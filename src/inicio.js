import { t } from './textos/index.js';
import { ICONS } from './icons.js';

// Tela inicial (Seus projetos) e o menu lateral que o símbolo do Forgia abre no editor. As duas
// mostram o histórico do main (electron/projeto.cjs: os .forgia salvos ou abertos, com miniatura)
// e deixam abrir e renomear o arquivo. Abrir passa pelo Arquivo (src/arquivo.js), que pergunta
// antes de trocar um projeto com alteração não salva.
// - A tela inicial aparece ao abrir o Forgia, menos quando o Windows mandou abrir um .forgia.
// - Enquanto uma das duas está aberta, as teclas do editor ficam paradas (Esc fecha o menu).

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

const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const semExt = (nome) => nome.replace(/\.forgia$/i, '');

export class Inicio {
  constructor(editor, arquivo) {
    this.ed = editor;
    this.arq = arquivo;
    this.seq = 0; // descarta listas que chegaram depois de outra mais nova
    this.tela = h('div', { id: 'inicio', class: 'inicio', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': t.inicio.titulo });
    this.gaveta = h('aside', { id: 'gaveta', class: 'gaveta', hidden: true, role: 'dialog', 'aria-label': t.inicio.abrirMenu });
    this.fundo = h('div', { class: 'gaveta-fundo', hidden: true, onclick: () => this.closeDrawer() });
    document.body.append(this.tela, this.fundo, this.gaveta);

    const logo = document.querySelector('#topbar .logo');
    logo.setAttribute('role', 'button');
    logo.setAttribute('tabindex', '0');
    logo.title = t.inicio.abrirMenu;
    logo.addEventListener('click', () => this.toggleDrawer());
    logo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleDrawer();
      }
    });

    // nada vaza para o teclado do editor (src/ui.js, no window) com a tela/menu aberto. Tecla com o
    // foco aqui dentro chega aos campos e botões e para na caixa; com o foco fora, para já no window
    const passa = (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !e.shiftKey; // Abrir vale aqui também
    const barra = (e) => {
      if (passa(e)) return;
      // Ctrl+S: nada para salvar na lista; Ctrl+A etc. fora de campo: sem selecionar a página inteira
      const campo = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || !campo)) e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen() || document.querySelector('.modal-back')) return;
        const dentro = this.tela.contains(e.target) || this.gaveta.contains(e.target);
        if (e.key === 'Escape' && !this.gaveta.hidden && !(e.target && e.target.classList && e.target.classList.contains('proj-nome-campo'))) {
          e.preventDefault();
          this.closeDrawer();
          return e.stopImmediatePropagation();
        }
        if (!dentro) barra(e);
      },
      true,
    );
    this.tela.addEventListener('keydown', barra);
    this.gaveta.addEventListener('keydown', barra);
    this.arq.addEventListener('aberto', () => this.close());
  }

  isOpen() {
    return !this.tela.hidden || !this.gaveta.hidden;
  }

  showHome() {
    this.closeDrawer();
    this.tela.hidden = false;
    document.body.classList.add('com-inicio');
    return this.render(this.tela, 'tela');
  }

  close() {
    this.tela.hidden = true;
    document.body.classList.remove('com-inicio');
    this.closeDrawer();
  }

  toggleDrawer() {
    if (!this.gaveta.hidden) return this.closeDrawer();
    this.gaveta.hidden = false;
    this.fundo.hidden = false;
    return this.render(this.gaveta, 'gaveta');
  }

  closeDrawer() {
    this.gaveta.hidden = true;
    this.fundo.hidden = true;
  }

  // ---------- ações ----------

  async run(fn) {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      if (await fn()) this.close();
      else if (this.isOpen()) this.refresh(); // cancelou ou não abriu: a lista pode ter mudado
    } finally {
      this.ocupado = false;
    }
  }

  openItem(item) {
    const atual = this.arq.file;
    if (atual && atual.caminho && atual.caminho.toLowerCase() === item.caminho.toLowerCase()) return this.close();
    return this.run(() => this.arq.openHistory(item));
  }

  refresh() {
    if (!this.tela.hidden) this.render(this.tela, 'tela');
    if (!this.gaveta.hidden) this.render(this.gaveta, 'gaveta');
  }

  // ---------- conteúdo ----------

  async render(box, modo) {
    const seq = ++this.seq;
    const lista = await this.arq.history();
    if (seq !== this.seq) return;
    const tx = t.inicio;
    const acoes = h(
      'div',
      { class: 'inicio-acoes' },
      h('button', { class: 'btn primary com-icone', type: 'button', onclick: () => this.run(() => this.arq.newProject()) }, h('span', { html: ICONS.plus }), tx.novo),
      h('button', { class: 'btn com-icone', type: 'button', onclick: () => this.run(() => this.arq.open()) }, h('span', { html: ICONS.open }), tx.abrirArquivo),
    );
    const cards = [];
    // projeto atual sem arquivo (a cópia de segurança trouxe de volta): continua de onde parou
    if (!this.arq.file && this.ed.objects.length > 0) {
      cards.push(this.card({ nome: this.ed.name, sub: tx.naoSalvo, atual: true }, () => this.close(), modo));
    }
    for (const item of lista) cards.push(this.itemCard(item, modo));
    const corpo = cards.length ? h('div', { class: modo === 'tela' ? 'proj-grade' : 'proj-lista' }, cards) : h('p', { class: 'inicio-vazio' }, this.arq.api ? tx.vazio : tx.semHistorico);

    if (modo === 'tela') {
      box.replaceChildren(
        h(
          'div',
          { class: 'inicio-caixa' },
          h('header', { class: 'inicio-topo' }, h('img', { src: './branding/forgia-forge-v1.svg', width: '40', height: '40', alt: '' }), h('div', {}, h('h1', {}, tx.titulo), h('p', {}, tx.subtitulo)), acoes),
          corpo,
        ),
      );
    } else {
      box.replaceChildren(
        h(
          'div',
          { class: 'gaveta-topo' },
          h('h2', {}, tx.titulo),
          h('button', { class: 'icon-btn tiny', type: 'button', 'aria-label': tx.fecharMenu, title: tx.fecharMenu, html: ICONS.close, onclick: () => this.closeDrawer() }),
        ),
        acoes,
        h('button', { class: 'text-btn small gaveta-inicial', type: 'button', onclick: () => this.showHome() }, tx.telaInicial),
        corpo,
      );
    }
  }

  itemCard(item, modo) {
    const tx = t.inicio;
    const atual = this.arq.file && this.arq.file.caminho && this.arq.file.caminho.toLowerCase() === item.caminho.toLowerCase();
    const sub = item.existe ? tx.alterado(quando(item.alteradoEm)) : tx.naoEncontrado;
    return this.card({ nome: semExt(item.nome), sub, miniatura: item.miniatura, atual, item, title: item.caminho, disabled: !item.existe }, () => this.openItem(item), modo);
  }

  // um projeto: miniatura, nome, linha de baixo e (com arquivo) o lápis de renomear
  card({ nome, sub, miniatura = null, atual = false, item = null, title = null, disabled = false }, onOpen, modo) {
    const tx = t.inicio;
    const thumb = miniatura ? h('img', { class: 'proj-thumb', src: miniatura, alt: '' }) : h('span', { class: 'proj-thumb vazio', html: ICONS.cube || ICONS.folder });
    const nomeEl = h('span', { class: 'proj-nome' }, nome || '—');
    const abrir = h(
      'button',
      { class: 'proj-abrir', type: 'button', title, disabled },
      thumb,
      h('span', { class: 'proj-info' }, nomeEl, h('span', { class: 'proj-sub' }, atual && item ? `${tx.aberto} · ${sub}` : sub)),
    );
    abrir.addEventListener('click', onOpen);
    const el = h('div', { class: `proj proj-${modo}${atual ? ' atual' : ''}${disabled ? ' sumiu' : ''}` }, abrir);
    if (item && item.existe && this.arq.api) {
      el.append(h('button', { class: 'icon-btn tiny proj-renomear', type: 'button', title: tx.renomear, 'aria-label': tx.renomear, html: ICONS.rename, onclick: () => this.editName(el, item) }));
    }
    return el;
  }

  // renomear no lugar: Enter ou "Salvar nome" grava; Esc ou "Cancelar" volta
  editName(el, item) {
    const tx = t.inicio;
    const campo = h('input', { class: 'proj-nome-campo', value: semExt(item.nome), spellcheck: 'false', maxlength: '120', 'aria-label': tx.renomear });
    let feito = false;
    const fim = () => {
      feito = true;
      this.refresh();
    };
    const salvar = async () => {
      if (feito) return;
      const novo = campo.value.trim();
      if (!novo || novo === semExt(item.nome)) return fim();
      feito = true;
      campo.disabled = true;
      await this.arq.rename(item, novo);
      this.refresh();
    };
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        salvar();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        fim();
      }
    });
    const form = h(
      'div',
      { class: 'proj-editar' },
      campo,
      h('div', { class: 'proj-editar-acoes' }, h('button', { class: 'btn small', type: 'button', onclick: fim }, tx.cancelar), h('button', { class: 'btn small primary', type: 'button', onclick: salvar }, tx.salvarNome)),
    );
    el.querySelector('.proj-info').replaceChildren(form);
    el.querySelector('.proj-renomear')?.remove();
    // o botão de abrir não pode engolir cliques/teclas do campo
    const abrir = el.querySelector('.proj-abrir');
    abrir.replaceWith(h('div', { class: 'proj-abrir editando' }, ...abrir.childNodes));
    campo.focus();
    campo.select();
  }
}
