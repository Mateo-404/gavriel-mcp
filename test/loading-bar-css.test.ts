import { describe, expect, test } from 'bun:test';

const css = await Bun.file('static/content/shortcuts.css').text();

describe('sin barras de carga de Gavriel', () => {
  test('la raya fina que pulsa (h-1 + animate-pulse + rounded-full) se oculta siempre', () => {
    expect(css).toMatch(/\.animate-pulse\.h-1\.w-full\.rounded-full[^{]*\{[^}]*display:\s*none\s*!important/);
  });
  test('el resaltado naranja del bloque de evento se anula', () => {
    expect(css).toMatch(/\.monitoring-panel-event-block\.ring-warning[^{]*\{[^}]*box-shadow:\s*none\s*!important/);
  });
  test('el recuadro naranja del filtro y los parlantes naranjas del panel se apagan', () => {
    expect(css).toMatch(/monitoring-panel-filter-btn\.ring-warning[^{]*\{[^}]*box-shadow:\s*none\s*!important/);
    expect(css).toMatch(/pi-volume-up\.text-warning[^{]*\{[^}]*color:/);
  });
});
