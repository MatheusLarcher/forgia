// Soma 1 no patch da versão do package.json e imprime a versão nova.
// Usado pelo gerar_setup.bat antes de gerar o instalador (npm run dist:win não sobe a versão).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminho = join(raiz, 'package.json');

const bruto = readFileSync(caminho, 'utf8');
const pacote = JSON.parse(bruto);

const partes = String(pacote.version ?? '').split('.');
if (partes.length !== 3 || partes.some((p) => !/^\d+$/.test(p))) {
  console.error(`[bump-version] versão inválida no package.json: "${pacote.version}" (esperado x.y.z)`);
  process.exit(1);
}

const anterior = partes.join('.');
partes[2] = String(Number(partes[2]) + 1);
const nova = partes.join('.');

// Troca só o valor da chave "version", para preservar a formatação e a ordem do arquivo
const atualizado = bruto.replace(/("version"\s*:\s*")[^"]*(")/, (_m, abre, fecha) => `${abre}${nova}${fecha}`);
if (atualizado === bruto) {
  console.error('[bump-version] não achei a chave "version" no package.json.');
  process.exit(1);
}

writeFileSync(caminho, atualizado);
console.error(`[bump-version] ${anterior} -> ${nova}`);
// O stdout recebe só a versão nova: o .bat lê daqui
console.log(nova);
