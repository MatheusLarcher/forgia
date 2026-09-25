// Evidence runner: actual compiled app, isolated in-memory session, no user data.
// Run after dist:win:branding: node_modules/.bin/electron tests/branding-runtime.cjs
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const evidence = path.join(root, 'docs', 'branding-evidence');
app.setPath('userData', path.join(root, 'build', 'branding-test-profile'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `branding-test-${Date.now()}` } });
  const wc = win.webContents;
  const messages = [];
  wc.on('console-message', (_event, level, message) => { if (level >= 2) messages.push({ level, message }); });
  const js = source => wc.executeJavaScript(source);
  const shot = async name => { await wait(300); fs.writeFileSync(path.join(evidence, name + '.png'), (await wc.capturePage()).toPNG()); };
  const project = () => js('JSON.parse(localStorage.getItem("forgia.design.v1"))');
  try {
    // Use the real packaged resource, not an alternative HTML fixture.
    const entry = path.join(root, 'release', 'branding', 'win-unpacked', 'resources', 'app.asar', 'dist', 'index.html');
    await win.loadFile(entry); await wait(1500);
    assert.equal(await js('localStorage.length'), 0);
    assert.equal(await js('document.querySelector(".logo-symbol").naturalWidth'), 1024);
    assert.ok(!nativeImage.createFromPath(path.join(path.dirname(entry), 'branding', 'forgia-forge-v1.ico')).isEmpty());
    await shot('app-empty-file');
    // Real pointer events: drag the library box onto the workplane.
    const points = await js(`(() => {const a=document.querySelector('.tile[data-label="Caixa"]').getBoundingClientRect();const b=document.querySelector('#viewport > canvas').getBoundingClientRect();return {x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2),tx:Math.round(b.x+b.width*.5),ty:Math.round(b.y+b.height*.55)};})()`);
    wc.sendInputEvent({ type: 'mouseMove', x: points.x, y: points.y });
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: points.x, y: points.y });
    wc.sendInputEvent({ type: 'mouseMove', x: points.tx, y: points.ty });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: points.tx, y: points.ty });
    await wait(400);
    assert.equal((await project()).objects.length, 1);
    await js(`(() => {const e=document.querySelector('#inspector input[type=number]');e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal((await project()).objects[0].params.radius, 2);
    await shot('app-edited-file');
    await win.loadFile(entry); await wait(900);
    assert.equal((await project()).objects[0].params.radius, 2);
    await win.loadURL('about:blank'); await win.loadFile(entry); await wait(900);
    assert.equal(await js('document.querySelector(".logo-symbol").naturalWidth'), 1024);
    assert.equal((await project()).objects.length, 1);
    await js(`document.querySelector('#viewport > canvas').focus(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:true,bubbles:true})); document.querySelector('[data-cmd=delete]').click();`);
    assert.equal((await project()).objects.length, 0);
    await js(`(() => {const dt=new DataTransfer();dt.items.add(new File(['invalid zip'],'branding-invalid.3mf'));const input=document.querySelector('#file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(200);
    assert.match(await js('document.querySelector(".toast")?.textContent || ""'), /Não foi possível ler o arquivo/);
    await shot('app-invalid-file');
    assert.equal((await project()).objects.length, 0);
    // Display the very same SVG at native icon sizes, plus the 1024 raster.
    const uri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'public/branding/forgia-forge-v1.svg')).toString('base64');
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:64px;background:#f5f6f7;color:#2b2f33;font:16px Segoe UI"><h1 style="font-size:28px;font-weight:600">Forgia</h1><p>F esculpido · laranja-forja / grafite</p><div style="display:flex;align-items:end;gap:32px;margin-top:48px">${[16,24,32,36,48,64,128,256].map(size=>`<div><img src="${uri}" width="${size}" height="${size}"><p>${size}px</p></div>`).join('')}</div></body></html>`));
    await shot('brand-scales');
    fs.writeFileSync(path.join(evidence, 'runtime.json'), JSON.stringify({
      result: 'PASS', entry, viewport: '1400x900', isolatedSession: true,
      checks: ['file:// ASAR entry loads', 'SVG image decoded', 'ICO decoded by Electron', 'empty project', 'real mouse drag creates box', 'radius edit 0→2', 'reload preserves edit', 'navigate away/back preserves edit and logo', 'select/delete leaves zero objects', 'invalid 3MF toast without mutation'],
      consoleWarningsAndErrors: messages,
    }, null, 2));
    console.log('PASS: packaged file:// app, create/edit/reload/navigate/delete/invalid-file, 4 screenshots saved.');
    if (messages.length) console.log('Console messages:', JSON.stringify(messages));
  } finally { win.destroy(); }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
