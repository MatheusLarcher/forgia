// Dobradiça impressa pronta (print-in-place): duas folhas deitadas na mesa, eixo ao longo de X na
// altura do raio da junta, juntas intercaladas (A, B, A, …, sempre ímpar para o pino ficar preso
// nas duas pontas). A folha A (em +Z) carrega o pino, que atravessa as juntas da folha B (em −Z)
// com folga radial; entre juntas vizinhas há a mesma folga no eixo. As duas peças saem fechadas e
// separadas na mesma malha, sem se tocar em ponto nenhum.
//
// Raio da junta R = maior entre (pino/2 + folga + 1,2 mm de parede) e a espessura da folha (a
// folha B dobra 180° por cima da A sem bater). Folga padrão 0,4 mm: abaixo disso as peças soldam
// ao imprimir (regra de print-in-place).
//
// Perfil no plano (u, v) perpendicular ao eixo: u atravessa a dobradiça (folha A em u < 0), v é a
// altura; o eixo fica em (0, R) e a junta encosta na mesa em (0, 0).
import { MeshBuilder, layeredExtrude, roundTo } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('hinge');
export const HINGE_PARAMS = [
  P('length', { value: 40, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'comprimento' }),
  P('width', { value: 30, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'largura' }),
  P('thickness', { value: 2.5, min: 1, max: 10, step: 0.1, unit: 'mm', bridge: 'espessura' }),
  P('knuckles', { value: 5, min: 3, max: 15, step: 2, bridge: 'juntas' }),
  P('pin', { value: 3, min: 1.5, max: 20, step: 0.1, unit: 'mm', bridge: 'pino' }),
  P('clearance', { value: 0.4, min: 0.2, max: 1, step: 0.05, unit: 'mm', bridge: 'folga' }),
  P('segments', { value: 48, min: 16, max: 96, step: 4, bridge: 'segmentos' }),
];

const KNUCKLE_WALL = 1.2;

export function hingeDims(params) {
  const p = resolveParams(HINGE_PARAMS, params);
  const c = p.clearance;
  const rPin = p.pin / 2;
  const R = Math.max(rPin + c + KNUCKLE_WALL, p.thickness);
  let n = Math.max(3, Math.round(p.knuckles));
  if (n % 2 === 0) n += 1;
  // cada junta com pelo menos 1,5 mm
  while (n > 3 && (p.length - (n - 1) * c) / n < 1.5) n -= 2;
  const width = Math.max(p.width, 2 * (R + c + 1));
  const T = Math.min(p.thickness, R);
  return { p, c, rPin, R, n, width, T, length: p.length, kl: (p.length - (n - 1) * c) / n };
}

export function hingeSize(params) {
  const d = hingeDims(params);
  return [d.length, 2 * d.R, d.width];
}

export function buildHinge(params) {
  const { p, c, rPin, R, n, width, T, length, kl } = hingeDims(params);
  const N = roundTo(p.segments, 4);
  const pts = [];
  const add = (u, v) => {
    pts.push([u, v]);
    return pts.length - 1;
  };
  // círculo em volta do eixo (0, R); ângulo −90° = ponto mais baixo (encosta na mesa se r = R)
  const circle = (r, extra = []) => {
    const angles = [];
    for (let j = 0; j < N; j++) angles.push(-Math.PI / 2 + (2 * Math.PI * j) / N);
    for (const a of extra) {
      const k = angles.findIndex((b) => Math.abs(b - a) < 1e-6);
      if (k >= 0) angles[k] = a;
      else angles.push(a);
    }
    angles.sort((x, y) => x - y);
    return angles.map((a) => ({ a, i: add(r * Math.cos(a), R + r * Math.sin(a)) }));
  };
  // onde o círculo da junta corta o topo da folha (v = T), dos dois lados
  const aRight = Math.asin((T - R) / R);
  const aLeft = Math.PI - aRight;
  const pin = circle(rPin);
  const gap = circle(rPin + c);
  const kn = circle(R, [aRight, aLeft]);
  const idx = (ring) => ring.map((q) => q.i);
  const bottom = kn.find((q) => Math.abs(q.a + Math.PI / 2) < 1e-9).i;
  const right = kn.find((q) => q.a === aRight).i;
  const left = kn.find((q) => q.a === aLeft).i;
  const e = R + c; // as folhas começam a uma folga da junta da outra
  const w2 = width / 2;
  const aBL = add(-e, 0);
  const aTL = add(-e, T);
  const bBR = add(e, 0);
  const bTR = add(e, T);
  // arcos da junta que tocam as folhas (de baixo até a altura T)
  const arcLeft = kn.filter((q) => q.a >= aLeft - 1e-12 && q.a <= (3 * Math.PI) / 2 - 1e-12).map((q) => q.i).reverse(); // de baixo para cima pela esquerda
  const arcRight = kn.filter((q) => q.a >= -Math.PI / 2 + 1e-12 && q.a <= aRight + 1e-12).map((q) => q.i); // de baixo para cima pela direita
  // o ponto mais baixo (−90°) é o mesmo que 270°: fica no início dos dois arcos
  const armA = [aBL, bottom, ...arcLeft.filter((i) => i !== bottom), aTL];
  const armB = [bottom, bBR, bTR, ...[...arcRight].reverse().filter((i) => i !== bottom)];
  void left;
  void right;
  const farA = [add(-w2, 0), aBL, aTL, add(-w2, T)];
  const farB = [bBR, add(w2, 0), add(w2, T), bTR];
  const cells = [
    { rings: [idx(pin)] }, // 0 PINO
    { rings: [idx(gap), idx(pin)] }, // 1 FOLGA do pino
    { rings: [idx(kn), idx(gap)] }, // 2 JUNTA
    { rings: [armA] }, // 3 braço A
    { rings: [armB] }, // 4 braço B
    { rings: [farA] }, // 5 folha A
    { rings: [farB] }, // 6 folha B
  ];
  // camadas ao longo do eixo: junta A, folga, junta B, folga, …, junta A
  const planes = [0];
  const kinds = [];
  for (let k = 0; k < n; k++) {
    planes.push(planes[planes.length - 1] + kl);
    kinds.push(k % 2 === 0 ? 'A' : 'B');
    if (k < n - 1) {
      planes.push(planes[planes.length - 1] + c);
      kinds.push('gap');
    }
  }
  planes[planes.length - 1] = length;
  // eixo em X, folha A em +Z; (u, v, w) -> (w, v, −u)
  const map = (u, v, w) => [w, v, -u];
  const b = new MeshBuilder();
  layeredExtrude(b, { pts, cells, planes, layers: kinds.map((k) => (k === 'A' ? [0, 1, 2, 3, 5] : [0, 5])), map });
  layeredExtrude(b, { pts, cells, planes, layers: kinds.map((k) => (k === 'B' ? [2, 4, 6] : [6])), map });
  return b.toGeometry();
}
