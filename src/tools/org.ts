import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, wrapReadOnly, forwardParams } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerOrgTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_companies",
    {
      title: "Listar empresas",
      description: "Lista empresas del sistema con búsqueda opcional.",
      inputSchema: {
        ...paginationSchema,
        search: z.string().optional().describe("Búsqueda libre (nombre/código)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["search"]) };
      const res = await client.get("/companies", params);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_company_technicians",
    {
      title: "Listar técnicos de empresa",
      description: "Técnicos de la empresa para asignar servicios.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/companies/${args.id}/technicians`);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_users",
    {
      title: "Listar usuarios",
      description: "Lista usuarios del sistema con búsqueda opcional.",
      inputSchema: {
        ...paginationSchema,
        search: z.string().optional().describe("Búsqueda libre (nombre/email)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["search"]) };
      const res = await client.get("/users", params);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_roles",
    {
      title: "Listar roles",
      description: "Lista de roles del sistema.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (_args) => {
      const res = await client.get("/roles");
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_my_profile",
    {
      title: "Obtener perfil propio",
      description: "Perfil del usuario logueado.",
      inputSchema: {},
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
      title: "Agregar días no laborales a técnico (ESCRITURA)",
      description:
        "POST /users/{id}/non-working-days/range. Marca días no laborales del técnico. Requiere confirm: true.",
      inputSchema: {
        userId: z.string(),
        from: z.string().describe("Fecha de inicio (YYYY-MM-DD)"),
        to: z.string().describe("Fecha de fin (YYYY-MM-DD)"),
        label: z.string().optional().describe("Etiqueta/razón opcional"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { from: args.from, to: args.to };
      if (args.label !== undefined) body.label = args.label;
      const path = `/users/${args.userId}/non-working-days/range`;
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
      title: "Agregar día no laboral a empresa (ESCRITURA)",
      description:
        "POST /companies/{id}/non-working-days. Marca un día no laboral de la empresa. Requiere confirm: true.",
      inputSchema: {
        companyId: z.string(),
        date: z.string().describe("Fecha (YYYY-MM-DD)"),
        label: z.string().optional().describe("Etiqueta/razón opcional"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { date: args.date };
      if (args.label !== undefined) body.label = args.label;
      const path = `/companies/${args.companyId}/non-working-days`;
      return requireConfirm(
        args.confirm,
        { tool: "add_company_non_working_day", method: "POST", path, params: body },
        client,
        () => client.post(path, body),
      ).then(ok);
    },
  );
}
