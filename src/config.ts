import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolvePassword } from "./secrets.js";
import { loadStore } from "./profiles.js";

function isSecureBase(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

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
    .default("https://app.gavriel.com.ar/api"),
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
};

function loadDotEnv(): void {
  try {
    process.loadEnvFile?.();
    return;
  } catch {
    // no .env in cwd, try alongside the built dist/
  }
  try {
    // raíz del proyecto (src/ o dist/); fileURLToPath maneja espacios y rutas de Windows
    process.loadEnvFile?.(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    // no .env found anywhere, env vars del sistema alcanzan
  }
}

function readEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    out[key] = process.env[key];
  }
  return out;
}

// Perfil: explícito, GAVRIEL_PROFILE, o el activo si no hay GAVRIEL_EMAIL (modo env intacto).
export function loadConfig(opts: { profile?: string } = {}): Config {
  loadDotEnv();
  const env = readEnv();
  const name = opts.profile ?? process.env.GAVRIEL_PROFILE ?? (env.GAVRIEL_EMAIL ? undefined : loadStore().active ?? undefined);
  const profile = name ? loadStore().profiles[name] : undefined;
  if (name && !profile) throw new Error(`El perfil "${name}" no existe (ver: gavriel accounts list).`);
  if (profile) {
    env.GAVRIEL_EMAIL = profile.email;
    if (profile.apiBase) env.GAVRIEL_API_BASE = profile.apiBase;
    if (profile.role) env.GAVRIEL_MCP_ROLE = profile.role;
    if (profile.toolsets) process.env.GAVRIEL_MCP_TOOLSETS ??= profile.toolsets;
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
  return { ...parsed.data, GAVRIEL_PASSWORD: password };
}

export function logDir(config: Config): string {
  return config.GAVRIEL_MCP_LOG_DIR || join(homedir(), ".local", "share", "gavriel-mcp");
}
