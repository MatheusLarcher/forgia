// Pedidos de teste com um agente de verdade (Claude Code CLI em modo não interativo) conversando
// com o Forgia.exe gerado pelo MCP. Não mexe na configuração global do usuário: o MCP entra só por
// --mcp-config (um JSON na pasta de evidências) com --strict-mcp-config, e as ferramentas são liberadas por
// --allowedTools mcp__forgia. O Forgia abre com perfil temporário (FORGIA_DADOS aponta o
// ponte.json dele). A conversa roda numa pasta de teste (C:\GitHub\teste), fora do projeto.
//
//   node tests/agente-real.mjs --pedido=p1 --rotulo=antes [--exe=release\fase-c\win-unpacked\Forgia.exe]
//
// Mede, pelo stream-json: chamadas de ferramenta (por nome), capturas, estados, tempo, turnos e
// custo; no fim lê o projeto pela ponte, confere as medidas do pedido e guarda tudo em
// docs/fase-c-evidence/agente/<rotulo>/<pedido>.{jsonl,json,png}.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, bridgeRequest, tempProfile, scriptPath, ROOT, wait, readClipboardText, writeClipboardText } from './forgia-exe.mjs';
import { SCENARIOS } from './agente-pedidos.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return [m[1], m[2] === undefined ? true : m[2]];
}));
const EXE = path.resolve(ROOT, args.exe || 'release/fase-c/win-unpacked/Forgia.exe');
const CLAUDE = args.claude || path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
const CWD = args.pasta || 'C:\\GitHub\\teste';
const scenario = SCENARIOS[args.pedido];
if (!scenario) throw new Error(`--pedido precisa ser um de: ${Object.keys(SCENARIOS).join(', ')}`);
const label = args.rotulo || 'teste';
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'agente', label);
fs.mkdirSync(OUT, { recursive: true });

const profile = tempProfile('forgia-agente-');
const app = await Forgia.open(EXE, profile);
const api = async (cmd, a = {}) => (await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd, args: a })).json;
let summary;
try {
  // o Marcar parte copia para a área de transferência: a do usuário volta logo depois
  const saved = scenario.setup ? readClipboardText() : '';
  const setup = scenario.setup ? await scenario.setup({ app, api }) : null;
  if (scenario.setup) writeClipboardText(saved);
  const cfgFile = path.join(OUT, `mcp-config-${args.pedido}.json`);
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { forgia: { type: 'stdio', command: EXE, args: [scriptPath(EXE)], env: { ELECTRON_RUN_AS_NODE: '1', FORGIA_DADOS: profile } } } }, null, 2));
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const prompt = typeof scenario.prompt === 'function' ? scenario.prompt(setup) : scenario.prompt;
  const cli = ['-p', prompt, '--mcp-config', cfgFile, '--strict-mcp-config', '--allowedTools', 'mcp__forgia', '--output-format', 'stream-json', '--verbose'];
  if (args.model) cli.push('--model', args.model);
  const t0 = Date.now();
  const lines = [];
  await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, cli, { cwd: CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (buf.trim()) lines.push(buf);
      if (code !== 0 && !lines.length) reject(new Error(`claude saiu com ${code}: ${err.slice(0, 500)}`));
      else resolve();
    });
  });
  const wall = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, `${args.pedido}.jsonl`), lines.join('\n') + '\n');
  const events = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {};
  const result = events.find((e) => e.type === 'result') || {};
  const calls = [];
  const errors = [];
  const results = new Map();
  for (const e of events) {
    if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
    }
  }
  for (const e of events) {
    if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
    for (const c of e.message.content) {
      if (c.type !== 'tool_use') continue;
      const r = results.get(c.id);
      calls.push({ nome: c.name.replace(/^mcp__forgia__/, ''), entrada: c.input, erro: !!(r && r.is_error) });
      if (r && r.is_error) errors.push({ nome: c.name, texto: JSON.stringify(r.content).slice(0, 400) });
    }
  }
  const count = (n) => calls.filter((c) => c.nome === n).length;
  const final = await api('estado', { filhos: true });
  const shot = await api('captura', { vista: 'iso', largura: 800, altura: 600 });
  if (shot && shot.imagem) fs.writeFileSync(path.join(OUT, `${args.pedido}-iso.png`), Buffer.from(shot.imagem.split(',')[1], 'base64'));
  await app.screenshot(path.join(OUT, `${args.pedido}-tela.png`));
  const check = scenario.check(final, setup);
  const text = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message.content || []).filter((c) => c.type === 'text').map((c) => c.text)).join('\n').slice(-1500);
  summary = {
    pedido: args.pedido,
    rotulo: label,
    prompt,
    modelo: init.model,
    mcp: init.mcp_servers,
    ferramentasForgia: (init.tools || []).filter((n) => /forgia/.test(n)).length,
    chamadas: calls.length,
    porFerramenta: Object.fromEntries([...new Set(calls.map((c) => c.nome))].map((n) => [n, count(n)])),
    capturas: count('forgia_captura'),
    estados: count('forgia_estado'),
    lotes: count('forgia_lote'),
    manual: count('forgia_manual'),
    codigoLivre: count('forgia_executar_codigo'),
    naoForgia: calls.filter((c) => !c.nome.startsWith('forgia_')).map((c) => c.nome),
    errosDeFerramenta: errors,
    tempoMs: result.duration_ms || wall,
    tempoParedeMs: wall,
    turnos: result.num_turns,
    custoUsd: result.total_cost_usd,
    medidasCertas: check.ok,
    conferencia: check,
    sequencia: calls.map((c) => c.nome + (c.erro ? ' (erro)' : '')),
    respostaFinal: text,
    console: app.console.slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT, `${args.pedido}.json`), JSON.stringify({ ...summary, estadoFinal: final }, null, 2));
  console.log(JSON.stringify({ pedido: summary.pedido, rotulo: label, chamadas: summary.chamadas, porFerramenta: summary.porFerramenta, capturas: summary.capturas, estados: summary.estados, tempoS: Math.round(summary.tempoMs / 100) / 10, turnos: summary.turnos, medidasCertas: summary.medidasCertas, motivo: check.motivo, erros: errors.length, naoForgia: summary.naoForgia }, null, 1));
} finally {
  await app.close();
  await wait(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
