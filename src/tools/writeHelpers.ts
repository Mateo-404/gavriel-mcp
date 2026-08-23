import { z } from "zod";
import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/server";
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

// ── Aprobación destructiva (defensa extra sobre confirm) ───────────
// Tools que borran datos o escriben en masa. Con
// GAVRIEL_MCP_DESTRUCTIVE_APPROVAL=elicitation, además del confirm la tool
// le pregunta al usuario humano vía elicitation antes de ejecutar.
const DESTRUCTIVE_TOOLS = new Set([
  "delete_account_note",
  "bulk_mark_events_by_filter",
  "bulk_add_account_note",
]);

type ApprovalMode = "off" | "elicitation";
// ponytail: estado de módulo — el server es un proceso único y el modo se
// setea una vez al arrancar desde config; no hace falta inyectarlo por DI.
let approvalMode: ApprovalMode = "off";

export function setDestructiveApproval(mode: ApprovalMode): void {
  approvalMode = mode;
}

export type ElicitFn = (params: ElicitRequestFormParams) => Promise<ElicitResult>;

// Devuelve un guard para requireConfirm si corresponde preguntarle al humano.
// Si el cliente no soporta elicitation (o falla), NO ejecuta (falla cerrado).
// Nota: ctx.mcpReq.elicitInput está deprecado en la spec 2026-07-28 (usa
// inputRequired) pero sigue funcional en clientes 2025-era; en un cliente
// 2026-07-28 lanza → el catch lo trata como "no aprobado".
export function destructiveGuard(
  tool: string,
  exec: WriteExecution,
  elicit?: ElicitFn,
): { confirmWithUser: () => Promise<boolean> } | undefined {
  if (approvalMode !== "elicitation" || !DESTRUCTIVE_TOOLS.has(tool) || !elicit) return undefined;
  return {
    confirmWithUser: async () => {
      try {
        const res = await elicit({
          mode: "form",
          message:
            `Operación destructiva: ${exec.tool}\n${exec.method} ${exec.path}\n` +
            `¿Ejecutar? (el agente ya mostró el preview y pediste confirm)`,
          requestedSchema: {
            type: "object",
            properties: {
              aprobar: {
                type: "boolean",
                title: "¿Ejecutar?",
                description: "Marcá true solo si aprobás explícitamente esta operación.",
              },
            },
            required: ["aprobar"],
          },
        });
        const aprobar = (res.content as { aprobar?: unknown } | undefined)?.aprobar;
        return res.action === "accept" && aprobar === true;
      } catch (e) {
        console.error(`[writeHelpers] elicitation no disponible/falló: ${(e as Error).message}`);
        return false;
      }
    },
  };
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
  guard?: { confirmWithUser: () => Promise<boolean> },
): Promise<unknown> {
  if (confirm !== true) {
    return buildPreview(exec);
  }

  if (guard && !(await guard.confirmWithUser())) {
    return {
      ok: false,
      writeStatus: "rejected_by_user",
      mensaje: "El usuario rechazó la operación destructiva (o su cliente no soporta elicitation).",
    };
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

// ── Lotes ───────────────────────────────────────────────────────────
// Ejecuta N operaciones en paralelo; la concurrencia real la limita el
// semáforo del cliente (GAVRIEL_MCP_WRITE_CONCURRENCY). Un fallo por ítem
// no corta el lote: cada entrada reporta ok/status/error.
export interface BatchOp {
  id: string;
  run: () => Promise<{ status: number }>;
}

export interface BatchReport {
  summary: { total: number; ok: number; failed: number };
  results: Array<{ id: string; ok: boolean; status?: number; error?: string }>;
}

export async function runBatch(ops: BatchOp[]): Promise<BatchReport> {
  const results = await Promise.all(
    ops.map(async (op) => {
      try {
        const r = await op.run();
        return { id: op.id, ok: r.status >= 200 && r.status < 300, status: r.status };
      } catch (e) {
        return { id: op.id, ok: false, error: (e as Error).message };
      }
    }),
  );
  const failed = results.filter((r) => !r.ok).length;
  return { summary: { total: ops.length, ok: ops.length - failed, failed }, results };
}
