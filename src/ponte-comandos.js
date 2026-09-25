import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { SHAPES, defaultParams, defaultSize, textWidthFor, shapeGeometry, registerMesh } from './shapes.js';
import { groupResult, aliasGroupResult, objectMatrix } from './csg.js';
import { toUser, fromUser, boxToUser } from './coords.js';
import { prepareOutline } from './outline.js';
import { parseModel, ImportError } from './importar.js';
import { GERADORES, TEXTOS_SUGERIDOS } from './geradores/index.js';
import { t } from './textos/index.js';
import { build3MF } from './exportar3mf.js';
// encaixe.js também importa daqui (quadros e renormalize): o ciclo é seguro porque os dois lados
// só usam o outro dentro de funções, nunca ao carregar o módulo
import { createFit, FOLGA_PADRAO, MARGEM_PADRAO, FOLGA_MAX } from './encaixe.js';

// Comandos da ponte da IA, no sistema do usuário (src/coords.js): mm, Z para cima, X para a direita,
// Y para o fundo, origem no centro da mesa; posição = centro do objeto; rotação em graus [X, Y, Z]
// (gira em X, depois em Y, depois em Z, nos eixos fixos da mesa); medidas [X, Y, Z] nos eixos do
// próprio objeto. Tudo que altera roda dentro de editor.batch(): um pedido = um passo de desfazer,
// e erro (ou projeto inválido no fim) devolve tudo como estava.
//
// As mensagens daqui vão para o agente (JSON da ponte), não para a tela; por isso ficam neste
// arquivo e não em src/textos. Erro = BridgeError com o que é válido e um exemplo ("erros que
// ensinam").
//
// Partes de grupo: um grupo guarda os filhos no quadro dele (centrado na caixa do resultado da
// booleana). Mexer numa parte muda a booleana; renormalize() recentra os filhos e ajusta posição
// e tamanho do grupo de modo que nada saia do lugar no mundo, descendo em grupos aninhados.

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100 || 0;
const r3 = (v) => Math.round(v * 1000) / 1000 || 0;
const MAX_MM = 10000;
const MIN_MM = 0.1;

export class BridgeError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}
const fail = (message, extra) => {
  throw new BridgeError(message, extra);
};

// ---------------- tipos e parâmetros ----------------

// tipo interno (shapes.js) -> nome na ponte
export const TYPE_NAMES = {
  box: 'caixa', cylinder: 'cilindro', sphere: 'esfera', roof: 'telhado', cone: 'cone', roundRoof: 'telhado_redondo',
  text: 'texto', wedge: 'cunha', pyramid: 'piramide', halfSphere: 'meia_esfera', polygon: 'poligono',
  paraboloid: 'paraboloide', torus: 'toroide', tube: 'tubo', star: 'estrela', heart: 'coracao',
  icosahedron: 'icosaedro', desenho: 'desenho', mesh: 'importado', group: 'grupo',
};
// Hardware e Geradores (src/geradores/): o nome na ponte vem do próprio gerador (porca, engrenagem…)
for (const [type, g] of Object.entries(GERADORES)) TYPE_NAMES[type] = g.bridge;
const CREATABLE = Object.keys(TYPE_NAMES).filter((k) => k !== 'mesh' && k !== 'group');
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const FROM_NAME = {};
for (const k of CREATABLE) {
  FROM_NAME[TYPE_NAMES[k]] = k;
  FROM_NAME[k.toLowerCase()] = k; // aceita também o nome interno (box, cylinder…)
}

// o que as medidas [X, Y, Z] significam em cada tipo
const SIZE_NOTES = {
  _: 'X largura, Y profundidade, Z altura',
  cylinder: 'X e Y = diâmetro, Z = altura',
  cone: 'X e Y = diâmetro da base, Z = altura',
  sphere: 'diâmetros em X, Y e Z',
  halfSphere: 'X e Y = diâmetro, Z = altura (a cúpula fica para cima)',
  polygon: 'X e Y = largura de canto a canto, Z = altura (prisma)',
  paraboloid: 'X e Y = diâmetro da base, Z = altura',
  torus: 'X e Y = diâmetro externo, Z = altura do anel',
  tube: 'X e Y = diâmetro externo, Z = altura',
  roof: 'X largura, Y comprimento (a cumeeira corre em Y), Z altura',
  roundRoof: 'X largura, Y comprimento, Z altura (meio cilindro deitado ao longo de Y)',
  wedge: 'X largura, Y profundidade, Z altura (rampa)',
  pyramid: 'X e Y = base, Z = altura',
  text: 'X comprimento (automático pelo texto se omitido ou null), Y altura das letras, Z espessura do relevo',
  star: 'X e Y = contorno, Z = espessura',
  heart: 'X e Y = contorno, Z = espessura',
  desenho: 'X e Y esticam o contorno (padrão: o tamanho dos pontos), Z = altura (padrão 2)',
};

// parâmetros na ponte (português) -> chave interna, unidade e significado
const P = (key, unidade, o_que) => ({ key, unidade, o_que });
const PARAMS = {
  box: { raio: P('radius', 'mm', 'arredonda as arestas (0 = cantos vivos)'), passos: P('steps', '', 'suavidade do arredondamento') },
  cylinder: { lados: P('sides', '', 'lados do contorno (resolução; 64 = bem redondo)'), chanfro: P('bevel', 'mm', 'arredonda as bordas de cima e de baixo') },
  sphere: { passos: P('steps', '', 'resolução') },
  cone: { raio_topo: P('top', 'mm', 'raio do topo (0 = pontudo)'), lados: P('sides', '', 'resolução') },
  roundRoof: { lados: P('sides', '', 'resolução da curva') },
  text: { texto: P('text', '', 'o texto (até 40 caracteres)') },
  halfSphere: { passos: P('steps', '', 'resolução') },
  polygon: { lados: P('sides', '', 'número de lados do prisma') },
  paraboloid: { lados: P('sides', '', 'resolução') },
  torus: { espessura: P('tube', 'mm', 'espessura do anel'), lados: P('sides', '', 'resolução em volta'), passos: P('steps', '', 'resolução do tubo') },
  tube: { parede: P('wall', 'mm', 'espessura da parede (furo interno = diâmetro − 2 × parede)'), lados: P('sides', '', 'resolução') },
  star: { pontas: P('points', '', 'número de pontas'), raio_interno: P('ratio', 'fração', 'raio interno ÷ raio externo') },
  icosahedron: { detalhe: P('detail', '', 'subdivisões') },
  desenho: { pontos: P('points', 'mm', 'contorno fechado [[X, Y], ...] no plano da mesa, sem repetir o 1º ponto e sem cruzar') },
};
// geradores: parâmetros pelo nome da ponte (m, rosca, modulo, dentes…), significado e medidas
// escritos para o agente em src/geradores/textos-sugeridos.js
for (const [type, g] of Object.entries(GERADORES)) {
  PARAMS[type] = {};
  for (const d of g.params) {
    PARAMS[type][d.bridge] = { key: d.key, unidade: d.unit === '°' ? 'graus' : d.unit, o_que: (TEXTOS_SUGERIDOS.significados[type] || {})[d.key] || '', opcoes: d.bridgeOptions || null, valores: d.options || null };
  }
  SIZE_NOTES[type] = TEXTOS_SUGERIDOS.medidas[type];
}

const EXAMPLES = {
  criar: { tipo: 'caixa', medidas: [80, 60, 5], centro: [0, 0, null], base_z: 0, nome: 'base' },
  alterar: { id: '<id>', medidas: [null, null, 12], mover: [0, 5, 0] },
  criar_encaixe: { id: '<id da peça>', folga: 0.25, margem: 3 },
  exportar_3mf: { caminho: 'C:\\Users\\voce\\pecas.3mf' },
  lote: { comandos: [{ cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [80, 60, 5] }, { cmd: 'criar', ref: 'furo', tipo: 'cilindro', medidas: [8, 8, 5], furo: true }, { cmd: 'agrupar', ids: ['$base', '$furo'], nome: 'suporte' }] },
};

export function resolveType(tipo) {
  const k = tipo == null ? null : FROM_NAME[norm(tipo)];
  if (!k) fail(`Tipo de forma desconhecido: ${JSON.stringify(tipo)}.`, { validos: CREATABLE.map((t) => TYPE_NAMES[t]), exemplo: EXAMPLES.criar, dica: 'forgia_formas mostra medidas e parâmetros de cada tipo.' });
  return k;
}

// catálogo para forgia_formas, derivado de SHAPES
export function catalog(tipo) {
  const types = tipo ? [resolveType(tipo)] : CREATABLE;
  return types.map((type) => {
    const def = SHAPES[type];
    const params = {};
    for (const [nome, spec] of Object.entries(PARAMS[type] || {})) {
      if (spec.key === 'points') {
        params[nome] = { obrigatorio: true, unidade: spec.unidade, o_que: spec.o_que, exemplo: [[-20, -10], [20, -10], [0, 15]] };
        continue;
      }
      const p = def.params.find((q) => q.key === spec.key);
      if (p.kind === 'text') params[nome] = { padrao: p.value, o_que: spec.o_que };
      else if (spec.opcoes) params[nome] = { padrao: Object.keys(spec.opcoes).find((k) => spec.opcoes[k] === p.value) ?? p.value, opcoes: Object.keys(spec.opcoes), o_que: spec.o_que };
      else if (spec.valores) params[nome] = { padrao: p.value, valores: spec.valores, ...(spec.unidade ? { unidade: spec.unidade } : {}), o_que: spec.o_que };
      else params[nome] = { padrao: p.value, min: p.min, max: p.max, ...(spec.unidade ? { unidade: spec.unidade } : {}), o_que: spec.o_que };
    }
    const size = type === 'desenho' ? [20, 20, 2] : sizeToUser(defaultSize(type, defaultParams(type)));
    const out = { tipo: TYPE_NAMES[type], nome: def.label, medidas_padrao: size.map(r2), medidas: SIZE_NOTES[type] || SIZE_NOTES._, params };
    if (def.generator) {
      out.categoria = def.category;
      out.medidas_automaticas = 'as medidas saem dos parâmetros (omita "medidas"); esticar deforma rosca e dentes';
    }
    if (def.hole) out.nasce_como_furo = true;
    return out;
  });
}

// ---------------- conversões ----------------

const sizeToUser = (s) => [s[0], s[2], s[1]];
const sizeFromUser = (s) => [s[0], s[2], s[1]];

// base do usuário em relação ao interno: usuário = C · interno
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const CT = C.clone().transpose();

function quatToUserDeg(q) {
  const ru = C.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(CT);
  const e = new THREE.Euler().setFromRotationMatrix(ru, 'ZYX');
  return [e.x, e.y, e.z].map((a) => r2(a / DEG));
}

function userDegToQuat(d) {
  const ru = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(d[0] * DEG, d[1] * DEG, d[2] * DEG, 'ZYX'));
  return new THREE.Quaternion().setFromRotationMatrix(CT.clone().multiply(ru).multiply(C));
}

// ---------------- validação de argumentos ----------------

function checkKeys(args, allowed, cmd) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail(`${cmd}: os argumentos precisam ser um objeto JSON.`, { exemplo: EXAMPLES[cmd] });
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) fail(`${cmd}: parâmetro desconhecido "${k}".`, { validos: allowed, exemplo: EXAMPLES[cmd] });
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function num(v, name, { min = -Infinity, max = Infinity } = {}) {
  if (!isNum(v)) fail(`${name} precisa ser um número (mm ou graus), recebido ${JSON.stringify(v)}.`);
  if (v < min || v > max) fail(`${name} = ${v} está fora do limite (${min} a ${max}).`);
  return v;
}

// [X, Y, Z]; nulls = "não mexe nesse eixo" quando allowNull
function vec3(v, name, { allowNull = false, min, max } = {}) {
  if (!Array.isArray(v) || v.length !== 3) fail(`${name} precisa ser [X, Y, Z]${allowNull ? ' (null = não muda aquele eixo)' : ''}, recebido ${JSON.stringify(v)}.`);
  return v.map((c, i) => {
    if (c === null && allowNull) return null;
    return num(c, `${name}[${'XYZ'[i]}]`, { min, max });
  });
}

const sizeVec = (v) => vec3(v, 'medidas', { allowNull: true, min: MIN_MM, max: MAX_MM });

function color(v) {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail(`cor precisa ser "#rrggbb", recebido ${JSON.stringify(v)}.`, { exemplo: '#1b8bd2' });
  return v.toLowerCase();
}

function idList(v, name = 'ids') {
  if (typeof v === 'string') return [v];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) fail(`${name} precisa ser uma lista de ids (texto), ex.: ["a1b2c3d4"] ou ["$base"] dentro de um lote.`);
  return v;
}

// ---------------- árvore e quadros ----------------

// acha em qualquer nível: { o, parent, list, chain: [grupos do topo até o pai] }
function locate(objects, id) {
  const walk = (list, parent, chain) => {
    for (const o of list) {
      if (o.id === id) return { o, parent, list, chain };
      if (o.children) {
        const r = walk(o.children, o, [...chain, o]);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(objects, null, []);
}

// quadro onde ficam os filhos de g (é o que updateMesh desenha: posição, giro e escala do grupo
// aplicados à booleana centrada)
function groupFrame(g, parentFrame) {
  const c = groupResult(g).center;
  return parentFrame.clone().multiply(objectMatrix(g)).multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
}

function frameOf(chain) {
  let m = new THREE.Matrix4();
  for (const g of chain) m = groupFrame(g, m);
  return m;
}

const geometryOf = (o) => (o.type === 'group' ? groupResult(o).geometry : shapeGeometry(o));

// caixa envolvente no mundo (interno), a partir dos dados (não precisa de malha na cena)
const boxCache = new Map();
function worldBox(o, frame) {
  const geo = geometryOf(o);
  const m = frame.clone().multiply(objectMatrix(o));
  const key = geo.uuid + '|' + m.elements.map((v) => v.toFixed(5)).join(',');
  const hit = boxCache.get(key);
  if (hit) return hit.clone();
  const b = new THREE.Box3();
  const pos = geo.attributes.position;
  const v = V3();
  for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  boxCache.set(key, b.clone());
  if (boxCache.size > 800) boxCache.delete(boxCache.keys().next().value);
  return b;
}

const userBox = (b) => boxToUser(b.min, b.max);
const centerWorld = (o, frame) => V3().fromArray(o.pos).applyMatrix4(frame);

// giro do quadro (sem escala)
function frameQuat(frame) {
  const q = new THREE.Quaternion();
  frame.decompose(V3(), q, V3());
  return q;
}

// mm no mundo por unidade local, em cada eixo interno do objeto (1 fora de grupo escalado)
function axisFactors(o, frame) {
  const lin = new THREE.Matrix3().setFromMatrix4(frame);
  const q = new THREE.Quaternion().fromArray(o.quat);
  return [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)].map((e) => e.applyQuaternion(q).applyMatrix3(lin).length() || 1);
}

// desloca o objeto por d (mundo, interno); dentro de grupo converte para o quadro do pai
function moveInternal(o, frame, d) {
  const local = d.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(frame).invert());
  o.pos = [r3(o.pos[0] + local.x), r3(o.pos[1] + local.y), r3(o.pos[2] + local.z)];
}
const moveUser = (o, frame, d) => moveInternal(o, frame, V3(...fromUser(d)));

// estado dos grupos da cadeia antes de mexer num filho (para renormalize)
function snapshotChain(chain) {
  return chain.map((g) => {
    const r = groupResult(g);
    return { g, center: [...r.center], base: [...r.baseSize] };
  });
}

// depois de mexer em filhos: recentra cada grupo da cadeia (do mais interno para fora), mantendo a
// escala e o lugar de tudo no mundo
function renormalize(before) {
  for (let i = before.length - 1; i >= 0; i--) {
    const { g, center: c0, base: b0 } = before[i];
    if (!g.children.length) continue;
    const r = groupResult(g);
    const cn = r.center;
    const f = g.flip || [1, 1, 1];
    const S = [0, 1, 2].map((k) => (g.size[k] / b0[k]) * f[k]);
    for (const ch of g.children) ch.pos = ch.pos.map((v, k) => r3(v - cn[k]));
    aliasGroupResult(g.children, r);
    const shift = V3((cn[0] - c0[0]) * S[0], (cn[1] - c0[1]) * S[1], (cn[2] - c0[2]) * S[2]).applyQuaternion(new THREE.Quaternion().fromArray(g.quat));
    g.pos = [r3(g.pos[0] + shift.x), r3(g.pos[1] + shift.y), r3(g.pos[2] + shift.z)];
    g.size = g.size.map((s, k) => r3((s / b0[k]) * r.baseSize[k]));
  }
}

// ---------------- estado (o que o agente lê) ----------------

function userParams(o) {
  const map = PARAMS[o.type];
  if (!map) return undefined;
  const out = {};
  for (const [nome, spec] of Object.entries(map)) {
    if (spec.key === 'points') out.pontos_qtd = (o.params.points || []).length;
    else if (spec.opcoes) out[nome] = Object.keys(spec.opcoes).find((k) => spec.opcoes[k] === o.params[spec.key]) ?? o.params[spec.key];
    else out[nome] = o.params[spec.key];
  }
  return out;
}

// "apoiado em": mesa, id do objeto logo abaixo (mesmo nível), no_ar ou abaixo_da_mesa
function restingOn(item, siblings) {
  const minZ = item.box.min[2];
  if (Math.abs(minZ) <= 0.02) return 'mesa';
  let best = null;
  let bestArea = 0;
  for (const s of siblings) {
    if (s === item || s.o.hole || s.o.hidden) continue;
    if (Math.abs(s.box.max[2] - minZ) > 0.05) continue;
    const ox = Math.min(item.box.max[0], s.box.max[0]) - Math.max(item.box.min[0], s.box.min[0]);
    const oy = Math.min(item.box.max[1], s.box.max[1]) - Math.max(item.box.min[1], s.box.min[1]);
    if (ox > 0 && oy > 0 && ox * oy > bestArea) {
      bestArea = ox * oy;
      best = s.o.id;
    }
  }
  if (best) return best;
  return minZ < 0 ? 'abaixo_da_mesa' : 'no_ar';
}

// centro e medidas no sistema do usuário: a mesma conta no estado e na barra de status
function centerSize(o, frame) {
  const f = axisFactors(o, frame);
  return { centro: toUser(centerWorld(o, frame)).map(r2), medidas: sizeToUser(o.size.map((s, k) => s * f[k])).map(r2) };
}

// descreve uma lista de irmãos (topo ou filhos de um grupo) no sistema do usuário
function describeList(list, chain, depth, opts) {
  const frame = frameOf(chain);
  const fq = frameQuat(frame);
  const items = list.map((o) => ({ o, box: userBox(worldBox(o, frame)) }));
  return items.map((it) => {
    const o = it.o;
    const out = {
      id: o.id,
      nome: o.name,
      tipo: TYPE_NAMES[o.type] || o.type,
      furo: !!o.hole,
    };
    if (o.type !== 'group' || o.color) out.cor = o.color;
    const cs = centerSize(o, frame);
    out.medidas = cs.medidas;
    out.centro = cs.centro;
    out.caixa = { min: it.box.min.map(r2), max: it.box.max.map(r2) };
    const rot = quatToUserDeg(fq.clone().multiply(new THREE.Quaternion().fromArray(o.quat)));
    if (rot.some((a) => a !== 0)) out.rotacao = rot;
    const fl = o.flip || [1, 1, 1];
    if (fl.some((v) => v < 0)) out.espelhado = ['X', 'Y', 'Z'].filter((_, k) => fl[[0, 2, 1][k]] < 0);
    const params = userParams(o);
    if (params) out.params = params;
    if (!o.hole) out.apoiado_em = restingOn(it, items);
    if (chain.length) out.grupo = chain[chain.length - 1].id;
    if (o.hidden) out.oculto = true;
    if (o.locked) out.bloqueado = true;
    if (o.type === 'group') {
      if (depth > 0) out.filhos = describeList(o.children, [...chain, o], depth - 1, opts);
      else out.filhos = o.children.length;
    }
    return out;
  });
}

function describeOne(ed, id, depth = 0) {
  const loc = locate(ed.objects, id);
  if (!loc) return null;
  const all = describeList(loc.list, loc.chain, depth, {});
  return all.find((d) => d.id === id);
}

// marcações do Marcar parte (src/marcar.js): info() lê a parte de novo a cada chamada
export function marksOut(ed) {
  return (ed.marks || []).map((m) => (typeof m.info === 'function' ? m.info() : m.info));
}

export function state(ed, args = {}) {
  checkKeys(args, ['ids', 'filhos'], 'estado');
  const deep = args.filhos === true ? 99 : 0;
  let objetos;
  if (args.ids) {
    objetos = idList(args.ids).map((id) => {
      const d = describeOne(ed, id, Math.max(deep, 1));
      if (!d) fail(`Objeto ${JSON.stringify(id)} não existe.`, { ids_existentes: ed.objects.map((o) => o.id).slice(0, 40) });
      return d;
    });
  } else {
    objetos = describeList(ed.objects, [], deep, {});
  }
  const MAX = 150;
  const out = {
    ok: true,
    sistema: 'mm; Z para cima, X direita, Y fundo; origem no centro da mesa; centro = centro do objeto; rotacao em graus',
    projeto: ed.name,
    mesa: { medidas: [ed.workplane.w, ed.workplane.l, ed.workplane.h] },
    selecao: [...ed.selection],
    total: ed.objects.length,
    objetos: objetos.slice(0, MAX),
  };
  if (objetos.length > MAX) out.truncado = `mostrando ${MAX} de ${objetos.length}; peça ids específicos`;
  out.marcacoes = marksOut(ed);
  out.desfazer = { pode_desfazer: ed.historyIndex > 0, pode_refazer: ed.historyIndex < ed.history.length - 1 };
  return out;
}

// X/Y/Z e medidas da seleção para a barra de status: o MESMO cálculo do estado
export function selectionSummary(ed) {
  const sel = ed.selected;
  if (!sel.length) return null;
  if (sel.length === 1) return { ...centerSize(sel[0], new THREE.Matrix4()), n: 1 };
  const b = new THREE.Box3();
  for (const o of sel) b.union(worldBox(o, new THREE.Matrix4()));
  const u = userBox(b);
  return { centro: [0, 1, 2].map((k) => r2((u.min[k] + u.max[k]) / 2)), medidas: [0, 1, 2].map((k) => r2(u.max[k] - u.min[k])), n: sel.length };
}

// ---------------- validação do projeto (fim de todo pedido) ----------------

export function validateProject(objects) {
  const ids = new Set();
  const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(isNum);
  const check = (o, where) => {
    const bad = (why) => fail(`Projeto inválido depois do pedido (${where}): ${why}. Nada foi aplicado.`);
    if (!o || typeof o !== 'object') bad('objeto que não é objeto');
    if (typeof o.id !== 'string' || !o.id) bad('objeto sem id');
    if (ids.has(o.id)) bad(`id repetido ${o.id}`);
    ids.add(o.id);
    if (o.type !== 'group' && !SHAPES[o.type]) bad(`tipo desconhecido ${o.type}`);
    if (!finite(o.pos, 3)) bad(`posição inválida em ${o.id}`);
    if (!finite(o.quat, 4) || Math.abs(Math.hypot(...o.quat) - 1) > 1e-3) bad(`rotação inválida em ${o.id}`);
    if (!finite(o.size, 3) || o.size.some((v) => v <= 0 || v > 1e6)) bad(`medidas inválidas em ${o.id}`);
    if (o.flip && (!finite(o.flip, 3) || o.flip.some((v) => Math.abs(v) !== 1))) bad(`espelhamento inválido em ${o.id}`);
    if (o.pos.some((v) => Math.abs(v) > 1e6)) bad(`posição fora da mesa em ${o.id}`);
    if (o.params && typeof o.params === 'object') {
      for (const [k, v] of Object.entries(o.params)) if (typeof v === 'number' && !Number.isFinite(v)) bad(`parâmetro ${k} inválido em ${o.id}`);
    }
    if (o.type === 'group') {
      if (!Array.isArray(o.children) || !o.children.length) bad(`grupo ${o.id} sem partes`);
      o.children.forEach((c) => check(c, `grupo ${o.id}`));
    }
  };
  if (!Array.isArray(objects)) fail('Projeto inválido depois do pedido. Nada foi aplicado.');
  objects.forEach((o) => check(o, 'topo'));
}

// ---------------- execução ----------------

// contexto de um pedido: apelidos (ref) e o que foi criado/alterado/excluído
function newCtx() {
  return { refs: {}, created: [], altered: new Set(), deleted: [], avisos: [], encaixes: [] };
}

function resolveIds(ed, ctx, v, name = 'ids') {
  const out = [];
  for (const raw of idList(v, name)) {
    const key = raw.startsWith('$') ? raw.slice(1) : raw;
    if (ctx.refs[key] && (raw.startsWith('$') || !locate(ed.objects, raw))) out.push(...ctx.refs[key]);
    else if (raw.startsWith('$')) fail(`Apelido ${raw} não existe neste pedido. Dê "ref": "${key}" no criar/agrupar/duplicar antes de usar.`, { apelidos: Object.keys(ctx.refs).map((k) => '$' + k) });
    else out.push(raw);
  }
  return out;
}

function findObj(ed, ctx, v, name = 'id') {
  const ids = resolveIds(ed, ctx, v, name);
  if (ids.length !== 1) fail(`${name} precisa indicar um objeto só (recebido ${ids.length}).`);
  const loc = locate(ed.objects, ids[0]);
  if (!loc) fail(`Objeto ${JSON.stringify(ids[0])} não existe.`, { ids_existentes: ed.objects.map((o) => o.id).slice(0, 40), dica: 'forgia_estado lista os ids (e as partes dos grupos com filhos: true).' });
  return loc;
}

function topLevel(ed, ctx, v, cmd, min = 1) {
  const ids = resolveIds(ed, ctx, v);
  if (ids.length < min) fail(`${cmd} precisa de pelo menos ${min} id${min > 1 ? 's' : ''}.`);
  return ids.map((id) => {
    const loc = locate(ed.objects, id);
    if (!loc) fail(`Objeto ${JSON.stringify(id)} não existe.`, { ids_existentes: ed.objects.map((o) => o.id).slice(0, 40) });
    if (loc.parent) fail(`${cmd}: ${id} é parte do grupo ${loc.chain[0].id}. Use o id do grupo (ou desagrupe antes).`);
    return loc.o;
  });
}

const notLocked = (loc, cmd) => {
  if (loc.o.locked || loc.chain.some((g) => g.locked)) fail(`${cmd}: ${loc.o.id} está bloqueado pelo usuário no Forgia. Peça para ele desbloquear (Ctrl+L).`);
};

// params do usuário -> internos (com limites); desenho devolve também o contorno preparado
function internalParams(type, given) {
  if (given == null) return { params: {} };
  if (typeof given !== 'object' || Array.isArray(given)) fail('params precisa ser um objeto, ex.: { "raio": 2 }.');
  const map = PARAMS[type] || {};
  const params = {};
  let outline = null;
  for (const [k, v] of Object.entries(given)) {
    const entry = Object.entries(map).find(([nome, s]) => nome === norm(k) || s.key === k);
    if (!entry) fail(`O tipo ${TYPE_NAMES[type]} não tem o parâmetro "${k}".`, { validos: Object.keys(map), exemplo: catalog(TYPE_NAMES[type])[0].params });
    const [nome, spec] = entry;
    if (spec.key === 'points') {
      if (!Array.isArray(v) || !v.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))) fail('pontos precisa ser [[X, Y], [X, Y], ...] em mm (pelo menos 3).', { exemplo: [[-20, -10], [20, -10], [0, 15]] });
      const res = prepareOutline(v.map(([x, y]) => [x, -y]));
      if (!res.ok) fail({ poucos: 'O contorno precisa de pelo menos 3 pontos diferentes.', area: 'O contorno não tem área.', cruzado: 'O contorno se cruza: os lados não podem se cruzar nem se tocar.' }[res.reason], { exemplo: [[-20, -10], [20, -10], [0, 15]] });
      params.points = res.points;
      outline = res;
      continue;
    }
    const def = SHAPES[type].params.find((q) => q.key === spec.key);
    if (def.kind === 'text') {
      if (typeof v !== 'string' || v.length > 40) fail('texto precisa ser um texto de até 40 caracteres.');
      params[spec.key] = v;
      continue;
    }
    // opção por nome (rosca: "real" | "lisa", padrao: "colmeia"…) ou pelo valor numérico
    if (spec.opcoes && typeof v === 'string') {
      const k = norm(v);
      if (!(k in spec.opcoes)) fail(`params.${nome} precisa ser uma de: ${Object.keys(spec.opcoes).join(', ')}.`, { validos: Object.keys(spec.opcoes) });
      params[spec.key] = spec.opcoes[k];
      continue;
    }
    params[spec.key] = num(v, `params.${nome}`, { min: def.min, max: def.max });
    if (spec.valores && !spec.valores.includes(params[spec.key])) fail(`params.${nome} = ${v} não existe; use um de: ${spec.valores.join(', ')}.`, { validos: spec.valores });
  }
  return { params, outline };
}

const CRIAR_KEYS = ['tipo', 'medidas', 'centro', 'base_z', 'sobre', 'alinhar_com', 'mover', 'rotacao', 'cor', 'furo', 'nome', 'params', 'ref'];
const ALTERAR_KEYS = ['id', 'medidas', 'esticar', 'centro', 'base_z', 'sobre', 'alinhar_com', 'mover', 'rotacao', 'cor', 'furo', 'nome', 'params'];

// âncoras de posição: centro (null = não muda o eixo), alinhar_com (X/Y do centro de outro),
// sobre (base no topo de outro, X/Y no centro dele), base_z (Z mín da caixa), mover (soma no fim)
function place(ed, ctx, loc, frame, args, { isNew }) {
  const o = loc.o;
  const c = args.centro ? vec3(args.centro, 'centro', { allowNull: true, min: -MAX_MM, max: MAX_MM }) : [null, null, null];
  const cur = toUser(centerWorld(o, frame));
  const target = [...cur];
  let zMode = null;
  let baseZ = null;
  for (let k = 0; k < 3; k++) if (c[k] !== null) target[k] = c[k];
  if (c[2] !== null) zMode = 'centro';
  const other = (v, name) => {
    const ol = findObj(ed, ctx, v, name);
    if (ol.o === o) fail(`${name} não pode ser o próprio objeto.`);
    const of = frameOf(ol.chain);
    return { center: toUser(centerWorld(ol.o, of)), box: userBox(worldBox(ol.o, of)) };
  };
  if (args.alinhar_com != null) {
    const r = other(args.alinhar_com, 'alinhar_com');
    if (c[0] === null) target[0] = r.center[0];
    if (c[1] === null) target[1] = r.center[1];
  }
  if (args.sobre != null) {
    const r = other(args.sobre, 'sobre');
    if (c[0] === null && args.alinhar_com == null) target[0] = r.center[0];
    if (c[1] === null && args.alinhar_com == null) target[1] = r.center[1];
    baseZ = r.box.max[2];
    zMode = 'base';
  }
  if (args.base_z != null) {
    baseZ = num(args.base_z, 'base_z', { min: -MAX_MM, max: MAX_MM });
    zMode = 'base';
  }
  if (isNew && !zMode) {
    baseZ = 0;
    zMode = 'base';
  }
  moveUser(o, frame, [target[0] - cur[0], target[1] - cur[1], zMode === 'centro' ? target[2] - cur[2] : 0]);
  if (zMode === 'base') {
    const b = userBox(worldBox(o, frame));
    moveUser(o, frame, [0, 0, baseZ - b.min[2]]);
  }
  if (args.mover != null) moveUser(o, frame, vec3(args.mover, 'mover', { min: -1e308, max: 1e308 }));
}

function criar(ed, ctx, args) {
  checkKeys(args, CRIAR_KEYS, 'criar');
  const type = resolveType(args.tipo);
  const { params, outline } = internalParams(type, args.params);
  if (type === 'desenho' && !outline) fail('desenho precisa de params.pontos: [[X, Y], ...] em mm.', { exemplo: { tipo: 'desenho', params: { pontos: [[-20, -10], [20, -10], [0, 15]] }, medidas: [null, null, 3] } });
  const full = defaultParams(type, params);
  let size = defaultSize(type, full);
  if (outline) size = [outline.size[0], 2, outline.size[1]];
  if (args.medidas != null) {
    const m = sizeFromUser(sizeVec(args.medidas));
    size = size.map((s, k) => (m[k] === null ? s : m[k]));
    if (type === 'text' && m[0] === null) size[0] = textWidthFor(full, size[2]);
  }
  // furo: o pedido manda; sem ele, o padrão da forma (furo para parafuso e para inserto nascem furo)
  const opts = { params: full, size: size.map(r3), hole: args.furo == null ? !!SHAPES[type].hole : !!args.furo };
  if (args.nome != null) opts.name = String(args.nome).slice(0, 80);
  if (args.cor != null) opts.color = color(args.cor);
  const o = ed.createObject(type, opts);
  if (outline) o.pos = [outline.center[0], o.size[1] / 2, outline.center[1]];
  if (args.rotacao != null) o.quat = userDegToQuat(vec3(args.rotacao, 'rotacao', { min: -3600, max: 3600 })).toArray();
  ed.objects.push(o);
  const loc = { o, chain: [], list: ed.objects, parent: null };
  place(ed, ctx, loc, new THREE.Matrix4(), args, { isNew: true });
  ctx.created.push(o.id);
  if (args.ref != null) ctx.refs[String(args.ref).replace(/^\$/, '')] = [o.id];
  return o;
}

const SIDES = { X: [0, 1], Y: [2, -1], Z: [1, 1] }; // eixo do usuário -> [eixo interno, sinal]

function alterar(ed, ctx, args) {
  checkKeys(args, ALTERAR_KEYS, 'alterar');
  const loc = findObj(ed, ctx, args.id);
  notLocked(loc, 'alterar');
  const o = loc.o;
  const frame = frameOf(loc.chain); // fixo: o grupo só se ajusta no fim (renormalize)
  const before = snapshotChain(loc.chain);
  const base0 = userBox(worldBox(o, frame)).min[2];
  let reshaped = false;
  if (args.nome != null) o.name = String(args.nome).slice(0, 80);
  if (args.cor != null) {
    o.color = color(args.cor);
    o.hole = false;
  }
  if (args.furo != null) o.hole = !!args.furo;
  if (args.params != null) {
    if (o.type === 'group' || o.type === 'mesh') fail(`${TYPE_NAMES[o.type]} não tem parâmetros; mude medidas, centro ou rotacao.`);
    const { params, outline } = internalParams(o.type, args.params);
    Object.assign(o.params, params);
    if (outline && args.medidas == null) o.size = [outline.size[0], o.size[1], outline.size[1]];
    if (o.type === 'text' && params.text !== undefined && (args.medidas == null || args.medidas[0] === null)) o.size[0] = textWidthFor(o.params, o.size[2]);
    // Hardware e Geradores: medidas voltam às naturais dos parâmetros novos (M3 → M5 cresce)
    if (SHAPES[o.type].generator && args.medidas == null) {
      const f = axisFactors(o, frame);
      o.size = SHAPES[o.type].sizeFor(o.params).map((s, k) => r3(s / f[k]));
    }
    reshaped = true;
  }
  if (args.rotacao != null) {
    const qw = userDegToQuat(vec3(args.rotacao, 'rotacao', { min: -3600, max: 3600 }));
    o.quat = frameQuat(frame).invert().multiply(qw).toArray();
    reshaped = true;
  }
  if (args.medidas != null) {
    const m = sizeFromUser(sizeVec(args.medidas));
    const f = axisFactors(o, frame);
    o.size = o.size.map((s, k) => (m[k] === null ? s : r3(m[k] / f[k])));
    if (o.type === 'text' && m[0] === null && args.params == null) o.size[0] = textWidthFor(o.params, o.size[2]);
    reshaped = true;
  }
  // medidas, giro e parâmetros mantêm o centro X/Y e a base (Z mín) no lugar, a não ser que o
  // pedido diga outra altura
  const explicitZ = (args.centro && args.centro[2] != null) || args.base_z != null || args.sobre != null;
  if (reshaped && !explicitZ) moveUser(o, frame, [0, 0, base0 - userBox(worldBox(o, frame)).min[2]]);
  if (args.esticar != null) {
    const e = args.esticar;
    const m = /^([+-])([XYZ])$/i.exec(e && e.lado);
    if (!m || !isNum(e.mm)) fail('esticar precisa de { "lado": "+X"|"-X"|"+Y"|"-Y"|"+Z"|"-Z", "mm": número } (lado nos eixos do próprio objeto; o lado oposto fica parado).', { exemplo: { id: '<id>', esticar: { lado: '+Z', mm: 2 } } });
    const [axis, sgn] = SIDES[m[2].toUpperCase()];
    const s = (m[1] === '-' ? -1 : 1) * sgn;
    const f = axisFactors(o, frame)[axis];
    const next = o.size[axis] + e.mm / f;
    if (next < MIN_MM) fail(`esticar deixaria a medida com ${r2(next * f)} mm (mínimo ${MIN_MM}).`);
    o.size[axis] = r3(next);
    const dir = [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)][axis].applyQuaternion(new THREE.Quaternion().fromArray(o.quat));
    dir.applyMatrix3(new THREE.Matrix3().setFromMatrix4(frame)).normalize();
    moveInternal(o, frame, dir.multiplyScalar((s * e.mm) / 2));
  }
  place(ed, ctx, loc, frame, args, { isNew: false });
  renormalize(before);
  ctx.altered.add(o.id);
  return o;
}

function excluir(ed, ctx, args) {
  checkKeys(args, ['ids'], 'excluir');
  for (const id of resolveIds(ed, ctx, args.ids)) {
    const loc = locate(ed.objects, id);
    if (!loc) fail(`Objeto ${JSON.stringify(id)} não existe.`, { ids_existentes: ed.objects.map((o) => o.id).slice(0, 40) });
    notLocked(loc, 'excluir');
    if (!loc.parent) {
      ed.objects = ed.objects.filter((o) => o !== loc.o);
    } else {
      const before = snapshotChain(loc.chain);
      loc.parent.children.splice(loc.parent.children.indexOf(loc.o), 1);
      // grupo que ficou vazio sai junto (e assim para cima)
      for (let i = loc.chain.length - 1; i >= 0; i--) {
        const g = loc.chain[i];
        if (g.children.length) break;
        const up = loc.chain[i - 1];
        if (up) up.children.splice(up.children.indexOf(g), 1);
        else ed.objects = ed.objects.filter((o) => o !== g);
      }
      renormalize(before.filter((b) => locate(ed.objects, b.g.id)));
      ctx.altered.add(loc.chain[0].id);
    }
    ctx.deleted.push(id);
  }
}

const AXES = { X: [0, 1], Y: [2, -1], Z: [1, 1] };
function axisArg(v) {
  const k = String(v || '').toUpperCase();
  if (!AXES[k]) fail(`eixo precisa ser "X", "Y" ou "Z", recebido ${JSON.stringify(v)}.`);
  return AXES[k];
}

function agrupar(ed, ctx, args) {
  checkKeys(args, ['ids', 'nome', 'ref'], 'agrupar');
  const objs = topLevel(ed, ctx, args.ids, 'agrupar', 2);
  const g = ed.group(objs, { select: false });
  if (args.nome != null) g.name = String(args.nome).slice(0, 80);
  ctx.created.push(g.id);
  if (args.ref != null) ctx.refs[String(args.ref).replace(/^\$/, '')] = [g.id];
  return g;
}

function desagrupar(ed, ctx, args) {
  checkKeys(args, ['ids'], 'desagrupar');
  const objs = topLevel(ed, ctx, args.ids, 'desagrupar');
  const bad = objs.find((o) => o.type !== 'group');
  if (bad) fail(`desagrupar: ${bad.id} não é grupo.`);
  const ids = ed.ungroup(objs, { select: false });
  for (const o of objs) ctx.deleted.push(o.id);
  for (const id of ids) ctx.altered.add(id);
}

function alinhar(ed, ctx, args) {
  checkKeys(args, ['ids', 'eixo', 'onde', 'referencia'], 'alinhar');
  const objs = topLevel(ed, ctx, args.ids, 'alinhar', 2);
  const [axis, sgn] = axisArg(args.eixo);
  const where = { min: -1, centro: 0, max: 1 }[args.onde];
  if (where === undefined) fail('onde precisa ser "min", "centro" ou "max".', { exemplo: { ids: ['<a>', '<b>'], eixo: 'X', onde: 'centro' } });
  let key = null;
  if (args.referencia != null) {
    [key] = topLevel(ed, ctx, [args.referencia].flat(), 'alinhar');
    if (!objs.includes(key)) objs.push(key);
  }
  ed.align(axis, where * sgn, objs, key);
  for (const o of objs) if (o !== key) ctx.altered.add(o.id);
}

function espelhar(ed, ctx, args) {
  checkKeys(args, ['ids', 'eixo'], 'espelhar');
  const objs = topLevel(ed, ctx, args.ids, 'espelhar');
  objs.forEach((o) => notLocked({ o, chain: [] }, 'espelhar'));
  ed.mirror(axisArg(args.eixo)[0], objs);
  for (const o of objs) ctx.altered.add(o.id);
}

function soltar(ed, ctx, args) {
  checkKeys(args, ['ids'], 'soltar_na_mesa');
  const objs = topLevel(ed, ctx, args.ids, 'soltar_na_mesa');
  objs.forEach((o) => notLocked({ o, chain: [] }, 'soltar_na_mesa'));
  ed.dropToWorkplane(objs);
  for (const o of objs) ctx.altered.add(o.id);
}

function selecionar(ed, ctx, args) {
  checkKeys(args, ['ids'], 'selecionar');
  const objs = args.ids && args.ids.length === 0 ? [] : topLevel(ed, ctx, args.ids, 'selecionar');
  ed.select(objs.map((o) => o.id));
}

const clone = (o) => JSON.parse(JSON.stringify(o));
function reId(o) {
  o.id = Math.random().toString(36).slice(2, 10);
  if (o.children) o.children.forEach(reId);
  return o;
}

function duplicar(ed, ctx, args) {
  checkKeys(args, ['ids', 'vezes', 'deslocamento', 'giro_z', 'centro_giro', 'ref'], 'duplicar');
  const objs = topLevel(ed, ctx, args.ids, 'duplicar');
  const n = args.vezes == null ? 1 : num(args.vezes, 'vezes', { min: 1, max: 500 });
  if (!Number.isInteger(n)) fail('vezes precisa ser um número inteiro.');
  const step = args.deslocamento == null ? [0, 0, 0] : vec3(args.deslocamento, 'deslocamento', { min: -MAX_MM, max: MAX_MM });
  const giro = args.giro_z == null ? 0 : num(args.giro_z, 'giro_z', { min: -360, max: 360 });
  const pivot = args.centro_giro == null ? null : (() => {
    const p = args.centro_giro;
    if (!Array.isArray(p) || p.length !== 2 || !p.every(isNum)) fail('centro_giro precisa ser [X, Y] em mm.');
    return p;
  })();
  const made = [];
  for (let i = 1; i <= n; i++) {
    for (const src of objs) {
      const c = reId(clone(src));
      delete c.locked;
      const center = toUser(V3().fromArray(src.pos));
      const piv = pivot ? [pivot[0], pivot[1]] : [center[0], center[1]];
      const a = giro * i * DEG;
      // gira em volta do eixo Z do usuário (Y interno) pelo pivô, depois desloca
      const dx = center[0] - piv[0];
      const dy = center[1] - piv[1];
      const nc = [piv[0] + dx * Math.cos(a) - dy * Math.sin(a) + step[0] * i, piv[1] + dx * Math.sin(a) + dy * Math.cos(a) + step[1] * i, center[2] + step[2] * i];
      c.pos = fromUser(nc).map(r3);
      if (a) c.quat = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), a).multiply(new THREE.Quaternion().fromArray(src.quat)).toArray();
      ed.objects.push(c);
      made.push(c.id);
    }
  }
  ctx.created.push(...made);
  if (args.ref != null) ctx.refs[String(args.ref).replace(/^\$/, '')] = made;
  return made;
}

function importar(ed, ctx, args, file) {
  checkKeys(args, ['caminho', 'nome', 'medidas', 'centro', 'base_z', 'sobre', 'alinhar_com', 'mover', 'rotacao', 'cor', 'ref'], 'importar');
  if (!file || !file.dados) fail('importar: o arquivo não chegou ao editor.');
  let model;
  try {
    const bytes = file.dados;
    model = parseModel(file.nome, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (err) {
    if (err instanceof ImportError) fail(err.kind === 'vazio' ? 'O arquivo não tem triângulos.' : 'Formato não suportado: use .stl, .obj ou .3mf.');
    fail(`Não foi possível ler ${file.nome}: ${err.message}`);
  }
  const { ref, saved } = registerMesh(model.positions);
  let size = model.size;
  if (args.medidas != null) {
    const m = sizeFromUser(sizeVec(args.medidas));
    size = size.map((s, k) => (m[k] === null ? s : m[k]));
  }
  const o = ed.createObject('mesh', { params: { ref }, size, name: args.nome != null ? String(args.nome).slice(0, 80) : file.nome.replace(/\.[^.]+$/, '') });
  if (args.cor != null) o.color = color(args.cor);
  if (args.rotacao != null) o.quat = userDegToQuat(vec3(args.rotacao, 'rotacao', { min: -3600, max: 3600 })).toArray();
  ed.objects.push(o);
  place(ed, ctx, { o, chain: [], list: ed.objects, parent: null }, new THREE.Matrix4(), args, { isNew: true });
  ctx.created.push(o.id);
  if (args.ref != null) ctx.refs[String(args.ref).replace(/^\$/, '')] = [o.id];
  if (!saved) ctx.avisos.push('Modelo grande: ele não fica salvo quando o Forgia fechar (limite do armazenamento).');
  return o;
}

// Criar encaixe (src/encaixe.js): ao lado da peça, grupo com um bloco aberto em cima e a cópia da
// peça como furo, com a folga por lado. A peça não muda. Devolve o grupo e as duas partes.
function criar_encaixe(ed, ctx, args) {
  checkKeys(args, ['id', 'folga', 'margem', 'nome', 'ref'], 'criar_encaixe');
  if (args.id == null) fail('criar_encaixe precisa de "id": a peça (objeto do topo) que vai entrar no encaixe.', { exemplo: EXAMPLES.criar_encaixe });
  const objs = topLevel(ed, ctx, [args.id].flat(), 'criar_encaixe');
  if (objs.length !== 1) fail(`criar_encaixe: indique uma peça só (recebido ${objs.length}); para várias, agrupe antes.`);
  const piece = objs[0];
  if (piece.hole) fail(`criar_encaixe: ${piece.id} é um furo; o encaixe é feito de uma peça sólida.`);
  const folga = args.folga == null ? FOLGA_PADRAO : num(args.folga, 'folga', { min: 0, max: FOLGA_MAX });
  const margem = args.margem == null ? MARGEM_PADRAO : num(args.margem, 'margem', { min: 0.5, max: 50 });
  const tx = t.encaixe;
  const r = createFit(ed, piece, { folga, margem, names: { grupo: tx.grupo(piece.name), bloco: tx.bloco, copia: tx.copia(piece.name) } });
  const g = r.grupo;
  if (args.nome != null) g.name = String(args.nome).slice(0, 80);
  const [bloco, copia] = g.children;
  ctx.created.push(g.id, bloco.id, copia.id);
  if (args.ref != null) ctx.refs[String(args.ref).replace(/^\$/, '')] = [g.id];
  ctx.encaixes.push({ grupo: g.id, bloco: bloco.id, copia: copia.id, folga: r.folga, margem: r.margem, folga_exata: r.exata });
  if (!r.exata) ctx.avisos.push(`Folga aproximada no encaixe de ${piece.id}: a peça tem forma sem folga exata (malha importada, texto, contorno, gerador…); a cópia cresceu 2 × folga em cada eixo. Confira as medidas.`);
  return g;
}

const MUTATORS = { criar, alterar, excluir, agrupar, desagrupar, alinhar, espelhar, soltar_na_mesa: soltar, selecionar, duplicar, importar, criar_encaixe };
export const LOTE_COMMANDS = Object.keys(MUTATORS);

// um item de lote: { cmd, ...args } (forma curta) ou { cmd, args: { ... } }
function runOne(ed, ctx, item, i, files, inLote) {
  if (!item || typeof item !== 'object' || typeof item.cmd !== 'string') fail(`comando ${i + 1}: cada item precisa de "cmd".`, { exemplo: EXAMPLES.lote });
  const name = item.cmd.replace(/^forgia_/, '');
  const fn = MUTATORS[name];
  if (!fn) fail(`comando ${i + 1}: "${item.cmd}" não vale dentro de lote.`, { validos: LOTE_COMMANDS });
  const { cmd: _c, args: inner, ...rest } = item;
  const args = inner && typeof inner === 'object' ? inner : rest;
  try {
    return fn(ed, ctx, args, files && files[i]);
  } catch (err) {
    if (err instanceof BridgeError && inLote) err.message = `comando ${i + 1} (${name}): ${err.message} Nada do lote foi aplicado.`;
    throw err;
  }
}

// objetos afetados, descritos depois do pedido (partes de grupo com coordenadas no mundo)
function summary(ed, ctx) {
  const ids = [...new Set([...ctx.created, ...ctx.altered])].filter((id) => locate(ed.objects, id));
  const MAX = 60;
  const out = {
    ok: true,
    criados: ctx.created.filter((id) => locate(ed.objects, id)),
    alterados: [...ctx.altered].filter((id) => !ctx.created.includes(id) && locate(ed.objects, id)),
    excluidos: ctx.deleted,
  };
  if (Object.keys(ctx.refs).length) out.refs = Object.fromEntries(Object.entries(ctx.refs).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
  out.objetos = ids.slice(0, MAX).map((id) => describeOne(ed, id));
  if (ids.length > MAX) out.mais = ids.length - MAX;
  if (ctx.encaixes.length) out.encaixes = ctx.encaixes;
  if (ctx.avisos.length) out.avisos = ctx.avisos;
  return out;
}

// pedido que altera: um comando só (name) ou lote; roda em batch com validação no fim
export function mutate(ed, name, args, files = {}) {
  const ctx = newCtx();
  ed.batch(
    () => {
      if (name === 'lote') {
        checkKeys(args, ['comandos'], 'lote');
        const list = args.comandos;
        if (!Array.isArray(list) || !list.length) fail('lote precisa de "comandos": uma lista de { "cmd": ..., ...args }.', { exemplo: EXAMPLES.lote });
        if (list.length > 2000) fail('lote aceita até 2000 comandos.');
        list.forEach((item, i) => runOne(ed, ctx, item, i, files, true));
      } else {
        runOne(ed, ctx, { cmd: name, args }, 0, files, false);
      }
    },
    { validate: validateProject },
  );
  return { ...summary(ed, ctx), _ctx: ctx };
}

// comandos do código livre (Worker) aplicados como um lote
export function applyQueued(ed, comandos) {
  return mutate(ed, 'lote', { comandos });
}

// ---------------- leitura ----------------

export function medir(ed, args) {
  checkKeys(args, ['a', 'b'], 'medir');
  const ctx = newCtx();
  const read = (v, name) => {
    if (Array.isArray(v)) return { p: vec3(v, name) };
    const loc = findObj(ed, ctx, v, name);
    const f = frameOf(loc.chain);
    return { p: toUser(centerWorld(loc.o, f)), box: userBox(worldBox(loc.o, f)), id: loc.o.id };
  };
  if (args.a == null || args.b == null) fail('medir precisa de "a" e "b": ids ou pontos [X, Y, Z].', { exemplo: { a: '<id>', b: [0, 0, 0] } });
  const A = read(args.a, 'a');
  const B = read(args.b, 'b');
  const delta = [0, 1, 2].map((k) => r2(B.p[k] - A.p[k]));
  const out = { ok: true, distancia: r2(Math.hypot(...delta)), delta };
  if (A.box && B.box) {
    // folga por eixo entre as caixas: > 0 separadas, 0 encostadas, < 0 sobrepostas
    out.folga = [0, 1, 2].map((k) => r2(Math.max(A.box.min[k] - B.box.max[k], B.box.min[k] - A.box.max[k])));
    out.sobrepostos = out.folga.every((g) => g < 0);
    out.encostados = !out.sobrepostos && out.folga.every((g) => g <= 0.01) && out.folga.some((g) => Math.abs(g) <= 0.01);
  }
  return out;
}

// STL binário de ids (ou de tudo); furos soltos e ocultos não saem, como no Exportar
export function stl(ed, args) {
  checkKeys(args, ['caminho', 'ids'], 'exportar_stl');
  const ctx = newCtx();
  const list = args.ids == null ? ed.objects : topLevel(ed, ctx, args.ids, 'exportar_stl');
  const group = new THREE.Group();
  let tris = 0;
  for (const o of list) {
    if (o.hidden || o.hole) continue;
    const src = ed.meshes.get(o.id);
    if (!src) continue;
    const m = new THREE.Mesh(src.geometry);
    m.applyMatrix4(src.matrixWorld);
    group.add(m);
    tris += src.geometry.attributes.position.count / 3;
  }
  if (!group.children.length) fail('Nada para exportar: só sólidos visíveis saem no STL (furo solto não).');
  group.rotation.x = Math.PI / 2; // Y para cima -> Z para cima, como no Exportar
  group.updateMatrixWorld(true);
  const dv = new STLExporter().parse(group, { binary: true });
  return { ok: true, objetos: group.children.length, triangulos: Math.round(tris), stl: dv.buffer };
}

// 3MF de ids (ou de tudo): uma peça por objeto do topo, com a cor dela (src/exportar3mf.js); o main
// grava os bytes (tresmf) no caminho .3mf do agente
export async function tresMF(ed, args) {
  checkKeys(args, ['caminho', 'ids'], 'exportar_3mf');
  const ctx = newCtx();
  const list = args.ids == null ? ed.objects : topLevel(ed, ctx, args.ids, 'exportar_3mf');
  const res = await build3MF(ed, list);
  if (!res) fail('Nada para exportar: só sólidos visíveis saem no 3MF (furo solto não).');
  return { ok: true, objetos: res.objetos, pecas: res.resumo.map((p) => ({ nome: p.nome, triangulos: p.triangulos })), cores: res.cores, tresmf: res.dados };
}

export { describeOne, locate, frameOf, groupFrame, geometryOf, frameQuat, snapshotChain, renormalize, worldBox as dataWorldBox, userBox };
