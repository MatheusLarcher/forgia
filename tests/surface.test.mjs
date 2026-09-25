import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import { installBrowserStubs } from './stubs-navegador.mjs';

installBrowserStubs();
const { Surface, ensureBVH } = await import('../src/surface.js');
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const fakeEditor = () => ({ scene: new THREE.Scene(), meshes: new Map() });
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// caixa de 20 mm sem índice (como as formas de src/shapes.js): triângulos 0-1 = +X, 4-5 = +Y
function boxMesh() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20).toNonIndexed());
  m.userData.id = 'caixa';
  m.updateMatrixWorld(true);
  return m;
}

// placa plana de n × n quadrados de 1 mm (2n² triângulos), centrada na origem, em y = 0
function plateMesh(n) {
  const pos = new Float32Array(n * n * 18);
  let k = 0;
  const h = n / 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = i - h;
      const z0 = j - h;
      for (const [x, z] of [[x0, z0], [x0, z0 + 1], [x0 + 1, z0], [x0 + 1, z0], [x0, z0 + 1], [x0 + 1, z0 + 1]]) {
        pos[k++] = x;
        pos[k++] = 0;
        pos[k++] = z;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g);
  m.userData.id = 'placa';
  m.updateMatrixWorld(true);
  return m;
}

test('trocar de face descarta (dispose) a geometria verde da face anterior; a mesma face reaproveita', () => {
  const s = new Surface(fakeEditor());
  const mesh = boxMesh();
  s.show({ mesh, tri: 0, point: V(10, 0, 0), id: 'caixa' }, 20);
  const g1 = s.fill.geometry;
  let disposed = 0;
  g1.addEventListener('dispose', () => disposed++);
  s.show({ mesh, tri: 1, point: V(10, 2, 2), id: 'caixa' }, 20);
  assert.equal(s.fill.geometry, g1, 'mesma face: mesma geometria');
  assert.equal(disposed, 0);
  s.show({ mesh, tri: 4, point: V(0, 10, 0), id: 'caixa' }, 20);
  assert.notEqual(s.fill.geometry, g1, 'outra face: outra geometria');
  assert.equal(disposed, 1, 'a geometria da face anterior recebeu dispose()');
  assert.equal(s.shown.tris, 2);
});

test('o cache de topologia não prende a geometria da peça (a peça some, a memória vai junto)', async () => {
  const s = new Surface(fakeEditor());
  let ref;
  (() => {
    const mesh = boxMesh();
    s.show({ mesh, tri: 4, point: V(0, 10, 0), id: 'caixa' }, 20);
    s.hide();
    ref = new WeakRef(mesh.geometry);
  })();
  for (let i = 0; i < 6 && ref.deref(); i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  assert.equal(ref.deref(), undefined, 'a geometria continua viva: alguma referência forte ficou no cache');
});

test('malha enorme (400 mil triângulos): show() não monta a topologia inteira e responde rápido', () => {
  const mesh = plateMesh(450); // 405.000 triângulos
  ensureBVH(mesh.geometry); // o raio (Surface.hit) já faz a BVH antes de show()
  const s = new Surface(fakeEditor());
  const tri = 2 * (225 * 450 + 225); // perto do centro
  const t0 = performance.now();
  s.show({ mesh, tri, point: V(0.3, 0, 0.6), id: 'placa' }, 20);
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `show() levou ${ms.toFixed(0)} ms (limite 250 ms)`);
  assert.ok(s.fill.visible, 'o verde aparece');
  assert.ok(s.shown.tris > 100 && s.shown.tris < 20000, `área em volta do ponto: ${s.shown.tris} triângulos`);
  // só triângulos perto do ponto (raio da área + folga)
  const p = s.fill.geometry.attributes.position;
  let far = 0;
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i) - 0.3, p.getZ(i) - 0.6) > 60) far++;
  assert.equal(far, 0, 'nenhum vértice longe do ponto');
});
