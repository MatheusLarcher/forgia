// Monta o comercial do Forgia (1920x1080, 30 fps) com as gravações reais de docs/media,
// letreiros e a marca. Precisa do ffmpeg no PATH. Uso: node scripts/gerar-comercial.mjs
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const midia = join(raiz, 'docs', 'media')
const trab = join(raiz, '.comercial-tmp')
const saida = join(midia, 'forgia-comercial.mp4')
const LARANJA = '0xFF6A1A'
const GRAFITE = '0x1C1D21'

rmSync(trab, { recursive: true, force: true })
mkdirSync(trab, { recursive: true })
copyFileSync('C:/Windows/Fonts/segoeuib.ttf', join(trab, 'negrito.ttf'))
copyFileSync('C:/Windows/Fonts/segoeuil.ttf', join(trab, 'leve.ttf'))
copyFileSync(join(raiz, 'public', 'branding', 'forgia-forge-v1.png'), join(trab, 'logo.png'))

let n = 0
// texto: { t, size, y, cor, fonte, ini } — aparece com fade em `ini` segundos.
function drawtext(tx) {
  const arq = `t${++n}.txt`
  writeFileSync(join(trab, arq), tx.t, 'utf8')
  const ini = tx.ini ?? 0.2
  const cor = tx.cor ?? '0xF2F2F2'
  return `drawtext=fontfile=${tx.fonte === 'leve' ? 'leve' : 'negrito'}.ttf:textfile=${arq}:fontsize=${tx.size}` +
    `:fontcolor=${cor}:x=(w-text_w)/2:y=${tx.y}:alpha='clip((t-${ini})/0.5,0,1)'`
}

function rodar(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: trab, encoding: 'utf8' })
  if (r.status !== 0) { console.error(r.stderr); process.exit(1) }
}

const CODEC = ['-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p']

// Segmento com uma gravação de tela centralizada, moldura laranja e letreiros.
function segGravacao(nome, arquivo, dur, largura, proporcao, textos) {
  const alt = Math.round(largura * proporcao)
  const x = Math.round((1920 - largura) / 2)
  const y = 1080 - alt - 60
  const cadeia = [
    `[1:v]fps=30,scale=${largura}:${alt}:flags=lanczos,format=rgba[g]`,
    `[0:v][g]overlay=${x}:${y}:shortest=1[c]`,
    `[c]drawbox=x=${x - 3}:y=${y - 3}:w=${largura + 6}:h=${alt + 6}:color=${LARANJA}@0.75:t=3,` +
      `${textos.map(drawtext).join(',')},fade=t=in:st=0:d=0.4,fade=t=out:st=${dur - 0.4}:d=0.4[v]`,
  ].join(';')
  rodar([
    '-f', 'lavfi', '-i', `color=c=${GRAFITE}:s=1920x1080:r=30:d=${dur}`,
    '-ignore_loop', '0', '-i', arquivo,
    '-filter_complex', cadeia, '-map', '[v]', '-t', String(dur), ...CODEC, `${nome}.mp4`,
  ])
}

// Segmento só de texto (e logo opcional).
function segTexto(nome, dur, textos, logo = false) {
  const entradas = ['-f', 'lavfi', '-i', `color=c=${GRAFITE}:s=1920x1080:r=30:d=${dur}`]
  let base = '[0:v]'
  const filtros = []
  if (logo) {
    entradas.push('-loop', '1', '-t', String(dur), '-i', 'logo.png')
    filtros.push(`[1:v]scale=-1:230,format=rgba,fade=t=in:st=0.1:d=0.6:alpha=1[l]`)
    filtros.push(`${base}[l]overlay=(W-w)/2:180[b]`)
    base = '[b]'
  }
  filtros.push(`${base}${textos.map(drawtext).join(',')},fade=t=in:st=0:d=0.4,fade=t=out:st=${dur - 0.4}:d=0.4[v]`)
  rodar([...entradas, '-filter_complex', filtros.join(';'), '-map', '[v]', '-t', String(dur), ...CODEC, `${nome}.mp4`])
}

const g = (f) => join(midia, f).replaceAll('\\', '/')
const T = (t, size, y, extra = {}) => ({ t, size, y, ...extra })
const SUB = { cor: '0xBDBDBD', fonte: 'leve', ini: 0.6 }

segTexto('s01', 4, [
  T('Forgia', 150, 470),
  T('Da ideia à peça.', 64, 660, { cor: LARANJA, fonte: 'leve', ini: 0.9 }),
], true)
segTexto('s02', 4.5, [
  T('Modelar para imprimir em 3D parece difícil.', 72, 400),
  T('Não precisa ser.', 110, 560, { cor: LARANJA, ini: 1.8 }),
])
segGravacao('s03', g('ia-chaveiro.gif'), 10.7, 1200, 607 / 960, [
  T('Peça para a IA. Em português.', 68, 70),
  T('Claude ou GPT montam a peça na sua mesa, em milímetros.', 34, 165, SUB),
])
segGravacao('s04', g('arrastar.gif'), 8, 1200, 607 / 960, [
  T('Ou arraste formas e monte sua peça.', 68, 70),
  T('Clique no número da medida e digite. Qualquer forma vira furo.', 34, 165, SUB),
])
segGravacao('s05', g('encaixe.gif'), 5.5, 1000, 0.75, [
  T('Encaixes com folga, prontos para imprimir.', 68, 70),
  T('Um parafuso M8 vira um furo do tamanho certo.', 34, 165, SUB),
])
segGravacao('s06', g('exportar.gif'), 7.4, 1200, 607 / 960, [
  T('Exporte em STL ou 3MF, com as cores.', 68, 70),
  T('Abra no Bambu Studio, OrcaSlicer, PrusaSlicer ou Cura.', 34, 165, SUB),
])
segTexto('s07', 5, [
  T('Grátis.', 120, 250, { ini: 0.2 }),
  T('Funciona offline.', 120, 410, { ini: 0.9 }),
  T('Sem conta. Sem nuvem.', 120, 570, { ini: 1.6 }),
  T('Tudo em português.', 120, 730, { cor: LARANJA, ini: 2.3 }),
])
segTexto('s08', 5, [
  T('Forgia', 150, 470),
  T('Da ideia à peça.', 64, 660, { cor: LARANJA, fonte: 'leve', ini: 0.5 }),
  T('Baixe grátis para Windows 10 e 11', 40, 800, { cor: '0xBDBDBD', fonte: 'leve', ini: 1.2 }),
], true)

const nomes = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08']
writeFileSync(join(trab, 'lista.txt'), nomes.map((s) => `file '${s}.mp4'`).join('\n'))
rodar(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', '-movflags', '+faststart', saida])
rmSync(trab, { recursive: true, force: true })
console.log('OK', saida)
