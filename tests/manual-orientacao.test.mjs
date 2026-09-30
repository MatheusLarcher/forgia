// Manual da IA (electron/mcp/manual.cjs): orientação da peça antes de alterar base/topo/lado, a
// recomendação da posição de impressão só para peça a imprimir, e a linha do forgia_conversa no
// INSTRUCTIONS. Sem Electron: o módulo direto e o servidor MCP pelo stdio com o Forgia fechado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { INSTRUCTIONS, GUIA, SECTIONS, manual } = require('../electron/mcp/manual.cjs');

const linha = (re) => INSTRUCTIONS.split('\n').filter((l) => re.test(l));

test('INSTRUCTIONS: continua em 2048 bytes com as regras antigas', () => {
  const bytes = Buffer.byteLength(INSTRUCTIONS, 'utf8');
  assert.ok(bytes <= 2048, `instructions com ${bytes} bytes`);
  // os mesmos regex de tests/mcp-manual.test.mjs
  for (const must of [/Forgia: editor 3D/, /Z para cima/, /forgia_lote/, /Confira pelo retorno/, /forgia_manual/, /Código livre .* só em último caso/, /diga ao usuário por quê/, /forgia_marcacoes/, /só pelas ferramentas forgia_\*; sem criar, editar ou apagar arquivos e sem terminal/, /Na dúvida, pergunte/, /forgia_manual \{"secao":"regras"\}/, /forgia_criar_encaixe/, /forgia_exportar_3mf/, /omita medidas/]) {
    assert.match(INSTRUCTIONS, must);
  }
  console.log(`instructions: ${bytes} bytes`);
});

test('INSTRUCTIONS: uma linha de orientação', () => {
  const ls = linha(/"secao":"orientacao"/);
  assert.equal(ls.length, 1, 'uma linha só aponta a seção orientacao');
  const l = ls[0];
  for (const w of ['base', 'topo', 'em cima', 'embaixo', 'lado', 'frente']) assert.ok(l.toLowerCase().includes(w), w);
  assert.match(l, /de pé, de lado ou de cabeça para baixo/);
  assert.match(l, /antes/);
  assert.match(l, /forgia_estado rotacao\/caixa/);
  assert.match(l, /captura/);
  assert.match(l, /marcações/);
  assert.match(l, /na dúvida, pergunte/i);
  assert.match(l, /imprimir/);
  assert.match(l, /recomende deixá-la na posição de impressão/);
  assert.match(l, /forgia_manual \{"secao":"orientacao"\}/);
});

test('INSTRUCTIONS: uma linha do forgia_conversa', () => {
  const ls = linha(/forgia_conversa/);
  assert.equal(ls.length, 1);
  const l = ls[0];
  assert.match(l, /direto a você/);
  assert.match(l, /fora do Forgia/);
  assert.match(l, /\{"pedido": texto literal do usuário\} antes de mexer/);
  assert.match(l, /\{"resposta": sua resposta\} no fim/);
  assert.match(l, /chat do Forgia/);
  assert.match(l, /pedido vindo de lá já está/);
});

test('seção orientacao: quando, como descobrir, como interpretar, perguntar e posição de impressão', () => {
  const o = SECTIONS.orientacao;
  assert.ok(o && o.length > 200, 'seção com mais de 200 caracteres');
  // quando se aplica
  for (const w of ['base', 'fundo', 'topo', 'em cima', 'embaixo', 'lado', 'frente', 'trás']) assert.ok(o.includes(w), w);
  // como descobrir
  for (const re of [/rotacao \[180,0,0\]/, /\[0,180,0\]/, /cabeça para baixo/, /90 ou −90 em X ou Y/, /deitada de lado/, /caixa \{min,max\}/, /apoiado_em/, /face/, /normal/, /lado_da_parte/, /forgia_captura/, /vista frente/, /direita/, /topo/, /abertura/, /copo/, /texto/, /face plana grande/]) {
    assert.match(o, re);
  }
  // como interpretar
  assert.match(o, /Base = a face que fica na mesa na posição de uso ou de impressão, não necessariamente o Z mínimo atual/);
  assert.match(o, /esticar usa os lados da peça \(lado_da_parte\)/);
  // dizer como entendeu
  assert.match(o, /Diga ao usuário como entendeu/);
  // perguntar com opções concretas
  assert.match(o, /Na dúvida, pergunte/);
  assert.match(o, /opções concretas/);
  // posição de impressão: só para peça a imprimir, oferecendo girar e soltar, com confirmação
  assert.match(o, /Só para peça que vai para a impressora/);
  assert.match(o, /não para peça de referência/);
  assert.match(o, /recomende deixá-la na posição em que será impressa/);
  assert.match(o, /forgia_soltar_na_mesa/);
  assert.match(o, /confirmação do usuário/);
});

test('manual(): orientacao com e sem acento/maiúscula; GUIA e regras citam a regra', () => {
  assert.equal(manual('orientacao'), SECTIONS.orientacao);
  assert.equal(manual('Orientação'), SECTIONS.orientacao);
  assert.equal(manual(' ORIENTACAO '), SECTIONS.orientacao);
  assert.doesNotMatch(manual('nao-existe'), /^# Orientação/);
  assert.match(manual('nao-existe'), /Seções: .*orientacao/);

  const g = GUIA.split('\n').filter((l) => /de pé, de lado ou de cabeça para baixo/.test(l));
  assert.ok(g.length >= 1 && g.length <= 2, 'GUIA cita a regra em 1–2 linhas');
  assert.match(g.join('\n'), /na dúvida, pergunte/i);
  assert.match(g.join('\n'), /posição de impressão/);
  assert.match(GUIA, /Seções: regras.*\borientacao\b/);

  const r = SECTIONS.regras.split('\n').filter((l) => l.startsWith('- ') && /cabeça para baixo/.test(l));
  assert.equal(r.length, 1, 'um bullet de orientação nas regras');
  assert.match(r[0], /pergunte/);
  assert.match(r[0], /forgia_manual \{"secao":"orientacao"\}/);
});

test('servidor MCP: forgia_manual {"secao":"orientacao"} pelo stdio com o Forgia fechado', async () => {
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
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'forgia_manual', arguments: { secao: 'orientacao' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'forgia_manual', arguments: { secao: 'Orientação' } } });
  child.stdin.end();
  await new Promise((r) => child.on('exit', r));
  const byId = Object.fromEntries(lines.map((m) => [m.id, m]));
  assert.equal(byId[1].result.instructions, INSTRUCTIONS);
  assert.equal(byId[2].result.content[0].text, SECTIONS.orientacao);
  assert.equal(byId[3].result.content[0].text, SECTIONS.orientacao);
  assert.ok(!byId[2].result.isError);
});
