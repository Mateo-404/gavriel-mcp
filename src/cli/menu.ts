import * as cmd from "./commands.js";
import { ask, closeInput, confirm, InputError } from "./io.js";
import { loadStore } from "../profiles.js";
import * as ui from "./ui.js";

// ── Selector inline (flechas / j k / números / Enter / Esc) ──────────────────
// Inline y no pantalla completa: conserva el scrollback del shell y devuelve un valor limpio (skill tui-design).
export interface Item<T> {
  label: string;
  hint?: string;
  value: T;
}

const CSI = "\x1b[";

export async function select<T>(
  title: string,
  items: readonly Item<T>[],
  opts: { initial?: number; footer?: string; stdin?: NodeJS.ReadStream; out?: NodeJS.WriteStream } = {},
): Promise<T | undefined> {
  if (items.length === 0) return undefined;
  const stdin = opts.stdin ?? process.stdin;
  const out = opts.out ?? process.stderr;
  if (!stdin.isTTY) throw new Error("El menú requiere una terminal interactiva.");
  const p = ui.painter(out);
  const g = ui.glyphs();
  let index = Math.min(Math.max(opts.initial ?? 0, 0), items.length - 1);
  const width = Math.max(...items.map((i) => ui.visibleWidth(i.label)));
  const footer = opts.footer ?? `↑↓ mover ${g.dot} Enter elegir ${g.dot} Esc volver ${g.dot} 1-9 atajo`.replace(/↑↓/, ui.unicodeOn() ? "↑↓" : "up/down");

  const frame = (): string[] => [
    `${p.paint("brand", g.ask, { bold: true })} ${p.bold(title)}`,
    ...items.map((it, i) => {
      const num = i < 9 ? `${i + 1}` : " ";
      const hint = it.hint ? `  ${p.paint("muted", ui.truncate(it.hint, Math.max(10, (out.columns ?? 80) - width - 14)))}` : "";
      return i === index
        ? `  ${p.paint("brand", g.arrow, { bold: true })} ${p.paint("faint", num)} ${p.paint("brand", ui.padLabel(it.label, width), { bold: true })}${hint}`
        : `    ${p.paint("faint", num)} ${ui.padLabel(it.label, width)}${hint}`;
    }),
    p.paint("faint", `  ${footer}`),
  ];

  closeInput(); // un único dueño de stdin: el lector de líneas no puede convivir con el modo raw
  const height = items.length + 2;
  const draw = (first: boolean): void => {
    if (!first) out.write(`${CSI}${height}A${CSI}0J`);
    out.write(`${frame().join("\n")}\n`);
  };
  const hide = `${CSI}?25l`, show = `${CSI}?25h`;
  const onExit = (): void => { out.write(show); };
  process.once("exit", onExit);
  out.write(hide);
  draw(true);

  return new Promise<T | undefined>((resolve, reject) => {
    const finish = (result: T | undefined, err?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.off("exit", onExit);
      out.write(`${CSI}${height}A${CSI}0J${show}`);
      if (err) return reject(err);
      if (result !== undefined) {
        const chosen = items.find((i) => i.value === result);
        out.write(`${p.paint("ok", g.ok, { bold: true })} ${p.bold(title)} ${p.paint("muted", g.arrow)} ${p.paint("brand", chosen?.label ?? "")}\n`);
      }
      resolve(result);
    };
    const onData = (chunk: string): void => {
      const key = chunk;
      if (key === "\u0003") return finish(undefined, new InputError("Cancelado", 130));
      if (key === "\u001b" || key === "q") return finish(undefined);
      if (key === "\r" || key === "\n" || key === " ") return finish(items[index].value);
      if (key === `${CSI}A` || key === "k") index = (index - 1 + items.length) % items.length;
      else if (key === `${CSI}B` || key === "j" || key === "\t") index = (index + 1) % items.length;
      else if (key === `${CSI}H` || key === `${CSI}1~`) index = 0;
      else if (key === `${CSI}F` || key === `${CSI}4~`) index = items.length - 1;
      else if (/^[1-9]$/.test(key) && Number(key) <= items.length) return finish(items[Number(key) - 1].value);
      else return;
      draw(false);
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

// ── Menú principal ─────────────────────────────────────────────────────────
type Ctx = cmd.Ctx;
const ctxOf = (values: Ctx["values"] = {}, args: string[] = []): Ctx => ({ values, args });

function profileNames(): string[] {
  return Object.keys(loadStore().profiles);
}

async function pickProfile(title = "¿Qué cuenta?"): Promise<string | undefined> {
  const store = loadStore();
  const names = Object.keys(store.profiles);
  if (names.length === 0) {
    console.log(ui.line("info", "No hay cuentas guardadas. Iniciá sesión primero.", process.stdout));
    return undefined;
  }
  const items = names.map((n) => ({ label: n, hint: `${store.profiles[n].email}${store.active === n ? "  (activa)" : ""}`, value: n }));
  return select(title, items, { initial: Math.max(0, names.indexOf(store.active ?? "")) });
}

async function pause(): Promise<void> {
  await ask(ui.prompt("Enter para volver al menú"));
}

/** Ejecuta una acción mostrando sus errores sin salir del menú (Ctrl-C sí sale). */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (e) {
    if (e instanceof InputError && e.exitCode === 130) throw e;
    if (!(e instanceof cmd.SilentError)) console.error(ui.line("fail", `Error: ${(e as Error).message}`));
  }
  console.log("");
  await pause();
}

function header(): void {
  const store = loadStore();
  const p = ui.painter(process.stderr);
  const active = store.active && Object.hasOwn(store.profiles, store.active) ? store.profiles[store.active] : undefined;
  const line = active
    ? `${p.paint("muted", "Cuenta activa")} ${p.paint("brand", store.active ?? "", { bold: true })} ${p.paint("muted", `<${active.email}>`)}${active.role ? p.paint("faint", `  rol ${active.role}`) : ""}`
    : p.paint("warn", "Sin cuenta activa — elegí «Iniciar sesión»");
  console.error(`${line}   ${p.paint("faint", `${profileNames().length} cuenta(s)`)}\n`);
}

async function accountsMenu(): Promise<void> {
  for (;;) {
    const choice = await select("Cuentas", [
      { label: "Ver cuentas", hint: "lista de perfiles guardados", value: "list" },
      { label: "Cambiar cuenta activa", value: "use" },
      { label: "Renombrar", value: "rename" },
      { label: "Cerrar sesión", hint: "borra el dispositivo confiable", value: "logout" },
      { label: "Eliminar cuenta", hint: "borra perfil, password y semilla", value: "remove" },
      { label: "Volver", value: "back" },
    ] as const);
    if (!choice || choice === "back") return;
    if (choice === "list") { await run(() => cmd.profile(ctxOf({}, ["list"]))); continue; }
    const name = await pickProfile();
    if (!name) { await pause(); continue; }
    if (choice === "use") await run(() => cmd.profile(ctxOf({}, ["use", name])));
    else if (choice === "logout") await run(() => cmd.logout(ctxOf({ profile: name })));
    else if (choice === "rename") {
      await run(async () => cmd.profile(ctxOf({}, ["rename", name, await ask(ui.prompt("Nuevo nombre"))])));
    } else if (choice === "remove") {
      await run(async () => {
        if (!(await confirm(`¿Eliminar "${name}" junto con su password y semilla?`))) throw new Error("Cancelado");
        await cmd.profile(ctxOf({ purge: true }, ["remove", name]));
      });
    }
  }
}

async function totpMenu(): Promise<void> {
  const name = await pickProfile("¿Para qué cuenta?");
  if (!name) return pause();
  for (;;) {
    const choice = await select(`Código TOTP · ${name}`, [
      { label: "Ver código en vivo", hint: "cuenta regresiva de 30 s", value: "code" },
      { label: "Guardar semilla", hint: "renovación automática del dispositivo", value: "set" },
      { label: "Borrar semilla", value: "clear" },
      { label: "Volver", value: "back" },
    ] as const);
    if (!choice || choice === "back") return;
    await run(() => cmd.totpCmd(ctxOf({ profile: name }, [choice])));
  }
}

async function queriesMenu(): Promise<void> {
  for (;;) {
    const choice = await select("Consultas", [
      { label: "Tickets", hint: "con filtro de estado", value: "tickets" },
      { label: "Eventos pendientes", hint: "cuentas con eventos sin atender", value: "events" },
      { label: "Buscar cuenta", hint: "por nombre o número", value: "accounts" },
      { label: "Volver", value: "back" },
    ] as const);
    if (!choice || choice === "back") return;
    if (!profileNames().length) { console.log(ui.line("info", "Primero iniciá sesión.", process.stdout)); await pause(); return; }
    if (choice === "tickets") {
      const status = await select("Estado", [
        { label: "Todos", value: "" }, { label: "Abiertos", value: "open" }, { label: "En progreso", value: "in_progress" },
        { label: "Pendiente cliente", value: "pending_customer" }, { label: "Cerrados", value: "closed" },
      ] as const);
      if (status === undefined) continue;
      await run(() => cmd.tickets(ctxOf({ ...(status && { status }), limit: "20" })));
    } else if (choice === "events") await run(() => cmd.events(ctxOf({}, ["pending"])));
    else await run(async () => cmd.accounts(ctxOf({ limit: "20" }, ["search", await ask(ui.prompt("Buscar"))])));
  }
}

async function installMenu(): Promise<void> {
  if (!profileNames().length) { console.log(ui.line("info", "Primero iniciá sesión.", process.stdout)); return pause(); }
  const client = await select("¿Dónde instalar el MCP?", [
    { label: "Claude Desktop", hint: "edita claude_desktop_config.json (con backup)", value: "desktop" },
    { label: "Claude Code", hint: "imprime el comando `claude mcp add`", value: "code" },
  ] as const);
  if (!client) return;
  const mode = client === "desktop"
    ? await select("¿Qué hacer?", [
        { label: "Vista previa", hint: "no escribe nada", value: "dry" },
        { label: "Instalar", hint: "pide confirmación", value: "install" },
        { label: "Instalar y reemplazar si existe", value: "force" },
      ] as const)
    : "install";
  if (!mode) return;
  await run(() => cmd.mcp(ctxOf({ client, ...(mode === "dry" && { "dry-run": true }), ...(mode === "force" && { force: true }) }, ["install"])));
}

/** Menú interactivo (TUI inline). Requiere stdin y stderr en una terminal. */
export async function runMenu(help: () => string): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error("El menú requiere una terminal interactiva (usá los subcomandos o --help).");
  await ui.banner({ stream: process.stderr });
  let last = 0;
  for (;;) {
    header();
    const choice = await select("¿Qué querés hacer?", [
      { label: "Iniciar sesión / agregar cuenta", hint: "email + password, 2FA si hace falta", value: "login" },
      { label: "Renovar dispositivo confiable", hint: "vuelve a confiar este equipo (código o semilla)", value: "renew" },
      { label: "Cuentas", hint: "ver, cambiar, renombrar, eliminar", value: "accounts" },
      { label: "Código TOTP", hint: "ver código, guardar semilla", value: "totp" },
      { label: "Diagnóstico", hint: "almacén, perfil, API y sesión", value: "doctor" },
      { label: "Consultas", hint: "tickets, eventos pendientes, cuentas", value: "queries" },
      { label: "Instalar en Claude", hint: "registrar este MCP", value: "install" },
      { label: "Ayuda", value: "help" },
      { label: "Salir", value: "exit" },
    ] as const, { initial: last, footer: "↑↓ mover · Enter elegir · 1-9 atajo · Esc/q salir" });
    if (!choice || choice === "exit") break;
    last = ["login", "renew", "accounts", "totp", "doctor", "queries", "install", "help", "exit"].indexOf(choice);
    switch (choice) {
      case "login": await run(() => cmd.login(ctxOf())); break;
      case "renew": {
        const name = await pickProfile("¿Qué cuenta renovar?");
        if (name) await run(() => cmd.renew(ctxOf({ profile: name })));
        else await pause();
        break;
      }
      case "accounts": await accountsMenu(); break;
      case "totp": await totpMenu(); break;
      case "doctor": {
        const online = await confirm("¿Probar también un login real?");
        await run(() => cmd.doctor(ctxOf({ ...(online && { online: true }) })));
        break;
      }
      case "queries": await queriesMenu(); break;
      case "install": await installMenu(); break;
      case "help": console.log(help()); console.log(""); await pause(); break;
    }
    console.error("");
  }
  console.error(ui.line("ok", "Hasta luego.", process.stderr));
}
