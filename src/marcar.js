import * as THREE from 'three';
import { t } from './textos/index.js';
import { SHAPES, shapeGeometry } from './shapes.js';
import { objectMatrix } from './csg.js';
import { toUser } from './coords.js';
import { ensureBVH } from './surface.js';
import { outlineGeometry } from './edges.js';
import { theme } from './theme.js';
import { capture } from './captura.js';
import { describeOne, locate, groupFrame, frameQuat, frameOf } from './ponte-comandos.js';
import { ICONS } from './icons.js';
import { FINAL, resumo } from './agentcode.js';

// Ferramenta Marcar parte (tecla N, ou o botão Marcar da conversa "Pedir à IA"). Ao passar o
// mouse, o contorno da PARTE sob o cursor aparece (dentro de um grupo, a forma de dentro, não o
// grupo). O clique põe um alfinete numerado num ponto da face e abre o mini-chat: texto de
// referência ("Marcação 1: Caixa 'aba', ponto (12; −4; 30) mm, face virada para +X"), campo do
// pedido, Excluir marcador (só este) e Copiar. Enter monta o pedido (texto + bloco JSON estável,
// formato forgia.pedido/1) e copia para a área de transferência junto com o PNG da vista com os
// alfinetes; com a integração com o Agent Code ligada, Enter envia à IA.
// - Clicar fora de uma peça, ou em qualquer lugar com o mini-chat aberto, só desliga o marcador
//   (não põe outro alfinete); para marcar de novo, liga de novo.
// - Balão que sai do alfinete: depois de copiar ("cole na sua IA") e, num pedido enviado à IA, o
//   andamento e, no fim, o que ela fez (a resposta resumida).
//
// - A parte dentro de grupo: a malha na tela é o resultado da booleana e o raio acerta o grupo;
//   o ponto é testado contra a forma de cada filho (já transformada, descendo em grupos
//   aninhados, BVH closestPointToPoint) e fica a mais próxima. Na parede de um furo, a parte é o
//   furo. Empate: o furo ganha.
// - As marcações ficam em editor.marks, fora do projeto e do desfazer, até "Limpar marcações"
//   (ou o agente pedir, forgia_marcacoes { limpar: true }). Somem se a parte for excluída.
// - O agente lê as marcações por forgia_marcacoes/forgia_estado: info() relê a parte (medidas,
//   centro, caixa, parâmetros) a cada chamada; o ponto e a face são os do clique.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r2 = (v) => Math.round(v * 100) / 100 || 0;
const MINUS = '−';
const num = (v) => String(r2(v)).replace('.', ',').replace('-', MINUS);

// eixo dominante de um vetor no sistema do usuário: '+X', '−Z'…; null se inclinado
function axisLabel(u) {
  const a = u.map(Math.abs);
  const k = a.indexOf(Math.max(...a));
  if (a[k] < 0.9) return null;
  return (u[k] >= 0 ? '+' : MINUS) + 'XYZ'[k];
}

// parte (folha) mais próxima do ponto, dentro do objeto do topo
function pickPart(top, point) {
  if (top.type !== 'group') return { o: top, chain: [] };
  let best = null;
  const walk = (list, chain, frame) => {
    for (const c of list) {
      if (c.hidden) continue;
      if (c.type === 'group') {
        walk(c.children, [...chain, c], groupFrame(c, frame));
        continue;
      }
      const m = frame.clone().multiply(objectMatrix(c));
      const local = point.clone().applyMatrix4(m.clone().invert());
      const hit = ensureBVH(shapeGeometry(c)).closestPointToPoint(local);
      if (!hit) continue;
      const d = hit.point.clone().applyMatrix4(m).distanceTo(point);
      if (!best || d < best.d - 1e-3 || (Math.abs(d - best.d) <= 1e-3 && c.hole && !best.o.hole)) best = { o: c, chain, d };
    }
  };
  walk(top.children, [top], groupFrame(top, new THREE.Matrix4()));
  return best;
}

export class MarkTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'mark';
    editor.marks = [];
    this.next = 1;
    this.hover = null;
    this.open = null; // marcação com o mini-chat aberto
    this.pinEls = new Map();
    this.layer = document.createElement('div');
    this.layer.className = 'pin-layer';
    editor.overlay.append(this.layer);
    // contorno da parte sob o cursor, visível mesmo atrás de outra face (é a parte que vai ser marcada)
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    this.outline.matrixAutoUpdate = false;
    this.outline.renderOrder = 6;
    this.outline.visible = false;
    this.outline.raycast = () => {};
    editor.scene.add(this.outline);
    theme.watch((c) => this.outline.material.color.set(c.outline));
    // parte excluída (pela IA, pelo usuário ou por desfazer): a marcação some
    editor.addEventListener('change', () => this.prune());
    // outro projeto: o balão era de um ponto do projeto anterior
    editor.addEventListener('projeto', () => this.hideBalloon());
  }

  hint() {
    if (!this.open) return t.modos.marcar;
    // com a integração com o Agent Code ligada, o Enter envia à IA em vez de copiar
    const ac = this.ed.agentCode;
    return ac && ac.integrado ? t.modos.marcarChatEnviar : t.modos.marcarChat;
  }

  enter() {
    this.ed.viewport.classList.add('marking');
    // o alfinete (com o número que ele vai ter) segue o mouse até o clique pôr ele na peça
    if (!this.ghost) {
      this.ghost = document.createElement('div');
      this.ghost.className = 'pin pin-fantasma';
      this.ghost.setAttribute('aria-hidden', 'true');
    }
    this.ed.overlay.append(this.ghost);
    this.ghost.hidden = true;
    const e = this.ed.lastPointerEvent;
    if (e) this.onMove(e);
  }

  exit() {
    this.ed.viewport.classList.remove('marking');
    this.setHover(null);
    this.closeChat();
    if (this.ghost) this.ghost.remove();
  }

  // alfinete que o mouse carrega: a ponta no cursor; apagado fora de uma peça (lá o clique desliga)
  moveGhost(e) {
    const g = this.ghost;
    if (!g) return;
    const inside = !this.open && this.ed.insideViewport(e);
    g.hidden = !inside;
    if (!inside) return;
    const r = this.ed.viewport.getBoundingClientRect();
    g.textContent = this.next;
    g.classList.toggle('fora', !this.hover);
    g.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  }

  // ponto sob o cursor: { top, part, chain, point, normal } ou null
  pick(e) {
    const h = this.ed.surface.hit(e);
    if (!h || h.table || !h.id) return null;
    const top = this.ed.obj(h.id);
    if (!top) return null;
    const part = pickPart(top, h.point);
    if (!part) return null;
    return { top, part: part.o, chain: part.chain, point: h.point, normal: h.normal };
  }

  setHover(p) {
    this.hover = p;
    if (!p) {
      this.outline.visible = false;
      return;
    }
    const frame = frameOf(p.chain);
    this.outline.geometry = outlineGeometry(shapeGeometry(p.part), 28);
    this.outline.matrix.copy(frame.clone().multiply(objectMatrix(p.part)));
    this.outline.matrixWorldNeedsUpdate = true;
    this.outline.visible = true;
  }

  onDown(e) {
    // com o mini-chat aberto, o clique fora só fecha e desliga; fora de uma peça, também desliga
    const p = this.open ? null : this.pick(e);
    if (!p) {
      this.ed.setTool(null);
      return true;
    }
    this.add(p);
    return true;
  }

  onMove(e) {
    if (!this.ed.insideViewport(e)) {
      this.setHover(null);
      this.moveGhost(e);
      return true;
    }
    this.setHover(this.open ? null : this.pick(e));
    // o alfinete que segue o mouse faz o papel do cursor; com o mini-chat aberto, cursor normal
    this.ed.renderer.domElement.style.cursor = this.open ? 'default' : 'none';
    this.moveGhost(e);
    return true;
  }

  onUp() {
    return true;
  }

  onKey(e) {
    if (e.key === 'Escape' && this.open) {
      this.closeChat();
      this.ed.emit('mode');
      return true;
    }
    return false;
  }

  // alfinete novo: guarda o ponto e a face do clique e a parte; abre o mini-chat
  add(p) {
    const ed = this.ed;
    const n = this.next++;
    const q = frameQuat(frameOf(p.chain)).multiply(new THREE.Quaternion().fromArray(p.part.quat));
    const localN = p.normal.clone().applyQuaternion(q.clone().invert());
    const mark = {
      n,
      p: p.point.toArray(),
      objectId: p.top.id,
      partId: p.part.id,
      ponto: toUser(p.point).map(r2),
      normal: toUser(p.normal).map(r2),
      lado: axisLabel(toUser(localN)),
      texto: '',
    };
    mark.face = axisLabel(mark.normal);
    mark.info = () => this.info(mark);
    ed.marks.push(mark);
    this.hideBalloon();
    this.openChat(mark);
    ed.emit('marcas');
    ed.emit('alfinete', mark); // a conversa da IA (src/pedido-ia.js) fecha: o mini-chat assume
  }

  info(m) {
    const ed = this.ed;
    const loc = locate(ed.objects, m.partId);
    const top = ed.obj(m.objectId);
    const part = loc ? describeOne(ed, m.partId) : null;
    const out = {
      n: m.n,
      peca: top ? { id: top.id, nome: top.name, tipo: top.type === 'group' ? 'grupo' : part && part.tipo } : null,
      parte: part && { id: part.id, nome: part.nome, tipo: part.tipo, furo: part.furo, medidas: part.medidas, centro: part.centro, caixa: part.caixa, ...(part.rotacao ? { rotacao: part.rotacao } : {}), ...(part.params ? { params: part.params } : {}) },
      ponto: m.ponto,
      normal: m.normal,
      face: m.face ? m.face.replace(MINUS, '-') : 'inclinada',
      lado_da_parte: m.lado ? m.lado.replace(MINUS, '-') : null,
      referencia: this.reference(m),
    };
    if (m.texto) out.pedido = m.texto;
    return out;
  }

  // "Marcação 1: Caixa 'aba' (parte de 'suporte'), ponto (12; −4; 30) mm, face virada para +X"
  reference(m) {
    const ed = this.ed;
    const loc = locate(ed.objects, m.partId);
    const top = ed.obj(m.objectId);
    const part = loc ? loc.o : null;
    return t.marcar.referencia({
      n: m.n,
      tipo: part ? (SHAPES[part.type] ? SHAPES[part.type].label : part.type) : '',
      nome: part ? part.name : '',
      furo: !!(part && part.hole),
      grupo: top && part && top !== part ? top.name : null,
      ponto: m.ponto.map(num).join('; '),
      face: m.face || t.marcar.inclinada(m.normal.map(num).join('; ')),
    });
  }

  // pedido estável (forgia.pedido/1): texto legível + bloco JSON
  request(m) {
    const info = this.info(m);
    const json = { formato: 'forgia.pedido/1', texto: m.texto, marcacoes: [info] };
    return t.marcar.pedido({ referencia: info.referencia, texto: m.texto, json: JSON.stringify(json) });
  }

  async copy(m) {
    const ed = this.ed;
    const text = this.request(m);
    const W = ed.renderer.domElement.clientWidth || 800;
    const H = ed.renderer.domElement.clientHeight || 600;
    const k = Math.min(1, 1280 / Math.max(W, H));
    const shot = capture(ed, { vista: 'atual', largura: Math.round(W * k), altura: Math.round(H * k), marcacoes: true });
    const api = window.forgiaPonte;
    let ok = false;
    if (api) ok = await api.copiar(text, shot.imagem);
    else {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    this.lastCopy = { text, png: shot.imagem.length };
    if (!ok) {
      ed.emit('aviso', t.marcar.naoCopiou);
      return false;
    }
    // copiou: o mini-chat fecha e o balão do alfinete diz o que fazer com o pedido
    this.closeChat();
    ed.emit('mode');
    this.showBalloon({ p: m.p, n: m.n, texto: t.marcar.balao.copiado, ms: 9000 });
    return true;
  }

  // envia o pedido ao Agent Code (src/agentcode.js); o andamento e o fim aparecem no balão do alfinete
  async send(m) {
    const ac = this.ed.agentCode;
    if (!m.texto.trim()) return false;
    if (ac.ocupado) {
      this.ed.emit('aviso', t.agentcode.ocupado);
      return false;
    }
    if (!this.acOuvindo) {
      this.acOuvindo = true;
      ac.addEventListener('tarefa', (e) => this.onTask(e.detail));
    }
    // vai o pedido inteiro (referência + bloco forgia-pedido); a conversa mostra só o que o usuário escreveu
    const pedido = ac.pedir(this.request(m), { rotulo: m.texto, marca: m.n, detalhe: this.reference(m) });
    this.showBalloon({ p: m.p, n: m.n, task: ac.tarefa });
    this.ed.setTool(null); // enviado: o marcador desliga (o clique seguinte não põe outro alfinete)
    return pedido;
  }

  // a tarefa do balão mudou (andamento, resposta, erro)
  onTask(task) {
    if (this.balao && this.balao.task && this.balao.task === task) this.renderBalloon();
  }

  // ---------- balão do alfinete ----------
  // { p (ponto 3D), n, texto } ou { p, n, task }; ms: some sozinho depois disso
  showBalloon(b) {
    this.hideBalloon();
    const el = document.createElement('div');
    el.className = 'pin-balao';
    el.setAttribute('role', 'status');
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ed.overlay.append(el);
    this.balao = { ...b, p: [...b.p], el };
    if (b.ms) this.balao.timer = setTimeout(() => this.hideBalloon(), b.ms);
    this.renderBalloon();
  }

  renderBalloon() {
    const b = this.balao;
    if (!b) return;
    const tx = t.marcar.balao;
    const task = b.task;
    let status = 'info';
    let texto = b.texto;
    let nota = null;
    if (task) {
      status = FINAL.has(task.status) ? task.status : 'rodando';
      if (task.status === 'concluida') texto = tx.terminou(resumo(task.resposta));
      else if (task.status === 'erro') texto = tx.erro(task.erro || t.agentcode.erros.erro());
      else if (task.status === 'cancelada') texto = tx.cancelado;
      else texto = task.cancelando ? t.agentcode.cancelando : tx.trabalhando;
      nota = task.nota;
    }
    b.el.dataset.status = status;
    const body = document.createElement('div');
    body.className = 'pin-balao-corpo';
    if (task) body.append(Object.assign(document.createElement('span'), { className: 'pin-balao-ponto' }));
    body.append(Object.assign(document.createElement('p'), { textContent: texto }));
    const parts = [body];
    if (nota) parts.push(Object.assign(document.createElement('p'), { className: 'pin-balao-nota', textContent: nota }));
    const actions = document.createElement('div');
    actions.className = 'pin-balao-acoes';
    if (task && !FINAL.has(task.status) && task.id) {
      const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'text-btn small', textContent: t.agentcode.cancelar });
      cancel.dataset.balao = 'cancelar';
      cancel.disabled = !!task.cancelando;
      cancel.addEventListener('click', () => this.ed.agentCode.cancelar());
      actions.append(cancel);
    }
    if (!task || FINAL.has(task.status)) {
      const close = Object.assign(document.createElement('button'), { type: 'button', className: 'text-btn small', textContent: t.agentcode.fechar });
      close.dataset.balao = 'fechar';
      close.addEventListener('click', () => this.hideBalloon());
      actions.append(close);
    }
    if (actions.childElementCount) parts.push(actions);
    b.el.replaceChildren(...parts);
  }

  hideBalloon() {
    if (!this.balao) return;
    clearTimeout(this.balao.timer);
    this.balao.el.remove();
    this.balao = null;
  }

  // exclui só esta marcação (os números das outras ficam)
  remove(m) {
    const ed = this.ed;
    const i = ed.marks.indexOf(m);
    if (i >= 0) ed.marks.splice(i, 1);
    if (this.open === m) this.closeChat();
    if (!ed.marks.length) this.next = 1;
    ed.emit('marcas');
    ed.emit('mode');
  }

  clear() {
    this.ed.marks.length = 0;
    this.next = 1;
    this.closeChat();
    // o balão de um pedido à IA fica (o agente costuma limpar as marcações no fim do trabalho e o
    // usuário ainda tem que ver o que ela fez); o de "copiado" vai junto com os alfinetes
    if (this.balao && !this.balao.task) this.hideBalloon();
    this.ed.emit('marcas');
  }

  prune() {
    const ed = this.ed;
    const before = ed.marks.length;
    for (let i = ed.marks.length - 1; i >= 0; i--) if (!locate(ed.objects, ed.marks[i].partId)) ed.marks.splice(i, 1);
    if (this.open && !ed.marks.includes(this.open)) this.closeChat();
    if (!ed.marks.length) this.next = 1;
    if (ed.marks.length !== before) ed.emit('marcas');
  }

  // ---------- mini-chat ----------
  openChat(m) {
    this.closeChat();
    this.open = m;
    if (this.ghost) this.ghost.hidden = true;
    const el = document.createElement('div');
    el.className = 'marca-chat';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t.marcar.titulo(m.n));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const head = document.createElement('div');
    head.className = 'marca-chat-topo';
    const title = document.createElement('span');
    title.textContent = t.marcar.titulo(m.n);
    const close = document.createElement('button');
    close.className = 'icon-btn tiny';
    close.type = 'button';
    close.setAttribute('aria-label', t.dialogos.fechar);
    close.innerHTML = ICONS.close;
    close.addEventListener('click', () => {
      this.closeChat();
      this.ed.emit('mode');
    });
    head.append(title, close);
    const ref = document.createElement('p');
    ref.className = 'marca-ref';
    ref.textContent = this.reference(m);
    // integração com o Agent Code ligada: Enter envia o mesmo pedido que seria copiado (texto,
    // referência e bloco forgia-pedido; a imagem não vai: o agente lê a marcação pelo
    // forgia_marcacoes) em vez de copiar
    const ac = this.ed.agentCode;
    const send = !!(ac && ac.integrado);
    const submit = send ? () => this.send(m) : () => this.copy(m);
    const input = document.createElement('textarea');
    input.className = 'marca-texto';
    input.rows = 2;
    input.placeholder = send ? t.marcar.placeholderEnviar : t.marcar.placeholder;
    input.value = m.texto;
    input.addEventListener('input', () => (m.texto = input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        this.closeChat();
        this.ed.emit('mode');
      }
    });
    const actions = document.createElement('div');
    actions.className = 'marca-acoes';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'text-btn small com-icone';
    clear.dataset.marca = 'excluir';
    clear.innerHTML = ICONS.deleteSmall;
    clear.append(t.marcar.excluir);
    clear.addEventListener('click', () => this.remove(m));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = (send ? 'text-btn small' : 'btn primary') + ' com-icone';
    copy.dataset.marca = 'copiar';
    copy.innerHTML = ICONS.copySmall;
    copy.append(t.marcar.copiar);
    copy.addEventListener('click', () => this.copy(m));
    actions.append(clear, copy);
    if (send) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary com-icone';
      go.dataset.marca = 'enviar';
      go.innerHTML = ICONS.send;
      go.append(t.marcar.enviar);
      go.addEventListener('click', submit);
      actions.append(go);
    }
    el.append(head, ref, input, actions);
    this.ed.overlay.append(el);
    this.chatEl = el;
    this.ed.emit('mode');
    requestAnimationFrame(() => input.focus());
  }

  closeChat() {
    if (this.chatEl) this.chatEl.remove();
    this.chatEl = null;
    this.open = null;
  }

  // alfinetes e mini-chat acompanham a vista a cada quadro (ferramenta ligada ou não)
  updatePins() {
    const ed = this.ed;
    const seen = new Set();
    const W = ed.viewport.clientWidth;
    const H = ed.viewport.clientHeight;
    for (const m of ed.marks) {
      seen.add(m);
      let el = this.pinEls.get(m);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'pin';
        el.textContent = m.n;
        el.setAttribute('aria-label', t.marcar.titulo(m.n));
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', () => {
          if (ed.tool !== this) ed.setTool('mark');
          this.openChat(m);
        });
        this.layer.append(el);
        this.pinEls.set(m, el);
      }
      const s = ed.project(V3(...m.p));
      const hidden = s.z > 1 || s.x < -20 || s.y < -20 || s.x > W + 20 || s.y > H + 20;
      el.style.display = hidden ? 'none' : '';
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      el.classList.toggle('aberto', this.open === m);
      if (this.open === m && this.chatEl) {
        const cw = this.chatEl.offsetWidth || 300;
        const ch = this.chatEl.offsetHeight || 160;
        const x = Math.min(Math.max(8, s.x + 22), W - cw - 8);
        const y = Math.min(Math.max(8, s.y - ch - 30), H - ch - 8);
        this.chatEl.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
    for (const [m, el] of this.pinEls) {
      if (!seen.has(m)) {
        el.remove();
        this.pinEls.delete(m);
      }
    }
    // o balão sai da cabeça do alfinete (vale mesmo se o agente já limpou a marcação)
    const b = this.balao;
    if (b) {
      const s = ed.project(V3(...b.p));
      const bw = b.el.offsetWidth || 260;
      const bh = b.el.offsetHeight || 60;
      const hidden = s.z > 1;
      b.el.style.display = hidden ? 'none' : '';
      const x = Math.min(Math.max(8, s.x + 16), W - bw - 8);
      const y = Math.min(Math.max(8, s.y - bh - 40), H - bh - 8);
      b.el.style.transform = `translate(${x}px, ${y}px)`;
      // a ponta do balão aponta para o alfinete, mesmo quando o balão encosta na borda
      b.el.style.setProperty('--ponta', `${Math.min(Math.max(10, s.x - x - 6), bw - 22)}px`);
    }
  }
}
