# Propuesta de rol de servicio mínimo — "MCP Service"

**Solo propuesta. Nadie crea usuarios ni roles desde OpenCode.** La creación
del usuario y el rol se hace manualmente en Gavriel por Mateo (o Mateo +
Armando) si se aprueba esta propuesta.

Contexto: la cuenta actual del MCP es humana (`Admin`, con CRUD completo en
todo). Para un MCP de solo consulta, el principio es menor privilegio:
un rol que solo pueda **leer** lo que las tools de lectura usan, y nada más.

## Cómo se determinó la matriz

La matriz de permisos granular no es un catálogo fijo del frontend: el
backend la emite por usuario en `login`/`profile` (`permissions`). La lista
siguiente es la del rol Admin actual, que es el universo de módulos que el
backend expone. Las tools del MCP (65, ya construidas) se cruzaron contra
esa matriz.

## Permisos del sistema → ¿lo necesita el MCP? → tools que lo usan

| Módulo | Acción | ¿Necesario? | Tools que lo usan |
|---|---|---|---|
| `accounts` | read | **SÍ** | `get_account`, `list_accounts`, `list_account_devices`, `list_account_partitions`, `list_account_users`, `list_account_contacts`, `list_account_zones`, `list_accounts_pending_events` (parcial) |
| `accounts` | create / update / delete | No | `add_account_contact` (create), `update_account`, `update_account_contact`, `add/update/delete_account_note` (update) — ver nota sobre escrituras |
| `events` | read | **SÍ** | `list_events`, `list_accounts_pending_events`, `get_monitoring_events_chart`, catálogo `events-types/codes/formats` |
| `events` | update | No | `mark_events_processed` (update) |
| `interventions` | read | **SÍ** | `list_interventions` |
| `interventions` | create / update | No | `create_intervention`, `create_bulk_interventions` (create), `close_intervention`, `set_intervention_observation` (update) |
| `companies` | read | **SÍ** | `list_companies`, `list_company_technicians`, catálogo `companies/type/technical` |
| `companies` | create / update / delete | No | `add_company_non_working_day` (update) |
| `users` | read | **SÍ** | `list_users`, `list_company_technicians` (parcial) |
| `users` | create / update / delete | No | `add_technician_non_working_days` (update) |
| `roles` | read | **SÍ** | `list_roles` |
| `roles` | create / update / delete | No | — |
| `zones` | read | **SÍ** | `list_account_zones`, catálogo `zones` |
| `zones` | create / update / delete | No | — |
| `connections` | read | **SÍ** | `list_connections`, `get_connection_report`, `get_monitoring_events_chart` (parcial) |
| `connections` | create / update / delete | No | — |
| `bridges` | read | **SÍ** | `list_bridge_logs`, `get_bridge_disk_space`, `health` (parcial) |
| `bridges` | create / update / delete | No | — |
| `protocols` | read | **SÍ** | catálogo `protocols` |
| `protocols` | create / update / delete | No | — |
| `device-brands` | read | **SÍ** | catálogo `device-brands`, `device-brands/active` |
| `device-brands` | create / update / delete | No | — |
| `device-models` | read | **SÍ** | catálogo `device-models` |
| `device-models` | create / update / delete | No | — |
| `ticket` | read | **SÍ** | `list_tickets`, `get_ticket`, `ticket_stats`, `get_open_technical_tickets_count`, `list_activities_by_ticket`, `get_activity_stats`, catálogos de tickets |
| `ticket` | create / update | No | `create_ticket` (create), `update_ticket`, `close_ticket`, `add_ticket_activity`, `mark_activity_read/unread`, `update_activity` (update) |
| `ticket-category` | read | **SÍ** | catálogo `ticket-categories` |
| `ticket-category` | create / update / delete | No | — |
| `jurisdictions` | read | **SÍ** | `list_useful_contacts` (parcial), catálogo `jurisdictions`, `states`, `cities` |
| `jurisdictions` | create / update / delete | No | — |
| `useful-contacts` | read | **SÍ** | `list_useful_contacts` |
| `useful-contacts` | create / update / delete | No | — |
| `audit` | read (único) | **SÍ** | `audit_logs` |
| `conversations` | read | **SÍ** | `list_conversations`, `list_conversation_messages`, `get_conversation_stats` |
| `conversations` | create / update | No | `send_conversation_message` (create), `conversation_claim/release/set_status/mark_read` (update) |
| `integration-credentials` | read / create / update / delete | No | — |
| `integrations` (hik/dahua/ezviz flags) | — | No | — (son POST de integración, Tier 3) |
| `file-storage` | read / create / update / delete | No | — (archivos son Tier 3, sin tools) |

### Módulos que el MCP lee pero NO existen en la matriz granular

El backend no expone permiso específico para estos (el Admin los tiene por
ser Admin; cualquier usuario autenticado los alcanza):

| Endpoint que usa el MCP | Tools |
|---|---|
| `/services/*` (panel, agenda, technician-locations) | `get_service_panel`, `get_service_panel_summary`, `get_service`, `list_technician_agenda`, `get_technician_locations`, `schedule_service`, `update_service` |
| `/activities` (hijos de ticket) | `list_activities_by_ticket`, `get_activity_stats`, `mark_activity_read/unread`, `update_activity`, `add_ticket_activity` |
| Catálogos sin módulo: `device-connection-types`, `device-taxonomies`, `intervention-categories`, `activities/type-options`, `events-types/gavriel-intervention` | resources de catálogo |
| `/auth/profile` | `get_my_profile` |
| GET libre con whitelist | `get` (lee cualquier path de la whitelist de lectura; no usa módulo específico) |

Si el backend decide gatear estos con un permiso nuevo, ese permiso tendría
que agregarse a este rol; hoy no existe la clave.

> **Nota sobre confirmación**: esta matriz se derivó del payload `permissions`
> del rol Admin actual (emitido por el backend en `login`/`profile`). Los
> endpoints y payloads de escritura citados están confirmados contra el bundle
> del frontend (ver `AGENTS.md`), no contra llamadas vivas al backend. Los
> módulos marcados con `—` (integrations, file-storage, integration-credentials)
> **no tienen tools implementadas** (Tier 3) y su permiso es inferido de la
> matriz Admin, no probado.

## Rol propuesto — "MCP Service" (solo lectura)

Exactamente esto, nada más:

```json
{
  "name": "MCP Service",
  "cognitoGroup": "mcpservice",
  "permissions": {
    "accounts":      { "read": true },
    "events":        { "read": true },
    "interventions": { "read": true },
    "companies":     { "read": true },
    "users":         { "read": true },
    "roles":         { "read": true },
    "zones":         { "read": true },
    "connections":   { "read": true },
    "bridges":       { "read": true },
    "protocols":     { "read": true },
    "device-brands": { "read": true },
    "device-models": { "read": true },
    "ticket":        { "read": true },
    "ticket-category": { "read": true },
    "jurisdictions": { "read": true },
    "useful-contacts": { "read": true },
    "audit":         { "read": true },
    "conversations": { "read": true }
  }
}
```

Usuario: una sola cuenta humana tipo servicio, p. ej.
`service_user@example.com`, con **2FA activo** y el rol `MCP Service`.

## Nota sobre escrituras

El MCP tiene 27 tools de escritura (gated por `confirm`). Esta propuesta las
deja **fuera del rol**: son operaciones que conviene que haga una cuenta
humana (hay auditoría, responsabilidad de quién acciona). Si más adelante se
quiere que la cuenta de servicio escriba, se habilitan solo estos módulos:

| Módulo | Acción | Tools involucradas |
|---|---|---|
| `events` | update | `mark_events_processed` |
| `interventions` | create / update | `create_intervention`, `create_bulk_interventions`, `close_intervention`, `set_intervention_observation` |
| `ticket` | create / update | `create_ticket`, `update_ticket`, `close_ticket`, `add_ticket_activity`, `mark_activity_read/unread`, `update_activity` |
| `accounts` | create / update | `update_account`, `add/update/delete_account_note`, `add/update_account_contact` |
| `conversations` | create / update | `send_conversation_message`, `conversation_claim/release/set_status/mark_read` |
| `users` / `companies` | update | `add_technician_non_working_days`, `add_company_non_working_day` |

## Decision pendiente

1. ¿Se crea el rol `MCP Service` y el usuario `service_user@example.com`
   (manual, en Gavriel)?
2. ¿Solo lectura (recomendado) o con el set de escrituras de la tabla de
   arriba?
3. Cuando exista, el MCP pasa a loguearse con esa cuenta (solo cambia
   `GAVRIEL_EMAIL`/password en el keyring; el código no cambia).
