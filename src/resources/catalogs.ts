import type { GavrielClient } from "../gavrielClient.js";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Role } from "../tools/roles.js";

const TTL_MS = 60 * 60 * 1000; // 1h

const CATALOGS = [
  { path: "/events-types", name: "Tipos de evento" },
  { path: "/events-codes", name: "Códigos de evento" },
  { path: "/events-formats", name: "Formatos de evento" },
  { path: "/protocols", name: "Protocolos" },
  { path: "/intervention-categories", name: "Categorías de intervención" },
  { path: "/device-brands", name: "Marcas de dispositivos" },
  { path: "/device-brands/active", name: "Marcas activas de dispositivos" },
  { path: "/device-models", name: "Modelos de dispositivos" },
  { path: "/device-connection-types", name: "Tipos de conexión de dispositivo" },
  { path: "/device-connection-types/active", name: "Tipos de conexión activos" },
  { path: "/device-taxonomies", name: "Taxonomías de dispositivo" },
  { path: "/states", name: "Provincias / estados" },
  { path: "/cities", name: "Ciudades" },
  { path: "/jurisdictions", name: "Jurisdicciones" },
  { path: "/zones", name: "Zonas" },
  { path: "/tickets/status-options", name: "Opciones de estado de ticket" },
  { path: "/tickets/priority-options", name: "Opciones de prioridad de ticket" },
  { path: "/ticket-categories", name: "Categorías de ticket" },
  { path: "/activities/type-options", name: "Tipos de actividad" },
  { path: "/events-types/gavriel-intervention", name: "Tipos de evento de intervención Gavriel" },
  { path: "/companies/type/technical", name: "Empresas técnicas" },
] as const;

// ponytail: cache global por path con TTL 1h; si hiciera falta invalidación por evento,
// se agrega un Map de versiones o se baja el TTL — hoy alcanza para catálogos semi-estáticos.
const cache = new Map<string, { expiresAt: number; data: unknown }>();

function compactEventsTypes(data: unknown): unknown {
  const items = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data ?? [];
  return items.map((t: Record<string, unknown>) => ({
    id: t.id,
    name: t.name,
    title: t.title,
    eventCount: Array.isArray(t.eventsCodes) ? t.eventsCodes.length : 0,
  }));
}

export function registerCatalogResources(server: McpServer, client: GavrielClient, _role: Role): void {
  for (const { path, name } of CATALOGS) {
    const uri = `gavriel://catalog${path}`;
    const isEventsTypes = path === "/events-types";

    server.registerResource(
      name,
      uri,
      {
        description: isEventsTypes
          ? `Catálogo ${name} de Gavriel (compacto: id/name/title/eventCount). Cacheado 1 hora.`
          : `Catálogo ${name} de Gavriel (GET ${path}). Cacheado 1 hora.`,
        mimeType: "application/json",
      },
      async () => {
        const now = Date.now();
        const hit = cache.get(path);
        if (hit && hit.expiresAt > now) {
          return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(hit.data) }] };
        }
        try {
          const { data } = await client.get(path, { limit: 200 });
          const compacted = isEventsTypes ? compactEventsTypes(data) : data;
          cache.set(path, { expiresAt: now + TTL_MS, data: compacted });
          return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(compacted) }] };
        } catch (e) {
          const errorData = { error: (e as Error).message, path };
          return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(errorData) }] };
        }
      },
    );
  }
}
