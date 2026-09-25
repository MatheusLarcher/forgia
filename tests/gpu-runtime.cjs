// Evidência de GPU no Electron real: carrega dist/index.html pelo electron/main.cjs de verdade
// (mesmos switches do app), em perfil temporário, e imprime window.forgia.gpu.
// Uso (depois de `npx vite build`):
//   npx electron tests/gpu-runtime.cjs --expect=gpu
//   npx electron tests/gpu-runtime.cjs --disable-gpu --expect=software
//   npx electron tests/gpu-runtime.cjs --disable-gpu --disable-software-rasterizer --expect=none
//   npx electron tests/gpu-runtime.cjs --baseline   (sem os switches do main.cjs, só para comparar)
//   npx electron tests/gpu-runtime.cjs --baseline --force_low_power_gpu --label=lowpower  (prova que o Chromium troca de placa)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`));
const expect = (arg('expect=') || '--expect=').split('=')[1] || null;
const baseline = !!arg('baseline');
const label = (arg('label=') || '').split('=')[1] || (baseline ? 'baseline' : expect || 'run');
const evidence = path.join(root, 'docs', 'gpu-evidence');
// perfil descartável, zerado a cada execução (nunca o perfil do usuário)
const profile = path.join(os.tmpdir(), 'forgia-gpu-test-profile');
fs.rmSync(profile, { recursive: true, force: true });
app.setPath('userData', profile);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// janela "visível" (para pintar e capturar de verdade), mas transparente e sem receber cliques
BrowserWindow.prototype.maximize = function () {};
app.on('browser-window-created', (_e, w) => { w.setOpacity(0); w.setIgnoreMouseEvents(true); w.setSkipTaskbar(true); });

if (baseline) {
  app.whenReady().then(() => {
    new BrowserWindow({ width: 1400, height: 900 }).loadFile(path.join(root, 'dist', 'index.html'));
  });
} else {
  require(path.join(root, 'electron', 'main.cjs'));
}

app.whenReady().then(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await wait(100); }
  win.setContentSize(1400, 900);
  const wc = win.webContents;
  const messages = [];
  wc.on('console-message', (_e, level, message) => { if (level >= 2) messages.push({ level, message }); });
  const js = (s) => wc.executeJavaScript(s);
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  let gpu = null;
  for (let i = 0; i < 100; i++) { gpu = await js('window.forgia && window.forgia.gpu'); if (gpu && gpu.mode) break; await wait(100); }
  await wait(1500);

  // sem GPU nem SwiftShader o Electron recusa getGPUInfo
  const info = await app.getGPUInfo('complete').catch((err) => ({ error: err.message }));
  const devices = (info.gpuDevice || []).map((d) => ({ vendorId: d.vendorId.toString(16), deviceId: d.deviceId.toString(16), active: d.active, description: d.deviceString || d.driverVendor }));
  const result = { label, switches: process.argv.filter((a) => a.startsWith('--') && !a.startsWith('--expect') && !a.startsWith('--label')), gpu, glRenderer: info.auxAttributes ? info.auxAttributes.glRenderer : info.error, devices, checks: [] };

  if (gpu.mode === 'none') {
    const msg = await js('document.querySelector(".gpu-fail")?.innerText || ""');
    assert.match(msg, /O 3D não pôde iniciar/);
    assert.equal(await js('!!document.querySelector("#viewport canvas")'), false);
    result.message = msg;
    result.checks.push('mensagem amigável no viewport, sem canvas');
  } else {
    // o canvas principal desenhou algo (plano/grade), não ficou em branco
    const painted = await js(`(() => { const c=document.querySelector('.main-canvas'); const t=document.createElement('canvas'); t.width=c.width; t.height=c.height; const g=t.getContext('2d'); g.drawImage(c,0,0); const d=g.getImageData(0,0,t.width,t.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]) n++; return n / (d.length/4); })()`);
    assert.ok(painted > 0.2, `canvas quase vazio (${painted})`);
    result.paintedFraction = Math.round(painted * 1000) / 1000;
    result.checks.push('canvas principal desenhado');
    result.toast = await js('document.querySelector(".toast")?.textContent || null');
    // arrastar a Caixa da biblioteca para o plano (eventos reais), depois excluir
    const p = await js(`(() => {const a=document.querySelector('.tile[data-label="Caixa"]').getBoundingClientRect();const b=document.querySelector('.main-canvas').getBoundingClientRect();return {x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2),tx:Math.round(b.x+b.width*.5),ty:Math.round(b.y+b.height*.55)};})()`);
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseMove', x: p.tx, y: p.ty });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: p.tx, y: p.ty });
    await wait(500);
    const objs = await js('window.forgia.editor.objects.map(o => o.type + (o.hole ? "(furo)" : ""))');
    assert.equal(objs.length, 1, `objetos após arrastar: ${JSON.stringify(objs)}`);
    result.checks.push('arrastar Caixa cria 1 objeto');
    await js('document.querySelector("#btn-help").click()');
    result.helpLine = await js('document.querySelector(".gpu-line")?.textContent || null');
    assert.match(result.helpLine, /^Placa de vídeo: .+ \((GPU|modo software)\)$/);
    result.checks.push('linha da placa no diálogo Atalhos');
    await js('document.querySelector(".modal-body").scrollTop = 1e6'); // linha da placa visível no print
    await wait(300);
    fs.writeFileSync(path.join(evidence, `${label}.png`), (await wc.capturePage()).toPNG());
    await js('window.forgia.ui.closeModal(); window.forgia.editor.selectAll?.(); document.querySelector("[data-cmd=delete]").click()');
    await wait(200);
    if (await js('window.forgia.editor.objects.length')) {
      await js(`document.querySelector('.main-canvas').focus(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:true,bubbles:true})); document.querySelector('[data-cmd=delete]').click();`);
    }
    assert.equal(await js('window.forgia.editor.objects.length'), 0);
    result.checks.push('excluir deixa 0 objetos');
  }
  if (gpu.mode === 'none') fs.writeFileSync(path.join(evidence, `${label}.png`), (await wc.capturePage()).toPNG());
  if (expect) assert.equal(gpu.mode, expect, `modo esperado ${expect}, obtido ${gpu.mode}`);
  result.consoleWarningsAndErrors = messages;
  result.result = 'PASS';
  fs.writeFileSync(path.join(evidence, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})
  .then(() => app.exit(0))
  .catch((err) => { console.error('FAIL:', err); app.exit(1); });
