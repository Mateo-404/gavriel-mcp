import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
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

export function configDir(): string {
  return process.env.GAVRIEL_CONFIG_DIR || join(homedir(), ".config", "gavriel");
}
const storeFile = (): string => join(configDir(), "profiles.json");

export function validateProfileName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`Nombre de perfil inválido: "${name}" (letras, números, . _ -; máx 40)`);
}

export function loadStore(): ProfileStore {
  try {
    const s = JSON.parse(readFileSync(storeFile(), "utf8")) as Partial<ProfileStore>;
    return { active: s.active ?? null, profiles: s.profiles ?? {} };
  } catch {
    return { active: null, profiles: {} };
  }
}

export function saveStore(store: ProfileStore): void {
  mkdirSync(configDir(), { recursive: true });
  const tmp = `${storeFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, storeFile());
}
