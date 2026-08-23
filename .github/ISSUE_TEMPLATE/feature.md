description: Propuesta de mejora o nueva funcionalidad para el servidor MCP.
name: "Feature request"
title: "[feat] "
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problema / necesidad
      description: ¿Qué problema resuelve? ¿Por qué importa?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Propuesta
      description: Qué cambio sugerís (tool nueva, flag, comportamiento).
    validations:
      required: true
  - type: textarea
    id: scope
    attributes:
      label: Alcance y riesgos
      description: Endpoints afectados, breaking changes, consideraciones de seguridad.
    validations:
      required: false