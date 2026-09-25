// Sistema de coordenadas único do usuário e da ponte da IA (Fase C):
//   mm, Z para cima, X para a direita, Y para o fundo da mesa, origem no centro da mesa.
// É o mesmo do STL exportado (exportScene gira a cena +90° em X), só com a origem no centro.
// Por dentro o Forgia usa o do three.js: Y para cima e Z para a frente da mesa. Então:
//   interno (x, y, z)  ->  usuário (x, −z, y)
//   usuário (X, Y, Z)  ->  interno (X, Z, −Y)
// A conversão é linear (sem translação): vale igual para pontos e para diferenças (ΔX, ΔY, ΔZ).
// Toda tela ou comando que mostra ou recebe X/Y/Z passa por aqui (régua Medir, barra de status e
// ponte da IA). Aceita [x, y, z] ou { x, y, z } e devolve sempre [x, y, z].

const xyz = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const n0 = (v) => (v === 0 ? 0 : v); // sem −0 (senão aparece "-0" na tela)

export function toUser(p) {
  const [x, y, z] = xyz(p);
  return [n0(x), n0(-z), n0(y)];
}

export function fromUser(p) {
  const [X, Y, Z] = xyz(p);
  return [n0(X), n0(Z), n0(-Y)];
}

// caixa envolvente interna (mín/máx) -> caixa no sistema do usuário. O Y do usuário é −z interno,
// então o mínimo de Y vem do máximo de z (e vice-versa)
export function boxToUser(min, max) {
  const a = xyz(min);
  const b = xyz(max);
  return { min: [n0(a[0]), n0(-b[2]), n0(a[1])], max: [n0(b[0]), n0(-a[2]), n0(b[1])] };
}
