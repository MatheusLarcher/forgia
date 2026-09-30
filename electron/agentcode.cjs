'use strict';
// Integração Forgia → Agent Code, no processo main. O usuário escreve o pedido no Forgia ("Pedir à
// IA" ou Marcar parte); o Forgia manda ao Agent Code aberto na mesma máquina, que roda o Claude com
// as ferramentas MCP do próprio Forgia, e a peça muda na tela pela ponte (um passo de desfazer).
// Contrato do lado do Agent Code: docs/arquitetura.md, "Integração com o Agent Code".
//
// - Descoberta: a porta salva em <userData>\agent-code.json; se não responder, GET /agent-code nas
//   40 portas de 47110 a 47149 em paralelo (300 ms cada), vale a primeira com app "agent-code".
//   Uma chamada que falha por rede refaz a varredura UMA vez antes do erro (Agent Code reiniciado
//   noutra porta).
// - Cliente MCP (Streamable HTTP, 2025-06-18) escrito à mão, como o electron/mcp/forgia-mcp.cjs:
//   initialize -> notifications/initialized -> tools/call, repassando o Mcp-Session-Id. Aceita
//   resposta em JSON ou em text/event-stream.
// - Token fixo em todo POST /mcp (decisão do usuário). Fica só aqui: nunca vai para o renderer. O
//   Forgia é código aberto, então o token é público: ele barra chamadas acidentais, não quem ler o
//   código. Nenhum cabeçalho Origin (o Agent Code recusa pedidos de página web).
// - O renderer só vê ações de alto nível (estado, integrar, desligar, enviar, tarefa, cancelar):
//   nunca porta, URL, token, nem a configuração do servidor MCP, que é montada aqui
//   (electron/mcp-servidor.cjs), porque é um comando que o agente vai executar.
// - projeto = <userData>\agente, pasta vazia só do agente: ele roda sem aprovação e tem ferramentas
//   de arquivo, e nem a pasta de dados (ponte.json, recuperacao\, criacoes\) nem a do projeto do
//   usuário devem ficar ao alcance por acidente.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const TOKEN = 'fgac_cFCfAYvVfH0UxI4ZppNsH9s58YSpSmcDd5SSBBso4qc';
const PORTS = { de: 47110, ate: 47149 };
const PROTOCOL = '2025-06-18';
const PROBE_MS = 300;
const CALL_MS = 20000;
const MAX_TEXT = 20000;
const MAX_IMAGEM = 12 * 1024 * 1024; // base64 do PNG da vista (1280 px de largura no máximo)
// Agent Code que anuncia recursos: ["modelo", "imagens"] no GET /agent-code recebe o modelo da
// tarefa e a imagem como anexo (no lugar do marcador [[imagem:1]]); o antigo, nada disso (o
// agent_code_enviar dele recusa campo desconhecido) e a imagem vai como arquivo na pasta do agente
const MODELO_PADRAO = 'claude-opus-5-5';
const MAX_ANEXO = 5 * 1024 * 1024; // bytes de cada imagem anexada (limite do contrato)
const MARCA_IMAGEM = '[[imagem:1]]';

// instruções do Forgia que vão antes do pedido. Para o agente começar sem consultar, vão junto o
// manual e as regras da IA (electron/mcp/manual.cjs), o estado do projeto (o mesmo retorno do
// forgia_estado, com as marcações) e a imagem da vista (anexo ou arquivo). O pedido do usuário
// fica sempre por último.
// ctx = { manual, estado, imagem: { anexo: true } | { arquivo } }, tudo opcional
const MAX_ESTADO = 120000;
const prompt = (pedido, ctx = {}) => {
  const linhas = [
    'Pedido feito no Forgia, o editor 3D de peças para impressão 3D aberto neste computador.',
    'Use só as ferramentas forgia_* do servidor "forgia". Não crie, edite nem apague arquivos e não rode terminal nem programas (exportar, só se o usuário pedir, no caminho que ele disser).',
    'Carregue de uma vez só as ferramentas que for usar (no Claude Code: ToolSearch "select:mcp__forgia__forgia_lote,mcp__forgia__forgia_estado,mcp__forgia__forgia_captura", mais as que precisar).',
    ctx.manual
      ? 'O manual e as regras da IA estão abaixo: não precisa chamar forgia_manual para começar (outras seções, se precisar: forgia_manual {"secao":"receitas"}, "impressao", "marcacoes", "erros").'
      : 'Antes de modelar, leia forgia_manual (sem seção) e siga forgia_manual {"secao":"regras"}.',
    'Faça o pedido num único forgia_lote (um passo de desfazer). Se o pedido for ambíguo ou apagaria muita coisa, pergunte antes. Responda em português, curto: o que mudou na peça, em mm.',
    // o pedido e a resposta desta tarefa já aparecem no chat do Forgia (src/pedido-ia.js)
    'Este pedido e a sua resposta já aparecem no chat do Forgia: não chame forgia_conversa (ela é só para mensagens escritas direto no agente).',
  ];
  const img = ctx.imagem;
  if (img && img.anexo) linhas.push('Imagem da vista do usuário agora, com os alfinetes das marcações:', MARCA_IMAGEM);
  else if (img && img.arquivo) linhas.push(`Imagem da vista do usuário agora, com os alfinetes das marcações: ${img.arquivo}. Abra-a (leitura de arquivo) antes de modelar para ver o que ele vê.`);
  if (ctx.estado) linhas.push('', '## Projeto aberto agora (o mesmo retorno do forgia_estado; ids, medidas e marcações)', ctx.estado);
  if (ctx.manual) linhas.push('', '## Manual da IA', ctx.manual);
  linhas.push('', 'Pedido do usuário:', pedido);
  return linhas.join('\n');
};

const FINAL = new Set(['concluida', 'erro', 'cancelada']);

// erro com tipo, para o renderer escolher o texto (src/textos/pt-BR.js, agentcode.erros).
// seguro = o pedido com certeza NÃO chegou ao Agent Code (conexão recusada, falha antes do
// tools/call): repetir não duplica nada. Sem ele, um agent_code_enviar não é repetido.
class AgentCodeError extends Error {
  constructor(tipo, message = tipo, { seguro = false } = {}) {
    super(message);
    this.tipo = tipo; // 'ausente' | 'login' | 'indisponivel' | 'recusado' | 'rede' | 'incerto' | 'erro'
    this.seguro = seguro;
  }
}

function request(port, { method = 'GET', pathname, body, headers = {}, timeout = CALL_MS, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    let conectou = false; // antes de conectar, nada saiu: a falha é segura
    // agent: false = conexão nova a cada chamada (é local): sem keep-alive, um Agent Code fechado
    // dá "conexão recusada" (segura), e não um reset numa conexão velha reaproveitada
    const req = http.request({ host, port, path: pathname, method, timeout, agent: false, headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (err) => reject(new AgentCodeError('rede', err.message)));
    });
    req.on('socket', (s) => (s.connecting ? s.once('connect', () => (conectou = true)) : (conectou = true)));
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', (err) => reject(new AgentCodeError('rede', err.message, { seguro: !conectou })));
    req.end(data || undefined);
  });
}

// Agent Code aberto mas não pronto: sem conta Claude ('login') ou ainda carregando
const naoPronto = (hit) => new AgentCodeError(hit.info.motivo === 'login' ? 'login' : 'indisponivel', 'não pronto', { seguro: true });

// resposta do POST /mcp: JSON direto ou eventos SSE (data: {...}); devolve a mensagem com esse id
function rpcMessage(res, id) {
  const type = String(res.headers['content-type'] || '');
  const msgs = [];
  const add = (v) => (Array.isArray(v) ? msgs.push(...v) : msgs.push(v));
  try {
    if (type.includes('text/event-stream')) {
      for (const block of res.text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) add(JSON.parse(data));
      }
    } else if (res.text.trim()) add(JSON.parse(res.text));
  } catch {
    throw new AgentCodeError('rede', 'Resposta inválida do Agent Code.');
  }
  return msgs.find((m) => m && m.id === id) || null;
}

// resultado de tools/call: structuredContent ou o JSON do primeiro texto
function toolResult(result) {
  const text = ((result && result.content) || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  if (result && result.isError) throw new AgentCodeError('erro', text || 'O Agent Code devolveu um erro.');
  if (result && result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentCodeError('erro', text || 'Resposta vazia do Agent Code.');
  }
}

// arquivo: <userData>\agent-code.json; projeto: <userData>\agente; servidor(): { command, args, env };
// manual(): guia + regras da IA (texto) para ir no pedido, ou '' se não houver
function createAgentCodeClient({ arquivo, projeto, servidor, manual = () => '', versao = '0.0.0', portas = PORTS, probeMs = PROBE_MS, callMs = CALL_MS, log = () => {} }) {
  const manualTexto = () => {
    try {
      return String(manual() || '');
    } catch (err) {
      log('manual da IA não lido:', err.message);
      return '';
    }
  };
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
  } catch {
    saved = {};
  }
  let session = null; // { porta, id }
  let seq = 0;
  const tarefas = new Set(); // só se consulta e cancela o que este Forgia criou

  function save(patch) {
    saved = { ...saved, ...patch };
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo + '.tmp', JSON.stringify(saved, null, 2));
      fs.renameSync(arquivo + '.tmp', arquivo);
    } catch (err) {
      log('agent-code.json não gravado:', err.message);
    }
  }

  // GET /agent-code numa porta: { porta, info } se for o Agent Code; senão null
  async function probe(porta) {
    try {
      const r = await request(porta, { pathname: '/agent-code', timeout: probeMs });
      const info = JSON.parse(r.text);
      return r.status === 200 && info && info.app === 'agent-code' ? { porta, info } : null;
    } catch {
      return null;
    }
  }

  // a porta salva primeiro; senão as 40 em paralelo, e vale a primeira que responder
  async function find({ varrer = false } = {}) {
    if (!varrer && Number.isInteger(saved.porta)) {
      const hit = await probe(saved.porta);
      if (hit) return hit;
    }
    const all = [];
    for (let p = portas.de; p <= portas.ate; p++) all.push(p);
    const hit = await new Promise((resolve) => {
      let left = all.length;
      for (const p of all) {
        probe(p).then((r) => {
          if (r) resolve(r);
          else if (--left === 0) resolve(null);
        });
      }
    });
    if (hit && hit.porta !== saved.porta) save({ porta: hit.porta });
    return hit;
  }

  const stateOf = (hit) => ({
    estado: !hit ? 'ausente' : !hit.info.pronto ? (hit.info.motivo === 'login' ? 'login' : 'indisponivel') : saved.integrado ? 'integrado' : 'pronto',
    versao: hit ? String(hit.info.versao || '') : null,
    integrado: !!saved.integrado,
  });

  async function estado() {
    return stateOf(await find());
  }

  async function integrar() {
    const hit = await find();
    if (hit && hit.info.pronto) save({ porta: hit.porta, integrado: true });
    return stateOf(hit);
  }

  function desligar() {
    save({ integrado: false });
    return { estado: 'desligado', integrado: false, versao: null };
  }

  async function post(porta, body, extra = {}) {
    const headers = { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`, ...extra };
    const res = await request(porta, { method: 'POST', pathname: '/mcp', body, headers, timeout: callMs });
    if (res.status === 401 || res.status === 403) throw new AgentCodeError('recusado', 'recusado', { seguro: true });
    return res;
  }

  // sessão nova; falhar aqui é sempre seguro: o tools/call ainda não saiu
  async function sessao(porta) {
    try {
      await initialize(porta);
    } catch (err) {
      err.seguro = true;
      throw err;
    }
  }

  async function initialize(porta) {
    const id = ++seq;
    const res = await post(porta, { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'forgia', title: 'Forgia', version: versao } } });
    const msg = res.status === 200 ? rpcMessage(res, id) : null;
    // outra coisa nessa porta (ou Agent Code que não fala MCP): trata como "não está aqui"
    if (!msg || !msg.result) throw new AgentCodeError('rede', `initialize: HTTP ${res.status}`);
    const sid = res.headers['mcp-session-id'] || null;
    const extra = { 'MCP-Protocol-Version': msg.result.protocolVersion || PROTOCOL, ...(sid ? { 'Mcp-Session-Id': sid } : {}) };
    await post(porta, { jsonrpc: '2.0', method: 'notifications/initialized' }, extra);
    session = { porta, headers: extra };
  }

  async function callOnce(porta, name, args) {
    if (!session || session.porta !== porta) await sessao(porta);
    const id = ++seq;
    let res = await post(porta, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, session.headers);
    if (res.status === 404) {
      // sessão expirou (Agent Code reiniciado na mesma porta): o pedido não rodou; uma sessão nova
      await sessao(porta);
      res = await post(porta, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, session.headers);
    }
    // 4xx: o Agent Code recusou sem executar (seguro); 5xx: pode ter começado
    if (res.status !== 200) throw new AgentCodeError(res.status >= 500 ? 'erro' : 'rede', `HTTP ${res.status}`, { seguro: res.status < 500 });
    const msg = rpcMessage(res, id);
    if (!msg) throw new AgentCodeError('rede', 'O Agent Code não respondeu ao pedido.');
    if (msg.error) throw new AgentCodeError('erro', msg.error.message || 'Erro do Agent Code.');
    return toolResult(msg.result);
  }

  // chamada com a porta conhecida; falha de rede -> uma varredura nova e mais uma tentativa.
  // repetir: false (agent_code_enviar, que cria tarefa) só repete se a falha for segura; se o
  // pedido pode ter chegado, avisa "incerto" em vez de criar uma segunda tarefa
  async function call(name, args, { repetir = true } = {}) {
    let porta = Number.isInteger(saved.porta) ? saved.porta : null;
    if (porta === null) {
      const hit = await find();
      if (!hit) throw new AgentCodeError('ausente');
      if (!hit.info.pronto) throw naoPronto(hit);
      porta = hit.porta;
    }
    try {
      return await callOnce(porta, name, args);
    } catch (err) {
      if (err.tipo !== 'rede') throw err;
      if (!repetir && !err.seguro) throw new AgentCodeError('incerto', err.message);
      log('Agent Code não respondeu em', porta, '-', err.message, '; varrendo de novo');
      session = null;
      const hit = await find({ varrer: true });
      if (!hit) throw new AgentCodeError('ausente');
      if (!hit.info.pronto) throw naoPronto(hit);
      try {
        return await callOnce(hit.porta, name, args);
      } catch (err2) {
        if (err2.tipo === 'rede' && !repetir && !err2.seguro) throw new AgentCodeError('incerto', err2.message);
        throw err2;
      }
    }
  }

  // imagem da vista (data URL PNG) -> <projeto>\vista-<hora>.png; as antigas saem. null se não deu
  function gravarImagem(dataUrl) {
    const m = typeof dataUrl === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
    if (!m || m[1].length > MAX_IMAGEM) return null;
    try {
      for (const f of fs.readdirSync(projeto)) if (/^vista-\d+\.png$/.test(f)) fs.rmSync(path.join(projeto, f), { force: true });
      const file = path.join(projeto, `vista-${Date.now()}.png`);
      fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
      return file;
    } catch (err) {
      log('imagem da vista não gravada:', err.message);
      return null;
    }
  }

  // contexto = { estado (objeto do forgia_estado), imagem (data URL) } vindo da página, opcional
  async function enviar(texto, conversaId, contexto = null) {
    const pedido = String(texto || '').trim();
    if (!pedido) throw new AgentCodeError('erro', 'Pedido vazio.');
    if (pedido.length > MAX_TEXT) throw new AgentCodeError('erro', 'Pedido longo demais.');
    // pronto para receber? (sem conta Claude ou ainda carregando: avisa em vez de mandar)
    const hit = await find();
    if (!hit) throw new AgentCodeError('ausente');
    if (!hit.info.pronto) throw naoPronto(hit);
    fs.mkdirSync(projeto, { recursive: true });
    // manual e regras: só na primeira mensagem da conversa (depois ela já tem); estado e imagem, sempre
    const ctx = { manual: conversaId ? '' : manualTexto() };
    if (contexto && contexto.estado && typeof contexto.estado === 'object') {
      const json = JSON.stringify(contexto.estado);
      if (json.length <= MAX_ESTADO) ctx.estado = json;
    }
    // o que este Agent Code aceita além do básico (anunciado no GET /agent-code)
    const recursos = new Set(Array.isArray(hit.info.recursos) ? hit.info.recursos : []);
    const extra = {};
    if (recursos.has('modelo') && Array.isArray(hit.info.modelos) && hit.info.modelos.includes(MODELO_PADRAO)) extra.modelo = MODELO_PADRAO;
    const png = contexto && typeof contexto.imagem === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(contexto.imagem) : null;
    if (png && recursos.has('imagens') && Buffer.byteLength(png[1], 'base64') <= MAX_ANEXO) {
      extra.imagens = [{ nome: 'vista.png', mime: 'image/png', base64: png[1] }];
      ctx.imagem = { anexo: true };
    } else if (png) {
      const arquivo = gravarImagem(contexto.imagem);
      if (arquivo) ctx.imagem = { arquivo };
    }
    const args = { prompt: prompt(pedido, ctx), cliente: 'Forgia', projeto, mcp_servers: { forgia: servidor() }, ...extra };
    if (typeof conversaId === 'string' && conversaId) args.conversa_id = conversaId;
    const r = await call('agent_code_enviar', args, { repetir: false });
    if (!r || typeof r.tarefa_id !== 'string') throw new AgentCodeError('erro', 'O Agent Code não devolveu a tarefa.');
    tarefas.add(r.tarefa_id);
    return { tarefa_id: r.tarefa_id, conversa_id: typeof r.conversa_id === 'string' ? r.conversa_id : null };
  }

  const known = (id) => {
    if (typeof id !== 'string' || !tarefas.has(id)) throw new AgentCodeError('erro', 'Tarefa desconhecida.');
  };

  async function tarefa(id) {
    known(id);
    const r = await call('agent_code_tarefa', { tarefa_id: id });
    const status = r && r.status;
    if (FINAL.has(status)) tarefas.delete(id);
    return { status, resposta: r && typeof r.resposta === 'string' ? r.resposta : null, erro: r && typeof r.erro === 'string' ? r.erro : null };
  }

  async function cancelar(id) {
    known(id);
    await call('agent_code_cancelar', { tarefa_id: id });
    return { ok: true };
  }

  return { estado, integrar, desligar, enviar, tarefa, cancelar, get integrado() { return !!saved.integrado; } };
}

// faixa de portas: a do contrato, ou FORGIA_AGENTCODE_PORTAS="de-ate" (testes e gravação das
// mídias, para usar o Agent Code falso mesmo com o de verdade aberto na faixa real; até 40 portas)
function portasDoAmbiente(env = process.env) {
  const m = /^(\d{4,5})-(\d{4,5})$/.exec(String(env.FORGIA_AGENTCODE_PORTAS || '').trim());
  if (!m) return PORTS;
  const de = Number(m[1]);
  const ate = Number(m[2]);
  return de >= 1024 && ate <= 65535 && ate >= de && ate - de < 40 ? { de, ate } : PORTS;
}

// cola com o Electron: IPC só da janela do Forgia; erros viram { ok: false, tipo, erro }
function startAgentCode(win) {
  const { app, ipcMain } = require('electron');
  const { serverSpec, forgiaPaths } = require('./mcp-servidor.cjs');
  const userData = app.getPath('userData');
  const client = createAgentCodeClient({
    arquivo: path.join(userData, 'agent-code.json'),
    projeto: path.join(userData, 'agente'),
    servidor: () => serverSpec(forgiaPaths(app)),
    // o manual mora ao lado do servidor MCP (resources\mcp no instalado)
    manual: () => {
      const { manual: secao } = require(path.join(path.dirname(forgiaPaths(app).script), 'manual.cjs'));
      return `${secao()}\n\n${secao('regras')}`;
    },
    versao: app.getVersion(),
    portas: portasDoAmbiente(),
    log: (...a) => console.log('[agent-code]', ...a),
  });
  const fromWindow = (e) => e.sender === win.webContents;
  const handle = (name, fn) =>
    ipcMain.handle(`agentcode:${name}`, async (e, ...args) => {
      if (!fromWindow(e)) return null;
      try {
        return { ok: true, ...(await fn(...args)) };
      } catch (err) {
        return { ok: false, tipo: err.tipo || 'erro', erro: err.tipo === 'erro' ? err.message : null };
      }
    });
  handle('estado', () => client.estado());
  handle('integrar', () => client.integrar());
  handle('desligar', () => client.desligar());
  handle('enviar', (texto, conversaId, contexto) => client.enviar(texto, conversaId, contexto));
  handle('tarefa', (id) => client.tarefa(id));
  handle('cancelar', (id) => client.cancelar(id));
  return client;
}

module.exports = { createAgentCodeClient, startAgentCode, portasDoAmbiente, AgentCodeError, TOKEN, PORTS, MODELO_PADRAO, prompt };
