import type { GavrielClient } from "../gavrielClient.js";
import { ok, okTruncated, wrapReadOnly, truncateSchema, selectFields, fieldsSchema, forwardParams, ensureOk } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, destructiveGuard, okOrInput, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const ID = /^[\w-]+$/;
const id = (d: string) => z.string().regex(ID).describe(d);
const CLOUDS = z.array(z.string().regex(ID)).optional().describe("Nubes/proveedores a consultar (ej: hpp, imou, ezviz). Se envía como CSV");

const RO = { readOnlyHint: true } as const;

// /video/cameras y /cloud-devices-inventory responden {equipos:[...]} (cientos/miles de ítems): `fields` y `truncate` actúan sobre equipos.
export function shapeEquipos(d: unknown, fields?: string[], truncate?: number) {
  const o = d as { equipos?: Record<string, unknown>[] } | null;
  if (!o || !Array.isArray(o.equipos)) return okTruncated(selectFields(d as Record<string, unknown>, fields), truncate);
  const eq = fields?.length ? (selectFields(o.equipos, fields) as Record<string, unknown>[]) : o.equipos;
  const wrap = (n: number) => ({ ...o, equipos: eq.slice(0, n), ...(n < eq.length ? { _truncado: `Se devuelven ${n} de ${eq.length} equipos. Usá fields/truncate más alto.` } : {}) });
  let n = eq.length;
  while (truncate && n > 1 && JSON.stringify(wrap(n)).length > truncate) n = Math.max(1, Math.floor(n / 2));
  return ok(wrap(n));
}

export function registerVideoTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_video_cameras",
    {
      title: "Inventario de cámaras de video",
      description:
        "GET /video/cameras (respuesta con `equipos`). Usar cuando se necesita el inventario de cámaras/equipos de video de todas las nubes. No usar para cámaras de un evento o cuenta (usar get_event_cameras). fresh=true evita el caché del backend (más lento).",
      inputSchema: z.object({
        fresh: z.boolean().optional().describe("true = refrescar desde los proveedores (lento)"),
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/video/cameras", args.fresh ? { fresh: 1 } : undefined);
      return shapeEquipos(ensureOk(res), args.fields, args.truncate);
    }),
  );

  server.registerTool(
    "get_event_cameras",
    {
      title: "Cámaras de un evento o cuenta",
      description:
        "Usar cuando se quiere saber qué cámaras de video corresponden a un evento (eventId) o a una cuenta (accountId): GET /video/events/{id}/cameras o /video/events/account-cameras. Enviar exactamente uno de los dos. No usar para el inventario global (list_video_cameras).",
      inputSchema: z.object({
        eventId: id("Id del evento").optional(),
        accountId: id("Id de la cuenta").optional(),
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      if (!!args.eventId === !!args.accountId) throw new Error("Enviar exactamente uno: eventId o accountId");
      const res = args.eventId
        ? await client.get(`/video/events/${seg(args.eventId)}/cameras`)
        : await client.get("/video/events/account-cameras", { accountId: args.accountId });
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "get_event_clips",
    {
      title: "Clips de video de eventos",
      description:
        "Usar cuando se necesita el estado de los clips de video asociados a eventos: GET /video/event-clips?eventIds=… (varios ids) o /video/event-clips/{id} (uno). No usar para reproducción de grabaciones (get_video_playback).",
      inputSchema: z.object({
        eventId: id("Id de un evento (detalle)").optional(),
        eventIds: z.array(z.string().regex(ID)).max(100).optional().describe("Ids de eventos (máx 100); se envían como CSV"),
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      if (!!args.eventId === !!args.eventIds?.length) throw new Error("Enviar exactamente uno: eventId o eventIds");
      const res = args.eventId
        ? await client.get(`/video/event-clips/${seg(args.eventId)}`)
        : await client.get("/video/event-clips", { eventIds: args.eventIds!.join(",") });
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "get_video_playback",
    {
      title: "Consultas de reproducción de video",
      description:
        "Usar cuando se consulta información de grabaciones de una cámara: kind=rail (GET /video/playback/rail, requiere accountId+deviceId+clouds), segments (GET /video/playback/segments, requiere accountId+deviceId+channelNo+from+to), usage (GET /video/playback/usage, accountId+deviceId: bytes de hoy). No usar para abrir sesiones de video (no soportado).",
      inputSchema: z.object({
        kind: z.enum(["rail", "segments", "usage"]).describe("Tipo de consulta"),
        accountId: id("Id de la cuenta"),
        deviceId: id("Id del dispositivo"),
        channelNo: z.number().int().min(0).optional().describe("Canal (segments)"),
        from: z.string().optional().describe("Inicio del rango, ISO 8601 o epoch ms (segments)"),
        to: z.string().optional().describe("Fin del rango, ISO 8601 o epoch ms (segments)"),
        clouds: CLOUDS,
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      const base = { accountId: args.accountId, deviceId: args.deviceId };
      const clouds = args.clouds?.join(",");
      let res;
      if (args.kind === "usage") res = await client.get("/video/playback/usage", base);
      else if (args.kind === "rail") {
        if (!clouds) throw new Error("rail requiere clouds");
        res = await client.get("/video/playback/rail", { ...base, clouds });
      } else {
        if (args.channelNo === undefined || !args.from || !args.to) throw new Error("segments requiere channelNo, from y to");
        res = await client.get("/video/playback/segments", { ...base, channelNo: args.channelNo, from: args.from, to: args.to, ...(clouds ? { clouds } : {}) });
      }
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "list_video_walls",
    {
      title: "Mosaicos de video",
      description:
        "Usar cuando se listan los mosaicos (video walls) guardados (GET /video/walls) o se pide el detalle de uno con id (GET /video/walls/{id}).",
      inputSchema: z.object({
        id: id("Id del mosaico (omitir para listar)").optional(),
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(args.id ? `/video/walls/${seg(args.id)}` : "/video/walls");
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "get_cloud_devices_inventory",
    {
      title: "Inventario de equipos en la nube",
      description:
        "GET /cloud-devices-inventory (respuesta con `equipos`). Usar cuando se necesita el inventario de dispositivos registrados en las nubes de video. fresh=true fuerza refresco (lento).",
      inputSchema: z.object({
        fresh: z.boolean().optional().describe("true = refrescar desde los proveedores"),
        truncate: truncateSchema,
        fields: fieldsSchema,
      }),
      annotations: RO,
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/cloud-devices-inventory", args.fresh ? { fresh: 1 } : undefined);
      return shapeEquipos(ensureOk(res), args.fields, args.truncate);
    }),
  );

  // POST de solo consulta (lookup): sin efectos de escritura, el frontend lo llama al cargar la página.
  server.registerTool(
    "resolve_video_cameras",
    {
      title: "Resolver cámaras por cuenta/dispositivo",
      description:
        "POST /video/cameras/resolve (lookup, no modifica nada). Usar cuando se quiere mapear cuentas/dispositivos a sus cámaras. Enviar accountIds y/o deviceIds.",
      inputSchema: z.object({
        accountIds: z.array(id("Id de cuenta")).max(200).optional().describe("Ids de cuentas"),
        deviceIds: z.array(id("Id de dispositivo")).max(200).optional().describe("Ids de dispositivos"),
        truncate: truncateSchema,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.post("/video/cameras/resolve", forwardParams(args, ["accountIds", "deviceIds"]));
      return okTruncated(ensureOk(res), args.truncate);
    }),
  );

  registerTool(
    server, role, "full", "sync_video_camera",
    {
      title: "Sincronizar cámara de video",
      description:
        "POST /video/cameras/sync. Usar cuando una cámara (por serial) debe re-sincronizarse con el proveedor, opcionalmente vinculándola a una cuenta. Requiere confirm: true.",
      inputSchema: {
        serial: z.string().min(1).describe("Número de serie de la cámara/equipo"),
        accountId: id("Id de cuenta a vincular (opcional)").optional(),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const body = { serial: args.serial, ...(args.accountId ? { accountId: args.accountId } : {}) };
      return requireConfirm(
        args.confirm,
        { tool: "sync_video_camera", method: "POST", path: "/video/cameras/sync", params: body },
        client,
        () => client.post("/video/cameras/sync", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "create_video_wall",
    {
      title: "Guardar mosaico de video",
      description:
        "POST /video/walls. Usar cuando se guarda un mosaico con nombre y distribución de cámaras. Si existe uno propio con el mismo nombre el frontend pide reemplazo. `layout` se pasa tal cual (celdas/cámaras del mosaico; copiar la forma de list_video_walls). Requiere confirm: true.",
      inputSchema: {
        nombre: z.string().min(1).describe("Nombre del mosaico"),
        compartido: z.boolean().default(false).describe("true = visible para otros usuarios"),
        layout: z.record(z.string(), z.unknown()).describe("Campos de distribución del mosaico, mismos que devuelve list_video_walls"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = { ...args.layout, nombre: args.nombre, compartido: args.compartido };
      return requireConfirm(
        args.confirm,
        { tool: "create_video_wall", method: "POST", path: "/video/walls", params: body },
        client,
        () => client.post("/video/walls", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_video_wall",
    {
      title: "Borrar mosaico de video",
      description: "DELETE /video/walls/{id}. Usar cuando se elimina un mosaico guardado. Irreversible. Requiere confirm: true y aprobación humana.",
      inputSchema: { id: id("Id del mosaico"), confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const path = `/video/walls/${seg(args.id)}`;
      const exec = { tool: "delete_video_wall", method: "DELETE", path, params: {} };
      return requireConfirm(args.confirm, exec, client, () => client.delete(path),
        destructiveGuard("delete_video_wall", exec, ctx)).then(okOrInput);
    },
  );

  registerTool(
    server, role, "full", "verify_cloud_live_view",
    {
      title: "Verificar live-view en la nube de un dispositivo",
      description:
        "POST /accounts/{accountId}/devices/{deviceId}/cloud-live-view-verification-for-{ezviz|team}-preview. Usar cuando se verifica si un dispositivo soporta live-view por nube Ezviz o Hik-Connect for Teams. No usar para credenciales de acceso. Requiere confirm: true.",
      inputSchema: {
        accountId: id("Id de la cuenta"),
        deviceId: id("Id del dispositivo"),
        provider: z.enum(["ezviz", "team"]).describe("Proveedor a verificar"),
        confirm: confirmSchema,
      },
      annotations: { openWorldHint: true },
    },
    async (args) => {
      const path = `/accounts/${seg(args.accountId)}/devices/${seg(args.deviceId)}/cloud-live-view-verification-for-${args.provider}-preview`;
      return requireConfirm(
        args.confirm,
        { tool: "verify_cloud_live_view", method: "POST", path, params: {} },
        client,
        () => client.post(path, {}),
      ).then(ok);
    },
  );
}
