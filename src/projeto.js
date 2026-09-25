import { zipFiles, unzipFiles } from './zip.js';

// Formato do arquivo de projeto .forgia: um ZIP com
//   projeto.json        { formato: 'forgia.projeto', versao: 1, app, salvoEm, projeto, malhas }
//                       projeto = { name, grid, workplane, objects }: os mesmos dados do editor
//                       (editor.projectData()); malhas = { <ref>: { arquivo, triangulos } }
//   malhas/<ref>.bin    posições das malhas importadas: Float32 little-endian, triângulos soltos,
//                       Y para cima (como em params.ref dos objetos 'mesh')
//   miniatura.png       vista do projeto (opcional)
// "versao" muda quando um campo muda de sentido; campo novo entra sem mudar. Arquivo de versão
// mais nova que a deste Forgia é recusado com mensagem (não se abre pela metade).

export const FORMATO = 'forgia.projeto';
export const VERSAO = 1;
export const REF_OK = /^[A-Za-z0-9_-]{1,40}$/;

export class ProjectFileError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind; // 'zip' | 'formato' | 'versao' | 'dados'
    this.detail = detail;
  }
}

// refs de malha usadas pelos objetos (desce nos grupos)
export function meshRefsOf(objects, out = new Set()) {
  for (const o of objects || []) {
    if (o.type === 'mesh' && o.params && o.params.ref) out.add(o.params.ref);
    if (o.children) meshRefsOf(o.children, out);
  }
  return out;
}

const f32Bytes = (arr) => new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);

// data = editor.projectData(); getMesh(ref) -> Float32Array; png = Uint8Array (opcional)
export async function packProject(data, getMesh, { png = null, app = '' } = {}) {
  const malhas = {};
  const entries = [];
  for (const ref of meshRefsOf(data.objects)) {
    const pos = getMesh(ref);
    if (!pos || !REF_OK.test(ref)) continue;
    const arquivo = `malhas/${ref}.bin`;
    malhas[ref] = { arquivo, triangulos: pos.length / 9 };
    entries.push({ nome: arquivo, dados: f32Bytes(pos) });
  }
  const json = { formato: FORMATO, versao: VERSAO, app, salvoEm: new Date().toISOString(), projeto: data, malhas };
  entries.unshift({ nome: 'projeto.json', dados: JSON.stringify(json) });
  if (png) entries.push({ nome: 'miniatura.png', dados: png, comprimir: false });
  return zipFiles(entries);
}

// Uint8Array do .forgia -> { data, meshes: Map<ref, Float32Array>, versao, faltando: [refs] }
export function unpackProject(bytes) {
  let files;
  try {
    files = unzipFiles(bytes);
  } catch (err) {
    throw new ProjectFileError('zip', err.message);
  }
  if (!files['projeto.json']) throw new ProjectFileError('formato');
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(files['projeto.json']));
  } catch (err) {
    throw new ProjectFileError('formato', err.message);
  }
  if (!json || json.formato !== FORMATO) throw new ProjectFileError('formato');
  if (!Number.isInteger(json.versao) || json.versao < 1) throw new ProjectFileError('formato');
  if (json.versao > VERSAO) throw new ProjectFileError('versao', json.versao);
  const data = migrate(json);
  if (!data || !Array.isArray(data.objects)) throw new ProjectFileError('dados');
  const meshes = new Map();
  const faltando = [];
  for (const ref of meshRefsOf(data.objects)) {
    const info = json.malhas && json.malhas[ref];
    const raw = info && REF_OK.test(ref) && files[`malhas/${ref}.bin`];
    if (!raw || raw.byteLength % 36) {
      faltando.push(ref);
      continue;
    }
    // cópia alinhada (o Float32Array pede múltiplo de 4 no início)
    meshes.set(ref, new Float32Array(raw.slice().buffer));
  }
  return { data, meshes, versao: json.versao, faltando, miniatura: files['miniatura.png'] || null };
}

// versões antigas do formato -> dados do editor desta versão (hoje só existe a 1)
function migrate(json) {
  const p = json.projeto;
  if (!p || typeof p !== 'object') return null;
  return {
    name: typeof p.name === 'string' ? p.name : '',
    grid: Number.isFinite(p.grid) ? p.grid : 1,
    workplane: p.workplane && Number.isFinite(p.workplane.w) ? { h: 255, ...p.workplane } : null,
    objects: Array.isArray(p.objects) ? p.objects : [],
  };
}
