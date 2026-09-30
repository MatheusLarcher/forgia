// Manual da IA dentro do MCP (electron/mcp/manual.cjs) e ferramentas (ferramentas.cjs), sem Electron:
// instructions até 2 KB (o Claude Code corta aí) com as regras do handoff, guia e seções pedidas,
// regra do código livre em destaque, exemplos JSON válidos, e o servidor MCP respondendo o manual
// pelo protocolo (stdio) sem o Forgia aberto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { INSTRUCTIONS, GUIA, SECTIONS, manual } = require('../electron/mcp/manual.cjs');
const { TOOLS } = require('../electron/mcp/ferramentas.cjs');

// blocos {"comandos":[...]} do texto do manual
export function lotes(text) {
  const out = [];
  let i = text.indexOf('{"comandos":[');
  while (i >= 0) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push(text.slice(i, j + 1));
    i = text.indexOf('{"comandos":[', j);
  }
  return out;
}

test('instructions: até 2048 bytes (UTF-8) e com as regras do handoff', () => {
  const bytes = Buffer.byteLength(INSTRUCTIONS, 'utf8');
  assert.ok(bytes <= 2048, `instructions com ${bytes} bytes`);
  for (const must of [/Forgia: editor 3D/, /Z para cima/, /forgia_lote/, /Confira pelo retorno/, /forgia_manual/, /Código livre .* só em último caso/, /diga ao usuário por quê/, /forgia_marcacoes/]) {
    assert.match(INSTRUCTIONS, must);
  }
  console.log(`instructions: ${bytes} bytes, ${INSTRUCTIONS.length} caracteres`);
});

test('forgia_manual: guia sem seção e as seções pedidas no handoff', () => {
  assert.equal(manual(''), GUIA);
  assert.equal(manual(undefined), GUIA);
  for (const s of ['regras', 'coordenadas', 'receitas', 'impressao', 'marcacoes', 'codigo_livre', 'erros']) {
    assert.ok(SECTIONS[s] && SECTIONS[s].length > 200, s);
    assert.equal(manual(s), SECTIONS[s]);
  }
  assert.equal(manual('Impressão'), SECTIONS.impressao, 'aceita acento e maiúscula');
  assert.match(manual('nao-existe'), /não existe\. Seções:/);
});

test('regras do agente: linha essencial no instructions, seção regras citada no guia', () => {
  assert.match(INSTRUCTIONS, /só pelas ferramentas forgia_\*; sem criar, editar ou apagar arquivos e sem terminal/);
  assert.match(INSTRUCTIONS, /Na dúvida, pergunte/);
  assert.match(INSTRUCTIONS, /forgia_manual \{"secao":"regras"\}/);
  assert.match(GUIA, /forgia_manual \{"secao":"regras"\}/);
  assert.match(GUIA, /Seções: regras/);
  const r = SECTIONS.regras;
  for (const must of [/Não crie, edite nem apague arquivos/, /exportar .* quando o usuário pedir, no caminho que ele indicar/, /Não rode comandos de terminal nem programas/, /forgia_lote só/, /pergunte antes/, /Responda em português, curto/, /em mm/, /recuse com educação/]) {
    assert.match(r, must);
  }
  // nenhuma receita manda gerar arquivo por programa
  assert.doesNotMatch(GUIA + Object.values(SECTIONS).join('\n'), /Gere um STL com Python|STL gerado em Python/);
});

test('regra do código livre em destaque, com o que não justifica e a fachada', () => {
  const c = SECTIONS.codigo_livre;
  assert.match(c, /só em último caso/);
  assert.match(c, /SÓ quando nenhum comando pronto resolver o pedido, e antes diga ao usuário por quê/);
  assert.match(c, /NÃO justificam código livre/);
  for (const k of ['forgia_duplicar', 'forgia_alinhar', 'desenho', 'forgia_importar', 'forgia.criar', 'forgia.objetos()']) assert.ok(c.includes(k), k);
  assert.match(SECTIONS.receitas, /forgia_importar/, 'peça orgânica por importar');
});

test('exemplos de lote do manual são JSON válido e só usam comandos de lote', () => {
  const found = [...lotes(GUIA), ...lotes(SECTIONS.receitas)];
  assert.ok(found.length >= 3, `${found.length} exemplos`);
  const ok = new Set(['criar', 'alterar', 'excluir', 'agrupar', 'desagrupar', 'alinhar', 'espelhar', 'soltar_na_mesa', 'selecionar', 'duplicar', 'importar', 'criar_encaixe']);
  for (const src of found) {
    const lote = JSON.parse(src);
    for (const c of lote.comandos) assert.ok(ok.has(c.cmd), c.cmd);
  }
});

test('Fase D: hardware, geradores, encaixe e 3MF no manual e nas ferramentas', () => {
  assert.match(INSTRUCTIONS, /forgia_criar_encaixe/);
  assert.match(INSTRUCTIONS, /forgia_exportar_3mf/);
  assert.match(INSTRUCTIONS, /omita medidas/);
  for (const tipo of ['porca', 'parafuso', 'furo_parafuso', 'furo_inserto', 'engrenagem', 'caixa_com_tampa']) assert.ok(GUIA.includes(tipo), tipo);
  for (const r of ['Furo para parafuso M3 com porca numa parede lateral', 'Par de engrenagens', 'Encaixe (soquete)', 'caixa_com_tampa', 'forgia_exportar_3mf']) assert.ok(SECTIONS.receitas.includes(r), r);
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  assert.deepEqual(byName.forgia_exportar_3mf.inputSchema.required, ['caminho']);
  assert.deepEqual(byName.forgia_criar_encaixe.inputSchema.required, ['id']);
  assert.match(byName.forgia_lote.description, /criar_encaixe/);
  assert.match(byName.forgia_criar.inputSchema.properties.tipo.description, /engrenagem/);
});

test('forgia_conversa: pedido e/ou resposta com limite, e o comando na lista da ponte', () => {
  const c = TOOLS.find((t) => t.name === 'forgia_conversa');
  assert.ok(c, 'forgia_conversa existe');
  assert.deepEqual(Object.keys(c.inputSchema.properties).sort(), ['pedido', 'resposta']);
  assert.equal(c.inputSchema.required, undefined, 'nenhum dos dois é obrigatório sozinho');
  assert.equal(c.inputSchema.properties.pedido.maxLength, 4000);
  assert.equal(c.inputSchema.properties.resposta.maxLength, 20000);
  for (const must of [/direto no agente/, /pedido .* antes de mexer na peça/, /resposta no fim/, /Não use em pedido que veio do Forgia/]) assert.match(c.description, must);
  const { COMMANDS } = require('../electron/ponte-servidor.cjs');
  assert.ok(COMMANDS.has('conversa'));
  // toda ferramenta que vai à ponte tem o comando na lista (só forgia_manual responde no servidor MCP)
  for (const t of TOOLS) if (t.name !== 'forgia_manual') assert.ok(COMMANDS.has(t.name.replace(/^forgia_/, '')), t.name);
});

test('ferramentas: 25 forgia_*, cada uma com descrição e inputSchema de objeto', () => {
  assert.equal(TOOLS.length, 25);
  for (const t of TOOLS) {
    assert.match(t.name, /^forgia_[a-z0-9_]+$/);
    assert.ok(t.description && t.description.length >= 20, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
  }
  const bytes = Buffer.byteLength(JSON.stringify(TOOLS), 'utf8');
  console.log(`tools/list: ${bytes} bytes`);
});

test('servidor MCP: forgia_manual responde pelo stdio mesmo com o Forgia fechado', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'electron', 'mcp', 'forgia-mcp.cjs')], { env: { ...process.env, FORGIA_DADOS: path.join(ROOT, 'docs', 'nao-existe-forgia') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'forgia_manual', arguments: {} } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'forgia_manual', arguments: { secao: 'impressao' } } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'forgia_criar', arguments: { tipo: 'caixa' } } });
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'forgia_manual', arguments: { secao: 'regras' } } });
  child.stdin.end();
  await new Promise((r) => child.on('exit', r));
  const byId = Object.fromEntries(lines.map((m) => [m.id, m]));
  assert.equal(byId[1].result.instructions, INSTRUCTIONS);
  assert.equal(byId[2].result.content[0].text, GUIA);
  assert.equal(byId[3].result.content[0].text, SECTIONS.impressao);
  assert.equal(byId[4].result.isError, true);
  assert.match(byId[4].result.content[0].text, /Abra o Forgia/);
  assert.equal(byId[5].result.content[0].text, SECTIONS.regras);
});
