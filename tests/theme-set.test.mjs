import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStubs } from './stubs-navegador.mjs';

// theme.js é um singleton: cada teste importa um módulo novo (sufixo na URL) com o próprio ambiente
let n = 0;
async function freshTheme(opts) {
  const env = installBrowserStubs(opts);
  const { theme } = await import(`../src/theme.js?caso=${++n}`);
  return { env, theme };
}

test('clicar no tema que já está ativo não grava a escolha e o tema continua seguindo o Windows', async () => {
  const { env, theme } = await freshTheme({ dark: false });
  assert.equal(theme.name, 'claro');
  let changes = 0;
  theme.addEventListener('change', () => changes++);
  theme.set('claro'); // botão "Claro" das Configurações, já ativo
  assert.deepEqual(env.writes, [], 'nada gravado em forgia.tema');
  assert.equal(env.storage.getItem('forgia.tema'), null);
  assert.equal(changes, 0, 'sem evento change');
  env.setSystemDark(true); // o Windows vai para o escuro
  assert.equal(theme.name, 'escuro', 'sem escolha salva, segue o Windows');
  assert.equal(env.attrs['data-tema'], 'escuro');
  assert.equal(env.storage.getItem('forgia.tema'), null);
});

test('trocar de tema grava a escolha e para de seguir o Windows', async () => {
  const { env, theme } = await freshTheme({ dark: false });
  theme.set('escuro');
  assert.equal(theme.name, 'escuro');
  assert.deepEqual(env.writes, [['forgia.tema', 'escuro']]);
  env.setSystemDark(false);
  assert.equal(theme.name, 'escuro', 'com escolha salva, o Windows não muda o tema');
  theme.toggle();
  assert.equal(theme.name, 'claro');
  assert.deepEqual(env.writes.at(-1), ['forgia.tema', 'claro']);
});

test('com escolha salva, repetir o mesmo tema não regrava', async () => {
  const { env, theme } = await freshTheme({ dark: true, saved: 'claro' });
  assert.equal(theme.name, 'claro');
  theme.set('claro');
  assert.deepEqual(env.writes, []);
  assert.equal(env.storage.getItem('forgia.tema'), 'claro');
});
