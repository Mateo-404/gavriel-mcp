import type { GavrielClient } from "../gavrielClient.js";
import { buildBody } from "./shared.js";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, destructiveGuard, okOrInput, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const id = (what: string) => z.string().regex(/^[\w-]+$/).describe(what);
const optId = (what: string) => z.string().regex(/^[\w-]+$/).optional().describe(what);

type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export function registerInfrastructureTools(server: McpServer, client: GavrielClient, role: Role): void {
  // Todas las escrituras: preview sin confirm; `guarded` fuerza aprobación humana.
  const putCall = (path: string, body: unknown) => client.put(path, body);
  const run = (
    tool: string, method: Method, path: string, body: Record<string, unknown> | undefined,
    confirm: boolean, ctx: ServerContext, guarded = false,
  ) => {
    const exec = { tool, method, path, params: body ?? {} };
    const call = () =>
      method === "POST" ? client.post(path, body ?? {})
        : method === "PATCH" ? client.patch(path, body ?? {})
        : method === "PUT" ? putCall(path, body ?? {})
        : client.delete(path);
    return requireConfirm(confirm, exec, client, call, guarded ? destructiveGuard(tool, exec, ctx) : undefined).then(okOrInput);
  };

  // ── Bridges ───────────────────────────────────────────────────────
  const bridgeFields = {
    name: z.string().optional().describe("Nombre del bridge"),
    code: z.string().optional().describe("Código del bridge"),
    ip: z.string().optional().describe("IP del bridge"),
    httpPort: z.number().int().nullable().optional().describe("Puerto HTTP (null = ninguno)"),
    activated: z.boolean().optional().describe("Bridge activo"),
  };
  const BRIDGE_KEYS = ["name", "code", "ip", "httpPort", "activated"] as const;

  registerTool(server, role, "full", "create_bridge", {
    title: "Crear bridge (ESCRITURA)",
    description: "POST /bridges. Usar cuando hay que dar de alta un bridge (name, code, ip). No usar para editar uno existente (update_bridge). 409 = nombre/código duplicado. Requiere confirm: true.",
    inputSchema: { ...bridgeFields, name: z.string().describe("Nombre"), code: z.string().describe("Código"), ip: z.string().describe("IP"), confirm: confirmSchema },
  }, async (a, ctx) => run("create_bridge", "POST", "/bridges", buildBody(a, { required: ["name", "code", "ip"], optional: ["httpPort", "activated"] }), a.confirm, ctx));

  registerTool(server, role, "full", "update_bridge", {
    title: "Actualizar bridge (ESCRITURA)",
    description: "PATCH /bridges/{id}. Usar cuando hay que cambiar name/code/ip/httpPort de un bridge. No usar para activar/desactivar (toggle_bridge_activation). Requiere confirm: true.",
    inputSchema: { bridgeId: id("ID del bridge"), ...bridgeFields, confirm: confirmSchema },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("update_bridge", "PATCH", `/bridges/${seg(a.bridgeId)}`, buildBody(a, { optional: BRIDGE_KEYS }), a.confirm, ctx));

  registerTool(server, role, "full", "toggle_bridge_activation", {
    title: "Activar/desactivar bridge (DESTRUCTIVA)",
    description: "PATCH /bridges/toggle-activation/{id}. Invierte el estado activo del bridge: desactivarlo corta la recepción de eventos de sus conexiones. Usar solo con pedido explícito. No usar para editar datos. Requiere confirm: true + aprobación humana.",
    inputSchema: { bridgeId: id("ID del bridge"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("toggle_bridge_activation", "PATCH", `/bridges/toggle-activation/${seg(a.bridgeId)}`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "restart_bridge", {
    title: "Reiniciar bridge (DESTRUCTIVA)",
    description: "POST /bridges/{id}/restart. Reinicia el proceso del bridge: corte momentáneo de sus conexiones. Usar solo con pedido explícito. Requiere confirm: true + aprobación humana.",
    inputSchema: { bridgeId: id("ID del bridge"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("restart_bridge", "POST", `/bridges/${seg(a.bridgeId)}/restart`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "cleanup_bridge", {
    title: "Limpiar disco de bridge (DESTRUCTIVA)",
    description: "POST /bridges/{id}/cleanup. Borra archivos del disco del bridge para liberar espacio (irreversible). Usar tras revisar get_bridge_disk_space. Requiere confirm: true + aprobación humana.",
    inputSchema: { bridgeId: id("ID del bridge"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("cleanup_bridge", "POST", `/bridges/${seg(a.bridgeId)}/cleanup`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "delete_bridge", {
    title: "Eliminar bridge (DESTRUCTIVA)",
    description: "DELETE /bridges/{id}. Elimina el bridge. No usar para solo pausarlo (toggle_bridge_activation). Requiere confirm: true + aprobación humana.",
    inputSchema: { bridgeId: id("ID del bridge"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_bridge", "DELETE", `/bridges/${seg(a.bridgeId)}`, undefined, a.confirm, ctx, true));

  // ── Connections ───────────────────────────────────────────────────
  const connFields = {
    name: z.string().optional().describe("Nombre de la conexión"),
    code: z.string().optional().describe("Código"),
    bridgeId: optId("ID del bridge"),
    protocolId: optId("ID del protocolo"),
    eventsFormatId: optId("ID del formato de eventos"),
    customEventsFormatId: optId("ID del formato de eventos custom"),
    secondaryEventsFormatId: optId("ID del formato de eventos secundario"),
    companies: z.array(z.string().regex(/^[\w-]+$/)).optional().describe("IDs de empresas asociadas (reemplaza la lista)"),
    unknownAccountCompanyId: optId("ID de empresa para cuentas desconocidas"),
    activated: z.boolean().optional().describe("Conexión activa"),
    heartbeatIntervalMinutes: z.number().int().min(1).nullable().optional().describe("Intervalo de heartbeat en minutos"),
    maxMinutesWithoutEvents: z.number().int().min(1).nullable().optional().describe("Máx. minutos sin eventos antes de alertar"),
  };
  const CONN_KEYS = Object.keys(connFields);

  registerTool(server, role, "full", "create_connection", {
    title: "Crear conexión (ESCRITURA)",
    description: "POST /connections. Usar cuando hay que dar de alta una conexión de receptor bajo un bridge. Los campos extra (puertos, etc.) no están expuestos: usar solo los listados. No usar para editar (update_connection). Requiere confirm: true.",
    inputSchema: { ...connFields, confirm: confirmSchema },
  }, async (a, ctx) => run("create_connection", "POST", "/connections", buildBody(a, { optional: CONN_KEYS }), a.confirm, ctx));

  registerTool(server, role, "full", "update_connection", {
    title: "Actualizar conexión (ESCRITURA)",
    description: "PATCH /connections/{id}. Usar cuando hay que cambiar datos, empresas asociadas o umbrales de heartbeat de una conexión. Requiere confirm: true.",
    inputSchema: { connectionId: id("ID de la conexión"), ...connFields, confirm: confirmSchema },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("update_connection", "PATCH", `/connections/${seg(a.connectionId)}`, buildBody(a, { optional: CONN_KEYS }), a.confirm, ctx));

  registerTool(server, role, "full", "delete_connection", {
    title: "Eliminar conexión (DESTRUCTIVA)",
    description: "DELETE /connections/{id}. Elimina la conexión. Requiere confirm: true + aprobación humana.",
    inputSchema: { connectionId: id("ID de la conexión"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_connection", "DELETE", `/connections/${seg(a.connectionId)}`, undefined, a.confirm, ctx, true));

  // ── Partitions ────────────────────────────────────────────────────
  registerTool(server, role, "full", "create_partition", {
    title: "Crear partición (ESCRITURA)",
    description: "POST /accounts/{accountId}/partitions. Usar cuando hay que agregar una partición a una cuenta. Requiere confirm: true.",
    inputSchema: { accountId: id("ID de la cuenta"), code: z.string().describe("Código de la partición"), name: z.string().describe("Nombre"), confirm: confirmSchema },
  }, async (a, ctx) => run("create_partition", "POST", `/accounts/${seg(a.accountId)}/partitions`, { code: a.code, name: a.name, accountId: a.accountId }, a.confirm, ctx));

  registerTool(server, role, "full", "update_partition", {
    title: "Actualizar partición (ESCRITURA)",
    description: "PUT /partitions/{id}. Usar cuando hay que cambiar code/name de una partición. Requiere confirm: true.",
    inputSchema: { partitionId: id("ID de la partición"), code: z.string().optional().describe("Código"), name: z.string().optional().describe("Nombre"), confirm: confirmSchema },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("update_partition", "PUT", `/partitions/${seg(a.partitionId)}`, buildBody(a, { optional: ["code", "name"] }), a.confirm, ctx));

  registerTool(server, role, "full", "delete_partition", {
    title: "Eliminar partición (DESTRUCTIVA)",
    description: "DELETE /partitions/{id}. Requiere confirm: true + aprobación humana.",
    inputSchema: { partitionId: id("ID de la partición"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_partition", "DELETE", `/partitions/${seg(a.partitionId)}`, undefined, a.confirm, ctx, true));

  const MEMBER = { zones: "zoneId", users: "userId", contacts: "contactId" } as const;
  const memberSchema = {
    partitionId: id("ID de la partición"),
    kind: z.enum(["zones", "users", "contacts"]).describe("Tipo de miembro"),
    memberId: id("ID de la zona/usuario/contacto"),
    confirm: confirmSchema,
  };

  registerTool(server, role, "full", "add_partition_member", {
    title: "Asociar a partición (ESCRITURA)",
    description: "POST /partitions/{id}/{zones|users|contacts}. Usar cuando hay que asociar una zona, usuario o contacto a una partición. Requiere confirm: true.",
    inputSchema: memberSchema,
  }, async (a, ctx) => run("add_partition_member", "POST", `/partitions/${seg(a.partitionId)}/${a.kind}`, { [MEMBER[a.kind]]: a.memberId }, a.confirm, ctx));

  registerTool(server, role, "full", "delete_partition_member", {
    title: "Desasociar de partición (DESTRUCTIVA)",
    description: "DELETE /partitions/{id}/{zones|users|contacts}/{memberId}. Quita la asociación (no borra la zona/usuario/contacto). Requiere confirm: true + aprobación humana.",
    inputSchema: memberSchema,
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_partition_member", "DELETE", `/partitions/${seg(a.partitionId)}/${a.kind}/${seg(a.memberId)}`, undefined, a.confirm, ctx, true));

  // ── Zones ─────────────────────────────────────────────────────────
  registerTool(server, role, "full", "set_zone_maintenance", {
    title: "Poner zona en mantenimiento (ESCRITURA)",
    description: "PATCH /zones/{id}/maintenance. Usar cuando hay que silenciar una zona por N horas por mantenimiento. No usar para editar la zona (update_zone). Requiere confirm: true.",
    inputSchema: { zoneId: id("ID de la zona"), durationHours: z.number().positive().describe("Duración del mantenimiento en horas"), confirm: confirmSchema },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("set_zone_maintenance", "PATCH", `/zones/${seg(a.zoneId)}/maintenance`, { durationHours: a.durationHours }, a.confirm, ctx));

  registerTool(server, role, "full", "delete_zone_maintenance", {
    title: "Quitar mantenimiento de zona (DESTRUCTIVA)",
    description: "DELETE /zones/{id}/maintenance. Termina el mantenimiento: la zona vuelve a generar alertas. Requiere confirm: true + aprobación humana.",
    inputSchema: { zoneId: id("ID de la zona"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_zone_maintenance", "DELETE", `/zones/${seg(a.zoneId)}/maintenance`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "delete_zone", {
    title: "Eliminar zona (DESTRUCTIVA)",
    description: "DELETE /zones/{id}. Requiere confirm: true + aprobación humana.",
    inputSchema: { zoneId: id("ID de la zona"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_zone", "DELETE", `/zones/${seg(a.zoneId)}`, undefined, a.confirm, ctx, true));

  // ── Companies ─────────────────────────────────────────────────────
  const companyFields = {
    name: z.string().optional().describe("Nombre"),
    code: z.string().optional().describe("Código"),
    isTechnical: z.boolean().optional().describe("Empresa técnica"),
    isMonitoring: z.boolean().optional().describe("Empresa de monitoreo"),
    currentStatus: z.string().optional().describe("Estado actual"),
    logoId: z.string().regex(/^[\w-]+$/).nullable().optional().describe("ID de archivo del logo (null = quitar)"),
  };
  const COMPANY_KEYS = Object.keys(companyFields);

  registerTool(server, role, "full", "create_company", {
    title: "Crear empresa (ESCRITURA)",
    description: "POST /companies. Usar cuando hay que dar de alta una empresa (técnica y/o de monitoreo). 409 = duplicada. Requiere confirm: true.",
    inputSchema: { ...companyFields, name: z.string().describe("Nombre"), code: z.string().describe("Código"), confirm: confirmSchema },
  }, async (a, ctx) => run("create_company", "POST", "/companies", buildBody(a, { optional: COMPANY_KEYS }), a.confirm, ctx));

  registerTool(server, role, "full", "update_company", {
    title: "Actualizar empresa (ESCRITURA)",
    description: "PATCH /companies/{id}. Usar cuando hay que cambiar datos de una empresa. Requiere confirm: true.",
    inputSchema: { companyId: id("ID de la empresa"), ...companyFields, confirm: confirmSchema },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("update_company", "PATCH", `/companies/${seg(a.companyId)}`, buildBody(a, { optional: COMPANY_KEYS }), a.confirm, ctx));

  registerTool(server, role, "full", "delete_company", {
    title: "Eliminar empresa (DESTRUCTIVA)",
    description: "DELETE /companies/{id}. Requiere confirm: true + aprobación humana.",
    inputSchema: { companyId: id("ID de la empresa"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_company", "DELETE", `/companies/${seg(a.companyId)}`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "delete_company_non_working_day", {
    title: "Quitar día no laborable de empresa (DESTRUCTIVA)",
    description: "DELETE /companies/{id}/non-working-days/{dayId}. Para agregar usar add_company_non_working_day. Requiere confirm: true + aprobación humana.",
    inputSchema: { companyId: id("ID de la empresa"), dayId: id("ID del día no laborable"), confirm: confirmSchema },
    annotations: { destructiveHint: true },
  }, async (a, ctx) => run("delete_company_non_working_day", "DELETE", `/companies/${seg(a.companyId)}/non-working-days/${seg(a.dayId)}`, undefined, a.confirm, ctx, true));

  registerTool(server, role, "full", "set_company_sip_config", {
    title: "Configurar telefonía SIP de empresa (ESCRITURA)",
    description: "PUT /companies/{id}/sip-config. Usar cuando hay que habilitar/ajustar la telefonía SIP de una empresa (wssUrl, dominio, prefijo). Si enabled=true wssUrl y domain deben ser reales. Requiere confirm: true.",
    inputSchema: {
      companyId: id("ID de la empresa"),
      enabled: z.boolean().describe("Telefonía habilitada"),
      wssUrl: z.string().describe("URL WSS del servidor SIP"),
      domain: z.string().describe("Dominio SIP"),
      outboundPrefix: z.string().nullable().optional().describe("Prefijo de salida (null = ninguno)"),
      confirm: confirmSchema,
    },
    annotations: { idempotentHint: true },
  }, async (a, ctx) => run("set_company_sip_config", "PUT", `/companies/${seg(a.companyId)}/sip-config`,
    { enabled: a.enabled, wssUrl: a.wssUrl, domain: a.domain, outboundPrefix: a.outboundPrefix ?? null }, a.confirm, ctx));
}
