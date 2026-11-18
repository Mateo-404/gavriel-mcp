# Gavriel Tools (extensión de Chrome para app.gavriel.com.ar)

El usuario es operador de monitoreo de alarmas y escribe en español: responder en español, directo y sin relleno.

## Estado del trabajo de arquitectura y optimización
Se ejecutó lo que pedía **`docs/GUIA-OPTIMIZACION.md`** (versiones 0.20.1 a 0.24.0): línea de base y `scripts/measure.ts`, verificación del paquete en el build,
puente único entre mundos (`shared/page-rpc.ts`), `shortcuts.ts` dividido (`page`, `badges`, `music-feature`, `index-feature`, `settings-sync`),
ajustes declarativos (`SWITCH_DEFAULTS`), índice compacto con Web Lock, CSS minificado, fondo sin depuración y tests consolidados (331 → 282).
La arquitectura vigente está en el README (sección «Arquitectura») y los números en `docs/perf-baseline.md`.

**Pendiente** (lo que no se pudo cerrar sin el navegador del usuario o no alcanzó la meta):
1. Medir en vivo, con la extensión recargada, las pasadas del observador (`data-gv-perfon` → `data-gv-perf`) y el tamaño del índice guardado.
2. 4.2 de la guía (filtrar mutaciones propias del panel en `runtime.ts hasForeignChange`): solo si la medición lo justifica.
3. `main.js` sigue en ~65 KB (meta 55 KB): partir el desplegable y el índice de «Cuentas» a un script aparte, y poda de tests restante (meta ~150) sin perder los puentes de seguridad.
4. Probar con una llamada entrante real el cartel de cuenta (el número se lee de forma defensiva de la sesión SIP).

## Reglas permanentes
- **Bun primero, si no pnpm.** Nunca npm ni yarn.
- **Token de Gavriel:** solo lo usa `src/content/gavriel-api.ts`, en memoria del mundo MAIN, para `GET` a dos rutas (allowlist). Nunca se guarda, no cruza al mundo aislado y no se lee ni se loguea en ningún otro lado.
- **Cuentas y llamadas:** no hacer llamadas reales ni cambiar el estado de una cuenta (abrir una puede dejarla «en intervención»). El único teléfono de prueba es el del usuario, 342-537-0985, solo desde el marcador y pidiendo confirmación. Nunca contactos de clientes. Privacidad de los datos de clientes.
- **Git:** no hacer push sin permiso; darle al usuario `git push origin gavriel-extension`. Un commit por fase, con el trailer `Co-Authored-By` del modelo que lo hace.
- **Edición:** heredoc, `sed` y `node -e` rompen barras y comillas: usar Write y Edit. Sin Python.
- **Verificación en vivo:** el usuario recarga la extensión y se prueba en su Chrome con claude-in-chrome en solo lectura; las herramientas de red no muestran los pedidos propios de la extensión (el estado del índice queda en `<html data-gv-index>`).
- **Servidor SSH** (`marinozzi@192.168.0.109`, clave en el agente de Bitwarden, `ssh.exe` de Windows): el usuario pidió **no depender** de él. No usarlo salvo que lo pida.
