import { z } from "zod";
import { resolvePassword } from "./secrets.js";

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
    .default("https://app.gavriel.com.ar/api"),
  GAVRIEL_MCP_LOG_DIR: z.string().optional(),
  // readonly: solo tools de lectura. full (default): todas + escritura.
  GAVRIEL_MCP_ROLE: z.enum(["readonly", "full"]).default("full"),
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
    const root = new URL("../", import.meta.url).pathname; // raíz del proyecto (src/ o dist/)
    process.loadEnvFile?.(`${root}.env`);
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

export function loadConfig(): Config {
  loadDotEnv();
  const parsed = envSchema.safeParse(readEnv());
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuración de Gavriel MCP inválida.\n${missing}\n\n` +
        `Copiá .env.example a .env y completá las credenciales.`,
    );
  }
  const password = resolvePassword();
  if (!password) {
    throw new Error(
      "No se encontró el password de Gavriel en el keyring, en GAVRIEL_PASSWORD ni en ~/.secrets/gavriel-password.\n" +
        "Guardalo con: secret-tool store --label='Gavriel MCP - password' service gavriel-mcp account password",
    );
  }
  return { ...parsed.data, GAVRIEL_PASSWORD: password };
}

export function logDir(config: Config): string {
  return (
    config.GAVRIEL_MCP_LOG_DIR ||
    `${process.env.HOME || process.env.USERPROFILE || "."}/.local/share/gavriel-mcp`
  );
}
