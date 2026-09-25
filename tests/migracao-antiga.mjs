// Prepara um perfil "antigo" (Fase C, projeto e malhas só no localStorage: forgia.design.v1 e
// forgia.meshes.v1) com o exe ANTERIOR à Fase D, para testar a migração sem perda.
//   FORGIA_EXE_ANTIGO=release\fase-c\win-unpacked\Forgia.exe node tests/migracao-antiga.mjs <pasta>
// Grava em <pasta>\perfil (o --user-data-dir) e <pasta>\antes.json (o que o exe antigo tinha).
// Perfil temporário sempre: nunca %APPDATA%\Forgia.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Forgia, bridgeRequest, ROOT } from './forgia-exe.mjs';

// esfera UV em STL binário (Z para cima), n faixas × 2n gomos → 4n² triângulos
export function stlEsfera(file, raio = 15, n = 70) {
  const tris = [];
  const p = (i, j) => {
    const th = (Math.PI * i) / n;
    const ph = (2 * Math.PI * j) / (2 * n);
    return [raio * Math.sin(th) * Math.cos(ph), raio * Math.sin(th) * Math.sin(ph), raio * Math.cos(th)];
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2 * n; j++) {
      const a = p(i, j);
      const b = p(i + 1, j);
      const c = p(i + 1, j + 1);
      const d = p(i, j + 1);
      tris.push([a, b, c], [a, c, d]);
    }
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, k) => {
    let o = 84 + k * 50 + 12;
    for (const v of t) for (const c of v) (buf.writeFloatLE(c, o), (o += 4));
  });
  fs.writeFileSync(file, buf);
  return tris.length;
}

export async function prepararPerfilAntigo(exe, pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  const perfil = path.join(pasta, 'perfil');
  fs.rmSync(perfil, { recursive: true, force: true });
  fs.mkdirSync(perfil);
  const stl = path.join(pasta, 'bola.stl');
  const triangulos = stlEsfera(stl);
  const app = await Forgia.open(exe, perfil);
  try {
    const cmd = (c, args) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args });
    const lote = await cmd('lote', {
      comandos: [
        { cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [60, 40, 10], cor: '#1b8bd2', nome: 'base' },
        { cmd: 'criar', ref: 'pino', tipo: 'cilindro', medidas: [12, 12, 20], sobre: '$base', cor: '#1b8bd2', nome: 'pino' },
        { cmd: 'agrupar', ids: ['$base', '$pino'], nome: 'suporte antigo', ref: 'g' },
        { cmd: 'criar', tipo: 'texto', params: { texto: 'OLA' }, medidas: [null, 8, 3], centro: [0, -40, null], cor: '#e3302d', nome: 'etiqueta' },
      ],
    });
    if (!lote.json || !lote.json.ok) throw new Error('lote falhou: ' + JSON.stringify(lote.json));
    const imp = await cmd('importar', { caminho: stl, nome: 'bola antiga', centro: [60, 30, null] });
    if (!imp.json || !imp.json.ok) throw new Error('importar falhou: ' + JSON.stringify(imp.json));
    const est = await cmd('estado', {});
    const ls = await app.js(`(() => {
      const d = localStorage.getItem('forgia.design.v1') || '';
      const m = localStorage.getItem('forgia.meshes.v1') || '';
      return { design: d.length, meshes: m.length, refs: Object.keys(JSON.parse(m || '{}')), nome: JSON.parse(d || '{}').name, objetos: (JSON.parse(d || '{}').objects || []).length };
    })()`);
    if (!ls.meshes || !ls.refs.length) throw new Error('a malha não foi para o localStorage do exe antigo');
    const antes = {
      exe,
      triangulos,
      localStorage: ls,
      objetos: est.json.objetos.map((o) => ({ id: o.id, nome: o.nome, tipo: o.tipo, medidas: o.medidas, centro: o.centro, cor: o.cor })),
    };
    fs.writeFileSync(path.join(pasta, 'antes.json'), JSON.stringify(antes, null, 2));
    return { perfil, antes };
  } finally {
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const exe = process.env.FORGIA_EXE_ANTIGO ? path.resolve(ROOT, process.env.FORGIA_EXE_ANTIGO) : null;
  const pasta = process.argv[2];
  if (!exe || !fs.existsSync(exe) || !pasta) {
    console.error('uso: FORGIA_EXE_ANTIGO=<exe da Fase C> node tests/migracao-antiga.mjs <pasta temporária>');
    process.exit(2);
  }
  const { antes } = await prepararPerfilAntigo(exe, path.resolve(pasta));
  console.log(JSON.stringify(antes, null, 2));
}
