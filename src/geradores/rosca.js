// Rosca métrica ISO grossa (perfil básico de 60°, ISO 68-1) e medidas das peças M2–M8.
//
// Fontes das tabelas (conferidas em 25/09/2026):
//   - passo grosso e porca sextavada ISO 4032 (s = largura entre faces máx., m = altura máx.):
//     https://amesweb.info/Fasteners/Nut/Metric-Hex-Nut-Sizes-Dimensions-Chart.aspx
//   - parafuso cabeça cilíndrica com sextavado interno ISO 4762 (dk, k, s da chave, t mín.):
//     https://engineeringhardware.com/guide/standard/iso-4762-socket-head-cap-screws/
//   - parafuso cabeça sextavada ISO 4017 (k nominal; s igual ao da porca ISO 4032 nesses tamanhos):
//     https://www.fasteners.eu/standards/iso/4017/
//
// Perfil básico (o mesmo para rosca externa e interna): H = √3/2·P; crista plana de P/8 no
// diâmetro maior D; fundo plano de P/4 no diâmetro menor D1 = D − 1,0825·P (5H/8 de profundidade);
// flancos a 30° do plano radial.
//
// Folga (c, mm): afastamento NORMAL às faces da rosca, por peça. O parafuso encolhe c e a porca
// cresce c: entre uma porca e um parafuso do Forgia, ambos com c, sobram 2c entre os flancos
// (no raio, isso é 2c na crista e no fundo e 4c no meio do flanco). O perfil deslocado mantém os
// cantos vivos (interseção das retas deslocadas), o que só aumenta a folga nos cantos.
//
// Hélice à direita. Em torno do eixo Y, com x = r·sen θ e z = r·cos θ, a fração do passo num ponto
// é u = y/P − θ/2π; a crista do parafuso fica em u = 0. A fase é a mesma em toda peça (u = 0 em
// y = 0 do quadro natural da peça, antes de centrar): uma porca a k·P da base de um parafuso
// casa com a rosca dele sem girar.

export const METRIC_SIZES = [2, 2.5, 3, 4, 5, 6, 8];

export const METRIC = {
  2: { pitch: 0.4, nut: { s: 4, m: 1.6 }, hexHead: { s: 4, k: 1.4 }, socketHead: { dk: 3.8, k: 2, s: 1.5, t: 1.0 } },
  2.5: { pitch: 0.45, nut: { s: 5, m: 2.0 }, hexHead: { s: 5, k: 1.7 }, socketHead: { dk: 4.5, k: 2.5, s: 2, t: 1.1 } },
  3: { pitch: 0.5, nut: { s: 5.5, m: 2.4 }, hexHead: { s: 5.5, k: 2.0 }, socketHead: { dk: 5.5, k: 3, s: 2.5, t: 1.3 } },
  4: { pitch: 0.7, nut: { s: 7, m: 3.2 }, hexHead: { s: 7, k: 2.8 }, socketHead: { dk: 7, k: 4, s: 3, t: 2.0 } },
  5: { pitch: 0.8, nut: { s: 8, m: 4.7 }, hexHead: { s: 8, k: 3.5 }, socketHead: { dk: 8.5, k: 5, s: 4, t: 2.5 } },
  6: { pitch: 1.0, nut: { s: 10, m: 5.2 }, hexHead: { s: 10, k: 4.0 }, socketHead: { dk: 10, k: 6, s: 5, t: 3.0 } },
  8: { pitch: 1.25, nut: { s: 13, m: 6.8 }, hexHead: { s: 13, k: 5.3 }, socketHead: { dk: 13, k: 8, s: 6, t: 4.0 } },
};

const SQRT3 = Math.sqrt(3);

// Folga automática (parâmetro folga = 0): P/8, no máximo 0,1 mm por peça. Uma folga normal c tira
// ~2c do engate no raio; com mais que P/8 as roscas finas (M2–M4) quase deixam de engatar (M2 com
// 0,1 mm já não engata). Com P/8 o engate fica em pelo menos ~50% da altura do filete:
// M2 0,05; M2.5 0,056; M3 0,0625; M4 0,0875; M5–M8 0,1 mm.
export const autoThreadClearance = (P) => Math.min(0.1, P / 8);

// diâmetros do perfil básico
export function threadDims(d, P) {
  const H = (SQRT3 / 2) * P;
  return { H, major: d, minor: d - 1.25 * H, pitchDiameter: d - 0.75 * H, depth: (5 / 8) * H };
}

// Perfil da rosca deslocado pela folga: raio em função da fração u ∈ [0, 1) do passo.
// internal = false: parafuso (encolhe c); true: porca (cresce c).
// Devolve { radiusAt(u), breaks, rMin, rMax }; breaks são as frações onde o perfil dobra.
export function threadProfile(d, P, c, internal) {
  const { minor } = threadDims(d, P);
  const R = d / 2;
  const r1 = minor / 2;
  const sg = internal ? 1 : -1;
  const hi = R + sg * c;
  const lo = r1 + sg * c;
  const line = (a) => R + 2 * sg * c - SQRT3 * (a - P / 16);
  const radiusAt = (u) => {
    const f = u - Math.floor(u);
    const a = Math.min(f, 1 - f) * P;
    return Math.min(hi, Math.max(lo, line(a)));
  };
  const aHi = P / 16 + (sg * c) / SQRT3;
  const aLo = P / 16 + (R - r1 + sg * c) / SQRT3;
  const set = [0, 0.5];
  for (const a of [aHi, aLo]) {
    const u = a / P;
    if (u > 1e-6 && u < 0.5 - 1e-6) set.push(u, 1 - u);
  }
  const breaks = [...new Set(set.map((u) => Math.round(u * 1e9) / 1e9))].sort((x, y) => x - y);
  const values = breaks.map(radiusAt);
  return { radiusAt, breaks, rMin: Math.min(...values), rMax: Math.max(...values) };
}

// Perfil de uma coluna θ da rosca entre y0 e y1: [[y, r], ...] com os pontos onde o perfil dobra
export function threadColumn(profile, P, theta, y0, y1) {
  const shift = theta / (2 * Math.PI);
  const at = (y) => profile.radiusAt(y / P - shift);
  const pts = [[y0, at(y0)]];
  const m0 = Math.floor(y0 / P - shift) - 1;
  const m1 = Math.ceil(y1 / P - shift) + 1;
  for (let m = m0; m <= m1; m++) {
    for (const u of profile.breaks) {
      const y = P * (u + m + shift);
      if (y > y0 + 1e-6 && y < y1 - 1e-6) pts.push([y, profile.radiusAt(u)]);
    }
  }
  pts.push([y1, at(y1)]);
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}
