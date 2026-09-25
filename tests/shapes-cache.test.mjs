import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installBrowserStubs } from './stubs-navegador.mjs';

register('./json-loader.mjs', import.meta.url);
installBrowserStubs();
const { shapeGeometry, defaultSize } = await import('../src/shapes.js');
const { groupKey } = await import('../src/csg.js');
const { prepareOutline, outlineSize } = await import('../src/outline.js');

// contorno com n pontos (polígono regular) num Proxy que conta as leituras dos pontos: serializar
// o contorno (JSON.stringify) lê todos; reaproveitar a assinatura não lê nenhum
function countedOutline(n, r = 20) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (-2 * Math.PI * i) / n;
    pts.push([Math.round(r * Math.cos(a) * 1000) / 1000, Math.round(r * Math.sin(a) * 1000) / 1000]);
  }
  let reads = 0;
  const proxy = new Proxy(pts, {
    get(target, key, recv) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, recv);
    },
  });
  return { points: proxy, plain: pts, reads: () => reads };
}

const desenho = (points) => ({ type: 'desenho', size: [40, 2, 40], params: { points } });

test('shapeGeometry: a chave do cache não percorre o contorno a cada chamada', () => {
  const c = countedOutline(3000);
  const o = desenho(c.points);
  const g = shapeGeometry(o);
  const after1 = c.reads();
  for (let i = 0; i < 60; i++) assert.equal(shapeGeometry(o), g, 'mesma geometria do cache');
  assert.equal(c.reads(), after1, `60 chamadas leram ${c.reads() - after1} pontos (esperado 0)`);
});

test('shapeGeometry: contorno novo troca a geometria; o mesmo contorno em outro array reaproveita', () => {
  const a = countedOutline(500);
  const g1 = shapeGeometry(desenho(a.points));
  const same = a.plain.map((p) => [...p]);
  assert.equal(shapeGeometry(desenho(same)), g1, 'mesmos pontos (undo/redo recria os arrays): mesma geometria');
  const moved = a.plain.map(([x, z], i) => (i === 7 ? [x + 0.5, z] : [x, z]));
  const g2 = shapeGeometry(desenho(moved));
  assert.notEqual(g2, g1, 'um ponto diferente: outra geometria');
  // mesmo tamanho, parâmetros de outras formas continuam na chave
  const s1 = shapeGeometry({ type: 'star', size: [20, 10, 19], params: { points: 5, ratio: 0.5 } });
  const s2 = shapeGeometry({ type: 'star', size: [20, 10, 19], params: { points: 6, ratio: 0.5 } });
  assert.notEqual(s1, s2);
});

test('groupKey: não serializa o contorno de um filho a cada chamada e muda quando ele muda', () => {
  const c = countedOutline(3000);
  const child = { ...desenho(c.points), pos: [0, 1, 0], quat: [0, 0, 0, 1], id: 'd1' };
  const box = { type: 'box', size: [10, 10, 10], params: { radius: 0, steps: 10 }, pos: [0, 5, 0], quat: [0, 0, 0, 1], hole: true, id: 'b1' };
  const k1 = groupKey([child, box]);
  const after1 = c.reads();
  for (let i = 0; i < 60; i++) assert.equal(groupKey([child, box]), k1);
  assert.equal(c.reads(), after1, `60 chamadas leram ${c.reads() - after1} pontos (esperado 0)`);
  const other = { ...child, params: { points: c.plain.map(([x, z], i) => (i === 0 ? [x - 1, z] : [x, z])) } };
  assert.notEqual(groupKey([other, box]), k1, 'contorno diferente: outra chave');
  assert.equal(groupKey([{ ...child, params: { points: c.plain.map((p) => [...p]) } }, box]), k1, 'mesmo contorno: mesma chave');
});

test('tamanho inicial do desenho = a caixa de prepareOutline (um cálculo, um arredondamento)', () => {
  const res = prepareOutline([[0, 0], [10.1234, 0], [10.1234, 7.0006], [0, 7.0006]]);
  assert.ok(res.ok);
  const [w, d] = outlineSize(res.points);
  assert.deepEqual(res.size, [w, d]);
  assert.deepEqual(defaultSize('desenho', { points: res.points }), [w, 2, d]);
});
