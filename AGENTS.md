# Gavriel MCP — contexto para agentes (OpenCode / Claude)

## Qué es

Servidor MCP que expone la API REST de **Gavriel** (monitoreo de alarmas de
Marinozzi Sistemas de Seguridad) como tools para agentes. La API base es
`https://app.gavriel.com.ar/api` y el server hace login con
`GAVRIEL_EMAIL`/`GAVRIEL_PASSWORD` (leídas de `.env` o variables de entorno).

Datos de producción: **+170.000 tickets**. Siempre acotá las consultas de
lectura con filtros y/o `limit` bajo (default 25, tope 200).

## Convención de `confirm` (CRÍTICA — no se pierde con la compactación)

Toda tool de **escritura** recibe un parámetro `confirm: boolean`:

- `confirm` **ausente o `false`** → la tool NO ejecuta nada. Devuelve un
  preview (método, path, body) para mostrar al usuario y pedir confirmación.
- `confirm: true` → ejecuta la llamada real contra datos de producción.

Reglas:
1. **Nunca** llamar una tool de escritura con `confirm: true` sin mostrar el
   preview antes y sin que el usuario confirme explícitamente.
2. Si el usuario solo pidió "información", "preview", "qué haría", etc.,
   llamar **sin** `confirm` (o con `false`) y reportar el preview.
3. Las tools de lectura no tienen `confirm` y son seguras.
4. Cada escritura ejecutada se loguea en
   `~/.local/share/gavriel-mcp/writes.log` (JSONL). Ese log es local y
   adicional al audit log propio de Gavriel.

## Herramientas

Los nombres MCP no llevan prefijo (`create_ticket`, `list_tickets`…). En las
sesiones de opencode se exponen antepuestos con el nombre del server
(`gavriel_`): `create_ticket` → `gavriel_create_ticket`.

Lectura: `list_tickets`, `get_ticket`, `ticket_stats`,
`get_open_technical_tickets_count`, `list_events`,
`list_accounts_pending_events`, `get_monitoring_events_chart`,
`get_account`, `list_accounts`, `list_account_devices`,
`list_account_partitions`, `list_account_zones`, `list_account_users`,
`list_account_contacts`, `list_useful_contacts`,
`list_interventions`, `list_activities_by_ticket`, `get_activity_stats`,
`list_conversations`, `list_conversation_messages`, `get_conversation_stats`,
`list_connections`, `get_connection_report`, `list_bridge_logs`,
`get_bridge_disk_space`, `get_service_panel`, `get_service_panel_summary`,
`get_service`, `list_technician_agenda`, `get_technician_locations`,
`list_companies`, `list_company_technicians`, `list_users`, `list_roles`,
`get_my_profile`, `audit_logs`, `health`,
`get` (GET libre con whitelist).

Escritura (requieren `confirm`): `create_intervention`,
`create_bulk_interventions`, `close_intervention`,
`set_intervention_observation`, `create_ticket`,
`update_ticket`, `close_ticket`, `add_ticket_activity`,
`mark_events_processed`, `update_account`,
`add_account_note`, `update_account_note`,
`delete_account_note`, `send_conversation_message`,
`conversation_claim`, `conversation_release`,
`conversation_set_status`, `conversation_mark_read`,
`mark_activity_read`, `mark_activity_unread`, `update_activity`,
`add_account_contact`, `update_account_contact`,
`schedule_service`, `update_service`,
`add_technician_non_working_days`, `add_company_non_working_day`.

Catálogos (resources, cache 1 h): `gavriel://catalog/...` (estados/prioridades
de ticket, categorías, tipos de evento, protocolos, marcas, etc.). Para
resolver valores válidos de `status`/`priority`/`categoryId` en los flujos de
escritura, consultar estos catálogos antes.

## Payloads de escritura confirmados contra el bundle del frontend

Estos son los shapes reales que arma el frontend (no inventados):

- Crear intervención: `POST /interventions`
  `{ assignedUserId, accountId, currentStatus: "in_progress" }`
- Bulk: `POST /interventions/bulk`
  `{ accountIds[], assignedUserId, reason, eventTypeId? }`
- Cerrar intervención: `PATCH /interventions/{id}`
  `{ currentStatus: "closed", categoryId?, resolution? }`
- Observación: `PATCH /interventions/{id}`
  `{ currentStatus: "observation", observationComment? }`
- Crear/actualizar ticket: `POST /tickets` / `PATCH /tickets/{id}`
  `{ title, description, priority, status, accountId?, categoryId?,
     assignedUserId?, resolution? }`
- Cerrar ticket: `PATCH /tickets/{id}/close` `{ resolution }`
- Actividad en ticket: `POST /activities`
  `{ ticketId, title, description?, type (MESSAGE|TASK|NOTIFICATION|REMINDER|ALERT|UPDATE), assignedUserId? }`
- Marcar evento: `PATCH /events/{id}` `{ status: "processed"|"attending"|... }`
- Mensaje helpdesk: `POST /conversations/{id}/messages` `{ body, messageType: "text" }`
- Nota de cuenta: `POST /accounts/{id}/notes`
  `{ type: "bitacora"|"temporal"|"fija", content, validFrom?, validUntil? }`

Estados de evento: `pending`, `attending`, `processed`, `self-processed`,
`cancelled`, `hidden`. Estados de intervención: `in_progress`, `waiting`,
`transferred`, `closed`, `observation`.

## Escrituras Tier 2 (payloads confirmados contra el bundle)

- Marcar conversación leída: `POST /conversations/{id}/read` `{}`
- Marcar actividad leída: `PATCH /activities/{id}/mark-as-read` `{ readAt }`
  (si no se pasa, el server usa la fecha actual)
- Marcar actividad no leída: `PATCH /activities/{id}/mark-as-unread` `{}`
- Editar actividad: `PATCH /activities/{id}`
  `{ title?, description?, type?, assignedUserId?, ticketId? }`
- Contacto de cuenta: `POST /account-contacts`
  `{ accountId, name, phone?, email?, description?, order? }`
  / `PATCH /account-contacts/{id}` (mismos campos sin accountId)
- Agendar servicio: `PATCH /services/{id}/schedule`
  `{ scheduledDate, slotCount?, assignedUserId? }`
- Editar servicio: `PATCH /services/{id}`
  `{ accountId?, type?, title?, description?, priority?, assignedUserId?, categoryId? }`
- Días no laborales de técnico: `POST /users/{id}/non-working-days/range`
  `{ from (YYYY-MM-DD), to (YYYY-MM-DD), label? }`
- Día no laboral de empresa: `POST /companies/{id}/non-working-days`
  `{ date (YYYY-MM-DD), label? }`

Los endpoints de escritura que exceden el perfil de riesgo aprobado (borrados,
gestión de usuarios/roles, activación de monitoreo, facturación, catálogos,
archivos) están en `TIER3_PENDIENTE.md`: **documentados pero no implementados**.

## Escrituras: serialización y robustez (Fase B)

- `src/gavrielClient.ts` **serializa** internamente post/patch/delete (cola
  propia, máx 1 en vuelo; los GET quedan concurrentes). Se puede lanzar un
  grupo de PATCH de reordenamiento (`order` de contactos, etc.) en paralelo
  sin riesgo de conflictos 409 del lado del cliente. Si se requiere orden
  estricto entre procesos/sesiones distintas, pedirlas de a una igualmente.
- El backend de Gavriel falla de forma **intermitente** (a veces devuelve un
  body truncado con HTTP 200). El cliente detecta esto: devuelve
  `writeStatus: "applied_response_unparseable"`, loguea el body crudo en
  `~/.local/share/gavriel-mcp/writes.log` y re-lee el recurso para verificar
  el estado real. Ante este `writeStatus`, **no asumir fallo ni éxito**: leer
  el `verifiedState` devuelto o re-consultar el recurso.
- Tras una escritura, los endpoints con path de acción
  (`mark-as-read`, `mark-as-unread`) re-leen el recurso **padre**.

## Verificación

- `npm run selfcheck`: suite rápida offline (preview sin ejecutar,
  `applied_response_unparseable`, re-lectura a padre, 4xx genuinos,
  serialización de la cola). 9/9 verde = invariantes core OK.
- `npm run regression`: comparación tool vs endpoint crudo contra el backend
  real (muestra fija de datos). Compara estructura estable (ignora orden de
  arrays, `updatedAt` y celdas horarias de drift), no el JSON exacto. Necesita
  el `.env` y conexión a `app.gavriel.com.ar`.

## Reglas de proyecto

1. No hardcodear credenciales/JWT en código, tests, README ni este archivo.
   Los secretos van al **keyring del sistema** (`secret-tool`, paquete
   `libsecret-tools`) con `service gavriel-mcp account password` y
   `... account trusted_device_token`. Fallbacks en orden: variables de
   entorno (`GAVRIEL_PASSWORD` / `GAVRIEL_TRUSTED_DEVICE_TOKEN`), y por
   último el archivo legacy `~/.secrets/gavriel-password` (chmod 600) con
   warning explícito (ver `src/secrets.ts`). El `.env` del proyecto
   (gitignoreado) es un fallback de ejecución local.
2. No hacer commit/push salvo pedido explícito.
3. El log de debug va a **stderr** (`console.error`), nunca a stdout (stdio
   usa stdout para JSON-RPC).
4. No inventar campos de payload: si un endpoint de escritura no está
   confirmado contra el bundle, marcarlo como pendiente en vez de adivinar.
5. El gate `confirm` es el único control técnico de escrituras (además del
   log local). No agregar restricciones de roles/permisos en el código: el
   control de cuándo se usan las tools de escritura es del usuario/prompt.
