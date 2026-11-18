# Gavriel Tools: plan de arquitectura, optimización y poda de tests

## Contexto
La extensión (Chrome MV3, TypeScript + Bun, v0.20.0, rama `gavriel-extension`) ya funciona bien en producción. Creció por pedidos sueltos durante semanas: 6,8 k líneas en `src/` (`content/shortcuts.ts` sola tiene 1.093), 48 archivos de prueba y 331 tests (4,3 k líneas, algunos frágiles por tiempos), y cada ajuste nuevo hay que tocarlo en 5 lugares. El usuario pide tres cosas: máximo rendimiento, una arquitectura clara y menos tests. Este documento es la guía para el modelo que lo va a ejecutar. **No cambia ningún comportamiento visible**: es un refactor con mediciones.

## Reglas que no se negocian (leer antes de tocar nada)
- **Gestor de paquetes:** Bun; si no hay Bun, pnpm. Nunca npm ni yarn.
- **Token de Gavriel:** solo lo usa `src/content/gavriel-api.ts`, en memoria del mundo MAIN, para `GET` a `/api/accounts?…` y `/api/account-contacts?accountId=…` (allowlist `ALLOWED_PATH`). Nunca se guarda, nunca cruza al mundo aislado, nunca se loguea. Ninguna otra parte lo lee.
- **Cuentas y teléfonos:** no hacer llamadas reales ni cambiar el estado de una cuenta (abrir una cuenta puede dejarla «en intervención»). El único teléfono de prueba permitido es el del usuario (342-537-0985), solo desde el marcador y pidiendo confirmación antes. Nunca usar contactos de clientes.
- **Privacidad:** no exportar datos de clientes fuera del navegador.
- **Git:** commits con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca hacer push sin permiso; para pedirlo, dar el comando `git push origin gavriel-extension`.
- **Herramientas:** heredoc, `sed` y `node -e` rompen las barras y las comillas, así que para editar se usan Write y Edit. Sin Python.
- **Al cerrar cada fase:** `bun run check` en verde, un bump de versión patch o minor en `package.json` (el build lo propaga al manifest), una línea en el README y un commit por fase.
- **Si una fase no da la mejora medida, se revierte.** Ningún cambio de rendimiento entra sin el número de antes y el de después.

## Arquitectura actual (resumen)
- **Mundo MAIN** (`content/mute.js`, al inicio del documento): `mute.ts` instala:
  - el silenciador de sonidos;
  - `net-tap.ts`: lee en copia las respuestas que Gavriel ya trae (llamadas, cuenta, eventos pendientes) y guarda en memoria la cabecera de sesión;
  - `sip-bridge.ts`: colgar, atender, rechazar, mute y número de quien llama;
  - `gavriel-api.ts`: los GET propios del índice;
  - `push-guard.ts`, `rtc-fix.ts` (SDP de las llamadas entrantes) y `mic.ts`.
- **Mundo aislado:**
  - `bridge.js` (inicio del documento): pasa los ajustes a atributos `data-gv-*` de `<html>`.
  - `main.js` (`account.ts` + `shortcuts.ts`): **un solo observador del DOM** (`runtime.ts` `watchDom`) que llama a `decorate()` en cada cambio, con 150 ms de agrupado.
- **Fondo** (`background.ts`): reglas DNR (cache, fonts, push), notificaciones, `media-router.ts` y `action-gate.ts`.
- **Pestañas de música:** `music.js`.
- **Canales entre mundos:** tres canales de `CustomEvent` hechos a mano, cada uno con su propio id y su timeout: SIP (`sip.ts`), TAP (`net-tap`) y GAPI (`account-index.ts` `createApiRequester`).

---

## Fase 0: línea de base (medir antes de tocar)
1. Agregar `scripts/measure.ts` (Bun): imprime el tamaño de cada JS de `dist/` (crudo y gzip) y la cantidad de tests y el tiempo de `bun test`.
2. En el Chrome real, con claude-in-chrome y solo lectura en `/monitoring-panel` y en una cuenta ya abierta, medir con `performance.now()` alrededor de `decorate()`. Exponer un contador temporal en `<html data-gv-perf>`, detrás de `?gvperf` o de un ajuste oculto. Registrar ms por pasada, pasadas por minuto con el panel en reposo y heap (`performance.memory`).
3. Guardar los números en `docs/perf-baseline.md`. Son la referencia de todas las fases.

## Fase 1: arquitectura por features (sacarle peso a `shortcuts.ts`)
**Problema:** `content/shortcuts.ts` mezcla teclado, indicadores, ronda, tarjeta de llamada, música, índice, diálogos y ajustes. Cada feature nueva se cuelga en tres lugares: `decorate()`, `onKeyDown` y `storage.onChanged`.

**Diseño:** una interfaz chica y un registro.
```ts
// src/content/feature.ts
export interface Feature {
  id: string;
  setting?: keyof Settings;               // interruptor que la prende o apaga
  paint?(ctx: PaintCtx): void;            // en cada pasada del observador
  key?(e: KeyboardEvent, ctx: KeyCtx): boolean; // true = consumió la tecla
  setEnabled?(on: boolean): void;
}
```
- `PaintCtx` es una **foto por pasada**: `buttons` (un solo `querySelectorAll('button')`), `dialogOpen`, `modalOpen`, `accountId`, `isCalling`, `eventsActive`. Hoy `buttons()` (`shortcuts.ts:148`) se recorre varias veces en cada pasada. La foto se calcula una vez y se pasa a todas las features.
- `shortcuts.ts` queda como orquestador de menos de 200 líneas: arma el contexto, recorre las features en orden fijo y lee los ajustes una sola vez con un solo `onChanged`.
- Features a extraer, sin cambiar su lógica: `badges` (indicadores Alt/Ctrl), `events-nav`, `filters` (`panel-actions`), `dialogs` (`dialog-confirm` y el fin de intervención), `calls` (atajos de llamada, `call-card`, `call-mute`, `call-round`), `music` (`media-bar` y Ctrl+Espacio), `account-index` (índice, desplegable y cartel de llamada entrante), `dial-input` y `last-contact`.
- **Orden de los atajos:** hoy es implícito por la posición dentro de `onKeyDown`. Se vuelve explícito con un arreglo ordenado de features. Ctrl+Espacio y los dígitos del marcador van primero.
- **Aceptación:** mismo comportamiento (los tests DOM que se conservan pasan sin cambios en sus aserciones) y `decorate` por pasada igual o más rápido que en la Fase 0.

## Fase 2: un solo puente entre mundos
**Problema:** tres implementaciones de pedido y respuesta por `CustomEvent`: `sip.ts`, `createApiRequester` y el replay de `net-tap`.

**Diseño:**
- `src/shared/page-rpc.ts`, con `createRpcClient(channel, timeoutMs)` del lado aislado y `serveRpc(channel, handlers)` del lado MAIN. Ids, timeouts, JSON y limpieza de oyentes en un solo lugar.
- `sip-bridge`, `gavriel-api` y el replay de `net-tap` pasan a ser handlers.
- `gavriel-api` conserva **su allowlist y la regla del token**: el handler recibe la ruta, nunca devuelve cabeceras.
- Ganancia: unas 120 líneas menos y un solo lugar donde auditar qué cruza de un mundo al otro.

## Fase 3: ajustes declarativos (un ajuste = una línea)
**Problema:** agregar un ajuste hoy toca `constants.ts` (tipo y defecto), `storage.ts` (normalización), `options.ts` (tres listas) y `options.html`.

**Diseño:**
- `src/shared/settings-schema.ts`: un arreglo con `{ key, default, kind: 'bool' | 'list', section, label, help }`.
- De ahí salen el tipo `Settings` (con `as const` y tipos mapeados), `DEFAULT_SETTINGS`, `normalize()` en `storage.ts` y los interruptores de Opciones, que `options.ts` renderiza en cada `<section>` según `section`.
- `options.html` queda con las secciones y los textos largos; los `<label class="row">` se generan.
- **Aceptación:** la página de Opciones se ve igual (comparar con una captura antes y después) y los ajustes guardados por los usuarios se siguen leyendo, con las mismas claves.

## Fase 4: optimizaciones concretas (cada una con medición)
| # | Caso | Cambio | Dónde |
|---|------|--------|-------|
| 4.1 | `decorate` vuelve a escanear todos los botones varias veces por pasada | Foto única por pasada (Fase 1). Además, salir enseguida si la pestaña está oculta (`document.hidden`) | `content/shortcuts.ts`, `runtime.ts` |
| 4.2 | El observador del DOM despierta con cada mutación de React, incluso las del panel de eventos que no nos importan | Filtrar en `hasForeignChange` los registros cuyo `target` está dentro de nuestros nodos o de zonas que nunca miramos. Medir pasadas por minuto antes y después | `content/runtime.ts` |
| 4.3 | `music.ts` lee el reproductor cada 3 s aunque no cambie nada | Sondear solo con la pestaña visible o mientras suena; si está pausado y oculto, cada 15 s. Los eventos `play`/`pause`/… ya cubren lo inmediato | `content/music.ts:221` |
| 4.4 | El índice guarda el objeto entero (~1.843 cuentas con contactos) en `chrome.storage.local` cada 150 contactos, y `onChanged` manda ese objeto **a todas las pestañas** en cada guardado | Separar en `accountIndexMeta` (`updatedAt`, `complete`, `count`), que es lo que se escucha, y `accountIndexData`, que se lee solo cuando cambia la meta. Datos compactos en arreglos (`[id, número, nombre, estado, teléfono, [[nombre, tel, tel2]…]]`). Medir el tamaño en bytes antes y después | `content/account-index.ts` (`chromeIndexStore`) |
| 4.5 | `buildIndex` normaliza todo de nuevo con cada `reload` | Reconstruir solo si cambió `updatedAt` o `count` | `account-index.ts` |
| 4.6 | El candado del índice dependía de tiempos (bug real que ya se vio) | Reemplazarlo por `navigator.locks.request('gv-account-index', { ifAvailable: true })`. Cerrar la pestaña libera el candado sin vencimientos. Si no existe la API, se conserva el candado actual | `account-index.ts` |
| 4.7 | `declarativeNetRequestFeedback` y `diagnoseFonts` son de depuración y la permiso agrega una advertencia | Sacar el permiso y `diagnoseFonts`/`onRuleMatchedDebug` del build de producción (dejarlos detrás de `process.env.GV_DEBUG` en `build.ts` con `define`) | `static/manifest.json`, `src/background.ts:16-47`, `build.ts` |
| 4.8 | CSS: `shortcuts.css` (18 KB) se inyecta entero en todas las pantallas | Pasar el CSS por el minificador de Bun en el build. Revisar reglas muertas: las de clases de Gavriel que ya no existen | `build.ts`, `static/content/shortcuts.css` |
| 4.9 | `main.js` pesa 64 KB y se parsea en cada carga | Después de la Fase 1, comprobar con `measure.ts` que no se duplican helpers. Meta: menos de 55 KB minificado, sin partir en más scripts (un solo script fue una decisión tomada) | `build.ts` |
| 4.10 | Atributos de diagnóstico (`data-gv-index`, `data-gv-net`) escritos en cada cambio | Escribirlos solo si el valor cambió | `account-index.ts`, `shortcuts.ts` |

Fuera de alcance, porque no se puede resolver del lado del cliente: la lentitud de `/api/accounts/<id>` (1,3 s) y `/api/events` (1,5 s) es del servidor de Gavriel. Ya se diagnosticó.

## Fase 5: poda de tests (de 331 a unos 150, de 48 a unos 25 archivos)
**Criterio:** se conserva lo que protege contra regresiones caras o de seguridad; se saca lo que repite la misma lógica en dos niveles, verifica texto de CSS o del manifest con expresiones regulares, o depende de tiempos.

- **Se conservan** (consolidados por tema):
  - **Lógica pura:** `account-search` (puntajes y parsers), `call-round` (estado, solo la versión unitaria), `contact-card`/`labels` (parser de contactos), `gavriel-data`, `event-alerts`, `media` (`nextTab`/`sameMedia`), `dedupe`, `storage` (normalización, que con la Fase 3 pasa a testear el esquema).
  - **Seguridad y puentes:** `gavriel-api` (allowlist, el token nunca sale, solo GET), `sip-bridge` (no cuelga «por las dudas»), `push-guard`, `rtc-fix` (`sanitizeSdp`).
  - **Integración:** **un** test DOM por feature crítica (ronda: avance y colores; diálogo: Ctrl+Enter con «.» y la acción posterior; índice: armado con 429 y candado; desplegable; marcador), más `bundle-smoke`.
  - **e2e:** se queda como está (`node e2e/gavriel-cache-sounds.mjs`), corrido a mano antes de cada versión minor.
- **Se borran o fusionan:**
  - `loading-bar-css.test.ts`, `icons.test.ts`, `manifest.test.ts` y `manifest-targets.test.ts`: se reemplazan por **una** verificación en `build.ts` que falla el build si el manifest no tiene los rulesets o los permisos esperados.
  - `fonts-rules`, `cache-rules` y `sound-rules`: se fusionan en `rules.test.ts`, con un caso por ruleset.
  - `console-filter`, `client-message`, `routes` y `sounds`: se juntan en `small-utils.test.ts`, o se borran si son una línea trivial.
  - El duplicado unitario más DOM de `call-round`, `dialog` y `dialog-confirm`: queda uno de cada par.
  - Todo test que use `setTimeout` reales con márgenes chicos (ejemplo: `retryFor` en `dialog-confirm.test.ts`): se reescribe con reloj falso (`sleep`/`now` inyectados, como ya hace `account-index`) o se borra.
- **Aceptación:** `bun test` por debajo de 1,5 s, sin tests que fallen de forma intermitente, con la misma cobertura de los puntos críticos de la lista. Antes de borrar un archivo, comprobar que cada comportamiento crítico que cubre quede cubierto en otro lado.

## Orden de ejecución y versiones
1. Fase 0 (sin versión: solo docs y script).
2. Fase 5 primero en lo trivial (fusiones y borrados de CSS y manifest), para que los refactors corran sobre una suite rápida. Versión 0.20.1.
3. Fase 2, puente único. Versión 0.21.0.
4. Fase 1, features. Versión 0.22.0.
5. Fase 3, esquema de ajustes. Versión 0.23.0.
6. Fase 4, una optimización por commit y con su número en el mensaje. Versiones 0.23.x.
7. Cierre: actualizar el README (sección «Arquitectura» con el diagrama de mundos y features) y `docs/perf-baseline.md` con el antes y el después.

## Archivos críticos
`src/content/shortcuts.ts`, `src/content/runtime.ts`, `src/content/account-index.ts`, `src/content/gavriel-api.ts`, `src/content/sip.ts`, `src/content/sip-bridge.ts`, `src/content/net-tap.ts`, `src/content/music.ts`, `src/shared/constants.ts`, `src/shared/storage.ts`, `src/options/options.ts`, `static/options/options.html`, `static/manifest.json`, `src/background.ts`, `build.ts` y `test/**`.

## Verificación
- **En cada commit:** `bun run check` (tsc, tests y build).
- **Antes de cada versión minor:**
  - correr `bun run e2e`;
  - en el Chrome del usuario, después de que recargue la extensión, con claude-in-chrome y solo lectura:
    - en el panel: flechas, Alt+N, filtros Alt+Q…, Esc y el reproductor;
    - en una cuenta **ya abierta por el usuario**: indicadores, ronda (sin llamar), Esc para volver;
    - en Cuentas: el desplegable del índice (`data-gv-index` en «completo»);
    - Ctrl+Espacio con Spotify abierto.
- **Rendimiento:** repetir la medición de la Fase 0 y anotar el antes y el después en `docs/perf-baseline.md`. Una fase que empeora algún número se revierte.
- **Push:** no hacer push. Al final, dar al usuario `git push origin gavriel-extension`.
