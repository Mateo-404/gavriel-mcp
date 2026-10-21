import type { McpServer } from "@modelcontextprotocol/server";
import type { GavrielClient } from "../gavrielClient.js";

export const PENDING_URI = "gavriel://events/pending";
const MIN_SEC = 30;
const MAX_BACKOFF_MS = 10 * 60_000;

export interface PendingEvent {
  id: string;
  accountId?: unknown;
  accountName?: unknown;
  port?: unknown;
  createdAt?: unknown;
}

/** Eventos cuyo id no estaba en `prevIds` (puro, sin I/O). */
export function diffNewEvents<T extends { id?: unknown }>(prevIds: ReadonlySet<string>, events: readonly T[]): T[] {
  return events.filter((e) => e && e.id != null && !prevIds.has(String(e.id)));
}

/** GAVRIEL_POLL_SEC -> segundos (min 30) o null si está apagado/ inválido. */
export function parsePollSec(raw: string | undefined): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.max(MIN_SEC, Math.floor(n)) : null;
}

async function fetchPending(client: GavrielClient): Promise<PendingEvent[]> {
  const res = await client.get("/events/accounts-with-pending-events");
  const accounts = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
  const out: PendingEvent[] = [];
  // shortcut: tope de 20 cuentas por ciclo, subir si hay más cuentas pendientes simultáneas.
  for (const a of accounts.slice(0, 20)) {
    const r = await client.get("/events", { accountId: a.id, pending: true, limit: 10 });
    const d = r.data as unknown;
    const list = (Array.isArray(d) ? d : (d as { data?: unknown[] } | null)?.data ?? []) as Record<string, unknown>[];
    for (const e of list) out.push({ id: String(e.id), accountId: a.id, accountName: a.name, port: e.port, createdAt: e.createdAt });
  }
  return out;
}

/** Arranca el poller opt-in; devuelve stop(). null si GAVRIEL_POLL_SEC no está seteado. */
export function startPoller(server: McpServer, client: GavrielClient): (() => void) | null {
  const sec = parsePollSec(process.env.GAVRIEL_POLL_SEC);
  if (!sec) return null;
  let seen: Set<string> | null = null; // el primer ciclo solo siembra, no alerta
  let failures = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    try {
      const events = await fetchPending(client);
      const fresh = diffNewEvents(seen ?? new Set(), events);
      if (seen && fresh.length) {
        await server.sendLoggingMessage({ level: "warning", logger: "gavriel", data: { newPendingEvents: fresh.length, events: fresh.slice(0, 10) } });
        await server.server.sendResourceUpdated({ uri: PENDING_URI }).catch(() => {});
      }
      seen = new Set(events.map((e) => e.id));
      failures = 0;
    } catch (err) {
      failures++;
      console.error(`[poller] error (${failures}): ${(err as Error).message}`);
    }
    if (!stopped) {
      const delay = Math.min(sec * 1000 * 2 ** failures, MAX_BACKOFF_MS);
      timer = setTimeout(tick, failures ? delay : sec * 1000);
      timer.unref();
    }
  };
  timer = setTimeout(tick, sec * 1000);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
