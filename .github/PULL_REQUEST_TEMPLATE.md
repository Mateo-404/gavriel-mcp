description: Plantilla de Pull Request para gavriel-mcp.
name: Pull Request
body:
  - type: markdown
    attributes:
      value: |
        Antes de abrir el PR, corré localmente:
        `pnpm build && pnpm typecheck && pnpm selfcheck`.
  - type: textarea
    id: what
    attributes:
      label: Qué cambia
      validations:
        required: true
  - type: checkboxes
    id: checks
    attributes:
      label: Checklist
      options:
        - label: "`pnpm build` y `pnpm typecheck` pasan"
        - label: "`pnpm selfcheck` pasa"
        - label: Sin secretos ni tokens en el diff
        - label: CHANGELOG.md actualizado (si es user-facing)
  - type: input
    id: issue
    attributes:
      label: Issue relacionado
      placeholder: "#123"