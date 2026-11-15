# Gavriel Tools

Extensión de Chrome (Manifest V3, TypeScript, compilada con [Bun](https://bun.sh)) con herramientas extra para
[app.gavriel.com.ar](https://app.gavriel.com.ar). Solo actúa sobre ese dominio.

## Qué hace

**Silenciar sonidos de Gavriel.** En cualquier pantalla, bloquea en la red los sonidos que cada usuario elija en el popup (el ícono de la extensión, que maneja solo el sonido): con `declarativeNetRequest` el navegador ni descarga `/sounds/<nombre>.mp3`, así que no se gasta ancho de banda (en una prueba, 15 descargas y 838 KB en pocos minutos) y Gavriel solo anota un error en su consola, que su propio código atrapa. Como respaldo, `mute.ts` también silencia el audio si llegara a reproducirse. Por defecto: `alarm`, `siren` y `beep`. Si Gavriel reproduce un sonido nuevo, aparece en la lista (sin bloquearse) para que se elija. Las llamadas, las grabaciones y cualquier otro audio no se tocan. Los eventos siguen apareciendo en pantalla, y solo se bloquea en el navegador de quien instala la extensión.

**Atajos de teclado.** Los indicadores `Alt+N` solo se ven mientras se mantiene `Alt` y van dentro de cada componente, sin flotar encima:

| Atajo | Acción |
| ----- | ------ |
| `↑` `↓` `←` `→` | En el panel de monitoreo recorren los eventos. La primera flecha marca siempre el primer evento de la columna de la izquierda; `↓`/`↑` bajan y suben por la columna y `←`/`→` pasan a la columna vecina. También funcionan con `Shift`. La tarjeta marcada se ve con un anillo lila, resplandor y la etiqueta «Enter para abrir». `Enter` abre el evento marcado y `Esc` quita la marca. No intervienen al escribir en un campo, dentro de un menú o con un diálogo abierto. |
| `Alt` + `1…9` | **En el panel:** abre el evento N (columna por columna: primero todos los de NUEVO, después los de la columna siguiente). **En una cuenta:** llama al contacto en esa posición de la lista (1 = el primero), desde cualquier pestaña. Nunca llama a Jurisdicción ni al 911. |
| `Alt` + `Shift` + `1…9` | **En el panel:** activa o desactiva el filtro N por tipo de evento (los botones de colores bajo el buscador, de izquierda a derecha). Alternativa sin `Shift` (por si `Alt`+`Shift` te cambia el idioma del teclado): `Alt`+`Q`, `W`, `R`, `T`, `Y`, `U`, `I`, `O`, `P` (se saltean E, D y F porque Chrome las usa con `Alt`). Los indicadores `Alt+⇧N · Alt+Q` se ven al mantener `Alt`. Con un filtro activo, `Ctrl`+`Enter` aprieta **Procesar masivo** y abre el diálogo «Cerrar Intervenciones Masivamente»; ahí, otro `Ctrl`+`Enter` **sin motivo escrito** pone «.» como motivo y cierra los eventos (con un motivo escrito se respeta y solo confirma). Lo mismo en «Dejar en observación»: sin comentario escrito, `Ctrl`+`Enter` pone «.» y confirma, y `Esc` aprieta **Limpiar filtros** (si no hay una tarjeta marcada con las flechas). |
| Mantener `Alt` | Muestra los atajos Alt+N y, en una cuenta, abre el menú de contactos; al soltar `Alt` se cierra. Un toque rápido no hace nada. |
| `Alt` + `Enter` | En una cuenta: **ronda de llamadas**. Llama al siguiente contacto de emergencia tildado; si hay una llamada en curso, la corta, espera 5 s y llama al siguiente. |
| `Alt` + `M` | Durante una llamada: silencia o reactiva tu micrófono (la pista de audio que Gavriel ya abrió; la llamada no se toca). También hay un botón de micrófono a la izquierda del teléfono flotante que se pone rojo al silenciar. Al cortar, el micrófono vuelve a quedar activo para la próxima llamada. |
| Escribir números | Con el softphone abierto en «Marcador», los dígitos 0-9 que escribís (sin Ctrl/Alt/Shift) van al campo «Número…» aunque no hayas hecho clic en él. Solo números: letras y demás teclas no se escriben ahí. Si hacés clic en el campo, escribís como siempre. |
| `Alt` + `C` | En una cuenta, copia al portapapeles (al instante, desde los datos de la cuenta que Gavriel ya trajo; si no llegaron, lee la pantalla) el mensaje para el cliente: `Estimado/a cliente: *MERLO FERNANDO*` y, en otra línea, `Alarma de: *J. M. NOLLI 1820, RAFAELA · Santa Fe*` (nombre de la cuenta y dirección de «Localización y contacto»). |
| `Alt` + `Shift` | En una cuenta, **copia al portapapeles el nombre de la última persona a la que llamaste** (por ejemplo `Pablo Perren`, sin el teléfono ni la descripción). **Instantáneo y sin tocar la pantalla:** lee del historial de llamadas (`/api/sip/calls`) que Gavriel ya trae al abrir la cuenta, busca el teléfono marcado entre los contactos de la cuenta (`/api/accounts/<id>`) y copia su nombre; una llamada hecha desde esta pestaña después de abrir la cuenta también cuenta. La extensión no hace pedidos propios ni usa el token: solo lee una copia de esas dos respuestas (`net-tap.ts`, en el mundo de la página). Si esos datos no están (cuenta recién abierta o un número que no es de un contacto), usa el respaldo de siempre, que sin tocar nada abre «Búsqueda avanzada», desmarca «Ocultar operación (intervención, llamadas…)» si hace falta, lee la descripción «Contacto vía Teléfono a …» del evento más reciente y deja el panel y el filtro como estaban. Tarda menos de un segundo. Ojo: en Windows, `Alt`+`Shift` también cambia el idioma del teclado si tenés más de uno instalado (se desactiva en Configuración → Hora e idioma → Teclado). |
| `Esc` en un diálogo / en una cuenta | **Diálogo abierto:** aprieta su botón de salida («Cancelar» o «Cerrar»), también mientras escribís; si no tiene, lo cierra Gavriel como siempre. **Cuenta abierta sin diálogo:** aprieta «Volver a panel» (no actúa si escribís, con un menú abierto o en pantalla completa). En el panel, `Esc` sigue quitando la marca de la tarjeta y limpiando filtros. Sus indicadores `Esc` se ven dentro de cada botón. |
| `Ctrl` + `Enter` en un diálogo | Con un diálogo abierto (Cerrar intervención, Dejar en observación, Procesar masivo, etc.) aprieta su **botón principal** (el verde o rojo, no «Cancelar»), también mientras escribís. Si el botón está deshabilitado (faltan campos) no fuerza nada y avisa. Tiene prioridad sobre el resto de los `Ctrl`+`Enter`. Solo diálogos modales con un único botón principal; ante la duda no hace nada. |
| `Ctrl` + `Enter` | Corta la llamada en curso; si hay una entrante, la atiende; si hay un número en el marcador, llama. **Sin nada de eso, en una cuenta intervenida abre «Cerrar intervención» y deja el cursor en «Resolución»** (el diálogo de Gavriel manda el foco a «Categoría»; la extensión lo mueve). Confirmar el cierre sigue siendo manual: el botón queda deshabilitado hasta completar categoría y resolución. No interviene si escribís en un campo ni con un diálogo abierto. |

**Tarjeta de llamada.** Al llamar a un contacto (con atajo, mouse, menú del teléfono o marcador) flota sobre el botón del teléfono una tarjeta chica con su nombre y descripción. No recibe clics, se va sola al cortar y vuelve con el siguiente contacto. Se apaga en Ajustes.

**Panel más tranquilo.** En Ajustes, «Panel de monitoreo»: oculta la barra naranja «Alerta sonora · N pendientes» quita el tinte de color de las tarjetas de eventos (queda la franja izquierda con el color del tipo) y oculta el botón de la vista Grilla (Kanban y Mapa quedan). Es solo CSS activado por atributos de <html>; no toca datos ni sonidos.

**Ajustes.** Todo lo que no es sonido se maneja en una página propia: botón **Ajustes** del popup, o clic derecho en el ícono → *Opciones*. Ahí se activan o desactivan los atajos (con la lista completa y en qué pantalla funciona cada uno), las opciones de cuenta y un botón para restablecer. Se guarda al instante.

**Al abrir una cuenta** (se puede desactivar cada cosa en Ajustes): entra directo a la pestaña **Contactos** y toca el ojito de **Clave** y **Contraclave**. Se aplica una sola vez por cuenta y solo si el botón existe: Gavriel dibuja el ojito únicamente si tu usuario tiene permiso para ver la clave.

Caché de los archivos de Gavriel (Ajustes → Panel de monitoreo, activado por defecto): el servidor pide `no-store` para todo, incluso para los archivos con hash en el nombre (`/assets/index-XXXXXXXX.js`), así que cada recarga bajaba ~1,6 MB y el navegador recompilaba el JS. Una regla estática de `declarativeNetRequest` cambia solo la cabecera de esos archivos a `public, max-age=31536000, immutable`. Como el nombre cambia con cada versión de Gavriel y la página principal sigue sin guardarse, nunca se ve una versión vieja. Pide el permiso del sitio en Chrome (`host_permissions`).

Colgar, atender y rechazar al instante: `Ctrl`+`Enter` ya no recorre la interfaz (abrir el panel flotante, cambiar a «Marcador», apretar «Colgar»: hasta ~1 s y un parpadeo). Gavriel guarda la sesión de JsSIP en `SipProvider` y publica por contexto de React `hangup`, `answer`, `reject`, `call`…; el botón «Colgar» es literalmente `onClick: e.hangup`. La extensión (`sip-bridge.ts`, en el mundo de la página) encuentra ese objeto subiendo por los fibers de React desde el `<audio>` oculto del proveedor y llama a la misma función; solo actúa si hay una llamada en curso (o entrante, para atender/rechazar). Si no lo encuentra, usa el camino por la interfaz de siempre. **Llamar a un contacto no se hace por ahí**: el botón de cada contacto primero registra la llamada en la auditoría de la cuenta y recién después llama, así que se sigue usando el clic real.

Abrir una cuenta más rápido (Ajustes → Panel de monitoreo, activado por defecto): al abrir una cuenta, Gavriel pide `GET /api/accounts/<id>` (360 KB sin comprimir, ~1,1 s) y, cuando termina, lo vuelve a pedir idéntico (~1,5 s); la tarjeta «Localización y contacto» espera a ese segundo pedido. Medido: la cascada completa tarda ~5 s y la tarjeta aparece recién a los ~4,9 s. La extensión responde el segundo pedido idéntico desde memoria (`net-tap.ts` + `xhr-dedupe.ts`, con los mismos estados y eventos que un XHR real; probado con axios real en Chrome). Salvaguardas: solo `GET` de la cuenta y respuestas 2xx, 10 s de vida, la clave incluye la sesión (cabecera Authorization), cualquier escritura (POST/PUT/PATCH/DELETE) a `/api/` descarta todo, y no se devuelven cabeceras de renovación de token viejas.

Tipografías locales (Ajustes → Panel de monitoreo, activado por defecto): Gavriel pide su CSS de Geist a `fonts.googleapis.com` antes de dibujar la pantalla (Lighthouse/DevTools lo marca como bloqueo del primer dibujado, ~0,4 s) y luego dos archivos a `fonts.gstatic.com`. Ahora no se hace ningún pedido a Google: una regla de `declarativeNetRequest` bloquea ese CSS (falla al instante) y el script de arranque (`fonts.ts`, `document_start`) inyecta el mismo `@font-face` apuntando a copias dentro de la extensión (`static/fonts/`, Geist y Geist Mono, subconjuntos latin y latin-ext, 84 KB, SIL Open Font License 1.1). Los archivos son locales, así que no hace falta cachearlos. Probado en Chrome real con las cabeceras de aislamiento (`COOP`/`COEP`) que usa Gavriel. Sin permisos extra sobre Google. Detalle encontrado con un registro de red (`chrome://net-export`): en perfiles con historial Chrome precarga ese CSS por su cuenta antes de que la página lo pida, con `sec-fetch-dest: empty` (tipo «other» para las reglas), no como hoja de estilo; por eso la regla bloquea también los tipos `other`, `xmlhttprequest` y `font` para esa URL.

Modo ahorro de recursos (Ajustes → Panel de monitoreo, activado por defecto): sin desenfoque detrás de los diálogos (obliga a la GPU a rehacer el fondo en cada cuadro), sin las animaciones que nunca paran (campana de eventos nuevos y parlante que suena). Los scripts de contenido ya no se inyectan en los iframes. También descarta los ~440 mensajes de depuración con emoji que Gavriel escribe en cada actualización (Chrome los guarda en memoria aunque las herramientas de desarrollo estén cerradas; `warn` y `error` pasan siempre).

Ronda de llamadas: en «Contactos de emergencia» cada tarjeta tiene un tilde (todos tildados al entrar a la cuenta) y cambia de color: verde llamando ahora, amarillo llamado una vez, rojo dos, atenuada si la destildás. Una barra sobre la lista muestra la ronda («Ronda 1 de 2 · 3/8 llamados») y tiene «Reiniciar ronda». `Alt+Enter` avanza en orden (dos rondas como máximo y luego avisa «Ronda terminada»); `Alt+N` reintenta a mano a un contacto sin mover la ronda. El estado es por cuenta y vive en memoria (se pierde al recargar la página). Se apaga en Ajustes → Ronda de llamadas.

Avisos por tipo: notificaciones del sistema para BUR (robo), POW (corte de energía), PAN (pánico), MED (médica) e INC (incendio), cada tipo con su interruptor en Ajustes y un botón «Probar aviso». Salen de comparar las respuestas sucesivas de eventos pendientes que la página ya recibe (la primera es la base; las restauraciones no avisan; máximo 5 por 30 s y luego un resumen). No usa el token. Requiere una pestaña de Gavriel abierta; permiso nuevo: `notifications`.

Música: si hay Spotify Web (`open.spotify.com`) o YouTube Music (`music.youtube.com`) abiertos en otra pestaña, aparece un reproductor en la barra, junto a «Tiempo real» (en el resto de las pantallas, solo en la barra de arriba) (anterior, pausa, siguiente, volumen, silencio, progreso, cambiar de reproductor). Lee `navigator.mediaSession` y el elemento de audio. No controla la app de escritorio de Spotify. Los selectores de los botones pueden romperse si los sitios cambian.

Música abierta antes que Gavriel: al abrir Gavriel (o al instalar/recargar la extensión) el fondo busca las pestañas de Spotify Web y YouTube Music por su dirección, les pide que informen su estado y, si alguna estaba abierta antes de la extensión y no tiene el script, se lo inyecta (permiso `scripting`). Una pestaña abierta se muestra aunque esté en pausa hace horas; una cerrada desaparece.

Animaciones: vienen apagadas por defecto (interruptor en Ajustes, `data-gv-noanim`): sin transiciones ni animaciones, sin desenfoques (`backdrop-filter`) ni `will-change`; solo quedan los indicadores de carga. Incluye al reproductor.

Rendimiento: el build sale minificado (de 66 KB en cuatro scripts a 32 KB en tres), con un único content script para cuenta y atajos; todos comparten un solo observador del DOM (que ignora lo que dibuja la extensión y se pausa con la pestaña oculta), una sola lectura de ajustes y, en Chrome, la Navigation API en lugar de sondear la URL. El JS sale moderno (ES más nuevo, Chrome 120 o más) y TypeScript compila con `target: ESNext`.

Compatibilidad con otras herramientas: los indicadores (`Ctrl+Enter`, `Esc`, `Alt+N`…) no agregan texto a los botones; el texto lo dibuja el CSS (`::after` de un atributo). Un botón sigue valiendo exactamente lo que dice (por ejemplo `normalize-space(.)='Cerrar Intervención'` en un XPath de otra extensión de macros).

Protecciones: ignora teclas repetidas, `AltGr`, `Shift`/`Meta`; bloquea llamadas dobles durante 1,5 s; no llama si ya
hay una llamada en curso ni con un menú o diálogo modal abierto.

Sin push de Gavriel: Gavriel se suscribe a notificaciones push (Firebase Cloud Messaging). Con el interruptor de Ajustes (activado por defecto) la suscripción se rechaza como un permiso negado, la que ya existía se da de baja y los pedidos a `fcm.googleapis.com`, `fcmregistrations.googleapis.com` y `firebaseinstallations.googleapis.com` se bloquean (regla estática `push`). Las notificaciones de la extensión (por tipo de evento) no dependen de esto.

Solo donde hace falta: la extensión únicamente actúa en Gavriel, Spotify Web y YouTube Music (scripts, reglas de red y permisos acotados a esos sitios). En cualquier otro sitio el ícono de la barra aparece en gris y sin ventana; en Chrome lo decide el propio navegador con reglas declarativas (permiso declarativeContent), sin leer tus pestañas. En Firefox el botón queda siempre activo. Los ajustes siguen disponibles con clic derecho en el ícono → Opciones.

Robustez: cada manejador está aislado (una falla se avisa una vez por consola y no rompe la página), los observadores ignoran lo que dibuja la propia extensión, no gastan nada con la pestaña oculta y se apagan solos si la extensión se recarga mientras Gavriel sigue abierto (basta F5). Si el almacenamiento falla, se usan los valores por defecto.

## Instalar y compilar

Se usa siempre Bun (y pnpm solo si Bun no se pudiera). Si no tenés Bun global, queda como dependencia del proyecto.

```bash
bun install
bun run build        # compila src/ y static/ en dist/
```

Cada `bun run build` genera dos carpetas:

| Navegador | Carpeta | Cómo cargarla |
| --------- | ------- | ------------- |
| Chrome, Edge, Brave, Chromium | `dist/` | `chrome://extensions` → **Modo desarrollador** → **Cargar descomprimida** |
| Firefox 128 o más nuevo | `dist-firefox/` | `about:debugging#/runtime/this-firefox` → **Cargar complemento temporal** → elegir `dist-firefox/manifest.json` |

Al cambiar el código: `bun run build` (o `bun run dev` para recompilar al guardar) y el botón de recargar de la extensión.

**Firefox.** El manifest de Firefox lleva además un id propio, la versión mínima 128 (la primera que admite `world: "MAIN"`) y el permiso del sitio. Sin firmar en addons.mozilla.org solo se puede cargar como temporal: se pierde al cerrar Firefox. Si tras cargarla no actúa en Gavriel, abrí `about:addons` → Gavriel Tools → **Permisos** y activá el acceso a app.gavriel.com.ar. No se probó en un Firefox real.

**Linux.** Funciona igual (Bun y los navegadores tienen versión para Linux; no se probó allá). `Alt`+`Shift` suele cambiar la distribución del teclado en GNOME y KDE: si te molesta, se desactiva en la configuración del teclado. Algunos escritorios usan `Alt`+clic para mover ventanas.

## Scripts

| Comando             | Qué hace                                           |
| ------------------- | -------------------------------------------------- |
| `bun run build`     | Compila a `dist/` (la versión sale de `package.json`) |
| `bun run dev`       | Recompila al guardar                               |
| `bun run typecheck` | `tsc --noEmit` en modo estricto                    |
| `bun test`          | Tests unitarios (lógica pura) y de DOM con happy-dom (diálogos, filtros, tarjeta de llamada, observador, bundles minificados) |
| `bun run outdated` / `bun run update:latest` | Ver y subir Bun, TypeScript y dependencias a lo último |
| `bun run check`     | Tipos + tests + build                              |
| `bun run e2e`       | Prueba de punta a punta en un Chrome aparte (perfil temporal) con la extensión cargada sobre un servidor local que imita a Gavriel: verifica la caché de archivos con hash (1 descarga en 3 cargas), el bloqueo de sonidos (los elegidos no se piden, los demás sí) y el arranque de los content scripts. Necesita Chrome y openssl; no toca el Gavriel real. |

## Estructura

```
src/
  content/
    mute.ts        silenciador (corre en el mundo de la página: world MAIN)
    bridge.ts      pasa la configuración de chrome.storage a mute.ts
    shortcuts.ts   atajos e indicadores dentro de los componentes
    events-nav.ts  recorrer los eventos del panel con las flechas
    call-card.ts   tarjeta flotante con a quién se llama
    client-copy.ts Alt+C: mensaje para el cliente con cuenta y dirección
    ../background.ts  mantiene las reglas de bloqueo de sonidos (service worker / script de fondo)
    runtime.ts     aislamiento de errores y observador del DOM sin bucles
    main.ts        único content script (cuenta + atajos): un solo bundle y un solo observador
    account.ts     al abrir una cuenta: pestaña Contactos y ojito de la clave
  popup/popup.ts   popup: solo sonidos (interruptor general y lista) + botón Ajustes
  options/options.ts   página de ajustes: atajos, opciones de cuenta, restablecer
  shared/          constantes, almacenamiento tipado y lógica pura (testeada)
static/            manifest.json, popup/ y options/ (html y css), shortcuts.css, iconos, logo
test/              bun test
build.ts           script de build (Bun.build, un IIFE por content script; genera dist/ y dist-firefox/)
manifest-targets.ts  manifest de cada navegador a partir de static/manifest.json
scripts/make-icons.mjs  genera los íconos de 16, 32 y 48 px desde icon128.png (PNG válidos; un bloque dañado en icon48.png hacía que Chrome mostrara una «G» gris)
```

## Cómo funciona Gavriel (verificado en su código)

- Los sonidos salen de `new Audio('/sounds/<nombre>.mp3')`: `siren` y `alarm` según el tipo de evento y `beep` cuando
  entran eventos nuevos. Ese audio nunca entra al DOM, por eso `mute.ts` intercepta `play()` y los setters de
  `muted`/`volume`, y solo para archivos de `/sounds/` elegidos.
- El botón oficial de silenciar del panel depende de un permiso del backend. Esta extensión no lo simula ni lo toca.
- Softphone: "Colgar" existe solo dentro de la pestaña *Marcador*; el botón flotante se pone rojo (`bg-destructive`)
  durante una llamada; la llamada entrante es una tarjeta "Llamada de: …" con *Atender* / *Rechazar* (los eventos
  también tienen un "Atender", por eso se distingue).
- Contactos: sección *Contactos de emergencia*, cada uno con un botón `aria-label="Llamar"`. Gavriel solo dibuja la pestaña activa, así que desde otras pestañas (p. ej. Dispositivos) el atajo usa el menú "Llamar a…" del botón flotante, que existe en todas, tiene la misma lista y el mismo orden, y se cierra solo al elegir un contacto.

## Pruebas

`bun test` cubre la lógica pura (nombres de sonido, etiquetas, almacenamiento, manifest). El comportamiento sobre la
página real se verificó a mano en el navegador con `click()` interceptado para no llamar a nadie. Pendiente: una
llamada real de punta a punta con la extensión cargada en Chrome.
