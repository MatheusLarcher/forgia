// Capturas da interface nova da Fase C no Forgia.exe gerado, nos dois temas, com vista fixa
// 1400×900 CSS px a 1,5× (2100×1350 px), perfil temporário:
//   node tests/fase-c-telas.mjs [--exe=release\fase-c\win-unpacked\Forgia.exe]
// Saída: docs/fase-c-evidence/telas/<cena>-<tema>.png (fora do Git).
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, bridgeRequest, tempProfile, ROOT, wait } from './forgia-exe.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const EXE = path.resolve(ROOT, arg.exe || 'release/fase-c/win-unpacked/Forgia.exe');
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'telas');
fs.mkdirSync(OUT, { recursive: true });

// cenas: nome -> função que monta a tela (recebe app e api); a captura sai logo depois
export const SCENES = {
  async configuracoes({ app }) {
    await app.js("document.getElementById('btn-settings').click(), true");
    await app.waitFor("!!document.querySelector('.modal [data-ia-opcao]')", 3000, 'Configurações com a seção IA');
  },
  async 'dica-marcar'({ app }) {
    const b = await app.js("(() => { const r = document.querySelector('[data-cmd=\"mark\"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
    await app.mouse('mouseMoved', b.x - 40, b.y + 300);
    await wait(300);
    await app.mouse('mouseMoved', b.x, b.y);
    await app.waitFor("!!document.querySelector('.dica.aberta')", 3000, 'cartão de dica do Marcar parte');
  },
  async atalhos({ app }) {
    await app.mouse('mouseMoved', 700, 600);
    await app.js("document.getElementById('btn-help').click(), true");
    await app.waitFor("!!document.querySelector('.modal table.keys')", 3000, 'diálogo Atalhos');
    await app.js("(() => { const row = [...document.querySelectorAll('.modal table.keys tr')].find((r) => r.textContent.startsWith('N')); row.scrollIntoView({ block: 'center' }); return true; })()");
  },
  async 'conectar-ia'({ app }) {
    await app.js("(!document.querySelector('.ia-chat:not([hidden])') && document.getElementById('sb-pedir').click(), document.querySelector('.ia-chat [data-ia="conectar"]').click()), true");
    await app.waitFor("!!document.querySelector('.modal .conectar')", 3000, 'diálogo Conectar IA');
  },
};

const profile = tempProfile('forgia-telas-');
const app = await Forgia.open(EXE, profile);
const api = async (cmd, a = {}) => (await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd, args: a })).json;
const shots = [];
try {
  // uma peça para a barra de status ter o que mostrar
  const r = await api('lote', { comandos: [
    { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [60, 40, 6], nome: 'base' },
    { cmd: 'criar', ref: 'a', tipo: 'caixa', medidas: [60, 4, 30], sobre: '$b', centro: [null, 18, null], nome: 'aba' },
    { cmd: 'criar', ref: 'f', tipo: 'cilindro', medidas: [8, 8, 6], alinhar_com: '$b', furo: true },
    { cmd: 'agrupar', ids: ['$b', '$a', '$f'], nome: 'suporte', ref: 'g' },
  ] });
  await app.js(`(forgia.editor.select([${JSON.stringify(r.refs.g)}]), forgia.editor.fitView(), true)`);
  await wait(800);
  for (const [name, build] of Object.entries(SCENES).filter(([n]) => !arg.cena || n === arg.cena)) {
    for (const tema of ['claro', 'escuro']) {
      await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
      await wait(200);
      await build({ app, api });
      await wait(400);
      shots.push(await app.screenshot(path.join(OUT, `${name}-${tema}.png`)));
      await app.js("document.getElementById('modal-root').innerHTML = '', true");
    }
  }
  console.log(JSON.stringify({ capturas: shots, console: app.console }, null, 1));
} finally {
  await app.close();
  await wait(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
