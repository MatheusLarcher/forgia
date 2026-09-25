// Contorno da forma 'desenho' (funções puras, sem three.js nem DOM).
//
// Formato de params.points (usado pela ferramenta Desenhar e pela ponte da IA na Fase C):
//   [[x, z], [x, z], ...]  em mm, no plano da mesa, nos eixos internos do Forgia
//   (x = direita, z = frente da mesa; o "Y da ponte/usuário" é −z, veja src/coords.js).
//   - Contorno fechado e simples: o último ponto liga no primeiro (não repita o primeiro no fim)
//     e nenhum lado cruza ou encosta em outro. Pelo menos 3 pontos e área maior que zero.
//   - Centrado: o centro da caixa envolvente dos pontos é (0, 0). A posição da peça na mesa fica
//     em o.pos, como em qualquer forma.
//   - Sentido anti-horário visto de cima (olhando para baixo, fundo da mesa no alto da tela).
//     Em (x, z) isso dá área com sinal negativa em signedArea(); em (x, y da ponte), positiva.
//   - Os pontos definem o desenho; as medidas finais vêm de o.size, como nas outras formas: a
//     caixa envolvente do contorno é esticada para size[0] (x) × size[2] (z), com altura size[1].
//     Por isso uma peça nova usa size = [largura dos pontos, altura, profundidade dos pontos]
//     (outlineSize).
//   - Imutável: o cache de geometria guarda uma assinatura por array (src/shapes.js, paramsKey) e
//     congela o array. Para mudar o contorno, troque o array inteiro; mexer nele no lugar dá erro.
// prepareOutline() leva um traço qualquer (aberto, repetido, horário) para esse formato ou diz
// por que ele não pode virar peça.

const EPS = 1e-6;
const r3 = (v) => Math.round(v * 1000) / 1000 || 0; // || 0 tira o −0

// área com sinal (fórmula do laço) no plano (x, z)
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

// distância do ponto p ao segmento ab
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

// Ramer–Douglas–Peucker numa cadeia aberta (mantém as pontas)
function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1;
    let dmax = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(pts[i], pts[i0], pts[i1]);
      if (d > dmax) {
        dmax = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// RDP num contorno fechado: corta no ponto mais distante do primeiro e simplifica as duas metades
export function simplifyClosed(pts, tol) {
  if (pts.length < 4 || !(tol > 0)) return pts.slice();
  let far = 0;
  let dmax = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > dmax) {
      dmax = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// suaviza um trecho aberto (média 1-2-1, pontas fixas): tira a tremida da mão antes do RDP
export function smoothOpen(pts, passes = 2) {
  let cur = pts.map((p) => [p[0], p[1]]);
  for (let k = 0; k < passes && cur.length > 2; k++) {
    const next = cur.map((p) => [p[0], p[1]]);
    for (let i = 1; i < cur.length - 1; i++) {
      next[i][0] = (cur[i - 1][0] + 2 * cur[i][0] + cur[i + 1][0]) / 4;
      next[i][1] = (cur[i - 1][1] + 2 * cur[i][1] + cur[i + 1][1]) / 4;
    }
    cur = next;
  }
  return cur;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSeg = (p, a, b, eps) =>
  Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps && Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps;

// os segmentos ab e cd se cruzam ou se tocam (inclui sobreposição colinear)
function segmentsTouch(a, b, c, d, eps) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  if (Math.abs(d1) <= eps && onSeg(a, c, d, eps)) return true;
  if (Math.abs(d2) <= eps && onSeg(b, c, d, eps)) return true;
  if (Math.abs(d3) <= eps && onSeg(c, a, b, eps)) return true;
  if (Math.abs(d4) <= eps && onSeg(d, a, b, eps)) return true;
  return false;
}

// ponto onde os segmentos ab e cd se cruzam (cruzamento próprio), ou null
function crossingPoint(a, b, c, d) {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const u = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const v = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return null;
  return [a[0] + u * rx, a[1] + u * rz];
}

// Traço à mão livre que passou do ponto de partida ao fechar: tira a sobra na emenda (só no
// primeiro e no último quinto do traço), em vez de recusar o contorno inteiro.
// 1) o fim cruzou o começo: corta no cruzamento;
// 2) o fim passou rente ao começo sem cruzar: corta no ponto do fim mais perto do começo.
export function trimSeam(pts) {
  const n = pts.length;
  if (n < 8) return pts;
  const k = Math.max(2, Math.floor(n * 0.2));
  for (let j = n - 2; j >= n - 1 - k; j--) {
    for (let i = 0; i < k && i < j - 1; i++) {
      const x = crossingPoint(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (x) return [x, ...pts.slice(i + 1, j + 1)];
    }
  }
  const d0 = (p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let best = n - 1;
  for (let j = n - 2; j >= n - 1 - k; j--) if (d0(pts[j]) < d0(pts[best])) best = j;
  return pts.slice(0, best + 1);
}

// contorno fechado que se cruza ou encosta em si mesmo (O(n²) nos pares de lados não vizinhos)
export function selfIntersects(pts) {
  const n = pts.length;
  if (n < 4) return false;
  let scale = 0;
  for (const p of pts) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  const eps = Math.max(scale, 1) * Math.max(scale, 1) * 1e-9;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // o último lado é vizinho do primeiro
      if (segmentsTouch(a, b, pts[j], pts[(j + 1) % n], eps)) return true;
    }
  }
  return false;
}

// tira pontos repetidos seguidos (inclusive o fim igual ao começo) e pontos alinhados (lado de área nula)
function clean(pts, minDist) {
  let out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > minDist) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= minDist) out.pop();
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      if (segDist(b, a, c) <= EPS) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export const MIN_AREA = 0.1; // mm²: abaixo disso o desenho não vira peça

// caixa envolvente dos pontos: [minX, minZ, maxX, maxZ]
function bounds(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return [minX, minZ, maxX, maxZ];
}

// Largura (x) e profundidade (z) da caixa do contorno, em mm (0,001). A única conta da caixa: o
// size de prepareOutline e o tamanho inicial da forma 'desenho' (src/shapes.js) saem daqui.
export function outlineSize(points) {
  const [minX, minZ, maxX, maxZ] = bounds(points);
  return [r3(maxX - minX), r3(maxZ - minZ)];
}

// Traço do usuário (ou pontos da IA) → contorno no formato de params.points.
// tolerance: tolerância do RDP em mm (0 = só limpa). Devolve
//   { ok: true, points, center: [cx, cz], size: outlineSize(points) }  ou
//   { ok: false, reason: 'poucos' | 'area' | 'cruzado' }
// center é onde o centro da caixa envolvente estava antes de centrar (vira o.pos na mesa).
export function prepareOutline(input, { tolerance = 0 } = {}) {
  const raw = (Array.isArray(input) ? input : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  let pts = clean(raw.map((p) => [p[0], p[1]]), 1e-3);
  if (tolerance > 0) pts = clean(simplifyClosed(pts, tolerance), 1e-3);
  if (pts.length < 3) return { ok: false, reason: 'poucos' };
  const [minX, minZ, maxX, maxZ] = bounds(pts);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  pts = clean(pts.map(([x, z]) => [r3(x - cx), r3(z - cz)]), 1e-3);
  if (pts.length < 3) return { ok: false, reason: 'poucos' };
  if (selfIntersects(pts)) return { ok: false, reason: 'cruzado' };
  const area = signedArea(pts);
  if (Math.abs(area) < MIN_AREA) return { ok: false, reason: 'area' };
  if (area > 0) pts.reverse(); // anti-horário visto de cima = área negativa em (x, z)
  return { ok: true, points: pts, center: [r3(cx), r3(cz)], size: outlineSize(pts) };
}
