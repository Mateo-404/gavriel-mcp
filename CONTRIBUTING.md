# Contributing

Thank you for wanting to contribute to **gavriel-mcp**.

## Getting Started

```bash
pnpm install
pnpm build
pnpm selfcheck   # starts the server against the environment and validates the handshake
pnpm dev         # runs from src using tsx (no prior build required)
```

Node >= 20 is required. We use **pnpm**; do not mix it with npm/yarn in the lockfile.

### Quick Development (optional)

If you have [Bun](https://bun.sh) installed, `pnpm run test:fast` runs the selfcheck faster for local iteration (Bun executes the same Node script more quickly). It does not replace `pnpm selfcheck` or the canonical CI path — that is what must pass before opening a PR.

## Conventions

* **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). These are used to generate automatic release notes.
* **Keep PR scope small.** One tool / one change per PR whenever possible.
* **No third-party runtime dependencies without review.** If a new feature introduces a `dependency`, justify it in the PR. Build-time dependencies (esbuild, postject, tsx, typescript) are already approved.

## Security

* Never commit secrets. The Gavriel token lives in the system keyring
  (or in `GAVRIEL_API_TOKEN`); the server reads it at runtime and does not
  store it in the repository.
* Writes (create/close/delete) go through a `confirm` gate (see
  `config.GAVRIEL_MCP_DESTRUCTIVE_APPROVAL`). Do not bypass it in code.

## Releases

* Versioning is manual SemVer in `package.json`.
* To publish: push a `vX.Y.Z` tag (a pushed tag triggers
  `.github/workflows/release.yml`). This workflow builds the single-executable
  binaries (Node.js SEA) for each platform and attaches them to the GitHub
  Release with `sha256` checksums.
* Do not publish to npm: the package is `private: true`. Distribution is via
  binaries in GitHub Releases.

## Structure

* `src/` — MCP server, client, tools.
* `scripts/` — `selfcheck.mjs`, `regression.mjs`, `build-bin.mjs` (SEA).
* `TIER3_PENDIENTE.md` — endpoints pending implementation.

Also consult `AGENTS.md` (agent rules) and `CHANGELOG.md`.
