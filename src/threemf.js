import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

// Leitor de 3MF que também entende a extensão de produção (p:path), usada pelo
// Bambu Studio / OrcaSlicer, onde as malhas ficam em 3D/Objects/*.model.
// Devolve um Float32Array de triângulos soltos, em coordenadas do 3MF (Z para cima).

function transform(el) {
  const m = new THREE.Matrix4();
  const t = el.getAttribute('transform');
  if (!t) return m;
  const v = t.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some(isNaN)) return m;
  return m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
}

const tags = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const norm = (p) => (p.startsWith('/') ? p.slice(1) : p);

export function parse3MF(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const docs = {};
  const doc = (path) => {
    path = norm(path);
    if (!(path in docs)) {
      if (!files[path]) throw new Error('parte ausente no 3MF: ' + path);
      docs[path] = new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml');
      if (docs[path].getElementsByTagName('parsererror')[0]) throw new Error('XML inválido em ' + path);
    }
    return docs[path];
  };
  const objectsCache = {};
  const objects = (path) => {
    path = norm(path);
    if (!objectsCache[path]) {
      objectsCache[path] = {};
      for (const o of tags(doc(path), 'object')) objectsCache[path][o.getAttribute('id')] = o;
    }
    return objectsCache[path];
  };

  const out = [];
  const v = new THREE.Vector3();
  const emit = (path, id, matrix, depth) => {
    if (depth > 32) throw new Error('componentes aninhados demais');
    const obj = objects(path)[id];
    if (!obj) throw new Error(`objeto ${id} não encontrado em ${path}`);
    const mesh = tags(obj, 'mesh')[0];
    if (mesh) {
      const verts = tags(mesh, 'vertex').map((e) => [+e.getAttribute('x'), +e.getAttribute('y'), +e.getAttribute('z')]);
      for (const t of tags(mesh, 'triangle')) {
        for (const k of ['v1', 'v2', 'v3']) {
          const p = verts[+t.getAttribute(k)];
          if (!p) throw new Error('triângulo com vértice inválido');
          v.set(p[0], p[1], p[2]).applyMatrix4(matrix);
          out.push(v.x, v.y, v.z);
        }
      }
    }
    for (const c of tags(obj, 'component')) {
      const sub = c.getAttribute('p:path') || path;
      emit(sub, c.getAttribute('objectid'), matrix.clone().multiply(transform(c)), depth + 1);
    }
  };

  const rels = files['_rels/.rels'] ? strFromU8(files['_rels/.rels']) : '';
  const root = (rels.match(/Target="([^"]+\.model)"/i) || [])[1] || '3D/3dmodel.model';
  for (const item of tags(doc(root), 'item')) {
    if (item.getAttribute('printable') === '0') continue;
    emit(item.getAttribute('p:path') || root, item.getAttribute('objectid'), transform(item), 0);
  }
  return new Float32Array(out);
}
