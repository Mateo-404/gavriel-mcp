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

## Después de cada fase
(se completa a medida que se avanza)
