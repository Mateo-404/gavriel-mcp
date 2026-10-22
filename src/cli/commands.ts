import { loadConfig, type Config } from "../config.js";
import { GavrielClient } from "../gavrielClient.js";
import { configDir, loadStore, saveStore, validateProfileName, type Profile, type ProfileStore } from "../profiles.js";
import {
  clearPassword, clearTotpSeed, clearTrustedToken, keyringLookup, passwordAccount, readTotpSeed, readTrustedToken,
  saveTotpSeed, secretBackend, storePassword,
} from "../secrets.js";
import { parseSeedInput, secondsLeft, totp, totpFresh } from "../totp.js";
import { ask, askHidden, confirm, rowsOf } from "./io.js";
import * as ui from "./ui.js";
import { parseClients } from "./clients.js";
import { install, uninstall } from "./install.js";
import { mcpInstall, mcpUninstall } from "./mcpInstall.js";

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
  logo: { type: "string" },
  dir: { type: "string" },
  register: { type: "string" },
  "no-path": { type: "boolean" },
  "keep-claude": { type: "boolean" },
  "no-color": { type: "boolean" },
  plain: { type: "boolean" },
  "no-anim": { type: "boolean" },
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
    console.error(ui.line("warn", `ADVERTENCIA: ${u.hostname} no es un host conocido de Gavriel (${TRUSTED_HOSTS.join(", ")}); tus credenciales se enviarán allí.`));
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
let activeSpin: ui.Spin | undefined;
const json = (ctx: Ctx): boolean => Boolean(ctx.values.json);
const showBanner = (ctx: Ctx): Promise<void> => (json(ctx) ? Promise.resolve() : ui.banner({ stream: process.stderr }));

function twoFactor(ctx: Ctx, email: string): () => Promise<string | undefined> {
  return async () => {
    const given = str(ctx.values.code);
    if (given) return given;
    const seed = readTotpSeed(email);
    if (seed) {
      activeSpin?.update("Generando código TOTP desde la semilla guardada");
      return totpFresh(seed);
    }
    if (!process.stdin.isTTY) return undefined;
    activeSpin?.stop();
    const code = await ask(ui.prompt("Código 2FA (6 dígitos)"));
    activeSpin = ui.spinner("Verificando el código");
    return code;
  };
}

// Ejecuta un login con spinner; el mensaje final lo decide quien llama.
async function loginWithSpinner(client: GavrielClient, label: string): Promise<void> {
  activeSpin = ui.spinner(label);
  try {
    await client.login();
    activeSpin.stop();
  } catch (e) {
    activeSpin.fail((e as Error).message.split("\n")[0]);
    throw new SilentError((e as Error).message);
  } finally {
    activeSpin = undefined;
  }
}

/** Error cuyo mensaje ya se mostró (spinner); cli.ts solo fija el código de salida. */
export class SilentError extends Error {}

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

const MAX_LOGIN_TRIES = 5;
// Errores del backend que tienen sentido reintentar en una terminal (credenciales o código); los de red no.
const CREDENTIAL_ERROR = /Login (con 2FA )?falló \((400|401|403|422)\)|Código 2FA rechazado/;

export async function login(ctx: Ctx): Promise<void> {
  const apiBase = optApiBase(ctx);
  const role = optRole(ctx);
  const toolsets = optToolsets(ctx);
  await showBanner(ctx);
  const email = str(ctx.values.email) ?? (await ask(ui.prompt("Email")));
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("Email inválido");
  const explicit = str(ctx.values.profile);
  const name = explicit ?? deriveProfileName(email);
  checkName(name);
  const store = loadStore();
  const prev = has(store, name) ? store.profiles[name] : undefined;
  if (prev && !explicit && prev.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`El perfil "${name}" ya existe con otro email (${prev.email}). Usá --profile <nombre> para elegir o reemplazar uno.`);
  }
  // Primero se autentica con el password candidato (sin persistirlo); solo si anda se guarda todo.
  // En una terminal, un password o código incorrecto permite reintentar (sin pisar nada guardado).
  let password = "";
  let client!: GavrielClient;
  let askPassword = true;
  let codeFlag = str(ctx.values.code);
  for (let attempt = 1; ; attempt++) {
    if (askPassword) {
      password = await askHidden(ui.prompt(attempt === 1 ? "Password" : "Password (reintento)"));
      if (!password) throw new Error("Password requerido");
    }
    const config = {
      GAVRIEL_EMAIL: email, GAVRIEL_PASSWORD: password, GAVRIEL_API_BASE: apiBase ?? prev?.apiBase ?? DEFAULT_API,
      GAVRIEL_MCP_ROLE: role ?? prev?.role ?? "full", GAVRIEL_MCP_WRITE_CONCURRENCY: 5, GAVRIEL_MCP_DESTRUCTIVE_APPROVAL: "elicitation", strictProfile: true,
    } as Config;
    const tryCtx: Ctx = { ...ctx, values: { ...ctx.values, code: codeFlag } };
    client = new GavrielClient(config, { getTwoFactorCode: twoFactor(tryCtx, email) });
    try {
      await loginWithSpinner(client, "Autenticando con Gavriel");
      break;
    } catch (e) {
      const msg = (e as Error).message;
      if (!process.stdin.isTTY || attempt >= MAX_LOGIN_TRIES || !CREDENTIAL_ERROR.test(msg)) throw e;
      const badCode = /Código 2FA rechazado|2FA falló/.test(msg);
      askPassword = !badCode; // código malo: se reutiliza el password y se pide solo el código
      codeFlag = undefined; // un --code ya usado no sirve de nuevo
      console.error(ui.line("warn", `${badCode ? "Código 2FA incorrecto" : "Email o password incorrectos"} (intento ${attempt}/${MAX_LOGIN_TRIES}). Probá de nuevo o Ctrl-C para salir.`));
    }
  }
  if (!storePassword(email, password)) {
    throw new Error("No hay almacén seguro disponible (Windows: DPAPI; Linux: libsecret-tools). No se guardó nada.");
  }
  store.profiles[name] = { ...prev, email, ...(apiBase && { apiBase }), ...(role && { role }), ...(toolsets && { toolsets }) };
  store.active = name;
  saveStore(store);
  console.log(ui.line("ok", `Sesión iniciada como ${email}`, process.stdout));
  console.log(ui.kv([
    ["Perfil", `${name}${prev ? "" : " (nuevo)"}`, "brand"],
    ["Vence", ui.shortDate(client.tokenExpiresAt ? new Date(client.tokenExpiresAt).toISOString() : "") || "desconocido"],
    ["Dispositivo confiable", readTrustedToken(email, true) ? "guardado" : "no guardado", readTrustedToken(email, true) ? "ok" : "warn"],
    ["Semilla TOTP", readTotpSeed(email) ? "guardada (renovación automática)" : "no guardada — gavriel totp set", readTotpSeed(email) ? "ok" : "muted"],
  ]));
}

export async function renew(ctx: Ctx): Promise<void> {
  const names = ctx.values.all ? Object.keys(loadStore().profiles) : [profileName(ctx)];
  if (names.length === 0) throw new Error("No hay perfiles.");
  for (const name of names) {
    const { email } = profileOf(name);
    clearTrustedToken(email, true);
    await loginWithSpinner(makeClient(ctx, name), `Renovando dispositivo confiable de "${name}"`);
    console.log(ui.line("ok", `[${name}] dispositivo confiable renovado.`, process.stdout));
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
    console.log(ui.line("ok", `[${name}] ${ctx.values.purge ? "credenciales y perfil borrados" : "dispositivo confiable borrado"}.`, process.stdout));
  }
  saveStore(store);
}

// ── perfiles ──────────────────────────────────────────────────────────────
export async function profile(ctx: Ctx): Promise<void> {
  const [sub, a, b] = ctx.args;
  const store = loadStore();
  switch (sub) {
    case "list": {
      if (ctx.values.json) return console.log(ui.json(store));
      const rows = Object.entries(store.profiles).map(([name, p]) => ({ name, p, active: store.active === name }));
      if (rows.length === 0) return console.log(ui.line("info", "No hay perfiles. Creá uno con: gavriel login", process.stdout));
      return console.log(ui.table(rows, [
        { title: ui.glyphs().dot, value: (r) => (r.active ? ui.glyphs().dot : ""), slot: () => "brand" },
        { title: "Perfil", value: (r) => r.name, slot: (r) => (r.active ? "brand" : undefined) },
        { title: "Email", value: (r) => r.p.email },
        { title: "Rol", value: (r) => r.p.role ?? "full", slot: (r) => (r.p.role === "readonly" ? "ok" : r.p.role === "lite" ? "warn" : "muted") },
        { title: "API", value: (r) => r.p.apiBase ?? "(por defecto)", slot: () => "muted" },
      ]));
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
      return console.log(ui.line("ok", `Perfil "${a}" creado. Ejecutá: gavriel login --profile ${a} --email ${email}`, process.stdout));
    }
    case "use":
      if (!a || !has(store, a)) throw new Error(`El perfil "${a ?? ""}" no existe.`);
      store.active = a;
      saveStore(store);
      return console.log(ui.line("ok", `Perfil activo: ${a}`, process.stdout));
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
      return console.log(ui.line("ok", `Perfil "${a}" eliminado${ctx.values.purge ? " junto con sus secretos" : ""}.`, process.stdout));
    }
    case "rename": {
      if (!a || !b || !has(store, a)) throw new Error("Uso: gavriel profile rename <viejo> <nuevo>");
      checkName(b);
      if (has(store, b)) throw new Error(`Ya existe "${b}".`);
      store.profiles[b] = store.profiles[a];
      delete store.profiles[a];
      if (store.active === a) store.active = b;
      saveStore(store);
      return console.log(ui.line("ok", `"${a}" → "${b}"`, process.stdout));
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
    console.error(ui.line("warn",
      "ADVERTENCIA: guardar la semilla en este equipo permite generar códigos 2FA sin tu teléfono; " +
        "quien acceda a tu usuario de Windows podrá iniciar sesión sin segundo factor.",
    ));
    if (!ctx.values.yes && !(await confirm("¿Guardar la semilla TOTP?"))) throw new Error("Cancelado");
    const seed = parseSeedInput(await askHidden(ui.prompt("Semilla base32 o URI otpauth://")));
    if (!saveTotpSeed(email, seed)) throw new Error("No hay almacén seguro disponible; no se guardó.");
    return console.log(ui.line("ok", `Semilla guardada. Código actual: ${totp(seed)} (válido ${secondsLeft()} s).`, process.stdout));
  }
  if (sub === "clear") {
    clearTotpSeed(email);
    return console.log(ui.line("ok", "Semilla borrada.", process.stdout));
  }
  if (sub === "code") {
    const seed = readTotpSeed(email);
    if (!seed) throw new Error("No hay semilla guardada (gavriel totp set).");
    const out = { code: totp(seed), secondsLeft: secondsLeft() };
    if (ctx.values.json) return console.log(ui.json(out));
    const live = process.stdout.isTTY ? process.stdout : process.stderr;
    if (!live.isTTY) return console.log(`${out.code}  (${out.secondsLeft} s)`); // pipes: solo el código, fácil de capturar
    const p = ui.painter(live);
    await ui.countdown((left, total) => `  ${p.paint("brand", out.code, { bold: true })}  ${ui.bar(left / total, 24, live, left <= 5 ? "warn" : "brand")}  ${p.paint(left <= 5 ? "warn" : "muted", `${left}s`)}`, out.secondsLeft, live);
    return;
  }
  throw new Error("Uso: gavriel totp set|clear|code");
}

// ── whoami / doctor ───────────────────────────────────────────────────────
export async function whoami(ctx: Ctx): Promise<void> {
  const name = profileName(ctx);
  const res = await makeClient(ctx, name).get("/auth/profile");
  const d = (res.data ?? {}) as Record<string, unknown>;
  const out = Object.fromEntries(Object.entries(d).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)));
  if (ctx.values.json) return console.log(ui.json({ perfil: name, ...out }));
  console.log(ui.line("ok", "Sesión activa", process.stdout));
  console.log(ui.kv([["perfil", name, "brand"], ...Object.entries(out).map(([k, v]) => [k, v] as [string, unknown])]));
}

export async function doctor(ctx: Ctx): Promise<void> {
  let failed = false;
  let checks = 0;
  const p = ui.painter(process.stdout);
  await showBanner(ctx);
  const check = (ok: boolean, label: string, detail = ""): void => {
    if (!ok) failed = true;
    checks++;
    console.log(`  ${ui.line(ok ? "ok" : "fail", `${ok ? "" : "FALLA "}${label}${detail ? ` ${p.paint("muted", detail)}` : ""}`, process.stdout)}`);
  };
  const note = (text: string): void => console.log(`    ${p.paint("muted", text)}`);
  try {
    const backend = secretBackend();
    check(backend !== "none", "Almacén seguro", backend);
    note(`config: ${configDir()}`);
    const name = profileName(ctx);
    const prof = profileOf(name);
    const config = loadConfigSafe(name);
    const base = config?.GAVRIEL_API_BASE ?? prof.apiBase ?? DEFAULT_API;
    check(true, "Perfil", `${name} <${prof.email}>`);
    check(/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(base), "API base con https", base);
    check(Boolean(keyringLookup(passwordAccount(prof.email))), "Password guardado");
    check(Boolean(readTrustedToken(prof.email, true)), "Dispositivo confiable", "se renueva con `gavriel renew`");
    note(`semilla TOTP: ${readTotpSeed(prof.email) ? "guardada" : "no guardada"}`);
    const ping = ui.spinner("Probando conectividad con la API");
    try {
      await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      ping.stop();
      check(true, "API alcanzable");
    } catch (e) {
      ping.stop();
      check(false, "API alcanzable", (e as Error).message);
    }
    if (!config) note("Sesión: omitida (sin password)");
    else if (!ctx.values.online) note("Sesión: omitida (use --online)");
    else {
      const sp = ui.spinner("Iniciando sesión de prueba");
      activeSpin = sp;
      try {
        const client = makeClient(ctx, name);
        await client.login();
        sp.stop();
        check(true, "Sesión", `JWT vence ${fmtExp(client.tokenExpiresAt)}`);
      } catch (e) {
        sp.stop();
        check(false, "Sesión", (e as Error).message);
      } finally {
        activeSpin = undefined;
      }
    }
  } catch (e) {
    check(false, "Diagnóstico", (e as Error).message);
  }
  console.log(failed
    ? `\n${ui.line("fail", `Hay problemas (${checks} chequeos). Revisá los puntos marcados.`, process.stdout)}`
    : `\n${ui.line("ok", `Todo en orden (${checks} chequeos).`, process.stdout)}`);
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
// ── install / uninstall (desde el binario) ──────────────────────────────────
export async function installCmd(ctx: Ctx): Promise<void> {
  const reg = str(ctx.values.register);
  const register = reg === undefined || reg === "none" ? [] : parseClients(reg);
  await showBanner(ctx);
  await install({
    dir: str(ctx.values.dir), path: !ctx.values["no-path"], register,
    profile: str(ctx.values.profile), role: optRole(ctx), toolsets: optToolsets(ctx),
    dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes), force: Boolean(ctx.values.force),
  });
}

export async function uninstallCmd(ctx: Ctx): Promise<void> {
  await uninstall({
    dir: str(ctx.values.dir), unregister: !ctx.values["keep-claude"], purge: Boolean(ctx.values.purge),
    dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes),
  });
}

export async function mcp(ctx: Ctx): Promise<void> {
  const sub = ctx.args[0];
  if (sub === "serve") { // servidor MCP por stdio: nada de banners ni texto en stdout
    const p = str(ctx.values.profile);
    if (p) process.env.GAVRIEL_PROFILE = p;
    const { serve } = await import("../serve.js");
    return serve();
  }
  if (sub === "uninstall") {
    const entryName = str(ctx.values.name) ?? "gavriel";
    checkName(entryName);
    const only = str(ctx.values.client) ? parseClients(str(ctx.values.client)) : undefined;
    await mcpUninstall({ name: entryName, dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes), clients: only });
    return;
  }
  if (sub !== "install") {
    throw new Error("Uso: gavriel mcp install|uninstall|serve [--client desktop|code|codex|opencode|all] [--role r] [--toolsets t] [--force] [--server-path ruta] [--dry-run] [-y]");
  }
  const clients = parseClients(str(ctx.values.client));
  const entryName = str(ctx.values.name) ?? "gavriel";
  checkName(entryName);
  const role = optRole(ctx);
  const toolsets = optToolsets(ctx);
  const name = profileName(ctx);
  const p = profileOf(name);
  for (const client of clients) {
    await mcpInstall({
      client, name: entryName, profile: name, role: role ?? p.role, toolsets: toolsets ?? p.toolsets,
      dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes), force: Boolean(ctx.values.force),
      serverPath: str(ctx.values["server-path"]),
    });
  }
}

// ── consultas ─────────────────────────────────────────────────────────────
// Columnas preferidas por nombre (las que existan en los datos); si no hay, las primeras escalares.
const PREFERRED = ["id", "number", "code", "title", "name", "accountName", "status", "priority", "type", "createdAt", "pendingEvents"];

function show(ctx: Ctx, data: unknown): void {
  if (ctx.values.json) return console.log(ui.json(data));
  const rows = rowsOf(data);
  if (rows.length === 0) return console.log(ui.json(data));
  const scalar = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);
  const keys = Object.keys(rows[0]).filter((k) => scalar(rows[0][k]));
  const picked = [...PREFERRED.filter((k) => keys.includes(k)), ...keys.filter((k) => !PREFERRED.includes(k))].slice(0, 6);
  const cols = picked.map((k) => ({
    title: k,
    value: (r: Record<string, unknown>) => (/At$|Date$/.test(k) ? ui.shortDate(r[k]) : r[k]),
    slot: (r: Record<string, unknown>) => (k === "status" ? ui.statusSlot(r[k]) : k === "priority" ? ui.prioritySlot(r[k]) : undefined),
    align: typeof rows[0][k] === "number" ? ("right" as const) : undefined,
  }));
  console.log(ui.table(rows, cols));
  console.log(ui.kv([["filas", rows.length, "muted"]]));
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
    return console.log(ui.json((await client.get(`/accounts/${encodeURIComponent(q)}`)).data));
  }
  throw new Error("Uso: gavriel accounts search <texto> | gavriel accounts get <id>");
}
