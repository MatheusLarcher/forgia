import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { t } from './textos/index.js';
import { outlineSize } from './outline.js';
import { GERADORES, defaultsOf } from './geradores/index.js';

const DEG = Math.PI / 180;
const { nomes, params: paramLabels, textoPadrao } = t.formas;
export const font = new FontLoader().parse(fontData);

// Paleta de cores do seletor "Sólido" (parecida com a do Tinkercad)
export const PALETTE = [
  '#e3302d', '#f38a00', '#f7c511', '#8cc63f', '#3fb34f', '#0f7a3d',
  '#17a3a6', '#4fb3e8', '#1b8bd2', '#233e91', '#8e44ad', '#d6297f',
  '#f5a5c0', '#8b5a2b', '#d9b98a', '#ffffff', '#c8ccd0', '#8b9197',
  '#4a4f55', '#1d1f22',
];

// ---------- utilidades de geometria ----------

function normalizeTo(geo, [w, h, d]) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(w / (s.x || 1), h / (s.y || 1), d / (s.z || 1));
  return geo;
}

// Remove atributos extras e recalcula normais com vinco (arestas vivas, curvas suaves).
// rapido: mesma conta do toCreasedNormals sem chaves de texto (malhas grandes: importadas e Cinzel)
function finalize(geo, crease = 30, rapido = false) {
  for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
  const g = (rapido ? creasedNormals : toCreasedNormals)(geo, crease * DEG);
  g.clearGroups();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// toCreasedNormals do three (BufferGeometryUtils) com o mesmo resultado: vértices juntados pela
// mesma grade de 0,01 (~~(v × 100)), normal de cada canto = média das normais das faces do mesmo
// ponto que fazem menos que o ângulo de vinco com a dele, na mesma ordem de soma. Troca as chaves
// de texto num objeto por uma tabela de inteiros: ~8× mais rápido em 100 mil triângulos.
export function creasedNormals(geometry, creaseAngle) {
  const creaseDot = Math.cos(creaseAngle);
  const hm = (1 + 1e-10) * 1e2;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pa = g.attributes.position;
  const nv = pa.count - (pa.count % 3);
  const nt = nv / 3;
  // normal de cada face: (c − b) × (a − b), normalizada
  const fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const i = t * 3;
    const ax = pa.getX(i), ay = pa.getY(i), az = pa.getZ(i);
    const bx = pa.getX(i + 1), by = pa.getY(i + 1), bz = pa.getZ(i + 1);
    const cx = pa.getX(i + 2), cy = pa.getY(i + 2), cz = pa.getZ(i + 2);
    const ux = cx - bx, uy = cy - by, uz = cz - bz;
    const vx = ax - bx, vy = ay - by, vz = az - bz;
    const x = uy * vz - uz * vy;
    const y = uz * vx - ux * vz;
    const z = ux * vy - uy * vx;
    const il = 1 / (Math.sqrt(x * x + y * y + z * z) || 1); // como Vector3.normalize
    fn[t * 3] = x * il;
    fn[t * 3 + 1] = y * il;
    fn[t * 3 + 2] = z * il;
  }
  // ponto (célula da grade) de cada canto: tabela aberta com as 3 coordenadas inteiras
  let cap = 16;
  while (cap < nv * 2) cap <<= 1;
  const mask = cap - 1;
  const kx = new Int32Array(cap);
  const ky = new Int32Array(cap);
  const kz = new Int32Array(cap);
  const slot = new Int32Array(cap).fill(-1);
  const ponto = new Int32Array(nv);
  let np = 0;
  for (let i = 0; i < nv; i++) {
    const x = ~~(pa.getX(i) * hm);
    const y = ~~(pa.getY(i) * hm);
    const z = ~~(pa.getZ(i) * hm);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    while (slot[h] >= 0 && !(kx[h] === x && ky[h] === y && kz[h] === z)) h = (h + 1) & mask;
    if (slot[h] < 0) {
      slot[h] = np++;
      kx[h] = x;
      ky[h] = y;
      kz[h] = z;
    }
    ponto[i] = slot[h];
  }
  // faces de cada ponto, na ordem dos cantos (a mesma em que o three empilha)
  const ini = new Int32Array(np + 1);
  for (let i = 0; i < nv; i++) ini[ponto[i] + 1]++;
  for (let p = 0; p < np; p++) ini[p + 1] += ini[p];
  const fill = ini.slice(0, np);
  const faces = new Int32Array(nv);
  for (let i = 0; i < nv; i++) faces[fill[ponto[i]]++] = (i / 3) | 0;
  const out = new Float32Array(pa.count * 3);
  for (let i = 0; i < nv; i++) {
    const t = ((i / 3) | 0) * 3;
    const fx = fn[t], fy = fn[t + 1], fz = fn[t + 2];
    let sx = 0, sy = 0, sz = 0;
    for (let k = ini[ponto[i]], e = ini[ponto[i] + 1]; k < e; k++) {
      const o = faces[k] * 3;
      if (fx * fn[o] + fy * fn[o + 1] + fz * fn[o + 2] > creaseDot) {
        sx += fn[o];
        sy += fn[o + 1];
        sz += fn[o + 2];
      }
    }
    const il = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    out[i * 3] = sx * il;
    out[i * 3 + 1] = sy * il;
    out[i * 3 + 2] = sz * il;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

// Sólido de revolução a partir de um perfil [raio, y] (unitário: raio 0.5, altura -0.5..0.5)
function lathe(pts, sides) {
  const n = Math.max(3, Math.round(sides));
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), n, Math.PI / n);
}

// Prisma: extruda um contorno 2D (plano XY) ao longo de Z
function extrude(points, depth = 1) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
}

function arc(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (a0 + (a1 - a0) * (i / n)) * DEG;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

function cylinderProfile(bx, by) {
  const pts = [[0, -0.5]];
  if (bx > 0.0005 && by > 0.0005) {
    pts.push(...arc(0.5 - bx, -0.5 + by, bx, by, -90, 0, 6));
    pts.push(...arc(0.5 - bx, 0.5 - by, bx, by, 0, 90, 6));
  } else {
    pts.push([0.5, -0.5], [0.5, 0.5]);
  }
  pts.push([0, 0.5]);
  return pts;
}

function textGeometry(text) {
  const s = (text ?? '').trim() ? text : textoPadrao;
  const g = new TextGeometry(s, { font, size: 10, depth: 2, curveSegments: 6, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // deitado sobre o plano de trabalho, legível de cima
  return g;
}

function starPoints(n, ratio) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.5 * ratio;
    const a = Math.PI / 2 + (i * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function heartPoints() {
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x, y]);
  }
  return pts;
}

// forma plana extrudada "para cima" (Y), com o topo do desenho voltado para trás
function flatExtrude(points) {
  const g = extrude(points, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// contorno da forma 'desenho' ([[x, z], ...] na mesa, veja src/outline.js) extrudado para cima (Y).
// A forma 2D usa (x, −z): depois do rotateX(−π/2), o y da forma vira −z, e o ponto volta para (x, z)
function outlineExtrude(points) {
  const g = extrude(points.map(([x, z]) => [x, -z]), 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

const validOutline = (points) => Array.isArray(points) && points.length >= 3 && points.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

function naturalSize(geo) {
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return [s.x, s.y, s.z];
}

// ---------- definições das formas ----------

// parâmetro editável no inspetor; o rótulo vem do arquivo de textos pela chave
const P = (key, value, min, max, step = 1, kind = 'number') => ({ key, label: paramLabels[key], value, min, max, step, kind });

export const SHAPES = {
  box: {
    label: nomes.box, color: '#e3302d', size: [20, 20, 20],
    params: [P('radius', 0, 0, 10, 0.1), P('steps', 10, 1, 20)],
    build([w, h, d], p) {
      const r = Math.min(p.radius, Math.min(w, h, d) / 2 - 0.01);
      if (r > 0.05) return finalize(new RoundedBoxGeometry(w, h, d, Math.max(1, Math.round(p.steps / 2)), r), 40);
      return finalize(new THREE.BoxGeometry(w, h, d));
    },
  },
  cylinder: {
    label: nomes.cylinder, color: '#f38a00', size: [20, 20, 20],
    params: [P('sides', 20, 3, 64), P('bevel', 0, 0, 10, 0.1)],
    build([w, h, d], p) {
      const b = Math.min(p.bevel, Math.min(w, d) / 2 - 0.01, h / 2 - 0.01);
      const g = lathe(cylinderProfile(Math.max(0, b) / w, Math.max(0, b) / h), p.sides);
      return finalize(normalizeTo(g, [w, h, d]), 30);
    },
  },
  sphere: {
    label: nomes.sphere, color: '#1b8bd2', size: [20, 20, 20],
    params: [P('steps', 24, 4, 64)],
    build(size, p) {
      const n = Math.max(2, Math.round(p.steps / 2));
      const g = lathe(arc(0, 0, 0.5, 0.5, -90, 90, n), p.steps);
      return finalize(normalizeTo(g, size), 40);
    },
  },
  roof: {
    label: nomes.roof, color: '#3fb34f', size: [20, 20, 20], params: [],
    build(size) {
      return finalize(normalizeTo(extrude([[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]), size));
    },
  },
  cone: {
    label: nomes.cone, color: '#8e44ad', size: [20, 20, 20],
    params: [P('top', 0, 0, 10, 0.1), P('sides', 20, 3, 64)],
    build([w, h, d], p) {
      const rt = Math.min(0.5, Math.max(0, p.top / w));
      const pts = [[0, -0.5], [0.5, -0.5]];
      if (rt > 0.001) pts.push([rt, 0.5], [0, 0.5]); else pts.push([0, 0.5]);
      const g = lathe(pts, p.sides);
      normalizeTo(g, [w, h, d]);
      return finalize(g, 30);
    },
  },
  roundRoof: {
    label: nomes.roundRoof, color: '#17a3a6', size: [20, 20, 20],
    params: [P('sides', 20, 3, 64)],
    build(size, p) {
      const pts = arc(0, -0.5, 0.5, 1, 0, 180, Math.max(2, Math.round(p.sides)));
      return finalize(normalizeTo(extrude(pts), size), 30);
    },
  },
  text: {
    label: nomes.text, color: '#e3302d', size: [60, 10, 20],
    params: [P('text', textoPadrao, 0, 0, 0, 'text')],
    build(size, p) {
      return finalize(normalizeTo(textGeometry(p.text), size), 30);
    },
    natural: (p) => naturalSize(textGeometry(p.text)),
    height: 10,
  },
  wedge: {
    label: nomes.wedge, color: '#233e91', size: [20, 20, 20], params: [],
    build(size) {
      const g = extrude([[0.5, -0.5], [-0.5, -0.5], [0.5, 0.5]]);
      g.rotateY(Math.PI / 2);
      return finalize(normalizeTo(g, size));
    },
  },
  pyramid: {
    label: nomes.pyramid, color: '#f7c511', size: [20, 20, 20], params: [],
    build(size) {
      return finalize(normalizeTo(lathe([[0, -0.5], [0.5, -0.5], [0, 0.5]], 4), size));
    },
  },
  halfSphere: {
    label: nomes.halfSphere, color: '#d6297f', size: [20, 10, 20],
    params: [P('steps', 24, 4, 64)],
    build(size, p) {
      const n = Math.max(2, Math.round(p.steps / 4));
      const g = lathe([[0, -0.5], ...arc(0, -0.5, 0.5, 1, 0, 90, n)], p.steps);
      return finalize(normalizeTo(g, size), 40);
    },
  },
  polygon: {
    label: nomes.polygon, color: '#233e91', size: [20, 20, 20],
    params: [P('sides', 6, 3, 20)],
    build(size, p) {
      return finalize(normalizeTo(lathe(cylinderProfile(0, 0), p.sides), size), 30);
    },
  },
  paraboloid: {
    label: nomes.paraboloid, color: '#9aa4ad', size: [20, 20, 20],
    params: [P('sides', 24, 3, 64)],
    build(size, p) {
      const pts = [[0, -0.5]];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const r = 0.5 * (1 - i / n);
        pts.push([r, 0.5 - (2 * r) ** 2]);
      }
      return finalize(normalizeTo(lathe(pts, p.sides), size), 40);
    },
  },
  torus: {
    label: nomes.torus, color: '#1b8bd2', size: [20, 4, 20],
    params: [P('tube', 4, 0.5, 10, 0.1), P('sides', 24, 3, 64), P('steps', 16, 3, 32)],
    build([w, h, d], p) {
      const rt = Math.min(0.25, Math.max(0.01, p.tube / 2 / w));
      const pts = arc(0.5 - rt, 0, rt, 0.5, -90, 270, Math.round(p.steps));
      return finalize(normalizeTo(lathe(pts, p.sides), [w, h, d]), 40);
    },
  },
  tube: {
    label: nomes.tube, color: '#f38a00', size: [20, 20, 20],
    params: [P('wall', 2, 0.1, 10, 0.1), P('sides', 24, 3, 64)],
    build([w, h, d], p) {
      const ri = Math.min(0.49, Math.max(0.005, 0.5 - p.wall / w));
      const pts = [[ri, -0.5], [0.5, -0.5], [0.5, 0.5], [ri, 0.5], [ri, -0.5]];
      return finalize(normalizeTo(lathe(pts, p.sides), [w, h, d]), 30);
    },
  },
  star: {
    label: nomes.star, color: '#f7c511', size: [20, 10, 19],
    params: [P('points', 5, 3, 20), P('ratio', 0.5, 0.1, 0.95, 0.01)],
    build(size, p) {
      return finalize(normalizeTo(flatExtrude(starPoints(Math.round(p.points), p.ratio)), size));
    },
    natural: (p) => naturalSize(flatExtrude(starPoints(Math.round(p.points), p.ratio))),
    height: 10,
  },
  heart: {
    label: nomes.heart, color: '#e3302d', size: [20, 8, 18], params: [],
    build(size) {
      return finalize(normalizeTo(flatExtrude(heartPoints()), size), 40);
    },
  },
  icosahedron: {
    label: nomes.icosahedron, color: '#3fb34f', size: [20, 20, 20],
    params: [P('detail', 0, 0, 3)],
    build(size, p) {
      return finalize(normalizeTo(new THREE.IcosahedronGeometry(0.5, Math.round(p.detail)), size), 20);
    },
  },
  // Contorno feito na ferramenta Desenhar (ou passado pela IA), extrudado na altura size[1].
  // params.points: [[x, z], ...] em mm, centrado e anti-horário visto de cima; formato completo
  // documentado em src/outline.js. Não aparece na biblioteca e não tem parâmetro no inspetor.
  desenho: {
    label: nomes.desenho, color: '#1b8bd2', size: [20, 2, 20], params: [],
    build(size, p) {
      if (!validOutline(p.points)) return finalize(new THREE.BoxGeometry(...size));
      return finalize(normalizeTo(outlineExtrude(p.points), size), 40);
    },
    // tamanho inicial = caixa envolvente dos pontos (outlineSize, em mm, sem reescalar) × 2 mm de altura
    sizeFor(p) {
      if (!validOutline(p.points)) return [20, 2, 20];
      const [w, d] = outlineSize(p.points);
      return [Math.max(w, 0.1), 2, Math.max(d, 0.1)];
    },
  },
};

// ---------- malhas importadas (STL/OBJ/3MF) ----------

// Posições (triângulos soltos, Float32Array, Y para cima) por referência (params.ref do objeto
// 'mesh'). Ficam só na memória: quem guarda em disco é o projeto (src/arquivo.js: cópia de
// segurança e .forgia no programa; forgia.meshes.v1 no localStorage só no npm run dev).
const meshStore = new Map();
let meshPersister = null;

export const getMesh = (ref) => meshStore.get(ref);
export const setMesh = (ref, positions) => meshStore.set(ref, positions);
export const meshRefs = () => [...meshStore.keys()];
// quem guarda as malhas novas: fn(ref, positions) -> true se guardou (false = não coube)
export function setMeshPersister(fn) {
  meshPersister = fn;
}
// esquece uma malha que ninguém usa mais (posições e geometrias prontas dela); src/cinzel.js
export function releaseMesh(ref) {
  meshStore.delete(ref);
  const tag = `"ref":${JSON.stringify(ref)}`;
  for (const [key, g] of [...geoCache]) {
    if (!key.startsWith('mesh|') || !key.includes(tag)) continue;
    geoCache.delete(key);
    g.dispose();
  }
}

// esquece as malhas que o projeto novo não usa
export function keepMeshes(refs) {
  const keep = new Set(refs);
  for (const ref of [...meshStore.keys()]) if (!keep.has(ref)) meshStore.delete(ref);
}

export function f32ToB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF32(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// Guarda as posições (triângulos soltos) e devolve a referência; saved false se o armazenamento
// recusou (só no npm run dev, com o localStorage cheio)
export function registerMesh(positions) {
  const ref = 'm' + Math.random().toString(36).slice(2, 10);
  meshStore.set(ref, positions);
  let saved = true;
  if (meshPersister) {
    try {
      saved = meshPersister(ref, positions) !== false;
    } catch {
      saved = false;
    }
  }
  return { ref, saved };
}

SHAPES.mesh = {
  label: nomes.mesh, color: '#8b9197', size: [20, 20, 20], params: [],
  build(size, p) {
    const data = meshStore.get(p.ref);
    if (!data) return finalize(new THREE.BoxGeometry(...size));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
    return finalize(normalizeTo(g, size), 30, true);
  },
};

// ---------- Hardware e Geradores de forma (src/geradores/) ----------

// Cada gerador vira um tipo como os outros (biblioteca, inspetor, CSG, ponte da IA). A geometria
// vem em mm no tamanho natural (sizeFor): no tamanho natural, normalizeTo não deforma nada.
// Parâmetros 'choice'/'toggle' (medida M, rosca real/lisa, padrão…) aparecem como lista no
// inspetor, com os rótulos de t.formas.opcoes.
for (const [type, g] of Object.entries(GERADORES)) {
  const params = g.params.map((d) => {
    const kind = d.kind === 'text' ? 'text' : d.kind === 'choice' || d.kind === 'toggle' ? 'choice' : 'number';
    return { ...P(d.key, d.value, d.min, d.max, d.step, kind), options: d.options, optionsKey: d.optionsKey, unit: d.unit };
  });
  SHAPES[type] = {
    label: nomes[type],
    color: g.color,
    hole: !!g.hole,
    category: g.category,
    generator: true,
    size: g.size(defaultsOf(g.params), font),
    params,
    build: (size, p) => finalize(normalizeTo(g.build(p, font), size), 30),
    sizeFor: (p) => g.size(p, font),
  };
}

// ---------- API ----------

export function defaultParams(type, overrides = {}) {
  const out = {};
  for (const p of SHAPES[type].params) out[p.key] = p.value;
  return { ...out, ...overrides };
}

// Tamanho inicial: formas com proporção natural (texto, estrela) mantêm a proporção
export function defaultSize(type, params) {
  const def = SHAPES[type];
  if (def.sizeFor) return def.sizeFor(params);
  if (!def.natural) return [...def.size];
  const [nx, , nz] = def.natural(params);
  if (type === 'text') return [round2(20 * (nx / nz)), def.height, 20];
  const k = 20 / Math.max(nx, nz);
  return [round2(nx * k), def.height, round2(nz * k)];
}

// Ao editar o texto, a largura acompanha o comprimento do texto
export function textWidthFor(params, depth) {
  const [nx, , nz] = SHAPES.text.natural(params);
  return round2(depth * (nx / nz));
}

const round2 = (v) => Math.round(v * 100) / 100;

// Assinatura dos params para as chaves de cache (geometria aqui, grupos em src/csg.js), pedida a
// cada sync. O contorno do desenho (params.points, milhares de pontos) não é serializado a cada
// vez: entra por um hash calculado uma vez por array (WeakMap). Por isso o array de pontos é
// imutável: ele é congelado na primeira assinatura, e mudar o contorno = trocar o array (como
// fazem o Desenhar, a ponte, o desfazer e o copiar, que sempre criam arrays novos).
const pointSigs = new WeakMap();
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function pointsSig(pts) {
  let sig = pointSigs.get(pts);
  if (sig === undefined) {
    // dois hashes de 32 bits (FNV-1a e um multiplicativo) sobre os bits de cada coordenada
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9 ^ pts.length;
    for (const p of pts) {
      for (let k = 0; k < 2; k++) {
        f64[0] = Array.isArray(p) ? p[k] : NaN;
        for (const w of u32) {
          h1 = Math.imul(h1 ^ w, 0x01000193);
          h2 = Math.imul(h2 ^ w, 0x5bd1e995);
          h2 ^= h2 >>> 15;
        }
      }
      if (Array.isArray(p)) Object.freeze(p);
    }
    Object.freeze(pts);
    sig = `${pts.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36).padStart(7, '0')}`;
    pointSigs.set(pts, sig);
  }
  return sig;
}
export function paramsKey(params) {
  if (!params || !Array.isArray(params.points)) return JSON.stringify(params);
  return JSON.stringify({ ...params, points: pointsSig(params.points) });
}

const geoCache = new Map();
export function shapeGeometry(o) {
  const key = o.type + '|' + o.size.map((v) => v.toFixed(3)).join(',') + '|' + paramsKey(o.params);
  let g = geoCache.get(key);
  if (!g) {
    g = SHAPES[o.type].build(o.size, o.params);
    geoCache.set(key, g);
    if (geoCache.size > 400) geoCache.delete(geoCache.keys().next().value);
  } else {
    geoCache.delete(key);
    geoCache.set(key, g);
  }
  return g;
}
