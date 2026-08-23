import { z } from "zod";
import type { GavrielClient } from "../gavrielClient.js";
import { logWrite } from "../auditLog.js";

// Segmentos de path que son "acciones" sobre un recurso, no el recurso mismo.
// Se usan para derivar el GET de re-lectura tras una respuesta corrupta.
const ACTION_SEGMENTS = new Set([
  "read", "claim", "release", "close", "schedule",
  "mark-as-read", "mark-as-unread", "open", "range", "non-working-days",
]);

export const confirmSchema = z
  .boolean()
  .describe("true = ejecutar. false/omitido = preview.")
  .default(false);

export interface WriteExecution {
  tool: string;
  method: string;
  path: string;
  params: unknown;
}

/**
 * Gate de confirmación (Fase 0, regla 2).
 *
 * Si `confirm !== true` devuelve un preview (método + path + body armado) sin
 * tocar la API. Si `confirm === true` ejecuta la llamada y la loguea en
 * writes.log (antes y después).
 *
 * Si la respuesta tiene status 2xx pero el body no parsea como JSON (bug
 * conocido del backend de Gavriel que trunca respuestas a la mitad), no se
 * reporta error a ciegas: se loguea el body crudo y se re-lee el recurso
 * afectado para confirmar el estado real post-escritura.
 *
 * Para remover este gate: esta función es el único lugar a tocar — cambiar el
 * check a `true` (o devolver `null` y siempre ejecutar).
 */
export async function requireConfirm(
  confirm: boolean,
  exec: WriteExecution,
  client: GavrielClient,
  run: () => Promise<{ status: number; data: unknown }>,
): Promise<unknown> {
  if (confirm !== true) {
    return buildPreview(exec);
  }

  logWrite({
    tool: exec.tool,
    method: exec.method,
    path: exec.path,
    params: exec.params,
    userEmail: client.email,
  });

  try {
    const { status, data } = await run();

    // 2xx con body no parseable: el cliente dejó `data` como string crudo.
    if (status >= 200 && status < 300 && typeof data === "string") {
      logWrite({
        tool: exec.tool,
        method: exec.method,
        path: exec.path,
        params: exec.params,
        userEmail: client.email,
        responseStatus: status,
        ok: false,
        error: "response 2xx con body no parseable (truncado por el backend)",
        rawBody: data,
      });
      const verifiedState = await verifyAfterWrite(exec, client);
      return {
        writeStatus: "applied_response_unparseable",
        httpStatus: status,
        warning:
          "El backend devolvió una respuesta no parseable; se verificó el estado real leyendo el recurso.",
        verifiedState,
      };
    }

    logWrite({
      tool: exec.tool,
      method: exec.method,
      path: exec.path,
      params: exec.params,
      userEmail: client.email,
      responseStatus: status,
      responseBody: summarize(data),
      ok: status >= 200 && status < 300,
    });
    return { ok: status >= 200 && status < 300, status, data };
  } catch (err) {
    logWrite({
      tool: exec.tool,
      method: exec.method,
      path: exec.path,
      params: exec.params,
      userEmail: client.email,
      ok: false,
      error: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Re-lectura del recurso tras una escritura con respuesta corrupta.
 * Solo para PATCH/DELETE (path apunta a un recurso existente y GET-able).
 * Para POST (creaciones) no hay id si la respuesta se perdió: se devuelve
 * null y el warning lo deja claro.
 */
async function verifyAfterWrite(exec: WriteExecution, client: GavrielClient): Promise<unknown> {
  if (exec.method !== "PATCH" && exec.method !== "DELETE") return null;
  const path = readBackPath(exec.path);
  if (!path) return null;
  try {
    const res = await client.get(path);
    return { reRead: { path, status: res.status, data: res.data } };
  } catch (e) {
    // Para DELETE un 404/error confirma que el recurso ya no existe.
    return { reRead: { path, failed: true, reason: (e as Error).message } };
  }
}

function readBackPath(path: string): string | null {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  while (segs.length && ACTION_SEGMENTS.has(segs[segs.length - 1])) segs.pop();
  return segs.length ? `/${segs.join("/")}` : null;
}

export function buildPreview(exec: WriteExecution): unknown {
  return {
    preview: true,
    mensaje:
      "Escritura NO ejecutada. Revisá el detalle y llamá de nuevo con `confirm: true` si querés ejecutarla.",
    metodo: exec.method,
    path: exec.path,
    body: exec.params,
  };
}

function summarize(data: unknown, maxLen = 1000): unknown {
  if (data === null || data === undefined) return data;
  const json = JSON.stringify(data);
  if (json.length <= maxLen) return data;
  // ponytail: preview truncado sin parsear — JSON.parse sobre un slice
  // truncado lanza (bug C-2); el log solo necesita una muestra legible.
  return { _truncatedPreview: json.slice(0, maxLen), totalLength: json.length };
}
