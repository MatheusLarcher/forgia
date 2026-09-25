// Cartão de dica: parar o ponteiro sobre um elemento com data-dica="<chave>" mostra título,
// atalho e descrição de t.dicas[<chave>]. Um só cartão na página, com delegação de eventos no
// document (serve também para botões criados depois, como os do inspetor).
// data-dica-lado="direita" abre à direita (coluna de vista); senão abre abaixo (ou acima, sem espaço).
// Com t.dicas[k].video (src) o cartão ganha um vídeo com botão pausar/tocar; sem src, o bloco não existe.
import { t } from './textos/index.js';
import { ICONS } from './icons.js';

const OPEN_DELAY = 400; // ms com o ponteiro parado sobre o elemento
const LEAVE_GRACE = 150; // ms para atravessar a setinha e alcançar o cartão (e o X)
const GAP = 10; // distância entre o elemento e o cartão (a setinha fica nela)
const MARGIN = 8; // distância mínima da borda da janela
const CARD_ID = 'dica-cartao';

const el = (tag, cls, ...children) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Dica {
  // busy(): true quando o cartão não deve abrir (arraste, colocação de forma, modal aberto)
  constructor({ busy = () => false } = {}) {
    this.busy = busy;
    this.card = null;
    this.owner = null; // elemento dono do cartão aberto
    this.suppressed = null; // clicado ou fechado: não reabre até o ponteiro sair dele
    this.openTimer = 0;
    this.closeTimer = 0;
    document.addEventListener('pointermove', (e) => this.onMove(e), true);
    document.addEventListener('pointerdown', (e) => this.onDown(e), true);
    document.addEventListener('pointerout', (e) => {
      if (e.relatedTarget) return;
      // saiu da janela
      this.cancelOpen();
      this.scheduleClose();
    });
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
  }

  get isOpen() {
    return !!this.owner;
  }

  onMove(e) {
    if (this.card && this.card.contains(e.target)) {
      this.cancelClose();
      return;
    }
    if (e.buttons || this.busy()) {
      this.hide();
      return;
    }
    const target = e.target instanceof Element ? e.target.closest('[data-dica]') : null;
    if (target !== this.suppressed) this.suppressed = null;
    if (target && target === this.owner) {
      this.cancelClose();
      return;
    }
    if (!target || target === this.suppressed) {
      this.cancelOpen();
      this.scheduleClose();
      return;
    }
    // outro elemento: o tempo recomeça a cada movimento (só abre com o ponteiro parado)
    if (this.isOpen) this.close();
    this.cancelOpen();
    this.openTimer = setTimeout(() => this.open(target), OPEN_DELAY);
  }

  onDown(e) {
    if (this.card && this.card.contains(e.target)) return;
    // clicar no elemento (ou em qualquer outro lugar) fecha o cartão
    const target = e.target instanceof Element ? e.target.closest('[data-dica]') : null;
    if (target) this.suppressed = target;
    this.hide();
  }

  onKey(e) {
    if (e.key !== 'Escape' || !this.isOpen) return;
    // Esc fecha só o cartão (não desfaz a seleção nem sai do modo)
    this.suppressed = this.owner;
    this.hide();
    e.stopPropagation();
    e.preventDefault();
  }

  cancelOpen() {
    clearTimeout(this.openTimer);
    this.openTimer = 0;
  }

  cancelClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
  }

  scheduleClose() {
    if (!this.isOpen || this.closeTimer) return;
    this.closeTimer = setTimeout(() => this.close(), LEAVE_GRACE);
  }

  hide() {
    this.cancelOpen();
    this.close();
  }

  open(target) {
    this.openTimer = 0;
    const d = t.dicas[target.dataset.dica];
    if (!d || !target.isConnected || this.busy()) return;
    const card = this.render(d);
    this.owner = target;
    target.setAttribute('aria-describedby', CARD_ID);
    this.place(target, card);
    card.classList.add('aberta');
    const video = card.querySelector('video');
    if (video) video.play().catch(() => {});
  }

  close() {
    this.cancelClose();
    if (!this.owner) return;
    this.owner.removeAttribute('aria-describedby');
    this.owner = null;
    this.card.classList.remove('aberta');
    const video = this.card.querySelector('video');
    if (video) video.pause();
  }

  // monta o conteúdo do cartão para a dica d = { titulo, atalho?, texto, video? }
  render(d) {
    if (!this.card) {
      this.card = el('div', 'dica');
      this.card.id = CARD_ID;
      this.card.setAttribute('role', 'tooltip');
      document.body.append(this.card);
    }
    const card = this.card;
    const close = el('button', 'dica-fechar');
    close.type = 'button';
    close.setAttribute('aria-label', t.dialogos.fechar);
    close.innerHTML = ICONS.close;
    close.addEventListener('click', () => {
      this.suppressed = this.owner;
      this.hide();
    });
    const parts = [el('span', 'dica-seta'), el('div', 'dica-topo', el('span', 'dica-titulo', d.titulo), close)];
    if (d.video) parts.push(this.videoBlock(d.video));
    const keys = el('div', 'dica-atalho');
    if (d.atalho) {
      d.atalho.split('+').forEach((k, i) => {
        if (i) keys.append(el('span', 'dica-mais', '+'));
        keys.append(el('kbd', '', k));
      });
    } else {
      keys.append(el('span', 'dica-info', 'i'));
    }
    parts.push(keys, el('p', 'dica-texto', d.texto));
    card.classList.toggle('com-video', !!d.video);
    card.replaceChildren(...parts);
    return card;
  }

  videoBlock(src) {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.src = src;
    const btn = el('button', 'dica-play');
    btn.type = 'button';
    const sync = () => {
      btn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
      btn.setAttribute('aria-label', video.paused ? t.dialogos.video.tocar : t.dialogos.video.pausar);
    };
    btn.addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    sync();
    return el('div', 'dica-video', video, btn);
  }

  // abaixo e centrado no elemento (acima se não couber); à direita com data-dica-lado="direita".
  // O cartão desliza para caber na janela; a setinha continua apontando para o centro do elemento.
  place(target, card) {
    const r = target.getBoundingClientRect();
    const w = card.offsetWidth;
    const hh = card.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let side = target.dataset.dicaLado === 'direita' ? 'direita' : 'abaixo';
    let x, y, arrow;
    if (side === 'direita') {
      x = r.right + GAP;
      y = clamp(r.top + r.height / 2 - hh / 2, MARGIN, vh - hh - MARGIN);
      arrow = r.top + r.height / 2 - y;
    } else {
      y = r.bottom + GAP;
      if (y + hh > vh - MARGIN && r.top - GAP - hh >= MARGIN) {
        side = 'acima';
        y = r.top - GAP - hh;
      }
      x = clamp(r.left + r.width / 2 - w / 2, MARGIN, vw - w - MARGIN);
      arrow = r.left + r.width / 2 - x;
    }
    card.dataset.lado = side;
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    card.style.setProperty('--seta', `${Math.round(arrow)}px`);
  }
}
