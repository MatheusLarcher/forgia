// Plano de trabalho (P) no Forgia.exe gerado, com mouse e teclado reais (CDP) e perfis temporários.
//  1. Modo normal sem regressão: o MESMO roteiro (colocar da biblioteca, arrastar, setas, Ctrl+↑,
//     alça de canto, alça de cima, cone de elevar, giro, duas peças escaladas juntas, Shift+D) no
//     exe da Fase C (FORGIA_EXE_ANTIGO) e no novo (FORGIA_EXE): os números têm de ser iguais.
//  2. Plano numa face inclinada (cunha): forma nova nasce alinhada e na grade do plano, setas e
//     cone seguem o plano, alças no quadro dele, barra com o rótulo e X/Y/Z relativos, P de novo
//     volta à mesa, fechar e abrir não guarda o plano. Capturas nos dois temas.
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe FORGIA_EXE_ANTIGO=release\fase-c\win-unpacked\Forgia.exe
//     node --test tests/plano-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait, bridgeRequest, ROOT } from './forgia-exe.mjs';

const EXE = exePath();
const ANTIGO = process.env.FORGIA_EXE_ANTIGO ? path.resolve(ROOT, process.env.FORGIA_EXE_ANTIGO) : null;
const skip = !EXE && 'defina FORGIA_EXE (exe gerado da Fase D)';
const EVID = path.join(ROOT, 'docs', 'fase-d-evidence', 'plano');
const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);

async function drag(app, from, to, { steps = 12, modifiers = 0 } = {}) {
  await app.mouse('mouseMoved', from[0], from[1], { modifiers });
  await wait(80);
  await app.mouse('mousePressed', from[0], from[1], { button: 'left', buttons: 1, clickCount: 1, modifiers });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await app.mouse('mouseMoved', Math.round(x), Math.round(y), { button: 'left', buttons: 1, modifiers });
    await wait(25);
  }
  await app.mouse('mouseReleased', to[0], to[1], { button: 'left', buttons: 0, clickCount: 1, modifiers });
  await wait(250);
}

async function key(app, k, { ctrl = false, shift = false } = {}) {
  const vk = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Escape: 27 }[k] || k.toUpperCase().charCodeAt(0);
  const code = k.length === 1 ? 'Key' + k.toUpperCase() : k;
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const kk = shift && k.length === 1 ? k.toUpperCase() : k;
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: kk, code, windowsVirtualKeyCode: vk, modifiers });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: kk, code, windowsVirtualKeyCode: vk, modifiers });
  await wait(120);
}

// ponto do mundo (interno) -> pixel da janela
const screenOf = (app, [x, y, z]) => app.js(`(() => { const ed = forgia.editor; const r = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(ed.camera.position.clone().set(${x}, ${y}, ${z})); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; })()`);
// pixel de uma alça: tipo e filtro (axis, sx, sz, s)
const handleAt = (app, type, extra = '') => app.js(`(() => { const ed = forgia.editor; const h = ed.handles.items.find((i) => i.type === '${type}'${extra}); if (!h || !h.object.visible) return null; const v = h.object.getWorldPosition(ed.camera.position.clone()); const r = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(v); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; })()`);
const snap = (app) => app.js(`forgia.editor.objects.map((o) => ({ n: o.name, pos: o.pos.map((v) => Math.round(v * 100) / 100), size: o.size.map((v) => Math.round(v * 100) / 100), quat: o.quat.map((v) => Math.round(v * 1e4) / 1e4) }))`);

async function vistaFixa(app) {
  // vista inicial e sem animação: a mesma câmera nos dois exes
  await app.js(`(forgia.editor.homeViewInstant(), forgia.editor.controls.update(), true)`);
  await wait(300);
}

// Roteiro do modo normal: devolve os números de cada passo
async function roteiroNormal(app) {
  const out = {};
  await vistaFixa(app);
  // 1. arrastar a Caixa da biblioteca para a mesa
  const tile = await app.js(`(() => { const r = document.querySelector('.tile[data-label="Caixa"]').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
  const alvo = await screenOf(app, [10, 0, 5]);
  await drag(app, tile, alvo, { steps: 16 });
  out.colocar = await snap(app);
  // 2. arrastar a peça pelo corpo (meio da face da frente, longe das alças)
  const corpo = await screenOf(app, [10, 12, 15]);
  const ate = await screenOf(app, [40, 12, -5]);
  await drag(app, corpo, ate);
  out.arrastar = await snap(app);
  // 3. setas e Ctrl+↑
  await app.js(`document.querySelector('.main-canvas').focus()`);
  await key(app, 'ArrowRight');
  await key(app, 'ArrowRight');
  await key(app, 'ArrowUp');
  await key(app, 'ArrowUp', { ctrl: true });
  out.setas = await snap(app);
  // 4. alça de canto (−x, +z) e alça de cima. (O canto +x+z fica sob a cota de elevação quando a
  // peça está fora da mesa: a cota pega o clique, igual na Fase C; não é deste roteiro.)
  await vistaFixa(app);
  const canto = await handleAt(app, 'corner', ' && i.sx === -1 && i.sz === 1');
  await drag(app, canto, [canto[0] - 40, canto[1] + 25]);
  out.canto = await snap(app);
  const topo = await handleAt(app, 'top');
  await drag(app, topo, [topo[0], topo[1] - 40]);
  out.topo = await snap(app);
  // 5. cone de elevar
  const cone = await handleAt(app, 'lift');
  await drag(app, cone, [cone[0], cone[1] - 30]);
  out.elevar = await snap(app);
  // 6. giro no eixo y (seta do chão)
  const giro = await handleAt(app, 'rot', " && i.axis === 'y'");
  await drag(app, giro, [giro[0] + 60, giro[1] + 10]);
  out.girar = await snap(app);
  // 7. Shift+D
  await key(app, 'd', { shift: true });
  out.soltar = await snap(app);
  // 8. duas peças, alça de canto do conjunto
  await cmd(app, 'criar', { tipo: 'cilindro', medidas: [10, 10, 10], centro: [-40, 20, null], nome: 'segundo' });
  await app.js(`(forgia.editor.selectAll(), true)`);
  await wait(200);
  await vistaFixa(app);
  const canto2 = await handleAt(app, 'corner', ' && i.sx === 1 && i.sz === 1');
  await drag(app, canto2, [canto2[0] + 30, canto2[1] + 20]);
  out.conjunto = await snap(app);
  // 9. desfazer tudo volta ao vazio
  out.passos = await app.js('forgia.editor.historyIndex');
  return out;
}

test('Plano de trabalho no exe', { skip, timeout: 600000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const log = {};

  await t.test('modo normal sem regressão: mesmo roteiro, mesmos números no exe da Fase C e no novo', { skip: !ANTIGO && 'defina FORGIA_EXE_ANTIGO (exe da Fase C)' }, async () => {
    const res = {};
    for (const [nome, exe] of [['antes', ANTIGO], ['depois', EXE]]) {
      const app = await Forgia.open(exe, tempProfile(`forgia-plano-${nome}-`));
      try {
        res[nome] = await roteiroNormal(app);
        await app.screenshot(path.join(EVID, `normal-${nome}.png`));
      } finally {
        await app.close();
      }
    }
    log.normal = res;
    fs.writeFileSync(path.join(EVID, 'normal-antes-depois.json'), JSON.stringify(res, null, 2));
    for (const passo of Object.keys(res.antes)) assert.deepEqual(res.depois[passo], res.antes[passo], `passo "${passo}" mudou`);
  });

  const perfil = tempProfile('forgia-plano-');
  let app = await Forgia.open(EXE, perfil);
  try {
    let wp;
    await t.test('P numa face inclinada: o plano nasce na face, com a grade e o rótulo na barra', async () => {
      // cunha: rampa subindo para −Y do usuário (rampa com 45°)
      const r = await cmd(app, 'criar', { tipo: 'cunha', medidas: [40, 40, 40], nome: 'rampa', cor: '#8b9197' });
      assert.ok(r.ok);
      await vistaFixa(app);
      await app.js(`document.querySelector('.main-canvas').focus()`);
      await key(app, 'p');
      assert.equal(await app.js(`forgia.editor.tool && forgia.editor.tool.name`), 'workplane', 'P liga a escolha da face');
      // ponto no meio da rampa: centro da cunha (y = 20) sobe e vai para trás
      const p = await screenOf(app, [0, 20, 0]);
      await app.mouse('mouseMoved', p[0], p[1]);
      await wait(150);
      await app.screenshot(path.join(EVID, 'escolher-face.png'));
      await app.mouse('mousePressed', p[0], p[1], { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p[0], p[1], { button: 'left', buttons: 0, clickCount: 1 });
      await wait(300);
      wp = await app.js(`(() => { const w = forgia.editor.wplane; return w && { n: w.normal.toArray().map((v) => Math.round(v * 1e4) / 1e4), x: w.x.toArray().map((v) => Math.round(v * 1e4) / 1e4), o: w.origin.toArray().map((v) => Math.round(v * 100) / 100), q: w.quat.toArray() }; })()`);
      assert.ok(wp, 'plano ativo');
      const s2 = Math.SQRT1_2;
      assert.ok(Math.abs(wp.n[1] - s2) < 1e-3 && Math.abs(Math.abs(wp.n[2]) - s2) < 1e-3, `normal da rampa inclinada 45°: ${wp.n}`);
      // eixo x do plano = aresta da rampa mais perto do clique: a de baixo/cima (paralela a X) ou
      // a lateral (subindo a rampa)
      const lateral = Math.abs(wp.x[0]) < 1e-3 && Math.abs(Math.abs(wp.x[1]) - s2) < 1e-3 && Math.abs(Math.abs(wp.x[2]) - s2) < 1e-3;
      assert.ok(Math.abs(Math.abs(wp.x[0]) - 1) < 1e-3 || lateral, `eixo x do plano numa aresta da rampa: ${wp.x}`);
      assert.ok(Math.abs(wp.x[0] * wp.n[0] + wp.x[1] * wp.n[1] + wp.x[2] * wp.n[2]) < 1e-6, 'x no plano');
      assert.equal(await app.js(`forgia.editor.tool`), null, 'a escolha sai depois do clique');
      assert.equal(await app.js(`!!forgia.editor.scene.getObjectByName('plano-de-trabalho')`), true, 'grade no plano');
      assert.equal(await app.js(`document.getElementById('sb-plano').hidden`), false, 'rótulo na barra');
      assert.equal(await app.js(`document.getElementById('sb-plano').textContent`), 'Plano de trabalho');
      assert.equal(await app.js(`document.querySelector('[data-cmd="workplane"]').classList.contains('active')`), true);
      log.plano = wp;
    });

    await t.test('forma nova nasce alinhada e na grade do plano; setas, arraste e cone seguem o plano', async () => {
      await app.js(`forgia.editor.select([])`);
      const tile = await app.js(`(() => { const r = document.querySelector('.tile[data-label="Caixa"]').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
      const alvo = await screenOf(app, [3, 23, -3]);
      await drag(app, tile, alvo, { steps: 16 });
      const caixa = await app.js(`(() => { const ed = forgia.editor; const o = ed.objects.find((x) => x.type === 'box'); const w = ed.wplane; const q = ed.camera.quaternion.clone().fromArray(o.quat); const l = w.toLocal(ed.camera.position.clone().fromArray(o.pos)); return { quat: o.quat.map((v) => Math.round(v * 1e4) / 1e4), mesmoGiro: Math.abs(q.dot(w.quat)) > 0.9999, altura: Math.round(l.y * 100) / 100 || 0, gradeX: Math.round(l.x * 1000) / 1000 || 0, gradeZ: Math.round(l.z * 1000) / 1000 || 0, base: Math.round(ed.planeExtent(o).min * 100) / 100 || 0, id: o.id }; })()`);
      assert.equal(caixa.mesmoGiro, true, 'giro da caixa = giro do plano');
      assert.equal(caixa.base, 0, 'base apoiada no plano');
      assert.equal(caixa.altura, 10, 'centro a meia altura sobre o plano');
      assert.ok(Number.isInteger(caixa.gradeX) && Number.isInteger(caixa.gradeZ), `x/z na grade de 1 mm do plano: ${caixa.gradeX}, ${caixa.gradeZ}`);
      log.caixaNoPlano = caixa;
      await app.js(`forgia.editor.select([${JSON.stringify(caixa.id)}])`);
      await wait(200);
      // barra: X/Y/Z relativos ao plano (Z = 10, a meia altura)
      const bar = await app.js(`document.getElementById('sb-coords').textContent`);
      assert.match(bar, /Z 10$/, `barra relativa ao plano: ${bar}`);
      // alças no quadro do plano: o conjunto de alças gira com o plano
      assert.equal(await app.js(`Math.abs(forgia.editor.handles.root.quaternion.dot(forgia.editor.wplane.quat)) > 0.9999`), true, 'alças alinhadas ao plano');
      const local = () => app.js(`(() => { const ed = forgia.editor; const o = ed.objects.find((x) => x.type === 'box'); const l = ed.wplane.toLocal(ed.camera.position.clone().fromArray(o.pos)); return [l.x, l.y, l.z].map((v) => Math.round(v * 100) / 100 || 0); })()`);
      const l0 = await local();
      await app.js(`document.querySelector('.main-canvas').focus()`);
      await key(app, 'ArrowRight');
      const l1 = await local();
      assert.deepEqual([l1[0] - l0[0], l1[1] - l0[1], l1[2] - l0[2]].map((v) => Math.round(v * 100) / 100), [1, 0, 0], 'seta → anda 1 mm no x do plano');
      await key(app, 'ArrowUp', { ctrl: true });
      const l2 = await local();
      assert.deepEqual([l2[0] - l1[0], l2[1] - l1[1], l2[2] - l1[2]].map((v) => Math.round(v * 100) / 100), [0, 1, 0], 'Ctrl+↑ sobe 1 mm pela normal do plano');
      // cone de elevar: sobe pela normal
      await vistaFixa(app);
      const cone = await handleAt(app, 'lift');
      await drag(app, cone, [cone[0], cone[1] - 40]);
      const l3 = await local();
      assert.ok(Math.abs(l3[0] - l2[0]) < 0.01 && Math.abs(l3[2] - l2[2]) < 0.01 && l3[1] > l2[1], `cone de elevar pela normal: ${l2} → ${l3}`);
      // Shift+D: volta a apoiar no plano
      await key(app, 'd', { shift: true });
      const l4 = await local();
      assert.equal(l4[1], 10, 'Shift+D apoia no plano');
      // arraste pelo corpo: continua no plano
      const corpo = await app.js(`(() => { const ed = forgia.editor; const o = ed.objects.find((x) => x.type === 'box'); const r = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(ed.camera.position.clone().fromArray(o.pos)); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; })()`);
      await drag(app, corpo, [corpo[0] + 40, corpo[1] + 10]);
      const l5 = await local();
      assert.equal(l5[1], 10, 'arraste mantém a altura sobre o plano');
      assert.ok(Math.abs(l5[0] - l4[0]) + Math.abs(l5[2] - l4[2]) > 1, 'arraste andou no plano');
      assert.ok(Number.isInteger(l5[0] - l4[0]) && Number.isInteger(l5[2] - l4[2]), 'arraste na grade do plano');
      log.caixaLocal = { l0, l1, l2, l3, l4, l5 };
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await app.js(`(forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)`);
        await wait(900);
        await app.screenshot(path.join(EVID, `plano-${tema}.png`));
      }
    });

    await t.test('P de novo volta à mesa; o plano não fica salvo', async () => {
      await app.js(`document.querySelector('.main-canvas').focus()`);
      await key(app, 'p');
      assert.equal(await app.js('forgia.editor.wplane'), null);
      assert.equal(await app.js(`document.getElementById('sb-plano').hidden`), true);
      assert.equal(await app.js(`!!forgia.editor.scene.getObjectByName('plano-de-trabalho')`), false);
      // de novo no plano e fecha: ao abrir, volta a mesa
      await key(app, 'p');
      const p = await screenOf(app, [0, 20, 0]);
      await app.mouse('mousePressed', p[0], p[1], { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p[0], p[1], { button: 'left', buttons: 0, clickCount: 1 });
      await wait(300);
      assert.ok(await app.js('!!forgia.editor.wplane'));
      await wait(700);
      assert.ok(!fs.readFileSync(path.join(perfil, 'recuperacao', 'projeto.json'), 'utf8').includes('wplane'), 'fora da cópia de segurança');
      await app.close();
      app = await Forgia.open(EXE, perfil);
      assert.equal(await app.js('forgia.editor.wplane'), null, 'reabriu na mesa');
      assert.equal(await app.js('forgia.editor.objects.length'), 2);
    });
  } finally {
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    await app.close();
  }
});
