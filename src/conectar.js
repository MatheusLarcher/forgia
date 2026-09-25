import { t } from './textos/index.js';

// Conteúdo do diálogo Conectar IA: um seletor de agente e o texto para colar nele. info vem do
// processo main (electron/ponte.cjs, describe()):
// { exe, script, dados, dadosPadrao, porta, ativa, erro, empacotado, versao }.
// O servidor MCP roda pelo próprio Forgia.exe com ELECTRON_RUN_AS_NODE=1 e o script fora do asar
// (resources\mcp\forgia-mcp.cjs); FORGIA_DADOS só entra quando a pasta de dados não é a padrão
// (%APPDATA%\Forgia), como num teste com --user-data-dir. O texto de cada agente fica em
// t.conectar.prompts; aqui só se montam os pedaços técnicos (comando, JSON e TOML com os caminhos
// reais), que não são tradução. Clicar em Conectar IA de novo gera os caminhos da versão instalada.

export const AGENTS = ['agentcode', 'codex', 'cursor', 'generico'];

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
};

// configuração comum a todos os agentes
export function serverSpec(info) {
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  const same = (a, b) => String(a || '').toLowerCase().replace(/[\\/]+$/, '') === String(b || '').toLowerCase().replace(/[\\/]+$/, '');
  if (info.dados && !same(info.dados, info.dadosPadrao)) env.FORGIA_DADOS = info.dados;
  return { command: info.exe, args: [info.script], env };
}

// argumento entre aspas duplas para o shell (Git Bash, PowerShell e cmd aceitam; caminho do
// Windows não tem aspas)
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
// string TOML: literal (aspas simples, barra invertida como está) se der; senão básica escapada
const toml = (s) => (String(s).includes("'") ? JSON.stringify(String(s)) : `'${s}'`);

// pedaços técnicos de cada texto, com os caminhos desta instalação
export function promptParts(info) {
  const s = serverSpec(info);
  const envList = Object.entries(s.env);
  const entry = (extra = {}) => JSON.stringify({ ...extra, command: s.command, args: s.args, env: s.env });
  return {
    exe: s.command,
    script: s.args[0],
    env: envList.map(([k, v]) => `${k}=${v}`).join('  '),
    // sintaxe do "claude mcp add --help" (2.1.x): nome antes de -e (que aceita vários valores) e o
    // comando do servidor depois de --
    claudeAdd: `claude mcp add --scope user forgia ${envList.map(([k, v]) => `-e ${q(`${k}=${v}`)}`).join(' ')} -- ${q(s.command)} ${s.args.map(q).join(' ')}`,
    claudeJson: entry({ type: 'stdio' }),
    cursorJson: entry({ type: 'stdio' }),
    genericoJson: JSON.stringify({ mcpServers: { forgia: { command: s.command, args: s.args, env: s.env } } }, null, 2),
    codexToml: [
      '[mcp_servers.forgia]',
      `command = ${toml(s.command)}`,
      `args = [${s.args.map(toml).join(', ')}]`,
      `env = { ${envList.map(([k, v]) => `${k} = ${toml(v)}`).join(', ')} }`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 120',
      'default_tools_approval_mode = "auto"',
    ].join('\n'),
  };
}

// texto para colar no agente escolhido
export function connectPrompt(info, agent) {
  const make = t.conectar.prompts[agent] || t.conectar.prompts.generico;
  return make(promptParts(info));
}

export function connectContent(info, copy, agent = AGENTS[0]) {
  const tx = t.conectar;
  if (!info) return el('p', {}, tx.semPonte);
  const area = el('textarea', { class: 'conectar-texto', readonly: '', spellcheck: 'false', rows: '14' });
  const buttons = AGENTS.map((a) => el('button', { 'data-agente': a, onclick: () => pick(a) }, tx.agentes[a]));
  const pick = (a) => {
    agent = a;
    area.value = connectPrompt(info, a);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.agente === a));
  };
  pick(agent);
  const status = info.porta ? tx.ponteAtiva(info.porta) : tx.ponteInativa(info.erro || '');
  return el(
    'div',
    { class: 'conectar' },
    el('p', {}, tx.explica),
    el('div', { class: 'segmented conectar-agentes', role: 'group', 'aria-label': tx.agente }, buttons),
    area,
    el('div', { class: 'conectar-acoes' }, el('span', { class: 'muted conectar-status' }, status), el('button', { class: 'btn primary', 'data-conectar': 'copiar', onclick: () => copy(area.value) }, t.dialogos.conectar.copiar)),
  );
}
