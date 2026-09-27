// Modo gravação das dicas animadas (Fase E): roteiros (ajuda/roteiros), cenas (ajuda/cenas), o
// WebM com a duração inserida (scripts/gravar/webm.cjs) e os 22 vídeos em public/ajuda.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { installBrowserStubs } from './stubs-navegador.mjs';

register('./json-loader.mjs', import.meta.url);
installBrowserStubs();
const { SHAPES } = await import('../src/shapes.js');
const { validateProject } = await import('../src/ponte-comandos.js');
const { t } = await import('../src/textos/index.js');
const webm = createRequire(import.meta.url)('../scripts/gravar/webm.cjs');

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DICAS = ['cruise', 'align', 'mirror', 'group', 'duplicate', 'draw', 'mark', 'encaixe', 'workplane', 'soltar', 'measure'];
// dicas com o vídeo de um fluxo inteiro (o pedido à IA indo e voltando): roteiro em
// docs/media/roteiros, mais longas que as das funções
const DICAS_FLUXO = ['pedir'];
const ACOES = ['tecla', 'mover', 'clicar', 'apertar', 'arrastar', 'caminho', 'soltar', 'digitar', 'esperar', 'selo', 'seta', 'legenda'];
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const roteiros = fs.readdirSync(path.join(ROOT, 'ajuda', 'roteiros')).filter((f) => f.endsWith('.json')).map((f) => readJson('ajuda', 'roteiros', f));

test('um roteiro para cada uma das 11 funções com vídeo', () => {
  assert.deepEqual(roteiros.map((r) => r.dica).sort(), [...DICAS].sort());
});

test('t.dicas: vídeo nas 11 funções (nome do roteiro) e em nenhuma outra', () => {
  const comVideo = Object.entries(t.dicas).filter(([, d]) => d.video).map(([k, d]) => [k, d.video]);
  assert.deepEqual(comVideo.map(([k]) => k).sort(), [...DICAS, ...DICAS_FLUXO].sort());
  for (const [k, v] of comVideo) assert.equal(v, k);
  for (const k of ['copy', 'paste', 'delete', 'undo', 'redo', 'in', 'out']) assert.ok(t.dicas[k] && !t.dicas[k].video, k);
});

test('cada roteiro usa uma cena que existe, com câmera, seleção e passos conhecidos', () => {
  for (const r of roteiros) {
    const cena = readJson('ajuda', 'cenas', r.cena + '.json');
    const nomes = new Set(cena.projeto.objects.map((o) => o.name));
    for (const n of r.selecionar || []) assert.ok(nomes.has(n), `${r.dica}: "${n}" não está na cena ${r.cena}`);
    assert.equal(r.camera.alvo.length, 3, r.dica);
    assert.equal(r.camera.de.length, 3, r.dica);
    assert.ok(r.passos.length > 0, r.dica);
    for (const p of r.passos) assert.ok(ACOES.some((k) => k in p), `${r.dica}: passo sem ação ${JSON.stringify(p)}`);
    // alvos: peças da cena ou o encaixe que o próprio roteiro cria a partir de uma delas
    const alvos = new Set([...nomes, ...[...nomes].map((n) => t.encaixe.grupo(n))]);
    for (const p of r.passos) {
      const specs = [p.mover, p.clicar, p.arrastar, p.seta && p.seta.de, p.seta && p.seta.para];
      for (const s of specs) if (s && s.peca) assert.ok(alvos.has(s.peca), `${r.dica}: alvo "${s.peca}"`);
    }
  }
});

test('as cenas são projetos válidos, só com formas do Forgia', () => {
  const cenas = fs.readdirSync(path.join(ROOT, 'ajuda', 'cenas')).filter((f) => f.endsWith('.json'));
  assert.ok(cenas.length >= 8);
  for (const f of cenas) {
    const c = readJson('ajuda', 'cenas', f);
    assert.equal(c.formato, 'forgia.projeto', f);
    assert.ok(c.montagem, `${f}: sem montagem (como a cena foi feita)`);
    const objs = c.projeto.objects;
    assert.ok(objs.length > 0, f);
    assert.doesNotThrow(() => validateProject(objs), f);
    const walk = (o) => {
      assert.ok(o.type === 'group' || SHAPES[o.type], `${f}: tipo ${o.type}`);
      assert.notEqual(o.type, 'mesh', `${f}: malha importada`);
      (o.children || []).forEach(walk);
    };
    objs.forEach(walk);
  }
});

// WebM mínimo: cabeçalho EBML, Segment de tamanho desconhecido (como o do MediaRecorder), Info
// sem Duration, Tracks com um vídeo e um Cluster com 3 blocos a 0, 33 e 66 ms
function tinyWebm() {
  const size = (n) => {
    if (n < 0x7f) return Buffer.from([0x80 | n]);
    return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  };
  const el = (id, ...data) => {
    const body = Buffer.concat(data);
    return Buffer.concat([Buffer.from(id), size(body.length), body]);
  };
  const u = (n, len = 1) => {
    const b = Buffer.alloc(len);
    b.writeUIntBE(n, 0, len);
    return b;
  };
  const block = (tc) => el([0xa3], Buffer.from([0x81]), Buffer.from([tc >> 8, tc & 0xff]), Buffer.from([0x80, 1, 2, 3]));
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm')));
  const info = el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], u(1000000, 3)), el([0x4d, 0x80], Buffer.from('teste')));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], u(1)), el([0x86], Buffer.from('V_VP9')), el([0xe0], el([0xb0], u(640, 2)), el([0xba], u(480, 2)))));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], el([0xe7], u(0)), block(0), block(33), block(66));
  const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), info, tracks, cluster]);
  return Buffer.concat([header, segment]);
}

test('webm: a Duration entra no Info e a leitura bate com os blocos', () => {
  const raw = tinyWebm();
  const before = webm.info(raw);
  assert.equal(before.duracaoGravada, false);
  assert.equal(before.quadros, 3);
  assert.equal(before.largura, 640);
  assert.equal(before.codec, 'V_VP9');
  const fixed = webm.withDuration(raw);
  assert.equal(fixed.length, raw.length + 11);
  const after = webm.info(fixed);
  assert.equal(after.duracaoGravada, true);
  assert.equal(after.duracaoMs, 99); // último bloco (66) + um quadro (33)
  assert.equal(after.quadros, 3);
  assert.equal(webm.withDuration(fixed), fixed, 'já tem Duration: não muda');
});

test('os 22 vídeos: 640x480, VP9, 4 a 6 s, com duração gravada e no máximo 300 KB', () => {
  let total = 0;
  for (const d of DICAS) {
    for (const tema of ['claro', 'escuro']) {
      const file = path.join(ROOT, 'public', 'ajuda', `${d}-${tema}.webm`);
      assert.ok(fs.existsSync(file), file);
      const buf = fs.readFileSync(file);
      const i = webm.info(buf);
      assert.equal(`${i.largura}x${i.altura}`, '640x480', file);
      assert.equal(i.codec, 'V_VP9', file);
      assert.ok(i.duracaoGravada, file);
      assert.ok(i.duracaoMs >= 4000 && i.duracaoMs <= 6000, `${file}: ${i.duracaoMs} ms`);
      assert.ok(buf.length <= 300 * 1024, `${file}: ${buf.length} bytes`);
      total += buf.length;
    }
  }
  assert.ok(total <= 6 * 1024 * 1024, `total ${total}`);
});

test('dicas de fluxo: roteiro em docs/media/roteiros e vídeo 640x480 VP9 nos dois temas, até 12 s e 600 KB', () => {
  for (const d of DICAS_FLUXO) {
    assert.equal(readJson('docs', 'media', 'roteiros', d + '.json').dica, d);
    for (const tema of ['claro', 'escuro']) {
      const file = path.join(ROOT, 'public', 'ajuda', `${d}-${tema}.webm`);
      const buf = fs.readFileSync(file);
      const i = webm.info(buf);
      assert.equal(`${i.largura}x${i.altura}`, '640x480', file);
      assert.equal(i.codec, 'V_VP9', file);
      assert.ok(i.duracaoGravada && i.duracaoMs <= 12000, `${file}: ${i.duracaoMs} ms`);
      assert.ok(buf.length <= 600 * 1024, `${file}: ${buf.length} bytes`);
    }
  }
});
