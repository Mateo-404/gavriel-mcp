#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as cmd from "./cli/commands.js";

// Injected at bundle time by esbuild (see scripts/build-bin.mjs).
declare const __GAVRIEL_VERSION__: string | undefined;
const VERSION = typeof __GAVRIEL_VERSION__ !== "undefined" ? __GAVRIEL_VERSION__ : "dev";

const HELP = `gavriel — CLI de Gavriel MCP

Uso: gavriel <comando> [opciones]

Sesión
  login [-p perfil] [--email e] [--code 123456]   Inicia sesión y guarda credenciales (password oculto)
  renew [-p perfil] [--all]                       Renueva el dispositivo confiable (código o semilla TOTP)
  logout [-p perfil] [--all] [--purge]            Borra el dispositivo confiable (--purge: también password y perfil)
  whoami                                          Usuario de la sesión
  doctor                                          Diagnóstico: almacén, perfil, API, sesión

Cuentas (perfiles)
  profile list|add|use|remove|rename              Administra varias cuentas de Gavriel
  totp set|clear|code                             Semilla TOTP opcional (renovación automática)

Claude
  mcp install [--client desktop|code] [--role r] [--toolsets t] [--dry-run] [-y]

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
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: cmd.OPTIONS, allowPositionals: true });
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  const { values, positionals } = parsed;
  if (values.version) return console.log(`gavriel ${VERSION}`);
  const [name, ...args] = positionals;
  if (values.help || !name) return console.log(HELP);
  const run = COMMANDS[name];
  if (!run) {
    console.error(`Comando desconocido: ${name}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  try {
    await run({ values, args });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
