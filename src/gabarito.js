import * as THREE from 'three';
import { t } from './textos/index.js';

// Gabarito dos atalhos da vista (girar, andar com WASD, roda do mouse), no canto de baixo à
// esquerda. Discreto e só com a vista afastada: aparece na vista inicial (a mesa inteira na tela)
// e some ao aproximar, com uma ferramenta ou modo ligado (a dica de modo ocupa o rodapé) e ao
// colocar forma da biblioteca. update() roda a cada quadro e só mexe no DOM quando o estado muda.

// fração da altura visível da vista inicial a partir da qual a vista conta como "afastada"
const LONGE = 0.8;

export class ViewShortcuts {
  constructor(editor) {
    this.ed = editor;
    this.on = null;
    const el = (this.el = document.createElement('div'));
    el.className = 'gabarito';
    el.setAttribute('aria-hidden', 'true'); // os mesmos atalhos estão no diálogo Atalhos
    for (const [teclas, acao] of t.vista.gabarito) {
      const row = document.createElement('div');
      row.className = 'gabarito-linha';
      const keys = document.createElement('span');
      keys.className = 'gabarito-teclas';
      for (const k of teclas) keys.append(Object.assign(document.createElement(k === '+' ? 'span' : 'kbd'), { textContent: k }));
      row.append(keys, Object.assign(document.createElement('span'), { textContent: acao }));
      el.append(row);
    }
    editor.viewport.append(el);
  }

  // altura (mm) que a vista mostra no alvo, em perspectiva ou ortográfica
  viewHeight() {
    const ed = this.ed;
    if (ed.isOrtho) return (ed.orthoCam.top - ed.orthoCam.bottom) / ed.orthoCam.zoom;
    const dist = ed.camera.position.distanceTo(ed.controls.target);
    return 2 * dist * Math.tan(THREE.MathUtils.degToRad(ed.perspCam.fov / 2));
  }

  update() {
    const ed = this.ed;
    const home = 2 * Math.max(ed.workplane.w, ed.workplane.l) * 1.65 * Math.tan(THREE.MathUtils.degToRad(ed.perspCam.fov / 2));
    const on = !ed.tool && !ed.mode && !ed.placing && this.viewHeight() >= home * LONGE;
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('visivel', on);
  }
}
