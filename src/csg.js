import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, HOLLOW_INTERSECTION } from 'three-bvh-csg';
import { shapeGeometry, paramsKey } from './shapes.js';
import { solidMaterial, holeMaterial } from './materials.js';

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = true;

const cache = new Map();

// Chave estável do conteúdo de um grupo (só o que afeta a geometria); os params entram pela
// assinatura de src/shapes.js (o contorno de um desenho não é serializado a cada chamada)
export function groupKey(children) {
  return JSON.stringify(children.map(keyOf));
}
function keyOf(o) {
  const base = { t: o.type, s: o.size, p: o.pos, q: o.quat, f: o.flip, h: !!o.hole, c: o.color || null, x: !!o.hidden };
  if (o.type === 'group') base.ch = o.children.map(keyOf);
  else base.pa = paramsKey(o.params);
  return base;
}

// Tamanho da geometria "crua" de um objeto (antes da escala do objeto)
export function geometrySize(o) {
  return o.type === 'group' ? groupResult(o).baseSize : o.size;
}

export function objectMatrix(o, target = new THREE.Matrix4()) {
  const base = geometrySize(o);
  const f = o.flip || [1, 1, 1];
  const s = new THREE.Vector3(
    (o.size[0] / base[0]) * f[0],
    (o.size[1] / base[1]) * f[1],
    (o.size[2] / base[2]) * f[2],
  );
  return target.compose(new THREE.Vector3().fromArray(o.pos), new THREE.Quaternion().fromArray(o.quat), s);
}

function flipWinding(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const n = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}

// Geometria de um filho já transformada para o espaço do grupo pai
function bakedChild(child) {
  let geo;
  let mats;
  if (child.type === 'group') {
    const r = groupResult(child);
    geo = r.geometry.clone();
    mats = r.materials;
  } else {
    geo = shapeGeometry(child).clone();
    mats = [solidMaterial(child.color)];
  }
  if (geo.index) geo = geo.toNonIndexed();
  if (child.hole) {
    geo.clearGroups();
    mats = holeMaterial;
  } else if (child.color && child.type === 'group') {
    geo.clearGroups();
    mats = solidMaterial(child.color);
  } else if (!geo.groups.length) {
    mats = mats[0];
  }
  const m = objectMatrix(child);
  geo.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(geo);
  return { geo, mats };
}

// Resultado CSG de um grupo: união dos sólidos menos a união dos furos
export function groupResult(group) {
  const key = groupKey(group.children);
  const hit = cache.get(key);
  if (hit) return hit;

  const solids = [];
  const holes = [];
  for (const child of group.children) {
    if (child.hidden) continue;
    const { geo, mats } = bakedChild(child);
    const brush = new Brush(geo, mats);
    brush.updateMatrixWorld();
    (child.hole ? holes : solids).push(brush);
  }

  let acc;
  let isHole = false;
  if (solids.length) {
    acc = solids[0];
    for (let i = 1; i < solids.length; i++) acc = evaluator.evaluate(acc, solids[i], ADDITION);
    for (const h of holes) acc = evaluator.evaluate(acc, h, SUBTRACTION);
  } else if (holes.length) {
    isHole = true;
    acc = holes[0];
    for (let i = 1; i < holes.length; i++) acc = evaluator.evaluate(acc, holes[i], ADDITION);
  }

  let geometry;
  let materials;
  if (!acc) {
    geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    materials = [solidMaterial('#c8ccd0')];
  } else {
    geometry = acc.geometry;
    if (geometry.index) geometry = geometry.toNonIndexed();
    materials = Array.isArray(acc.material) ? acc.material.slice() : [acc.material];
    if (!geometry.groups.length) geometry.addGroup(0, geometry.attributes.position.count, 0);
    if (!isHole) {
      // faces cortadas pelo furo herdam a cor do sólido
      const firstSolid = materials.find((m) => m !== holeMaterial) || solidMaterial('#e3302d');
      materials = materials.map((m) => (m === holeMaterial ? firstSolid : m));
    }
  }

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const result = {
    geometry,
    materials,
    isHole,
    center: center.toArray(),
    baseSize: [Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)],
  };
  cache.set(key, result);
  if (cache.size > 150) cache.delete(cache.keys().next().value);
  return result;
}

// Registra o mesmo resultado sob a chave dos filhos já recentralizados (evita recomputar)
export function aliasGroupResult(children, result) {
  cache.set(groupKey(children), { ...result, center: [0, 0, 0] });
}

// ---------------- recorte do Cinzel (src/cinzel.js) ----------------

// só posições: o resultado vira uma malha importada ('mesh'), que refaz as normais
const semCor = new THREE.MeshBasicMaterial();

// cópia só com as posições, já no mundo (matriz m aplicada)
function brushNoMundo(geo, m) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
  const b = new Brush(g, semCor);
  b.updateMatrixWorld();
  return b;
}

// recorte local: grupos separam o que veio da peça (matA) do que veio dos cortes (matB)
const evLocal = new Evaluator();
evLocal.attributes = ['position'];
evLocal.useGroups = true;
const matA = new THREE.MeshBasicMaterial();
const matB = new THREE.MeshBasicMaterial();

// triângulos soltos (Float32Array) de uma geometria indexada ou não, com a matriz m aplicada
function posicoesNoMundo(geo, m) {
  const src = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : src.count;
  const out = new Float32Array(n * 3);
  const e = m.elements;
  for (let i = 0; i < n; i++) {
    const j = idx ? idx.getX(i) : i;
    const x = src.getX(j);
    const y = src.getY(j);
    const z = src.getZ(j);
    out[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  if (m.determinant() < 0) for (let i = 0; i < out.length; i += 9) for (let k = 3; k < 6; k++) [out[i + k], out[i + k + 3]] = [out[i + k + 3], out[i + k]];
  return out;
}

// triângulos dos grupos de b (Brush resultado) cujo material é mat
function trisDoMaterial(b, mat) {
  const p = b.geometry.attributes.position.array;
  const out = [];
  for (const g of b.geometry.groups) if (b.material[g.materialIndex] === mat) out.push(p.subarray(g.start * 3, (g.start + g.count) * 3));
  return out;
}

const _ray = new THREE.Ray();
const _tri = new THREE.Triangle();
const _n = new THREE.Vector3();

// Planos das faces de uma forma convexa (o carimbo unitário: esfera, cubo ou cilindro), para o
// teste exato "ponto dentro dele": [nx, ny, nz, d, ...] com n·p > d = fora
const planosDaForma = new WeakMap();
function planosDe(geo) {
  let pl = planosDaForma.get(geo);
  if (pl) return pl;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const vistos = new Set();
  const out = [];
  for (let i = 0; i < n; i += 3) {
    const [a, b, c] = [i, i + 1, i + 2].map((j) => (idx ? idx.getX(j) : j));
    _tri.setFromAttributeAndIndices(pos, a, b, c);
    if (_tri.getArea() < 1e-12) continue; // degenerado (ponta do torno no eixo)
    _tri.getNormal(_n);
    const d = _n.dot(_tri.a);
    const k = [_n.x, _n.y, _n.z, d].map((v) => Math.round(v * 1e6)).join();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(_n.x, _n.y, _n.z, d);
  }
  pl = new Float64Array(out);
  planosDaForma.set(geo, pl);
  return pl;
}

// caixa (Box3) de triângulos soltos p medida pelas linhas r (rotação, elements) e folga
function caixaNoQuadro(p, r) {
  const box = new THREE.Box3();
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(_n.set(r[0] * p[i] + r[4] * p[i + 1] + r[8] * p[i + 2], r[1] * p[i] + r[5] * p[i + 1] + r[9] * p[i + 2], r[2] * p[i] + r[6] * p[i + 1] + r[10] * p[i + 2]));
  return box.expandByScalar(0.01 + box.getSize(_n).length() * 1e-4);
}

// separa os triângulos soltos p (n valores usados) em [os que a caixa (quadro r) toca, os outros]
function separar(p, n, box, r) {
  const perto = new Float32Array(n);
  const longe = new Float32Array(n);
  let np = 0;
  let nl = 0;
  const { min, max } = box;
  for (let o = 0; o < n; o += 9) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = o; v < o + 9; v += 3) {
      const x = r[0] * p[v] + r[4] * p[v + 1] + r[8] * p[v + 2];
      const y = r[1] * p[v] + r[5] * p[v + 1] + r[9] * p[v + 2];
      const z = r[2] * p[v] + r[6] * p[v + 1] + r[10] * p[v + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const fora = x1 < min.x || x0 > max.x || y1 < min.y || y0 > max.y || z1 < min.z || z0 > max.z;
    if (fora) longe.set(p.subarray(o, o + 9), (nl += 9) - 9);
    else perto.set(p.subarray(o, o + 9), (np += 9) - 9);
  }
  return [perto.subarray(0, np), longe.subarray(0, nl)];
}

// Peça (geometria geo com matriz m) menos os cortes [{ geo, m, dentro? }], tudo no mundo. Corte sem
// `dentro` = forma convexa fechada; com `dentro(x, y, z)` = paredes (podem ser abertas fora da peça)
// e o teste exato do volume delas (o prisma do passante, src/cinzel.js).
// Devolve as posições do resultado (triângulos soltos, Float32Array; vazio = não sobrou nada).
// bvh = árvore de geo (a mesma do raio do mouse, src/surface.js).
// - Um corte por vez, sem unir os cortes antes: a união de carimbos quase iguais (cilindros
//   paralelos sobrepostos do passante arrastado) saía aberta no three-bvh-csg e a peça vazava.
// - O custo depende do traço, não do tamanho da peça: em cada corte só os triângulos dentro da
//   caixa dele entram na booleana; os outros são copiados.
// - A parte da peça que fica vem da subtração (o corte é fechado). Os pedaços do corte que viram
//   parede são escolhidos aqui: dentro da peça inteira (bvh; um pedaço aberto dela erraria o
//   "dentro" quando o raio sai por onde ela foi recortada) e fora dos cortes anteriores (teste
//   exato). O que fica da peça também passa pelo teste exato: o raio do three-bvh-csg só separa.
export function recortar(geo, m, cortes, bvh, giro = null) {
  // caixas medidas no quadro `giro` (passante: eixo Y = direção do rasgo, a caixa fica justa em
  // volta dele em vez de cobrir a peça inteira na diagonal)
  const r = new THREE.Matrix4().makeRotationFromQuaternion(giro || new THREE.Quaternion()).invert().elements;
  const brushes = cortes.map((c) => brushNoMundo(c.geo, c.m));
  const caixas = brushes.map((b) => caixaNoQuadro(b.geometry.attributes.position.array, r));
  const tudo = new THREE.Box3();
  for (const c of caixas) tudo.union(c);
  const w = posicoesNoMundo(geo, m);
  const [perto, longe] = separar(w, w.length, tudo, r);
  if (!perto.length) return w; // o traço não toca a peça
  // "dentro do corte j" (mundo): o teste do próprio corte (c.dentro) ou, num convexo, ponto no quadro
  // da forma unitária atrás de todos os planos dela (em cima de uma face conta como fora)
  const testes = cortes.map((c) => {
    if (c.dentro) return c.dentro;
    const e = c.m.clone().invert().elements;
    const pl = planosDe(c.geo);
    return (x, y, z) => {
      const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
      const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
      for (let i = 0; i < pl.length; i += 4) if (pl[i] * lx + pl[i + 1] * ly + pl[i + 2] * lz > pl[i + 3] - 1e-9) return false;
      return true;
    };
  });
  const dentroDoCorte = (j, x, y, z) => testes[j](x, y, z);
  const mi = m.clone().invert();
  const sinal = m.determinant() < 0 ? -1 : 1;
  // pedaço local: cresce com as paredes dos cortes e perde o que cada corte tira
  let atual = perto;
  let n = perto.length;
  for (let k = 0; k < brushes.length; k++) {
    const [dentro, fora] = separar(atual, n, caixas[k], r);
    if (!dentro.length) continue;
    const ga = new THREE.BufferGeometry();
    ga.setAttribute('position', new THREE.BufferAttribute(dentro, 3));
    const a = new Brush(ga, matA);
    a.updateMatrixWorld();
    const cut = brushes[k];
    cut.material = matB;
    const [sub, add, int] = evLocal.evaluate(a, cut, [SUBTRACTION, ADDITION, HOLLOW_INTERSECTION], [new Brush(), new Brush(), new Brush()]);
    // o que estava aqui e ficou fora do corte k: todos os pedaços (fora e dentro, pelo raio do
    // three-bvh-csg) passam pelo teste exato do convexo
    const ficou = [];
    for (const arr of [...trisDoMaterial(sub, matA), ...trisDoMaterial(int, matA)]) {
      for (let o = 0; o < arr.length; o += 9) {
        const x = (arr[o] + arr[o + 3] + arr[o + 6]) / 3;
        const y = (arr[o + 1] + arr[o + 4] + arr[o + 7]) / 3;
        const z = (arr[o + 2] + arr[o + 5] + arr[o + 8]) / 3;
        if (!dentroDoCorte(k, x, y, z)) ficou.push(arr.subarray(o, o + 9));
      }
    }
    // triângulos do corte k: na subtração vêm invertidos (os de dentro do pedaço), na adição como
    // estão (os de fora); ficam, invertidos, os que estão dentro da peça e fora dos cortes anteriores
    const paredes = [];
    const pega = (arr, invertido) => {
      for (let o = 0; o < arr.length; o += 9) {
        _tri.a.fromArray(arr, o);
        if (invertido) _tri.b.fromArray(arr, o + 6), _tri.c.fromArray(arr, o + 3);
        else _tri.b.fromArray(arr, o + 3), _tri.c.fromArray(arr, o + 6);
        _tri.getMidpoint(_ray.origin);
        let antes = false;
        for (let j = 0; j < k && !antes; j++) antes = dentroDoCorte(j, _ray.origin.x, _ray.origin.y, _ray.origin.z);
        if (antes) continue;
        // como getHitSide do three-bvh-csg: raio do meio do triângulo na direção da normal dele;
        // bateu pelo lado de trás de uma face da peça = está dentro
        _ray.origin.applyMatrix4(mi);
        _tri.getNormal(_ray.direction).transformDirection(mi);
        const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
        if (!hit || _ray.direction.dot(hit.face.normal) * sinal <= 0) continue;
        paredes.push(_tri.a.x, _tri.a.y, _tri.a.z, _tri.c.x, _tri.c.y, _tri.c.z, _tri.b.x, _tri.b.y, _tri.b.z);
      }
    };
    for (const arr of trisDoMaterial(sub, matB)) pega(arr, true);
    for (const arr of trisDoMaterial(add, matB)) pega(arr, false);
    n = fora.length + ficou.reduce((s, x) => s + x.length, 0) + paredes.length;
    const prox = new Float32Array(n);
    prox.set(fora);
    let i = fora.length;
    for (const x of ficou) prox.set(x, (i += x.length) - x.length);
    prox.set(paredes, i);
    atual = prox;
  }
  const out = new Float32Array(longe.length + n);
  out.set(longe);
  out.set(atual.subarray(0, n), longe.length);
  return out;
}
