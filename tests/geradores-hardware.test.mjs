// Hardware (src/geradores/hardware.js): malhas fechadas, medidas externas e triângulos no padrão.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { buildNut, buildBolt, buildBoltHole, buildInsertHole, nutSize, boltSize, boltHoleSize, insertHoleSize, INSERTS, boltHoleDims } from '../src/geradores/hardware.js';
import { METRIC, METRIC_SIZES } from '../src/geradores/rosca.js';
import { meshReport } from '../src/geradores/malha.js';

const SQRT3 = Math.sqrt(3);

function assertClosed(r, name) {
  assert.equal(r.openEdges, 0, `${name}: arestas abertas`);
  assert.equal(r.nonManifoldEdges, 0, `${name}: arestas com mais de 2 triângulos`);
  assert.equal(r.flippedEdges, 0, `${name}: triângulos com sentido invertido`);
  assert.equal(r.degenerate, 0, `${name}: triângulos degenerados`);
  assert.ok(r.volume > 0, `${name}: volume ${r.volume}`);
}

function assertSize(actual, expected, name, tol = 1e-3) {
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(actual[k] - expected[k]) <= tol, `${name}: eixo ${'XYZ'[k]} ${actual[k]} ≠ ${expected[k]}`);
}

function assertCentered(r, name) {
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(r.center[k]) < 1e-4, `${name}: caixa não centrada (${r.center})`);
}

test('porca: fechada e com as medidas ISO 4032 (s entre faces, m de altura) de M2 a M8', (t) => {
  for (const m of METRIC_SIZES) {
    for (const thread of [1, 0]) {
      const name = `porca M${m} ${thread ? 'real' : 'lisa'}`;
      const r = meshReport(buildNut({ m, thread }));
      assertClosed(r, name);
      const { s, m: h } = METRIC[m].nut;
      assertSize(r.size, [s, h, (2 * s) / SQRT3], name);
      assertSize(nutSize({ m, thread }), r.size, `${name} (nutSize)`);
      assertCentered(r, name);
    }
  }
  const def = meshReport(buildNut({}));
  t.diagnostic(`porca M3 padrão: ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 6000, `porca M3 padrão com ${def.triangles} triângulos`);
});

test('parafuso: fechado, cabeça ISO 4017/4762 e comprimento sob a cabeça', (t) => {
  for (const m of METRIC_SIZES) {
    for (const head of [0, 1]) {
      for (const thread of [1, 0]) {
        const name = `parafuso M${m} cabeça ${head} ${thread ? 'real' : 'liso'}`;
        const length = 2 * m + 4;
        const r = meshReport(buildBolt({ m, head, thread, length }));
        assertClosed(r, name);
        const spec = METRIC[m];
        const expected = head === 1 ? [spec.hexHead.s, spec.hexHead.k + length, (2 * spec.hexHead.s) / SQRT3] : [spec.socketHead.dk, spec.socketHead.k + length, spec.socketHead.dk];
        assertSize(r.size, expected, name);
        assertSize(boltSize({ m, head, thread, length }), r.size, `${name} (boltSize)`);
      }
    }
  }
  const def = meshReport(buildBolt({}));
  const big = meshReport(buildBolt({ m: 8, length: 40 }));
  t.diagnostic(`parafuso M3×10 padrão: ${def.triangles} triângulos; M8×40: ${big.triangles}`);
  assert.ok(def.triangles <= 15000, `parafuso M3×10 com ${def.triangles} triângulos`);
  assert.ok(big.triangles <= 25000, `parafuso M8×40 com ${big.triangles} triângulos`);
});

test('resolução: segmentos por volta mudam a contagem e continuam fechados', () => {
  const low = meshReport(buildBolt({ segments: 24 }));
  const high = meshReport(buildBolt({ segments: 96 }));
  assertClosed(low, 'parafuso 24 segmentos');
  assertClosed(high, 'parafuso 96 segmentos');
  assert.ok(low.triangles < high.triangles / 3);
});

test('furo para parafuso e porca: passante d + 2·folga, rebaixo e bolsão sextavado', (t) => {
  for (const m of METRIC_SIZES) {
    for (const head of [0, 1, 2]) {
      for (const nut of [1, 0]) {
        const name = `furo M${m} cabeça ${head} porca ${nut}`;
        const r = meshReport(buildBoltHole({ m, head, nut }));
        assertClosed(r, name);
        assertSize(boltHoleSize({ m, head, nut }), r.size, name);
      }
    }
  }
  // M3 padrão: passante 3,4 (ISO 273 médio), rebaixo 5,5 + 0,4, bolsão 5,5 + 0,4 entre faces
  const d = boltHoleDims({ m: 3 });
  assert.equal(+(2 * d.rThrough).toFixed(3), 3.4);
  assert.equal(+(2 * d.rHead).toFixed(3), 5.9);
  assert.equal(+d.nutAF.toFixed(3), 5.9);
  assert.equal(+d.hNut.toFixed(3), 2.6);
  assert.equal(+d.hHead.toFixed(3), 3.2);
  const r = meshReport(buildBoltHole({ m: 3, length: 12 }));
  assertSize(r.size, [5.9, 12, (2 * 5.9) / SQRT3], 'furo M3');
  // comprimento pequeno demais cresce para caber rebaixo + bolsão + 1 mm
  assert.equal(boltHoleSize({ m: 3, length: 2 })[1], 3.2 + 2.6 + 1);
  t.diagnostic(`furo M3 padrão: ${r.triangles} triângulos`);
  assert.ok(r.triangles <= 2000);
});

test('furo para inserto: medidas CNC Kitchen por padrão e editáveis', (t) => {
  for (const m of [2, 3, 4]) {
    const r = meshReport(buildInsertHole({ m, chamfer: 0 }));
    assertClosed(r, `inserto M${m}`);
    const ins = INSERTS[m];
    assertSize(r.size, [ins.hole, ins.length + 1, ins.hole], `inserto M${m}`);
  }
  const custom = meshReport(buildInsertHole({ m: 3, diameter: 4.2, depth: 7, chamfer: 0.4 }));
  assertClosed(custom, 'inserto M3 editado');
  assertSize(custom.size, [4.2 + 0.8, 7, 4.2 + 0.8], 'inserto M3 editado');
  assertSize(insertHoleSize({ m: 3, diameter: 4.2, depth: 7, chamfer: 0.4 }), custom.size, 'insertHoleSize');
  const def = meshReport(buildInsertHole({}));
  t.diagnostic(`inserto M3 padrão: ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 1000);
});

test('furo para parafuso e porca funciona como furo no three-bvh-csg (caixa − furo)', () => {
  const box = new THREE.BoxGeometry(20, 12, 20).toNonIndexed();
  box.computeVertexNormals();
  const holeGeo = buildBoltHole({ m: 3, length: 14 }); // passa 1 mm acima e abaixo da caixa
  const hole = holeGeo.toNonIndexed();
  hole.computeVertexNormals();
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  const out = ev.evaluate(new Brush(box), new Brush(hole), SUBTRACTION);
  const vHole = meshReport(holeGeo).volume;
  const d = boltHoleDims({ m: 3 });
  const outside = (Math.sqrt(3) / 2) * d.nutAF ** 2; // 1 mm do bolsão sextavado abaixo da caixa
  const outsideTop = Math.PI * d.rHead ** 2; // 1 mm do rebaixo acima da caixa (48 lados ≈ círculo)
  const expected = 20 * 12 * 20 - (vHole - outside - outsideTop);
  const got = meshReport(out.geometry, { minArea: 0 }).volume;
  assert.ok(Math.abs(got - expected) / expected < 0.005, `volume ${got} ≠ ${expected}`);
});

test('parâmetros fora do limite e M inválido caem no valor válido mais próximo', () => {
  assertSize(nutSize({ m: 3.4 }), nutSize({ m: 3 }), 'M3,4 -> M3');
  assertSize(nutSize({ m: 100 }), nutSize({ m: 8 }), 'M100 -> M8');
  assertSize(nutSize({ m: 'x' }), nutSize({ m: 3 }), 'm inválido -> padrão');
  assertClosed(meshReport(buildNut({ clearance: 5, segments: 7 })), 'porca com folga e segmentos limitados');
});
