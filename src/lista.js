import { t } from './textos/index.js';
import { ICONS } from './icons.js';
import { SHAPES } from './shapes.js';
import { locate, snapshotChain, renormalize } from './ponte-comandos.js';

// Lista de objetos (aba "Objetos" do painel lateral): a árvore do projeto com grupos e partes,
// inclusive ocultos e bloqueados, e o que a IA criou (é tudo editor.objects).
// - clique seleciona (Shift/Ctrl soma); numa parte de grupo, seleciona o grupo do topo (a seleção
//   do editor é só de peças do topo);
// - olho oculta/mostra, cadeado bloqueia/desbloqueia, duplo clique no nome renomeia: cada um é um
//   editor.change (um desfazer). Ocultar uma parte muda a booleana do grupo; renormalize() mantém
//   o resto do grupo no lugar, como nos comandos da IA;
// - a árvore só é refeita quando algo que ela mostra muda (assinatura), não a cada quadro de arraste.

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  return e;
}

export class ObjectList {
  constructor(editor, { toast }) {
    this.ed = editor;
    this.toast = toast;
    this.root = $('#obj-list');
    this.countEl = $('#obj-count');
    this.expanded = new Set();
    this.sig = '';
    this.visible = false;
    this.pending = false;
    const refresh = () => this.schedule();
    for (const ev of ['change', 'selection', 'projeto']) editor.addEventListener(ev, refresh);
    this.schedule();
  }

  setVisible(on) {
    this.visible = on;
    if (on) {
      this.sig = '';
      this.render();
    }
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  // o que a lista mostra; igual = nada a refazer
  signature() {
    const walk = (list) => list.map((o) => [o.id, o.name, o.type, o.hidden ? 1 : 0, o.locked ? 1 : 0, o.hole ? 1 : 0, o.color || '', o.children ? walk(o.children) : 0]);
    return JSON.stringify([walk(this.ed.objects), this.ed.selection, [...this.expanded]]);
  }

  render() {
    const n = this.ed.objects.length;
    this.countEl.textContent = n ? String(n) : '';
    if (!this.visible || this.editing) return;
    const sig = this.signature();
    if (sig === this.sig) return;
    this.sig = sig;
    const sel = new Set(this.ed.selection);
    const rows = [];
    const add = (o, level, top) => {
      rows.push(this.row(o, level, top, sel.has(o.id)));
      if (o.children && this.expanded.has(o.id)) for (const c of o.children) add(c, level + 1, top);
    };
    for (const o of this.ed.objects) add(o, 1, o);
    this.root.replaceChildren(...rows);
    if (!rows.length) this.root.append(el('div', 'obj-vazia'));
    if (!rows.length) this.root.lastChild.textContent = t.lista.vazia;
    const first = this.root.querySelector('.obj-row.sel');
    if (first) first.scrollIntoView({ block: 'nearest' });
  }

  row(o, level, top, selected) {
    const isGroup = o.type === 'group';
    const part = level > 1;
    const r = el('div', 'obj-row' + (selected ? ' sel' : '') + (o.hidden ? ' oculto' : '') + (o.locked ? ' bloqueado' : '') + (part ? ' parte' : ''), {
      role: 'treeitem',
      'aria-level': level,
      'aria-selected': String(selected),
      'aria-expanded': isGroup ? String(this.expanded.has(o.id)) : null,
      'data-id': o.id,
    });
    r.style.setProperty('--nivel', level - 1);
    // abrir/fechar as partes do grupo
    if (isGroup) {
      const open = this.expanded.has(o.id);
      const tg = el('button', 'obj-toggle' + (open ? ' aberto' : ''), { type: 'button', 'aria-label': open ? t.lista.fecharGrupo : t.lista.abrirGrupo });
      tg.innerHTML = ICONS.chevronRight;
      tg.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) this.expanded.delete(o.id);
        else this.expanded.add(o.id);
        this.render();
      });
      r.append(tg);
    } else r.append(el('span', 'obj-toggle vazio'));
    // amostra da cor (furo listrado, grupo multicolorido em degradê)
    const sw = el('span', 'obj-swatch' + (o.hole ? ' furo' : isGroup && !o.color ? ' multi' : ''));
    if (!o.hole && (!isGroup || o.color)) sw.style.background = o.color || 'var(--line-strong)';
    r.append(sw);
    const name = el('span', 'obj-nome');
    name.textContent = o.name || (SHAPES[o.type] ? SHAPES[o.type].label : o.type);
    r.append(name);
    const meta = el('span', 'obj-meta');
    meta.textContent = isGroup ? t.lista.partes(o.children.length) : o.hole ? t.lista.furo : '';
    r.append(meta);
    const eye = el('button', 'obj-btn obj-olho' + (o.hidden ? ' on' : ''), { type: 'button', 'aria-label': o.hidden ? t.lista.mostrar : t.lista.ocultar, 'aria-pressed': String(!!o.hidden), 'data-dica': 'listaOcultar' });
    eye.innerHTML = o.hidden ? ICONS.hide : ICONS.showAll;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setProps(o.id, { hidden: !o.hidden });
    });
    const lock = el('button', 'obj-btn obj-cadeado' + (o.locked ? ' on' : ''), { type: 'button', 'aria-label': o.locked ? t.lista.desbloquear : t.lista.bloquear, 'aria-pressed': String(!!o.locked), 'data-dica': 'listaBloquear' });
    lock.innerHTML = o.locked ? ICONS.lock : ICONS.unlock;
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setProps(o.id, { locked: !o.locked });
    });
    r.append(eye, lock);
    r.addEventListener('click', (e) => {
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      this.ed.select([top.id], add ? { toggle: true } : {});
    });
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.rename(o, name);
    });
    return r;
  }

  // oculto / bloqueado / nome num objeto de qualquer nível: um editor.change (um desfazer)
  setProps(id, patch) {
    const ed = this.ed;
    const loc = locate(ed.objects, id);
    if (!loc) return;
    if (patch.hidden && loc.parent && loc.parent.children.filter((c) => !c.hidden && c !== loc.o).length === 0) {
      this.toast(t.lista.ultimaParte);
      return;
    }
    ed.change(() => {
      const before = snapshotChain(loc.chain);
      if ('hidden' in patch) loc.o.hidden = !!patch.hidden;
      if ('locked' in patch) loc.o.locked = !!patch.locked;
      if ('name' in patch) loc.o.name = patch.name;
      if (loc.chain.length && 'hidden' in patch) renormalize(before);
    });
    if (patch.hidden && !loc.parent && ed.selection.includes(id)) ed.select(ed.selection.filter((s) => s !== id));
    ed.emit('selection');
  }

  rename(o, nameEl) {
    this.editing = true;
    const input = el('input', 'obj-renomear', { type: 'text', maxlength: '80', 'aria-label': t.lista.renomear, spellcheck: 'false' });
    input.value = o.name || '';
    nameEl.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      this.editing = false;
      const v = input.value.trim().slice(0, 80);
      this.sig = '';
      if (apply && v && v !== o.name) this.setProps(o.id, { name: v });
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  }
}
