import { createHmac } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!clean) throw new Error("Semilla vacía");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Semilla base32 inválida");
    value = ((value << 5) | i) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 6238 (HMAC-SHA1, 30 s, 6 dígitos): lo que usan las apps de autenticación.
export function totp(seedBase32: string, nowMs = Date.now(), digits = 6, periodSec = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / periodSec)));
  const h = createHmac("sha1", base32Decode(seedBase32)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// Acepta la semilla base32 sola o una URI otpauth://totp/...?secret=...; devuelve base32 normalizado.
export function parseSeedInput(input: string): string {
  let raw = input.trim();
  if (/^otpauth:\/\//i.test(raw)) {
    const secret = new URL(raw).searchParams.get("secret");
    if (!secret) throw new Error("La URI otpauth no trae secret");
    raw = secret;
  }
  const seed = raw.toUpperCase().replace(/[\s=-]/g, "");
  base32Decode(seed); // valida
  return seed;
}

export function secondsLeft(nowMs = Date.now(), periodSec = 30): number {
  return periodSec - (Math.floor(nowMs / 1000) % periodSec);
}

// Código TOTP válido por al menos ~2 s: si la ventana está por cerrar, espera a la siguiente
// (si no, el código puede vencer en tránsito y el backend lo rechaza).
export async function totpFresh(seedBase32: string): Promise<string> {
  if (secondsLeft() < 2) await new Promise((r) => setTimeout(r, secondsLeft() * 1000 + 250));
  return totp(seedBase32);
}
