import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okTruncated, truncateSchema, selectFields, wrapReadOnly } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerConversationTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_conversations",
    {
      title: "Conversaciones del usuario",
      description: "Conversaciones del usuario.",
      inputSchema: {
        ...paginationSchema,
        truncate: truncateSchema,
        fields: z.array(z.string()).optional().describe("Campos a retornar"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/me/conversations", { page: args.page, limit: args.limit });
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "list_conversation_messages",
    {
      title: "Mensajes de conversación",
      description: "Mensajes de conversación.",
      inputSchema: {
        id: z.string(),
        ...paginationSchema,
        truncate: truncateSchema,
        fields: z.array(z.string()).optional().describe("Campos a retornar"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/conversations/${args.id}/messages`, {
        page: args.page,
        limit: args.limit,
      });
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  registerTool(
    server, role, "full", "send_conversation_message",
    {
      title: "Enviar mensaje (ESCRITURA)",
      description: "POST /conversations/{id}/messages. Requiere confirm: true.",
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
      title: "Estado de conversación (ESCRITURA)",
      description: "PATCH /conversations/{id}. Requiere confirm: true.",
      inputSchema: {
        conversationId: z.string(),
        status: z.string().describe("Nuevo estado (consultar catálogo si aplica)"),
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
      title: "Stats de conversaciones",
      description: "Stats de conversaciones.",
      inputSchema: {
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/me/conversations/stats");
      return okTruncated(res.data, args.truncate);
    }),
  );

  registerTool(
    server, role, "full", "conversation_mark_read",
    {
      title: "Marcar leída (ESCRITURA)",
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
