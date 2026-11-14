// Prueba de punta a punta: Chrome aparte (perfil temporal) con la extensión cargada, sobre un servidor
// local que imita a Gavriel (mismo host, archivos con no-store y sonidos). No toca el Gavriel real.
//
//   bun run build && bun run e2e
//
// Necesita Chrome instalado (CHROME_PATH si no está en la ruta habitual) y openssl. Verifica con el
// contador de pedidos del servidor: los archivos con hash se bajan una sola vez en tres cargas, los
// sonidos elegidos no se piden y los demás sí, y los content scripts arrancan.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extDir = resolve(process.argv[2] ?? 'dist');
const scratch = mkdtempSync(join(tmpdir(), 'gv-e2e-files-'));
const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => existsSync(p));
if (!CHROME) throw new Error('No encontré Chrome: definí CHROME_PATH');
const HOST = 'app.gavriel.com.ar';
const NUL = String.fromCharCode(0);
const hits = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(scratch, 'k.pem'), '-out', join(scratch, 'c.pem'), '-days', '1', '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST},DNS:fonts.googleapis.com,DNS:fonts.gstatic.com`], { stdio: 'ignore' });

const NOSTORE = 'no-cache, no-store, must-revalidate';
const server = createServer({ key: readFileSync(join(scratch, 'k.pem')), cert: readFileSync(join(scratch, 'c.pem')) }, (req, res) => {
  const path = req.url.split('?')[0];
  const external = req.headers.host?.split(':')[0] !== HOST; // fonts.googleapis.com / fonts.gstatic.com
  if (external) {
    const key = `${req.headers.host}${path}`;
    hits[key] = (hits[key] ?? 0) + 1;
    res.writeHead(200, { 'content-type': path.endsWith('.css') || req.url.includes('css2') ? 'text/css' : 'font/woff2', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' });
    return res.end(req.url.includes('css2') ? "@font-face{font-family:'Geist';src:url(https://fonts.gstatic.com/x.woff2)}" : Buffer.alloc(10));
  }
  if (path === '/favicon.ico') return res.writeHead(404).end();
  hits[path] = (hits[path] ?? 0) + 1;
  if (path === '/api/accounts/acc1') {
    res.writeHead(200, { 'content-type': 'application/json', 'x-new-token': 'token-nuevo', etag: 'W/"acc"' });
    return res.end(JSON.stringify({ id: 'acc1', name: 'MERLO FERNANDO', accountNumber: '2904', address: 'J. M. NOLLI 1820', city: 'RAFAELA', state: 'Santa Fe', accountContacts: [{ order: 1, name: 'Ana Pérez', phone: '3416636288', description: 'Titular' }, { order: 2, name: 'Beto Gómez', phone: '3415016202', description: 'Hijo' }] }));
  }
  if (path === '/__react.js' || path === '/__react-dom.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(readFileSync(join(process.cwd(), path === '/__react.js' ? 'node_modules/react/umd/react.production.min.js' : 'node_modules/react-dom/umd/react-dom.production.min.js')));
  }
  if (path === '/__axios.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(readFileSync(join(process.cwd(), 'node_modules/axios/dist/axios.min.js')));
  }
  if (path === '/api/interventions/start' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (path === '/api/sip/calls') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ accountId: 'acc1', direction: 'outbound', remoteNumber: '703415016202', startedAt: '2026-11-14T19:31:00.920Z', recordingUrl: 'https://bucket/x?X-Amz-Signature=secreto' }, { accountId: 'acc1', direction: 'outbound', remoteNumber: '703416636288', startedAt: '2026-11-14T17:00:00.000Z' }] }));
  }
  if (!path.startsWith('/assets/') && !path.startsWith('/sounds/') && !path.startsWith('/api/')) {
    // como una SPA: cualquier pantalla devuelve la misma página
    // Gavriel responde con aislamiento de origen cruzado: se imita para comprobar que las tipografías locales cargan igual
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': NOSTORE, 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' });
    return res.end(`<!doctype html><title>t</title><body>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;700&display=swap">
<p style="font-family:Geist,sans-serif">Atención: señal perdida · Ñandú</p><code style="font-family:'Geist Mono',monospace">E130</code>
<script>fetch('/api/accounts/acc1').then(r=>r.json());fetch('/api/sip/calls?page=1&limit=30').then(r=>r.json());</script>
<script src="/__axios.js"></script>
<script src="/__react.js"></script>
<script src="/__react-dom.js"></script>
<script>
window.__sipClicks = { hangup: 0, panel: 0, colgar: 0 };
window.__mountSip = () => {
  const h = React.createElement;
  const Ctx = React.createContext(null);
  function SipProvider({ children }) {
    const [calling, setCalling] = React.useState(true);
    const value = React.useMemo(() => ({
      status: 'registrado', connected: true, calling, incoming: null,
      call: () => {}, answer: () => {}, reject: () => {},
      hangup: () => { window.__sipClicks.hangup++; setCalling(false); },
    }), [calling]);
    return h(Ctx.Provider, { value }, h('audio', { autoPlay: true, playsInline: true, style: { display: 'none' } }), children);
  }
  function Fab() {
    const sip = React.useContext(Ctx);
    // Como en Gavriel: el botón flotante se pone rojo durante la llamada; «Colgar» solo existe dentro del panel
    return h('div', { className: 'fixed' }, h('button', {
      'aria-label': sip.calling ? 'Abrir softphone' : 'Abrir softphone',
      className: sip.calling ? 'bg-destructive' : '',
      onClick: () => { window.__sipClicks.panel++; },
    }, 'tel'));
  }
  const root = document.createElement('div');
  document.body.append(root);
  ReactDOM.createRoot(root).render(h(SipProvider, null, h(Fab)));
};
</script>
<script src="/assets/index-ABCD1234.js"></script>
<script src="/assets/plain.js"></script>
<script>
for (const n of ['beep','alarm','siren','ding']) { const a = new Audio('/sounds/'+n+'.mp3'); a.load(); a.play().catch(()=>{}); }
</script></body>`);
  }
  if (path.startsWith('/assets/')) {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': NOSTORE, etag: 'W/"x"' });
    return res.end('window.__loaded=(window.__loaded||0)+1;');
  }
  if (path.startsWith('/sounds/')) {
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    return res.end(Buffer.alloc(2048));
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(8443, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'gv-e2e-'));
const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--remote-debugging-port=9333', '--enable-unsafe-extension-debugging',
  // REAL_FONTS=1: Google Fonts real por internet (solo Gavriel se imita). HEADFUL=1: con ventana.
  process.env.REAL_FONTS
    ? `--host-resolver-rules=MAP ${HOST} 127.0.0.1:8443`
    : `--host-resolver-rules=MAP ${HOST} 127.0.0.1:8443, MAP fonts.googleapis.com 127.0.0.1:8443, MAP fonts.gstatic.com 127.0.0.1:8443`,
  '--ignore-certificate-errors',
  '--no-first-run', '--no-default-browser-check', ...(process.env.HEADFUL ? [] : ['--headless=new']), 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

// Extensions.loadUnpacked solo existe por la tubería de depuración (Chrome de marca ya no acepta --load-extension)
const pipeOut = chrome.stdio[3];
const pipeIn = chrome.stdio[4];
let pipeBuf = '';
const waiters = new Map();
pipeIn.on('data', (d) => {
  pipeBuf += d.toString();
  let i;
  while ((i = pipeBuf.indexOf(NUL)) >= 0) {
    const msg = JSON.parse(pipeBuf.slice(0, i));
    pipeBuf = pipeBuf.slice(i + 1);
    if (msg.id && waiters.has(msg.id)) waiters.get(msg.id)(msg);
  }
});
let pipeId = 0;
const pipeSend = (method, params = {}) => new Promise((r) => { const id = ++pipeId; waiters.set(id, r); pipeOut.write(JSON.stringify({ id, method, params }) + NUL); });

const out = {};
try {
  await sleep(2000);
  const loaded = await pipeSend('Extensions.loadUnpacked', { path: extDir.replace(/\//g, '\\') });
  out.loadUnpacked = loaded.result ?? loaded.error;

  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.length) break; } catch {}
    await sleep(500);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) pending.get(d.id)(d); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable');

  await sleep(4000); // el fondo sincroniza las reglas dinámicas al instalarse
  const all = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const mine = loaded.result?.id;
  out.myTargets = all.filter((t) => mine && t.url.includes(mine)).map((t) => t.type + ' ' + t.url.split('/').pop());
  const sw = all.find((t) => t.type === 'service_worker' && mine && t.url.includes(mine));
  if (sw) {
    const w2 = new WebSocket(sw.webSocketDebuggerUrl);
    await new Promise((r) => (w2.onopen = r));
    const ask = (expression) => new Promise((r) => { const i = 9000 + Math.floor(Math.random() * 999); w2.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === i) r(d.result?.result?.value ?? JSON.stringify(d.result?.exceptionDetails ?? d.error)); }; w2.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    out.dynamicRules = await ask('chrome.declarativeNetRequest.getDynamicRules().then(r=>r.map(x=>x.condition.urlFilter))');
    out.enabledRulesets = await ask('chrome.declarativeNetRequest.getEnabledRulesets()');
    out.version = await ask('chrome.runtime.getManifest().name+" "+chrome.runtime.getManifest().version');
    w2.close();
  }

  const load = async () => { await send('Page.navigate', { url: `https://${HOST}/` }); await sleep(2500); };
  await load(); await load(); await load();
  out.hits = { ...hits };
  const cached = (u) => evalJs(`fetch('${u}',{cache:'only-if-cached',mode:'same-origin'}).then(r=>r.status).catch(e=>'no-esta-en-cache')`);
  out.hashedInCache = await cached('/assets/index-ABCD1234.js');
  out.plainInCache = await cached('/assets/plain.js');
  // ¿qué tipografías cargó la página realmente? (FontFace con estado 'loaded' y de dónde vinieron)
  out.fontsLoaded = await evalJs(`document.fonts.ready.then(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+':'+f.unicodeRange.slice(0,8)))`);
  // --- Alt+Shift y Alt+C con teclas reales sobre «una cuenta»: deben salir de los datos que la página recibió
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: `https://${HOST}` }).catch(() => {});
  await send('Page.navigate', { url: `https://${HOST}/monitoring-panel/account-analysis?accountId=acc1` });
  await sleep(2500);
  const key = (type, k, code, vk, modifiers) => send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
  const toast = () => evalJs(`document.querySelector('.gv-toast')?.textContent ?? ''`);
  await key('keyDown', 'Alt', 'AltLeft', 18, 1); await key('keyDown', 'Shift', 'ShiftLeft', 16, 9);
  await key('keyUp', 'Shift', 'ShiftLeft', 16, 1); await key('keyUp', 'Alt', 'AltLeft', 18, 0);
  await sleep(500);
  out.altShiftToast = await toast();
  out.altShiftClipboard = await evalJs(`navigator.clipboard.readText().catch(e=>'error:'+e.message)`);
  await key('keyDown', 'c', 'KeyC', 67, 1); await key('keyUp', 'c', 'KeyC', 67, 1);
  await sleep(500);
  out.altCToast = await toast();
  out.altCClipboard = await evalJs(`navigator.clipboard.readText().catch(e=>'error:'+e.message)`);
  out.contentScriptAttrs = await evalJs(`document.documentElement.getAttributeNames().filter(a=>a.startsWith('data-gv')||a.startsWith('data-gavriel')).join(',')`);
  // --- ¿Un depurador conectado (como el de la extensión de Claude) saltea el bloqueo de red?
  const linkTest = () => evalJs(`new Promise((res) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400&display=swap&t=' + Math.random(); l.onload = () => res('cargó'); l.onerror = () => res('bloqueado'); document.head.append(l); setTimeout(() => res('sin respuesta'), 4000); })`);
  out.fontLinkWithoutNetworkDomain = await linkTest();
  // Pedido como el de la precarga de Chrome (sin destino de hoja de estilo): también debe bloquearse
  out.fontNoCorsFetch = await evalJs(`fetch('https://fonts.googleapis.com/css2?family=Geist:wght@400&display=swap&f=' + Math.random(), { mode: 'no-cors' }).then(() => 'cargó').catch(() => 'bloqueado')`);
  await send('Network.enable');
  out.fontLinkWithNetworkDomain = await linkTest();
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  out.fontLinkWithCacheDisabled = await linkTest();
  await send('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*' }] });
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Fetch.requestPaused') ws.send(JSON.stringify({ id: 99999, method: 'Fetch.continueRequest', params: { requestId: d.params.requestId } })); });
  out.fontLinkWithFetchInterception = await linkTest();
  await send('Fetch.disable');
  await send('Network.disable');
  // --- axios real (como Gavriel): el segundo pedido idéntico de la cuenta sale de memoria
  const before = hits['/api/accounts/acc1'] ?? 0;
  const run = (body) => evalJs(`(async () => { ${body} })()`);
  out.axios = await run(`
    const get = () => axios.get('/api/accounts/acc1', { headers: { Authorization: 'Bearer prueba' } });
    const a = await get(); const b = await get();
    return { name: [a.data.name, b.data.name], status: [a.status, b.status], etag: [a.headers.etag, b.headers.etag], newToken: [a.headers['x-new-token'] ?? null, b.headers['x-new-token'] ?? null] };
  `);
  out.axiosHitsAfterTwoGets = (hits['/api/accounts/acc1'] ?? 0) - before;
  await run(`await axios.post('/api/interventions/start', {}, { headers: { Authorization: 'Bearer prueba' } });`);
  await run(`await axios.get('/api/accounts/acc1', { headers: { Authorization: 'Bearer prueba' } });`);
  out.axiosHitsAfterWrite = (hits['/api/accounts/acc1'] ?? 0) - before;
  await run(`await axios.get('/api/accounts/acc1', { headers: { Authorization: 'Bearer otra-sesion' } });`);
  out.axiosHitsOtherSession = (hits['/api/accounts/acc1'] ?? 0) - before;
  // --- Colgar: Ctrl+Enter llama a hangup() del contexto de React, sin abrir el panel ni cambiar de pestaña
  await evalJs('window.__mountSip()');
  await sleep(500);
  await key('keyDown', 'Control', 'ControlLeft', 17, 2); await key('keyDown', 'Enter', 'Enter', 13, 2);
  await key('keyUp', 'Enter', 'Enter', 13, 2); await key('keyUp', 'Control', 'ControlLeft', 17, 0);
  await sleep(500);
  out.sipClicks = await evalJs('window.__sipClicks');
  out.sipToast = await toast();
  out.netStatus = await evalJs(`document.documentElement.getAttribute('data-gv-net')`);
  ws.close();
} catch (e) {
  out.error = String(e);
} finally {
  chrome.kill();
  server.close();
}
console.log(JSON.stringify(out, null, 2));

// --- verificaciones
assert.equal(out.error, undefined, out.error);
assert.ok(out.loadUnpacked?.id, 'la extensión no cargó');
assert.deepEqual([...out.enabledRulesets].sort(), ['cache', 'fonts'], 'los conjuntos de reglas de caché y tipografías deben estar activos');
assert.equal(out.hits['/assets/index-ABCD1234.js'], 1, 'el archivo con hash debía bajarse una sola vez en tres cargas');
assert.equal(out.hits['/assets/plain.js'], 3, 'el archivo sin hash no debe guardarse (control)');
assert.equal(out.hits['/'], 3, 'la página principal debe pedirse siempre');
for (const name of ['beep', 'alarm', 'siren']) {
  assert.equal(out.hits[`/sounds/${name}.mp3`], undefined, `${name} debía estar bloqueado`);
}
assert.ok(out.hits['/sounds/ding.mp3'] >= 1, 'un sonido no silenciado debe descargarse');
assert.equal(out.hits['fonts.googleapis.com/css2'], undefined, 'el CSS de Google Fonts no debía pedirse');
assert.equal(out.hits['fonts.gstatic.com/x.woff2'], undefined, 'no debía pedirse nada a gstatic');
assert.ok(out.fontsLoaded.some((f) => f.startsWith('Geist:')), 'Geist no cargó desde la extensión');
assert.ok(out.fontsLoaded.some((f) => f.startsWith('Geist Mono:')), 'Geist Mono no cargó desde la extensión');
assert.equal(out.altShiftToast, 'Copiado: Beto Gómez', 'Alt+Shift debía copiar al último contacto llamado desde los datos de la página');
assert.equal(out.altShiftClipboard, 'Beto Gómez');
// Windows entrega el portapapeles con CRLF
assert.equal(out.altCClipboard.replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10)), 'Estimado/a cliente: *MERLO FERNANDO*\nAlarma de: *J. M. NOLLI 1820, RAFAELA · Santa Fe*');
assert.deepEqual(out.axios.name, ['MERLO FERNANDO', 'MERLO FERNANDO'], 'axios debía recibir la cuenta las dos veces');
assert.deepEqual(out.axios.status, [200, 200]);
assert.equal(out.axiosHitsAfterTwoGets, 1, 'el segundo pedido idéntico debía salir de memoria (1 solo pedido al servidor)');
assert.equal(out.axios.etag[1], out.axios.etag[0], 'la copia en memoria conserva las cabeceras');
assert.equal(out.axios.newToken[1], null, 'la copia en memoria no devuelve un token de renovación viejo');
assert.equal(out.axiosHitsAfterWrite, 2, 'después de una escritura el pedido debe volver al servidor');
assert.equal(out.axiosHitsOtherSession, 3, 'otra sesión nunca recibe la copia de la primera');
assert.equal(out.fontNoCorsFetch, 'bloqueado', 'el pedido sin destino de hoja de estilo también debe bloquearse');
assert.equal(out.fontLinkWithoutNetworkDomain, 'bloqueado');
assert.equal(out.sipClicks.hangup, 1, 'Ctrl+Enter debía llamar una vez a hangup() del softphone');
assert.equal(out.sipClicks.panel, 0, 'no debía abrir el panel del softphone');
assert.equal(out.sipToast, 'Llamada cortada');
const net = JSON.parse(out.netStatus ?? '{}');
assert.deepEqual([...(net.rulesets ?? [])].sort(), ['cache', 'fonts'], 'el fondo debe publicar las reglas activas');
assert.equal(net.dynamic, 3, 'el fondo debe publicar los sonidos bloqueados');
assert.equal(net.error, null);
assert.match(out.contentScriptAttrs, /data-gavriel-mute/, 'los content scripts no arrancaron');
console.log('OK: caché, bloqueo de sonidos y content scripts verificados');
process.exit(0);
