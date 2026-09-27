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
  // extraArgs: argumentos a mais (ex.: o caminho de um .forgia, como o duplo clique no arquivo)
  // env: variáveis a mais para o exe (ex.: FORGIA_AGENTCODE_PORTAS)
  static async open(exe, profile, { metrics = { width: 1400, height: 900, deviceScaleFactor: 1.5, mobile: false }, extraArgs = [], ready = null, env = null } = {}) {
    const app = new Forgia();
    app.exe = exe;
    app.profile = profile;
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
    const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', ...extraArgs];
    const child = spawn(exe, args, { stdio: 'ignore', ...(env ? { env: { ...process.env, ...env } } : {}) });
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
    // ready: expressão a esperar no lugar da ponte (ex.: a pergunta de recuperar na abertura, que
    // segura a ponte até o usuário responder)
    if (ready) {
      await app.waitFor(ready, 45000, ready);
      return app;
    }
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

  // Fecha como o usuário fecharia. Desde a Fase D, com alteração não salva o Forgia pergunta
  // "Salvar / Não salvar / Cancelar": aqui a resposta é "Não salvar" (escolha = 'nao'), que num
  // projeto sem arquivo mantém a cópia de segurança (ele volta ao abrir, como antes).
  async close({ escolha = 'nao' } = {}) {
    if (this.exited) return;
    this.cdp.send('Browser.close').catch(() => {});
    const t0 = Date.now();
    while (!this.exited && Date.now() - t0 < 15000) {
      try {
        await Promise.race([this.js(`(() => { const b = document.querySelector('.modal [data-escolha="${escolha}"]'); if (b) b.click(); return !!b; })()`), wait(1000)]);
      } catch {}
      await Promise.race([this.exitPromise, wait(200)]);
    }
    this.cdp.close();
    if (!this.exited) spawnSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { stdio: 'ignore' });
  }

  // encerra o processo à força (queda, "matar o processo no meio"): nada de pergunta nem de flush
  async kill() {
    spawnSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { stdio: 'ignore' });
    await Promise.race([this.exitPromise, wait(10000)]);
    this.cdp.close();
  }

  // pede para fechar a janela como o X da barra de título (WM_CLOSE na janela deste processo)
  windowClose() {
    const ps = `Add-Type -Name W -Namespace F -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'; $h = (Get-Process -Id ${this.pid}).MainWindowHandle; [F.W]::PostMessage($h, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero)`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    return /True/i.test(r.stdout || '');
  }
}

// Preenche o diálogo de arquivo do Windows (Salvar/Abrir do Electron) aberto pelo processo pid:
// acha a janela de diálogo (#32770) do processo pela UI Automation, põe o caminho no campo do nome
// (AutomationId 1001 no Salvar, 1148 no Abrir) e aciona o botão principal (AutomationId 1).
// Não depende de foco nem de teclado. Devolve true se achou e acionou.
export function fileDialog(pid, filePath, { timeout = 15000 } = {}) {
  const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$root = $A::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, ${pid})
$cls = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')
$deadline = (Get-Date).AddMilliseconds(${timeout})
$dlg = $null
# o diálogo é "dono" da janela do Forgia: aparece como descendente dela na árvore da UI Automation
while (-not $dlg -and (Get-Date) -lt $deadline) {
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    if ($w.Current.ClassName -eq '#32770') { $dlg = $w; break }
    $d = $w.FindFirst([System.Windows.Automation.TreeScope]::Children, $cls)
    if ($d) { $dlg = $d; break }
  }
  if (-not $dlg) { Start-Sleep -Milliseconds 200 }
}
if (-not $dlg) { 'sem-dialogo'; exit }
# campo do nome: Edit 1001 (Salvar) ou o Edit dentro do combo 1148 (Abrir); o texto entra por
# WM_SETTEXT e o botão principal (id 1) por BM_CLICK, direto nas janelas Win32 do diálogo
Add-Type -Name U -Namespace F -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, string l); [DllImport("user32.dll")] public static extern System.IntPtr PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'
$edit = $null
foreach ($e in $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Edit')))) {
  $id = $e.Current.AutomationId
  $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($e)
  if ($id -eq '1001' -or $id -eq '1148' -or ($parent -and $parent.Current.AutomationId -eq '1148')) { $edit = $e; break }
}
if (-not $edit) { 'sem-campo'; exit }
[void][F.U]::SendMessage([System.IntPtr]$edit.Current.NativeWindowHandle, 0x000C, [System.IntPtr]::Zero, ${lit(filePath)})
Start-Sleep -Milliseconds 150
$btn = $dlg.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, '1')), (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Button')))))
if (-not $btn) { 'sem-botao'; exit }
[void][F.U]::PostMessage([System.IntPtr]$btn.Current.NativeWindowHandle, 0x00F5, [System.IntPtr]::Zero, [System.IntPtr]::Zero)
'ok'`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: timeout + 15000 });
  return (r.stdout || '').trim() + (r.stderr ? ' ' + r.stderr.trim().slice(0, 300) : '');
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
