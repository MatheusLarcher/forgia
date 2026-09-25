// Criar encaixe no Forgia.exe gerado (perfil temporário): peça de caixa + cilindro → grupo com
// bloco aberto em cima e a cópia como furo com folga de 0,25 mm, conferida com a régua (Medir, com
// cliques reais no meio das arestas da borda do furo) e pelas medidas; malha importada com o aviso
// de folga aproximada; um desfazer; folga editável; dois temas.
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe node --test tests/encaixe-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait, bridgeRequest, ROOT } from './forgia-exe.mjs';
import { stlEsfera } from './migracao-antiga.mjs';

const EXE = exePath();
const skip = !EXE && 'defina FORGIA_EXE (exe gerado da Fase D)';
const EVID = path.join(ROOT, 'docs', 'fase-d-evidence', 'encaixe');
const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

async function click(app, x, y) {
  await app.mouse('mouseMoved', x, y);
  await wait(60);
  await app.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  await wait(40);
  await app.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  await wait(150);
}

test('Criar encaixe no exe', { skip, timeout: 300000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const perfil = tempProfile('forgia-fase-d-encaixe-');
  const app = await Forgia.open(EXE, perfil);
  const log = {};
  try {
    let peca;
    await t.test('peça de caixa + cilindro: bloco aberto em cima, cópia como furo com 0,25 mm', async () => {
      const r = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [30, 20, 10], cor: '#1b8bd2', nome: 'base' },
        { cmd: 'criar', ref: 'c', tipo: 'cilindro', medidas: [10, 10, 15], sobre: '$b', cor: '#1b8bd2', nome: 'pino' },
        { cmd: 'agrupar', ids: ['$b', '$c'], nome: 'peça', ref: 'g' },
        { cmd: 'selecionar', ids: ['$g'] },
      ] });
      assert.ok(r.ok, JSON.stringify(r));
      peca = r.objetos.find((o) => o.nome === 'peça');
      await app.waitFor(`!document.querySelector('[data-cmd="encaixe"]').disabled`, 5000, 'botão habilitado');
      const h0 = await app.js('forgia.editor.historyIndex');
      await app.js(`document.querySelector('[data-cmd="encaixe"]').click()`);
      await app.waitFor(`!!document.querySelector('[data-encaixe="folga"]')`, 5000, 'diálogo');
      assert.equal(await app.js(`document.querySelector('[data-encaixe="folga"]').value`), '0.25');
      assert.equal(await app.js(`document.querySelector('[data-encaixe="margem"]').value`), '3');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await wait(250);
        await app.screenshot(path.join(EVID, `dialogo-${tema}.png`));
      }
      await app.js(`document.querySelector('[data-escolha="criar-encaixe"]').click()`);
      await app.waitFor('forgia.editor.objects.length === 2', 10000, 'encaixe criado');
      assert.equal(await app.js('forgia.editor.historyIndex') - h0, 1, 'um passo de desfazer');
      const toast = await app.js(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ')`);
      assert.match(toast, /Encaixe criado com folga de 0,25 mm/);
      const est = await cmd(app, 'estado', { filhos: true });
      const enc = est.objetos.find((o) => o.nome === 'Encaixe de peça');
      assert.ok(enc, 'grupo "Encaixe de peça"');
      assert.deepEqual(est.selecao, [enc.id], 'o encaixe fica selecionado');
      const bloco = enc.filhos.find((f) => f.nome === 'Bloco');
      const copia = enc.filhos.find((f) => f.furo);
      assert.ok(bloco && copia, 'bloco sólido e cópia como furo');
      // bloco: caixa da peça + 3 mm nos lados e embaixo; topo rente ao topo da peça
      assert.ok(near(bloco.medidas[0], peca.medidas[0] + 6) && near(bloco.medidas[1], peca.medidas[1] + 6), `bloco ${bloco.medidas}`);
      assert.ok(near(bloco.medidas[2], peca.medidas[2] + 3 - 0.01), `altura do bloco ${bloco.medidas[2]}`);
      assert.ok(near(bloco.caixa.min[2], 0), 'bloco apoiado na mesa');
      assert.ok(copia.caixa.max[2] > bloco.caixa.max[2], 'a cópia atravessa o topo: aberto em cima');
      // cópia: 2 × folga em cada eixo
      for (let k = 0; k < 3; k++) assert.ok(near(copia.medidas[k], peca.medidas[k] + 0.5), `cópia ${copia.medidas} × peça ${peca.medidas}`);
      // fundo do encaixe: margem − folga
      assert.ok(near(copia.caixa.min[2] - bloco.caixa.min[2], 3 - 0.25), 'fundo com 2,75 mm');
      assert.ok(enc.caixa.min[0] > peca.caixa.max[0], 'ao lado da peça (+X)');
      log.peca = peca.medidas;
      log.bloco = bloco.medidas;
      log.copia = copia.medidas;
    });

    await t.test('Medir: a borda do furo do pino tem 10 + 2 × 0,25 = 10,5 mm', async () => {
      const est = await cmd(app, 'estado', { filhos: true });
      const enc = est.objetos.find((o) => o.nome === 'Encaixe de peça');
      const copia = enc.filhos.find((f) => f.furo);
      const pino = copia.filhos.find((f) => f.tipo === 'cilindro');
      // vista de cima, ortográfica, perto da borda do furo (topo do bloco)
      const top = enc.caixa.max[2];
      const cx = pino.centro[0];
      const cy = pino.centro[1];
      await app.js(`(() => { const ed = forgia.editor; window.__vista = ed.saveView(); ed.setOrtho(true); const V = ed.camera.position.clone(); const target = V.clone().set(${cx}, ${top}, ${-cy}); ed.restoreView({ ortho: true, pos: target.clone().add(V.clone().set(0, 300, 0.001)), target, up: V.clone().set(0, 0, -1), zoom: 9, orthoHeight: ed.orthoHeight }); return true; })()`);
      await wait(400);
      await app.js(`forgia.editor.select([])`);
      await app.js(`forgia.editor.setTool('measure')`);
      await wait(200);
      // meio das arestas da borda do furo (cilindro de 20 lados: faces a 5,25 mm do centro em ±X)
      const pts = await app.js(`(() => { const ed = forgia.editor; const r = ed.renderer.domElement.getBoundingClientRect(); const V = ed.camera.position.clone(); return [[${cx - 5.25}], [${cx + 5.25}]].map(([x]) => { const s = ed.project(V.clone().set(x, ${top}, ${-cy})); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; }); })()`);
      await click(app, ...pts[0]);
      await click(app, ...pts[1]);
      await wait(300);
      const label = await app.js(`(() => { const l = document.querySelector('.measure-label:not(.preview)'); return l ? l.textContent : null; })()`);
      log.medir = label;
      await app.screenshot(path.join(EVID, 'medir-folga.png'));
      assert.match(label || '', /^10,5 mm/, `régua: ${label}`);
      await app.js(`(forgia.editor.setTool(null), forgia.editor.restoreView(window.__vista), true)`);
    });

    await t.test('um desfazer tira o encaixe; folga editável (0,5 mm)', async () => {
      await app.js('forgia.editor.undo()');
      assert.equal(await app.js('forgia.editor.objects.length'), 1, 'desfazer: só a peça');
      await app.js(`forgia.editor.select([forgia.editor.objects[0].id])`);
      await app.js(`document.querySelector('[data-cmd="encaixe"]').click()`);
      await app.waitFor(`!!document.querySelector('[data-encaixe="folga"]')`, 5000, 'diálogo');
      await app.js(`document.querySelector('[data-encaixe="folga"]').value = '0.5'`);
      await app.js(`document.querySelector('[data-escolha="criar-encaixe"]').click()`);
      await app.waitFor('forgia.editor.objects.length === 2', 10000, 'encaixe 0,5');
      const est = await cmd(app, 'estado', { filhos: true });
      const enc = est.objetos.find((o) => o.nome === 'Encaixe de peça');
      const copia = enc.filhos.find((f) => f.furo);
      assert.ok(near(copia.medidas[0], 31) && near(copia.medidas[1], 21) && near(copia.medidas[2], 26), `cópia com 0,5: ${copia.medidas}`);
      assert.equal(await app.js(`JSON.parse(localStorage.getItem('forgia.encaixe')).folga`), 0.5, 'lembrada para a próxima vez');
      await app.js(`localStorage.setItem('forgia.encaixe', JSON.stringify({ folga: 0.25, margem: 3 }))`);
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await app.js('(forgia.editor.setOrtho(false), forgia.editor.homeViewInstant(), forgia.editor.select([forgia.editor.objects[1].id]), forgia.editor.fitView(), true)');
        await wait(900);
        await app.screenshot(path.join(EVID, `encaixe-${tema}.png`));
      }
    });

    await t.test('malha importada: funciona, com o aviso de folga aproximada', async () => {
      const stl = path.join(perfil, 'bola.stl');
      stlEsfera(stl, 10, 30);
      const imp = await cmd(app, 'importar', { caminho: stl, nome: 'bola', centro: [0, 60, null] });
      assert.ok(imp.ok);
      await app.js(`forgia.editor.select([${JSON.stringify(imp.criados[0])}])`);
      await app.js(`document.querySelectorAll('.toast').forEach((e) => e.remove())`);
      await app.js(`document.querySelector('[data-cmd="encaixe"]').click()`);
      await app.waitFor(`!!document.querySelector('[data-encaixe="folga"]')`, 5000, 'diálogo');
      await app.js(`document.querySelector('[data-escolha="criar-encaixe"]').click()`);
      await app.waitFor(`forgia.editor.objects.some((o) => o.name === 'Encaixe de bola')`, 10000, 'encaixe da malha');
      const toast = await app.js(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ')`);
      assert.match(toast, /folga é aproximada/);
      log.avisoMalha = toast;
      const est = await cmd(app, 'estado', { filhos: true });
      const copia = est.objetos.find((o) => o.nome === 'Encaixe de bola').filhos.find((f) => f.furo);
      for (let k = 0; k < 3; k++) assert.ok(near(copia.medidas[k], imp.objetos[0].medidas[k] + 0.5), `malha escalada por eixo: ${copia.medidas}`);
      await app.screenshot(path.join(EVID, 'encaixe-malha.png'));
    });
  } finally {
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    await app.close();
  }
});
