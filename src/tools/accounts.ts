import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured, okTruncated, truncateSchema, selectFields, normalizeAccountNumber, buildBody, wrapReadOnly, forwardParams, fieldsSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, runBatch, destructiveGuard } from "./writeHelpers.js";
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
        validFrom: z.iso.datetime({ offset: true }).optional().describe("ISO datetime, solo para tipo temporal"),
        validUntil: z.iso.datetime({ offset: true }).optional().describe("ISO datetime, solo para tipo temporal"),
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
    server, role, "full", "bulk_add_account_note",
    {
      title: "Agregar nota a varias cuentas (ESCRITURA MASIVA)",
      description:
        "POST /accounts/{id}/notes a cada cuenta de la lista con el mismo cuerpo. " +
        "Sin confirm muestra el preview; con confirm ejecuta los POST en lote.",
      inputSchema: {
        accountIds: z.array(z.string()).min(1).max(100).describe("IDs de las cuentas destino"),
        type: z.enum(["bitacora", "temporal", "fija"]).describe("Tipo de nota"),
        content: z.string().min(1),
        validFrom: z.iso.datetime({ offset: true }).optional().describe("ISO datetime, solo para tipo temporal"),
        validUntil: z.iso.datetime({ offset: true }).optional().describe("ISO datetime, solo para tipo temporal"),
        confirm: confirmSchema,
      },
    },
    async (args, ctx) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["type", "content"],
        optional: ["validFrom", "validUntil"],
      });
      const ids = [...new Set(args.accountIds)];
      const exec = {
        tool: "bulk_add_account_note",
        method: "POST",
        path: `/accounts/{id}/notes (${ids.length} cuentas)`,
        params: { accountIds: ids, ...body },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          ids.map((id) => ({ id, run: () => client.post(`/accounts/${id}/notes`, body) })),
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_add_account_note", exec, ctx.mcpReq.elicitInput)).then(ok);
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
    async (args, ctx) => {
      const exec = { tool: "delete_account_note", method: "DELETE", path: `/accounts/${args.accountId}/notes/${args.noteId}`, params: {} };
      return requireConfirm(
        args.confirm,
        exec,
        client,
        () => client.delete(`/accounts/${args.accountId}/notes/${args.noteId}`),
        destructiveGuard("delete_account_note", exec, ctx.mcpReq.elicitInput),
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
              fields: fieldsSchema,
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
      description:
        "POST /account-contacts. `order` = posición del contacto (menor = primero). " +
        "Si la posición está rodeada de orders contiguos, llamá antes reorder_account_contacts para dejar lugar. Requiere confirm: true.",
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
      description:
        "PATCH /account-contacts/{id}. `order` = posición/prioridad del contacto (menor = primero). " +
        "Para mover varios o insertar en una posición usá reorder_account_contacts, que correja el resto automáticamente. Requiere confirm: true.",
      inputSchema: {
        contactId: z.string(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        description: z.string().optional(),
        order: z.number().int().optional().describe("Posición del contacto (menor = primero)"),
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

  registerTool(
    server, role, "full", "reorder_account_contacts",
    {
      title: "Reordenar contactos de cuenta (ESCRITURA)",
      description:
        "Fija el orden final de TODOS los contactos de la cuenta según la secuencia pedida " +
        "(orderedContactIds[0] = posición 1). Espacia las posiciones de a 10 para dejar lugar a " +
        "inserciones futuras y corrige automáticamente a los demás contactos: solo hace PATCH de los que cambian. " +
        "Para insertar un contacto nuevo en la posición k: pasá la secuencia completa deseada acá " +
        "y después crealo con add_account_contact usando un order intermedio libre. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        orderedContactIds: z
          .array(z.string())
          .min(1)
          .max(200)
          .describe("IDs de contactos en el orden final deseado (índice 0 = posición 1). Debe incluir TODOS los contactos actuales."),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const accountId = normalizeAccountNumber(args.accountId);
      const listRes = await client.get("/account-contacts", { accountId });
      if (listRes.status >= 400) {
        return err(`GET /account-contacts -> ${listRes.status}: ${JSON.stringify(listRes.data).slice(0, 200)}`);
      }
      const contacts = (Array.isArray(listRes.data) ? listRes.data : (listRes.data as { data?: unknown[] })?.data ?? []) as Array<{ id?: string; name?: string; order?: number }>;
      const currentIds = contacts.filter((c) => c.id).map((c) => c.id as string);
      const byId = new Map(contacts.filter((c) => c.id).map((c) => [c.id as string, c]));

      const requested = args.orderedContactIds;
      const dupes = requested.filter((id, i) => requested.indexOf(id) !== i);
      if (dupes.length) return err(`IDs duplicados en orderedContactIds: ${dupes.join(", ")}`);
      const missing = currentIds.filter((id) => !requested.includes(id));
      if (missing.length) {
        return err(
          `Faltan contactos actuales en orderedContactIds: ${missing.join(", ")}. ` +
            "La secuencia debe incluir TODOS los contactos de la cuenta. Consultalos con list_account_contacts.",
        );
      }
      const extra = requested.filter((id) => !byId.has(id));
      if (extra.length) {
        return err(`IDs que no existen en la cuenta: ${extra.join(", ")}. Usá list_account_contacts para ver los válidos.`);
      }

      // Orden final espaciado ×10: deja gaps para insertar sin correr a nadie.
      const finals = new Map(requested.map((id, i) => [id, (i + 1) * 10]));
      const cambios = requested
        .map((id) => ({ contactId: id, name: byId.get(id)?.name, from: byId.get(id)?.order ?? null, to: finals.get(id)! }))
        .filter((c) => c.from !== c.to);

      // Simula la secuencia de PATCHs y detecta colisiones transitorias
      // (dos contactos con el mismo `order` al mismo tiempo). Si hay ciclo,
      // barre todo a valores temporales altos antes de fijar los finales.
      // ponytail: O(n²) por paso — n = contactos de una cuenta, sobra.
      const state = new Map(currentIds.map((id) => [id, byId.get(id)?.order ?? Number.MAX_SAFE_INTEGER]));
      const pending = new Set(cambios.map((c) => c.contactId));
      let needsTempSweep = false;
      while (pending.size > 0 && !needsTempSweep) {
        const ready = [...pending].filter((id) =>
          ![...pending].some((other) => other !== id && state.get(other) === finals.get(id)),
        );
        if (ready.length === 0) { needsTempSweep = true; break; }
        for (const id of ready) { state.set(id, finals.get(id)!); pending.delete(id); }
      }

      type Move = { contactId: string; order: number };
      const fases: Move[][] = [];
      if (needsTempSweep) {
        fases.push(cambios.map((c, i) => ({ contactId: c.contactId, order: 1_000_000 + i * 10 })));
      }
      fases.push(cambios.map((c) => ({ contactId: c.contactId, order: finals.get(c.contactId)! })));

      if (!args.confirm) {
        return ok({
          preview: true,
          mensaje: "Escritura NO ejecutada. Revisá el detalle y llamá de nuevo con `confirm: true` si querés ejecutarla.",
          accountId,
          ordenFinal: requested.map((id, i) => ({ posicion: i + 1, order: finals.get(id), contactId: id, name: byId.get(id)?.name })),
          cambios: cambios.length ? cambios : "nada que cambiar (ya está en ese orden)",
          ...(needsTempSweep ? { aviso: "Se necesita una pasada temporal para evitar orders duplicados durante el movimiento." } : {}),
          patchsAejecutar: fases.flat().length,
        });
      }

      const resultados: Array<{ contactId: string; ok: boolean; status?: number; error?: string }> = [];
      for (const fase of fases) {
        for (const move of fase) {
          const path = `/account-contacts/${move.contactId}`;
          try {
            const r = (await requireConfirm(
              true,
              { tool: "reorder_account_contacts", method: "PATCH", path, params: { order: move.order } },
              client,
              () => client.patch(path, { order: move.order }),
            )) as { ok?: boolean; status?: number };
            resultados.push({ contactId: move.contactId, ok: r.ok !== false, status: r.status });
          } catch (e) {
            resultados.push({ contactId: move.contactId, ok: false, error: (e as Error).message });
          }
        }
      }
      const fallidos = resultados.filter((r) => !r.ok);
      return ok({
        writeStatus: fallidos.length ? "partial_failure" : "applied",
        summary: { total: resultados.length, ok: resultados.length - fallidos.length, failed: fallidos.length },
        resultados,
        ...(fallidos.length ? { aviso: "Hubo fallos parciales: releé los contactos con list_account_contacts antes de reintentar." } : {}),
      });
    },
  );
}
