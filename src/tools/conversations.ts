import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerConversationTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_conversations",
    {
      title: "Listar conversaciones (helpdesk)",
      description: "GET /me/conversations del usuario logueado.",
      inputSchema: { ...paginationSchema },
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const res = await client.get("/me/conversations", { page: args.page, limit: args.limit });
        return okStructured(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_conversation_messages",
    {
      title: "Listar mensajes de una conversación",
      description: "GET /conversations/{id}/messages.",
      inputSchema: { id: z.string(), ...paginationSchema },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const res = await client.get(`/conversations/${args.id}/messages`, {
          page: args.page,
          limit: args.limit,
        });
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  registerTool(
    server, role, "full", "send_conversation_message",
    {
      title: "Enviar mensaje en conversación (ESCRITURA)",
      description:
        "POST /conversations/{id}/messages con { body, messageType: \"text\" }. Requiere confirm: true.",
      inputSchema: {
        conversationId: z.string(),
        body: z.string().min(1).describe("Contenido del mensaje"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = { body: args.body, messageType: "text" };
      return requireConfirm(
        args.confirm,
        { tool: "send_conversation_message", method: "POST", path: `/conversations/${args.conversationId}/messages`, params: body },
        client,
        () => client.post(`/conversations/${args.conversationId}/messages`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "conversation_claim",
    {
      title: "Tomar conversación (ESCRITURA)",
      description: "POST /conversations/{id}/claim. Requiere confirm: true.",
      inputSchema: { conversationId: z.string(), confirm: confirmSchema },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "conversation_claim", method: "POST", path: `/conversations/${args.conversationId}/claim`, params: {} },
        client,
        () => client.post(`/conversations/${args.conversationId}/claim`),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "conversation_release",
    {
      title: "Liberar conversación (ESCRITURA)",
      description: "POST /conversations/{id}/release. Requiere confirm: true.",
      inputSchema: { conversationId: z.string(), confirm: confirmSchema },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "conversation_release", method: "POST", path: `/conversations/${args.conversationId}/release`, params: {} },
        client,
        () => client.post(`/conversations/${args.conversationId}/release`),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "conversation_set_status",
    {
      title: "Cambiar estado de conversación (ESCRITURA)",
      description: "PATCH /conversations/{id} con { status }. Requiere confirm: true.",
      inputSchema: {
        conversationId: z.string(),
        status: z.string().describe("Nuevo estado (consultar catálogo de conversaciones si aplica)"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = { status: args.status };
      return requireConfirm(
        args.confirm,
        { tool: "conversation_set_status", method: "PATCH", path: `/conversations/${args.conversationId}`, params: body },
        client,
        () => client.patch(`/conversations/${args.conversationId}`, body),
      ).then(ok);
    },
  );

  server.registerTool(
    "get_conversation_stats",
    {
      title: "Estadísticas de conversaciones",
      description: "GET /me/conversations/stats del usuario logueado.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const res = await client.get("/me/conversations/stats");
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  registerTool(
    server, role, "full", "conversation_mark_read",
    {
      title: "Marcar conversación como leída (ESCRITURA)",
      description: "POST /conversations/{id}/read. Requiere confirm: true.",
      inputSchema: { conversationId: z.string(), confirm: confirmSchema },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "conversation_mark_read", method: "POST", path: `/conversations/${args.conversationId}/read`, params: {} },
        client,
        () => client.post(`/conversations/${args.conversationId}/read`, {}),
      ).then(ok);
    },
  );
}
