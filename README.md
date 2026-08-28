# 🪽 Gavriel MCP

Servidor MCP local (TypeScript) que expone la API de **Gavriel** — sistema de
monitoreo de alarmas — como herramientas para agentes de IA (OpenCode, Claude Desktop).

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/PROPUESTA_ROL_SERVICIO.md`](docs/PROPUESTA_ROL_SERVICIO.md) | Rol de servicio mínimo `MCP Service` (decisión pendiente). |
| [`docs/PERF.md`](docs/PERF.md) | Ledger de optimización y métricas de contexto. |
| [`TIER3_PENDIENTE.md`](TIER3_PENDIENTE.md) | Endpoints inventariados y no implementados (backlog). |

## Requisitos

- Node.js 20+ (probado con Node 22/24)
- Credenciales de usuario de Gavriel (`app.gavriel.com.ar`)

## Instalación

```bash
cd ~/proyectos/gavriel-mcp
pnpm install          # package manager: pnpm (ver packageManager en package.json)
pnpm build
cp .env.example .env   # completar GAVRIEL_EMAIL y GAVRIEL_PASSWORD
```

## Configuración

`src/config.ts` lee estas variables (de `.env` o del entorno):

| Variable | Requerida | Default |
|---|---|---|
| `GAVRIEL_EMAIL` | sí | — |
| `GAVRIEL_PASSWORD` | no* | — (ver resolución de secretos) |
| `GAVRIEL_TRUSTED_DEVICE_TOKEN` | no | — (fallback dev; normalmente en keyring) |
| `GAVRIEL_API_BASE` | no | `https://app.gavriel.com.ar/api` |
| `GAVRIEL_MCP_LOG_DIR` | no | `~/.local/share/gavriel-mcp` |
| `GAVRIEL_MCP_ROLE` | no | `full` |
| `GAVRIEL_MCP_WRITE_CONCURRENCY` | no | `5` (1–20) |
| `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL` | no | `off` |

### Roles del server (`GAVRIEL_MCP_ROLE`)

- `full` (default): todas las tools, incluidas las de escritura (con `confirm`).
- `lite`: lectura + escrituras core (tickets, intervenciones, conversaciones).
- `readonly`: solo lectura; las tools de escritura **no se registran** (no
  existen para el agente). Incluye `get` y `audit_logs`, que son GET.

Sin variable → `full` (comportamiento actual). `confirm` sigue vigente en
todos los roles: rol = disponibilidad, confirm = aprobación. El rol real de
seguridad es el usuario de Gavriel con el que se loguea el server.

### Configuración del rol de servicio

El rol de servicio está definido en `docs/PROPUESTA_ROL_SERVICIO.md`. La
configuración recomendada es usar el rol `MCP Service` (solo lectura) como
default.

> **Nota:** hoy el MCP se loguea con una cuenta `Admin` (CRUD completo). Ese
> es el estado actual **no deseado** que la propuesta de rol busca reemplazar,
> no un modo de uso soportado. Configurar la cuenta `Admin` solo tiene sentido
> como paso previo hasta crear el rol `MCP Service`.

El JWT se cachea **en memoria** (nunca en disco) y se renueva ~5 min antes de
expirar o ante un 401. La API renueva el token vía el header `x-new-token`, que
el cliente respeta automáticamente.

## Resolución de secretos

El server resuelve `password` y `trusted_device_token` al arrancar, en este
orden (ver `src/secrets.ts`):

1. **Keyring del sistema** (`secret-tool`, paquete `libsecret-tools`): más
   seguro, es el modo recomendado.
2. **Variables de entorno** `GAVRIEL_PASSWORD` / `GAVRIEL_TRUSTED_DEVICE_TOKEN`
   (útil para dev local fuera de opencode).
3. **Archivos legacy** (`~/.secrets/gavriel-password` y
   `~/.local/share/gavriel-mcp/trusted-device.json`): solo último recurso, con
   warning explícito en stderr.

El JWT se cachea **en memoria** (nunca en disco) y se renueva ~5 min antes de
expirar o ante un 401. La API renueva el token vía el header `x-new-token`, que
el cliente respeta automáticamente. El `trusted_device_token` (válido ~20 días,
salta el 2FA en logins posteriores) también va al keyring.

## Registrarlo en OpenCode

Instalar `libsecret-tools` (si no está) y guardar ambos secretos una sola vez,
de forma interactiva (el valor se pide por stdin, no va en la línea de
comando):

```bash
sudo apt install libsecret-tools    # si hace falta (daemon: gnome-keyring)

secret-tool store --label="Gavriel MCP - password" service gavriel-mcp account password
secret-tool store --label="Gavriel MCP - trusted device token" service gavriel-mcp account trusted_device_token
```

El server los lee solo del keyring; la config de opencode ya no necesita el
secret:

```json
{
  "mcp": {
    "gavriel": {
      "type": "local",
      "command": ["node", "/ruta/al/proyecto/gavriel-mcp/dist/index.js"],
      "environment": {
        "GAVRIEL_EMAIL": "user@example.com"
      },
      "enabled": true
    }
  }
}
```

> Interino (hasta migrar): si `secret-tool` no está instalado, el server cae al
> archivo `~/.secrets/gavriel-password` (chmod 600) con warning. En ese caso la
> config de opencode puede seguir usando `{file:~/.secrets/gavriel-password}`
> como hoy.

## Herramientas

Los nombres MCP no llevan prefijo. Al usarlas desde una sesión de opencode,
opencode antepone el nombre del server: `create_ticket` se expone como
`gavriel_create_ticket`.

### Lectura (no requieren `confirm`)

| Tool | Qué hace |
|---|---|
| `list_tickets` | Lista tickets (filtros: status, priority, accountId, categoryId, assignedUserId, search). Paginación máx. 200. |
| `get_ticket` | Ticket + actividades (comentarios) por ID. |
| `ticket_stats` | Estadísticas globales de tickets. |
| `get_open_technical_tickets_count` | Cantidad de tickets técnicos abiertos (por accountId). |
| `list_events` | Lista eventos/alarmas (accountId, port, eventCode, dateFrom, dateTo, pendientes…). |
| `list_accounts_pending_events` | Cuentas con eventos pendientes (para intervención masiva). |
| `get_monitoring_events_chart` | Gráfico de eventos 24 h (por conexión o global). |
| `get_account` | Cuenta completa (zonas, contactos, usuarios, intervenciones). |
| `list_accounts` | Buscar cuentas por nombre/código. |
| `list_account_devices` / `list_account_partitions` / `list_account_zones` | Dispositivos, particiones y zonas de una cuenta. |
| `list_account_users` / `list_account_contacts` | Usuarios y contactos de una cuenta. |
| `list_useful_contacts` | Contactos útiles (por jurisdicción). |
| `list_interventions` | Intervenciones de una cuenta (openOnly para solo abiertas). |
| `list_activities_by_ticket` / `get_activity_stats` | Actividades de un ticket / estadísticas globales. |
| `list_conversations` / `list_conversation_messages` / `get_conversation_stats` | Conversaciones de helpdesk, sus mensajes y stats. |
| `list_connections` / `get_connection_report` | Conexiones y reporte de estado por conexión. |
| `list_bridge_logs` / `get_bridge_disk_space` | Logs y espacio en disco de un bridge. |
| `get_service_panel` / `get_service_panel_summary` / `get_service` / `list_technician_agenda` / `get_technician_locations` | Panel de servicios, agenda de técnicos y ubicaciones. |
| `list_companies` / `list_company_technicians` | Empresas y sus técnicos. |
| `list_users` / `list_roles` / `get_my_profile` | Usuarios, roles y perfil propio. |
| `audit_logs` | Logs de auditoría del sistema. |
| `health` | Logs de salud de conexiones y bridges. |
| `get` | GET libre sobre whitelist de endpoints de lectura. |

### Escritura — **todas requieren `confirm: true`**

El gate es la **Fase 0, regla 2**: si `confirm` falta o es `false`, la tool
**no ejecuta nada** y devuelve un preview (método + path + body). Si
`confirm: true`, ejecuta y loguea la operación en `writes.log`.

| Tool | Acción |
|---|---|
| `create_intervention` | Crear intervención en progreso sobre una cuenta. |
| `create_bulk_interventions` | Procesar eventos pendientes en masa (motivo + cuentas). |
| `close_intervention` | Cerrar intervención (crea/cierra ticket y marca eventos procesados). |
| `set_intervention_observation` | Poner intervención en observación con comentario. |
| `create_ticket` | Crear ticket. |
| `update_ticket` | Cambiar status/prioridad/asignado/campos de un ticket. |
| `close_ticket` | Cerrar ticket con resolución. |
| `add_ticket_activity` | Agregar comentario/actividad a un ticket. |
| `mark_events_processed` | Marcar uno o más eventos como procesados. |
| `update_account` | Actualizar campos de una cuenta. |
| `add_account_note` / `update_account_note` / `delete_account_note` | Bitácora/notas de cuenta. |
| `send_conversation_message` | Enviar mensaje en conversación de helpdesk. |
| `conversation_claim` / `conversation_release` / `conversation_set_status` / `conversation_mark_read` | Gestión de conversaciones. |
| `mark_activity_read` / `mark_activity_unread` / `update_activity` | Marcar leída/no leída y editar una actividad. |
| `add_account_contact` / `update_account_contact` | Alta y edición de contactos de una cuenta. |
| `schedule_service` / `update_service` | Agendar y editar servicios. |
| `add_technician_non_working_days` / `add_company_non_working_day` | Días no laborales de técnico y de empresa. |

**Importante:** probá siempre primero con `confirm` ausente/false y revisá el
preview. La primera ejecución real de cada tool hacela en presencia del
operador — son datos reales de clientes en producción.

### Recursos (catálogos semi-estáticos, cache 1 h)

`gavriel://catalog/...` para eventos-types, events-codes, events-formats,
protocols, intervention-categories, device-brands (y activas), device-models,
device-connection-types (y activos), device-taxonomies, states, cities,
jurisdictions, zones, tickets status/priority options, ticket-categories,
activities type-options, events-types/gavriel-intervention y
companies/type/technical.

## Endpoints no implementados (Tier 3)

Los endpoints de escritura que exceden el perfil de riesgo aprobado (borrados,
gestión de usuarios/roles, activación de monitoreo, facturación, catálogos,
archivos) están inventariados en `TIER3_PENDIENTE.md` y **no se implementan**
sin instrucción explícita.

## Log de escrituras

Toda escritura ejecutada queda registrada en
`~/.local/share/gavriel-mcp/writes.log` (JSONL): timestamp, tool, parámetros,
email del usuario del JWT, y respuesta de la API (status + body resumido).
Esto es adicional al audit log propio de Gavriel (`/audit/logs`).

## Despliegue

No se despliega: es local, transporte stdio. No requiere Docker ni el host
Hyper-V.

## Seguridad

- Los secretos (`password` y `trusted_device_token`) viven en el **keyring del
  sistema** (recomendado); el archivo legacy `~/.secrets/gavriel-password`
  (chmod 600) queda solo como fallback interino con warning. El `.env` del repo
  (gitignoreado) es un fallback de ejecución local.
- El JWT nunca se persiste en disco.
- El gate de `confirm` evita ejecuciones accidentales; el control de *cuándo*
  se usan las escrituras queda a nivel de skill/prompt del agente, no
  bloqueado en el código (decisión del dueño del proyecto).
- **Respuestas no parseables**: ocasionalmente el backend puede devolver HTTP 200
  con un body truncado o inválido. Esta tool lo detecta (`writeStatus:
  "applied_response_unparseable"`), loguea el body crudo y re-lee el recurso
  para verificar el estado real. No asumir éxito ni fallo ante ese status:
  consultar el `verifiedState` devuelto o re-consultar el recurso.
