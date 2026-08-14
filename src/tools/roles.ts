import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

// Rol del server completo (GAVRIEL_MCP_ROLE), decidido por configuración.
// readonly: solo tools de lectura (+ `get` y `audit_logs`, que son GET).
// full: todas las tools (lectura + escritura). El gate `confirm` sigue
// vigente en todos los roles: rol = disponibilidad, confirm = aprobación.
export type Role = "readonly" | "full";

const ROLE_RANK: Record<Role, number> = { readonly: 0, full: 1 };

export function hasRole(current: Role, min: Role): boolean {
  return ROLE_RANK[current] >= ROLE_RANK[min];
}

// Registra la tool solo si el rol activo alcanza el mínimo requerido.
// Es el choke point único por el que pasan las tools de escritura.
// Misma firma genérica que server.registerTool para mantener la inferencia
// del tipo de `args` en el callback.
export function registerTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  server: McpServer,
  role: Role,
  min: Role,
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>,
): void {
  if (hasRole(role, min)) server.registerTool(name, config, cb);
}