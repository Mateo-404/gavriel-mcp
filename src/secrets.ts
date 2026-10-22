import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "gavriel-mcp";
const SECRET_TOOL_TIMEOUT_MS = 5_000;
const POWERSHELL_TIMEOUT_MS = 15_000;
const IS_WIN = process.platform === "win32";

const LEGACY_PASSWORD_FILE = join(homedir(), ".secrets/gavriel-password");
const LEGACY_TOKENS_DIR = join(homedir(), ".local/share/gavriel-mcp");
const LEGACY_TOKENS_FILE = join(LEGACY_TOKENS_DIR, "trusted-device.json");

// Los archivos en texto plano solo se usan con opt-in explícito.
function plaintextAllowed(): boolean {
  return process.env.GAVRIEL_ALLOW_PLAINTEXT === "1";
}

// ── Windows: DPAPI (ConvertTo/From-SecureString), blob cifrado en %APPDATA% ──
// El secreto viaja por stdin, nunca por argv ni interpolado en el script.
// shortcut: DPAPI ata el blob al usuario de Windows; no hay backend macOS (la CLI
// `security` solo acepta el secreto por argv, visible en la lista de procesos).
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
const PS_PROTECT =
  "$p=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $p -AsPlainText -Force | ConvertFrom-SecureString";
const PS_UNPROTECT =
  "$b=[Console]::In.ReadToEnd().Trim(); $s=ConvertTo-SecureString -String $b; " +
  "[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))";

function dpapiFile(account: string): string {
  const base = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const id = createHash("sha256").update(account).digest("hex").slice(0, 24);
  return join(base, SERVICE, "secrets", `${id}.dpapi`);
}

// Ruta absoluta: evita que un powershell.exe plantado en el PATH/cwd reciba los secretos.
function powershellExe(): string {
  const abs = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(abs) ? abs : "powershell.exe";
}

function powershell(script: string, input: string): string | null {
  const r = spawnSync(powershellExe(), [...PS_ARGS, script], {
    input,
    timeout: POWERSHELL_TIMEOUT_MS,
    windowsHide: true,
    encoding: "utf8",
  });
  if (r.status !== 0 || r.error) return null;
  return r.stdout.replace(/[\r\n]+$/, "");
}

let secretToolChecked = false;
let secretToolOK = false;

function hasSecretTool(): boolean {
  if (IS_WIN) return true; // DPAPI siempre disponible
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
      "[gavriel-mcp] warning: no hay almacén seguro disponible (secret-tool). " +
        "Instalá libsecret-tools; el fallback en texto plano requiere GAVRIEL_ALLOW_PLAINTEXT=1.",
    );
  }
  return secretToolOK;
}

// Cache por proceso (cada lookup spawnea un proceso bloqueante); store/clear la invalidan.
const lookupCache = new Map<string, string | null>();

export function keyringLookup(account: string): string | null {
  if (lookupCache.has(account)) return lookupCache.get(account) ?? null;
  const v = keyringLookupRaw(account);
  lookupCache.set(account, v);
  return v;
}

function keyringLookupRaw(account: string): string | null {
  if (IS_WIN) {
    try {
      const blob = readFileSync(dpapiFile(account), "utf8");
      const v = powershell(PS_UNPROTECT, blob);
      return v ? v : null;
    } catch {
      return null;
    }
  }
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
  lookupCache.delete(account);
  if (IS_WIN) {
    try {
      const blob = powershell(PS_PROTECT, value);
      if (!blob) return false;
      const file = dpapiFile(account);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, blob, { encoding: "utf8", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
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
  lookupCache.delete(account);
  if (IS_WIN) {
    try {
      if (existsSync(dpapiFile(account))) rmSync(dpapiFile(account));
    } catch {
      // best effort
    }
    return;
  }
  if (!hasSecretTool()) return;
  try {
    spawnSync("secret-tool", ["clear", "service", SERVICE, "account", account], {
      timeout: SECRET_TOOL_TIMEOUT_MS,
    });
  } catch {
    // best effort
  }
}

const normEmail = (email: string): string => email.toLowerCase().trim();

// Clave por email para multi-cuenta; `resolvePassword()` sin email sigue usando la global.
export const passwordAccount = (email: string): string => `password:${normEmail(email)}`;
export const totpSeedAccount = (email: string): string => `totp_seed:${normEmail(email)}`;

export function storePassword(email: string, password: string): boolean {
  return keyringStore(passwordAccount(email), password);
}
export function clearPassword(email: string): void {
  keyringClear(passwordAccount(email));
}
export function readTotpSeed(email: string): string | null {
  return keyringLookup(totpSeedAccount(email));
}
export function saveTotpSeed(email: string, seed: string): boolean {
  return keyringStore(totpSeedAccount(email), seed);
}
export function clearTotpSeed(email: string): void {
  keyringClear(totpSeedAccount(email));
}

// Para `gavriel doctor`: qué almacén seguro se usaría (sin leer secretos).
export function secretBackend(): "dpapi" | "secret-tool" | "none" {
  if (IS_WIN) return "dpapi";
  return hasSecretTool() ? "secret-tool" : "none";
}

let warnedGlobalPassword = false;
function warnGlobalPasswordOnce(email: string): void {
  if (warnedGlobalPassword) return;
  warnedGlobalPassword = true;
  console.error(
    `[gavriel-mcp] warning: no hay password guardado para ${email}; se usa el password global del keyring, que puede ser de otra cuenta. ` +
      "Guardá uno por cuenta (gavriel login).",
  );
}

// strict (modo perfil): solo la clave de ese email, sin caer a la global ni a env/archivos de otra cuenta.
export function resolvePassword(email?: string, strict = false): string | null {
  if (strict && email) return keyringLookup(passwordAccount(email));
  const scoped = email ? keyringLookup(passwordAccount(email)) : null;
  if (scoped) return scoped;
  const fromKeyring = keyringLookup("password");
  if (fromKeyring) {
    if (email) warnGlobalPasswordOnce(email);
    return fromKeyring;
  }
  if (process.env.GAVRIEL_PASSWORD) return process.env.GAVRIEL_PASSWORD;
  if (!plaintextAllowed()) return null;
  try {
    // solo el salto de línea final: los espacios pueden ser parte del password
    const fromLegacy = readFileSync(LEGACY_PASSWORD_FILE, "utf8").replace(/\r?\n$/, "");
    if (fromLegacy) {
      console.error(
        "[gavriel-mcp] warning: usando password del archivo legacy (~/.secrets/gavriel-password, modo menos seguro). " +
          "Movelo al almacén seguro (ver SECURITY.md).",
      );
    }
    return fromLegacy;
  } catch {
    return null;
  }
}

function readLegacyTokens(): Record<string, string> {
  if (!plaintextAllowed()) return {};
  try {
    return JSON.parse(readFileSync(LEGACY_TOKENS_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLegacyTokens(all: Record<string, string>): void {
  if (!plaintextAllowed()) return;
  try {
    mkdirSync(LEGACY_TOKENS_DIR, { recursive: true });
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

// strict (modo perfil): solo la clave de ese email; sin caer a la clave sin scope ni a GAVRIEL_TRUSTED_DEVICE_TOKEN.
export function readTrustedToken(email: string, strict = false): string | null {
  const scoped = keyringLookup(tokenKeyringAccount(email));
  if (scoped) return scoped;
  if (!strict) {
    const unscoped = keyringLookup(LEGACY_KEYRING_TOKEN_ACCOUNT);
    if (unscoped) return unscoped;
    if (process.env.GAVRIEL_TRUSTED_DEVICE_TOKEN) return process.env.GAVRIEL_TRUSTED_DEVICE_TOKEN;
  }
  const legacy = readLegacyTokens()[email.toLowerCase().trim()];
  if (legacy) {
    console.error(
      "[gavriel-mcp] warning: usando trusted_device_token del archivo legacy (modo menos seguro). " +
        "Movelo al almacén seguro (ver SECURITY.md).",
    );
  }
  return legacy ?? null;
}

export function saveTrustedToken(email: string, token: string): void {
  if (keyringStore(tokenKeyringAccount(email), token)) return;
  if (!plaintextAllowed()) {
    console.error("[gavriel-mcp] no hay almacén seguro: el trusted device token no se persistió (GAVRIEL_ALLOW_PLAINTEXT=1 para forzar texto plano).");
    return;
  }
  const all = readLegacyTokens();
  all[email.toLowerCase().trim()] = token;
  writeLegacyTokens(all);
}

export function clearTrustedToken(email: string, strict = false): void {
  keyringClear(tokenKeyringAccount(email));
  if (!strict) keyringClear(LEGACY_KEYRING_TOKEN_ACCOUNT); // limpia también la clave pre-scoping (nunca en modo perfil)
  const all = readLegacyTokens();
  delete all[email.toLowerCase().trim()];
  writeLegacyTokens(all);
}
