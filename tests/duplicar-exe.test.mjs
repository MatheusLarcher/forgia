// R2 — "Duplicar e repetir" pelo mouse, no Forgia.exe gerado (CDP, mouse e teclado reais, perfil
// temporário: --user-data-dir e FORGIA_DADOS em %TEMP%; recusa o Forgia instalado).
//  1. Caixa, Ctrl+D (a cópia nasce no lugar e fica selecionada), arrastar pelo meio da face: move a
//     CÓPIA e o original fica; Ctrl+D de novo: a terceira nasce com o mesmo deslocamento.
//  2. Controle: duas peças sobrepostas, nada selecionado: o clique pega a da frente.
//  3. Controle: a de trás selecionada, clique na da frente: pega a da frente (a preferência pela
//     selecionada vale só para superfícies praticamente coincidentes).
// A montagem da cena é pela API/ponte; a interação testada é sempre por mouse e teclado.
//   FORGIA_EXE=release\fase-r2\win-unpacked\Forgia.exe node --test tests/duplicar-exe.test.mjs
// Resultado em <pasta do build>\evidencias-r2\resultado.json (fora do Git: release/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Forgia, exePath, tempProfile, wait, bridgeRequest } from './forgia-exe.mjs';

const { userProfileStamp } = createRequire(import.meta.url)('./visual-runtime.cjs');
const EXE = exePath();
const skip = !EXE && 'defina FORGIA_EXE (exe gerado)';
const EVID = EXE ? path.join(path.dirname(path.dirname(EXE)), 'evidencias-r2') : null;
const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

async function click(app, [x, y]) {
  await app.mouse('mouseMoved', x, y);
  await wait(80);
  await app.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  await wait(40);
  await app.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  await wait(200);
}

async function drag(app, from, to, steps = 12) {
  await app.mouse('mouseMoved', from[0], from[1]);
  await wait(80);
  await app.mouse('mousePressed', from[0], from[1], { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await app.mouse('mouseMoved', Math.round(x), Math.round(y), { button: 'left', buttons: 1 });
    await wait(25);
  }
  await app.mouse('mouseReleased', to[0], to[1], { button: 'left', buttons: 0, clickCount: 1 });
  await wait(250);
}

async function ctrlD(app) {
  const k = { key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68, modifiers: 2 };
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await wait(20);
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  await wait(250);
}

// cena limpa, vista inicial sem animação
async function cenaVazia(app) {
  await app.js(`(forgia.editor.loadProject(null), forgia.editor.homeViewInstant(), forgia.editor.controls.update(), true)`);
  await wait(300);
}

const objs = (app) => app.js(`forgia.editor.objects.map((o) => ({ id: o.id, n: o.name, pos: [...o.pos] }))`);
const selecao = (app) => app.js('[...forgia.editor.selection]');
const idDe = (app, nome) => app.js(`(forgia.editor.objects.find((o) => o.name === ${JSON.stringify(nome)}) || {}).id`);

// pixel da janela de um ponto na caixa do objeto: fx/fy/fz em 0..1 (0 = min, 1 = max; interno, Y para cima)
const pixelNaCaixa = (app, nome, [fx, fy, fz]) =>
  app.js(`(() => { const ed = forgia.editor; const o = ed.objects.find((q) => q.name === ${JSON.stringify(nome)}); const b = ed.worldBox(o); const v = b.min.clone().set(b.min.x + (b.max.x - b.min.x) * ${fx}, b.min.y + (b.max.y - b.min.y) * ${fy}, b.min.z + (b.max.z - b.min.z) * ${fz}); const s = ed.project(v); const r = ed.renderer.domElement.getBoundingClientRect(); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; })()`);

// o que está sob o pixel: interseções (id, distância) e a alça, como o editor as vê
const sobPixel = (app, [x, y]) =>
  app.js(`(() => { const ed = forgia.editor; ed.setRay({ clientX: ${x}, clientY: ${y} }); const hs = ed.raycaster.intersectObjects([...ed.meshes.values()].filter((m) => m.visible), false); const h = ed.handles.pick(ed.raycaster); return { hits: hs.map((i) => ({ id: i.object.userData.id, d: i.distance })), alca: h ? h.type : null }; })()`);

test('Duplicar e repetir pelo mouse (R2)', { skip, timeout: 240000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const perfil = tempProfile('forgia-r2-');
  process.env.FORGIA_DADOS = perfil;
  const carimboAntes = userProfileStamp();
  const app = await Forgia.open(EXE, perfil);
  const log = { exe: EXE, perfil, cenas: {} };
  try {
    await t.test('Ctrl+D, arrastar pelo meio: move a cópia; Ctrl+D de novo repete o deslocamento', async () => {
      const L = (log.cenas.duplicar_e_repetir = {});
      await cenaVazia(app);
      const r = await cmd(app, 'criar', { tipo: 'caixa', medidas: [20, 20, 20], centro: [0, 0, null], nome: 'A' });
      assert.ok(r && r.ok, JSON.stringify(r));
      const idA = await idDe(app, 'A');
      // meio da face da frente (interno +Z, virada para a câmera da vista inicial)
      const px = await pixelNaCaixa(app, 'A', [0.5, 0.5, 1]);
      L.pixel = px;
      await click(app, px);
      assert.deepEqual(await selecao(app), [idA], 'o clique seleciona a caixa');
      await ctrlD(app);
      const depoisD = await objs(app);
      assert.equal(depoisD.length, 2, 'Ctrl+D criou a cópia');
      const idB = depoisD.find((o) => o.id !== idA).id;
      assert.deepEqual(await selecao(app), [idB], 'a cópia fica selecionada');
      const posA0 = depoisD.find((o) => o.id === idA).pos;
      assert.deepEqual(depoisD.find((o) => o.id === idB).pos, posA0, 'a cópia nasce no lugar do original');
      // pré-condição: sob o pixel estão as duas, à mesma distância, e nenhuma alça
      const sob = await sobPixel(app, px);
      L.sobPixel = sob;
      assert.equal(sob.alca, null, 'nenhuma alça sob o pixel do arraste');
      const dA = sob.hits.find((h) => h.id === idA);
      const dB = sob.hits.find((h) => h.id === idB);
      assert.ok(dA && dB && near(dA.d, dB.d, 1e-4), `original e cópia coincidentes sob o pixel: ${JSON.stringify(sob.hits)}`);
      L.primeiraIntersecao = sob.hits[0].id === idA ? 'original' : 'copia';

      await drag(app, px, [px[0] + 90, px[1]]);
      const depoisArraste = await objs(app);
      const posA = depoisArraste.find((o) => o.id === idA).pos;
      const posB = depoisArraste.find((o) => o.id === idB).pos;
      L.depoisArraste = { original: posA, copia: posB, selecao: await selecao(app) };
      assert.deepEqual(posA, posA0, 'o original fica no lugar');
      const delta = posB.map((v, k) => v - posA[k]);
      L.deslocamento = delta;
      assert.ok(Math.hypot(...delta) >= 5, `a cópia se moveu (deslocamento ${delta})`);
      assert.deepEqual(await selecao(app), [idB], 'a cópia continua selecionada');

      await ctrlD(app);
      const depois2 = await objs(app);
      assert.equal(depois2.length, 3, 'Ctrl+D de novo criou a terceira');
      const sel2 = await selecao(app);
      assert.equal(sel2.length, 1);
      const terceira = depois2.find((o) => o.id === sel2[0]);
      assert.ok(terceira && terceira.id !== idA && terceira.id !== idB, 'a terceira fica selecionada');
      const esperado = posB.map((v, k) => v + delta[k]);
      L.terceira = { pos: terceira.pos, esperado };
      for (let k = 0; k < 3; k++) assert.ok(near(terceira.pos[k], esperado[k], 1e-3), `terceira em ${terceira.pos}, esperado ${esperado}`);
      assert.deepEqual(depois2.find((o) => o.id === idA).pos, posA0, 'o original continua no lugar');
      await app.screenshot(path.join(EVID, 'duplicar-e-repetir.png'));
      L.ok = true;
    });

    // duas caixas sobrepostas: B 10 mm à frente de A (interno +Z), as duas sob o pixel, B mais perto
    async function cenaSobrepostas() {
      await cenaVazia(app);
      const r = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', tipo: 'caixa', medidas: [20, 20, 20], centro: [0, 0, null], nome: 'A' },
        { cmd: 'criar', tipo: 'caixa', medidas: [20, 20, 20], centro: [0, -10, null], nome: 'B' },
      ] });
      assert.ok(r && r.ok, JSON.stringify(r));
      const ids = { A: await idDe(app, 'A'), B: await idDe(app, 'B') };
      const px = await pixelNaCaixa(app, 'B', [0.5, 0.8, 1]);
      return { ids, px };
    }

    await t.test('controle: sobrepostas sem seleção, o clique pega a da frente', async () => {
      const L = (log.cenas.frente_sem_selecao = {});
      const { ids, px } = await cenaSobrepostas();
      assert.deepEqual(await selecao(app), []);
      const sob = await sobPixel(app, px);
      L.pixel = px;
      L.sobPixel = sob;
      assert.equal(sob.alca, null);
      assert.equal(sob.hits[0].id, ids.B, 'B é a primeira interseção');
      assert.ok(sob.hits.some((h) => h.id === ids.A), 'A também está sob o pixel');
      await click(app, px);
      L.selecao = await selecao(app);
      assert.deepEqual(L.selecao, [ids.B], 'o clique pega a da frente');
      L.ok = true;
    });

    await t.test('controle: a de trás selecionada, clique na da frente pega a da frente', async () => {
      const L = (log.cenas.frente_com_tras_selecionada = {});
      const { ids, px } = await cenaSobrepostas();
      await app.js(`(forgia.editor.select([${JSON.stringify(ids.A)}]), true)`);
      await wait(200);
      const sob = await sobPixel(app, px);
      L.pixel = px;
      L.sobPixel = sob;
      assert.equal(sob.alca, null, 'nenhuma alça de A sob o pixel');
      assert.equal(sob.hits[0].id, ids.B);
      const dA = sob.hits.find((h) => h.id === ids.A);
      assert.ok(dA && dA.d - sob.hits[0].d > 5, `A bem atrás de B: ${JSON.stringify(sob.hits)}`);
      await click(app, px);
      L.selecao = await selecao(app);
      assert.deepEqual(L.selecao, [ids.B], 'o clique pega a da frente');
      L.ok = true;
    });

    log.console = app.console;
  } finally {
    await app.close();
    log.carimboAppData = { antes: carimboAntes, depois: userProfileStamp() };
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    try {
      fs.rmSync(perfil, { recursive: true, force: true });
    } catch {}
  }
});
