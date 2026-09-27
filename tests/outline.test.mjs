import test from 'node:test';
import assert from 'node:assert/strict';
import * as outline from '../src/outline.js';

const { prepareOutline, signedArea } = outline;

test('a caixa do contorno sai de um lugar só: prepareOutline().size = outlineSize(points)', () => {
  assert.equal(typeof outline.outlineSize, 'function', 'src/outline.js exporta outlineSize');
  // medidas com mais de 3 casas: a caixa tem que ser a dos pontos centrados e arredondados que vão
  // para params.points (±5,062 × ±3,5), não a do traço antes de centrar (10,123 × 7,001)
  const res = prepareOutline([[0, 0], [10.1234, 0], [10.1234, 7.0006], [0, 7.0006]]);
  assert.ok(res.ok);
  assert.deepEqual(res.size, outline.outlineSize(res.points));
  assert.deepEqual(res.size, [10.124, 7]);
});

test('outlineSize: largura (x) e profundidade (z) da caixa envolvente, arredondadas em 0,001 mm', () => {
  assert.deepEqual(outline.outlineSize([[-5, -2], [5, -2], [0, 3]]), [10, 5]);
  assert.deepEqual(outline.outlineSize([[0.00049, 0], [1.00001, 0], [0, 2.3336]]), [1, 2.334]);
});

test('prepareOutline continua centrando e deixando anti-horário (área negativa em x, z)', () => {
  const res = prepareOutline([[10, 10], [30, 10], [30, 20], [10, 20]]);
  assert.ok(res.ok);
  assert.deepEqual(res.center, [20, 15]);
  assert.ok(signedArea(res.points) < 0);
  assert.deepEqual(res.size, [20, 10]);
});

test('firstCrossing: o trecho novo que cruzaria o traço para encostado na linha (o vizinho não conta)', () => {
  const { firstCrossing } = outline;
  // traço em L: (0,0) → (10,0) → (10,10); o trecho novo sai de (10,10) para (5,-5) e cruza o 1º lado em (20/3; 0)
  const path = [[0, 0], [10, 0], [10, 10]];
  const x = firstCrossing(path, [5, -5]);
  assert.ok(Math.abs(x[0] - 20 / 3) < 1e-9 && Math.abs(x[1]) < 1e-9, JSON.stringify(x));
  // com recuo, para 1 mm antes da linha, sobre o trecho novo
  const r = firstCrossing(path, [5, -5], 1);
  assert.ok(r[1] > 0 && Math.abs(Math.hypot(r[0] - 20 / 3, r[1]) - 1) < 1e-9, JSON.stringify(r));
  // não cruza: null (inclusive encostando só no lado vizinho)
  assert.equal(firstCrossing(path, [2, 8]), null);
  assert.equal(firstCrossing([[0, 0], [10, 0]], [5, -5]), null);
  // o mais perto ganha quando cruzaria dois lados
  const zig = [[0, 0], [10, 0], [10, 2], [0, 2], [0, 10]];
  const z = firstCrossing(zig, [5, -5]);
  assert.ok(Math.abs(z[1] - 2) < 1e-9, JSON.stringify(z));
});

test('firstCrossing: passar exatamente por cima de um vértice do traço também é cruzar', () => {
  const { firstCrossing } = outline;
  // o 1º trecho tem um vértice em (0; 0); o trecho novo desce por x = 0 e passaria por ele
  const path = [[-10, 0], [0, 0], [10, 0], [10, -10], [0, -10]];
  const x = firstCrossing(path, [0, 10], 1);
  assert.ok(x && Math.abs(x[0]) < 1e-9 && Math.abs(x[1] + 1) < 1e-9, JSON.stringify(x));
});

test('firstCrossing: o ponto diz em que trecho encostou (.trecho)', () => {
  const x = outline.firstCrossing([[0, 0], [10, 0], [20, 0], [20, -10], [15, -10]], [15, 5]);
  assert.equal(x.trecho, 1); // o trecho (10; 0) → (20; 0)
});
