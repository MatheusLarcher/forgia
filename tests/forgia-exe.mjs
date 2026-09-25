// Ajudante dos testes no Forgia.exe gerado: abre o exe com um perfil TEMPORÁRIO
// (--user-data-dir em %TEMP%, nunca %APPDATA%\Forgia) e porta de depuração (CDP), lê o ponte.json
// desse perfil, fala com a ponte por HTTP e com o MCP pelo próprio exe (ELECTRON_RUN_AS_NODE=1).
// Encerra só os PIDs que abriu. Node >= 22 (fetch e WebSocket globais); nenhuma dependência.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Forgia').toLowerCase();

export function exePath() {
  const exe = process.env.FORGIA_EXE ? path.resolve(ROOT, process.env.FORGIA_EXE) : null;
  if (!exe || !fs.existsSync(exe)) return null;
  if (exe.toLowerCase().startsWith(INSTALLED)) throw new Error('recusado: não use o Forgia instalado nos testes');
  return exe;
}

export const scriptPath = (exe) => path.join(path.dirname(exe), 'resources', 'mcp', 'forgia-mcp.cjs');

export function tempProfile(prefix = 'forgia-fase-c-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('CDP: falha ao conectar'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (m.id !== undefined && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
      } else for (const h of this.handlers) h(m);
    };
    this.ws.onclose = () => {
      for (const [, p] of this.pending) p.reject(new Error('CDP fechado'));
      this.pending.clear();
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function fetchJson(url, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    if (Date.now() - t0 > timeout) throw new Error('sem resposta de ' + url);
    await wait(150);
  }
}

export class Forgia {
  static async open(exe, profile, { metrics = { width: 1400, height: 900, deviceScaleFactor: 1.5, mobile: false } } = {}) {
    const app = new Forgia();
    app.exe = exe;
    app.profile = profile;
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
    const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    const child = spawn(exe, args, { stdio: 'ignore' });
    app.pid = child.pid;
    app.exited = null;
    app.exitPromise = new Promise((r) => child.on('exit', (code) => r((app.exited = { code }))));
    let port = 0;
    const t0 = Date.now();
    while (!port) {
      if (app.exited) throw new Error('o exe fechou ao abrir');
      if (Date.now() - t0 > 30000) throw new Error('DevToolsActivePort não apareceu');
      try {
        port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10) || 0;
      } catch {}
      if (!port) await wait(100);
    }
    const ver = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    app.cdp = new Cdp(ver.webSocketDebuggerUrl);
    await app.cdp.connect();
    let target = null;
    for (let i = 0; i < 300 && !target; i++) {
      const { targetInfos } = await app.cdp.send('Target.getTargets');
      target = targetInfos.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (!target) await wait(100);
    }
    app.targetId = target.targetId;
    const { sessionId } = await app.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    app.session = sessionId;
    app.console = [];
    app.cdp.handlers.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) app.console.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (m.method === 'Runtime.exceptionThrown') app.console.push('exceção: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    });
    await app.send('Runtime.enable');
    await app.send('Page.enable');
    if (metrics) await app.send('Emulation.setDeviceMetricsOverride', metrics);
    await app.waitFor('!!(window.forgia && window.forgia.editor && window.forgia.ponte && window.forgia.ponte.info && window.forgia.ponte.info.porta)', 45000, 'Forgia e ponte prontos');
    app.bridge = await app.waitBridgeFile();
    return app;
  }

  async waitBridgeFile(previousToken = null, timeout = 20000) {
    const file = path.join(this.profile, 'ponte.json');
    const t0 = Date.now();
    for (;;) {
      try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (d.token && d.token !== previousToken) return d;
      } catch {}
      if (Date.now() - t0 > timeout) throw new Error('ponte.json não apareceu em ' + file);
      await wait(100);
    }
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.session);
  }

  async js(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  async waitFor(expression, timeout, label) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try {
        v = await this.js(expression);
      } catch {}
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error('tempo esgotado esperando: ' + label);
      await wait(100);
    }
  }

  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, modifiers: 0, ...extra });
  }

  async screenshot(file) {
    await this.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  // minimiza/restaura a janela deste processo (o CDP do Electron não tem Browser.setWindowBounds):
  // ShowWindow do Windows na janela principal do PID que este roteiro abriu
  windowState(state) {
    const cmd = { minimized: 6, normal: 9 }[state];
    const ps = `Add-Type -Name W -Namespace F -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'; $h = (Get-Process -Id ${this.pid}).MainWindowHandle; [void][F.W]::ShowWindow($h, ${cmd}); Start-Sleep -Milliseconds 300; [F.W]::IsIconic($h)`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    return /True/i.test(r.stdout || '');
  }

  async close() {
    if (this.exited) return;
    await this.cdp.send('Browser.close').catch(() => {});
    const r = await Promise.race([this.exitPromise, wait(15000).then(() => null)]);
    this.cdp.close();
    if (!r) spawnSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

// pedido HTTP cru à ponte (headers livres para os testes de segurança)
export function bridgeRequest(port, { token, cmd, args = {}, headers = {}, body } = {}) {
  const data = body !== undefined ? body : JSON.stringify({ cmd, args });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/comando', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(token ? { 'X-Forgia-Token': token } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

// cliente MCP mínimo: o próprio Forgia.exe como Node rodando o script empacotado
export class McpClient {
  constructor(exe, dataDir) {
    this.child = spawn(exe, [scriptPath(exe)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FORGIA_DADOS: dataDir }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.id = 0;
    this.pending = new Map();
    this.buf = '';
    this.raw = []; // tudo o que saiu no stdout, linha a linha (tem que ser só JSON-RPC)
    this.stderr = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (c) => {
      this.buf += c;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        this.raw.push(line);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          p(m);
        }
      }
    });
    this.child.stderr.on('data', (c) => (this.stderr += c));
  }
  request(method, params) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async call(name, args = {}) {
    const m = await this.request('tools/call', { name, arguments: args });
    return m.result;
  }
  close() {
    this.child.stdin.end();
    return new Promise((r) => this.child.on('exit', r));
  }
}

// texto da área de transferência do Windows (para guardar e devolver o do usuário nos testes)
export function readClipboardText() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [Text.Encoding]::UTF8; [System.Windows.Forms.Clipboard]::GetText()'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').replace(/\r?\n$/, '');
}
export function writeClipboardText(text) {
  if (!text) return;
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
}

// PNG: largura, altura (cabeçalho IHDR)
export function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), png: buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' };
}
