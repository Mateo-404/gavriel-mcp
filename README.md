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

* To **use** gavriel: nothing. The single-file executable bundles its own runtime (no Node, no pnpm).
* To **build or develop**: Node.js 24+ (LTS; CI also tests Node 26) and pnpm.
* Gavriel user credentials (`app.gavriel.com.ar`)

## Installation

### Quick install (no Node needed)

One executable is both the `gavriel` CLI and the MCP server (`gavriel mcp serve`). The installer downloads it
from the latest GitHub release, verifies its SHA-256, copies it to your user folder (no admin rights), adds it to
your PATH and, if you ask, registers the MCP in your AI clients.

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.ps1 | iex
# also register the MCP (log in first with `gavriel login`, or run `gavriel mcp install` later):
$env:GAVRIEL_REGISTER = "all"; irm https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.sh | GAVRIEL_REGISTER=all sh
```

Already have the executable (e.g. a download)? Run it once and let it install itself:

```bash
gavriel-win32-x64.exe install                    # or: gavriel install --register desktop,codex,opencode
gavriel uninstall [--purge]                      # removes the binary, the PATH entry and the MCP entries
```

Install location: `%LOCALAPPDATA%\Programs\Gavriel` on Windows, `~/.local/bin` elsewhere (override with `--dir` or
`GAVRIEL_INSTALL_DIR`; `--no-path` skips the PATH change; `--dry-run` shows what would happen). Without a terminal
pass `--yes`. The executables are not code-signed, so SmartScreen may warn if you download them with a browser;
the scripts above avoid that and verify the checksum instead.

### From source

```bash
cd ~/proyectos/gavriel-mcp
pnpm install                 # package manager: pnpm (see packageManager in package.json)
pnpm run install:cli         # build + single-file executable + install the `gavriel` command
pnpm run install:mcp         # same, and also register the MCP in Claude Desktop (--client codex|opencode|all)
pnpm run uninstall:cli
```

`install:*` compile with the local TypeScript, build the executable with `pnpm build:bin` only when it is stale and run
`gavriel install`. **Why pnpm and not bun:** the executable already embeds its own runtime, so end users need neither;
pnpm is the project's package manager (lockfile, CI, release). Bun would add a second runtime and lockfile for no gain.

Plain MCP server without installing (development):

```bash
pnpm build
cp .env.example .env   # fill in GAVRIEL_EMAIL and GAVRIEL_PASSWORD
```

### Registering the MCP in your AI clients

After `gavriel login`, one command registers the server (the entry only carries the profile name, never secrets;
existing settings are preserved, the file is backed up and written atomically):

| Client | Command | File edited |
|---|---|---|
| Claude Desktop | `gavriel mcp install --client desktop` | `claude_desktop_config.json` (`mcpServers`) |
| Codex | `gavriel mcp install --client codex` | `~/.codex/config.toml` (`[mcp_servers.gavriel]`) |
| OpenCode | `gavriel mcp install --client opencode` | `~/.config/opencode/opencode.json` (`mcp`) |
| Claude Code | `gavriel mcp install --client code` | prints the `claude mcp add` command |
| all of the above that have a file | `gavriel mcp install --client all` | |

Add `--dry-run` to preview, `--force` to replace an existing entry, `--role readonly|lite|full` and
`--toolsets core,composites` to limit what the agent can see. `gavriel mcp uninstall [--client c]` removes it.
Path overrides (useful for tests): `GAVRIEL_CLAUDE_DESKTOP_CONFIG`, `GAVRIEL_CODEX_CONFIG`,
`GAVRIEL_OPENCODE_CONFIG`, `CODEX_HOME`.

Manual equivalents (adjust the path to your installed `gavriel`):

```json
{ "mcpServers": { "gavriel": { "command": "C:\\Users\\you\\AppData\\Local\\Programs\\Gavriel\\gavriel.exe",
  "args": ["mcp", "serve"], "env": { "GAVRIEL_PROFILE": "work" } } } }
```

```toml
# ~/.codex/config.toml
[mcp_servers.gavriel]
command = 'C:\Users\you\AppData\Local\Programs\Gavriel\gavriel.exe'
args = ['mcp', 'serve']

[mcp_servers.gavriel.env]
GAVRIEL_PROFILE = 'work'
```

```json
{ "mcp": { "gavriel": { "type": "local", "enabled": true,
  "command": ["C:\\Users\\you\\AppData\\Local\\Programs\\Gavriel\\gavriel.exe", "mcp", "serve"],
  "environment": { "GAVRIEL_PROFILE": "work" } } } }
```

### MCPB bundle (Claude Desktop)

`manifest.json` follows the [MCPB](https://github.com/modelcontextprotocol/mcpb) spec (credentials are asked
as `user_config`, the password is sensitive). After `pnpm install && pnpm build`, run `pnpm mcpb:pack`
(`@anthropic-ai/mcpb` is a pinned devDependency) to produce `gavriel-mcp.mcpb`. Not published anywhere.

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
| `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL` | no       | `elicitation` (`off` to disable)      |
| `GAVRIEL_MCP_TOOLSETS`             | no       | `all` (comma-separated toolsets)      |
| `GAVRIEL_PROFILE`                  | no       | active profile (see CLI); picks the account profile |
| `GAVRIEL_CONFIG_DIR`               | no       | `~/.config/gavriel` (profiles.json, no secrets) |
| `GAVRIEL_ALLOW_CUSTOM_API_BASE`    | no       | unset (`1`, real environment only, allows a non-Gavriel API host) |
| `GAVRIEL_CLAUDE_DESKTOP_CONFIG`    | no       | platform default (CLI: alternate Claude Desktop config path) |
| `GAVRIEL_ALLOW_PLAINTEXT`          | no       | unset (`1` allows plaintext token storage when no secure store exists) |
| `GAVRIEL_POLL_SEC`                 | no       | off (min 30; polls pending events, emits log notifications) |

### Server Roles (`GAVRIEL_MCP_ROLE`)

* `full` (default): all tools, including write tools (with `confirm`).
* `lite`: read access + core writes (tickets, interventions, conversations).
* `readonly`: read-only; write tools are **not registered** (they do not
  exist for the agent). Includes `get` and `audit_logs`, which are GETs.

Without the variable → `full` (current behavior). The MCPB `manifest.json` deliberately defaults to `readonly` (least privilege for the Claude Desktop bundle). `confirm` remains in effect in
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

## CLI (`gavriel`)

Second binary (`dist/cli.js`, no extra dependencies) to log in, manage several Gavriel accounts, renew the trusted device, install itself and register the MCP in Claude Desktop, Claude Code, Codex and OpenCode. The same executable also runs the MCP server: `gavriel mcp serve`.

```bash
gavriel login                          # email + hidden password, stored in DPAPI / libsecret; handles 2FA
gavriel renew [--all]                  # re-trust the device (code, stored TOTP seed, or prompt)
gavriel profile list|add|use|remove|rename
gavriel totp set|clear|code            # optional TOTP seed: lets the CLI and the MCP renew on their own
gavriel whoami | gavriel doctor [--online]   # --online performs a real login
gavriel mcp install --client all --profile work --role lite --dry-run   # desktop|code|codex|opencode|all; --force replaces; --server-path <file> overrides the server
gavriel mcp uninstall | gavriel mcp serve    # remove the entries | run the MCP server over stdio
gavriel install [--register all] | gavriel uninstall [--purge]   # self-install / remove (see Installation)
gavriel tickets --status open | gavriel events pending | gavriel accounts search <text>
```

`login` authenticates first and only then stores the password/profile; a profile name already used by a different email is refused unless `--profile` is explicit. Exit codes: 0 ok, 1 error (130 on Ctrl-C), 2 bad usage. Piped input works: `printf 'me@x.com\nPASSWORD\n' | gavriel login`. The release ships `gavriel-<platform>-<arch>` (CLI + MCP server, recommended) and the server-only `gavriel-mcp-<platform>-<arch>`, each with a `.sha256`.

Run `gavriel` with no arguments in a terminal (or `gavriel menu`) for an interactive menu: arrow keys / j k / number shortcuts, Enter to choose, Esc to go back. It covers login, renewing the trusted device, accounts (list/switch/rename/log out/remove), TOTP (live code, save/clear seed), diagnostics, queries (tickets, pending events, account search) and installing the MCP in Claude. A wrong password or 2FA code lets you retry (up to 5 times) and the password is echoed as `*`.

Logo style: `--logo blocks|braille|text|none` or `GAVRIEL_LOGO` (default `blocks`; `braille` gives finer feather detail on fonts that draw braille well).

Visual layer (follows the tui-design guidelines): the Gavriel logo (mint leaf + wordmark, rasterized from the official SVG with `scripts/gen-logo.mjs`) with a short reveal and shine animation, brand-colored tables with status/priority colors, spinners, a live TOTP countdown bar and colored JSON. It respects `NO_COLOR`, `FORCE_COLOR`, pipes (no art, no ANSI), `CI`, `TERM=dumb`, falls back to 16/256 colors and to ASCII glyphs on legacy consoles. Flags/env: `--no-color`, `--plain`, `--no-anim`, `GAVRIEL_THEME=light|dark`, `GAVRIEL_NO_ANIM=1`, `GAVRIEL_ASCII=1`, `GAVRIEL_PLAIN=1`.

Profiles live in `~/.config/gavriel/profiles.json` (override with `GAVRIEL_CONFIG_DIR`) and hold no secrets. The MCP picks one with `GAVRIEL_PROFILE` (or the active profile when `GAVRIEL_EMAIL` is unset). Storing the TOTP seed removes the second factor on that machine; it is opt-in (see SECURITY.md).

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

## Registering it in OpenCode (manual, from source)

> The easy way is `gavriel mcp install --client opencode` (see Installation). What follows is the manual setup
> with the keyring on Linux.

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
      },
      "enabled": true
    }
  }
}
```

> Interim (until migration): if `secret-tool` is not installed, the server falls back
> to `~/.secrets/gavriel-password` (chmod 600) with a warning. In that case the
> OpenCode config can still use `{file:~/.secrets/gavriel-password}`
> as it does today.

## Devices, zones and catalogs

- `create_device` / `update_device`: the whole backend form (`zoneId`, `deviceModelId`, `deviceConnectionTypeId`, `deviceKindId`, `alertType` Sonora|Silenciosa, `ownershipType` alquiler|comodato, `chip1`, `chip2`, `imei`, `moduleBrand`, `moduleModel`, `cloudDeviceId`, `hctCameraResourceId`, `cloudChannelNo`, `deviceTaxonomyId`, `hppDeviceCategory`, `hppDeviceSubCategory`, `cloudLiveViewVerification`). Serial and model are optional for accessories without serial (sirens, remotes). `update_device`/`update_zone` take `clear: ["chip2", ...]` to empty a field (only editable fields are accepted).
- `cloudLiveViewVerification` is a secret: it is masked in the confirm preview and in `writes.log`.
- Link a device to its zone with `zoneId` on the device, or from the zone side with `update_zone` (`serialNumber`, `deviceModelId`, `deviceBrandId`).
- `hik_cloud_lookup` (POST, queries Hik-Partner Pro) returns `cloudDeviceId` and the taxonomy; when the taxonomy does not exist in Gavriel's catalog it adds a `warnings` note: use `list_catalog` kind `device-taxonomies` or the generic taxonomy of the category (creating the missing taxonomies, e.g. hik_2_20 / hik_3_14, is backend data).
- `bulk_upsert_account_devices`: repeatable load of up to 50 devices into ONE account. Creates the ones that do not exist and updates (matching by `serialNumber`) only the fields that changed. Without `confirm` it returns a single preview (create/update/no-op counts and bodies); with `confirm: true` it returns `{summary, results}`. It needs the human approval like every `bulk_*` tool.
- `search_accounts` / `list_accounts` accept `exact: true`; `list_account_zones` omits the embedded account unless `include: ["account"]` or `full: true`; `list_account_devices` is lean unless `full: true` or `fields`.
- Catalogs for device loads: `list_catalog` kinds `device-taxonomies`, `device-kinds` (served by `/device-kinds/active`), `device-connection-types`, `device-brands`, `device-models`.
- Unknown tool arguments are rejected (`Argumentos desconocidos: "confrim" (¿quisiste decir "confirm"?)`). After rebuilding the server, reconnect the MCP client session: clients cache tool schemas per session (see CONTRIBUTING).

## Toolsets

`GAVRIEL_MCP_TOOLSETS` (comma-separated, default `all`) selects which tool modules are registered. Groups: `core` (tickets, events, accounts, interventions, activities, conversations, search, dashboards, batch, health, audit, get, services, org, monitoring, devices, event catalogs, catalog/entity resources, prompts), `notifications`, `video`, `telephony`, `infrastructure`, `coreGaps`, `composites`. Unknown names abort startup with the list of valid ones.

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

`TIER3_PENDIENTE.md` is a historical inventory and is **partly stale**: deletions,
user management, infrastructure, catalogs and file linking have since been
implemented (all behind `confirm` and, by default, human elicitation). The
authoritative tool list is `test/tools.snapshot.json` (213 tools).

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
