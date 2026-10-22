# Changelog

Todas las versiones se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y el versionado
[SemVer](https://semver.org/lang/es/). Las notas de release en GitHub se
generan automáticamente desde los commits (conventional commits) al crear el
tag `vX.Y.Z`.

## [Unreleased]

### Added
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
