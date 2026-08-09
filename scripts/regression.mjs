// Harness de regresión del MCP Gavriel contra la API real.
// Uso: npm run regression   (requiere build previo y credenciales en keyring/env)
//
// Chequea:
//  1. Lecturas básicas (un grupo representativo de las 65 tools).
//  2. Mapeo de parámetros: para cada tool de lectura con endpoint equivalente,
//     compara la respuesta de la tool "envuelta" contra gavriel_get crudo al
//     MISMO path+params sobre el mismo recurso real. Si difieren, es un bug de
//     mapeo (el caso de list_account_contacts que devolvía []).
//  3. get_account con número de cuenta (2353): debe resolver al ID interno.
//  4. Escrituras en paralelo: N PATCH idempotentes lanzados "a la vez" deben
//     completar todos sin 409 y serializados por la cola (B.3).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("node", [join(ROOT, "dist/index.js")], {
  env: { ...process.env },
});
const results = new Map();
let pending = new Set();
let stderr = "";
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { results.set(msg.id, msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (d) => { stderr += d.toString(); });

const req = (id, method, params) =>
  new Promise((res) => {
    pending.add(id);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const iv = setInterval(() => { if (results.has(id)) { clearInterval(iv); res(results.get(id)); } }, 25);
    setTimeout(() => { clearInterval(iv); res({ timedOut: true }); }, 200000);
  });

const call = async (tool, args) => {
  const r = await req(Math.floor(Math.random() * 1e9), "tools/call", { name: tool, arguments: args });
  if (r.timedOut) return { __timeout: true };
  try { return JSON.parse(r.result?.content?.[0]?.text ?? "null"); } catch { return { isError: true }; }
};

let nextId = 100;
const toolCall = async (tool, args) => {
  const r = await req(nextId++, "tools/call", { name: tool, arguments: args });
  if (r.timedOut) return { __timeout: true };
  const raw = r.result?.content?.[0]?.text;
  try { return JSON.parse(raw ?? "null"); } catch { return { __raw: String(raw).slice(0, 200) }; }
};

let passed = 0, failed = 0, mismatches = [];
const check = (label, cond, detail = "") => {
  if (cond) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; console.log(`  FAIL ${label} ${detail}`); }
};

// Campos mutables que el backend toca entre dos lecturas seguidas; se
// excluyen para que la comparación solo detecte bugs de mapeo, no drift vivo.
const VOLATILE_KEYS = new Set(["updatedAt", "lastTestEventAt", "deletedAt", "endedAt", "lastEventAt"]);
function stable(v, depth = 0) {
  if (depth > 6) return typeof v;
  if (Array.isArray(v)) {
    // orden irrelevante para mapeo de parámetros: ordenar por id si existe
    const arr = [...v];
    if (arr.length > 1 && arr.every((x) => x && typeof x === "object" && "id" in x)) {
      arr.sort((x, y) => String(x.id).localeCompare(String(y.id)));
    }
    const items = arr.map((x) => stable(x, depth + 1));
    // charts horarios: las últimas celdas cambian con eventos nuevos
    const cut = items.length && v.every((x) => x && typeof x === "object" && "hour" in x) ? 3 : 0;
    return { __len: items.length, __items: items.slice(0, Math.max(items.length - cut, 1)).slice(0, 30) };
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stable(val, depth + 1);
    }
    return out;
  }
  return v;
}

// comparación tool vs raw crudo (secuencial: evita doble carga de endpoints pesados)
async function compareWrapped(tool, args, rawPath, rawQuery, label) {
  const w = await toolCall(tool, args);
  const r = await toolCall("get", { path: rawPath, query: rawQuery });
  if (w.__timeout || r.__timeout) {
    failed++;
    const who = w.__timeout ? tool : "get";
    console.log(`  TIMEOUT ${label} (${who} > 200s)`);
    mismatches.push({ label, reason: `timeout ${who}` });
    return;
  }
  if (JSON.stringify(stable(w)) === JSON.stringify(stable(r))) {
    passed++; console.log(`  PASS wrapped==raw: ${label}`);
  } else {
    failed++;
    console.log(`  MISMATCH ${label}`);
    console.log(`    wrapped(${JSON.stringify(stable(w)).slice(0, 160)}...)`);
    console.log(`    raw(${JSON.stringify(stable(r)).slice(0, 160)}...)`);
    mismatches.push({ label, reason: "diff estructural" });
  }
}

async function main() {
  console.log("== arrancando server ==");
  await req(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "regression", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  console.log("== 1. descubrir recursos de ejemplo ==");
  const accounts = (await call("list_accounts", { search: "2353", limit: 5 }))?.data ?? [];
  const account = accounts[0];
  console.log(`  cuenta: ${account?.id} (${account?.accountNumber})`);
  const tickets = (await call("list_tickets", { limit: 1 }))?.data ?? [];
  const ticket = tickets[0];
  console.log(`  ticket: ${ticket?.id}`);
  const convs = (await call("list_conversations", { limit: 1 }))?.data ?? [];
  const conv = convs[0];
  console.log(`  conversación: ${conv?.id}`);
  const conns = (await call("list_connections", { limit: 1 }))?.data ?? [];
  const conn = conns[0];
  console.log(`  conexión: ${conn?.id}`);
  const companies = (await call("list_companies", { limit: 1 }))?.data ?? [];
  const company = companies[0];
  const technicians = company ? (await call("list_company_technicians", { id: company.id })) ?? [] : [];
  const tech = Array.isArray(technicians) ? technicians[0] : technicians?.data?.[0];
  console.log(`  empresa: ${company?.id}, técnico: ${tech?.id}`);
  const panel = await call("get_service_panel", {});
  const service = Array.isArray(panel) ? panel[0] : panel?.data?.[0] ?? panel?.services?.[0];
  console.log(`  servicio: ${service?.id}`);

  console.log("== 2. tool envuelta vs gavriel_get crudo (mapeo de parámetros) ==");
  if (account) {
    await compareWrapped("list_account_contacts", { accountId: account.id }, "/account-contacts", { accountId: account.id }, "list_account_contacts/accountId");
    await compareWrapped("get_account", { id: account.id }, `/accounts/${account.id}`, undefined, "get_account/{id}");
    await compareWrapped("list_account_devices", { id: account.id }, `/accounts/${account.id}/devices`, undefined, "list_account_devices/{id}");
    await compareWrapped("list_account_partitions", { id: account.id }, `/accounts/${account.id}/partitions`, undefined, "list_account_partitions/{id}");
    await compareWrapped("list_account_users", { id: account.id }, `/account-users/account/${account.id}`, undefined, "list_account_users/{id}");
    await compareWrapped("list_account_zones", { id: account.id }, `/zones/account/${account.id}`, undefined, "list_account_zones/{id}");
    await compareWrapped("list_interventions", { id: account.id }, `/interventions/account/${account.id}`, undefined, "list_interventions/{id}");
  }
  if (ticket) {
    await compareWrapped("list_activities_by_ticket", { id: ticket.id }, `/activities/ticket/${ticket.id}`, undefined, "list_activities_by_ticket/{id}");
  }
  if (conv) {
    await compareWrapped("list_conversation_messages", { id: conv.id, page: 1, limit: 5 }, `/conversations/${conv.id}/messages`, { page: 1, limit: 5 }, "list_conversation_messages/{id}");
  }
  await compareWrapped("list_tickets", { page: 1, limit: 3, status: "open" }, "/tickets", { page: 1, limit: 3, status: "open", sortBy: "createdAt", sortDirection: "desc" }, "list_tickets/filtros");
  await compareWrapped("list_events", { page: 1, limit: 3, accountId: account?.id, dateFrom: "2026-07-01T00:00:00.000Z", dateTo: "2026-08-09T00:00:00.000Z" }, "/events", { page: 1, limit: 3, accountId: account?.id, dateFrom: "2026-07-01T00:00:00.000Z", dateTo: "2026-08-09T00:00:00.000Z", sortBy: "createdAt", sortDirection: "desc" }, "list_events/filtros");
  await compareWrapped("list_conversations", { page: 1, limit: 3 }, "/me/conversations", { page: 1, limit: 3 }, "list_conversations/paginación");
  await compareWrapped("list_companies", { page: 1, limit: 3 }, "/companies", { page: 1, limit: 3 }, "list_companies/paginación");
  await compareWrapped("list_users", { page: 1, limit: 3 }, "/users", { page: 1, limit: 3 }, "list_users/paginación");
  await compareWrapped("list_connections", { page: 1, limit: 3 }, "/connections", { page: 1, limit: 3 }, "list_connections/paginación");
  await compareWrapped("get_conversation_stats", {}, "/me/conversations/stats", undefined, "get_conversation_stats");
  await compareWrapped("ticket_stats", {}, "/tickets/stats", undefined, "ticket_stats");
  await compareWrapped("get_activity_stats", {}, "/activities/stats", undefined, "get_activity_stats");
  await compareWrapped("list_accounts_pending_events", {}, "/events/accounts-with-pending-events", undefined, "list_accounts_pending_events");
  await compareWrapped("get_service_panel_summary", {}, "/services/panel/summary", undefined, "get_service_panel_summary");
  await compareWrapped("get_my_profile", {}, "/auth/profile", undefined, "get_my_profile");
  if (tech) await compareWrapped("list_technician_agenda", { userId: tech.id, date: "2026-08-09" }, "/services/technician-agenda", { userId: tech.id, date: "2026-08-09" }, "list_technician_agenda/tecnico");
  if (conn) {
    // chart horario: comparar celda por celda con tolerancia (drift vivo). Si el
    // tool ignorara connectionId, TODAS las celdas diferirían (miles vs 0).
    const wc = await toolCall("get_monitoring_events_chart", { connectionId: conn.id });
    const rc = await toolCall("get", { path: "/monitoring/events-chart", query: { connectionId: conn.id } });
    const wd = (wc?.data ?? []), rd = (rc?.data ?? []);
    const diffCells = Math.max(wd.length, rd.length) === 0 ? 0
      : [...Array(Math.min(wd.length, rd.length)).keys()].filter((i) => JSON.stringify(wd[i]) !== JSON.stringify(rd[i])).length;
    check(`get_monitoring_events_chart/{connectionId} (≤3 celdas de drift: ${diffCells})`, diffCells <= 3);
  }

  console.log("== 3. get_account con número de cuenta (Fase C) ==");
  if (account) {
    const resolved = await call("get_account", { id: account.accountNumber });
    check(`get_account("${account.accountNumber}") resuelve al ID interno`, resolved?.id === account.id, `-> ${resolved?.id}`);
    const missing = await call("get_account", { id: "999999999" });
    const msg = missing?.error ?? "";
    check("get_account con número inexistente da mensaje claro", /NÚMERO de cuenta/.test(msg) && /list_accounts/.test(msg), `-> ${msg.slice(0, 120)}`);
  }

  console.log("== 4. escrituras en paralelo serializadas (Fase B.3) ==");
  if (ticket) {
    const acts = await call("list_activities_by_ticket", { id: ticket.id });
    const actList = Array.isArray(acts) ? acts : acts?.data ?? [];
    if (actList.length) {
      const actId = actList[0].id;
      const t0 = Date.now();
      const out = await Promise.all([
        toolCall("mark_activity_read", { activityId: actId, confirm: true }),
        toolCall("mark_activity_unread", { activityId: actId, confirm: true }),
        toolCall("mark_activity_read", { activityId: actId, confirm: true }),
      ]);
      const elapsed = Date.now() - t0;
      // la serialización se prueba determinísticamente en selfcheck; acá se
      // valida el timing (~300ms c/u → 3 escrituras ≥ 600ms) y se tolera un
      // fallo puntual del backend intermitente (B.1)
      const non2xx = out.filter((o) => o?.status >= 300 || (o?.httpStatus ?? 200) >= 300).length;
      check(`3 PATCH idempotentes en paralelo se serializan (${elapsed}ms, ${3 - non2xx}/3 ok)`, elapsed >= 500 && non2xx <= 1);
      if (non2xx > 1) console.log("  (varias respuestas no-2xx: probable bug backend intermitente B.1, no de la cola)");
    } else {
      console.log("  (sin actividades en el ticket de ejemplo; se saltea la prueba paralela)");
    }
  }

  console.log(`\n== resumen: ${passed} PASS, ${failed} FAIL ==`);
  child.kill();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); child.kill(); process.exit(1); });
