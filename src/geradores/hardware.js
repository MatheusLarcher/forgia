// Hardware paramétrico em mm: porca sextavada, parafuso, furo para parafuso e porca, furo para
// inserto a quente. Funções puras: build(params) -> BufferGeometry (convenção em malha.js);
// size(params) -> [x, y, z] (caixa natural em mm, eixos internos, Y para cima), sem gerar malha.
//
// Todas as peças giram em torno de Y. Os sextavados têm faces planas perpendiculares a X e cantos
// em ±Z: X = largura entre faces, Z = largura entre cantos. Segmentos por volta são arredondados
// para múltiplo de 12 (acerta cantos do sextavado e os extremos em X e Z).
import { MeshBuilder, revolve, hexRadius, roundTo, plLine, plMin, plMax } from './malha.js';
import { METRIC, METRIC_SIZES, threadDims, threadProfile, threadColumn, autoThreadClearance } from './rosca.js';
import { paramFactory, resolveParams } from './parametros.js';

const SQRT3 = Math.sqrt(3);
// chanfro de 30° nos cantos do sextavado (porca e cabeça sextavada): começa num círculo de
// 0,9·s na face, como o círculo de apoio das porcas ISO
const HEX_CHAMFER = 0.45;

const toRY = (pl) => pl.map(([y, r]) => [r, y]);
const last = (a) => a[a.length - 1];

// perfil externo de um sextavado de altura H, com chanfro nas duas faces
function hexSide(s, H, theta) {
  const h = hexRadius(s, theta);
  const rc = HEX_CHAMFER * s;
  let f = plLine(0, h, H, h);
  f = plMin(f, plLine(0, rc, H, rc + SQRT3 * H));
  f = plMin(f, plLine(0, rc + SQRT3 * H, H, rc));
  return f;
}

const THREAD = { value: 1, min: 0, max: 1, kind: 'toggle', options: [0, 1], optionsKey: 'thread', bridge: 'rosca', bridgeOptions: { lisa: 0, real: 1 } };
// folga da rosca por peça; 0 = automática (autoThreadClearance em rosca.js)
const THREAD_CLEARANCE = { value: 0, min: 0, max: 0.4, step: 0.01, unit: 'mm', bridge: 'folga' };
const clearanceFor = (p, P) => (p.clearance > 0 ? p.clearance : autoThreadClearance(P));
const SEGMENTS = { value: 48, min: 12, max: 96, step: 12, bridge: 'segmentos' };
const M = { value: 3, min: 2, max: 8, step: 0.5, unit: 'mm', kind: 'choice', options: METRIC_SIZES, optionsKey: 'm', bridge: 'm' };

// ---------- porca sextavada (ISO 4032) ----------

const nutP = paramFactory('nut');
export const NUT_PARAMS = [
  nutP('m', M),
  nutP('thread', THREAD),
  nutP('clearance', THREAD_CLEARANCE),
  nutP('segments', SEGMENTS),
];

function nutSpec(params) {
  const p = resolveParams(NUT_PARAMS, params);
  const spec = METRIC[p.m];
  return { p, s: spec.nut.s, H: spec.nut.m, P: spec.pitch };
}

export function nutSize(params) {
  const { s, H } = nutSpec(params);
  return [s, H, (2 * s) / SQRT3];
}

// Porca com rosca real (perfil ISO deslocado pela folga) ou lisa. Lisa = furo piloto para
// parafuso autoatarraxante: Ø = diâmetro menor + 2·folga. Escareado de 45° nas duas faces.
export function buildNut(params) {
  const { p, s, H, P } = nutSpec(params);
  const c = clearanceFor(p, P);
  const prof = threadProfile(p.m, P, c, true);
  const rPilot = threadDims(p.m, P).minor / 2 + c;
  const rCs = p.m / 2 + c + 0.05 * p.m;
  const b = new MeshBuilder();
  revolve(b, roundTo(p.segments, 12), (th) => {
    let inner = p.thread ? threadColumn(prof, P, th, 0, H) : plLine(0, rPilot, H, rPilot);
    inner = plMax(inner, plLine(0, rCs, H, rCs - H));
    inner = plMax(inner, plLine(0, rCs - H, H, rCs));
    const outer = hexSide(s, H, th);
    return {
      closed: true,
      segments: [
        { key: 'r', pts: [[inner[0][1], 0], [outer[0][1], 0]] },
        { key: 'y', pts: toRY(outer) },
        { key: '-r', pts: [[last(outer)[1], H], [last(inner)[1], H]] },
        { key: '-y', pts: toRY(inner).reverse() },
      ],
    };
  });
  return b.toGeometry();
}

// ---------- parafuso (ISO 4017 sextavado / ISO 4762 cilíndrico com sextavado interno) ----------

const boltP = paramFactory('bolt');
export const BOLT_PARAMS = [
  boltP('m', M),
  boltP('length', { value: 10, min: 2, max: 80, step: 0.5, unit: 'mm', bridge: 'comprimento' }),
  boltP('head', { value: 1, min: 0, max: 1, kind: 'choice', options: [0, 1], optionsKey: 'head', bridge: 'cabeca', bridgeOptions: { cilindrica: 0, sextavada: 1 } }),
  boltP('thread', THREAD),
  boltP('clearance', THREAD_CLEARANCE),
  boltP('segments', SEGMENTS),
];

function boltSpec(params) {
  const p = resolveParams(BOLT_PARAMS, params);
  const spec = METRIC[p.m];
  const hex = p.head === 1;
  const k = hex ? spec.hexHead.k : spec.socketHead.k;
  return { p, spec, hex, k, P: spec.pitch, total: k + p.length };
}

export function boltSize(params) {
  const { spec, hex, total } = boltSpec(params);
  if (hex) return [spec.hexHead.s, total, (2 * spec.hexHead.s) / SQRT3];
  return [spec.socketHead.dk, total, spec.socketHead.dk];
}

// Parafuso de cabeça para baixo (a cabeça apoiada na mesa é como ele imprime melhor, sem suporte):
// cabeça de y = 0 a k, corpo roscado (rosca até a cabeça) de k a k + comprimento, ponta com
// chanfro de 45° até o diâmetro menor. Lisa: corpo liso com Ø = d − 2·folga.
export function buildBolt(params) {
  const { p, spec, hex, k, P, total } = boltSpec(params);
  const c = clearanceFor(p, P);
  const prof = threadProfile(p.m, P, c, false);
  const rTip = threadDims(p.m, P).minor / 2 - c;
  const rPlain = p.m / 2 - c;
  const b = new MeshBuilder();
  revolve(b, roundTo(p.segments, 12), (th) => {
    let shank = p.thread ? threadColumn(prof, P, th, k, total) : plLine(k, rPlain, total, rPlain);
    shank = plMin(shank, plLine(k, rTip + (total - k), total, rTip));
    const tail = [
      { key: 'y', pts: toRY(shank) },
      { key: '-r', pts: [[last(shank)[1], total], [0, total]] },
    ];
    if (hex) {
      const side = hexSide(spec.hexHead.s, k, th);
      return {
        segments: [
          { key: 'r', pts: [[0, 0], [side[0][1], 0]] },
          { key: 'y', pts: toRY(side) },
          { key: '-r', pts: [[last(side)[1], k], [shank[0][1], k]] },
          ...tail,
        ],
      };
    }
    const { dk, s, t } = spec.socketHead;
    const hs = hexRadius(s, th);
    const R0 = dk / 2;
    const ch = 0.05 * dk; // chanfro de 45° na borda que fica na mesa
    const side = plMin(plLine(0, R0, k, R0), plLine(0, R0 - ch, k, R0 - ch + k));
    return {
      segments: [
        { key: 'r', pts: [[0, t], [hs, t]] },
        { key: '-y', pts: [[hs, t], [hs, 0]] },
        { key: 'r', pts: [[hs, 0], [side[0][1], 0]] },
        { key: 'y', pts: toRY(side) },
        { key: '-r', pts: [[last(side)[1], k], [shank[0][1], k]] },
        ...tail,
      ],
    };
  });
  return b.toGeometry();
}

// ---------- furo para parafuso e porca ----------

const holeP = paramFactory('boltHole');
export const BOLT_HOLE_PARAMS = [
  holeP('m', M),
  holeP('length', { value: 12, min: 2, max: 100, step: 0.5, unit: 'mm', bridge: 'comprimento' }),
  holeP('head', { value: 0, min: 0, max: 2, kind: 'choice', options: [0, 1, 2], optionsKey: 'head', bridge: 'cabeca', bridgeOptions: { cilindrica: 0, sextavada: 1, sem_rebaixo: 2 } }),
  holeP('nut', { value: 1, min: 0, max: 1, kind: 'toggle', options: [0, 1], optionsKey: 'nut', bridge: 'bolsao_porca', bridgeOptions: { nao: 0, sim: 1 } }),
  holeP('clearance', { value: 0.2, min: 0, max: 0.6, step: 0.05, unit: 'mm', bridge: 'folga' }),
  holeP('segments', SEGMENTS),
];

// medidas derivadas do furo; o comprimento efetivo cresce se não couberem rebaixo + bolsão + 1 mm
export function boltHoleDims(params) {
  const p = resolveParams(BOLT_HOLE_PARAMS, params);
  const spec = METRIC[p.m];
  const c = p.clearance;
  const rThrough = p.m / 2 + c;
  let rHead = 0;
  let hHead = 0;
  if (p.head === 0) {
    rHead = spec.socketHead.dk / 2 + c;
    hHead = spec.socketHead.k + c;
  } else if (p.head === 1) {
    rHead = spec.hexHead.s / SQRT3 + c; // círculo que passa nos cantos da cabeça
    hHead = spec.hexHead.k + c;
  }
  const nutAF = p.nut ? spec.nut.s + 2 * c : 0;
  const hNut = p.nut ? spec.nut.m + c : 0;
  const length = Math.max(p.length, hHead + hNut + 1);
  return { p, rThrough, rHead, hHead, nutAF, hNut, length };
}

export function boltHoleSize(params) {
  const d = boltHoleDims(params);
  const x = Math.max(2 * d.rThrough, 2 * d.rHead, d.nutAF);
  const z = Math.max(2 * d.rThrough, 2 * d.rHead, (2 * d.nutAF) / SQRT3);
  return [x, d.length, z];
}

// Geometria do VAZIO (para usar como furo): bolsão sextavado da porca embaixo (y = 0), furo
// passante (Ø = d + 2·folga, ISO 273 médio para M3 = 3,4) e rebaixo da cabeça em cima. Rebaixo
// e bolsão têm a medida da cabeça/porca + 2·folga e a altura dela + folga.
export function buildBoltHole(params) {
  const d = boltHoleDims(params);
  const { rThrough: rt, rHead, hHead, nutAF, hNut, length: L } = d;
  const b = new MeshBuilder();
  revolve(b, roundTo(d.p.segments, 12), (th) => {
    const segs = [];
    let yA = 0;
    if (nutAF > 0) {
      const hn = hexRadius(nutAF, th);
      segs.push({ key: 'r', pts: [[0, 0], [hn, 0]] }, { key: 'y', pts: [[hn, 0], [hn, hNut]] }, { key: '-r', pts: [[hn, hNut], [rt, hNut]] });
      yA = hNut;
    } else segs.push({ key: 'r', pts: [[0, 0], [rt, 0]] });
    const yB = rHead > 0 ? L - hHead : L;
    segs.push({ key: 'y', pts: [[rt, yA], [rt, yB]] });
    if (rHead > 0) segs.push({ key: 'r', pts: [[rt, yB], [rHead, yB]] }, { key: 'y', pts: [[rHead, yB], [rHead, L]] }, { key: '-r', pts: [[rHead, L], [0, L]] });
    else segs.push({ key: '-r', pts: [[rt, L], [0, L]] });
    return { segments: segs };
  });
  return b.toGeometry();
}

// ---------- furo para inserto a quente ----------

// Insertos padrão CNC Kitchen (os ruthex têm as mesmas medidas), datasheet nas páginas da 3DJake:
//   https://www.3djake.com/cnc-kitchen/threaded-inserts-m2-standard  (M2: L 3,0; Ø ext 3,6; furo 3,2; parede 1,3)
//   https://www.3djake.com/cnc-kitchen/threaded-inserts-m3-standard  (M3: L 5,7; Ø ext 4,6; furo 4,0; parede 1,6)
//   https://www.3djake.com/cnc-kitchen/threaded-inserts-m4-standard  (M4: L 8,1; Ø ext 6,3; furo 5,6; parede 2,1)
// Profundidade automática = comprimento + 1 mm: margem nossa (não do fabricante) para o plástico
// deslocado pelo inserto.
export const INSERTS = {
  2: { hole: 3.2, length: 3.0, outer: 3.6, wall: 1.3 },
  3: { hole: 4.0, length: 5.7, outer: 4.6, wall: 1.6 },
  4: { hole: 5.6, length: 8.1, outer: 6.3, wall: 2.1 },
};
const INSERT_DEPTH_MARGIN = 1;

const insP = paramFactory('insertHole');
export const INSERT_HOLE_PARAMS = [
  insP('m', { ...M, options: [2, 3, 4], min: 2, max: 4, step: 1, optionsKey: 'm' }),
  insP('diameter', { value: 0, min: 0, max: 12, step: 0.05, unit: 'mm', bridge: 'diametro' }),
  insP('depth', { value: 0, min: 0, max: 30, step: 0.1, unit: 'mm', bridge: 'profundidade' }),
  insP('chamfer', { value: 0.5, min: 0, max: 1.5, step: 0.1, unit: 'mm', bridge: 'chanfro' }),
  insP('segments', SEGMENTS),
];

export function insertHoleDims(params) {
  const p = resolveParams(INSERT_HOLE_PARAMS, params);
  const ins = INSERTS[p.m];
  const r = (p.diameter > 0 ? p.diameter : ins.hole) / 2;
  const depth = p.depth > 0 ? p.depth : ins.length + INSERT_DEPTH_MARGIN;
  const ch = Math.min(p.chamfer, depth / 2, r);
  return { p, r, depth, ch };
}

export function insertHoleSize(params) {
  const { r, depth, ch } = insertHoleDims(params);
  return [2 * (r + ch), depth, 2 * (r + ch)];
}

// Geometria do VAZIO: furo cego com o fundo em y = 0 e a boca em cima (y = profundidade), com
// chanfro de entrada de 45° que centra o inserto. Diâmetro e profundidade 0 = medida do fabricante.
export function buildInsertHole(params) {
  const { p, r, depth, ch } = insertHoleDims(params);
  const b = new MeshBuilder();
  const side = ch > 0 ? [[r, 0], [r, depth - ch], [r + ch, depth]] : [[r, 0], [r, depth]];
  revolve(b, roundTo(p.segments, 12), () => ({
    segments: [
      { key: 'r', pts: [[0, 0], [r, 0]] },
      { key: 'y', pts: side },
      { key: '-r', pts: [[r + ch, depth], [0, depth]] },
    ],
  }));
  return b.toGeometry();
}
