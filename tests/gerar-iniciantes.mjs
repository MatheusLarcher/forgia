// Gera os Iniciantes do projeto (public/iniciantes/*.json) montando cada cena no próprio Forgia.exe
// pela ponte (lote de criar/agrupar, no sistema do usuário: mm, Z para cima), só com formas do
// Forgia. Grava o grupo do topo como arquivo de projeto (formato forgia.projeto, versão 1).
// São as mesmas cenas das dicas animadas da Fase E.
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe node tests/gerar-iniciantes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, exePath, tempProfile, bridgeRequest, ROOT } from './forgia-exe.mjs';

const OUT = path.join(ROOT, 'public', 'iniciantes');

const fins = () =>
  [0, 1, 2].map((k) => {
    const phi = 90 + 120 * k;
    const a = (phi * Math.PI) / 180;
    return { cmd: 'criar', ref: `aleta${k}`, tipo: 'cunha', medidas: [3, 16, 22], centro: [18 * Math.cos(a), 18 * Math.sin(a), null], base_z: 0, rotacao: [0, 0, phi + 90], cor: '#e3302d', nome: `aleta ${k + 1}` };
  });

const CENAS = {
  chaveiro: {
    nome: 'Chaveiro com nome',
    comandos: [
      { cmd: 'criar', ref: 'placa', tipo: 'caixa', medidas: [64, 20, 3], params: { raio: 1.4 }, centro: [4, 0, null], base_z: 0, cor: '#1b8bd2', nome: 'placa' },
      { cmd: 'criar', ref: 'argola', tipo: 'tubo', medidas: [14, 14, 3], params: { parede: 3.5 }, centro: [-30, 0, null], base_z: 0, cor: '#1b8bd2', nome: 'argola' },
      { cmd: 'criar', ref: 'furo', tipo: 'cilindro', medidas: [7, 7, 3], furo: true, centro: [-30, 0, null], base_z: 0, nome: 'furo da argola' },
      { cmd: 'criar', ref: 'nome', tipo: 'texto', params: { texto: 'FORGIA' }, medidas: [null, 11, 1.6], centro: [8, 0, null], base_z: 3, cor: '#ffffff', nome: 'nome' },
      { cmd: 'agrupar', ids: ['$placa', '$argola', '$furo', '$nome'], nome: 'Chaveiro com nome' },
    ],
  },
  'suporte-celular': {
    nome: 'Suporte de celular',
    comandos: [
      { cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [70, 80, 5], params: { raio: 1.5 }, centro: [0, 0, null], base_z: 0, cor: '#f38a00', nome: 'base' },
      { cmd: 'criar', ref: 'encosto', tipo: 'caixa', medidas: [70, 6, 78], params: { raio: 1.5 }, rotacao: [-20, 0, 0], centro: [0, 13, 39], cor: '#f38a00', nome: 'encosto' },
      { cmd: 'criar', ref: 'apoio', tipo: 'caixa', medidas: [70, 8, 14], params: { raio: 1.5 }, centro: [0, -28, null], base_z: 0, cor: '#f38a00', nome: 'apoio da frente' },
      { cmd: 'criar', ref: 'reforco', tipo: 'cunha', medidas: [60, 30, 22], centro: [0, 20, null], base_z: 0, rotacao: [0, 0, 180], cor: '#f38a00', nome: 'reforço' },
      { cmd: 'criar', ref: 'cabo', tipo: 'caixa', medidas: [20, 16, 20], furo: true, centro: [0, -28, null], base_z: 3, nome: 'passagem do cabo' },
      { cmd: 'agrupar', ids: ['$base', '$encosto', '$apoio', '$reforco', '$cabo'], nome: 'Suporte de celular' },
    ],
  },
  'caixa-com-tampa': {
    nome: 'Caixa com tampa',
    comandos: [
      { cmd: 'criar', ref: 'corpo', tipo: 'caixa', medidas: [60, 40, 25], params: { raio: 1 }, centro: [-35, 0, null], base_z: 0, cor: '#3fb34f', nome: 'corpo' },
      { cmd: 'criar', ref: 'vao', tipo: 'caixa', medidas: [56, 36, 24], furo: true, centro: [-35, 0, null], base_z: 2, nome: 'vão' },
      { cmd: 'agrupar', ids: ['$corpo', '$vao'], nome: 'caixa', ref: 'caixa' },
      { cmd: 'criar', ref: 'placa', tipo: 'caixa', medidas: [60, 40, 2], params: { raio: 1 }, centro: [35, 0, null], base_z: 0, cor: '#f7c511', nome: 'placa da tampa' },
      { cmd: 'criar', ref: 'aba', tipo: 'caixa', medidas: [55.5, 35.5, 4], centro: [35, 0, null], base_z: 2, cor: '#f7c511', nome: 'aba (0,25 mm de folga)' },
      { cmd: 'criar', ref: 'vaoaba', tipo: 'caixa', medidas: [51.5, 31.5, 4], furo: true, centro: [35, 0, null], base_z: 2, nome: 'miolo da aba' },
      { cmd: 'agrupar', ids: ['$placa', '$aba', '$vaoaba'], nome: 'tampa', ref: 'tampa' },
      { cmd: 'agrupar', ids: ['$caixa', '$tampa'], nome: 'Caixa com tampa' },
    ],
  },
  'boneco-de-neve': {
    nome: 'Boneco de neve',
    comandos: [
      { cmd: 'criar', ref: 'b1', tipo: 'esfera', medidas: [36, 36, 36], params: { passos: 40 }, centro: [0, 0, 16], cor: '#ffffff', nome: 'corpo de baixo' },
      { cmd: 'criar', ref: 'b2', tipo: 'esfera', medidas: [28, 28, 28], params: { passos: 40 }, centro: [0, 0, 42], cor: '#ffffff', nome: 'corpo do meio' },
      { cmd: 'criar', ref: 'b3', tipo: 'esfera', medidas: [20, 20, 20], params: { passos: 40 }, centro: [0, 0, 62], cor: '#ffffff', nome: 'cabeça' },
      { cmd: 'criar', ref: 'chao', tipo: 'caixa', medidas: [40, 40, 2], furo: true, centro: [0, 0, -1], nome: 'base reta' },
      { cmd: 'criar', ref: 'olho1', tipo: 'esfera', medidas: [3, 3, 3], centro: [-3.5, -8.6, 65], cor: '#1d1f22', nome: 'olho' },
      { cmd: 'criar', ref: 'olho2', tipo: 'esfera', medidas: [3, 3, 3], centro: [3.5, -8.6, 65], cor: '#1d1f22', nome: 'olho' },
      { cmd: 'criar', ref: 'nariz', tipo: 'cone', medidas: [4, 4, 10], rotacao: [90, 0, 0], centro: [0, -13, 62], cor: '#f38a00', nome: 'nariz' },
      { cmd: 'criar', ref: 'botao1', tipo: 'esfera', medidas: [3.5, 3.5, 3.5], centro: [0, -13.5, 46], cor: '#1d1f22', nome: 'botão' },
      { cmd: 'criar', ref: 'botao2', tipo: 'esfera', medidas: [3.5, 3.5, 3.5], centro: [0, -13.8, 40], cor: '#1d1f22', nome: 'botão' },
      { cmd: 'criar', ref: 'botao3', tipo: 'esfera', medidas: [3.5, 3.5, 3.5], centro: [0, -17.3, 22], cor: '#1d1f22', nome: 'botão' },
      { cmd: 'criar', ref: 'cachecol', tipo: 'toroide', medidas: [22, 22, 5], params: { espessura: 5 }, centro: [0, 0, 53], cor: '#e3302d', nome: 'cachecol' },
      { cmd: 'criar', ref: 'aba', tipo: 'cilindro', medidas: [22, 22, 2], params: { lados: 48 }, centro: [0, 0, 71], cor: '#1d1f22', nome: 'aba do chapéu' },
      { cmd: 'criar', ref: 'copa', tipo: 'cilindro', medidas: [14, 14, 12], params: { lados: 48 }, centro: [0, 0, 78], cor: '#1d1f22', nome: 'copa do chapéu' },
      { cmd: 'agrupar', ids: ['$b1', '$b2', '$b3', '$chao', '$olho1', '$olho2', '$nariz', '$botao1', '$botao2', '$botao3', '$cachecol', '$aba', '$copa'], nome: 'Boneco de neve' },
    ],
  },
  foguete: {
    nome: 'Foguete',
    comandos: [
      { cmd: 'criar', ref: 'motor', tipo: 'cone', medidas: [14, 14, 7], params: { raio_topo: 4, lados: 40 }, centro: [0, 0, null], base_z: 0, cor: '#4a4f55', nome: 'motor' },
      { cmd: 'criar', ref: 'corpo', tipo: 'cilindro', medidas: [20, 20, 50], params: { lados: 48 }, centro: [0, 0, null], base_z: 6, cor: '#c8ccd0', nome: 'corpo' },
      { cmd: 'criar', ref: 'bico', tipo: 'paraboloide', medidas: [20, 20, 22], params: { lados: 48 }, centro: [0, 0, null], base_z: 56, cor: '#e3302d', nome: 'bico' },
      { cmd: 'criar', ref: 'janela', tipo: 'cilindro', medidas: [9, 9, 2], params: { lados: 32 }, rotacao: [90, 0, 0], centro: [0, -10, 40], cor: '#4fb3e8', nome: 'janela' },
      { cmd: 'criar', ref: 'faixa', tipo: 'cilindro', medidas: [21, 21, 3], params: { lados: 48 }, centro: [0, 0, null], base_z: 24, cor: '#e3302d', nome: 'faixa' },
      ...fins(),
      { cmd: 'agrupar', ids: ['$motor', '$corpo', '$bico', '$janela', '$faixa', '$aleta0', '$aleta1', '$aleta2'], nome: 'Foguete' },
    ],
  },
};

const exe = exePath();
if (!exe) {
  console.error('defina FORGIA_EXE');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const app = await Forgia.open(exe, tempProfile('forgia-iniciantes-'));
try {
  for (const [arquivo, cena] of Object.entries(CENAS)) {
    await app.js('(forgia.editor.loadProject(null), true)');
    const r = await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: 'lote', args: { comandos: cena.comandos } }).then((x) => x.json);
    if (!r || !r.ok) throw new Error(`${arquivo}: ${JSON.stringify(r)}`);
    // o grupo vai para o centro da mesa, apoiado nela
    const objects = await app.js(`(() => { const ed = forgia.editor; const g = ed.objects[0]; const b = ed.worldBox(g); g.pos = [Math.round((g.pos[0] - (b.min.x + b.max.x) / 2) * 1000) / 1000, Math.round((g.pos[1] - b.min.y) * 1000) / 1000, Math.round((g.pos[2] - (b.min.z + b.max.z) / 2) * 1000) / 1000]; ed.sync(); return JSON.parse(JSON.stringify(ed.objects)); })()`);
    if (objects.length !== 1) throw new Error(`${arquivo}: ${objects.length} objetos no topo`);
    const json = { formato: 'forgia.projeto', versao: 1, app: 'Forgia (iniciante)', projeto: { name: cena.nome, grid: 1, workplane: { w: 255, l: 255, h: 255 }, objects }, malhas: {} };
    fs.writeFileSync(path.join(OUT, arquivo + '.json'), JSON.stringify(json, null, 1) + '\n');
    await app.js(`(forgia.editor.select([forgia.editor.objects[0].id]), forgia.editor.fitView(), true)`);
    await new Promise((res) => setTimeout(res, 900));
    await app.screenshot(path.join(ROOT, 'docs', 'fase-d-evidence', 'iniciantes', arquivo + '.png'));
    console.log(arquivo, 'ok', r.objetos.find((o) => o.nome === cena.nome)?.medidas);
  }
} finally {
  await app.close();
}
