// Loading da abertura (#carregando em index.html): sai com um fade curto quando o projeto chegou e a
// cena desenhou o primeiro quadro. Nunca fica preso: erro na abertura ou o tempo máximo também tiram.
//
// No app desktop (window.forgiaAbertura, electron/preload.cjs) a janela do editor fica escondida atrás
// da janela de abertura (electron/splash.html) até o aviso de carregado: o loading em página não foi
// visto e sai sem fade, e não se esperam quadros — numa janela escondida o Chromium quase não os dá
// (~1,3 s pelos dois); a cena desenha quando a janela aparece.

const TEMPO_MAXIMO = 20000;

let saiu = false;

// tira o loading (uma vez só); com erro sai na hora para o erro ficar à vista
export function tirarCarregando({ agora = false } = {}) {
  if (saiu) return;
  saiu = true;
  performance.mark('forgia:carregado');
  const abertura = window.forgiaAbertura;
  const el = document.getElementById('carregando');
  if (el) {
    document.documentElement.dataset.carregado = '1';
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (agora || reduzido || abertura) el.remove();
    else {
      el.classList.add('saindo');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
    }
  }
  if (abertura) abertura.carregado();
}

// dois quadros (o primeiro desenho da cena já foi à tela); no desktop, nenhum (ver acima)
const quadros = () =>
  new Promise((r) => {
    if (window.forgiaAbertura) return r();
    requestAnimationFrame(() => requestAnimationFrame(r));
  });

// espera a promessa (projeto carregado) e os quadros
export function esperarPronto(pronto) {
  const limite = setTimeout(() => tirarCarregando(), TEMPO_MAXIMO);
  // pergunta na abertura (recuperar cópia, abrir outro arquivo) segura o projeto: sai para ela aparecer
  const modais = document.getElementById('modal-root');
  if (modais) {
    const obs = new MutationObserver(() => modais.childElementCount && (obs.disconnect(), tirarCarregando()));
    obs.observe(modais, { childList: true });
    obs.takeRecords();
    if (modais.childElementCount) tirarCarregando();
  }
  Promise.resolve(pronto)
    .then(() => {
      performance.mark('forgia:projeto');
      // o projeto da abertura chegou: o .forgia da 2ª instância já pode vir sem ser coberto por ele
      if (window.forgiaAbertura) window.forgiaAbertura.projetoPronto();
    })
    .then(quadros)
    .then(
      () => tirarCarregando(),
      () => tirarCarregando({ agora: true }),
    )
    .finally(() => clearTimeout(limite));
}

// erro não tratado antes do fim da abertura também tira (o erro não fica escondido atrás)
window.addEventListener('error', () => tirarCarregando({ agora: true }));
window.addEventListener('unhandledrejection', () => tirarCarregando({ agora: true }));
