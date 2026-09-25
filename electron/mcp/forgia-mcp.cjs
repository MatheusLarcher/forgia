'use strict';
// Servidor MCP do Forgia (stdio), escrito à mão, sem dependência: JSON-RPC 2.0, uma mensagem por
// linha (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
// Roda pelo próprio Forgia.exe, como Node puro:
//   ELECTRON_RUN_AS_NODE=1  "<pasta>\Forgia.exe"  "<pasta>\resources\mcp\forgia-mcp.cjs"
// (no desenvolvimento: electron/mcp/forgia-mcp.cjs). Nesse modo o Electron não abre janela nem
// passa pela trava de instância única do Forgia.
//
// Implementa initialize (com instructions e capabilities.tools), notifications/initialized, ping,
// tools/list e tools/call. A cada chamada lê <pasta de dados>/ponte.json ({ porta, token }), então
// aguenta o Forgia ser fechado e reaberto (porta e token novos). Pasta de dados: FORGIA_DADOS, ou
// %APPDATA%\Forgia (a do Forgia instalado). Forgia fechado -> erro "Abra o Forgia".
// NADA além de mensagens MCP vai para o stdout: logs vão para o stderr.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { TOOLS } = require('./ferramentas.cjs');
const { INSTRUCTIONS, manual } = require('./manual.cjs');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const TIMEOUT = 120000;

// qualquer console.log acidental iria para o stdout e quebraria o protocolo
console.log = console.info = console.debug = (...a) => console.error(...a);
const log = (...a) => console.error('[forgia-mcp]', ...a);

function version() {
  for (const p of [path.join(__dirname, '..', '..', 'package.json'), path.join(__dirname, '..', 'app.asar', 'package.json')]) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')).version;
    } catch {
      /* próximo */
    }
  }
  return '0.0.0';
}

const dataDir = () => process.env.FORGIA_DADOS || path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), 'Forgia');

const CLOSED = 'O Forgia não está aberto (ou a ponte dele não respondeu). Abra o Forgia no computador e tente de novo.';

function readBridge() {
  const file = path.join(dataDir(), 'ponte.json');
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number.isInteger(d.porta) && typeof d.token === 'string') return d;
  } catch {
    /* sem arquivo: Forgia fechado */
  }
  return null;
}

// POST /comando na ponte; resolve com { status, body } ou { fechado: true }
function callBridge(cmd, args) {
  const info = readBridge();
  if (!info) return Promise.resolve({ fechado: true });
  const data = JSON.stringify({ cmd, args });
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: info.porta, path: '/comando', method: 'POST', timeout: TIMEOUT, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Forgia-Token': info.token } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch {
            resolve({ status: res.statusCode, body: { ok: false, erro: 'Resposta inválida da ponte do Forgia.' } });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => resolve(err.code === 'ETIMEDOUT' ? { status: 504, body: { ok: false, erro: 'O Forgia demorou demais para responder.' } } : { fechado: true, code: err.code }));
    req.end(data);
  });
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function callTool(name, args) {
  if (name === 'forgia_manual') return text(manual(args && args.secao));
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return text(`Ferramenta desconhecida: ${name}. Use tools/list.`, true);
  const r = await callBridge(name.replace(/^forgia_/, ''), args || {});
  if (r.fechado) return text(CLOSED, true);
  const body = r.body || {};
  if (!body.ok) {
    if (r.status === 401) body.erro += ' (O Forgia pode ter sido reaberto por outro usuário ou perfil.)';
    return text(JSON.stringify(body), true);
  }
  if (name === 'forgia_captura' && typeof body.imagem === 'string') {
    const [, b64] = body.imagem.split(',');
    delete body.imagem;
    return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(body) }] };
  }
  return text(JSON.stringify(body));
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) return null; // notificação (notifications/initialized, cancelled…): sem resposta
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'forgia', title: 'Forgia', version: version() },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      try {
        return ok(await callTool(name, (params && params.arguments) || {}));
      } catch (err) {
        log('erro em', name, err);
        return ok(text(`Erro no servidor MCP do Forgia: ${err.message}`, true));
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

async function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(handle))).filter(Boolean);
    if (out.length) send(out);
    return;
  }
  const res = await handle(msg);
  if (res) send(res);
}

let buffer = '';
let pending = 0;
let ended = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).replace(/\r$/, '');
    buffer = buffer.slice(i + 1);
    pending++;
    onLine(line)
      .catch((err) => log('erro:', err))
      .finally(() => {
        pending--;
        if (ended && !pending) process.exit(0);
      });
  }
});
process.stdin.on('end', () => {
  ended = true;
  if (buffer.trim()) {
    pending++;
    onLine(buffer).finally(() => {
      pending--;
      if (!pending) process.exit(0);
    });
  } else if (!pending) process.exit(0);
});
