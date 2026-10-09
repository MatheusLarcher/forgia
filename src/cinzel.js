import * as THREE from 'three';
import { t } from './textos/index.js';
import { theme } from './theme.js';
import { recortar } from './csg.js';
import { shapeGeometry, defaultParams, registerMesh, releaseMesh, getMesh, SHAPES } from './shapes.js';
import { ensureBVH } from './surface.js';

// Ferramenta Cinzel (tecla E): apaga parte da peça. Uma ponteira translúcida segue a superfície
// sob o mouse; o clique apaga aquele volume e arrastar apaga ao longo do caminho, como borracha.
// - Cada traço é "assado" na peça: a geometria atual dela (no mundo) menos os carimbos do traço
//   (um por vez, csg.js) vira uma malha nova (type 'mesh', registerMesh) com o mesmo id, nome, cor e lugar. A
//   booleana só pega os triângulos perto do traço (csg.js, recortar): o custo não cresce com os
//   traços anteriores e reabrir não refaz nada. A peça perde os parâmetros (primitiva/grupo vira
//   malha); um traço = um passo de desfazer.
// - Durante o arraste os carimbos só aparecem (sem booleana); ao soltar, o traço é aplicado.
//   Carimbos a cada 0,5 × ø pelo caminho, no máximo MAX_STAMPS por traço.
// - Formatos: esfera (1), cubo (2) e furo passante (3, cilindro na direção da normal, atravessa a
//   peça). Roda do mouse (no canvas) ou [ e ] mudam o diâmetro (0,5 a 200 mm); Ctrl+roda dá zoom.
// - Só peças sólidas visíveis e livres: furos não barram o raio; peça travada barra (não apaga a de trás).
// - Memória: as malhas criadas pelo Cinzel saem da memória quando nenhum passo do histórico, objeto
//   ou a área de transferência usa mais (traço desfeito e sobrescrito); acima de MAX_BYTES, os passos
//   de desfazer mais antigos saem do histórico. O .forgia e a cópia de segurança só levam as em uso.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

export const FORMATOS = ['esfera', 'cubo', 'passante'];
export const MIN_D = 0.5;
export const MAX_D = 200;
export const MAX_STAMPS = 30; // por traço; tempos medidos em peça importada de 100 mil triângulos na tarefa
export const PASSO = 0.5; // espaçamento dos carimbos, em diâmetros
export const MAX_BYTES = 256 * 1024 * 1024; // malhas do Cinzel guardadas para desfazer

// ---------------- parte pura (tests/cinzel.test.mjs) ----------------

// diâmetro seguinte: ~10% por passo da roda (dir +1 ou −1), em décimos de mm, entre MIN_D e MAX_D
export function ajustarDiametro(d, dir) {
  let n = Math.round(d * (dir > 0 ? 1.1 : 1 / 1.1) * 10) / 10;
  if (n === d) n = Math.round((d + (dir > 0 ? 0.1 : -0.1)) * 10) / 10;
  return Math.min(MAX_D, Math.max(MIN_D, n));
}

export function novoTraco(step, max = MAX_STAMPS) {
  return { step, max, last: null, rest: 0, stamps: [] };
}

const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function nlerp(a, b, k) {
  const v = lerp(a, b, k);
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? v.map((c) => c / l) : [...b];
}

// mais uma amostra do mouse na superfície (p, n: [x, y, z]): carimbos a cada `step` medidos pelo
// caminho, interpolados entre amostras (mouse rápido não deixa buraco). Devolve quantos entraram.
export function estenderTraco(tr, p, n) {
  const before = tr.stamps.length;
  if (tr.stamps.length >= tr.max) return 0;
  if (!tr.last) {
    // começo do traço, ou volta à peça depois de sair dela: carimbo no próprio ponto
    tr.stamps.push({ p: [...p], n: [...n] });
    tr.last = { p: [...p], n: [...n] };
    tr.rest = 0;
    return 1;
  }
  const a = tr.last.p;
  const L = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  let s = tr.step - tr.rest; // distância até o próximo carimbo
  while (s <= L + 1e-9 && tr.stamps.length < tr.max) {
    const k = L > 0 ? s / L : 1;
    tr.stamps.push({ p: lerp(a, p, k), n: nlerp(tr.last.n, n, k) });
    s += tr.step;
  }
  tr.rest = L - (s - tr.step); // percorrido desde o último carimbo
  tr.last = { p: [...p], n: [...n] };
  return tr.stamps.length - before;
}

// o mouse saiu da peça: a volta começa um trecho novo (sem carimbos pelo ar entre os dois pontos)
export function quebrarTraco(tr) {
  tr.last = null;
}

// giro que leva o eixo Y da forma para a normal n
const quatFor = (n) => new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(...n).normalize());

// Passante: trecho da reta p + t·n dentro da caixa da peça (box, mundo), com 1 mm de folga em cada
// ponta: { c (centro), len }. Cilindro além da peça custa caro na booleana (triângulos compridos
// cruzam a BVH inteira): numa bola importada de 60 mm, o mesmo rasgo levou 15,5 s com 210 mm de
// comprimento e 2,3 s com 70 mm.
export function passanteEm(box, p, n) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(n[k]) < 1e-9) continue; // reta paralela à faixa: o ponto já está nela
    let a = (box.min[k] - 1 - p[k]) / n[k];
    let b = (box.max[k] + 1 - p[k]) / n[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (!(t1 > t0)) [t0, t1] = [-1, 1];
  return { c: p.clone().addScaledVector(n, (t0 + t1) / 2), len: t1 - t0 };
}

// Posições no mundo (triângulos soltos) -> malha no quadro de uma peça com o giro quat [x, y, z, w]:
// { positions (centradas), size, pos }. SHAPES.mesh centra a caixa e escala por size / caixa
// (= 1 aqui), então o objeto { pos, quat, size, flip [1, 1, 1] } desenha os mesmos pontos no mundo.
// O espelhamento da peça já está nas posições (a matriz do mundo o aplicou).
export function malhaNoLugar(world, quat) {
  const q = new THREE.Quaternion().fromArray(quat);
  const qi = q.clone().invert();
  const n = world.length / 3;
  const loc = new Float64Array(world.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = V3();
  for (let i = 0; i < n; i++) {
    v.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]).applyQuaternion(qi);
    for (let k = 0; k < 3; k++) {
      const c = v.getComponent(k);
      loc[i * 3 + k] = c;
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const positions = new Float32Array(world.length);
  for (let i = 0; i < loc.length; i++) positions[i] = loc[i] - c[i % 3];
  // caixa das posições já em float32: size é exatamente a caixa que SHAPES.mesh mede (escala 1,
  // sem encolher/crescer um fio a cada traço) e pos leva o centro dela
  const fmin = [Infinity, Infinity, Infinity];
  const fmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    if (positions[i] < fmin[k]) fmin[k] = positions[i];
    if (positions[i] > fmax[k]) fmax[k] = positions[i];
  }
  const pos = V3(...[0, 1, 2].map((k) => c[k] + (fmin[k] + fmax[k]) / 2)).applyQuaternion(q);
  return {
    positions,
    // peça plana num eixo: 0,001 evita medida zero
    size: [0, 1, 2].map((k) => Math.max(fmax[k] - fmin[k], 0.001)),
    pos: pos.toArray(),
  };
}

// refs de malha citadas nos textos JSON (snapshots do histórico, objetos, área de transferência)
export function refsEmUso(textos) {
  const out = new Set();
  for (const s of textos) for (const m of s.matchAll(/"ref":"([^"]+)"/g)) out.add(m[1]);
  return out;
}

// ---------------- cortes a partir dos carimbos ----------------

const TIPO = { esfera: 'sphere', cubo: 'box' };
const VOLTA = Math.PI * 2;

// número "ao acaso" em [0, 1) que só depende do ponto p e da semente s: o mesmo traço dá sempre o
// mesmo corte (testes e refazer iguais)
function acaso(p, s) {
  const x = Math.sin(p[0] * (12.9898 + s) + p[1] * (78.233 + 2 * s) + p[2] * (37.719 + 3 * s) + s) * 43758.5453;
  return x - Math.floor(x);
}

// Giro de cada carimbo além da direção dele. Carimbos com facetas paralelas, do mesmo traço ou de um
// anterior, dão faces quase coplanares que o three-bvh-csg não parte direito (triângulo faltando =
// furinho; cubos alinhados em traços vizinhos: 2.369 arestas abertas em 10 traços). Então: esfera
// girada ao acaso (não muda a forma); cubo levemente inclinado (o fundo de cubos de traços vizinhos
// deixa de ser coplanar). A inclinação é dada pelo quanto o canto anda, não por um ângulo fixo: um
// ângulo fixo desloca proporcionalmente ao ø (1° = 0,45 mm de canto num cubo de ø 20).
// Deslocamento de qualquer canto/borda: giro <= DESLOC_GIRO + tamanho <= 2 × DESLOC_TAMANHO <= 0,03 mm.
const DESLOC_GIRO = 0.02; // mm, canto do cubo pelo giro (entre 1/3 e 1 disso, ao acaso)
const DESLOC_TAMANHO = 0.004; // mm, por degrau da variação de tamanho entre carimbos vizinhos

// raio da forma (centro -> ponto mais longe) para a medida d: cubo = meia diagonal, esfera = d/2
const raioDe = (formato, d) => (formato === 'cubo' ? (d * Math.sqrt(3)) / 2 : d / 2);

function giroExtra(formato, p, d) {
  if (formato === 'esfera') return new THREE.Quaternion().setFromEuler(new THREE.Euler(acaso(p, 1) * VOLTA, acaso(p, 2) * VOLTA, acaso(p, 3) * VOLTA));
  const eixo = V3(acaso(p, 5) - 0.5, acaso(p, 6) - 0.5, acaso(p, 7) - 0.5);
  if (eixo.lengthSq() < 1e-6) eixo.set(1, 0, 0);
  // canto a R do centro girado de θ anda 2·R·sen(θ/2); ø pequeno: no máximo os 0,5° a 1,5° de antes
  const a = 0.5 + acaso(p, 8);
  const desloc = (DESLOC_GIRO * a) / 1.5;
  const ang = Math.min((a * Math.PI) / 180, 2 * Math.asin(Math.min(1, desloc / (2 * raioDe(formato, d)))));
  return new THREE.Quaternion().setFromAxisAngle(eixo.normalize(), ang);
}

// fator de tamanho do i-ésimo carimbo de um traço com n carimbos: vizinhos de tamanhos um pouco
// diferentes (sem faces coplanares na booleana); a borda anda no máximo 2 × DESLOC_TAMANHO
export function fatorTamanho(formato, d, i, n) {
  if (n <= 1) return 1;
  return 1 + (i % 3) * Math.min(0.003, DESLOC_TAMANHO / raioDe(formato, d));
}

// Passante: UM prisma reto na direção n0 (normal do começo do traço), de ponta a ponta da caixa da
// peça (+1 mm), cuja seção é o contorno da união dos círculos de ø d dos carimbos. Cilindros quase
// iguais unidos no three-bvh-csg saíam abertos (a peça vazava) e subtraídos um a um levavam
// segundos (cada um reparte as paredes compridas dos anteriores).
// - Contorno por marching squares sobre a distância aos círculos (grade de d/16): segmentos com o
//   lado de dentro à esquerda; cada ponto de aresta da grade sai da mesma conta nas duas células
//   vizinhas, então as paredes fecham entre si sem costura.
// - Sem tampas: ficam fora da peça. O "dentro" do prisma (dentro(x, y, z), mundo) é decidido pelo
//   mesmo contorno, então concorda exatamente com as paredes.
// { geo (paredes no mundo, triângulos soltos), m (identidade), dentro }
export function prismaDoPassante(stamps, d, box) {
  const q = quatFor(stamps[0].n);
  const qi = q.clone().invert();
  const r = d / 2;
  const h = d / 16;
  // centros no quadro do prisma (eixo Y = n0): seção no plano (x, z)
  const cs = stamps.map((s) => V3(...s.p).applyQuaternion(qi));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const y = V3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyQuaternion(qi).y;
    y0 = Math.min(y0, y - 1);
    y1 = Math.max(y1, y + 1);
  }
  const u0 = Math.min(...cs.map((c) => c.x)) - r - 2 * h;
  const v0 = Math.min(...cs.map((c) => c.z)) - r - 2 * h;
  const nu = Math.ceil((Math.max(...cs.map((c) => c.x)) + r + 2 * h - u0) / h);
  const nv = Math.ceil((Math.max(...cs.map((c) => c.z)) + r + 2 * h - v0) / h);
  // distância com sinal à união dos círculos, nos nós da grade (negativa = dentro)
  const W = nu + 1;
  const f = new Float64Array(W * (nv + 1));
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = u0 + i * h;
      const v = v0 + j * h;
      let m = Infinity;
      for (const c of cs) m = Math.min(m, Math.hypot(u - c.x, v - c.z) - r);
      f[j * W + i] = m;
    }
  }
  const F = (i, j) => f[j * W + i];
  // ponto onde a aresta da grade de (i, j) para (i + 1, j) (h) ou (i, j + 1) (v) cruza o contorno
  const ponto = (tipo, i, j) => {
    const a = F(i, j);
    const b = tipo === 'h' ? F(i + 1, j) : F(i, j + 1);
    const t = a / (a - b);
    return tipo === 'h' ? [u0 + (i + t) * h, v0 + j * h] : [u0 + i * h, v0 + (j + t) * h];
  };
  // segmentos da célula (i, j) e se ela está toda dentro: cantos e arestas no sentido anti-horário;
  // cada trecho de dentro vai de uma entrada a uma saída, e o segmento fecha da saída para a entrada
  const celula = (i, j) => {
    const cantos = [F(i, j), F(i + 1, j), F(i + 1, j + 1), F(i, j + 1)];
    const arestas = [['h', i, j], ['v', i + 1, j], ['h', i, j + 1], ['v', i, j]];
    const cruza = [];
    for (let e = 0; e < 4; e++) {
      const a = cantos[e] < 0;
      const b = cantos[(e + 1) % 4] < 0;
      if (a === b) continue;
      // nas arestas de cima e da esquerda o sentido anti-horário anda contra a grade: o ponto é o
      // mesmo da célula vizinha (mesma conta), só a entrada/saída se inverte
      cruza.push({ p: ponto(...arestas[e]), entra: b });
    }
    const segs = [];
    if (cruza.length === 2) {
      const [x, y] = cruza[0].entra ? [cruza[1], cruza[0]] : [cruza[0], cruza[1]];
      segs.push([x.p, y.p]);
    } else if (cruza.length === 4) {
      // sela: o centro decide se os dois trechos de dentro se ligam
      const ligado = (cantos[0] + cantos[1] + cantos[2] + cantos[3]) / 4 < 0;
      for (let k = 0; k < 4; k++) {
        if (cruza[k].entra) continue;
        const proxEntrada = cruza[(k + 1) % 4];
        const suaEntrada = cruza[(k + 3) % 4];
        segs.push([cruza[k].p, (ligado ? proxEntrada : suaEntrada).p]);
      }
      segs.ligado = ligado;
    }
    segs.cheia = cantos[0] < 0;
    return segs;
  };
  // segmentos -> laços fechados (o fim de um é, bit a bit, o começo do seguinte)
  const chave = (p) => p[0] + ',' + p[1];
  const porInicio = new Map();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) for (const s of celula(i, j)) porInicio.set(chave(s[0]), s);
  const lacos = [];
  for (const s0 of porInicio.values()) {
    if (s0.usado) continue;
    const laco = [];
    for (let s = s0; s && !s.usado; s = porInicio.get(chave(s[1]))) {
      s.usado = true;
      laco.push(s[0]);
    }
    // menos pontos (desvio até d/200): cada parede reparte a face da peça que atravessa, e a conta
    // cresce com o número de paredes
    const simples = simplificar(laco, d / 200);
    if (simples.length >= 3) lacos.push(simples);
  }
  const pos = [];
  const w = (u, y, v) => {
    const p = V3(u, y, v).applyQuaternion(q);
    pos.push(p.x, p.y, p.z);
  };
  // paredes em faixas de ~2 × ø ao longo do eixo (no máximo 48): triângulo comprido demais estraga
  // as árvores (BVH) do three-bvh-csg e da peça, e cada raio passa a testar quase todos. Bola de 100
  // mil triângulos, 3º passante de 16 carimbos cruzando dois rasgos: 7,9 s inteiras, 0,9 s em faixas
  const nY = Math.max(1, Math.min(48, Math.round((y1 - y0) / (2 * d))));
  const ys = Array.from({ length: nY + 1 }, (_, k) => (k === nY ? y1 : y0 + ((y1 - y0) * k) / nY));
  for (const laco of lacos) {
    for (let k = 0; k < laco.length; k++) {
      const p = laco[k];
      const q2 = laco[(k + 1) % laco.length];
      // parede do segmento p -> q2, virada para fora (direita do segmento; dentro fica à esquerda)
      for (let s = 0; s < nY; s++) {
        const a = ys[s];
        const b = ys[s + 1];
        w(p[0], a, p[1]), w(q2[0], b, q2[1]), w(q2[0], a, q2[1]);
        w(p[0], a, p[1]), w(p[0], b, p[1]), w(q2[0], b, q2[1]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const _p = V3();
  // dentro do prisma: entre as pontas e dentro dos laços (par/ímpar de cruzamentos de um raio em +x)
  const dentro = (x, y, z) => {
    _p.set(x, y, z).applyQuaternion(qi);
    if (_p.y <= y0 || _p.y >= y1) return false;
    const u = _p.x;
    const v = _p.z;
    let impar = false;
    for (const laco of lacos) {
      for (let k = 0, n = laco.length; k < n; k++) {
        const a = laco[k];
        const b = laco[(k + 1) % n];
        if (a[1] > v !== b[1] > v && u < a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) impar = !impar;
      }
    }
    return impar;
  };
  return { geo, m: new THREE.Matrix4(), dentro };
}

// Douglas-Peucker num laço fechado de pontos [u, v]: tira os que desviam menos que tol
function simplificar(laco, tol) {
  const n = laco.length;
  if (n < 8) return laco;
  // começa nos dois pontos mais distantes entre si (o primeiro e o mais longe dele)
  let far = 0;
  let best = -1;
  for (let k = 1; k < n; k++) {
    const dd = (laco[k][0] - laco[0][0]) ** 2 + (laco[k][1] - laco[0][1]) ** 2;
    if (dd > best) (best = dd), (far = k);
  }
  const fica = new Uint8Array(n);
  fica[0] = fica[far] = 1;
  const pilha = [[0, far], [far, n]];
  while (pilha.length) {
    const [i, j] = pilha.pop();
    const a = laco[i];
    const b = laco[j % n];
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const L = Math.hypot(du, dv) || 1e-12;
    let pior = 0;
    let kp = -1;
    for (let k = i + 1; k < j; k++) {
      const e = Math.abs(du * (laco[k][1] - a[1]) - dv * (laco[k][0] - a[0])) / L;
      if (e > pior) (pior = e), (kp = k);
    }
    if (pior > tol) {
      fica[kp] = 1;
      pilha.push([i, kp], [kp, j]);
    }
  }
  return laco.filter((_, k) => fica[k]);
}

// cortes de um traço no mundo: [{ geo, m (matriz), dentro? }]; box = caixa da peça (passante).
// Esfera e cubo: um corte convexo por carimbo (forma unitária + matriz); passante: um prisma só.
export function cortesDoTraco(stamps, formato, d, box) {
  if (formato === 'passante') return [prismaDoPassante(stamps, d, box)];
  const type = TIPO[formato];
  // traço com vários carimbos: esfera mais leve (eles se sobrepõem e a booleana custa por
  // triângulo; 40 carimbos de ø 4: 659 ms com 16 lados, 385 ms com 12)
  const extra = formato === 'esfera' && stamps.length > 1 ? { steps: d <= 10 ? 12 : 16 } : {};
  const geo = shapeGeometry({ type, size: [1, 1, 1], params: defaultParams(type, extra) });
  return stamps.map((s, i) => {
    const k = fatorTamanho(formato, d, i, stamps.length);
    const giro = giroExtra(formato, s.p, d * k);
    const q = formato === 'esfera' ? giro : quatFor(s.n).multiply(giro);
    return { geo, m: new THREE.Matrix4().compose(V3(...s.p), q, V3(d * k, d * k, d * k)) };
  });
}

// cor da peça: a do grupo, ou a da primeira parte sólida visível
function corDe(o) {
  if (o.color || o.type !== 'group') return o.color || SHAPES.mesh.color;
  for (const c of o.children) if (!c.hole && !c.hidden) return corDe(c);
  return SHAPES.mesh.color;
}

// Malhas criadas pelo Cinzel nesta sessão. Sem uso no histórico, nos objetos e na área de
// transferência, saem da memória; acima de MAX_BYTES, os passos de desfazer mais antigos saem.
const criadas = new Set();
let refsDoPasso = new Map(); // snapshot do histórico -> refs dele (cada passo é lido uma vez só)
export function liberarMalhas(ed, max = MAX_BYTES) {
  if (!criadas.size) return;
  // quantos textos usam cada ref: um por passo do histórico, mais os objetos e a área de transferência
  const visto = new Map();
  const porPasso = ed.history.map((s) => {
    const r = refsDoPasso.get(s) || refsEmUso([s]);
    visto.set(s, r);
    return r;
  });
  refsDoPasso = visto;
  const conta = new Map();
  for (const refs of [...porPasso, refsEmUso([JSON.stringify(ed.objects), ed.clipboard ? JSON.stringify(ed.clipboard) : ''])]) {
    for (const ref of refs) conta.set(ref, (conta.get(ref) || 0) + 1);
  }
  const tamanho = (ref) => (getMesh(ref) || { byteLength: 0 }).byteLength;
  const soltar = (ref) => {
    releaseMesh(ref);
    criadas.delete(ref);
  };
  let bytes = 0;
  for (const ref of [...criadas]) {
    if (conta.get(ref)) bytes += tamanho(ref);
    else soltar(ref);
  }
  // acima do teto: os passos de desfazer mais antigos saem (o atual e os de refazer ficam)
  let corte = 0;
  while (bytes > max && corte < ed.historyIndex) {
    for (const ref of porPasso[corte]) {
      const n = conta.get(ref) - 1;
      conta.set(ref, n);
      if (!n && criadas.has(ref)) {
        bytes -= tamanho(ref);
        soltar(ref);
      }
    }
    corte++;
  }
  if (!corte) return;
  ed.history.splice(0, corte);
  ed.historyIndex -= corte;
  queueMicrotask(() => ed.emit('history')); // botões de desfazer; fora deste 'history'
}

let avisouMalha = false;
let avisouGrande = false;

// Aplica o traço na peça do topo: a peça vira a malha recortada (um passo de desfazer).
// Devolve o objeto novo ou null (nada mudou).
export function aplicarTraco(ed, top, stamps, formato, d) {
  if (!stamps.length || !top || top.hole || top.locked || top.hidden) return null;
  const mesh = ed.meshes.get(top.id);
  if (!mesh) return null;
  mesh.updateMatrixWorld(true);
  let world;
  try {
    // a árvore do raio do mouse (já pronta: o traço começou com o mouse na peça)
    // passante: "perto" medido no quadro do rasgo (eixo Y = normal do começo do traço)
    const giro = formato === 'passante' ? quatFor(stamps[0].n) : null;
    world = recortar(mesh.geometry, mesh.matrixWorld, cortesDoTraco(stamps, formato, d, ed.worldBox(top)), ensureBVH(mesh.geometry), giro);
  } catch (err) {
    // three-bvh-csg falha em alguns triângulos degenerados: nada muda
    console.warn('Cinzel: booleana falhou', err);
    ed.emit('aviso', t.avisos.cinzelFalhou);
    return null;
  }
  if (world.length < 9) {
    ed.emit('aviso', t.avisos.cinzelTudo);
    return null;
  }
  const m = malhaNoLugar(world, top.quat);
  const { ref, saved } = registerMesh(m.positions);
  criadas.add(ref);
  const novo = { id: top.id, type: 'mesh', name: top.name, color: corDe(top), hole: false, params: { ref }, size: m.size, pos: m.pos, quat: [...top.quat], flip: [1, 1, 1] };
  const i = ed.objects.indexOf(top);
  ed.change(() => (ed.objects[i] = novo));
  if (!saved && !avisouGrande) {
    // uma vez por sessão (cada traço é uma malha nova)
    avisouGrande = true;
    ed.emit('aviso', t.avisos.modeloGrande);
  } else if (top.type !== 'mesh' && !avisouMalha) {
    // uma vez por sessão: a primitiva/grupo virou malha
    avisouMalha = true;
    ed.emit('aviso', t.avisos.cinzelMalha);
  }
  return novo;
}

// ---------------- ferramenta ----------------

export class CinzelTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'cinzel';
    this.formato = 'esfera';
    this.d = 6;
    this.trace = null; // traço em andamento: { id (peça do topo), tr }
    this.lastMs = 0; // tempo da última aplicação (booleana + sync), para medir
    // ponteira: volume que vai sair, visível mesmo dentro da peça
    this.geos = {
      esfera: new THREE.SphereGeometry(0.5, 24, 12),
      cubo: new THREE.BoxGeometry(1, 1, 1),
      passante: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
    };
    // contorno da ponteira: três círculos na esfera; arestas no cubo e no cilindro
    const ring = (axis) => {
      const pts = [];
      for (let i = 0; i < 48; i++) {
        for (const k of [i, i + 1]) {
          const a = (k / 48) * Math.PI * 2;
          const c = 0.5 * Math.cos(a);
          const s = 0.5 * Math.sin(a);
          pts.push(...(axis === 0 ? [0, c, s] : axis === 1 ? [c, 0, s] : [c, s, 0]));
        }
      }
      return pts;
    };
    const rings = new THREE.BufferGeometry();
    rings.setAttribute('position', new THREE.Float32BufferAttribute([...ring(0), ...ring(1), ...ring(2)], 3));
    this.edgeGeos = { esfera: rings, cubo: new THREE.EdgesGeometry(this.geos.cubo), passante: new THREE.EdgesGeometry(this.geos.passante) };
    // branco translúcido com o contorno na cor de destaque do tema: aparece em peça de qualquer cor
    const mat = (opacity) => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity, depthTest: false, depthWrite: false });
    this.tip = new THREE.Mesh(this.geos.esfera, mat(0.35));
    this.tipEdges = new THREE.LineSegments(rings, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    this.tipEdges.raycast = () => {};
    this.tipEdges.renderOrder = 8;
    this.tip.add(this.tipEdges);
    this.ghosts = new THREE.InstancedMesh(this.geos.esfera, mat(0.3), MAX_STAMPS);
    for (const o of [this.tip, this.ghosts]) {
      o.matrixAutoUpdate = false;
      o.visible = false;
      o.raycast = () => {};
      o.renderOrder = 7;
      o.frustumCulled = false;
      editor.scene.add(o);
    }
    theme.watch((c) => this.tipEdges.material.color.set(c.outline));
    this.label = document.createElement('div');
    this.label.className = 'cinzel-rotulo';
    this.label.style.display = 'none';
    editor.overlay.append(this.label);
    this.onWheel = (e) => this.wheel(e);
    // desfazer, abrir outro projeto, colar...: solta as malhas do Cinzel que ninguém usa mais
    editor.addEventListener('history', () => liberarMalhas(editor));
  }

  hint() {
    return t.modos.cinzel(t.cinzel.formatos[this.formato], fmt(this.d));
  }

  enter() {
    this.ed.viewport.classList.add('chiseling');
    // a roda muda o diâmetro: escuta antes do OrbitControls (captura no viewport)
    this.ed.viewport.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    const e = this.ed.lastPointerEvent;
    if (e) this.onMove(e);
  }

  exit() {
    const ed = this.ed;
    ed.viewport.classList.remove('chiseling');
    ed.viewport.removeEventListener('wheel', this.onWheel, { capture: true });
    if (ed.drag && ed.drag.kind === 'cinzel') ed.drag = null;
    this.trace = null;
    this.hover = null;
    this.tip.visible = false;
    this.ghosts.visible = false;
    this.label.style.display = 'none';
  }

  // ponto da superfície de uma peça sólida, visível e livre: { h, top } ou null. Furos não barram
  // o raio; peça travada barra (o Cinzel não apaga a peça escondida atrás dela)
  pick(e) {
    const ed = this.ed;
    const skip = new Set(ed.objects.filter((o) => o.hole).map((o) => o.id));
    const h = ed.surface.hit(e, skip);
    if (!h || h.table || !h.id) return null;
    const top = ed.obj(h.id);
    return top && !top.locked ? { h, top } : null;
  }

  // matriz da ponteira/carimbo no mundo
  stampMatrix(p, n, top, m = new THREE.Matrix4()) {
    const d = this.d;
    if (this.formato === 'esfera') return m.compose(p, new THREE.Quaternion(), V3(d, d, d));
    const nv = n.isVector3 ? n.clone().normalize() : V3(...n).normalize();
    const q = quatFor(nv.toArray());
    if (this.formato !== 'passante' || !top) return m.compose(p, q, V3(d, d, d));
    const { c, len } = passanteEm(this.ed.worldBox(top), p, nv);
    return m.compose(c, q, V3(d, len, d));
  }

  showTip() {
    const hv = this.hover;
    if (!hv) {
      this.tip.visible = false;
      this.label.style.display = 'none';
      return;
    }
    this.tip.geometry = this.geos[this.formato];
    this.tipEdges.geometry = this.edgeGeos[this.formato];
    this.stampMatrix(hv.h.point, hv.h.normal, hv.top, this.tip.matrix);
    this.tip.matrixWorldNeedsUpdate = true;
    this.tip.visible = true;
    const px = this.ed.pointer;
    this.label.textContent = t.cinzel.rotulo(t.cinzel.formatos[this.formato], fmt(this.d));
    this.label.style.display = 'block';
    // ao lado do cursor, sem passar da borda da vista
    const W = this.ed.viewport.clientWidth;
    const x = Math.max(4, Math.min(px.x + 14, W - this.label.offsetWidth - 4));
    this.label.style.transform = `translate(${x}px, ${px.y + 12}px)`;
  }

  showGhosts() {
    const tr = this.trace && this.trace.tr;
    if (!tr || !tr.stamps.length) {
      this.ghosts.visible = false;
      return;
    }
    const top = this.ed.obj(this.trace.id);
    this.ghosts.geometry = this.geos[this.formato];
    const m = new THREE.Matrix4();
    const n0 = tr.stamps[0].n; // passante: a direção do começo vale para o traço inteiro
    tr.stamps.forEach((s, i) => this.ghosts.setMatrixAt(i, this.stampMatrix(V3(...s.p), this.formato === 'passante' ? n0 : s.n, top, m)));
    this.ghosts.count = tr.stamps.length;
    this.ghosts.instanceMatrix.needsUpdate = true;
    this.ghosts.visible = true;
  }

  onDown(e) {
    if (this.trace) this.onUp(); // traço anterior sem pointerup: aplica antes de começar outro
    const p = this.pick(e);
    if (!p) return true; // fora de uma peça: nada (Esc sai)
    this.trace = { id: p.top.id, tr: novoTraco(this.d * PASSO) };
    estenderTraco(this.trace.tr, p.h.point.toArray(), p.h.normal.toArray());
    this.ed.drag = { kind: 'cinzel' }; // Ctrl+Z no meio do traço espera o fim (editor.undo)
    this.showGhosts();
    return true;
  }

  onMove(e) {
    const ed = this.ed;
    if (!ed.insideViewport(e) && !this.trace) {
      this.hover = null;
      this.showTip();
      return true;
    }
    // botão direito/meio: a vista gira ou anda
    if (e.buttons & 6) return false;
    // o botão foi solto sem o pointerup chegar (fora da janela, troca de janela): fecha o traço
    if (this.trace && !(e.buttons & 1)) return this.onUp();
    const p = this.pick(e);
    this.hover = p;
    if (this.trace) {
      // o traço fica na peça em que começou; fora dela, o caminho se interrompe
      const tr = this.trace.tr;
      if (p && p.top.id === this.trace.id) estenderTraco(tr, p.h.point.toArray(), p.h.normal.toArray());
      else quebrarTraco(tr);
      if (tr.stamps.length >= tr.max && !this.trace.avisou) {
        // traço no limite: o resto do caminho não apaga; avisa uma vez
        this.trace.avisou = true;
        ed.emit('aviso', t.avisos.cinzelLimite);
      }
      this.showGhosts();
    }
    this.showTip();
    return true;
  }

  onUp() {
    const tr = this.trace;
    if (!tr) return true;
    this.trace = null;
    if (this.ed.drag && this.ed.drag.kind === 'cinzel') this.ed.drag = null;
    this.ghosts.visible = false;
    const top = this.ed.obj(tr.id);
    const t0 = performance.now();
    aplicarTraco(this.ed, top, tr.tr.stamps, this.formato, this.d);
    this.lastMs = performance.now() - t0;
    this.lastCount = tr.tr.stamps.length;
    // a peça mudou (malha nova): a ponteira volta a seguir o que está sob o mouse
    const e = this.ed.lastPointerEvent;
    if (e) this.onMove(e);
    return true;
  }

  setSize(d) {
    this.d = Math.min(MAX_D, Math.max(MIN_D, d));
    this.showTip();
    this.ed.emit('mode'); // a dica mostra o ø
  }

  setFormato(f) {
    if (!FORMATOS.includes(f)) return;
    this.formato = f;
    this.showTip();
    this.ed.emit('mode');
  }

  // Só a roda sobre o canvas: inspetor, viewcube e botões da vista rolam/agem como sempre.
  // Durante o traço a roda é engolida (nem zoom nem ø: o traço segue com o tamanho do começo).
  wheel(e) {
    if (e.target !== this.ed.renderer.domElement) return;
    if (this.trace) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // Ctrl+roda: zoom, como sempre
    e.preventDefault();
    e.stopPropagation();
    if (!e.deltaY) return;
    this.setSize(ajustarDiametro(this.d, e.deltaY < 0 ? 1 : -1));
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const i = ['1', '2', '3'].indexOf(e.key);
    const tam = e.key === '[' || e.key === ']';
    if (!tam && i < 0) return false;
    if (this.trace) return true; // como a roda: tamanho e formato ficam fixos até soltar
    if (tam) this.setSize(ajustarDiametro(this.d, e.key === ']' ? 1 : -1));
    else this.setFormato(FORMATOS[i]);
    return true;
  }
}
