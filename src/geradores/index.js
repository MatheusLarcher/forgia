// Registro dos geradores de forma (Hardware e Geradores da biblioteca). Cada entrada vira um tipo
// em SHAPES (src/shapes.js) e, pela ponte, no catálogo forgia_formas / forgia_criar da IA.
//
// Entrada: {
//   category  'hardware' | 'geradores' (categoria da biblioteca)
//   bridge    nome do tipo na ponte (português, sem acento), ex.: forgia_criar { tipo: 'porca' }
//   color     cor padrão (da PALETTE de shapes.js)
//   hole      true = nasce como furo (o.hole)
//   needsFont true = build(params, font) e size(params, font) recebem o `font` de shapes.js
//   params    descritores (parametros.js)
//   build(params[, font]) -> BufferGeometry em mm (malha.js: indexada, Y para cima, centrada)
//   size(params[, font])  -> [x, y, z] natural em mm (eixos internos), sem gerar a malha
// }
//
// Integração sugerida em shapes.js (o integrador decide; aqui nada é registrado):
//   import { GERADORES } from './geradores/index.js';
//   for (const [type, g] of Object.entries(GERADORES)) {
//     SHAPES[type] = {
//       label: nomes[type], color: g.color,
//       size: g.size(defaultsOf(g.params), font),
//       params: g.params.map((d) => P(d.key, d.value, d.min, d.max, d.step, d.kind === 'text' ? 'text' : 'number')),
//       build: (size, p) => finalize(normalizeTo(g.build(p, font), size), 30),
//       sizeFor: (p) => g.size(p, font),
//     };
//   }
// A geometria já vem em mm no tamanho natural: com size = sizeFor(p), normalizeTo não deforma.
// Esticar uma peça de hardware deforma a rosca; se isso não for desejado, trave a escala.
import { NUT_PARAMS, buildNut, nutSize, BOLT_PARAMS, buildBolt, boltSize, BOLT_HOLE_PARAMS, buildBoltHole, boltHoleSize, INSERT_HOLE_PARAMS, buildInsertHole, insertHoleSize } from './hardware.js';
import { GEAR_PARAMS, buildGear, gearSize } from './engrenagem.js';
import { GRID_PARAMS, buildGrid, gridSize } from './grade.js';
import { SPRING_PARAMS, buildSpring, springSize } from './mola.js';
import { HINGE_PARAMS, buildHinge, hingeSize } from './dobradica.js';
import { CURVED_TEXT_PARAMS, buildCurvedText, curvedTextSize } from './texto-curvo.js';
import { LID_BOX_PARAMS, buildLidBox, lidBoxSize } from './caixa.js';

export const GERADORES = {
  nut: { category: 'hardware', bridge: 'porca', color: '#8b9197', hole: false, params: NUT_PARAMS, build: buildNut, size: nutSize },
  bolt: { category: 'hardware', bridge: 'parafuso', color: '#8b9197', hole: false, params: BOLT_PARAMS, build: buildBolt, size: boltSize },
  boltHole: { category: 'hardware', bridge: 'furo_parafuso', color: '#8b9197', hole: true, params: BOLT_HOLE_PARAMS, build: buildBoltHole, size: boltHoleSize },
  insertHole: { category: 'hardware', bridge: 'furo_inserto', color: '#8b9197', hole: true, params: INSERT_HOLE_PARAMS, build: buildInsertHole, size: insertHoleSize },
  gear: { category: 'geradores', bridge: 'engrenagem', color: '#f38a00', hole: false, params: GEAR_PARAMS, build: buildGear, size: gearSize },
  grid: { category: 'geradores', bridge: 'grade', color: '#17a3a6', hole: false, params: GRID_PARAMS, build: buildGrid, size: gridSize },
  spring: { category: 'geradores', bridge: 'mola', color: '#8e44ad', hole: false, params: SPRING_PARAMS, build: buildSpring, size: springSize },
  hinge: { category: 'geradores', bridge: 'dobradica', color: '#1b8bd2', hole: false, params: HINGE_PARAMS, build: buildHinge, size: hingeSize },
  curvedText: { category: 'geradores', bridge: 'texto_curvo', color: '#e3302d', hole: false, needsFont: true, params: CURVED_TEXT_PARAMS, build: buildCurvedText, size: curvedTextSize },
  lidBox: { category: 'geradores', bridge: 'caixa_com_tampa', color: '#3fb34f', hole: false, params: LID_BOX_PARAMS, build: buildLidBox, size: lidBoxSize },
};

export { TEXTOS_SUGERIDOS } from './textos-sugeridos.js';
export { defaultsOf, resolveParams } from './parametros.js';
export { meshReport } from './malha.js';
export { METRIC, METRIC_SIZES, autoThreadClearance } from './rosca.js';
export { centerDistance, meshRotation } from './engrenagem.js';
