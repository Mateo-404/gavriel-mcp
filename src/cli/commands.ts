import { loadConfig } from "../config.js";
import { GavrielClient } from "../gavrielClient.js";
import { configDir, loadStore, saveStore, validateProfileName, type Profile } from "../profiles.js";
import {
  clearPassword, clearTotpSeed, clearTrustedToken, keyringLookup, passwordAccount, readTotpSeed, readTrustedToken,
  saveTotpSeed, secretBackend, storePassword,
} from "../secrets.js";
import { parseSeedInput, secondsLeft, totp } from "../totp.js";
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
  json: { type: "boolean" },
  all: { type: "boolean" },
  purge: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

export interface Ctx {
  values: Record<string, string | boolean | undefined>;
  args: string[]; // posicionales tras el subcomando
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function profileName(ctx: Ctx): string {
  const name = str(ctx.values.profile) ?? process.env.GAVRIEL_PROFILE ?? loadStore().active ?? undefined;
  if (!name) throw new Error("No hay perfil activo. Ejecutá `gavriel login` o usá --profile.");
  return name;
}

function profileOf(name: string): Profile {
  const p = loadStore().profiles[name];
  if (!p) throw new Error(`El perfil "${name}" no existe (gavriel profile list).`);
  return p;
}

// Código 2FA: --code, semilla TOTP guardada, o prompt si hay terminal.
function makeClient(ctx: Ctx, name: string): GavrielClient {
  const config = loadConfig({ profile: name });
  return new GavrielClient(config, {
    getTwoFactorCode: async () => {
      const given = str(ctx.values.code);
      if (given) return given;
      const seed = readTotpSeed(config.GAVRIEL_EMAIL);
      if (seed) return totp(seed);
      return process.stdin.isTTY ? await ask("Código 2FA de 6 dígitos: ") : undefined;
    },
  });
}

const fmtExp = (ms: number | null): string => (ms ? new Date(ms).toISOString() : "desconocido");

// ── login / renew / logout ────────────────────────────────────────────────
export async function login(ctx: Ctx): Promise<void> {
  const email = str(ctx.values.email) ?? (await ask("Email: "));
  if (!email) throw new Error("Email requerido");
  const name = str(ctx.values.profile) ?? email.split("@")[0].replace(/[^\w.-]/g, "_").slice(0, 40);
  validateProfileName(name);
  const store = loadStore();
  const isNew = !store.profiles[name];
  const password = await askHidden("Password: ");
  if (!password) throw new Error("Password requerido");
  if (!storePassword(email, password)) {
    throw new Error("No hay almacén seguro disponible (Windows: DPAPI; Linux: libsecret-tools). No se guardó nada.");
  }
  const prev = store.profiles[name];
  store.profiles[name] = {
    ...prev, email, ...(str(ctx.values["api-base"]) && { apiBase: str(ctx.values["api-base"]) }),
    ...(str(ctx.values.role) && { role: str(ctx.values.role) as Profile["role"] }),
    ...(str(ctx.values.toolsets) && { toolsets: str(ctx.values.toolsets) }),
  };
  store.active = name;
  saveStore(store);
  const client = makeClient(ctx, name);
  try {
    await client.login();
  } catch (err) {
    // Credenciales malas en un perfil nuevo: no dejar basura. Un 2FA fallido sí conserva todo para reintentar.
    if (isNew && String((err as Error).message).startsWith("Login falló")) {
      clearPassword(email);
      delete store.profiles[name];
      store.active = Object.keys(store.profiles)[0] ?? null;
      saveStore(store);
    }
    throw err;
  }
  console.log(`Sesión iniciada como ${email} (perfil "${name}", vence ${fmtExp(client.tokenExpiresAt)}).`);
}

export async function renew(ctx: Ctx): Promise<void> {
  const names = ctx.values.all ? Object.keys(loadStore().profiles) : [profileName(ctx)];
  if (names.length === 0) throw new Error("No hay perfiles.");
  for (const name of names) {
    const { email } = profileOf(name);
    clearTrustedToken(email);
    await makeClient(ctx, name).login();
    console.log(`[${name}] dispositivo confiable renovado.`);
  }
}

export async function logout(ctx: Ctx): Promise<void> {
  const store = loadStore();
  const names = ctx.values.all ? Object.keys(store.profiles) : [profileName(ctx)];
  for (const name of names) {
    const { email } = profileOf(name);
    clearTrustedToken(email);
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
      validateProfileName(a);
      const email = str(ctx.values.email);
      if (!email) throw new Error("Falta --email");
      store.profiles[a] = {
        email, ...(str(ctx.values["api-base"]) && { apiBase: str(ctx.values["api-base"]) }),
        ...(str(ctx.values.role) && { role: str(ctx.values.role) as Profile["role"] }),
        ...(str(ctx.values.toolsets) && { toolsets: str(ctx.values.toolsets) }),
      };
      store.active ??= a;
      saveStore(store);
      return console.log(`Perfil "${a}" creado. Ejecutá: gavriel login --profile ${a} --email ${email}`);
    }
    case "use":
      if (!a || !store.profiles[a]) throw new Error(`El perfil "${a ?? ""}" no existe.`);
      store.active = a;
      saveStore(store);
      return console.log(`Perfil activo: ${a}`);
    case "remove": {
      if (!a || !store.profiles[a]) throw new Error(`El perfil "${a ?? ""}" no existe.`);
      if (ctx.values.purge) {
        const { email } = store.profiles[a];
        clearTrustedToken(email);
        clearPassword(email);
        clearTotpSeed(email);
      }
      delete store.profiles[a];
      if (store.active === a) store.active = Object.keys(store.profiles)[0] ?? null;
      saveStore(store);
      return console.log(`Perfil "${a}" eliminado${ctx.values.purge ? " junto con sus secretos" : ""}.`);
    }
    case "rename": {
      if (!a || !b || !store.profiles[a]) throw new Error("Uso: gavriel profile rename <viejo> <nuevo>");
      validateProfileName(b);
      if (store.profiles[b]) throw new Error(`Ya existe "${b}".`);
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
  const backend = secretBackend();
  check(backend !== "none", "Almacén seguro", backend);
  console.log(`     config: ${configDir()}`);
  let name: string;
  try {
    name = profileName(ctx);
  } catch (e) {
    check(false, "Perfil", (e as Error).message);
    process.exitCode = 1;
    return;
  }
  const p = profileOf(name);
  const config = loadConfigSafe(name);
  const base = config?.GAVRIEL_API_BASE ?? p.apiBase ?? "https://app.gavriel.com.ar/api";
  check(true, "Perfil", `${name} <${p.email}>`);
  check(base.startsWith("https://"), "API base con https", base);
  check(Boolean(keyringLookup(passwordAccount(p.email))), "Password guardado");
  check(Boolean(readTrustedToken(p.email)), "Dispositivo confiable", "se renueva con `gavriel renew`");
  console.log(`     semilla TOTP: ${readTotpSeed(p.email) ? "guardada" : "no guardada"}`);
  try {
    await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    check(true, "API alcanzable");
  } catch (e) {
    check(false, "API alcanzable", (e as Error).message);
  }
  if (config) {
    try {
      const client = makeClient(ctx, name);
      await client.login();
      check(true, "Sesión", `JWT vence ${fmtExp(client.tokenExpiresAt)}`);
    } catch (e) {
      check(false, "Sesión", (e as Error).message);
    }
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
  if (ctx.args[0] !== "install") throw new Error("Uso: gavriel mcp install [--client desktop|code] [--profile] [--role] [--toolsets] [--dry-run]");
  const client = str(ctx.values.client) ?? "desktop";
  if (client !== "desktop" && client !== "code") throw new Error("--client debe ser desktop o code");
  const name = profileName(ctx);
  const p = profileOf(name);
  await mcpInstall({
    client, name: str(ctx.values.name) ?? "gavriel", profile: name, role: str(ctx.values.role) ?? p.role,
    toolsets: str(ctx.values.toolsets) ?? p.toolsets, dryRun: Boolean(ctx.values["dry-run"]), yes: Boolean(ctx.values.yes),
  });
}

// ── consultas ─────────────────────────────────────────────────────────────
function show(ctx: Ctx, data: unknown): void {
  if (ctx.values.json) return printJson(data);
  const rows = rowsOf(data);
  rows.length ? printTable(rows) : printJson(data);
}

export async function tickets(ctx: Ctx): Promise<void> {
  const params: Record<string, unknown> = { limit: Number(str(ctx.values.limit) ?? 20) };
  if (str(ctx.values.status)) params.status = str(ctx.values.status);
  show(ctx, (await makeClient(ctx, profileName(ctx)).get("/tickets", params)).data);
}

export async function events(ctx: Ctx): Promise<void> {
  if (ctx.args[0] !== "pending") throw new Error("Uso: gavriel events pending");
  show(ctx, (await makeClient(ctx, profileName(ctx)).get("/events/accounts-with-pending-events")).data);
}

export async function accounts(ctx: Ctx): Promise<void> {
  const [sub, q] = ctx.args;
  const client = makeClient(ctx, profileName(ctx));
  if (sub === "search" && q) return show(ctx, (await client.get("/accounts", { search: q, limit: Number(str(ctx.values.limit) ?? 20) })).data);
  if (sub === "get" && q) {
    if (!/^[\w-]+$/.test(q)) throw new Error("Identificador inválido");
    return printJson((await client.get(`/accounts/${encodeURIComponent(q)}`)).data);
  }
  throw new Error("Uso: gavriel accounts search <texto> | gavriel accounts get <id>");
}
