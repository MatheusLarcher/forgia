// Run after npm run dist:win:branding.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';
const root = fileURLToPath(new URL('../', import.meta.url));
const archive = path.join(root, 'release/branding/win-unpacked/resources/app.asar');
const publicIcon = fs.readFileSync(path.join(root, 'public/branding/forgia-forge-v1.ico'));
// @electron/asar splits entry paths on the platform separator, so '/' fails on Windows.
const entry = (p) => p.split('/').join(path.sep);

test('ASAR includes identical SVG, PNG and ICO; compiled HTML URLs resolve', () => {
  for (const ext of ['svg', 'png', 'ico']) {
    const name = `branding/forgia-forge-v1.${ext}`;
    assert.deepEqual(asar.extractFile(archive, entry(`dist/${name}`)), fs.readFileSync(path.join(root, 'public', name)));
  }
  const html = asar.extractFile(archive, entry('dist/index.html')).toString();
  const refs = [...html.matchAll(/(?:href|src)="([^\"]*forgia-forge[^\"]+)"/g)].map(m => m[1]);
  assert.equal(refs.length, 3);
  for (const ref of refs) {
    const url = new URL(ref, 'file:///app.asar/dist/index.html');
    assert.ok(url.pathname.startsWith('/app.asar/dist/branding/'));
    assert.ok(asar.extractFile(archive, entry(url.pathname.slice('/app.asar/'.length))).length > 0);
  }
});

test('application executable and NSIS installer contain all seven branded icon frames', () => {
  for (const file of ['release/branding/win-unpacked/Forgia.exe', 'release/branding/Forgia-Setup-0.1.0.exe']) {
    const exe = fs.readFileSync(path.join(root, file));
    assert.equal(exe.toString('ascii', 0, 2), 'MZ');
    for (let index = 0; index < 7; index++) {
      const at = 6 + index * 16;
      const size = publicIcon.readUInt32LE(at + 8), offset = publicIcon.readUInt32LE(at + 12);
      assert.ok(exe.includes(publicIcon.subarray(offset, offset + size)), `${file}: missing ICO frame ${index}`);
    }
  }
});
