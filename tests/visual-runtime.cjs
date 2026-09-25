'use strict';
/*
 * Roteiro de validação visual da Fase A no Forgia.exe GERADO (o programa empacotado, não o Vite).
 * Abre o exe com um perfil TEMPORÁRIO (--user-data-dir em %TEMP%) e porta de depuração (CDP),
 * monta as cenas com eventos reais de mouse e teclado (Input.dispatch*) e salva as capturas em
 * docs/visual-evidence/<rótulo>/, com as verificações em docs/visual-evidence/<rótulo>/resultado.json.
 * Node puro (>= 22: fetch e WebSocket globais); nenhuma dependência.
 *
 * Uso:
 *   node tests/visual-runtime.cjs --exe=release\antes\win-unpacked\Forgia.exe --rotulo=antes
 *   node tests/visual-runtime.cjs --exe=release\antes\win-unpacked\Forgia.exe --rotulo=antes --abertura
 *   node tests/visual-runtime.cjs --exe=release\fase-a\win-unpacked\Forgia.exe --rotulo=depois
 *   node tests/visual-runtime.cjs --exe=release\fase-a\win-unpacked\Forgia.exe --rotulo=depois --abertura
 *   node tests/visual-runtime.cjs --comparacao
 *
 * Modos:
 *   antes   (--rotulo=antes)  as 4 cenas uma vez: vazia, forma-selecionada, grupo-com-furo,
 *                             dialogo-atalhos (+ reabrir o mesmo perfil mantém o projeto).
 *   depois  (--rotulo=depois) exige #btn-theme e data-tema; as 4 cenas nos DOIS temas (troca pelo
 *                             clique real em #btn-theme) e as verificações da Fase A: tema inicial
 *                             = Windows, tema segue o Windows ao vivo sem escolha salva, troca ao
 *                             vivo sem recriar geometria nem recarregar, cartão de dica, link do
 *                             crédito, reabrir mantém tema e projeto, bloco Sobre.
 *   --abertura  só a medição de abertura: prepara um perfil com forgia.tema = 'escuro', cobre a
 *               área de trabalho do monitor principal com uma CORTINA preta (janela do próprio
 *               roteiro, topmost), grava essa área (ffmpeg gdigrab, 30 fps pedidos) desde antes
 *               de abrir o exe e mede a luma da janela quadro a quadro, a partir do instante em
 *               que a janela fica visível (vigia Win32, que a põe acima da cortina). A cortina
 *               dá um fundo conhecido e impede que a tela do usuário entre na gravação. Guarda 3
 *               quadros recortados na janela (abertura-primeiro/meio/final.png) e APAGA o vídeo.
 *               Junta o resultado em resultado.json (chave "abertura", verificação sem_clarao).
 *   --comparacao  só monta docs/visual-evidence/comparacao/<cena>.png (antes | claro | escuro).
 *               Também é montada ao fim de qualquer execução, se antes/ e depois/ existirem.
 *
 * Outras opções: --porta=N (padrão: porta livre, lida de <perfil>/DevToolsActivePort);
 *   --modo=antes|depois (padrão: pelo rótulo); --pasta=<dir> (raiz das evidências; padrão
 *   docs/visual-evidence);
 *   --tamanho=LxA  vista fixa em CSS px nas cenas (padrão 1400x900), por CDP
 *                  Emulation.setDeviceMetricsOverride com deviceScaleFactor 1.5 e mobile false:
 *                  as capturas saem em (L*1.5)x(A*1.5) px (2100x1350 no padrão), qualquer que seja
 *                  o monitor. Não se aplica a --abertura, que mede a janela real sem emulação.
 * Teste do próprio roteiro (no exe antigo; NÃO é evidência da Fase A):
 *   --simular-depois    injeta tests/visual-runtime-simulacao.js (imitação grosseira dos ganchos
 *                       da seção 11) e roda o modo depois inteiro; saída em <pasta>/_simulacao-depois.
 *   --simular-defeitos  a imitação erra de propósito (recria geometria, cartão imediato, title,
 *                       não salva, não segue o Windows, abre com botão apertado, não fecha, link
 *                       que navega); passa só se CADA verificação correspondente reprovar.
 *
 * Limitações: a vista fixa (--tamanho) é emulada dentro da janela maximizada; o tamanho real da
 * janela e o da captura vão em resultado.json → ambiente. O gdigrab na área inteira de um monitor
 * grande não chega a 30 fps (o fps efetivo vai em abertura.fpsEfetivo), então um clarão de
 * 1 quadro de tela pode escapar.
 *
 * Segurança (obrigatório): nunca usa o perfil do usuário (%APPDATA%\Forgia), recusa o Forgia
 * instalado (%LOCALAPPDATA%\Programs\Forgia), encerra só os PIDs que abriu (taskkill /T no PID)
 * e registra o LastWriteTime de "%APPDATA%\Forgia\Local Storage" antes e depois.
 * Durante a execução não mexa o mouse sobre a janela do Forgia: o Windows também entrega o mouse
 * físico à página e isso atrapalha as medições de hover.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[visual]', ...a);
const SCENES = ['vazia', 'forma-selecionada', 'grupo-com-furo', 'dialogo-atalhos'];
const THEMES = ['claro', 'escuro'];
// Só afetam o agendamento (janela coberta continua desenhando); não mudam nada visual.
// Não são usadas na medição de abertura, que abre o exe só com perfil e porta.
const SCENE_FLAGS = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];
// Enquadramento da forma: "Ajustar à tela" e N cliques em "Afastar" (botões reais da coluna de
// vista), para a Caixa de 20 mm, as alças e as cotas ficarem legíveis com a mesa em volta
const ZOOM_OUT_CLICKS = 2;
const SPEC_PLATE = { claro: '#d8e2ec', escuro: '#262c33' }; // cor da mesa (spec, seção 3)
// Vista fixa das cenas (--tamanho): CSS px; o fator 1.5 é o DPI do monitor de referência (150%)
const DEFAULT_SIZE = '1400x900';
const SCENE_DSF = 1.5;

// ---------------- argumentos ----------------
const KNOWN = ['exe', 'rotulo', 'porta', 'abertura', 'modo', 'pasta', 'tamanho', 'simular-depois', 'simular-defeitos', 'comparacao', 'ajuda'];
// --simular-defeitos: a imitação erra de propósito; cada verificação abaixo tem que REPROVAR
const PLANTED_DEFECTS = {
  geometria: 'troca_de_tema_sem_recriar_geometria',
  naoSegueWindows: 'tema_segue_windows_ao_vivo',
  dicaImediata: 'cartao_de_dica_escuro',
  title: 'data_dica_sem_title',
  naoFecha: 'cartao_fecha_ao_sair',
  abreComBotao: 'cartao_nao_abre_com_botao_apertado',
  linkNavega: 'link_do_credito',
  naoSalva: 'reabrir_mantem_tema_e_projeto',
};
function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m || !KNOWN.includes(m[1])) throw new Error(`argumento não reconhecido: ${a} (válidos: ${KNOWN.map((k) => '--' + k).join(' ')})`);
    o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}

function parseSize(v) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(v);
  if (!m) throw new Error(`--tamanho deve ser LxA em CSS px (ex.: ${DEFAULT_SIZE}), recebido: ${v}`);
  return { width: +m[1], height: +m[2], deviceScaleFactor: SCENE_DSF, mobile: false };
}

// ---------------- processos e limpeza ----------------
const spawned = new Set(); // PIDs abertos por este roteiro (e só eles são encerrados)
const tempDirs = new Set();
function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  spawned.delete(pid);
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function removeDirSync(dir) {
  for (let i = 0; i < 12; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    if (!fs.existsSync(dir)) {
      tempDirs.delete(dir);
      return true;
    }
    sleepSync(400);
  }
  return false;
}
function makeTempDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(d);
  return d;
}
function cleanupAll() {
  for (const pid of [...spawned]) killTree(pid);
  for (const d of [...tempDirs]) removeDirSync(d);
}
process.on('SIGINT', () => {
  console.error('[visual] interrompido: encerrando os processos abertos e apagando perfis temporários');
  cleanupAll();
  process.exit(130);
});

// ---------------- perfil do usuário (só leitura de datas) ----------------
const USER_LS = path.join(process.env.APPDATA || '', 'Forgia', 'Local Storage');
function userProfileStamp() {
  const out = { caminho: USER_LS };
  try {
    out.pasta = fs.statSync(USER_LS).mtime.toISOString();
    const ldb = path.join(USER_LS, 'leveldb');
    out.leveldb = fs.statSync(ldb).mtime.toISOString();
    let max = 0;
    let name = null;
    for (const f of fs.readdirSync(ldb)) {
      const s = fs.statSync(path.join(ldb, f));
      if (s.mtimeMs > max) [max, name] = [s.mtimeMs, f];
    }
    out.arquivoMaisRecente = name ? `${name} ${new Date(max).toISOString()}` : null;
  } catch (e) {
    out.erro = e.message;
  }
  return out;
}

function windowsPrefersDark() {
  const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { encoding: 'utf8', windowsHide: true });
  const m = /AppsUseLightTheme\s+REG_DWORD\s+0x(\d+)/i.exec(r.stdout || '');
  return m ? m[1] === '0' : null;
}

// ---------------- CDP ----------------
class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.closed = false;
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('falha ao conectar no CDP: ' + this.url));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
      } else for (const h of this.handlers) h(m);
    };
    this.ws.onclose = () => {
      this.closed = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(Object.assign(new Error(`${p.method}: conexão CDP fechada`), { closed: true }));
      }
      this.pending.clear();
    };
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    if (this.closed) return Promise.reject(Object.assign(new Error(`${method}: conexão CDP fechada`), { closed: true }));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: sem resposta em ${timeout} ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) {
    this.handlers.push(fn);
    return () => (this.handlers = this.handlers.filter((h) => h !== fn));
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

// Uma execução do Forgia.exe: processo + sessão CDP na página principal
class App {
  static spawn({ exe, profile, port = 0, extraArgs = [] }) {
    const app = new App();
    Object.assign(app, { exe, profile, fixedPort: port || 0, exited: null, pointer: null, events: { navegacoes: 0 }, pageConsole: [] });
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true }); // senão lê a porta da execução anterior
    const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port || 0}`, ...extraArgs];
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false });
    app.pid = child.pid;
    spawned.add(child.pid);
    app.exitPromise = new Promise((resolve) => {
      child.on('exit', (code, signal) => {
        app.exited = { code, signal };
        spawned.delete(child.pid);
        resolve(app.exited);
      });
      child.on('error', (err) => {
        app.exited = { code: null, error: err.message };
        resolve(app.exited);
      });
    });
    return app;
  }

  static async open(opts) {
    const app = App.spawn(opts);
    await app.connect(opts);
    return app;
  }

  async connect({ simulate = null, metrics = null } = {}) {
    let port = this.fixedPort;
    const t0 = Date.now();
    while (!port) {
      if (this.exited) throw new Error(`o exe fechou logo ao abrir (código ${this.exited.code}); instância única com o mesmo perfil?`);
      if (Date.now() - t0 > 30000) throw new Error('DevToolsActivePort não apareceu em 30 s');
      try {
        port = parseInt(fs.readFileSync(path.join(this.profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10) || 0;
      } catch {}
      if (!port) await wait(100);
    }
    this.port = port;
    this.version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    this.cdp = new Cdp(this.version.webSocketDebuggerUrl);
    await this.cdp.connect();
    let target = null;
    for (let i = 0; i < 300 && !target; i++) {
      const { targetInfos } = await this.cdp.send('Target.getTargets');
      target = targetInfos.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (!target) await wait(100);
    }
    if (!target) throw new Error('alvo "page" do index.html não apareceu no CDP');
    this.targetId = target.targetId;
    this.pageUrl = target.url;
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    this.session = sessionId;
    this.cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) this.events.navegacoes++;
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
        this.pageConsole.push({ tipo: m.params.type, texto: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) });
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.pageConsole.push({ tipo: 'exceção', texto: (d.exception?.description || d.text || '').slice(0, 400) });
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    if (metrics) {
      // vista fixa (--tamanho): antes das cenas; a página redimensiona pelo ResizeObserver da vista
      this.realWindow = await this.js('({ vistaCss: innerWidth + "x" + innerHeight, janelaCss: outerWidth + "x" + outerHeight, dpr: devicePixelRatio })').catch((e) => ({ erro: e.message }));
      await this.send('Emulation.setDeviceMetricsOverride', metrics);
      this.metrics = metrics;
    }
    if (simulate) {
      // imitação dos ganchos da seção 11 (só para testar o roteiro): entra antes dos scripts da página
      await this.send('Page.addScriptToEvaluateOnNewDocument', { source: simulate });
      await this.send('Page.reload', { ignoreCache: false });
      await wait(300);
    }
    await this.waitReady();
    return this;
  }

  send(method, params = {}, timeout) {
    return this.cdp.send(method, params, this.session, timeout);
  }

  async js(expression, timeout = 30000) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (r.exceptionDetails) throw new Error('erro no JS da página: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  async waitFor(expression, timeout, label) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try {
        v = await this.js(expression);
      } catch (e) {
        if (Date.now() - t0 > timeout) throw e;
      }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`tempo esgotado (${timeout} ms) esperando: ${label}`);
      await wait(80);
    }
  }

  async waitReady() {
    await this.waitFor('!!(window.forgia && (window.forgia.editor || window.forgia.gpu))', 45000, 'window.forgia');
    if (!(await this.js('!!window.forgia.editor'))) {
      const msg = await this.js('document.querySelector(".gpu-fail")?.innerText || ""');
      throw new Error('o 3D não iniciou (window.forgia.editor ausente): ' + msg);
    }
    await this.waitFor(
      `document.readyState === 'complete' && document.querySelectorAll('.tile img').length > 0 && [...document.querySelectorAll('.tile img')].every((i) => i.complete && i.naturalWidth > 0)`,
      30000,
      'miniaturas da biblioteca',
    );
    await this.js('document.fonts.ready.then(() => true)');
    await this.frames();
    await wait(800);
  }

  // dois quadros de animação: garante que o que foi mudado já foi desenhado
  frames() {
    return this.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', 15000);
  }

  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, modifiers: 0, ...extra });
  }

  // move o ponteiro em passos (como uma mão), com ou sem o botão esquerdo apertado
  async move(x, y, { steps = 8, pressed = false, delay = 12 } = {}) {
    const from = this.pointer || { x, y };
    for (let i = 1; i <= steps; i++) {
      const px = from.x + ((x - from.x) * i) / steps;
      const py = from.y + ((y - from.y) * i) / steps;
      await this.mouse('mouseMoved', px, py, pressed ? { button: 'left', buttons: 1 } : { button: 'none', buttons: 0 });
      if (delay) await wait(delay);
    }
    this.pointer = { x, y };
  }

  async center(sel) {
    return this.js(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      const top = document.elementFromPoint(x, y);
      const onTop = !!top && (top === e || e.contains(top));
      return { x, y, w: b.width, h: b.height, visivel: b.width > 0 && b.height > 0, noTopo: onTop,
        cobertoPor: onTop || !top ? null : (top.id ? '#' + top.id : '.' + String(top.className || top.tagName)),
        desabilitado: !!e.disabled || e.getAttribute('aria-disabled') === 'true' };
    })()`);
  }

  async click(sel) {
    let c = await this.center(sel);
    if (c && !c.noTopo && /dica/.test(c.cobertoPor || '')) {
      // um cartão de dica aberto cobre o alvo: tira o mouse (o cartão fecha) e confere de novo
      await parkMouse(this);
      await wait(300);
      c = await this.center(sel);
    }
    if (!c) throw new Error(`elemento não existe: ${sel}`);
    if (!c.visivel) throw new Error(`elemento sem tamanho (oculto): ${sel}`);
    if (!c.noTopo) throw new Error(`elemento coberto por ${c.cobertoPor}: ${sel}`);
    await this.move(c.x, c.y, { steps: 6 });
    await wait(60);
    await this.mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 });
    await wait(40);
    await this.mouse('mouseReleased', c.x, c.y, { button: 'left', buttons: 0, clickCount: 1 });
    await wait(150);
    return c;
  }

  async drag(from, to, steps = 14) {
    await this.move(from.x, from.y, { steps: 5 });
    await wait(60);
    await this.mouse('mousePressed', from.x, from.y, { button: 'left', buttons: 1, clickCount: 1 });
    await this.move(to.x, to.y, { steps, pressed: true });
    await wait(80);
    await this.mouse('mouseReleased', to.x, to.y, { button: 'left', buttons: 0, clickCount: 1 });
    await wait(200);
  }

  async key(name) {
    const K = {
      h: { key: 'h', code: 'KeyH', vk: 72, text: 'h' },
      Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    }[name];
    const base = { key: K.key, code: K.code, windowsVirtualKeyCode: K.vk, nativeVirtualKeyCode: K.vk };
    await this.send('Input.dispatchKeyEvent', { type: K.text ? 'keyDown' : 'rawKeyDown', ...base, ...(K.text ? { text: K.text, unmodifiedText: K.text } : {}) });
    await wait(30);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await wait(150);
  }

  async screenshot(file) {
    await this.frames();
    await wait(250);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 60000);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return path.basename(file);
  }

  async pageTargets() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url }));
  }

  // Fecha pelo CDP (Browser.close: sai limpo e grava o localStorage); se não sair, encerra o PID
  async close() {
    if (this.exited) return { gracioso: true, jaFechado: true };
    if (this.cdp && !this.cdp.closed) await this.cdp.send('Browser.close', {}, undefined, 5000).catch(() => {}); // a conexão cai ao fechar
    const r = await Promise.race([this.exitPromise, wait(15000).then(() => null)]);
    if (this.cdp) this.cdp.close();
    if (r) return { gracioso: true, codigo: r.code };
    killTree(this.pid);
    await Promise.race([this.exitPromise, wait(5000)]);
    return { gracioso: false, motivo: 'Browser.close não encerrou em 15 s; processo encerrado pelo PID (taskkill /T /F)' };
  }

  kill() {
    if (!this.exited) killTree(this.pid);
  }
}

// ---------------- trechos executados na página ----------------
const JS = {
  theme: `(document.documentElement.dataset.tema || null)`, // entre parênteses: é usado dentro de expressões
  meshes: `(() => [...forgia.editor.meshes.entries()].map(([id, m]) => ({ id, geometria: m.geometry.uuid, contorno: m.userData.outline ? m.userData.outline.geometry.uuid : null })))()`,
  // cor da mesa: o que o código novo expuser (wpMats), senão o 1º MeshBasicMaterial do plano (editor.wp)
  plate: `(() => {
    const ed = forgia.editor;
    let mat = null, fonte = null;
    if (ed.wpMats && ed.wpMats.plate && ed.wpMats.plate.color) { mat = ed.wpMats.plate; fonte = 'editor.wpMats.plate'; }
    else if (ed.wp) ed.wp.traverse((o) => { if (!mat && o.isMesh && o.material && o.material.type === 'MeshBasicMaterial') { mat = o.material; fonte = 'editor.wp (1º MeshBasicMaterial)'; } });
    return mat ? { fonte, cor: '#' + mat.color.getHexString(), opacidade: mat.opacity, uuid: mat.uuid } : null;
  })()`,
  // média RGBA do canvas principal (preserveDrawingBuffer: true)
  canvasMean: `(() => {
    const c = document.querySelector('.main-canvas');
    const t = document.createElement('canvas'); t.width = 320; t.height = Math.max(1, Math.round(320 * c.height / c.width));
    const g = t.getContext('2d'); g.drawImage(c, 0, 0, t.width, t.height);
    const d = g.getImageData(0, 0, t.width, t.height).data; const s = [0, 0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 4; k++) s[k] += d[i + k];
    const n = d.length / 4; return s.map((v) => Math.round((v / n) * 10) / 10);
  })()`,
  // ponto da vista sem objeto nem painel por cima (para soltar forma ou começar arraste no vazio)
  emptySpot: `(() => {
    const ed = forgia.editor, c = ed.renderer.domElement, r = c.getBoundingClientRect();
    const cands = [[0.40, 0.62], [0.60, 0.62], [0.42, 0.45], [0.58, 0.45], [0.33, 0.72], [0.67, 0.72], [0.25, 0.55]];
    for (const [fx, fy] of cands) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (document.elementFromPoint(x, y) !== c) continue;
      if (ed.pickObject({ clientX: x, clientY: y })) continue;
      return { x, y };
    }
    return null;
  })()`,
  dimsVisible: `[...document.querySelectorAll('.dim-label')].filter((e) => e.style.display === 'block').length`,
  cardOpen: `!!document.querySelector('.dica.aberta')`,
};

// ---------------- cenas ----------------
async function parkMouse(app) {
  // repouso sobre o título da biblioteca: sem cartão de dica, sem hover no 3D
  const c = (await app.center('.lib-title')) || (await app.center('#library'));
  await app.move(c.x, c.y, { steps: 6 });
  await app.waitFor(`!(${JS.cardOpen})`, 2000, 'cartão de dica fechado').catch(() => {});
}

async function showDims(app) {
  await app.js('(forgia.editor.dimsVisibleUntil = performance.now() + 120000), true');
  return app.waitFor(`${JS.dimsVisible} >= 3 && ${JS.dimsVisible}`, 3000, 'cotas visíveis');
}

// Clique real; se o botão não existir no build, faz o mesmo pela API e registra em observações
async function clickOr(app, sel, fallbackJs, notes) {
  if (await app.js(`!!document.querySelector(${JSON.stringify(sel)})`)) return app.click(sel);
  notes.push(`${sel} não existe neste build: usado ${fallbackJs} pela API`);
  await app.js(`(${fallbackJs}), true`);
}

async function buildSelected(app, notes) {
  const p = await app.js(`(() => {
    const a = document.querySelector('.tile[data-label="Caixa"]'), c = document.querySelector('.main-canvas');
    if (!a || !c) return null;
    a.scrollIntoView({ block: 'nearest' });
    const b = a.getBoundingClientRect(), v = c.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, tx: v.x + v.width * 0.5, ty: v.y + v.height * 0.55 };
  })()`);
  if (!p) throw new Error('.tile[data-label="Caixa"] ou .main-canvas não encontrados');
  // arrastar a Caixa da biblioteca para a mesa (eventos reais de mouse)
  await app.drag({ x: p.x, y: p.y }, { x: p.tx, y: p.ty });
  const box = await app.waitFor(
    `(() => { const ed = forgia.editor; const o = ed.objects[0]; return ed.objects.length === 1 && ed.selection.length === 1 && !ed.placing ? { id: o.id, tipo: o.type, tamanho: o.size, pos: o.pos } : null; })()`,
    5000,
    'Caixa criada e selecionada depois de arrastar da biblioteca',
  );
  await clickOr(app, '[data-view="fit"]', 'forgia.editor.fitView()', notes); // botão real "Ajustar à tela" (enquadra a seleção)
  await wait(650);
  for (let i = 0; i < ZOOM_OUT_CLICKS; i++) {
    await clickOr(app, '[data-view="out"]', 'forgia.editor.zoomBy(1 / 1.3)', notes); // botão real "Afastar"
    await wait(550);
  }
  await parkMouse(app);
  const dims = await showDims(app);
  return { caixa: box, cotasVisiveis: dims, enquadramento: `Ajustar à tela + ${ZOOM_OUT_CLICKS}x Afastar` };
}

async function buildGroup(app, boxId, notes) {
  const spot = await app.js(JS.emptySpot);
  if (!spot) throw new Error('não achei ponto vazio na vista para soltar o Cilindro');
  const tile = await app.js(`(() => { const a = document.querySelector('.tile[data-label="Cilindro"]'); if (!a) return null; a.scrollIntoView({ block: 'nearest' }); const b = a.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  let cylId;
  if (tile) {
    await app.drag(tile, spot);
    cylId = await app.waitFor(
      `(() => { const ed = forgia.editor; return ed.objects.length === 2 && ed.selection.length === 1 && !ed.placing && ed.obj(ed.selection[0]).type === 'cylinder' ? ed.selection[0] : null; })()`,
      5000,
      'Cilindro criado e selecionado depois de arrastar da biblioteca',
    );
  } else {
    notes.push('.tile[data-label="Cilindro"] não existe: Cilindro criado pela API');
    cylId = await app.js(`(() => { const ed = forgia.editor; const c = ed.createObject('cylinder'); ed.change(() => ed.objects.push(c)); ed.select([c.id]); return c.id; })()`);
  }
  // vira furo pelo atalho real H
  await app.key('h');
  const hole = await app.waitFor(`forgia.editor.obj(${JSON.stringify(cylId)}).hole === true`, 2000, 'tecla H virar furo').catch(() => false);
  if (!hole) {
    notes.push('a tecla H não virou furo: furo aplicado pela API (setHole)');
    await app.js('forgia.editor.setHole(true), true');
  }
  // atravessa a Caixa pelo centro (posicionar ao mm pelo mouse seria frágil) e seleciona os dois
  await app.js(`(() => {
    const ed = forgia.editor, b = ed.obj(${JSON.stringify(boxId)}), c = ed.obj(${JSON.stringify(cylId)});
    ed.change(() => { c.size = [10, 28, 10]; c.pos = [b.pos[0], 12, b.pos[2]]; });
    ed.select([b.id, c.id]);
    return true;
  })()`);
  await app.waitFor(`(() => { const e = document.querySelector('[data-cmd="group"]'); return !e || (!e.disabled && e.getAttribute('aria-disabled') !== 'true'); })()`, 3000, 'botão Agrupar habilitado');
  await clickOr(app, '[data-cmd="group"]', 'forgia.editor.group()', notes); // botão real "Agrupar"
  const g = await app.waitFor(
    `(() => { const ed = forgia.editor, o = ed.objects; return o.length === 1 && o[0].type === 'group' && ed.selection.length === 1 && ed.selection[0] === o[0].id ? { id: o[0].id, filhos: o[0].children.length, furos: o[0].children.filter((c) => c.hole).length } : null; })()`,
    8000,
    'grupo criado pelo botão Agrupar e selecionado',
  );
  await parkMouse(app);
  return g;
}

async function openHelp(app) {
  await app.click('#btn-help'); // botão real "Atalhos"
  await app.waitFor(`!!document.querySelector('.modal-back .modal .modal-body')`, 3000, 'diálogo Atalhos aberto');
  const body = await app.center('.modal .modal-body');
  await app.move(body.x, body.y, { steps: 6 });
  await app.mouse('mouseWheel', body.x, body.y, { deltaX: 0, deltaY: 5000 }); // roda do mouse até o fim
  await wait(800);
  const s = await app.js(`(() => { const b = document.querySelector('.modal .modal-body'); return { topo: b.scrollTop, max: b.scrollHeight - b.clientHeight }; })()`);
  let rolagem = s.max <= 0 ? 'sem rolagem (cabe inteiro)' : 'roda do mouse';
  if (s.max > 0 && s.topo < s.max - 2) {
    await app.js(`(() => { const b = document.querySelector('.modal .modal-body'); b.scrollTop = b.scrollHeight; return true; })()`);
    rolagem = `scrollTop pela página (a roda parou em ${s.topo} de ${s.max})`;
  }
  const sobre = await app.js(`(() => {
    const s = document.querySelector('.modal .sobre'); if (!s) return null;
    const b = document.querySelector('.modal .modal-body').getBoundingClientRect(), r = s.getBoundingClientRect();
    return { visivel: r.height > 0 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, link: !!s.querySelector('a[href="https://larchertech.com/"]'), texto: s.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) };
  })()`);
  const gpuLine = await app.js(`document.querySelector('.modal .gpu-line')?.textContent || null`);
  return { rolagem, sobre, linhaDaPlaca: gpuLine };
}

async function closeModal(app) {
  await app.key('Escape');
  await app.waitFor(`!document.querySelector('.modal-back')`, 3000, 'diálogo fechado com Esc');
}

// ---------------- tema (modo depois) ----------------
async function toggleTheme(app) {
  const before = await app.js(JS.theme);
  await app.click('#btn-theme'); // botão real sol/lua
  const after = await app.waitFor(`(() => { const t = ${JS.theme}; return t && t !== ${JSON.stringify(before)} ? t : null; })()`, 3000, 'data-tema mudar depois do clique em #btn-theme');
  await parkMouse(app);
  await app.frames();
  await wait(300);
  return after;
}

async function ensureTheme(app, name) {
  if ((await app.js(JS.theme)) !== name) await toggleTheme(app);
}

const check = (ok, detalhe, motivo) => ({ resultado: ok ? 'PASS' : 'FAIL', ...(motivo && !ok ? { motivo } : {}), detalhe });

async function checkInitialTheme(app) {
  const s = await app.js(`({ tema: ${JS.theme}, windowsEscuro: matchMedia('(prefers-color-scheme: dark)').matches, salvo: localStorage.getItem('forgia.tema'), temaNoForgia: window.forgia.theme ? window.forgia.theme.name : null })`);
  const expected = s.windowsEscuro ? 'escuro' : 'claro';
  s.esperado = expected;
  s.registroWindowsEscuro = windowsPrefersDark();
  return check(s.tema === expected && s.salvo === null, s, `perfil novo abriu em '${s.tema}', o Windows pede '${expected}' (salvo=${s.salvo})`);
}

async function checkLiveOsTheme(app) {
  // sem escolha salva, o tema acompanha o Windows ao vivo (Emulation.setEmulatedMedia)
  await app.js('(window.__semRecarga = true), true');
  const osDark = await app.js(`matchMedia('(prefers-color-scheme: dark)').matches`);
  const [otherMedia, otherTheme] = osDark ? ['light', 'claro'] : ['dark', 'escuro'];
  const [backMedia, backTheme] = osDark ? ['dark', 'escuro'] : ['light', 'claro'];
  const d = { windowsEscuro: osDark };
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: otherMedia }] });
  d.foiPara = await app.waitFor(`${JS.theme} === ${JSON.stringify(otherTheme)} && ${JS.theme}`, 2500, `data-tema virar '${otherTheme}'`).catch(() => app.js(JS.theme));
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: backMedia }] });
  d.voltouPara = await app.waitFor(`${JS.theme} === ${JSON.stringify(backTheme)} && ${JS.theme}`, 2500, `data-tema voltar a '${backTheme}'`).catch(() => app.js(JS.theme));
  await app.send('Emulation.setEmulatedMedia', { features: [] });
  d.salvoDepois = await app.js(`localStorage.getItem('forgia.tema')`);
  d.semRecarga = await app.js('window.__semRecarga === true');
  const ok = d.foiPara === otherTheme && d.voltouPara === backTheme && d.salvoDepois === null && d.semRecarga;
  return check(ok, d, `esperado '${otherTheme}' e de volta '${backTheme}', sem gravar forgia.tema e sem recarregar`);
}

async function snapshotForThemeSwitch(app) {
  return app.js(`({ tema: ${JS.theme}, malhas: ${JS.meshes}, mesa: ${JS.plate}, canvas: ${JS.canvasMean}, semRecarga: window.__semRecarga === true, url: location.href, grade: (() => { const m = forgia.editor.wpMats; return m ? Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.color).map(([k, v]) => [k, '#' + v.color.getHexString()])) : null; })() })`);
}

function compareThemeSwitch(a, b, navBefore, navAfter) {
  const geoA = JSON.stringify(a.malhas);
  const geoB = JSON.stringify(b.malhas);
  const d = {
    temaAntes: a.tema,
    temaDepois: b.tema,
    malhas: a.malhas.length,
    geometriasIguais: geoA === geoB,
    mesaAntes: a.mesa,
    mesaDepois: b.mesa,
    corDaMesaMudou: a.mesa && b.mesa ? a.mesa.cor !== b.mesa.cor : null,
    canvasAntes: a.canvas,
    canvasDepois: b.canvas,
    canvasMudou: a.canvas.some((v, i) => Math.abs(v - b.canvas[i]) > 2),
    gradeAntes: a.grade,
    gradeDepois: b.grade,
    semRecarga: b.semRecarga && a.url === b.url && navAfter === navBefore,
    navegacoesDaPagina: navAfter - navBefore,
    // só informativo (a cor exata é critério da tarefa do tema, não deste roteiro)
    mesaConfereComASpec: Object.fromEntries([a, b].filter((s) => s.mesa && SPEC_PLATE[s.tema]).map((s) => [s.tema, `${s.mesa.cor} (spec ${SPEC_PLATE[s.tema]})${s.mesa.cor === SPEC_PLATE[s.tema] ? ' ok' : ' DIFERENTE'}`])),
  };
  if (!d.geometriasIguais) Object.assign(d, { geometriasAntes: a.malhas, geometriasDepois: b.malhas });
  const colorChanged = d.corDaMesaMudou === null ? d.canvasMudou : d.corDaMesaMudou;
  const ok = a.tema !== b.tema && d.geometriasIguais && colorChanged && d.semRecarga;
  return check(ok, d, 'a troca deve mudar data-tema e a cor da mesa, manter os uuid das geometrias e não recarregar');
}

async function checkCard(app, theme, outDir, full) {
  const target = await app.center('[data-cmd="copy"]');
  if (!target) return { cartao: check(false, null, '[data-cmd="copy"] não existe') };
  const out = {};
  await parkMouse(app);
  await wait(500);
  await app.move(target.x, target.y, { steps: 6 });
  const t0 = Date.now();
  await wait(Math.max(0, t0 + 200 - Date.now()));
  const at200 = await app.js(JS.cardOpen);
  const t200 = Date.now() - t0;
  await wait(Math.max(0, t0 + 700 - Date.now()));
  const at700 = await app.js(`(() => {
    const d = document.querySelector('.dica.aberta'); if (!d) return null;
    const btn = document.querySelector('[data-cmd="copy"]');
    return { titulo: d.querySelector('.dica-titulo')?.textContent.trim() || null,
      teclas: [...d.querySelectorAll('.dica-atalho kbd')].map((k) => k.textContent.trim()),
      texto: d.querySelector('.dica-texto')?.textContent.trim() || null, role: d.getAttribute('role'),
      describedby: btn.getAttribute('aria-describedby'), id: d.id || null, botaoDesabilitado: !!btn.disabled || btn.getAttribute('aria-disabled') === 'true' };
  })()`);
  const t700 = Date.now() - t0;
  const shot = await app.screenshot(path.join(outDir, `dica-${theme}.png`));
  const opened = !!at700 && at700.titulo === 'Copiar' && at700.teclas.join('+') === 'Ctrl+C';
  out.cartao = check(!at200 && opened, { aos200ms: { aberto: at200, medidoEm: t200 }, aos700ms: { cartao: at700, medidoEm: t700 }, captura: shot }, 'esperado: fechado em ~200 ms; aberto em ~700 ms com "Copiar" e teclas Ctrl + C');
  if (!full) return out;

  const titled = await app.js(`(() => { const all = [...document.querySelectorAll('[data-dica]')]; return { total: all.length, comTitle: all.filter((e) => e.hasAttribute('title')).map((e) => e.outerHTML.slice(0, 140)) }; })()`);
  out.semTitle = check(titled.total > 0 && titled.comTitle.length === 0, titled, 'nenhum [data-dica] pode ter title (e tem que existir algum)');

  // tirar o mouse fecha em < 500 ms
  const neutral = (await app.center('.lib-title')) || (await app.center('#library'));
  const tLeave = Date.now();
  await app.move(neutral.x, neutral.y, { steps: 3, delay: 0 });
  let closedIn = null;
  while (Date.now() - tLeave < 1500) {
    if (!(await app.js(JS.cardOpen))) {
      closedIn = Date.now() - tLeave;
      break;
    }
    await wait(20);
  }
  out.fechaAoSair = check(closedIn !== null && closedIn < 500, { fechouEmMs: closedIn }, 'tirar o mouse deve fechar em menos de 500 ms');

  // com o botão esquerdo apertado, arrastando da vista até o botão, o cartão não abre
  await wait(400);
  const spot = await app.js(JS.emptySpot);
  const objsBefore = await app.js('JSON.stringify(forgia.editor.objects.map((o) => o.pos))');
  await app.move(spot.x, spot.y, { steps: 6 });
  await app.mouse('mousePressed', spot.x, spot.y, { button: 'left', buttons: 1, clickCount: 1 });
  await app.move(target.x, target.y, { steps: 12, pressed: true });
  await wait(900);
  const openedPressed = await app.js(JS.cardOpen);
  await app.mouse('mouseReleased', target.x, target.y, { button: 'left', buttons: 0, clickCount: 1 });
  await parkMouse(app);
  const moved = (await app.js('JSON.stringify(forgia.editor.objects.map((o) => o.pos))')) !== objsBefore;
  out.naoAbreArrastando = check(!openedPressed, { abriuComBotaoApertado: openedPressed, arrasteMoveuObjeto: moved }, 'com o botão apertado o cartão não pode abrir');

  // botão desabilitado também mostra o cartão (sem seleção, Copiar fica desabilitado)
  await app.key('Escape');
  await wait(300);
  const dis = await app.center('[data-cmd="copy"]');
  await app.move(dis.x, dis.y, { steps: 6 });
  await wait(800);
  const disCard = await app.js(`(() => { const d = document.querySelector('.dica.aberta'); return d ? d.querySelector('.dica-titulo')?.textContent.trim() : null; })()`);
  out.botaoDesabilitado = check(dis.desabilitado && disCard === 'Copiar', { desabilitado: dis.desabilitado, tituloDoCartao: disCard }, 'o cartão deve abrir também no botão desabilitado');
  await parkMouse(app);
  return out;
}

async function checkCreditLink(app) {
  // desde a Fase D o crédito fica na ponta direita da barra de status (#statusbar a.credit)
  const CREDITO = '#statusbar a.credit';
  const link = await app.js(`(() => { const a = document.querySelector('${CREDITO}'); return a ? { href: a.href, target: a.target, rel: a.rel, texto: a.textContent.trim() } : null; })()`);
  if (!link) return check(false, null, `${CREDITO} não existe`);
  await app.js('(window.__semRecarga = true), true');
  const before = await app.pageTargets();
  const created = [];
  await app.cdp.send('Target.setDiscoverTargets', { discover: true });
  const off = app.cdp.on((m) => {
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page' && !before.some((t) => t.id === m.params.targetInfo.targetId)) created.push(m.params.targetInfo.url);
  });
  const url0 = await app.js('location.href');
  const nav0 = app.events.navegacoes;
  await app.click(CREDITO); // clique real
  await wait(1500);
  off();
  await app.cdp.send('Target.setDiscoverTargets', { discover: false }).catch(() => {});
  const after = await app.pageTargets();
  const d = {
    link,
    alvosPageAntes: before.length,
    alvosPageDepois: after.length,
    alvosPageCriados: created,
    urlAntes: url0,
    urlDepois: await app.js('location.href'),
    semRecarga: await app.js('window.__semRecarga === true'),
    navegacoesDaPagina: app.events.navegacoes - nav0,
    nota: 'a abertura no navegador padrão (shell.openExternal) é conferida pelo supervisor',
  };
  const ok = created.length === 0 && after.length === before.length && d.urlAntes === d.urlDepois && d.semRecarga && d.navegacoesDaPagina === 0;
  return check(ok, d, 'o clique não pode criar alvo "page" nem navegar a página');
}

// ---------------- execução das cenas ----------------
async function runScenes(ctx) {
  const { exe, outDir, mode, res, simulate } = ctx;
  const profile = makeTempDir(`forgia-visual-${ctx.label}-`);
  const shots = (res.capturas = []);
  const notes = (res.observacoes = res.observacoes || []);
  const V = (res.verificacoes = {});
  const opened = []; // para juntar o console de todas as execuções no fim
  let app = null;
  let reopened = null;
  try {
    log(`abrindo ${exe}`);
    log(`perfil temporário: ${profile}`);
    app = await App.open({ exe, profile, port: ctx.port, extraArgs: SCENE_FLAGS, simulate, metrics: ctx.metrics });
    opened.push(app);
    const env = await app.js(`({ largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio, tela: [screen.width, screen.height], gpu: window.forgia.gpu, localStorageInicial: localStorage.length, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches, temBotaoTema: !!document.querySelector('#btn-theme'), dataTema: ${JS.theme}, titulo: document.title })`);
    res.ambiente = {
      navegador: app.version.Browser,
      userAgent: app.version['User-Agent'],
      pagina: app.pageUrl,
      janelaCss: `${env.largura}x${env.altura}`,
      dpr: env.dpr,
      capturaPx: `${Math.round(env.largura * env.dpr)}x${Math.round(env.altura * env.dpr)}`,
      vistaFixa: ctx.metrics ? { ...ctx.metrics, via: 'Emulation.setDeviceMetricsOverride' } : null,
      janelaReal: app.realWindow || null, // medida ao conectar, antes da emulação (a janela pode ainda não estar maximizada)
      tela: env.tela,
      gpu: env.gpu,
      windowsEscuro: windowsPrefersDark(),
      prefersColorSchemeDark: env.prefersDark,
      tituloDaJanela: env.titulo,
      flagsExtras: SCENE_FLAGS,
      perfilTemporario: profile,
      node: process.version,
    };
    V.abre_com_perfil_novo = check(env.localStorageInicial === 0, { localStorageInicial: env.localStorageInicial, pid: app.pid, porta: app.port }, 'o perfil temporário deveria abrir vazio');
    log(`janela ${res.ambiente.janelaCss} CSS px, dpr ${env.dpr}; GPU: ${env.gpu && env.gpu.mode} ${env.gpu && env.gpu.renderer}`);

    if (mode === 'depois' && (!env.temBotaoTema || !env.dataTema)) {
      const why = !env.temBotaoTema ? '#btn-theme não existe neste exe' : 'o <html> não tem data-tema';
      V.ganchos_do_tema = check(false, { temBotaoTema: env.temBotaoTema, dataTema: env.dataTema }, `${why}: não é o build da Fase A (use --rotulo=antes para o build antigo)`);
      throw Object.assign(new Error(`modo depois: ${why} — este exe não tem o tema da Fase A`), { fatal: true });
    }
    if (mode === 'antes' && env.temBotaoTema) notes.push('este exe TEM #btn-theme: não parece ser o build antigo, mas rodou como "antes"');

    const themed = mode === 'depois';
    const order = themed ? [env.dataTema, env.dataTema === 'claro' ? 'escuro' : 'claro'] : [null];
    if (themed) {
      V.tema_inicial_segue_windows = await checkInitialTheme(app);
      V.tema_segue_windows_ao_vivo = await checkLiveOsTheme(app);
      log(`tema inicial ${V.tema_inicial_segue_windows.resultado}; segue o Windows ao vivo ${V.tema_segue_windows_ao_vivo.resultado}`);
    }
    await parkMouse(app);

    // captura a cena em cada tema, trocando pelo botão real; devolve o tema em que terminou
    const seqFrom = async () => (themed ? ((await app.js(JS.theme)) === order[0] ? order : [order[1], order[0]]) : [null]);
    const capture = async (scene, theme) => shots.push(await app.screenshot(path.join(outDir, theme ? `${scene}-${theme}.png` : `${scene}.png`)));

    // (a) vazia
    for (const t of await seqFrom()) {
      if (t) await ensureTheme(app, t);
      await capture('vazia', t);
    }
    const png = pngSize(path.join(outDir, shots[0]));
    res.ambiente.capturaPxReal = `${png.w}x${png.h}`;
    if (res.ambiente.capturaPxReal !== res.ambiente.capturaPx) notes.push(`a captura saiu em ${res.ambiente.capturaPxReal}, esperado ${res.ambiente.capturaPx}`);
    V.cena_vazia = check((await app.js('forgia.editor.objects.length')) === 0, { objetos: 0 }, 'a mesa deveria estar vazia');
    log('cena vazia ok');

    // (b) forma selecionada com cotas
    const sel = await buildSelected(app, notes);
    for (const t of await seqFrom()) {
      if (t) await ensureTheme(app, t);
      await showDims(app);
      await capture('forma-selecionada', t);
    }
    V.cena_forma_selecionada = check(sel.caixa.tipo === 'box' && sel.cotasVisiveis >= 3, sel, 'arrastar a Caixa deveria criar 1 caixa selecionada com cotas');
    log(`cena forma-selecionada ok (${sel.cotasVisiveis} cotas)`);

    // (c) grupo com furo, selecionado (+ troca de tema ao vivo sem recriar geometria)
    const grp = await buildGroup(app, sel.caixa.id, notes);
    await app.js('(forgia.editor.dimsVisibleUntil = 0), true'); // só selecionado: sem as cotas forçadas em (b)
    await app.waitFor(`${JS.dimsVisible} === 0`, 3000, 'cotas escondidas no grupo');
    const seqC = await seqFrom();
    for (let i = 0; i < seqC.length; i++) {
      const t = seqC[i];
      if (t && i > 0) {
        const nav0 = app.events.navegacoes;
        await app.js('(window.__semRecarga = true), true');
        const a = await snapshotForThemeSwitch(app);
        await toggleTheme(app);
        const b = await snapshotForThemeSwitch(app);
        V.troca_de_tema_sem_recriar_geometria = compareThemeSwitch(a, b, nav0, app.events.navegacoes);
        log(`troca de tema ao vivo ${V.troca_de_tema_sem_recriar_geometria.resultado}`);
      }
      await capture('grupo-com-furo', t);
    }
    V.cena_grupo_com_furo = check(grp.filhos === 2 && grp.furos === 1, grp, 'o grupo deveria ter 2 formas, 1 furo, e estar selecionado');
    log('cena grupo-com-furo ok');

    // (d) diálogo Atalhos rolado até o fim (bloco Sobre, quando existir)
    let help = null;
    for (const t of await seqFrom()) {
      if (t) await ensureTheme(app, t);
      help = await openHelp(app);
      await capture('dialogo-atalhos', t);
      await closeModal(app);
      await parkMouse(app);
    }
    V.cena_dialogo_atalhos = check(/^Placa de vídeo: .+ \((GPU|modo software)\)$/.test(help.linhaDaPlaca || ''), help, 'o diálogo Atalhos deveria abrir com a linha da placa de vídeo');
    if (themed) V.sobre_no_dialogo = check(!!help.sobre && help.sobre.visivel && help.sobre.link, help.sobre, '.modal .sobre deveria existir, com o link da LarcherTech, visível depois de rolar até o fim');
    log('cena dialogo-atalhos ok');

    if (themed) {
      // cartão de dica nos dois temas (verificação completa no primeiro)
      const seqD = await seqFrom();
      for (let i = 0; i < seqD.length; i++) {
        await ensureTheme(app, seqD[i]);
        await app.js('forgia.editor.selectAll(), true'); // Copiar habilitado
        await wait(200);
        const r = await checkCard(app, seqD[i], outDir, i === 0);
        shots.push(`dica-${seqD[i]}.png`);
        V[`cartao_de_dica_${seqD[i]}`] = r.cartao;
        if (r.semTitle) V.data_dica_sem_title = r.semTitle;
        if (r.fechaAoSair) V.cartao_fecha_ao_sair = r.fechaAoSair;
        if (r.naoAbreArrastando) V.cartao_nao_abre_com_botao_apertado = r.naoAbreArrastando;
        if (r.botaoDesabilitado) V.cartao_em_botao_desabilitado = r.botaoDesabilitado;
      }
      log(`cartão de dica: ${Object.entries(V).filter(([k]) => k.startsWith('cartao') || k === 'data_dica_sem_title').map(([k, v]) => `${k}=${v.resultado}`).join(' ')}`);
      V.link_do_credito = await checkCreditLink(app);
      log(`link do crédito ${V.link_do_credito.resultado}`);
    }

    // reabrir o MESMO perfil: projeto (e tema escolhido) continuam
    let chosen = null;
    if (themed) {
      chosen = (await app.js(`matchMedia('(prefers-color-scheme: dark)').matches`)) ? 'claro' : 'escuro'; // o oposto do Windows prova que é o salvo
      await ensureTheme(app, chosen);
    }
    const before = await app.js(`({ tema: ${JS.theme}, salvo: localStorage.getItem('forgia.tema'), objetos: forgia.editor.objects.length, tipos: forgia.editor.objects.map((o) => o.type) })`);
    await wait(1500); // tempo para o localStorage gravar
    const closing = await app.close();
    app = null;
    log(`fechado (${closing.gracioso ? 'Browser.close' : 'forçado'}); reabrindo o mesmo perfil`);
    reopened = await App.open({ exe, profile, port: ctx.port, extraArgs: SCENE_FLAGS, simulate, metrics: ctx.metrics });
    opened.push(reopened);
    const after = await reopened.js(`({ tema: ${JS.theme}, salvo: localStorage.getItem('forgia.tema'), objetos: forgia.editor.objects.length, tipos: forgia.editor.objects.map((o) => o.type) })`);
    await parkMouse(reopened);
    shots.push(await reopened.screenshot(path.join(outDir, themed ? `reaberto-${after.tema}.png` : 'reaberto.png')));
    const d = { antesDeFechar: before, depoisDeReabrir: after, fechamento: closing };
    if (themed) V.reabrir_mantem_tema_e_projeto = check(closing.gracioso && after.tema === chosen && after.salvo === chosen && after.objetos === before.objetos, d, `reaberto deveria voltar em '${chosen}' com ${before.objetos} objeto(s)`);
    else V.reabrir_mantem_projeto = check(closing.gracioso && after.objetos === before.objetos && after.objetos > 0, d, `reaberto deveria ter ${before.objetos} objeto(s)`);
    log(`reabrir ${(V.reabrir_mantem_tema_e_projeto || V.reabrir_mantem_projeto).resultado}`);
  } finally {
    for (const a of [app, reopened]) {
      if (!a) continue;
      const c = await a.close().catch(() => (a.kill(), { gracioso: false }));
      if (!c.gracioso) notes.push('fechamento forçado pelo PID: ' + (c.motivo || ''));
    }
    res.consoleDaPagina = opened.flatMap((a, i) => a.pageConsole.map((m) => ({ execucao: i + 1, ...m })));
    const removed = await removeDirAsync(profile);
    res.perfilTemporarioApagado = removed;
    log(`perfil temporário ${removed ? 'apagado' : 'NÃO apagado: ' + profile}`);
  }
}

async function removeDirAsync(dir) {
  for (let i = 0; i < 15; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    if (!fs.existsSync(dir)) {
      tempDirs.delete(dir);
      return true;
    }
    await wait(400);
  }
  return false;
}

// ---------------- abertura: gravação da tela e brilho da janela ----------------
// Vigia da janela (PowerShell + Win32, ciente de DPI):
// - abre uma CORTINA preta (janela própria, topmost, sem ativar, só na área de trabalho) ANTES
//   de a gravação começar: o fundo fica conhecido (preto) e a tela do usuário não é gravada;
// - marca o instante em que a janela do PID fica visível e põe ESSA janela acima da cortina
//   (topmost, sem ativar), informando o retângulo e se ela está no topo;
// - não mexe em nenhuma outra janela; a cortina some quando o vigia é encerrado.
const WATCHER_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public class ForgiaCortina : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008; return cp; } }
}
public static class ForgiaVigia {
  static ForgiaCortina cortina;
  public static void AbrirCortina(int x, int y, int w, int h) {
    ManualResetEvent pronta = new ManualResetEvent(false);
    Thread t = new Thread(delegate () {
      cortina = new ForgiaCortina();
      cortina.FormBorderStyle = FormBorderStyle.None;
      cortina.BackColor = Color.Black;
      cortina.StartPosition = FormStartPosition.Manual;
      cortina.ShowInTaskbar = false;
      cortina.TopMost = true;
      cortina.Bounds = new Rectangle(x, y, w, h);
      cortina.Shown += delegate { pronta.Set(); };
      Application.Run(cortina);
    });
    t.SetApartmentState(ApartmentState.STA);
    t.IsBackground = true;
    t.Start();
    pronta.WaitOne(10000);
    Thread.Sleep(200);
    RECT r; GetWindowRect(cortina.Handle, out r);
    Out("{\"evento\":\"cortina\",\"janela\":" + R(r) + "}");
  }
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO mi);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("kernel32.dll")] static extern void GetSystemTimePreciseAsFileTime(out long ft);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  static double Now() { long ft; GetSystemTimePreciseAsFileTime(out ft); return (ft - 116444736000000000L) / 10000.0; }
  static string N(double v) { return v.ToString("F3", CultureInfo.InvariantCulture); }
  static string R(RECT r) { return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }
  static void Out(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }
  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    timeBeginPeriod(1);
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(MonitorFromPoint(new POINT(), 1), ref mi);
    Out("{\"evento\":\"pronto\",\"t\":" + N(Now()) + ",\"monitor\":" + R(mi.rcMonitor) + ",\"trabalho\":" + R(mi.rcWork) + "}");
  }
  static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.R - r.L < 300 || r.B - r.T < 200) return true;
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
  static string State(string ev, IntPtr h, double t) {
    RECT fr; if (DwmGetWindowAttribute(h, 9, out fr, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out fr);
    RECT wr; GetWindowRect(h, out wr);
    POINT c = new POINT(); c.X = (fr.L + fr.R) / 2; c.Y = (fr.T + fr.B) / 2;
    IntPtr top = GetAncestor(WindowFromPoint(c), 2);
    return "{\"evento\":\"" + ev + "\",\"t\":" + N(t) + ",\"quadro\":" + R(fr) + ",\"janela\":" + R(wr) + ",\"frente\":" + (GetForegroundWindow() == h ? "true" : "false") + ",\"topo\":" + (top == h ? "true" : "false") + ",\"minimizada\":" + (IsIconic(h) ? "true" : "false") + "}";
  }
  public static void Run(uint pid, int maxMs) {
    double t0 = Now(); IntPtr h = IntPtr.Zero; double last = 0;
    while (Now() - t0 < maxMs) {
      if (h == IntPtr.Zero) {
        IntPtr f = Find(pid);
        if (f == IntPtr.Zero) { Thread.Sleep(1); continue; }
        double t = Now(); h = f;
        SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        Out(State("visivel", h, t)); last = t;
      } else {
        Thread.Sleep(10);
        if (!IsWindow(h)) { Out("{\"evento\":\"fechada\",\"t\":" + N(Now()) + "}"); break; }
        if (Now() - last >= 50) { last = Now(); Out(State("estado", h, last)); }
      }
    }
    Out("{\"evento\":\"fim\"}");
  }
}
'@
[ForgiaVigia]::Init()
$linha = [Console]::In.ReadLine()
if ($linha -and $linha.StartsWith('cortina ')) {
  $p = $linha.Split(' ')
  [ForgiaVigia]::AbrirCortina([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4])
  $linha = [Console]::In.ReadLine()
}
if ($linha) { [ForgiaVigia]::Run([uint32]$linha, 45000) }
`;

function startWatcher() {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WATCHER_PS, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  spawned.add(ps.pid);
  const w = { proc: ps, events: [], err: '', listeners: [] };
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      const ev = JSON.parse(line);
      w.events.push(ev);
      for (const l of w.listeners) l(ev);
    }
  });
  ps.stderr.on('data', (d) => (w.err += d.toString('utf8')));
  ps.on('exit', () => spawned.delete(ps.pid));
  w.waitEvent = (name, timeout) =>
    new Promise((resolve, reject) => {
      const hit = w.events.find((e) => e.evento === name);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error(`vigia da janela: sem evento '${name}' em ${timeout} ms ${w.err.slice(0, 300)}`)), timeout);
      w.listeners.push((e) => {
        if (e.evento === name) {
          clearTimeout(timer);
          resolve(e);
        }
      });
    });
  w.stop = () => {
    try {
      ps.stdin.end();
    } catch {}
    killTree(ps.pid);
  };
  return w;
}

function startRecording(file, cap) {
  // região = área de trabalho do monitor principal (sem a barra de tarefas); metade da resolução
  const args = ['-hide_banner', '-loglevel', 'info', '-y', '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0', '-offset_x', String(cap.x), '-offset_y', String(cap.y), '-video_size', `${cap.w}x${cap.h}`, '-i', 'desktop', '-vf', 'scale=iw/2:ih/2:flags=area', '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', '-fps_mode', 'passthrough', file];
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  spawned.add(ff.pid);
  const rec = { proc: ff, err: '', start: null, exited: false };
  rec.exitPromise = new Promise((r) => ff.on('exit', (code) => (spawned.delete(ff.pid), (rec.exited = true), r(code))));
  rec.started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ffmpeg não começou a gravar em 15 s: ' + rec.err.slice(-400))), 15000);
    ff.stderr.on('data', (d) => {
      rec.err += d.toString('utf8');
      if (rec.err.length > 200000) rec.err = rec.err.slice(-100000);
      const m = /start: (\d+\.\d+)/.exec(rec.err);
      if (m && rec.start === null) rec.start = parseFloat(m[1]) * 1000; // relógio de parede (ms): o pts do gdigrab é av_gettime()
      if (rec.start !== null && /frame=\s*[1-9]/.test(rec.err)) {
        clearTimeout(timer);
        resolve();
      }
    });
    ff.on('exit', () => reject(new Error('ffmpeg saiu antes de gravar: ' + rec.err.slice(-600))));
  });
  rec.stop = async () => {
    try {
      ff.stdin.write('q');
    } catch {}
    const code = await Promise.race([rec.exitPromise, wait(20000).then(() => 'timeout')]);
    if (code === 'timeout') killTree(ff.pid);
    return code;
  };
  return rec;
}

// Decodifica o vídeo a 1/8 da tela e devolve a luma (Rec.709, 0..1) de cada quadro + o instante
function decodeFrames(file, aw, ah) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'info', '-i', file, '-vf', `scale=${aw}:${ah}:flags=area,showinfo`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    spawned.add(ff.pid);
    const size = aw * ah * 3;
    const frames = [];
    const times = [];
    let pending = Buffer.alloc(0);
    let errTxt = '';
    ff.stdout.on('data', (d) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= size) {
        const f = pending.subarray(0, size);
        const luma = new Uint8Array(aw * ah);
        for (let p = 0, q = 0; p < luma.length; p++, q += 3) luma[p] = Math.round(0.2126 * f[q] + 0.7152 * f[q + 1] + 0.0722 * f[q + 2]);
        frames.push(luma);
        pending = Buffer.from(pending.subarray(size));
      }
    });
    ff.stderr.on('data', (d) => {
      errTxt += d.toString('utf8');
      let i;
      while ((i = errTxt.indexOf('\n')) >= 0) {
        const line = errTxt.slice(0, i);
        errTxt = errTxt.slice(i + 1);
        const m = /n:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)/.exec(line);
        if (m) times[+m[1]] = parseFloat(m[2]) * 1000;
      }
    });
    ff.on('exit', (code) => {
      spawned.delete(ff.pid);
      if (code !== 0) return reject(new Error('ffmpeg (decodificar) saiu com código ' + code));
      resolve({ frames, times });
    });
  });
}

function regionStats(luma, aw, ah, rect, base) {
  const [x0, y0, x1, y1] = rect;
  let sum = 0;
  let diff = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * aw + x;
      sum += luma[i];
      if (base) diff += Math.abs(luma[i] - base[i]);
      n++;
    }
  }
  return { lum: n ? sum / n / 255 : 0, diff: n && base ? diff / n / 255 : null };
}

async function measureOpening(ctx) {
  const { exe, outDir } = ctx;
  const profile = makeTempDir(`forgia-abertura-${ctx.label}-`);
  const work = makeTempDir('forgia-abertura-video-');
  const video = path.join(work, 'abertura.mkv');
  const out = {
    perfilTemporario: profile,
    criterio: 'luma média (Rec.709, 0..1) no retângulo da janela, sobre cortina preta: FAIL se algum quadro passar de 0,6 (claro) ou se o último segundo não ficar abaixo de 0,35 (escuro); INCONCLUSIVO se a cortina não estava preta ou a janela não estava no topo',
  };
  let app = null;
  let watcher = null;
  let rec = null;
  try {
    // 1) perfil com o tema salvo 'escuro' (antes da gravação)
    log('preparando perfil com forgia.tema = escuro');
    const seed = await App.open({ exe, profile, port: ctx.port });
    out.semente = await seed.js(`(localStorage.setItem('forgia.tema', 'escuro'), { salvo: localStorage.getItem('forgia.tema'), temaNaPagina: ${JS.theme} })`);
    await wait(1500);
    out.semente.fechamento = await seed.close();

    // 2) vigia, cortina preta e gravação, ANTES de abrir o exe
    watcher = startWatcher();
    const ready = await watcher.waitEvent('pronto', 30000);
    const [L, T, R, B] = ready.trabalho;
    const cap = { x: L, y: T, w: (R - L) & ~7, h: (B - T) & ~7 };
    out.regiaoGravada = cap;
    watcher.proc.stdin.write(`cortina ${cap.x} ${cap.y} ${cap.w} ${cap.h}\n`);
    out.cortina = (await watcher.waitEvent('cortina', 20000)).janela;
    rec = startRecording(video, cap);
    await rec.started;
    await wait(900); // quadros de referência (só a cortina) antes da janela
    log(`gravando ${cap.w}x${cap.h} sobre cortina preta (gdigrab, 30 fps pedidos); abrindo o exe`);

    // 3) abre o exe (só perfil e porta, sem flags extras) e avisa o vigia qual PID olhar
    const tSpawn = Date.now();
    app = App.spawn({ exe, profile, port: ctx.port });
    watcher.proc.stdin.write(`${app.pid}\n`);
    const vis = await watcher.waitEvent('visivel', 20000);
    out.msAteJanelaVisivel = Math.round(vis.t - tSpawn);
    await app.connect();
    const remaining = vis.t + 6000 - Date.now();
    if (remaining > 0) await wait(remaining);
    const recStart = rec.start;
    await rec.stop();
    rec = null;
    // só os estados da janela até o fim da gravação e com retângulo válido
    const states = watcher.events.filter((e) => (e.evento === 'visivel' || e.evento === 'estado') && e.quadro[2] > e.quadro[0] && e.quadro[3] > e.quadro[1]);
    out.inicioGravacao = new Date(recStart).toISOString();
    out.janelaVisivelEm = new Date(vis.t).toISOString();
    out.estadoFinal = await app.js(`({ tema: ${JS.theme}, salvo: localStorage.getItem('forgia.tema'), fundo: getComputedStyle(document.body).backgroundColor })`);
    out.fechamento = await app.close();
    app = null;
    watcher.stop();

    // 4) análise quadro a quadro (só números; nenhum quadro vai para o disco aqui)
    const aw = Math.floor(cap.w / 8);
    const ah = Math.floor(cap.h / 8);
    const { frames, times } = await decodeFrames(video, aw, ah);
    const rectAt = (t) => {
      let s = null;
      for (const e of states) if (e.t <= t) s = e;
      return s;
    };
    const toA = (q) => {
      const x0 = Math.max(0, Math.floor((q[0] - cap.x) / 8));
      const y0 = Math.max(0, Math.floor((q[1] - cap.y) / 8));
      const x1 = Math.min(aw, Math.ceil((q[2] - cap.x) / 8));
      const y1 = Math.min(ah, Math.ceil((q[3] - cap.y) / 8));
      return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
    };
    const t0 = recStart; // quadro i foi capturado em recStart + times[i] (relógio de parede)
    const last = states[states.length - 1] || vis;
    const finalRect = toA(last.quadro);
    // antes da janela: só a cortina (tem que estar preta, senão a medição não vale)
    const pre = [];
    let base = null;
    const series = [];
    for (let i = 0; i < frames.length; i++) {
      const t = t0 + (times[i] ?? 0);
      if (t < vis.t - 60) {
        if (finalRect) pre.push(regionStats(frames[i], aw, ah, finalRect, null).lum);
        base = frames[i];
        continue;
      }
      // a partir de ~60 ms antes do "visível": o BitBlt de um quadro pode atravessar a aparição
      const st = rectAt(t) || vis;
      const r = toA(st.quadro);
      if (!r) continue;
      const s = regionStats(frames[i], aw, ah, r, base);
      series.push({ i, t, ms: Math.round(t - vis.t), lum: Math.round(s.lum * 1000) / 1000, diff: s.diff, topo: t < vis.t ? null : st.topo, quadro: st.quadro });
    }
    const painted = series.findIndex((s) => s.diff !== null && s.diff > 0.02);
    out.quadrosGravados = frames.length;
    out.fpsEfetivo = frames.length > 1 ? Math.round(((frames.length - 1) / ((times[frames.length - 1] - times[0]) / 1000)) * 10) / 10 : null;
    out.cortinaLumMaxima = pre.length ? Math.round(Math.max(...pre) * 1000) / 1000 : null;
    out.quadrosDaJanela = series.length;
    out.janelaVisivel = { quadro: vis.quadro, frente: vis.frente, topo: vis.topo };
    out.primeiraPinturaMs = painted >= 0 ? series[painted].ms : null;
    out.serie = series.map(({ ms, lum }) => ({ ms, lum }));
    const light = series.filter((s) => s.lum > 0.6);
    const tail = series.filter((s) => s.t >= series[series.length - 1].t - 1000);
    const tailLum = tail.length ? tail.reduce((a, s) => a + s.lum, 0) / tail.length : null;
    const notOnTop = series.filter((s) => s.ms >= 200 && s.topo === false).length;
    const onTopChecked = series.filter((s) => s.ms >= 200).length;
    out.quadrosClaros = light.length;
    out.primeiroQuadroClaroMs = light.length ? light[0].ms : null;
    out.lumMaxima = series.length ? Math.max(...series.map((s) => s.lum)) : null;
    out.lumMediaUltimoSegundo = tailLum === null ? null : Math.round(tailLum * 1000) / 1000;
    out.quadrosSemJanelaNoTopo = notOnTop;
    if (!series.length || painted < 0) {
      out.resultado = 'INCONCLUSIVO';
      out.motivo = 'a janela não apareceu na gravação';
    } else if (out.cortinaLumMaxima === null || out.cortinaLumMaxima > 0.05) {
      out.resultado = 'INCONCLUSIVO';
      out.motivo = `a cortina não estava preta antes da janela (luma ${out.cortinaLumMaxima})`;
    } else if (notOnTop > onTopChecked / 2) {
      out.resultado = 'INCONCLUSIVO';
      out.motivo = 'a janela do Forgia não estava no topo da tela na maior parte da gravação';
    } else if (light.length) {
      out.resultado = 'FAIL';
      out.motivo = `${light.length} quadro(s) claro(s) (luma > 0,6), o primeiro ${light[0].ms} ms depois de a janela ficar visível`;
    } else if (tailLum >= 0.35) {
      out.resultado = 'FAIL';
      out.motivo = `a janela não ficou escura (luma média do último segundo ${out.lumMediaUltimoSegundo})`;
    } else {
      out.resultado = 'PASS';
      out.motivo = `nenhum quadro claro; pintou escuro ${out.primeiraPinturaMs} ms depois de ficar visível (luma máxima ${out.lumMaxima})`;
    }

    // 5) três quadros recortados na janela (primeira pintura, meio, final); o resto é apagado
    for (const f of fs.readdirSync(outDir)) if (/^abertura-.*\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
    out.capturas = [];
    if (painted >= 0) {
      const picks = [
        ['primeiro', series[painted]],
        ['meio', series[Math.floor((painted + series.length - 1) / 2)]],
        ['final', series[series.length - 1]],
      ];
      for (const [name, s] of picks) {
        const q = s.quadro;
        const x = Math.max(0, Math.floor((q[0] - cap.x) / 2)) & ~1;
        const y = Math.max(0, Math.floor((q[1] - cap.y) / 2)) & ~1;
        const w = (Math.min(cap.w / 2, Math.ceil((q[2] - cap.x) / 2)) - x) & ~1;
        const h = (Math.min(cap.h / 2, Math.ceil((q[3] - cap.y) / 2)) - y) & ~1;
        const file = path.join(outDir, `abertura-${name}.png`);
        const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select=eq(n\\,${s.i}),crop=${w}:${h}:${x}:${y}`, '-fps_mode', 'passthrough', '-frames:v', '1', file], { encoding: 'utf8', windowsHide: true });
        if (r.status !== 0) throw new Error('ffmpeg (quadro) falhou: ' + r.stderr);
        out.capturas.push({ arquivo: path.basename(file), ms: s.ms, lum: s.lum });
      }
    }
    log(`abertura: ${out.resultado} — ${out.motivo}`);
  } finally {
    if (rec) await rec.stop().catch(() => {});
    if (app) await app.close().catch(() => app.kill());
    if (watcher) watcher.stop();
    out.videoApagado = await removeDirAsync(work);
    out.perfilTemporarioApagado = await removeDirAsync(profile);
    log(`vídeo e quadros intermediários ${out.videoApagado ? 'apagados' : 'NÃO apagados: ' + work}`);
  }
  return out;
}

// ---------------- comparação lado a lado ----------------
function pngSize(file) {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function sideBySide(inputs, labels, out) {
  const h = Math.min(720, ...inputs.map((f) => pngSize(f).h)) & ~1;
  const font = 'C:/Windows/Fonts/segoeui.ttf';
  const hasFont = fs.existsSync(font);
  const chains = inputs.map((_, i) => {
    let c = `[${i}:v]scale=-2:${h}:flags=lanczos`;
    // rótulo no canto inferior esquerdo (em cima da vista 3D): no alto ele cobria o logotipo
    if (hasFont) c += `,drawtext=fontfile='C\\:/Windows/Fonts/segoeui.ttf':text='${labels[i]}':x=14:y=h-th-18:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8`;
    if (i < inputs.length - 1) c += ',pad=iw+6:ih:0:0:color=0x808080';
    return c + `[v${i}]`;
  });
  const filter = chains.join(';') + ';' + inputs.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${inputs.length}`;
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', filter, '-frames:v', '1', out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('ffmpeg (comparação) falhou: ' + (r.stderr || r.error));
}

function buildComparisons(evid) {
  const a = path.join(evid, 'antes');
  const d = path.join(evid, 'depois');
  if (!fs.existsSync(a) || !fs.existsSync(d)) return { montadas: [], motivo: 'precisa de antes/ e depois/' };
  const dir = path.join(evid, 'comparacao');
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  const missing = [];
  for (const s of SCENES) {
    const files = [path.join(a, `${s}.png`), path.join(d, `${s}-claro.png`), path.join(d, `${s}-escuro.png`)];
    const lack = files.filter((f) => !fs.existsSync(f));
    if (lack.length) {
      missing.push(...lack.map((f) => path.relative(evid, f)));
      continue;
    }
    sideBySide(files, ['antes', 'depois - claro', 'depois - escuro'], path.join(dir, `${s}.png`));
    made.push(`${s}.png`);
  }
  const ab = [path.join(a, 'abertura-primeiro.png'), path.join(d, 'abertura-primeiro.png')];
  if (ab.every((f) => fs.existsSync(f))) {
    sideBySide(ab, ['antes - 1o quadro', 'depois - 1o quadro'], path.join(dir, 'abertura-primeiro.png'));
    made.push('abertura-primeiro.png');
  }
  return { montadas: made, faltando: missing };
}

// ---------------- principal ----------------
function readResult(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function overall(res, mode) {
  const all = Object.entries(res.verificacoes || {});
  const failed = all.filter(([, v]) => v.resultado !== 'PASS' && v.resultado !== 'N/A' && !(mode === 'antes' && v.esperadoNoAntes));
  return { resultado: failed.length ? 'FAIL' : 'PASS', falhas: failed.map(([k, v]) => `${k}: ${v.motivo || v.resultado}`) };
}

async function main() {
  const A = parseArgs(process.argv.slice(2));
  if (A.ajuda) {
    const src = fs.readFileSync(__filename, 'utf8');
    console.log(src.slice(src.indexOf('/*'), src.indexOf('*/') + 2));
    return 0;
  }
  const evid = path.resolve(ROOT, typeof A.pasta === 'string' ? A.pasta : path.join('docs', 'visual-evidence'));
  if (A.comparacao) {
    const c = buildComparisons(evid);
    log(`comparação: ${c.montadas.length ? c.montadas.join(', ') : 'nada montado'}${c.motivo ? ' (' + c.motivo + ')' : ''}${c.faltando?.length ? '; faltando: ' + c.faltando.join(', ') : ''}`);
    return 0;
  }
  if (typeof A.exe !== 'string') throw new Error('faltou --exe=<caminho do Forgia.exe gerado>');
  const exe = path.resolve(ROOT, A.exe);
  if (!fs.existsSync(exe)) throw new Error('exe não encontrado: ' + exe);
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Forgia');
  if (exe.toLowerCase().startsWith(installed.toLowerCase() + path.sep)) throw new Error('recusado: esse é o Forgia INSTALADO do usuário (' + installed + ')');
  const defects = !!A['simular-defeitos'];
  const simulate = !!A['simular-depois'] || defects;
  if (simulate && A.abertura) throw new Error('--simular-depois não mede abertura (o fundo da janela vem do main.cjs antigo)');
  const label = defects ? '_simulacao-defeitos' : simulate ? '_simulacao-depois' : typeof A.rotulo === 'string' ? A.rotulo : null;
  if (!label || !/^[\w.-]+$/.test(label)) throw new Error('faltou --rotulo=<antes|depois> (letras, números, - _ .)');
  const mode = simulate ? 'depois' : A.modo || (label === 'antes' ? 'antes' : 'depois');
  if (!['antes', 'depois'].includes(mode)) throw new Error('--modo deve ser antes ou depois');
  const port = A.porta ? parseInt(A.porta, 10) : 0;
  const metrics = parseSize(typeof A.tamanho === 'string' ? A.tamanho : DEFAULT_SIZE);
  if (A.abertura && A.tamanho) log('--tamanho ignorado: a medição de abertura usa a janela real, sem emulação');
  const outDir = path.join(evid, label);
  fs.mkdirSync(outDir, { recursive: true });
  const resFile = path.join(outDir, 'resultado.json');
  const prev = readResult(resFile);
  const stampBefore = userProfileStamp();
  log(`perfil do usuário (só leitura de data): Local Storage ${stampBefore.pasta || stampBefore.erro}`);
  const res = { rotulo: label, modo: mode, simulacao: simulate || undefined, exe, quando: new Date().toISOString() };
  let fatal = null;
  if (A.abertura) {
    Object.assign(res, prev, { quandoAbertura: res.quando, quando: prev.quando || res.quando });
    res.verificacoes = { ...(prev.verificacoes || {}) };
    try {
      res.abertura = { exe, quando: res.quandoAbertura, ...(await measureOpening({ exe, outDir, label, port })) };
      const ab = res.abertura;
      res.verificacoes.sem_clarao = { resultado: ab.resultado, motivo: ab.motivo, detalhe: { primeiraPinturaMs: ab.primeiraPinturaMs, quadrosClaros: ab.quadrosClaros, lumMaxima: ab.lumMaxima, lumMediaUltimoSegundo: ab.lumMediaUltimoSegundo, fpsEfetivo: ab.fpsEfetivo, capturas: ab.capturas } };
      if (mode === 'antes' && res.abertura.resultado === 'FAIL') res.verificacoes.sem_clarao.esperadoNoAntes = true;
    } catch (e) {
      fatal = e;
      res.verificacoes.sem_clarao = { resultado: 'FAIL', motivo: 'erro na medição: ' + e.message };
    }
  } else {
    if (prev.abertura) res.abertura = prev.abertura; // a medição de abertura é outra execução
    for (const f of fs.readdirSync(outDir)) if (/^(vazia|forma-selecionada|grupo-com-furo|dialogo-atalhos|dica|reaberto)(-[\w]+)?\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
    let simSource = simulate ? fs.readFileSync(path.join(__dirname, 'visual-runtime-simulacao.js'), 'utf8') : null;
    if (defects) simSource = `window.__simulacaoDefeitos = ${JSON.stringify(Object.fromEntries(Object.keys(PLANTED_DEFECTS).map((k) => [k, true])))};\n${simSource}`;
    try {
      await runScenes({ exe, outDir, mode, res, label, port, metrics, simulate: simSource });
    } catch (e) {
      fatal = e;
      res.erro = e.message;
    }
    if (prev.verificacoes?.sem_clarao) res.verificacoes.sem_clarao = prev.verificacoes.sem_clarao;
  }
  const stampAfter = userProfileStamp();
  const same = JSON.stringify({ ...stampBefore, caminho: 0 }) === JSON.stringify({ ...stampAfter, caminho: 0 });
  res.perfilUsuario = { antes: stampBefore, depois: stampAfter, igual: same };
  res.verificacoes = res.verificacoes || {};
  res.verificacoes.perfil_do_usuario_intocado = check(same, res.perfilUsuario, 'o LastWriteTime de %APPDATA%\\Forgia\\Local Storage mudou durante a execução (pode ser o Forgia do próprio usuário gravando)');
  Object.assign(res, overall(res, mode));
  if (fatal) res.resultado = 'FAIL';
  if (defects) {
    const planted = Object.entries(PLANTED_DEFECTS).map(([defeito, verificacao]) => ({ defeito, verificacao, resultado: res.verificacoes[verificacao]?.resultado || 'ausente' }));
    res.testeDeDefeitos = { plantados: planted, todosReprovados: !fatal && planted.every((p) => p.resultado === 'FAIL') };
  }
  fs.writeFileSync(resFile, JSON.stringify(res, null, 2));

  if (!simulate) {
    try {
      const c = buildComparisons(evid);
      if (c.montadas.length) log(`comparação montada: ${c.montadas.join(', ')}`);
      else log(`comparação não montada (${c.motivo || 'faltando: ' + (c.faltando || []).join(', ')})`);
    } catch (e) {
      log('comparação falhou: ' + e.message);
    }
  }
  log(`resultado: ${res.resultado} -> ${path.relative(ROOT, resFile)}`);
  for (const [k, v] of Object.entries(res.verificacoes)) log(`  ${v.resultado.padEnd(12)} ${k}${v.esperadoNoAntes ? ' (esperado no antes)' : ''}${v.resultado !== 'PASS' && v.motivo ? ' — ' + v.motivo : ''}`);
  if (fatal) {
    console.error('[visual] ERRO: ' + fatal.message);
    return fatal.fatal ? 2 : 1;
  }
  if (defects) {
    for (const p of res.testeDeDefeitos.plantados) log(`  defeito ${p.defeito.padEnd(16)} -> ${p.verificacao}: ${p.resultado === 'FAIL' ? 'reprovou (ok)' : 'NÃO reprovou: ' + p.resultado}`);
    log(`teste de defeitos: ${res.testeDeDefeitos.todosReprovados ? 'todas as verificações reprovaram o defeito plantado' : 'ALGUMA verificação deixou passar o defeito'}`);
    return res.testeDeDefeitos.todosReprovados ? 0 : 1;
  }
  return res.resultado === 'PASS' ? 0 : 1;
}

// require() de outro roteiro (ex.: tests/r1-runtime.cjs) só usa as peças, sem rodar as cenas
module.exports = { App, makeTempDir, cleanupAll, removeDirSync, userProfileStamp, check, wait, SCENE_FLAGS, parseSize, DEFAULT_SIZE };

if (require.main === module) {
  main()
    .then((code) => {
      cleanupAll();
      process.exit(code);
    })
    .catch((err) => {
      console.error('[visual] ERRO:', err.message);
      cleanupAll();
      process.exit(1);
    });
}
