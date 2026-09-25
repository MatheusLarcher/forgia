// Mídias do README (docs/media/*.gif e o vídeo de apresentação) a partir das gravações do modo
// gravação. Usa o ffmpeg DA MÁQUINA (não é dependência do projeto): FFMPEG=<caminho do ffmpeg.exe>,
// ou "ffmpeg" no PATH. Passos para regravar tudo:
//   npm run gravar-dicas                                     (as dicas: public/ajuda/*.webm)
//   npm run gravar-dicas -- --roteiros=docs/media/roteiros --temas=claro --saida=docs/fase-e-evidence/readme-video
//   node scripts/gifs-readme.mjs
// As gravações intermediárias do README ficam em docs/fase-e-evidence/readme-video (fora do Git).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FF = process.env.FFMPEG || 'ffmpeg';
const VIDEO = path.join(ROOT, 'docs', 'fase-e-evidence', 'readme-video');
const AJUDA = path.join(ROOT, 'public', 'ajuda');
const OUT = path.join(ROOT, 'docs', 'media');
const LIMITE = 8 * 1024 * 1024; // GIF inline no GitHub: até ~8 MB cada

// paleta própria por GIF (só 2 passagens do ffmpeg), pontilhado leve e só o retângulo que muda
const paleta = (w, fps, cores = 128) => `fps=${fps},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${cores}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;

const GIFS = [
  { nome: 'ia-chaveiro.gif', entradas: [path.join(VIDEO, 'ia-chaveiro-claro.webm')], filtro: paleta(720, 10) },
  { nome: 'arrastar.gif', entradas: [path.join(VIDEO, 'arrastar-claro.webm')], filtro: paleta(720, 10) },
  { nome: 'exportar.gif', entradas: [path.join(VIDEO, 'exportar-claro.webm')], filtro: paleta(720, 10) },
  { nome: 'conectar.gif', entradas: [path.join(VIDEO, 'conectar-claro.webm')], filtro: paleta(720, 10) },
  { nome: 'desenhar.gif', entradas: [path.join(AJUDA, 'draw-claro.webm')], filtro: paleta(440, 12) },
  { nome: 'marcar.gif', entradas: [path.join(AJUDA, 'mark-claro.webm')], filtro: paleta(440, 12) },
  { nome: 'encaixe.gif', entradas: [path.join(AJUDA, 'encaixe-claro.webm')], filtro: paleta(440, 12) },
  {
    nome: 'cruzeiro-medir.gif',
    entradas: [path.join(AJUDA, 'cruise-claro.webm'), path.join(AJUDA, 'measure-claro.webm')],
    complexo: `[0:v]fps=12,scale=380:-1:flags=lanczos[a];[1:v]fps=12,scale=380:-1:flags=lanczos[b];[a][b]hstack=inputs=2,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  },
];

function run(args) {
  const r = spawnSync(FF, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg não encontrado (${FF}): defina FFMPEG com o caminho do ffmpeg.exe`);
  if (r.status !== 0) throw new Error(r.stderr);
}

fs.mkdirSync(OUT, { recursive: true });
let erro = false;
for (const g of GIFS) {
  for (const e of g.entradas) if (!fs.existsSync(e)) throw new Error(`falta a gravação ${path.relative(ROOT, e)}: rode o npm run gravar-dicas (veja o topo deste arquivo)`);
  const out = path.join(OUT, g.nome);
  const ins = g.entradas.flatMap((e) => ['-i', e]);
  run([...ins, ...(g.complexo ? ['-filter_complex', g.complexo] : ['-vf', g.filtro]), '-loop', '0', out]);
  const kb = Math.round(fs.statSync(out).size / 1024);
  const passou = kb * 1024 > LIMITE;
  if (passou) erro = true;
  console.log(`${g.nome}: ${kb} KB${passou ? '  (acima de 8 MB!)' : ''}`);
}
// vídeo de apresentação (link no README): a mesma gravação da IA, em VP9 com qualidade constante
const apres = path.join(OUT, 'forgia-apresentacao.webm');
run(['-i', path.join(VIDEO, 'ia-chaveiro-claro.webm'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-an', apres]);
console.log(`forgia-apresentacao.webm: ${Math.round(fs.statSync(apres).size / 1024)} KB`);
process.exit(erro ? 1 : 0);
