// Lógica de GPU do electron/main.cjs com Electron e reg.exe simulados (não toca o registro real).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const EXE = 'C:\\Users\\Teste\\AppData\\Local\\Programs\\Forgia\\Forgia.exe';

// queryResult: null = valor já existe; {code} = erro do reg query
function run({ isPackaged = true, platform = 'win32', queryResult = { code: 1 }, addResult = null } = {}) {
  const switches = [], calls = [], warnings = [];
  const execFile = (file, args, opts, cb) => {
    calls.push({ file, args: [...args], opts }); // cópia: array do vm é de outro realm
    cb(args[0] === 'query' ? (queryResult && Object.assign(new Error('reg'), queryResult)) : addResult);
  };
  const app = {
    isPackaged,
    commandLine: { appendSwitch: (s, v) => switches.push(v === undefined ? s : `${s}=${v}`) },
    requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }),
  };
  vm.runInNewContext(source, {
    __dirname: path.join(root, 'electron'),
    process: { platform, execPath: EXE },
    console: { warn: (...a) => warnings.push(a.join(' ')) },
    require: (name) => name === 'path' ? path : name === 'child_process' ? { execFile } : { app, BrowserWindow: class {}, Menu: {}, shell: {} },
  });
  return { switches, calls, warnings };
}

test('switches: GPU dedicada + SwiftShader como fallback, sem desligar blocklist nem GPU', () => {
  const { switches } = run({ isPackaged: false });
  assert.deepEqual(switches, ['force_high_performance_gpu', 'enable-unsafe-swiftshader']);
});

test('fora do app empacotado ou fora do Windows não mexe no registro', () => {
  assert.equal(run({ isPackaged: false }).calls.length, 0);
  assert.equal(run({ platform: 'linux' }).calls.length, 0);
});

test('valor ausente: grava GpuPreference=2; para o próprio exe', () => {
  const { calls, warnings } = run({ queryResult: { code: 1 } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['query', KEY, '/v', EXE]);
  assert.deepEqual(calls[1].args, ['add', KEY, '/v', EXE, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f']);
  assert.ok(calls.every((c) => c.file === 'reg.exe' && c.opts.windowsHide));
  assert.equal(warnings.length, 0);
});

test('valor já existe (escolha do usuário): não sobrescreve', () => {
  const { calls } = run({ queryResult: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'query');
});

test('falhas do reg.exe são ignoradas com aviso no console', () => {
  const odd = run({ queryResult: { code: 'ENOENT' } });
  assert.equal(odd.calls.length, 1);
  assert.equal(odd.warnings.length, 1);
  const denied = run({ queryResult: { code: 1 }, addResult: new Error('Acesso negado') });
  assert.equal(denied.calls.length, 2);
  assert.match(denied.warnings[0], /não gravada/);
});

test('desinstalador remove o mesmo valor (exceto em atualização)', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(build.nsis.include, 'build/installer.nsh');
  const nsh = fs.readFileSync(path.join(root, build.nsis.include), 'utf8');
  assert.match(nsh, /!macro customUnInstall/);
  assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}/);
  assert.ok(nsh.includes('DeleteRegValue HKCU "Software\\Microsoft\\DirectX\\UserGpuPreferences" "$INSTDIR\\Forgia.exe"'));
});
