import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured, okTruncated, truncateSchema, selectFields, normalizeAccountNumber, buildBody, wrapReadOnly, forwardParams } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const ACCOUNT_FIELDS = [
  "accountNumber", "name", "description", "note", "address", "city", "state",
  "phone", "email", "latitude", "longitude", "serviceDate",
  "companyTechnicalId", "companyMonitoringId", "jurisdictionId",
] as const;

export function registerAccountTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "get_account",
    {
      title: "Obtener cuenta",
      description: "Devuelve una cuenta con sus zonas, contactos, usuarios e intervenciones.",
      inputSchema: z.object({
              id: z.string(),
              include: z.array(z.enum(["zones", "contacts", "users", "interventions", "devices"]))
                .optional()
                .describe("Secciones a incluir (default: todas)"),
              fields: z.array(z.string()).optional().describe("Campos a retornar (default: todos)"),
            }),
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const looksLikeAccountNumber = /^\d{1,10}$/.test(args.id);
      let id = args.id;
      if (looksLikeAccountNumber) {
        try {
          const res = await client.get("/accounts", { search: id, limit: 5 });
          const list = Array.isArray(res.data) ? res.data : (res.data as { data?: unknown[] } | null)?.data ?? [];
          const exact = list.find((a) => String((a as { accountNumber?: unknown }).accountNumber) === args.id);
          if (exact) id = (exact as { id: string }).id;
        } catch { /* fallthrough */ }
      }
      try {
        const res = await client.get(`/accounts/${id}`);
        if (res.status >= 400) {
          const detail = (res.data as { message?: unknown })?.message ?? JSON.stringify(res.data);
          if (looksLikeAccountNumber) {
            return err(
              `La cuenta "${args.id}" parece un NÚMERO de cuenta, no un ID interno ` +
                `(ej "xxxxxxxxxxxxxxx"). Buscala primero con list_accounts ` +
                `(search: "${args.id}") y usá el id resultante. Detalle: ${String(detail).slice(0, 200)}`,
            );
          }
          return err(`GET /accounts/${id} -> ${res.status}: ${String(detail).slice(0, 200)}`);
        }
        // Filtrar secciones si se pidió `include`
        const include = args.include as string[] | undefined;
        let data: unknown;
        if (include && Array.isArray(include) && include.length > 0) {
          const d = res.data as Record<string, unknown>;
          const SECTION_KEYS: Record<string, string[]> = {
            zones: ["accountZones", "zones"],
            contacts: ["accountContacts", "contacts"],
            users: ["accountUsers", "users"],
            interventions: ["interventions"],
            devices: ["devices"],
          };
          const filtered = { ...d };
          for (const [section, keys] of Object.entries(SECTION_KEYS)) {
            if (!include.includes(section)) {
              for (const k of keys) delete filtered[k];
            }
          }
          data = filtered;
        } else {
          data = res.data;
        }
        if (args.fields) data = selectFields(data as Record<string, unknown>, args.fields as string[]);
        return okStructured(data);
      } catch (e) {
        if (looksLikeAccountNumber) {
          return err(
            `La cuenta "${args.id}" parece un NÚMERO de cuenta, no un ID interno ` +
              `(ej "xxxxxxxxxxxxxxx"). Buscala primero con list_accounts ` +
              `(search: "${args.id}") y usá el id resultante. Detalle: ${(e as Error).message}`,
          );
        }
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "Listar cuentas",
      description: "Lista cuentas para ubicar un ID por nombre/código/número.",
      inputSchema: z.object({
              ...paginationSchema,
              search: z.string().optional().describe("Búsqueda libre (nombre/código)"),
              name: z.string().optional(),
              code: z.string().optional(),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["search", "name", "code"]) };
      const res = await client.get("/accounts", params);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    },
  );

  registerTool(
    server, role, "full", "update_account",
    {
      title: "Actualizar cuenta (ESCRITURA)",
      description:
        "PATCH /accounts/{id} (solo envía los provistos). Campos confirmados en el bundle. Requiere confirm: true.",
      inputSchema: {
        id: z.string(),
        ...Object.fromEntries(
          ACCOUNT_FIELDS.map((f) => [f, z.string().optional().nullish()]),
        ),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: ACCOUNT_FIELDS });
      return requireConfirm(
        args.confirm,
        { tool: "update_account", method: "PATCH", path: `/accounts/${args.id}`, params: body },
        client,
        () => client.patch(`/accounts/${args.id}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "add_account_note",
    {
      title: "Agregar nota a cuenta (ESCRITURA)",
      description:
        "POST /accounts/{id}/notes. type: bitacora (log), temporal (con rango de fechas) o fija. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        type: z.enum(["bitacora", "temporal", "fija"]).describe("Tipo de nota"),
        content: z.string().min(1),
        validFrom: z.string().optional().describe("ISO datetime, solo para tipo temporal"),
        validUntil: z.string().optional().describe("ISO datetime, solo para tipo temporal"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["type", "content"],
        optional: ["validFrom", "validUntil"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "add_account_note", method: "POST", path: `/accounts/${args.accountId}/notes`, params: body },
        client,
        () => client.post(`/accounts/${args.accountId}/notes`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_account_note",
    {
      title: "Actualizar nota de cuenta (ESCRITURA)",
      description: "PATCH /accounts/{id}/notes/{noteId}. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        noteId: z.string(),
        content: z.string().optional(),
        validFrom: z.string().optional(),
        validUntil: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: ["content", "validFrom", "validUntil"] });
      return requireConfirm(
        args.confirm,
        { tool: "update_account_note", method: "PATCH", path: `/accounts/${args.accountId}/notes/${args.noteId}`, params: body },
        client,
        () => client.patch(`/accounts/${args.accountId}/notes/${args.noteId}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_account_note",
    {
      title: "Eliminar nota de cuenta (ESCRITURA)",
      description: "DELETE /accounts/{id}/notes/{noteId}. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        noteId: z.string(),
        confirm: confirmSchema,
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_account_note", method: "DELETE", path: `/accounts/${args.accountId}/notes/${args.noteId}`, params: {} },
        client,
        () => client.delete(`/accounts/${args.accountId}/notes/${args.noteId}`),
      ).then(ok);
    },
  );

  server.registerTool(
    "list_account_devices",
    {
      title: "Listar dispositivos de cuenta",
      description: "Dispositivos de una cuenta.",
      inputSchema: z.object({
              id: z.string(),
              brandId: z.string().optional().describe("Filtrar por marca"),
              modelId: z.string().optional().describe("Filtrar por modelo"),
              status: z.string().optional().describe("Filtrar por estado"),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = {};
      if (args.brandId) params.brandId = args.brandId;
      if (args.modelId) params.modelId = args.modelId;
      if (args.status) params.status = args.status;
      const res = await client.get(`/accounts/${args.id}/devices`, Object.keys(params).length ? params : undefined);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  server.registerTool(
    "list_account_partitions",
    {
      title: "Listar particiones de cuenta",
      description: "Particiones de una cuenta.",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/accounts/${args.id}/partitions`);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  server.registerTool(
    "list_account_users",
    {
      title: "Listar usuarios de cuenta",
      description: "Usuarios de una cuenta.",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/account-users/account/${args.id}`);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  server.registerTool(
    "list_account_contacts",
    {
      title: "Listar contactos de cuenta",
      description: "Contactos de una cuenta.",
      inputSchema: z.object({
              accountId: z.string(),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const accountId = normalizeAccountNumber(args.accountId);
      const res = await client.get("/account-contacts", { accountId });
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  server.registerTool(
    "list_useful_contacts",
    {
      title: "Listar contactos útiles",
      description: "Contactos útiles (por jurisdicción opcional).",
      inputSchema: z.object({
              jurisdictionId: z.string().optional().describe("Filtra por jurisdicción si viene"),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const path = args.jurisdictionId
        ? `/useful-contacts/jurisdiction/${args.jurisdictionId}`
        : "/useful-contacts";
      const res = await client.get(path);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  server.registerTool(
    "list_account_zones",
    {
      title: "Listar zonas de cuenta",
      description: "Zonas de una cuenta.",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional().describe("Campos a retornar por objeto"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/zones/account/${args.id}`);
      let data = res.data;
      if (args.fields && Array.isArray(data)) {
        data = data.map((item) => selectFields(item as Record<string, unknown>, args.fields as string[]));
      }
      return okTruncated(data, args.truncate);
    }),
  );

  registerTool(
    server, role, "full", "add_account_contact",
    {
      title: "Agregar contacto a cuenta (ESCRITURA)",
      description: "POST /account-contacts. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().optional(),
        description: z.string().optional(),
        order: z.number().int().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const accountId = normalizeAccountNumber(args.accountId);
      const body = buildBody({ ...args, accountId } as Record<string, unknown>, {
        required: ["accountId", "name"],
        optional: ["phone", "email", "description", "order"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "add_account_contact", method: "POST", path: "/account-contacts", params: body },
        client,
        () => client.post("/account-contacts", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_account_contact",
    {
      title: "Actualizar contacto de cuenta (ESCRITURA)",
      description: "PATCH /account-contacts/{id}. Requiere confirm: true.",
      inputSchema: {
        contactId: z.string(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        description: z.string().optional(),
        order: z.number().int().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: ["name", "phone", "email", "description", "order"] });
      return requireConfirm(
        args.confirm,
        { tool: "update_account_contact", method: "PATCH", path: `/account-contacts/${args.contactId}`, params: body },
        client,
        () => client.patch(`/account-contacts/${args.contactId}`, body),
      ).then(ok);
    },
  );
}
