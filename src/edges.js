import * as THREE from 'three';

// Arestas "de verdade" para o contorno de seleção.
// O EdgesGeometry do three trata junções em T (comuns após CSG) como bordas e desenha a
// triangulação interna das faces. Aqui, arestas sem par são casadas por sobreposição colinear
// e só viram contorno quando as faces dos dois lados formam um ângulo maior que o limite.

const cache = new WeakMap();

export function outlineGeometry(geometry, thresholdDeg = 28) {
  let g = cache.get(geometry);
  if (!g) {
    g = build(geometry, thresholdDeg);
    cache.set(geometry, g);
  }
  return g;
}

function build(geometry, thresholdDeg) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const cosT = Math.cos(THREE.MathUtils.degToRad(thresholdDeg));
  geometry.computeBoundingSphere();
  const scale = Math.max(geometry.boundingSphere.radius, 1e-3);
  const q = 1e4 / scale; // quantização relativa ao tamanho
  const eps = scale * 1e-5;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const key = (v) => `${Math.round(v.x * q)},${Math.round(v.y * q)},${Math.round(v.z * q)}`;
  const vi = (i) => (index ? index.getX(i) : i);

  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, vi(t * 3));
    b.fromBufferAttribute(pos, vi(t * 3 + 1));
    c.fromBufferAttribute(pos, vi(t * 3 + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    if (n.lengthSq() < 1e-14 * scale * scale) continue; // triângulo degenerado
    n.normalize();
    const vs = [a.clone(), b.clone(), c.clone()];
    const ks = vs.map(key);
    for (let e = 0; e < 3; e++) {
      const i0 = e;
      const i1 = (e + 1) % 3;
      if (ks[i0] === ks[i1]) continue;
      const k = ks[i0] < ks[i1] ? ks[i0] + '|' + ks[i1] : ks[i1] + '|' + ks[i0];
      let rec = edges.get(k);
      if (!rec) {
        rec = { p0: vs[i0], p1: vs[i1], normals: [] };
        edges.set(k, rec);
      }
      rec.normals.push(n.clone());
    }
  }

  const out = [];
  const lone = [];
  for (const rec of edges.values()) {
    if (rec.normals.length === 2) {
      if (rec.normals[0].dot(rec.normals[1]) < cosT) out.push(rec.p0, rec.p1);
    } else if (rec.normals.length === 1) {
      lone.push(rec);
    } else {
      // aresta não-manifold: desenha se houver quebra de ângulo
      const [n0, ...rest] = rec.normals;
      if (rest.some((m) => n0.dot(m) < cosT)) out.push(rec.p0, rec.p1);
    }
  }

  // casa arestas sem par que se sobrepõem na mesma reta (junções em T)
  if (lone.length && lone.length < 6000) {
    const dir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const info = lone.map((r) => {
      const d = r.p1.clone().sub(r.p0);
      const len = d.length();
      return { r, d: d.divideScalar(len), len };
    });
    for (let i = 0; i < info.length; i++) {
      const A = info[i];
      for (let j = i + 1; j < info.length; j++) {
        const B = info[j];
        if (Math.abs(A.d.dot(B.d)) < 0.99999) continue;
        // B precisa estar sobre a reta de A
        tmp.subVectors(B.r.p0, A.r.p0);
        dir.copy(A.d);
        const along = tmp.dot(dir);
        if (tmp.lengthSq() - along * along > eps * eps) continue;
        const t0 = along;
        const t1 = B.r.p1.clone().sub(A.r.p0).dot(dir);
        const lo = Math.max(0, Math.min(t0, t1));
        const hi = Math.min(A.len, Math.max(t0, t1));
        if (hi - lo <= eps) continue;
        if (A.r.normals[0].dot(B.r.normals[0]) < cosT) {
          out.push(A.r.p0.clone().addScaledVector(dir, lo), A.r.p0.clone().addScaledVector(dir, hi));
        }
      }
    }
  }

  const g = new THREE.BufferGeometry().setFromPoints(out);
  return g;
}
