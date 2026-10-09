// Cinzel (src/cinzel.js), parte pura: carimbos ao longo do traço (espaçamento, interpolação, limite,
// interrupção), passo do diâmetro, passante, malha no lugar da peça, recorte "assado" (peça vira
// 'mesh' no mesmo lugar, um passo de desfazer) e a liberação das malhas que ninguém usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { installBrowserStubs } from './stubs-navegador.mjs';

register('./json-loader.mjs', import.meta.url);
installBrowserStubs();
const { novoTraco, estenderTraco, quebrarTraco, ajustarDiametro, passanteEm, malhaNoLugar, refsEmUso, cortesDoTraco, aplicarTraco, liberarMalhas, MIN_D, MAX_D, MAX_STAMPS, PASSO } = await import('../src/cinzel.js');
const { objectMatrix, groupResult, recortar } = await import('../src/csg.js');
const { defaultParams, shapeGeometry, registerMesh, getMesh } = await import('../src/shapes.js');
const { ensureBVH } = await import('../src/surface.js');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const UP = [0, 1, 0];

test('traço reto com amostras irregulares: carimbos a cada passo exato, sem buraco', () => {
  const tr = novoTraco(1, 100);
  for (const x of [0, 0.3, 0.35, 2.7, 2.71, 6.2, 10]) estenderTraco(tr, [x, 0, 0], UP);
  const xs = tr.stamps.map((s) => s.p[0]);
  assert.equal(xs.length, 11);
  xs.forEach((x, i) => assert.ok(Math.abs(x - i) < 1e-9, `carimbo ${i} em ${x}`));
});

test('mouse parado não acumula carimbos; o resto do caminho conta para o próximo', () => {
  const tr = novoTraco(2, 100);
  estenderTraco(tr, [0, 0, 0], UP);
  for (let i = 0; i < 20; i++) estenderTraco(tr, [0, 0, 0], UP);
  assert.equal(tr.stamps.length, 1);
  estenderTraco(tr, [1.5, 0, 0], UP);
  assert.equal(tr.stamps.length, 1);
  estenderTraco(tr, [2.5, 0, 0], UP);
  assert.equal(tr.stamps.length, 2);
  assert.ok(Math.abs(tr.stamps[1].p[0] - 2) < 1e-9);
});

test('caminho em L: distância entre carimbos seguidos nunca passa do passo', () => {
  const tr = novoTraco(0.75, 1000);
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([i * 0.37, 0, 0]);
  for (let i = 1; i <= 40; i++) pts.push([40 * 0.37, i * 0.53, 0]);
  for (const p of pts) estenderTraco(tr, p, UP);
  for (let i = 1; i < tr.stamps.length; i++) assert.ok(dist(tr.stamps[i].p, tr.stamps[i - 1].p) <= 0.75 + 1e-9);
  const total = 40 * 0.37 + 40 * 0.53;
  assert.equal(tr.stamps.length, Math.floor(total / 0.75 + 1e-9) + 1);
});

test('limite de carimbos por traço', () => {
  const tr = novoTraco(1);
  estenderTraco(tr, [0, 0, 0], UP);
  estenderTraco(tr, [1000, 0, 0], UP);
  assert.equal(tr.stamps.length, MAX_STAMPS);
  assert.equal(estenderTraco(tr, [2000, 0, 0], UP), 0);
});

test('saiu da peça: a volta começa trecho novo, sem carimbos pelo ar', () => {
  const tr = novoTraco(1, 100);
  estenderTraco(tr, [0, 0, 0], UP);
  estenderTraco(tr, [2, 0, 0], UP);
  quebrarTraco(tr);
  estenderTraco(tr, [50, 0, 0], UP);
  assert.deepEqual(tr.stamps.map((s) => s.p[0]), [0, 1, 2, 50]);
});

test('normal interpolada e unitária entre amostras', () => {
  const tr = novoTraco(1, 100);
  estenderTraco(tr, [0, 0, 0], [0, 1, 0]);
  estenderTraco(tr, [2, 0, 0], [1, 0, 0]);
  const n = tr.stamps[1].n;
  assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
  assert.ok(Math.abs(n[0] - n[1]) < 1e-9, 'no meio, 45°');
});

test('diâmetro: ~10% por passo, em décimos, sempre muda e respeita os limites', () => {
  assert.equal(ajustarDiametro(6, 1), 6.6);
  assert.equal(ajustarDiametro(6, -1), 5.5);
  assert.equal(ajustarDiametro(0.5, 1), 0.6);
  assert.equal(ajustarDiametro(0.5, -1), MIN_D);
  assert.equal(ajustarDiametro(195, 1), MAX_D);
  let d = 6;
  for (let i = 0; i < 200; i++) d = ajustarDiametro(d, 1);
  assert.equal(d, MAX_D);
  for (let i = 0; i < 200; i++) d = ajustarDiametro(d, -1);
  assert.equal(d, MIN_D);
});

test('passante: cilindro só do tamanho da peça na direção da normal (+1 mm em cada ponta)', () => {
  const box = new THREE.Box3(new THREE.Vector3(-20, 0, -15), new THREE.Vector3(20, 30, 15));
  let r = passanteEm(box, new THREE.Vector3(5, 30, 2), new THREE.Vector3(0, 1, 0));
  assert.ok(Math.abs(r.len - 32) < 1e-9);
  assert.deepEqual(r.c.toArray(), [5, 15, 2]);
  r = passanteEm(box, new THREE.Vector3(20, 10, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(Math.abs(r.len - 42) < 1e-9);
  assert.ok(Math.abs(r.c.x) < 1e-9);
  const n = new THREE.Vector3(1, 1, 0).normalize();
  const p = new THREE.Vector3(10, 30, 0);
  r = passanteEm(box, p, n);
  assert.ok(Math.abs(p.clone().sub(r.c).dot(n)) <= r.len / 2, 'o ponto fica dentro do cilindro');
  assert.ok(r.len < 30 * Math.SQRT2 + 3, `não passa da caixa: ${r.len}`);
});

// quanto o canto/borda de um carimbo de ø d anda pelo giro extra e pela variação de tamanho (mm)
function deslocamentos(formato, d) {
  const box = new THREE.Box3(new THREE.Vector3(-500, -500, -500), new THREE.Vector3(500, 500, 500));
  const st = [0, 1, 2, 3, 4, 5].map((x) => ({ p: [x * 0.37 * d, 20 + x * 1.3, x * 0.11], n: x % 2 ? [0.6, 0.8, 0] : [0, 1, 0] }));
  const raio = formato === 'cubo' ? (d * Math.sqrt(3)) / 2 : d / 2;
  return cortesDoTraco(st, formato, d, box).map(({ m }, i) => {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
    const base = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...st[i].n).normalize());
    const k = new THREE.Vector3().setFromMatrixScale(m).x / d;
    return { giro: 2 * raio * Math.sin(q.angleTo(base) / 2), tamanho: raio * Math.abs(k - 1) };
  });
}

test('cortes do traço: esfera e cubo um por carimbo (tamanhos um pouco diferentes); passante = um prisma na direção do começo', () => {
  const box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
  const st = [0, 1, 2, 3].map((x) => ({ p: [x, 20, 0], n: x ? [0.6, 0.8, 0] : [0, 1, 0] }));
  const c = cortesDoTraco(st, 'cubo', 2, box);
  assert.equal(c.length, 4);
  const s = c.map(({ m }) => new THREE.Vector3().setFromMatrixScale(m));
  // vizinhos de tamanhos diferentes (sem faces coplanares), o 1º e o 4º iguais (ciclo de 3)
  assert.ok(Math.abs(s[0].x - 2) < 1e-9 && s[1].x > 2 + 1e-4 && s[2].x > s[1].x && Math.abs(s[3].x - 2) < 1e-9);
  // cubo: eixo Y = normal do carimbo, levemente girado (sem faces coplanares entre traços)
  c.forEach(({ m }, i) => {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
    const base = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...st[i].n).normalize());
    const graus = (q.angleTo(base) * 180) / Math.PI;
    assert.ok(graus > 0.01 && graus < 1.51, `giro ${graus}°`);
  });
  // o mesmo traço dá sempre os mesmos cortes (refazer, testes)
  assert.deepEqual(cortesDoTraco(st, 'cubo', 2, box).map((x) => x.m.elements), c.map((x) => x.m.elements));
  assert.equal(cortesDoTraco([st[0]], 'esfera', 5, box).length, 1);
  // passante: um prisma só, eixo = normal do primeiro carimbo (Y), seção = círculos de ø 2 em volta
  // dos carimbos, de ponta a ponta da caixa (+1 mm); só paredes (as tampas ficariam fora da peça)
  const cp = cortesDoTraco(st, 'passante', 2, box);
  assert.equal(cp.length, 1);
  const { dentro, geo } = cp[0];
  assert.ok(dentro(0, 5, 0) && dentro(1.5, 12, 0) && dentro(3, 1, 0.9) && dentro(3.9, 19, 0));
  assert.ok(!dentro(3, 1, 1.1) && !dentro(4.1, 10, 0) && !dentro(-1.1, 10, 0) && !dentro(1.5, 10, 1.1));
  assert.ok(dentro(0, -0.9, 0) && !dentro(0, -1.1, 0) && dentro(0, 20.9, 0) && !dentro(0, 21.1, 0));
  const pos = geo.attributes.position;
  const t = new THREE.Triangle();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    t.setFromAttributeAndIndices(pos, i, i + 1, i + 2).getNormal(nrm);
    assert.ok(Math.abs(nrm.y) < 1e-6, 'parede paralela ao eixo');
    // virada para fora: um passo na direção da normal sai do prisma (longe dos cantos)
    const largura = Math.max(Math.hypot(t.a.x - t.b.x, t.a.z - t.b.z), Math.hypot(t.a.x - t.c.x, t.a.z - t.c.z));
    if (largura < 0.05) continue;
    const c0 = t.getMidpoint(new THREE.Vector3());
    assert.ok(!dentro(...c0.clone().addScaledVector(nrm, 0.01).toArray()) && dentro(...c0.clone().addScaledVector(nrm, -0.01).toArray()));
  }
});

test('giro e variação de tamanho dos carimbos deslocam no máximo 0,03 mm, qualquer que seja o ø', () => {
  for (const d of [0.5, 3, 6, 20, 200]) {
    for (const [i, x] of deslocamentos('cubo', d).entries()) {
      assert.ok(x.giro + x.tamanho <= 0.03 + 1e-9, `cubo ø${d} carimbo ${i}: ${(x.giro + x.tamanho).toFixed(4)} mm`);
      assert.ok(x.giro > 0, `cubo ø${d}: ainda girado (sem faces coplanares)`);
    }
    for (const x of deslocamentos('esfera', d)) assert.ok(x.tamanho <= 0.01 + 1e-9, `esfera ø${d}: ${x.tamanho} mm`);
  }
});

// --------- recorte assado numa imitação mínima do editor ---------

// volume com sinal de triângulos soltos
function volume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const a = new THREE.Vector3(p[i], p[i + 1], p[i + 2]);
    const b = new THREE.Vector3(p[i + 3], p[i + 4], p[i + 5]);
    const c = new THREE.Vector3(p[i + 6], p[i + 7], p[i + 8]);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

// posições no mundo de um objeto, como o editor o desenha (mesma matriz de updateMesh)
function mundo(o) {
  const g = (o.type === 'group' ? groupResult(o).geometry : shapeGeometry(o)).clone();
  const geo = g.index ? g.toNonIndexed() : g;
  const m = objectMatrix(o);
  geo.applyMatrix4(m);
  const p = geo.attributes.position.array;
  if (m.determinant() < 0) for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
  return p;
}
const caixa = (p) => new THREE.Box3().setFromArray(p);

function fakeEd(objects) {
  const ed = {
    objects,
    meshes: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
    avisos: [],
    emit(k, d) {
      if (k === 'aviso') this.avisos.push(d);
      if (k === 'history') liberarMalhas(this, this.max);
    },
    obj(id) {
      return this.objects.find((o) => o.id === id);
    },
    sync() {
      this.meshes.clear();
      for (const o of this.objects) {
        const mesh = new THREE.Mesh(o.type === 'group' ? groupResult(o).geometry : shapeGeometry(o));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(objectMatrix(o));
        this.meshes.set(o.id, mesh);
      }
    },
    worldBox(o) {
      return caixa(mundo(o));
    },
    change(fn) {
      fn();
      this.sync();
      this.commit();
    },
    commit() {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(JSON.stringify(this.objects));
      this.historyIndex = this.history.length - 1;
      this.emit('history');
    },
    undo() {
      this.historyIndex--;
      this.objects = JSON.parse(this.history[this.historyIndex]);
      this.sync();
      this.emit('history');
    },
  };
  ed.sync();
  ed.commit();
  return ed;
}

const obj = (type, o) => ({ id: o.id || type, type, name: o.name || type, color: o.color || '#e3302d', hole: !!o.hole, params: defaultParams(type, o.params), size: o.size, pos: o.pos, quat: o.quat || [0, 0, 0, 1], flip: o.flip || [1, 1, 1] });

test('malha no lugar: mantém o giro da peça e desenha os mesmos pontos no mundo (< 0,01 mm)', () => {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.2, 0.7)).toArray();
  const caixaGirada = obj('box', { size: [30, 8, 14], pos: [12, 20, -7], quat, flip: [-1, 1, 1] });
  const w = mundo(caixaGirada);
  const m = malhaNoLugar(w, quat);
  const { ref } = registerMesh(m.positions);
  const back = mundo({ ...obj('mesh', { size: m.size, pos: m.pos, quat }), params: { ref } });
  assert.equal(back.length, w.length);
  let pior = 0;
  for (let i = 0; i < w.length; i++) pior = Math.max(pior, Math.abs(back[i] - w[i]));
  assert.ok(pior < 0.01, `desvio ${pior}`);
  // a caixa da malha no quadro da peça é a própria caixa (30 × 8 × 14)
  m.size.forEach((v, k) => assert.ok(Math.abs(v - [30, 8, 14][k]) < 1e-3));
  assert.ok(Math.abs(volume(back) - 30 * 8 * 14) < 0.5, 'espelhada continua com as faces para fora');
});

test('recortar: só o traço sai da peça; apagar tudo devolve vazio', () => {
  const box = obj('box', { size: [20, 10, 20], pos: [0, 5, 0] });
  const geo = shapeGeometry(box);
  const m = objectMatrix(box);
  const cortes = cortesDoTraco([{ p: [0, 10, 0], n: [0, 1, 0] }], 'esfera', 6, caixa(mundo(box)));
  const out = recortar(geo, m, cortes, ensureBVH(geo));
  const tirado = 20 * 10 * 20 - volume(out);
  const meiaEsfera = (2 / 3) * Math.PI * 27;
  assert.ok(Math.abs(tirado - meiaEsfera) < meiaEsfera * 0.1, `tirou ${tirado}, esperado ~${meiaEsfera}`);
  const grande = cortesDoTraco([{ p: [0, 5, 0], n: [0, 1, 0] }], 'cubo', 100, caixa(mundo(box)));
  assert.equal(recortar(geo, m, grande, ensureBVH(geo)).length, 0);
});

test('recorte local (só os triângulos perto do traço) = booleana com a peça inteira; passante tira o prisma', async () => {
  const { MeshBVH } = await import('three-mesh-bvh');
  const { Brush, Evaluator, SUBTRACTION, ADDITION } = await import('three-bvh-csg');
  // bola de 120 × 60 faixas: o carimbo na superfície tem triângulos dentro dela cujo raio (na
  // direção da normal do carimbo) só bate do outro lado da bola, longe do pedaço local
  const bola = obj('sphere', { size: [20, 20, 20], pos: [0, 10, 0], params: { steps: 120 } });
  const geo = shapeGeometry(bola);
  const m = objectMatrix(bola);
  const bvh = new MeshBVH(geo, { indirect: true });
  // passante de dois carimbos de ø 3 no topo: tira da bola o prisma (seção = os dois círculos) ao
  // longo de Y; volume esperado = soma, na seção, da corda vertical da bola (grade de 0,02 mm)
  const st = [{ p: [0, 20, 0], n: [0, 1, 0] }, { p: [0, 20, 1.5], n: [0, 1, 0] }];
  const [prisma] = cortesDoTraco(st, 'passante', 3, caixa(mundo(bola)));
  const tirado = volume(mundo(bola)) - volume(recortar(geo, m, [prisma], bvh, new THREE.Quaternion()));
  let esperado = 0;
  for (let x = -1.6; x <= 1.6; x += 0.02) for (let z = -1.6; z <= 3.1; z += 0.02) if (prisma.dentro(x, 10, z)) esperado += 2 * Math.sqrt(100 - x * x - z * z) * 0.0004;
  assert.ok(Math.abs(tirado - esperado) < 0.01 * esperado, `passante: tirou ${tirado}, prisma ${esperado}`);
  for (const [formato, p, n] of [['esfera', [0, 20, 0], [0, 1, 0]], ['cubo', [10, 10, 0], [1, 0, 0]]]) {
    const cortes = cortesDoTraco([{ p, n }, { p: p.map((v, k) => v + (k === 2 ? 1.5 : 0)), n }], formato, 3, caixa(mundo(bola)));
    const local = recortar(geo, m, cortes, bvh);
    // referência: a peça inteira menos a união, direto no three-bvh-csg
    const ev = new Evaluator();
    ev.attributes = ['position'];
    ev.useGroups = false;
    const br = (g, mm) => {
      const c = g.clone();
      c.applyMatrix4(mm);
      for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k);
      const b = new Brush(c.index ? c.toNonIndexed() : c);
      b.updateMatrixWorld();
      return b;
    };
    let u = br(cortes[0].geo, cortes[0].m);
    u = ev.evaluate(u, br(cortes[1].geo, cortes[1].m), ADDITION);
    const ref = ev.evaluate(br(geo, m), u, SUBTRACTION).geometry.attributes.position.array;
    const vl = volume(local);
    const vr = volume(ref);
    assert.ok(Math.abs(vl - vr) < 1e-3 * vr, `${formato}: local ${vl} x inteira ${vr}`);
    assert.ok(vl < volume(mundo(bola)) - 5, `${formato}: tirou algo`);
    // os cortes partem os triângulos de outro jeito, mas a quantidade é parecida
    assert.ok(Math.abs(local.length - ref.length) < 0.05 * ref.length, `${formato}: ${local.length / 9} x ${ref.length / 9} triângulos`);
  }
});

test('normais com vinco rápidas = toCreasedNormals do three', async () => {
  const { creasedNormals } = await import('../src/shapes.js');
  const { toCreasedNormals } = await import('three/addons/utils/BufferGeometryUtils.js');
  const sopa = new Float32Array(3000 * 9).map((_, i) => Math.round(Math.sin(i * 12.9898) * 437.5) / 20); // pontos repetidos e quase iguais
  const geos = [
    new THREE.SphereGeometry(5, 24, 12),
    new THREE.BoxGeometry(3, 4, 5),
    new THREE.TorusKnotGeometry(6, 1.5, 120, 16),
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sopa, 3)),
  ];
  for (const g of geos) {
    for (const ang of [30, 40]) {
      const a = toCreasedNormals(g.clone(), (ang * Math.PI) / 180).attributes.normal.array;
      const b = creasedNormals(g.clone(), (ang * Math.PI) / 180).attributes.normal.array;
      assert.equal(a.length, b.length);
      let pior = 0;
      for (let i = 0; i < a.length; i++) pior = Math.max(pior, Math.abs(a[i] - b[i]));
      assert.equal(pior, 0, `diferença ${pior}`);
    }
  }
});

test('traço assado: peça vira mesh com mesmo id/nome/cor/lugar, um passo de desfazer, sem aninhar', () => {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)).toArray();
  const ed = fakeEd([obj('box', { id: 'p1', name: 'Caixa', color: '#123456', size: [40, 10, 20], pos: [3, 5, 2], quat })]);
  const antes = caixa(mundo(ed.objects[0]));
  const tr = novoTraco(1.5);
  for (let x = -10; x <= 10; x += 0.5) estenderTraco(tr, [3 + x * Math.cos(0.5), 10, 2 - x * Math.sin(0.5)], UP);
  const novo = aplicarTraco(ed, ed.objects[0], tr.stamps, 'esfera', 3);
  assert.ok(novo);
  assert.equal(ed.objects.length, 1);
  const o = ed.objects[0];
  assert.deepEqual([o.id, o.type, o.name, o.color, o.hole, o.children], ['p1', 'mesh', 'Caixa', '#123456', false, undefined]);
  assert.deepEqual(o.quat, quat);
  const depois = caixa(mundo(o));
  assert.ok(depois.min.distanceTo(antes.min) < 0.01 && depois.max.distanceTo(antes.max) < 0.01, 'mesma caixa no mundo');
  assert.ok(volume(mundo(o)) < 40 * 10 * 20 - 50, 'o sulco saiu');
  assert.equal(ed.historyIndex, 1);
  assert.match(ed.avisos[0], /malha/);
  // segundo traço na malha: continua uma malha só, nada de grupo
  aplicarTraco(ed, ed.objects[0], [{ p: [3, 10, 2], n: UP }], 'cubo', 4);
  assert.equal(ed.objects[0].type, 'mesh');
  assert.equal(ed.historyIndex, 2);
  assert.equal(ed.avisos.length, 1, 'o aviso de virar malha é uma vez só');
  ed.undo();
  ed.undo();
  assert.equal(ed.objects[0].type, 'box');
});

test('grupo vira uma malha só com o resultado dele; apagar tudo não muda nada', () => {
  const g = {
    id: 'g1', type: 'group', name: 'Suporte', color: null, hole: false, params: {}, size: [20, 10, 20], pos: [0, 5, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1],
    children: [obj('box', { id: 'c1', color: '#00aa00', size: [20, 10, 20], pos: [0, 0, 0] }), obj('cylinder', { id: 'c2', hole: true, size: [6, 12, 6], pos: [0, 0, 0] })],
  };
  const ed = fakeEd([g]);
  const v0 = volume(mundo(ed.objects[0]));
  aplicarTraco(ed, ed.objects[0], [{ p: [8, 10, 8], n: UP }], 'esfera', 4);
  const o = ed.objects[0];
  assert.deepEqual([o.type, o.name, o.color], ['mesh', 'Suporte', '#00aa00']);
  const v1 = volume(mundo(o));
  assert.ok(v1 < v0 - 10 && v1 > v0 - 40, `${v0} -> ${v1}`);
  const h = ed.historyIndex;
  const json = JSON.stringify(ed.objects);
  assert.equal(aplicarTraco(ed, ed.objects[0], [{ p: [0, 5, 0], n: UP }], 'cubo', 200), null);
  assert.equal(JSON.stringify(ed.objects), json);
  assert.equal(ed.historyIndex, h);
  assert.match(ed.avisos.at(-1), /inteira/);
});

// --------- estanqueidade (peça fechada para imprimir) ---------

// Bordas abertas de verdade de triângulos soltos p: solda os pontos a 1e-3 mm, conta as arestas
// dirigidas sem par e parte cada uma nos pontos de outras bordas que caem sobre ela (T-junction do
// three-bvh-csg = fechado). Devolve { abertas, comprimento, area (soma dos vetores de área, mm²) }.
function furos(p, eps = 1e-3) {
  const ids = new Map();
  const V = [];
  const id = (i) => {
    const s = Math.round(p[i] / eps) + ',' + Math.round(p[i + 1] / eps) + ',' + Math.round(p[i + 2] / eps);
    let v = ids.get(s);
    if (v === undefined) ids.set(s, (v = V.length)), V.push([p[i], p[i + 1], p[i + 2]]);
    return v;
  };
  const somar = (net, a, b) => {
    if (a === b) return;
    const k = a < b ? a + ':' + b : b + ':' + a;
    net.set(k, (net.get(k) || 0) + (a < b ? 1 : -1));
  };
  const net = new Map();
  const area = [0, 0, 0];
  for (let t = 0; t < p.length; t += 9) {
    const v = [id(t), id(t + 3), id(t + 6)];
    for (let e = 0; e < 3; e++) somar(net, v[e], v[(e + 1) % 3]);
    const u = [p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]];
    const w = [p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]];
    area[0] += (u[1] * w[2] - u[2] * w[1]) / 2;
    area[1] += (u[2] * w[0] - u[0] * w[2]) / 2;
    area[2] += (u[0] * w[1] - u[1] * w[0]) / 2;
  }
  const segs = [];
  for (const [k, c] of net) {
    if (!c) continue;
    const [a, b] = k.split(':').map(Number);
    for (let i = 0; i < Math.abs(c); i++) segs.push(c > 0 ? [a, b] : [b, a]);
  }
  // pontos das bordas numa grade de 0,5 mm
  const cel = (x) => Math.floor(x / 0.5);
  const grade = new Map();
  for (const v of new Set(segs.flat())) {
    const k = V[v].map(cel).join();
    if (!grade.has(k)) grade.set(k, []);
    grade.get(k).push(v);
  }
  const net2 = new Map();
  for (const [a, b] of segs) {
    const A = V[a];
    const B = V[b];
    const d = B.map((x, k) => x - A[k]);
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const lo = [0, 1, 2].map((k) => cel(Math.min(A[k], B[k]) - eps));
    const hi = [0, 1, 2].map((k) => cel(Math.max(A[k], B[k]) + eps));
    const sobre = [];
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      for (const v of grade.get(x + ',' + y + ',' + z) || []) {
        if (v === a || v === b) continue;
        const w = V[v].map((c, k) => c - A[k]);
        const t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / L2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        if (Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]) < eps) sobre.push([t, v]);
      }
    }
    sobre.sort((x, y) => x[0] - y[0]);
    let ant = a;
    for (const [, v] of sobre) somar(net2, ant, v), (ant = v);
    somar(net2, ant, b);
  }
  let abertas = 0;
  let comprimento = 0;
  for (const [k, c] of net2) {
    if (!c) continue;
    const [a, b] = k.split(':').map(Number);
    abertas += Math.abs(c);
    comprimento += Math.abs(c) * Math.hypot(...V[a].map((x, i) => x - V[b][i]));
  }
  return { abertas, comprimento, area: Math.hypot(...area) };
}

// área da união de n círculos de raio r em fila, centros a s um do outro (s >= r: só vizinhos se tocam)
const areaFila = (n, r, s) => n * Math.PI * r * r - (n - 1) * (2 * r * r * Math.acos(s / (2 * r)) - (s / 2) * Math.sqrt(4 * r * r - s * s));

test('estanque: passante arrastado com 1, 2 e N carimbos fecha a peça e tira o volume do rasgo', () => {
  for (const [n, d] of [[1, 2], [2, 2], [5, 2], [21, 2], [30, 3], [10, 6]]) {
    // caixa 60 × 20 × 40 nova a cada rasgo; traço reto em X na face de cima, pela peça real (aplicarTraco)
    const ed = fakeEd([obj('box', { id: 'cx', size: [60, 20, 40], pos: [0, 10, 0] })]);
    const tr = novoTraco(d * PASSO, 100);
    for (let k = 0; k < n; k++) estenderTraco(tr, [(k - (n - 1) / 2) * d * PASSO, 20, 0.3], UP);
    assert.equal(tr.stamps.length, n);
    assert.ok(aplicarTraco(ed, ed.objects[0], tr.stamps, 'passante', d));
    const w = mundo(ed.objects[0]);
    const f = furos(w);
    assert.equal(f.abertas, 0, `${n} carimbos ø ${d}: ${f.abertas} arestas abertas (${f.comprimento} mm)`);
    assert.ok(f.area < 1e-3, `${n} carimbos ø ${d}: vetor de área ${f.area} mm²`);
    const esperado = areaFila(n, d / 2, d * PASSO) * 20;
    const tirado = 60 * 20 * 40 - volume(w);
    assert.ok(Math.abs(tirado - esperado) < 0.015 * esperado, `${n} carimbos ø ${d}: tirou ${tirado}, rasgo ${esperado}`);
  }
});

test('estanque: rasgos passantes que se cruzam e caminho em curva', () => {
  const ed = fakeEd([obj('box', { id: 'cx', size: [60, 20, 40], pos: [0, 10, 0] })]);
  for (const [x0, z0, dx, dz] of [[-15, -5, 1, 0], [-5, -15, 0, 1], [-15, 5, 0.8, -0.6]]) {
    const tr = novoTraco(1.5, 100);
    for (let k = 0; k <= 40; k++) {
      const a = k * 0.5;
      estenderTraco(tr, [x0 + dx * a + Math.sin(a / 3) * dz, 20, z0 + dz * a + Math.sin(a / 3) * dx], UP);
    }
    assert.ok(aplicarTraco(ed, ed.objects[0], tr.stamps, 'passante', 3));
    const f = furos(mundo(ed.objects[0]));
    assert.equal(f.abertas, 0, `${f.abertas} arestas abertas (${f.comprimento} mm)`);
    assert.ok(f.area < 1e-3, `vetor de área ${f.area} mm²`);
  }
});

test('estanque: cadeia de esferas num traço; cubos; vários traços de esfera sobrepostos', () => {
  for (const formato of ['esfera', 'cubo']) {
    const ed = fakeEd([obj('box', { id: 'cx', size: [60, 20, 40], pos: [0, 10, 0] })]);
    const tr = novoTraco(1.5, 100);
    for (let k = 0; k < 20; k++) estenderTraco(tr, [-15 + k * 1.5, 20, 0.3 + k * 0.05], UP);
    assert.ok(aplicarTraco(ed, ed.objects[0], tr.stamps, formato, 3));
    const f = furos(mundo(ed.objects[0]));
    assert.ok(f.area < 1e-3, `${formato}: vetor de área ${f.area} mm²`);
    // cubo: as faces de cubos vizinhos se cruzam em ~1° (o giro que tira a coplanaridade) e o
    // three-bvh-csg às vezes deixa uma fresta de espessura ~0,001 mm (aqui 0,03 mm de aresta)
    if (formato === 'esfera') assert.equal(f.abertas, 0, `esfera: ${f.abertas} arestas abertas (${f.comprimento} mm)`);
    else assert.ok(f.comprimento < 0.1, `cubo: ${f.abertas} arestas abertas (${f.comprimento} mm)`);
  }
  // 10 traços de esfera ø 3 sobrepostos (1,4 mm entre eles): o three-bvh-csg ainda deixa frestas de
  // espessura ~0,001 mm (triângulo que ele não parte no encontro de três paredes); a peça fica fechada
  // para o fatiador (vetor de área ~0) e o que sobra é menos de 1 mm de aresta
  const ed = fakeEd([obj('box', { id: 'cx', size: [60, 20, 40], pos: [0, 10, 0] })]);
  for (let i = 0; i < 10; i++) {
    const tr = novoTraco(1.5);
    for (let k = 0; k < 9; k++) estenderTraco(tr, [-25 + k * 2.5, 20, -17 + i * 1.4 + k * 0.06], UP);
    assert.ok(aplicarTraco(ed, ed.objects[0], tr.stamps, 'esfera', 3));
  }
  const f = furos(mundo(ed.objects[0]));
  assert.ok(f.area < 1e-3, `vetor de área ${f.area} mm²`);
  assert.ok(f.comprimento < 1, `${f.abertas} arestas abertas, ${f.comprimento} mm`);
});

test('memória: malha de traço desfeito e sobrescrito sai; teto corta os passos mais antigos', () => {
  const ed = fakeEd([obj('box', { id: 'm1', size: [40, 10, 20], pos: [0, 5, 0] })]);
  const refs = [];
  for (let i = 0; i < 4; i++) {
    aplicarTraco(ed, ed.objects[0], [{ p: [-15 + i * 8, 10, 0], n: UP }], 'esfera', 3);
    refs.push(ed.objects[0].params.ref);
  }
  assert.ok(refs.every((r) => getMesh(r)));
  ed.undo();
  ed.undo();
  assert.ok(getMesh(refs[3]) && getMesh(refs[2]), 'desfeitos ainda dão para refazer');
  aplicarTraco(ed, ed.objects[0], [{ p: [15, 10, 5], n: UP }], 'esfera', 3);
  assert.equal(getMesh(refs[3]), undefined, 'o refazer sobrescrito sai da memória');
  assert.equal(getMesh(refs[2]), undefined);
  assert.ok(getMesh(refs[0]) && getMesh(refs[1]));
  // teto de 1 byte: só a malha atual fica; o histórico vira só o passo atual
  const atual = ed.objects[0].params.ref;
  ed.clipboard = null;
  liberarMalhas(ed, 1);
  assert.equal(ed.historyIndex, 0);
  assert.equal(ed.history.length, 1);
  assert.ok(getMesh(atual));
  assert.equal(getMesh(refs[0]), undefined);
  assert.deepEqual([...refsEmUso(['{"params":{"ref":"ma"}}', 'x "ref":"mb" "ref":"ma"'])], ['ma', 'mb']);
});
