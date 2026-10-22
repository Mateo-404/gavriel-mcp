import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// Perfiles sin secretos; password, trusted token y semilla TOTP viven en el almacén seguro (secrets.ts).
export interface Profile {
  email: string;
  apiBase?: string;
  role?: "readonly" | "lite" | "full";
  toolsets?: string;
}
export interface ProfileStore {
  active: string | null;
  profiles: Record<string, Profile>;
}

const NAME_RE = /^[\w.-]{1,40}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export function configDir(): string {
  return process.env.GAVRIEL_CONFIG_DIR || join(homedir(), ".config", "gavriel");
}
const storeFile = (): string => join(configDir(), "profiles.json");

export function validateProfileName(name: string): void {
  if (!NAME_RE.test(name) || RESERVED.has(name)) {
    throw new Error(`Nombre de perfil inválido: "${name}" (letras, números, . _ -; máx 40)`);
  }
}

/** Lookup que ignora propiedades heredadas (p.ej. "constructor"). */
export function getProfile(store: ProfileStore, name: string): Profile | undefined {
  return Object.hasOwn(store.profiles, name) ? store.profiles[name] : undefined;
}

// Solo ENOENT es "no hay perfiles"; cualquier otro error se propaga para que un
// saveStore posterior no pise con un store vacío un archivo ilegible o corrupto.
export function loadStore(): ProfileStore {
  let raw: string;
  try {
    raw = readFileSync(storeFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { active: null, profiles: Object.create(null) };
    throw new Error(`No se pudo leer ${storeFile()}: ${(err as Error).message}`);
  }
  let s: Partial<ProfileStore> | null;
  try {
    s = JSON.parse(raw) as Partial<ProfileStore> | null;
  } catch (err) {
    throw new Error(`${storeFile()} no es JSON válido (${(err as Error).message}); corregilo o borralo a mano.`);
  }
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    throw new Error(`${storeFile()} tiene un formato inesperado; corregilo o borralo a mano.`);
  }
  return { active: s.active ?? null, profiles: Object.assign(Object.create(null), s.profiles ?? {}) };
}

export function saveStore(store: ProfileStore): void {
  mkdirSync(configDir(), { recursive: true });
  const tmp = `${storeFile()}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, storeFile());
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}
