import type {
  McpServer,
  ToolCallback,
  ToolAnnotations,
  StandardSchemaWithJSON,
  ServerContext,
  CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { isDestructive } from "./writeHelpers.js";

// Rol del server (GAVRIEL_MCP_ROLE).
// readonly: solo lectura (+ get y audit_logs).
// lite: lectura + escrituras core marcadas "lite" en cada tool (tickets, actividades de ticket,
//       intervenciones, notas de cuenta, claim/release/mark_read de conversaciones).
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
    server.registerTool(name, withDefaultAnnotations(name, config as ToolConfigBase) as never, cb as never);
  }
}

// Defaults de annotations: este choke point registra casi solo escrituras.
// Lo declarado explícitamente en la tool siempre gana.
const IDEMPOTENT_NAME = /^(update_|set_|conversation_set_|conversation_mark_|mark_|reorder_|conversation_claim|conversation_release)/;

export function withDefaultAnnotations<C extends ToolConfigBase>(name: string, config: C): C {
  const a = config.annotations ?? {};
  if (a.destructiveHint === true && !isDestructive(name)) {
    throw new Error(`Tool "${name}" declara destructiveHint:true pero isDestructive() no la cubre (sin aprobación humana). Agregarla en writeHelpers.isDestructive.`);
  }
  const readOnly = a.readOnlyHint === true;
  return {
    ...config,
    annotations: {
      readOnlyHint: false,
      destructiveHint: !readOnly && isDestructive(name),
      idempotentHint: readOnly || IDEMPOTENT_NAME.test(name),
      openWorldHint: false,
      ...a,
    },
  };
}

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Rechaza argumentos desconocidos (un cliente con schemas viejos cacheados descartaba params nuevos en silencio).
// Acepta raw shape o z.object; cualquier otro schema pasa sin tocar.
export function strictInput(schema: unknown): unknown {
  let obj: z.ZodObject | undefined;
  if (schema instanceof z.ZodObject) obj = schema;
  else if (
    schema && typeof schema === "object" && !("~standard" in schema) &&
    Object.values(schema).every((v) => v instanceof z.ZodType)
  ) obj = z.object(schema as RawShape);
  if (!obj) return schema;
  const known = Object.keys(obj.shape);
  const error = (iss: { code: string; keys?: string[] }) => {
    if (iss.code !== "unrecognized_keys") return undefined;
    const parts = (iss.keys ?? []).map((k) => {
      const near = known.find((n) => lev(k.toLowerCase(), n.toLowerCase()) <= 2);
      return near ? `"${k}" (¿quisiste decir "${near}"?)` : `"${k}"`;
    });
    return `Argumentos desconocidos: ${parts.join(", ")}. Parámetros válidos: ${known.join(", ")}. Si recién reconstruiste el server, reiniciá la sesión del cliente MCP (schemas cacheados).`;
  };
  return obj.clone({ ...obj._zod.def, catchall: z.never(), error } as never);
}
