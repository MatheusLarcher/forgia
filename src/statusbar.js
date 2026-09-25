import * as THREE from 'three';
import { t } from './textos/index.js';
import { fmt } from './editor.js';

const r2 = (v) => Math.round(v * 100) / 100 || 0;
import { selectionSummary } from './ponte-comandos.js';

// Barra de status: X/Y/Z e medidas da seleção no sistema do usuário (o MESMO cálculo do
// forgia_estado, src/ponte-comandos.js), o rótulo do Plano de trabalho quando ativo, indicador da
// IA, botão Conectar IA e o crédito LarcherTech na ponta direita (HTML fixo do index.html).
// Também mostra o aviso da IA no canto da vista ("IA: criou 2, alterou 1 · Desfazer").
export class StatusBar {
  constructor(editor, ponte, { onConnect }) {
    this.ed = editor;
    this.ponte = ponte;
    this.coordsEl = document.getElementById('sb-coords');
    this.sizeEl = document.getElementById('sb-size');
    this.iaEl = document.getElementById('sb-ia');
    this.iaText = this.iaEl.querySelector('.sb-ia-texto');
    document.getElementById('btn-conectar-ia').addEventListener('click', onConnect);
    this.iaEl.addEventListener('click', onConnect);
    const refresh = () => this.refreshCoords();
    editor.addEventListener('change', refresh);
    editor.addEventListener('selection', refresh);
    // plano de trabalho: X/Y/Z relativos a ele e o rótulo "Plano de trabalho"
    this.planeEl = document.getElementById('sb-plano');
    this.planeEl.textContent = t.status.plano;
    editor.addEventListener('plano', refresh);
    // "Limpar marcações (n)" só aparece com marcações na vista (Marcar parte)
    this.marksBtn = document.getElementById('btn-limpar-marcas');
    this.marksBtn.addEventListener('click', () => editor.clearMarks());
    editor.addEventListener('marcas', () => this.refreshMarks());
    this.refreshMarks();
    ponte.addEventListener('estado', (e) => this.refreshIa(e.detail.status));
    ponte.addEventListener('aviso', (e) => this.notice(e.detail));
    this.refreshCoords();
    this.refreshIa(ponte.status);
  }

  refreshCoords() {
    const wp = this.ed.wplane;
    this.planeEl.hidden = !wp;
    const s = selectionSummary(this.ed);
    if (s && wp) {
      // relativo ao plano: centro nos eixos dele (Z = altura pela normal); medidas das peças
      const sel = this.ed.selected;
      if (sel.length === 1) s.centro = wp.toUser(new THREE.Vector3().fromArray(sel[0].pos)).map(r2);
      else {
        const f = this.ed.getFrame(sel);
        s.centro = wp.toUser(f.pos).map(r2);
        s.medidas = [f.size.x, f.size.z, f.size.y].map(r2);
      }
    }
    if (!s) {
      this.coordsEl.textContent = t.status.semSelecao;
      this.sizeEl.textContent = '';
      return;
    }
    const [x, y, z] = s.centro.map(fmt);
    this.coordsEl.textContent = t.status.centro(x, y, z);
    this.sizeEl.textContent = t.status.medidas(...s.medidas.map(fmt)) + (s.n > 1 ? ' · ' + t.status.selecionadas(s.n) : '');
  }

  refreshMarks() {
    const n = (this.ed.marks || []).length;
    this.marksBtn.hidden = !n;
    this.marksBtn.textContent = t.marcar.limparN(n);
  }

  refreshIa(status) {
    this.iaEl.dataset.estado = status;
    this.iaText.textContent = t.ia.estados[status];
    this.iaEl.setAttribute('aria-label', t.ia.estados[status]);
    this.iaEl.dataset.dica = 'ia_' + status;
  }

  // aviso no canto; "Desfazer" só enquanto o passo da IA for o último do histórico
  notice({ text, undo, index, ms }) {
    const vp = document.getElementById('viewport');
    let el = vp.querySelector('.ia-aviso');
    if (el) el.remove();
    el = document.createElement('div');
    el.className = 'ia-aviso';
    el.setAttribute('role', 'status');
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    if (undo) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t.ia.desfazer;
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        if (this.ed.historyIndex === index) this.ed.undo();
        close();
      });
      el.append(document.createTextNode(' · '), btn);
    }
    vp.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    };
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(close, ms);
  }
}
