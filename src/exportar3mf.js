import * as THREE from 'three';
import { zipFiles } from './zip.js';

// Exportar .3MF (padrão core do 3MF Consortium) com cada peça separada e com a sua cor, para a
// impressão multicor (AMS) no Bambu Studio / OrcaSlicer. Fonte das cores no Bambu:
// https://wiki.bambulab.com/en/bambu-studio/Standard-3MF-File-Color-Parsing
//  - um <object> por peça do topo do projeto, com os grupos já resolvidos pela booleana (a malha da
//    cena); furos soltos e peças ocultas não saem, como no STL;
//  - cor por <basematerials>: cada cor distinta vira um <base displaycolor>, na ordem em que aparece
//    no projeto (o Bambu liga grupo de cor → slot do AMS pela ordem, então a ordem é estável);
//    a peça de uma cor só leva pid/pindex no <object>; o grupo multicolorido leva a cor por triângulo;
//  - mm, Z para cima (sistema do usuário, src/coords.js), vértices no centro da própria peça e a
//    posição no <item transform>, com a origem no canto da mesa (X + largura/2, Y + comprimento/2),
//    como a mesa dos fatiadores; o nome do objeto é o nome da peça.

const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const Q = 1e4; // vértices iguais até 0,0001 mm viram o mesmo (malha fechada para o fatiador)

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const num = (v) => String(Math.round(v * Q) / Q);

// Uma peça: triângulos soltos (Float32Array, sistema do usuário) e a cor de cada triângulo
// (índice na lista de cores). Devolve o XML do <object> e a caixa (para o transform).
function objectXml(id, parte, pid) {
  const { tris, cores } = parte;
  const n = tris.length / 9;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < min[k]) min[k] = tris[i + k];
      if (tris[i + k] > max[k]) max[k] = tris[i + k];
    }
  }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  c[2] = min[2]; // origem da peça na base: o fatiador apoia pela base
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
    faces.push(single ? `<triangle v1="${a}" v2="${b}" v3="${d}"/>` : `<triangle v1="${a}" v2="${b}" v3="${d}" pid="${pid}" p1="${cores[t]}"/>`);
  }
  const color = single ? ` pid="${pid}" pindex="${cores ? cores[0] : parte.cor}"` : ` pid="${pid}" pindex="${cores[0]}"`;
  const xml = `<object id="${id}" type="model" name="${esc(parte.nome)}"${color}><mesh><vertices>${verts.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh></object>`;
  return { xml, origem: c, triangulos: faces.length, vertices: verts.length };
}

// { titulo, partes: [{ nome, tris, cores?: Uint16Array, cor?: índice }], cores: ['#rrggbb'], mesa: { w, l } }
// -> { arquivos: [{ nome, dados }], resumo }
export function model3MF({ titulo, partes, cores, mesa, app = 'Forgia' }) {
  const pid = 1;
  const objs = [];
  const items = [];
  const resumo = [];
  partes.forEach((p, i) => {
    const id = i + 2;
    const o = objectXml(id, p, pid);
    if (!o.triangulos) return;
    objs.push(o.xml);
    const tx = o.origem[0] + mesa.w / 2;
    const ty = o.origem[1] + mesa.l / 2;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} ${num(o.origem[2])}"/>`);
    resumo.push({ nome: p.nome, triangulos: o.triangulos, vertices: o.vertices });
  });
  const bases = cores.map((hex) => `<base name="${hex.toUpperCase()}" displaycolor="${hex.toUpperCase()}"/>`).join('');
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="pt-BR" xmlns="${NS}">` +
    `<metadata name="Title">${esc(titulo)}</metadata><metadata name="Application">${esc(app)}</metadata>` +
    `<resources><basematerials id="${pid}">${bases}</basematerials>${objs.join('')}</resources>` +
    `<build>${items.join('')}</build></model>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return {
    arquivos: [
      { nome: '[Content_Types].xml', dados: types },
      { nome: '_rels/.rels', dados: rels },
      { nome: '3D/3dmodel.model', dados: model },
    ],
    resumo,
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
