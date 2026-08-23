# Contributing

Gracias por querer aportar a **gavriel-mcp**.

## Cómo arrancar

```bash
pnpm install
pnpm build
pnpm selfcheck   # levanta el server contra el entorno y valida el handshake
pnpm dev         # corre desde src con tsx (sin build previo)
```

Requerís Node >= 20. Usamos **pnpm**; no mezcles con npm/yarn en el lockfile.

### Desarrollo rápido (opcional)

Si tenés [Bun](https://bun.sh) instalado, `pnpm run test:fast` corre el
selfcheck más rápido para iterar localmente (Bun ejecuta el mismo script Node
más veloz). No reemplaza `pnpm selfcheck` ni el camino canónico de CI — eso es
lo que hay que confirmar en verde antes de abrir un PR.

## Convenciones

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). Se usan para generar las
  notas de release automáticas.
- **Mantené el scope del PR chico.** Una herramienta / un cambio por PR cuando
  sea posible.
- **Sin dependencias de runtime de terceros sin revisión.** Si una feature
  nueva introduce un `dependency`, justificalo en el PR. Las de build-time
  (esbuild, postject, tsx, typescript) ya están aprobadas.

## Seguridad

- Nunca commitees secretos. El token de Gavriel vive en el keyring del sistema
  (o en `GAVRIEL_API_TOKEN`); el server lo lee en runtime, no se guarda en el
  repo.
- Las escrituras (crear/cerrar/eliminar) pasan por un gate de `confirm`
  (ver `config.GAVRIEL_MCP_DESTRUCTIVE_APPROVAL`). No lo saltees en código.

## Releases

- El versionado es SemVer manual en `package.json`.
- Para publicar: subí un tag `vX.Y.Z` (pushed tag dispara
  `.github/workflows/release.yml`). Ese workflow construye los binarios
  single-executable (Node.js SEA) por plataforma y los adjunta al Release de
  GitHub con checksums `sha256`.
- No publiques a npm: el paquete es `private: true`. La distribución es vía
  binarios en GitHub Releases.

## Estructura

- `src/` — servidor MCP, client, tools.
- `scripts/` — `selfcheck.mjs`, `regression.mjs`, `build-bin.mjs` (SEA).
- `TIER3_PENDIENTE.md` — endpoints pendientes de implementar.

Consultá también `AGENTS.md` (reglas de agentes) y `CHANGELOG.md`.
