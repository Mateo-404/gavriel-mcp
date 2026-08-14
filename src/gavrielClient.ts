import type { Config } from "./config.js";
import { readTrustedToken, saveTrustedToken, clearTrustedToken } from "./secrets.js";
import { logPerf } from "./auditLog.js";

// ponytail: el backend de Gavriel es lento en consultas sin filtrar (events llegó
// a 60s+). Timeout global 90s; si una tool puntual necesita más, se filtra mejor
// en el query en vez de subir esto.
const REQUEST_TIMEOUT_MS = 90_000;
const REFRESH_MARGIN_SECONDS = 5 * 60;
const MAX_BACKOFF_MS = 8_000;

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

  constructor(config: Config) {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.GAVRIEL_API_BASE.replace(/\/+$/, "");
  }

  get email(): string | null {
    return this.userEmail;
  }

  async login(): Promise<void> {
    const token = await this.doLogin();
    this.jwt.token = token;
    this.jwt.expiresAt = decodeExp(token);
    this.userEmail = this.config.GAVRIEL_EMAIL;
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
  ): Promise<{ status: number; data: unknown; headers: Headers }> {
    const token = await this.ensureToken();
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`Error de red hacia ${method} ${path}: ${(err as Error).message}`);
    }

    if (res.status === 401 && _attempt < 1) {
      clearTimeout(timer);
      console.error("[gavrielClient] 401, reintento con re-login");
      this.jwt.token = null;
      await this.login();
      return this.requestInner(method, path, body, _attempt + 1);
    }

    if ((res.status === 429 || res.status >= 500) && _attempt < 2) {
      clearTimeout(timer);
      const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
      const delay = Math.min(retryAfter || 500 * 2 ** _attempt, MAX_BACKOFF_MS);
      console.error(`[gavrielClient] ${res.status}, backoff ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return this.requestInner(method, path, body, _attempt + 1);
    }

    this.handleNewToken(res);

    // El abort (REQUEST_TIMEOUT_MS) debe cubrir también la lectura del body:
    // si el stream se estanca (conexión keep-alive reusada que el server
    // dejó a medias), sin esto el request colgaba para siempre.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new Error(`Error de red leyendo el body de ${method} ${path}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
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
    _attempt = 0,
  ): Promise<{ status: number; data: unknown; headers: Headers }> {
    const start = Date.now();
    try {
      const res = await this.requestInner(method, path, body, _attempt);
      logPerf({ method, path: path.split("?")[0], status: res.status, ms: Date.now() - start });
      return res;
    } catch (e) {
      logPerf({ method, path: path.split("?")[0], ms: Date.now() - start });
      throw e;
    }
  }

  async get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<{ status: number; data: T }> {
    const qs = params ? buildQueryString(params) : "";
    const res = await this.request("GET", `${path}${qs}`);
    return { status: res.status, data: res.data as T };
  }

  // Cola de escrituras: máximo 1 POST/PATCH/DELETE en vuelo por vez.
  // El backend de Gavriel tiene un unique constraint en el campo `order` de
  // account-contacts y rompe (o contesta JSON corrupto) con escrituras
  // paralelas que tocan el mismo recurso. Las lecturas siguen concurrentes.
  // ponytail: cola global simple; si alguna vez el throughput de escrituras
  // importa, pasar a colas por recurso.
  private writeQueue: Promise<void> = Promise.resolve();
  private enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(op);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
    return this.enqueueWrite(async () => {
      const res = await this.request("POST", path, body);
      return { status: res.status, data: res.data as T };
    });
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
    return this.enqueueWrite(async () => {
      const res = await this.request("PATCH", path, body);
      return { status: res.status, data: res.data as T };
    });
  }

  async delete<T = unknown>(path: string): Promise<{ status: number; data: T }> {
    return this.enqueueWrite(async () => {
      const res = await this.request("DELETE", path);
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
