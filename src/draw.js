import * as THREE from 'three';
import { t } from './textos/index.js';
import { prepareOutline, smoothOpen, trimSeam } from './outline.js';

// Ferramenta Desenhar (tecla B): contorno fechado na mesa que vira a forma 'desenho'.
// - Ao entrar, a vista vai para o topo ortográfico (desenhar em perspectiva distorce o traço) e o
//   giro da vista fica desligado; ao sair, volta exatamente à vista de antes (editor.restoreView).
// - Arrastar desenha à mão livre (sem grade); clicar põe um vértice reto, grudado na grade. A mão
//   treme num clique: só vira traço depois de DRAG_PX, e o traço guarda o caminho desde o aperto.
// - Enter ou clicar no 1º ponto (com 3 ou mais) fecha; com menos, o clique ali é um vértice comum.
//   Um traço à mão livre começado do zero fecha ao soltar.
// - O traço é limpo por prepareOutline (src/outline.js): suavizado, simplificado (RDP com
//   tolerância em pixels, ou seja, proporcional ao zoom), centrado e anti-horário. Contorno que
//   se cruza, com menos de 3 pontos ou sem área: aviso e nada é criado.
// - A peça nasce com 2 mm de altura (sobe pela alça de cima) num único editor.change: um desfazer.
// O traço em andamento é desenhado numa camada SVG da sobreposição (cores do tema via CSS), refeita
// só quando os pontos, o cursor ou a vista mudam.

const SVGNS = 'http://www.w3.org/2000/svg';
const DRAG_PX = 10; // arrastar mais que isso (px) = mão livre; menos = clique (com a tremida da mão)
const SAMPLE_PX = 3; // distância mínima entre amostras da mão livre (px)
const CLOSE_PX = 10; // raio (px) em volta do 1º ponto em que o clique fecha o contorno
const RDP_PX = 1.5; // tolerância da simplificação, em pixels de tela
const TABLE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const TOP = new THREE.Vector3(0, 1, 0);

export class DrawTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'draw';
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'draw-layer');
    this.svg.style.display = 'none';
    editor.overlay.append(this.svg);
    this.reset();
  }

  reset() {
    this.points = []; // [[x, z], ...] em mm, na ordem do traço
    this.hasFree = false; // algum trecho à mão livre (só então simplifica)
    this.stroke = null; // mão livre em andamento
    this.down = null;
    this.cursor = null;
    this.closing = false; // cursor sobre o 1º ponto (com 3 ou mais): o clique fecha
    this.dirty = true; // o SVG precisa ser refeito (update)
    this.svg.innerHTML = '';
  }

  hint() {
    return t.modos.desenhar;
  }

  enter() {
    const ed = this.ed;
    this.view = ed.saveView();
    ed.select([]);
    ed.setOrtho(true);
    ed.viewFrom(TOP);
    ed.controls.enableRotate = false;
    ed.viewport.classList.add('drawing');
    this.svg.style.display = '';
    this.reset();
  }

  exit() {
    const ed = this.ed;
    this.reset();
    this.svg.style.display = 'none';
    ed.viewport.classList.remove('drawing');
    ed.controls.enableRotate = true;
    ed.restoreView(this.view);
    this.view = null;
  }

  // ponto da mesa sob o cursor (a vista é de topo, então o raio sempre cruza o plano)
  tablePoint(e) {
    this.ed.setRay(e);
    const p = new THREE.Vector3();
    return this.ed.raycaster.ray.intersectPlane(TABLE, p) ? [p.x, p.z] : null;
  }

  snapped([x, z]) {
    return [this.ed.snap(x), this.ed.snap(z)];
  }

  screen([x, z]) {
    return this.ed.project(new THREE.Vector3(x, 0, z));
  }

  nearFirst() {
    if (!this.points.length) return false;
    const s = this.screen(this.points[0]);
    const p = this.ed.pointer;
    return Math.hypot(s.x - p.x, s.y - p.y) <= CLOSE_PX;
  }

  onDown(e) {
    const p = this.tablePoint(e);
    // pts/last: amostras do caminho desde o aperto (viram o começo do traço se ele passar de DRAG_PX)
    if (p) this.down = { x: e.clientX, y: e.clientY, p, pts: [p], last: { x: e.clientX, y: e.clientY } };
    return true;
  }

  onMove(e) {
    const d = this.down;
    if (!d && !this.ed.insideViewport(e)) {
      if (this.cursor) this.dirty = true;
      this.cursor = null;
      return true;
    }
    const p = this.tablePoint(e);
    if (!p) return true;
    if (d && e.buttons & 1) {
      const s = this.stroke || d;
      if (Math.hypot(e.clientX - s.last.x, e.clientY - s.last.y) >= SAMPLE_PX) {
        s.pts.push(p);
        s.last = { x: e.clientX, y: e.clientY };
        if (this.stroke) this.dirty = true;
      }
      if (!this.stroke && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) {
        // virou traço: mão livre a partir do ponto onde apertou, com o caminho feito até aqui
        this.stroke = { pts: d.pts, last: d.last, alone: !this.points.length };
      }
    }
    const cursor = this.stroke ? null : this.snapped(p);
    const closing = !this.stroke && this.points.length >= 3 && this.nearFirst();
    if (closing !== this.closing || String(cursor) !== String(this.cursor)) this.dirty = true;
    this.cursor = cursor;
    this.closing = closing;
    return true;
  }

  onUp(e) {
    const d = this.down;
    this.down = null;
    if (!d) return true;
    this.dirty = true;
    const s = this.stroke;
    if (s) {
      this.stroke = null;
      const p = this.tablePoint(e);
      if (p) s.pts.push(p);
      const pts = smoothOpen(s.pts, 2);
      this.hasFree = true;
      if (s.alone) {
        // traço à mão livre começado do zero: fecha sozinho ao soltar (a sobra na emenda sai)
        this.points = trimSeam(pts);
        this.finish();
      } else {
        this.points.push(...pts);
      }
      return true;
    }
    this.ed.setRay(e);
    if (this.points.length >= 3 && this.nearFirst()) this.finish();
    else this.points.push(this.snapped(d.p));
    return true;
  }

  onKey(e) {
    if (e.key !== 'Enter' || !this.points.length) return false;
    this.finish();
    return true;
  }

  // fecha o contorno: cria a peça ou avisa por que não dá
  finish() {
    const ed = this.ed;
    const tolerance = this.hasFree ? RDP_PX * ed.pixelSize(ed.controls.target) : 0;
    const res = prepareOutline(this.points, { tolerance });
    if (!res.ok) {
      ed.emit('aviso', t.avisos.desenho[res.reason]);
      this.reset();
      return;
    }
    const o = ed.createObject('desenho', { params: { points: res.points } });
    o.pos = [res.center[0], o.size[1] / 2, res.center[1]];
    ed.setTool(null);
    ed.change(() => ed.objects.push(o));
    ed.select([o.id]);
  }

  // redesenha o traço quando ele, o cursor ou a vista (anda e muda o zoom durante o desenho) mudam
  update() {
    const key = this.ed.viewKey();
    if (!this.dirty && key === this.drawnKey) return;
    this.dirty = false;
    this.drawnKey = key;
    const pts = this.stroke ? [...this.points, ...this.stroke.pts] : this.points;
    if (!pts.length && !this.cursor) {
      if (this.svg.firstChild) this.svg.innerHTML = '';
      return;
    }
    const sp = pts.map((p) => this.screen(p));
    const xy = (s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
    let svg = '';
    if (sp.length > 1) svg += `<polygon class="draw-fill" points="${sp.map(xy).join(' ')}"/>`;
    if (sp.length) svg += `<polyline class="draw-path" points="${sp.map(xy).join(' ')}"/>`;
    if (this.cursor && sp.length && !this.closing) {
      const c = this.screen(this.cursor);
      const last = sp[sp.length - 1];
      svg += `<line class="draw-rubber" x1="${last.x}" y1="${last.y}" x2="${c.x}" y2="${c.y}"/>`;
    }
    // vértices dos cliques (a mão livre não mostra pontos); o 1º fica maior e cheio ao fechar
    if (!this.hasFree && !this.stroke) {
      sp.forEach((s, i) => {
        if (i) svg += `<circle class="draw-vertex" cx="${s.x}" cy="${s.y}" r="3.5"/>`;
      });
    }
    if (sp.length) svg += `<circle class="draw-first${this.closing ? ' closing' : ''}" cx="${sp[0].x}" cy="${sp[0].y}" r="${this.closing ? 7 : 5}"/>`;
    if (this.cursor && !this.closing) {
      const c = this.screen(this.cursor);
      svg += `<circle class="draw-cursor" cx="${c.x}" cy="${c.y}" r="4"/>`;
    }
    this.svg.innerHTML = svg;
  }
}
