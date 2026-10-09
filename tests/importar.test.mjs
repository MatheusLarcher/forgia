// Importação (src/importar.js) sem navegador: triângulos com coordenada NaN/Infinity são
// descartados em STL binário, STL ASCII e OBJ; se não sobra nenhum, é o erro 'vazio'.
// O 3MF usa o DOMParser do navegador (src/threemf.js) e passa pelo mesmo filtro no fim de parseModel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModel, ImportError } from '../src/importar.js';

// STL binário com os triângulos dados (9 números cada)
function stlBinario(tris) {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const v = new DataView(buf);
  v.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((x, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, x, true)));
  return buf;
}
function stlAscii(tris) {
  const faces = tris.map((t) => `facet normal 0 0 1\nouter loop\n${[0, 3, 6].map((k) => `vertex ${t[k]} ${t[k + 1]} ${t[k + 2]}`).join('\n')}\nendloop\nendfacet`);
  return new TextEncoder().encode(`solid t\n${faces.join('\n')}\nendsolid t\n`).buffer;
}
const bom = [0, 0, 0, 10, 0, 0, 0, 20, 0];
const bom2 = [0, 0, 5, 10, 0, 5, 0, 20, 5];

test('STL binário: triângulos com NaN/Infinity saem, os bons ficam', () => {
  const r = parseModel('a.stl', stlBinario([bom, [NaN, 0, 0, 1, 0, 0, 0, 1, 0], bom2, [0, 0, 0, Infinity, 0, 0, 0, 1, 0], [0, 0, 0, 1, 0, 0, 0, -Infinity, 0]]));
  assert.equal(r.positions.length, 2 * 9);
  assert.ok(r.positions.every(Number.isFinite));
  assert.deepEqual(r.size, [10, 5, 20]); // Z do STL vira Y
});

test('STL ASCII: vértice 1e999 (Infinity) sai', () => {
  const r = parseModel('a.stl', stlAscii([bom, [0, 0, 0, '1e999', 0, 0, 0, 1, 0], bom2]));
  assert.equal(r.positions.length, 2 * 9);
  assert.ok(r.positions.every(Number.isFinite));
});

test('OBJ: vértice nan/1e999 sai só com as faces que o usam', () => {
  const obj = 'v 0 0 0\nv 10 0 0\nv 0 20 0\nv nan 0 0\nv 1e999 0 0\nf 1 2 3\nf 1 2 4\nf 1 5 3\n';
  const r = parseModel('a.obj', new TextEncoder().encode(obj).buffer);
  assert.equal(r.positions.length, 9);
  assert.deepEqual(r.size, [10, 20, 1]);
});

test('só triângulos inválidos: erro vazio', () => {
  assert.throws(() => parseModel('a.stl', stlBinario([[NaN, 0, 0, 1, 0, 0, 0, 1, 0]])), (e) => e instanceof ImportError && e.kind === 'vazio');
  const obj = 'v nan 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
  assert.throws(() => parseModel('a.obj', new TextEncoder().encode(obj).buffer), (e) => e instanceof ImportError && e.kind === 'vazio');
});
