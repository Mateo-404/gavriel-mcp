/**
 * Verificación del paquete: corre en cada `bun run build` y hace fallar el build si algo de lo que la extensión da
 * por hecho no está. Reemplaza a los tests que leían el manifest, los íconos y el CSS con expresiones regulares.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from '../manifest-targets';

interface Loose {
  icons?: Record<string, string>;
  description?: string;
  action?: { default_popup?: string };
  options_ui?: { page?: string; open_in_tab?: boolean };
  permissions?: string[];
  declarative_net_request?: { rule_resources?: { id: string; enabled: boolean; path: string }[] };
  content_scripts?: { js: string[]; css?: string[]; world?: string; matches: string[]; all_frames?: boolean }[];
}

export function verifyPackage(manifest: Manifest, root = '.'): string[] {
  const m = manifest as unknown as Loose;
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  const at = (...parts: string[]): string => join(root, ...parts);

  // Fuentes y archivos estáticos
  for (const script of m.content_scripts ?? []) {
    for (const js of script.js) need(existsSync(at('src', js.replace(/\.js$/, '.ts'))), `falta la fuente de ${js}`);
    for (const css of script.css ?? []) need(existsSync(at('static', css)), `falta ${css}`);
    need(script.all_frames === undefined, 'los content scripts no deben inyectarse en iframes');
    const music = script.js.includes('content/music.js');
    need(
      JSON.stringify(script.matches) === JSON.stringify(music ? ['https://open.spotify.com/*', 'https://music.youtube.com/*'] : ['https://app.gavriel.com.ar/*']),
      `matches inesperados en ${script.js.join(',')}`,
    );
  }
  const inMain = (m.content_scripts ?? []).filter((s) => s.world === 'MAIN').flatMap((s) => s.js);
  need(JSON.stringify(inMain) === JSON.stringify(['content/mute.js']), 'solo mute.js corre en el mundo de la página');

  // Páginas
  need(existsSync(at('static', m.action?.default_popup ?? '?')), 'falta el popup');
  need(existsSync(at('static', m.options_ui?.page ?? '?')) && m.options_ui?.open_in_tab === true, 'falta la página de ajustes (o no abre en pestaña)');

  // Reglas de red y permisos
  const rules = m.declarative_net_request?.rule_resources ?? [];
  for (const id of ['cache', 'fonts', 'push']) {
    const rule = rules.find((r) => r.id === id);
    need(!!rule && rule.enabled && existsSync(at('static', rule.path)), `falta el conjunto de reglas «${id}»`);
  }
  need((m.permissions ?? []).includes('declarativeNetRequest'), 'falta el permiso declarativeNetRequest');

  // Íconos: tamaño que dice la clave y que sean PNG (Chrome descarta los dañados y muestra una «G» gris)
  need(JSON.stringify(Object.keys(m.icons ?? {}).sort((a, b) => Number(a) - Number(b))) === '["16","32","48","128"]', 'faltan íconos de 16, 32, 48 o 128');
  for (const [size, path] of Object.entries(m.icons ?? {})) {
    const file = at('static', path);
    if (!existsSync(file)) {
      problems.push(`falta el ícono ${path}`);
      continue;
    }
    const buf = readFileSync(file);
    const png = buf.length > 33 && buf.readUInt32BE(0) === 0x89504e47;
    need(png && buf.readUInt32BE(16) === Number(size) && buf.readUInt32BE(20) === Number(size), `el ícono ${path} no es un PNG de ${size}×${size}`);
  }

  // Tipografías locales: solo archivos que existen y nada de internet
  const fontsCss = at('static', 'fonts', 'gavriel-fonts.css');
  if (existsSync(fontsCss)) {
    for (const match of readFileSync(fontsCss, 'utf8').matchAll(/url\(([^)]+)\)/g)) {
      const url = match[1]!.replace(/['"]/g, '');
      need(!url.startsWith('http') && existsSync(at('static', 'fonts', url)), `gavriel-fonts.css apunta a ${url}`);
    }
  }

  const description = m.description ?? '';
  need(description.length > 40 && description.length <= 132, 'la descripción debe tener entre 41 y 132 caracteres');
  return problems;
}
