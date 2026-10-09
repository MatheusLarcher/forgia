// Loading da abertura (#carregando, src/carregando.js) no Forgia.exe GERADO: aparece na abertura,
// no tema claro e no escuro, e sai sozinho; reabrir 2x com o mesmo perfil. Janela de abertura
// (electron/splash.html): fecha quando o editor aparece maximizado, também com a pergunta de
// recuperar na abertura, e o .forgia da 2ª instância (duplo clique) abre. Só roda com FORGIA_EXE:
//   FORGIA_EXE=release\loading\win-unpacked\Forgia.exe node --test tests/carregando-exe.test.mjs
// Capturas em docs/fase-c-evidence/carregando/ (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { exePath, tempProfile, Forgia, ROOT, wait, bridgeRequest, fileDialog } from './forgia-exe.mjs';

const EXE = exePath();
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'carregando');
const VISIVEL = "(() => { const c = document.getElementById('carregando'); return !!c && !c.classList.contains('saindo'); })()";
const FORA = "!document.getElementById('carregando') && document.documentElement.dataset.carregado === '1'";

// recarrega com a CPU freada (o loading dura poucos quadros num PC rápido) para conseguir capturá-lo
async function capturarLoading(app, tema) {
  await app.js(`localStorage.setItem('forgia.tema', '${tema}')`);
  await app.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await app.send('Page.reload', { ignoreCache: true });
  await app.waitFor(VISIVEL, 15000, 'loading visível');
  const vis = await app.js(`(() => { const c = document.getElementById('carregando'); return { tema: document.documentElement.dataset.tema, fundo: getComputedStyle(c).backgroundColor, role: c.getAttribute('role'), texto: c.innerText.trim() }; })()`);
  await app.screenshot(path.join(OUT, `loading-${tema}.png`));
  await app.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await app.waitFor(FORA, 30000, 'loading fora');
  await app.screenshot(path.join(OUT, `editor-${tema}.png`));
  return vis;
}

test('loading da abertura no Forgia.exe', { skip: !EXE && 'defina FORGIA_EXE com o Forgia.exe gerado', timeout: 240000 }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = tempProfile('forgia-carregando-');
  const res = {};
  let app = await Forgia.open(EXE, profile);
  try {
    res.claro = await capturarLoading(app, 'claro');
    assert.equal(res.claro.tema, 'claro');
    assert.equal(res.claro.fundo, 'rgb(233, 236, 239)');
    assert.equal(res.claro.role, 'status');
    res.escuro = await capturarLoading(app, 'escuro');
    assert.equal(res.escuro.tema, 'escuro');
    assert.equal(res.escuro.fundo, 'rgb(22, 24, 27)');
    // reabrir 2x o exe de verdade: o helper só volta quando a ponte está pronta e o loading saiu
    for (let i = 1; i <= 2; i++) {
      await app.close();
      const t0 = Date.now();
      app = await Forgia.open(EXE, profile);
      res[`reabrir${i}`] = { ms: Date.now() - t0, fora: await app.js(FORA) };
      assert.ok(res[`reabrir${i}`].fora);
      await app.screenshot(path.join(OUT, `reaberto-${i}.png`));
    }
    res.console = app.console;
  } finally {
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(res, null, 2));
    await app.close();
  }
});

// janelas visíveis de nível superior do processo: [{ w, h, max }] (abertura 360x340; editor maximizado)
function janelas(pid) {
  const ps = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices; using System.Collections.Generic;',
    'public static class J {',
    '  public delegate bool CB(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] static extern bool EnumWindows(CB cb, IntPtr l);',
    '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);',
    '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);',
    '  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);',
    '  public struct R { public int L, T, Rt, B; }',
    '  public static string Lista(uint pid) {',
    '    var o = new List<string>();',
    '    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) { R r; GetWindowRect(h, out r); o.Add((r.Rt - r.L) + "," + (r.B - r.T) + "," + IsZoomed(h)); } return true; }, IntPtr.Zero);',
    '    return string.Join(";", o);',
    '  }',
    '}',
    '"@',
    `[J]::Lista(${pid})`,
  ].join('\n');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '')
    .trim()
    .split(';')
    .filter(Boolean)
    .map((s) => {
      const [w, h, max] = s.split(',');
      return { w: +w, h: +h, max: max === 'True' };
    });
}

async function aberturaFechada(app) {
  const { targetInfos } = await app.cdp.send('Target.getTargets');
  return !targetInfos.some((t) => t.type === 'page' && /splash\.html/.test(t.url));
}

// o editor na tela, sozinho e maximizado; a abertura já fechou
async function soEditor(app, rotulo) {
  await wait(400);
  const js = janelas(app.pid);
  assert.equal(js.length, 1, `${rotulo}: uma janela visível (${JSON.stringify(js)})`);
  assert.ok(js[0].max, `${rotulo}: editor maximizado`);
  assert.ok(await aberturaFechada(app), `${rotulo}: abertura fechada`);
  return js[0];
}

const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);

test('janela de abertura no Forgia.exe: editor maximizado, recuperar e 2ª instância', { skip: !EXE && 'defina FORGIA_EXE com o Forgia.exe gerado', timeout: 300000 }, async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  const perfil = tempProfile('forgia-abertura-');
  const pasta = tempProfile('forgia-abertura-arq-');
  const arquivo = path.join(pasta, 'abertura.forgia');
  const res = {};
  let app = null;
  try {
    await t.test('abre: a abertura sai e o editor fica maximizado; salva um .forgia', async () => {
      app = await Forgia.open(EXE, perfil);
      res.normal = await soEditor(app, 'abertura normal');
      await cmd(app, 'criar', { tipo: 'cone', medidas: [14, 14, 20], nome: 'cone da abertura' });
      await app.js('void forgia.arquivo.save({ como: true })');
      assert.equal(fileDialog(app.pid, arquivo), 'ok');
      await app.waitFor('!!forgia.arquivo.file && !forgia.arquivo.isDirty()', 20000, 'salvo');
      assert.ok(fs.existsSync(arquivo));
    });

    await t.test('pergunta de recuperar na abertura: o editor aparece com ela, a abertura não a esconde', async () => {
      await cmd(app, 'criar', { tipo: 'cone', medidas: [10, 10, 10], centro: [0, -40, null], nome: 'cone recuperavel' });
      await wait(900); // a cópia de segurança sai ~0,4 s depois
      await app.kill();
      app = await Forgia.open(EXE, perfil, { ready: `!!document.querySelector('.modal [data-escolha="recuperar"]')` });
      res.recuperar = await soEditor(app, 'recuperar');
      await app.screenshot(path.join(OUT, 'recuperar-na-abertura.png'));
      await app.js(`document.querySelector('.modal [data-escolha="recuperar"]').click()`);
      await app.waitFor(`forgia.editor.objects.some((o) => o.name === 'cone recuperavel')`, 20000, 'recuperado');
      await app.close();
      app = null;
    });

    await t.test('duplo clique no .forgia com o Forgia fechado', async () => {
      app = await Forgia.open(EXE, tempProfile('forgia-abertura-argv-'), { extraArgs: [arquivo] });
      await app.waitFor(`forgia.arquivo.file && forgia.arquivo.file.nome === 'abertura.forgia'`, 20000, 'aberto pelo argumento');
      res.argv = await soEditor(app, 'argumento');
      await app.close();
      app = null;
    });

    await t.test('duplo clique no .forgia enquanto o Forgia ainda abre (2ª instância): abre quando o editor aparece', async () => {
      const outro = tempProfile('forgia-abertura-2a-');
      const abrindo = Forgia.open(EXE, outro);
      // a abertura já na tela (o editor ainda carregando): a 2ª instância passa o arquivo e sai
      const t0 = Date.now();
      while (!fs.existsSync(path.join(outro, 'DevToolsActivePort')) && Date.now() - t0 < 15000) await wait(20);
      await wait(150);
      const segunda = spawn(EXE, [`--user-data-dir=${outro}`, arquivo], { stdio: 'ignore' });
      const saiu = await Promise.race([new Promise((r) => segunda.on('exit', (code) => r({ code, em: Date.now() }))), wait(15000).then(() => null)]);
      assert.ok(saiu, 'a 2ª instância saiu');
      app = await abrindo;
      // a 2ª instância veio mesmo antes de o editor carregar? (relógio de parede dos dois lados)
      const carregado = await app.js(`performance.timeOrigin + performance.getEntriesByName('forgia:carregado')[0].startTime`);
      res.segundaAntesDoEditor = { segundaSaiu: saiu.em, editorCarregou: Math.round(carregado), antes: saiu.em < carregado };
      assert.ok(res.segundaAntesDoEditor.antes, 'o pedido da 2ª instância chegou com o editor ainda carregando');
      await app.waitFor(`forgia.arquivo.file && forgia.arquivo.file.nome === 'abertura.forgia'`, 20000, 'aberto pela 2ª instância');
      res.segunda = await soEditor(app, '2ª instância');
      res.console = app.console;
    });
  } finally {
    fs.writeFileSync(path.join(OUT, 'abertura.json'), JSON.stringify(res, null, 2));
    if (app) await app.close();
  }
});
