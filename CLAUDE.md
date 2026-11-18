# Gavriel Tools (extensión de Chrome para app.gavriel.com.ar)

El usuario es operador de monitoreo de alarmas y escribe en español: responder en español, directo y sin relleno.

## Tarea pendiente para el próximo modelo
Leer **`docs/GUIA-OPTIMIZACION.md`** completa antes de tocar código y ejecutarla en el orden que indica (Fase 0, luego poda de tests trivial, puente único, features, ajustes declarativos y optimizaciones, un commit por fase y con `bun run check` en verde). Es un refactor sin cambios de comportamiento visibles: cada mejora de rendimiento lleva su medición de antes y después, y si no mejora se revierte.

## Reglas permanentes
- **Bun primero, si no pnpm.** Nunca npm ni yarn.
- **Token de Gavriel:** solo lo usa `src/content/gavriel-api.ts`, en memoria del mundo MAIN, para `GET` a dos rutas (allowlist). Nunca se guarda, no cruza al mundo aislado y no se lee ni se loguea en ningún otro lado.
- **Cuentas y llamadas:** no hacer llamadas reales ni cambiar el estado de una cuenta (abrir una puede dejarla «en intervención»). El único teléfono de prueba es el del usuario, 342-537-0985, solo desde el marcador y pidiendo confirmación. Nunca contactos de clientes. Privacidad de los datos de clientes.
- **Git:** no hacer push sin permiso; darle al usuario `git push origin gavriel-extension`. Un commit por fase, con el trailer `Co-Authored-By` del modelo que lo hace.
- **Edición:** heredoc, `sed` y `node -e` rompen barras y comillas: usar Write y Edit. Sin Python.
- **Verificación en vivo:** el usuario recarga la extensión y se prueba en su Chrome con claude-in-chrome en solo lectura; las herramientas de red no muestran los pedidos propios de la extensión (el estado del índice queda en `<html data-gv-index>`).
- **Servidor SSH** (`marinozzi@192.168.0.109`, clave en el agente de Bitwarden, `ssh.exe` de Windows): el usuario pidió **no depender** de él. No usarlo salvo que lo pida.
