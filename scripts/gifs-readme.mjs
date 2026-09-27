// Mídias do README (docs/media/*.gif e o vídeo de apresentação) a partir das gravações do modo
// gravação. Usa o ffmpeg DA MÁQUINA (não é dependência do projeto): FFMPEG=<caminho do ffmpeg.exe>,
// ou "ffmpeg" no PATH. Passos para regravar tudo:
//   npm run gravar-dicas                                     (as dicas: public/ajuda/*.webm)
//   npm run gravar-dicas -- --roteiros=docs/media/roteiros --temas=claro --saida=docs/fase-e-evidence/readme-video
//   node scripts/gifs-readme.mjs [--so=encaixe,importar]
// As gravações intermediárias do README ficam em docs/fase-e-evidence/readme-video (fora do Git).
//
// Regra (do usuário): NÃO perder qualidade. Todo texto dentro do GIF (legenda, selo, cota, botão)
// tem que se ler no tamanho exibido no README, no computador e no celular. Por isso cada GIF sai na
// LARGURA ORIGINAL da gravação (README 960 px, dicas 640 px; o README exibe menor e telas de alta
// densidade aproveitam os pixels a mais) e o tamanho só cai sem perda: quadros repetidos (tempo
// parado) viram um quadro mais longo (mpdecimate + tempo variável) e só o retângulo que muda é
// regravado. ~3 MB por GIF é referência, não limite: legibilidade vem antes do tamanho.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FF = process.env.FFMPEG || 'ffmpeg';
const VIDEO = path.join(ROOT, 'docs', 'fase-e-evidence', 'readme-video');
const AJUDA = path.join(ROOT, 'public', 'ajuda');
const OUT = path.join(ROOT, 'docs', 'media');
const REFERENCIA = 3 * 1024 * 1024;

// ruído da compressão da gravação (VP9) some só no TEMPO (hqdn3d sem parte espacial: nada borra):
// sem ele, quase todo quadro "muda" um pouco e o retângulo regravado cresce (o GIF cai ~pela metade)
const semRuido = 'hqdn3d=0:0:4:4';
// quadros iguais saem; os que ficam guardam o tempo real (-fps_mode vfr na saída)
const semRepetidos = `${semRuido},mpdecimate=hi=64*12:lo=64*5:frac=0.33`;
// paleta própria por GIF (só 2 passagens do ffmpeg), pontilhado leve e só o retângulo que muda
const gif = 'split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
const paleta = (fps) => `fps=${fps},${semRepetidos},${gif}`;

// Conectar IA com Claude e Codex: gravação da tela de verdade (Forgia instalado + app do agente,
// ffmpeg gdigrab), cortada e legendada à mão: colar o texto, o agente ligar o Forgia e criar o cubo.
// Um arquivo só para os dois temas (o app do agente tem o tema dele).
const REAIS = new Set(['claude', 'codex']);
const conectarFonte = (a, tema) => path.join(VIDEO, REAIS.has(a) ? `conectar-${a}-real.mp4` : `conectar-${a}-${tema}.webm`);

const GIFS = [
  { nome: 'ia-chaveiro.gif', entradas: [path.join(VIDEO, 'ia-chaveiro-claro.webm')], filtro: paleta(10) },
  { nome: 'arrastar.gif', entradas: [path.join(VIDEO, 'arrastar-claro.webm')], filtro: paleta(10) },
  { nome: 'importar.gif', entradas: [path.join(VIDEO, 'importar-claro.webm')], filtro: paleta(10) },
  { nome: 'exportar.gif', entradas: [path.join(VIDEO, 'exportar-claro.webm')], filtro: paleta(10) },
  // Conectar IA: um por agente (o Cursor fica de fora por enquanto); Claude e Codex vêm das
  // gravações reais (veja REAIS)
  ...['agentcode', 'claude', 'codex', 'outro'].map((a) => ({ nome: `conectar-${a}.gif`, entradas: [conectarFonte(a, 'claro')], filtro: paleta(10) })),
  { nome: 'desenhar.gif', entradas: [path.join(AJUDA, 'draw-claro.webm')], filtro: paleta(12) },
  { nome: 'marcar.gif', entradas: [path.join(VIDEO, 'marcar-claro.webm')], filtro: paleta(10) },
  { nome: 'encaixe.gif', entradas: [path.join(AJUDA, 'encaixe-claro.webm')], filtro: paleta(12) },
  {
    nome: 'cruzeiro-medir.gif',
    entradas: [path.join(AJUDA, 'cruise-claro.webm'), path.join(AJUDA, 'measure-claro.webm')],
    complexo: `[0:v]fps=12[a];[1:v]fps=12[b];[a][b]hstack=inputs=2,${semRepetidos},${gif}`,
  },
];

function run(args) {
  const r = spawnSync(FF, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg não encontrado (${FF}): defina FFMPEG com o caminho do ffmpeg.exe`);
  if (r.status !== 0) throw new Error(r.stderr);
}

fs.mkdirSync(OUT, { recursive: true });
const so = process.argv.find((a) => a.startsWith('--so='));
const lista = so ? GIFS.filter((g) => so.slice(5).split(',').includes(g.nome.replace(/\.gif$/, ''))) : GIFS;
for (const g of lista) {
  for (const e of g.entradas) if (!fs.existsSync(e)) throw new Error(`falta a gravação ${path.relative(ROOT, e)}: rode o npm run gravar-dicas (veja o topo deste arquivo)`);
  const out = path.join(OUT, g.nome);
  const ins = g.entradas.flatMap((e) => ['-i', e]);
  run([...ins, ...(g.complexo ? ['-filter_complex', g.complexo] : ['-vf', g.filtro]), '-fps_mode', 'vfr', '-loop', '0', out]);
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`${g.nome}: ${kb} KB${kb * 1024 > REFERENCIA ? '  (acima da referência de 3 MB: confira se a nitidez compensa)' : ''}`);
}
// vídeo tutorial de cada aba do Conectar IA, dentro do app (src/conectar.js): as mesmas gravações do
// README, nos dois temas (gravar com --temas=claro,escuro), em VP9 800 px de largura (o diálogo
// mostra ~600 px): public/ajuda/conectar-<agente>-<tema>.webm
if (!so || so.includes('conectar-app')) {
  for (const a of ['agentcode', 'claude', 'codex', 'outro']) {
    for (const tema of ['claro', 'escuro']) {
      const src = conectarFonte(a, tema);
      if (!fs.existsSync(src)) throw new Error(`falta a gravação ${path.relative(ROOT, src)}: grave os conectar-* com --temas=claro,escuro`);
      const out = path.join(AJUDA, `conectar-${a}-${tema}.webm`);
      run(['-i', src, '-vf', 'scale=800:-2:flags=lanczos', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-an', out]);
      console.log(`${path.relative(ROOT, out)}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
    }
  }
}
if (!so) {
  // vídeo de apresentação (link no README): a mesma gravação da IA, em VP9 com qualidade constante
  const apres = path.join(OUT, 'forgia-apresentacao.webm');
  run(['-i', path.join(VIDEO, 'ia-chaveiro-claro.webm'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-an', apres]);
  console.log(`forgia-apresentacao.webm: ${Math.round(fs.statSync(apres).size / 1024)} KB`);
}
