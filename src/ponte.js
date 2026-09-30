import { t } from './textos/index.js';
import { capture, VIEW_NAMES } from './captura.js';
import { state, catalog, mutate, applyQueued, medir, stl, tresMF, marksOut, BridgeError, validateProject } from './ponte-comandos.js';

// Lado da página da ponte da IA. Os pedidos chegam do processo main pelo preload
// (window.forgiaPonte, electron/preload.cjs), um de cada vez por ordem de chegada:
//   - comando que altera com o usuário arrastando ou colocando forma: "ocupado" (409), nada muda;
//   - comandos que alteram rodam em editor.batch (src/ponte-comandos.js): um pedido = um desfazer;
//   - depois de alterar: aviso no canto "IA: criou 2, alterou 1 · Desfazer" (~6 s) e o contorno
//     dos objetos afetados pisca (~1,5 s). A seleção do usuário não muda (só "selecionar" muda);
//   - executar_codigo roda num Worker (src/ponte-codigo.js) com limite de 10 s; os comandos que o
//     código enfileirou são aplicados como um lote.
//   - conversa { pedido?, resposta? }: a mensagem escrita direto no agente (forgia_conversa) vira o
//     evento 'conversa', que o chat "Pedir à IA" mostra (src/pedido-ia.js). Não altera o projeto
//     nem vira passo de desfazer.
// Eventos: 'estado', 'aviso' (o aviso do canto) e 'atividade' ({ text }: o mesmo texto do aviso,
// para o chat mostrar o que a IA fez mesmo que ela não chame forgia_conversa).
// Configurações da IA (Permitir IA, Permitir código livre) ficam em localStorage['forgia.ia'] e são
// repassadas ao main, que recusa antes de chegar aqui.

const STORAGE = 'forgia.ia';
const MUTATING = new Set(['criar', 'alterar', 'excluir', 'agrupar', 'desagrupar', 'alinhar', 'espelhar', 'soltar_na_mesa', 'duplicar', 'lote', 'importar', 'criar_encaixe', 'desfazer', 'refazer', 'executar_codigo']);
const CODE_TIMEOUT = 10000;
const CONNECTED_MS = 10 * 60 * 1000; // "IA conectada" até 10 min depois do último pedido
const NOTICE_MS = 6000;
const CONVERSA_MAX = { pedido: 4000, resposta: 20000 }; // os mesmos limites de forgia_conversa

export function loadIaConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    return { permitir: c.permitir !== false, codigo: c.codigo !== false };
  } catch {
    return { permitir: true, codigo: true };
  }
}

export class Ponte extends EventTarget {
  // ready: promessa de que o projeto já chegou (src/arquivo.js); até lá o main responde "abrindo"
  constructor(editor, ready = null) {
    super();
    this.ed = editor;
    this.api = window.forgiaPonte || null; // sem Electron (npm run dev): sem ponte
    this.config = loadIaConfig();
    this.info = null;
    this.last = 0;
    this.queue = Promise.resolve();
    if (!this.api) return;
    this.api.aoPedido((msg) => {
      this.queue = this.queue.then(() => this.handle(msg));
    });
    this.api.aoEstado((info) => this.setInfo(info));
    Promise.resolve(ready).then(() => {
      this.configurar();
      // de tempos em tempos repete: se o main perdeu o "pronto", ele volta sozinho
      setInterval(() => this.configurar(), 30000);
    });
    setInterval(() => this.emitState(), 30000);
  }

  configurar() {
    return this.api.configurar(this.config).then((info) => this.setInfo(info));
  }

  get available() {
    return !!this.api;
  }

  setInfo(info) {
    if (info) this.info = info;
    this.emitState();
  }

  // 'conectada' | 'pronta' | 'desligada' | 'indisponivel'
  get status() {
    if (!this.api || !this.info || this.info.erro) return 'indisponivel';
    if (!this.config.permitir) return 'desligada';
    if (!this.info.porta) return 'indisponivel';
    return Date.now() - this.last < CONNECTED_MS ? 'conectada' : 'pronta';
  }

  emitState() {
    this.dispatchEvent(new CustomEvent('estado', { detail: { status: this.status, info: this.info } }));
  }

  setConfig(patch) {
    this.config = { ...this.config, ...patch };
    try {
      localStorage.setItem(STORAGE, JSON.stringify(this.config));
    } catch {
      /* sem armazenamento: vale até fechar */
    }
    if (this.api) this.configurar();
    else this.emitState();
  }

  async handle({ id, cmd, args, arquivos }) {
    let res;
    try {
      res = await this.run(cmd, args || {}, arquivos || {});
    } catch (err) {
      res = errorOut(err);
    }
    this.last = Date.now();
    this.emitState();
    this.api.responder(id, res);
  }

  async run(cmd, args, files) {
    const ed = this.ed;
    if (!this.config.permitir) return { ok: false, status: 403, erro: 'A IA está desligada no Forgia (Configurações > IA).' };
    if (MUTATING.has(cmd) && (ed.drag || ed.placing)) {
      return { ok: false, ocupado: true, erro: 'Ocupado: o usuário está arrastando ou colocando uma forma no Forgia. Tente de novo em alguns segundos; nada foi alterado.' };
    }
    switch (cmd) {
      case 'estado':
        return state(ed, args);
      case 'formas':
        return { ok: true, tipos: catalog(args.tipo), sistema: 'medidas [X, Y, Z] em mm nos eixos do objeto; Z para cima' };
      case 'marcacoes': {
        // limpar: devolve as marcações que havia e depois apaga
        const marcacoes = marksOut(ed);
        if (args.limpar === true) ed.clearMarks();
        return { ok: true, marcacoes, ...(args.limpar === true ? { limpas: true } : {}) };
      }
      case 'medir':
        return medir(ed, args);
      case 'captura':
        return this.capture(args);
      case 'exportar_stl':
        return stl(ed, args);
      case 'exportar_3mf':
        return tresMF(ed, args);
      case 'desfazer':
      case 'refazer': {
        const before = ed.historyIndex;
        if (cmd === 'desfazer') ed.undo();
        else ed.redo();
        const moved = ed.historyIndex !== before;
        if (moved) this.notify({ text: cmd === 'desfazer' ? t.ia.desfez : t.ia.refez, undo: false });
        return { ok: true, feito: moved, pode_desfazer: ed.historyIndex > 0, pode_refazer: ed.historyIndex < ed.history.length - 1, ...(moved ? {} : { aviso: cmd === 'desfazer' ? 'Nada para desfazer.' : 'Nada para refazer.' }) };
      }
      case 'executar_codigo':
        return this.runCode(args);
      case 'conversa':
        return this.conversa(args);
      default: {
        const res = mutate(ed, cmd, args, files);
        return this.done(res, false);
      }
    }
  }

  // aviso + piscar para o que um pedido mudou; devolve a resposta sem o contexto interno
  done(res, code) {
    const ctx = res._ctx;
    delete res._ctx;
    // no aviso conta o que o usuário vê: peças novas no topo (3 formas agrupadas = criou 1)
    const created = res.criados.filter((id) => this.ed.objects.some((o) => o.id === id)).length;
    const altered = res.alterados.length;
    const deleted = res.excluidos.length;
    if (created || altered || deleted || code) {
      const parts = [];
      if (created) parts.push(t.ia.criou(created));
      if (altered) parts.push(t.ia.alterou(altered));
      if (deleted) parts.push(t.ia.excluiu(deleted));
      const text = code ? t.ia.codigo(parts.join(', ')) : t.ia.aviso(parts.join(', '));
      if (created || altered || deleted) this.notify({ text, undo: true });
      // pisca o que está no topo da cena (a parte de um grupo pisca pelo grupo)
      const tops = new Set();
      for (const id of [...ctx.created, ...ctx.altered]) {
        const top = this.ed.objects.find((o) => o.id === id || (o.children && contains(o, id)));
        if (top) tops.add(top.id);
      }
      if (tops.size) this.ed.flash([...tops]);
    }
    return res;
  }

  notify({ text, undo }) {
    this.dispatchEvent(new CustomEvent('aviso', { detail: { text, undo, index: this.ed.historyIndex, ms: NOTICE_MS } }));
    this.dispatchEvent(new CustomEvent('atividade', { detail: { text } }));
  }

  // forgia_conversa: valida e entrega ao chat. Quem ouve o evento diz se mostrou (detail.ignorado:
  // 'forgia' = o pedido veio do próprio Forgia e já está no chat; 'repetido' = igual ao último)
  conversa(args) {
    const exemplo = { pedido: 'faça uma caixa de 30 mm' };
    const extra = Object.keys(args).filter((k) => k !== 'pedido' && k !== 'resposta');
    if (extra.length) throw new BridgeError(`conversa: parâmetro desconhecido "${extra[0]}". Use só "pedido" e/ou "resposta".`, { validos: ['pedido', 'resposta'], exemplo });
    const campo = (nome, max) => {
      const v = args[nome];
      if (v == null) return null;
      if (typeof v !== 'string') throw new BridgeError(`conversa: "${nome}" precisa ser texto.`, { exemplo });
      const s = v.trim();
      if (!s) throw new BridgeError(`conversa: "${nome}" está vazio.`, { exemplo });
      if (s.length > max) throw new BridgeError(`conversa: "${nome}" passa de ${max} caracteres (tem ${s.length}). Resuma.`, { exemplo });
      return s;
    };
    const pedido = campo('pedido', CONVERSA_MAX.pedido);
    const resposta = campo('resposta', CONVERSA_MAX.resposta);
    if (!pedido && !resposta) {
      throw new BridgeError('conversa precisa de "pedido" (a mensagem do usuário, antes de mexer na peça) ou "resposta" (a sua resposta, no fim).', { exemplo, exemplo_resposta: { resposta: 'Criei uma caixa de 30 × 30 × 10 mm.' } });
    }
    const detail = { pedido, resposta, ignorado: null };
    this.dispatchEvent(new CustomEvent('conversa', { detail }));
    if (detail.ignorado === 'forgia') return { ok: true, chat: 'ignorado', aviso: 'Há um pedido do chat do Forgia em andamento e o chat mostra só ele agora: esta mensagem não entrou. Se o pedido veio do Forgia, ele já está no chat e não precisa de forgia_conversa.' };
    if (detail.ignorado) return { ok: true, chat: 'ignorado', aviso: 'Mensagem igual à anterior: já está no chat.' };
    return { ok: true, chat: 'mostrado' };
  }

  capture(args) {
    const allowed = ['vista', 'ids', 'largura', 'altura', 'marcacoes'];
    for (const k of Object.keys(args)) if (!allowed.includes(k)) throw new BridgeError(`captura: parâmetro desconhecido "${k}".`, { validos: allowed, exemplo: { vista: 'iso', largura: 800, altura: 600 } });
    const vista = args.vista || 'iso';
    if (!VIEW_NAMES.includes(vista)) throw new BridgeError(`vista precisa ser uma de: ${VIEW_NAMES.join(', ')}.`, { exemplo: { vista: 'frente' } });
    const size = (v, d, name) => {
      if (v == null) return d;
      if (!Number.isInteger(v) || v < 64 || v > 1600) throw new BridgeError(`${name} precisa ser um inteiro de 64 a 1600 px.`);
      return v;
    };
    const ids = args.ids == null ? null : (Array.isArray(args.ids) ? args.ids : [args.ids]);
    if (ids) for (const id of ids) if (!this.ed.obj(id)) throw new BridgeError(`captura: objeto ${JSON.stringify(id)} não existe (ou é parte de um grupo: use o id do grupo).`);
    const shot = capture(this.ed, { vista, ids, largura: size(args.largura, 800, 'largura'), altura: size(args.altura, 600, 'altura'), marcacoes: args.marcacoes !== false });
    return { ok: true, ...shot, marcacoes: marksOut(this.ed).length };
  }

  // código livre: Worker com a fachada; o que ele enfileirou vira um lote (um desfazer)
  runCode(args) {
    if (!this.config.codigo) return { ok: false, status: 403, erro: 'O código livre da IA está desligado no Forgia (Configurações > IA). Use os comandos prontos.' };
    const keys = Object.keys(args);
    if (typeof args.codigo !== 'string' || !args.codigo.trim() || keys.some((k) => k !== 'codigo')) {
      throw new BridgeError('executar_codigo precisa só de "codigo": texto com JavaScript que usa forgia.*.', { exemplo: { codigo: "for (let i = 0; i < 12; i++) forgia.criar({ tipo: 'cilindro', medidas: [4, 4, 10], centro: [30 * Math.cos(i * Math.PI / 6), 30 * Math.sin(i * Math.PI / 6), null] });" } });
    }
    const ed = this.ed;
    const input = { codigo: args.codigo, estado: state(ed, { filhos: true }), formas: catalog() };
    return new Promise((resolve) => {
      let worker;
      try {
        worker = new Worker(new URL('./ponte-codigo.js', import.meta.url), { type: 'module' });
      } catch (err) {
        resolve({ ok: false, erro: 'Não foi possível iniciar o código livre: ' + err.message });
        return;
      }
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ ok: false, erro: `Tempo esgotado: o código passou de ${CODE_TIMEOUT / 1000} s e foi interrompido. Nada foi aplicado.` });
      }, CODE_TIMEOUT);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({ ok: false, erro: `Erro no código: ${e.message || 'erro de sintaxe'}. Nada foi aplicado.` });
      };
      worker.onmessage = (e) => {
        clearTimeout(timer);
        worker.terminate();
        const r = e.data || {};
        if (!r.ok) {
          resolve({ ok: false, erro: `Erro no código: ${r.erro}. Nada foi aplicado.`, saida: r.saida });
          return;
        }
        if (ed.drag || ed.placing) {
          resolve({ ok: false, ocupado: true, erro: 'Ocupado: o usuário começou a arrastar ou colocar uma forma. Nada foi aplicado; tente de novo.' });
          return;
        }
        try {
          const res = r.comandos.length ? this.done(applyQueued(ed, r.comandos), true) : { ok: true, criados: [], alterados: [], excluidos: [], objetos: [] };
          res.comandos = r.comandos.length;
          if (r.retorno !== undefined) res.retorno = r.retorno;
          if (r.saida && r.saida.length) res.saida = r.saida;
          resolve(res);
        } catch (err) {
          resolve({ ...errorOut(err), saida: r.saida });
        }
      };
      worker.postMessage(input);
    });
  }
}

function contains(g, id) {
  return g.children.some((c) => c.id === id || (c.children && contains(c, id)));
}

function errorOut(err) {
  if (err instanceof BridgeError) {
    const { message, ...extra } = err;
    return { ok: false, erro: message, ...extra };
  }
  console.error('[ponte]', err);
  return { ok: false, erro: 'Erro inesperado no editor: ' + ((err && err.message) || err) + '. Nada foi aplicado.' };
}

export { validateProject };
