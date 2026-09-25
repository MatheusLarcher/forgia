import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const asset = name => path.join(root, 'public/branding', `forgia-forge-v1.${name}`);
const sha = data => createHash('sha256').update(data).digest('hex');
function png(buffer, size) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.readUInt32BE(16), size);
  assert.equal(buffer.readUInt32BE(20), size);
  const idat = [];
  let end = false;
  for (let pos = 8; pos < buffer.length;) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    assert.ok(pos + length + 12 <= buffer.length);
    let crc = 0xffffffff;
    for (const byte of buffer.subarray(pos + 4, pos + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, buffer.readUInt32BE(pos + 8 + length), `${type} CRC`);
    if (type === 'IDAT') idat.push(buffer.subarray(pos + 8, pos + 8 + length));
    if (type === 'IEND') end = true;
    pos += length + 12;
  }
  assert.ok(end);
  assert.ok(inflateSync(Buffer.concat(idat)).length >= size * size * 3);
}

test('master and 1024 PNG exist; generated files match the source manifest', () => {
  assert.ok(fs.existsSync(asset('svg')), 'missing SVG master');
  const svg = fs.readFileSync(asset('svg'), 'utf8');
  assert.ok(!/<(?:image|script|foreignObject)|https?:\/\/(?!www.w3.org)/i.test(svg), 'master must be self-contained');
  png(fs.readFileSync(asset('png')), 1024);
  const manifest = JSON.parse(fs.readFileSync(asset('json')));
  for (const ext of ['svg', 'png', 'ico']) assert.equal(sha(fs.readFileSync(asset(ext))), manifest.sha256[ext]);
});

test('ICO has seven complete 32-bit PNG frames, including 16px and 256px', () => {
  assert.ok(fs.existsSync(asset('ico')), 'missing multi-resolution ICO');
  const ico = fs.readFileSync(asset('ico'));
  assert.equal(ico.readUInt32LE(0), 65536);
  assert.equal(ico.readUInt16LE(4), 7);
  let expectedOffset = 118;
  [16, 24, 32, 48, 64, 128, 256].forEach((size, i) => {
    const at = 6 + i * 16;
    assert.equal(ico[at] || 256, size);
    assert.equal(ico[at + 1] || 256, size);
    assert.equal(ico.readUInt16LE(at + 4), 1);
    assert.equal(ico.readUInt16LE(at + 6), 32);
    const length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    assert.equal(offset, expectedOffset);
    png(ico.subarray(offset, offset + length), size);
    expectedOffset += length;
  });
  assert.equal(expectedOffset, ico.length);
});

test('web branding URLs resolve under a nested file deployment', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:href|src)="([^"]*forgia-forge[^\"]+)"/g)].map(m => m[1]);
  assert.ok(urls.length >= 3, 'logo plus favicon formats');
  for (const url of urls) {
    const resolved = new URL(url, 'file:///installation/dist/index.html');
    assert.ok(resolved.pathname.startsWith('/installation/dist/branding/'));
    assert.ok(fs.existsSync(path.join(root, 'public', url)));
  }
});

test('Windows and NSIS consume a valid branded ICO', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  for (const icon of [build.win.icon, build.nsis.installerIcon, build.nsis.uninstallerIcon, build.nsis.installerHeaderIcon]) {
    assert.ok(icon, 'missing Windows/NSIS icon');
    assert.deepEqual(fs.readFileSync(path.join(root, icon)), fs.readFileSync(asset('ico')));
  }
});

test('BrowserWindow icon resolves inside the packaged dist directory', () => {
  let options;
  const app = { commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then: fn => fn() }) };
  class BrowserWindow {
    constructor(value) { options = value; this.webContents = { setWindowOpenHandler() {} }; }
    maximize() {} loadFile() {} once() {} show() {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8'), {
    __dirname: path.join(root, 'electron'),
    process: { argv: [] },
    require: name => name === 'path' ? path : name === './ponte.cjs' ? { startBridge() {} } : name === './projeto.cjs' ? { startProject() {}, fileFromArgv: () => null } : { app, BrowserWindow, Menu: { setApplicationMenu() {} }, shell: {}, nativeTheme: { shouldUseDarkColors: false } },
  });
  assert.ok(options.icon, 'BrowserWindow icon not configured');
  assert.equal(path.relative(path.join(root, 'dist'), options.icon).replaceAll('\\', '/'), 'branding/forgia-forge-v1.ico');
});
