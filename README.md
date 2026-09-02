# 🪽 Gavriel MCP

Local MCP server (TypeScript) that exposes the **Gavriel** API — alarm
monitoring system — as tools for AI agents (OpenCode, Claude Desktop).

## Documentation

| Document                                                           | Purpose                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| [`docs/PROPUESTA_ROL_SERVICIO.md`](docs/PROPUESTA_ROL_SERVICIO.md) | Minimum `MCP Service` service role (decision pending). |
| [`docs/PERF.md`](docs/PERF.md)                                     | Optimization ledger and context metrics.               |
| [`TIER3_PENDIENTE.md`](TIER3_PENDIENTE.md)                         | Inventoried and unimplemented endpoints (backlog).     |

## Requirements

* Node.js 20+ (tested with Node 22/24)
* Gavriel user credentials (`app.gavriel.com.ar`)

## Installation

```bash
cd ~/proyectos/gavriel-mcp
pnpm install          # package manager: pnpm (see packageManager in package.json)
pnpm build
cp .env.example .env   # fill in GAVRIEL_EMAIL and GAVRIEL_PASSWORD
```

## Configuration

`src/config.ts` reads these variables (from `.env` or the environment):

| Variable                           | Required | Default                               |
| ---------------------------------- | -------- | ------------------------------------- |
| `GAVRIEL_EMAIL`                    | yes      | —                                     |
| `GAVRIEL_PASSWORD`                 | no*      | — (see secret resolution)             |
| `GAVRIEL_TRUSTED_DEVICE_TOKEN`     | no       | — (dev fallback; normally in keyring) |
| `GAVRIEL_API_BASE`                 | no       | `https://app.gavriel.com.ar/api`      |
| `GAVRIEL_MCP_LOG_DIR`              | no       | `~/.local/share/gavriel-mcp`          |
| `GAVRIEL_MCP_ROLE`                 | no       | `full`                                |
| `GAVRIEL_MCP_WRITE_CONCURRENCY`    | no       | `5` (1–20)                            |
| `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL` | no       | `off`                                 |

### Server Roles (`GAVRIEL_MCP_ROLE`)

* `full` (default): all tools, including write tools (with `confirm`).
* `lite`: read access + core writes (tickets, interventions, conversations).
* `readonly`: read-only; write tools are **not registered** (they do not
  exist for the agent). Includes `get` and `audit_logs`, which are GETs.

Without the variable → `full` (current behavior). `confirm` remains in effect in
all roles: role = availability, confirm = approval. The actual security role is
the Gavriel user the server logs in with.

### Service Role Configuration

The service role is defined in `docs/PROPUESTA_ROL_SERVICIO.md`. The
recommended configuration is to use the `MCP Service` role (read-only) as the
default.

> **Note:** currently the MCP logs in with an `Admin` account (full CRUD).
> This is the current **undesired** state that the role proposal aims to replace,
> not a supported usage mode. Configuring the `Admin` account only makes sense
> as an interim step until the `MCP Service` role is created.

The JWT is cached **in memory** (never on disk) and renewed ~5 minutes before
expiration or after a 401. The API renews the token through the `x-new-token`
header, which the client automatically respects.

## Secret Resolution

The server resolves `password` and `trusted_device_token` at startup, in this
order (see `src/secrets.ts`):

1. **System keyring** (`secret-tool`, `libsecret-tools` package): most
   secure, and the recommended method.
2. **Environment variables** `GAVRIEL_PASSWORD` / `GAVRIEL_TRUSTED_DEVICE_TOKEN`
   (useful for local development outside OpenCode).
3. **Legacy files** (`~/.secrets/gavriel-password` and
   `~/.local/share/gavriel-mcp/trusted-device.json`): last resort only, with
   an explicit warning on stderr.

The JWT is cached **in memory** (never on disk) and renewed ~5 minutes before
expiration or after a 401. The API renews the token through the `x-new-token`
header, which the client automatically respects. The `trusted_device_token` (valid
for ~20 days and bypasses 2FA on subsequent logins) is also stored in the keyring.

## Registering it in OpenCode

Install `libsecret-tools` (if not already installed) and store both secrets once,
interactively (the value is requested through stdin and is not included on the
command line):

```bash
sudo apt install libsecret-tools    # if needed (daemon: gnome-keyring)

secret-tool store --label="Gavriel MCP - password" service gavriel-mcp account password
secret-tool store --label="Gavriel MCP - trusted device token" service gavriel-mcp account trusted_device_token
```

The server reads them only from the keyring; the OpenCode config no longer needs
the secret:

```json
{
  "mcp": {
    "gavriel": {
      "type": "local",
      "command": ["node", "/path/to/project/gavriel-mcp/dist/index.js"],
      "environment": {
        "GAVRIEL_EMAIL": "user@example.com"
      }
    },
    "enabled": true
  }
}
```

> Interim (until migration): if `secret-tool` is not installed, the server falls back
> to `~/.secrets/gavriel-password` (chmod 600) with a warning. In that case the
> OpenCode config can still use `{file:~/.secrets/gavriel-password}`
> as it does today.

## Tools

MCP names do not use a prefix. When using them from an OpenCode session,
OpenCode prepends the server name: `create_ticket` is exposed as
`gavriel_create_ticket`.

### Read Operations (do not require `confirm`)

| Tool                                                                                                                      | What it does                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `list_tickets`                                                                                                            | Lists tickets (filters: status, priority, accountId, categoryId, assignedUserId, search). Max. pagination 200. |
| `get_ticket`                                                                                                              | Ticket + activities (comments) by ID.                                                                          |
| `get_ticket_context`                                                                                                      | Ticket + account + activities in ONE call.                                                                     |
| `ticket_stats`                                                                                                            | Global ticket statistics.                                                                                      |
| `get_open_technical_tickets_count`                                                                                        | Number of open technical tickets (by accountId).                                                               |
| `list_events`                                                                                                             | Lists events/alarms (accountId, port, eventCode, dateFrom, dateTo, pending…).                                  |
| `list_accounts_pending_events`                                                                                            | Accounts with pending events (for bulk intervention).                                                          |
| `get_monitoring_events_chart`                                                                                             | 24-hour event chart (per connection or global).                                                                |
| `get_event`                                                                                                               | Event by ID with its relationships.                                                                            |
| `get_event_context`                                                                                                       | Event + account + connection in ONE call.                                                                      |
| `get_account`                                                                                                             | Full account (zones, contacts, users, interventions).                                                          |
| `get_account_dashboard`                                                                                                   | Account + devices + interventions + pending events in ONE call.                                                |
| `get_pending_events_dashboard`                                                                                            | Accounts with pending events and their details (bulk processing).                                              |
| `list_accounts`                                                                                                           | Search accounts by name/code.                                                                                  |
| `list_account_devices` / `list_account_partitions` / `list_account_zones`                                                 | Devices, partitions, and zones of an account.                                                                  |
| `list_account_users` / `list_account_contacts`                                                                            | Users and contacts of an account.                                                                              |
| `list_useful_contacts`                                                                                                    | Useful contacts (by jurisdiction).                                                                             |
| `list_interventions`                                                                                                      | Interventions for an account (`openOnly` for open ones only).                                                  |
| `list_activities_by_ticket` / `get_activity_stats`                                                                        | Activities for a ticket / global statistics.                                                                   |
| `list_conversations` / `list_conversation_messages` / `get_conversation_stats`                                            | Helpdesk conversations, their messages, and stats.                                                             |
| `list_connections` / `get_connection_report`                                                                              | Connections and status report per connection.                                                                  |
| `list_bridge_logs` / `get_bridge_disk_space`                                                                              | Logs and disk space for a bridge.                                                                              |
| `get_service_panel` / `get_service_panel_summary` / `get_service` / `list_technician_agenda` / `get_technician_locations` | Service panel, technician agenda, and locations.                                                               |
| `list_companies` / `list_company_technicians`                                                                             | Companies and their technicians.                                                                               |
| `list_users` / `list_roles` / `get_my_profile`                                                                            | Users, roles, and own profile.                                                                                 |
| `audit_logs`                                                                                                              | System audit logs.                                                                                             |
| `health`                                                                                                                  | Connection and bridge health logs.                                                                             |
| `search_accounts` / `search_tickets` / `search_events` / `search_users`                                                   | Quick search with reduced fields (for resolving IDs).                                                          |
| `find_duplicate_event_codes` / `find_duplicate_event_types` / `validate_event_mapping`                                    | Audit of event type/code mapping.                                                                              |
| `get`                                                                                                                     | Free GET over a whitelist of read-only endpoints.                                                              |

### Write Operations — **all require `confirm: true`**

The gate is **Phase 0, rule 2**: if `confirm` is missing or `false`, the tool
**does not execute anything** and returns a preview (method + path + body). If
`confirm: true`, it executes and logs the operation in `writes.log`.

| Tool                                                                                                          | Action                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `create_intervention`                                                                                         | Create an in-progress intervention on an account.                                        |
| `create_bulk_interventions`                                                                                   | Process pending events in bulk (reason + accounts).                                      |
| `close_intervention`                                                                                          | Close an intervention (creates/closes a ticket and marks events as processed).           |
| `set_intervention_observation`                                                                                | Put an intervention under observation with a comment.                                    |
| `create_ticket`                                                                                               | Create a ticket.                                                                         |
| `update_ticket`                                                                                               | Change the status/priority/assignee/fields of a ticket.                                  |
| `close_ticket`                                                                                                | Close a ticket with a resolution.                                                        |
| `add_ticket_activity`                                                                                         | Add a comment/activity to a ticket.                                                      |
| `mark_events_processed`                                                                                       | Mark one or more events as processed.                                                    |
| `bulk_process_events`                                                                                         | Mark multiple events as processed in bulk.                                               |
| `bulk_mark_events_by_filter`                                                                                  | Mark events to a state by filter (account required; preview of IDs before confirmation). |
| `bulk_close_tickets`                                                                                          | Close multiple tickets in bulk with the same resolution.                                 |
| `bulk_add_account_note`                                                                                       | Add the same note to up to 100 accounts (ID deduplication).                              |
| `update_account`                                                                                              | Update account fields.                                                                   |
| `add_account_note` / `update_account_note` / `delete_account_note`                                            | Account log/notes.                                                                       |
| `send_conversation_message`                                                                                   | Send a message in a helpdesk conversation.                                               |
| `conversation_claim` / `conversation_release` / `conversation_set_status` / `conversation_mark_read`          | Conversation management.                                                                 |
| `mark_activity_read` / `mark_activity_unread` / `update_activity`                                             | Mark as read/unread and edit an activity.                                                |
| `add_account_contact` / `update_account_contact`                                                              | Add and edit account contacts.                                                           |
| `reorder_account_contacts`                                                                                    | Set the final order of all contacts (spacing ×10 for future insertions).                 |
| `schedule_service` / `update_service`                                                                         | Schedule and edit services.                                                              |
| `add_technician_non_working_days` / `add_company_non_working_day`                                             | Technician and company non-working days.                                                 |
| `create_/update_/delete_event_type`, `create_/update_/delete_event_code`, `bulk_create_event_codes`           | CRUD for the event type and code catalog.                                                |
| `create_/update_/delete_device_brand`, `create_/update_/delete_device_model`, `create_/update_/delete_device` | CRUD for the brand/model and device catalog.                                             |

**Important:** always test first with `confirm` omitted/false and review the
preview. Perform the first real execution of each tool in the presence of the
operator — these are real production customer data.

### Resources (semi-static catalogs, 1 h cache)

`gavriel://catalog/...` for event-types, event-codes, event-formats,
protocols, intervention-categories, device-brands (and active ones), device-models,
device-connection-types (and active ones), device-taxonomies, states, cities,
jurisdictions, zones, ticket status/priority options, ticket-categories,
activity type-options, event-types/gavriel-intervention, and
company/type/technical.

## Unimplemented Endpoints (Tier 3)

Write endpoints that exceed the approved risk profile (deletions,
user/role management, monitoring activation, billing, catalogs,
files) are inventoried in `TIER3_PENDIENTE.md` and **are not implemented**
without explicit instruction.

## Write Log

Every executed write operation is logged in
`~/.local/share/gavriel-mcp/writes.log` (JSONL): timestamp, tool, parameters,
JWT user email, and API response (status + summarized body).
This is in addition to Gavriel's own audit log (`/audit/logs`).

## Deployment

It is not deployed: it is local, using stdio transport. It does not require Docker
or the Hyper-V host.

## Verification

```bash
pnpm typecheck   # types
pnpm build       # compiles to dist/
pnpm selfcheck   # quick offline core invariants suite (no network)
pnpm regression  # compares tool vs endpoint against the real backend (requires .env and network)
```

## Security

* Secrets (`password` and `trusted_device_token`) live in the **system keyring**
  (recommended); the legacy `~/.secrets/gavriel-password`
  (chmod 600) remains only as an interim fallback with a warning. The `.env` file in the repository
  (gitignored) is a local runtime fallback.
* The JWT is never persisted to disk.
* The `confirm` gate prevents accidental executions; control over *when*
  writes are used remains at the agent's skill/prompt level rather than being
  blocked in code (project owner's decision).
* **Unparseable responses**: occasionally the backend may return HTTP 200
  with a truncated or invalid body. This tool detects it (`writeStatus:
  "applied_response_unparseable"`), logs the raw body, and re-reads the resource
  to verify the actual state. Do not assume success or failure for this status:
  check the returned `verifiedState` or re-query the resource.
