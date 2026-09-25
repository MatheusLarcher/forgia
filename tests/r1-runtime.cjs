'use strict';
/*
 * Roteiro da tarefa R1 (correções da revisão das Fases A e B) no Forgia.exe GERADO, por CDP, com
 * eventos reais de mouse e teclado (Input.dispatch*). Usa as peças de tests/visual-runtime.cjs:
 * perfil TEMPORÁRIO (--user-data-dir em %TEMP%), recusa o Forgia instalado, encerra só o PID que
 * abriu e confere que "%APPDATA%\Forgia\Local Storage" não mudou.
 *
 * Uso:
 *   node tests/r1-runtime.cjs --exe=release\fase-r1-antes\win-unpacked\Forgia.exe --rotulo=antes
 *   node tests/r1-runtime.cjs --exe=release\fase-r1\win-unpacked\Forgia.exe --rotulo=depois
 * Saída: <pasta do build>\evidencias-r1\<rótulo>\resultado.json (fora do Git: release/).
 *
 * Cenas (a montagem da cena é pela API; a interação testada é sempre por mouse/teclado):
 *   cruzeiro_peca_bloqueada   (achado 1) bolinha e apoio calculados só com a peça que se move
 *   medir_mesma_peca          (achado 2) dois pontos na mesma peça: aviso e nada muda
 *   medir_outra_peca          (controle) pontos em peças diferentes: a peça do fim anda
 *   desenhar_fechar_2_pontos  (achado 3) 1º ponto com 2 pontos não fecha nem realça: vira vértice
 *   desenhar_clique_tremido   (achado 4) clique com tremida de 6 px vira vértice
 *   desenhar_mao_livre        (controle) traço à mão livre continua virando peça
 *   trocar_ferramenta_no_giro (achado 5) R no meio do giro: transferidor some, um passo de desfazer
 *   cursor_cruz_desenhar      (achado 6) cursor em cruz no Desenhar mesmo vindo do hover de peça
 *   medir_snap_sem_recalculo  (achado 9) passar o mouse não serializa grupos nem reprojeta arestas
 *   svg_so_quando_muda        (achado 10) camadas do Desenhar e do Medir paradas = sem mutação
 * Não mexa o mouse sobre a janela do Forgia durante a execução.
 */
const fs = require('node:fs');
const path = require('node:path');
const { App, makeTempDir, cleanupAll, userProfileStamp, check, wait, SCENE_FLAGS, parseSize, DEFAULT_SIZE } = require('./visual-runtime.cjs');

const ROOT = path.join(__dirname, '..');
const log = (...a) => console.log('[r1]', ...a);

// ---------------- teclado ----------------
const KEYS = { b: ['b', 'KeyB', 66], r: ['r', 'KeyR', 82], c: ['c', 'KeyC', 67], z: ['z', 'KeyZ', 90], Enter: ['Enter', 'Enter', 13], Escape: ['Escape', 'Escape', 27] };
async function key(app, name, { ctrl = false } = {}) {
  const [k, code, vk] = KEYS[name];
  const text = k.length === 1 && !ctrl ? k : name === 'Enter' ? '\r' : undefined;
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 };
  await app.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) });
  await wait(20);
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await wait(120);
}
const press = (app, p) => app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
const release = (app, p) => app.mouse('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: 1 });
async function clickAt(app, p) {
  await app.move(p.x, p.y, { steps: 4 });
  await wait(40);
  await press(app, p);
  await wait(30);
  await release(app, p);
  await wait(120);
}

// ---------------- ganchos na página ----------------
const HOOKS = `(() => {
  const ed = forgia.editor;
  const V = ed.camera.position.constructor; // THREE.Vector3 (não é global na página)
  const canvas = ed.renderer.domElement;
  const scr = (x, y, z) => { const s = ed.project(new V(x, y, z)); const r = canvas.getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; };
  const avisos = [];
  // emit('aviso', undefined) chega como detail null (CustomEvent): aviso sem texto
  ed.addEventListener('aviso', (e) => avisos.push(e.detail == null || e.detail === '' ? '(sem texto)' : String(e.detail)));
  const R = {
    ed, V, scr, avisos,
    reset(view) {
      if (ed.tool) ed.setTool(null);
      if (ed.mode) ed.setMode(null);
      if (ed.placing) ed.cancelPlacing();
      ed.drag = null;
      ed.newDesign();
      avisos.length = 0;
      cancelAnimationFrame(ed.camAnim);
      ed.setOrtho(!!view.ortho);
      ed.camera.up.set(0, 1, 0);
      ed.camera.position.set(...view.pos);
      ed.controls.target.set(...view.target);
      ed.camera.zoom = 1;
      ed.camera.updateProjectionMatrix();
      ed.camera.lookAt(ed.controls.target);
      ed.controls.update();
      return true;
    },
    add(type, o = {}) {
      const obj = ed.createObject(type, o);
      if (o.pos) obj.pos = o.pos;
      if (o.locked) obj.locked = true;
      ed.change(() => ed.objects.push(obj));
      return obj.id;
    },
    box(id) { const b = ed.worldBox(ed.obj(id)); return { min: b.min.toArray(), max: b.max.toArray() }; },
    obj(id) { const o = ed.obj(id); return o && { pos: o.pos.slice(), quat: o.quat.slice(), size: o.size.slice(), locked: !!o.locked }; },
    // conta chamadas de uma função enquanto fn roda (para medir o custo do hover)
    counters: {},
    wrap(target, name, label) {
      const orig = target[name];
      const c = (R.counters[label] = { n: 0 });
      target[name] = function (...a) { c.n++; return orig.apply(this, a); };
      return () => { target[name] = orig; };
    },
    // registra mutações de um elemento; devolve { stop() -> número de registros }
    observe(sel) {
      const el = document.querySelector(sel);
      let n = 0;
      const mo = new MutationObserver((recs) => (n += recs.length));
      mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      return { count: () => n, stop: () => { mo.disconnect(); return n; } };
    },
  };
  window.__r1 = R;
  return true;
})()`;

const js = (app, expr) => app.js(expr);
const frames = async (app, n) => {
  for (let i = 0; i < n; i++) await app.frames();
};

// vista em perspectiva de frente-cima, fixa
const VIEW = { pos: [60, 150, 230], target: [0, 10, 0] };

// ---------------- cenas ----------------
async function cruiseLocked(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  const ids = await js(app, `(() => {
    const A = __r1.add('box', { size: [20, 20, 20], pos: [-60, 10, 0], locked: true }); // bloqueada, na mesa
    const B = __r1.add('box', { size: [10, 10, 10], pos: [-20, 20, 0] });               // solta, base em y = 15
    const C = __r1.add('box', { size: [40, 20, 40], pos: [50, 10, 0] });                // alvo: topo em y = 20
    __r1.ed.select([A, B]);
    return { A, B, C };
  })()`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'c');
  await frames(app, 3);
  const tool = await js(app, `__r1.ed.tool && __r1.ed.tool.name`);
  const ball = await js(app, `(() => { const b = document.querySelector('.cruise-ball'); if (!b || b.style.display === 'none') return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const expectBall = await js(app, `__r1.scr(-20, 15, 0)`); // base da peça que se move
  const comboBall = await js(app, `__r1.scr(-42.5, 0, 0)`); // base da caixa das duas
  const d = { ferramenta: tool, bolinha: ball, esperadoBasePecaSolta: expectBall, baseDaCaixaDasDuas: comboBall };
  if (!ball) return check(false, d, 'a bolinha do Cruzeiro não apareceu');
  d.distanciaBolinhaPx = Math.hypot(ball.x - expectBall.x, ball.y - expectBall.y);
  const hist0 = await js(app, `__r1.ed.historyIndex`);
  const target = await js(app, `__r1.scr(50, 20, 0)`);
  await app.move(ball.x, ball.y, { steps: 4 });
  await press(app, ball);
  await app.move(target.x, target.y, { steps: 16, pressed: true });
  await wait(80);
  await release(app, target);
  await wait(200);
  d.caixaB = await js(app, `__r1.box(${JSON.stringify(ids.B)})`);
  d.A = await js(app, `__r1.obj(${JSON.stringify(ids.A)})`);
  d.passosDeDesfazer = (await js(app, `__r1.ed.historyIndex`)) - hist0;
  const sits = Math.abs(d.caixaB.min[1] - 20) < 0.05;
  const centered = Math.abs((d.caixaB.min[0] + d.caixaB.max[0]) / 2 - 50) < 1.5 && Math.abs((d.caixaB.min[2] + d.caixaB.max[2]) / 2) < 1.5;
  d.assentaNoTopoDeC = sits;
  d.centroSobOCursor = centered;
  d.bloqueadaParada = JSON.stringify(d.A.pos) === JSON.stringify([-60, 10, 0]);
  await key(app, 'Escape');
  const ok = d.distanciaBolinhaPx < 3 && sits && centered && d.bloqueadaParada && d.passosDeDesfazer === 1;
  return check(ok, d, 'com uma peça bloqueada na seleção, a bolinha deve ficar na base da peça solta e ela deve assentar no topo de C, sob o cursor');
}

// ponto perto do canto (x, y, z) da face de cima, 4 px para dentro da face (o raio pega a face)
async function nearCorner(app, corner, faceCenter) {
  const c = await js(app, `__r1.scr(${corner.join(',')})`);
  const f = await js(app, `__r1.scr(${faceCenter.join(',')})`);
  const len = Math.hypot(f.x - c.x, f.y - c.y) || 1;
  return { x: c.x + ((f.x - c.x) / len) * 4, y: c.y + ((f.y - c.y) / len) * 4 };
}

async function typeDistance(app, value) {
  const total = await app.center('.measure-total');
  if (!total || !total.visivel) return false;
  await clickAt(app, total);
  const hasInput = await js(app, `document.activeElement && document.activeElement.classList.contains('measure-input')`);
  if (!hasInput) return false;
  await app.send('Input.insertText', { text: String(value) });
  await key(app, 'Enter');
  await frames(app, 2);
  return true;
}

async function measureSamePiece(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  const X = await js(app, `__r1.add('box', { size: [20, 20, 20], pos: [0, 10, 0] })`);
  await js(app, `__r1.ed.select([])`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'r');
  const p1 = await nearCorner(app, [-10, 20, 10], [0, 20, 0]);
  const p2 = await nearCorner(app, [10, 20, 10], [0, 20, 0]);
  await clickAt(app, p1);
  await clickAt(app, p2);
  const pts = await js(app, `__r1.ed.tool.pts.map((q) => ({ kind: q.kind, id: q.id, p: q.p.toArray().map((v) => Math.round(v * 1000) / 1000) }))`);
  const d = { ferramenta: await js(app, `__r1.ed.tool && __r1.ed.tool.name`), pontos: pts };
  const hist0 = await js(app, `__r1.ed.historyIndex`);
  const pos0 = await js(app, `__r1.obj(${JSON.stringify(X)}).pos`);
  d.digitou = await typeDistance(app, 30);
  d.posDepois = await js(app, `__r1.obj(${JSON.stringify(X)}).pos`);
  d.posAntes = pos0;
  d.passosDeDesfazer = (await js(app, `__r1.ed.historyIndex`)) - hist0;
  d.reguaMostra = await js(app, `Math.round(__r1.ed.tool.distance() * 1000) / 1000`);
  d.avisos = await js(app, `__r1.avisos.slice()`);
  await key(app, 'Escape');
  const same = pts.length === 2 && pts[0].id === X && pts[1].id === X;
  d.doisPontosNaMesmaPeca = same;
  const ok = same && d.digitou && JSON.stringify(d.posDepois) === JSON.stringify(pos0) && d.passosDeDesfazer === 0 && Math.abs(d.reguaMostra - 20) < 0.01 && d.avisos.length === 1;
  const res = check(ok, d, 'dois pontos na mesma peça: a peça não pode andar, a régua continua mostrando 20 e sai um aviso');
  res.textoDoAvisoExiste = check(d.avisos.length === 1 && d.avisos[0] !== '(sem texto)', { aviso: d.avisos[0] ?? null }, 'o aviso saiu sem texto (falta a chave avisos.medirMesmaPeca em src/textos/pt-BR.js)');
  return res;
}

async function measureOtherPiece(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  const ids = await js(app, `({ X: __r1.add('box', { size: [20, 20, 20], pos: [-20, 10, 0] }), Y: __r1.add('box', { size: [20, 20, 20], pos: [20, 10, 0] }) })`);
  await js(app, `__r1.ed.select([])`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'r');
  await clickAt(app, await nearCorner(app, [-10, 20, 10], [-20, 20, 0])); // canto frente-direita de X
  await clickAt(app, await nearCorner(app, [10, 20, 10], [20, 20, 0])); // canto frente-esquerda de Y
  const d = { pontos: await js(app, `__r1.ed.tool.pts.map((q) => ({ kind: q.kind, id: q.id }))`) };
  const hist0 = await js(app, `__r1.ed.historyIndex`);
  d.digitou = await typeDistance(app, 25);
  d.posY = await js(app, `__r1.obj(${JSON.stringify(ids.Y)}).pos`);
  d.passosDeDesfazer = (await js(app, `__r1.ed.historyIndex`)) - hist0;
  d.avisos = await js(app, `__r1.avisos.slice()`);
  await key(app, 'Escape');
  const ok = d.pontos.length === 2 && d.pontos[0].id === ids.X && d.pontos[1].id === ids.Y && Math.abs(d.posY[0] - 25) < 0.01 && d.passosDeDesfazer === 1 && d.avisos.length === 0;
  return check(ok, d, 'pontos em peças diferentes: a peça do ponto final anda 5 mm (20 -> 25) num passo de desfazer');
}

async function enterDraw(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'b');
  await wait(750); // a vista anima até o topo (380 ms)
  await frames(app, 2);
}
const drawState = (app) => js(app, `(() => { const t = __r1.ed.tool; return { ferramenta: t && t.name, pontos: t ? t.points.length : null, fechando: t ? !!t.closing : null, desenhos: __r1.ed.objects.filter((o) => o.type === 'desenho').length, avisos: __r1.avisos.slice() }; })()`);

async function drawCloseTwo(app) {
  await enterDraw(app);
  const p1 = await js(app, `__r1.scr(-20, 0, 20)`);
  const p2 = await js(app, `__r1.scr(20, 0, 20)`);
  await clickAt(app, p1);
  await clickAt(app, p2);
  await app.move(p1.x + 1, p1.y, { steps: 6 });
  await frames(app, 2);
  const hover = await drawState(app);
  await press(app, p1);
  await wait(30);
  await release(app, p1);
  await wait(150);
  const after = await drawState(app);
  const d = { comDoisPontosSobreO1o: hover, depoisDoClique: after };
  // controle: com 3 pontos, clicar no 1º fecha e cria a peça
  await key(app, 'Escape');
  await enterDraw(app);
  for (const [x, z] of [[-20, 20], [20, 20], [0, -20]]) await clickAt(app, await js(app, `__r1.scr(${x}, 0, ${z})`));
  const q1 = await js(app, `__r1.scr(-20, 0, 20)`);
  await app.move(q1.x + 1, q1.y, { steps: 6 });
  await frames(app, 2);
  d.comTresPontosSobreO1o = await drawState(app);
  await press(app, q1);
  await wait(30);
  await release(app, q1);
  await wait(250);
  d.depoisDeFecharComTres = await drawState(app);
  const ok = !hover.fechando && after.pontos === 3 && after.avisos.length === 0 && after.desenhos === 0 && d.comTresPontosSobreO1o.fechando && d.depoisDeFecharComTres.desenhos === 1;
  return check(ok, d, 'com 2 pontos, o 1º ponto não realça nem fecha (o clique vira o 3º vértice); com 3, fecha e cria a peça');
}

async function drawShakyClick(app) {
  await enterDraw(app);
  const p = await js(app, `__r1.scr(-10, 0, 10)`);
  await app.move(p.x, p.y, { steps: 4 });
  await press(app, p);
  // tremida de 6 px em ~40 ms, como a mão num clique
  for (const [dx, dy] of [[2, 1], [4, 2], [6, 1], [5, 3]]) {
    await app.mouse('mouseMoved', p.x + dx, p.y + dy, { button: 'left', buttons: 1 });
    await wait(8);
  }
  await release(app, { x: p.x + 5, y: p.y + 3 });
  await wait(150);
  const d = await drawState(app);
  await key(app, 'Escape');
  const ok = d.pontos === 1 && d.avisos.length === 0 && d.ferramenta === 'draw';
  return check(ok, d, 'um clique com tremida de 6 px deve pôr o 1º vértice, sem aviso nem traço à mão livre');
}

async function drawFreehand(app) {
  await enterDraw(app);
  const c = await js(app, `__r1.scr(0, 0, 0)`);
  const R = 90;
  const start = { x: c.x + R, y: c.y };
  await app.move(start.x, start.y, { steps: 4 });
  await press(app, start);
  for (let i = 1; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    await app.mouse('mouseMoved', c.x + R * Math.cos(a), c.y + R * Math.sin(a), { button: 'left', buttons: 1 });
    await wait(6);
  }
  await release(app, start);
  await wait(300);
  const d = await drawState(app);
  d.peca = await js(app, `(() => { const o = __r1.ed.objects.find((o) => o.type === 'desenho'); return o ? { pontos: o.params.points.length, tamanho: o.size } : null; })()`);
  const ok = d.desenhos === 1 && d.avisos.length === 0 && d.peca && d.peca.pontos >= 8;
  return check(ok, d, 'um círculo à mão livre deve virar uma peça desenho');
}

async function toolDuringRotation(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  const X = await js(app, `__r1.add('box', { size: [20, 20, 20], pos: [0, 10, 0] })`);
  await js(app, `__r1.ed.select([${JSON.stringify(X)}])`);
  await app.move(700, 120, { steps: 3 });
  await frames(app, 3);
  // ponto da seta de giro em torno de Y (sobre a área de clique do arco)
  const h = await js(app, `(() => {
    const it = __r1.ed.handles.items.find((i) => i.type === 'rot' && i.axis === 'y');
    const w = it.object.children[0].localToWorld(new __r1.V(0, 0.25, 0));
    return __r1.scr(w.x, w.y, w.z);
  })()`);
  const hist0 = await js(app, `__r1.ed.historyIndex`);
  await app.move(h.x, h.y, { steps: 4 });
  await press(app, h);
  await app.move(h.x + 70, h.y - 25, { steps: 12, pressed: true });
  await frames(app, 2);
  const during = await js(app, `({ arraste: __r1.ed.drag && __r1.ed.drag.kind, transferidor: __r1.ed.protractor.root.visible, angulo: getComputedStyle(__r1.ed.angleEl).display, quat: __r1.ed.obj(${JSON.stringify(X)}).quat.map((v) => Math.round(v * 1e4) / 1e4) })`);
  await key(app, 'r'); // troca para o Medir com o botão ainda apertado
  await frames(app, 2);
  const afterKey = await js(app, `({ ferramenta: __r1.ed.tool && __r1.ed.tool.name, arraste: __r1.ed.drag && __r1.ed.drag.kind, transferidor: __r1.ed.protractor.root.visible, angulo: getComputedStyle(__r1.ed.angleEl).display, passos: __r1.ed.historyIndex - ${hist0} })`);
  await release(app, { x: h.x + 70, y: h.y - 25 });
  await wait(150);
  await key(app, 'Escape');
  await key(app, 'z', { ctrl: true });
  await frames(app, 2);
  // null = o Ctrl+Z desfez além do giro (a peça sumiu): o giro não tinha virado passo próprio
  const undone = await js(app, `(() => { const o = __r1.ed.obj(${JSON.stringify(X)}); return o ? o.quat.map((v) => Math.round(v * 1e4) / 1e4) : null; })()`);
  const d = { duranteOGiro: during, depoisDaTeclaR: afterKey, quatDepoisDoCtrlZ: undone };
  const rotated = during.arraste === 'handle' && during.transferidor && JSON.stringify(during.quat) !== JSON.stringify([0, 0, 0, 1]);
  d.estavaGirando = rotated;
  const ok = rotated && afterKey.ferramenta === 'measure' && !afterKey.transferidor && afterKey.angulo === 'none' && afterKey.passos === 1 && JSON.stringify(undone) === JSON.stringify([0, 0, 0, 1]);
  return check(ok, d, 'trocar de ferramenta no meio do giro deve esconder transferidor e ângulo e gravar um passo de desfazer (Ctrl+Z volta o giro)');
}

async function drawCursor(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  await js(app, `__r1.add('box', { size: [40, 20, 40], pos: [0, 10, 0] })`);
  await js(app, `__r1.ed.select([])`);
  const over = await js(app, `__r1.scr(0, 20, 0)`);
  await app.move(over.x, over.y, { steps: 6 });
  await frames(app, 2);
  const beforeTool = await js(app, `({ inline: __r1.ed.renderer.domElement.style.cursor, calculado: getComputedStyle(__r1.ed.renderer.domElement).cursor })`);
  await key(app, 'b');
  await wait(750);
  await app.move(over.x + 6, over.y + 4, { steps: 3 });
  await frames(app, 2);
  const inDraw = await js(app, `({ ferramenta: __r1.ed.tool && __r1.ed.tool.name, inline: __r1.ed.renderer.domElement.style.cursor, calculado: getComputedStyle(__r1.ed.renderer.domElement).cursor })`);
  await key(app, 'Escape');
  const d = { sobreAPecaAntes: beforeTool, noDesenhar: inDraw };
  const ok = beforeTool.calculado === 'move' && inDraw.ferramenta === 'draw' && inDraw.calculado === 'crosshair';
  return check(ok, d, 'no Desenhar o cursor deve ser a cruz (crosshair), mesmo vindo do hover de uma peça');
}

async function measureSnapCost(app) {
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  // grupo com furo (centros dentro de grupo) + cilindros soltos; o mouse passa sobre o cilindro C
  await js(app, `(() => {
    const ed = __r1.ed;
    const a = ed.createObject('box', { size: [30, 20, 30] }); a.pos = [-50, 10, 0];
    const h = ed.createObject('cylinder', { size: [10, 30, 10], hole: true }); h.pos = [-50, 12, 0];
    ed.change(() => ed.objects.push(a, h));
    ed.select([a.id, h.id]);
    ed.group();
    for (const x of [0, 30]) __r1.add('cylinder', { size: [20, 20, 20], pos: [x, 10, -40] });
    __r1.add('cylinder', { size: [24, 20, 24], pos: [20, 10, 20] });
    ed.select([]);
    return true;
  })()`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'r');
  const face = await js(app, `__r1.scr(20, 20, 20)`); // topo do cilindro C
  await app.move(face.x, face.y, { steps: 6 });
  await frames(app, 3);
  await js(app, `(() => {
    __r1.unwrap = [__r1.wrap(JSON, 'stringify', 'stringify'), __r1.wrap(__r1.ed, 'project', 'project')];
    return true;
  })()`);
  const N = 20;
  for (let i = 1; i <= N; i++) {
    await app.mouse('mouseMoved', face.x + i, face.y + (i % 2), { button: 'none', buttons: 0 });
    await wait(16);
  }
  await frames(app, 2);
  const c = await js(app, `(() => { for (const f of __r1.unwrap) f(); return { stringify: __r1.counters.stringify.n, project: __r1.counters.project.n, hover: __r1.ed.tool.hover && __r1.ed.tool.hover.kind }; })()`);
  await key(app, 'Escape');
  const d = { movimentos: N, chamadasJSONstringify: c.stringify, chamadasProject: c.project, porMovimento: { stringify: c.stringify / N, project: c.project / N }, snapNoFim: c.hover };
  const ok = c.stringify === 0 && c.project / N < 8;
  return check(ok, d, 'passar o mouse (sem mudar projeto nem câmera) não pode serializar grupos nem reprojetar todas as arestas a cada movimento');
}

async function svgOnlyWhenChanged(app) {
  const d = {};
  // Desenhar: dois vértices, mouse parado
  await enterDraw(app);
  for (const [x, z] of [[-20, 20], [20, 20]]) await clickAt(app, await js(app, `__r1.scr(${x}, 0, ${z})`));
  await app.move(700, 300, { steps: 3 });
  await frames(app, 3);
  await js(app, `(__r1.obsDraw = __r1.observe('.draw-layer')), true`);
  await frames(app, 30);
  d.desenharParado = await js(app, `__r1.obsDraw.count()`);
  await js(app, `(__r1.ed.zoomBy(1.25), true)`); // a vista muda: tem que redesenhar
  await frames(app, 4);
  d.desenharDepoisDoZoom = await js(app, `__r1.obsDraw.stop()`) - d.desenharParado;
  await key(app, 'Escape');
  // Medir: régua com dois pontos, mouse parado
  await js(app, `__r1.reset(${JSON.stringify(VIEW)})`);
  await js(app, `__r1.add('box', { size: [20, 20, 20], pos: [0, 10, 0] })`);
  await js(app, `__r1.ed.select([])`);
  await app.move(700, 120, { steps: 3 });
  await key(app, 'r');
  await clickAt(app, await nearCorner(app, [-10, 20, 10], [0, 20, 0]));
  await clickAt(app, await nearCorner(app, [10, 20, 10], [0, 20, 0]));
  await app.move(700, 300, { steps: 3 });
  await frames(app, 3);
  await js(app, `(__r1.obsMeasure = __r1.observe('.measure-layer')), true`);
  await frames(app, 30);
  d.medirParado = await js(app, `__r1.obsMeasure.count()`);
  await js(app, `(__r1.ed.camera.position.x += 15, __r1.ed.camera.lookAt(__r1.ed.controls.target), __r1.ed.controls.update(), true)`);
  await frames(app, 4);
  d.medirDepoisDeMoverACamera = await js(app, `__r1.obsMeasure.stop()`) - d.medirParado;
  await key(app, 'Escape');
  const ok = d.desenharParado === 0 && d.desenharDepoisDoZoom > 0 && d.medirParado === 0 && d.medirDepoisDeMoverACamera > 0;
  return check(ok, d, 'com tudo parado (30 quadros) as camadas SVG não podem mudar; com a vista mudando, redesenham');
}

// ---------------- execução ----------------
async function main() {
  const A = Object.fromEntries(process.argv.slice(2).map((a) => /^--([^=]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2] ?? true]));
  if (typeof A.exe !== 'string' || typeof A.rotulo !== 'string') throw new Error('uso: node tests/r1-runtime.cjs --exe=<Forgia.exe gerado> --rotulo=<antes|depois>');
  const exe = path.resolve(ROOT, A.exe);
  if (!fs.existsSync(exe)) throw new Error('exe não encontrado: ' + exe);
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Forgia');
  if (exe.toLowerCase().startsWith(installed.toLowerCase() + path.sep)) throw new Error('recusado: esse é o Forgia INSTALADO do usuário');
  if (/[\\/]release[\\/]win-unpacked[\\/]/i.test(exe)) throw new Error('recusado: release\\win-unpacked está travado; use o build da tarefa');
  const outDir = path.join(path.dirname(exe), '..', 'evidencias-r1', A.rotulo);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp0 = userProfileStamp();
  const res = { rotulo: A.rotulo, exe, quando: new Date().toISOString(), verificacoes: {} };
  const profile = makeTempDir('forgia-r1-');
  let app = null;
  try {
    log('abrindo', exe, 'perfil', profile);
    app = await App.open({ exe, profile, extraArgs: SCENE_FLAGS, metrics: parseSize(DEFAULT_SIZE) });
    await js(app, HOOKS);
    const scenes = {
      cruzeiro_peca_bloqueada: cruiseLocked,
      medir_mesma_peca: measureSamePiece,
      medir_outra_peca: measureOtherPiece,
      desenhar_fechar_2_pontos: drawCloseTwo,
      desenhar_clique_tremido: drawShakyClick,
      desenhar_mao_livre: drawFreehand,
      trocar_ferramenta_no_giro: toolDuringRotation,
      cursor_cruz_desenhar: drawCursor,
      medir_snap_sem_recalculo: measureSnapCost,
      svg_so_quando_muda: svgOnlyWhenChanged,
    };
    for (const [name, fn] of Object.entries(scenes)) {
      try {
        const r = await fn(app);
        if (r.textoDoAvisoExiste) {
          res.verificacoes.medir_mesma_peca_texto_do_aviso = r.textoDoAvisoExiste;
          delete r.textoDoAvisoExiste;
        }
        res.verificacoes[name] = r;
      } catch (e) {
        res.verificacoes[name] = { resultado: 'FAIL', motivo: 'erro: ' + e.message };
        await js(app, `(__r1.ed.drag = null, true)`).catch(() => {});
        await release(app, { x: 700, y: 120 }).catch(() => {});
      }
      log(`${res.verificacoes[name].resultado.padEnd(5)} ${name}`);
    }
    res.consoleDaPagina = app.pageConsole;
  } finally {
    if (app) res.fechamento = await app.close();
    cleanupAll();
  }
  const stamp1 = userProfileStamp();
  const same = JSON.stringify(stamp0) === JSON.stringify(stamp1);
  res.verificacoes.perfil_do_usuario_intocado = check(same, { antes: stamp0, depois: stamp1 }, 'o Local Storage do Forgia do usuário mudou durante a execução');
  const failed = Object.entries(res.verificacoes).filter(([, v]) => v.resultado !== 'PASS');
  res.resultado = failed.length ? 'FAIL' : 'PASS';
  res.falhas = failed.map(([k]) => k);
  const file = path.join(outDir, 'resultado.json');
  fs.writeFileSync(file, JSON.stringify(res, null, 2));
  log(`resultado: ${res.resultado} -> ${file}`);
  for (const [k, v] of Object.entries(res.verificacoes)) log(`  ${v.resultado.padEnd(5)} ${k}${v.resultado !== 'PASS' && v.motivo ? ' — ' + v.motivo : ''}`);
  return res.resultado === 'PASS' ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[r1] ERRO:', e.message);
    cleanupAll();
    process.exit(1);
  });
