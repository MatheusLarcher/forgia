// Loading da abertura (#carregando em index.html): sai com um fade curto quando o projeto chegou e a
// cena desenhou o primeiro quadro. Nunca fica preso: erro na abertura ou o tempo máximo também tiram.

const TEMPO_MAXIMO = 20000;

let saiu = false;

// tira o loading (uma vez só); com erro sai na hora para o erro ficar à vista
export function tirarCarregando({ agora = false } = {}) {
  if (saiu) return;
  saiu = true;
  const el = document.getElementById('carregando');
  if (!el) return;
  document.documentElement.dataset.carregado = '1';
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (agora || reduzido) return el.remove();
  el.classList.add('saindo');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

// espera a promessa (projeto carregado) e dois quadros: o primeiro desenho da cena já foi à tela
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
    .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(
      () => tirarCarregando(),
      () => tirarCarregando({ agora: true }),
    )
    .finally(() => clearTimeout(limite));
}

// erro não tratado antes do fim da abertura também tira (o erro não fica escondido atrás)
window.addEventListener('error', () => tirarCarregando({ agora: true }));
window.addEventListener('unhandledrejection', () => tirarCarregando({ agora: true }));
