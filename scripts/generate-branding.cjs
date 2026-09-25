// Rasterize our SVG with the Chromium bundled in the existing Electron devDependency.
// Run: npm run branding:generate (no network, fonts or third-party image service).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const output = path.join(__dirname, '..', 'public', 'branding');
const base = 'forgia-forge-v1';
const sizes = [16, 24, 32, 48, 64, 128, 256];
// Keep the generator completely separate from the user's Forgia profile.
app.setPath('userData', path.join(__dirname, '..', 'build', 'branding-generator-profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'branding-generator' } });
  try {
    const svg = fs.readFileSync(path.join(output, `${base}.svg`));
    const data = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    await win.loadURL('data:text/html,<meta charset="utf-8"><title>Forgia asset generator</title>');
    const frames = await win.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(data)};
      await image.decode();
      return ${JSON.stringify([...sizes, 1024])}.map(size => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    })()`);
    const pngs = frames.map(value => Buffer.from(value, 'base64'));
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const at = 6 + index * 16;
      header[at] = header[at + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
      header.writeUInt32LE(pngs[index].length, at + 8); header.writeUInt32LE(offset, at + 12);
      offset += pngs[index].length;
    });
    const png = pngs[7], ico = Buffer.concat([header, ...pngs.slice(0, 7)]);
    fs.writeFileSync(path.join(output, `${base}.png`), png);
    fs.writeFileSync(path.join(output, `${base}.ico`), ico);
    const hash = value => createHash('sha256').update(value).digest('hex');
    fs.writeFileSync(path.join(output, `${base}.json`), JSON.stringify({
      source: `${base}.svg`, renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      pngSize: 1024, icoSizes: sizes, sha256: { svg: hash(svg), png: hash(png), ico: hash(ico) },
    }, null, 2) + '\n');
    console.log(`Generated ${base}.png (1024px) and .ico (${sizes.join('/')})`);
  } finally { win.destroy(); }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
