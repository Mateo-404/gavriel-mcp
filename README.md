# Gavriel Tools

Extensión de Chrome (Manifest V3, TypeScript, compilada con [Bun](https://bun.sh)) con herramientas extra para
[app.gavriel.com.ar](https://app.gavriel.com.ar). Solo actúa sobre ese dominio.

## Qué hace

**Silenciar sonidos del panel de monitoreo.** Dentro de `/monitoring-panel`, silencia los sonidos que cada usuario
elija en el popup. Por defecto: `alarm`, `siren` y `beep`. Si Gavriel reproduce un sonido nuevo, aparece en la lista
(sin silenciarse) para que se elija. Las llamadas, las grabaciones y cualquier otro audio no se tocan. Los eventos
siguen apareciendo en pantalla: solo se silencia el audio, y solo en el navegador de quien instala la extensión.

**Atajos de teclado.** Se muestran dentro de cada componente, sin flotar encima:

| Atajo          | Acción                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `Alt` + `1…9`  | Llama al contacto de la cuenta en esa posición de la lista (1 = el primero), **desde cualquier pestaña de la cuenta**. Nunca llama a Jurisdicción ni al 911. |
| `Ctrl` + `Enter` | Corta la llamada en curso; si hay una entrante, la atiende; si hay un número en el marcador, llama. Sin ninguna de las tres no interviene. |

Protecciones: ignora teclas repetidas, `AltGr`, `Shift`/`Meta`; bloquea llamadas dobles durante 1,5 s; no llama si ya
hay una llamada en curso ni con un menú o diálogo modal abierto.

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
  popup/popup.ts   interruptores y lista de sonidos
  shared/          constantes, almacenamiento tipado y lógica pura (testeada)
static/            manifest.json, popup.html/css, shortcuts.css, iconos, logo
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
