import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as util from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolvePassword } from "./secrets.js";
import { loadStore, getProfile, validateProfileName, type ProfileStore } from "./profiles.js";

function isSecureBase(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

const DEFAULT_API_BASE = "https://app.gavriel.com.ar/api";

const envSchema = z.object({
  GAVRIEL_EMAIL: z.string().min(1, "GAVRIEL_EMAIL es requerido"),
  // El password se resuelve al cargar: keyring > env > archivo legacy (ver secrets.ts).
  GAVRIEL_PASSWORD: z.string().optional(),
  GAVRIEL_TRUSTED_DEVICE_TOKEN: z
    .string()
    .optional()
    .describe("Trusted device token (fallback para dev, normalmente va en keyring)"),
  GAVRIEL_2FA_CODE: z
    .string()
    .optional()
    .describe(
      "Código de 2FA solo si el dispositivo no está confiado (la primera vez). Una vez guardado el trusted_device_token no hace falta.",
    ),
  GAVRIEL_API_BASE: z
    .string()
    .url("GAVRIEL_API_BASE debe ser una URL válida")
    .refine(isSecureBase, "GAVRIEL_API_BASE debe usar https (http solo para localhost/127.0.0.1)")
    .default(DEFAULT_API_BASE),
  GAVRIEL_MCP_LOG_DIR: z.string().optional(),
  // Roles: readonly (solo lectura) < lite (lectura + core writes) < full (todo).
  GAVRIEL_MCP_ROLE: z.enum(["readonly", "lite", "full"]).default("full"),
  // Escrituras en vuelo simultáneas por recurso (cola por path, ver gavrielClient).
  GAVRIEL_MCP_WRITE_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  // Aprobación humana extra para tools destructivas: "elicitation" (default) | "off".
  GAVRIEL_MCP_DESTRUCTIVE_APPROVAL: z.enum(["off", "elicitation"]).default("elicitation"),
});

export type Config = Omit<z.infer<typeof envSchema>, "GAVRIEL_PASSWORD"> & {
  GAVRIEL_PASSWORD: string;
  /** Config nacida de un perfil: secretos solo de su propio email (sin fallbacks globales). */
  strictProfile?: boolean;
};

// Claves que vinieron del archivo .env (no del entorno real): se usan para no confiar ciegamente en ellas.
const dotEnvKeys = new Set<string>();

// Directorio del módulo; también funciona empaquetado a CJS (SEA), donde import.meta.url no existe.
function moduleDir(): string {
  try {
    if (import.meta.url) return dirname(fileURLToPath(import.meta.url));
  } catch {
    // bundle CJS: import.meta no está definido
  }
  if (typeof __dirname !== "undefined") return __dirname;
  return dirname(process.argv[1] ?? process.execPath);
}

// Solo el .env junto a la raíz del proyecto/dist (nunca el del cwd: un repo ajeno podría
// plantar uno). Un valor del archivo jamás pisa una variable ya definida en el entorno real.
function loadDotEnv(): void {
  const parseEnv = (util as { parseEnv?: (c: string) => Record<string, string | undefined> }).parseEnv;
  if (!parseEnv) return; // Node < 20.12
  let text: string;
  try {
    text = readFileSync(join(moduleDir(), "..", ".env"), "utf8");
  } catch {
    return; // sin .env, alcanzan las variables del sistema
  }
  for (const [k, v] of Object.entries(parseEnv(text))) {
    if (v === undefined || process.env[k] !== undefined) continue;
    process.env[k] = v;
    dotEnvKeys.add(k);
  }
}

// Strings vacíos (VAR=) se tratan como no definidos para que apliquen los defaults/optional de zod.
function readEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    out[key] = process.env[key] || undefined;
  }
  return out;
}

// Perfil: explícito, GAVRIEL_PROFILE, o el activo si no hay GAVRIEL_EMAIL (modo env intacto).
export function loadConfig(opts: { profile?: string } = {}): Config {
  loadDotEnv();
  const env = readEnv();
  const explicit = opts.profile ?? (process.env.GAVRIEL_PROFILE || undefined);
  let store: ProfileStore | undefined;
  const getStore = () => (store ??= loadStore());
  const name = explicit ?? (env.GAVRIEL_EMAIL ? undefined : getStore().active ?? undefined);
  if (name) validateProfileName(name);
  const profile = name ? getProfile(getStore(), name) : undefined;
  if (name && !profile) throw new Error(`El perfil "${name}" no existe (ver: gavriel accounts list).`);
  if (profile) {
    env.GAVRIEL_EMAIL = profile.email;
    if (profile.apiBase) env.GAVRIEL_API_BASE = profile.apiBase;
    if (profile.role) env.GAVRIEL_MCP_ROLE = profile.role;
    if (profile.toolsets) process.env.GAVRIEL_MCP_TOOLSETS ??= profile.toolsets;
  }
  // Un .env hostil podría apuntar la API a un host propio y recibir email/password en el login.
  // Una base distinta de la default que venga del .env se rechaza salvo opt-in explícito en el
  // entorno real (GAVRIEL_ALLOW_CUSTOM_API_BASE=1; el .env no puede habilitarse a sí mismo).
  const base = env.GAVRIEL_API_BASE?.replace(/\/+$/, "");
  if (
    !profile?.apiBase &&
    base &&
    base !== DEFAULT_API_BASE &&
    dotEnvKeys.has("GAVRIEL_API_BASE") &&
    !(process.env.GAVRIEL_ALLOW_CUSTOM_API_BASE === "1" && !dotEnvKeys.has("GAVRIEL_ALLOW_CUSTOM_API_BASE"))
  ) {
    throw new Error(
      `GAVRIEL_API_BASE=${base} viene de un archivo .env y no es la API oficial. ` +
        "Definila en el entorno real o exportá GAVRIEL_ALLOW_CUSTOM_API_BASE=1 para permitirla.",
    );
  }
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuración de Gavriel MCP inválida.\n${missing}\n\n` +
        `Copiá .env.example a .env y completá las credenciales.`,
    );
  }
  const password = resolvePassword(parsed.data.GAVRIEL_EMAIL, Boolean(profile));
  if (!password) {
    throw new Error(
      profile
        ? `No hay password guardado para ${parsed.data.GAVRIEL_EMAIL}. Ejecutá: gavriel login --profile ${name}`
        : "No se encontró el password de Gavriel en el almacén seguro ni en GAVRIEL_PASSWORD (ver SECURITY.md).",
    );
  }
  return { ...parsed.data, GAVRIEL_PASSWORD: password, strictProfile: Boolean(profile) };
}

export function logDir(config: Config): string {
  return config.GAVRIEL_MCP_LOG_DIR || join(homedir(), ".local", "share", "gavriel-mcp");
}
