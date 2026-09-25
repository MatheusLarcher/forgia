import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { toUser, fromUser, boxToUser } from '../src/coords.js';

test('interno (x, y, z) vira usuário (x, −z, y): Z para cima, Y para o fundo', () => {
  assert.deepEqual(toUser([1, 2, 3]), [1, -3, 2]);
  // 10 mm acima da mesa (Y interno) = Z do usuário
  assert.deepEqual(toUser([0, 10, 0]), [0, 0, 10]);
  // para o fundo da mesa (−z interno) = +Y do usuário
  assert.deepEqual(toUser([0, 0, -5]), [0, 5, 0]);
  // para a direita continua X
  assert.deepEqual(toUser([7, 0, 0]), [7, 0, 0]);
});

test('usuário (X, Y, Z) volta para interno (X, Z, −Y)', () => {
  assert.deepEqual(fromUser([1, -3, 2]), [1, 2, 3]);
  assert.deepEqual(fromUser([0, 5, 0]), [0, 0, -5]);
});

test('ida e volta devolve o mesmo ponto', () => {
  for (const p of [[0, 0, 0], [12.5, -3.25, 88], [-127.5, 255, 0.001], [1e-9, -1e-9, 3]]) {
    assert.deepEqual(fromUser(toUser(p)), p);
    assert.deepEqual(toUser(fromUser(p)), p);
  }
});

test('aceita { x, y, z } (Vector3) e não devolve −0', () => {
  assert.deepEqual(toUser(new THREE.Vector3(4, 5, 6)), [4, -6, 5]);
  assert.deepEqual(toUser({ x: 1, y: 2, z: 3 }), [1, -3, 2]);
  const [, y] = toUser([0, 0, 0]);
  assert.ok(Object.is(y, 0), 'Y de z = 0 deve ser 0, não −0');
  const [, , zi] = fromUser([0, 0, 0]);
  assert.ok(Object.is(zi, 0), 'z interno de Y = 0 deve ser 0, não −0');
});

test('é linear: vale para diferenças (ΔX, ΔY, ΔZ da régua)', () => {
  const a = [3, 4, 5];
  const b = [10, 1, -2];
  const d = toUser([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const ua = toUser(a);
  const ub = toUser(b);
  assert.deepEqual(d, [ub[0] - ua[0], ub[1] - ua[1], ub[2] - ua[2]]);
});

test('caixa envolvente: mínimo e máximo do usuário ficam na ordem certa', () => {
  const { min, max } = boxToUser([-10, 0, -20], [10, 5, 30]);
  assert.deepEqual(min, [-10, -30, 0]);
  assert.deepEqual(max, [10, 20, 5]);
  for (let i = 0; i < 3; i++) assert.ok(min[i] <= max[i]);
});

test('bate com o giro do STL exportado (+90° em X, como exportScene)', () => {
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  for (const p of [[1, 2, 3], [-40, 12.5, 7], [0, 0, -9]]) {
    const v = new THREE.Vector3(...p).applyMatrix4(m).toArray();
    const u = toUser(p);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(v[i] - u[i]) < 1e-12, `${p} -> ${v} vs ${u}`);
  }
});
