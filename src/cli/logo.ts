// Bitmap del logo de Gavriel (generado con scripts/gen-logo.mjs a partir del SVG oficial).
// "L" = hoja (verde menta), "W" = texto "gavriel", "." = vacío. Dos filas de píxeles = una línea de terminal (medios bloques).
export const LOGO_ROWS: readonly string[] = [
  ".....LLLLLLLL...................................................",
  "LLLLLLLLLLLLLLL.................................................",
  "LLLLLLLLLLLLLLLL................................................",
  ".LLLLLLLLLLLLLLL.....WWWWWW........................W..........WW",
  ".LLLLLLLLLLLLLL.....WWW..WWW.......................W..........WW",
  "..LLLLLLLLLLLLL.....WW.....WW.................................WW",
  ".LLLLLLLLLLLLLL....WW.......W...WWWW.WW....WW.W.WW.W...WWWWW..WW",
  ".LLLLLLLLLLLLLL....WW..........WW..WW.WW...WW.WWW..W..WWW.WWW.WW",
  "..LLLLLLLLLLLL.....W.....WWWW..W...WW.WW...W..WW...W..WW...WW.WW",
  "..LLLLLLLLLLLL.....WW...WWWWW...WWWWW..W..WW..WW...W..WWWWWWW.WW",
  "...LLLLLLLLLLL.....WW......WW..WWWWWW..WW.WW..W....W..WWWWWWW.WW",
  "..LLLLLLLLLLL......WW......WW.WW...WW..WW.W...W....W..W.......WW",
  "...LLLLLLLLLL.......WWW...WWW.WW...WW...WWW...W....W..WW...WW.WW",
  "....LLLLLLLL.........WWWWWW.W..WWWWWW...WW....W....W...WWWWW..WW",
  ".....LLLLLL.....................................................",
  ".........L......................................................",
  "........L.......................................................",
  "................................................................",
];

export const LOGO_WIDTH = LOGO_ROWS[0].length;
// Columnas que ocupa solo la hoja (para el modo compacto).
export const MARK_WIDTH = Math.max(...LOGO_ROWS.map((r) => r.lastIndexOf("L") + 1));
