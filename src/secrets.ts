import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "gavriel-mcp";
const SECRET_TOOL_TIMEOUT_MS = 5_000;

const LEGACY_PASSWORD_FILE = join(process.env.HOME || ".", ".secrets/gavriel-password");
const LEGACY_TOKENS_FILE = join(process.env.HOME || ".", ".local/share/gavriel-mcp/trusted-device.json");

let secretToolChecked = false;
let secretToolOK = false;

function hasSecretTool(): boolean {
  if (secretToolChecked) return secretToolOK;
  secretToolChecked = true;
  try {
    const r = spawnSync("which", ["secret-tool"], { timeout: SECRET_TOOL_TIMEOUT_MS });
    secretToolOK = r.status === 0 && r.error === undefined;
  } catch {
    secretToolOK = false;
  }
  if (!secretToolOK) {
    console.error(
      "[gavriel-mcp] warning: 'secret-tool' no está disponible, los secretos caen al fallback menos seguro " +
        "(env / archivo plano). Instalá libsecret-tools para usar el keyring del sistema.",
    );
  }
  return secretToolOK;
}

export function keyringLookup(account: string): string | null {
  if (!hasSecretTool()) return null;
  try {
    const r = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", account], {
      timeout: SECRET_TOOL_TIMEOUT_MS,
    });
    if (r.status !== 0 || r.error) return null;
    const out = r.stdout.toString("utf8").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function keyringStore(account: string, value: string): boolean {
  if (!hasSecretTool()) return false;
  try {
    const r = spawnSync(
      "secret-tool",
      ["store", `--label=Gavriel MCP - ${account}`, "service", SERVICE, "account", account],
      { input: value, timeout: SECRET_TOOL_TIMEOUT_MS },
    );
    return r.status === 0 && !r.error;
  } catch {
    return false;
  }
}

export function keyringClear(account: string): void {
  if (!hasSecretTool()) return;
  try {
    spawnSync("secret-tool", ["clear", "service", SERVICE, "account", account], {
      timeout: SECRET_TOOL_TIMEOUT_MS,
    });
  } catch {
    // best effort
  }
}

export function resolvePassword(): string | null {
  const fromKeyring = keyringLookup("password");
  if (fromKeyring) return fromKeyring;
  if (process.env.GAVRIEL_PASSWORD) return process.env.GAVRIEL_PASSWORD;
  try {
    const fromLegacy = readFileSync(LEGACY_PASSWORD_FILE, "utf8");
    if (fromLegacy) {
      console.error(
        "[gavriel-mcp] warning: usando password del archivo legacy (~/.secrets/gavriel-password, modo menos seguro). " +
          "Movelo al keyring con: secret-tool store --label='Gavriel MCP - password' service gavriel-mcp account password",
      );
    }
    return fromLegacy;
  } catch {
    return null;
  }
}

function readLegacyTokens(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(LEGACY_TOKENS_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLegacyTokens(all: Record<string, string>): void {
  try {
    mkdirSync(join(process.env.HOME || ".", ".local/share/gavriel-mcp"), { recursive: true });
    writeFileSync(LEGACY_TOKENS_FILE, JSON.stringify(all), { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(LEGACY_TOKENS_FILE, 0o600); // por si el archivo ya existía con permisos amplios
    } catch {
      // best effort
    }
  } catch (err) {
    console.error("[gavrielClient] no se pudo guardar el trusted device token:", err);
  }
}

// Clave keyring del trusted token, por-email: dos cuentas de Gavriel no se
// pisan el token. El lookup cae a la clave vieja sin email (migración).
const LEGACY_KEYRING_TOKEN_ACCOUNT = "trusted_device_token";

function tokenKeyringAccount(email: string): string {
  return `${LEGACY_KEYRING_TOKEN_ACCOUNT}:${email.toLowerCase().trim()}`;
}

export function readTrustedToken(email: string): string | null {
  const scoped = keyringLookup(tokenKeyringAccount(email));
  if (scoped) return scoped;
  const unscoped = keyringLookup(LEGACY_KEYRING_TOKEN_ACCOUNT);
  if (unscoped) return unscoped;
  if (process.env.GAVRIEL_TRUSTED_DEVICE_TOKEN) return process.env.GAVRIEL_TRUSTED_DEVICE_TOKEN;
  const legacy = readLegacyTokens()[email.toLowerCase().trim()];
  if (legacy) {
    console.error(
      "[gavriel-mcp] warning: usando trusted_device_token del archivo legacy (modo menos seguro). " +
        "Movelo al keyring con: secret-tool store --label='Gavriel MCP - trusted device token' service gavriel-mcp account trusted_device_token",
    );
  }
  return legacy ?? null;
}

export function saveTrustedToken(email: string, token: string): void {
  if (keyringStore(tokenKeyringAccount(email), token)) return;
  const all = readLegacyTokens();
  all[email.toLowerCase().trim()] = token;
  writeLegacyTokens(all);
}

export function clearTrustedToken(email: string): void {
  keyringClear(tokenKeyringAccount(email));
  keyringClear(LEGACY_KEYRING_TOKEN_ACCOUNT); // limpia también la clave pre-scoping
  const all = readLegacyTokens();
  delete all[email.toLowerCase().trim()];
  writeLegacyTokens(all);
}
