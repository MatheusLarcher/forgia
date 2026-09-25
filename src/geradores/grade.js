// Grade / colmeia: placa W × D × espessura com furos sextavados (colmeia) ou quadrados, moldura
// cheia em volta. Deitada na mesa, espessura em Y. As células que a moldura corta são aparadas;
// sobra de célula pequena demais para imprimir (menos de 25% da célula ou mais estreita que
// 0,8 mm) fica cheia.
import { MeshBuilder, prism, onTable, cleanRing, ringArea } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('grid');
export const GRID_PARAMS = [
  P('width', { value: 60, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'largura' }),
  P('depth', { value: 60, min: 10, max: 300, step: 0.5, unit: 'mm', bridge: 'profundidade' }),
  P('thickness', { value: 3, min: 0.6, max: 30, step: 0.1, unit: 'mm', bridge: 'espessura' }),
  P('cell', { value: 8, min: 2, max: 50, step: 0.5, unit: 'mm', bridge: 'celula' }),
  P('wall', { value: 1.6, min: 0.6, max: 10, step: 0.1, unit: 'mm', bridge: 'parede' }),
  P('border', { value: 3, min: 0.8, max: 30, step: 0.1, unit: 'mm', bridge: 'moldura' }),
  P('pattern', { value: 0, min: 0, max: 1, kind: 'choice', options: [0, 1], optionsKey: 'pattern', bridge: 'padrao', bridgeOptions: { colmeia: 0, quadrado: 1 } }),
];

// recorta um polígono convexo pelo retângulo [x0, x1] × [y0, y1] (Sutherland–Hodgman)
function clipRect(poly, x0, y0, x1, y1) {
  const planes = [
    (p) => p[0] - x0,
    (p) => x1 - p[0],
    (p) => p[1] - y0,
    (p) => y1 - p[1],
  ];
  let out = poly;
  for (const f of planes) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    if (!out.length) return out;
  }
  return out;
}

export function gridCells(params) {
  const p = resolveParams(GRID_PARAMS, params);
  const W = p.width;
  const D = p.depth;
  const border = Math.min(p.border, Math.min(W, D) / 2 - 1);
  const x0 = -W / 2 + border;
  const x1 = W / 2 - border;
  const y0 = -D / 2 + border;
  const y1 = D / 2 - border;
  const holes = [];
  const pitch = p.cell + p.wall;
  const shapes = [];
  if (p.pattern === 0) {
    // sextavados com um canto em ±u; faces planas em ±v; célula = largura entre faces
    const rho = p.cell / Math.sqrt(3);
    const dx = (1.5 * pitch) / Math.sqrt(3);
    const dy = pitch;
    const nI = Math.ceil(W / 2 / dx) + 1;
    const nJ = Math.ceil(D / 2 / dy) + 1;
    for (let i = -nI; i <= nI; i++) {
      for (let j = -nJ; j <= nJ; j++) {
        const cx = i * dx;
        const cy = j * dy + (Math.abs(i) % 2 ? dy / 2 : 0);
        const hex = [];
        for (let k = 0; k < 6; k++) hex.push([cx + rho * Math.cos((k * Math.PI) / 3), cy + rho * Math.sin((k * Math.PI) / 3)]);
        shapes.push(hex);
      }
    }
  } else {
    const h = p.cell / 2;
    const n = Math.ceil(Math.max(W, D) / 2 / pitch) + 1;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const cx = i * pitch;
        const cy = j * pitch;
        shapes.push([[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]]);
      }
    }
  }
  const full = shapes.length ? Math.abs(ringArea(shapes[0])) : 0;
  if (x1 - x0 > 0.8 && y1 - y0 > 0.8) {
    for (const s of shapes) {
      const c = clipRect(s, x0, y0, x1, y1);
      if (c.length < 3) continue;
      const ring = cleanRing(c);
      if (ring.length < 3) continue;
      const area = Math.abs(ringArea(ring));
      let per = 0;
      for (let i = 0; i < ring.length; i++) per += Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
      if (area < 0.25 * full || (2 * area) / per < 0.4) continue; // 2·área/perímetro = raio inscrito
      holes.push(ring);
    }
  }
  const outer = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  return { p, outer, holes };
}

export function gridSize(params) {
  const p = resolveParams(GRID_PARAMS, params);
  return [p.width, p.thickness, p.depth];
}

export function buildGrid(params) {
  const { p, outer, holes } = gridCells(params);
  const b = new MeshBuilder();
  prism(b, outer, holes, 0, p.thickness, onTable);
  return b.toGeometry();
}
