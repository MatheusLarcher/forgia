// Marcar parte (tecla N) no Forgia.exe GERADO, com eventos reais de mouse e teclado (CDP) e perfil
// temporário: realce da parte, alfinete num filho de grupo (inclusive na parede do furo), mini-chat
// com a referência, Enter copia texto + PNG (área de transferência do Windows conferida pelo
// PowerShell; o texto que estava lá é devolvido no fim), marcações fora do projeto e do desfazer,
// forgia_marcacoes e captura com alfinetes pela ponte, some ao excluir a parte, Limpar marcações.
//   FORGIA_EXE=release\fase-c\win-unpacked\Forgia.exe node --test tests/marcar-exe.test.mjs
// Evidências em docs/fase-c-evidence/marcar/ (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exePath, tempProfile, Forgia, bridgeRequest, pngSize, wait, ROOT } from './forgia-exe.mjs';

const EXE = exePath();
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'marcar');
const results = {};

function ps(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').trim();
}
const clipboardText = () => ps('Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [Text.Encoding]::UTF8; [System.Windows.Forms.Clipboard]::GetText()');
const clipboardHasImage = () => ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::ContainsImage()') === 'True';
const clipboardImageSize = () => ps('Add-Type -AssemblyName System.Windows.Forms; $i = [System.Windows.Forms.Clipboard]::GetImage(); if ($i) { "$($i.Width)x$($i.Height)" }');

async function key(app, k, code, vk) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k.length === 1 ? k : undefined });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await wait(120);
}

test('Marcar parte no Forgia.exe', { skip: !EXE && 'defina FORGIA_EXE com o Forgia.exe gerado', timeout: 240000 }, async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = tempProfile('forgia-marcar-');
  const app = await Forgia.open(EXE, profile);
  const api = async (cmd, a = {}) => (await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd, args: a })).json;
  const savedClipboard = clipboardText();
  // ponto do mundo (interno) -> coordenada de tela da página
  const screen = (p) => app.js(`(() => { const ed = forgia.editor; const c = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(new (ed.camera.position.constructor)(${p.join(',')})); return { x: c.x + s.x, y: c.y + s.y }; })()`);
  try {
    const built = await api('lote', { comandos: [
      { cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [80, 60, 5], nome: 'base' },
      { cmd: 'criar', ref: 'aba', tipo: 'caixa', medidas: [80, 5, 40], sobre: '$base', centro: [null, 27.5, null], nome: 'aba' },
      { cmd: 'criar', ref: 'furo', tipo: 'cilindro', medidas: [8, 8, 5], centro: [0, -10, null], furo: true, nome: 'furo', params: { lados: 48 } },
      { cmd: 'agrupar', ids: ['$base', '$aba', '$furo'], nome: 'suporte', ref: 'sup' },
    ] });
    const ids = built.refs;
    const h0 = await app.js('forgia.editor.historyIndex');
    const snap0 = await app.js('forgia.editor.snapshot()');
    await app.js('(forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)');
    await wait(900);

    await t.test('N liga a ferramenta; passar o mouse realça a PARTE (a aba), não o grupo', async () => {
      await app.mouse('mouseMoved', 5, 5);
      await key(app, 'n', 'KeyN', 78);
      assert.equal(await app.js('forgia.editor.tool && forgia.editor.tool.name'), 'mark');
      // frente da aba (Y do usuário = 25 → z interno = −25), meio da altura
      const p = await screen([10, 25, -25.01]);
      for (let i = 0; i < 4; i++) await app.mouse('mouseMoved', p.x + i, p.y);
      const hv = await app.js('(() => { const m = forgia.editor.tools.mark; return m.hover ? { parte: m.hover.part.id, topo: m.hover.top.id, contorno: m.outline.visible } : null; })()');
      assert.deepEqual(hv, { parte: ids.aba, topo: ids.sup, contorno: true });
      await app.screenshot(path.join(OUT, 'realce-da-parte.png'));
      results.realce = hv;
    });

    await t.test('clique põe o alfinete 1 na aba; mini-chat com a referência no sistema Z para cima', async () => {
      const p = await screen([10, 25, -25.01]);
      await app.mouse('mousePressed', p.x + 3, p.y, { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p.x + 3, p.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(250);
      const m = await app.js('(() => { const ed = forgia.editor; return { n: ed.marks.length, info: ed.marks[0].info(), chat: document.querySelector(".marca-chat .marca-ref")?.textContent, pin: !!document.querySelector(".pin") }; })()');
      assert.equal(m.n, 1);
      assert.equal(m.info.parte.id, ids.aba);
      assert.equal(m.info.peca.id, ids.sup);
      assert.equal(m.info.face, '-Y');
      assert.equal(m.info.lado_da_parte, '-Y');
      assert.ok(Math.abs(m.info.ponto[1] - 25) < 0.05, 'ponto na frente da aba (Y = 25)');
      assert.match(m.chat, /^Marcação 1: Caixa 'aba' \(parte de 'suporte'\), ponto \(.+; 25; .+\) mm, face virada para −Y$/);
      assert.equal(m.pin, true);
      results.alfinete1 = m;
    });

    await t.test('Enter no mini-chat monta o pedido e copia texto + PNG', async () => {
      await app.js('document.querySelector(".marca-chat textarea").focus(), true');
      await app.send('Input.insertText', { text: 'aumenta essa aba em 2 mm' });
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
        await wait(250);
        await app.screenshot(path.join(OUT, `mini-chat-${tema}.png`));
      }
      await key(app, 'Enter', 'Enter', 13);
      await wait(900);
      const copied = await app.js('forgia.editor.tools.mark.lastCopy');
      const toast = await app.js('[...document.querySelectorAll(".toast")].map((e) => e.textContent).join(" | ")');
      const text = clipboardText();
      assert.match(toast, /Copiado\. Cole no seu agente\./);
      assert.equal(text.replace(/\r\n/g, '\n'), copied.text);
      assert.match(text, /Pedido: aumenta essa aba em 2 mm/);
      const json = JSON.parse(/```forgia-pedido\r?\n([\s\S]+?)\r?\n```/.exec(text)[1]);
      assert.equal(json.formato, 'forgia.pedido/1');
      assert.equal(json.marcacoes[0].parte.id, ids.aba);
      assert.equal(clipboardHasImage(), true, 'imagem junto na área de transferência');
      results.pedido = { texto: text, imagem: clipboardImageSize(), pngBytesDataUrl: copied.png };
      fs.writeFileSync(path.join(OUT, 'pedido-copiado.txt'), text);
      await app.js('forgia.theme.set("claro"), true');
    });

    await t.test('na parede do furo, a parte marcada é o furo', async () => {
      const hole = (await api('estado', { ids: [ids.furo] })).objetos[0];
      const [hx, hy] = hole.centro; // usuário: X, Y (Y do usuário = −z interno)
      const hz = -hy;
      // câmera acima do furo, olhando a parede do fundo pela abertura
      await app.js(`(() => { const ed = forgia.editor; const V = ed.camera.position.constructor; ed.restoreView({ ortho: false, pos: new V(${hx}, 40, ${hz} + 2), target: new V(${hx}, 2.5, ${hz} - 3.99), up: new V(0, 1, 0), zoom: 1, orthoHeight: ed.orthoHeight }); return true; })()`);
      await wait(300);
      const p = await screen([hx, 2.5, hz - 3.99]);
      await app.mouse('mouseMoved', p.x, p.y);
      await app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(250);
      const m = await app.js('(() => { const ed = forgia.editor; const k = ed.marks[ed.marks.length - 1]; return { n: ed.marks.length, info: k.info() }; })()');
      assert.equal(m.n, 2);
      assert.equal(m.info.parte.id, ids.furo);
      assert.equal(m.info.parte.furo, true);
      assert.match(m.info.referencia, /^Marcação 2: furo Cilindro 'furo' \(parte de 'suporte'\)/);
      await app.screenshot(path.join(OUT, 'alfinete-no-furo.png'));
      results.alfinete2 = m.info;
      await key(app, 'Escape', 'Escape', 27);
      await app.js('(forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)');
      await wait(700);
    });

    await t.test('marcações fora do projeto e do desfazer', async () => {
      assert.equal(await app.js('forgia.editor.historyIndex'), h0);
      assert.equal(await app.js('forgia.editor.snapshot()'), snap0);
      assert.equal(await app.js("JSON.parse(localStorage.getItem('forgia.design.v1')).objects.length"), 1);
      assert.ok(!(await app.js("localStorage.getItem('forgia.design.v1')")).includes('marca'));
    });

    await t.test('forgia_marcacoes e captura com os alfinetes pela ponte', async () => {
      const r = await api('marcacoes');
      assert.equal(r.marcacoes.length, 2);
      assert.deepEqual(r.marcacoes.map((m) => m.parte.id), [ids.aba, ids.furo]);
      assert.equal(r.marcacoes[0].pedido, 'aumenta essa aba em 2 mm');
      const st = await api('estado');
      assert.equal(st.marcacoes.length, 2);
      const withPins = await api('captura', { vista: 'atual', largura: 800, altura: 600 });
      const without = await api('captura', { vista: 'atual', largura: 800, altura: 600, marcacoes: false });
      assert.equal(withPins.marcacoes, 2);
      const a = Buffer.from(withPins.imagem.split(',')[1], 'base64');
      const b = Buffer.from(without.imagem.split(',')[1], 'base64');
      assert.equal(pngSize(a).w, 800);
      assert.notEqual(a.length, b.length, 'a imagem com alfinetes é outra');
      fs.writeFileSync(path.join(OUT, 'captura-com-alfinetes.png'), a);
      fs.writeFileSync(path.join(OUT, 'captura-sem-alfinetes.png'), b);
      results.ponte = r.marcacoes;
    });

    await t.test('excluir a parte some com a marcação dela; Limpar marcações tira o resto', async () => {
      const del = await api('excluir', { ids: [ids.aba] });
      assert.equal(del.ok, true);
      await wait(200);
      const left = await app.js('forgia.editor.marks.map((m) => m.partId)');
      assert.deepEqual(left, [ids.furo]);
      const btn = await app.js('(() => { const b = document.getElementById("btn-limpar-marcas"); return { hidden: b.hidden, texto: b.textContent }; })()');
      assert.deepEqual(btn, { hidden: false, texto: 'Limpar marcações (1)' });
      await app.screenshot(path.join(OUT, 'barra-limpar-marcacoes.png'));
      await app.js('document.getElementById("btn-limpar-marcas").click(), true');
      await wait(200);
      assert.equal(await app.js('forgia.editor.marks.length'), 0);
      assert.equal(await app.js('document.getElementById("btn-limpar-marcas").hidden'), true);
      assert.equal(await app.js('document.querySelectorAll(".pin").length'), 0);
      const again = await api('marcacoes');
      assert.equal(again.marcacoes.length, 0);
    });

    await t.test('o agente também limpa: forgia_marcacoes { limpar: true }', async () => {
      await app.js('forgia.editor.setTool(null), true');
      await key(app, 'n', 'KeyN', 78);
      const top = (await api('estado')).objetos[0];
      const p = await screen([top.centro[0], top.caixa.max[2], -top.centro[1]]);
      await app.mouse('mouseMoved', p.x, p.y);
      await app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(200);
      assert.equal(await app.js('forgia.editor.marks.length'), 1);
      const r = await api('marcacoes', { limpar: true });
      assert.equal(r.marcacoes.length, 1, 'devolve o que havia');
      assert.equal(await app.js('forgia.editor.marks.length'), 0);
    });
  } finally {
    results.console = app.console.slice(0, 20);
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(results, null, 2));
    if (savedClipboard) ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(savedClipboard, 'utf8').toString('base64')}')))`);
    await app.close();
    await wait(500);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
});
