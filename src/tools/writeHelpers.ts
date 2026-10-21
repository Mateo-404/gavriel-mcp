import { z } from "zod";
import {
  inputRequired,
  inputResponse,
  isInputRequiredResult,
  type CallToolResult,
  type ElicitRequestFormParams,
  type ElicitResult,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { ok } from "./shared.js";
import type { GavrielClient } from "../gavrielClient.js";
import { logWrite } from "../auditLog.js";

// Segmentos de path que son "acciones" sobre un recurso, no el recurso mismo.
// Se usan para derivar el GET de re-lectura tras una respuesta corrupta.
const ACTION_SEGMENTS = new Set([
  "read", "claim", "release", "close", "schedule",
  "mark-as-read", "mark-as-unread", "open", "range", "non-working-days",
]);

// Segmento de path seguro: los ids vienen de input del modelo, nunca se interpolan crudos.
export const seg = (id: string): string => encodeURIComponent(id);

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
// Todo delete_*, todo bulk_* y send_conversation_message piden además
// aprobación humana vía elicitation (default). Opt-out explícito:
// GAVRIEL_MCP_DESTRUCTIVE_APPROVAL=off. Sin cliente con elicitation falla cerrado.
export function isDestructive(tool: string): boolean {
  return /^(delete_|bulk_|restart_|toggle_|cleanup_|cancel_notification_|retry_failed_notification_|archive_notification_)/.test(tool)
    || /^(send_conversation_message|create_notification_campaign|reset_user_otp|create_user|update_user|notify_barrio|set_technician_slot_config|deactivate_intervention_category)$/.test(tool);
}

type ApprovalMode = "off" | "elicitation";
// ponytail: estado de módulo — el server es un proceso único y el modo se
// setea una vez al arrancar desde config; no hace falta inyectarlo por DI.
let approvalMode: ApprovalMode = "elicitation";

export function setDestructiveApproval(mode: ApprovalMode): void {
  approvalMode = mode;
}

export type ElicitFn = (params: ElicitRequestFormParams) => Promise<ElicitResult>;
type Guard = { confirmWithUser: () => Promise<boolean | InputRequiredResult> };

const APPROVAL_KEY = "approve";

/** Convierte el resultado de requireConfirm en respuesta MCP (pasa input_required tal cual). */
export function okOrInput(r: unknown): CallToolResult {
  return isInputRequiredResult(r) ? (r as unknown as CallToolResult) : ok(r);
}

// Devuelve un guard para requireConfirm si corresponde preguntarle al humano.
// 3er parámetro:
//  - ServerContext (preferido): usa inputRequired.elicit (spec 2026-07-28; el SDK
//    lo adapta a clientes 2025 con su legacy shim). Al reintento lee inputResponses.
//  - ElicitFn (legacy, ctx.mcpReq.elicitInput): fallback deprecado, lanza en clientes 2026.
// Si no hay forma de preguntar o falla, NO ejecuta (falla cerrado).
export function destructiveGuard(
  tool: string,
  exec: WriteExecution,
  via?: ServerContext | ElicitFn,
): Guard | undefined {
  if (approvalMode !== "elicitation" || !isDestructive(tool)) return undefined;
  const params: ElicitRequestFormParams = {
    mode: "form",
    message:
      `Operación destructiva: ${exec.tool}
${exec.method} ${exec.path}
` +
      `¿Ejecutar? (el agente ya mostró el preview y pidió confirm)`,
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
  };
  return {
    confirmWithUser: async () => {
      try {
        if (typeof via === "function") {
          const res = await via(params);
          return res.action === "accept" && (res.content as { aprobar?: unknown } | undefined)?.aprobar === true;
        }
        if (!via) return false;
        const v = inputResponse(via.mcpReq.inputResponses, APPROVAL_KEY);
        if (v.kind === "elicit") return v.action === "accept" && v.content?.aprobar === true;
        return inputRequired({ inputRequests: { [APPROVAL_KEY]: inputRequired.elicit(params) } });
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
  guard?: Guard,
): Promise<unknown> {
  if (confirm !== true) {
    return buildPreview(exec);
  }

  const approval = guard ? await guard.confirmWithUser() : true;
  if (typeof approval === "object") return approval; // input_required: el cliente pregunta y reintenta
  if (!approval) {
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
  run: (signal?: AbortSignal) => Promise<{ status: number }>;
}

export interface BatchReport {
  summary: { total: number; ok: number; failed: number };
  results: Array<{ id: string; ok: boolean; status?: number; error?: string }>;
}

// ctx (opcional): emite progress si el request trae progressToken y propaga su abort signal a cada op.
export async function runBatch(ops: BatchOp[], ctx?: ServerContext): Promise<BatchReport> {
  const token = ctx?.mcpReq._meta?.progressToken;
  const signal = ctx?.mcpReq.signal;
  let done = 0;
  const settled = await Promise.allSettled(
    ops.map(async (op) => {
      try {
        return await op.run(signal);
      } finally {
        done++;
        if (token !== undefined) {
          // best-effort: un fallo al notificar no debe romper el lote
          void ctx!.mcpReq
            .notify({ method: "notifications/progress", params: { progressToken: token, progress: done, total: ops.length } })
            .catch(() => {});
        }
      }
    }),
  );
  const results = settled.map((r, i) =>
    r.status === "fulfilled"
      ? { id: ops[i].id, ok: r.value.status >= 200 && r.value.status < 300, status: r.value.status }
      : { id: ops[i].id, ok: false, error: (r.reason as Error)?.message ?? String(r.reason) },
  );
  const failed = results.filter((r) => !r.ok).length;
  return { summary: { total: ops.length, ok: ops.length - failed, failed }, results };
}
