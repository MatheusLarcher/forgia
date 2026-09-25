import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { parseModel, ImportError, MODEL_EXTS } from './importar.js';
import { SHAPES, PALETTE, registerMesh } from './shapes.js';
import { ICONS } from './icons.js';
import { gpuInfo } from './gpu.js';
import { fmt } from './editor.js';
import { t } from './textos/index.js';
import { THEMES, theme } from './theme.js';
import { Dica } from './dica.js';
import { connectContent } from './conectar.js';
import { build3MF } from './exportar3mf.js';
import { ObjectList } from './lista.js';
import { createFit, FOLGA_PADRAO, MARGEM_PADRAO, FOLGA_MAX } from './encaixe.js';
import { Library, CATEGORY_ORDER } from './biblioteca.js';

// áreas de impressão prontas: chave do rótulo em t.barra.areas e medidas em mm
const AREA_PRESETS = [
  ['padrao', 255, 255, 255],
  ['bambu', 256, 256, 256],
  ['a1mini', 180, 180, 180],
  ['prusa', 250, 210, 220],
  ['ender3', 220, 220, 250],
  ['grande', 300, 300, 300],
];
// passos do "Ajustar grade", em mm (0 = desligado)
const GRID_STEPS = [0, 0.1, 0.25, 0.5, 1, 2, 5, 10];
// teclas das ferramentas, sem modificador; P (plano de trabalho) liga e desliga em toggleWorkplane
const TOOL_KEYS = { b: 'draw', c: 'cruise', r: 'measure', n: 'mark' };

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

// categorias e itens da biblioteca: src/biblioteca.js

export class UI {
  constructor(editor, ponte = null, arquivo = null) {
    this.ed = editor;
    this.ponte = ponte;
    this.arquivo = arquivo;
    this.thumbs = new Map();
    this.paletteOpen = false;
    this.collapsed = false;
    this.initIcons();
    this.initTopbar();
    this.initFileMenu();
    this.initToolbar();
    this.initView();
    this.initLibrary();
    this.initSidePanel();
    this.initKeys();
    this.initMisc();
    // cartão de dica: não abre durante arraste, colocação de forma nem com modal aberto
    this.dica = new Dica({ busy: () => !!(editor.drag || editor.placing || $('.modal-back')) });

    const ed = editor;
    ed.addEventListener('selection', () => this.refresh());
    ed.addEventListener('history', () => this.refresh());
    ed.addEventListener('mode', () => this.refresh());
    ed.addEventListener('clipboard', () => this.refreshToolbar());
    ed.addEventListener('camera', () => this.refreshView());
    ed.addEventListener('aviso', (e) => this.toast(e.detail));
    this.refresh();
  }

  initIcons() {
    for (const b of $$('[data-cmd]')) b.innerHTML = ICONS[b.dataset.cmd] || '';
    const viewIcons = { home: 'home', fit: 'fit', in: 'plus', out: 'minus', ortho: 'cube' };
    for (const b of $$('[data-view]')) b.innerHTML = ICONS[viewIcons[b.dataset.view]];
    $('#btn-new').innerHTML = ICONS.newFile;
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
    // projeto trocado (abrir, recuperar, novo): nome, grade
    this.ed.addEventListener('projeto', () => {
      name.value = this.ed.name;
      const snap = $('#snap-select');
      if (snap) snap.value = String(this.ed.grid);
    });
    // Novo: pergunta antes só se houver alteração não salva (src/arquivo.js)
    $('#btn-new').addEventListener('click', () => {
      if (this.arquivo) this.arquivo.newProject();
      else {
        this.ed.newDesign();
        this.ed.setName(t.editor.nomePadrao);
        name.value = this.ed.name;
      }
    });
    $('#btn-export').addEventListener('click', () => this.exportDialog());
    $('#btn-help').addEventListener('click', () => this.helpDialog());
    // sol/lua: o ícone mostra o tema para onde o botão leva
    const themeBtn = $('#btn-theme');
    themeBtn.addEventListener('click', () => theme.toggle());
    theme.watch((_, name) => {
      const toDark = name === 'claro';
      themeBtn.innerHTML = toDark ? ICONS.moon : ICONS.sun;
      themeBtn.setAttribute('aria-label', toDark ? t.barra.temaEscuro : t.barra.temaClaro);
      themeBtn.dataset.dica = toDark ? 'temaEscuro' : 'temaClaro';
    });
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
      const opts = AREA_PRESETS.map(([key, a, b, c]) => [`${a}x${b}x${c}`, t.barra.areas[key]]);
      if (!opts.some(([v]) => v === cur)) opts.unshift([cur, t.barra.areaMedidas(w, l, hh)]);
      opts.push(['custom', t.barra.areaPersonalizada]);
      area.replaceChildren(...opts.map(([v, label]) => h('option', { value: v }, label)));
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
    snap.replaceChildren(...GRID_STEPS.map((mm) => h('option', { value: mm }, mm ? t.barra.grade(mm) : t.barra.gradeDesligada)));
    snap.value = String(this.ed.grid);
    snap.addEventListener('change', () => {
      this.ed.setGrid(parseFloat(snap.value));
      snap.blur();
    });
  }

  // ---------- menu Arquivo (Abrir, Salvar, Salvar como, Recentes) e o nome do arquivo ----------
  initFileMenu() {
    const btn = $('#btn-arquivo');
    const label = $('#file-name');
    const arq = this.arquivo;
    if (!arq) {
      btn.hidden = true;
      return;
    }
    arq.addEventListener('estado', (e) => {
      const { file, dirty } = e.detail;
      label.textContent = file ? file.nome + (dirty ? ' •' : '') : dirty ? '• ' + t.arquivo.semArquivo : '';
      label.classList.toggle('sujo', dirty);
      label.dataset.sujo = String(dirty);
    });
    btn.addEventListener('click', () => this.toggleFileMenu());
  }

  async toggleFileMenu() {
    const btn = $('#btn-arquivo');
    if (this.closeMenu()) return;
    const arq = this.arquivo;
    const recents = await arq.recents();
    const item = (text, key, fn, opts = {}) => {
      const b = h('button', { class: 'menu-item', role: 'menuitem', type: 'button', disabled: opts.disabled || false, title: opts.title || null }, h('span', { class: 'menu-texto' }, text), key ? h('kbd', {}, key) : null);
      b.addEventListener('click', () => {
        this.closeMenu();
        fn();
      });
      return b;
    };
    const tx = t.arquivo;
    const menu = h(
      'div',
      { class: 'menu', role: 'menu', id: 'menu-arquivo' },
      item(tx.abrir, 'Ctrl+O', () => arq.open()),
      item(tx.salvar, 'Ctrl+S', () => arq.save()),
      item(tx.salvarComo, 'Ctrl+Shift+S', () => arq.save({ como: true })),
      h('div', { class: 'menu-sep', role: 'separator' }),
      h('div', { class: 'menu-titulo' }, tx.recentes),
      ...(recents.length
        ? recents.map((r, i) => item(r.existe ? r.nome : `${r.nome} (${tx.naoEncontrado})`, null, () => arq.openRecent(i), { title: r.caminho, disabled: !r.existe }))
        : [h('div', { class: 'menu-vazio' }, tx.semRecentes)]),
    );
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    btn.setAttribute('aria-expanded', 'true');
    this.menuEl = menu;
    const first = menu.querySelector('.menu-item:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  // fecha o menu aberto; true se havia um
  closeMenu() {
    if (!this.menuEl) return false;
    this.menuEl.remove();
    this.menuEl = null;
    (this.menuBtn || $('#btn-arquivo')).setAttribute('aria-expanded', 'false');
    this.menuBtn = null;
    return true;
  }

  // ---------- painel lateral: abas Biblioteca | Objetos ----------
  initSidePanel() {
    this.list = new ObjectList(this.ed, { toast: (m) => this.toast(m) });
    const tabs = $$('.side-tab');
    const show = (aba) => {
      for (const tb of tabs) tb.setAttribute('aria-selected', String(tb.dataset.aba === aba));
      $('#pane-biblioteca').hidden = aba !== 'biblioteca';
      $('#pane-objetos').hidden = aba !== 'objetos';
      this.list.setVisible(aba === 'objetos');
    };
    for (const tb of tabs) tb.addEventListener('click', () => show(tb.dataset.aba));
    this.showPane = show;
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
      encaixe: () => this.fitDialog(),
      draw: () => ed.setTool('draw'),
      cruise: () => ed.setTool('cruise'),
      measure: () => ed.setTool('measure'),
      mark: () => ed.setTool('mark'),
      workplane: () => this.toggleWorkplane(),
    };
    for (const b of $$('[data-cmd]')) b.addEventListener('click', () => cmds[b.dataset.cmd]());
    ed.addEventListener('plano', () => this.refresh());
  }

  // Plano de trabalho (P / botão): com o plano ativo, volta para a mesa; senão, escolhe a face
  toggleWorkplane() {
    const ed = this.ed;
    if (ed.wplane) {
      if (ed.tool && ed.tool.name === 'workplane') ed.setTool(null);
      ed.clearWorkplaneFrame();
    } else ed.setTool('workplane');
    this.refresh();
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
      encaixe: n === 1 && !ed.selected[0].hole,
      draw: true,
      cruise: ed.selected.some((o) => !o.locked),
      measure: true,
      mark: ed.objects.length > 0,
      workplane: ed.objects.length > 0 || !!ed.wplane,
    };
    const tool = ed.tool ? ed.tool.name : null;
    for (const b of $$('[data-cmd]')) {
      b.disabled = !en[b.dataset.cmd];
      b.classList.toggle('active', ed.mode === b.dataset.cmd || tool === b.dataset.cmd || (b.dataset.cmd === 'workplane' && !!ed.wplane));
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

  // ---------- biblioteca de formas (categorias, favoritos, suas criações: src/biblioteca.js) ----------
  initLibrary() {
    const api = this.arquivo && this.arquivo.api;
    this.lib = new Library({ api, toast: (m) => this.toast(m) });
    this.category = 'basic';
    const search = $('#lib-search');
    search.addEventListener('input', () => this.renderLibrary());
    search.addEventListener('keydown', (e) => e.stopPropagation());
    $('#lib-category').addEventListener('click', () => this.toggleCategoryMenu());
    $('#btn-salvar-criacao').addEventListener('click', () => this.saveCreationDialog());
    this.ed.addEventListener('selection', () => this.refreshCreationButton());
    this.renderCategoryButton();
    this.renderLibrary();
    this.lib.loadCreations().then(() => {
      if (this.category === 'criacoes' || this.category === 'favoritos') this.renderLibrary();
    });
  }

  renderCategoryButton() {
    const btn = $('#lib-category');
    btn.querySelector('.lib-cat-ico').src = this.lib.categoryIcons()[this.category];
    btn.querySelector('.lib-cat-nome').textContent = t.biblioteca.categorias[this.category];
    btn.querySelector('.lib-cat-seta').innerHTML = ICONS.chevron;
    btn.dataset.categoria = this.category;
    this.refreshCreationButton();
  }

  refreshCreationButton() {
    const b = $('#btn-salvar-criacao');
    b.hidden = this.category !== 'criacoes';
    b.disabled = !this.ed.selection.length;
  }

  toggleCategoryMenu() {
    if (this.closeMenu()) return;
    const btn = $('#lib-category');
    const icons = this.lib.categoryIcons();
    const menu = h(
      'div',
      { class: 'menu menu-categorias', role: 'listbox', id: 'menu-categorias' },
      CATEGORY_ORDER.map((cat) => {
        const it = h(
          'button',
          { class: 'menu-item menu-cat' + (cat === this.category ? ' on' : ''), role: 'option', type: 'button', 'aria-selected': String(cat === this.category), 'data-categoria': cat },
          h('img', { src: icons[cat], alt: '', width: '36', height: '36' }),
          h('span', { class: 'menu-texto' }, t.biblioteca.categorias[cat]),
        );
        it.addEventListener('click', () => {
          this.closeMenu();
          this.category = cat;
          $('#lib-search').value = '';
          this.renderCategoryButton();
          this.renderLibrary();
        });
        return it;
      }),
    );
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.width = r.width + 'px';
    btn.setAttribute('aria-expanded', 'true');
    this.menuEl = menu;
    this.menuBtn = btn;
  }

  renderLibrary() {
    const cat = this.category;
    const items = this.lib.items(cat);
    const imgs = this.lib.thumbsFor(items);
    const q = $('#lib-search').value.trim().toLowerCase();
    const grid = $('#lib-grid');
    grid.innerHTML = '';
    grid.classList.toggle('letters', cat === 'letters');
    items.forEach((it, i) => {
      if (q && !it.label.toLowerCase().includes(q)) return;
      const fav = this.lib.favorites.has(it.key);
      const star = h('button', { class: 'tile-btn tile-fav' + (fav ? ' on' : ''), type: 'button', 'aria-label': fav ? t.biblioteca.desfavoritar : t.biblioteca.favoritar, 'aria-pressed': String(fav), html: ICONS.star });
      star.addEventListener('pointerdown', (e) => e.stopPropagation());
      star.addEventListener('click', () => {
        this.lib.toggleFavorite(it.key);
        this.renderLibrary();
      });
      const tile = h(
        'div',
        { class: 'tile', 'data-label': it.label, 'data-item': it.key, title: '' },
        h('img', { src: imgs[i], alt: it.label, draggable: 'false' }),
        h('span', { class: 'tile-label' }, it.label),
        star,
      );
      if (it.creation) {
        const ren = h('button', { class: 'tile-btn tile-ren', type: 'button', 'aria-label': t.biblioteca.renomearCriacao, html: ICONS.rename });
        const del = h('button', { class: 'tile-btn tile-del', type: 'button', 'aria-label': t.biblioteca.excluirCriacao, html: ICONS.delete });
        for (const b of [ren, del]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
        ren.addEventListener('click', () => this.renameCreationDialog(it.creation));
        del.addEventListener('click', () => this.deleteCreationDialog(it.creation));
        tile.append(ren, del);
      }
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.ed.startPlacing({ ...it.spec });
        this.ed.placing.tileDrag = true;
        this.refreshHint();
      });
      grid.append(tile);
    });
    if (!grid.children.length) {
      const empty = cat === 'criacoes' ? t.biblioteca.semCriacoes : cat === 'favoritos' ? t.biblioteca.semFavoritos : t.biblioteca.nenhuma;
      grid.append(h('div', { class: 'lib-empty' }, q ? t.biblioteca.nenhuma : empty));
    }
  }

  // "Salvar seleção como criação": nome e grava na pasta de criações
  saveCreationDialog() {
    const sel = this.ed.selected;
    if (!sel.length) return;
    const tx = t.biblioteca;
    const input = h('input', { type: 'text', class: 'param-text largo', maxlength: '80', value: sel.length === 1 ? sel[0].name : tx.criacaoPadrao, 'data-criacao': 'nome' });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
    });
    const save = async () => {
      const nome = input.value.trim().slice(0, 80) || tx.criacaoPadrao;
      this.closeModal();
      const ok = await this.lib.saveCreation(sel, nome);
      this.toast(ok ? tx.criacaoSalva(nome) : tx.criacaoNaoSalva);
      this.category = 'criacoes';
      this.renderCategoryButton();
      this.renderLibrary();
    };
    this.modal(tx.salvarCriacao, h('div', { class: 'settings' }, h('p', {}, tx.salvarCriacaoExplica), h('label', { class: 'campo' }, tx.nomeCriacao, input)), [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, t.dialogos.cancelar),
      h('button', { class: 'btn primary', 'data-escolha': 'salvar-criacao', onclick: save }, tx.salvar),
    ]);
    input.focus();
    input.select();
  }

  renameCreationDialog(c) {
    const tx = t.biblioteca;
    const input = h('input', { type: 'text', class: 'param-text largo', maxlength: '80', value: c.nome, 'data-criacao': 'nome' });
    const ok = async () => {
      const nome = input.value.trim().slice(0, 80);
      this.closeModal();
      if (nome && nome !== c.nome) {
        await this.lib.renameCreation(c.id, nome);
        this.lib.thumbs.delete(`criacoes:${c.id}`);
        this.renderLibrary();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
    });
    this.modal(tx.renomearCriacao, h('label', { class: 'campo' }, tx.nomeCriacao, input), [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, t.dialogos.cancelar),
      h('button', { class: 'btn primary', 'data-escolha': 'renomear-criacao', onclick: ok }, tx.renomear),
    ]);
    input.focus();
    input.select();
  }

  deleteCreationDialog(c) {
    const tx = t.biblioteca;
    this.confirm(tx.excluirCriacao, tx.excluirCriacaoTexto(c.nome), tx.excluir, async () => {
      await this.lib.deleteCreation(c.id);
      this.renderLibrary();
    });
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
    let msg = '';
    if (ed.placing) msg = t.modos.posicionar;
    else if (ed.tool) msg = ed.tool.hint();
    else if (ed.mode === 'align') msg = t.modos.alinhar;
    else if (ed.mode === 'mirror') msg = t.modos.espelhar;
    hint.textContent = msg;
    hint.style.display = msg ? 'block' : 'none';
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

    const title = single ? single.name : t.inspetor.varias(sel.length);
    const head = h(
      'div',
      { class: 'insp-head' },
      h('span', { class: 'insp-title' }, title),
      h('button', {
        class: 'icon-btn tiny' + (locked ? ' active' : ''),
        'aria-label': locked ? t.inspetor.desbloquear : t.inspetor.bloquear,
        'data-dica': locked ? 'desbloquear' : 'bloquear',
        html: locked ? ICONS.lock : ICONS.unlock,
        onclick: () => ed.setLocked(!locked),
      }),
      h('button', { class: 'icon-btn tiny', 'aria-label': t.inspetor.ocultar, 'data-dica': 'ocultar', html: ICONS.hide, onclick: () => ed.hideSelected() }),
      // o mesmo Shift+D; o botão também é onde o cartão de dica (com vídeo) do Soltar na mesa aparece
      h('button', { class: 'icon-btn tiny', 'aria-label': t.inspetor.soltar, 'data-dica': 'soltar', html: ICONS.soltar, disabled: locked, onclick: () => ed.dropToWorkplane() }),
      h('button', {
        class: 'icon-btn tiny collapse' + (this.collapsed ? ' up' : ''),
        'aria-label': this.collapsed ? t.inspetor.expandir : t.inspetor.recolher,
        'data-dica': this.collapsed ? 'expandir' : 'recolher',
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
    if (!multicolor) swatch.style.background = color || 'var(--line-strong)';
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
      h('span', {}, t.inspetor.solido),
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
      h('span', {}, t.inspetor.furo),
    );
    const section = (title) => h('div', { class: 'insp-section' }, title);
    const body = h('div', { class: 'insp-body' }, section(t.inspetor.material), h('div', { class: 'solid-hole' }, solidBtn, holeBtn));
    box.append(body);

    if (this.paletteOpen && !allHole) body.append(this.palette(single, color, multicolor));

    if (single && single.type !== 'group' && SHAPES[single.type].params.length) {
      body.append(section(t.inspetor.parametros));
      for (const p of SHAPES[single.type].params) body.append(this.paramRow(single, p));
      // Hardware e Geradores: a dica da peça (rosca real abaixo de M4 fica em destaque)
      const dica = SHAPES[single.type].generator && t.formas.dicas[single.type];
      if (dica) {
        const fraca = (single.type === 'nut' || single.type === 'bolt') && single.params.thread === 1 && single.params.m < 4;
        body.append(h('div', { class: 'insp-note insp-dica' + (fraca ? ' aviso' : ''), 'data-dica-peca': single.type }, dica));
      }
    }
    if (single && single.type === 'group') {
      body.append(section(t.inspetor.grupo), h('div', { class: 'insp-note' }, t.inspetor.agrupadas(single.children.length)));
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
    const row = h('div', { class: 'palette-row' }, h('label', { class: 'custom' }, custom, h('span', {}, t.inspetor.personalizado)));
    if (single && single.type === 'group') {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = multicolor;
      cb.addEventListener('change', () => {
        if (cb.checked) ed.setColor(null);
        else ed.setColor(PALETTE[0]);
      });
      row.append(h('label', { class: 'multi-cb' }, cb, h('span', {}, t.inspetor.multicolorido)));
    }
    wrap.append(row);
    return wrap;
  }

  paramRow(o, p) {
    const ed = this.ed;
    const value = o.params[p.key];
    if (p.kind === 'choice') {
      // lista (medida M, rosca real/lisa, padrão…): rótulos em t.formas.opcoes
      const labels = t.formas.opcoes[p.optionsKey] || {};
      const sel = h('select', { class: 'param-select', 'data-param': p.key }, p.options.map((v) => h('option', { value: String(v) }, labels[v] || String(v))));
      sel.value = String(value);
      sel.addEventListener('keydown', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        ed.setParam(p.key, parseFloat(sel.value), true);
        this.renderInspector();
      });
      return h('div', { class: 'param' }, h('label', {}, p.label), sel);
    }
    if (p.kind === 'text') {
      const input = h('input', { type: 'text', class: 'param-text', value, maxlength: '40' });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('input', () => ed.setParam(p.key, input.value, false));
      input.addEventListener('change', () => ed.commit());
      return h('div', { class: 'param' }, h('label', {}, p.label), input);
    }
    const range = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value });
    const num = h('input', { type: 'number', min: p.min, max: p.max, step: p.step, value });
    // parte preenchida da trilha (style.css usa --pct): o Chromium não pinta sozinha com appearance none
    const fill = () => range.style.setProperty('--pct', `${((range.value - p.min) / (p.max - p.min || 1)) * 100}%`);
    fill();
    num.addEventListener('keydown', (e) => e.stopPropagation());
    range.addEventListener('input', () => {
      num.value = range.value;
      fill();
      ed.setParam(p.key, parseFloat(range.value), false);
    });
    range.addEventListener('change', () => ed.commit());
    num.addEventListener('change', () => {
      let v = parseFloat(String(num.value).replace(',', '.'));
      if (!Number.isFinite(v)) v = p.value;
      v = Math.min(p.max, Math.max(p.min, v));
      num.value = v;
      range.value = v;
      fill();
      ed.setParam(p.key, v, true);
    });
    return h('div', { class: 'param' }, h('label', {}, p.label), h('div', { class: 'param-ctl' }, range, num));
  }

  // ---------- teclado ----------
  initKeys() {
    const ed = this.ed;
    window.addEventListener('keydown', (e) => {
      const el = e.target;
      // Ctrl+S / Ctrl+Shift+S / Ctrl+O valem até com o cursor num campo (menos com diálogo aberto)
      const kk = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (kk === 's' || (kk === 'o' && !e.shiftKey)) && this.arquivo && !$('.modal-back')) {
        e.preventDefault();
        if (e.repeat) return;
        if (el && el.tagName === 'INPUT') el.blur(); // o nome digitado entra antes de salvar
        if (kk === 's') this.arquivo.save({ como: e.shiftKey });
        else this.arquivo.open();
        return;
      }
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if ($('.modal-back')) {
        if (e.key === 'Escape') this.closeModal();
        return;
      }
      if (this.menuEl && e.key === 'Escape') {
        this.closeMenu();
        e.preventDefault();
        return;
      }
      // a ferramenta ativa trata as teclas dela primeiro (ex.: Enter fecha o desenho)
      if (ed.tool && ed.tool.onKey && ed.tool.onKey(e)) {
        e.preventDefault();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const step = (ed.grid || 1) * (e.shiftKey ? 10 : 1);
      const plain = !ctrl && !e.altKey && !e.shiftKey;
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
        else if (ed.tool) ed.setTool(null);
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
      else if (plain && TOOL_KEYS[k]) {
        if (!e.repeat) ed.setTool(TOOL_KEYS[k]);
      } else if (plain && k === 'p') {
        if (!e.repeat) this.toggleWorkplane();
      } else if (k === 'h') ed.setHole(true);
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
    // fecha a paleta ao clicar fora do inspetor, e o menu Arquivo ao clicar fora dele
    document.addEventListener('pointerdown', (e) => {
      if (this.paletteOpen && !e.target.closest('#inspector')) {
        this.paletteOpen = false;
        this.renderInspector();
      }
      if (this.menuEl && !e.target.closest('.menu') && !e.target.closest('#btn-arquivo') && !e.target.closest('#lib-category')) this.closeMenu();
    });
  }

  // ---------- diálogos ----------
  // onClose: chamado uma vez quando o diálogo fecha (por qualquer caminho)
  modal(title, content, actions = [], onClose = null) {
    this.closeModal();
    this.onModalClose = onClose;
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
    const fn = this.onModalClose;
    this.onModalClose = null;
    if (fn) fn();
  }

  // pergunta com vários botões: buttons = [[valor, rótulo, primário?], ...] -> Promise do valor
  // escolhido; fechar pelo X, Esc ou fora devolve dflt (ou o primeiro)
  choose(title, text, buttons, dflt = buttons[0][0]) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const btns = buttons.map(([v, label, primary]) =>
        h('button', { class: 'btn' + (primary ? ' primary' : ''), 'data-escolha': v, onclick: () => {
          finish(v);
          this.closeModal();
        } }, label),
      );
      this.modal(title, h('p', {}, text), btns, () => finish(dflt));
      const main = btns.find((b) => b.classList.contains('primary'));
      if (main) main.focus();
    });
  }

  // seletor de arquivo do navegador (npm run dev, sem o preload): Promise do File ou null
  pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, hidden: true });
      input.addEventListener('change', () => {
        resolve(input.files[0] || null);
        input.remove();
      });
      document.body.append(input);
      input.click();
    });
  }

  confirm(title, text, ok, fn) {
    this.modal(title, h('p', {}, text), [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, t.dialogos.cancelar),
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
    const tx = t.dialogos.exportar;
    const hasSel = ed.selection.length > 0;
    const all = h('input', { type: 'radio', name: 'exp-scope', value: 'all' });
    const sel = h('input', { type: 'radio', name: 'exp-scope', value: 'sel', disabled: !hasSel });
    (hasSel ? sel : all).checked = true;
    const btn = (label, fn) => h('button', { class: 'btn export', onclick: () => fn(sel.checked) }, label);
    const body = h(
      'div',
      { class: 'export' },
      h('div', { class: 'radio-row' }, h('label', {}, all, tx.tudo), h('label', {}, sel, tx.selecionadas)),
      h('h4', {}, tx.impressao),
      h('div', { class: 'export-btns' }, btn(tx.stl, (s) => this.exportSTL(s)), btn(tx.obj, (s) => this.exportOBJ(s)), btn(tx.glb, (s) => this.exportGLB(s))),
      h('div', { class: 'export-btns' }, h('button', { class: 'btn export largo', 'data-formato': '3mf', onclick: () => this.export3MF(sel.checked) }, tx.tresmf)),
      h('p', { class: 'muted' }, tx.nota3mf),
      h('p', { class: 'muted' }, tx.nota),
    );
    this.modal(tx.titulo, body);
  }

  fileName(ext) {
    return (this.ed.name || t.dialogos.exportar.arquivo).replace(/[\\/:*?"<>|]+/g, '_') + ext;
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
    if (!scene.children.length) return this.toast(t.avisos.nadaExportar);
    const data = new STLExporter().parse(scene, { binary: true });
    this.download(data, this.fileName('.stl'), 'model/stl');
    this.closeModal();
  }

  exportOBJ(onlySel) {
    const scene = this.ed.exportScene(onlySel);
    if (!scene.children.length) return this.toast(t.avisos.nadaExportar);
    this.download(new OBJExporter().parse(scene), this.fileName('.obj'), 'text/plain');
    this.closeModal();
  }

  exportGLB(onlySel) {
    const scene = this.ed.exportScene(onlySel);
    if (!scene.children.length) return this.toast(t.avisos.nadaExportar);
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
      (err) => this.toast(t.avisos.falhaExportar(err.message)),
      { binary: true },
    );
  }

  // Criar encaixe (src/encaixe.js): folga (0–1 mm) e parede do bloco, lembradas para a próxima vez
  fitDialog() {
    const ed = this.ed;
    const [piece] = ed.selected;
    if (!piece || ed.selection.length !== 1 || piece.hole) return;
    const tx = t.encaixe;
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('forgia.encaixe') || '{}') || {};
    } catch {}
    const folga = h('input', { type: 'number', min: 0, max: FOLGA_MAX, step: 0.05, value: saved.folga ?? FOLGA_PADRAO, 'data-encaixe': 'folga' });
    const margem = h('input', { type: 'number', min: 0.5, max: 20, step: 0.5, value: saved.margem ?? MARGEM_PADRAO, 'data-encaixe': 'margem' });
    for (const i of [folga, margem]) i.addEventListener('keydown', (e) => e.stopPropagation());
    const body = h(
      'div',
      { class: 'settings' },
      h('p', {}, tx.explica),
      h('div', { class: 'field-row' }, h('label', {}, tx.folga, folga), h('label', {}, tx.margem, margem)),
      h('p', { class: 'muted' }, tx.folgaAjuda),
    );
    const create = () => {
      const num = (el, lo, hi, d) => {
        const v = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
      };
      const f = num(folga, 0, FOLGA_MAX, FOLGA_PADRAO);
      const m = num(margem, 0.5, 20, MARGEM_PADRAO);
      try {
        localStorage.setItem('forgia.encaixe', JSON.stringify({ folga: f, margem: m }));
      } catch {}
      this.closeModal();
      const r = createFit(ed, piece, { folga: f, margem: m, names: { grupo: tx.grupo(piece.name), bloco: tx.bloco, copia: tx.copia(piece.name) } });
      ed.select([r.grupo.id]);
      this.toast(r.exata ? tx.feito(fmt(r.folga)) : tx.aproximada);
    };
    this.modal(tx.titulo, body, [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, t.dialogos.cancelar),
      h('button', { class: 'btn primary', 'data-escolha': 'criar-encaixe', onclick: create }, tx.criar),
    ]);
    folga.focus();
    folga.select();
  }

  // .3MF com cada peça separada e com a sua cor (src/exportar3mf.js)
  make3MF(onlySel) {
    const ed = this.ed;
    return build3MF(ed, onlySel && ed.selection.length ? ed.selected : ed.objects);
  }

  async export3MF(onlySel) {
    let res;
    try {
      res = await this.make3MF(onlySel);
    } catch (err) {
      return this.toast(t.avisos.falhaExportar(err.message));
    }
    if (!res) return this.toast(t.avisos.nadaExportar);
    this.download(new Blob([res.dados], { type: 'model/3mf' }), this.fileName('.3mf'));
    this.closeModal();
  }

  async importFile(file) {
    const ed = this.ed;
    if (!MODEL_EXTS.includes(file.name.split('.').pop().toLowerCase())) return this.toast(t.avisos.formatoNaoSuportado);
    let model;
    try {
      model = parseModel(file.name, await file.arrayBuffer());
    } catch (err) {
      if (err instanceof ImportError && err.kind === 'vazio') return this.toast(t.avisos.semTriangulos);
      return this.toast(t.avisos.naoLeu(err.message));
    }
    const { ref, saved } = registerMesh(model.positions);
    const o = ed.createObject('mesh', {
      params: { ref },
      size: model.size,
      name: file.name.replace(/\.[^.]+$/, ''),
    });
    ed.change(() => ed.objects.push(o));
    ed.select([o.id]);
    ed.fitView();
    if (!saved) this.toast(t.avisos.modeloGrande);
  }

  settingsDialog() {
    const ed = this.ed;
    const tx = t.dialogos.configuracoes;
    const w = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.w });
    const l = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.l });
    const z = h('input', { type: 'number', min: 10, max: 2000, value: ed.workplane.h });
    // Aparência: aplica e salva na hora, sem depender de "Atualizar grade". O aria-pressed
    // acompanha o tema também quando ele muda sem clique (botão sol/lua, Windows)
    const themeOptions = THEMES.map((name) =>
      h('button', { 'data-tema-opcao': name, onclick: () => theme.set(name) }, tx.temas[name]),
    );
    const stopWatch = theme.watch((_, current) => {
      for (const b of themeOptions) b.setAttribute('aria-pressed', String(b.dataset.temaOpcao === current));
    });
    // IA: ligam e desligam na hora (a ponte recusa os pedidos do agente quando desligada)
    const iaSection = [];
    if (this.ponte) {
      const cfg = this.ponte.config;
      const check = (key, label) => {
        const cb = h('input', { type: 'checkbox', 'data-ia-opcao': key });
        cb.checked = cfg[key];
        cb.addEventListener('change', () => this.ponte.setConfig({ [key]: cb.checked }));
        return h('label', { class: 'check-row' }, cb, h('span', {}, label));
      };
      iaSection.push(
        h('h4', {}, tx.ia),
        check('permitir', tx.permitirIA),
        check('codigo', tx.permitirCodigo),
        h('div', { class: 'presets' }, h('button', { class: 'chip', onclick: () => this.connectDialog() }, tx.conectar)),
      );
    }
    const body = h(
      'div',
      { class: 'settings' },
      h('h4', {}, tx.aparencia),
      h('div', { class: 'segmented', role: 'group', 'aria-label': tx.aparencia }, themeOptions),
      ...iaSection,
      h('h4', {}, tx.plano),
      h('div', { class: 'field-row' }, h('label', {}, tx.largura, w), h('label', {}, tx.comprimento, l), h('label', {}, tx.altura, z)),
      h(
        'div',
        { class: 'presets' },
        ...AREA_PRESETS.map(([key, a, b, c]) =>
          h('button', {
            class: 'chip',
            onclick: () => {
              w.value = a;
              l.value = b;
              z.value = c;
            },
          }, t.barra.areas[key]),
        ),
      ),
    );
    this.modal(tx.titulo, body, [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, t.dialogos.cancelar),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const a = parseFloat(w.value);
          const b = parseFloat(l.value);
          const c = parseFloat(z.value);
          if (a > 0 && b > 0 && c > 0) ed.setWorkplane(a, b, c);
          this.closeModal();
        },
      }, tx.atualizar),
    ], stopWatch);
  }

  // Conectar IA: texto para colar no agente (src/conectar.js), com os caminhos desta instalação
  async connectDialog() {
    const info = this.ponte && this.ponte.api ? await this.ponte.api.info() : null;
    const tx = t.dialogos.conectar;
    this.modal(tx.titulo, connectContent(info, (text) => this.copyText(text)), [
      h('button', { class: 'btn', onclick: () => this.closeModal() }, tx.fechar),
    ]);
    const dlg = $('.modal');
    if (dlg) dlg.classList.add('largo');
  }

  // área de transferência do Electron (pelo preload, a mesma do Marcar parte); sem ela (npm run
  // dev), a do navegador
  async copyText(text) {
    try {
      if (this.ponte && this.ponte.api) await this.ponte.api.copiar(text, null);
      else await navigator.clipboard.writeText(text);
    } catch {
      return this.toast(t.marcar.naoCopiou);
    }
    this.toast(t.dialogos.conectar.copiado);
  }

  helpDialog() {
    const tx = t.dialogos.atalhos;
    const table = h('table', { class: 'keys' }, tx.linhas.map(([a, b]) => h('tr', {}, h('td', {}, h('kbd', {}, a)), h('td', {}, b))));
    const gpu = h('p', { class: 'muted gpu-line' }, tx.placa(gpuInfo.renderer, gpuInfo.mode === 'gpu'));
    this.modal(tx.titulo, [table, gpu, this.aboutBlock()]);
  }

  // "Sobre o Forgia", no fim do diálogo Atalhos. O símbolo entra por aqui (não pelo index.html)
  aboutBlock() {
    const tx = t.sobre;
    return h(
      'div',
      { class: 'sobre' },
      h('h4', {}, tx.titulo),
      h(
        'div',
        { class: 'sobre-app' },
        h('img', { src: './branding/forgia-forge-v1.svg', width: '32', height: '32', alt: '' }),
        h('span', { class: 'sobre-nome' }, t.app.nome),
        h('span', { class: 'sobre-versao' }, tx.versao(__APP_VERSION__)),
      ),
      h('p', {}, tx.feito, h('a', { href: 'https://larchertech.com/', target: '_blank', rel: 'noopener noreferrer' }, tx.empresa)),
      h('p', {}, tx.licenca),
      h('p', {}, tx.icones),
    );
  }

  toast(msg) {
    const el = h('div', { class: 'toast' + ($('#hint').style.display === 'block' ? ' acima' : '') }, msg);
    document.body.append(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }
}

export { fmt };
