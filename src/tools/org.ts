import type { GavrielClient } from "../gavrielClient.js";
import { ok, paginationSchema, okTruncated, truncateSchema, selectFields, wrapReadOnly, forwardParams, fieldsSchema, idSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const CACHE_TTL = 5 * 60_000;

export function registerOrgTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_companies",
    {
      title: "Listar empresas",
      description: "Usar cuando necesitás listar empresas (paginado, búsqueda por nombre/código). No usar para técnicos de una empresa (ver list_company_technicians).",
      inputSchema: z.object({
              ...paginationSchema,
              search: z.string().optional().describe("Búsqueda libre (nombre/código)"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["search"]) };
      const res = await client.get("/companies", params, { ttl: CACHE_TTL });
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "list_company_technicians",
    {
      title: "Listar técnicos de empresa",
      description: "Usar cuando necesitás los técnicos de una empresa por su ID (ver list_companies).",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/companies/${seg(args.id)}/technicians`);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "list_users",
    {
      title: "Listar usuarios",
      description: "Usar cuando necesitás el listado paginado de usuarios del sistema. No usar para ubicar uno por nombre/email con campos reducidos (ver search_users).",
      inputSchema: z.object({
              ...paginationSchema,
              search: z.string().optional().describe("Búsqueda libre (nombre/email)"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["search"]) };
      const res = await client.get("/users", params);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "list_roles",
    {
      title: "Listar roles",
      description: "Usar cuando necesitás los roles disponibles (p. ej. para asignar o filtrar usuarios).",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/roles", undefined, { ttl: CACHE_TTL });
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "get_my_profile",
    {
      title: "Obtener perfil propio",
      description: "Usar cuando necesitás saber quién es el usuario de la sesión (id, rol, permisos) antes de asignar o filtrar por él.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (_args) => {
      const res = await client.get("/auth/profile");
      return ok(res.data);
    }),
  );

  registerTool(
    server, role, "full", "add_technician_non_working_days",
    {
      title: "Agregar días no laborales a técnico",
      description:
        "POST /users/{id}/non-working-days/range. Marca días no laborales del técnico. Requiere confirm: true.",
      inputSchema: {
        userId: idSchema,
        from: z.iso.date().describe("Fecha de inicio (YYYY-MM-DD)"),
        to: z.iso.date().describe("Fecha de fin (YYYY-MM-DD)"),
        label: z.string().optional().describe("Etiqueta/razón opcional"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { from: args.from, to: args.to };
      if (args.label !== undefined) body.label = args.label;
      const path = `/users/${seg(args.userId)}/non-working-days/range`;
      return requireConfirm(
        args.confirm,
        { tool: "add_technician_non_working_days", method: "POST", path, params: body },
        client,
        () => client.post(path, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "add_company_non_working_day",
    {
      title: "Agregar día no laboral a empresa",
      description:
        "POST /companies/{id}/non-working-days. Marca un día no laboral de la empresa. Requiere confirm: true.",
      inputSchema: {
        companyId: idSchema,
        date: z.iso.date().describe("Fecha (YYYY-MM-DD)"),
        label: z.string().optional().describe("Etiqueta/razón opcional"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { date: args.date };
      if (args.label !== undefined) body.label = args.label;
      const path = `/companies/${seg(args.companyId)}/non-working-days`;
      return requireConfirm(
        args.confirm,
        { tool: "add_company_non_working_day", method: "POST", path, params: body },
        client,
        () => client.post(path, body),
      ).then(ok);
    },
  );
}
