// Engrenagem de dentes retos, perfil evolvente, ângulo de pressão 20°, dentes padrão
// (cabeça 1·m, pé 1,25·m). O perfil sai da cremalheira que gera o dente: evolvente acima do
// círculo de base e, no pé, a trocoide da quina da cremalheira (o rebaixo, "undercut", das
// engrenagens de poucos dentes). Duas engrenagens do mesmo módulo engrenam na distância entre
// centros m·(z1 + z2)/2; com o rebaixo gerado, mesmo um pinhão de 12 dentes não interfere nem
// com folga zero (o flanco radial comum abaixo da base interferiria: 0,002 mm contra z = 20 e
// 0,012 mm contra z = 120, com m = 1,5 — veja tests/geradores-engrenagem.test.mjs).
//
// Folga entre dentes (backlash, mm): cada dente fica backlash/2 mais fino no círculo primitivo;
// duas engrenagens com o mesmo valor somam backlash de folga no primitivo.
//
// Plano do perfil (u, v): dente 0 centrado no ângulo 0 (aponta para +u = +X). Deitada na mesa
// (Y para cima, espessura em Y), vista de cima: um giro anti-horário no plano (u, v) é um giro
// positivo em torno de +Y. Para engrenar com outra colocada em +X, gire a segunda por
// meshRotation(z2) em torno de Y (meio passo quando z2 é par).
import { MeshBuilder, prism, onTable, cleanRing } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('gear');
export const GEAR_PARAMS = [
  P('module', { value: 1.5, min: 0.5, max: 5, step: 0.1, unit: 'mm', bridge: 'modulo' }),
  P('teeth', { value: 20, min: 8, max: 120, step: 1, bridge: 'dentes' }),
  P('thickness', { value: 6, min: 1, max: 50, step: 0.5, unit: 'mm', bridge: 'espessura' }),
  P('bore', { value: 5, min: 0, max: 100, step: 0.1, unit: 'mm', bridge: 'furo' }),
  P('backlash', { value: 0.2, min: 0, max: 1, step: 0.05, unit: 'mm', bridge: 'folga_dentes' }),
  P('resolution', { value: 8, min: 3, max: 30, step: 1, bridge: 'resolucao' }),
];

const ALPHA = (20 * Math.PI) / 180;
const inv = (a) => Math.tan(a) - a;

export const centerDistance = (module, z1, z2) => (module * (z1 + z2)) / 2;
export const meshRotation = (z2) => (Math.round(z2) % 2 === 0 ? Math.PI / Math.round(z2) : 0);

// meia espessura angular do dente em função do raio, gerada pela cremalheira
export function toothFlank(m, z, backlash) {
  const r = (m * z) / 2;
  const rb = r * Math.cos(ALPHA);
  const hf = 1.25 * m;
  const rRoot = r - hf;
  const s = (Math.PI * m) / 2 - backlash / 2; // espessura no primitivo
  const xiC = s / 2 + hf * Math.tan(ALPHA); // quina da cremalheira, a partir do centro do vão dela
  const betaInv = (R) => s / (2 * r) + inv(ALPHA) - inv(Math.acos(Math.min(1, rb / R)));
  const betaTroch = (R) => {
    const w = Math.sqrt(Math.max(0, R * R - rRoot * rRoot));
    const a = Math.atan2(w, rRoot);
    return Math.min((xiC - w) / r + a, (xiC + w) / r - a);
  };
  // abaixo deste raio o flanco reto da cremalheira não toca: só a quina (trocoide) gera o pé
  const sin2 = Math.sin(ALPHA) ** 2;
  const rGen = hf <= r * sin2 ? Math.sqrt(rRoot * rRoot + (hf / Math.tan(ALPHA)) ** 2) : rb;
  const beta = (R) => (R >= rGen ? Math.min(betaTroch(R), betaInv(R)) : betaTroch(R));
  return { r, rb, rRoot, rGen, beta, betaInv, betaTroch };
}

function bisect(f, a, b, n = 60) {
  let fa = f(a);
  for (let i = 0; i < n; i++) {
    const c = (a + b) / 2;
    const fc = f(c);
    if (fa * fc <= 0) b = c;
    else {
      a = c;
      fa = fc;
    }
  }
  return (a + b) / 2;
}

// Contorno 2D da engrenagem (sem o furo): { points: [[u, v], ...] anti-horário, ra, rf, r, ... }
export function gearOutline(params) {
  const p = resolveParams(GEAR_PARAMS, params);
  const m = p.module;
  const z = Math.round(p.teeth);
  const K = Math.round(p.resolution);
  const f = toothFlank(m, z, p.backlash);
  const rf = f.rRoot;
  let ra = f.r + m;
  // dente pontudo (poucos dentes + muita folga): corta a cabeça onde a meia espessura é 0,002 rad
  const minBeta = 0.002;
  if (f.beta(ra) < minBeta) ra = bisect((R) => f.beta(R) - minBeta, Math.max(rf, f.rGen), ra);
  // raio onde a evolvente passa a mandar (acima da trocoide)
  let rJoin = Math.max(f.rGen, rf);
  if (rJoin < ra && f.betaTroch(rJoin) < f.betaInv(rJoin)) {
    const g = (R) => f.betaTroch(R) - f.betaInv(R);
    if (g(ra) > 0) rJoin = bisect(g, rJoin, ra);
  }
  const radii = [];
  const Kt = Math.max(3, Math.ceil(K / 2));
  // pé (trocoide): pontos mais densos junto ao círculo de pé, onde ela é quase radial
  for (let i = 0; i < Kt; i++) radii.push(rf + (rJoin - rf) * (i / Kt) ** 2);
  for (let i = 0; i <= K; i++) radii.push(rJoin + ((ra - rJoin) * i) / K);
  const flank = radii.filter((R, i) => i === 0 || R - radii[i - 1] > 1e-6).map((R) => [R, f.beta(R)]);
  return { points: toothOutline(z, flank), ra, rf, r: f.r, rb: f.rb, z, module: m, params: p };
}

// Contorno anti-horário de z dentes a partir do flanco [[R, meia espessura angular], ...] com R
// crescente (do pé à cabeça); o fundo entre dentes é um arco no raio do 1º ponto
export function toothOutline(z, flank) {
  const pitch = (2 * Math.PI) / z;
  const polar = (R, a) => [R * Math.cos(a), R * Math.sin(a)];
  const pts = [];
  const [rf, bRoot] = flank[0];
  const ra = flank[flank.length - 1][0];
  for (let j = 0; j < z; j++) {
    const g = j * pitch;
    for (const [R, b] of flank) pts.push(polar(R, g - b));
    pts.push(polar(ra, g)); // meio da cabeça: acerta a caixa em ±ra
    for (let i = flank.length - 1; i >= 0; i--) pts.push(polar(flank[i][0], g + flank[i][1]));
    const gap = pitch - 2 * bRoot;
    for (let q = 1; q < 3; q++) pts.push(polar(rf, g + bRoot + (gap * q) / 3));
  }
  return cleanRing(pts);
}

function boreRing(p, rf) {
  const d = Math.min(p.bore, 2 * (rf - 1));
  if (d <= 0.2) return null;
  const n = Math.max(24, Math.min(96, Math.round((Math.PI * d) / 0.6)));
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([(d / 2) * Math.cos(a), (d / 2) * Math.sin(a)]);
  }
  return ring;
}

export function gearSize(params) {
  const o = gearOutline(params);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of o.points) {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return [maxU - minU, o.params.thickness, maxV - minV];
}

// Engrenagem deitada na mesa, espessura em Y, furo central (0 = sem furo; limitado a 1 mm do pé)
export function buildGear(params) {
  const o = gearOutline(params);
  const hole = boreRing(o.params, o.rf);
  const b = new MeshBuilder();
  prism(b, o.points, hole ? [hole] : [], 0, o.params.thickness, onTable);
  return b.toGeometry();
}
