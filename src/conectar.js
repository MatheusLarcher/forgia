import { t } from './textos/index.js';
import { ICONS } from './icons.js';

// Conteúdo do diálogo Conectar IA: um seletor de agente. Na opção Agent Code, a integração
// (src/agentcode.js): o que é, a vantagem, Integrar e o estado. Nas outras, o texto para colar no
// agente. info vem do processo main (electron/ponte.cjs, describe()):
// { exe, script, dados, dadosPadrao, servidor, porta, ativa, erro, empacotado, versao }.
// servidor = { command, args, env } do servidor MCP, montado no main (electron/mcp-servidor.cjs),
// o mesmo que a integração manda ao Agent Code; aqui só se formata. O texto de cada agente fica em
// t.conectar.prompts; aqui só se montam os pedaços técnicos (comando, JSON e TOML com os caminhos
// reais), que não são tradução. Clicar em Conectar IA de novo gera os caminhos da versão instalada.

export const AGENTS = ['agentcode', 'claudecode', 'codex', 'cursor', 'generico'];
// vídeo tutorial de cada aba: public/ajuda/<base>-<tema>.webm, gravados dos roteiros do README
// (docs/media/roteiros/conectar-*.json). O Cursor ainda não tem (o usuário não usa o Cursor).
export const VIDEOS = { agentcode: 'conectar-agentcode', claudecode: 'conectar-claude', codex: 'conectar-codex', generico: 'conectar-outro' };
const LINKS = {
  agentCode: 'https://github.com/MatheusLarcher/agent-code',
  planos: 'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan',
};

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

// argumento entre aspas duplas para o shell (Git Bash, PowerShell e cmd aceitam; caminho do
// Windows não tem aspas)
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
// string TOML: literal (aspas simples, barra invertida como está) se der; senão básica escapada
const toml = (s) => (String(s).includes("'") ? JSON.stringify(String(s)) : `'${s}'`);

// pedaços técnicos de cada texto, com os caminhos desta instalação
export function promptParts(info) {
  const s = info.servidor;
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

// ícone de cada agente no seletor (src/assets/ia, pelo CSS: .ag-icone[data-ia]); "Outro", um plugue
function agentIcon(a) {
  const i = el('span', { class: 'ag-icone', 'data-ia': a, 'aria-hidden': 'true' });
  if (a === 'generico') i.innerHTML = ICONS.plug;
  return i;
}

// vídeo do tema ativo (lido na hora: este arquivo também roda em Node, nos testes), em loop e
// mudo, com pausar/tocar como o das dicas (mesmo estilo, .dica-video)
function tutorialVideo(base) {
  const tema = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
  const video = el('video', { src: `./ajuda/${base}-${tema}.webm`, 'data-base': base });
  Object.assign(video, { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
  const btn = el('button', { type: 'button', class: 'dica-play', onclick: () => (video.paused ? video.play().catch(() => {}) : video.pause()) });
  const sync = () => {
    btn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
    btn.setAttribute('aria-label', video.paused ? t.dialogos.video.tocar : t.dialogos.video.pausar);
  };
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  sync();
  return el('div', { class: 'dica-video conectar-video' }, video, btn);
}

// para o vídeo e solta o arquivo (troca de aba e fechar o diálogo)
function stopVideo(box) {
  const v = box.querySelector('video');
  if (!v) return;
  v.pause();
  v.removeAttribute('src');
  v.load();
}

// agentCode: src/agentcode.js (null sem Electron). O elemento devolvido tem fechar(), chamado ao
// fechar o diálogo
export function connectContent(info, copy, agent = AGENTS[0], agentCode = null) {
  const tx = t.conectar;
  if (!info) return el('p', {}, tx.semPonte);
  const area = el('textarea', { class: 'conectar-texto', readonly: '', spellcheck: 'false', rows: '10' });
  const explain = el('div', { class: 'conectar-explica' }, ...tx.explica.map((p) => el('p', {}, p)));
  const status = info.porta ? tx.ponteAtiva(info.porta) : tx.ponteInativa(info.erro || '');
  const actions = el('div', { class: 'conectar-acoes' }, el('span', { class: 'muted conectar-status' }, status), el('button', { class: 'btn primary', 'data-conectar': 'copiar', onclick: () => copy(area.value) }, t.dialogos.conectar.copiar));
  const panel = agentCode && agentCode.available ? agentCodePanel(agentCode) : null;
  const buttons = AGENTS.filter((a) => a !== 'agentcode' || panel).map((a) => el('button', { 'data-agente': a, onclick: () => pick(a) }, agentIcon(a), tx.agentes[a]));
  const tutorial = el('div', { class: 'conectar-tutorial' });
  const pick = (a) => {
    agent = a === 'agentcode' && !panel ? 'claudecode' : a;
    const integration = agent === 'agentcode';
    stopVideo(tutorial);
    tutorial.replaceChildren(...(VIDEOS[agent] ? [tutorialVideo(VIDEOS[agent])] : []));
    tutorial.hidden = !VIDEOS[agent];
    for (const e of [explain, area, actions]) e.hidden = integration;
    if (panel) {
      panel.hidden = !integration;
      if (integration) panel.refresh();
    }
    if (!integration) area.value = connectPrompt(info, agent);
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.agente === agent));
  };
  const root = el('div', { class: 'conectar' }, el('div', { class: 'segmented conectar-agentes', role: 'group', 'aria-label': tx.agente }, buttons),
    // o que fazer (texto e botões) à esquerda, o vídeo à direita: Integrar/Copiar sem rolar
    el('div', { class: 'conectar-corpo' }, el('div', { class: 'conectar-principal' }, panel, explain, area, actions), tutorial),
  );
  pick(agent);
  root.fechar = () => {
    stopVideo(tutorial);
    if (panel) panel.fechar();
  };
  return root;
}

// opção Agent Code: o que é, a vantagem, o que exige, onde baixar, Integrar e o estado
function agentCodePanel(ac) {
  const tx = t.agentcode;
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const state = el('p', { class: 'ac-estado', role: 'status' });
  const integrate = el('button', { class: 'btn primary', 'data-agentcode': 'integrar', onclick: () => run(() => ac.integrar()) }, tx.integrar);
  const off = el('button', { class: 'text-btn small', 'data-agentcode': 'desligar', onclick: () => run(() => ac.desligar()) }, tx.desligar);
  let busy = false;
  const show = (s) => {
    state.dataset.estado = busy ? 'procurando' : s ? s.estado : 'procurando';
    state.textContent = busy || !s ? tx.procurando : s.estado === 'integrado' ? tx.estados.integrado(s.versao) : s.estado === 'ausente' && s.integrado ? tx.estados.integradoAusente : tx.estados[s.estado] || tx.estados.ausente;
    integrate.hidden = !!(s && s.estado === 'integrado');
    integrate.disabled = busy;
    off.hidden = !(s && s.integrado);
  };
  async function run(fn) {
    busy = true;
    show(ac.estado);
    try {
      await fn();
    } finally {
      busy = false;
      show(ac.estado);
    }
  }
  const onState = (e) => show(e.detail);
  ac.addEventListener('estado', onState);
  const panel = el(
    'div',
    { class: 'conectar-agentcode' },
    el('p', { class: 'ac-oque' }, el('strong', {}, tx.nome), ' ', tx.oQueE),
    el('p', { class: 'ac-vantagem' }, tx.vantagem),
    el('p', { class: 'ac-exige muted' }, tx.exige, ' ', link(LINKS.planos, tx.verPlanos)),
    el('div', { class: 'ac-acoes' }, state, el('div', { class: 'ac-botoes' }, off, integrate)),
    el('p', { class: 'ac-baixar' }, link(LINKS.agentCode, tx.baixar)),
  );
  show(ac.estado);
  panel.refresh = () => run(() => ac.refresh());
  panel.fechar = () => ac.removeEventListener('estado', onState);
  return panel;
}
