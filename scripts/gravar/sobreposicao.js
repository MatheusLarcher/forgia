// Sobreposição do modo gravação, injetada na página do Forgia pelo main (executeJavaScript).
// Só existe durante a gravação das dicas; o programa em si não tem nada disto.
// - Cursor falso: seta desenhada aqui (traço branco com contorno escuro, visível nos dois temas).
//   Ele segue os eventos de ponteiro da própria página (ouvidos na captura, em window): como o
//   mouse do roteiro chega como entrada real (CDP Input.dispatchMouseEvent), o cursor falso fica
//   exatamente onde o clique acontece. Apertar encolhe a seta e solta um anel laranja.
// - Selo de teclas: quando o roteiro aperta um atalho, as teclas aparecem no canto do recorte,
//   no estilo dos <kbd> do cartão de dica (variáveis do tema).
// - O cursor de verdade some (cursor: none), para não aparecer na captura da janela.
(() => {
  if (window.__gravacao) return;
  const css = document.createElement('style');
  css.textContent = `
*, *::before, *::after { cursor: none !important; }
.grav-cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; z-index: 2147483646; pointer-events: none; transform: translate(-200px, -200px); }
.grav-cursor svg { display: block; width: 100%; height: 100%; overflow: visible; transform-origin: 4px 3px; transition: transform 90ms ease-out; filter: drop-shadow(0 1px 1.2px rgba(0, 0, 0, 0.35)); }
.grav-cursor.apertado svg { transform: scale(0.86); }
.grav-anel { position: fixed; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; border: 2.5px solid #f58220; background: rgba(245, 130, 32, 0.18); z-index: 2147483645; pointer-events: none; animation: grav-anel 420ms ease-out forwards; }
@keyframes grav-anel { from { transform: var(--p) scale(0.35); opacity: 0.95; } to { transform: var(--p) scale(1.15); opacity: 0; } }
.grav-selo { position: fixed; z-index: 2147483644; pointer-events: none; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 10px; background: var(--panel-raised); border: 1px solid var(--line); box-shadow: var(--shadow-2); font: 600 19px/1 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; color: var(--ink); opacity: 0; transform: translateY(6px); transition: opacity 140ms, transform 140ms; }
.grav-selo.visivel { opacity: 1; transform: none; }
.grav-selo kbd { display: inline-grid; place-items: center; min-width: 38px; height: 38px; padding: 0 10px; border: 1px solid var(--line-strong); border-bottom-width: 3px; border-radius: 7px; background: var(--field); font: inherit; color: var(--ink); }
.grav-selo .mais { color: var(--muted); font-weight: 500; }
.grav-selo .rotulo { padding: 0 4px; }
.grav-legenda { position: fixed; z-index: 2147483644; pointer-events: none; max-width: 420px; padding: 9px 13px; border-radius: 10px; background: var(--panel-raised); border: 1px solid var(--line); box-shadow: var(--shadow-2); font: 500 15px/1.35 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; color: var(--ink); opacity: 0; transition: opacity 160ms; }
.grav-legenda.visivel { opacity: 1; }
.grav-legenda b { color: var(--accent-ink); font-weight: 600; }
`;
  document.head.append(css);

  const cursor = document.createElement('div');
  cursor.className = 'grav-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3 L4 19.5 L8.4 15.6 L11.3 21.8 L14.2 20.5 L11.4 14.4 L17.2 14.4 Z" fill="#ffffff" stroke="#1b1e22" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.body.append(cursor);
  let pos = { x: -200, y: -200 };
  const place = (x, y) => {
    pos = { x, y };
    // a ponta da seta (4, 3 no desenho) fica no ponto do evento
    cursor.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
  };
  const opts = { capture: true, passive: true };
  window.addEventListener('pointermove', (e) => place(e.clientX, e.clientY), opts);
  window.addEventListener(
    'pointerdown',
    (e) => {
      place(e.clientX, e.clientY);
      cursor.classList.add('apertado');
      const ring = document.createElement('div');
      ring.className = 'grav-anel';
      ring.style.setProperty('--p', `translate(${e.clientX}px, ${e.clientY}px)`);
      document.body.append(ring);
      setTimeout(() => ring.remove(), 500);
    },
    opts,
  );
  window.addEventListener('pointerup', () => cursor.classList.remove('apertado'), opts);

  const selo = document.createElement('div');
  selo.className = 'grav-selo';
  document.body.append(selo);
  let seloTimer = 0;
  const legenda = document.createElement('div');
  legenda.className = 'grav-legenda';
  document.body.append(legenda);

  // ---------- ajudantes do roteiro (arrumar a cena e achar pontos na tela) ----------
  const ed = () => window.forgia.editor;
  const vec = (x, y, z) => ed().camera.position.clone().set(x, y, z); // Vector3 do three da página
  const fromUser = ([X, Y, Z]) => vec(X, Z, -Y); // sistema do usuário (Z para cima) -> interno
  const findByName = (nome, list = ed().objects) => {
    for (const o of list) {
      if (o.name === nome) return o;
    }
    return null;
  };

  window.__gravacao = {
    get pos() {
      return pos;
    },
    place,
    // cena na pose inicial do roteiro: tema, projeto, câmera, seleção; nada disso entra no vídeo
    // como gesto (é a arrumação antes de gravar e, no fim, por baixo da imagem congelada)
    preparar({ tema, projeto, camera, selecionar = [], estilo = '' }) {
      const e = ed();
      // CSS a mais só deste roteiro (ex.: borrar caminhos do computador num diálogo)
      let extra = document.getElementById('grav-estilo');
      if (!extra) {
        extra = document.createElement('style');
        extra.id = 'grav-estilo';
        document.head.append(extra);
      }
      extra.textContent = estilo;
      window.forgia.theme.set(tema, { save: false });
      window.forgia.ui.closeModal && window.forgia.ui.closeModal();
      window.forgia.ui.dica && window.forgia.ui.dica.hide();
      if (e.tool) e.setTool(null);
      if (e.mode) e.setMode(null);
      e.clearMarks();
      e.loadProject(projeto, { view: false });
      if (e.isOrtho) e.setOrtho(false);
      const target = fromUser(camera.alvo);
      e.restoreView({ ortho: false, pos: fromUser(camera.de), target, up: vec(0, 1, 0), zoom: 1, orthoHeight: e.orthoHeight });
      const ids = selecionar.map((n) => findByName(n)).filter(Boolean).map((o) => o.id);
      e.select(ids);
      e.dimsVisibleUntil = 0;
      e.dimsHover = false;
      return ids.length === selecionar.length;
    },
    // ponto na janela (px CSS) de um alvo do roteiro:
    //   { seletor, fx?, fy? }          elemento da página (fração da caixa; padrão o centro)
    //   { peca, ancora: [x, y, z] }    peça do topo pelo nome; âncora de -1 a 1 na caixa dela,
    //                                  no sistema do usuário (ex.: [0, -1, 0] = meio da face da frente)
    //   { mundo: [X, Y, Z] }           ponto em mm no sistema do usuário
    //   { alca: 'top' }                alça da seleção (tipo da alça em src/handles.js)
    // dx/dy somam px na tela.
    alvo(spec) {
      const e = ed();
      const vp = e.viewport.getBoundingClientRect();
      const dx = spec.dx || 0;
      const dy = spec.dy || 0;
      if (spec.seletor) {
        const el = document.querySelector(spec.seletor);
        if (!el) throw new Error('alvo sem elemento: ' + spec.seletor);
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width * (spec.fx ?? 0.5) + dx, y: r.top + r.height * (spec.fy ?? 0.5) + dy };
      }
      let v = null;
      if (spec.mundo) v = fromUser(spec.mundo);
      if (spec.peca) {
        const o = findByName(spec.peca);
        if (!o) throw new Error('alvo sem peça: ' + spec.peca);
        const b = e.worldBox(o);
        const half = b.max.clone().sub(b.min).multiplyScalar(0.5);
        const [ax, ay, az] = spec.ancora || [0, 0, 0];
        v = b.getCenter(vec(0, 0, 0)).add(vec(ax * half.x, az * half.y, -ay * half.z));
      }
      if (spec.alca) {
        let found = null;
        e.scene.traverse((o) => {
          if (!found && o.userData && o.userData.handle && o.userData.handle.type === spec.alca) found = o;
        });
        if (!found) throw new Error('alvo sem alça: ' + spec.alca);
        v = found.getWorldPosition(vec(0, 0, 0));
      }
      if (!v) throw new Error('alvo desconhecido: ' + JSON.stringify(spec));
      const s = e.project(v);
      return { x: vp.left + s.x + dx, y: vp.top + s.y + dy };
    },
    vista() {
      const r = ed().viewport.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    esconderCursor(on) {
      cursor.style.visibility = on ? 'hidden' : '';
    },
    // teclas: 'Ctrl+D' | 'Shift+→' ...; rotulo: texto de botão (ex.: 'Criar encaixe'); canto: { x, y } (base esquerda)
    selo({ teclas, rotulo, canto, ms = 1100 }) {
      const parts = [];
      if (teclas) {
        teclas.split('+').forEach((k, i) => {
          if (i) parts.push(Object.assign(document.createElement('span'), { className: 'mais', textContent: '+' }));
          parts.push(Object.assign(document.createElement('kbd'), { textContent: k }));
        });
      }
      if (rotulo) parts.push(Object.assign(document.createElement('span'), { className: 'rotulo', textContent: rotulo }));
      selo.replaceChildren(...parts);
      selo.style.left = `${canto.x}px`;
      selo.style.top = `${canto.y - selo.offsetHeight}px`;
      selo.classList.add('visivel');
      clearTimeout(seloTimer);
      seloTimer = setTimeout(() => selo.classList.remove('visivel'), ms);
    },
    semSelo() {
      clearTimeout(seloTimer);
      selo.classList.remove('visivel');
    },
    // legenda (pedido feito à IA no vídeo do README); html simples, texto do roteiro
    legenda({ html, canto, visivel = true }) {
      if (html != null) legenda.innerHTML = html;
      if (canto) {
        legenda.style.left = `${canto.x}px`;
        legenda.style.top = `${canto.y}px`;
      }
      legenda.classList.toggle('visivel', visivel);
    },
  };
})();
