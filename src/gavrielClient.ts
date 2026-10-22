import type { Config } from "./config.js";
import { readTrustedToken, saveTrustedToken, clearTrustedToken } from "./secrets.js";
import { logPerf } from "./auditLog.js";
import { secondsLeft } from "./totp.js";

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
// Login colgado: sin timeout, loginShared quedaba pendiente para siempre.
const LOGIN_TIMEOUT_MS = 30_000;
// Tras un login fallido se re-lanza el mismo error en vez de re-postear (evita bloqueo de cuenta).
const LOGIN_FAIL_MEMORY_MS = 30_000;
const CACHE_MAX = 500;
// Re-lecturas de verificación post-escritura no se frenan por el breaker durante este lapso.
const WRITE_GRACE_MS = 15_000;

export interface GetOptions {
  /** Cachea la respuesta 200 durante `ttl` ms (opt-in). */
  ttl?: number;
  signal?: AbortSignal;
  /** Re-lecturas de verificación post-escritura: ignoran el circuit breaker. */
  bypassBreaker?: boolean;
}

// Libera el body de una respuesta que se descarta (reintentos) para no retener sockets.
function drain(res: Response): void {
  res.body?.cancel().catch(() => {});
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
  private loginInFlight: Promise<{ token: string; expiresAt: number | null }> | null = null;
  private loginFailure: { at: number; err: unknown } | null = null;
  private invalidGen = 0;
  private lastWriteDoneAt = 0;
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

  private getTwoFactorCode?: () => string | undefined | Promise<string | undefined>;

  // getTwoFactorCode: fuente del código 2FA (CLI: prompt o semilla TOTP); sin ella se usa GAVRIEL_2FA_CODE.
  constructor(config: Config, opts?: { getTwoFactorCode?: () => string | undefined | Promise<string | undefined> }) {
    this.config = config;
    this.getTwoFactorCode = opts?.getTwoFactorCode;
    this.writeConcurrency = config.GAVRIEL_MCP_WRITE_CONCURRENCY ?? 5;
  }

  private get baseUrl(): string {
    return this.config.GAVRIEL_API_BASE.replace(/\/+$/, "");
  }

  get email(): string | null {
    return this.userEmail;
  }

  get tokenExpiresAt(): number | null {
    return this.jwt.expiresAt;
  }

  // Logins concurrentes (p.ej. varios 401 a la vez) comparten uno solo.
  login(): Promise<void> {
    const f = this.loginFailure;
    if (f && Date.now() - f.at < LOGIN_FAIL_MEMORY_MS) return Promise.reject(f.err);
    this.loginShared ??= this.loginOnce()
      .then(
        () => {
          this.loginFailure = null;
        },
        (err) => {
          this.loginFailure = { at: Date.now(), err };
          throw err;
        },
      )
      .finally(() => {
        this.loginShared = null;
      });
    return this.loginShared;
  }

  private async loginOnce(): Promise<void> {
    // El header x-token-expires-at que trae doLogin es la fuente más precisa;
    // decodeExp del JWT es fallback. El estado solo se pisa tras un login exitoso.
    const { token, expiresAt } = await this.doLogin();
    this.jwt.token = token;
    this.jwt.expiresAt = expiresAt ?? decodeExp(token);
    this.userEmail = this.config.GAVRIEL_EMAIL;
    this.lastLoginAt = Date.now();
    console.error(
      `[gavrielClient] login ok (exp ${this.jwt.expiresAt ? new Date(this.jwt.expiresAt).toISOString() : "desconocida"})`,
    );
  }

  private async doLogin(): Promise<{ token: string; expiresAt: number | null }> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      const email = this.config.GAVRIEL_EMAIL;
      const base: Record<string, string> = { email, password: this.config.GAVRIEL_PASSWORD };

      const strict = Boolean(this.config.strictProfile);
      const trusted = readTrustedToken(email, strict);
      if (trusted) base.trustedDeviceToken = trusted;

      let res = await this.postLogin(base);
      if (!res.ok) {
        const msg = res.message;
        // El trusted token expiró: limpiarlo y exigir el código 2FA de nuevo.
        const trustedExpired = msg.includes("token de dispositivo expiró");
        if (trustedExpired) {
          clearTrustedToken(email, strict);
        }
        const needs2fa =
          trustedExpired ||
          msg.includes("dos factores") ||
          msg.includes("código de autenticación de dos factores");
        if (needs2fa) {
          const fromGetter = await this.getTwoFactorCode?.();
          const code = fromGetter || process.env.GAVRIEL_2FA_CODE;
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
          if (!res.ok && fromGetter && /dos factores|código/.test(res.message)) {
            // Código rechazado (p.ej. ventana TOTP vencida): esperar la próxima y reintentar una vez.
            await sleep(secondsLeft() * 1000 + 500);
            const next = await this.getTwoFactorCode?.();
            if (next && next !== code) {
              console.error("[gavrielClient] código 2FA rechazado, reintento con la ventana siguiente");
              res = await this.postLogin({ ...base, twoFactorCode: next, trustedDeviceToken: undefined });
            }
          }
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
      let expiresAt: number | null = null;
      const xExpires = res.headers.get("x-token-expires-at");
      if (xExpires) {
        const t = Date.parse(xExpires);
        if (!Number.isNaN(t)) expiresAt = t;
      }
      return { token: data.access_token, expiresAt };
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
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
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
        try {
          await this.login();
        } catch (err) {
          // Si el JWT actual sigue vigente, usarlo: el refresh es proactivo.
          if (this.jwt.expiresAt <= Date.now()) throw err;
          console.error(`[gavrielClient] re-login falló, sigo con el JWT vigente: ${(err as Error).message}`);
        }
      }
      return this.jwt.token as string;
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
    // Siempre base + path: nunca mandar el bearer a un host arbitrario.
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
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
      throw Object.assign(new Error(`Error de red hacia ${method} ${path}: ${(err as Error).message}`), {
        breaker: !signal?.aborted,
      });
    }

    if (res.status === 401 && !_authRetried) {
      // Otro request ya renovó el token mientras este volaba: reintentar con el nuevo.
      drain(res);
      if (this.jwt.token && this.jwt.token !== token) return again(_attempt, true, _netRetried);
      const sinceLogin = Date.now() - this.lastLoginAt;
      if (sinceLogin < LOGIN_RETRY_GUARD_MS) {
        // No se anula el token: si no, cada llamada siguiente reloguearía (una por tool call).
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
      drain(res);
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
      throw Object.assign(new Error(`Error de red leyendo el body de ${method} ${path}: ${(err as Error).message}`), {
        breaker: !signal?.aborted,
      });
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
      if (hit && hit.exp > Date.now()) return { status: hit.status, data: structuredClone(hit.data) as T };
    }
    const grace = opts.bypassBreaker || Date.now() - this.lastWriteDoneAt < WRITE_GRACE_MS;
    if (!grace && Date.now() < this.breakerOpenUntil) {
      throw new Error(`Circuit breaker abierto: el backend falló ${BREAKER_THRESHOLD} veces seguidas; reintentar en unos segundos.`);
    }

    // Dedupe: GETs idénticos concurrentes comparten un solo request (salvo con signal propio).
    // Todos reciben copias: el caller puede mutar el resultado sin contaminar a los demás ni al cache.
    const shared = opts.signal ? undefined : this.getInFlight.get(full);
    if (shared) {
      const r = await shared;
      return { status: r.status, data: structuredClone(r.data) as T };
    }

    const gen = this.invalidGen; // si una escritura invalida mientras vuela, no se cachea
    const p = (async () => {
      let res: { status: number; data: unknown };
      try {
        res = await this.request("GET", full, undefined, opts.signal);
      } catch (e) {
        if ((e as { breaker?: boolean }).breaker) this.noteGetFailure();
        throw e;
      }
      if (res.status >= 500) this.noteGetFailure();
      else this.getFailures = 0;
      // Nunca se cachean bodies no-JSON/truncados (string): serían basura servida hasta el ttl.
      if (opts.ttl && res.status === 200 && typeof res.data !== "string" && gen === this.invalidGen) {
        this.cacheSet(full, { exp: Date.now() + opts.ttl, status: res.status, data: structuredClone(res.data) });
      }
      return res;
    })();
    if (opts.signal) {
      const r = await p;
      return { status: r.status, data: r.data as T };
    }
    this.getInFlight.set(full, p);
    try {
      const r = await p;
      return { status: r.status, data: structuredClone(r.data) as T };
    } finally {
      if (this.getInFlight.get(full) === p) this.getInFlight.delete(full);
    }
  }

  // Cache acotado: barre vencidas en cada set y, si sigue lleno, descarta las más viejas.
  private cacheSet(k: string, v: { exp: number; status: number; data: unknown }): void {
    const now = Date.now();
    for (const [kk, vv] of this.cache) if (vv.exp <= now) this.cache.delete(kk);
    while (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(k, v);
  }

  private noteGetFailure(): void {
    if (++this.getFailures >= BREAKER_THRESHOLD) {
      this.breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
      this.getFailures = 0;
    }
  }

  // Una escritura (exitosa o que pudo aplicarse: 5xx/timeout) invalida cache y GETs en vuelo
  // cuyo path comparte prefijo (en cualquier sentido); invalidGen impide que un GET ya
  // iniciado repueble el cache con datos previos a la escritura.
  private invalidate(path: string): void {
    this.invalidGen++;
    const w = path.split("?")[0];
    const hit = (k: string) => {
      const kp = k.split("?")[0];
      return kp.startsWith(w) || w.startsWith(kp);
    };
    for (const k of [...this.cache.keys()]) if (hit(k)) this.cache.delete(k);
    for (const k of [...this.getInFlight.keys()]) if (hit(k)) this.getInFlight.delete(k);
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
    // El slot se transfiere directo desde releaseWriteSlot (writeInFlight no baja ni sube).
    await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
  }

  private releaseWriteSlot(): void {
    const next = this.writeWaiters.shift();
    if (next) next();
    else this.writeInFlight--;
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

  // Escritura con invalidación: también si pudo aplicarse (5xx / error o timeout), no en 4xx.
  private write<T>(
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: T }> {
    return this.runWrite(path, async () => {
      try {
        const res = await this.request(method, path, body, signal);
        if (res.status < 400 || res.status >= 500) this.invalidate(path);
        return { status: res.status, data: res.data as T };
      } catch (e) {
        this.invalidate(path);
        throw e;
      } finally {
        this.lastWriteDoneAt = Date.now();
      }
    });
  }

  post<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.write("POST", path, body, signal);
  }

  patch<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.write("PATCH", path, body, signal);
  }

  put<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.write("PUT", path, body, signal);
  }

  delete<T = unknown>(path: string, signal?: AbortSignal): Promise<{ status: number; data: T }> {
    return this.write("DELETE", path, undefined, signal);
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
