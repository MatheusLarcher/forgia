import * as THREE from 'three';
import { zipFiles } from './zip.js';

// Exportar .3MF (padrão core do 3MF Consortium) com cada peça separada e com a sua cor, para a
// impressão multicor (AMS) no Bambu Studio / OrcaSlicer, no lugar em que está na tela.
//  - uma parte por peça do topo do projeto, com os grupos já resolvidos pela booleana (a malha da
//    cena); furos soltos e peças ocultas não saem, como no STL;
//  - peças que se tocam ou se sobrepõem (caixas envolventes) saem num só objeto com várias partes
//    (<components>): o fatiador apoia cada OBJETO na mesa e o rearranja, então uma peça solta "no
//    ar" (letra em relevo, inserto) caía na mesa e saía do lugar. Dentro de um objeto as partes
//    mantêm a posição entre si. Testado no Bambu Studio (CLI --export-3mf);
//  - cor por <m:colorgroup> (extensão Materials do 3MF): cada cor distinta vira um <m:color>, na
//    ordem em que aparece no projeto; a peça de uma cor só leva pid/pindex no <object>; o grupo
//    multicolorido leva a cor por triângulo (p1). O Bambu/Orca só lê cor de colorgroup (não de
//    <basematerials>; src/libslic3r/Format/bbs_3mf.cpp, tags "m:colorgroup"/"m:color", com esse
//    prefixo exato) e liga cor → filamento pela ordem: 1ª cor = filamento 1;
//  - e, para o Bambu/Orca, o filamento de cada parte em Metadata/model_settings.config (metadata
//    "extruder", mesma ordem) e a cor por triângulo em paint_color (a pintura multicor dele);
//  - mm, Z para cima (sistema do usuário, src/coords.js), vértices em volta da origem do objeto e
//    a posição no <item transform>, com a origem no canto da mesa (X + largura/2, Y + comprimento/2),
//    como a mesa dos fatiadores; o nome do objeto é o da maior peça dele.

const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_M = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const Q = 1e4; // vértices iguais até 0,0001 mm viram o mesmo (malha fechada para o fatiador)
const TOCA = 0.01; // mm: caixas a essa distância contam como encostadas (mesmo objeto)

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const num = (v) => String(Math.round(v * Q) / Q);

// paint_color do Bambu/Orca para um triângulo inteiro do filamento f (1, 2, …): é o
// TriangleSelector serializado em hexadecimal; triângulo sem divisão = 2 bits de divisão (0) e
// o estado; estado ≥ 3 vira "C" mais um nibble com estado − 3 (a string sai invertida)
export function paintColor(f) {
  if (f === 1) return '4';
  if (f === 2) return '8';
  return (f - 3).toString(16).toUpperCase() + 'C';
}

function caixa(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < min[k]) min[k] = tris[i + k];
      if (tris[i + k] > max[k]) max[k] = tris[i + k];
    }
  }
  return { min, max };
}

// cor principal de uma parte (a mais frequente); é o filamento da parte, o resto vai pintado
function corPrincipal(parte) {
  if (!parte.cores) return parte.cor;
  const conta = new Map();
  for (const k of parte.cores) conta.set(k, (conta.get(k) || 0) + 1);
  let best = parte.cores[0];
  for (const [k, n] of conta) if (n > conta.get(best)) best = k;
  return best;
}

// Partes em objetos: caixas que se tocam ou se sobrepõem ficam juntas (união transitiva)
function agrupar(caixas) {
  const pai = caixas.map((_, i) => i);
  const raiz = (i) => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      const a = caixas[i];
      const b = caixas[j];
      if ([0, 1, 2].every((k) => a.min[k] <= b.max[k] + TOCA && b.min[k] <= a.max[k] + TOCA)) pai[raiz(i)] = raiz(j);
    }
  }
  const grupos = new Map();
  caixas.forEach((_, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(i);
  });
  return [...grupos.values()];
}

// Uma peça: triângulos soltos (Float32Array, sistema do usuário) e a cor de cada triângulo
// (índice na lista de cores), com os vértices em volta da origem c do objeto dela.
// Devolve o XML do <object> de malha.
function objectXml(id, parte, pid, c, principal) {
  const { tris, cores } = parte;
  const n = tris.length / 9;
  const index = new Map();
  const verts = [];
  const faces = [];
  const vid = (i) => {
    const x = Math.round((tris[i] - c[0]) * Q);
    const y = Math.round((tris[i + 1] - c[1]) * Q);
    const z = Math.round((tris[i + 2] - c[2]) * Q);
    const key = x + ',' + y + ',' + z;
    let v = index.get(key);
    if (v === undefined) {
      v = verts.length;
      index.set(key, v);
      verts.push(`<vertex x="${String(x / Q)}" y="${String(y / Q)}" z="${String(z / Q)}"/>`);
    }
    return v;
  };
  const single = !cores || cores.every((k) => k === cores[0]);
  for (let t = 0; t < n; t++) {
    const a = vid(t * 9);
    const b = vid(t * 9 + 3);
    const d = vid(t * 9 + 6);
    if (a === b || b === d || a === d) continue; // triângulo degenerado (o 3MF pede vértices distintos)
    if (single) faces.push(`<triangle v1="${a}" v2="${b}" v3="${d}"/>`);
    else {
      const paint = cores[t] === principal ? '' : ` paint_color="${paintColor(cores[t] + 1)}"`;
      faces.push(`<triangle v1="${a}" v2="${b}" v3="${d}" pid="${pid}" p1="${cores[t]}"${paint}/>`);
    }
  }
  const color = ` pid="${pid}" pindex="${principal}"`;
  const xml = `<object id="${id}" type="model" name="${esc(parte.nome)}"${color}><mesh><vertices>${verts.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh></object>`;
  return { xml, triangulos: faces.length, vertices: verts.length };
}

const IDENT = '1 0 0 0 1 0 0 0 1 0 0 0';
const IDENT4 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';

// { titulo, partes: [{ nome, tris, cores?: Uint16Array, cor?: índice }], cores: ['#rrggbb'], mesa: { w, l } }
// -> { arquivos: [{ nome, dados }], resumo, objetos (objetos do fatiador) }
export function model3MF({ titulo, partes, cores, mesa, app = 'Forgia' }) {
  const pid = 1;
  const usadas = partes.filter((p) => p.tris.length >= 9);
  const caixas = usadas.map((p) => caixa(p.tris));
  const vol = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  const malhas = [];
  const montagens = [];
  const items = [];
  const config = [];
  const resumo = [];
  let nextId = 2;
  for (const grupo of agrupar(caixas)) {
    // maior peça primeiro: dá o nome e o filamento do objeto
    grupo.sort((a, b) => vol(caixas[b]) - vol(caixas[a]));
    const min = [0, 1, 2].map((k) => Math.min(...grupo.map((i) => caixas[i].min[k])));
    const max = [0, 1, 2].map((k) => Math.max(...grupo.map((i) => caixas[i].max[k])));
    // origem do objeto: centro em X/Y e base em Z (o fatiador apoia pela base)
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    const comps = [];
    const parts = [];
    for (const i of grupo) {
      const p = usadas[i];
      const principal = corPrincipal(p);
      const id = nextId++;
      const o = objectXml(id, p, pid, c, principal);
      if (!o.triangulos) continue;
      malhas.push(o.xml);
      comps.push(`<component objectid="${id}" transform="${IDENT}"/>`);
      parts.push({ id, nome: p.nome, filamento: principal + 1 });
      resumo.push({ nome: p.nome, triangulos: o.triangulos, vertices: o.vertices });
    }
    if (!comps.length) continue;
    const id = nextId++;
    montagens.push(`<object id="${id}" type="model" name="${esc(parts[0].nome)}"><components>${comps.join('')}</components></object>`);
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(c[0] + mesa.w / 2)} ${num(c[1] + mesa.l / 2)} ${num(c[2])}"/>`);
    const partXml = parts
      .map((p) => `<part id="${p.id}" subtype="normal_part"><metadata key="name" value="${esc(p.nome)}"/><metadata key="matrix" value="${IDENT4}"/><metadata key="extruder" value="${p.filamento}"/></part>`)
      .join('');
    config.push(`<object id="${id}"><metadata key="name" value="${esc(parts[0].nome)}"/><metadata key="extruder" value="${parts[0].filamento}"/>${partXml}</object>`);
  }
  const grupoCores = cores.map((hex) => `<m:color color="${hex.toUpperCase()}"/>`).join('');
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="pt-BR" xmlns="${NS}" xmlns:m="${NS_M}">` +
    `<metadata name="Title">${esc(titulo)}</metadata><metadata name="Application">${esc(app)}</metadata>` +
    `<resources><m:colorgroup id="${pid}">${grupoCores}</m:colorgroup>${malhas.join('')}${montagens.join('')}</resources>` +
    `<build>${items.join('')}</build></model>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>\n<config>${config.join('')}</config>`;
  return {
    arquivos: [
      { nome: '[Content_Types].xml', dados: types },
      { nome: '_rels/.rels', dados: rels },
      { nome: '3D/3dmodel.model', dados: model },
      { nome: 'Metadata/model_settings.config', dados: settings },
    ],
    resumo,
    objetos: items.length,
  };
}

// Peças do editor (malhas da cena, já com a booleana dos grupos) no sistema do usuário.
// objs: lista de objetos do topo (padrão: tudo). Devolve { partes, cores }.
export function partsFromEditor(ed, objs = ed.objects) {
  const cores = [];
  const corIndex = (hex) => {
    const k = (hex || '#c8ccd0').toLowerCase();
    let i = cores.indexOf(k);
    if (i < 0) i = cores.push(k) - 1;
    return i;
  };
  const partes = [];
  const v = new THREE.Vector3();
  for (const o of objs) {
    if (o.hidden || o.hole) continue;
    const mesh = ed.meshes.get(o.id);
    if (!mesh) continue;
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geo.attributes.position;
    const n = pos.count / 3;
    const m = mesh.matrixWorld;
    const flipped = m.determinant() < 0; // espelhado: inverte a ordem para a normal continuar para fora
    const tris = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const src = t * 3 + (flipped && k ? 3 - k : k);
        v.fromBufferAttribute(pos, src).applyMatrix4(m);
        // interno (Y para cima) -> usuário (Z para cima): [x, −z, y]
        tris[t * 9 + k * 3] = v.x;
        tris[t * 9 + k * 3 + 1] = -v.z;
        tris[t * 9 + k * 3 + 2] = v.y;
      }
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hexOf = (mat) => (mat && mat.userData && mat.userData.colorHex) || (mat && mat.color ? '#' + mat.color.getHexString() : null);
    let tcores = null;
    if (mats.length > 1 && geo.groups.length) {
      tcores = new Uint16Array(n);
      const first = corIndex(o.color || hexOf(mats[geo.groups[0].materialIndex || 0]));
      tcores.fill(first);
      for (const g of geo.groups) {
        const ci = corIndex(hexOf(mats[g.materialIndex || 0]));
        const end = Math.min(n, (g.start + g.count) / 3);
        for (let t = g.start / 3; t < end; t++) tcores[t] = ci;
      }
    }
    partes.push({ nome: o.name || o.id, tris, cores: tcores, cor: tcores ? tcores[0] : corIndex(o.color || hexOf(mats[0])) });
  }
  return { partes, cores };
}

// .3MF de ids (ou da seleção, ou de tudo) -> { dados: Uint8Array, objetos, resumo }
export async function build3MF(ed, objs = ed.objects) {
  const { partes, cores } = partsFromEditor(ed, objs);
  if (!partes.length) return null;
  const { arquivos, resumo } = model3MF({ titulo: ed.name, partes, cores, mesa: ed.workplane });
  const dados = await zipFiles(arquivos);
  return { dados, objetos: resumo.length, resumo, cores };
}
