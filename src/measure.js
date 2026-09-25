import * as THREE from 'three';
import { t } from './textos/index.js';
import { objectMatrix } from './csg.js';
import { outlineGeometry } from './edges.js';
import { toUser } from './coords.js';
import { fmt } from './editor.js'; // mesmo formato das cotas (vírgula decimal, 2 casas)

// Ferramenta Medir (tecla R), a régua do Tinkercad: clique no ponto inicial e no final; a linha
// tracejada mostra a distância total em mm (editável) e, abaixo, ΔX/ΔY/ΔZ no sistema do usuário
// (src/coords.js: Z para cima). Cada ponto gruda no que estiver a até 12 px do cursor (o mais
// perto ganha):
//   vértice e meio de aresta (arestas reais da peça sob o cursor, as mesmas do contorno de
//   seleção), centro de face circular (dos dados da forma: tampas de cilindro, tubo, cone e
//   polígono, centro de esfera, toroide, meia esfera e paraboloide, também dentro de grupos, como
//   o centro de um furo); se nada disso estiver perto, na face (ponto sob o cursor) ou na grade.
// - Os pontos podem ser arrastados depois; clicar fora deles começa outra medida.
// - Digitar outra distância move a peça do ponto final ao longo da linha até ficar exatamente
//   naquela distância: um editor.change (um desfazer). Ponto final na mesa: só o ponto anda. Os
//   dois pontos na mesma peça (ou a peça bloqueada): aviso e nada muda.
// - A régua não entra no projeto nem no histórico. Esc, R ou o botão de novo encerram.
// - Custo por movimento do mouse: os centros vêm de um cache refeito a cada sync do editor, e as
//   arestas da peça sob o cursor ficam projetadas até a peça ou a vista mudar; a camada SVG só é
//   refeita quando os pontos, o marcador ou a vista mudam.

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12; // distância na tela para grudar em vértice, aresta ou centro
const GRAB_PX = 10; // raio para pegar um ponto já colocado
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r3 = (v) => Math.round(v * 1000) / 1000;

// centros de face circular no espaço da geometria, por tipo (a geometria é centrada no tamanho)
const CENTERS = {
  cylinder: (s) => [V3(0, s[1] / 2, 0), V3(0, -s[1] / 2, 0)],
  tube: (s) => [V3(0, s[1] / 2, 0), V3(0, -s[1] / 2, 0)],
  polygon: (s) => [V3(0, s[1] / 2, 0), V3(0, -s[1] / 2, 0)],
  cone: (s) => [V3(0, s[1] / 2, 0), V3(0, -s[1] / 2, 0)],
  paraboloid: (s) => [V3(0, -s[1] / 2, 0)],
  halfSphere: (s) => [V3(0, -s[1] / 2, 0)],
  sphere: () => [V3()],
  torus: () => [V3()],
};

// centros de todas as peças visíveis, no mundo; rootId = peça do projeto que contém o centro
function circleCenters(objects) {
  const out = [];
  const walk = (o, parent, rootId) => {
    if (o.hidden) return;
    const m = parent.clone().multiply(objectMatrix(o));
    if (o.type === 'group') for (const c of o.children) walk(c, m, rootId);
    else if (CENTERS[o.type]) for (const p of CENTERS[o.type](o.size)) out.push({ p: p.applyMatrix4(m), id: rootId });
  };
  for (const o of objects) walk(o, new THREE.Matrix4(), o.id);
  return out;
}

export class MeasureTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'measure';
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'measure-layer');
    this.svg.style.display = 'none';
    editor.overlay.append(this.svg);
    // rótulo: distância total (botão que vira campo) e, abaixo, as diferenças em X, Y e Z
    const label = (this.label = document.createElement('div'));
    label.className = 'measure-label';
    label.style.display = 'none';
    label.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.totalEl = document.createElement('button');
    this.totalEl.type = 'button';
    this.totalEl.className = 'measure-total';
    this.totalEl.title = t.editor.medir.editar;
    this.totalEl.addEventListener('click', () => this.editTotal());
    this.deltaEl = document.createElement('div');
    this.deltaEl.className = 'measure-deltas';
    label.append(this.totalEl, this.deltaEl);
    this.kindEl = document.createElement('div');
    this.kindEl.className = 'measure-kind';
    this.kindEl.style.display = 'none';
    editor.overlay.append(label, this.kindEl);
    // centros de face circular no mundo: refeitos só quando o projeto muda (sync emite 'change')
    this.centers = null;
    editor.addEventListener('change', () => (this.centers = null));
    this.reset();
  }

  reset() {
    this.pts = []; // [{ p: Vector3 (mundo), kind, id }]
    this.hover = null;
    this.dragIdx = -1;
    this.editing = false;
    this.dirty = true; // a camada SVG e o rótulo precisam ser refeitos (update)
  }

  hint() {
    const m = t.modos.medir;
    return this.pts.length === 0 ? m.inicio : this.pts.length === 1 ? m.fim : m.pronto;
  }

  enter() {
    this.reset();
    this.svg.style.display = '';
    this.ed.viewport.classList.add('measuring');
  }

  exit() {
    if (this.ed.drag && this.ed.drag.kind === 'measure') this.ed.drag = null;
    this.reset();
    this.svg.style.display = 'none';
    this.svg.innerHTML = '';
    this.label.style.display = 'none';
    this.kindEl.style.display = 'none';
    this.ed.viewport.classList.remove('measuring');
  }

  // pontos no mundo -> na tela, com a profundidade na vista: [{ p, id, kind, rank, x, y, depth }]
  onScreen(list) {
    const cam = this.ed.camera;
    const view = cam.getWorldDirection(V3());
    return list.map((c) => {
      const s = this.ed.project(c.p);
      return { ...c, x: s.x, y: s.y, depth: c.p.clone().sub(cam.position).dot(view) };
    });
  }

  // vértices e meios das arestas reais da peça (as do contorno de seleção), já na tela; refeitos só
  // quando a peça, a posição dela ou a vista (vk = editor.viewKey()) mudam
  edgeCandidates(mesh, id, vk) {
    const c = this.edgeCache;
    const mw = mesh.matrixWorld.elements.join();
    if (c && c.mesh === mesh && c.geo === mesh.geometry && c.mw === mw && c.vk === vk) return c.list;
    const pos = outlineGeometry(mesh.geometry, 28).attributes.position;
    const m = mesh.matrixWorld;
    const world = [];
    for (let i = 0; i + 1 < pos.count; i += 2) {
      const a = V3().fromBufferAttribute(pos, i).applyMatrix4(m);
      const b = V3().fromBufferAttribute(pos, i + 1).applyMatrix4(m);
      world.push({ p: a, id, kind: 'vertice', rank: 0 }, { p: b, id, kind: 'vertice', rank: 0 });
      world.push({ p: a.clone().add(b).multiplyScalar(0.5), id, kind: 'aresta', rank: 2 });
    }
    this.edgeCache = { mesh, geo: mesh.geometry, mw, vk, list: this.onScreen(world) };
    return this.edgeCache.list;
  }

  // centros de face circular de todas as peças, na tela (o cache do mundo cai a cada sync)
  centerCandidates(vk) {
    if (!this.centers) this.centers = circleCenters(this.ed.objects).map((c) => ({ ...c, kind: 'centro', rank: 1 }));
    const c = this.centerCache;
    if (c && c.src === this.centers && c.vk === vk) return c.list;
    this.centerCache = { src: this.centers, vk, list: this.onScreen(this.centers) };
    return this.centerCache.list;
  }

  // ponto de snap sob o cursor: { p, kind: 'vertice'|'aresta'|'centro'|'face'|'grade', id }
  snapAt(e) {
    const ed = this.ed;
    const h = ed.surface.hit(e);
    if (!h) return null;
    const cam = ed.camera;
    const view = cam.getWorldDirection(V3()); // também atualiza as matrizes da câmera
    const vk = ed.viewKey();
    const hitDepth = h.point.clone().sub(cam.position).dot(view);
    const tol = hitDepth * 0.01 + 0.5; // candidato atrás da superfície atingida não vale
    const px = ed.pointer;
    // o candidato mais perto do cursor ganha; em empate (menos de ~1 px), vértice > centro > aresta
    let best = null;
    const consider = (c) => {
      const d = Math.hypot(c.x - px.x, c.y - px.y);
      if (d > SNAP_PX || (!h.table && c.depth > hitDepth + tol)) return;
      const score = d + c.rank * 0.5;
      if (!best || score < best.score) best = { c, score };
    };
    if (!h.table) for (const c of this.edgeCandidates(h.mesh, h.id, vk)) consider(c);
    for (const c of this.centerCandidates(vk)) consider(c);
    if (best) return { p: best.c.p.clone(), kind: best.c.kind, id: best.c.id };
    if (h.table) return { p: V3(ed.snap(h.point.x), 0, ed.snap(h.point.z)), kind: 'grade', id: null };
    return { p: h.point.clone(), kind: 'face', id: h.id };
  }

  nearPoint() {
    const px = this.ed.pointer;
    let idx = -1;
    let best = GRAB_PX;
    this.pts.forEach((q, i) => {
      const s = this.ed.project(q.p);
      const d = Math.hypot(s.x - px.x, s.y - px.y);
      if (d <= best) {
        best = d;
        idx = i;
      }
    });
    return idx;
  }

  onDown(e) {
    const ed = this.ed;
    ed.setRay(e);
    if (this.pts.length === 2) {
      const i = this.nearPoint();
      if (i >= 0) {
        this.dragIdx = i;
        ed.drag = { kind: 'measure' };
        return true;
      }
    }
    const s = this.snapAt(e);
    if (!s) return true;
    if (this.pts.length !== 1) this.pts = [s];
    else this.pts.push(s);
    this.dirty = true;
    ed.emit('mode'); // a dica de modo muda com a etapa
    return true;
  }

  onMove(e) {
    const ed = this.ed;
    if (this.dragIdx < 0 && !ed.insideViewport(e)) {
      this.setHover(null);
      return true;
    }
    const s = this.snapAt(e);
    if (this.dragIdx >= 0) {
      if (s) {
        this.pts[this.dragIdx] = s;
        this.dirty = true;
      }
      this.setHover(s);
    } else {
      this.setHover(s);
      ed.renderer.domElement.style.cursor = this.pts.length === 2 && this.nearPoint() >= 0 ? 'grab' : 'crosshair';
    }
    return true;
  }

  // marcador de snap sob o cursor; só pede redesenho se ele mudou
  setHover(s) {
    const h = this.hover;
    const same = s && h ? s.kind === h.kind && s.id === h.id && s.p.equals(h.p) : s === h;
    if (!same) this.dirty = true;
    this.hover = s;
  }

  onUp() {
    if (this.dragIdx >= 0) {
      this.dragIdx = -1;
      this.ed.drag = null;
      this.dirty = true;
    }
    return true;
  }

  distance() {
    return this.pts.length === 2 ? this.pts[0].p.distanceTo(this.pts[1].p) : 0;
  }

  // novo valor da distância: a peça do ponto final anda ao longo da linha (um desfazer)
  setDistance(L) {
    const ed = this.ed;
    if (this.pts.length !== 2 || !(L >= 0)) return;
    const [A, B] = this.pts;
    const d = B.p.clone().sub(A.p);
    const len = d.length();
    if (len < 1e-9) return;
    const target = A.p.clone().addScaledVector(d, L / len);
    const delta = target.clone().sub(B.p);
    const o = B.id ? ed.obj(B.id) : null;
    if (o && A.id === B.id) {
      // os dois pontos na mesma peça: movê-la leva os dois juntos e a distância não mudaria
      ed.emit('aviso', t.avisos.medirMesmaPeca);
      return;
    }
    if (o && o.locked) {
      ed.emit('aviso', t.avisos.medirBloqueada);
      return;
    }
    if (o) ed.change(() => (o.pos = o.pos.map((v, i) => r3(v + delta.getComponent(i)))));
    B.p.copy(target);
    this.dirty = true;
  }

  editTotal() {
    if (this.pts.length !== 2 || this.editing) return;
    this.editing = true;
    const el = this.totalEl;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'measure-input';
    input.value = fmt(this.distance());
    el.replaceWith(input);
    input.focus();
    input.select();
    const done = (apply) => {
      if (!this.editing) return;
      this.editing = false;
      this.dirty = true; // o rótulo volta a mostrar a distância
      const v = parseFloat(input.value.replace(',', '.'));
      input.replaceWith(el);
      if (apply && Number.isFinite(v) && v >= 0) this.setDistance(v);
    };
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  // desenha régua, pontos e marcador de snap quando eles ou a vista (que pode andar) mudam
  update() {
    const ed = this.ed;
    const key = ed.viewKey();
    if (!this.dirty && key === this.drawnKey) return;
    this.dirty = false;
    this.drawnKey = key;
    const P = (p) => ed.project(p);
    let svg = '';
    const ends = this.pts.slice();
    if (ends.length === 1 && this.hover && this.dragIdx < 0) ends.push({ ...this.hover, preview: true });
    if (ends.length === 2) {
      const a = P(ends[0].p);
      const b = P(ends[1].p);
      svg += `<line class="measure-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    }
    for (const q of this.pts) {
      const s = P(q.p);
      svg += `<circle class="measure-end" cx="${s.x}" cy="${s.y}" r="5"/>`;
    }
    const hv = this.hover;
    if (hv && !(this.pts.length === 2 && this.dragIdx < 0 && this.nearPointOf(hv))) {
      const s = P(hv.p);
      svg += snapMark(hv.kind, s.x, s.y);
      this.kindEl.textContent = t.editor.medir.tipos[hv.kind];
      this.kindEl.style.display = 'block';
      this.kindEl.style.transform = `translate(${s.x + 12}px, ${s.y + 10}px)`;
    } else {
      this.kindEl.style.display = 'none';
    }
    this.svg.innerHTML = svg;
    if (ends.length === 2) {
      const a = ends[0].p;
      const b = ends[1].p;
      const m = P(a.clone().add(b).multiplyScalar(0.5));
      const ua = toUser(a);
      const ub = toUser(b);
      if (!this.editing) this.totalEl.textContent = t.editor.medir.total(fmt(a.distanceTo(b)));
      this.deltaEl.textContent = ['X', 'Y', 'Z'].map((k, i) => t.editor.medir.eixo(k, fmt(ub[i] - ua[i]))).join('   ');
      this.label.style.display = 'block';
      this.label.classList.toggle('preview', this.pts.length < 2);
      this.label.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)`;
    } else {
      this.label.style.display = 'none';
    }
  }

  nearPointOf(hv) {
    return this.pts.some((q) => q.p.distanceToSquared(hv.p) < 1e-10);
  }
}

// marcador do snap: quadrado (vértice), losango (meio de aresta), alvo (centro), anel (face), cruz (grade)
function snapMark(kind, x, y) {
  const c = `class="measure-snap ${kind}"`;
  if (kind === 'vertice') return `<rect ${c} x="${x - 5}" y="${y - 5}" width="10" height="10"/>`;
  if (kind === 'aresta') return `<rect ${c} x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" transform="rotate(45 ${x} ${y})"/>`;
  if (kind === 'centro') return `<circle ${c} cx="${x}" cy="${y}" r="7"/><path ${c} d="M${x - 10} ${y}h20M${x} ${y - 10}v20"/>`;
  if (kind === 'grade') return `<path ${c} d="M${x - 6} ${y}h12M${x} ${y - 6}v12"/>`;
  return `<circle ${c} cx="${x}" cy="${y}" r="6"/>`;
}
