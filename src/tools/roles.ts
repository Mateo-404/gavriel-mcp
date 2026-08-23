import type {
  McpServer,
  ToolCallback,
  ToolAnnotations,
  StandardSchemaWithJSON,
  ServerContext,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type { z } from "zod";

// Rol del server (GAVRIEL_MCP_ROLE).
// readonly: solo lectura (+ get y audit_logs).
// lite: lectura + tools core de escritura (tickets, interventions, conversations).
// full: todas las tools.
export type Role = "readonly" | "lite" | "full";

const ROLE_RANK: Record<Role, number> = { readonly: 0, lite: 1, full: 2 };

export function hasRole(current: Role, min: Role): boolean {
  return ROLE_RANK[current] >= ROLE_RANK[min];
}

type RawShape = Record<string, z.ZodType>;

interface ToolConfigBase {
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

// Registra la tool solo si el rol activo alcanza el mínimo requerido.
// Es el choke point único por el que pasan las tools de escritura.
export function registerTool<
  InputArgs extends StandardSchemaWithJSON | undefined = undefined,
>(
  server: McpServer,
  role: Role,
  min: Role,
  name: string,
  config: ToolConfigBase & {
    inputSchema?: InputArgs;
    outputSchema?: StandardSchemaWithJSON;
  },
  cb: ToolCallback<InputArgs>,
): void;
export function registerTool<InputArgs extends RawShape>(
  server: McpServer,
  role: Role,
  min: Role,
  name: string,
  config: ToolConfigBase & {
    inputSchema?: InputArgs;
    outputSchema?: StandardSchemaWithJSON;
  },
  cb: (
    args: z.output<z.ZodObject<InputArgs>>,
    ctx: ServerContext,
  ) => CallToolResult | Promise<CallToolResult>,
): void;
export function registerTool(
  server: McpServer,
  role: Role,
  min: Role,
  name: string,
  // ponytail: firma interna loose para satisfacer ambos overloads
  config: unknown,
  cb: unknown,
): void {
  if (hasRole(role, min)) {
    server.registerTool(name, config as never, cb as never);
  }
}
