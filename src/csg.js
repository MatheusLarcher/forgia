import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { shapeGeometry } from './shapes.js';
import { solidMaterial, holeMaterial } from './materials.js';

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = true;

const cache = new Map();

// Chave estável do conteúdo de um grupo (só o que afeta a geometria)
export function groupKey(children) {
  return JSON.stringify(children.map(keyOf));
}
function keyOf(o) {
  const base = { t: o.type, s: o.size, p: o.pos, q: o.quat, f: o.flip, h: !!o.hole, c: o.color || null, x: !!o.hidden };
  if (o.type === 'group') base.ch = o.children.map(keyOf);
  else base.pa = o.params;
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
