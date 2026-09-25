// Texto curvo: letras em arco, deitadas na mesa e lidas de cima (como o Texto de shapes.js), com
// a linha de base num círculo de raio "raio do arco" e o topo das letras para fora. O texto fica
// centrado no alto do arco (−Z, o fundo) e corre da esquerda para a direita (sentido horário).
//
// A fonte é recebida de fora: o integrador passa o `font` de src/shapes.js (helvetiker bold), o
// mesmo do Texto; assim este módulo não importa shapes.js (evita import circular quando SHAPES
// registrar os geradores). Contornos como no TextGeometry de shapes.js (curveSegments 6).
//
// Ângulo do arco: 0 = natural (o comprimento do texto na linha de base). Maior que o natural:
// o espaço extra vai entre as letras, que mantêm a forma. Menor: o texto todo é comprimido ao
// longo do arco. As letras são dobradas junto com o arco (os contornos são subdivididos antes),
// o que mantém letras vizinhas sem se tocar.
import { MeshBuilder, prism, onTable, cleanRing, ringArea } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('curvedText');
export const DEFAULT_TEXT = 'TEXTO';
export const CURVED_TEXT_PARAMS = [
  P('text', { value: DEFAULT_TEXT, kind: 'text', bridge: 'texto' }),
  P('arcRadius', { value: 30, min: 5, max: 500, step: 0.5, unit: 'mm', bridge: 'raio' }),
  P('angle', { value: 0, min: 0, max: 350, step: 1, unit: '°', bridge: 'angulo' }),
  P('letterSize', { value: 10, min: 2, max: 100, step: 0.5, unit: 'mm', bridge: 'altura_letras' }),
  P('relief', { value: 2, min: 0.4, max: 20, step: 0.1, unit: 'mm', bridge: 'espessura' }),
];

const CURVE_SEGMENTS = 6;
const MAX_ANGLE = (350 * Math.PI) / 180;

// contornos das letras no plano (x ao longo do texto, y para cima), uma entrada por letra
function layout(text, font, size) {
  const data = font.data;
  const scale = size / data.resolution;
  const glyphs = [];
  let x = 0;
  for (const ch of Array.from(text)) {
    const key = data.glyphs[ch] ? ch : '?';
    const g = data.glyphs[key];
    if (!g) continue;
    if (g.o) {
      const shapes = font.generateShapes(key, size).map((s) => {
        const e = s.extractPoints(CURVE_SEGMENTS);
        return { outer: e.shape.map((v) => [v.x + x, v.y]), holes: e.holes.map((h) => h.map((v) => [v.x + x, v.y])) };
      });
      glyphs.push(shapes);
    }
    x += g.ha * scale;
  }
  return glyphs;
}

function subdivide(ring, maxLen) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

// Contornos dobrados no plano da mesa (u à direita, v para o fundo, como onTable)
export function curvedTextOutline(params, font) {
  if (!font) throw new Error('texto curvo: passe a fonte (font de src/shapes.js)');
  const p = resolveParams(CURVED_TEXT_PARAMS, params);
  const text = p.text.trim() ? p.text : DEFAULT_TEXT;
  const size = p.letterSize;
  const glyphs = layout(text, font, size);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const g of glyphs) {
    for (const s of g) {
      for (const [x, y] of s.outer) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
      }
    }
  }
  if (!glyphs.length) return { p, shapes: [] };
  const width = maxX - minX;
  // raio: pelo menos a altura das letras (descendentes não cruzam o centro) e o texto em ≤ 350°
  const R = Math.max(p.arcRadius, size, -minY + 1, width / MAX_ANGLE);
  const natural = width / R;
  const target = p.angle > 0 ? Math.min((p.angle * Math.PI) / 180, MAX_ANGLE) : natural;
  const extra = target > natural && glyphs.length > 1 ? (target * R - width) / (glyphs.length - 1) : 0;
  const k = target < natural ? target / natural : 1;
  const span = width * k + extra * (glyphs.length - 1);
  const maxLen = size / 8;
  const shapes = [];
  glyphs.forEach((g, gi) => {
    for (const s of g) {
      const bend = (ring) =>
        subdivide(ring, maxLen).map(([x, y]) => {
          const t = (x - minX) * k + gi * extra - span / 2; // comprimento de arco a partir do meio
          const beta = t / R;
          const rho = R + y;
          return [rho * Math.sin(beta), rho * Math.cos(beta)];
        });
      const outer = cleanRing(bend(s.outer));
      const holes = s.holes.map((h) => cleanRing(bend(h))).filter((h) => h.length >= 3 && Math.abs(ringArea(h)) > 1e-6);
      if (outer.length >= 3 && Math.abs(ringArea(outer)) > 1e-6) shapes.push({ outer, holes });
    }
  });
  return { p, shapes, radius: R, angle: target };
}

export function curvedTextSize(params, font) {
  const o = curvedTextOutline(params, font);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const s of o.shapes) {
    for (const [u, v] of s.outer) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  if (!o.shapes.length) return [0, 0, 0];
  return [maxU - minU, o.p.relief, maxV - minV];
}

export function buildCurvedText(params, font) {
  const o = curvedTextOutline(params, font);
  const b = new MeshBuilder();
  for (const s of o.shapes) prism(b, s.outer, s.holes, 0, o.p.relief, onTable);
  return b.toGeometry();
}
