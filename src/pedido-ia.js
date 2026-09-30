import { t } from './textos/index.js';
import { FINAL } from './agentcode.js';
import { ICONS } from './icons.js';

// Pedido à IA escrito no Forgia (integração com o Agent Code, src/agentcode.js):
// - botão "Pedir à IA" na barra de status (index.html, #sb-pedir). Ele abre a conversa, que sobe a
//   partir dele: os pedidos do usuário e as respostas da IA, com o campo para escrever (inclusive
//   peça do zero). No topo da conversa ficam o Marcar parte (clicar numa parte marca onde mudar;
//   a dica animada aparece ao parar o mouse) e o Conectar IA. Sem a integração ligada, a conversa
//   explica e leva ao Conectar IA; o marcador copia o pedido para colar na IA.
// - Ao abrir o Forgia, um convite sai do botão ("peça à IA…"), até o usuário abrir a conversa
//   uma vez (forgia.iaConviteVisto).
// - Clicar fora da conversa fecha ela (e desliga o marcador); clicar numa parte da peça com o
//   marcador ligado põe o alfinete (o mini-chat dele assume e a conversa fecha). Pedidos feitos
//   pelo alfinete também entram na conversa, resumidos (clique expande a referência da parte); o
//   andamento deles aparece no balão do alfinete (src/marcar.js).
// - A conversa é por projeto aberto, como o conversa_id (novo projeto ou abrir outro: começa vazia).
// O que a IA muda chega pela ponte: vira um passo de desfazer e o aviso aparece sozinho.
// Conversa feita direto no agente (o usuário escreveu no Agent Code, no Claude…), pela ponte
// (src/ponte.js):
// - 'conversa' (ferramenta forgia_conversa): o pedido vira um balão "você" marcado "Pelo agente" e
//   um balão da IA em andamento; a resposta conclui esse balão.
// - 'atividade' (o texto do aviso "IA: criou 1"): entra no balão em andamento; sem pedido aberto,
//   vira um balão só de atividade (as seguidas em até JUNTAR_MS se juntam). É a reserva para a
//   conversa se atualizar mesmo que a IA não chame forgia_conversa.
// - Pedido aberto sem resposta por TURNO_MS fecha sozinho, mostrando o que a IA fez.
// - Com um pedido do próprio Forgia em andamento (agentCode.ocupado), os dois são ignorados: a
//   tarefa já mostra; um pedido igual ao último "você" em até REPETIDO_MS também.
// - Com a conversa fechada, uma mensagem dessas acende um ponto no botão (some ao abrir).

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const CONVITE_VISTO = 'forgia.iaConviteVisto';
const TURNO_MS = 3 * 60 * 1000; // pedido do agente sem resposta: fecha sozinho depois disso
const JUNTAR_MS = 60 * 1000; // atividades sem pedido, uma depois da outra: o mesmo balão
const REPETIDO_MS = 10 * 1000;

// o que pode ser clicado sem fechar a conversa (ela, o botão, o alfinete e o mini-chat dele, diálogos)
const DENTRO = '.ia-chat, #sb-pedir, .pin, .marca-chat, .pin-balao, .modal, #modal-root, .toast, .ia-convite';

export class PedidoIA {
  // ponte: src/ponte.js (eventos 'conversa' e 'atividade'); sem ela, só os pedidos daqui
  constructor(editor, agentCode, { onConnect, ponte = null }) {
    this.ed = editor;
    this.ac = agentCode;
    this.onConnect = onConnect;
    // { de: 'voce', texto, marca, detalhe, aberta, em } | { de: 'ia', task }
    // | { de: 'ia', externo: true, pedido (tem balão "você" antes), atividades, resposta, aberto, ultima }
    // (externo = conversa feita direto no agente; em/ultima = Date.now())
    this.msgs = [];
    this.turno = null; // balão externo que ainda recebe atividade/resposta
    this.turnoMs = TURNO_MS;
    this.juntarMs = JUNTAR_MS;
    this.btn = document.getElementById('sb-pedir');
    this.btn.hidden = !agentCode.available;
    this.btnText = this.btn.querySelector('.sb-pedir-rotulo');
    this.btn.addEventListener('click', () => (this.aberta ? this.fechar({ marcador: true }) : this.abrir()));
    this.build();
    agentCode.addEventListener('tarefa', (e) => this.onTask(e.detail));
    agentCode.addEventListener('estado', () => (this.render(), this.renderBtn()));
    // novo projeto ou abrir outro: conversa nova (o agentcode.js já zera o conversa_id e cancela a
    // tarefa em andamento; ela fica na conversa para mostrar que foi cancelada)
    editor.addEventListener('projeto', () => {
      const cur = this.ac.tarefa;
      const keep = cur && !FINAL.has(cur.status) ? this.msgs.findIndex((m) => m.task === cur) : -1;
      this.msgs = keep > 0 ? this.msgs.slice(keep - 1, keep + 1) : [];
      this.fecharTurno();
      this.novidade(false);
      this.render();
    });
    if (ponte) {
      ponte.addEventListener('conversa', (e) => this.onConversa(e.detail));
      ponte.addEventListener('atividade', (e) => this.onAtividade(e.detail));
    }
    // alfinete posto: o mini-chat dele assume
    editor.addEventListener('alfinete', () => this.fechar());
    // o botão do marcador na conversa acompanha a ferramenta (N, Esc, clique fora de uma peça)
    editor.addEventListener('mode', () => this.renderMarker());
    // clique fora da conversa: fecha e desliga o marcador. No 3D, com o marcador ligado, quem
    // decide é ele (numa parte, põe o alfinete; fora, desliga), então aqui só fecha.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.aberta || (e.target.closest && e.target.closest(DENTRO))) return;
        this.fechar({ marcador: e.target !== this.ed.renderer.domElement });
      },
      true,
    );
    this.renderBtn();
    if (agentCode.available) this.convidar();
  }

  get aberta() {
    return !this.panel.hidden;
  }

  build() {
    const tx = t.agentcode;
    const panel = (this.panel = el('div', 'ia-chat'));
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', tx.conversa);
    const head = el('div', 'ia-chat-topo');
    head.append(el('span', 'ia-chat-titulo', tx.conversa));
    const tools = el('div', 'ia-chat-ferramentas');
    // Marcar parte: o mesmo da tecla N; a dica animada (data-dica) vem junto
    const mark = (this.markBtn = el('button', 'ia-chat-marcar'));
    mark.type = 'button';
    mark.dataset.ia = 'marcar';
    mark.dataset.dica = 'mark';
    mark.innerHTML = ICONS.mark;
    mark.append(el('span', null, tx.marcarBtn));
    mark.addEventListener('click', () => {
      this.ed.setTool('mark');
      this.renderMarker();
    });
    const connect = el('button', 'text-btn small ia-chat-conectar');
    connect.type = 'button';
    connect.dataset.ia = 'conectar';
    connect.dataset.dica = 'conectarIA';
    connect.innerHTML = ICONS.plug;
    connect.append(el('span', null, tx.conectarBtn));
    connect.addEventListener('click', () => this.conectar());
    const close = el('button', 'icon-btn tiny ia-chat-fechar', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t.dialogos.fechar);
    close.addEventListener('click', () => this.fechar({ marcador: true }));
    tools.append(mark, connect, close);
    head.append(tools);
    this.list = el('div', 'ia-chat-lista');
    this.list.setAttribute('aria-live', 'polite');
    const form = (this.form = el('form', 'ia-chat-campo'));
    const input = (this.input = document.createElement('textarea'));
    input.rows = 2;
    input.maxLength = 4000;
    input.placeholder = tx.placeholder;
    input.setAttribute('aria-label', tx.rotulo);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // atalhos do editor não valem enquanto se escreve
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.enviar();
      } else if (e.key === 'Escape') this.fechar({ marcador: true });
    });
    const send = el('button', 'btn primary small', tx.enviarBtn);
    send.type = 'submit';
    this.sendBtn = send;
    form.append(input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.enviar();
    });
    this.noIntegration = el('div', 'ia-chat-sem');
    const connect2 = el('button', 'btn small', tx.conectarBtn);
    connect2.type = 'button';
    connect2.addEventListener('click', () => this.conectar());
    this.noIntegration.append(el('p', null, tx.semIntegracao), connect2);
    panel.append(head, this.list, this.noIntegration, form);
    document.body.append(panel);
  }

  conectar() {
    this.fechar({ marcador: true });
    this.onConnect(this.ac.integrado ? undefined : 'agentcode');
  }

  // convite ao abrir o Forgia: sai do botão, some ao clicar nele, ao abrir a conversa ou no ×
  convidar() {
    try {
      if (localStorage.getItem(CONVITE_VISTO)) return;
    } catch {}
    const c = (this.convite = el('div', 'ia-convite'));
    c.setAttribute('role', 'status');
    c.append(el('p', null, t.agentcode.convite));
    const close = el('button', 'icon-btn tiny', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t.dialogos.fechar);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.semConvite();
    });
    c.append(close);
    c.addEventListener('click', () => this.abrir());
    document.body.append(c);
    requestAnimationFrame(() => {
      const r = this.btn.getBoundingClientRect();
      if (!r.width) return this.semConvite();
      c.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      c.style.bottom = `${window.innerHeight - r.top + 10}px`;
      c.style.setProperty('--ponta', `${Math.max(14, r.width / 2 - 6)}px`);
    });
  }

  semConvite({ visto = false } = {}) {
    if (visto) {
      try {
        localStorage.setItem(CONVITE_VISTO, '1');
      } catch {}
    }
    if (this.convite) this.convite.remove();
    this.convite = null;
  }

  abrir() {
    this.semConvite({ visto: true });
    this.novidade(false);
    this.panel.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    // a dica com vídeo (data-dica) cobriria a conversa: só volta quando ela fechar
    delete this.btn.dataset.dica;
    this.render();
    this.place();
    if (this.ac.integrado) requestAnimationFrame(() => this.input.focus());
  }

  // marcador: também desliga o Marcar parte (clique fora, ×, Esc)
  fechar({ marcador = false } = {}) {
    if (!this.aberta) return;
    this.panel.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.dataset.dica = 'pedir';
    if (marcador && this.ed.tool === this.ed.tools.mark) this.ed.setTool(null);
  }

  // sobe a partir do botão, alinhada pela direita dele
  place() {
    const r = this.btn.getBoundingClientRect();
    this.panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    this.panel.style.bottom = `${window.innerHeight - r.top + 6}px`;
  }

  async enviar() {
    const texto = this.input.value.trim();
    if (!texto || !this.ac.integrado) return;
    if (this.ac.ocupado) {
      this.ed.emit('aviso', t.agentcode.ocupado);
      return;
    }
    this.input.value = '';
    await this.ac.pedir(texto);
  }

  // pedido novo (daqui ou do alfinete) entra na conversa; o andamento atualiza a resposta dele
  onTask(task) {
    if (task && !this.msgs.some((m) => m.task === task)) {
      this.fecharTurno(); // o que vier agora é desta tarefa
      this.msgs.push({ de: 'voce', texto: task.texto, marca: task.marca, detalhe: task.detalhe, aberta: false, em: Date.now() }, { de: 'ia', task });
    }
    this.renderBtn();
    this.render();
  }

  // forgia_conversa (src/ponte.js); detail.ignorado diz à ponte que não entrou
  onConversa(detail) {
    const { pedido, resposta } = detail;
    if (this.ac.ocupado) {
      detail.ignorado = 'forgia';
      return;
    }
    if (pedido) {
      const last = [...this.msgs].reverse().find((m) => m.de === 'voce');
      if (!resposta && last && last.texto === pedido && Date.now() - last.em < REPETIDO_MS) {
        detail.ignorado = 'repetido';
        return;
      }
      this.fecharTurno();
      const turno = { de: 'ia', externo: true, pedido: true, atividades: [], resposta: null, aberto: true, ultima: Date.now() };
      this.msgs.push({ de: 'voce', externo: true, texto: pedido, em: Date.now() }, turno);
      this.turno = turno;
      this.armarTurno();
    }
    if (resposta) {
      if (this.turno && this.parado(this.turno)) this.fecharTurno();
      // resposta depois do prazo: volta ao último pedido do agente que fechou sem ela
      const last = this.msgs[this.msgs.length - 1];
      const atrasado = !this.turno && last && last.externo && last.de === 'ia' && last.pedido && !last.resposta ? last : null;
      const turno = this.turno || atrasado || { de: 'ia', externo: true, pedido: false, atividades: [], resposta: null, aberto: true };
      if (!this.turno && !atrasado) this.msgs.push(turno);
      turno.resposta = resposta;
      this.fecharTurno();
    }
    this.novidade(true);
    this.render();
  }

  // o que a IA fez na peça ("IA: criou 1"), venha ou não um forgia_conversa
  onAtividade({ text }) {
    if (this.ac.ocupado || !text) return;
    const now = Date.now();
    let turno = this.turno;
    // balão só de atividade que ficou parado: a próxima começa outro
    if (turno && this.parado(turno)) turno = this.fecharTurno();
    if (!turno) {
      turno = this.turno = { de: 'ia', externo: true, pedido: false, atividades: [], resposta: null, aberto: true };
      this.msgs.push(turno);
    }
    turno.atividades.push(text);
    turno.ultima = now;
    if (turno.pedido) this.armarTurno();
    this.novidade(true);
    this.render();
  }

  // balão só de atividade sem novidade há mais de juntarMs (o de pedido espera o turnoMs)
  parado(turno) {
    return !turno.pedido && Date.now() - turno.ultima > this.juntarMs;
  }

  // pedido do agente sem resposta: o prazo recomeça a cada atividade
  armarTurno() {
    clearTimeout(this.turnoTimer);
    const turno = this.turno;
    this.turnoTimer = setTimeout(() => {
      if (this.turno !== turno) return;
      this.fecharTurno();
      this.render();
    }, this.turnoMs);
  }

  // o balão externo em andamento para de receber; devolve null
  fecharTurno() {
    clearTimeout(this.turnoTimer);
    if (this.turno) this.turno.aberto = false;
    this.turno = null;
    return null;
  }

  // ponto no botão: mensagem do agente chegou com a conversa fechada
  novidade(on) {
    this.btn.classList.toggle('novidade', on && !this.aberta);
    this.labelBtn();
  }

  // o texto do botão não muda com o ponto (ele é só visual); o leitor de tela ouve o aria-label,
  // que junta o rótulo atual (inclusive "trabalhando") e o aviso de mensagem nova
  labelBtn() {
    if (this.btn.classList.contains('novidade')) this.btn.setAttribute('aria-label', `${this.btnText.textContent}: ${t.agentcode.externo.novidade}`);
    else this.btn.removeAttribute('aria-label');
  }

  renderBtn() {
    const busy = this.ac.ocupado;
    this.btn.classList.toggle('trabalhando', busy);
    // integração ligada: o ponto do botão fica verde (a IA já está ligada ao Forgia)
    this.btn.classList.toggle('integrado', this.ac.integrado);
    this.btnText.textContent = busy ? t.agentcode.rotuloTrabalhando : t.agentcode.rotulo;
    this.labelBtn();
  }

  renderMarker() {
    const on = this.ed.tool === this.ed.tools.mark;
    this.markBtn.classList.toggle('ativo', on);
    this.markBtn.setAttribute('aria-pressed', String(on));
  }

  render() {
    this.renderMarker();
    if (!this.aberta) return;
    const tx = t.agentcode;
    const integrado = this.ac.integrado;
    this.noIntegration.hidden = integrado;
    this.form.hidden = !integrado;
    this.sendBtn.disabled = this.ac.ocupado;
    const items = this.msgs.map((m) => this.bubble(m));
    if (!items.length) items.push(el('p', 'ia-chat-vazio', integrado ? tx.vazio : tx.vazioSemIntegracao));
    this.list.replaceChildren(...items);
    this.list.scrollTop = this.list.scrollHeight;
    this.place();
  }

  bubble(m) {
    const tx = t.agentcode;
    if (m.de === 'voce') {
      const b = el('div', 'ia-msg voce');
      if (m.externo) {
        // escrito direto no agente: a marca diz de onde veio
        b.className = 'ia-msg externo voce';
        b.append(el('span', 'ia-msg-origem', tx.externo.origem), el('p', null, m.texto));
        return b;
      }
      if (!m.marca) {
        b.append(el('p', null, m.texto));
        return b;
      }
      // pedido do alfinete: resumido (a marcação e o que o usuário escreveu); o clique mostra a
      // referência da parte que foi junto para a IA
      b.classList.add('marcacao');
      b.classList.toggle('aberta', !!m.aberta);
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
      b.setAttribute('aria-expanded', String(!!m.aberta));
      b.append(el('span', 'ia-msg-marca', tx.marcacao(m.marca)), el('p', 'ia-msg-resumo', m.texto));
      if (m.aberta && m.detalhe) b.append(el('p', 'ia-msg-detalhe', m.detalhe));
      const toggle = () => {
        m.aberta = !m.aberta;
        this.render();
      };
      b.addEventListener('click', toggle);
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      return b;
    }
    if (m.externo || !m.task) return this.bubbleExterno(m);
    const task = m.task;
    const done = FINAL.has(task.status);
    const b = el('div', 'ia-msg ia');
    b.dataset.status = task.status;
    if (!done) {
      const head = el('p', 'ia-msg-andamento');
      head.append(el('span', 'ia-msg-ponto'), document.createTextNode(task.cancelando ? tx.cancelando : tx.status[task.status] || task.status));
      b.append(head);
    } else if (task.status === 'concluida') b.append(...(task.resposta ? respostaIA(task.resposta) : [el('p', null, tx.status.concluida)]));
    else if (task.status === 'erro') b.append(el('p', null, task.erro || tx.erros.erro()));
    else b.append(el('p', null, tx.status.cancelada));
    if (task.nota) b.append(el('p', 'ia-msg-nota', task.nota));
    if (!done && task.id && task === this.ac.tarefa) {
      const cancel = el('button', 'text-btn small', tx.cancelar);
      cancel.type = 'button';
      cancel.dataset.tarefa = 'cancelar';
      cancel.disabled = !!task.cancelando;
      cancel.addEventListener('click', () => this.ac.cancelar());
      b.append(cancel);
    }
    return b;
  }

  // balão da IA de uma conversa feita direto no agente: andamento (se há pedido aberto), o que ela
  // fez na peça (as atividades, em linhas curtas) e a resposta
  bubbleExterno(m) {
    const tx = t.agentcode;
    const atividades = m.atividades || [];
    const emAndamento = m.aberto && m.pedido && !m.resposta;
    const b = el('div', 'ia-msg externo ia');
    b.dataset.status = emAndamento ? 'rodando' : 'concluida';
    if (emAndamento) {
      const head = el('p', 'ia-msg-andamento');
      head.append(el('span', 'ia-msg-ponto'), document.createTextNode(tx.externo.trabalhando));
      b.append(head);
    } else if (!m.pedido) b.append(el('span', 'ia-msg-origem', tx.externo.origem));
    if (atividades.length) {
      const list = el('ul', 'ia-msg-atividades');
      for (const a of atividades) list.append(el('li', null, a));
      b.append(list);
    }
    if (m.resposta) b.append(...respostaIA(m.resposta));
    else if (!emAndamento && m.pedido) b.append(el('p', 'ia-msg-nota', tx.externo.semResposta));
    return b;
  }
}

// resposta da IA (markdown simples) em elementos: parágrafos, listas "- " e "1. ", **negrito** e
// `código`. Só texto: nada vira HTML, então a resposta não injeta nada na página
export function respostaIA(texto) {
  const inline = (parent, s) => {
    for (const part of String(s).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (!part) continue;
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(el('strong', null, part.slice(2, -2)));
      else if (/^`[^`]+`$/.test(part)) parent.append(el('code', null, part.slice(1, -1)));
      else parent.append(document.createTextNode(part));
    }
    return parent;
  };
  const out = [];
  let list = null;
  let para = null;
  for (const raw of String(texto).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const tag = item[1] ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) out.push((list = el(tag, 'ia-lista')));
      list.append(inline(el('li'), item[2]));
      para = null;
    } else if (!line.trim()) {
      list = null;
      para = null;
    } else {
      list = null;
      const txt = line.replace(/^#+\s*/, '');
      if (para) para.append(document.createTextNode(' '));
      else out.push((para = el('p')));
      inline(para, txt);
    }
  }
  return out.length ? out : [el('p', null, String(texto))];
}

// .ia-canto: o aviso da IA (src/statusbar.js) no canto inferior esquerdo da vista
export function iaCorner() {
  const vp = document.getElementById('viewport');
  let c = vp.querySelector('.ia-canto');
  if (!c) {
    c = el('div', 'ia-canto');
    vp.append(c);
  }
  return c;
}
