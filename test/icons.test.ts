import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

interface PngInfo {
  width: number;
  height: number;
  badChunks: string[];
  inflated: number | string;
  rgba: boolean;
}

/** Revisa lo mismo que Chrome al decodificar un ícono: firma, CRC de cada bloque y datos de imagen. */
function inspect(buf: Buffer): PngInfo {
  const info: PngInfo = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), badChunks: [], inflated: 0, rgba: buf[24] === 8 && buf[25] === 6 };
  const idat: Buffer[] = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (crc32(Buffer.concat([type, data])) !== buf.readUInt32BE(o + 8 + len)) info.badChunks.push(type.toString());
    if (type.toString() === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  try {
    info.inflated = inflateSync(Buffer.concat(idat)).length;
  } catch (error) {
    info.inflated = `error: ${(error as Error).message}`;
  }
  return info;
}

const manifest = (await Bun.file('static/manifest.json').json()) as { icons: Record<string, string>; description: string; homepage_url?: string };

describe('íconos de la extensión', () => {
  test('cada ícono del manifest existe y su tamaño coincide con su clave', () => {
    for (const [size, path] of Object.entries(manifest.icons)) {
      expect(existsSync(`static/${path}`)).toBe(true);
      const info = inspect(readFileSync(`static/${path}`));
      expect([info.width, info.height]).toEqual([Number(size), Number(size)]);
    }
  });

  // Un ícono con un bloque dañado se ve bien en un visor pero Chrome lo descarta y muestra una «G» gris (pasó con icon48.png)
  test('ningún PNG tiene bloques dañados ni datos que no se puedan descomprimir', () => {
    const files = readdirSync('static/icons').filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const info = inspect(readFileSync(`static/icons/${file}`));
      expect({ file, bad: info.badChunks }).toEqual({ file, bad: [] });
      expect({ file, rgba: info.rgba }).toEqual({ file, rgba: true });
      expect({ file, inflated: info.inflated }).toEqual({ file, inflated: info.height * (1 + info.width * 4) });
    }
  });

  test('hay ícono para 16, 32, 48 y 128 (Chrome usa el de 48 en la lista de extensiones)', () => {
    expect(Object.keys(manifest.icons).sort((a, b) => Number(a) - Number(b))).toEqual(['16', '32', '48', '128']);
  });
});

describe('descripción y metadatos', () => {
  test('la descripción cabe en los 132 caracteres que admite Chrome Web Store y no está vacía', () => {
    expect(manifest.description.length).toBeGreaterThan(40);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  test('tiene dirección de proyecto', () => {
    expect(manifest.homepage_url).toMatch(/^https:\/\/github\.com\//);
  });
});
