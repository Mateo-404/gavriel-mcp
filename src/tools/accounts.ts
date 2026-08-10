import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";

const ACCOUNT_FIELDS = [
  "accountNumber", "name", "description", "note", "address", "city", "state",
  "phone", "email", "latitude", "longitude", "serviceDate",
  "companyTechnicalId", "companyMonitoringId", "jurisdictionId",
] as const;

export function registerAccountTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "get_account",
    {
      title: "Obtener cuenta",
      description: "Devuelve una cuenta con sus zonas, contactos, usuarios e intervenciones.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      const looksLikeAccountNumber = /^\d{1,10}$/.test(args.id);
      let id = args.id;
      if (looksLikeAccountNumber) {
        try {
          // El ID interno es del estilo "xxxxxxxxxxxxxxx"; un número corto
          // es un número de cuenta. Resolverlo por búsqueda antes de fallar.
          const res = await client.get("/accounts", { search: id, limit: 5 });
          const list = Array.isArray(res.data) ? res.data : (res.data as { data?: unknown[] } | null)?.data ?? [];
          const exact = list.find((a) => String((a as { accountNumber?: unknown }).accountNumber) === args.id);
          if (exact) id = (exact as { id: string }).id;
        } catch {
          // búsqueda falla o es lenta: seguir con el id numérico, el error de
          // abajo lo explica.
        }
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
        return ok(res.data);
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
      inputSchema: {
        ...paginationSchema,
        search: z.string().optional().describe("Búsqueda libre (nombre/código)"),
        name: z.string().optional(),
        code: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const params: Record<string, unknown> = { page: args.page, limit: args.limit };
        for (const k of ["search", "name", "code"] as const) {
          const v = (args as Record<string, unknown>)[k];
          if (v !== undefined) params[k] = v;
        }
        const res = await client.get("/accounts", params);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_account",
    {
      title: "Actualizar cuenta (ESCRITURA)",
      description:
        "PATCH /accounts/{id} con los campos a modificar (solo envía los provistos). Campos de cuenta confirmados en el bundle. Requiere confirm: true.",
      inputSchema: {
        id: z.string(),
        ...Object.fromEntries(
          ACCOUNT_FIELDS.map((f) => [f, z.string().optional().nullish()]),
        ),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = {};
      for (const f of ACCOUNT_FIELDS) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined && v !== null) body[f] = v;
      }
      return requireConfirm(
        args.confirm,
        { tool: "update_account", method: "PATCH", path: `/accounts/${args.id}`, params: body },
        client,
        () => client.patch(`/accounts/${args.id}`, body),
      ).then(ok);
    },
  );

  server.registerTool(
    "add_account_note",
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
      const body: Record<string, unknown> = { type: args.type, content: args.content };
      if (args.validFrom) body.validFrom = args.validFrom;
      if (args.validUntil) body.validUntil = args.validUntil;
      return requireConfirm(
        args.confirm,
        { tool: "add_account_note", method: "POST", path: `/accounts/${args.accountId}/notes`, params: body },
        client,
        () => client.post(`/accounts/${args.accountId}/notes`, body),
      ).then(ok);
    },
  );

  server.registerTool(
    "update_account_note",
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
      const body: Record<string, unknown> = {};
      for (const f of ["content", "validFrom", "validUntil"] as const) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined) body[f] = v;
      }
      return requireConfirm(
        args.confirm,
        { tool: "update_account_note", method: "PATCH", path: `/accounts/${args.accountId}/notes/${args.noteId}`, params: body },
        client,
        () => client.patch(`/accounts/${args.accountId}/notes/${args.noteId}`, body),
      ).then(ok);
    },
  );

  server.registerTool(
    "delete_account_note",
    {
      title: "Eliminar nota de cuenta (ESCRITURA)",
      description: "DELETE /accounts/{id}/notes/{noteId}. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        noteId: z.string(),
        confirm: confirmSchema,
      },
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
      description: "GET /accounts/{id}/devices.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      try {
        const res = await client.get(`/accounts/${args.id}/devices`);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_account_partitions",
    {
      title: "Listar particiones de cuenta",
      description: "GET /accounts/{id}/partitions.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      try {
        const res = await client.get(`/accounts/${args.id}/partitions`);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_account_users",
    {
      title: "Listar usuarios de cuenta",
      description: "GET /account-users/account/{id}.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      try {
        const res = await client.get(`/account-users/account/${args.id}`);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_account_contacts",
    {
      title: "Listar contactos de cuenta",
      description: "GET /account-contacts con query { accountId }.",
      inputSchema: { accountId: z.string() },
    },
    async (args) => {
      try {
        const res = await client.get("/account-contacts", { accountId: args.accountId });
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_useful_contacts",
    {
      title: "Listar contactos útiles",
      description:
        "GET /useful-contacts, o /useful-contacts/jurisdiction/{jurisdictionId} si se pasa jurisdictionId.",
      inputSchema: {
        jurisdictionId: z.string().optional().describe("Filtra por jurisdicción si viene"),
      },
    },
    async (args) => {
      try {
        const path = args.jurisdictionId
          ? `/useful-contacts/jurisdiction/${args.jurisdictionId}`
          : "/useful-contacts";
        const res = await client.get(path);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_account_zones",
    {
      title: "Listar zonas de cuenta",
      description: "GET /zones/account/{id}.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      try {
        const res = await client.get(`/zones/account/${args.id}`);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "add_account_contact",
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
      const body: Record<string, unknown> = { accountId: args.accountId, name: args.name };
      for (const f of ["phone", "email", "description", "order"] as const) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined) body[f] = v;
      }
      return requireConfirm(
        args.confirm,
        { tool: "add_account_contact", method: "POST", path: "/account-contacts", params: body },
        client,
        () => client.post("/account-contacts", body),
      ).then(ok);
    },
  );

  server.registerTool(
    "update_account_contact",
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
      const body: Record<string, unknown> = {};
      for (const f of ["name", "phone", "email", "description", "order"] as const) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined) body[f] = v;
      }
      return requireConfirm(
        args.confirm,
        { tool: "update_account_contact", method: "PATCH", path: `/account-contacts/${args.contactId}`, params: body },
        client,
        () => client.patch(`/account-contacts/${args.contactId}`, body),
      ).then(ok);
    },
  );
}
