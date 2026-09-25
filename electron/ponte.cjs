'use strict';
// Ponte local Forgia ↔ IA no processo main (cola com o Electron). Veja docs/arquitetura.md, "Ponte da IA".
//
// - Sobe o servidor HTTP de ponte-servidor.cjs em 127.0.0.1 (47821 ou uma porta livre) e grava
//   { porta, token, pid, versao } em <userData>/ponte.json (%APPDATA%\Forgia no instalado). O token
//   é novo a cada abertura; ao fechar, o arquivo é apagado (se ainda for o desta execução).
// - Cada pedido vai ao renderer pelo IPC ('ponte:pedido') e volta por 'ponte:resposta'. O renderer
//   não ganha acesso a disco: importar, exportar_stl e exportar_3mf leem/gravam aqui, só no caminho
//   que o agente (dono do token) mandou, e só .stl/.obj/.3mf (gravação: .stl ou .3mf, conforme o
//   comando).
// - O renderer diz aqui se a IA e o código livre estão permitidos (Configurações), e até ele dizer,
//   a ponte responde "abrindo".
// - A sessão do navegador fica sem rede (http/https/ws cancelados): o Forgia é offline e o código
//   livre da IA, que roda num Worker do renderer, não alcança nada fora do programa.
const { app, ipcMain, clipboard, nativeImage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBridgeServer, newToken, DEFAULT_PORT } = require('./ponte-servidor.cjs');

const MODEL_EXT = new Set(['.stl', '.obj', '.3mf']);
const MAX_MODEL = 200 * 1024 * 1024;
const TIMEOUTS = { importar: 90000, exportar_stl: 90000, exportar_3mf: 90000, executar_codigo: 30000, lote: 60000 };
// comandos que gravam arquivo: extensão exigida e campo da resposta do renderer com os bytes
const EXPORTS = { exportar_stl: { ext: '.stl', campo: 'stl' }, exportar_3mf: { ext: '.3mf', campo: 'tresmf' } };

function startBridge(win) {
  const log = (...a) => console.log('[ponte]', ...a);
  const token = newToken();
  const config = { permitir: true, codigo: true, pronto: false };
  const pending = new Map();
  let seq = 0;
  let info = { porta: null, erro: null };
  const file = path.join(app.getPath('userData'), 'ponte.json');

  // sem rede no renderer (páginas, workers): o Forgia só carrega arquivos locais
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));

  const wc = win.webContents;
  const fromWindow = (e) => e.sender === wc;

  // renderer recarregou/fechou: nada pendente fica esperando, e só volta a atender quando se configurar
  const resetRenderer = () => {
    config.pronto = false;
    for (const [, p] of pending) p.resolve({ ok: false, status: 503, erro: 'O Forgia recarregou a janela. Tente de novo.' });
    pending.clear();
  };
  wc.on('did-start-loading', resetRenderer);
  wc.on('render-process-gone', resetRenderer);

  function toRenderer(cmd, args, arquivos) {
    if (wc.isDestroyed()) return Promise.resolve({ ok: false, status: 503, erro: 'A janela do Forgia fechou.' });
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, status: 504, erro: `O Forgia não respondeu a tempo (${cmd}).` });
      }, TIMEOUTS[cmd] || 30000);
      pending.set(id, { resolve: (r) => (clearTimeout(timer), resolve(r)) });
      wc.send('ponte:pedido', { id, cmd, args, arquivos });
    });
  }

  ipcMain.on('ponte:resposta', (e, id, res) => {
    if (!fromWindow(e)) return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.resolve(res && typeof res === 'object' ? res : { ok: false, erro: 'Resposta inválida do editor.' });
  });

  const describe = () => ({
    porta: info.porta,
    ativa: !!info.porta,
    erro: info.erro,
    exe: app.getPath('exe'),
    script: app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'forgia-mcp.cjs') : path.join(__dirname, 'mcp', 'forgia-mcp.cjs'),
    recursos: process.resourcesPath,
    dados: app.getPath('userData'),
    dadosPadrao: path.join(app.getPath('appData'), 'Forgia'),
    empacotado: app.isPackaged,
    versao: app.getVersion(),
  });

  ipcMain.handle('ponte:config', (e, cfg) => {
    if (!fromWindow(e)) return null;
    config.permitir = !(cfg && cfg.permitir === false);
    config.codigo = !(cfg && cfg.codigo === false);
    config.pronto = true;
    return describe();
  });
  ipcMain.handle('ponte:info', (e) => (fromWindow(e) ? describe() : null));
  // Marcar parte: texto + PNG da vista num item só da área de transferência
  ipcMain.handle('ponte:copiar', (e, data) => {
    if (!fromWindow(e) || !data) return false;
    const item = { text: String(data.texto || '') };
    if (typeof data.png === 'string' && data.png.startsWith('data:image/png;base64,')) item.image = nativeImage.createFromDataURL(data.png);
    clipboard.write(item);
    return true;
  });

  // writeExt: extensão exigida na gravação ('.stl' ou '.3mf'); sem ela, leitura
  const checkModelPath = (p, writeExt = null) => {
    if (typeof p !== 'string' || !p.trim()) return 'Informe "caminho": caminho absoluto do arquivo.';
    if (!path.isAbsolute(p)) return `O caminho precisa ser absoluto (ex.: C:\\\\pasta\\\\peca${writeExt || '.stl'}). Recebido: ${p}`;
    const ext = path.extname(p).toLowerCase();
    if (writeExt ? ext !== writeExt : !MODEL_EXT.has(ext)) return writeExt ? `O arquivo precisa terminar em ${writeExt}.` : 'Formato não suportado: use .stl, .obj ou .3mf.';
    return null;
  };

  function readModel(p) {
    const bad = checkModelPath(p);
    if (bad) return { erro: bad };
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return { erro: `Arquivo não encontrado: ${p}` };
    }
    if (!st.isFile()) return { erro: `Não é um arquivo: ${p}` };
    if (st.size > MAX_MODEL) return { erro: `Arquivo grande demais (${Math.round(st.size / 1048576)} MB; limite 200 MB).` };
    return { nome: path.basename(p), dados: fs.readFileSync(p) };
  }

  async function onCommand(cmd, args) {
    // arquivos lidos aqui e entregues ao renderer por índice do comando (0 = pedido único)
    const arquivos = {};
    const imports = cmd === 'importar' ? [[0, args]] : cmd === 'lote' && Array.isArray(args.comandos) ? args.comandos.map((c, i) => [i, c]).filter(([, c]) => c && String(c.cmd || '').replace(/^forgia_/, '') === 'importar') : [];
    for (const [i, c] of imports) {
      const a = c.args && typeof c.args === 'object' ? c.args : c;
      const r = readModel(a.caminho);
      if (r.erro) return { ok: false, erro: imports.length > 1 || cmd === 'lote' ? `comando ${i + 1} (importar): ${r.erro}` : r.erro };
      arquivos[i] = r;
    }
    let target = null;
    const exp = EXPORTS[cmd];
    if (exp) {
      const bad = checkModelPath(args.caminho, exp.ext);
      if (bad) return { ok: false, erro: bad };
      target = args.caminho;
      if (!fs.existsSync(path.dirname(target))) return { ok: false, erro: `A pasta não existe: ${path.dirname(target)}` };
    }
    const res = await toRenderer(cmd, args, arquivos);
    if (target && res.ok) {
      const data = res[exp.campo];
      delete res[exp.campo];
      if (!data || typeof data.byteLength !== 'number') return { ok: false, erro: 'O editor não devolveu o arquivo.' };
      try {
        fs.writeFileSync(target, Buffer.from(data));
      } catch (err) {
        return { ok: false, erro: `Não foi possível gravar ${target}: ${err.message}` };
      }
      res.caminho = target;
      res.bytes = data.byteLength;
    }
    return res;
  }

  const server = createBridgeServer({ token, onCommand, getConfig: () => config, log });

  function writeInfo() {
    const data = { porta: info.porta, token, pid: process.pid, versao: app.getVersion(), inicio: new Date().toISOString() };
    const tmp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  server
    .listen(DEFAULT_PORT)
    .then((p) => {
      info.porta = p;
      writeInfo();
      log(`ouvindo em 127.0.0.1:${p}; ${file}`);
      if (!wc.isDestroyed()) wc.send('ponte:estado', describe());
    })
    .catch((err) => {
      info.erro = err.message;
      console.warn('[ponte] não subiu:', err.message);
      if (!wc.isDestroyed()) wc.send('ponte:estado', describe());
    });

  // ao sair: apaga o ponte.json se ele ainda for o desta execução (outra instância pode ter gravado)
  app.on('will-quit', () => {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cur.token === token) fs.rmSync(file, { force: true });
    } catch {
      /* já não existe */
    }
    server.close();
  });
}

module.exports = { startBridge };
