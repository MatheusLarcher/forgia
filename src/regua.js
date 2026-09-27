import * as THREE from 'three';
import { t } from './textos/index.js';
import { fmt } from './editor.js';

// Régua da mesa: por fora da borda da frente (X) e da esquerda (Y), com o zero no canto da frente
// à esquerda e o total na ponta ("256 mm"), como uma régua de verdade. Não usa o sistema da barra
// de status (origem no centro): por isso a faixa da peça mostra a largura, não a coordenada.
// - Tracinhos a cada 10 mm (casam com as linhas grossas da mesa), mais longos a cada 50 mm: linhas
//   na cena, dentro do grupo da mesa (refeitos por initWorkplane na troca de mesa).
// - Números em HTML sobre a vista (nítidos em qualquer zoom): a cada 10, 50 ou 100 mm conforme o
//   espaço na tela; quem encostar num rótulo de mais prioridade (total, faixa, zero, centenas…)
//   não aparece, então nunca sobrepõem.
// - Indicador: com peça selecionada (ou sendo arrastada), a faixa que ela ocupa acende nas duas
//   réguas com a largura; sem seleção, uma marquinha acompanha o cursor sobre a mesa.
// - Some com o plano de trabalho ativo. Fica fora do projeto, do desfazer, da exportação e das
//   capturas (src/captura.js esconde o root).
// - Custo por quadro: a caixa da seleção (em cache no editor) e a chave da vista; os rótulos só são
//   reposicionados quando a vista, a mesa, a faixa ou o cursor mudam.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TICK = 3; // mm: tracinho de 10 mm
const TICK_MAJOR = 6; // mm: tracinho de 50 mm e das pontas; largura da faixa da seleção
const STEPS = [10, 50, 100, 200, 500, 1000]; // passos dos números, do mais denso ao mais ralo
const GAP_PX = 5; // da ponta do tracinho até o rótulo
const LABEL_H = 14; // altura do rótulo na tela (px)
const BAND_Y = 0.03; // faixa logo acima da sombra (0,02)

const tickLen = (k, total) => (k % 50 === 0 || k === total ? TICK_MAJOR : TICK);

export class TableRuler {
  constructor(editor) {
    this.ed = editor;
    this.layer = document.createElement('div');
    this.layer.className = 'regua-mesa';
    editor.viewport.querySelector('.overlay').prepend(this.layer);
    this.cursorEls = [0, 1].map(() => this.el('regua-cursor'));
    this.bandEls = [0, 1].map(() => this.el('regua-faixa'));
    this.labels = [];
    this.cursor = null; // ponto da mesa sob o cursor (mundo), só sem seleção
    this.key = '';
    this.cursorKey = '';
    // a fonte carregou depois da primeira medida: mede os rótulos de novo
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.remeasure());
  }

  remeasure() {
    for (const e of this.labels) e.real = false;
    this.bandText = ['', ''];
    this.key = '';
  }

  el(cls, text = '') {
    const e = document.createElement('div');
    e.className = cls;
    e.textContent = text;
    e.style.display = 'none';
    this.layer.append(e);
    return e;
  }

  // chamado por initWorkplane: tracinhos e faixas no grupo da mesa (geometria descartada com ele)
  // e os números da mesa nova
  build(group, mats, w, l) {
    this.w = w;
    this.l = l;
    const root = (this.root = new THREE.Group());
    const pts = [];
    // X: borda da frente (z = l/2), para fora (+z); valor k em x = −w/2 + k
    for (const k of values(w)) pts.push(-w / 2 + k, 0, l / 2, -w / 2 + k, 0, l / 2 + tickLen(k, w));
    // Y: borda da esquerda (x = −w/2), para fora (−x); valor k em z = l/2 − k
    for (const k of values(l)) pts.push(-w / 2, 0, l / 2 - k, -w / 2 - tickLen(k, l), 0, l / 2 - k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ticks = new THREE.LineSegments(geo, mats.ruler);
    ticks.renderOrder = -1;
    root.add(ticks);
    this.bands = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats.rulerBand);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = -1;
      m.visible = false;
      root.add(m);
      return m;
    });
    for (const o of root.children) o.raycast = () => {};
    group.add(root);

    for (const e of this.labels) e.el.remove();
    this.labels = [];
    for (const [axis, total] of [[0, w], [1, l]]) {
      for (const k of values(total)) {
        if (axis === 1 && k === 0) continue; // um zero só, no canto (o da régua X)
        const end = k === total;
        const el = this.el(end ? 'regua-num regua-total' : 'regua-num', end ? t.editor.regua.total(fmt(total)) : fmt(k));
        // prioridade para sobrar quando não cabe tudo: total, zero, centenas, cinquentas, dezenas
        const rank = end ? 0 : k === 0 ? 1 : k % 100 === 0 ? 2 : k % 50 === 0 ? 3 : 4;
        this.labels.push({ axis, k, end, el, rank, w: 0, real: false });
      }
    }
    this.labels.sort((a, b) => a.rank - b.rank || a.k - b.k);
    this.bandText = ['', ''];
    this.bandW = [0, 0];
    this.key = '';
    this.cursorKey = '';
  }

  // sem seleção: ponto da mesa sob o cursor (hover do editor); null tira a marquinha
  setCursor(p) {
    this.cursor = p ? { x: p.x, z: p.z } : null;
  }

  // ponto da régua (mundo) do valor k, a len mm para fora da borda
  point(axis, k, len = 0) {
    const { w, l } = this;
    return axis === 0 ? V3(-w / 2 + k, 0, l / 2 + len) : V3(-w / 2 - len, 0, l / 2 - k);
  }

  // direção "para fora da mesa" na tela, no ponto p da régua (s = p projetado)
  outward(axis, p, s) {
    const q = this.ed.project(p.clone().add(axis === 0 ? V3(0, 0, 10) : V3(-10, 0, 0)));
    const dx = q.x - s.x;
    const dy = q.y - s.y;
    const n = Math.hypot(dx, dy);
    return n > 1e-3 ? { x: dx / n, y: dy / n } : { x: 0, y: 1 };
  }

  update() {
    const ed = this.ed;
    if (!this.root) return;
    const on = !ed.wplane;
    this.root.visible = on;
    this.layer.style.display = on ? '' : 'none';
    if (!on) return;
    // faixa da seleção: caixa no mundo, em X e em Z (o Y do usuário)
    let range = null;
    if (ed.selection.length) {
      const b = ed.selectionBox();
      if (!b.isEmpty()) range = [[b.min.x, b.max.x], [b.min.z, b.max.z]];
    }
    const view = ed.viewKey();
    // obstáculos: o que flutua sobre a vista (cubo e botões, inspetor, barra de baixo, dica, painel
    // e aviso da IA). Lidos antes de qualquer escrita de estilo, para não forçar layout no meio do
    // quadro; entram na chave, então um painel que aparece ou some reposiciona os números
    const obstaculos = this.obstacles();
    const key = `${view}|${this.w}x${this.l}|${range ? range.flat().join() : ''}|${obstaculos.sig}`;
    if (key !== this.key || this.labels.some((e) => !e.real)) {
      this.key = key;
      this.layout(range, obstaculos.rects);
    }
    // a marquinha do cursor anda sozinha: mover o mouse não refaz os números
    const c = range ? null : this.cursor;
    const cursorKey = `${view}|${this.w}x${this.l}|${c ? c.x + ',' + c.z : ''}`;
    if (cursorKey !== this.cursorKey) {
      this.cursorKey = cursorKey;
      this.layoutCursor(c);
    }
  }

  obstacles() {
    const ed = this.ed;
    const vp = ed.viewport;
    const vr = vp.getBoundingClientRect();
    const rects = [];
    for (const child of vp.children) {
      if (child === ed.renderer.domElement || child.classList.contains('overlay')) continue;
      const b = child.getBoundingClientRect();
      if (b.width && b.height) rects.push({ x0: b.left - vr.left, x1: b.right - vr.left, y0: b.top - vr.top, y1: b.bottom - vr.top });
    }
    return { rects, sig: `${vp.clientWidth}x${vp.clientHeight}:` + rects.map((r) => [r.x0, r.y0, r.x1, r.y1].map(Math.round).join()).join(';') };
  }

  // marquinha do cursor (sem seleção), com o cursor sobre a mesa
  layoutCursor(cursor) {
    const ed = this.ed;
    const { w, l } = this;
    const inside = cursor && Math.abs(cursor.x) <= w / 2 && Math.abs(cursor.z) <= l / 2;
    for (const axis of [0, 1]) {
      const el = this.cursorEls[axis];
      const p = inside && this.point(axis, axis === 0 ? cursor.x + w / 2 : l / 2 - cursor.z);
      const s = p && ed.project(p);
      if (!s || s.z < -1 || s.z > 1) {
        el.style.display = 'none';
        continue;
      }
      const d = this.outward(axis, p, s);
      el.style.display = 'block';
      el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${Math.atan2(d.y, d.x)}rad)`;
    }
  }

  layout(range, obstaculos) {
    const ed = this.ed;
    const { w, l } = this;
    const totals = [w, l];
    const W = ed.viewport.clientWidth;
    const H = ed.viewport.clientHeight;
    const placed = [...obstaculos];
    const fits = (r) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H && !placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
    // caixa do rótulo (largura bw px), com o centro afastado da ponta do tracinho, para fora
    // side = −1: do lado de dentro da mesa (o total, quando por fora cai atrás da barra ou fora da vista)
    const rect = (axis, p, bw, side = 1) => {
      const s = ed.project(p);
      if (s.z < -1 || s.z > 1) return null; // atrás da câmera
      const d = this.outward(axis, p, s);
      const half = Math.abs(d.x) * (bw / 2) + Math.abs(d.y) * (LABEL_H / 2);
      const cx = s.x + side * d.x * (GAP_PX + half);
      const cy = s.y + side * d.y * (GAP_PX + half);
      return { cx, cy, x0: cx - bw / 2 - 3, x1: cx + bw / 2 + 3, y0: cy - LABEL_H / 2 - 1, y1: cy + LABEL_H / 2 + 1 };
    };
    const show = (el, r) => {
      el.style.display = 'block';
      el.style.transform = `translate(${r.cx}px, ${r.cy}px) translate(-50%, -50%)`;
    };

    // faixas da seleção (cena) e a largura delas (HTML), que passam na frente dos números
    for (const axis of [0, 1]) {
      const band = this.bands[axis];
      const el = this.bandEls[axis];
      if (!range) {
        band.visible = false;
        el.style.display = 'none';
        continue;
      }
      const [a, b] = range[axis];
      const size = Math.max(b - a, 0.01);
      band.visible = true;
      if (axis === 0) {
        band.scale.set(size, TICK_MAJOR, 1);
        band.position.set((a + b) / 2, BAND_Y, l / 2 + TICK_MAJOR / 2);
      } else {
        band.scale.set(TICK_MAJOR, size, 1);
        band.position.set(-w / 2 - TICK_MAJOR / 2, BAND_Y, (a + b) / 2);
      }
      const text = t.editor.regua.largura(fmt(b - a));
      if (this.bandText[axis] !== text) {
        el.textContent = text;
        const m = measure(el);
        this.bandW[axis] = m.w;
        this.bandText[axis] = m.real ? text : ''; // estimativa: mede de novo no próximo layout
      }
      // centro da faixa em valor de régua (x = −w/2 + k; z = l/2 − k)
      const k = axis === 0 ? (a + b) / 2 + w / 2 : l / 2 - (a + b) / 2;
      const r = rect(axis, this.point(axis, k, TICK_MAJOR), this.bandW[axis]);
      if (r && fits(r)) {
        placed.push(r);
        show(el, r);
      } else el.style.display = 'none';
    }

    // largura de cada número: medida de verdade quando dá; estimativa (vista escondida, fonte
    // carregando) é medida de novo no próximo quadro
    for (const e of this.labels) {
      if (e.real) continue;
      const m = measure(e.el);
      e.w = m.w;
      e.real = m.real;
    }
    // passo dos números: o menor com espaço entre dois vizinhos nas duas pontas da régua (em
    // perspectiva o espaço na tela muda ao longo dela e é mínimo numa das pontas)
    const stepFor = (axis) => {
      const total = totals[axis];
      let bw = 20;
      for (const e of this.labels) if (e.axis === axis && !e.end) bw = Math.max(bw, e.w);
      for (const step of STEPS) {
        if (step >= total) break;
        const ok = [0, total - step].every((k0) => {
          const p = ed.project(this.point(axis, k0));
          const q = ed.project(this.point(axis, k0 + step));
          return Math.abs(q.x - p.x) >= bw + 6 || Math.abs(q.y - p.y) >= LABEL_H + 4;
        });
        if (ok) return step;
      }
      return Infinity; // só o zero e o total
    };
    const steps = [stepFor(0), stepFor(1)];
    for (const e of this.labels) {
      const wanted = e.end || e.k === 0 || e.k % steps[e.axis] === 0;
      let r = wanted && rect(e.axis, this.point(e.axis, e.k, tickLen(e.k, totals[e.axis])), e.w);
      if (e.end && r && !fits(r)) r = rect(e.axis, this.point(e.axis, e.k), e.w, -1);
      if (r && fits(r)) {
        placed.push(r);
        show(e.el, r);
      } else e.el.style.display = 'none';
    }
  }
}

// 0, 10, 20… e o total (a última marca, mesmo quando não é múltiplo de 10)
function values(total) {
  const out = [];
  for (let k = 0; k < total - 1e-6; k += 10) out.push(k);
  out.push(total);
  return out;
}

// largura do rótulo na tela: { w, real }; escondido (vista fora da tela), uma estimativa pelo texto
function measure(el) {
  const was = el.style.display;
  el.style.display = 'block';
  const real = el.offsetWidth;
  el.style.display = was;
  return real ? { w: real, real: true } : { w: el.textContent.length * 6.5 + 8, real: false };
}
