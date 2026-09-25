// Geradores de forma (grade, mola, dobradiça, caixa com tampa, texto curvo): malhas fechadas,
// medidas externas, folgas medidas na malha e triângulos no padrão.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import { meshReport } from '../src/geradores/malha.js';
import { buildGrid, gridSize, gridCells } from '../src/geradores/grade.js';
import { buildSpring, springSize, springDims } from '../src/geradores/mola.js';
import { buildHinge, hingeSize, hingeDims } from '../src/geradores/dobradica.js';
import { buildLidBox, lidBoxSize, lidBoxDims } from '../src/geradores/caixa.js';
import { buildCurvedText, curvedTextSize, curvedTextOutline } from '../src/geradores/texto-curvo.js';

const font = new FontLoader().parse(JSON.parse(readFileSync(new URL('../node_modules/three/examples/fonts/helvetiker_bold.typeface.json', import.meta.url), 'utf8')));

function assertClosed(r, name) {
  assert.equal(r.openEdges, 0, `${name}: arestas abertas`);
  assert.equal(r.nonManifoldEdges, 0, `${name}: arestas com mais de 2 triângulos`);
  assert.equal(r.flippedEdges, 0, `${name}: sentido invertido`);
  assert.equal(r.degenerate, 0, `${name}: degenerados`);
  assert.ok(r.volume > 0, `${name}: volume ${r.volume}`);
}

function assertSize(actual, expected, name, tol = 1e-3) {
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(actual[k] - expected[k]) <= tol, `${name}: eixo ${'XYZ'[k]} ${actual[k]} ≠ ${expected[k]}`);
}

// todas as distâncias em que um raio cruza a malha, em ordem
function hits(geo, origin, dir) {
  const bvh = new MeshBVH(geo);
  const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
  const out = bvh.raycast(ray, THREE.DoubleSide).map((h) => h.distance);
  out.sort((a, b) => a - b);
  return out.filter((d, i) => i === 0 || d - out[i - 1] > 1e-5);
}

// número de peças soltas (componentes conexos por vértice)
function components(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index.array;
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]);
    parent[find(idx[t + 1])] = a;
    parent[find(idx[t + 2])] = a;
  }
  const roots = new Set();
  for (let t = 0; t < idx.length; t++) roots.add(find(idx[t]));
  return roots.size;
}

test('grade: colmeia e quadrada fechadas, com a placa W × espessura × D e furos', (t) => {
  for (const pattern of [0, 1]) {
    for (const [width, depth, cell, wall, border] of [
      [60, 60, 8, 1.6, 3],
      [80, 45, 5, 1.2, 2],
      [30, 100, 12, 2, 4],
    ]) {
      const params = { width, depth, cell, wall, border, pattern, thickness: 2.4 };
      const name = `grade ${pattern ? 'quadrada' : 'colmeia'} ${width}×${depth} célula ${cell}`;
      const r = meshReport(buildGrid(params));
      assertClosed(r, name);
      assertSize(r.size, [width, 2.4, depth], name);
      assertSize(gridSize(params), r.size, `${name} (gridSize)`);
      const { holes } = gridCells(params);
      assert.ok(holes.length > 3, `${name}: ${holes.length} furos`);
      assert.ok(r.volume < width * depth * 2.4 * 0.8, `${name}: quase sem furo`);
    }
  }
  const def = meshReport(buildGrid({}));
  t.diagnostic(`grade padrão (60×60, colmeia 8 mm): ${def.triangles} triângulos, ${gridCells({}).holes.length} células`);
  assert.ok(def.triangles <= 5000);
});

test('mola: fechada, Ø externo, altura = espiras·passo + fio·cos λ, e passo mínimo para imprimir', (t) => {
  for (const params of [{}, { diameter: 12, wire: 1.2, pitch: 3, coils: 8 }, { diameter: 30, wire: 3, pitch: 2, coils: 3 }]) {
    const r = meshReport(buildSpring(params));
    const name = `mola ${JSON.stringify(params)}`;
    assertClosed(r, name);
    assertSize(r.size, springSize(params), name, 2e-3);
    const d = springDims(params);
    assert.ok(Math.abs(r.size[0] - (params.diameter ?? 20)) < 2e-3, `${name}: Ø externo ${r.size[0]}`);
    assert.ok(d.pitch * d.cosL - d.wire >= 0.4 - 1e-9, `${name}: espiras encostadas`);
  }
  // passo menor que o fio: sobe para caber 0,4 mm entre espiras
  assert.ok(springDims({ wire: 3, pitch: 2 }).pitch > 3.4);
  const def = meshReport(buildSpring({}));
  t.diagnostic(`mola padrão (Ø20, fio 2, 5 espiras): ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 6000);
});

test('dobradiça: duas peças fechadas e separadas, folga radial do pino e folga entre juntas', (t) => {
  for (const params of [{}, { knuckles: 3, pin: 2, clearance: 0.3, thickness: 2 }, { length: 80, width: 50, knuckles: 7, thickness: 4, pin: 4 }]) {
    const name = `dobradiça ${JSON.stringify(params)}`;
    const geo = buildHinge(params);
    const r = meshReport(geo);
    assertClosed(r, name);
    assertSize(r.size, hingeSize(params), name);
    assert.equal(components(geo), 2, `${name}: deveria ter 2 peças`);
    const d = hingeDims(params);
    // após centrar: eixo em y = 0, z = 0, comprimento de −L/2 a L/2
    const xB = -d.length / 2 + d.kl + d.c + d.kl / 2; // meio da 1ª junta B
    const radial = hits(geo, [xB, 0, 0], [0, 1, 0]);
    // sai do pino, entra na junta B, sai da junta B
    assert.ok(Math.abs(radial[0] - d.rPin) < 0.01, `${name}: raio do pino ${radial[0]}`);
    assert.ok(Math.abs(radial[1] - radial[0] - d.c) < 0.01, `${name}: folga radial ${radial[1] - radial[0]}`);
    // raio paralelo ao eixo passando dentro das juntas: folga c entre uma junta e a seguinte
    const rho = (d.rPin + d.c + d.R) / 2;
    const axial = hits(geo, [-d.length / 2 - 1, rho, 0], [1, 0, 0]);
    assert.equal(axial.length, 2 * d.n, `${name}: ${axial.length} cruzamentos para ${d.n} juntas`);
    for (let k = 1; k < axial.length - 1; k += 2) assert.ok(Math.abs(axial[k + 1] - axial[k] - d.c) < 1e-3, `${name}: folga entre juntas ${axial[k + 1] - axial[k]}`);
    if (!Object.keys(params).length) t.diagnostic(`dobradiça padrão: folga radial ${(radial[1] - radial[0]).toFixed(3)} mm, entre juntas ${(axial[2] - axial[1]).toFixed(3)} mm, ${r.triangles} triângulos`);
  }
  assert.ok(meshReport(buildHinge({})).triangles <= 6000);
});

test('caixa com tampa: fechadas, medidas externas e aba da tampa com a folga por lado', (t) => {
  for (const params of [{}, { width: 80, depth: 50, height: 25, radius: 0 }, { width: 30, depth: 30, height: 20, wall: 1.2, clearance: 0.3, radius: 5 }]) {
    for (const part of [0, 1, 2]) {
      const q = { ...params, part };
      const name = `caixa ${JSON.stringify(q)}`;
      const geo = buildLidBox(q);
      const r = meshReport(geo);
      assertClosed(r, name);
      assertSize(r.size, lidBoxSize(q), name);
      if (part === 0) assert.equal(components(geo), 2, `${name}: caixa e tampa são 2 peças`);
    }
    const d = lidBoxDims(params);
    const box = buildLidBox({ ...params, part: 1 });
    const lid = buildLidBox({ ...params, part: 2 });
    assertSize(meshReport(box).size, [d.W, d.p.height - d.lid, d.D], 'caixa: W × (altura − tampa) × D');
    // parede interna da caixa (do centro, a meia altura, para +X): W/2 − parede
    const inBox = hits(box, [0, d.boxH / 4, 0], [1, 0, 0])[0];
    // aba da tampa: 1º cruzamento = lado de dentro da aba, 2º = lado de fora
    const lidY = -(d.lid + d.lip) / 2 + d.lid + d.lip / 2;
    const lip = hits(lid, [0, lidY, 0], [1, 0, 0]);
    assert.ok(Math.abs(inBox - (d.W / 2 - d.wall)) < 1e-3, `vão da caixa ${inBox}`);
    assert.ok(Math.abs(inBox - lip[1] - d.c) < 1e-3, `folga da tampa ${inBox - lip[1]} ≠ ${d.c}`);
  }
  const def = meshReport(buildLidBox({}));
  t.diagnostic(`caixa com tampa padrão (60×40×30): ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 3000);
});

test('texto curvo: letras fechadas no arco, raio e ângulo', (t) => {
  for (const text of ['TEXTO', 'Forgia 2026', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz 0123456789 &@#%?!']) {
    const params = { text, arcRadius: 40 };
    const name = `texto curvo "${text}"`;
    const r = meshReport(buildCurvedText(params, font));
    assertClosed(r, name);
    assertSize(r.size, curvedTextSize(params, font), name);
    assert.ok(Math.abs(r.size[1] - 2) < 1e-4, `${name}: espessura ${r.size[1]}`);
  }
  // ângulo: natural por padrão; 180° abre o arco (mais largo) sem deformar as letras
  const natural = curvedTextOutline({ text: 'TEXTO', arcRadius: 30 }, font);
  const wide = curvedTextOutline({ text: 'TEXTO', arcRadius: 30, angle: 180 }, font);
  const narrow = curvedTextOutline({ text: 'TEXTO', arcRadius: 30, angle: 30 }, font);
  assert.ok(Math.abs(wide.angle - Math.PI) < 1e-9);
  assert.ok(natural.angle > narrow.angle && natural.angle < wide.angle);
  const sn = curvedTextSize({ text: 'TEXTO', arcRadius: 30 }, font);
  const sw = curvedTextSize({ text: 'TEXTO', arcRadius: 30, angle: 180 }, font);
  assert.ok(sw[0] > sn[0], 'arco de 180° mais largo que o natural');
  // raio grande: quase reto, largura perto da do texto reto
  const flat = curvedTextSize({ text: 'TEXTO', arcRadius: 500 }, font);
  assert.ok(flat[2] < 11, `raio 500: profundidade ${flat[2]}`);
  assert.throws(() => buildCurvedText({}), /fonte/);
  const def = meshReport(buildCurvedText({}, font));
  t.diagnostic(`texto curvo padrão ("TEXTO", raio 30): ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 6000);
});
