import { t } from './textos/index.js';
import { fmt } from './editor.js';
import { selectionSummary } from './ponte-comandos.js';

// Barra de status mínima (Fase C): X/Y/Z e medidas da seleção no sistema do usuário (o MESMO
// cálculo do forgia_estado, src/ponte-comandos.js), indicador da IA e botão Conectar IA.
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
    const s = selectionSummary(this.ed);
    if (!s) {
      this.coordsEl.textContent = t.status.semSelecao;
      this.sizeEl.textContent = '';
      return;
    }
    const [x, y, z] = s.centro.map(fmt);
    this.coordsEl.textContent = t.status.centro(x, y, z);
    this.sizeEl.textContent = t.status.medidas(...s.medidas.map(fmt));
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
