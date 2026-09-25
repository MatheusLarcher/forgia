import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parse3MF } from './threemf.js';

const AREA_PRESETS = [
  ['255³ (padrão)', 255, 255, 255],
  ['256³ Bambu A1/P1', 256, 256, 256],
  ['180³ A1 mini', 180, 180, 180],
  ['250×210×220 Prusa', 250, 210, 220],
  ['220×220×250 Ender 3', 220, 220, 250],
  ['300³ grande', 300, 300, 300],
];
import { SHAPES, PALETTE, registerMesh } from './shapes.js';
import { ICONS } from './icons.js';
import { renderThumbnails } from './thumbs.js';
import { gpuInfo } from './gpu.js';
import { fmt } from './editor.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

const BASIC = [
  { type: 'box', hole: true, label: 'Caixa (furo)' },
  { type: 'cylinder', hole: true, label: 'Cilindro (furo)' },
  { type: 'box' },
  { type: 'cylinder' },
  { type: 'sphere' },
  { type: 'roof' },
  { type: 'cone' },
  { type: 'roundRoof' },
  { type: 'text' },
  { type: 'wedge' },
  { type: 'pyramid' },
  { type: 'halfSphere' },
  { type: 'polygon' },
  { type: 'paraboloid' },
  { type: 'torus' },
  { type: 'tube' },
  { type: 'star' },
  { type: 'heart' },
  { type: 'icosahedron' },
];
const LETTER_COLORS = ['#e3302d', '#f38a00', '#f7c511', '#3fb34f', '#1b8bd2', '#8e44ad'];
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((ch, i) => ({
  type: 'text',
  params: { text: ch },
  label: ch,
  name: ch,
  color: LETTER_COLORS[i % LETTER_COLORS.length],
}));
const CATEGORIES = { basic: BASIC, letters: LETTERS };
const labelOf = (spec) => spec.label || SHAPES[spec.type].label;

export class UI {
  constructor(editor) {
    this.ed = editor;
    this.thumbs = new Map();
    this.paletteOpen = false;
    this.collapsed = false;
    this.initIcons();
    this.initTopbar();
    this.initToolbar();
    this.initView();
    this.initLibrary();
    this.initKeys();
    this.initMisc();

    const ed = editor;
    ed.addEventListener('selection', () => this.refresh());
    ed.addEventListener('history', () => this.refresh());
    ed.addEventListener('mode', () => this.refresh());
    ed.addEventListener('clipboard', () => this.refreshToolbar());
    ed.addEventListener('camera', () => this.refreshView());
    this.refresh();
  }

  initIcons() {
    for (const b of $$('[data-cmd]')) b.innerHTML = ICONS[b.dataset.cmd] || '';
    const viewIcons = { home: 'home', fit: 'fit', in: 'plus', out: 'minus', ortho: 'cube' };
    for (const b of $$('[data-view]')) b.innerHTML = ICONS[viewIcons[b.dataset.view]];
    $('#btn-new').innerHTML = ICONS.grid;
    $('.search-ico').innerHTML = ICONS.search;
  }

  // ---------- barra superior ----------
  initTopbar() {
    const name = $('#design-name');
    name.value = this.ed.name;
    name.addEventListener('change', () => this.ed.setName(name.value.trim()));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    $('#btn-new').addEventListener('click', () =>
      this.confirm('Novo projeto', 'Começar um projeto vazio? O projeto atual será apagado deste navegador.', 'Novo projeto', () => {
        this.ed.newDesign();
        this.ed.setName('Meu projeto 3D');
        name.value = this.ed.name;
      }),
    );
    $('#btn-export').addEventListener('click', () => this.exportDialog());
    $('#btn-help').addEventListener('click', () => this.helpDialog());
    $('#btn-import').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.importFile(f);
    });
    // importar arrastando arquivos para a janela
    const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      for (const f of e.dataTransfer.files) this.importFile(f);
    });
    $('#btn-settings').addEventListener('click', () => this.settingsDialog());
    const area = $('#area-select');
    const fillArea = () => {
      const { w, l, h: hh } = this.ed.workplane;
      const cur = `${w}x${l}x${hh}`;
      const opts = AREA_PRESETS.map(([t, a, b, c]) => [`${a}x${b}x${c}`, t]);
      if (!opts.some(([v]) => v === cur)) opts.unshift([cur, `${w}×${l}×${hh}`]);
      opts.push(['custom', 'Personalizado…']);
      area.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
      area.value = cur;
    };
    fillArea();
    this.ed.addEventListener('workplane', fillArea);
    area.addEventListener('change', () => {
      if (area.value === 'custom') {
        fillArea();
        this.settingsDialog();
      } else {
        const [a, b, c] = area.value.split('x').map(Number);
        this.ed.setWorkplane(a, b, c);
      }
      area.blur();
    });
    const snap = $('#snap-select');
    snap.value = String(this.ed.grid);
    snap.addEventListener('change', () => {
      this.ed.setGrid(parseFloat(snap.value));
      snap.blur();
    });
  }

  initToolbar() {
    const ed = this.ed;
    const cmds = {
      copy: () => ed.copy(),
      paste: () => ed.paste(),
      duplicate: () => ed.duplicate(),
      delete: () => ed.deleteSelected(),
      undo: () => ed.undo(),
      redo: () => ed.redo(),
      showAll: () => ed.showAll(),
      group: () => ed.group(),
      ungroup: () => ed.ungroup(),
      align: () => ed.setMode('align'),
      mirror: () => ed.setMode('mirror'),
    };
    for (const b of $$('[data-cmd]')) b.addEventListener('click', () => cmds[b.dataset.cmd]());
  }

  refreshToolbar() {
    const ed = this.ed;
    const n = ed.selection.length;
    const en = {
      copy: n > 0,
      paste: !!ed.clipboard,
      duplicate: n > 0,
      delete: n > 0,
      undo: ed.historyIndex > 0,
      redo: ed.historyIndex < ed.history.length - 1,
      showAll: ed.objects.some((o) => o.hidden),
      group: n > 1,
      ungroup: ed.selected.some((o) => o.type === 'group'),
      align: n > 1,
      mirror: n > 0,
    };
    for (const b of $$('[data-cmd]')) {
      b.disabled = !en[b.dataset.cmd];
      b.classList.toggle('active', ed.mode === b.dataset.cmd);
    }
  }

  // ---------- navegação ----------
  initView() {
    const ed = this.ed;
    const act = {
      home: () => ed.homeView(),
      fit: () => ed.fitView(),
      in: () => ed.zoomBy(1.3),
      out: () => ed.zoomBy(1 / 1.3),
      ortho: () => ed.setOrtho(!ed.isOrtho),
    };
    for (const b of $$('[data-view]')) b.addEventListener('click', () => act[b.dataset.view]());
  }

  refreshView() {
    const b = $('[data-view="ortho"]');
    b.innerHTML = this.ed.isOrtho ? ICONS.cubeOrtho : ICONS.cube;
    b.classList.toggle('active', this.ed.isOrtho);
  }

  // ---------- biblioteca de formas ----------
  initLibrary() {
    const cat = $('#lib-category');
    const search = $('#lib-search');
    cat.addEventListener('change', () => this.renderLibrary());
    search.addEventListener('input', () => this.renderLibrary());
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.renderLibrary();
  }

  thumbsFor(key, specs) {
    if (!this.thumbs.has(key)) this.thumbs.set(key, renderThumbnails(specs));
    return this.thumbs.get(key);
  }

  renderLibrary() {
    const key = $('#lib-category').value;
    const specs = CATEGORIES[key];
    const imgs = this.thumbsFor(key, specs);
    const q = $('#lib-search').value.trim().toLowerCase();
    const grid = $('#lib-grid');
    grid.innerHTML = '';
    grid.classList.toggle('letters', key === 'letters');
    specs.forEach((spec, i) => {
      const label = labelOf(spec);
      if (q && !label.toLowerCase().includes(q)) return;
      const tile = h(
        'div',
        { class: 'tile', 'data-label': label, title: '' },
        h('img', { src: imgs[i], alt: label, draggable: 'false' }),
        h('span', { class: 'tile-label' }, label),
      );
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const { label: _l, ...rest } = spec;
        this.ed.startPlacing({ ...rest, name: spec.name || SHAPES[spec.type].label });
        this.ed.placing.tileDrag = true;
        this.refreshHint();
      });
      grid.append(tile);
    });
    if (!grid.children.length) grid.append(h('div', { class: 'lib-empty' }, 'Nenhuma forma encontrada'));
  }

  // ---------- inspetor ----------
  refresh() {
    this.refreshToolbar();
    this.renderInspector();
    this.refreshHint();
    this.refreshView();
  }

  refreshHint() {
    const ed = this.ed;
    const hint = $('#hint');
    let t = '';
    if (ed.placing) t = 'Clique no plano de trabalho para posicionar a forma — Esc cancela';
    else if (ed.mode === 'align') t = 'Clique num ponto preto para alinhar. Clique numa forma selecionada para usá-la como referência.';
    else if (ed.mode === 'mirror') t = 'Clique numa seta para espelhar a seleção naquele eixo.';
    hint.textContent = t;
    hint.style.display = t ? 'block' : 'none';
  }

  renderInspector() {
    const ed = this.ed;
    const box = $('#inspector');
    const sel = ed.selected;
    if (!sel.length) {
      box.classList.add('hidden');
      this.paletteOpen = false;
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = '';
    const single = sel.length === 1 ? sel[0] : null;
    const allHole = sel.every((o) => o.hole);
    const locked = sel.every((o) => o.locked);
    const color = single ? single.color : sel.every((o) => o.color === sel[0].color) ? sel[0].color : null;
    const multicolor = single && single.type === 'group' && !single.color;

    const title = single ? single.name : `Formas (${sel.length})`;
    const head = h(
      'div',
      { class: 'insp-head' },
      h('span', { class: 'insp-title' }, title),
      h('button', {
        class: 'icon-btn tiny' + (locked ? ' active' : ''),
        title: locked ? 'Desbloquear (Ctrl+L)' : 'Bloquear (Ctrl+L)',
        html: locked ? ICONS.lock : ICONS.unlock,
        onclick: () => ed.setLocked(!locked),
      }),
      h('button', { class: 'icon-btn tiny', title: 'Ocultar (Ctrl+H)', html: ICONS.bulb, onclick: () => ed.hideSelected() }),
      h('button', {
        class: 'icon-btn tiny collapse' + (this.collapsed ? ' up' : ''),
        title: this.collapsed ? 'Expandir' : 'Recolher',
        html: ICONS.chevron,
        onclick: () => {
          this.collapsed = !this.collapsed;
          this.renderInspector();
        },
      }),
    );
    box.append(head);
    if (this.collapsed) return;

    const swatch = h('span', { class: 'swatch' + (multicolor ? ' multi' : '') });
    if (!multicolor) swatch.style.background = color || '#ccc';
    const solidBtn = h(
      'button',
      {
        class: 'sh-btn' + (!allHole ? ' active' : ''),
        onclick: () => {
          if (allHole) ed.setHole(false);
          this.paletteOpen = !this.paletteOpen || allHole;
          this.renderInspector();
        },
      },
      swatch,
      h('span', {}, 'Sólido'),
    );
    const holeBtn = h(
      'button',
      {
        class: 'sh-btn hole' + (allHole ? ' active' : ''),
        onclick: () => {
          this.paletteOpen = false;
          ed.setHole(true);
        },
      },
      h('span', { class: 'swatch hole-swatch' }),
      h('span', {}, 'Furo'),
    );
    box.append(h('div', { class: 'insp-body' }, h('div', { class: 'solid-hole' }, solidBtn, holeBtn)));
    const body = $('.insp-body', box);

    if (this.paletteOpen && !allHole) body.append(this.palette(single, color, multicolor));

    if (single && single.type !== 'group' && SHAPES[single.type].params.length) {
      for (const p of SHAPES[single.type].params) body.append(this.paramRow(single, p));
    }
    if (single && single.type === 'group') {
      body.append(h('div', { class: 'insp-note' }, `${single.children.length} formas agrupadas`));
    }
  }

  palette(single, color, multicolor) {
    const ed = this.ed;
    const wrap = h('div', { class: 'palette' });
    const grid = h('div', { class: 'palette-grid' });
    for (const c of PALETTE) {
      const b = h('button', {
        class: 'pal' + (!multicolor && color && color.toLowerCase() === c ? ' on' : ''),
        title: c,
        onclick: () => ed.setColor(c),
      });
      b.style.background = c;
      grid.append(b);
    }
    wrap.append(grid);
    const custom = h('input', { type: 'color', value: color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#e3302d' });
    custom.addEventListener('change', () => ed.setColor(custom.value));
    const row = h('div', { class: 'palette-row' }, h('label', { class: 'custom' }, custom, h('span', {}, 'Personalizado')));
    if (single && single.type === 'group') {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = multicolor;
      cb.addEventListener('change', () => {
        if (cb.checked) ed.setColor(null);
        else ed.setColor(PALETTE[0]);
      });
      row.append(h('label', { class: 'multi-cb' }, cb, h('span', {}, 'Multicolorido')));
    }
    wrap.append(row);
    return wrap;
  }

  paramRow(o, p) {
    const ed = this.ed;
    const value = o.params[p.key];
    if (p.kind === 'text') {
      const input = h('input', { type: 'text', class: 'param-text', value, maxlength: '40' });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('input', () => ed.setParam(p.key, input.value, false));
      input.addEventListener('change', () => ed.commit());
      return h('div', { class: 'param' }, h('label', {}, p.label), input);
    }
    const range = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value });
    const num = h('input', { type: 'number', min: p.min, max: p.max, step: p.step, value });
    num.addEventListener('keydown', (e) => e.stopPropagation());
    range.addEventListener('input', () => {
      num.value = range.value;
      ed.setParam(p.key, parseFloat(range.value), false);
    });
    range.addEventListener('change', () => ed.commit());
    num.addEventListener('change', () => {
      let v = parseFloat(String(num.value).replace(',', '.'));
      if (!Number.isFinite(v)) v = p.value;
      v = Math.min(p.max, Math.max(p.min, v));
      num.value = v;
      range.value = v;
      ed.setParam(p.key, v, true);
    });
    return h('div', { class: 'param' }, h('label', {}, p.label), h('div', { class: 'param-ctl' }, range, num));
  }

  // ---------- teclado ----------
  initKeys() {
    const ed = this.ed;
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ($('.modal-back')) {
        if (e.key === 'Escape') this.closeModal();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const step = (ed.grid || 1) * (e.shiftKey ? 10 : 1);
      let handled = true;
      if (!ctrl && !e.altKey && !e.shiftKey && 'wasd'.includes(k) && k.length === 1) {
        ed.moveKeys.add(k);
        e.preventDefault();
        return;
      }
      if (ctrl && k === 'z' && !e.shiftKey) ed.undo();
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) ed.redo();
      else if (ctrl && k === 'c') ed.copy();
      else if (ctrl && k === 'x') ed.cut();
      else if (ctrl && k === 'v') ed.paste();
      else if (ctrl && k === 'd') ed.duplicate();
      else if (ctrl && k === 'g' && e.shiftKey) ed.ungroup();
      else if (ctrl && k === 'g') ed.group();
      else if (ctrl && k === 'a') ed.selectAll();
      else if (ctrl && k === 'h' && e.shiftKey) ed.showAll();
      else if (ctrl && k === 'h') ed.hideSelected();
      else if (ctrl && k === 'l') ed.setLocked(!ed.selected.every((o) => o.locked));
      else if (k === 'delete' || k === 'backspace') ed.deleteSelected();
      else if (k === 'escape') {
        if (ed.placing) ed.cancelPlacing();
        else if (ed.mode) ed.setMode(null);
        else ed.select([]);
        this.refresh();
      } else if (k === 'arrowup' && ctrl) ed.nudge(0, step, 0);
      else if (k === 'arrowdown' && ctrl) ed.nudge(0, -step, 0);
      else if (k === 'arrowup') ed.nudge(0, 0, -step);
      else if (k === 'arrowdown') ed.nudge(0, 0, step);
      else if (k === 'arrowleft') ed.nudge(-step, 0, 0);
      else if (k === 'arrowright') ed.nudge(step, 0, 0);
      else if (ctrl) handled = false;
      else if (k === 'h') ed.setHole(true);
      else if (k === 's') ed.setHole(false);
      else if (k === 'd') ed.dropToWorkplane();
      else if (k === 'l') ed.setMode('align');
      else if (k === 'm') ed.setMode('mirror');
      else if (k === 'f') ed.fitView();
      else if (k === '?') this.helpDialog();
      else handled = false;
      if (handled) e.preventDefault();
    });
    ed.moveKeys = new Set();
    window.addEventListener('keyup', (e) => ed.moveKeys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => ed.moveKeys.clear());
  }

  initMisc() {
    // fecha a paleta ao clicar fora do inspetor
    document.addEventListener('pointerdown', (e) => {
      if (this.paletteOpen && !e.target.closest('#inspector')) {
        this.paletteOpen = false;
        this.renderInspector();
      }
    });
  }

  // ---------- diálogos ----------
  modal(title, content, actions = []) {
    this.closeModal();
    const back = h('div', { class: 'modal-back' });
    const dlg = h(
      'div',
      { class: 'modal' },
      h('div', { class: 'modal-head' }, h('span', {}, title), h('button', { class: 'icon-btn tiny', html: ICONS.close, onclick: () => this.closeModal() })),
      h('div', { class: 'modal-body' }, content),
      actions.length ? h('div', { class: 'modal-actions' }, actions) : null,
    );
    back.append(dlg);
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) this.closeModal();
    });
    $('#modal-root').append(back);
    return dlg;
  }

  closeModal() {
    $('#modal-root').innerHTML = '';
  }

  confirm(title, text, ok, fn) {
    this.modal(title, h('p', {}, text), [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, 'Cancelar'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          this.closeModal();
          fn();
        },
      }, ok),
    ]);
  }

  exportDialog() {
    const ed = this.ed;
    const hasSel = ed.selection.length > 0;
    const all = h('input', { type: 'radio', name: 'exp-scope', value: 'all' });
    const sel = h('input', { type: 'radio', name: 'exp-scope', value: 'sel', disabled: !hasSel });
    (hasSel ? sel : all).checked = true;
    const btn = (label, fn) => h('button', { class: 'btn export', onclick: () => fn(sel.checked) }, label);
    const body = h(
      'div',
      { class: 'export' },
      h('div', { class: 'radio-row' }, h('label', {}, all, ' Tudo no design'), h('label', {}, sel, ' Formas selecionadas')),
      h('h4', {}, 'Para impressão 3D'),
      h('div', { class: 'export-btns' }, btn('.STL', (s) => this.exportSTL(s)), btn('.OBJ', (s) => this.exportOBJ(s)), btn('.GLB', (s) => this.exportGLB(s))),
      h('p', { class: 'muted' }, 'Furos não são exportados sozinhos: agrupe-os com um sólido para recortar.'),
    );
    this.modal('Exportar', body);
  }

  fileName(ext) {
    return (this.ed.name || 'projeto').replace(/[\\/:*?"<>|]+/g, '_') + ext;
  }

  download(data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  exportSTL(onlySel) {
    const scene = this.ed.exportScene(onlySel);
    if (!scene.children.length) return this.toast('Nada para exportar');
    const data = new STLExporter().parse(scene, { binary: true });
    this.download(data, this.fileName('.stl'), 'model/stl');
    this.closeModal();
  }

  exportOBJ(onlySel) {
    const scene = this.ed.exportScene(onlySel);
    if (!scene.children.length) return this.toast('Nada para exportar');
    this.download(new OBJExporter().parse(scene), this.fileName('.obj'), 'text/plain');
    this.closeModal();
  }

  exportGLB(onlySel) {
    const scene = this.ed.exportScene(onlySel);
    if (!scene.children.length) return this.toast('Nada para exportar');
    // GLB é Y para cima: desfaz a rotação usada para STL/OBJ
    scene.rotation.x = 0;
    scene.scale.setScalar(0.001); // mm -> m
    scene.updateMatrixWorld(true);
    new GLTFExporter().parse(
      scene,
      (glb) => {
        this.download(new Blob([glb], { type: 'model/gltf-binary' }), this.fileName('.glb'));
        this.closeModal();
      },
      (err) => this.toast('Falha ao exportar: ' + err.message),
      { binary: true },
    );
  }

  async importFile(file) {
    const ed = this.ed;
    const ext = file.name.split('.').pop().toLowerCase();
    let geo;
    try {
      if (ext === 'stl') {
        geo = new STLLoader().parse(await file.arrayBuffer());
      } else if (ext === '3mf') {
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(parse3MF(await file.arrayBuffer()), 3));
      } else if (ext === 'obj') {
        const root = new OBJLoader().parse(await file.text());
        const pos = [];
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          if (!o.isMesh) return;
          let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          pos.push(...g.attributes.position.array);
        });
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      } else {
        return this.toast('Formato não suportado (use .STL, .OBJ ou .3MF)');
      }
    } catch (err) {
      return this.toast('Não foi possível ler o arquivo: ' + err.message);
    }
    if (geo.index) geo = geo.toNonIndexed();
    if (ext === 'stl' || ext === '3mf') geo.rotateX(-Math.PI / 2); // Z para cima -> Y para cima
    const count = geo.attributes.position.count;
    if (!count) return this.toast('O arquivo não tem triângulos');
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    const positions = new Float32Array(geo.attributes.position.array);
    const { ref, saved } = registerMesh(positions);
    const o = ed.createObject('mesh', {
      params: { ref },
      size: [s.x || 1, s.y || 1, s.z || 1].map((v) => Math.round(v * 100) / 100),
      name: file.name.replace(/\.[^.]+$/, ''),
    });
    ed.change(() => ed.objects.push(o));
    ed.select([o.id]);
    ed.fitView();
    if (!saved) this.toast('Modelo grande: ele não ficará salvo após recarregar a página.');
  }

  settingsDialog() {
    const ed = this.ed;
    const w = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.w });
    const l = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.l });
    const z = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.h });
    const body = h(
      'div',
      { class: 'settings' },
      h('h4', {}, 'Plano de trabalho'),
      h('div', { class: 'field-row' }, h('label', {}, 'Largura (mm)', w), h('label', {}, 'Comprimento (mm)', l), h('label', {}, 'Altura (mm)', z)),
      h(
        'div',
        { class: 'presets' },
        ...AREA_PRESETS.map(([t, a, b, c]) =>
          h('button', {
            class: 'chip',
            onclick: () => {
              w.value = a;
              l.value = b;
              z.value = c;
            },
          }, t),
        ),
      ),
    );
    this.modal('Configurações', body, [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, 'Cancelar'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const a = parseFloat(w.value);
          const b = parseFloat(l.value);
          const c = parseFloat(z.value);
          if (a > 0 && b > 0 && c > 0) ed.setWorkplane(a, b, c);
          this.closeModal();
        },
      }, 'Atualizar grade'),
    ]);
  }

  helpDialog() {
    const rows = [
      ['Arrastar forma da biblioteca', 'Criar forma no plano'],
      ['Clique / Shift+clique', 'Selecionar / somar à seleção'],
      ['Arrastar no vazio', 'Seleção por área'],
      ['Botão direito + arrastar', 'Girar a vista'],
      ['Botão do meio / Shift+direito', 'Mover a vista'],
      ['Roda do mouse', 'Zoom'],
      ['Alt + arrastar forma', 'Duplicar arrastando'],
      ['Shift nas alças', 'Manter proporção / girar de 45°'],
      ['Alt nas alças', 'Redimensionar a partir do centro'],
      ['Setas / Shift+setas', 'Mover na grade (×10)'],
      ['Ctrl + ↑ / ↓', 'Subir / descer'],
      ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copiar / colar / duplicar e repetir'],
      ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'],
      ['Ctrl+G / Ctrl+Shift+G', 'Agrupar / desagrupar'],
      ['W / A / S / D', 'Andar com a vista'],
      ['H / Shift+S', 'Furo / sólido'],
      ['Shift+D', 'Soltar no plano de trabalho'],
      ['Arrastar arquivo para a tela', 'Importar STL / OBJ / 3MF'],
      ['L / M', 'Alinhar / espelhar'],
      ['F', 'Ajustar à tela'],
      ['Ctrl+L / Ctrl+H', 'Bloquear / ocultar'],
      ['Delete', 'Excluir'],
    ];
    const table = h('table', { class: 'keys' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, h('kbd', {}, a)), h('td', {}, b))));
    const modo = gpuInfo.mode === 'gpu' ? 'GPU' : 'modo software';
    const gpu = h('p', { class: 'muted gpu-line' }, `Placa de vídeo: ${gpuInfo.renderer || 'desconhecida'} (${modo})`);
    this.modal('Atalhos e controles', [table, gpu]);
  }

  toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }
}

export { fmt };
