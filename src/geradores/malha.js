// Utilidades de malha dos geradores de forma (src/geradores/). Funções puras, sem estado global.
//
// Convenção de saída de todos os geradores (a mesma das formas de src/shapes.js):
//   - THREE.BufferGeometry indexada, só com o atributo 'position', em mm;
//   - Y para cima; a caixa envolvente é centrada na origem (como normalizeTo em shapes.js);
//   - malha fechada: toda aresta é de exatamente 2 triângulos, normais para fora, sem triângulo
//     degenerado. As normais ficam para o finalize() de shapes.js (toCreasedNormals).
//
// Nada aqui usa booleana (CSG): as peças saem fechadas por construção, de dois construtores:
//   - revolve(): sólido de revolução em torno de Y com um perfil por coluna θ (rosca, porca,
//     parafuso, furos). Cada coluna pode ter pontos em alturas diferentes (a hélice da rosca).
//   - layeredExtrude(): subdivisão plana conforme extrudada em camadas, cada camada com o seu
//     conjunto de células cheias (dobradiça, caixa, grade, engrenagem, texto).
import * as THREE from 'three';

// distância abaixo da qual dois pontos de um perfil são o mesmo (mm); acima da precisão do Float32
const TOL = 1e-5;

// ---------- construtor de malha indexada ----------

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
  }

  get triangleCount() {
    return this.idx.length / 3;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(x, y, z) {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }

  // triângulo com índice repetido (polo, ponto colapsado) é ignorado
  tri(a, b, c) {
    if (a === b || b === c || a === c) return;
    this.idx.push(a, b, c);
  }

  // volume com sinal dos triângulos a partir do triângulo `from`
  signedVolume(from = 0) {
    const p = this.pos;
    const ix = this.idx;
    let v = 0;
    for (let t = from * 3; t < ix.length; t += 3) {
      const a = ix[t] * 3;
      const b = ix[t + 1] * 3;
      const c = ix[t + 2] * 3;
      v +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return v / 6;
  }

  // deixa as normais do corpo (triângulos desde `from`) para fora: volume positivo
  orient(from = 0) {
    if (this.signedVolume(from) >= 0) return;
    const ix = this.idx;
    for (let t = from * 3; t < ix.length; t += 3) {
      const tmp = ix[t + 1];
      ix[t + 1] = ix[t + 2];
      ix[t + 2] = tmp;
    }
  }

  // desloca os vértices a partir do vértice `from`
  translate(dx, dy, dz, from = 0) {
    const p = this.pos;
    for (let i = from * 3; i < p.length; i += 3) {
      p[i] += dx;
      p[i + 1] += dy;
      p[i + 2] += dz;
    }
  }

  // BufferGeometry indexada; center = caixa envolvente na origem (calculada em Float64)
  toGeometry({ center = true } = {}) {
    const p = this.pos;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    if (center && p.length) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (p[i + k] < min[k]) min[k] = p[i + k];
          if (p[i + k] > max[k]) max[k] = p[i + k];
        }
      }
      cx = (min[0] + max[0]) / 2;
      cy = (min[1] + max[1]) / 2;
      cz = (min[2] + max[2]) / 2;
    }
    const arr = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      arr[i] = p[i] - cx;
      arr[i + 1] = p[i + 1] - cy;
      arr[i + 2] = p[i + 2] - cz;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- 2D ----------

export function ringArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// Anel limpo para uso isolado (sem vizinho que compartilhe vértices): tira pontos repetidos e
// pontos colineares com os vizinhos. Não use em células de uma subdivisão (layeredExtrude).
export function cleanRing(pts, tol = TOL) {
  let out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > tol) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= tol) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    const keep = [];
    for (let i = 0, n = out.length; i < n; i++) {
      const a = out[(i + n - 1) % n];
      const b = out[i];
      const c = out[(i + 1) % n];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cross2(a, b, c)) / len <= tol * 0.1) changed = true;
      else keep.push(b);
    }
    out = keep;
  }
  return out;
}

// p no interior do segmento ab (colinear, fora das pontas)?
function onSegment(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return false;
  const cr = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
  if (Math.abs(cr) > 1e-9 * l2 + 1e-12) return false;
  const t = (dx * (p[0] - a[0]) + dy * (p[1] - a[1])) / l2;
  return t > 1e-9 && t < 1 - 1e-9;
}

// Triangula um polígono simples (com furos) usando TODOS os vértices, em sentido anti-horário.
// outer: [[u, v], ...], holes: [[[u, v], ...], ...], em qualquer sentido. Devolve [[i, j, k], ...]
// com índices na lista outer ++ holes. Sobre o Earcut do three:
//   - ele descarta vértices colineares; um vértice descartado viraria junção em T com a parede ao
//     lado, então ele volta partindo o triângulo cuja aresta passa por cima dele;
//   - lados colineares de anéis diferentes geram triângulos de área zero: são desfeitos girando a
//     aresta com o vizinho (flip);
//   - furos alinhados exatamente (grade quadrada) podem dar triangulação inválida: o resultado é
//     conferido (arestas de contorno uma vez, internas duas, área igual à do polígono) e, se
//     falhar, refeito com os pontos girados (o giro não muda a validade para os pontos originais).
export function triangulate(outer, holes = []) {
  const all = [...outer, ...holes.flat()];
  const rings = [];
  let off = 0;
  for (const r of [outer, ...holes]) {
    rings.push(r.map((_, i) => off + i));
    off += r.length;
  }
  const area = Math.abs(ringArea(outer)) - holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);
  let scale = 0;
  for (const [x, y] of all) scale = Math.max(scale, Math.abs(x), Math.abs(y));
  const minArea = 1e-12 * Math.max(1, scale * scale);
  for (const angle of [0, 0.2718281828, 1.1415926535, 2.3025850929, 0.5772156649]) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rot = ([x, y]) => new THREE.Vector2(x * c - y * s, x * s + y * c);
    let tris;
    try {
      const faces = THREE.ShapeUtils.triangulateShape(outer.map(rot), holes.map((h) => h.map(rot)));
      tris = faces.map(([a, b, cc]) => (cross2(all[a], all[b], all[cc]) < 0 ? [a, cc, b] : [a, b, cc]));
      restoreDropped(tris, all);
      fixSlivers(tris, all, minArea);
    } catch {
      continue;
    }
    if (validTriangulation(tris, all, rings, area, minArea)) return tris;
  }
  throw new Error('triangulate: não foi possível triangular o polígono');
}

function restoreDropped(tris, all) {
  const used = new Uint8Array(all.length);
  for (const t of tris) for (const i of t) used[i] = 1;
  for (let i = 0; i < all.length; i++) {
    if (used[i]) continue;
    let found = false;
    for (let t = 0; t < tris.length; t++) {
      const tr = tris[t];
      for (let e = 0; e < 3; e++) {
        const a = tr[e];
        const b = tr[(e + 1) % 3];
        if (!onSegment(all[a], all[b], all[i])) continue;
        const c = tr[(e + 2) % 3];
        tris[t] = [a, i, c];
        tris.push([i, b, c]);
        found = true;
        break;
      }
    }
    if (!found) throw new Error(`triangulate: vértice ${i} ficou fora da triangulação`);
  }
}

// triângulo de área zero (a, b, c) com c sobre ab: some, e o vizinho do outro lado de ab é
// partido em c. Repete até não sobrar nenhum.
function fixSlivers(tris, all, minArea) {
  for (let guard = 0; guard < 4 * tris.length + 10; guard++) {
    let k = -1;
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      if (Math.abs(cross2(all[a], all[b], all[c])) / 2 < minArea) {
        k = t;
        break;
      }
    }
    if (k < 0) return;
    const tr = tris[k];
    // aresta mais longa: o vértice oposto fica entre as pontas dela
    let e = 0;
    let best = -1;
    for (let q = 0; q < 3; q++) {
      const p = all[tr[q]];
      const r = all[tr[(q + 1) % 3]];
      const l = Math.hypot(r[0] - p[0], r[1] - p[1]);
      if (l > best) {
        best = l;
        e = q;
      }
    }
    const a = tr[e];
    const b = tr[(e + 1) % 3];
    const c = tr[(e + 2) % 3];
    const n = tris.findIndex((t, i) => i !== k && [0, 1, 2].some((q) => t[q] === b && t[(q + 1) % 3] === a));
    if (n < 0) throw new Error('triangulate: triângulo de área zero na borda');
    const tn = tris[n];
    const q = tn.indexOf(b);
    const d = tn[(q + 2) % 3];
    tris[n] = [b, c, d];
    tris[k] = [c, a, d];
  }
  throw new Error('triangulate: não convergiu ao desfazer triângulos de área zero');
}

function validTriangulation(tris, all, rings, area, minArea) {
  const N = all.length;
  const count = new Map();
  let sum = 0;
  for (const [a, b, c] of tris) {
    const ar = cross2(all[a], all[b], all[c]) / 2;
    if (ar < minArea) return false;
    sum += ar;
    for (const [u, w] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u * N + w;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  if (Math.abs(sum - area) > 1e-6 * Math.max(1, area)) return false;
  for (const v of count.values()) if (v !== 1) return false;
  let boundary = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i];
      const w = ring[(i + 1) % ring.length];
      const f = count.has(u * N + w);
      const r = count.has(w * N + u);
      if (f === r) return false; // aresta de contorno em um só sentido, uma vez
      boundary++;
    }
  }
  // cada aresta interna aparece nos dois sentidos
  for (const key of count.keys()) {
    const u = Math.floor(key / N);
    const w = key % N;
    if (!count.has(w * N + u)) boundary--;
  }
  return boundary === 0;
}

// ---------- extrusão em camadas ----------

// Extrusão de uma subdivisão plana conforme, em camadas. Acrescenta um corpo fechado ao builder.
//   pts: [[u, v], ...] vértices 2D compartilhados;
//   cells: [{ rings: [[i, ...], ...] }], 1º anel = contorno, demais = furos (qualquer sentido);
//     células vizinhas usam os mesmos índices na aresta comum (sem vértice em T);
//   planes: [w0, w1, ...] crescentes; layers[k]: células cheias entre planes[k] e planes[k + 1].
//     De uma camada para a seguinte, um conjunto deve conter o outro (senão surgem arestas com
//     4 triângulos);
//   map(u, v, w) -> [x, y, z].
export function layeredExtrude(b, { pts, cells, planes, layers, map }) {
  const from = b.triangleCount;
  const L = layers.length;
  const nP = planes.length;
  if (nP !== L + 1) throw new Error('layeredExtrude: planes.length deve ser layers.length + 1');
  const cache = new Map();
  const V = (i, j) => {
    const key = i * nP + j;
    let v = cache.get(key);
    if (v === undefined) {
      const [x, y, z] = map(pts[i][0], pts[i][1], planes[j]);
      v = b.vertex(x, y, z);
      cache.set(key, v);
    }
    return v;
  };
  // contorno anti-horário, furos horários: o interior fica sempre à esquerda de cada aresta
  const rings = cells.map((c) =>
    c.rings.map((ring, k) => {
      const a = ringArea(ring.map((i) => pts[i]));
      return (k === 0) === a > 0 ? ring : [...ring].reverse();
    }),
  );
  const caps = rings.map((rs) => {
    const flat = rs.flat();
    return triangulate(
      rs[0].map((i) => pts[i]),
      rs.slice(1).map((r) => r.map((i) => pts[i])),
    ).map((t) => t.map((k) => flat[k]));
  });
  const inLayer = layers.map((set) => {
    const arr = new Uint8Array(cells.length);
    for (const c of set) arr[c] = 1;
    return arr;
  });
  const N = pts.length;
  const edges = new Map();
  rings.forEach((rs, c) =>
    rs.forEach((ring) =>
      ring.forEach((a, k) => {
        const e = ring[(k + 1) % ring.length];
        const key = a < e ? a * N + e : e * N + a;
        let list = edges.get(key);
        if (!list) edges.set(key, (list = []));
        list.push({ c, a, b: e });
      }),
    ),
  );
  // paredes: aresta entre célula cheia e vazia (ou o lado de fora), numa camada
  for (const list of edges.values()) {
    if (list.length > 2) throw new Error('layeredExtrude: aresta em mais de 2 células');
    for (const e of list) {
      const other = list.length === 2 ? (list[0] === e ? list[1] : list[0]).c : -1;
      for (let k = 0; k < L; k++) {
        if (!inLayer[k][e.c] || (other >= 0 && inLayer[k][other])) continue;
        const a0 = V(e.a, k);
        const b0 = V(e.b, k);
        const b1 = V(e.b, k + 1);
        const a1 = V(e.a, k + 1);
        b.tri(a0, b0, b1);
        b.tri(a0, b1, a1);
      }
    }
  }
  // tampas: célula que muda de estado num plano
  for (let j = 0; j < nP; j++) {
    for (let c = 0; c < cells.length; c++) {
      const below = j > 0 && inLayer[j - 1][c] === 1;
      const above = j < L && inLayer[j][c] === 1;
      if (below === above) continue;
      for (const [p, q, r] of caps[c]) {
        if (below) b.tri(V(p, j), V(q, j), V(r, j));
        else b.tri(V(p, j), V(r, j), V(q, j));
      }
    }
  }
  b.orient(from);
}

// Prisma de um polígono com furos (anéis isolados), de w0 a w1
export function prism(b, outer, holes, w0, w1, map) {
  const pts = [];
  const rings = [outer, ...holes].map((ring) =>
    ring.map((p) => {
      pts.push(p);
      return pts.length - 1;
    }),
  );
  layeredExtrude(b, { pts, cells: [{ rings }], planes: [w0, w1], layers: [[0]], map });
}

// (u, v, w) -> (x, y, z) com o plano (u, v) deitado na mesa, lido de cima (v aponta para −Z,
// o fundo, como o texto de shapes.js) e w para cima (Y)
export const onTable = (u, v, w) => [u, w, -v];

// ---------- sólido de revolução com perfil por coluna ----------

const KEYS = {
  y: (r, y) => y,
  '-y': (r, y) => -y,
  r: (r) => r,
  '-r': (r) => -r,
};

// Sólido de revolução em torno de Y. n colunas em θ = 2π·i/n; ponto (r, y) -> (r·sen θ, y, r·cos θ).
// column(θ, i) -> { closed, segments: [{ key, pts: [[r, y], ...] }] }
//   - os segmentos se encadeiam (o último ponto de um é o primeiro do seguinte) e toda coluna tem
//     os mesmos segmentos: eles se correspondem de uma coluna para a vizinha;
//   - key ('y', '-y', 'r', '-r') cresce estritamente ao longo do segmento: é por ela que os pontos
//     de duas colunas vizinhas são costurados (cada coluna pode ter pontos em alturas diferentes);
//   - aberto: o perfil começa e termina no eixo (r = 0, polos); fechado: termina no 1º ponto.
export function revolve(b, n, column) {
  const from = b.triangleCount;
  const cols = [];
  let poleStart = -1;
  let poleEnd = -1;
  const near = (v, r, y) => Math.abs(v.r - r) <= TOL && Math.abs(v.y - y) <= TOL;
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    const { segments, closed = false } = column(th, i);
    const col = [];
    let first = null;
    let last = null;
    for (let s = 0; s < segments.length; s++) {
      const key = KEYS[segments[s].key];
      const pts = segments[s].pts;
      const list = [];
      for (let j = 0; j < pts.length; j++) {
        const [r, y] = pts[j];
        const lastPoint = s === segments.length - 1 && j === pts.length - 1;
        let v;
        if (last && near(last, r, y)) v = last;
        else if (closed && lastPoint && first && near(first, r, y)) v = first;
        else if (r <= TOL) {
          if (!last) {
            if (poleStart < 0) poleStart = b.vertex(0, y, 0);
            v = { i: poleStart, r: 0, y };
          } else if (lastPoint && !closed) {
            if (poleEnd < 0) poleEnd = b.vertex(0, y, 0);
            v = { i: poleEnd, r: 0, y };
          } else throw new Error('revolve: ponto no eixo no meio do perfil');
        } else v = { i: b.vertex(r * sn, y, r * cs), r, y };
        if (!first) first = v;
        const top = list[list.length - 1];
        if (!top || top.i !== v.i) {
          const k = key(v.r, v.y);
          if (top && k <= top.k) throw new Error(`revolve: chave '${segments[s].key}' não cresce no segmento ${s}`);
          list.push({ i: v.i, k });
        }
        last = v;
      }
      col.push(list);
    }
    if (closed && last !== first) throw new Error('revolve: perfil fechado não volta ao início');
    cols.push(col);
  }
  for (let i = 0; i < n; i++) {
    const A = cols[i];
    const B = cols[(i + 1) % n];
    if (A.length !== B.length) throw new Error('revolve: colunas com número diferente de segmentos');
    for (let s = 0; s < A.length; s++) zip(b, A[s], B[s]);
  }
  b.orient(from);
}

// costura dois segmentos correspondentes de colunas vizinhas, em ordem de chave
function zip(b, A, B) {
  let i = 0;
  let j = 0;
  while (i < A.length - 1 || j < B.length - 1) {
    const advA = j >= B.length - 1 || (i < A.length - 1 && A[i + 1].k <= B[j + 1].k);
    if (advA) {
      b.tri(A[i].i, A[i + 1].i, B[j].i);
      i++;
    } else {
      b.tri(A[i].i, B[j + 1].i, B[j].i);
      j++;
    }
  }
}

// Raio de um sextavado de largura entre faces s no ângulo θ: cantos em θ = 0°, 60°, … (um canto
// aponta para +Z) e faces planas perpendiculares a X. Use n múltiplo de 6 para acertar os cantos.
export function hexRadius(s, theta) {
  const seg = Math.PI / 3;
  let t = theta % seg;
  if (t < 0) t += seg;
  return s / 2 / Math.cos(t - seg / 2);
}

// arredonda n para um múltiplo de `mult`, no mínimo `mult`
export const roundTo = (n, mult) => Math.max(mult, Math.round(n / mult) * mult);

// ---------- funções lineares por partes: perfil de uma coluna, [[y, r], ...] com y crescente ----------

export const plLine = (y0, r0, y1, r1) => [
  [y0, r0],
  [y1, r1],
];

function plAt(f, y) {
  if (y <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) {
    if (y <= f[i][0]) {
      const [ya, ra] = f[i - 1];
      const [yb, rb] = f[i];
      return yb - ya <= 0 ? rb : ra + ((rb - ra) * (y - ya)) / (yb - ya);
    }
  }
  return f[f.length - 1][1];
}

// tira pontos repetidos e pontos colineares (mesma reta dos vizinhos)
export function plSimplify(f) {
  const out = [];
  for (const p of f) {
    const q = out[out.length - 1];
    if (q && p[0] - q[0] <= TOL) {
      if (Math.abs(p[1] - q[1]) > TOL) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  const res = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = res[res.length - 1];
    const b = out[i];
    const c = out[i + 1];
    const expected = a[1] + ((c[1] - a[1]) * (b[0] - a[0])) / (c[0] - a[0]);
    if (Math.abs(expected - b[1]) > 1e-9) res.push(b);
  }
  if (out.length > 1) res.push(out[out.length - 1]);
  return res;
}

function plCombine(f, g, pick) {
  const y0 = Math.max(f[0][0], g[0][0]);
  const y1 = Math.min(f[f.length - 1][0], g[g.length - 1][0]);
  const all = [...f.map((p) => p[0]), ...g.map((p) => p[0])].filter((y) => y >= y0 && y <= y1).sort((a, b) => a - b);
  const ys = all.filter((y, i) => i === 0 || y - all[i - 1] > 1e-12);
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const a = plAt(f, y);
    const c = plAt(g, y);
    out.push([y, pick(a, c)]);
    const yn = ys[i + 1];
    if (yn === undefined) continue;
    const an = plAt(f, yn);
    const cn = plAt(g, yn);
    const d0 = a - c;
    const d1 = an - cn;
    if ((d0 > 1e-12 && d1 < -1e-12) || (d0 < -1e-12 && d1 > 1e-12)) {
      const t = d0 / (d0 - d1);
      out.push([y + t * (yn - y), a + t * (an - a)]);
    }
  }
  return plSimplify(out);
}

export const plMin = (f, g) => plCombine(f, g, Math.min);
export const plMax = (f, g) => plCombine(f, g, Math.max);

// ---------- análise (usada pelos testes) ----------

// Relatório de uma malha: triângulos, degenerados, arestas abertas / com mais de 2 triângulos /
// com sentido invertido, volume (mm³) e caixa. Solda vértices pela posição (tolerância em mm).
export function meshReport(geo, { weld = 1e-6, minArea = 1e-8 } = {}) {
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : null;
  const nTri = (index ? index.length : pos.count) / 3;
  const remap = new Int32Array(pos.count);
  const seen = new Map();
  const q = 1 / weld;
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    let v = seen.get(key);
    if (v === undefined) seen.set(key, (v = i));
    remap[i] = v;
  }
  const vi = (t, k) => remap[index ? index[t * 3 + k] : t * 3 + k];
  const edges = new Map();
  const N = pos.count;
  let degenerate = 0;
  let volume = 0;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let t = 0; t < nTri; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    A.fromBufferAttribute(pos, a);
    B.fromBufferAttribute(pos, b);
    C.fromBufferAttribute(pos, c);
    volume += A.dot(B.clone().cross(C)) / 6;
    const area = B.clone().sub(A).cross(C.clone().sub(A)).length() / 2;
    if (a === b || b === c || a === c || area < minArea) degenerate++;
    for (const [u, w] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < w ? u * N + w : w * N + u;
      const e = edges.get(key) || { n: 0, dir: 0 };
      e.n++;
      e.dir += u < w ? 1 : -1;
      edges.set(key, e);
    }
  }
  let open = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const e of edges.values()) {
    if (e.n === 1) open++;
    else if (e.n > 2) nonManifold++;
    else if (e.dir !== 0) flipped++;
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = bb.getSize(new THREE.Vector3());
  return {
    triangles: nTri,
    degenerate,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    volume,
    size: [size.x, size.y, size.z],
    center: bb.getCenter(new THREE.Vector3()).toArray(),
  };
}
