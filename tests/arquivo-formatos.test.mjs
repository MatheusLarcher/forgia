// ZIP escrito à mão (src/zip.js), 3MF com peças e cores (src/exportar3mf.js) e o .forgia
// (src/projeto.js), sem Electron. O 3MF de verdade também é reimportado no exe
// (tests/projeto-exe.test.mjs) pelo src/threemf.js, que precisa do DOMParser do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { zipFiles, unzipFiles, crc32 } from '../src/zip.js';
import { model3MF } from '../src/exportar3mf.js';
import { packProject, unpackProject, ProjectFileError, meshRefsOf } from '../src/projeto.js';

const dec = (u8) => new TextDecoder().decode(u8);

test('crc32 igual ao do zlib do Node', () => {
  for (const s of ['', 'a', 'Forgia 3D', 'x'.repeat(100000)]) {
    const b = new TextEncoder().encode(s);
    assert.equal(crc32(b), zlib.crc32(b));
  }
});

test('ZIP: sem compressão e deflate-raw, nomes UTF-8, lido pelo fflate e pelo formato (assinaturas)', async () => {
  const big = new Uint8Array(200000).map((_, i) => i % 7);
  const bytes = await zipFiles([
    { nome: 'projeto.json', dados: JSON.stringify({ ok: true, texto: 'ação' }) },
    { nome: 'malhas/m1.bin', dados: big },
    { nome: 'miniatura.png', dados: new Uint8Array([1, 2, 3]), comprimir: false },
    { nome: 'pasta/ção.txt', dados: 'olá' },
  ]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50, 'cabeçalho local');
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50, 'fim do diretório central');
  assert.equal(view.getUint16(bytes.length - 22 + 10, true), 4, '4 entradas');
  assert.ok(bytes.length < 60000, 'o binário repetitivo foi comprimido');
  const files = unzipFiles(bytes);
  assert.deepEqual(Object.keys(files).sort(), ['malhas/m1.bin', 'miniatura.png', 'pasta/ção.txt', 'projeto.json']);
  assert.deepEqual(JSON.parse(dec(files['projeto.json'])), { ok: true, texto: 'ação' });
  assert.deepEqual(files['malhas/m1.bin'], big);
  assert.equal(dec(files['pasta/ção.txt']), 'olá');
});

// cubo 10 mm em triângulos soltos (sistema do usuário, Z para cima), centrado em (cx, cy) e base em z0
function cubo(cx, cy, z0, s = 10) {
  const h = s / 2;
  const v = (x, y, z) => [cx + x * h, cy + y * h, z0 + (z + 1) * h];
  const faces = [
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]],
    [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]],
  ];
  const out = [];
  for (const [a, b, c, d] of faces) for (const tri of [[a, b, c], [a, c, d]]) for (const p of tri) out.push(...v(...p));
  return new Float32Array(out);
}

test('3MF: um objeto por peça, cores na ordem do projeto, vértices compartilhados e posição no item', () => {
  const partes = [
    { nome: 'Caixa vermelha', tris: cubo(-30, 0, 0), cor: 0 },
    { nome: 'Caixa <azul> & cia', tris: cubo(0, 0, 0), cor: 1 },
    { nome: 'Grupo', tris: cubo(30, 10, 5), cores: new Uint16Array(12).map((_, i) => (i < 6 ? 2 : 0)) },
  ];
  const { arquivos, resumo } = model3MF({ titulo: 'teste', partes, cores: ['#e3302d', '#1b8bd2', '#3fb34f'], mesa: { w: 256, l: 256 } });
  const model = arquivos.find((a) => a.nome === '3D/3dmodel.model').dados;
  assert.match(model, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(model, /unit="millimeter"/);
  assert.match(model, /xmlns="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/core\/2015\/02"/);
  const bases = [...model.matchAll(/<base name="[^"]*" displaycolor="(#[0-9A-F]{6})"\/>/g)].map((m) => m[1]);
  assert.deepEqual(bases, ['#E3302D', '#1B8BD2', '#3FB34F'], 'ordem estável das cores');
  const objs = [...model.matchAll(/<object id="(\d+)" type="model" name="([^"]*)" pid="1" pindex="(\d+)">/g)];
  assert.equal(objs.length, 3);
  assert.equal(objs[1][2], 'Caixa &lt;azul&gt; &amp; cia', 'nome escapado');
  assert.deepEqual(objs.map((o) => +o[3]), [0, 1, 2]);
  assert.equal(resumo[0].vertices, 8, 'cubo com 8 vértices compartilhados (malha fechada)');
  assert.equal(resumo[0].triangulos, 12);
  // grupo multicolorido: cor por triângulo
  assert.equal((model.match(/p1="2"/g) || []).length, 6);
  assert.equal((model.match(/p1="0"/g) || []).length, 6);
  // item: centro X/Y da peça + meia mesa, base em Z
  const items = [...model.matchAll(/<item objectid="(\d+)" transform="1 0 0 0 1 0 0 0 1 ([-\d.]+) ([-\d.]+) ([-\d.]+)"\/>/g)].map((m) => m.slice(2).map(Number));
  assert.deepEqual(items, [[98, 128, 0], [128, 128, 0], [158, 138, 5]]);
  // vértices do primeiro objeto ficam em volta da origem da peça (base em z = 0)
  const first = model.slice(model.indexOf('<object id="2"'), model.indexOf('</object>'));
  const zs = [...first.matchAll(/z="([-\d.]+)"/g)].map((m) => +m[1]);
  assert.equal(Math.min(...zs), 0);
  assert.equal(Math.max(...zs), 10);
  assert.ok(arquivos.find((a) => a.nome === '_rels/.rels').dados.includes('Target="/3D/3dmodel.model"'));
  assert.ok(arquivos.find((a) => a.nome === '[Content_Types].xml').dados.includes('application/vnd.ms-package.3dmanufacturing-3dmodel+xml'));
});

test('.forgia: ida e volta com malha, miniatura e versão do formato', async () => {
  const pos = cubo(0, 0, 0);
  const data = {
    name: 'Suporte',
    grid: 0.5,
    workplane: { w: 256, l: 256, h: 256 },
    objects: [
      { id: 'a1', type: 'box', name: 'base', color: '#1b8bd2', hole: false, params: { radius: 0, steps: 10 }, size: [60, 5, 40], pos: [0, 2.5, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] },
      { id: 'g1', type: 'group', name: 'grupo', color: null, hole: false, params: {}, size: [10, 10, 10], pos: [0, 5, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1], children: [
        { id: 'm1', type: 'mesh', name: 'bola', color: '#8b9197', hole: false, params: { ref: 'mabc123' }, size: [10, 10, 10], pos: [0, 0, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] },
      ] },
    ],
  };
  assert.deepEqual([...meshRefsOf(data.objects)], ['mabc123']);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const bytes = await packProject(data, (ref) => (ref === 'mabc123' ? pos : null), { png, app: 'Forgia 0.1.0' });
  const files = unzipFiles(bytes);
  const json = JSON.parse(dec(files['projeto.json']));
  assert.equal(json.formato, 'forgia.projeto');
  assert.equal(json.versao, 1);
  assert.deepEqual(json.malhas, { mabc123: { arquivo: 'malhas/mabc123.bin', triangulos: 12 } });
  const back = unpackProject(bytes);
  assert.deepEqual(back.data, data);
  assert.deepEqual([...back.meshes.get('mabc123')], [...pos]);
  assert.deepEqual(back.faltando, []);
  assert.deepEqual([...back.miniatura], [...png]);
});

test('.forgia: recusa o que não é projeto e versão mais nova, e avisa malha que falta', async () => {
  const kind = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof ProjectFileError);
      return e.kind;
    }
    return null;
  };
  assert.equal(kind(() => unpackProject(new Uint8Array([1, 2, 3, 4]))), 'zip');
  const other = await zipFiles([{ nome: 'x.txt', dados: 'x' }]);
  assert.equal(kind(() => unpackProject(other)), 'formato');
  const newer = await zipFiles([{ nome: 'projeto.json', dados: JSON.stringify({ formato: 'forgia.projeto', versao: 99, projeto: { objects: [] } }) }]);
  assert.equal(kind(() => unpackProject(newer)), 'versao');
  const missing = await zipFiles([{ nome: 'projeto.json', dados: JSON.stringify({ formato: 'forgia.projeto', versao: 1, projeto: { name: 'x', objects: [{ id: 'm', type: 'mesh', params: { ref: 'mzz' } }] }, malhas: { mzz: { arquivo: 'malhas/mzz.bin' } } }) }]);
  assert.deepEqual(unpackProject(missing).faltando, ['mzz']);
});
