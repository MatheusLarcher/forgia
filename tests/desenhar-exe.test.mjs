// Desenhar (tecla B) no exe gerado: o traço não cruza a si mesmo, encosta na linha e para ali.
// À mão livre e com cliques (a linha elástica também). Perfil temporário.
// FORGIA_EXE=release\<pasta>\win-unpacked\Forgia.exe node --test tests/desenhar-exe.test.mjs
// Capturas em %TEMP%\forgia-desenhar-shots.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait } from './forgia-exe.mjs';
import { selfIntersects } from '../src/outline.js';

const exe = exePath();
const shots = path.join(os.tmpdir(), 'forgia-desenhar-shots');

// algum par de trechos não vizinhos do caminho aberto se cruza?
function crosses(pts) {
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      const [a, b, c, d] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
      const d1 = cr(c, d, a);
      const d2 = cr(c, d, b);
      const d3 = cr(a, b, c);
      const d4 = cr(a, b, d);
      if (d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0)) return [i, j]; // passar por cima de um vértice também conta
    }
  }
  return null;
}

test('Desenhar: o traço encosta na própria linha e não passa por cima', { skip: !exe && 'defina FORGIA_EXE', timeout: 120000 }, async (t) => {
  const app = await Forgia.open(exe, tempProfile('forgia-desenhar-'));
  const key = async (k, code, vk) => {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await wait(150);
  };
  const c = await app.js(`(() => { const r = forgia.editor.renderer.domElement.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const at = (dx, dy) => ({ x: c.x + dx, y: c.y + dy });
  const path2 = () => app.js('(() => { const d = forgia.editor.tool; return [...d.points, ...(d.stroke ? d.stroke.pts : [])]; })()');
  // pixels na mesa -> mm (vista de topo)
  const mmPorPx = () => app.js('forgia.editor.pixelSize(forgia.editor.controls.target)');
  try {
    await t.test('à mão livre: vem de cima, encosta no 1º trecho e não cruza', async () => {
      await app.mouse('mouseMoved', 5, 5);
      await key('b', 'KeyB', 66);
      assert.equal(await app.js('forgia.editor.tool && forgia.editor.tool.name'), 'draw');
      await wait(500); // a vista vai para o topo
      const seq = [at(-120, 0)];
      const leg = (a, b, n = 20) => {
        for (let i = 1; i <= n; i++) seq.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
      };
      leg(at(-120, 0), at(120, 0));
      leg(at(120, 0), at(120, -120));
      leg(at(120, -120), at(0, -120));
      leg(at(0, -120), at(0, 100), 30); // atravessaria o 1º trecho em (0, 0)
      leg(at(0, 100), at(-60, 100), 10);
      await app.mouse('mouseMoved', seq[0].x, seq[0].y);
      await app.mouse('mousePressed', seq[0].x, seq[0].y, { button: 'left', buttons: 1, clickCount: 1 });
      for (const p of seq.slice(1)) {
        await app.mouse('mouseMoved', p.x, p.y, { button: 'left', buttons: 1 });
        await wait(8);
      }
      await wait(100);
      const pts = await path2();
      assert.ok(pts.length > 20, `${pts.length} pontos`);
      assert.equal(crosses(pts), null, 'o traço em andamento não se cruza');
      // o fim parou encostado no 1º trecho (a mesma profundidade z dele, do lado de cima)
      const z0 = pts[0][1];
      const last = pts[pts.length - 1];
      const k = await mmPorPx();
      assert.ok(Math.abs(last[1] - z0) < 6 * k, `fim a ${(Math.abs(last[1] - z0) / k).toFixed(1)} px da linha`);
      await app.screenshot(path.join(shots, '01-mao-livre-encostou.png'));
      const fim = seq[seq.length - 1];
      await app.mouse('mouseReleased', fim.x, fim.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(400);
      await app.screenshot(path.join(shots, '02-mao-livre-solto.png'));
      // o traço começado do zero fecha ao soltar: vira a peça (ou avisa), mas nunca um contorno cruzado
      const obj = await app.js(`forgia.editor.objects.filter((o) => o.type === 'desenho').map((o) => o.params.points)`);
      for (const p of obj) assert.equal(selfIntersects(p), false, 'a peça não tem contorno cruzado');
      // terminou encostado: o laço fecha ali e o começo antes do encosto sai (só o quadrado, sem rebarba)
      const tam = await app.js("forgia.editor.objects.filter((o) => o.type === 'desenho').map((o) => o.size)");
      assert.equal(tam.length, 1, 'a peça foi criada');
      assert.ok(tam[0][0] < 120 * k * 1.1 && tam[0][0] > 120 * k * 0.9, `largura ${tam[0][0]} mm (o quadrado tem ${(120 * k).toFixed(1)})`);
      if (await app.js('forgia.editor.tool && forgia.editor.tool.name')) await key('Escape', 'Escape', 27);
      await app.js('(forgia.editor.change(() => forgia.editor.objects.splice(0)), true)');
    });

    await t.test('com cliques: o vértice que cruzaria para na linha, e a linha elástica também', async () => {
      await key('b', 'KeyB', 66);
      await wait(500);
      const tap = async (p) => {
        await app.mouse('mouseMoved', p.x, p.y);
        await app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
        await app.mouse('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: 1 });
        await wait(120);
      };
      await tap(at(-120, 0));
      await tap(at(120, 0));
      await tap(at(120, -120));
      // a linha elástica até um cursor do outro lado do 1º trecho encosta nele
      await app.mouse('mouseMoved', c.x - 40, c.y + 90);
      await wait(150);
      const cursor = await app.js('forgia.editor.tool.cursor');
      const pts0 = await path2();
      const k = await mmPorPx();
      assert.ok(Math.abs(cursor[1] - pts0[0][1]) < 6 * k, 'o cursor da linha elástica parou na linha');
      await app.screenshot(path.join(shots, '03-elastica-encostou.png'));
      await tap(at(-40, 90));
      const pts = await path2();
      assert.equal(pts.length, 4);
      assert.equal(crosses(pts), null, 'nenhum trecho cruza');
      assert.ok(Math.abs(pts[3][1] - pts[0][1]) < 6 * k, 'o 4º vértice ficou na linha, não do outro lado');
      await key('Escape', 'Escape', 27);
    });
    assert.deepEqual(app.console.filter((m) => /exceção|Uncaught/i.test(m)), []);
  } finally {
    await app.close();
  }
});
