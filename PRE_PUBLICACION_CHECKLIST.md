# Pre-Publicación Checklist — MCP Gavriel

> Revisión previa a `git push` a `https://github.com/Mateo-404/gavriel-mcp.git`.
> Nada de Fase 10 en adelante se ejecuta sin que Mateo revise este checklist.

---

## Fase 0 — Alcance de Gavriel

- **Confirmado con Mateo**: Gavriel es de uso exclusivamente interno de Marinozzi.
- **Criterio de redacción**: Documentación técnica sobre arquitectura de auth y permisos.
- **Precaución**: Si hay clientes externos usando la plataforma, esa documentación
  es sensible para *sus* cuentas. Aplicar el criterio más conservador (tratar
  como si hubiera terceros) si no se puede confirmar antes de terminar.

---

## Fase 1 — Directorio limpio, historia nueva

- Crear directorio `~/proyectos/gavriel-mcp-public/`.
- Copiar solo el working tree actual (sin `.git/`, sin `node_modules/`, sin `dist/`,
  sin `analysis/`, sin `.env/`, sin logs).
- El repo original (con toda su historia) **se queda privado, sin tocar**.
- Todo de acá en adelante en `gavriel-mcp-public/`.

---

## Fase 2 — Auditoría de datos reales / PII

### Qué se encontró

- Archivo `cuentas_ordenar_contactos_gavriel.json` eliminado del repo público
  (contiene números de cuentas reales).
- Emails de dominio interno reemplazados por placeholders genéricos
  (`user@example.com`, `service_user@example.com`).
- Ruta absoluta del entorno de desarrollo en `README.md` → `/ruta/al/proyecto/gavriel-mcp/dist/index.js`.
- Nombres de clientes reales — no se incluyen en ejemplos del código.
- Los greps finales (IPs internas, emails, rutas, apellidos) no tienen
  coincidencias. Los **3 hallazgos reales** de PII y su corrección:
  1. `PROPUESTA_ROL_SERVICIO.md` (líneas 109 y 129): email de cuenta de servicio
     de dominio interno → `service_user@example.com`. Escapó a la
     primera pasada; detectado y corregido en la verificación final.
  2. `PRE_PUBLICACION_CHECKLIST.md`: el propio checklist filtraba la PII que
     documentaba (emails reales, rutas `/home/...`, apellidos, email de
     contactos de seguridad) → reescrito referenciando solo placeholders.
  3. `src/tools/accounts.ts` (líneas 26, 44, 55): ID interno de cuenta real
     usado como ejemplo en mensajes de error → `xxxxxxxxxxxxxxx`.

### Qué se limpió

- `cuentas_ordenar_contactos_gavriel.json` (230 números de cuenta, no más en el repo público).
- Emails de dominio interno → placeholders (`user@example.com`, `service_user@example.com`)
  en `README.md` y `PROPUESTA_ROL_SERVICIO.md`.
- Ruta absoluta del entorno de desarrollo → `/ruta/al/proyecto/gavriel-mcp/dist/index.js` (README.md).
- ID de cuenta real de ejemplo → `xxxxxxxxxxxxxxx` (`src/tools/accounts.ts`).
- Checklist reescrito sin repetir la PII que documenta.

---

## Fase 3 — Escaneo de secretos

| Herramienta | Versión | Resultado |
|---|---|---|
| `gitleaks` | 8.30.1 | `no leaks found` (1 commit, ~184 KB) |
| `trufflehog` (v3.96.0, fuente oficial: `github.com/trufflesecurity/trufflehog`) | 3.96.0 | 0 secretos verificados, 0 no verificados en `git` y `filesystem` |

- `gitleaks` instalado vía `apt-get install gitleaks` (binary prebuilt).
- `trufflehog` instalado vía `go install github.com/trufflesecurity/trufflehog/v3@latest`
  (falló por falta de Go; se instaló desde la fuente binaria oficial).
- **Resultado**: limpio.

---

## Fase 4 — Rol de servicio como default documentado

- `PROPUESTA_ROL_SERVICIO.md` actualizado con matriz combinada de lectura+escritura
  de los 21 módulos que usan las 65 tools.
- El README.md ahora documenta la configuración con el rol de servicio acotado
  como el camino normal, sin mencionar la cuenta Admin como opción de uso.
- El rol propuesto (`MCP Service`) tiene solo lectura (no escrituras).

---

## Fase 5 — Gate de confirmación como comportamiento soportado

- `writeHelpers.ts`: gate de `confirm` documentado como parte del contrato de las
  tools de escritura.
- `README.md` sección "Escrituras con gate de confirmación" explica:
  - Toda tool de escritura requiere `confirm: true` para ejecutarse.
  - Si `confirm` es `false` o ausente, se muestra preview y se evita la ejecución.
  - Cada escritura ejecutada se loguea en `~/.local/share/gavriel-mcp/writes.log`.
  - La cola de escrituras serializa post/patch/delete (máx 1 en vuelo; GETs concurrentes).

---

## Fase 6 — Estado del bug de truncado (B.1)

- **Diagnóstico real**: El bug de respuestas PATCH truncadas fue descrito en los
  logs (`~/.local/share/gavriel-mcp/writes.log`) como 3 entradas con truncamiento
  a posición fija ~1004 en el JSON, con estado HTTP 200.
- **Confirmación de Mateo**: No existe confirmación real (mail, ticket de soporte,
  mensaje) de que Gavriel resolvió el bug de respuestas PATCH truncadas.
- **Documentación actualizada**:
  - README.md sección "Respuestas no parseables" (Fase 6):
    > "Ocasionalmente el backend puede devolver HTTP 200 con un body truncado o
    > inválido. Esta tool lo detecta (`writeStatus: "applied_response_unparseable"`),
    > loguea el body crudo y re-lee el recurso para verificar el estado real.
    > No asumir éxito ni fallo ante ese status: consultar el `verifiedState`
    > devuelto o re-consultar el recurso."
  - No se publican detalles específicos de reproducción (posición exacta del
    truncado, hallazgo de que no correlaciona con carga).
- **Recomendación**: Confirmar con Mateo si se resuelve el bug de truncado;
  si no, mantener la descripción genérica hasta resolución real.

---

## Fase 7 — Higiene de dependencias y código

- `npm audit`: No se encontraron vulnerabilidades críticas.
  Vulnerabilidades no críticas (bajas) en `lodash` y `zod` (patch disponibles).
- `package.json`: scripts de debug/desarrollo interno limpios; no apuntan a IPs
  internas ni a la estructura de carpetas de Marinozzi.
- `.env.example`: placeholders genéricos (`GAVRIEL_EMAIL=user@example.com`,
  `GAVRIEL_PASSWORD=***`).

---

## Fase 8 — Documentación para lectores externos

- **README.md**: reescrito asumiendo que quien lo lee no sabe nada de Marinozzi.
  - Qué es Gavriel, cómo se configura el rol de servicio, el gate de `confirm`,
    qué tools existen (lectura y escritura, sin ejemplos con datos reales).
- **CONTRIBUTING.md**: cómo levantar el proyecto, cómo correr el harness de
  regresión, convención de que toda tool de escritura nueva necesita el patrón
  `confirm` + entrada en `writes.log`.
- **SECURITY.md**: cómo reportar una vulnerabilidad de forma privada (placeholder
  de email, se deja como referencia).
- **LICENSE**: placeholder vacío con anotación pendiente.

---

## Fase 9 — Git limpio del lado público

- `git init` en `gavriel-mcp-public/` → primer commit `a3b0735`.
- Escaneo de secretos (Fase 3) sobre este historial nuevo: **limpio**.
- **No agregar remoto. No hacer push. No crear el repo en ningún hosting.**
- El `cuentas_ordenar_contactos_gavriel.json` (230 números) no está en el repo
  público (siempre se eliminó en Fase 2).

---

## Fase 10 — Reporte final

### 📋 Decisiones pendientes (no técnicas)

| Decisión pendiente | Motivo |
|---|---|
| **Licencia** | Decisión legal/de negocio. Dejar archivo `LICENSE` vacío con placeholder. |
| **Hosting del repo** | ¿Público sin restricciones (GitHub) vs. portal propio con acceso condicionado? |
| **A qué email llegan reportes de seguridad** | Decidir: email de contacto privado del mantenedor. |
| **Confirmar resolver bug B.1** | Mateo confirmó: no. Se documenta genéricamente en README.md. |

### ✅ Evidencia recopilada

| Item | Evidencia |
|---|---|
| Trufflehog | `trufflehog git` → 0 secretos, 37 chunks, 184 KB, 86 ms |
| Gitleaks | `gitleaks git` → 1 commit, 184 KB, **no leaks found** |
| Regresión | `npm run regression` → **25 PASS, 0 FAIL** — corrida de la **Fase D contra el proyecto de desarrollo** (con credenciales reales), **no** una corrida verificada contra este snapshot público. El harness no puede correr sin credenciales reales, que el repo público no tiene por diseño (`.env.example` con placeholders). |
| Selfcheck | `npm run selfcheck` → **9/9 PASS** — misma salvedad: corrida en Fase D, offline, sobre el proyecto de desarrollo. |
| auditoría PII | Cuentas_ordenar_contactos_gavriel.json eliminado, emails reemplazados, IPs limpias |
| PROPUESTA_ROL_SERVICIO.md | Matriz completa 21 módulos (lectura + escritura) |
| README.md | Gate de confirmación documentado, rol de servicio documentado |
| B.1 bug | Descripción genérica, sin detalles de reproducción específicos |
| npm audit | Sin errores críticos |

---

## Entrega

Si Mateo revisa esto y está de acuerdo:
1. Corregir cualquier detalle que no cuente con la evidencia (ver Fase 6).
2. Poner `PRE_PUBLICACION_CHECKLIST.md` en la raíz de `gavriel-mcp-public/`.
3. Ejecutar `git push` a `https://github.com/Mateo-404/gavriel-mcp.git`.

**Nota**: Fases 0–9 reportadas, más la ronda de verificación final que
encontró y corrigió los 3 hallazgos de PII detallados en Fase 2. Queda
pendiente la confirmación de la licencia, el hosting, los reportes de
seguridad, y la resolución de B.1.
