# Línea de base de rendimiento

Se genera con `bun run build && bun run scripts/measure.ts`. En el navegador: poner `data-gv-perfon` en `<html>` (consola de la
página) y leer `data-gv-perf` (pasadas del observador del DOM, ms totales y la más lenta).

## Antes (v0.20.0, 331 tests en 46 archivos)
| archivo | crudo | gzip |
|---|---:|---:|
| background.js | 14.539 | 5.652 |
| content/bridge.js | 13.170 | 3.293 |
| content/main.js | 64.537 | 23.006 |
| content/music.js | 6.563 | 2.547 |
| content/mute.js | 16.844 | 6.675 |
| content/shortcuts.css | 18.069 | 5.061 |
| options/options.js | 13.238 | 4.912 |
| popup/popup.js | 6.750 | 2.640 |
| **TOTAL (js + css)** | **172.018** | **58.305** |

Tests: 331 pass en 46 archivos, ~3,2 s (con arranque).

## Después (v0.23.1, 282 tests en 39 archivos)
| archivo | crudo | gzip |
|---|---:|---:|
| background.js | 12.582 | 5.157 |
| content/bridge.js | 11.872 | 3.101 |
| content/main.js | 64.794 | 23.530 |
| content/music.js | 6.631 | 2.588 |
| content/mute.js | 17.123 | 6.810 |
| content/shortcuts.css (minificado) | 13.005 | 3.307 |
| options/options.js | 11.070 | 4.614 |
| popup/popup.js | 5.452 | 2.438 |
| **TOTAL (js + css)** | **158.407** | **55.430** |

- Total: −8 % crudo (172.018 → 158.407) y −5 % gzip (58.305 → 55.430). Sale del CSS minificado (−28 % el de shortcuts), del fondo sin
  diagnóstico de depuración (−2 KB) y de los ajustes declarativos (`options.js` −2 KB, `bridge.js` −1,3 KB).
- `main.js` quedó igual (64,5 → 64,8 KB): el trabajo nuevo (índice, ronda, Ctrl+Espacio, cartel de llamada entrante) compensó lo que se sacó
  del orquestador. La meta de 55 KB no se alcanzó; el camino es partir lo que solo se usa en «Cuentas» (desplegable e índice) a un script aparte.
- Tests: 331 → 282 (−15 %) y de 46 a 39 archivos. La meta de ~150 no se alcanzó: lo que queda es lógica pura y los puentes de seguridad.

## Medido en el navegador (v0.24.0, Chrome del usuario, 18/11/2026)
- Panel de monitoreo en reposo (~30 s): **9 pasadas, 36 ms en total (≈4 ms cada una), la más lenta 21 ms**.
- Lista de cuentas escribiendo en el buscador: 10 pasadas, 10 ms en total, la más lenta 5 ms.
- Índice: leyó lo guardado (1.844 cuentas) sin pedir nada; el desplegable responde al instante.
- No hay medición «antes» en el navegador (la v0.20 no tenía el contador), así que estos números son la referencia de aquí en adelante.

## Pendiente de medir en el navegador
- Pasadas del observador por minuto y ms por pasada (`data-gv-perfon` / `data-gv-perf`): antes/después de la foto única de botones.
- Tamaño de `chrome.storage.local` del índice (formato compacto) y de los avisos `onChanged` entre pestañas.
- La mejora de 4.2 (filtrar mutaciones propias del panel) no se hizo: sin esa medición no hay forma de saber si ayuda o rompe repintados.
