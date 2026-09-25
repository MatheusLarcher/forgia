// npm run gravar-dicas: regrava os vídeos das dicas animadas (public/ajuda/<dica>-<tema>.webm) a
// partir dos roteiros (ajuda/roteiros/*.json) e das cenas (ajuda/cenas/*.json), sem passo manual.
// O npm script faz o build do Vite antes; aqui abre o modo gravação (scripts/gravar/principal.cjs)
// no Electron do projeto com um perfil TEMPORÁRIO (--user-data-dir e FORGIA_DADOS em %TEMP%,
// nunca o %APPDATA%\Forgia do usuário) e apaga o perfil no fim.
//
// Opções (repassadas ao modo gravação):
//   --dicas=cruise,align   só estes roteiros (chave "dica" do roteiro)
//   --temas=claro          só um tema (padrão: claro e escuro)
//   --cenas[=nome,...]     remonta as cenas (montagem: Iniciantes + lote da ponte) antes de gravar
//   --so-cenas             só remonta as cenas
//   --roteiros=<pasta>     outra pasta de roteiros (ex.: ajuda/roteiros/readme)
//   --saida=<pasta>        onde gravar os .webm (padrão public/ajuda)
//   --fotos=<pasta>        PNG do início, dos passos com "foto" e do fim de cada vídeo
//   --resumo=<arquivo>     JSON com tamanho, duração e a diferença início/fim de cada vídeo
// A janela da gravação aparece na tela, sempre por cima, e não recebe o mouse físico.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const electron = createRequire(import.meta.url)('electron');
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('[gravar] falta o build: rode "npx vite build" (o npm run gravar-dicas já faz)');
  process.exit(2);
}
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-gravacao-'));
const env = { ...process.env, FORGIA_DADOS: perfil };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(ROOT, 'scripts', 'gravar', 'principal.cjs'), `--user-data-dir=${perfil}`, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit', env });
child.on('exit', async (code) => {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(perfil, { recursive: true, force: true });
    } catch {}
    if (!fs.existsSync(perfil)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  process.exit(code ?? 1);
});
