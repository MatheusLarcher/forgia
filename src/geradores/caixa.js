// Caixa paramétrica com tampa de encaixe, pronta para imprimir: caixa aberta em cima e, ao lado
// (+X), a tampa de cabeça para baixo (placa na mesa, aba para cima). A aba entra na caixa com a
// folga por lado. Altura = altura total com a tampa fechada (caixa = altura − espessura da tampa).
// Cantos verticais arredondados pelo raio (0 = vivos).
import { MeshBuilder, layeredExtrude, onTable } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('lidBox');
export const LID_BOX_PARAMS = [
  P('width', { value: 60, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'largura' }),
  P('depth', { value: 40, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'profundidade' }),
  P('height', { value: 30, min: 5, max: 300, step: 0.5, unit: 'mm', bridge: 'altura' }),
  P('wall', { value: 2, min: 0.8, max: 10, step: 0.1, unit: 'mm', bridge: 'parede' }),
  P('floor', { value: 2, min: 0.6, max: 10, step: 0.1, unit: 'mm', bridge: 'fundo' }),
  P('lid', { value: 2, min: 0.6, max: 10, step: 0.1, unit: 'mm', bridge: 'tampa' }),
  P('lip', { value: 5, min: 1, max: 50, step: 0.5, unit: 'mm', bridge: 'aba' }),
  P('clearance', { value: 0.25, min: 0, max: 1, step: 0.05, unit: 'mm', bridge: 'folga' }),
  P('radius', { value: 3, min: 0, max: 50, step: 0.5, unit: 'mm', bridge: 'raio_cantos' }),
  P('part', { value: 0, min: 0, max: 2, kind: 'choice', options: [0, 1, 2], optionsKey: 'part', bridge: 'pecas', bridgeOptions: { caixa_e_tampa: 0, caixa: 1, tampa: 2 } }),
];

const GAP = 5; // entre a caixa e a tampa, lado a lado na mesa
const CORNER_STEPS = 8;

// retângulo w × d centrado em (cx, 0), cantos com raio r, anti-horário
function roundedRect(w, d, r, cx = 0) {
  const hw = w / 2;
  const hd = d / 2;
  r = Math.max(0, Math.min(r, hw - 0.01, hd - 0.01));
  if (r < 1e-3) return [[cx - hw, -hd], [cx + hw, -hd], [cx + hw, hd], [cx - hw, hd]];
  const pts = [];
  const corners = [
    [hw - r, -hd + r, -Math.PI / 2],
    [hw - r, hd - r, 0],
    [-hw + r, hd - r, Math.PI / 2],
    [-hw + r, -hd + r, Math.PI],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const a = a0 + ((Math.PI / 2) * i) / CORNER_STEPS;
      pts.push([cx + x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  }
  return pts;
}

export function lidBoxDims(params) {
  const p = resolveParams(LID_BOX_PARAMS, params);
  const { width: W, depth: D, clearance: c } = p;
  // paredes da caixa e da aba cabem: aba interna com pelo menos 2 mm de vão
  const wall = Math.min(p.wall, (Math.min(W, D) - 2 * c - 2) / 4);
  const lid = Math.min(p.lid, p.height - p.floor - 1);
  const boxH = p.height - lid;
  const lip = Math.min(p.lip, boxH - p.floor - 0.5);
  const radius = Math.min(p.radius, Math.min(W, D) / 2);
  return { p, W, D, c, wall, lid, boxH, lip, radius, floor: p.floor };
}

export function lidBoxSize(params) {
  const d = lidBoxDims(params);
  if (d.p.part === 1) return [d.W, d.boxH, d.D];
  if (d.p.part === 2) return [d.W, d.lid + d.lip, d.D];
  return [2 * d.W + GAP, Math.max(d.boxH, d.lid + d.lip), d.D];
}

// pontos e anéis de retângulos concêntricos (do maior para o menor) numa lista só
function nested(rects) {
  const pts = [];
  const rings = rects.map((ring) =>
    ring.map((q) => {
      pts.push(q);
      return pts.length - 1;
    }),
  );
  return { pts, rings };
}

function addBox(b, d, cx) {
  const { W, D, wall, radius, floor, boxH } = d;
  const { pts, rings } = nested([roundedRect(W, D, radius, cx), roundedRect(W - 2 * wall, D - 2 * wall, radius - wall, cx)]);
  // células: 0 = parede (anel), 1 = fundo interno
  layeredExtrude(b, {
    pts,
    cells: [{ rings: [rings[0], rings[1]] }, { rings: [rings[1]] }],
    planes: [0, floor, boxH],
    layers: [[0, 1], [0]],
    map: onTable,
  });
}

function addLid(b, d, cx) {
  const { W, D, wall, radius, c, lid, lip } = d;
  const inW = W - 2 * wall - 2 * c;
  const inD = D - 2 * wall - 2 * c;
  const rIn = radius - wall - c;
  const { pts, rings } = nested([roundedRect(W, D, radius, cx), roundedRect(inW, inD, rIn, cx), roundedRect(inW - 2 * wall, inD - 2 * wall, rIn - wall, cx)]);
  // células: 0 = borda da placa, 1 = aba (anel), 2 = miolo
  layeredExtrude(b, {
    pts,
    cells: [{ rings: [rings[0], rings[1]] }, { rings: [rings[1], rings[2]] }, { rings: [rings[2]] }],
    planes: [0, lid, lid + lip],
    layers: [[0, 1, 2], [1]],
    map: onTable,
  });
}

export function buildLidBox(params) {
  const d = lidBoxDims(params);
  const b = new MeshBuilder();
  const part = d.p.part;
  if (part === 1) addBox(b, d, 0);
  else if (part === 2) addLid(b, d, 0);
  else {
    const off = (d.W + GAP) / 2;
    addBox(b, d, -off);
    addLid(b, d, off);
  }
  return b.toGeometry();
}
