#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import * as cmd from "./cli/commands.js";
import { closeInput, InputError } from "./cli/io.js";
import { runMenu } from "./cli/menu.js";
import * as ui from "./cli/ui.js";

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

const SECTIONS: readonly [string, readonly (readonly [string, string])[]][] = [
  ["Interfaz", [
    ["menu  (o sin argumentos en una terminal)", "Menú interactivo: cuentas, TOTP, diagnóstico, consultas, instalar en Claude"],
  ]],
  ["Sesión", [
    ["login [-p perfil] [--email e] [--code 123456]", "Inicia sesión y guarda credenciales (password oculto)"],
    ["renew [-p perfil] [--all]", "Renueva el dispositivo confiable (código o semilla TOTP)"],
    ["logout [-p perfil] [--all] [--purge]", "Borra el dispositivo confiable (--purge: también password y perfil)"],
    ["whoami", "Usuario de la sesión"],
    ["doctor [--online]", "Diagnóstico: almacén, perfil, API (--online: login real)"],
  ]],
  ["Cuentas (perfiles)", [
    ["profile list|add|use|remove|rename", "Administra varias cuentas de Gavriel"],
    ["totp set|clear|code", "Semilla TOTP opcional (renovación automática)"],
  ]],
  ["Claude", [
    ["mcp install [--client desktop|code] [--role r] [--toolsets t]", "Registra el MCP (--force, --server-path, --dry-run, -y)"],
  ]],
  ["Consultas", [
    ["tickets [--status s] [--limit n]", "Tickets (abiertos, en progreso, pendientes, cerrados)"],
    ["events pending", "Cuentas con eventos pendientes"],
    ["accounts search <texto> | accounts get <id>", "Buscar y ver cuentas"],
  ]],
];

function helpText(stream: NodeJS.WriteStream): string {
  const p = ui.painter(stream);
  const g = ui.glyphs();
  const width = Math.max(...SECTIONS.flatMap(([, rows]) => rows.map(([c]) => c.length)));
  const lines: string[] = [`${p.paint("text", "Uso:", { bold: true })} gavriel ${p.paint("brand", "<comando>")} ${p.paint("muted", "[opciones]")}`, ""];
  for (const [title, rows] of SECTIONS) {
    lines.push(p.paint("brand", title, { bold: true }));
    for (const [c, d] of rows) lines.push(`  ${p.paint("text", c.padEnd(width))}  ${p.paint("muted", d)}`);
    lines.push("");
  }
  lines.push(
    `${p.paint("brand", "Opciones globales", { bold: true })}  ${p.paint("muted", "-p/--profile  --json  -y/--yes  --no-color  --plain  --no-anim  --logo blocks|braille|text|none  -h/--help  -v/--version")}`,
    `${p.paint("brand", "Códigos de salida", { bold: true })}   ${p.paint("muted", `0 ok ${g.dot} 1 error ${g.dot} 2 uso incorrecto ${g.dot} 130 cancelado`)}`,
    `${p.paint("brand", "Entorno", { bold: true })}            ${p.paint("muted", "NO_COLOR, FORCE_COLOR, GAVRIEL_THEME=light|dark, GAVRIEL_NO_ANIM, GAVRIEL_ASCII, GAVRIEL_PLAIN, GAVRIEL_LOGO")}`,
  );
  return lines.join("\n");
}

const COMMANDS: Record<string, (ctx: cmd.Ctx) => Promise<void>> = {
  login: cmd.login, renew: cmd.renew, logout: cmd.logout, whoami: cmd.whoami, doctor: cmd.doctor,
  menu: async () => runMenu(() => helpText(process.stdout)),
  profile: cmd.profile, profiles: cmd.profile, totp: cmd.totpCmd, mcp: cmd.mcp,
  tickets: cmd.tickets, events: cmd.events, accounts: cmd.accounts,
};

async function main(): Promise<void> {
  ui.setVersion(VERSION);
  const argv = process.argv.slice(2);
  const dd = argv.indexOf("--");
  const profileFlags = (dd < 0 ? argv : argv.slice(0, dd)).filter((a) => /^(-p|--profile)(=.*)?$/.test(a)).length;
  if (profileFlags > 1) {
    console.error(ui.line("fail", "Opción -p/--profile repetida: indicá un solo perfil."));
    process.exitCode = 2;
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: cmd.OPTIONS, allowPositionals: true });
  } catch (e) {
    console.error(`${ui.line("fail", (e as Error).message)}\nVer: gavriel --help`);
    process.exitCode = 2;
    return;
  }
  const { values, positionals } = parsed;
  ui.configure({ noColor: values["no-color"], plain: values.plain, noAnim: values["no-anim"] });
  if (values.logo !== undefined) {
    if (!["blocks", "braille", "text", "none"].includes(values.logo)) {
      console.error(ui.line("fail", "--logo debe ser blocks, braille, text o none"));
      process.exitCode = 2;
      return;
    }
    ui.setLogoMode(values.logo as ui.LogoMode);
  }
  if (values.version) return console.log(`gavriel ${VERSION}`);
  const [name, ...args] = positionals;
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY && !values.json);
  if (!name && !values.help && interactive) {
    try {
      await runMenu(() => helpText(process.stdout));
    } catch (err) {
      if (!(err instanceof cmd.SilentError)) console.error(ui.line("fail", `Error: ${(err as Error).message}`));
      process.exitCode = err instanceof InputError ? err.exitCode : 1;
    } finally {
      closeInput();
    }
    return;
  }
  if (values.help || !name) {
    await ui.banner({ stream: process.stdout });
    return console.log(helpText(process.stdout));
  }
  const run = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!run) {
    console.error(`${ui.line("fail", `Comando desconocido: ${name}`)}\n\n${helpText(process.stderr)}`);
    process.exitCode = 2;
    return;
  }
  try {
    await run({ values, args });
  } catch (err) {
    if (!(err instanceof cmd.SilentError)) console.error(ui.line("fail", `Error: ${(err as Error).message}`));
    process.exitCode = err instanceof InputError ? err.exitCode : 1;
  } finally {
    closeInput();
  }
}

void main();
