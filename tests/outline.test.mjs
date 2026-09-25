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
