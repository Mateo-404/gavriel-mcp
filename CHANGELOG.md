# Changelog

Todas las versiones se documentan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y el versionado
[SemVer](https://semver.org/lang/es/). Las notas de release en GitHub se
generan automáticamente desde los commits (conventional commits) al crear el
tag `vX.Y.Z`.

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
