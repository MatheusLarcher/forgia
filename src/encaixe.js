import * as THREE from 'three';
import { objectMatrix } from './csg.js';
import { groupFrame, snapshotChain, renormalize, dataWorldBox } from './ponte-comandos.js';

// Criar encaixe: o negativo da peça, para imprimir um soquete/suporte onde ela entra.
// Resultado = grupo editável { bloco sólido aberto em cima + cópia da peça como furo, com folga }.
//
// Folga "por forma" (decisão amb-encaixe-folga): as formas do Forgia são unitárias esticadas pelo
// size, então a folga f vira medida e parâmetro da cópia:
//  - exata: caixa (e raio do arredondamento + f), cilindro e polígono (face do prisma afastada f:
//    conta pelo apótema, não pelo canto), esfera, cunha e telhado (o triângulo cresce em volta do
//    incentro: cada lado se afasta f), cone (a lateral se afasta f na perpendicular: raio da base,
//    do topo e altura recalculados), pirâmide (ápice sobe f/sen β), tubo (a parede cresce 2f, o
//    furo de dentro encolhe f) e toroide (anel e espessura + 2f, o furo do meio encolhe);
//  - em grupo: sólidos crescem e furos encolhem (f negativo), e o grupo é recentrado como nos
//    comandos da IA (renormalize);
//  - aproximada (aviso): as demais formas (curvas não circulares, contornos, texto) e malhas
//    importadas crescem 2f em cada eixo (escala por eixo); cone/pirâmide com base não circular
//    ou quadrada, e peças dentro de grupo esticado de forma desigual.
// O bloco é alinhado à mesa: a caixa da peça + margem nos lados e embaixo, com o topo rente ao
// topo da peça (−0,01 mm), então a cópia com folga sempre atravessa o topo: fica aberto em cima.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r3 = (v) => Math.round(v * 1000) / 1000 || 0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
const MIN = 0.1;

export const FOLGA_PADRAO = 0.25;
export const MARGEM_PADRAO = 3;
export const FOLGA_MAX = 1;

// largura em x e z de um polígono regular de raio 1 como o lathe do shapes.js (início em π/n)
function latheExtent(n) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const a = Math.PI / n + (2 * Math.PI * k) / n;
    minX = Math.min(minX, Math.sin(a));
    maxX = Math.max(maxX, Math.sin(a));
    minZ = Math.min(minZ, Math.cos(a));
    maxZ = Math.max(maxZ, Math.cos(a));
  }
  return [maxX - minX, maxZ - minZ];
}

// novo tamanho de um prisma/lathe de n lados para as faces laterais se afastarem f (pelo apótema)
function latheGrow(size, n, fx, fz) {
  const sides = Math.max(3, Math.round(n));
  const [ex, ez] = latheExtent(sides);
  const c = Math.cos(Math.PI / sides);
  const ax = (size[0] / ex) * c; // apótema em x (mm)
  const az = (size[2] / ez) * c;
  return [size[0] * (ax + fx) / ax, size[2] * (az + fz) / az];
}

// mm do mundo por unidade local, em cada eixo do objeto, dentro do quadro frame
function axisFactors(o, frame) {
  const lin = new THREE.Matrix3().setFromMatrix4(frame);
  const q = new THREE.Quaternion().fromArray(o.quat);
  return [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)].map((e) => e.applyQuaternion(q).applyMatrix3(lin).length() || 1);
}

// desloca o centro no quadro local do objeto (respeitando giro e espelhamento)
function shiftLocal(o, local) {
  const f = o.flip || [1, 1, 1];
  const d = V3(local[0] * f[0], local[1] * f[1], local[2] * f[2]).applyQuaternion(new THREE.Quaternion().fromArray(o.quat));
  o.pos = [r3(o.pos[0] + d.x), r3(o.pos[1] + d.y), r3(o.pos[2] + d.z)];
}

// aplica a folga f (mm do mundo; negativo encolhe) num objeto solto (cópia). fac = mm por unidade
// local em cada eixo. Devolve true se a folga é exata.
export function growShape(o, f, fac = [1, 1, 1]) {
  const [fx, fy, fz] = fac.map((k) => f / k);
  const uniform = Math.abs(fac[0] - fac[1]) < 1e-6 && Math.abs(fac[1] - fac[2]) < 1e-6;
  const s = o.size;
  const p = o.params || {};
  let exact = true;
  switch (o.type) {
    case 'box':
      o.size = [s[0] + 2 * fx, s[1] + 2 * fy, s[2] + 2 * fz];
      if (p.radius > 0) {
        // canto arredondado = arco em facetas: raio + f e o máximo de passos (facetas menores; a
        // folga no canto fica em ≥ 98,5% de f, conferido em tests/encaixe.test.mjs)
        p.radius = r3(Math.max(0, p.radius + fx));
        p.steps = 20;
      }
      break;
    case 'cylinder':
    case 'polygon': {
      const [w, d] = latheGrow(s, p.sides || 20, fx, fz);
      o.size = [w, s[1] + 2 * fy, d];
      if (o.type === 'cylinder' && p.bevel > 0) p.bevel = r3(Math.max(0, p.bevel + fx));
      break;
    }
    case 'tube': {
      const [w, d] = latheGrow(s, p.sides || 24, fx, fz);
      // raio de dentro (mm, em x) = w/2 − parede: encolhe fx; parede nova = w'/2 − (raio − fx)
      const inner = s[0] / 2 - p.wall;
      p.wall = r3(Math.max(0.1, w / 2 - (inner - fx)));
      o.size = [w, s[1] + 2 * fy, d];
      break;
    }
    case 'sphere': {
      const c = Math.cos(Math.PI / Math.max(4, p.steps || 24));
      o.size = [s[0] + (2 * fx) / c, s[1] + (2 * fy) / c, s[2] + (2 * fz) / c];
      break;
    }
    case 'torus':
      o.size = [s[0] + 2 * fx, s[1] + 2 * fy, s[2] + 2 * fz];
      p.tube = r3(Math.max(0.5, p.tube + 2 * fx));
      break;
    case 'wedge': {
      // triângulo retângulo: catetos em z (d, face vertical em −z) e y (h); extrusão em x
      const [d, h] = [s[2], s[1]];
      const rho = (d + h - Math.hypot(d, h)) / 2;
      const k = (rho + fy) / rho;
      o.size = [s[0] + 2 * fx, h * k, d * k];
      shiftLocal(o, [0, (fy * (h - 2 * rho)) / (2 * rho), (fy * (d - 2 * rho)) / (2 * rho)]);
      exact = Math.abs(fy - fz) < 1e-9;
      break;
    }
    case 'roof': {
      // triângulo isósceles: base w (x), altura h (y); extrusão em z
      const [w, h] = [s[0], s[1]];
      const rho = (w * h) / (w + 2 * Math.hypot(w / 2, h));
      const k = (rho + fy) / rho;
      o.size = [w * k, h * k, s[2] + 2 * fz];
      shiftLocal(o, [0, (fy * (h - 2 * rho)) / (2 * rho), 0]);
      exact = Math.abs(fx - fy) < 1e-9;
      break;
    }
    case 'cone': {
      // perfil: base R em y = −H/2, topo r em y = H/2; a lateral se afasta f na perpendicular
      // (1/cos(π/n) compensa as faces do polígono); base e topo se afastam f
      const H = s[1];
      const c = 1 / Math.cos(Math.PI / Math.max(3, p.sides || 20));
      const grow = (R, r) => {
        const L = Math.hypot(H, R - r);
        return [R + (fy * (R - r)) / H + (c * fx * L) / H, r - (fy * (R - r)) / H + (c * fx * L) / H];
      };
      const [Rx, rx] = grow(s[0] / 2, p.top || 0);
      const [Rz] = grow(s[2] / 2, ((p.top || 0) * s[2]) / s[0]);
      o.size = [2 * Rx, H + 2 * fy, 2 * Rz];
      p.top = r3(Math.max(0, rx));
      exact = Math.abs(s[0] - s[2]) < 1e-6 && rx >= 0;
      break;
    }
    case 'pyramid': {
      // pirâmide de base w × d (faces viradas para x e z) e ápice em y = H/2: o ápice sobe f/sen β
      const H = s[1];
      const ax = s[0] / 2;
      const az = s[2] / 2;
      const sx = ax / Math.hypot(ax, H);
      const sz = az / Math.hypot(az, H);
      const apex = H / 2 + Math.max(fx / sx, fz / sz);
      const Hn = apex + H / 2 + fy;
      o.size = [2 * (ax / H) * Hn, Hn, 2 * (az / H) * Hn];
      shiftLocal(o, [0, (apex - H / 2 - fy) / 2, 0]);
      exact = Math.abs(ax - az) < 1e-6;
      break;
    }
    default:
      // escala por eixo (malha importada, contornos, curvas não circulares)
      o.size = [s[0] + 2 * fx, s[1] + 2 * fy, s[2] + 2 * fz];
      exact = false;
  }
  if (o.size.some((v) => v < MIN)) {
    o.size = o.size.map((v) => Math.max(MIN, v));
    exact = false;
  }
  o.size = o.size.map(r3);
  return exact && uniform;
}

// grupo: sólidos crescem f, furos encolhem f (em qualquer nível); o grupo se recentra no fim
function growGroup(g, f, frame) {
  const before = snapshotChain([g]);
  const inner = groupFrame(g, frame);
  let exact = true;
  for (const c of g.children) {
    if (c.hidden) continue;
    const fc = c.hole ? -f : f;
    if (c.type === 'group') exact = growGroup(c, fc, inner) && exact;
    else exact = growShape(c, fc, axisFactors(c, inner)) && exact;
  }
  renormalize(before);
  return exact;
}

// cópia da peça (topo) com folga f: devolve { copia, exata }
export function clearanceCopy(piece, f) {
  const copia = clone(piece);
  const reId = (o) => {
    o.id = uid();
    delete o.locked;
    if (o.children) o.children.forEach(reId);
  };
  reId(copia);
  const exata = copia.type === 'group' ? growGroup(copia, f, new THREE.Matrix4()) : growShape(copia, f);
  return { copia, exata };
}

// Monta o encaixe da peça (objeto do topo) dentro de um editor.batch: bloco + cópia como furo,
// agrupados, ao lado da peça (+X, 10 mm) e apoiados na mesa. Um passo de desfazer.
// names = { grupo, bloco, copia } (textos). Devolve { grupo, exata }.
export function createFit(ed, piece, { folga = FOLGA_PADRAO, margem = MARGEM_PADRAO, names }) {
  const f = Math.min(FOLGA_MAX, Math.max(0, folga));
  const m = Math.max(0.5, margem);
  let result;
  ed.batch(() => {
    const box = dataWorldBox(piece, new THREE.Matrix4());
    const { copia, exata } = clearanceCopy(piece, f);
    copia.hole = true;
    copia.name = names.copia;
    const size = [box.max.x - box.min.x + 2 * m, box.max.y - 0.01 - (box.min.y - m), box.max.z - box.min.z + 2 * m].map(r3);
    const bloco = ed.createObject('box', { size, name: names.bloco, color: piece.type === 'group' && !piece.color ? '#8b9197' : piece.color });
    bloco.pos = [r3((box.min.x + box.max.x) / 2), r3(box.min.y - m + size[1] / 2), r3((box.min.z + box.max.z) / 2)];
    ed.objects.push(bloco, copia);
    const g = ed.group([bloco, copia], { select: false });
    g.name = names.grupo;
    // ao lado da peça, com a base do bloco na mesa
    const dx = box.max.x - box.min.x + 2 * m + 10;
    g.pos = [r3(g.pos[0] + dx), r3(g.pos[1] - (box.min.y - m)), g.pos[2]];
    result = { grupo: g, exata, folga: f, margem: m };
  });
  return result;
}
