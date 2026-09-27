// Agent Code FALSO, que segue o contrato da integração (docs/arquitetura.md, "Integração com o
// Agent Code"): GET /agent-code sem token; POST /mcp (MCP Streamable HTTP 2025-06-18) com o token
// fixo, recusa de Origin, sessão por Mcp-Session-Id e as ferramentas agent_code_enviar,
// agent_code_tarefa e agent_code_cancelar. O Agent Code de verdade ainda não tem esse servidor.
//
// executor(args, tarefa): opcional; roda o "agente" da tarefa. Sem ele, a tarefa vai de na_fila a
// rodando e termina em concluida depois de duracaoMs. mcpStdio(servidor) sobe um servidor MCP stdio
// (o mcp_servers.forgia recebido) para o executor chamar as ferramentas forgia_*.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const TOKEN = 'fgac_cFCfAYvVfH0UxI4ZppNsH9s58YSpSmcDd5SSBBso4qc';

// demoraEnviarMs: cria a tarefa na hora, mas só responde ao agent_code_enviar depois desse tempo
// (o Forgia desiste antes e não pode reenviar)
// falhar: nomes de ferramentas que respondem HTTP 503 enquanto estiverem no conjunto (falha passageira)
// recursos/modelos: o que o falso anuncia no GET /agent-code (null = Agent Code antigo, sem o campo).
// Como o de verdade, o agent_code_enviar recusa campo que não conhece: modelo e imagens só passam
// com o recurso anunciado
export async function fakeAgentCode({ porta, pronto = true, motivo = null, versao = '9.9.9', token = TOKEN, sse = false, duracaoMs = 600, executor = null, demoraEnviarMs = 0, recursos = null, modelos = ['claude-opus-5-5', 'claude-sonnet-5'] } = {}) {
  const falhar = new Set();
  let demora = demoraEnviarMs;
  const sessions = new Set();
  const tasks = new Map();
  const log = []; // { method, url, headers, rpc }
  let seq = 0;

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const reply = (res, msg, headers = {}) => {
    if (!sse) return json(res, 200, msg, headers);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
    res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
  };
  const toolText = (obj, isError = false) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], ...(isError ? { isError: true } : {}) });

  function startTask(args) {
    const id = `t${++seq}`;
    const conversa = args.conversa_id || `c${randomUUID().slice(0, 8)}`;
    const task = { id, args, conversa, status: 'na_fila', resposta: null, erro: null, cancelada: false };
    tasks.set(id, task);
    setTimeout(async () => {
      if (task.cancelada) return;
      task.status = 'rodando';
      if (executor) {
        try {
          const r = await executor(args, task);
          if (!task.cancelada) Object.assign(task, { status: 'concluida', resposta: r });
        } catch (err) {
          if (!task.cancelada) Object.assign(task, { status: 'erro', erro: err.message });
        }
      } else {
        task.timer = setTimeout(() => {
          if (!task.cancelada) Object.assign(task, { status: 'concluida', resposta: `Feito: ${String(args.prompt).split('\n').pop()}` });
        }, duracaoMs);
      }
    }, 150);
    return { tarefa_id: id, conversa_id: conversa };
  }

  function tool(name, a) {
    if (name === 'agent_code_enviar') {
      if (!a || typeof a.prompt !== 'string' || a.cliente !== 'Forgia' || typeof a.projeto !== 'string') return toolText('prompt, cliente e projeto são obrigatórios', true);
      const aceitos = new Set(['prompt', 'cliente', 'projeto', 'conversa_id', 'mcp_servers', ...(recursos || [])]);
      const extra = Object.keys(a).filter((k) => !aceitos.has(k));
      if (extra.length) return toolText(`campo desconhecido: ${extra.join(', ')}`, true);
      if (a.modelo !== undefined && !modelos.includes(a.modelo)) return toolText(`modelo inválido; válidos: ${modelos.join(', ')}`, true);
      if (a.imagens !== undefined) {
        const ok = Array.isArray(a.imagens) && a.imagens.length <= 4 && a.imagens.every((i) => i && typeof i.nome === 'string' && ['image/png', 'image/jpeg', 'image/webp'].includes(i.mime) && typeof i.base64 === 'string' && Buffer.from(i.base64, 'base64').subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
        if (!ok) return toolText('imagens inválidas', true);
        const marcas = [...a.prompt.matchAll(/\[\[imagem:(\d+)\]\]/g)].map((m) => Number(m[1]));
        if (marcas.some((n) => n < 1 || n > a.imagens.length)) return toolText('marcador de imagem sem imagem', true);
      }
      return toolText(startTask(a));
    }
    const task = tasks.get(a && a.tarefa_id);
    if (!task) return toolText('tarefa não encontrada', true);
    if (name === 'agent_code_tarefa') return toolText({ status: task.status, ...(task.resposta ? { resposta: task.resposta } : {}), ...(task.erro ? { erro: task.erro } : {}) });
    if (name === 'agent_code_cancelar') {
      task.cancelada = true;
      clearTimeout(task.timer);
      task.status = 'cancelada';
      return toolText({ ok: true });
    }
    return toolText(`ferramenta desconhecida: ${name}`, true);
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, rpc: null };
      log.push(entry);
      if (req.method === 'GET' && req.url === '/agent-code') return json(res, 200, { app: 'agent-code', versao, mcp: '/mcp', pronto, motivo, ...(recursos ? { recursos, modelos, modelo_padrao: modelos[0] } : {}) });
      if (req.url !== '/mcp' || req.method !== 'POST') return json(res, 404, { erro: 'não encontrado' });
      if (req.headers.origin) return json(res, 403, { erro: 'Origin recusado' });
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { erro: 'token' });
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return json(res, 400, { erro: 'JSON' });
      }
      entry.rpc = msg;
      if (msg.method === 'initialize') {
        const sid = randomUUID();
        sessions.add(sid);
        return reply(res, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-code', version: versao } } }, { 'Mcp-Session-Id': sid });
      }
      const sid = req.headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) return json(res, 404, { erro: 'sessão' });
      if (msg.id === undefined) return json(res, 202);
      if (msg.method === 'tools/call') {
        if (falhar.has(msg.params.name)) return json(res, 503, { erro: 'ocupado' });
        const result = tool(msg.params.name, msg.params.arguments);
        const atraso = msg.params.name === 'agent_code_enviar' ? demora : 0;
        if (atraso) return void setTimeout(() => !res.destroyed && reply(res, { jsonrpc: '2.0', id: msg.id, result }), atraso);
        return reply(res, { jsonrpc: '2.0', id: msg.id, result });
      }
      return reply(res, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(porta, '127.0.0.1', resolve);
  });
  return {
    porta,
    log,
    tasks,
    falhar,
    set demoraEnviarMs(ms) {
      demora = ms;
    },
    resetSessions: () => sessions.clear(),
    close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

// cliente MCP stdio mínimo para o executor chamar o servidor forgia recebido em mcp_servers
export function mcpStdio({ command, args, env }) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const pending = new Map();
  let buf = '';
  let id = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        p(m);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return {
    async init() {
      await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-code-falso', version: '0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    async call(name, a) {
      const m = await rpc('tools/call', { name, arguments: a });
      const text = m.result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (m.result.isError) throw new Error(text);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    close: () => child.stdin.end(),
  };
}
