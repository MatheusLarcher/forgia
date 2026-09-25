// Folga por forma do Criar encaixe (src/encaixe.js), medida na geometria de verdade: cada vértice
// da peça original fica a pelo menos f (e perto de f) de todas as faces da cópia com folga.
// Formas convexas: distância do vértice aos planos das faces da cópia. Tubo e toroide: medidas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installBrowserStubs } from './stubs-navegador.mjs';

register('./json-loader.mjs', import.meta.url);
installBrowserStubs();
const THREE = await import('three');
const { shapeGeometry, defaultParams } = await import('../src/shapes.js');
const { growShape, clearanceCopy } = await import('../src/encaixe.js');

const F = 0.25;
const obj = (type, size, params = {}) => ({ id: 'p', type, name: type, color: '#e3302d', hole: false, params: defaultParams(type, params), size, pos: [0, size[1] / 2, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] });

// folga mínima e máxima dos vértices da original até as faces (convexas) da cópia
function clearance(orig, grown) {
  const g0 = shapeGeometry(orig);
  const g1 = shapeGeometry(grown);
  const shift = new THREE.Vector3(grown.pos[0] - orig.pos[0], grown.pos[1] - orig.pos[1], grown.pos[2] - orig.pos[2]);
  const p1 = g1.attributes.position;
  g1.computeBoundingBox();
  const c1 = g1.boundingBox.getCenter(new THREE.Vector3());
  const planes = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const idx = g1.index;
  const n = idx ? idx.count : p1.count;
  for (let i = 0; i < n; i += 3) {
    const at = (k) => (idx ? idx.getX(i + k) : i + k);
    a.fromBufferAttribute(p1, at(0));
    b.fromBufferAttribute(p1, at(1));
    c.fromBufferAttribute(p1, at(2));
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nn.length() < 1e-9) continue;
    nn.normalize();
    if (nn.dot(new THREE.Vector3().subVectors(a, c1)) < 0) nn.negate();
    planes.push([nn, a.clone().add(shift)]);
  }
  const p0 = g0.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < p0.count; i++) {
    v.fromBufferAttribute(p0, i);
    let d = Infinity;
    for (const [nn, p] of planes) d = Math.min(d, -nn.dot(new THREE.Vector3().subVectors(v, p)));
    min = Math.min(min, d);
  }
  return min;
}

const cases = [
  ['caixa', obj('box', [30, 12, 20])],
  ['caixa arredondada', obj('box', [30, 12, 20], { radius: 2 })],
  ['cilindro', obj('cylinder', [20, 25, 20])],
  ['cilindro de 8 lados', obj('cylinder', [20, 25, 20], { sides: 8 })],
  ['polígono de 6 lados', obj('polygon', [23.094, 10, 20], { sides: 6 })],
  ['cunha', obj('wedge', [20, 15, 30])],
  ['telhado', obj('roof', [30, 12, 20])],
  ['cone', obj('cone', [20, 30, 20])],
  ['cone truncado', obj('cone', [20, 30, 20], { top: 4 })],
  ['pirâmide', obj('pyramid', [20, 25, 20])],
];

for (const [nome, o] of cases) {
  test(`folga exata: ${nome}`, () => {
    const g = JSON.parse(JSON.stringify(o));
    const exata = growShape(g, F);
    assert.equal(exata, true, 'marcada como exata');
    const min = clearance(o, g);
    // canto arredondado em facetas: ≥ 98,5% da folga (3 µm a menos em 0,25 mm)
    const piso = o.params.radius > 0 ? F * 0.985 : F - 0.002;
    assert.ok(min >= piso, `folga mínima ${min.toFixed(4)} ≥ ${piso}`);
    assert.ok(min <= F + 0.02, `folga mínima ${min.toFixed(4)} perto de ${F} (não folgada demais)`);
  });
}

test('esfera: folga ≥ f nas faces (poliedro da esfera)', () => {
  const o = obj('sphere', [20, 20, 20]);
  const g = JSON.parse(JSON.stringify(o));
  growShape(g, F);
  const min = clearance(o, g);
  assert.ok(min >= F - 0.01 && min <= F + 0.05, `folga ${min}`);
});

test('tubo: parede cresce, furo de dentro encolhe f; toroide: furo do meio encolhe f', () => {
  const tubo = obj('tube', [20, 20, 20], { wall: 2 });
  const g = JSON.parse(JSON.stringify(tubo));
  assert.equal(growShape(g, F), true);
  const dentro = (o) => o.size[0] / 2 - o.params.wall;
  assert.ok(Math.abs(dentro(tubo) - dentro(g) - F) < 0.002, `raio de dentro ${dentro(tubo)} → ${dentro(g)}`);
  assert.ok(Math.abs(g.size[1] - 20 - 2 * F) < 1e-9);
  const tor = obj('torus', [20, 4, 20], { tube: 4 });
  const t2 = JSON.parse(JSON.stringify(tor));
  assert.equal(growShape(t2, F), true);
  const furo = (o) => o.size[0] / 2 - o.params.tube;
  assert.ok(Math.abs(furo(tor) - furo(t2) - F) < 1e-9);
  assert.ok(Math.abs(t2.params.tube - 4 - 2 * F) < 1e-9);
});

test('malha importada e formas sem conta exata: escala por eixo, marcada como aproximada', () => {
  for (const type of ['mesh', 'heart', 'star', 'halfSphere', 'text']) {
    const o = obj(type, [20, 10, 20]);
    const g = JSON.parse(JSON.stringify(o));
    assert.equal(growShape(g, F), false, type);
    assert.deepEqual(g.size, [20.5, 10.5, 20.5]);
  }
});

test('grupo: sólido cresce, furo encolhe, ids novos; folga 0 não muda nada', () => {
  const base = { ...obj('box', [40, 10, 30]), id: 'b' };
  const furo = { ...obj('cylinder', [8, 10, 8]), id: 'h', hole: true };
  const g = { id: 'g', type: 'group', name: 'placa', color: null, hole: false, params: {}, size: [40, 10, 30], pos: [0, 5, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1], children: [
    { ...base, pos: [0, 0, 0] },
    { ...furo, pos: [0, 0, 0] },
  ] };
  const { copia, exata } = clearanceCopy(g, F);
  assert.equal(exata, true);
  assert.notEqual(copia.id, 'g');
  assert.ok(copia.children.every((c) => c.id !== 'b' && c.id !== 'h'));
  const [b2, h2] = copia.children;
  assert.deepEqual(b2.size, [40.5, 10.5, 30.5]);
  assert.ok(h2.size[0] < 8 && Math.abs(h2.size[0] - 7.5) < 1e-6, `furo encolheu: ${h2.size[0]}`);
  assert.ok(Math.abs(copia.size[0] - 40.5) < 0.01 && Math.abs(copia.size[1] - 10.5) < 0.01, `grupo recentrado: ${copia.size}`);
  const zero = clearanceCopy(g, 0).copia;
  assert.deepEqual(zero.children.map((c) => c.size), [[40, 10, 30], [8, 10, 8]]);
});
