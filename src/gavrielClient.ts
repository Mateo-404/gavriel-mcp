import type { Config } from "./config.js";
import { readTrustedToken, saveTrustedToken, clearTrustedToken } from "./secrets.js";
import { logPerf } from "./auditLog.js";

// ponytail: el backend de Gavriel es lento en consultas sin filtrar (events llegó
// a 60s+). Timeout global 90s; si una tool puntual necesita más, se filtra mejor
// en el query en vez de subir esto.
const REQUEST_TIMEOUT_MS = 90_000;
const REFRESH_MARGIN_SECONDS = 5 * 60;
const MAX_BACKOFF_MS = 8_000;
// Si un login recién hecho vuelve a dar 401, no insistir: re-loginear en loop
// puede bloquear la cuenta. 15s cubre respuestas en vuelo del refresh.
const LOGIN_RETRY_GUARD_MS = 15_000;
// Recursos donde el backend tiene unique constraints que rompen con escrituras
// concurrentes sobre hermanos (p.ej. `order` de account-contacts): sus escrituras
// se serializan entre sí. El resto solo pasa por el semáforo global.
const WRITE_SERIAL_PREFIXES = ["/account-contacts"];
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 30_000;
const NET_RETRY_CODES = /^(ECONNRESET|EPIPE|ETIMEDOUT|UND_ERR_)/;

export interface GetOptions {
  /** Cachea la respuesta 200 durante `ttl` ms (opt-in). */
  ttl?: number;
  signal?: AbortSignal;
}

// Retry-After en segundos o fecha HTTP -> ms (null si no viene o es inválido).
export function parseRetryAfter(h: string | null, now = Date.now()): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

// Backoff exponencial con jitter (0.5x..1.5x); un Retry-After del server manda tal cual.
export function retryDelayMs(attempt: number, retryAfter: string | null, rand = Math.random(), now = Date.now()): number {
  const ra = parseRetryAfter(retryAfter, now);
  return Math.min(ra ?? 500 * 2 ** attempt * (0.5 + rand), MAX_BACKOFF_MS);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableNetError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError") return true;
  return NET_RETRY_CODES.test(e?.code ?? e?.cause?.code ?? "");
}

interface JwtState {
  token: string | null;
  expiresAt: number | null;
}

// trusted_device_token persistido igual que el frontend (localStorage) para
// saltear el 2FA en logins posteriores. No es el JWT (el JWT nunca va a disco).
// Ahora vive en el keyring del sistema (secrets.ts); el archivo legacy es solo
// fallback de último recurso con warning.
function decodeExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class GavrielClient {
  private jwt: JwtState = { token: null, expiresAt: null };
  private userEmail: string | null = null;
  private config: Config;
  private loginInFlight: Promise<string> | null = null;
  private lastLoginAt = 0;
  private readonly writeConcurrency: number;
  private writeInFlight = 0;
  private writeWaiters: Array<() => void> = [];
  private serialQueues = new Map<string, Promise<void>>();
  private cache = new Map<string, { exp: number; status: number; data: unknown }>();
  private getInFlight = new Map<string, Promise<{ status: number; data: unknown }>>();
  private loginShared: Promise<void> | null = null;
  private getFailures = 0;
  private breakerOpenUntil = 0;

  constructor(config: Config) {
    this.config = config;
    this.writeConcurrency = config.GAVRIEL_MCP_WRITE_CONCURRENCY ?? 5;
  }

  private get baseUrl(): string {
    return this.config.GAVRIEL_API_BASE.replace(/\/+$/, "");
  }

  get email(): string | null {
    return this.userEmail;
  }

  // Logins concurrentes (p.ej. varios 401 a la vez) comparten uno solo.
  login(): Promise<void> {
    this.loginShared ??= this.loginOnce().finally(() => {
      this.loginShared = null;
    });
    return this.loginShared;
  }

  private async loginOnce(): Promise<void> {
    // Resetea la expiración previa: el header x-token-expires-at que doLogin
    // pueda traer es la fuente más precisa; decodeExp del JWT es fallback.
    this.jwt.expiresAt = null;
    const token = await this.doLogin();
    this.jwt.token = token;
    this.jwt.expiresAt ??= decodeExp(token);
    this.userEmail = this.config.GAVRIEL_EMAIL;
    this.lastLoginAt = Date.now();
    console.error(
      `[gavrielClient] login ok (exp ${this.jwt.expiresAt ? new Date(this.jwt.expiresAt).toISOString() : "desconocida"})`,
    );
  }

  private async doLogin(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      const email = this.config.GAVRIEL_EMAIL;
      const base: Record<string, string> = { email, password: this.config.GAVRIEL_PASSWORD };

      const trusted = readTrustedToken(email);
      if (trusted) base.trustedDeviceToken = trusted;

      let res = await this.postLogin(base);
      if (!res.ok) {
        const msg = res.message;
        // El trusted token expiró: limpiarlo y exigir el código 2FA de nuevo.
        if (msg.includes("token de dispositivo expiró")) {
          clearTrustedToken(email);
        }
        const needs2fa =
          msg.includes("dos factores") ||
          msg.includes("código de autenticación de dos factores");
        if (needs2fa) {
          const code = process.env.GAVRIEL_2FA_CODE;
          if (!code) {
            throw new Error(
              "El usuario tiene 2FA activo y este dispositivo no está confiado. " +
                "Ejecutá el login con la variable GAVRIEL_2FA_CODE=<código de 6 dígitos> " +
                "para confiar el dispositivo (el trusted_device_token queda guardado y los " +
                "próximos logins no pedirán el código).",
            );
          }
          console.error("[gavrielClient] 2FA requerido, reintento con código");
          res = await this.postLogin({ ...base, twoFactorCode: code, trustedDeviceToken: undefined });
          if (!res.ok) {
            if (res.message.includes("dos factores") || res.message.includes("código")) {
              throw new Error(`Código 2FA rechazado: ${res.message}`);
            }
            throw new Error(`Login con 2FA falló (${res.status}): ${res.message}`);
          }
        } else {
          throw new Error(`Login falló (${res.status}): ${res.message}`);
        }
      }

      const data = res.data as { access_token?: string; trusted_device_token?: string; user?: { email?: string } };
      if (!data.access_token) {
        throw new Error("Login falló: la respuesta no trajo access_token");
      }
      if (data.trusted_device_token) saveTrustedToken(email, data.trusted_device_token);
      this.userEmail = data.user?.email ?? email;
      const xExpires = res.headers.get("x-token-expires-at");
      if (xExpires) {
        const t = Date.parse(xExpires);
        if (!Number.isNaN(t)) this.jwt.expiresAt = t;
      }
      return data.access_token;
    })().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async postLogin(
    body: Record<string, string | undefined>,
  ): Promise<{ ok: boolean; status: number; message: string; data: unknown; headers: Headers }> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) clean[k] = v;
    }
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(clean),
    });
    const text = await res.text().catch(() => "");
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    const message =
      (data as { message?: unknown })?.message ??
      (data as { error?: unknown })?.error ??
      (typeof data === "string" ? data : "");
    const msg = Array.isArray(message) ? message.join(", ") : String(message ?? "");
    return { ok: res.ok, status: res.status, message: msg, data, headers: res.headers };
  }

  private async ensureToken(): Promise<string> {
    if (this.jwt.token) {
      if (
        this.jwt.expiresAt &&
        this.jwt.expiresAt - Date.now() < REFRESH_MARGIN_SECONDS * 1000
      ) {
        console.error("[gavrielClient] JWT próximo a expirar, re-login");
        await this.login();
      }
      return this.jwt.token;
    }
    await this.login();
    return this.jwt.token as string;
  }

  private handleNewToken(res: Response): void {
    const xNewToken = res.headers.get("x-new-token");
    if (xNewToken) {
      this.jwt.token = xNewToken;
      this.jwt.expiresAt = decodeExp(xNewToken);
      console.error("[gavrielClient] JWT renovado vía x-new-token");
    }
    const xExpires = res.headers.get("x-token-expires-at");
    if (xExpires) {
      const t = Date.parse(xExpires);
      if (!Number.isNaN(t)) this.jwt.expiresAt = t;
    }
  }

  private async requestInner(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    _attempt = 0,
    signal?: AbortSignal,
    _authRetried = false,
    _netRetried = false,
  ): Promise<{ status: number; data: unknown; headers: Headers }> {
    const token = await this.ensureToken();
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const sig = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const again = (att: number, auth: boolean, net: boolean) =>
      this.requestInner(method, path, body, att, signal, auth, net);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: sig,
      });
    } catch (err) {
      // Un reintento para GET ante errores de red transitorios (no si abortó el caller).
      if (method === "GET" && !_netRetried && !signal?.aborted && isRetryableNetError(err)) {
        console.error(`[gavrielClient] error de red transitorio en GET ${path}, reintento`);
        await sleep(retryDelayMs(0, null), signal);
        return again(_attempt, _authRetried, true);
      }
      throw new Error(`Error de red hacia ${method} ${path}: ${(err as Error).message}`);
    }

    if (res.status === 401 && !_authRetried) {
      // Otro request ya renovó el token mientras este volaba: reintentar con el nuevo.
      if (this.jwt.token && this.jwt.token !== token) return again(_attempt, true, _netRetried);
      const sinceLogin = Date.now() - this.lastLoginAt;
      if (sinceLogin < LOGIN_RETRY_GUARD_MS) {
        if (this.jwt.token === token) this.jwt.token = null;
        throw new Error(
          `401 en ${method} ${path}: el JWT se renovó hace ${Math.round(sinceLogin / 1000)}s y fue rechazado igual. No reintento el login para no bloquear la cuenta; revisá credenciales/permisos.`,
        );
      }
      console.error("[gavrielClient] 401, reintento con re-login");
      if (this.jwt.token === token) this.jwt.token = null;
      await this.login(); // compartido entre 401 concurrentes
      return again(_attempt, true, _netRetried);
    }

    // Retry automático solo para GET: repetir un POST/PATCH tras un 5xx puede
    // duplicar la operación si el backend la aplicó antes de fallar la respuesta.
    if (method === "GET" && (res.status === 429 || res.status >= 500) && _attempt < 2) {
      const delay = retryDelayMs(_attempt, res.headers.get("retry-after"));
      console.error(`[gavrielClient] ${res.status}, backoff ${Math.round(delay)}ms`);
      await sleep(delay, signal);
      return again(_attempt + 1, _authRetried, _netRetried);
    }

    this.handleNewToken(res);

    // El abort (REQUEST_TIMEOUT_MS) cubre también la lectura del body:
    // si el stream se estanca, sin esto el request colgaba para siempre.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new Error(`Error de red leyendo el body de ${method} ${path}: ${(err as Error).message}`);
    }
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }

  // Envuelve requestInner con medición de latencia (perf.log): separa la
  // señal de cuánto tarda el backend del "sentimiento" del agente.
  private async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: unknown; headers: Headers }> {
    const start = Date.now();
    try {
      const res = await this.requestInner(method, path, body, 0, signal);
      logPerf({ method, path: path.split("?")[0], status: res.status, ms: Date.now() - start });
      return res;
    } catch (e) {
      logPerf({ method, path: path.split("?")[0], ms: Date.now() - start });
      throw e;
    }
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
    opts: GetOptions = {},
  ): Promise<{ status: number; data: T }> {
    // Claves ordenadas: mismos params en distinto orden comparten cache/dedupe.
    const sorted = params ? Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) : undefined;
    const full = `${path}${sorted ? buildQueryString(sorted) : ""}`;

    if (opts.ttl) {
      const hit = this.cache.get(full);
      if (hit && hit.exp > Date.now()) return { status: hit.status, data: hit.data as T };
    }
    if (Date.now() < this.breakerOpenUntil) {
      throw new Error(`Circuit breaker abierto: el backend falló ${BREAKER_THRESHOLD} veces seguidas; reintentar en unos segundos.`);
    }

    // Dedupe: GETs idénticos concurrentes comparten un solo request (salvo con signal propio).
    const shared = opts.signal ? undefined : this.getInFlight.get(full);
    if (shared) return (await shared) as { status: number; data: T };

    const p = (async () => {
      let res: { status: number; data: unknown };
      try {
        res = await this.request("GET", full, undefined, opts.signal);
      } catch (e) {
        if (!opts.signal?.aborted) this.noteGetFailure();
        throw e;
      }
      if (res.status >= 500) this.noteGetFailure();
      else this.getFailures = 0;
      if (opts.ttl && res.status === 200) {
        this.cache.set(full, { exp: Date.now() + opts.ttl, status: res.status, data: res.data });
      }
      return res;
    })();
    if (opts.signal) return (await p) as { status: number; data: T };
    this.getInFlight.set(full, p);
    try {
      return (await p) as { status: number; data: T };
    } finally {
      this.getInFlight.delete(full);
    }
  }

  private noteGetFailure(): void {
    if (++this.getFailures >= BREAKER_THRESHOLD) {
      this.breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
      this.getFailures = 0;
    }
  }

  // Una escritura exitosa invalida las entradas cuyo path comparte prefijo (en cualquier sentido).
  private invalidate(path: string): void {
    const w = path.split("?")[0];
    for (const k of this.cache.keys()) {
      const kp = k.split("?")[0];
      if (kp.startsWith(w) || w.startsWith(kp)) this.cache.delete(k);
    }
  }

  // Escrituras: semáforo global (GAVRIEL_MCP_WRITE_CONCURRENCY, default 5) +
  // cola FIFO por recurso para los prefijos con unique constraints del backend
  // (WRITE_SERIAL_PREFIXES), donde escrituras hermanas paralelas rompen o
  // contestan JSON corrupto. Las lecturas siguen concurrentes sin límite.
  private async acquireWriteSlot(): Promise<void> {
    if (this.writeInFlight < this.writeConcurrency) {
      this.writeInFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
    this.writeInFlight++;
  }

  private releaseWriteSlot(): void {
    this.writeInFlight--;
    this.writeWaiters.shift()?.();
  }

  private serialKeyFor(path: string): string | null {
    const clean = path.split("?")[0];
    for (const prefix of WRITE_SERIAL_PREFIXES) {
      if (clean === prefix || clean.startsWith(`${prefix}/`)) return prefix;
    }
    return null;
  }

  private runWrite<T>(path: string, op: () => Promise<T>): Promise<T> {
    const key = this.serialKeyFor(path);
    if (!key) return this.withSlot(op);
    const chained = (this.serialQueues.get(key) ?? Promise.resolve()).then(() => this.withSlot(op));
    this.serialQueues.set(
      key,
      chained.then(
        () => undefined,
        () => undefined,
      ),
    );
    return chained;
  }

  private async withSlot<T>(op: () => Promise<T>): Promise<T> {
    await this.acquireWriteSlot();
    try {
      return await op();
    } finally {
      this.releaseWriteSlot();
    }
  }

  async post<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.runWrite(path, async () => {
      const res = await this.request("POST", path, body, signal);
      if (res.status < 400) this.invalidate(path);
      return { status: res.status, data: res.data as T };
    });
  }

  async patch<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.runWrite(path, async () => {
      const res = await this.request("PATCH", path, body, signal);
      if (res.status < 400) this.invalidate(path);
      return { status: res.status, data: res.data as T };
    });
  }

  async put<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.runWrite(path, async () => {
      const res = await this.request("PUT", path, body, signal);
      if (res.status < 400) this.invalidate(path);
      return { status: res.status, data: res.data as T };
    });
  }

  async delete<T = unknown>(path: string, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.runWrite(path, async () => {
      const res = await this.request("DELETE", path, undefined, signal);
      if (res.status < 400) this.invalidate(path);
      return { status: res.status, data: res.data as T };
    });
  }
}

export function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null && v !== "") search.append(key, String(v));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}
