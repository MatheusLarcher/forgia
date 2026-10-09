// Separação de malha importada em partes (src/separar.js), sem Electron nem navegador:
// partes conexas, solda por posição (não por índice), lugar no mundo de cada parte e tempo numa
// malha de 300 mil triângulos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { separarPartes, dividirMalha, caixaDe, gradeDeSolda } from '../src/separar.js';

// caixa de triângulos soltos (12), canto mínimo em [x, y, z], medidas [lx, ly, lz]
function caixa([x, y, z], [lx, ly, lz]) {
  const g = new THREE.BoxGeometry(lx, ly, lz).toNonIndexed();
  g.translate(x + lx / 2, y + ly / 2, z + lz / 2);
  return Array.from(g.attributes.position.array);
}
const cubo = (canto, l = 1) => caixa(canto, [l, l, l]);
// grade n×n de quadrados (2 n² triângulos) no plano XY, na altura z
function grade(n, z = 0, x0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = [x0 + i, j, z], b = [x0 + i + 1, j, z], c = [x0 + i + 1, j + 1, z], d = [x0 + i, j + 1, z];
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return out;
}
const f32 = (...arrs) => new Float32Array(arrs.flat());

// mesma conta do SHAPES.mesh.build (normalizeTo) + objectMatrix: posições cruas -> mundo.
// b = caixa que o build centra e escala (a da malha do objeto; padrão: a das próprias posições)
function mundo(positions, o, b = caixaDe(positions)) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...o.pos), new THREE.Quaternion(...o.quat), new THREE.Vector3(...(o.flip || [1, 1, 1])));
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(...[0, 1, 2].map((k) => (positions[i + k] - (b.min[k] + b.max[k]) / 2) * (o.size[k] / (b.max[k] - b.min[k] || 1))));
    box.expandByPoint(v.applyMatrix4(m));
  }
  return box;
}

test('duas partes separadas: duas listas, na ordem do arquivo', () => {
  const p = f32(cubo([0, 0, 0]), cubo([5, 0, 0], 2));
  const partes = separarPartes(p);
  assert.equal(partes.length, 2);
  assert.equal(partes[0].length, 12 * 9);
  assert.equal(partes[1].length, 12 * 9);
  assert.deepEqual(caixaDe(partes[1]), { min: [5, 0, 0], max: [7, 2, 2] });
});

test('partes intercaladas no arquivo voltam juntas', () => {
  const a = cubo([0, 0, 0]);
  const b = cubo([3, 0, 0]);
  const mix = [];
  for (let t = 0; t < 12; t++) mix.push(...a.slice(t * 9, t * 9 + 9), ...b.slice(t * 9, t * 9 + 9));
  const partes = separarPartes(f32(mix));
  assert.equal(partes.length, 2);
  assert.deepEqual(caixaDe(partes[0]), { min: [0, 0, 0], max: [1, 1, 1] });
  assert.deepEqual(caixaDe(partes[1]), { min: [3, 0, 0], max: [4, 1, 1] });
});

test('solda: só um vértice ou uma aresta em comum = mesma parte', () => {
  assert.equal(separarPartes(f32(cubo([0, 0, 0]), cubo([1, 1, 1]))).length, 1, 'canto com canto');
  assert.equal(separarPartes(f32(cubo([0, 0, 0]), cubo([1, 1, 0]))).length, 1, 'aresta com aresta');
  assert.equal(separarPartes(f32(cubo([0, 0, 0]), cubo([1.01, 0, 0]))).length, 2, '0,01 de folga separa');
});

test('solda por posição, não por índice: ruído de float abaixo da tolerância ainda une', () => {
  // dois triângulos com a aresta comum escrita com ruído de 1e-6 (STL de outro programa);
  // tolerância = diagonal interquartil × 2 × 1e-6 ≈ 2,8e-5 aqui. A fronteira de célula está no teste abaixo.
  const e = 1e-6;
  const p = f32([0, 0, 0, 10, 0, 0, 0, 10, 0], [10 + e, 0, 0, 10, 10, 0, 0 - e, 10 + e, 0]);
  assert.equal(separarPartes(p).length, 1);
  // mesmo triângulo repetido longe: não encosta
  assert.equal(separarPartes(f32([0, 0, 0, 10, 0, 0, 0, 10, 0], [20, 0, 0, 30, 0, 0, 20, 10, 0])).length, 2);
});

// dois triângulos numa caixa 10×10 que só dividem o vértice (a, 5) / (b, 5)
const parFronteira = (ax, ay, bx, by) => f32([0, 0, 0, ax, ay, 0, 0, 10, 0], [bx, by, 0, 10, 10, 0, 10, 0, 0]);
const solda = gradeDeSolda(parFronteira(5, 5, 5, 5));

// quartis: x e y de 0 a 10, z = 0 -> diagonal interquartil × 2 = 2 × hypot(10, 10); acima de
// 4 passos do float32 no percentil 75% de |coordenada| (5)
test('tolerância do par de fronteira = diagonal interquartil × 2 × 1e-6 (acima de 4 passos do float32 em 5)', () => {
  assert.equal(solda.tol, 2 * Math.hypot(10, 10) * 1e-6);
});

test('solda: vértice comum exatamente numa fronteira de célula, com ruído ± abaixo da tolerância = 1 parte', () => {
  const { tol, celula } = solda;
  assert.equal(caixaDe(parFronteira(5, 5, 5, 5)).max[0], 10); // caixa 10×10 a partir de 0 (origem da grade)
  const ruidos = [tol * 0.02, tol * 0.1, tol * 0.3, tol * 0.45];
  let casos = 0;
  for (let m = Math.floor(3 / celula); m < 7 / celula; m += 97) {
    const f = m * celula; // fronteira x = m × célula (origem da grade = min da caixa = 0)
    for (const e of ruidos) {
      // um de cada lado da fronteira em X (distância 2e <= 0,9 tol); também na diagonal, com a
      // fronteira em X e em Y ao mesmo tempo (distância e·√2)
      const fy = Math.round(5 / celula) * celula;
      const d = e / 2;
      for (const p of [parFronteira(f + e, 5, f - e, 5), parFronteira(f - e, 5, f + e, 5), parFronteira(f + d, fy - d, f - d, fy + d)]) {
        assert.equal(separarPartes(p).length, 1, `fronteira ${f}, ruído ${e}`);
        casos++;
      }
    }
  }
  assert.ok(casos > 100, `${casos} casos`);
  // o caso da revisão: fronteira da grade antiga (arredondamento em (m + 0,5) × diag/65536), ±2e-7
  const antiga = Math.hypot(10, 10) / 65536;
  for (let m = 20000; m < 20044; m++) {
    const x = (m + 0.5) * antiga;
    assert.equal(separarPartes(parFronteira(x + 2e-7, 5, x - 2e-7, 5)).length, 1, `grade antiga m=${m}`);
  }
  // varredura fina em X (passo que não divide a célula): qualquer posição, ruído 0,4 × tol
  for (let x = 4; x < 6; x += 0.000137) assert.equal(separarPartes(parFronteira(x + tol * 0.2, 5, x - tol * 0.2, 5)).length, 1, `x=${x}`);
});

test('solda: vértices mais longe que a tolerância não soldam, nem na mesma célula', () => {
  const { tol, celula } = solda;
  const f = Math.round(5 / celula) * celula;
  assert.equal(separarPartes(parFronteira(f + 1.5 * tol, 5, f - 1.5 * tol, 5)).length, 2, '3 tol atravessando a fronteira');
  assert.equal(separarPartes(parFronteira(f + 0.1 * celula, 5, f + 0.1 * celula + 1.6 * tol, 5)).length, 2, '1,6 tol na mesma célula');
});

test('uma parte só: devolve a própria lista e dividirMalha dá null', () => {
  const p = f32(cubo([0, 0, 0]));
  const partes = separarPartes(p);
  assert.equal(partes.length, 1);
  assert.equal(partes[0], p);
  assert.equal(dividirMalha(p, { size: [1, 1, 1], pos: [0, 0, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] }), null);
  assert.equal(separarPartes(new Float32Array(0)).length, 1, 'vazia');
});

test('cada parte fica no mesmo lugar do mundo (girado, espelhado e redimensionado)', () => {
  const p = f32(cubo([0, 0, 0], 2), cubo([10, 3, -4], 1), cubo([4, 8, 6], 3));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 2.3)).toArray();
  for (const flip of [[1, 1, 1], [-1, 1, 1], [1, -1, -1]]) {
    const o = { size: [37, 12.5, 80], pos: [12, 40, -7], quat: q, flip };
    const partes = dividirMalha(p, o);
    assert.equal(partes.length, 3);
    for (const parte of partes) {
      const esperado = mundo(parte.positions, o, caixaDe(p)); // a parte desenhada pelo objeto original
      // o objeto novo, com as medidas e o centro arredondados como o editor grava (r3)
      const r3 = (v) => Math.round(v * 1000) / 1000;
      const novo = { ...o, size: parte.size.map(r3), pos: parte.pos.map(r3) };
      const real = mundo(parte.positions, novo);
      for (const k of ['min', 'max']) {
        for (const ax of ['x', 'y', 'z']) assert.ok(Math.abs(real[k][ax] - esperado[k][ax]) < 0.005, `${flip} ${k}.${ax}: ${real[k][ax]} x ${esperado[k][ax]}`);
      }
    }
    // a soma das partes é o original
    const tudo = mundo(p, o);
    const uniao = new THREE.Box3();
    for (const parte of partes) uniao.union(mundo(parte.positions, { ...o, size: parte.size, pos: parte.pos }));
    assert.ok(uniao.min.distanceTo(tudo.min) < 1e-3 && uniao.max.distanceTo(tudo.max) < 1e-3);
  }
});

test('parte plana num eixo não ganha medida 0', () => {
  const p = f32([0, 0, 0, 1, 0, 0, 0, 1, 0], cubo([3, 3, 3]));
  const partes = dividirMalha(p, { size: [4, 4, 4], pos: [0, 0, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] });
  assert.equal(partes.length, 2);
  assert.ok(partes[0].size.every((v) => v > 0));
  assert.ok(partes.every((x) => x.pos.every(Number.isFinite)));
});

test('300 mil triângulos em 2 partes: tempo', () => {
  const n = 274; // 2 × 274² ≈ 150 mil triângulos por grade
  const p = f32(grade(n, 0), grade(n, 5, 0));
  const nt = p.length / 9;
  assert.ok(nt >= 300000, `${nt} triângulos`);
  const o = { size: [n, n, 5], pos: [0, 2.5, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] };
  const t0 = performance.now();
  const partes = dividirMalha(p, o);
  const ms = performance.now() - t0;
  console.log(`separar ${nt} triângulos: ${ms.toFixed(0)} ms, ${partes.length} partes`);
  assert.equal(partes.length, 2);
  assert.equal(partes[0].positions.length + partes[1].positions.length, p.length);
  assert.ok(ms < 3000, `${ms} ms`);
});

// Sujeira típica de STL: um triângulo solto muito longe do modelo. A tolerância não pode crescer
// com ele (diagonal/65536 a 1e6 mm daria 15 mm e juntaria partes) nem o custo virar quadrático.
const soltoEm = (x) => [x, 0, 0, x, 1, 0, x, 0, 1]; // triângulo de arestas 1 em x (float32 válido)
const medir = (nome, p) => {
  const t0 = performance.now();
  const partes = separarPartes(p);
  const ms = performance.now() - t0;
  console.log(`${nome}: ${p.length / 9} triângulos, ${partes.length} partes, ${ms.toFixed(0)} ms`);
  return { partes, ms };
};

test('300 mil triângulos + 1 triângulo solto a 1e6, 3e38 e -3e38: peça + solto, < 3 s', () => {
  const chapa = grade(388); // 301.088 triângulos, uma peça
  for (const x of [1e6, 3e38, -3e38]) {
    const p = f32(chapa, soltoEm(x));
    const { partes, ms } = medir(`chapa + solto em ${x}`, p);
    assert.equal(partes.length, 2, `solto em ${x}`);
    assert.equal(partes[0].length, chapa.length);
    assert.equal(partes[1][0], Math.fround(x));
    assert.ok(ms < 3000, `${ms} ms`);
  }
});

test('o solto distante não junta partes próximas: duas chapas a 0,05 mm + solto em 1e6 = 3 partes', () => {
  const n = 274;
  const p = f32(grade(n), grade(n, 0, n + 0.05), soltoEm(1e6));
  assert.ok(gradeDeSolda(p).tol <= 1e-3, `tol ${gradeDeSolda(p).tol}`);
  const { partes, ms } = medir('duas chapas a 0,05 + solto', p);
  assert.equal(partes.length, 3);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('20 mil triângulos isolados + 1 em 1e7: 20.001 partes, rápido', () => {
  const tri = [];
  for (let i = 0; i < 20000; i++) tri.push(...soltoEm((i % 200) * 2).map((v, k) => (k % 3 === 2 ? v + Math.floor(i / 200) * 2 : v)));
  const p = f32(tri, soltoEm(1e7));
  const { partes, ms } = medir('20 mil isolados + 1 em 1e7', p);
  assert.equal(partes.length, 20001);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('célula lotada (sujeira: milhares de vértices distintos num ponto) não fica quadrática e ainda solda', () => {
  // 30 mil triângulos normais (aresta 1, isolados) e 20 mil triângulos de sujeira com 60 mil
  // vértices distintos num cubo de 1e-4 (< tolerância ≈ 6e-4): a célula lota, mas cada ponto ainda
  // busca nas 8 células, então a sujeira toda vira uma parte só.
  const tri = [];
  for (let i = 0; i < 30000; i++) tri.push(...soltoEm((i % 200) * 2).map((v, k) => (k % 3 === 2 ? v + Math.floor(i / 200) * 2 : v)));
  for (let i = 0; i < 60000; i++) tri.push(-10 + (i % 40) * 2.5e-6, -10 + (Math.floor(i / 40) % 40) * 2.5e-6, -10 + Math.floor(i / 1600) * 2.5e-6);
  const p = f32(tri);
  assert.ok(gradeDeSolda(p).tol > 2e-4, `tol ${gradeDeSolda(p).tol}`);
  const { partes, ms } = medir('célula lotada', p);
  assert.equal(partes.length, 30001);
  assert.ok(ms < 3000, `${ms} ms`);
});

// Casos da revisão final: malha grossa + solto distante, ruído de float32 longe da origem e
// detalhe fino que lota a célula.
// Os 3 vértices do solto são 4% dos 75 da malha: fora dos quartis, a tolerância fica ≈ 3,5e-4.
test('cubos de 100 mm (12 triângulos) a 0,05 mm + solto em 5e5 = 3 partes', () => {
  const p = f32(cubo([0, 0, 0], 100), cubo([100.05, 0, 0], 100), soltoEm(5e5));
  assert.ok(gradeDeSolda(p).tol < 1e-3, `tol ${gradeDeSolda(p).tol}`);
  const { partes, ms } = medir('cubos 100 a 0,05 + solto em 5e5', p);
  assert.equal(partes.length, 3, `tol ${gradeDeSolda(p).tol}`);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('placas 200×200×5 a 0,1 mm + solto em 1e4 = 3 partes', () => {
  const p = f32(caixa([0, 0, 0], [200, 200, 5]), caixa([200.1, 0, 0], [200, 200, 5]), soltoEm(1e4));
  const { partes, ms } = medir('placas a 0,1 + solto em 1e4', p);
  assert.equal(partes.length, 3, `tol ${gradeDeSolda(p).tol}`);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('esfera densa (358.800 triângulos) em (1000, 1000, 1000) com +1 passo do float32 em metade das coordenadas = 1 parte', () => {
  const g = new THREE.SphereGeometry(5, 600, 300).toNonIndexed();
  g.translate(1000, 1000, 1000);
  const p = new Float32Array(g.attributes.position.array);
  assert.equal(p.length / 9, 358800);
  assert.equal(separarPartes(p).length, 1, 'limpa');
  // metade das coordenadas (sorteio fixo) anda 1 passo do float32: o mesmo vértice muda em uns
  // triângulos e não em outros
  const bits = new Int32Array(p.buffer);
  let s = 1;
  for (let i = 0; i < bits.length; i++) if ((s = (s * 16807) % 2147483647) & 1) bits[i]++;
  const { partes, ms } = medir('esfera em 1000 com ruído de 1 ulp', p);
  assert.equal(partes.length, 1, `tol ${gradeDeSolda(p).tol}`);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('detalhe fino que lota a célula, com ruído abaixo da tolerância, não se parte', () => {
  // chapa 100×100 (20 mil triângulos) + leque de 300 triângulos colado no canto (100, 100, 0),
  // raio 0,25 tol, cada vértice com ruído próprio de até ±0,04 tol: 900 pontos distintos em 1 a 8
  // células (CHEIA = 64), todos a menos de tol uns dos outros.
  const chapa = grade(100);
  const { tol } = gradeDeSolda(f32(chapa));
  let s = 1;
  const ruido = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.08 * tol;
  const ponto = (a) => (a === null ? [100, 100, 0] : [100 + 0.25 * tol * Math.cos(a), 100, 0.25 * tol * Math.sin(a)]).map((v) => v + ruido());
  const leque = [];
  for (let i = 0; i < 300; i++) leque.push(...ponto(null), ...ponto((i / 300) * 2 * Math.PI), ...ponto(((i + 1) / 300) * 2 * Math.PI));
  const p = f32(chapa, leque);
  assert.ok(gradeDeSolda(p).tol > 0.95 * tol, 'o leque não muda a tolerância');
  const { partes, ms } = medir('detalhe fino com célula cheia', p);
  assert.equal(partes.length, 1);
  assert.ok(ms < 3000, `${ms} ms`);
});

test('triângulo com coordenada NaN/Infinity é ignorado sem lançar', () => {
  const nan = [NaN, 0, 0, 1, 0, 0, 0, 1, 0];
  const inf = [5, 5, 5, Infinity, 5, 5, 5, 6, 5];
  const p = f32(cubo([0, 0, 0]), nan, cubo([3, 0, 0]), inf, [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]);
  const partes = dividirMalha(p, { size: [4, 1, 1], pos: [0, 0, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] });
  assert.equal(partes.length, 2);
  for (const parte of partes) {
    assert.equal(parte.positions.length, 12 * 9);
    assert.ok(parte.positions.every(Number.isFinite));
    assert.ok([...parte.size, ...parte.pos].every(Number.isFinite));
  }
  // uma parte válida + lixo: nada a separar, sem erro
  assert.equal(dividirMalha(f32(cubo([0, 0, 0]), nan), { size: [1, 1, 1], pos: [0, 0, 0], quat: [0, 0, 0, 1], flip: [1, 1, 1] }), null);
  assert.equal(separarPartes(f32(nan, nan)).length, 1, 'só lixo');
});
