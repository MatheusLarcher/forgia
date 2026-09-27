// Régua da mesa no exe gerado (perfil temporário): troca de mesa, marquinha do cursor, faixa da
// peça selecionada e arrastada (largura igual à da barra de status), números sem sobrepor ao girar
// e aproximar, tema, plano de trabalho, fora da exportação e do projeto, fechar e reabrir.
// FORGIA_EXE=release\branding\win-unpacked\Forgia.exe node --test tests/regua-exe.test.mjs
// Capturas em %TEMP%\forgia-regua-shots. Sem FORGIA_EXE, o teste é pulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait } from './forgia-exe.mjs';

const exe = exePath();
const shots = path.join(os.tmpdir(), 'forgia-regua-shots');

// rótulos visíveis da régua e pares que se sobrepõem (retângulos reais do DOM)
const STATE = `(() => {
  const vis = (e) => e.style.display !== 'none' && !!e.offsetParent;
  const els = [...document.querySelectorAll('.regua-mesa > .regua-num, .regua-mesa > .regua-faixa')].filter(vis);
  const rs = els.map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }));
  const over = [];
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hit(rs[i].r, rs[j].r)) over.push(rs[i].t + ' x ' + rs[j].t);
  // nem por cima do que flutua sobre a vista, nem fora dela
  const vp = document.getElementById('viewport');
  const vr = vp.getBoundingClientRect();
  const ui = [...vp.children].filter((c) => !c.matches('canvas, .overlay')).map((c) => [c.className || c.id, c.getBoundingClientRect()]).filter(([, r]) => r.width && r.height);
  for (const x of rs) {
    for (const [name, r] of ui) if (hit(x.r, r)) over.push(x.t + ' x ' + name);
    if (x.r.left < vr.left || x.r.top < vr.top || x.r.right > vr.right || x.r.bottom > vr.bottom) over.push(x.t + ' fora da vista');
  }
  return {
    textos: rs.map((x) => x.t),
    over,
    cursor: [...document.querySelectorAll('.regua-cursor')].filter(vis).length,
    faixa: [...document.querySelectorAll('.regua-faixa')].map((e) => (vis(e) ? e.textContent : null)),
    status: document.getElementById('sb-size').textContent,
    root: window.forgia.editor.ruler.root.visible,
    layer: document.querySelector('.regua-mesa').style.display,
  };
})()`;
const V = 'window.forgia.editor.camera.position.constructor';

test('régua da mesa no exe', { skip: !exe && 'defina FORGIA_EXE', timeout: 240000 }, async () => {
  const profile = tempProfile('forgia-regua-');
  const app = await Forgia.open(exe, profile);
  const frame = () => app.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const state = async (label) => {
    await frame();
    const s = await app.js(STATE);
    console.log(label, JSON.stringify(s));
    return s;
  };
  const shot = (n) => app.screenshot(path.join(shots, n + '.png'));
  const area = async (v) => {
    await app.js(`(() => { const a = document.getElementById('area-select'); a.value = '${v}'; a.dispatchEvent(new Event('change')); return true; })()`);
    await wait(300);
  };
  const click = async (p) => {
    await app.mouse('mouseMoved', p.x, p.y);
    await app.mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1, buttons: 1 });
    await app.mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
    await wait(300);
  };
  // ponto do mundo -> tela (coordenadas da janela, para o mouse do CDP)
  const screen = (x, y, z) => app.js(`(() => { const ed = window.forgia.editor; const r = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(new ${V}(${x}, ${y}, ${z})); return { x: r.left + s.x, y: r.top + s.y }; })()`);
  try {
    const inicial = await state('inicial');
    assert.ok(inicial.root && inicial.textos.includes('255 mm'), 'mesa padrão termina em 255 mm');
    assert.ok(inicial.textos.includes('0'));
    await shot('01-inicial');

    // troca de mesa pelo seletor Área: A1 mini termina em 180; Ender 3 redesenha em 220
    await area('180x180x180');
    const a1 = await state('a1mini');
    assert.ok(a1.textos.includes('180 mm') && !a1.textos.includes('255 mm'));
    assert.deepEqual(a1.over, []);
    await shot('02-a1mini');
    await area('220x220x250');
    const e3 = await state('ender3');
    assert.ok(e3.textos.includes('220 mm') && !e3.textos.includes('180 mm'));
    assert.ok(!e3.textos.some((t) => Number(t) > 220), 'nenhum número passa do tamanho da mesa');
    assert.deepEqual(e3.over, []);
    await shot('03-ender3');

    // sem seleção: a marquinha segue o cursor sobre a mesa e some fora dela. O mouse físico sobre a
    // janela também manda eventos: confere logo no quadro seguinte, com nova tentativa
    const hover = async (p, want) => {
      let s;
      for (let i = 0; i < 5; i++) {
        await app.mouse('mouseMoved', p.x + i, p.y);
        s = await state('cursor');
        if (s.cursor === want) break;
      }
      return s;
    };
    const naMesa = await screen(20, 0, 30);
    assert.equal((await hover(naMesa, 2)).cursor, 2);
    await shot('04-cursor');
    const canto = await app.js(`window.forgia.editor.renderer.domElement.getBoundingClientRect().top + 4`);
    assert.equal((await hover({ x: 6, y: canto }, 0)).cursor, 0);

    // peça de 40 × 40 mm (20 de altura), selecionada com o mouse: faixa de 40 mm nas duas réguas
    await app.js(`(() => { const ed = window.forgia.editor; const o = ed.createObject('box', { size: [40, 20, 40] }); o.pos = [10, 10, -5]; ed.change(() => ed.objects.push(o)); window.__regua = o.id; return true; })()`);
    await click(await screen(10, 20, -5));
    const sel = await state('selecionada');
    assert.deepEqual(sel.faixa, ['40 mm', '40 mm']);
    assert.match(sel.status, /\b40\b.*\b40\b/, 'barra de status com as mesmas medidas');
    assert.equal(sel.cursor, 0, 'com seleção, sem marquinha');
    assert.deepEqual(sel.over, []);
    await shot('05-selecionada');

    // arrastar pela face da frente (o centro do topo é a alça de altura): a faixa acompanha a peça
    const p = await screen(10, 10, 15);
    const before = await app.js(`window.forgia.editor.ruler.bands[0].position.x`);
    await app.mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 12; i++) await app.mouse('mouseMoved', p.x + i * 10, p.y + i * 3, { buttons: 1 });
    const drag = await state('arrastando');
    const after = await app.js(`window.forgia.editor.ruler.bands[0].position.x`);
    assert.deepEqual(drag.faixa, ['40 mm', '40 mm']);
    assert.match(drag.status, /^40 × 40 × 20 mm/, 'arrastar não muda as medidas');
    assert.ok(Math.abs(after - before) > 5, `faixa andou com a peça (${before} -> ${after})`);
    await shot('06-arrastando');
    await app.mouse('mouseReleased', p.x + 120, p.y + 36, { button: 'left', clickCount: 1 });

    // girar e aproximar: nenhum número sobreposto
    const views = [[0, 1, 0], [0, 0.3, 1], [1, 0.3, 0], [-1, 0.5, -1], [1, 1, 1], [-0.3, 0.15, 1], [0.2, 0.05, 1], [0, -0.4, 1]];
    for (const [i, d] of views.entries()) {
      await app.js(`(() => { const ed = window.forgia.editor; ed.viewFrom(new ${V}(${d.join(',')}).normalize()); return true; })()`);
      await wait(550);
      const s = await state('vista ' + d.join(','));
      assert.deepEqual(s.over, [], 'vista ' + d.join(','));
      await shot('07-vista-' + i);
    }
    for (const f of [0.35, 0.12, 4, 10]) {
      await app.js(`(() => { const ed = window.forgia.editor; const t = ed.controls.target; ed.camera.position.sub(t).multiplyScalar(${f}).add(t); ed.controls.update(); return true; })()`);
      await wait(150);
      const s = await state('zoom ' + f);
      assert.deepEqual(s.over, [], 'zoom ' + f);
      await shot('08-zoom-' + f);
    }
    await app.js(`(() => { window.forgia.editor.viewFrom(new ${V}(0.42, 0.62, 0.66).normalize()); return true; })()`);
    await wait(550);

    // custo: update da régua com a vista girando (a cada quadro a chave muda e os rótulos são refeitos)
    const perf = await app.js(`new Promise((res) => {
      const ed = window.forgia.editor; const r = ed.ruler; const orig = r.update; let tot = 0, n = 0, max = 0;
      r.update = function () { const t0 = performance.now(); orig.call(r); const dt = performance.now() - t0; tot += dt; n++; max = Math.max(max, dt); };
      let frames = 0; const t0 = performance.now(); const tgt = ed.controls.target.clone(); const c0 = ed.camera.position.clone().sub(tgt); const up = new ${V}(0, 1, 0);
      const step = () => { frames++; ed.camera.position.copy(tgt).add(c0.clone().applyAxisAngle(up, (performance.now() - t0) / 1000)); if (performance.now() - t0 < 2000) requestAnimationFrame(step); else { r.update = orig; res({ fps: frames / 2, mediaMs: tot / n, maxMs: max }); } };
      requestAnimationFrame(step);
    })`);
    console.log('desempenho', JSON.stringify(perf));
    assert.ok(perf.mediaMs < 2, 'régua custa menos de 2 ms por quadro girando');

    // tema: troca e continua sem sobreposição
    const tema0 = await app.js('window.forgia.theme.name');
    await app.js('window.forgia.theme.toggle(), true');
    await wait(200);
    assert.notEqual(await app.js('window.forgia.theme.name'), tema0);
    assert.deepEqual((await state('outro tema')).over, []);
    await shot('09-outro-tema');
    await app.js('window.forgia.theme.toggle(), true');

    // plano de trabalho (P) na face de cima da peça: a régua some; ao sair, volta
    await app.js(`(() => { window.forgia.editor.setTool('workplane'); return true; })()`);
    const o = await app.js('window.forgia.editor.obj(window.__regua).pos');
    const topo = await screen(o[0], o[1] + 10, o[2]);
    await app.mouse('mouseMoved', topo.x, topo.y);
    await wait(100);
    await click(topo);
    assert.ok(await app.js('!!window.forgia.editor.wplane'), 'plano de trabalho ativo');
    const plano = await state('plano');
    assert.equal(plano.root, false);
    assert.equal(plano.layer, 'none');
    await shot('10-plano');
    await app.js('window.forgia.ui.toggleWorkplane(), true');
    assert.equal((await state('sem plano')).root, true);

    // fora da exportação e do projeto
    const exported = await app.js(`(() => { let n = 0; window.forgia.editor.exportScene().traverse((m) => { if (m.isMesh) n++; }); return n; })()`);
    assert.equal(exported, 1, 'exportação só com a peça');
    assert.ok(!(await app.js('window.forgia.editor.snapshot()')).includes('regua'));
    assert.deepEqual(app.console.filter((m) => /exceção|Error/i.test(m)), []);
  } finally {
    await app.close();
  }

  // fechar e reabrir o mesmo perfil: a mesa Ender 3 volta e a régua com ela
  const app2 = await Forgia.open(exe, profile);
  try {
    await wait(400);
    const wp = await app2.js('window.forgia.editor.workplane');
    assert.deepEqual([wp.w, wp.l], [220, 220]);
    await app2.js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const s = await app2.js(STATE);
    console.log('reaberto', JSON.stringify(s));
    assert.ok(s.root && s.textos.includes('220 mm'));
    assert.deepEqual(s.over, []);
    await app2.screenshot(path.join(shots, '11-reaberto.png'));
  } finally {
    await app2.close();
  }
});
