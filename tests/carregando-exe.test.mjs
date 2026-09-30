// Loading da abertura (#carregando, src/carregando.js) no Forgia.exe GERADO: aparece na abertura,
// no tema claro e no escuro, e sai sozinho; reabrir 2x com o mesmo perfil. Só roda com FORGIA_EXE:
//   FORGIA_EXE=release\loading\win-unpacked\Forgia.exe node --test tests/carregando-exe.test.mjs
// Capturas em docs/fase-c-evidence/carregando/ (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exePath, tempProfile, Forgia, ROOT } from './forgia-exe.mjs';

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
