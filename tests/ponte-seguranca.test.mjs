// Segurança da ponte da IA (electron/ponte-servidor.cjs), direto no servidor HTTP, sem Electron:
// recusa sem token, com token errado, com Origin/Sec-Fetch (página de navegador), com Host que não
// é localhost (DNS rebinding), com "Permitir IA" ou "Permitir código livre" desligados; só escuta
// em 127.0.0.1; porta ocupada cai numa livre. O editor é simulado (onCommand).
// Os testes no Forgia.exe de verdade (código com erro, projeto inválido, ocupado, reabrir…) ficam em
// tests/ponte-exe.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBridgeServer, newToken, DEFAULT_PORT } = require('../electron/ponte-servidor.cjs');

async function start(cfg = {}) {
  const token = newToken();
  const config = { permitir: true, codigo: true, pronto: true, ...cfg };
  const calls = [];
  const srv = createBridgeServer({
    token,
    getConfig: () => config,
    onCommand: async (cmd, args) => {
      calls.push({ cmd, args });
      return { ok: true, cmd };
    },
  });
  const port = await srv.listen(0);
  return { srv, port, token, config, calls };
}

// pedido HTTP cru (o fetch do Node não deixa mandar Host/Origin arbitrários)
function request(port, { method = 'POST', path = '/comando', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('pedido certo (token, Host 127.0.0.1) chega ao editor', async () => {
  const s = await start();
  try {
    const r = await request(s.port, { headers: { 'X-Forgia-Token': s.token }, body: { cmd: 'estado', args: {} } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(s.calls.map((c) => c.cmd), ['estado']);
    const r2 = await request(s.port, { headers: { 'X-Forgia-Token': s.token, Host: `localhost:${s.port}` }, body: { cmd: 'forgia_formas' } });
    assert.equal(r2.status, 200, 'Host localhost e prefixo forgia_ também valem');
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'nunca responde CORS');
  } finally {
    await s.srv.close();
  }
});

test('sem token ou com token errado: 401 e nada chega ao editor', async () => {
  const s = await start();
  try {
    const none = await request(s.port, { body: { cmd: 'criar', args: { tipo: 'caixa' } } });
    assert.equal(none.status, 401);
    assert.equal(none.json.ok, false);
    const wrong = await request(s.port, { headers: { 'X-Forgia-Token': s.token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }, body: { cmd: 'criar' } });
    assert.equal(wrong.status, 401);
    const short = await request(s.port, { headers: { 'X-Forgia-Token': 'x' }, body: { cmd: 'criar' } });
    assert.equal(short.status, 401);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.srv.close();
  }
});

test('com Origin (fetch de página no navegador): 403, mesmo com o token certo', async () => {
  const s = await start();
  try {
    for (const origin of ['https://site-malicioso.example', 'null', `http://127.0.0.1:${s.port}`]) {
      const r = await request(s.port, { headers: { 'X-Forgia-Token': s.token, Origin: origin }, body: { cmd: 'criar' } });
      assert.equal(r.status, 403, origin);
    }
    const fetchMeta = await request(s.port, { headers: { 'X-Forgia-Token': s.token, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' }, body: { cmd: 'criar' } });
    assert.equal(fetchMeta.status, 403, 'cabeçalhos Sec-Fetch-* denunciam navegador');
    const preflight = await request(s.port, { method: 'OPTIONS', headers: { Origin: 'https://x.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.srv.close();
  }
});

test('Host que não é localhost (DNS rebinding): 403', async () => {
  const s = await start();
  try {
    for (const host of [`evil.example:${s.port}`, `127.0.0.1:${s.port + 1}`, '127.0.0.1', `forgia.localhost:${s.port}`, `192.168.0.10:${s.port}`]) {
      const r = await request(s.port, { headers: { 'X-Forgia-Token': s.token, Host: host }, body: { cmd: 'criar' } });
      assert.equal(r.status, 403, host);
    }
    assert.equal(s.calls.length, 0);
  } finally {
    await s.srv.close();
  }
});

test('"Permitir IA" desligado: 403; "Permitir código livre" desligado: só executar_codigo recusa', async () => {
  const s = await start({ permitir: false });
  try {
    const r = await request(s.port, { headers: { 'X-Forgia-Token': s.token }, body: { cmd: 'estado' } });
    assert.equal(r.status, 403);
    assert.match(r.json.erro, /IA está desligada/);
    s.config.permitir = true;
    s.config.codigo = false;
    const code = await request(s.port, { headers: { 'X-Forgia-Token': s.token }, body: { cmd: 'executar_codigo', args: { codigo: '1' } } });
    assert.equal(code.status, 403);
    assert.match(code.json.erro, /código livre/);
    const ok = await request(s.port, { headers: { 'X-Forgia-Token': s.token }, body: { cmd: 'criar', args: { tipo: 'caixa' } } });
    assert.equal(ok.status, 200);
    assert.deepEqual(s.calls.map((c) => c.cmd), ['criar']);
  } finally {
    await s.srv.close();
  }
});

test('Forgia ainda abrindo (renderer não configurou): 503', async () => {
  const s = await start({ pronto: false });
  try {
    const r = await request(s.port, { headers: { 'X-Forgia-Token': s.token }, body: { cmd: 'estado' } });
    assert.equal(r.status, 503);
  } finally {
    await s.srv.close();
  }
});

test('método, caminho, corpo e comando inválidos: recusados com a correção', async () => {
  const s = await start();
  try {
    const tk = { 'X-Forgia-Token': s.token };
    assert.equal((await request(s.port, { method: 'GET', headers: tk })).status, 405);
    assert.equal((await request(s.port, { path: '/outra', headers: tk, body: {} })).status, 404);
    assert.equal((await request(s.port, { headers: tk, body: '{ quebrado' })).status, 400);
    const unk = await request(s.port, { headers: tk, body: { cmd: 'formatar_disco' } });
    assert.equal(unk.status, 400);
    assert.match(unk.json.erro, /Válidos: estado, formas, criar/);
    const big = await request(s.port, { headers: tk, body: { cmd: 'executar_codigo', args: { codigo: 'x'.repeat(5 * 1024 * 1024) } } }).catch((e) => ({ status: 'reset', e }));
    assert.ok(big.status === 413 || big.status === 'reset', `corpo acima de 4 MB: ${big.status}`);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.srv.close();
  }
});

test('escuta só em 127.0.0.1 e, com a porta padrão ocupada, usa uma livre', async () => {
  const s = await start();
  try {
    assert.equal(s.srv.server.address().address, '127.0.0.1');
  } finally {
    await s.srv.close();
  }
  // ocupa a porta padrão (se já estiver ocupada por outro programa, o teste vale do mesmo jeito)
  const blocker = net.createServer();
  const blocked = await new Promise((resolve) => {
    blocker.once('error', () => resolve(false));
    blocker.listen(DEFAULT_PORT, '127.0.0.1', () => resolve(true));
  });
  const srv = createBridgeServer({ token: newToken(), getConfig: () => ({ permitir: true, codigo: true, pronto: true }), onCommand: async () => ({ ok: true }) });
  try {
    const port = await srv.listen(DEFAULT_PORT);
    assert.notEqual(port, DEFAULT_PORT);
    assert.ok(port > 0);
  } finally {
    await srv.close();
    if (blocked) blocker.close();
  }
});
