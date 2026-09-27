'use strict';
// Modo gravação das dicas animadas (Fase E). Não é o programa do usuário: é um processo main de
// Electron só para desenvolvimento, aberto por scripts/gravar-dicas.mjs (npm run gravar-dicas),
// sempre com um perfil temporário (--user-data-dir e FORGIA_DADOS).
//
// - Abre o Forgia do build do Vite (dist/) com o MESMO preload, ponte e projeto do electron/main.cjs,
//   numa janela sem moldura de tamanho fixo, visível, sempre por cima e que não recebe o mouse
//   físico (setIgnoreMouseEvents): o mouse e o teclado do roteiro chegam como entrada real pelo
//   CDP (Input.dispatch*), pelos mesmos caminhos de código do usuário.
// - Para cada roteiro (ajuda/roteiros/<dica>.json) e tema: arruma a cena (ajuda/cenas/<cena>.json),
//   a câmera e a seleção; grava a janela inteira (desktopCapturer + MediaRecorder, na janela oculta
//   scripts/gravar/gravador.html), com o cursor falso e o selo das teclas (sobreposicao.js); roda
//   os passos; no fim congela a imagem, volta a cena à pose inicial por baixo e dissolve nela: o
//   vídeo termina onde começou e o loop não pula. Grava public/ajuda/<dica>-<tema>.webm.
// - --cenas: remonta as cenas a partir da "montagem" de cada arquivo (Iniciantes + lote da ponte).
const { app, BrowserWindow, desktopCapturer, session, screen, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { startBridge } = require('../../electron/ponte.cjs');
const { startProject } = require('../../electron/projeto.cjs');
// a gravação nunca fala com o Agent Code de verdade (aberto na faixa real): faixa só dela, onde
// fica o Agent Code falso dos roteiros com "agentCode". Exceção: --agentcode-real, para os roteiros
// com "agentCode": { "real": true } (a mídia do README com a IA de verdade)
const AGENTCODE_REAL = process.argv.includes('--agentcode-real');
if (!AGENTCODE_REAL) process.env.FORGIA_AGENTCODE_PORTAS = process.env.FORGIA_AGENTCODE_PORTAS || '47450-47489';
const { startAgentCode } = require('../../electron/agentcode.cjs');
const webm = require('./webm.cjs');

const ROOT = path.join(__dirname, '..', '..');
const ROTEIROS = path.join(ROOT, 'ajuda', 'roteiros');
const CENAS = path.join(ROOT, 'ajuda', 'cenas');
const INICIANTES = path.join(ROOT, 'public', 'iniciantes');
const WIN = { w: 1360, h: 860 }; // janela do Forgia na gravação (px CSS), igual em todas
const VIDEO = { w: 640, h: 480, fps: 30, bitrate: 300000 }; // cartão: 4:3, ~150–300 KB em 4–6 s
const RECORTE = 560; // largura padrão do recorte na vista (px CSS), 4:3
const TEMAS = ['claro', 'escuro'];
const log = (...a) => console.log('[gravar]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- argumentos ----------
const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const perfil = args['user-data-dir'];
const forgiaDoUsuario = path.join(process.env.APPDATA || '', 'Forgia').toLowerCase();
if (!perfil || path.resolve(perfil).toLowerCase().startsWith(forgiaDoUsuario)) {
  console.error('[gravar] recusado: use um --user-data-dir temporário (nunca o perfil do Forgia do usuário)');
  process.exit(2);
}
app.setPath('userData', path.resolve(perfil));

// as mesmas chaves de GPU do electron/main.cjs; e nada de pausar a janela coberta
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// ---------- teclado (CDP) ----------
const MOD = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
const NAMED = {
  ArrowLeft: ['ArrowLeft', 37, '←'],
  ArrowUp: ['ArrowUp', 38, '↑'],
  ArrowRight: ['ArrowRight', 39, '→'],
  ArrowDown: ['ArrowDown', 40, '↓'],
  Escape: ['Escape', 27, 'Esc'],
  Enter: ['Enter', 13, 'Enter'],
  Delete: ['Delete', 46, 'Delete'],
};
// 'Ctrl+D' | 'Shift+ArrowRight' | 'L' -> evento do CDP e o texto do selo ('Ctrl+D', 'Shift+→')
function parseKey(combo) {
  const parts = combo.split('+');
  const name = parts.pop();
  let modifiers = 0;
  for (const p of parts) modifiers |= MOD[p];
  const shift = !!(modifiers & MOD.Shift);
  let ev;
  let label;
  if (NAMED[name]) {
    const [key, vk, lbl] = NAMED[name];
    ev = { key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: name === 'Enter' ? '\r' : undefined };
    label = lbl;
  } else {
    const ch = name.length === 1 ? name : name[0];
    const up = ch.toUpperCase();
    const key = shift ? up : ch.toLowerCase();
    const code = /[A-Z]/.test(up) ? 'Key' + up : 'Digit' + up;
    ev = { key, code, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0), text: modifiers & (MOD.Ctrl | MOD.Alt | MOD.Meta) ? undefined : key };
    label = up;
  }
  return { ev: { ...ev, modifiers }, label: [...parts, label].join('+') };
}

// ---------- curvas do cursor ----------
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // começa e para devagar
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}
// caminho suave por vários pontos, parametrizado pelo comprimento (velocidade uniforme)
function smoothPath(pts, samples = 240) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < samples / (pts.length - 1); s++) out.push(catmull(p0, pts[i], pts[i + 1], p3, s / (samples / (pts.length - 1))));
  }
  out.push(pts[pts.length - 1]);
  const len = [0];
  for (let i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
  const total = len[len.length - 1] || 1;
  return (k) => {
    const d = k * total;
    let i = 1;
    while (i < len.length - 1 && len[i] < d) i++;
    const a = len[i - 1];
    const f = len[i] > a ? (d - a) / (len[i] - a) : 0;
    return { x: out[i - 1].x + (out[i].x - out[i - 1].x) * f, y: out[i - 1].y + (out[i].y - out[i - 1].y) * f };
  };
}

// JSON legível: um nível por linha, mas listas e objetos curtos (números, medidas) numa linha só
function pretty(v, ind = '') {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length <= 96) return one;
  const next = ind + ' ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + pretty(x, next)).join(',\n')}\n${ind}]`;
  return `{\n${Object.entries(v)
    .map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`)
    .join(',\n')}\n${ind}}`;
}

// ---------- a sessão de gravação ----------
class Sessao {
  async abrir() {
    const area = screen.getPrimaryDisplay().workArea;
    const cur = screen.getCursorScreenPoint();
    // a janela vai para o lado da tela longe do mouse físico
    const x = cur.x > area.x + area.width / 2 ? area.x + 24 : area.x + area.width - WIN.w - 24;
    const y = area.y + Math.max(0, Math.round((area.height - WIN.h) / 2));
    const win = (this.win = new BrowserWindow({
      x,
      y,
      width: WIN.w,
      height: WIN.h,
      useContentSize: true,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#e9ecef',
      title: 'Forgia (gravação das dicas)',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(ROOT, 'electron', 'preload.cjs') },
    }));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    startBridge(win);
    startAgentCode(win); // opção Agent Code do Conectar IA (sem Agent Code aberto: "não encontrado")
    startProject(win, { arquivoInicial: null });
    const shown = new Promise((r) => win.once('ready-to-show', r));
    win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    await shown;
    win.setAlwaysOnTop(true, 'floating');
    win.setIgnoreMouseEvents(true);
    win.showInactive();
    this.dbg = win.webContents.debugger;
    this.dbg.attach('1.3');
    await this.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await this.waitFor('!!(window.forgia && forgia.editor && forgia.ponte && forgia.ponte.info && forgia.ponte.info.porta)', 45000);
    await this.js(fs.readFileSync(path.join(__dirname, 'sobreposicao.js'), 'utf8'));

    // gravador: janela oculta; o getDisplayMedia dela recebe a janela do Forgia. A lista do
    // desktopCapturer não traz as janelas do próprio processo, então a fonte é a da janela
    // (getMediaSourceId, o id no formato do desktopCapturer), com o nome dela.
    session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
      const id = win.getMediaSourceId();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
      cb({ video: sources.find((s) => s.id === id) || { id, name: win.getTitle() } });
    });
    this.rec = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    await this.rec.loadFile(path.join(__dirname, 'gravador.html'));
    this.mouse = { x: 0, y: 0, down: false };
  }

  cdp(method, params = {}) {
    return this.dbg.sendCommand(method, params);
  }

  async js(code) {
    return this.win.webContents.executeJavaScript(code, true);
  }

  async rjs(code) {
    return this.rec.webContents.executeJavaScript(code, true);
  }

  async waitFor(expr, timeout = 15000) {
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try {
        ok = await this.js(expr);
      } catch {}
      if (ok) return ok;
      if (Date.now() - t0 > timeout) throw new Error('tempo esgotado: ' + expr);
      await wait(100);
    }
  }

  // quadros de desenho da página (a cena e as sobreposições já estão na tela)
  frames(n = 2) {
    return this.js(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
  }

  // ---------- mouse ----------
  async send(type, p, extra = {}) {
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    await this.cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: this.mouse.down || type !== 'mouseMoved' ? 'left' : 'none', buttons: this.mouse.down ? 1 : 0, modifiers: extra.modifiers || 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }

  async moveAlong(fn, ms, extra) {
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
      await this.send('mouseMoved', fn(ease(k)), extra);
      if (k >= 1) break;
      await wait(14);
    }
  }

  // até p, em linha com um arco leve (arco = fração da distância, para o lado)
  moveTo(p, ms, { arco = 0.12, modifiers = 0 } = {}) {
    const a = { x: this.mouse.x, y: this.mouse.y };
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const c = { x: a.x + dx / 2 - dy * arco, y: a.y + dy / 2 + dx * arco };
    return this.moveAlong((k) => ({ x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * c.x + k * k * p.x, y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * c.y + k * k * p.y }), ms, { modifiers });
  }

  async press(modifiers = 0) {
    this.mouse.down = true;
    await this.send('mousePressed', this.mouse, { modifiers });
  }

  async release(modifiers = 0) {
    this.mouse.down = false;
    await this.send('mouseReleased', this.mouse, { modifiers });
  }

  async key(combo) {
    const { ev } = parseKey(combo);
    const { text, ...base } = ev;
    await this.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) });
    await wait(40);
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async type(text, ms) {
    const per = ms / Math.max(1, text.length);
    for (const ch of text) {
      await this.cdp('Input.insertText', { text: ch });
      await wait(per);
    }
  }

  // arquivo { caminho (a partir da raiz), para, de?, rotulo? }: cartão com o nome segue o cursor
  // de "de" até "para" e o arquivo é solto ali (a página recebe o drop com o File de verdade)
  async arquivo(a, ms, st) {
    const file = path.resolve(ROOT, a.caminho);
    if (!fs.existsSync(file)) throw new Error(`arquivo do roteiro não existe: ${a.caminho}`);
    const nome = JSON.stringify(a.rotulo || path.basename(file));
    await this.js(`(() => {
      const c = document.createElement('div');
      c.id = '__gravacao-arquivo';
      c.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f58220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
      c.append(document.createTextNode(${nome}));
      Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483646', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '7px', background: '#ffffff', color: '#1e2226', border: '1px solid #c9ced3', boxShadow: '0 6px 18px rgba(0,0,0,.22)', font: '600 14px "Segoe UI", sans-serif', transform: 'translate(-999px, -999px)' });
      document.body.append(c);
      window.__gravacaoArquivo = (e) => (c.style.transform = 'translate(' + (e.clientX + 16) + 'px, ' + (e.clientY + 22) + 'px)');
      window.addEventListener('pointermove', window.__gravacaoArquivo, true);
      return true;
    })()`);
    if (a.de) await this.send('mouseMoved', await this.target(a.de));
    const p = await this.target(a.para);
    await this.moveTo(p, ms, st);
    await wait(st.pausa ?? 120);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await this.cdp('Input.dispatchDragEvent', { type, x: p.x, y: p.y, data });
    await this.js(`(() => { window.removeEventListener('pointermove', window.__gravacaoArquivo, true); const c = document.getElementById('__gravacao-arquivo'); if (c) c.remove(); return true; })()`);
  }

  // ---------- alvos ----------
  async target(spec) {
    if (spec.recorte) return { x: this.crop.x + this.crop.w * spec.recorte[0], y: this.crop.y + this.crop.h * spec.recorte[1] };
    return this.js(`__gravacao.alvo(${JSON.stringify(spec)})`);
  }

  async targets(list) {
    const out = [];
    for (const s of list) out.push(await this.target(s));
    return out;
  }

  // ---------- roteiro ----------
  async preparar(rot, tema, cena) {
    // no recorte da vista (dicas), o inspetor que flutua no canto de cima só apareceria cortado
    const janela = !!(rot.recorte && rot.recorte.janela);
    const estilo = (janela ? '' : '#inspector { visibility: hidden !important; }\n') + (rot.estilo || '');
    const setup = { tema, projeto: cena.projeto, camera: rot.camera, selecionar: rot.selecionar || [], estilo };
    const ok = await this.js(`__gravacao.preparar(${JSON.stringify(setup)})`);
    if (!ok) throw new Error(`${rot.dica}: seleção inicial não encontrada (${(rot.selecionar || []).join(', ')})`);
    await this.js('__gravacao.semSelo(); __gravacao.semSeta(); __gravacao.legenda({ visivel: false })');
    // o convite "Peça para a IA" (primeira abertura) não entra nas gravações
    await this.js("localStorage.setItem('forgia.iaConviteVisto', '1'), document.querySelectorAll('.ia-convite').forEach((e) => e.remove()), true");
    await this.frames(3);
    await wait(rot.esperaCena || 250); // booleanas (CSG) e miniaturas da cena
    const vp = await this.js('__gravacao.vista()');
    const video = { ...VIDEO, ...(rot.video || {}) };
    if (rot.recorte && rot.recorte.janela) {
      // a janela inteira (mídia do README): o vídeo tem a proporção da janela
      this.crop = { x: 0, y: 0, w: WIN.w, h: WIN.h, janela: WIN.w };
    } else {
      const w = (rot.recorte && rot.recorte.largura) || RECORTE;
      const h = Math.round((w * video.h) / video.w);
      const cx = vp.x + vp.w / 2 + ((rot.recorte && rot.recorte.dx) || 0);
      const cy = vp.y + vp.h / 2 + ((rot.recorte && rot.recorte.dy) || 0);
      this.crop = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, janela: WIN.w };
    }
    // o mouse vai para o ponto de partida do roteiro sem aparecer (antes de gravar ou congelado)
    const start = await this.target(rot.cursor || { recorte: [0.8, 0.82] });
    if (this.mouse.down) await this.release();
    await this.send('mouseMoved', start);
    await this.frames(3);
    await wait(150);
  }

  async passo(st) {
    const canto = { x: this.crop.x + 14, y: this.crop.y + this.crop.h - 14 };
    if (st.selo || (st.tecla && st.selo !== false)) {
      const teclas = st.tecla ? parseKey(st.tecla).label : null;
      await this.js(`__gravacao.selo(${JSON.stringify({ teclas, rotulo: typeof st.selo === 'string' ? st.selo : null, canto, ms: st.seloMs || 1100 })})`);
    }
    if (st.tecla) {
      await wait(st.antes ?? 120);
      await this.key(st.tecla);
    }
    if (st.mover) await this.moveTo(await this.target(st.mover), st.ms || 700, st);
    if (st.clicar) {
      await this.moveTo(await this.target(st.clicar), st.ms || 650, st);
      await wait(st.pausa ?? 90);
      await this.press(st.modifiers);
      await wait(80);
      await this.release(st.modifiers);
    }
    if (st.apertar) {
      await wait(st.pausa ?? 60);
      await this.press(st.modifiers);
    }
    if (st.arrastar) {
      if (!this.mouse.down) await this.press(st.modifiers);
      await this.moveTo(await this.target(st.arrastar), st.ms || 900, st);
      await wait(st.pausa ?? 60);
      await this.release(st.modifiers);
    }
    if (st.caminho) {
      const pts = [{ x: this.mouse.x, y: this.mouse.y }, ...(await this.targets(st.caminho))];
      await this.moveAlong(smoothPath(pts), st.ms || 1200, st);
    }
    if (st.soltar) await this.release(st.modifiers);
    if (st.digitar) await this.type(st.digitar, st.ms || 1000);
    // arquivo arrastado do Explorador para a janela: o cursor leva um cartão com o nome do arquivo
    // e solta de verdade (Input.dispatchDragEvent com o arquivo: o mesmo drop de um arrasto do Windows)
    if (st.arquivo) await this.arquivo(st.arquivo, st.ms || 900, st);
    // comando pela ponte da IA (HTTP local com o token), o mesmo caminho de um agente pelo MCP
    if (st.ponte) {
      const r = await this.ponte(st.ponte.cmd, st.ponte.args || {});
      if (!r.ok) throw new Error(`ponte ${st.ponte.cmd}: ${JSON.stringify(r).slice(0, 400)}`);
    }
    // legenda (ex.: o pedido feito ao agente), num ponto do recorte
    if (st.legenda) {
      const l = st.legenda;
      const canto = l.recorte ? { x: this.crop.x + this.crop.w * l.recorte[0], y: this.crop.y + this.crop.h * l.recorte[1] } : undefined;
      await this.js(`__gravacao.legenda(${JSON.stringify({ html: l.html, canto, visivel: l.visivel !== false })})`);
    }
    // seta de um alvo a outro (ex.: da peça ao encaixe que ela gerou)
    if (st.seta) {
      const { de, para, ms, curva } = st.seta;
      await this.js(`__gravacao.seta(${JSON.stringify({ de: await this.target(de), para: await this.target(para), ms, curva })})`);
    }
    // espera a página chegar a um estado (ex.: a tarefa da IA terminar), até ms
    if (st.esperarQue) await this.waitFor(st.esperarQue, st.ms || 20000);
    if (st.esperar) await wait(st.esperar);
    // tempo do vídeo: 4 = o que vem depois passa 4x mais rápido (a espera da IA de verdade); 1 volta
    if (st.velocidade) await this.rjs(`gravador.velocidade(${Number(st.velocidade)})`);
  }

  // Agent Code falso (tests/agentcode-falso.mjs, o do teste da integração) na faixa real, para a
  // mídia do README mostrar o pedido indo à IA e a peça mudando: o "agente" do falso sobe o
  // servidor MCP que o Forgia mandou em mcp_servers.forgia e faz as chamadas forgia_* do roteiro,
  // pelo mesmo caminho da IA de verdade. O Agent Code de verdade ainda não tem esse servidor.
  // cfg: { porta?, pensarMs?, chamadas: [{ ferramenta, args }], resposta }; nos args, "$peca",
  // "$parte", "$lado" e "$ponto" viram a peça, a parte, o lado e o ponto da 1ª marcação
  // (forgia_marcacoes). Outros "$nome" ficam como estão (as refs de um forgia_lote).
  async agenteFalso(cfg) {
    // "real": o Agent Code de verdade, aberto nesta máquina (faixa do contrato, sem falso); a IA
    // faz o pedido de verdade. Só com --agentcode-real (senão o main olharia a faixa de teste)
    if (cfg.real) {
      if (!AGENTCODE_REAL) throw new Error('roteiro com Agent Code real: rode com --agentcode-real');
      if (cfg.integrar === false) return;
      const estado = await this.js('forgia.agentCode.integrar().then((s) => s && s.estado)');
      if (estado !== 'integrado') throw new Error(`Agent Code real: estado ${estado} (ele está aberto e com conta?)`);
      return;
    }
    const { fakeAgentCode, mcpStdio } = await import(pathToFileURL(path.join(ROOT, 'tests', 'agentcode-falso.mjs')).href);
    const troca = (v, m) => {
      const valor = { peca: m.peca && m.peca.id, parte: m.parte && m.parte.id, lado: m.lado_da_parte, ponto: m.ponto };
      return JSON.parse(JSON.stringify(v).replace(/"\$(peca|parte|lado|ponto)"/g, (_s, k) => JSON.stringify(valor[k])));
    };
    const executor = async (a) => {
      const f = mcpStdio(a.mcp_servers.forgia);
      await f.init();
      try {
        await wait(cfg.pensarMs ?? 1500);
        const r = await f.call('forgia_marcacoes', {});
        const m = (r.marcacoes || r)[0];
        // pedido feito pela conversa (sem alfinete): as chamadas não usam "$peca" etc.
        if (!m && /"\$(peca|parte|lado|ponto)"/.test(JSON.stringify(cfg.chamadas || []))) throw new Error('nenhuma marcação');
        for (const c of cfg.chamadas || []) await f.call(c.ferramenta, m ? troca(c.args, m) : c.args);
        return cfg.resposta;
      } finally {
        f.close();
      }
    };
    this.falso = await fakeAgentCode({ porta: cfg.porta || 47489, executor });
    // integrar: false = o próprio roteiro clica em Integrar (a mídia mostra a integração)
    if (cfg.integrar === false) return;
    const estado = await this.js('forgia.agentCode.integrar().then((s) => s && s.estado)');
    if (estado !== 'integrado') throw new Error(`Agent Code falso: estado ${estado}`);
  }

  // tira o balão do alfinete e o aviso da IA (a pose inicial não tem) e desliga a integração
  async semAgenteFalso({ desligar = false } = {}) {
    await this.js("forgia.agentCode.fechar(), forgia.editor.tools.mark.hideBalloon(), document.querySelectorAll('#viewport .ia-aviso').forEach((e) => e.remove()), document.querySelectorAll('.ia-chat').forEach((e) => (e.hidden = true)), document.querySelectorAll('#sb-pedir').forEach((e) => e.setAttribute('aria-expanded', 'false')), forgia.editor.tool && forgia.editor.setTool(null), true");
    if (!desligar) return;
    await this.js('forgia.agentCode.desligar().then(() => true)');
    if (!this.falso) return;
    await this.falso.close();
    this.falso = null;
  }

  // grava um roteiro num tema; devolve o resumo
  async gravar(rot, tema, saida, fotos) {
    // cena: nome em ajuda/cenas, ou caminho a partir da raiz (ex.: public/iniciantes/foguete)
    const cenaFile = rot.cena.includes('/') ? path.join(ROOT, rot.cena + '.json') : path.join(CENAS, rot.cena + '.json');
    const cena = JSON.parse(fs.readFileSync(cenaFile, 'utf8'));
    // o roteiro pode clicar em Copiar: a área de transferência do usuário volta como estava
    const area = { texto: clipboard.readText(), imagem: clipboard.readImage() };
    if (rot.agentCode) await this.agenteFalso(rot.agentCode);
    try {
      return await this.gravarCena(rot, tema, saida, fotos, cena);
    } finally {
      if (rot.agentCode) await this.semAgenteFalso({ desligar: true });
      if (area.imagem.isEmpty()) clipboard.writeText(area.texto);
      else clipboard.write({ text: area.texto, image: area.imagem });
    }
  }

  async gravarCena(rot, tema, saida, fotos, cena) {
    await this.preparar(rot, tema, cena);
    const video = { ...VIDEO, ...(rot.video || {}) };
    await this.rjs(`gravador.iniciar(${JSON.stringify({ recorte: this.crop, saida: { w: video.w, h: video.h }, fps: video.fps, bitrate: video.bitrate })})`);
    const antes = await this.rjs('gravador.amostra()');
    const foto = async (nome) => {
      if (!fotos) return;
      await this.frames(2);
      await wait(70); // a captura da janela chega um ou dois quadros depois do desenho
      const b64 = await this.rjs('gravador.foto()');
      fs.writeFileSync(path.join(fotos, `${rot.dica}-${tema}-${nome}.png`), Buffer.from(b64, 'base64'));
    };
    await foto('1-inicio');
    if (args.previa) {
      // só o enquadramento da pose inicial (nada é gravado)
      await this.rjs('gravador.parar()');
      return { dica: rot.dica, tema, previa: true };
    }
    await wait(rot.pausaInicial ?? 250);
    for (const st of rot.passos) {
      await this.passo(st);
      if (st.foto) await foto('2-' + st.foto);
    }
    // o resultado fica parado mais um pouco enquanto a cena volta à pose inicial por baixo
    await wait(rot.pausaFinal ?? 100);
    await foto('3-fim');
    const acao = await this.rjs('gravador.amostra()'); // o resultado: tem que diferir do início
    // fim: congela, volta à pose inicial por baixo e dissolve nela
    await this.rjs('gravador.congelar()');
    if (rot.agentCode) await this.semAgenteFalso();
    // o aviso "IA: criou…" (de qualquer pedido pela ponte) não existe na pose inicial
    await this.js("document.querySelectorAll('#viewport .ia-aviso').forEach((e) => e.remove()), true");
    // o aviso "IA: criou…" (de um agente ou de um comando da ponte) não faz parte da pose inicial
    await this.js("document.querySelectorAll('#viewport .ia-aviso').forEach((e) => e.remove()), true");
    await this.preparar(rot, tema, cena);
    const depois = await this.rjs('gravador.amostra()');
    await this.rjs(`gravador.dissolver(${rot.dissolver || 420})`);
    await wait(100);
    const res = await this.rjs('gravador.parar()');
    const bruto = Buffer.from(res.base64, 'base64');
    const buf = webm.withDuration(bruto);
    const file = path.join(saida, `${rot.dica}-${tema}.webm`);
    fs.writeFileSync(file, buf);
    const inf = webm.info(buf);
    // diferença média e máxima (0–255) entre as miniaturas: início × fim (tem que dar ~0: o loop
    // não pula) e início × resultado da ação (tem que dar > 0: a comparação enxerga mudança)
    const dif = (a, b) => {
      let soma = 0;
      let max = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        soma += d;
        max = Math.max(max, d);
      }
      return { media: +(soma / a.length).toFixed(2), max };
    };
    return { dica: rot.dica, tema, arquivo: path.relative(ROOT, file).replace(/\\/g, '/'), bytes: buf.length, ms: inf.duracaoMs, quadros: inf.quadros, tamanho: `${inf.largura}x${inf.altura}`, codec: inf.codec, loop: dif(antes, depois), acao: dif(antes, acao) };
  }

  // ---------- cenas: remonta a partir da montagem (Iniciantes + lote da ponte) ----------
  async ponte(cmd, argsCmd) {
    const info = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'ponte.json'), 'utf8'));
    const body = JSON.stringify({ cmd, args: argsCmd });
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: info.porta, method: 'POST', path: '/comando', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Forgia-Token': info.token } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  async montarCena(file) {
    const cena = JSON.parse(fs.readFileSync(file, 'utf8'));
    const m = cena.montagem;
    if (!m) return null;
    const objetos = (m.iniciantes || []).map((nome) => JSON.parse(fs.readFileSync(path.join(INICIANTES, nome + '.json'), 'utf8')).projeto.objects[0]);
    await this.js(`(() => { const e = forgia.editor; e.loadProject(null, { view: false }); e.change(() => e.objects.push(...${JSON.stringify(objetos)})); return true; })()`);
    if (m.comandos && m.comandos.length) {
      const r = await this.ponte('lote', { comandos: m.comandos });
      if (!r.ok) throw new Error(`${path.basename(file)}: ${JSON.stringify(r).slice(0, 600)}`);
    }
    const objects = await this.js('JSON.parse(JSON.stringify(forgia.editor.objects))');
    cena.projeto = { name: cena.nome || path.basename(file, '.json'), grid: 1, workplane: { w: 255, l: 255, h: 255 }, objects };
    fs.writeFileSync(file, pretty(cena) + '\n');
    return objects.length;
  }

  fechar() {
    for (const w of [this.rec, this.win]) if (w && !w.isDestroyed()) w.destroy();
  }
}

async function main() {
  const s = new Sessao();
  let code = 0;
  try {
    await s.abrir();
    if (args.cenas) {
      const only = typeof args.cenas === 'string' ? new Set(args.cenas.split(',')) : null;
      for (const f of fs.readdirSync(CENAS).filter((f) => f.endsWith('.json'))) {
        if (only && !only.has(path.basename(f, '.json'))) continue;
        const n = await s.montarCena(path.join(CENAS, f));
        log('cena', f, n == null ? '(sem montagem)' : `${n} objeto(s) no topo`);
      }
    }
    // --cena=<arquivo>[,<arquivo>]: remonta cenas fora de ajuda/cenas (ex.: docs/media/cenas/*.json)
    if (args.cena) {
      for (const f of String(args.cena).split(',')) {
        const n = await s.montarCena(path.resolve(ROOT, f));
        log('cena', f, n == null ? '(sem montagem)' : `${n} objeto(s) no topo`);
      }
    }
    if (!args['so-cenas']) {
      const pasta = args.roteiros ? path.resolve(ROOT, args.roteiros) : ROTEIROS;
      const only = args.dicas ? new Set(String(args.dicas).split(',')) : null;
      const temas = args.temas ? String(args.temas).split(',') : TEMAS;
      const saida = path.resolve(ROOT, args.saida || path.join('public', 'ajuda'));
      const fotos = args.fotos ? path.resolve(ROOT, args.fotos) : null;
      fs.mkdirSync(saida, { recursive: true });
      if (fotos) fs.mkdirSync(fotos, { recursive: true });
      const lista = fs
        .readdirSync(pasta)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf8')))
        .filter((r) => !only || only.has(r.dica));
      const resumo = [];
      for (const rot of lista) {
        for (const tema of temas) {
          const r = await s.gravar(rot, tema, saida, fotos);
          if (r.previa) continue;
          resumo.push(r);
          log(`${r.arquivo}: ${(r.bytes / 1024).toFixed(0)} KB, ${(r.ms / 1000).toFixed(2)} s, ${r.quadros} quadros, ${r.tamanho} ${r.codec}, início×fim ${r.loop.media}/${r.loop.max}, início×ação ${r.acao.media}/${r.acao.max}`);
        }
      }
      const total = resumo.reduce((a, r) => a + r.bytes, 0);
      log(`total: ${resumo.length} vídeo(s), ${(total / 1024).toFixed(0)} KB`);
      if (args.resumo) fs.writeFileSync(path.resolve(ROOT, args.resumo), JSON.stringify({ gravadoEm: new Date().toISOString(), total, videos: resumo }, null, 2) + '\n');
    }
  } catch (err) {
    console.error('[gravar] erro:', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    s.fechar();
    app.exit(code);
  }
}

app.whenReady().then(main);
