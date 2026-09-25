// Textos do Conectar IA (src/conectar.js + t.conectar.prompts), sem Electron: caminhos reais no
// comando e nos JSON/TOML de cada agente, sintaxe do "claude mcp add" com variável de ambiente,
// instrução de MESCLAR as configurações e FORGIA_DADOS só fora da pasta de dados padrão.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, serverSpec, promptParts, connectPrompt } from '../src/conectar.js';

const INSTALADO = {
  exe: 'C:\\Users\\Teste\\AppData\\Local\\Programs\\Forgia\\Forgia.exe',
  script: 'C:\\Users\\Teste\\AppData\\Local\\Programs\\Forgia\\resources\\mcp\\forgia-mcp.cjs',
  dados: 'C:\\Users\\Teste\\AppData\\Roaming\\Forgia',
  dadosPadrao: 'C:\\Users\\Teste\\AppData\\Roaming\\Forgia',
  porta: 47821,
};
const TESTE = { ...INSTALADO, dados: 'C:\\Users\\Teste\\AppData\\Local\\Temp\\forgia-perfil-x' };

test('Forgia instalado: só ELECTRON_RUN_AS_NODE; com perfil de teste, FORGIA_DADOS também', () => {
  assert.deepEqual(serverSpec(INSTALADO), { command: INSTALADO.exe, args: [INSTALADO.script], env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepEqual(serverSpec({ ...INSTALADO, dados: INSTALADO.dados.toUpperCase() + '\\' }).env, { ELECTRON_RUN_AS_NODE: '1' }, 'mesma pasta com outra caixa e barra no fim');
  assert.deepEqual(serverSpec(TESTE).env, { ELECTRON_RUN_AS_NODE: '1', FORGIA_DADOS: TESTE.dados });
});

test('Agent Code / Claude Code: claude mcp add no escopo do usuário, com -e antes de -- e os caminhos reais', () => {
  const p = promptParts(INSTALADO);
  assert.equal(p.claudeAdd, `claude mcp add --scope user forgia -e "ELECTRON_RUN_AS_NODE=1" -- "${INSTALADO.exe}" "${INSTALADO.script}"`);
  assert.equal(promptParts(TESTE).claudeAdd, `claude mcp add --scope user forgia -e "ELECTRON_RUN_AS_NODE=1" -e "FORGIA_DADOS=${TESTE.dados}" -- "${TESTE.exe}" "${TESTE.script}"`);
  assert.deepEqual(JSON.parse(p.claudeJson), { type: 'stdio', command: INSTALADO.exe, args: [INSTALADO.script], env: { ELECTRON_RUN_AS_NODE: '1' } });
  const txt = connectPrompt(INSTALADO, 'agentcode');
  for (const must of ['claude mcp remove --scope user forgia', p.claudeAdd, '~/.claude/settings.json', '"mcp__forgia"', 'permissions.allow', 'MESCLE', 'mantenha tudo o que já existe', 'forgia_estado', 'conversa nova', '~/.claude.json']) {
    assert.ok(txt.includes(must), `falta: ${must}`);
  }
});

test('Codex: [mcp_servers.forgia] com strings literais TOML e aprovação automática', () => {
  const toml = promptParts(INSTALADO).codexToml.split('\n');
  assert.deepEqual(toml, [
    '[mcp_servers.forgia]',
    `command = '${INSTALADO.exe}'`,
    `args = ['${INSTALADO.script}']`,
    "env = { ELECTRON_RUN_AS_NODE = '1' }",
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 120',
    'default_tools_approval_mode = "auto"',
  ]);
  // caminho com aspas simples (ex.: usuário O'Brien) vira string básica escapada
  const odd = promptParts({ ...INSTALADO, exe: "C:\\Users\\O'Brien\\Forgia.exe" }).codexToml;
  assert.ok(odd.includes('command = "C:\\\\Users\\\\O\'Brien\\\\Forgia.exe"'), odd);
  const txt = connectPrompt(INSTALADO, 'codex');
  assert.ok(txt.includes('~/.codex/config.toml') && txt.includes('Mantenha todo o resto') && txt.includes('forgia_estado'));
});

test('Cursor e genérico: JSON válido com os caminhos reais; o Cursor libera pela interface', () => {
  const p = promptParts(TESTE);
  assert.deepEqual(JSON.parse(p.cursorJson), { type: 'stdio', command: TESTE.exe, args: [TESTE.script], env: { ELECTRON_RUN_AS_NODE: '1', FORGIA_DADOS: TESTE.dados } });
  assert.deepEqual(JSON.parse(p.genericoJson).mcpServers.forgia.args, [TESTE.script]);
  const cursor = connectPrompt(TESTE, 'cursor');
  assert.ok(cursor.includes('~/.cursor/mcp.json') && cursor.includes('MESCLE') && cursor.includes('Cursor Settings > MCP'));
  const gen = connectPrompt(TESTE, 'generico');
  for (const must of [TESTE.exe, TESTE.script, 'ELECTRON_RUN_AS_NODE=1', `FORGIA_DADOS=${TESTE.dados}`, 'forgia_estado']) assert.ok(gen.includes(must), must);
});

test('os quatro agentes têm texto', () => {
  assert.deepEqual(AGENTS, ['agentcode', 'codex', 'cursor', 'generico']);
  for (const a of AGENTS) assert.ok(connectPrompt(INSTALADO, a).length > 200, a);
});
