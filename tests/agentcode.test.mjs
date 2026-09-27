// Integração com o Agent Code (electron/agentcode.cjs) contra o Agent Code falso
// (tests/agentcode-falso.mjs), sem Electron. Faixa de portas própria do teste (47410–47449), para
// não esbarrar num Agent Code de verdade aberto na 47110–47149.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fakeAgentCode, TOKEN } from './agentcode-falso.mjs';

const { createAgentCodeClient, PORTS, TOKEN: CLIENT_TOKEN } = createRequire(import.meta.url)('../electron/agentcode.cjs');
const portas = { de: 47410, ate: 47449 };
const SERVIDOR = { command: 'C:\\Forgia\\Forgia.exe', args: ['C:\\Forgia\\resources\\mcp\\forgia-mcp.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };

function client(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-ac-')), extra = {}) {
  const c = createAgentCodeClient({ arquivo: path.join(dir, 'agent-code.json'), projeto: path.join(dir, 'agente'), servidor: () => SERVIDOR, portas, ...extra });
  c.dir = dir;
  return c;
}
const saved = (c) => JSON.parse(fs.readFileSync(path.join(c.dir, 'agent-code.json'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado');
    await wait(100);
  }
}
const noOrigin = (fake) => assert.ok(fake.log.every((r) => !r.headers.origin), 'o Forgia não manda Origin');

test('contrato: faixa 47110–47149 e o token fixo, que fica só no main', () => {
  assert.deepEqual(PORTS, { de: 47110, ate: 47149 });
  assert.equal(CLIENT_TOKEN, TOKEN);
  // nada da página (src/, index.html) sabe o token, a faixa nem fala HTTP com o Agent Code
  const root = new URL('../', import.meta.url);
  const files = [new URL('index.html', root), ...fs.readdirSync(new URL('src/', root), { recursive: true }).filter((f) => /\.(js|html|css)$/.test(f)).map((f) => new URL(`src/${f.replace(/\\/g, '/')}`, root))];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const bad of [TOKEN, 'fgac_', '47110', '47149', 'agent_code_enviar', 'agent_code_tarefa']) assert.ok(!txt.includes(bad), `${f.pathname} contém ${bad}`);
  }
});

test('todas as portas fechadas: "ausente" em menos de 1 s', async () => {
  const c = client();
  const t0 = Date.now();
  assert.equal((await c.estado()).estado, 'ausente');
  assert.equal((await c.integrar()).estado, 'ausente');
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  const r = await c.enviar('oi').catch((e) => e);
  assert.equal(r.tipo, 'ausente');
});

test('integrar salva a porta; na próxima vez a porta salva vale sem varredura', async () => {
  const a = await fakeAgentCode({ porta: 47425 });
  const c = client();
  try {
    const s = await c.integrar();
    assert.deepEqual(s, { estado: 'integrado', versao: '9.9.9', integrado: true });
    assert.deepEqual(saved(c), { porta: 47425, integrado: true });
    // outro "Agent Code" numa porta mais baixa: quem já tem a porta salva nem varre
    const b = await fakeAgentCode({ porta: 47411 });
    try {
      const c2 = client(c.dir);
      assert.equal((await c2.estado()).estado, 'integrado');
      assert.equal(b.log.length, 0, 'não varreu');
      assert.equal(a.log.filter((r) => r.url === '/agent-code').length, 2);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
});

test('porta salva velha: varre, acha a nova e salva', async () => {
  const c = client();
  fs.writeFileSync(path.join(c.dir, 'agent-code.json'), JSON.stringify({ porta: 47430, integrado: true }));
  const c2 = client(c.dir);
  const a = await fakeAgentCode({ porta: 47437 });
  try {
    assert.equal((await c2.estado()).estado, 'integrado');
    assert.equal(saved(c2).porta, 47437);
  } finally {
    await a.close();
  }
});

test('motivo "login": estado login e integrar não liga', async () => {
  const a = await fakeAgentCode({ porta: 47415, pronto: false, motivo: 'login' });
  const c = client();
  try {
    assert.equal((await c.estado()).estado, 'login');
    const s = await c.integrar();
    assert.equal(s.estado, 'login');
    assert.equal(s.integrado, false);
  } finally {
    await a.close();
  }
});

test('token errado: 401 vira "recusado"; o falso recusa sem token e com Origin', async () => {
  const a = await fakeAgentCode({ porta: 47416, token: 'outro' });
  const c = client();
  try {
    await c.integrar();
    const r = await c.enviar('aumente o furo').catch((e) => e);
    assert.equal(r.tipo, 'recusado');
    noOrigin(a);
    const raw = (headers) =>
      new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: 47416, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => (res.resume(), resolve(res.statusCode)));
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      });
    assert.equal(await raw({}), 401);
    assert.equal(await raw({ Authorization: 'Bearer outro', Origin: 'https://exemplo.com' }), 403);
  } finally {
    await a.close();
  }
});

for (const sse of [false, true]) {
  test(`pedido até "concluida", com sessão MCP e conversa (${sse ? 'SSE' : 'JSON'})`, async () => {
    const a = await fakeAgentCode({ porta: 47420, sse });
    const c = client();
    try {
      await c.integrar();
      const r = await c.enviar('faça um chaveiro com o nome ANA');
      assert.match(r.tarefa_id, /^t\d+$/);
      assert.ok(r.conversa_id);
      const rpc = a.log.filter((x) => x.rpc).map((x) => x.rpc.method || x.rpc.params?.name);
      assert.deepEqual(rpc.slice(0, 3), ['initialize', 'notifications/initialized', 'tools/call']);
      const calls = a.log.filter((x) => x.rpc && x.rpc.method === 'tools/call');
      assert.ok(calls.every((x) => x.headers['mcp-session-id'] && x.headers.authorization === `Bearer ${TOKEN}` && x.headers['mcp-protocol-version'] === '2025-06-18'));
      const args = calls[0].rpc.params.arguments;
      assert.equal(args.cliente, 'Forgia');
      assert.equal(args.projeto, path.join(c.dir, 'agente'));
      assert.ok(fs.statSync(args.projeto).isDirectory(), 'pasta do agente criada');
      assert.deepEqual(args.mcp_servers, { forgia: SERVIDOR });
      assert.ok(args.prompt.includes('forgia_manual') && args.prompt.includes('forgia_*') && args.prompt.endsWith('faça um chaveiro com o nome ANA'));
      assert.equal(args.conversa_id, undefined);
      const seen = new Set();
      const fim = await until(async () => {
        const s = await c.tarefa(r.tarefa_id);
        seen.add(s.status);
        return s.status === 'concluida' && s;
      });
      assert.ok(seen.has('rodando') || seen.has('na_fila'));
      assert.match(fim.resposta, /ANA/);
      // o pedido seguinte continua a conversa
      await c.enviar('agora com 60 mm', r.conversa_id);
      assert.equal(a.log.filter((x) => x.rpc && x.rpc.method === 'tools/call').pop().rpc.params.arguments.conversa_id, r.conversa_id);
      // sessão expirada (Agent Code reiniciado na mesma porta): uma sessão nova, sem erro
      a.resetSessions();
      const r3 = await c.enviar('mais um');
      assert.ok(r3.tarefa_id);
      noOrigin(a);
    } finally {
      await a.close();
    }
  });
}

test('Cancelar: a tarefa termina "cancelada"', async () => {
  const a = await fakeAgentCode({ porta: 47421, duracaoMs: 60000 });
  const c = client();
  try {
    await c.integrar();
    const r = await c.enviar('uma peça demorada');
    await until(async () => (await c.tarefa(r.tarefa_id)).status === 'rodando');
    await c.cancelar(r.tarefa_id);
    assert.equal((await c.tarefa(r.tarefa_id)).status, 'cancelada');
    // tarefa que este Forgia não criou: recusada sem chamar o Agent Code
    assert.equal((await c.tarefa('t999').catch((e) => e)).tipo, 'erro');
  } finally {
    await a.close();
  }
});

test('Agent Code reiniciado noutra porta: o próximo pedido funciona sem fazer nada', async () => {
  const a = await fakeAgentCode({ porta: 47431 });
  const c = client();
  await c.integrar();
  await c.enviar('primeiro');
  await a.close();
  const b = await fakeAgentCode({ porta: 47444 });
  try {
    const r = await c.enviar('segundo');
    assert.ok(r.tarefa_id);
    assert.equal(saved(c).porta, 47444);
    assert.equal(saved(c).integrado, true);
  } finally {
    await b.close();
  }
});

test('resposta do envio demorada: não reenvia (uma tarefa só) e avisa "incerto"', async () => {
  const a = await fakeAgentCode({ porta: 47434, demoraEnviarMs: 1500 });
  const c = client(undefined, { callMs: 400 });
  try {
    await c.integrar();
    const r = await c.enviar('faça um chaveiro').catch((e) => e);
    assert.equal(r.tipo, 'incerto');
    await wait(1600);
    assert.equal(a.tasks.size, 1, 'o Agent Code recebeu o pedido uma vez só');
    assert.equal(a.log.filter((x) => x.rpc && x.rpc.params && x.rpc.params.name === 'agent_code_enviar').length, 1);
  } finally {
    await a.close();
  }
});

test('Agent Code aberto mas carregando: "indisponivel", não "ausente"', async () => {
  const a = await fakeAgentCode({ porta: 47435, pronto: false, motivo: 'carregando' });
  const c = client();
  try {
    assert.equal((await c.estado()).estado, 'indisponivel');
    const r = await c.enviar('oi').catch((e) => e);
    assert.equal(r.tipo, 'indisponivel');
  } finally {
    await a.close();
  }
});

test('desligar a integração', async () => {
  const a = await fakeAgentCode({ porta: 47433 });
  const c = client();
  try {
    await c.integrar();
    assert.equal(c.desligar().estado, 'desligado');
    assert.equal((await c.estado()).estado, 'pronto');
    assert.equal(saved(c).integrado, false);
  } finally {
    await a.close();
  }
});

test('FORGIA_AGENTCODE_PORTAS: faixa só de testes; valor inválido volta à faixa do contrato', () => {
  const { portasDoAmbiente } = createRequire(import.meta.url)('../electron/agentcode.cjs');
  assert.deepEqual(portasDoAmbiente({}), PORTS);
  assert.deepEqual(portasDoAmbiente({ FORGIA_AGENTCODE_PORTAS: '47450-47489' }), { de: 47450, ate: 47489 });
  for (const ruim of ['80-90', '47450', '47489-47450', '47000-47100', 'x-y']) assert.deepEqual(portasDoAmbiente({ FORGIA_AGENTCODE_PORTAS: ruim }), PORTS, ruim);
});

// PNG mínimo (1x1) para os testes do contexto
const PNG = 'data:image/png;base64,iVBORw0KGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const PNG_OK = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const enviado = (fake) => fake.log.filter((r) => r.rpc && r.rpc.params && r.rpc.params.name === 'agent_code_enviar').pop().rpc.params.arguments;

test('Agent Code antigo (sem "recursos"): nem modelo nem imagens; a imagem vai como arquivo na pasta do agente', async () => {
  const a = await fakeAgentCode({ porta: 47440 });
  const c = client(undefined, { manual: () => 'MANUAL-DE-TESTE' });
  try {
    await c.integrar();
    const r = await c.enviar('aumenta 2 mm', null, { estado: { ok: true, objetos: [{ id: 'o1', nome: 'suporte' }] }, imagem: PNG_OK });
    assert.ok(r.tarefa_id);
    const args = enviado(a);
    assert.equal(args.modelo, undefined);
    assert.equal(args.imagens, undefined);
    assert.ok(args.prompt.includes('"suporte"') && args.prompt.includes('MANUAL-DE-TESTE') && args.prompt.endsWith('aumenta 2 mm'));
    const arq = /alfinetes das marcações: (.+?\.png)\./.exec(args.prompt);
    assert.ok(arq && fs.existsSync(arq[1]) && arq[1].startsWith(path.join(c.dir, 'agente')), 'PNG gravado na pasta do agente');
  } finally {
    await a.close();
  }
});

test('Agent Code novo ("recursos"): modelo padrão e a imagem como anexo no lugar do [[imagem:1]], sem arquivo', async () => {
  const a = await fakeAgentCode({ porta: 47441, recursos: ['modelo', 'imagens'] });
  const c = client();
  try {
    await c.integrar();
    await c.enviar('faz um furo', null, { imagem: PNG_OK });
    const args = enviado(a);
    assert.equal(args.modelo, 'claude-opus-5-5');
    assert.equal(args.imagens.length, 1);
    assert.equal(args.imagens[0].mime, 'image/png');
    assert.ok(args.prompt.includes('[[imagem:1]]'));
    assert.ok(!fs.existsSync(path.join(c.dir, 'agente')) || !fs.readdirSync(path.join(c.dir, 'agente')).some((f) => f.endsWith('.png')), 'sem PNG na pasta');
  } finally {
    await a.close();
  }
});

test('modelo padrão fora da lista do Agent Code: não manda modelo (vale o padrão dele)', async () => {
  const a = await fakeAgentCode({ porta: 47442, recursos: ['modelo'], modelos: ['claude-sonnet-5'] });
  const c = client();
  try {
    await c.integrar();
    await c.enviar('oi', null, { imagem: PNG });
    const args = enviado(a);
    assert.equal(args.modelo, undefined);
    assert.equal(args.imagens, undefined, 'sem o recurso "imagens", nada de anexo');
  } finally {
    await a.close();
  }
});
