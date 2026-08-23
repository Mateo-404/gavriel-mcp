import type { GavrielClient } from "../gavrielClient.js";
import { ok, buildBody, wrapReadOnly, okTruncated } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

interface EventType { id: string; name: string; title?: string; eventsCodes?: Array<{ code: string; id: string; eventsTypeId?: string }> }
interface EventCode { id: string; code: string; name?: string; eventsTypeId?: string; eventsFormatId?: string }

export function registerEventCatalogTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "full", "create_event_type",
    {
      title: "Crear tipo de evento (ESCRITURA)",
      description: "POST /events-types. Requiere confirm: true.",
      inputSchema: {
        name: z.string().min(1).describe("Nombre corto del tipo (ej: JDS)"),
        title: z.string().min(1).describe("Título descriptivo"),
        description: z.string().optional(),
        icon: z.string().optional().describe("FontAwesome icon class"),
        color: z.string().optional().describe("Hex color, ej #d9342f"),
        sound: z.string().optional(),
        requiresIntervention: z.boolean().optional(),
        priority: z.number().int().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["name", "title"],
        optional: ["description", "icon", "color", "sound", "requiresIntervention", "priority"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_event_type", method: "POST", path: "/events-types", params: body },
        client,
        () => client.post("/events-types", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_event_type",
    {
      title: "Actualizar tipo de evento (ESCRITURA)",
      description: "PATCH /events-types/{id}. Requiere confirm: true.",
      inputSchema: {
        eventTypeId: z.string(),
        name: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        sound: z.string().optional(),
        requiresIntervention: z.boolean().optional(),
        priority: z.number().int().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["name", "title", "description", "icon", "color", "sound", "requiresIntervention", "priority"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_event_type", method: "PATCH", path: `/events-types/${args.eventTypeId}`, params: body },
        client,
        () => client.patch(`/events-types/${args.eventTypeId}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_event_type",
    {
      title: "Eliminar tipo de evento (ESCRITURA)",
      description: "DELETE /events-types/{id}. Requiere confirm: true.",
      inputSchema: { eventTypeId: z.string(), confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_event_type", method: "DELETE", path: `/events-types/${args.eventTypeId}`, params: {} },
        client,
        () => client.delete(`/events-types/${args.eventTypeId}`),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "create_event_code",
    {
      title: "Crear código de evento (ESCRITURA)",
      description: "POST /events-codes. Requiere confirm: true.",
      inputSchema: {
        code: z.string().min(1).describe("Código del evento (ej: GTGEO)"),
        name: z.string().min(1).describe("Nombre descriptivo"),
        title: z.string().optional().describe("Título alternativo"),
        description: z.string().optional(),
        dataType: z.string().optional().describe("Tipo de dato (Zone, Alarm, etc.)"),
        eventsTypeId: z.string().describe("ID del tipo de evento asociado"),
        eventsFormatId: z.string().describe("ID del formato/protocolo"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["code", "name", "eventsTypeId", "eventsFormatId"],
        optional: ["title", "description", "dataType"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_event_code", method: "POST", path: "/events-codes", params: body },
        client,
        () => client.post("/events-codes", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_event_code",
    {
      title: "Actualizar código de evento (ESCRITURA)",
      description: "PATCH /events-codes/{id}. Requiere confirm: true.",
      inputSchema: {
        eventCodeId: z.string(),
        code: z.string().optional(),
        name: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        dataType: z.string().optional(),
        eventsTypeId: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["code", "name", "title", "description", "dataType", "eventsTypeId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_event_code", method: "PATCH", path: `/events-codes/${args.eventCodeId}`, params: body },
        client,
        () => client.patch(`/events-codes/${args.eventCodeId}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_event_code",
    {
      title: "Eliminar código de evento (ESCRITURA)",
      description: "DELETE /events-codes/{id}. Requiere confirm: true.",
      inputSchema: { eventCodeId: z.string(), confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_event_code", method: "DELETE", path: `/events-codes/${args.eventCodeId}`, params: {} },
        client,
        () => client.delete(`/events-codes/${args.eventCodeId}`),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "bulk_create_event_codes",
    {
      title: "Crear múltiples códigos de evento (ESCRITURA)",
      description:
        "Crea N códigos de evento secuencialmente (POST /events-codes). Devuelve resumen de éxitos/errores. Requiere confirm: true.",
      inputSchema: {
        codes: z.array(z.object({
          code: z.string().min(1),
          name: z.string().min(1),
          title: z.string().optional(),
          description: z.string().optional(),
          dataType: z.string().optional(),
          eventsTypeId: z.string(),
          eventsFormatId: z.string(),
        })).min(1).describe("Array de códigos a crear"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const exec = {
        tool: "bulk_create_event_codes",
        method: "POST",
        path: `/events-codes (×${args.codes.length})`,
        params: { count: args.codes.length },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const created: Array<{ code: string; id?: string }> = [];
        const errors: Array<{ code: string; error: string }> = [];
        for (const c of args.codes) {
          try {
            const body = buildBody(c as unknown as Record<string, unknown>, {
              required: ["code", "name", "eventsTypeId", "eventsFormatId"],
              optional: ["title", "description", "dataType"],
            });
            const r = await client.post("/events-codes", body);
            created.push({ code: c.code, id: (r.data as Record<string, unknown>)?.id as string | undefined });
          } catch (e) {
            errors.push({ code: c.code, error: (e as Error).message });
          }
        }
        return {
          status: 200,
          data: { created, errors, summary: { total: args.codes.length, created: created.length, errors: errors.length } },
        };
      }).then(ok);
    },
  );

  server.registerTool(
    "find_duplicate_event_types",
    {
      title: "Detectar tipos de evento duplicados",
      description: "Busca tipos con el mismo name. Devuelve grupos duplicados con sus IDs y códigos.",
      inputSchema: z.object({
              truncate: z.number().int().min(1000).optional(),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const { data } = await client.get("/events-types", { limit: 200 });
      const types = Array.isArray(data) ? data as EventType[] : [];
      const byName = new Map<string, EventType[]>();
      for (const t of types) {
        const key = (t.name ?? "").trim().toUpperCase();
        if (!key) continue;
        const list = byName.get(key) ?? [];
        list.push(t);
        byName.set(key, list);
      }
      const duplicates = [...byName.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([name, entries]) => ({
          name,
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            title: e.title,
            codes: (e.eventsCodes ?? []).map((c) => c.code),
          })),
        }));
      return args.truncate
        ? okTruncated({ duplicates, total: duplicates.length }, args.truncate)
        : ok({ duplicates, total: duplicates.length });
    }),
  );

  server.registerTool(
    "find_duplicate_event_codes",
    {
      title: "Detectar códigos de evento duplicados",
      description: "Busca códigos duplicados dentro de un eventsFormatId.",
      inputSchema: z.object({
              eventsFormatId: z.string().describe("ID del formato a analizar"),
              truncate: z.number().int().min(1000).optional(),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const { data } = await client.get("/events-codes", { limit: 500, eventsFormatId: args.eventsFormatId });
      const codes = Array.isArray(data) ? data as EventCode[] : [];
      const byCode = new Map<string, EventCode[]>();
      for (const c of codes) {
        const key = (c.code ?? "").trim().toUpperCase();
        if (!key) continue;
        const list = byCode.get(key) ?? [];
        list.push(c);
        byCode.set(key, list);
      }
      const duplicates = [...byCode.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([code, entries]) => ({
          code,
          entries: entries.map((e) => ({ id: e.id, eventsTypeId: e.eventsTypeId })),
        }));
      return args.truncate
        ? okTruncated({ duplicates, total: duplicates.length }, args.truncate)
        : ok({ duplicates, total: duplicates.length });
    }),
  );

  server.registerTool(
    "validate_event_mapping",
    {
      title: "Validar integridad de mapeo de eventos",
      description: "Chequea: tipos sin códigos, códigos sin tipo, duplicados, códigos apuntando a _UNK.",
      inputSchema: z.object({
              eventsFormatId: z.string().describe("ID del formato a validar"),
              truncate: z.number().int().min(1000).optional(),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const [typesRes, codesRes] = await Promise.all([
        client.get("/events-types", { limit: 200 }),
        client.get("/events-codes", { limit: 500, eventsFormatId: args.eventsFormatId }),
      ]);
      const types = Array.isArray(typesRes.data) ? typesRes.data as EventType[] : [];
      const codes = Array.isArray(codesRes.data) ? codesRes.data as EventCode[] : [];

      const codeTypeIds = new Set(codes.map((c) => c.eventsTypeId).filter(Boolean));
      const orphanTypes = types
        .filter((t) => !codeTypeIds.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, title: t.title }));

      const typeIds = new Set(types.map((t) => t.id));
      const orphanCodes = codes
        .filter((c) => c.eventsTypeId && !typeIds.has(c.eventsTypeId))
        .map((c) => ({ id: c.id, code: c.code, eventsTypeId: c.eventsTypeId }));

      const unkCodes = codes
        .filter((c) => {
          const t = types.find((tt) => tt.id === c.eventsTypeId);
          return t && /unk/i.test(t.name);
        })
        .map((c) => ({ id: c.id, code: c.code, typeName: types.find((t) => t.id === c.eventsTypeId)?.name }));

      const result = { orphanTypes, orphanCodes, unkCodes, summary: { orphanTypes: orphanTypes.length, orphanCodes: orphanCodes.length, unkCodes: unkCodes.length } };
      return args.truncate ? okTruncated(result, args.truncate) : ok(result);
    }),
  );
}
