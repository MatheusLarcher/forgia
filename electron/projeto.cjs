'use strict';
// Projeto em arquivo no processo main (cola com o Electron). Veja docs/arquitetura.md, "Projeto em
// arquivo". O renderer NUNCA manda caminho para gravar: ele manda os bytes e o main decide onde.
//
// - .forgia: salvar/abrir só por diálogo do Electron (showSaveDialog/showOpenDialog), pelos Recentes
//   (lista guardada aqui, em <userData>\recentes.json) ou pelo arquivo que o Windows mandou abrir
//   (duplo clique, associação de arquivo). A mesma lista (até 50) é o histórico da tela inicial:
//   miniatura de cada um em <userData>\miniaturas\<sha1 do caminho>.png e renomear por lá. O caminho do arquivo aberto fica aqui (atual); Ctrl+S
//   grava nele. Abrir devolve os bytes com um id; o arquivo só vira o atual quando a página
//   confirma que leu (adotar), para um arquivo estragado nunca ser sobrescrito por engano.
// - Cópia de segurança: <userData>\recuperacao\ (%APPDATA%\Forgia\recuperacao no instalado), pasta
//   fixa: projeto.json (projeto + nome, arquivo, sujo, data) e malhas\<ref>.bin, gravados a cada
//   alteração (a página agrupa em ~0,4 s). Aguenta malhas grandes, fora do localStorage.
// - Fechar a janela com o projeto aberto: o main pergunta à página (que pode mostrar Salvar / Não
//   salvar / Cancelar) e só fecha quando ela libera. Sem resposta em 2 s (página travada), fecha.
const { app, ipcMain, dialog } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PROJETO = 1024 * 1024 * 1024; // 1 GB
const MAX_RECENTES = 50; // histórico da tela inicial; o menu Arquivo mostra os 5 primeiros
const MENU_RECENTES = 5;
const MAX_MINIATURA = 2 * 1024 * 1024;
const REF_OK = /^[A-Za-z0-9_-]{1,40}$/;
const EXT = '.forgia';

// caminho de um .forgia na linha de comando (duplo clique no arquivo), se houver
function fileFromArgv(argv) {
  for (let i = (argv || []).length - 1; i >= 1; i--) {
    const a = argv[i];
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    if (path.extname(a).toLowerCase() === EXT && path.isAbsolute(a) && fs.existsSync(a)) return a;
  }
  return null;
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const isPng = (b) => b && b.length > 8 && b.length <= MAX_MINIATURA && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isZip = (b) => b && b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const toBuffer = (d) => (d instanceof Uint8Array ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : null);

function startProject(win, { arquivoInicial = null } = {}) {
  const wc = win.webContents;
  const fromWindow = (e) => e.sender === wc;
  const dados = app.getPath('userData');
  const pastaCopia = path.join(dados, 'recuperacao');
  const arqCopia = path.join(pastaCopia, 'projeto.json');
  const pastaMalhas = path.join(pastaCopia, 'malhas');
  const arqRecentes = path.join(dados, 'recentes.json');
  const pastaMiniaturas = path.join(dados, 'miniaturas');

  let atual = null; // caminho do .forgia aberto (null = projeto ainda não salvo em arquivo)
  let seq = 0;
  const pendentes = new Map(); // id -> caminho lido mas ainda não adotado pela página
  let inicial = arquivoInicial;

  // ---------- recentes ----------
  const lerRecentes = () => {
    try {
      const r = JSON.parse(fs.readFileSync(arqRecentes, 'utf8'));
      return Array.isArray(r) ? r.filter((p) => typeof p === 'string' && path.isAbsolute(p)).slice(0, MAX_RECENTES) : [];
    } catch {
      return [];
    }
  };
  const gravarRecentes = (lista) => {
    try {
      writeAtomic(arqRecentes, JSON.stringify(lista.slice(0, MAX_RECENTES), null, 2));
    } catch (err) {
      console.warn('[projeto] recentes não gravados:', err.message);
    }
  };
  const lembrar = (p) => gravarRecentes([p, ...lerRecentes().filter((q) => q.toLowerCase() !== p.toLowerCase())]);
  const esquecer = (p) => gravarRecentes(lerRecentes().filter((q) => q.toLowerCase() !== p.toLowerCase()));
  const recentes = () => lerRecentes().map((p) => ({ nome: path.basename(p), caminho: p, existe: fs.existsSync(p) }));
  const mesmo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  // item i do histórico, só se ainda é o caminho que a página viu (a lista pode ter mudado)
  const doHistorico = (i, caminho) => {
    const p = Number.isInteger(i) ? lerRecentes()[i] : null;
    return p && mesmo(p, caminho) ? p : null;
  };

  // ---------- miniaturas do histórico ----------
  const arqMiniatura = (p) => path.join(pastaMiniaturas, crypto.createHash('sha1').update(p.toLowerCase()).digest('hex') + '.png');
  const gravarMiniatura = (p, png) => {
    const buf = toBuffer(png);
    if (!p || !isPng(buf)) return;
    try {
      writeAtomic(arqMiniatura(p), buf);
    } catch (err) {
      console.warn('[projeto] miniatura não gravada:', err.message);
    }
  };
  const lerMiniatura = (p) => {
    try {
      return 'data:image/png;base64,' + fs.readFileSync(arqMiniatura(p)).toString('base64');
    } catch {
      return null;
    }
  };
  const historico = () =>
    lerRecentes().map((p) => {
      let st = null;
      try {
        st = fs.statSync(p);
      } catch {}
      const existe = !!(st && st.isFile());
      return { nome: path.basename(p), caminho: p, existe, alteradoEm: existe ? st.mtime.toISOString() : null, miniatura: existe ? lerMiniatura(p) : null };
    });
  const descreve = () => (atual ? { nome: path.basename(atual), caminho: atual } : null);

  // ---------- ler um .forgia (vira pendente até a página adotar) ----------
  function ler(p) {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return { ok: false, erro: 'naoEncontrado', nome: path.basename(p), caminho: p };
    }
    if (!st.isFile()) return { ok: false, erro: 'naoEncontrado', nome: path.basename(p), caminho: p };
    if (st.size > MAX_PROJETO) return { ok: false, erro: 'grande', nome: path.basename(p), caminho: p };
    const id = ++seq;
    pendentes.set(id, p);
    return { ok: true, id, nome: path.basename(p), caminho: p, dados: new Uint8Array(fs.readFileSync(p)) };
  }

  // ---------- cópia de segurança ----------
  function lerCopia() {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(arqCopia, 'utf8'));
    } catch {
      return null;
    }
    if (!meta || meta.formato !== 'forgia.recuperacao') return null;
    const malhas = {};
    if (meta.projeto) {
      let nomes = [];
      try {
        nomes = fs.readdirSync(pastaMalhas);
      } catch {}
      for (const f of nomes) {
        const ref = f.replace(/\.bin$/, '');
        if (!f.endsWith('.bin') || !REF_OK.test(ref)) continue;
        try {
          malhas[ref] = new Uint8Array(fs.readFileSync(path.join(pastaMalhas, f)));
        } catch {}
      }
    }
    const arquivo = typeof meta.arquivo === 'string' && path.isAbsolute(meta.arquivo) ? meta.arquivo : null;
    return { meta: { nome: meta.nome || '', arquivo: arquivo ? { nome: path.basename(arquivo), caminho: arquivo } : null, sujo: !!meta.sujo, alteradoEm: meta.alteradoEm || null, recarregar: !!meta.recarregar }, projeto: meta.projeto || null, malhas };
  }

  function gravarCopia({ projeto, nome, sujo, malhas, refs }) {
    let obj;
    try {
      obj = JSON.parse(projeto);
    } catch {
      return { ok: false, erro: 'projeto inválido' };
    }
    fs.mkdirSync(pastaMalhas, { recursive: true });
    for (const [ref, bytes] of Object.entries(malhas || {})) {
      const buf = toBuffer(bytes);
      if (!REF_OK.test(ref) || !buf) continue;
      const f = path.join(pastaMalhas, ref + '.bin');
      if (!fs.existsSync(f)) writeAtomic(f, buf);
    }
    const keep = new Set((refs || []).filter((r) => typeof r === 'string' && REF_OK.test(r)));
    let presentes = [];
    try {
      presentes = fs.readdirSync(pastaMalhas).filter((f) => f.endsWith('.bin'));
    } catch {}
    for (const f of presentes) if (!keep.has(f.replace(/\.bin$/, ''))) fs.rmSync(path.join(pastaMalhas, f), { force: true });
    writeAtomic(arqCopia, JSON.stringify({ formato: 'forgia.recuperacao', versao: 1, nome: String(nome || ''), arquivo: atual, sujo: !!sujo, alteradoEm: new Date().toISOString(), projeto: obj }));
    return { ok: true, refs: [...keep].filter((r) => fs.existsSync(path.join(pastaMalhas, r + '.bin'))) };
  }

  // "Não salvar" num projeto com arquivo: na próxima abertura vale o arquivo como foi salvo
  function descartarCopia() {
    fs.rmSync(pastaMalhas, { recursive: true, force: true });
    writeAtomic(arqCopia, JSON.stringify({ formato: 'forgia.recuperacao', versao: 1, arquivo: atual, sujo: false, recarregar: !!atual, alteradoEm: new Date().toISOString(), projeto: null }));
  }

  // ---------- IPC (só da própria janela) ----------
  ipcMain.handle('projeto:inicio', (e) => {
    if (!fromWindow(e)) return null;
    const copia = lerCopia();
    atual = copia && copia.meta.arquivo ? copia.meta.arquivo.caminho : null;
    const abrir = inicial ? ler(inicial) : null;
    inicial = null;
    return { copia, abrir, recentes: recentes() };
  });

  ipcMain.handle('projeto:salvar', async (e, bytes, opts = {}) => {
    if (!fromWindow(e)) return null;
    const buf = toBuffer(bytes);
    if (!buf || !isZip(buf)) return { ok: false, erro: 'dados' };
    let destino = opts.como || !atual ? null : atual;
    if (!destino) {
      const sug = String(opts.sugestao || 'projeto').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 120) || 'projeto';
      const base = atual ? path.dirname(atual) : app.getPath('documents');
      const r = await dialog.showSaveDialog(win, {
        title: String(opts.titulo || ''),
        defaultPath: path.join(base, sug.endsWith(EXT) ? sug : sug + EXT),
        filters: [{ name: String(opts.filtro || 'Forgia'), extensions: ['forgia'] }],
        properties: ['showOverwriteConfirmation'],
      });
      if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
      destino = path.extname(r.filePath).toLowerCase() === EXT ? r.filePath : r.filePath + EXT;
    }
    try {
      writeAtomic(destino, buf);
    } catch (err) {
      return { ok: false, erro: 'gravar', detalhe: err.message, nome: path.basename(destino) };
    }
    atual = destino;
    lembrar(destino);
    gravarMiniatura(destino, opts.miniatura);
    return { ok: true, ...descreve(), bytes: buf.length };
  });

  ipcMain.handle('projeto:abrir', async (e, opts = {}) => {
    if (!fromWindow(e)) return null;
    let p = null;
    if (Number.isInteger(opts.recente)) {
      p = opts.caminho ? doHistorico(opts.recente, opts.caminho) : lerRecentes()[opts.recente] || null;
      if (!p) return { ok: false, erro: 'naoEncontrado' };
    } else if (opts.reabrir) {
      if (!atual) return { ok: false, erro: 'naoEncontrado' };
      p = atual;
    } else {
      const r = await dialog.showOpenDialog(win, {
        title: String(opts.titulo || ''),
        defaultPath: atual ? path.dirname(atual) : app.getPath('documents'),
        filters: [{ name: String(opts.filtro || 'Forgia'), extensions: ['forgia'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, cancelado: true };
      p = r.filePaths[0];
    }
    const res = ler(p);
    if (!res.ok && res.erro === 'naoEncontrado' && Number.isInteger(opts.recente)) esquecer(p);
    return res;
  });

  // a página leu o arquivo pendente: ele vira o atual e entra nos Recentes
  // miniatura = a miniatura.png de dentro do .forgia (para o histórico), se houver
  ipcMain.handle('projeto:adotar', (e, id, miniatura) => {
    if (!fromWindow(e)) return null;
    const p = pendentes.get(id);
    pendentes.clear();
    if (!p) return { ok: false };
    atual = p;
    lembrar(p);
    gravarMiniatura(p, miniatura);
    return { ok: true, ...descreve() };
  });
  ipcMain.handle('projeto:recusar', (e, id) => {
    if (!fromWindow(e)) return null;
    pendentes.delete(id);
    return { ok: true };
  });

  ipcMain.handle('projeto:novo', (e) => {
    if (!fromWindow(e)) return null;
    atual = null;
    return { ok: true };
  });
  ipcMain.handle('projeto:recentes', (e) => (fromWindow(e) ? recentes().slice(0, MENU_RECENTES) : null));
  ipcMain.handle('projeto:historico', (e) => (fromWindow(e) ? historico() : null));

  // renomeia o .forgia do item i do histórico, na mesma pasta (o nome vem da página; a pasta, nunca)
  ipcMain.handle('projeto:renomear', (e, i, caminho, nome) => {
    if (!fromWindow(e)) return null;
    const p = doHistorico(i, caminho);
    if (!p) return { ok: false, erro: 'naoEncontrado' };
    let base = String(nome || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120);
    if (base.toLowerCase().endsWith(EXT)) base = base.slice(0, -EXT.length).trim();
    if (!base) return { ok: false, erro: 'nomeVazio' };
    const destino = path.join(path.dirname(p), base + EXT);
    if (destino === p) return { ok: true, nome: path.basename(p), caminho: p, atual: mesmo(atual, p) };
    // só muda maiúscula/minúscula: no Windows é o mesmo arquivo, renomeia direto
    if (!mesmo(destino, p) && fs.existsSync(destino)) return { ok: false, erro: 'nomeExiste', nome: path.basename(destino) };
    try {
      fs.renameSync(p, destino);
    } catch (err) {
      return { ok: false, erro: fs.existsSync(p) ? 'renomear' : 'naoEncontrado', detalhe: err.message };
    }
    try {
      fs.renameSync(arqMiniatura(p), arqMiniatura(destino));
    } catch {}
    gravarRecentes(lerRecentes().map((q) => (mesmo(q, p) ? destino : q)));
    const eraAtual = mesmo(atual, p);
    if (eraAtual) atual = destino;
    return { ok: true, nome: path.basename(destino), caminho: destino, atual: eraAtual };
  });
  ipcMain.handle('projeto:copia', (e, msg) => {
    if (!fromWindow(e) || !msg) return null;
    try {
      return gravarCopia(msg);
    } catch (err) {
      console.warn('[projeto] cópia de segurança falhou:', err.message);
      return { ok: false, erro: err.message };
    }
  });
  ipcMain.handle('projeto:descartar', (e) => {
    if (!fromWindow(e)) return null;
    try {
      descartarCopia();
    } catch (err) {
      return { ok: false, erro: err.message };
    }
    return { ok: true };
  });

  // ---------- Suas criações (biblioteca): <userData>\criacoes\<id>.forgia + indice.json ----------
  // Pasta fixa; a página manda os bytes (um .forgia com a peça) e o nome, nunca um caminho.
  const pastaCriacoes = path.join(dados, 'criacoes');
  const arqIndice = path.join(pastaCriacoes, 'indice.json');
  const ID_OK = /^[a-z0-9-]{1,40}$/;
  const lerIndice = () => {
    try {
      const r = JSON.parse(fs.readFileSync(arqIndice, 'utf8'));
      return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
    } catch {
      return {};
    }
  };
  const gravarIndice = (idx) => writeAtomic(arqIndice, JSON.stringify(idx, null, 2));
  const nomeLimpo = (n) => String(n || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 80);

  ipcMain.handle('criacoes:listar', (e) => {
    if (!fromWindow(e)) return null;
    const idx = lerIndice();
    const out = [];
    for (const [id, info] of Object.entries(idx)) {
      if (!ID_OK.test(id)) continue;
      try {
        out.push({ id, nome: info.nome, criadaEm: info.criadaEm, dados: new Uint8Array(fs.readFileSync(path.join(pastaCriacoes, id + EXT))) });
      } catch {
        /* arquivo sumiu: some da lista */
      }
    }
    return out.sort((a, b) => String(a.criadaEm).localeCompare(String(b.criadaEm)));
  });
  ipcMain.handle('criacoes:salvar', (e, bytes, nome) => {
    if (!fromWindow(e)) return null;
    const buf = toBuffer(bytes);
    if (!buf || !isZip(buf) || buf.length > MAX_PROJETO) return { ok: false };
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    writeAtomic(path.join(pastaCriacoes, id + EXT), buf);
    const idx = lerIndice();
    idx[id] = { nome: nomeLimpo(nome) || id, criadaEm: new Date().toISOString() };
    gravarIndice(idx);
    return { ok: true, id };
  });
  ipcMain.handle('criacoes:renomear', (e, id, nome) => {
    if (!fromWindow(e) || !ID_OK.test(String(id))) return null;
    const idx = lerIndice();
    if (!idx[id] || !nomeLimpo(nome)) return { ok: false };
    idx[id].nome = nomeLimpo(nome);
    gravarIndice(idx);
    return { ok: true };
  });
  ipcMain.handle('criacoes:excluir', (e, id) => {
    if (!fromWindow(e) || !ID_OK.test(String(id))) return null;
    const idx = lerIndice();
    delete idx[id];
    gravarIndice(idx);
    fs.rmSync(path.join(pastaCriacoes, id + EXT), { force: true });
    return { ok: true };
  });

  // ---------- fechar ----------
  let pronto = false; // a página cuida do fechar (registrou o aoFechar)
  let liberado = false;
  let perguntando = false;
  let semResposta = null;
  ipcMain.handle('projeto:pronto', (e) => {
    if (!fromWindow(e)) return null;
    pronto = true;
    return true;
  });
  const liberar = () => {
    liberado = true;
    clearTimeout(semResposta);
    if (!win.isDestroyed()) win.close();
  };
  win.on('close', (e) => {
    if (liberado || !pronto || wc.isDestroyed() || wc.isCrashed()) return;
    e.preventDefault();
    if (perguntando) return;
    perguntando = true;
    wc.send('projeto:fechar');
    semResposta = setTimeout(liberar, 2000); // página travada: fecha mesmo assim
  });
  ipcMain.handle('projeto:fechando', (e) => {
    if (fromWindow(e)) clearTimeout(semResposta);
    return true;
  });
  ipcMain.handle('projeto:fechar', (e, ok) => {
    if (!fromWindow(e)) return null;
    perguntando = false;
    if (ok) liberar();
    return true;
  });
  wc.on('render-process-gone', () => {
    pronto = false;
  });
  wc.on('did-start-loading', () => {
    pronto = false;
    perguntando = false;
  });

  // o Windows mandou abrir um .forgia com o Forgia já aberto (segunda instância)
  return {
    abrirDoSistema(p) {
      if (wc.isDestroyed()) return;
      const res = ler(p);
      wc.send('projeto:abrirArquivo', res);
    },
  };
}

module.exports = { startProject, fileFromArgv };
