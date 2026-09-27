'use strict';
// Imagem de prévia social do repositório no GitHub (Settings → Social preview): 1280×640, PNG até
// 1 MB (senão JPG), com a marca, "Da ideia à peça." e uma imagem do app. Fundo grafite próprio:
// legível tanto no tema claro quanto no escuro de onde o link for colado. Só entra pela interface
// do GitHub; o arquivo fica em docs/media/previa-social.png.
//   npx electron scripts/previa-social.cjs [--imagem=<png do app>] [--saida=docs/media/previa-social.png]
// A imagem do app padrão é um quadro da gravação do README (o chaveiro pronto, aos 5 s):
//   ffmpeg -ss 5 -i docs/fase-e-evidence/readme-video/ia-chaveiro-claro.webm -frames:v 1 docs/fase-e-evidence/quadros/chaveiro-5.png
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const arg = Object.fromEntries(process.argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const IMG = path.resolve(ROOT, arg.imagem || 'docs/fase-e-evidence/quadros/chaveiro-5.png');
const OUT = path.resolve(ROOT, arg.saida || 'docs/media/previa-social.png');
const W = 1280;
const H = 640;
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-previa-'));
app.setPath('userData', perfil);

const url = (p) => 'file:///' + p.replace(/\\/g, '/');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { background: radial-gradient(120% 120% at 0% 0%, #2b3037 0%, #16181b 60%); color: #f3f4f6; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; align-items: center; }
.texto { width: 470px; padding-left: 72px; flex: none; }
.marca { display: flex; align-items: center; gap: 18px; }
.marca img { width: 84px; height: 84px; }
.marca span { font-size: 66px; font-weight: 700; letter-spacing: -1px; }
.slogan { margin: 26px 0 0; font-size: 40px; font-weight: 700; color: #ff9b37; line-height: 1.1; }
.sub { margin: 22px 0 0; font-size: 25px; line-height: 1.35; color: #d5d9de; }
.selo { display: inline-block; margin-top: 28px; padding: 8px 16px; border-radius: 10px; background: #f58220; color: #fff; font-size: 22px; font-weight: 700; }
.app { position: absolute; right: -40px; top: 70px; width: 760px; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
.app img { display: block; width: 100%; }
</style></head><body>
<div class="texto">
  <div class="marca"><img src="${url(path.join(ROOT, 'public/branding/forgia-forge-v1.svg'))}" alt=""><span>Forgia</span></div>
  <p class="slogan">Da ideia à peça.</p>
  <p class="sub">Editor 3D grátis para Windows, em português, para impressão 3D — com IA (Claude e GPT).</p>
  <span class="selo">Grátis · Windows 10 e 11</span>
</div>
<div class="app"><img src="${url(IMG)}" alt=""></div>
</body></html>`;

app.whenReady().then(async () => {
  let code = 0;
  try {
    if (!fs.existsSync(IMG)) throw new Error(`falta a imagem do app: ${IMG}`);
    const tmp = path.join(perfil, 'previa.html');
    fs.writeFileSync(tmp, html);
    // renderização offscreen: pinta sem janela na tela (capturePage de janela oculta às vezes não
    // volta, e fora da tela a janela nem é pintada)
    const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true, offscreen: true } });
    win.webContents.setFrameRate(10);
    setTimeout(() => (console.error('tempo esgotado na captura'), app.exit(1)), 30000).unref();
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 800));
    let img = await win.webContents.capturePage();
    if (img.isEmpty()) throw new Error('captura vazia');
    const s = img.getSize();
    if (s.width !== W || s.height !== H) img = img.resize({ width: W, height: H, quality: 'best' });
    let data = img.toPNG();
    let out = OUT;
    if (data.length > 1024 * 1024) {
      data = img.toJPEG(90);
      out = OUT.replace(/\.png$/i, '.jpg');
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    console.log(path.relative(ROOT, out), `${W}x${H}`, `${Math.round(data.length / 1024)} KB`);
    win.destroy();
  } catch (err) {
    console.error(err);
    code = 1;
  }
  app.exit(code);
});
app.on('quit', () => fs.rmSync(perfil, { recursive: true, force: true }));
