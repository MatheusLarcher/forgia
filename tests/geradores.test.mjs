// Registro dos geradores (src/geradores/index.js): descritores completos e coerentes, textos
// sugeridos para cada chave, e cada gerador no padrão: malha fechada, caixa = size(), triângulos
// dentro do limite documentado abaixo, função pura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { GERADORES, TEXTOS_SUGERIDOS, defaultsOf, meshReport } from '../src/geradores/index.js';
import ptBR from '../src/textos/pt-BR.js';

const font = new FontLoader().parse(JSON.parse(readFileSync(new URL('../node_modules/three/examples/fonts/helvetiker_bold.typeface.json', import.meta.url), 'utf8')));

// Limite de triângulos no padrão de cada gerador (a contagem medida vai no diagnóstico).
// Referência: uma booleana do three-bvh-csg continua interativa até algumas dezenas de milhares.
const TRIANGLE_LIMIT = {
  nut: 6000, // M3, 48 segmentos
  bolt: 15000, // M3 × 10, 48 segmentos
  boltHole: 2000,
  insertHole: 1000,
  gear: 4000, // m 1,5, z 20, 8 pontos por flanco
  grid: 5000, // 60 × 60, colmeia de 8 mm
  spring: 6000, // 5 espiras, 32 segmentos por espira, 12 lados
  hinge: 6000, // 5 juntas, 48 segmentos
  curvedText: 6000, // "TEXTO"
  lidBox: 3000,
};

const UNITS = new Set(['mm', '°', '']);
const KINDS = new Set(['number', 'choice', 'toggle', 'text']);

test('descritores: limites, padrão, tipo e unidade coerentes; chaves de texto existem', () => {
  const S = TEXTOS_SUGERIDOS;
  const bridges = new Set();
  for (const [type, g] of Object.entries(GERADORES)) {
    assert.ok(S.nomes[type], `${type}: sem nome sugerido`);
    assert.ok(S.medidas[type], `${type}: sem nota de medidas`);
    assert.ok(S.dicas[type], `${type}: sem dica`);
    assert.ok(['hardware', 'geradores'].includes(g.category));
    assert.match(g.bridge, /^[a-z_]+$/);
    assert.ok(!bridges.has(g.bridge), `nome na ponte repetido: ${g.bridge}`);
    bridges.add(g.bridge);
    assert.match(g.color, /^#[0-9a-f]{6}$/);
    const keys = new Set();
    const pb = new Set();
    for (const d of g.params) {
      const name = `${type}.${d.key}`;
      assert.ok(!keys.has(d.key), `${name} repetido`);
      keys.add(d.key);
      assert.ok(!pb.has(d.bridge), `${name}: nome na ponte repetido`);
      pb.add(d.bridge);
      assert.match(d.bridge, /^[a-z_]+$/);
      assert.ok(KINDS.has(d.kind), `${name}: kind ${d.kind}`);
      assert.ok(UNITS.has(d.unit), `${name}: unidade ${d.unit}`);
      assert.equal(d.labelKey, d.key);
      assert.equal(d.meaningKey, name);
      assert.ok(S.params[d.labelKey], `${name}: sem rótulo sugerido`);
      assert.ok(S.significados[type]?.[d.key], `${name}: sem significado sugerido`);
      if (d.kind === 'text') continue;
      assert.ok(d.min <= d.value && d.value <= d.max, `${name}: padrão ${d.value} fora de [${d.min}, ${d.max}]`);
      assert.ok(d.step > 0, `${name}: passo ${d.step}`);
      if (d.options) {
        assert.ok(d.options.includes(d.value), `${name}: padrão fora das opções`);
        for (const o of d.options) assert.ok(S.opcoes[d.optionsKey]?.[o], `${name}: opção ${o} sem rótulo`);
        if (d.bridgeOptions) for (const v of Object.values(d.bridgeOptions)) assert.ok(d.options.includes(v), `${name}: bridgeOptions fora das opções`);
      }
    }
  }
});

test('tipos e rótulos não conflitam com as formas e os parâmetros que já existem', () => {
  const existing = ptBR.formas;
  const bridgeNames = new Set(['caixa', 'cilindro', 'esfera', 'telhado', 'cone', 'telhado_redondo', 'texto', 'cunha', 'piramide', 'meia_esfera', 'poligono', 'paraboloide', 'toroide', 'tubo', 'estrela', 'coracao', 'icosaedro', 'desenho', 'importado', 'grupo']);
  for (const [type, g] of Object.entries(GERADORES)) {
    // depois da integração (D2) o tipo está em t.formas.nomes, com o nome sugerido
    if (type in existing.nomes) assert.equal(existing.nomes[type], TEXTOS_SUGERIDOS.nomes[type], `nome de ${type} diverge do sugerido`);
    assert.ok(!bridgeNames.has(g.bridge), `nome na ponte ${g.bridge} já usado`);
  }
  // parâmetro com a mesma chave de um que já existe: mesmo rótulo (t.formas.params é global por chave)
  for (const [key, label] of Object.entries(TEXTOS_SUGERIDOS.params)) {
    if (key in existing.params) assert.equal(label, existing.params[key], `rótulo de '${key}' diverge de t.formas.params`);
  }
});

test('cada gerador no padrão: fechado, caixa = size(), centrado, dentro do limite de triângulos, puro', (t) => {
  for (const [type, g] of Object.entries(GERADORES)) {
    const params = defaultsOf(g.params);
    const frozen = Object.freeze({ ...params });
    const t0 = performance.now();
    const geo = g.build(frozen, font);
    const ms = performance.now() - t0;
    const r = meshReport(geo);
    assert.equal(r.openEdges, 0, `${type}: arestas abertas`);
    assert.equal(r.nonManifoldEdges, 0, `${type}: arestas com mais de 2 triângulos`);
    assert.equal(r.flippedEdges, 0, `${type}: sentido invertido`);
    assert.equal(r.degenerate, 0, `${type}: degenerados`);
    assert.ok(r.volume > 0, `${type}: volume`);
    const s = g.size(frozen, font);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(r.size[k] - s[k]) < 2e-3, `${type}: caixa ${r.size} ≠ size() ${s}`);
      assert.ok(Math.abs(r.center[k]) < 1e-4, `${type}: não centrado`);
    }
    assert.ok(r.triangles <= TRIANGLE_LIMIT[type], `${type}: ${r.triangles} triângulos > ${TRIANGLE_LIMIT[type]}`);
    assert.equal(geo.index !== null, true, `${type}: geometria indexada`);
    assert.deepEqual(Object.keys(geo.attributes), ['position'], `${type}: só position`);
    // pura: mesma entrada, mesma malha
    const again = g.build(frozen, font);
    assert.deepEqual(Array.from(again.attributes.position.array), Array.from(geo.attributes.position.array), `${type}: não determinístico`);
    t.diagnostic(`${type}: ${r.triangles} triângulos, ${r.size.map((v) => v.toFixed(2)).join(' × ')} mm, volume ${r.volume.toFixed(1)} mm³, ${ms.toFixed(1)} ms`);
  }
});

test('parâmetros ausentes ou inválidos caem no padrão sem quebrar', () => {
  for (const [type, g] of Object.entries(GERADORES)) {
    const bad = {};
    for (const d of g.params) bad[d.key] = d.kind === 'text' ? '' : 'x';
    const r = meshReport(g.build(bad, font));
    assert.equal(r.openEdges + r.nonManifoldEdges + r.degenerate, 0, `${type} com parâmetros inválidos`);
    const r2 = meshReport(g.build(undefined, font));
    assert.equal(r2.openEdges + r2.nonManifoldEdges + r2.degenerate, 0, `${type} sem parâmetros`);
  }
});
