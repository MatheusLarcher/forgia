// Tela inicial (Seus projetos) e menu lateral do símbolo (src/inicio.js), com perfil TEMPORÁRIO:
// histórico com miniatura, abrir por lá, arquivo sumido, renomear (inclusive o aberto, e Ctrl+S
// depois grava no nome novo), nome repetido, Esc, teclas do editor paradas, Novo projeto,
// fechar e abrir de novo, perfil vazio e .forgia pedido pelo Windows (sem tela inicial).
//   node --test tests/inicio-exe.test.mjs                      (Electron do projeto + dist/)
//   FORGIA_EXE=release\win-unpacked\Forgia.exe node --test tests/inicio-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Forgia, exePath, tempProfile, wait, ROOT } from './forgia-exe.mjs';
import { packProject } from '../src/projeto.js';

const EXE = exePath();
const ELECTRON = createRequire(import.meta.url)('electron');
const EVID = path.join(ROOT, 'docs', 'inicio-evidence');
const abrir = (perfil, extra = []) => (EXE ? Forgia.open(EXE, perfil, { extraArgs: extra }) : Forgia.open(ELECTRON, perfil, { extraArgs: [ROOT, ...extra] }));

const caixa = (id, x) => ({ id, type: 'box', name: id, pos: [x, 0, 10], quat: [0, 0, 0, 1], size: [20, 20, 20], color: '#e3302d', params: {} });
async function forgia(file, nome, objetos) {
  const png = new Uint8Array(fs.readFileSync(path.join(ROOT, 'public', 'branding', 'forgia-forge-v1.png')));
  const bytes = await packProject({ name: nome, grid: 1, workplane: null, objects: objetos }, () => null, { png, app: 'teste' });
  fs.writeFileSync(file, bytes);
}
const cartoes = (app, sel) =>
  app.js(`[...document.querySelectorAll('${sel} .proj')].map((c) => ({ nome: c.querySelector('.proj-nome')?.textContent, sub: c.querySelector('.proj-sub')?.textContent, thumb: !!c.querySelector('img.proj-thumb'), sumiu: c.classList.contains('sumiu'), atual: c.classList.contains('atual') }))`);
const clicarCartao = (app, sel, nome) => app.js(`[...document.querySelectorAll('${sel} .proj')].find((c) => c.querySelector('.proj-nome').textContent === ${JSON.stringify(nome)}).querySelector('.proj-abrir').click()`);
const key = async (app, k, { ctrl = false } = {}) => {
  const code = /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : k;
  const vk = /^[a-z]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : { Escape: 27, Delete: 46, Enter: 13 }[k] || 0;
  for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 });
};
async function renomear(app, sel, de, para) {
  await app.js(`[...document.querySelectorAll('${sel} .proj')].find((c) => c.querySelector('.proj-nome').textContent === ${JSON.stringify(de)}).querySelector('.proj-renomear').click()`);
  await app.waitFor(`document.activeElement && document.activeElement.classList.contains('proj-nome-campo')`, 3000, 'campo de nome com foco');
  await app.js(`document.activeElement.value = ${JSON.stringify(para)}`);
  await key(app, 'Enter');
}

test('tela inicial e menu lateral com o histórico de projetos', { timeout: 300000 }, async (t) => {
  if (!EXE && !fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('falta o build: npx vite build');
  fs.mkdirSync(EVID, { recursive: true });
  const work = tempProfile('forgia-inicio-arq-');
  const perfil = tempProfile('forgia-inicio-');
  const A = path.join(work, 'suporte.forgia');
  const B = path.join(work, 'engrenagem.forgia');
  const C = path.join(work, 'sumiu.forgia');
  await forgia(A, 'suporte', [caixa('a1', 0)]);
  await forgia(B, 'engrenagem', [caixa('b1', 0), caixa('b2', 30)]);
  fs.writeFileSync(path.join(perfil, 'recentes.json'), JSON.stringify([A, B, C]));
  const sel = '#inicio';
  const gav = '#gaveta';

  let app = await abrir(perfil);
  try {
    await t.test('abre na tela inicial com o histórico; arquivo sumido aparece desabilitado', async () => {
      await app.waitFor(`!document.getElementById('inicio').hidden && document.querySelectorAll('#inicio .proj').length === 3`, 10000, 'tela inicial');
      const c = await cartoes(app, sel);
      assert.deepEqual(c.map((x) => x.nome), ['suporte', 'engrenagem', 'sumiu']);
      assert.equal(c[2].sumiu, true);
      assert.match(c[2].sub, /não encontrado/);
      assert.equal(c[0].thumb, false, 'sem miniatura até abrir ou salvar pelo Forgia');
      await app.screenshot(path.join(EVID, '1-tela-inicial.png'));
    });

    await t.test('teclas do editor paradas com a tela aberta', async () => {
      await app.js(`document.activeElement && document.activeElement.blur()`);
      const n0 = await app.js('forgia.editor.objects.length');
      await key(app, 'a', { ctrl: true });
      await key(app, 'Delete');
      assert.equal(await app.js('forgia.editor.objects.length'), n0);
    });

    await t.test('clicar abre o projeto, fecha a tela e grava a miniatura', async () => {
      await clicarCartao(app, sel, 'suporte');
      await app.waitFor(`document.getElementById('inicio').hidden && forgia.arquivo.file && forgia.arquivo.file.nome === 'suporte.forgia'`, 10000, 'suporte aberto');
      assert.equal(await app.js('forgia.editor.objects.length'), 1);
      assert.equal(fs.readdirSync(path.join(perfil, 'miniaturas')).length, 1, 'miniatura no histórico');
    });

    await t.test('símbolo abre o menu lateral; o aberto fica marcado; Esc fecha', async () => {
      await app.js(`document.querySelector('#topbar .logo').click()`);
      await app.waitFor(`!document.getElementById('gaveta').hidden && document.querySelectorAll('#gaveta .proj').length === 3`, 5000, 'menu lateral');
      const c = await cartoes(app, gav);
      assert.equal(c[0].atual, true);
      assert.equal(c[0].thumb, true);
      await app.screenshot(path.join(EVID, '2-menu-lateral.png'));
      await app.js(`document.activeElement && document.activeElement.blur()`);
      await key(app, 'Delete');
      assert.equal(await app.js('forgia.editor.objects.length'), 1, 'Delete não apagou peça com o menu aberto');
      await key(app, 'Escape');
      await app.waitFor(`document.getElementById('gaveta').hidden`, 3000, 'Esc fecha');
      assert.equal(await app.js('forgia.editor.objects.length'), 1);
    });

    await t.test('renomear outro projeto pelo menu', async () => {
      await app.js(`document.querySelector('#topbar .logo').click()`);
      await app.waitFor(`document.querySelectorAll('#gaveta .proj').length === 3`, 5000, 'menu');
      await renomear(app, gav, 'engrenagem', 'engrenagem 40 dentes');
      await app.waitFor(`[...document.querySelectorAll('#gaveta .proj-nome')].some((e) => e.textContent === 'engrenagem 40 dentes')`, 5000, 'nome novo na lista');
      assert.ok(fs.existsSync(path.join(work, 'engrenagem 40 dentes.forgia')));
      assert.ok(!fs.existsSync(B));
    });

    await t.test('nome repetido é recusado com aviso', async () => {
      await renomear(app, gav, 'engrenagem 40 dentes', 'suporte');
      await app.waitFor(`[...document.querySelectorAll('.toast')].some((e) => /Já existe/.test(e.textContent))`, 5000, 'aviso de nome repetido');
      assert.ok(fs.existsSync(path.join(work, 'engrenagem 40 dentes.forgia')));
    });

    await t.test('renomear o aberto: título acompanha e Ctrl+S grava no nome novo', async () => {
      await renomear(app, gav, 'suporte', 'suporte da prateleira');
      await app.waitFor(`forgia.arquivo.file.nome === 'suporte da prateleira.forgia' && /suporte da prateleira/.test(document.title)`, 5000, 'título com o nome novo');
      await key(app, 'Escape');
      await app.waitFor(`document.getElementById('gaveta').hidden`, 3000, 'fecha');
      await app.js(`forgia.editor.select(forgia.editor.objects.map((o) => o.id)); forgia.editor.duplicate()`);
      await app.waitFor('forgia.arquivo.dirty', 3000, 'sujo');
      await key(app, 's', { ctrl: true });
      await app.waitFor('!forgia.arquivo.dirty', 10000, 'salvo sem diálogo');
      assert.ok(!fs.existsSync(A));
      assert.ok(fs.statSync(path.join(work, 'suporte da prateleira.forgia')).size > 0);
    });

    await t.test('Novo projeto pelo menu e volta à tela inicial', async () => {
      await app.js(`document.querySelector('#topbar .logo').click()`);
      await app.waitFor(`document.querySelectorAll('#gaveta .proj').length === 3`, 5000, 'menu');
      await app.js(`document.querySelector('#gaveta .inicio-acoes .btn.primary').click()`);
      await app.waitFor(`document.getElementById('gaveta').hidden && !forgia.arquivo.file && forgia.editor.objects.length === 0`, 5000, 'projeto novo');
      await app.js(`document.querySelector('#topbar .logo').click()`);
      await app.waitFor(`!document.getElementById('gaveta').hidden`, 3000, 'menu');
      await app.js(`document.querySelector('#gaveta .gaveta-inicial').click()`);
      await app.waitFor(`!document.getElementById('inicio').hidden && document.getElementById('gaveta').hidden`, 3000, 'tela inicial');
    });
  } finally {
    await app.close();
  }

  await t.test('fechar e abrir de novo: tela inicial com nomes novos e miniaturas', async () => {
    app = await abrir(perfil);
    try {
      await app.waitFor(`!document.getElementById('inicio').hidden && document.querySelectorAll('#inicio .proj').length === 3`, 10000, 'tela inicial');
      const c = await cartoes(app, sel);
      assert.deepEqual(c.map((x) => x.nome), ['suporte da prateleira', 'engrenagem 40 dentes', 'sumiu']);
      assert.equal(c[0].thumb, true);
      await app.js(`forgia.theme.set ? forgia.theme.set('escuro') : document.documentElement.setAttribute('data-tema', 'escuro')`);
      await app.screenshot(path.join(EVID, '3-tela-inicial-escuro.png'));
    } finally {
      await app.close();
    }
  });

  await t.test('.forgia pedido pelo Windows vai direto ao editor', async () => {
    app = await abrir(perfil, [path.join(work, 'engrenagem 40 dentes.forgia')]);
    try {
      await app.waitFor(`forgia.arquivo.file && forgia.arquivo.file.nome === 'engrenagem 40 dentes.forgia'`, 10000, 'aberto');
      await wait(500);
      assert.equal(await app.js(`document.getElementById('inicio').hidden`), true);
    } finally {
      await app.close();
    }
  });

  await t.test('perfil vazio: tela inicial com a mensagem de vazio', async () => {
    app = await abrir(tempProfile('forgia-inicio-vazio-'));
    try {
      await app.waitFor(`!document.getElementById('inicio').hidden && !!document.querySelector('#inicio .inicio-vazio')`, 10000, 'vazio');
      await app.screenshot(path.join(EVID, '4-vazio.png'));
    } finally {
      await app.close();
    }
  });
});
