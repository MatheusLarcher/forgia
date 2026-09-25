// Cartão de dica com vídeo no Forgia.exe GERADO (perfil temporário; nunca o %APPDATA%\Forgia):
// - passar o mouse (entrada real, CDP) em cada uma das 11 funções abre o cartão com o vídeo do tema
//   ativo tocando, nos dois temas; as sem vídeo (copiar, colar, excluir, desfazer, refazer, zoom)
//   abrem o cartão sem o bloco de vídeo;
// - trocar o tema com o cartão aberto troca o vídeo; pausar/tocar; o vídeo dá a volta (loop);
// - ao fechar, o vídeo para e solta o arquivo;
// - a vista 3D girando a câmera: quadros por segundo com o cartão fechado e aberto (vídeo tocando).
//   FORGIA_EXE=release\fase-e\win-unpacked\Forgia.exe node --test tests/dicas-exe.test.mjs
// Evidências (capturas e números) em docs/fase-e-evidence/cartao/ (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait, ROOT } from './forgia-exe.mjs';

const exe = exePath();
const OUT = path.join(ROOT, 'docs', 'fase-e-evidence', 'cartao');
const COM_VIDEO = ['cruise', 'align', 'mirror', 'group', 'duplicate', 'draw', 'mark', 'encaixe', 'workplane', 'soltar', 'measure'];
const SEM_VIDEO = ['copy', 'paste', 'delete', 'undo', 'redo', 'in', 'out'];

async function center(app, sel) {
  return app.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

// tira o mouse para um lugar neutro da vista (fecha o cartão) e para sobre o elemento
async function hover(app, sel) {
  const vp = await center(app, '#viewport');
  await app.mouse('mouseMoved', vp.x, vp.y + 120);
  await wait(350);
  const c = await center(app, sel);
  await app.mouse('mouseMoved', c.x - 3, c.y - 2);
  await wait(60);
  await app.mouse('mouseMoved', c.x, c.y);
  await wait(750);
}

const cardState = `(() => {
  const card = document.querySelector('.dica');
  const v = card && card.querySelector('.dica-video video');
  return { aberta: !!(card && card.classList.contains('aberta')), titulo: card && card.querySelector('.dica-titulo')?.textContent, video: !!v,
    src: v ? v.currentSrc : null, paused: v ? v.paused : null, t: v ? v.currentTime : null, dur: v ? v.duration : null, ready: v ? v.readyState : null, loop: v ? v.loop : null };
})()`;

async function waitPlaying(app, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const s = await app.js(cardState);
    if (s.video && !s.paused && s.t > 0.25 && s.ready >= 3) return s;
    if (Date.now() - t0 > ms) return s;
    await wait(100);
  }
}

// gira a câmera por quadro durante ms e mede os quadros (requestAnimationFrame = o laço de desenho)
const orbit = (ms) => `new Promise((resolve) => {
  const ed = forgia.editor; const t0 = performance.now(); let last = t0; const gaps = [];
  const f = (now) => {
    const a = ((now - t0) / 1000) * 0.9;
    ed.camera.position.set(Math.cos(a) * 320, 210, Math.sin(a) * 320);
    ed.controls.target.set(0, 0, 0); ed.camera.lookAt(0, 0, 0); ed.controls.update();
    gaps.push(now - last); last = now;
    if (now - t0 < ${ms}) requestAnimationFrame(f);
    else { gaps.shift(); gaps.sort((x, y) => x - y); resolve({ fps: +(gaps.length / ((now - t0) / 1000)).toFixed(1), p95ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), maxms: +gaps[gaps.length - 1].toFixed(1) }); }
  };
  requestAnimationFrame(f);
})`;

test('cartão de dica com o vídeo do tema no exe', { skip: !exe && 'defina FORGIA_EXE' }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await Forgia.open(exe, tempProfile('forgia-fase-e-cartao-'));
  const res = { exe: path.relative(ROOT, exe), temas: {}, semVideo: {}, troca: null, pausar: null, loop: null, fechar: null, fps: null };
  try {
    // uma cena com peça selecionada: o inspetor (e o botão Soltar na mesa) aparece
    const cena = JSON.parse(fs.readFileSync(path.join(ROOT, 'ajuda', 'cenas', 'arruelas.json'), 'utf8')).projeto;
    await app.js(`(() => { const e = forgia.editor; e.loadProject(${JSON.stringify(cena)}); e.select([e.objects[1].id]); return true; })()`);
    await wait(400);

    for (const tema of ['claro', 'escuro']) {
      await app.js(`forgia.theme.set('${tema}', { save: false })`);
      res.temas[tema] = {};
      for (const k of COM_VIDEO) {
        await hover(app, `[data-dica="${k}"]`);
        const s = await waitPlaying(app);
        res.temas[tema][k] = s;
        assert.ok(s.aberta && s.video, `${tema}/${k}: cartão sem vídeo ${JSON.stringify(s)}`);
        assert.ok(s.src.endsWith(`/ajuda/${k}-${tema}.webm`), `${tema}/${k}: ${s.src}`);
        assert.ok(!s.paused && s.t > 0.25, `${tema}/${k}: não tocou ${JSON.stringify(s)}`);
        assert.ok(s.loop && s.dur >= 4 && s.dur <= 6, `${tema}/${k}: loop/duração ${s.dur}`);
        if (k === 'cruise' || k === 'soltar') await app.screenshot(path.join(OUT, `cartao-${k}-${tema}.png`));
      }
    }

    for (const k of SEM_VIDEO) {
      await hover(app, `[data-dica="${k}"]`);
      const s = await app.js(cardState);
      res.semVideo[k] = s;
      assert.ok(s.aberta && !s.video, `${k}: devia abrir sem vídeo ${JSON.stringify(s)}`);
    }

    // trocar o tema com o cartão aberto troca o vídeo (no mesmo ponto, tocando)
    await app.js(`forgia.theme.set('claro', { save: false })`);
    await hover(app, '[data-dica="cruise"]');
    const antes = await waitPlaying(app);
    await app.js(`forgia.theme.set('escuro', { save: false })`);
    await wait(600);
    const depois = await waitPlaying(app);
    res.troca = { antes, depois };
    assert.ok(antes.src.endsWith('cruise-claro.webm') && depois.src.endsWith('cruise-escuro.webm'), JSON.stringify(res.troca));
    assert.ok(depois.aberta && !depois.paused, 'depois da troca o cartão segue aberto e tocando');

    // loop: o tempo do vídeo dá a volta sem parar
    let prev = depois.t;
    let wrapped = false;
    for (let i = 0; i < 80 && !wrapped; i++) {
      await wait(100);
      const s = await app.js(cardState);
      if (s.t < prev - 1) wrapped = !s.paused;
      prev = s.t;
    }
    res.loop = { deuVolta: wrapped };
    assert.ok(wrapped, 'o vídeo não deu a volta');

    // pausar/tocar pelo botão redondo (clique real)
    const btn = await center(app, '.dica .dica-play');
    await app.mouse('mouseMoved', btn.x, btn.y);
    await wait(150);
    const click = async () => {
      await app.mouse('mousePressed', btn.x, btn.y, { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', btn.x, btn.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(250);
      return app.js(`(() => { const v = document.querySelector('.dica video'); const b = document.querySelector('.dica .dica-play'); return { paused: v.paused, t: v.currentTime, rotulo: b.getAttribute('aria-label'), aberta: document.querySelector('.dica').classList.contains('aberta') }; })()`);
    };
    const pausado = await click();
    await wait(500);
    const aindaPausado = await app.js(`document.querySelector('.dica video').currentTime`);
    const tocando = await click();
    res.pausar = { pausado, aindaPausado, tocando };
    assert.ok(pausado.paused && pausado.aberta && pausado.rotulo === 'Tocar vídeo', JSON.stringify(pausado));
    assert.ok(Math.abs(aindaPausado - pausado.t) < 0.05, 'pausado, o tempo não anda');
    assert.ok(!tocando.paused && tocando.rotulo === 'Pausar vídeo', JSON.stringify(tocando));

    // fechar: tirar o mouse; o vídeo para e o arquivo é solto
    const vp = await center(app, '#viewport');
    await app.mouse('mouseMoved', vp.x, vp.y + 120);
    await wait(500);
    res.fechar = await app.js(`(() => { const c = document.querySelector('.dica'); const v = c.querySelector('video'); return { aberta: c.classList.contains('aberta'), paused: v ? v.paused : null, src: v ? v.getAttribute('src') : null }; })()`);
    assert.ok(!res.fechar.aberta && res.fechar.paused === true && !res.fechar.src, JSON.stringify(res.fechar));

    // fluidez: câmera girando 4 s com o cartão fechado e 4 s com o cartão aberto e o vídeo tocando
    await app.js(`forgia.editor.select([])`);
    const fechado = await app.js(orbit(4000));
    await hover(app, '[data-dica="workplane"]');
    await waitPlaying(app);
    const aberto = await app.js(orbit(4000));
    const s = await app.js(cardState);
    res.fps = { fechado, aberto, videoTocando: !s.paused };
    assert.ok(s.aberta && !s.paused, 'o cartão devia seguir aberto, tocando, durante a medida');
    assert.ok(aberto.fps >= fechado.fps * 0.9, `perdeu fluidez: ${JSON.stringify(res.fps)}`);
    await app.screenshot(path.join(OUT, 'cartao-aberto-girando.png'));
    assert.deepEqual(app.console.filter((m) => !/Autofill|GPU stall|WebGL/i.test(m)), [], 'erros no console');
  } finally {
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(res, null, 1) + '\n');
    await app.close();
  }
});
