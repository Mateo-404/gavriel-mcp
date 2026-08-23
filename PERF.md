# PERF.md — ledger de optimización

Mediciones y decisiones de la auditoría de optimización del MCP de Gavriel.
Cada intento registra: baseline, cambio, resultado y verdict.

## Métricas clave

- **Listing de tools** (name + title + description): una vez por sesión.
  - Hoy: **98 tools** (full). El peso real está en el `inputSchema` (name +
    title + description + describe de cada parámetro), no en el title.
  - `inputSchema` total (medido con InMemoryTransport + `listTools`):
    **44.6 KB ≈ 11.2k tok** en full. Recortar los `describe` compartidos en
    `shared.ts` bajó ~224 tok (~2%) sin perder info (ver I1). El resto del
    peso son los nombres de campo y describes específicos por tool; optimizar
    más allí roza perder hints operativos.
- **Payloads de respuesta**: el costo real por llamada (5.000–20.000+ tok).
  No se traduce la UI: convertir descripciones a inglés habría ahorrado
  ~800–1.200 tok una sola vez por sesión, marginal vs. el payload por tool call.

## Intentos — keep

| # | Cambio | Resultado | Verdict |
|---|--------|-----------|---------|
| A1 | `ok()` compacto (`JSON.stringify` sin indentar 2) | Menos tok por respuesta en TODAS las tools | keep |
| A2 | `okStructured()`: texto corto (`_resumen`) + `structuredContent` con el dato completo | El texto no duplica el payload; el modelo consume lo que necesita y el tool call es reducible por el cliente | keep (SDK exige `structuredContent` si hay `outputSchema`) |
| A3 | `okTruncated()` con marca `RESPUESTA TRUNCADA` + param `truncate` en list_accounts, audit_logs, list_bridge_logs, get | Listados enormes ya no saturan el contexto | keep |
| B1 | `readOnlyHint` en 38 tools de lectura | El cliente puede sugerir "no modificar la sesión"; costo ~0 | keep |
| B2 | `destructiveHint` (close_ticket, delete_account_note, close_intervention) | Refuerza el gate de confirm | keep |
| B3 | `idempotentHint` (mark_events_processed, conversation_claim/release/mark_read, mark_activity_read/unread) | El cliente puede reintentar sin duplicar | keep |
| C1 | Versión del server leída de package.json (fuente única) | Elimina desincronización "1.0.0" vs "1.1.0" | keep |
| D1 | `perf.log` en `~/.local/share/gavriel-mcp/` con latencia real por endpoint | Permite decidir con datos (p. ej. cuáles endpoints merecen truncate por defecto) | keep |
| E1 | Bulk de eventos: no confirmado contra el bundle → NO se inventa endpoint; `mark_events_processed` queda N×PATCH serial (ponytail note) | Evita adivinar payload (regla AGENTS 4) | keep (documentado en TIER3_PENDIENTE.md) |
| F1 | `outputSchema` + structured en `get_account` y `list_events` (las que devuelven `okStructured`) | Habilita que el cliente reduzca el tool result; el texto es un resumen, no un espejo. NOTA: `list_tickets`/`get_ticket` NO tienen `outputSchema` porque devuelven `ok()`/`okTruncated()` (texto puro sin `structuredContent`) — un `outputSchema` sin `structuredContent` rompe la tool (bug C-1, ya corregido) | keep |
| G1 | Test e2e de roles via `listTools` (InMemoryTransport): readonly sin las de escritura, full con todas | Verifica el feature de roles sin red | keep |
| H1 | Recorte terso de descripciones top | -407 chars (-8%) manteniendo hints | keep (parcial; a partir de acá es DIY decreciente) |
| I1 | Centralizar `fields`/`pagination`/`truncate` describes en `shared.ts` (una sola vez, repetido en ~20 tools) | Medido con InMemoryTransport: 98 tools, inputSchema **44.6 KB ≈ 11.2k tok** vs 45.5 KB baseline (describes largos) → **~224 tok (~2%) menos** por listing, sin perder info | keep |
| J1 | `outputSchema` removido de `list_tickets`/`get_ticket` (C-1) | Sin `structuredContent` el `outputSchema` las dejaba rotas; ahora devuelven texto correcto | keep (bugfix) |

## Intentos — revert (no cuestan)

| # | Cambio | Motivo del revert |
|---|--------|-------------------|
| — | Apilar librerías de minimización/compresión de salida | stdout es JSON-RPC; comprimir texto de tools agrega complejidad y el modelo puede resumir solo. YAGNI |

## Instrumentación

- Listing: `node scripts/measure-listing.mjs` no existe (medición ad-hoc con
  `buildServer` + `listTools` in-memory; reproducir con 15 líneas de node).
- Latencia real: `~/.local/share/gavriel-mcp/perf.log` (JSONL, línea por
  request: timestamp, method, path, status, ms).

## Pendiente / acotado

- El backend es lento en listados (events/audit). Si perf.log muestra que
  list_events > 30s en promedio, subir el `truncate` default ahí.
- No se instrumenta el código fuente del frontend (no presente en este
  entorno) para documar el bulk de eventos; traspasar cuando se acceda al
  bundle.