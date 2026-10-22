import { loadConfig, type Config } from "../config.js";
import { GavrielClient } from "../gavrielClient.js";
import { configDir, loadStore, saveStore, validateProfileName, type Profile, type ProfileStore } from "../profiles.js";
import {
  clearPassword, clearTotpSeed, clearTrustedToken, keyringLookup, passwordAccount, readTotpSeed, readTrustedToken,
  saveTotpSeed, secretBackend, storePassword,
} from "../secrets.js";
import { parseSeedInput, secondsLeft, totp, totpFresh } from "../totp.js";
import { ask, askHidden, confirm, printJson, printTable, rowsOf } from "./io.js";
import { mcpInstall } from "./mcpInstall.js";

export const OPTIONS = {
  profile: { type: "string", short: "p" },
  email: { type: "string" },
  code: { type: "string" },
  "api-base": { type: "string" },
  role: { type: "string" },
  toolsets: { type: "string" },
  client: { type: "string" },
  name: { type: "string" },
  status: { type: "string" },
  limit: { type: "string" },
  "server-path": { type: "string" },
  json: { type: "boolean" },
  all: { type: "boolean" },
  purge: { type: "boolean" },
  online: { type: "boolean" },
  force: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

export interface Ctx {
  values: Record<string, string | boolean | undefined>;
  args: string[]; // posicionales tras el subcomando
}

const DEFAULT_API = "https://app.gavriel.com.ar/api";
const TRUSTED_HOSTS = ["app.gavriel.com.ar"];
const ROLES = ["readonly", "lite", "full"];
const TOOLSET_NAMES = ["core", "notifications", "video", "telephony", "infrastructure", "coreGaps", "composites", "all"];
const RESERVED = ["__proto__", "constructor", "prototype"];

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

// Los perfiles vienen de JSON: nunca consultar `profiles[name]` a secas (constructor, __proto__...).
const has = (store: ProfileStore, name: string): boolean => Object.hasOwn(store.profiles, name);

export function checkName(name: string): void {
  validateProfileName(name);
  if (RESERVED.includes(name)) throw new Error(`Nombre reservado: "${name}"`);
}

export function parseLimit(v: string | undefined, def = 20): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < 1 || n > 200) throw new Error("--limit debe ser un entero entre 1 y 200");
  return n;
}

function optRole(ctx: Ctx): Profile["role"] | undefined {
  const r = str(ctx.values.role);
  if (r !== undefined && !ROLES.includes(r)) throw new Error(`--role debe ser ${ROLES.join("|")}`);
  return r as Profile["role"] | undefined;
}

function optToolsets(ctx: Ctx): string | undefined {
  const t = str(ctx.values.toolsets);
  if (t === undefined) return undefined;
  const parts = t.split(",").map((x) => x.trim());
  const bad = parts.filter((x) => !TOOLSET_NAMES.includes(x));
  if (bad.length > 0) throw new Error(`--toolsets inválido (${bad.join(", ") || "vacío"}). Válidos: ${TOOLSET_NAMES.join(", ")}`);
  return parts.join(",");
}

function optApiBase(ctx: Ctx): string | undefined {
  const v = str(ctx.values["api-base"]);
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("--api-base no es una URL válida");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("--api-base debe usar https (http solo para localhost)");
  if (!local && !TRUSTED_HOSTS.includes(u.hostname)) {
    console.error(`ADVERTENCIA: ${u.hostname} no es un host conocido de Gavriel (${TRUSTED_HOSTS.join(", ")}); tus credenciales se enviarán allí.`);
  }
  return v;
}

function profileName(ctx: Ctx): string {
  const name = str(ctx.values.profile) ?? str(process.env.GAVRIEL_PROFILE) ?? loadStore().active ?? undefined;
  if (!name) throw new Error("No hay perfil activo. Ejecutá `gavriel login` o usá --profile.");
  return name;
}

function profileOf(name: string): Profile {
  const store = loadStore();
  const p = has(store, name) ? store.profiles[name] : undefined;
  if (!p) throw new Error(`El perfil "${name}" no existe (gavriel profile list).`);
  return p;
}

// Código 2FA: --code, semilla TOTP guardada, o prompt si hay terminal.
function twoFactor(ctx: Ctx, email: string): () => Promise<string | undefined> {
  return async () => {
    const given = str(ctx.values.code);
    if (given) return given;
    const seed = readTotpSeed(email);
    if (seed) return totpFresh(seed);
    return process.stdin.isTTY ? await ask("Código 2FA de 6 dígitos: ") : undefined;
  };
}

function makeClient(ctx: Ctx, name: string): GavrielClient {
  const config = loadConfig({ profile: name });
  return new GavrielClient(config, { getTwoFactorCode: twoFactor(ctx, config.GAVRIEL_EMAIL) });
}

const fmtExp = (ms: number | null): string => (ms ? new Date(ms).toISOString() : "desconocido");

// ── login / renew / logout ────────────────────────────────────────────────
// Nombre por defecto desde el local-part del email: sin puntos/guiones iniciales y nunca vacío.
export function deriveProfileName(email: string): string {
  const n = email.split("@")[0].replace(/[^\w.-]/g, "_").replace(/^[.-]+/, "").slice(0, 40);
  return n || "perfil";
}

export async function login(ctx: Ctx): Promise<void> {
  const apiBase = optApiBase(ctx);
  const role = optRole(ctx);
  const toolsets = optToolsets(ctx);
  const email = str(ctx.values.email) ?? (await ask("Email: "));
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("Email inválido");
  const explicit = str(ctx.values.profile);
  const name = explicit ?? deriveProfileName(email);
  checkName(name);
  const store = loadStore();
  const prev = has(store, name) ? store.profiles[name] : undefined;
  if (prev && !explicit && prev.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`El perfil "${name}" ya existe con otro email (${prev.email}). Usá --profile <nombre> para elegir o reemplazar uno.`);
  }
  const password = await askHidden("Password: ");
  if (!password) throw new Error("Password requerido");
  // Primero se autentica con el password candidato (sin persistirlo); solo si anda se guarda todo.
  const config = {
    GAVRIEL_EMAIL: email, GAVRIEL_PASSWORD: password, GAVRIEL_API_BASE: apiBase ?? prev?.apiBase ?? DEFAULT_API,
    GAVRIEL_MCP_ROLE: role ?? prev?.role ?? "full", GAVRIEL_MCP_WRITE_CONCURRENCY: 5, GAVRIEL_MCP_DESTRUCTIVE_APPROVAL: "elicitation", strictProfile: true,
  } as Config;
  const client = new GavrielClient(config, { getTwoFactorCode: twoFactor(ctx, email) });
  await client.login();
  if (!storePassword(email, password)) {
    throw new Error("No hay almacén seguro disponible (Windows: DPAPI; Linux: libsecret-tools). No se guardó nada.");
  }
  store.profiles[name] = { ...prev, email, ...(apiBase && { apiBase }), ...(role && { role }), ...(toolsets && { toolsets }) };
  store.active = name;
  saveStore(store);
  console.log(`Sesión iniciada como ${email} (perfil "${name}", vence ${fmtExp(client.tokenExpiresAt)}).`);
}

export async function renew(ctx: Ctx): Promise<void> {
  const names = ctx.values.all ? Object.keys(loadStore().profiles) : [profileName(ctx)];
  if (names.length === 0) throw new Error("No hay perfiles.");
  for (const name of names) {
    const { email } = profileOf(name);
    clearTrustedToken(email, true);
    await makeClient(ctx, name).login();
    console.log(`[${name}] dispositivo confiable renovado.`);
  }
}

export async function logout(ctx: Ctx): Promise<void> {
  const store = loadStore();
  const names = ctx.values.all ? Object.keys(store.profiles) : [profileName(ctx)];
  for (const name of names) {
    const { email } = profileOf(name);
    clearTrustedToken(email, true);
    if (ctx.values.purge) {
      clearPassword(email);
      clearTotpSeed(email);
      delete store.profiles[name];
      if (store.active === name) store.active = null;
    }
    console.log(`[${name}] ${ctx.values.purge ? "credenciales y perfil borrados" : "dispositivo confiable borrado"}.`);
  }
  saveStore(store);
}

// ── perfiles ──────────────────────────────────────────────────────────────
export async function profile(ctx: Ctx): Promise<void> {
  const [sub, a, b] = ctx.args;
  const store = loadStore();
  switch (sub) {
    case "list": {
      const rows = Object.entries(store.profiles).map(([name, p]) => ({
        activo: store.active === name ? "*" : "", perfil: name, email: p.email, rol: p.role ?? "", api: p.apiBase ?? "",
      }));
      return ctx.values.json ? printJson(store) : printTable(rows);
    }
    case "add": {
      if (!a) throw new Error("Uso: gavriel profile add <nombre> --email <email>");
      checkName(a);
      const email = str(ctx.values.email);
      if (!email) throw new Error("Falta --email");
      const apiBase = optApiBase(ctx);
      const role = optRole(ctx);
      const toolsets = optToolsets(ctx);
      store.profiles[a] = { email, ...(apiBase && { apiBase }), ...(role && { role }), ...(toolsets && { toolsets }) };
      store.active ??= a;
      saveStore(store);
      return console.log(`Perfil "${a}" creado. Ejecutá: gavriel login --profile ${a} --email ${email}`);
    }
    case "use":
      if (!a || !has(store, a)) throw new Error(`El perfil "${a ?? ""}" no existe.`);
      store.active = a;
      saveStore(store);
      return console.log(`Perfil activo: ${a}`);
    case "remove": {
      if (!a || !has(store, a)) throw new Error(`El perfil "${a ?? ""}" no existe.`);
      if (ctx.values.purge) {
        const { email } = store.profiles[a];
        clearTrustedToken(email, true);
        clearPassword(email);
        clearTotpSeed(email);
      }
      delete store.profiles[a];
      if (store.active === a) store.active = Object.keys(store.profiles)[0] ?? null;
      saveStore(store);
      return console.log(`Perfil "${a}" eliminado${ctx.values.purge ? " junto con sus secretos" : ""}.`);
    }
    case "rename": {
      if (!a || !b || !has(store, a)) throw new Error("Uso: gavriel profile rename <viejo> <nuevo>");
      checkName(b);
      if (has(store, b)) throw new Error(`Ya existe "${b}".`);
      store.profiles[b] = store.profiles[a];
      delete store.profiles[a];
      if (store.active === a) store.active = b;
      saveStore(store);
      return console.log(`"${a}" → "${b}"`);
    }
    default:
      throw new Error("Uso: gavriel profile list|add|use|remove|rename");
  }
}

// ── totp ──────────────────────────────────────────────────────────────────
export async function totpCmd(ctx: Ctx): Promise<void> {
  const [sub] = ctx.args;
  const { email } = profileOf(profileName(ctx));
  if (sub === "set") {
    console.error(
      "ADVERTENCIA: guardar la semilla en este equipo permite generar códigos 2FA sin tu teléfono; " +
        "quien acceda a tu usuario de Windows podrá iniciar sesión sin segundo factor.",
    );
    if (!ctx.values.yes && !(await confirm("¿Guardar la semilla TOTP?"))) throw new Error("Cancelado");
    const seed = parseSeedInput(await askHidden("Semilla base32 o URI otpauth://: "));
    if (!saveTotpSeed(email, seed)) throw new Error("No hay almacén seguro disponible; no se guardó.");
    return console.log(`Semilla guardada. Código actual: ${totp(seed)} (válido ${secondsLeft()} s).`);
  }
  if (sub === "clear") {
    clearTotpSeed(email);
    return console.log("Semilla borrada.");
  }
  if (sub === "code") {
    const seed = readTotpSeed(email);
    if (!seed) throw new Error("No hay semilla guardada (gavriel totp set).");
    const out = { code: totp(seed), secondsLeft: secondsLeft() };
    return ctx.values.json ? printJson(out) : console.log(`${out.code}  (${out.secondsLeft} s)`);
  }
  throw new Error("Uso: gavriel totp set|clear|code");
}

// ── whoami / doctor ───────────────────────────────────────────────────────
export async function whoami(ctx: Ctx): Promise<void> {
  const name = profileName(ctx);
  const res = await makeClient(ctx, name).get("/auth/profile");
  const d = (res.data ?? {}) as Record<string, unknown>;
  const out = Object.fromEntries(Object.entries(d).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)));
  printJson({ perfil: name, ...out });
}

export async function doctor(ctx: Ctx): Promise<void> {
  let failed = false;
  const check = (ok: boolean, label: string, detail = ""): void => {
    if (!ok) failed = true;
    console.log(`${ok ? "OK  " : "FALLA"} ${label}${detail ? ` — ${detail}` : ""}`);
  };
  try {
    const backend = secretBackend();
    check(backend !== "none", "Almacén seguro", backend);
    console.log(`     config: ${configDir()}`);
    const name = profileName(ctx);
    const p = profileOf(name);
    const config = loadConfigSafe(name);
    const base = config?.GAVRIEL_API_BASE ?? p.apiBase ?? DEFAULT_API;
    check(true, "Perfil", `${name} <${p.email}>`);
    check(/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(base), "API base con https", base);
    check(Boolean(keyringLookup(passwordAccount(p.email))), "Password guardado");
    check(Boolean(readTrustedToken(p.email, true)), "Dispositivo confiable", "se renueva con `gavriel renew`");
    console.log(`     semilla TOTP: ${readTotpSeed(p.email) ? "guardada" : "no guardada"}`);
    try {
      await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      check(true, "API alcanzable");
    } catch (e) {
      check(false, "API alcanzable", (e as Error).message);
    }
    if (!config) console.log("     Sesión: omitida (sin password)");
    else if (!ctx.values.online) console.log("     Sesión: omitida (use --online)");
    else {
      try {
        const client = makeClient(ctx, name);
        await client.login();
        check(true, "Sesión", `JWT vence ${fmtExp(client.tokenExpiresAt)}`);
      } catch (e) {
        check(false, "Sesión", (e as Error).message);
      }
    }
  } catch (e) {
    check(false, "Diagnóstico", (e as Error).message);
  }
  if (failed) process.exitCode = 1;
}

function loadConfigSafe(name: string): ReturnType<typeof loadConfig> | null {
  try {
    return loadConfig({ profile: name });
  } catch {
    return null;
  }
}

// ── mcp install ───────────────────────────────────────────────────────────
export async function mcp(ctx: Ctx): Promise<void> {
  if (ctx.args[0] !== "install") {
    throw new Error("Uso: gavriel mcp install [--client desktop|code] [--role r] [--toolsets t] [--force] [--server-path ruta] [--dry-run] [-y]");
  }
  const client = str(ctx.values.client) ?? "desktop";
  if (client !== "desktop" && client !== "code") throw new Error("--client debe ser desktop o code");
  const entryName = str(ctx.values.name) ?? "gavriel";
  checkName(entryName);
  const role = optRole(ctx);
  const toolsets = optToolsets(ctx);
  const name = profileName(ctx);
  const p = profileOf(name);
  await mcpInstall({
    client, name: entryName, profile: name, role: role ?? p.role, toolsets: toolsets ?? p.toolsets,
    dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes), force: Boolean(ctx.values.force),
    serverPath: str(ctx.values["server-path"]),
  });
}

// ── consultas ─────────────────────────────────────────────────────────────
function show(ctx: Ctx, data: unknown): void {
  if (ctx.values.json) return printJson(data);
  const rows = rowsOf(data);
  rows.length ? printTable(rows) : printJson(data);
}

export async function tickets(ctx: Ctx): Promise<void> {
  const params: Record<string, unknown> = { limit: parseLimit(str(ctx.values.limit)) };
  if (str(ctx.values.status)) params.status = str(ctx.values.status);
  show(ctx, (await makeClient(ctx, profileName(ctx)).get("/tickets", params)).data);
}

export async function events(ctx: Ctx): Promise<void> {
  if (ctx.args[0] !== "pending") throw new Error("Uso: gavriel events pending");
  show(ctx, (await makeClient(ctx, profileName(ctx)).get("/events/accounts-with-pending-events")).data);
}

export async function accounts(ctx: Ctx): Promise<void> {
  const [sub, q] = ctx.args;
  const limit = parseLimit(str(ctx.values.limit));
  const client = makeClient(ctx, profileName(ctx));
  if (sub === "search" && q) return show(ctx, (await client.get("/accounts", { search: q, limit })).data);
  if (sub === "get" && q) {
    if (!/^[\w-]+$/.test(q)) throw new Error("Identificador inválido");
    return printJson((await client.get(`/accounts/${encodeURIComponent(q)}`)).data);
  }
  throw new Error("Uso: gavriel accounts search <texto> | gavriel accounts get <id>");
}
