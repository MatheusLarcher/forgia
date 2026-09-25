// Hardware e Geradores como tipos em SHAPES (src/shapes.js) e no catálogo/criação da ponte da IA
// (src/ponte-comandos.js): nomes, parâmetros, opções por nome, furo por padrão e medidas naturais.
// E os Iniciantes do projeto (public/iniciantes/*.json): só formas do Forgia, válidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { installBrowserStubs } from './stubs-navegador.mjs';

register('./json-loader.mjs', import.meta.url);
installBrowserStubs();
const { SHAPES, shapeGeometry, defaultParams, defaultSize } = await import('../src/shapes.js');
const { catalog, TYPE_NAMES, resolveType, validateProject } = await import('../src/ponte-comandos.js');
const { t } = await import('../src/textos/index.js');

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GER = ['nut', 'bolt', 'boltHole', 'insertHole', 'gear', 'grid', 'spring', 'hinge', 'curvedText', 'lidBox'];

test('geradores viram tipos em SHAPES com nome, rótulos e geometria no tamanho natural', () => {
  for (const type of GER) {
    const def = SHAPES[type];
    assert.ok(def && def.generator, type);
    assert.equal(def.label, t.formas.nomes[type]);
    for (const p of def.params) assert.ok(p.label, `${type}.${p.key} sem rótulo`);
    for (const p of def.params.filter((q) => q.kind === 'choice')) for (const v of p.options) assert.ok(t.formas.opcoes[p.optionsKey][v], `${type}.${p.key}=${v} sem rótulo`);
    const params = defaultParams(type);
    const size = defaultSize(type, params);
    const g = shapeGeometry({ type, params, size });
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(g.boundingBox.min.clone());
    for (let k = 0; k < 3; k++) assert.ok(Math.abs([s.x, s.y, s.z][k] - size[k]) < 0.01, `${type}: geometria ${s.toArray()} × tamanho ${size}`);
    assert.ok(t.formas.dicas[type], `${type} sem dica`);
  }
  assert.equal(SHAPES.boltHole.hole, true);
  assert.equal(SHAPES.insertHole.hole, true);
  assert.equal(SHAPES.nut.hole, false);
});

test('porca M3 ISO 4032: 5,5 mm entre faces e 2,4 mm de altura; M8: 13 × 6,8', () => {
  const m3 = defaultSize('nut', defaultParams('nut', { m: 3 })).map((v) => Math.round(v * 100) / 100);
  assert.equal(m3[0], 5.5);
  assert.equal(m3[1], 2.4);
  const m8 = defaultSize('nut', defaultParams('nut', { m: 8 }));
  assert.equal(Math.round(m8[0] * 100) / 100, 13);
  assert.equal(Math.round(m8[1] * 100) / 100, 6.8);
});

test('catálogo da IA: nomes da ponte, opções por nome e furo por padrão', () => {
  assert.equal(TYPE_NAMES.nut, 'porca');
  assert.equal(resolveType('engrenagem'), 'gear');
  assert.equal(resolveType('caixa com tampa'), 'lidBox');
  const [porca] = catalog('porca');
  assert.deepEqual(porca.params.rosca.opcoes, ['lisa', 'real']);
  assert.equal(porca.params.rosca.padrao, 'real');
  assert.deepEqual(porca.params.m.valores, [2, 2.5, 3, 4, 5, 6, 8]);
  assert.equal(porca.categoria, 'hardware');
  const [furo] = catalog('furo_parafuso');
  assert.equal(furo.nasce_como_furo, true);
  const [eng] = catalog('engrenagem');
  assert.ok(eng.params.modulo && eng.params.dentes && eng.params.furo);
  assert.match(eng.medidas, /m × \(z \+ 2\)/);
});

test('Iniciantes do projeto: 5 arquivos de projeto válidos, só com formas do Forgia', () => {
  const dir = path.join(ROOT, 'public', 'iniciantes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['boneco-de-neve.json', 'caixa-com-tampa.json', 'chaveiro.json', 'foguete.json', 'suporte-celular.json']);
  const walk = (list, fn) => list.forEach((o) => (fn(o), o.children && walk(o.children, fn)));
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(json.formato, 'forgia.projeto', f);
    assert.equal(json.versao, 1, f);
    const objs = json.projeto.objects;
    assert.equal(objs.length, 1, `${f}: um grupo só no topo`);
    assert.equal(objs[0].type, 'group', f);
    validateProject(objs);
    let n = 0;
    walk(objs, (o) => {
      assert.ok(o.type === 'group' || (SHAPES[o.type] && o.type !== 'mesh'), `${f}: tipo ${o.type}`);
      n++;
    });
    assert.ok(n >= 4, `${f}: montado com várias formas (${n})`);
  }
});
