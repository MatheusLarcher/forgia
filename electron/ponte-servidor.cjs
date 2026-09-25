'use strict';
// Servidor HTTP da ponte da IA, só com o Node (sem Electron): é o que os testes de segurança
// (tests/ponte-seguranca.test.mjs) exercitam direto. A cola com o Electron fica em ponte.cjs.
//
// Um pedido = POST /comando com corpo JSON { cmd, args } e o token no cabeçalho X-Forgia-Token.
// Regras (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports, "Security"):
//   - escuta só em 127.0.0.1 (nunca na rede);
//   - recusa Host que não seja 127.0.0.1/localhost na porta certa (DNS rebinding);
//   - recusa qualquer pedido com Origin ou cabeçalhos Sec-Fetch-* (vem de navegador) e nunca
//     responde cabeçalhos CORS, então nenhuma página consegue ler a resposta;
//   - recusa sem o token certo (comparação em tempo constante);
//   - "Permitir IA" e "Permitir código livre" desligados recusam antes de chegar ao editor.
// Respostas: JSON { ok, ... }. 200 = feito; 422 = comando recusado pelo editor (erro que ensina);
// 409 = ocupado (usuário arrastando/colocando forma); 4xx/5xx para o resto.

const http = require('node:http');
const crypto = require('node:crypto');

const DEFAULT_PORT = 47821; // longe da 9876 do MCP do Blender
const MAX_BODY = 4 * 1024 * 1024; // comandos e código; arquivos vão por caminho, não pelo corpo
const COMMANDS = new Set([
  'estado', 'formas', 'criar', 'alterar', 'excluir', 'agrupar', 'desagrupar', 'alinhar', 'espelhar',
  'soltar_na_mesa', 'selecionar', 'duplicar', 'lote', 'captura', 'medir', 'marcacoes',
  'exportar_stl', 'importar', 'desfazer', 'refazer', 'executar_codigo',
]);

const newToken = () => crypto.randomBytes(32).toString('hex');

function sameToken(given, token) {
  if (typeof given !== 'string' || !token) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// onCommand(cmd, args) -> Promise<{ ok, ... }>; getConfig() -> { permitir, codigo, pronto }
function createBridgeServer({ token, onCommand, getConfig, log = () => {} }) {
  let port = 0;
  const server = http.createServer((req, res) => handle(req, res).catch((err) => {
    log('erro no pedido:', err && err.message);
    send(res, 500, { ok: false, erro: 'Erro interno da ponte do Forgia: ' + (err && err.message) });
  }));
  server.keepAliveTimeout = 2000;
  server.headersTimeout = 10000;
  server.requestTimeout = 120000;

  function send(res, status, body) {
    if (res.headersSent) return;
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
    res.end(data);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('corpo grande demais'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const h = req.headers;
    const host = String(h.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return send(res, 403, { ok: false, erro: 'Pedido recusado: Host precisa ser 127.0.0.1 ou localhost.' });
    }
    if (h.origin !== undefined || h['sec-fetch-site'] !== undefined || h['sec-fetch-mode'] !== undefined) {
      return send(res, 403, { ok: false, erro: 'Pedido recusado: a ponte do Forgia não aceita pedidos de páginas do navegador.' });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, erro: 'Use POST /comando.' });
    if (req.url !== '/comando') return send(res, 404, { ok: false, erro: 'Caminho desconhecido. Use POST /comando.' });
    if (!sameToken(h['x-forgia-token'], token)) {
      return send(res, 401, { ok: false, erro: 'Token ausente ou errado. O Forgia gera um token novo a cada abertura (em ponte.json).' });
    }
    const cfg = getConfig();
    if (!cfg.permitir) {
      return send(res, 403, { ok: false, desligada: true, erro: 'A IA está desligada no Forgia (Configurações > IA > Permitir IA).' });
    }
    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch (err) {
      if (err.status === 413) return send(res, 413, { ok: false, erro: 'Pedido grande demais (limite de 4 MB).' });
      return send(res, 400, { ok: false, erro: 'Corpo inválido: mande JSON { "cmd": "...", "args": { ... } }.' });
    }
    if (!msg || typeof msg !== 'object' || typeof msg.cmd !== 'string') {
      return send(res, 400, { ok: false, erro: 'Corpo inválido: mande JSON { "cmd": "...", "args": { ... } }.' });
    }
    const cmd = msg.cmd.replace(/^forgia_/, '');
    if (!COMMANDS.has(cmd)) {
      return send(res, 400, { ok: false, erro: `Comando desconhecido: ${msg.cmd}. Válidos: ${[...COMMANDS].join(', ')}.` });
    }
    const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
    if (cmd === 'executar_codigo' && !cfg.codigo) {
      return send(res, 403, { ok: false, desligada: true, erro: 'O código livre da IA está desligado no Forgia (Configurações > IA > Permitir código livre da IA). Use os comandos prontos.' });
    }
    if (!cfg.pronto) return send(res, 503, { ok: false, erro: 'O Forgia ainda está abrindo. Tente de novo em alguns segundos.' });
    const out = await onCommand(cmd, args);
    const status = out && out.status ? out.status : out && out.ok ? 200 : out && out.ocupado ? 409 : 422;
    if (out && out.status) delete out.status;
    send(res, status, out || { ok: false, erro: 'Sem resposta do editor.' });
  }

  return {
    server,
    get port() {
      return port;
    },
    // porta preferida; ocupada -> uma livre qualquer (0). Resolve com a porta em uso
    listen(preferred = DEFAULT_PORT) {
      const tryPort = (p) =>
        new Promise((resolve, reject) => {
          const onError = (err) => {
            server.removeListener('listening', onListening);
            reject(err);
          };
          const onListening = () => {
            server.removeListener('error', onError);
            resolve(server.address().port);
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(p, '127.0.0.1');
        });
      return tryPort(preferred)
        .catch((err) => {
          if (err.code !== 'EADDRINUSE' || preferred === 0) throw err;
          log(`porta ${preferred} ocupada; usando uma livre`);
          return tryPort(0);
        })
        .then((p) => (port = p));
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createBridgeServer, newToken, sameToken, DEFAULT_PORT, COMMANDS, MAX_BODY };
