# Gavriel Tools

Extensión de Chrome (Manifest V3, TypeScript, compilada con [Bun](https://bun.sh)) con herramientas extra para
[app.gavriel.com.ar](https://app.gavriel.com.ar). Solo actúa sobre ese dominio.

## Qué hace

**Silenciar sonidos del panel de monitoreo.** Dentro de `/monitoring-panel`, silencia los sonidos que cada usuario
elija en el popup (el ícono de la extensión, que maneja solo el sonido). Por defecto: `alarm`, `siren` y `beep`. Si Gavriel reproduce un sonido nuevo, aparece en la lista
(sin silenciarse) para que se elija. Las llamadas, las grabaciones y cualquier otro audio no se tocan. Los eventos
siguen apareciendo en pantalla: solo se silencia el audio, y solo en el navegador de quien instala la extensión.

**Atajos de teclado.** Los indicadores `Alt+N` solo se ven mientras se mantiene `Alt` y van dentro de cada componente, sin flotar encima:

| Atajo | Acción |
| ----- | ------ |
| `↑` `↓` `←` `→` | En el panel de monitoreo recorren los eventos. La primera flecha marca siempre el primer evento de la columna de la izquierda; `↓`/`↑` bajan y suben por la columna y `←`/`→` pasan a la columna vecina. También funcionan con `Shift`. La tarjeta marcada se ve con un anillo lila, resplandor y la etiqueta «Enter para abrir». `Enter` abre el evento marcado y `Esc` quita la marca. No intervienen al escribir en un campo, dentro de un menú o con un diálogo abierto. |
| `Alt` + `1…9` | **En el panel:** abre el evento N (columna por columna: primero todos los de NUEVO, después los de la columna siguiente). **En una cuenta:** llama al contacto en esa posición de la lista (1 = el primero), desde cualquier pestaña. Nunca llama a Jurisdicción ni al 911. |
| Mantener `Alt` | Muestra los atajos Alt+N y, en una cuenta, abre el menú de contactos; al soltar `Alt` se cierra. Un toque rápido no hace nada. |
| `Alt` + `Shift` | En una cuenta, **copia al portapapeles el nombre de la última persona a la que llamaste** (por ejemplo `Pablo Perren`, sin el teléfono ni la descripción). Sin tocar nada: abre «Búsqueda avanzada», desmarca «Ocultar operación (intervención, llamadas…)» si hace falta, lee la descripción «Contacto vía Teléfono a …» del evento más reciente y deja el panel y el filtro como estaban. Tarda menos de un segundo. Ojo: en Windows, `Alt`+`Shift` también cambia el idioma del teclado si tenés más de uno instalado (se desactiva en Configuración → Hora e idioma → Teclado). |
| `Ctrl` + `Enter` | Corta la llamada en curso; si hay una entrante, la atiende; si hay un número en el marcador, llama. **Sin nada de eso, en una cuenta intervenida abre «Cerrar intervención» y deja el cursor en «Resolución»** (el diálogo de Gavriel manda el foco a «Categoría»; la extensión lo mueve). Confirmar el cierre sigue siendo manual: el botón queda deshabilitado hasta completar categoría y resolución. No interviene si escribís en un campo ni con un diálogo abierto. |

**Tarjeta de llamada.** Al llamar a un contacto (con atajo, mouse, menú del teléfono o marcador) flota sobre el botón del teléfono una tarjeta chica con su nombre y descripción. No recibe clics, se va sola al cortar y vuelve con el siguiente contacto. Se apaga en Ajustes.

**Ajustes.** Todo lo que no es sonido se maneja en una página propia: botón **Ajustes** del popup, o clic derecho en el ícono → *Opciones*. Ahí se activan o desactivan los atajos (con la lista completa y en qué pantalla funciona cada uno), las opciones de cuenta y un botón para restablecer. Se guarda al instante.

**Al abrir una cuenta** (se puede desactivar cada cosa en Ajustes): entra directo a la pestaña **Contactos** y toca el ojito de **Clave** y **Contraclave**. Se aplica una sola vez por cuenta y solo si el botón existe: Gavriel dibuja el ojito únicamente si tu usuario tiene permiso para ver la clave.

Protecciones: ignora teclas repetidas, `AltGr`, `Shift`/`Meta`; bloquea llamadas dobles durante 1,5 s; no llama si ya
hay una llamada en curso ni con un menú o diálogo modal abierto.

Robustez: cada manejador está aislado (una falla se avisa una vez por consola y no rompe la página), los observadores ignoran lo que dibuja la propia extensión, no gastan nada con la pestaña oculta y se apagan solos si la extensión se recarga mientras Gavriel sigue abierto (basta F5). Si el almacenamiento falla, se usan los valores por defecto.

## Instalar y compilar

Se usa siempre Bun (y pnpm solo si Bun no se pudiera). Si no tenés Bun global, queda como dependencia del proyecto.

```bash
bun install
bun run build        # compila src/ y static/ en dist/
```

Después, en `chrome://extensions`: activar **Modo desarrollador** → **Cargar descomprimida** → elegir la carpeta
**`dist/`**. Al cambiar el código: `bun run build` (o `bun run dev` para recompilar al guardar) y el botón de recargar de
la extensión.

## Scripts

| Comando             | Qué hace                                           |
| ------------------- | -------------------------------------------------- |
| `bun run build`     | Compila a `dist/` (la versión sale de `package.json`) |
| `bun run dev`       | Recompila al guardar                               |
| `bun run typecheck` | `tsc --noEmit` en modo estricto                    |
| `bun test`          | Tests unitarios de la lógica pura                  |
| `bun run check`     | Tipos + tests + build                              |

## Estructura

```
src/
  content/
    mute.ts        silenciador (corre en el mundo de la página: world MAIN)
    bridge.ts      pasa la configuración de chrome.storage a mute.ts
    shortcuts.ts   atajos e indicadores dentro de los componentes
    events-nav.ts  recorrer los eventos del panel con las flechas
    call-card.ts   tarjeta flotante con a quién se llama
    runtime.ts     aislamiento de errores y observador del DOM sin bucles
    account.ts     al abrir una cuenta: pestaña Contactos y ojito de la clave
  popup/popup.ts   popup: solo sonidos (interruptor general y lista) + botón Ajustes
  options/options.ts   página de ajustes: atajos, opciones de cuenta, restablecer
  shared/          constantes, almacenamiento tipado y lógica pura (testeada)
static/            manifest.json, popup/ y options/ (html y css), shortcuts.css, iconos, logo
test/              bun test
build.ts           script de build (Bun.build, un IIFE por content script)
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
