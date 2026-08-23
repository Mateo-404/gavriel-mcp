# INFORME — Fallo de `update_account_contact` ("Expected ':' after property name in JSON")

**Fecha:** 2026-08-22 · **Autor:** investigación (sesión opencode) · **Alcance:** solo diagnóstico, no se modificó código ni datos.

---

## 1. Resumen ejecutivo

Las tools de escritura que devuelven respuestas **mayores a 1000 caracteres** (en particular
`update_account_contact`) fallan con errores de `JSON.parse` **después de que la escritura ya se
aplicó en el backend**. La causa raíz está en el servidor MCP, no en la API de Gavriel: la función
`summarize()` de `src/tools/writeHelpers.ts:145-150` intenta "reparar" un JSON truncado cortándolo
a ciegas en el byte 1000 y pegándole `'..."}'`, lo que casi siempre produce JSON inválido.

**Consecuencia crítica:** el agente recibe un error aunque la escritura fue exitosa → falso
negativo → riesgo de reintentos innecesarios o de abandono de flujos a medio hacer.

---

## 2. Síntoma observado (producción, 2026-08-23 ~00:16-00:17 UTC)

Tres `PATCH /account-contacts/{id}` (cambio de `order`) fallaron con:

```
Expected ':' after property name in JSON at position 1004 (line 1 column 1005)
Unexpected token '.', ...""","state":..."}" is not valid JSON
Expected ':' after property name in JSON at position 1000 (line 1 column 1001)
```

- Las posiciones de error (1000–1004) coinciden con el punto de corte de `slice(0, 1000)` más los
  caracteres agregados (`...`).
- El mismo error se reprodujo en reintentos, con `contactId` distintos → falla determinista del
  endpoint, no transitoria.
- En cambio, `add_account_note` (POST) ejecutado en la misma sesión funcionó OK.

---

## 3. Causa raíz

`src/tools/writeHelpers.ts` (idéntico en `dist/tools/writeHelpers.js`, que es lo que corre):

```ts
function summarize(data: unknown, maxLen = 1000): unknown {   // línea 145
  if (data === null || data === undefined) return data;
  const json = JSON.stringify(data);
  if (json.length <= maxLen) return data;
  return JSON.parse(json.slice(0, maxLen) + '..."}');          // ← BUG
}
```

Flujo del fallo en `requireConfirm()` (líneas 58–94):

1. `run()` ejecuta el PATCH → HTTP 2xx, respuesta parseada bien por `gavrielClient.requestInner()`.
2. Se arma la entrada de auditoría local con `responseBody: summarize(data)` (línea 91).
3. `summarize()` trunca el JSON serializado en 1000 chars y hace `JSON.parse()` de ese fragmento
   inválido → **lanza excepción**.
4. El `catch` de `requireConfirm` loguea `ok:false` con ese mensaje y **relanza**, ocultando que la
   escritura fue aplicada.

Es decir: **un helper de logging rompe escrituras exitosas.**

### Por qué `update_account_contact` falla SIEMPRE

El backend responde el contacto **con el objeto `account` embebido completo** (~1400+ chars,
verificado con `list_account_contacts`). Toda respuesta supera holgadamente los 1000 chars →
`summarize()` siempre trunca → siempre lanza.

### Por qué `add_account_note` funcionó

Su respuesta (nota creada) es < 1000 chars → `summarize()` devuelve `data` sin truncar.

---

## 4. Evidencia

### 4.1 `~/.local/share/gavriel-mcp/writes.log`

Cada llamada registra **dos líneas**: pre-ejecución y post-ejecución.

```
00:17:03.843  update_account_contact PATCH /account-contacts/cljxutg6j14mduexn9q {"order":3}   (enviado)
00:17:04.396  ... ok:false "Expected ':' after property name in JSON at position 1004"          (+553 ms)
00:17:10.201  update_account_contact PATCH /account-contacts/clkwam8qkujmduexn9q {"order":1}   (enviado)
00:17:10.744  ... ok:false "Expected ':' after property name in JSON at position 1000"          (+543 ms)
```

Los ~550 ms entre ambas líneas son el round-trip HTTP real: **el PATCH llegó al backend y volvió
2xx antes del throw**. El error ocurre en el post-procesamiento, no en la red ni en la API.

### 4.2 Estado real del backend tras los "errores"

Re-lectura de `/accounts/cl34fy6bcr8mduexn9q` contacts (solo lectura):

| Contacto | order esperado | order real | updatedAt |
|---|---|---|---|
| Fransico Picotto | 3 | **3 ✓** | 2026-08-23T00:17:04Z (= momento del PATCH "fallido") |
| Picotto Jose | 2 | **2 ✓** | 2026-08-23T00:16:43Z |
| Volkart Ethel | 1 | **1 ✓** | 2026-08-23T00:17:10Z (= momento del PATCH "fallido") |

**Los tres PATCH "fallidos" se aplicaron.**

### 4.3 Reproducción local (Node)

Truncar JSON válido en un byte arbitrario + pegar `'..."}'` produce exactamente esta clase de
errores de V8 (`Unexpected non-whitespace character after JSON...`, `Expected ':' after property
name...`), variando el mensaje según dónde caiga el corte — consistente con las posiciones
1000–1004 de producción.

### 4.4 Descartado

- **Serialización del request**: `gavrielClient.requestInner()` usa `JSON.stringify(body)` (correcto).
- **Cola de escrituras**: `enqueueWrite` serializa POST/PATCH/DELETE; no hay carrera.
- **Bug conocido de body truncado del backend** (documentado en AGENTS.md como
  `applied_response_unparseable`): es otro problema, correctamente manejado en `requireConfirm`
  líneas 62–82. Este informe documenta un **segundo bug, cliente y no manejado**.
- **Constraint unique(order)** mencionado en `gavrielClient.ts:269`: no interviene aquí (los
  updates fueron secuenciales y uno a uno también falla).

---

## 5. Impacto

| Ítem | Detalle |
|---|---|
| Alcance | **Todas** las tools de escritura cuya respuesta cruda > 1000 chars. `summarize()` solo se usa en `writeHelpers.ts:91`. `PATCH/POST /account-contacts` afectado **siempre** (embeddea account). Otros endpoints según tamaño de respuesta. |
| Integridad de datos | La escritura SÍ se aplica; el error es cosmético para el agente pero real en su toma de decisiones. |
| Riesgo principal | Falso negativo → reintentos redundantes (en esta sesión se reintentó 2 veces) o flujos abandonados a mitad (p. ej. contactos desplazados sin crear el nuevo). |
| Observabilidad | `writes.log` queda con `ok:false` para operaciones exitosas → contamina métricas/auditoría local. |
| No afectado | Lecturas, previews (`confirm:false`) y escrituras con respuesta corta. |

---

## 6. Fix recomendado (NO aplicado)

Nunca re-parsear JSON truncado a mano. Devolver el prefijo como dato, no como JSON:

```ts
function summarize(data: unknown, maxLen = 1000): unknown {
  if (data === null || data === undefined) return data;
  const json = JSON.stringify(data);
  if (json.length <= maxLen) return data;
  return { _truncatedPreview: json.slice(0, maxLen), totalLength: json.length };
}
```

Checklist sugerido:
1. Reemplazar `summarize()` (src + rebuild de `dist/`).
2. Agregar caso al `selfcheck`: respuesta simulada > 1000 chars no debe lanzar y debe marcar la
   escritura como `ok:true`.
3. Considerar subir `maxLen` o aplicar el truncado sobre el objeto (campos seleccionados), no
   sobre el string JSON.
4. Revisar `writes.log` histórico: entradas `ok:false` con mensaje de JSON.parse son candidatas a
   ser escrituras realmente aplicadas.

---

## 7. Estado final de los datos (cuenta 2492 — PICOTTO JOSE ATILIO)

A pesar del bug, el objetivo quedó cumplido:

1. Nota fija cargada vía MCP (`add_account_note`, id `cmt525m4x8mvlqk8e8ej3ysho`) con el
   instructivo de contacto y la transcripción de WhatsApp.
2. Órdenes desplazadas correctamente: Ethel=1, José=2, Francisco=3.
3. Contacto "Lorena Negro" en order 0 — **creado fuera de esta sesión MCP** (00:19:37 UTC,
   createdUserId = usuario logueado; presuntamente carga manual desde la app web). Teléfono
   normalizado por el backend a `3492638980` (sin formato +54) y descripción
   "Personal de la Casa (TEMPORAL)". Verificar si ese formato/descripción es el deseado.
