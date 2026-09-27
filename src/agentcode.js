import { t } from './textos/index.js';
import { state } from './ponte-comandos.js';
import { capture } from './captura.js';

// Lado da página da integração com o Agent Code. Tudo passa por window.forgiaAgentCode
// (electron/preload.cjs -> electron/agentcode.cjs): a página não fala com o Agent Code, não vê
// porta, URL nem token, e manda o TEXTO do pedido mais o contexto (estado do projeto e imagem da
// vista, contexto()); as instruções do Forgia, o manual e o servidor MCP são montados no main.
// - estado: { estado: ausente|login|indisponivel|pronto|integrado|desligado, versao, integrado }
// - pedir(texto, { rotulo }): uma tarefa por vez; acompanha a cada 1,5 s até concluida/erro/
//   cancelada. Uma falha passageira na consulta não encerra a tarefa (o agente continua rodando):
//   só depois de MAX_FALHAS seguidas, ou se o Agent Code recusar o Forgia.
// - conversaId: por projeto aberto, só em memória. Novo projeto ou abrir outro (evento 'projeto'
//   do editor) começa conversa nova e CANCELA a tarefa em andamento: ela mexeria no projeto novo.
// Eventos: 'estado' (detail = estado) e 'tarefa' (detail = tarefa atual ou null).

const POLL_MS = 1500;
const MAX_FALHAS = 6; // ~9 s sem resposta seguida antes de desistir de acompanhar
export const FINAL = new Set(['concluida', 'erro', 'cancelada']);
// falha do próprio IPC (main sem a integração, janela recarregando) vira um erro comum, sem travar
const call = (p) => Promise.resolve(p).catch(() => ({ ok: false, tipo: 'rede' }));

export class AgentCode extends EventTarget {
  constructor(editor) {
    super();
    this.ed = editor;
    this.api = window.forgiaAgentCode || null; // sem Electron (npm run dev): sem integração
    this.estado = null;
    this.conversaId = null;
    // { texto (o que aparece no painel), id, status, resposta, erro, nota, cancelando, falhas }
    this.tarefa = null;
    editor.addEventListener('projeto', () => {
      this.conversaId = null;
      if (this.ocupado) this.cancelar(t.agentcode.canceladoProjeto);
    });
    if (this.api) this.refresh();
  }

  get available() {
    return !!this.api;
  }

  // a integração ligada (em Conectar IA); vale mesmo com o Agent Code fechado agora
  get integrado() {
    return !!(this.estado && this.estado.integrado);
  }

  get ocupado() {
    return !!(this.tarefa && !FINAL.has(this.tarefa.status));
  }

  setEstado(r) {
    this.estado = r && r.ok ? r : { estado: 'ausente', integrado: this.integrado, versao: null, erro: r ? mensagem(r) : null };
    this.dispatchEvent(new CustomEvent('estado', { detail: this.estado }));
    return this.estado;
  }

  async refresh() {
    if (!this.api) return null;
    return this.setEstado(await call(this.api.estado()));
  }

  async integrar() {
    if (!this.api) return null;
    return this.setEstado(await call(this.api.integrar()));
  }

  async desligar() {
    if (!this.api) return null;
    return this.setEstado(await call(this.api.desligar()));
  }

  emitTarefa() {
    this.dispatchEvent(new CustomEvent('tarefa', { detail: this.tarefa }));
  }

  // true se o pedido saiu; false se não (ocupado, vazio ou erro, que fica na tarefa).
  // rotulo: o que a conversa mostra (ex.: só o que o usuário escreveu no Marcar parte);
  // marca: o número da marcação de onde o pedido saiu (Marcar parte), ou null
  // detalhe: o que a conversa mostra ao expandir o pedido (a referência da parte marcada)
  async pedir(texto, { rotulo, marca = null, detalhe = null } = {}) {
    const pedido = String(texto || '').trim();
    if (!this.api || !pedido || this.ocupado) return false;
    const task = (this.tarefa = { texto: String(rotulo || pedido).trim(), marca, detalhe, id: null, status: 'enviando', resposta: null, erro: null, nota: null, falhas: 0 });
    this.emitTarefa();
    const r = await call(this.api.enviar(pedido, this.conversaId, this.contexto()));
    if (this.tarefa !== task) return false;
    if (!r || !r.ok) {
      this.fail(r);
      if (r && ['ausente', 'login', 'indisponivel'].includes(r.tipo)) this.refresh();
      return false;
    }
    // conversa_id vale para o projeto em que o pedido foi feito; trocado no meio, não reaproveita
    if (r.conversa_id && !task.cancelarPor) this.conversaId = r.conversa_id;
    Object.assign(task, { id: r.tarefa_id, status: 'na_fila' });
    this.emitTarefa();
    // o projeto mudou enquanto o pedido ia: cancela assim que houver tarefa para cancelar
    if (task.cancelarPor) this.cancelar(task.cancelarPor);
    this.poll(task);
    return true;
  }

  // o que vai junto com o pedido, para o agente começar sem consultar: o mesmo retorno do
  // forgia_estado (peças, medidas, marcações) e a imagem da vista atual com os alfinetes. Falhou
  // um dos dois: vai sem ele (o agente consulta pelas ferramentas)
  contexto() {
    const ed = this.ed;
    const out = {};
    try {
      out.estado = state(ed);
    } catch (err) {
      console.warn('[agentcode] estado', err);
    }
    try {
      const W = ed.renderer.domElement.clientWidth || 800;
      const H = ed.renderer.domElement.clientHeight || 600;
      const k = Math.min(1, 1280 / Math.max(W, H));
      out.imagem = capture(ed, { vista: 'atual', largura: Math.round(W * k), altura: Math.round(H * k), marcacoes: true }).imagem;
    } catch (err) {
      console.warn('[agentcode] imagem', err);
    }
    return out;
  }

  fail(r) {
    Object.assign(this.tarefa, { status: 'erro', erro: mensagem(r), nota: null });
    this.emitTarefa();
  }

  poll(task) {
    setTimeout(async () => {
      if (this.tarefa !== task || FINAL.has(task.status)) return;
      const r = await call(this.api.tarefa(task.id));
      if (this.tarefa !== task) return;
      if (!r || !r.ok) {
        // falha passageira: o agente pode estar rodando; segue acompanhando
        task.falhas++;
        if ((r && r.tipo === 'recusado') || task.falhas >= MAX_FALHAS) return this.fail(r);
        task.nota = t.agentcode.semResposta;
        this.emitTarefa();
        return this.poll(task);
      }
      // cancelada: mostra o motivo, se houver; senão tira o "sem resposta" de antes
      const nota = r.status === 'cancelada' ? task.notaCancelamento || null : null;
      Object.assign(task, { status: r.status || 'rodando', resposta: r.resposta, erro: r.erro, falhas: 0, nota });
      this.emitTarefa();
      if (!FINAL.has(task.status)) this.poll(task);
    }, POLL_MS);
  }

  // nota: por que cancelou (ex.: outro projeto aberto), mostrada quando a tarefa termina cancelada
  async cancelar(nota = null) {
    const task = this.tarefa;
    if (!task || FINAL.has(task.status)) return;
    if (nota) task.notaCancelamento = nota;
    if (!task.id) {
      task.cancelarPor = nota || true; // ainda enviando: cancela quando o Agent Code devolver a tarefa
      return;
    }
    task.cancelando = true;
    this.emitTarefa();
    const r = await call(this.api.cancelar(task.id));
    if (this.tarefa !== task) return;
    if (!r || !r.ok) {
      // não cancelou agora: a tarefa continua; o usuário pode tentar de novo
      Object.assign(task, { cancelando: false, nota: t.agentcode.naoCancelou });
      this.emitTarefa();
    }
    // o acompanhamento segue até o Agent Code dizer "cancelada"
  }

  // tira o painel da tarefa terminada
  fechar() {
    if (this.ocupado) return;
    this.tarefa = null;
    this.emitTarefa();
  }
}

// resposta da IA em uma frase curta (balão do alfinete): sem markdown nem blocos de código, a
// primeira frase se couber, senão cortada numa palavra com "…"
export function resumo(texto, max = 140) {
  let s = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const frase = /^.+?[.!?](?=\s|$)/.exec(s);
  if (frase && frase[0].length <= max) return frase[0];
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '…';
}

// texto para o usuário de um { ok: false, tipo, erro } do main
export function mensagem(r) {
  const e = t.agentcode.erros;
  if (!r) return e.rede;
  if (r.tipo === 'erro') return e.erro(r.erro);
  return e[r.tipo] || e.rede;
}
