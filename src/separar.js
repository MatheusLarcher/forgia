// Separa uma malha importada (triângulos soltos, Float32Array) nas partes desconectadas.
// Sem three.js nem DOM: roda igual no editor e no node --test (tests/separar.test.mjs).
//
// Os vértices são soldados pela posição, não pelo índice (STL repete o vértice em cada triângulo):
// a mesma posição exata é sempre o mesmo ponto, e dois vértices a uma distância <= tolerância
// (gradeDeSolda) também. A busca usa uma grade de células com 2 × a tolerância (origem 0): os
// vizinhos a <= tolerância de um ponto estão, em cada eixo, na célula dele ou na do lado mais
// próximo, então bastam 8 células — e um ponto colado a uma fronteira solda com o do outro lado.
// Triângulos que dividem um vértice ou uma aresta ficam na mesma parte (union-find).
//
// Custo nunca quadrático: uma célula guarda no máximo CHEIA pontos. Um ponto novo numa célula cheia
// ainda procura vizinhos nas 8 células (até 8 × CHEIA comparações), só não entra na cadeia. Ponto
// longe demais da origem para ter índice de célula exato solda só por posição exata.
// Triângulo com coordenada não finita (NaN/Infinity) é ignorado: não entra em parte nenhuma.

const RELATIVA = 1e-6; // × diagonal interquartil × 2: ~0,2 µm numa peça de 100 mm, << folga imprimível
const ULPS = 4; // × passo do float32 numa coordenada típica: acima do ruído de arredondamento do STL
const AMOSTRA = 30000; // vértices olhados para a escala (custo fixo, independe da malha)
const CHEIA = 64; // pontos por célula da grade
const LIMITE_INDICE = 2 ** 52; // índice de célula acima disso não é inteiro exato no double (q ± 1 = q)

// passo do float32 em |v| (distância até o próximo float32)
const f1 = new Float32Array(1);
const i1 = new Int32Array(f1.buffer);
function ulp32(v) {
  f1[0] = Math.abs(v);
  const a = f1[0];
  i1[0]++;
  return f1[0] - a;
}

// percentil p (0..1) de s já ordenado
const percentil = (s, p) => s[Math.round(p * (s.length - 1))];

// Escala robusta por quartis, numa amostra de até ~30 mil vértices finitos:
//   min/max = percentis 25% e 75% por eixo; ref = percentil 75% de |coordenada| (os 3 eixos juntos).
// Sujeira (triângulo solto muito longe) com até ~25% dos vértices não a move; null se não há vértice finito.
export function caixaRobusta(positions) {
  const nv = Math.floor(positions.length / 9) * 3;
  const passo = Math.max(1, Math.ceil(nv / AMOSTRA));
  const eixos = [0, 1, 2].map(() => new Float64Array(Math.ceil(nv / passo)));
  let n = 0;
  for (let i = 0; i < nv; i += passo) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    eixos[0][n] = x;
    eixos[1][n] = y;
    eixos[2][n] = z;
    n++;
  }
  if (!n) return null;
  const min = [];
  const max = [];
  const abs = new Float64Array(3 * n);
  for (let k = 0; k < 3; k++) {
    const s = eixos[k].subarray(0, n);
    for (let i = 0; i < n; i++) abs[k * n + i] = Math.abs(s[i]);
    s.sort();
    min[k] = percentil(s, 0.25);
    max[k] = percentil(s, 0.75);
  }
  return { min, max, ref: percentil(abs.sort(), 0.75) };
}

// Tolerância de solda e lado da célula (2 × tol):
//   tol = max(diagonal da caixa interquartil × 2 × 1e-6, 4 × passo do float32 em ref)
// Diagonal interquartil × 2 ≈ tamanho da peça, sem depender de sujeira distante nem de malha grossa
// (não usa aresta); o piso em passos do float32 de uma coordenada típica solda o ruído de
// arredondamento de peça longe da origem.
export function gradeDeSolda(positions) {
  const box = caixaRobusta(positions);
  if (!box) return { tol: 0, celula: 0 };
  const diagIQR = 2 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const tol = Math.max(diagIQR * RELATIVA, ULPS * ulp32(box.ref));
  return { tol, celula: 2 * tol };
}

// caixa [min, max] de posições (x, y, z intercalados), sem os vértices não finitos; null se não houver nenhum
export function caixaDe(p) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(p[i + 1]) || !Number.isFinite(p[i + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

// Partes conexas: lista de Float32Array (triângulos soltos), na ordem do 1º triângulo de cada uma.
// Uma parte só (ou malha vazia/degenerada): devolve [positions] sem copiar.
export function separarPartes(positions) {
  const nv = Math.floor(positions.length / 9) * 3;
  const nt = nv / 3;
  const box = caixaDe(positions.subarray(0, nv * 3));
  if (!box || nt < 2) return [positions];
  const { tol, celula } = gradeDeSolda(positions);
  // sem tolerância utilizável (malha toda num ponto, coordenada infinita): só posição exata
  const comGrade = tol > 0 && tol < Infinity;
  const inv = comGrade ? 1 / celula : 0;
  const tol2 = tol * tol;
  // bits do float32 de cada coordenada, para espalhar a posição exata (-0 e 0: mesma chave)
  const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const bits = new Int32Array(f32.buffer, f32.byteOffset, nv * 3);
  const chave = (b) => (b === -2147483648 ? 0 : b);

  // union-find nos pontos únicos (posições exatas distintas)
  const pai = new Int32Array(nv);
  const raiz = (a) => {
    while (pai[a] !== a) a = pai[a] = pai[pai[a]];
    return a;
  };
  const unir = (a, b) => {
    a = raiz(a);
    b = raiz(b);
    if (a !== b) pai[a < b ? b : a] = a < b ? a : b;
  };

  let cap = 1;
  while (cap < nv * 2) cap <<= 1;
  const mask = cap - 1;
  const origem = new Int32Array(nv); // vértice (índice em positions / 3) de cada ponto único
  const vid = new Int32Array(nv); // vértice -> ponto único
  // posição exata -> ponto único (espalhamento aberto)
  const exato = new Int32Array(cap).fill(-1);
  // grade: célula -> 1º ponto dela (encadeados por prox) e quantos tem; cx/cy/cz = célula do ponto.
  // Índice de célula em double (inteiro exato até 2^52): com origem 0 e tolerância pequena, longe
  // da origem ele passa do Int32.
  const slot = new Int32Array(cap).fill(-1);
  const qtd = new Int32Array(cap);
  const prox = new Int32Array(nv);
  const cx = new Float64Array(nv);
  const cy = new Float64Array(nv);
  const cz = new Float64Array(nv);
  const mistura = (q) => (q | 0) ^ Math.imul((q / 4294967296) | 0, 0x27d4eb2d);
  // posição na tabela da célula (qx, qy, qz): a dela, ou o lugar vazio onde ela entraria
  const lugar = (qx, qy, qz) => {
    let h = (Math.imul(mistura(qx), 73856093) ^ Math.imul(mistura(qy), 19349663) ^ Math.imul(mistura(qz), 83492791)) & mask;
    for (;;) {
      const s = slot[h];
      if (s < 0 || (cx[s] === qx && cy[s] === qy && cz[s] === qz)) return h;
      h = (h + 1) & mask;
    }
  };
  let nu = 0;
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      vid[i] = -1; // ponto inválido: o triângulo dele é ignorado
      continue;
    }
    // mesma posição exata de um ponto já visto: é ele (já foi soldado com os vizinhos)
    let he = Math.imul(chave(bits[i * 3]), 0x9e3779b1) ^ Math.imul(chave(bits[i * 3 + 1]), 0x85ebca77) ^ Math.imul(chave(bits[i * 3 + 2]), 0xc2b2ae3d);
    he = (he ^ (he >>> 15)) & mask;
    let u;
    while ((u = exato[he]) >= 0) {
      const j = origem[u] * 3;
      if (positions[j] === x && positions[j + 1] === y && positions[j + 2] === z) break;
      he = (he + 1) & mask;
    }
    if (u >= 0) {
      vid[i] = u;
      continue;
    }
    u = nu++;
    pai[u] = u;
    origem[u] = i;
    vid[i] = u;
    exato[he] = u;
    if (!comGrade) continue;
    const fx = x * inv;
    const fy = y * inv;
    const fz = z * inv;
    // longe demais da origem para ter índice de célula exato (q ± 1 = q): só posição exata
    if (!(Math.abs(fx) < LIMITE_INDICE && Math.abs(fy) < LIMITE_INDICE && Math.abs(fz) < LIMITE_INDICE)) continue;
    const qx = Math.floor(fx);
    const qy = Math.floor(fy);
    const qz = Math.floor(fz);
    const h = lugar(qx, qy, qz);
    // solda com os pontos a <= tol: célula dele e as do lado mais próximo em cada eixo (8)
    const ax = fx - qx < 0.5 ? -1 : 1;
    const ay = fy - qy < 0.5 ? -1 : 1;
    const az = fz - qz < 0.5 ? -1 : 1;
    for (let n = 0; n < 8; n++) {
      const hh = n ? lugar(qx + (n & 1 ? ax : 0), qy + (n & 2 ? ay : 0), qz + (n & 4 ? az : 0)) : h;
      for (let w = slot[hh]; w >= 0; w = prox[w]) {
        const j = origem[w] * 3;
        const dx = positions[j] - x;
        const dy = positions[j + 1] - y;
        const dz = positions[j + 2] - z;
        if (dx * dx + dy * dy + dz * dz <= tol2) unir(u, w);
      }
    }
    if (qtd[h] >= CHEIA) continue; // célula cheia: já buscou, só não entra na cadeia (custo limitado)
    cx[u] = qx;
    cy[u] = qy;
    cz[u] = qz;
    prox[u] = slot[h];
    slot[h] = u;
    qtd[h]++;
  }

  // triângulo com vértice inválido: fora de todas as partes
  const valido = (t) => vid[t * 3] >= 0 && vid[t * 3 + 1] >= 0 && vid[t * 3 + 2] >= 0;
  for (let t = 0; t < nt; t++) {
    if (!valido(t)) continue;
    unir(vid[t * 3], vid[t * 3 + 1]);
    unir(vid[t * 3 + 1], vid[t * 3 + 2]);
  }

  // parte de cada triângulo, na ordem em que aparecem
  const parteDaRaiz = new Int32Array(nu).fill(-1);
  const parte = new Int32Array(nt);
  const conta = [];
  for (let t = 0; t < nt; t++) {
    if (!valido(t)) {
      parte[t] = -1;
      continue;
    }
    const r = raiz(vid[t * 3]);
    let k = parteDaRaiz[r];
    if (k < 0) {
      k = parteDaRaiz[r] = conta.length;
      conta.push(0);
    }
    parte[t] = k;
    conta[k]++;
  }
  if (conta.length <= 1) return [positions];
  const out = conta.map((n) => new Float32Array(n * 9));
  const fim = new Int32Array(conta.length);
  for (let t = 0; t < nt; t++) {
    const k = parte[t];
    if (k < 0) continue;
    out[k].set(positions.subarray(t * 9, t * 9 + 9), fim[k]);
    fim[k] += 9;
  }
  return out;
}

// gira v pelo quatérnio q = [x, y, z, w]
function girar([vx, vy, vz], [qx, qy, qz, qw]) {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

// Divide um objeto 'mesh' (o: size, pos, quat, flip) cujas posições cruas são `positions`.
// Cada parte guarda as próprias posições cruas e ganha size/pos para ficar no MESMO lugar do mundo:
// SHAPES.mesh.build centra a caixa e escala por size / caixa (normalizeTo), então a escala por eixo
// (size / caixa do todo) se mantém e o centro da parte vai para pos + R·F·(escala ⊙ (c_parte − c_todo)).
// null se a malha é uma parte só.
export function dividirMalha(positions, o) {
  const partes = separarPartes(positions);
  if (partes.length < 2) return null;
  const box = caixaDe(positions);
  const f = o.flip || [1, 1, 1];
  const esc = [0, 1, 2].map((k) => o.size[k] / (box.max[k] - box.min[k] || 1));
  const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
  return partes.map((p) => {
    const b = caixaDe(p);
    const d = [0, 1, 2].map((k) => ((b.min[k] + b.max[k]) / 2 - c[k]) * esc[k] * f[k]);
    const r = girar(d, o.quat);
    return {
      positions: p,
      // parte plana num eixo: a medida não muda a forma (a caixa dela é 0); 0,001 evita divisão por 0
      size: [0, 1, 2].map((k) => Math.max((b.max[k] - b.min[k]) * esc[k], 0.001)),
      pos: [0, 1, 2].map((k) => o.pos[k] + r[k]),
    };
  });
}
