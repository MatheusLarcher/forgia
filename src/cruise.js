import * as THREE from 'three';
import { t } from './textos/index.js';

// Ferramenta Cruzeiro (tecla C), como o Cruise do Tinkercad: com a peça selecionada aparece uma
// bolinha na base dela; arrastando pela bolinha, a peça desliza pela superfície das outras peças
// (topo, lateral, face inclinada, grupo com furo), gira para ficar alinhada à face e apoia a base
// nela. A face sob o cursor fica verde (editor.surface). Shift afunda a peça na face: ela fica do
// lado de dentro, com o topo rente à superfície (para furos em paredes). Na mesa, a posição gruda
// na grade como no arraste normal.
// - O giro é sempre calculado a partir da orientação do começo do arraste: o "para cima" da peça
//   (ou da seleção) vai para a normal da face pelo menor giro, mantendo o giro em torno da normal.
// - Várias peças selecionadas andam juntas, como um bloco (caixa da seleção). Peça bloqueada na
//   seleção fica parada, como no arraste normal, e não entra na conta: bolinha, apoio, normal e
//   meia-altura vêm só das peças que se movem.
// - Soltar = um passo de desfazer (commit só no fim). A régua do arraste normal e o Shift+D não mudam.
// - Clicar e arrastar o corpo da peça continua sendo o arraste normal; sem seleção, o modo sai.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r3 = (v) => Math.round(v * 1000) / 1000;

export class CruiseTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'cruise';
    const b = (this.ball = document.createElement('button'));
    b.type = 'button';
    b.className = 'cruise-ball';
    b.title = t.editor.cruzeiro;
    b.setAttribute('aria-label', t.editor.cruzeiro);
    b.style.display = 'none';
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.startDrag(e);
    });
    editor.overlay.append(b);
    // Shift apertado/solto sem mexer o mouse também afunda/levanta na hora
    const shift = (e) => {
      if (e.key === 'Shift' && this.last && this.ed.drag && this.ed.drag.kind === 'cruise') this.apply(this.last, e.shiftKey);
    };
    window.addEventListener('keydown', shift);
    window.addEventListener('keyup', shift);
  }

  movable() {
    return this.ed.selected.filter((o) => !o.locked);
  }

  canEnter() {
    if (this.movable().length) return true;
    this.ed.emit('aviso', t.avisos.cruzeiroSemSelecao);
    return false;
  }

  hint() {
    return t.modos.cruzeiro;
  }

  enter() {
    this.ball.style.display = '';
  }

  exit() {
    this.onUp(); // saiu no meio do arraste: termina como ao soltar (o que andou vira um desfazer)
    this.ball.style.display = 'none';
    this.ball.classList.remove('dragging');
    this.ed.surface.hide();
    this.last = null;
  }

  // base das peças que se movem (a própria peça ou a caixa delas): o ponto que apoia na face
  base() {
    const f = this.ed.getFrame(this.movable());
    if (!f) return null;
    const up = V3(0, 1, 0).applyQuaternion(f.quat);
    return { frame: f, up, half: f.size.y / 2, point: f.pos.clone().addScaledVector(up, -f.size.y / 2) };
  }

  startDrag(e) {
    const ed = this.ed;
    const items = this.movable();
    const b = this.base();
    if (!items.length || !b) return;
    ed.renderer.domElement.focus({ preventScroll: true });
    ed.drag = {
      kind: 'cruise',
      items: items.map((o) => ({ o, pos: V3().fromArray(o.pos), quat: new THREE.Quaternion().fromArray(o.quat) })),
      up0: b.up,
      base0: b.point,
      half: b.half,
      exclude: new Set(items.map((o) => o.id)),
      size: Math.max(b.frame.size.x, b.frame.size.z), // base da peça: tamanho do verde em face curva
      moved: false,
    };
    this.ball.classList.add('dragging');
  }

  // leva a seleção para a superfície sob o cursor
  apply(e, sink) {
    const ed = this.ed;
    const d = ed.drag;
    const s = ed.surface.hit(e, d.exclude);
    if (!s) return;
    const P = s.point.clone();
    if (s.table) {
      P.x = ed.snap(P.x);
      P.z = ed.snap(P.z);
    }
    const R = new THREE.Quaternion().setFromUnitVectors(d.up0, s.normal);
    // sentada: base no ponto; afundada: topo no ponto (a peça inteira do lado de dentro da face)
    const off = sink ? s.normal.clone().multiplyScalar(-2 * d.half) : V3();
    for (const it of d.items) {
      it.o.pos = P.clone().add(it.pos.clone().sub(d.base0).applyQuaternion(R)).add(off).toArray().map(r3);
      it.o.quat = R.clone().multiply(it.quat).normalize().toArray();
    }
    d.moved = true;
    d.sunk = sink;
    ed.surface.show(s, d.size);
    ed.sync();
  }

  onDown() {
    return false; // clique no corpo da peça: seleção e arraste normais
  }

  onMove(e) {
    const d = this.ed.drag;
    if (!d || d.kind !== 'cruise') return false;
    this.last = { clientX: e.clientX, clientY: e.clientY };
    this.apply(this.last, e.shiftKey);
    return true;
  }

  onUp() {
    const ed = this.ed;
    const d = ed.drag;
    if (!d || d.kind !== 'cruise') return false;
    ed.drag = null;
    this.last = null;
    this.ball.classList.remove('dragging');
    ed.surface.hide();
    if (d.moved) ed.commit();
    ed.emit('selection');
    return true;
  }

  // bolinha na base da seleção, reprojetada a cada quadro; sem peça móvel selecionada, o modo sai
  update() {
    if (!this.movable().length) {
      if (!(this.ed.drag && this.ed.drag.kind === 'cruise')) this.ed.setTool(null);
      return;
    }
    const b = this.base();
    if (!b) return;
    const s = this.ed.project(b.point);
    this.ball.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }
}
