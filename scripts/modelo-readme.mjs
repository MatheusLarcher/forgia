// Modelo do GIF "Abra modelos baixados" do README: converte o OBJ do Smithsonian (CC0) num .3MF em
// milímetros para docs/media/modelos/ (o GIF e o roteiro ficam reproduzíveis). Sem dependência
// nova: o ZIP é o src/zip.js do próprio Forgia.
//   node scripts/modelo-readme.mjs --obj=<arquivo.obj> [--saida=docs/media/modelos/triceratops.3mf]
//     [--mm=150] (maior medida) [--cima=y|z] (eixo "para cima" do OBJ; o 3MF é Z para cima)
// O OBJ de origem (ZIP do Smithsonian) fica fora do Git, em docs/fase-e-evidence/modelos/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFiles } from '../src/zip.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
if (!arg.obj) throw new Error('informe --obj=<arquivo.obj>');
const OUT = path.resolve(ROOT, arg.saida || 'docs/media/modelos/triceratops.3mf');
const MM = Number(arg.mm || 150);
const UP = arg.cima || 'y';
const TITLE = arg.titulo || 'Triceratops horridus (Smithsonian, CC0)';

// vértices e faces do OBJ (faces com mais de 3 lados viram leque de triângulos; v/vt/vn -> v)
const v = [];
const f = [];
for (const line of fs.readFileSync(path.resolve(ROOT, arg.obj), 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.trim().split(/\s+/).map(Number);
    v.push(UP === 'y' ? [x, -z, y] : [x, y, z]); // Y para cima -> Z para cima
  } else if (line.startsWith('f ')) {
    const idx = line.trim().split(/\s+/).slice(1).map((s) => {
      const i = parseInt(s, 10);
      return i < 0 ? v.length + i : i - 1;
    });
    for (let k = 1; k + 1 < idx.length; k++) f.push([idx[0], idx[k], idx[k + 1]]);
  }
}
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const p of v) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k]));
const size = max.map((m, k) => m - min[k]);
const s = MM / Math.max(...size);
// centro em X/Y, base em Z = 0, maior medida = MM
const cx = (min[0] + max[0]) / 2;
const cy = (min[1] + max[1]) / 2;
const n = (x) => (Math.round(x * 100) / 100).toString();
const verts = v.map((p) => `<vertex x="${n((p[0] - cx) * s)}" y="${n((p[1] - cy) * s)}" z="${n((p[2] - min[2]) * s)}"/>`).join('');
const tris = f.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('');
const model =
  `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
  `<metadata name="Title">${TITLE}</metadata><metadata name="Designer">Smithsonian Institution</metadata><metadata name="License">CC0 1.0 (domínio público)</metadata>` +
  `<resources><object id="1" type="model" name="Triceratops"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object></resources>` +
  `<build><item objectid="1"/></build></model>`;
const types =
  `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const rels =
  `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
const bytes = await zipFiles([
  { nome: '[Content_Types].xml', dados: types },
  { nome: '_rels/.rels', dados: rels },
  { nome: '3D/3dmodel.model', dados: model },
]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, bytes);
console.log(`${path.relative(ROOT, OUT)}: ${v.length} vértices, ${f.length} triângulos, ${size.map((x) => n(x * s)).join(' × ')} mm, ${Math.round(bytes.length / 1024)} KB`);
