# INFORME — Auditoría y mejora de gavriel-mcp (2026-08)

Servidor MCP local que expone la API REST de Gavriel como tools para agentes.
Objetivo de la tanda: migrar a las últimas versiones de todas las dependencias,
corregir los bugs de auditoría (C-1/C-2/C-3), sumar la tool de reordenamiento
de contactos, optimizar cliente/tokens/manejo de errores, capa de permisos con
elicitation para destructivas, batch tools y regenerar docs.

## Estado final

- `pnpm typecheck` ✅ · `pnpm build` ✅ · `pnpm selfcheck` ✅ **38 checks**
- 11 commits convencionales (migración + 8 de mejoras + 2 docs/chore).

## 1. Migración a SDK v2 (commit `bc42980`)

| Dependencia | Antes | Después |
|---|---|---|
| `@modelcontextprotocol/server` | `sdk` v1 | `^2.0.0` (spec 2026-07-28) |
| `@modelcontextprotocol/client` | — | `^2.0.0` |
| `zod` | v3 | `^4.4.3` |
| `typescript` | v5 | `^7.0.2` (compilador nativo) |
| `@types/node` | v22 | `^26.2.0` |
| `tsx` | — | `^4.23.12` (devDep) |

Detalles clave aplicados:
- Codemod oficial `v1-to-v2`. `tsconfig.json` con `"types": ["node"]` (TS ≥6 lo exige).
- `roles.ts` reescrito con los dos overloads de `registerTool` v2 (Standard
  Schema moderno + raw shape legacy) preservando la inferencia de `args`.
- Margen de error del codemod (4 `z.object({}).passthrough()` falsos positivos)
  limpiado.
- `pnpm` 11: la clave de build es `allowBuilds` en `pnpm-workspace.yaml`
  (`allowBuilds: { esbuild: true }`); `onlyBuiltDependencies` ya no se lee.

## 2. Bugs de auditoría (commit `b22abb4`)

- **C-2** (`writeHelpers.summarize`): lanzaba al parsear un slice truncado de
  JSON sobre respuestas >1000 chars. Ahora devuelve `{ _truncatedPreview,
  totalLength }` sin parsear. Corregía falsos negativos en escrituras OK.
- **C-3** (`config.ts`): el rol `lite` era inalcanzable (enum no lo incluía).
  Ahora `GAVRIEL_MCP_ROLE: readonly|lite|full`. Sumé además:
  - `GAVRIEL_MCP_WRITE_CONCURRENCY` (1–20, default 5)
  - `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL` (`off`|`elicitation`, default `off`)
- **C-1** (`tickets.ts`): `list_tickets`/`get_ticket` declaraban `outputSchema`
  pero devolvían solo texto sin `structuredContent` → tools rotas. Se removió
  el `outputSchema` (quien sí usa `okStructured` — `get_account`,
  `list_events` — lo conserva).

## 3. Tool `reorder_account_contacts` (commit `b22abb4`)

Estrategia decidida:
- Orden final espaciado ×10 (`(i+1)*10`) para dejar gaps a inserciones futuras.
- Valida duplicados/faltantes/extras contra `GET /account-contacts?accountId=`.
- Simula colisiones transitorias O(n²); si detecta ciclo, barre a valores
  temporales (`1_000_000 + i*10`) antes de fijar los finales.
- Preview sin `confirm`; ejecución secuencial vía `requireConfirm` por PATCH,
  salida `{ writeStatus, summary, resultados }`. Solo PATCHea los que cambian.
- `add_account_contact`/`update_account_contact` documentan la receta de
  inserción con la nueva tool.

## 4. Cliente HTTP (commit `4e92970`)

- **Semáforo de escritura** configurable (`GAVRIEL_MCP_WRITE_CONCURRENCY`,
  default 5) + **cola FIFO por prefijo** solo para recursos con unique
  constraints (`/account-contacts`, el `order`). Las lecturas quedan
  concurrentes sin límite.
- **Retry solo en GET** (429/5xx con backoff). Una escritura reintentada tras
  un 5xx puede duplicarse si el backend la aplicó antes de fallar.
- **Anti-tormenta de login**: tras login exitoso, un `401` en los próximos 15 s
  lanza error claro en vez de re-loginear en loop (evita bloqueo de cuenta).
- **`expiresAt`**: el header `x-token-expires-at` ya no es pisado por
  `decodeExp` del JWT en `login()`.

Selfcheck extendido a 38 checks: serialización por recurso, semáforo, guard
anti-tormenta, etc.

## 5. Robustez de tools (commit `b1780bb`)

- `ensureOk()` en `shared.ts`: los getters de detalle convierten 4xx/5xx del
  backend en error explícito en vez de devolver el body de error como si fuera
  `data` (los dashboards compuestos lo usan: un 404 de cuenta/ticket/evento ya
  no produce `{id: undefined}` silencioso).
- `get_monitoring_events_chart` ahora captura errores de red (antes un throw
  se escapaba sin manejo).
- **Catálogos single-flight**: lecturas concurrentes del mismo catálogo frío
  comparten un único GET (antes: stampede de N fetches idénticos).
- **Validación de fechas** con zod4 (`z.iso.date` / `z.iso.datetime`): agenda,
  días no laborales, `scheduledDate`, `validFrom/Until`, `dateFrom/dateTo` de
  `list_events`, `readAt`.

## 6. Batch tools (commit `a26f620`)

- `bulk_mark_events_by_filter`: resuelve el filtro (cuenta obligatoria) y
  muestra los IDs exactos en el preview antes de confirmar; luego PATCH por
  evento al estado elegido.
- `bulk_add_account_note`: misma nota a hasta 100 cuentas, con dedupe de IDs.
- `runBatch()` en `writeHelpers`: ejecuta N ops en paralelo (la concurrencia
  la limita el semáforo del cliente); un fallo por ítem no corta el lote.
  Salida unificada `{ summary:{total,ok,failed}, results:[{id,ok,status?,error?}] }`.

## 7. Seguridad (commit `453e401`)

- **Aprobación destructiva vía elicitation**: con
  `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL=elicitation`, `delete_account_note`,
  `bulk_mark_events_by_filter` y `bulk_add_account_note` piden aprobación
  humana (form booleano `aprobar`) además del `confirm`. Sin soporte o
  rechazo → no ejecuta (falla cerrado). Nota: `ctx.mcpReq.elicitInput` está
  deprecado en spec 2026-07-28 (usa `inputRequired`), pero sigue funcional en
  clientes 2025-era (los que hay hoy).
- **Keyring email-scoped**: el `trusted_device_token` se guarda con clave por
  email (`trusted_device_token:email`); lookup cae a la clave vieja sin email
  (migración). Dos cuentas no se pisan el token.
- **chmod 600** en el archivo legacy de tokens + best-effort en el existente.

## 8. Tokens (commit `77efd95`)

- `fields`/`pagination`/`truncate` centralizados en `shared.ts` (se repetían en
  ~20 tools). Medición offline (InMemoryTransport): 98 tools, `inputSchema`
  **44.6 KB ≈ 11.2k tok** vs 45.5 KB baseline → **~224 tok (~2%) menos** por
  listing, sin perder info. El resto del peso son nombres de campo y describes
  específicos; optimizar más allí roza perder hints operativos.

## 9. Cleanup (commit `6d6cd5a`)

- `tsconfig.json`: `noUnusedLocals` + `noUnusedParameters` (encontró imports
  muertos reales).
- Imports muertos (`ok`/`err`/`wrapReadOnly`/`okStructured` sin usar)
  limpiados en todos los tools; `requireFilters` renombra `toolHint`→`_toolHint`.
- Whitelist de `get` completa (agregado `/interventions`).

## 10. Docs (commit `729cfc1`)

- `AGENTS.md`: modelo de concurrencia nuevo, env vars, payload
  `reorder_account_contacts`, nota SDK v2.
- `PERF.md`: métricas `inputSchema` (98 tools / 44.6 KB / 11.2k tok),
  entradas I1/J1, F1 corregido.
- `README.md`: tabla de config con los 2 nuevos env vars y rol `lite`.

## Notas / decisiones conscientes

- **Paginación en listas por-recurso** (`/activities/ticket/{id}`,
  `/interventions/account/{id}`, dispositivos/zonas de cuenta): **no se
  agregó**. Esos endpoints son por recurso y no aceptan `page/limit` del
  backend; agregarlos sería flexibilidad falsa.
- **Reescritura en Rust**: descartada. El cuello es latencia de backend/red,
  no el runtime; se optimizó en TS (concurrencia, single-flight, trimming).
- **`ctx.mcpReq.elicitInput` deprecado**: funciona hoy (clientes 2025-era) y
  falla cerrado en 2026-07-28; migrar a `inputRequired` cuando el ecosistema
  lo adopte.

## Cómo verificar

```
pnpm typecheck && pnpm build && pnpm selfcheck   # 38 checks en verde
```

No se ejecutó `regression` (requiere credenciales y red a `app.gavriel.com.ar`,
no toca producción). Ningún commit se pusheó ( policy: local-only salvo pedido).
