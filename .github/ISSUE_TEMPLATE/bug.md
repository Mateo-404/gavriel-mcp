description: Reporte de un bug o comportamiento incorrecto del servidor MCP.
name: "Bug report"
title: "[bug] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Gracias por reportar. Completá los campos que apliquen; lo que no
        tengas, dejalo en blanco. No pegues secretos ni tokens.
  - type: textarea
    id: what
    attributes:
      label: Qué pasó
      description: Comportamiento observado vs. esperado.
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Pasos para reproducir
      placeholder: |
        1. Configuré X
        2. Llamé a la tool Y con args Z
        3. Obtuve ...
    validations:
      required: false
  - type: input
    id: version
    attributes:
      label: Versión
      description: Salida de `gavriel-mcp --version` o del tag del Release.
    validations:
      required: false
  - type: textarea
    id: logs
    attributes:
      label: Logs relevantes
      description: Logs en ~/.local/share/gavriel-mcp/ (quitar datos sensibles).
      render: shell
    validations:
      required: false