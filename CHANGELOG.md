# Changelog

Todas las versiones se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y el versionado
[SemVer](https://semver.org/lang/es/). Las notas de release en GitHub se
generan automáticamente desde los commits (conventional commits) al crear el
tag `vX.Y.Z`.

## [Unreleased]

### Changed
- Windows DPAPI now uses .NET `ProtectedData` directly (same blob format as `ConvertFrom-SecureString`, existing secrets stay readable); the PowerShell security module could not be loaded on the GitHub runner, which broke the Windows CI.
- Dependencies at latest: zod 4.6.7, @types/node 26.6.5, tsx 4.23.15, Biome 2.6.2 and mcpb 2.1.2 as pinned devDependencies, pnpm 12.14.0. SDK 2.3.1, TypeScript 7.0.2, esbuild 0.28.2 were already current.
- Node >=24 (LTS); CI matrix Node 24 and 26; upload-artifact v7, download-artifact v8, attest-build-provenance v4. Lint is now blocking in CI.
- Date-time inputs use a lightweight `isoDateTime` schema (zod 4.6 injected a ~250-char regex per field into `tools/list`).

### Added
- Devices and zones: `create_device`/`update_device` accept the full backend form (zoneId, deviceKindId, alertType, ownershipType, chips, imei, moduleBrand/Model, cloud and Hik ids, taxonomy, camera verification code); serial and model are optional for accessories; `clear: string[]` empties fields (validated against a whitelist); `cloudLiveViewVerification` is redacted in previews and logs (#24, #25, #27).
- `hik_cloud_lookup` warns when the Hik taxonomy is missing from the catalog and points to the generic one (#26, #31).
- `bulk_upsert_account_devices`: repeatable load of up to 50 devices into one account with a single preview (#30).
- `search_accounts`/`list_accounts` `exact`, lean `list_account_zones` and `list_account_devices` by default (`full: true` for everything) (#30).
- Every tool now rejects unknown arguments with a "did you mean" hint, so a stale client schema fails loudly instead of dropping parameters (#29).
- `list_catalog` `device-kinds` uses `/device-kinds/active` (plain `/device-kinds` is 404) (#28).
- Installers: `gavriel install` / `uninstall` (self-install the single executable to a per-user folder, user PATH on Windows, optional MCP registration), `scripts/install.mjs` (from source: `pnpm run install:cli|install:mcp|uninstall:cli`), `scripts/install.ps1` and `scripts/install.sh` (download from the release and verify SHA-256).
- One executable is now CLI + MCP server: `gavriel mcp serve` (`src/serve.ts`); `gavriel-mcp` keeps working.
- MCP registration for **Codex** (`~/.codex/config.toml`) and **OpenCode** (`opencode.json`) besides Claude Desktop and Claude Code: `gavriel mcp install --client desktop|code|codex|opencode|all`, plus `gavriel mcp uninstall`.
- Tests: TOML/PATH/client unit tests and end-to-end installer tests with the real executable (sandboxed), including the PowerShell installer against a local server and a tampered checksum.
- CLI interactive menu (`gavriel` / `gavriel menu`) built on an inline selector (arrows, j/k, number shortcuts, Esc); password prompt echoes `*`; login retries on a wrong password or 2FA code (up to 5 times, only on a TTY).
- Logo re-rasterized at higher resolution from the official SVG (wing feathers and the thin wordmark preserved); styles `blocks` (default), `braille`, `text`, `none` via `--logo` / `GAVRIEL_LOGO`.
- CLI visual layer: official Gavriel logo (mint gradient, animated reveal and shine), branded palette with light/dark themes, rounded tables with status/priority colors, spinners, live TOTP countdown, colored JSON, styled prompts and help; honors NO_COLOR/FORCE_COLOR/CI/pipes with 16/256-color and ASCII fallbacks; `--no-color`, `--plain`, `--no-anim`.
- `gavriel` CLI (`dist/cli.js`): multi-account profiles, login, trusted-device renewal, optional TOTP seed, `doctor`, `mcp install`, quick read queries. Zero new dependencies.
- `GAVRIEL_PROFILE` and per-email password/TOTP keys; `GavrielClient` accepts a `getTwoFactorCode` hook (the MCP auto-renews with a stored seed).
- ~100 new tools: notifications, video, SIP/operator telephony, infrastructure, core-gap endpoints; toolsets via `GAVRIEL_MCP_TOOLSETS`; server `instructions`.
- Opt-in pending-events poller (`GAVRIEL_POLL_SEC`, min 30): logging notifications (warning) and `resources/updated` for `gavriel://events/pending`.
- Tests (`node --test`, `pnpm test`): client cache/dedupe/retry/401, write helpers, rawGet, redact, poller diff, stdio contract test with `test/tools.snapshot.json` (`pnpm test:snapshot` to update).
- MCPB `manifest.json`, `biome.json` (lint only), Dependabot, CI matrix (ubuntu/windows, Node 20/22/24), `pnpm audit`.

### Changed
- Destructive tools now require human approval via elicitation by default (`GAVRIEL_MCP_DESTRUCTIVE_APPROVAL=off` to opt out).
- Performance: GET cache/dedupe, circuit breaker, bounded concurrency.
- Release workflow fails if the tag differs from `package.json` or CHANGELOG has no entry.
- `tsconfig`: dropped `DOM` lib; `test:fast` no longer uses bun.

### Fixed (CLI / packaging / docs)
- CLI input: single shared readline (piped stdin no longer loses lines); EOF exits 1 ("Entrada cerrada"), Ctrl-C exits 130; hidden prompt reads the same reader without TTY.
- `gavriel login` authenticates with the candidate password before persisting anything; failed logins and 2FA failures keep the previous password/profile; a profile name taken by a different email is refused unless `--profile` is given; derived names are sanitized.
- `gavriel doctor`: live login is opt-in (`--online`); every step reports `FALLA` instead of crashing; exit 1 on any failure.
- CLI flag validation (`--limit` 1..200, `--role`, `--toolsets`, `--api-base`), duplicate/missing `-p` rejected with short errors, prototype-safe profile lookups.
- `gavriel mcp install`: refuses to replace an existing entry without `--force`, validates the JSON shape, atomic write after `.bak`, `--server-path`, `GAVRIEL_CLAUDE_DESKTOP_CONFIG`, safe quoting for PowerShell/cmd/POSIX plus JSON args for `claude mcp add`.
- `gavriel --version` reads `package.json` when not bundled.
- Release: second SEA binary `gavriel-<plat>-<arch>`, local `postject` (no `npx`), `import.meta.url` handled in the CJS bundle, build provenance attestation, tag must match `manifest.json` too, `gh release --repo`.
- `.gitattributes` (LF), `tsconfig` `newLine: lf`, grouped Dependabot updates.
- Docs: AGENTS/README/TIER3 brought in line (213 tools, elicitation default, `lite` role, new env vars, CLI section).

### Security
- Hardening: stricter `get` path/query sanitizing, wider log redaction, https-only API base.
- Windows DPAPI secret storage; plaintext fallback only with `GAVRIEL_ALLOW_PLAINTEXT=1`.

## [1.2.0] - 2026-08-23

### Added
- **Binarios single-executable por plataforma** (Node.js SEA, nativo, sin
  dependencias de runtime de terceros). Build vía `pnpm build:bin`
  (esbuild + postject, solo build-time). Se adjuntan a los Releases de GitHub
  con checksum `sha256`.
- Workflow `.github/workflows/release.yml`: ante un tag `v*`, construye los
  binarios linux-x64 / darwin-arm64 / darwin-x64 / win32-x64 y los publica en
  el Release con `--generate-notes`.
- Flag `--version` / `-v` en el binario (lee la versión de `package.json`
  inyectada en build-time por esbuild).
- `CHANGELOG.md`, plantillas de issue/PR y `CONTRIBUTING.md`.

### Security
- Se descarta `pkg` (deprecado, CVE-2024-24828 sin parche) a favor de Node.js
  SEA nativo.

## [1.1.0] - 2026-08-14

### Added
- Roles `readonly` / `full` con gate de `confirm` en escrituras.
- Auditoría de optimización de tokens: `ok()`/`okTruncated()`/`okStructured()`.
- Migración a pnpm.

## [1.0.0] - 2026-08-12

### Added
- Servidor MCP inicial: tools de lectura y escritura para la API de Gavriel.
