#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import * as cmd from "./cli/commands.js";
import { closeInput, InputError } from "./cli/io.js";

// Injected at bundle time by esbuild (see scripts/build-bin.mjs).
declare const __GAVRIEL_VERSION__: string | undefined;
function readVersion(): string {
  if (typeof __GAVRIEL_VERSION__ !== "undefined") return __GAVRIEL_VERSION__;
  try {
    return (createRequire(import.meta.url)("../package.json") as { version: string }).version; // dist/cli.js → raíz
  } catch {
    return "dev";
  }
}
const VERSION = readVersion();

const HELP = `gavriel — CLI de Gavriel MCP

Uso: gavriel <comando> [opciones]

Sesión
  login [-p perfil] [--email e] [--code 123456]   Inicia sesión y guarda credenciales (password oculto)
  renew [-p perfil] [--all]                       Renueva el dispositivo confiable (código o semilla TOTP)
  logout [-p perfil] [--all] [--purge]            Borra el dispositivo confiable (--purge: también password y perfil)
  whoami                                          Usuario de la sesión
  doctor [--online]                               Diagnóstico: almacén, perfil, API (--online: login real)

Cuentas (perfiles)
  profile list|add|use|remove|rename              Administra varias cuentas de Gavriel
  totp set|clear|code                             Semilla TOTP opcional (renovación automática)

Claude
  mcp install [--client desktop|code] [--role r] [--toolsets t] [--force] [--server-path ruta] [--dry-run] [-y]

Consultas
  tickets [--status s] [--limit n]
  events pending
  accounts search <texto> | accounts get <id>

Opciones globales: -p/--profile, --json, -y/--yes, -h/--help, -v/--version
Códigos de salida: 0 ok, 1 error, 2 uso incorrecto`;

const COMMANDS: Record<string, (ctx: cmd.Ctx) => Promise<void>> = {
  login: cmd.login, renew: cmd.renew, logout: cmd.logout, whoami: cmd.whoami, doctor: cmd.doctor,
  profile: cmd.profile, profiles: cmd.profile, totp: cmd.totpCmd, mcp: cmd.mcp,
  tickets: cmd.tickets, events: cmd.events, accounts: cmd.accounts,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dd = argv.indexOf("--");
  const profileFlags = (dd < 0 ? argv : argv.slice(0, dd)).filter((a) => /^(-p|--profile)(=.*)?$/.test(a)).length;
  if (profileFlags > 1) {
    console.error("Opción -p/--profile repetida: indicá un solo perfil.");
    process.exitCode = 2;
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: cmd.OPTIONS, allowPositionals: true });
  } catch (err) {
    console.error(`${(err as Error).message}\nVer: gavriel --help`);
    process.exitCode = 2;
    return;
  }
  const { values, positionals } = parsed;
  if (values.version) return console.log(`gavriel ${VERSION}`);
  const [name, ...args] = positionals;
  if (values.help || !name) return console.log(HELP);
  const run = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!run) {
    console.error(`Comando desconocido: ${name}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  try {
    await run({ values, args });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = err instanceof InputError ? err.exitCode : 1;
  } finally {
    closeInput();
  }
}

void main();
