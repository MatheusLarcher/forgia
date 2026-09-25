// SÓ PARA TESTAR tests/visual-runtime.cjs no exe ANTIGO (opção --simular-depois).
// Imitação grosseira dos ganchos da seção 11 da spec da Fase A (data-tema, #btn-theme,
// forgia.tema, window.forgia.theme, cartão .dica, crédito .lib-foot a.credit, bloco .sobre),
// injetada pelo CDP antes dos scripts da página. NÃO é o Forgia novo e NÃO é evidência da Fase A:
// serve para exercitar o caminho "depois" do roteiro enquanto o build novo não existe.
// Com --simular-defeitos, o roteiro define window.__simulacaoDefeitos antes deste arquivo e a
// imitação erra de propósito: serve para provar que cada verificação REPROVA o defeito.
(() => {
  if (window.__simulacaoFaseA) return;
  window.__simulacaoFaseA = true;
  const DEF = window.__simulacaoDefeitos || {};
  const KEY = 'forgia.tema';
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const resolve = () => saved() || (mq.matches ? 'escuro' : 'claro');
  const PLATE = { claro: '#d8e2ec', escuro: '#262c33' };
  const DICAS = {
    copy: { titulo: 'Copiar', atalho: 'Ctrl+C', texto: 'Copia as formas selecionadas para colar depois.' },
    paste: { titulo: 'Colar', atalho: 'Ctrl+V', texto: 'Cola as formas copiadas.' },
    group: { titulo: 'Agrupar', atalho: 'Ctrl+G', texto: 'Junta as formas selecionadas numa peça só.' },
    temaEscuro: { titulo: 'Tema escuro', texto: 'Muda para o tema escuro.' },
    temaClaro: { titulo: 'Tema claro', texto: 'Muda para o tema claro.' },
  };
  const setTema = (name) => document.documentElement && (document.documentElement.dataset.tema = name);
  setTema(resolve());

  const theme = {
    get name() {
      return document.documentElement.dataset.tema;
    },
    set(name, { save = true } = {}) {
      setTema(name);
      if (save && !DEF.naoSalva) localStorage.setItem(KEY, name);
      apply();
      if (DEF.geometria) for (const m of window.forgia.editor.meshes.values()) m.geometry = m.geometry.clone();
    },
    toggle() {
      this.set(this.name === 'escuro' ? 'claro' : 'escuro');
    },
  };
  mq.addEventListener('change', () => {
    if (saved() || DEF.naoSegueWindows) return;
    setTema(mq.matches ? 'escuro' : 'claro');
    apply();
  });

  function apply() {
    const dark = theme.name === 'escuro';
    const b = document.getElementById('btn-theme');
    if (b) {
      b.textContent = dark ? '☀' : '☾';
      b.dataset.dica = dark ? 'temaClaro' : 'temaEscuro';
      b.setAttribute('aria-label', dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
    }
    // cor da mesa sem recriar geometria (como a spec pede)
    const ed = window.forgia && window.forgia.editor;
    if (ed && ed.wp) ed.wp.traverse((o) => o.isMesh && o.material && o.material.type === 'MeshBasicMaterial' && o.material.color.set(PLATE[theme.name]));
  }

  function onReady() {
    setTema(resolve());
    const st = document.createElement('style');
    st.textContent = `
      [data-tema="escuro"] #app { filter: invert(.9) hue-rotate(180deg); }
      #btn-theme { font-size: 16px; }
      .dica { position: fixed; z-index: 60; width: 280px; background: #fff; color: #1e2226; border: 1px solid #dcdfe3; border-radius: 10px;
        padding: 12px 14px 14px; box-shadow: 0 8px 24px rgba(16,24,32,.14); font: 13px 'Segoe UI', sans-serif; display: none; }
      .dica.aberta { display: block; }
      .dica-titulo { font-weight: 600; font-size: 13.5px; }
      .dica-atalho { margin-top: 10px; } .dica-atalho kbd { border: 1px solid #c5cbd2; border-bottom-width: 2px; border-radius: 5px; padding: 0 6px; }
      .dica-texto { margin-top: 8px; color: #454c54; }
      .lib-foot { height: 32px; flex: none; display: flex; justify-content: flex-end; align-items: center; padding: 0 10px; border-top: 1px solid #dcdfe3; font-size: 11.5px; }`;
    document.head.append(st);
    const help = document.getElementById('btn-help');
    const b = document.createElement('button');
    b.id = 'btn-theme';
    b.className = 'icon-btn';
    b.addEventListener('click', () => theme.toggle());
    help.after(b);
    for (const el of document.querySelectorAll('[data-cmd], [data-view], #btn-new')) {
      el.dataset.dica = el.dataset.cmd || el.dataset.view || 'novo';
      if (!DEF.title) el.removeAttribute('title');
    }
    const foot = document.createElement('footer');
    foot.className = 'lib-foot';
    foot.innerHTML = DEF.linkNavega
      ? '<a class="credit" href="#forgia-simulacao">por LarcherTech (simulação com defeito)</a>'
      : '<a class="credit" href="about:blank#forgia-simulacao" target="_blank" rel="noopener noreferrer">por LarcherTech (simulação)</a>';
    document.getElementById('library').append(foot);
    new MutationObserver(() => {
      const body = document.querySelector('.modal .modal-body');
      if (body && body.querySelector('.gpu-line') && !body.querySelector('.sobre')) {
        const s = document.createElement('div');
        s.className = 'sobre';
        s.innerHTML = '<h4>Sobre o Forgia (simulação)</h4><p>Feito no Brasil, por um carioca — <a href="https://larchertech.com/" target="_blank" rel="noopener noreferrer">LarcherTech</a></p>';
        body.append(s);
      }
    }).observe(document.getElementById('modal-root'), { childList: true, subtree: true });

    // cartão de dica: 400 ms parado; some ao sair (150 ms); não abre com botão apertado
    const card = document.createElement('div');
    card.className = 'dica';
    card.id = 'dica-simulacao';
    card.setAttribute('role', 'tooltip');
    card.innerHTML = '<div class="dica-titulo"></div><div class="dica-atalho"></div><div class="dica-texto"></div>';
    document.body.append(card);
    let timer = 0;
    let closeTimer = 0;
    let current = null;
    const isOpen = () => card.classList.contains('aberta');
    const close = () => {
      clearTimeout(timer);
      clearTimeout(closeTimer);
      card.classList.remove('aberta');
      if (current) current.removeAttribute('aria-describedby');
      current = null;
    };
    const open = (el) => {
      const d = DICAS[el.dataset.dica] || { titulo: el.dataset.dica, texto: '' };
      card.querySelector('.dica-titulo').textContent = d.titulo;
      card.querySelector('.dica-atalho').innerHTML = d.atalho ? d.atalho.split('+').map((k) => `<kbd>${k}</kbd>`).join(' + ') : '<span class="dica-info">i</span>';
      card.querySelector('.dica-texto').textContent = d.texto;
      const r = el.getBoundingClientRect();
      card.style.left = Math.max(8, Math.min(innerWidth - 288, r.left + r.width / 2 - 140)) + 'px';
      card.style.top = r.bottom + 10 + 'px';
      card.classList.add('aberta');
      el.setAttribute('aria-describedby', card.id);
      current = el;
    };
    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.buttons && !DEF.abreComBotao) return close();
        if (card.contains(e.target)) return clearTimeout(closeTimer);
        const el = e.target.closest && e.target.closest('[data-dica]');
        if (!el) {
          clearTimeout(timer);
          if (isOpen() && !(DEF.naoFecha && current && current.dataset.dica === 'copy')) {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(close, 150);
          }
          return;
        }
        clearTimeout(closeTimer);
        if (isOpen() && current === el) return;
        if (isOpen()) close();
        clearTimeout(timer);
        timer = setTimeout(() => open(el), DEF.dicaImediata ? 0 : 400);
      },
      true,
    );
    document.addEventListener('pointerdown', () => DEF.abreComBotao || close(), true);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close(), true);
    apply();
    const iv = setInterval(() => {
      if (window.forgia && window.forgia.editor) {
        window.forgia.theme = theme;
        apply();
        clearInterval(iv);
      }
    }, 50);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
