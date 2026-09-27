// Conectar IA no Forgia.exe gerado (perfil temporário), nos dois temas:
//   node tests/conectar-exe.mjs [--exe=release\fase-c\win-unpacked\Forgia.exe]
// 1. Abre o diálogo pelo Pedir à IA > Conectar IA, escolhe cada agente e guarda o texto gerado
//    (docs/fase-c-evidence/conectar/<agente>.txt) e a captura (<agente>-<tema>.png).
// 2. Copiar põe o texto na área de transferência (a do usuário é restaurada no fim).
// 3. Roda o "claude mcp add" do texto do Claude Code, do jeito que está, no Git Bash e no
//    PowerShell, com CLAUDE_CONFIG_DIR numa pasta temporária (NÃO toca ~/.claude.json nem
//    ~/.claude/settings.json do usuário), e confere com "claude mcp get/list" que o servidor
//    registrado conecta no Forgia aberto.
// Resultado: docs/fase-c-evidence/conectar/resultado.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Forgia, tempProfile, ROOT, wait, readClipboardText, writeClipboardText } from './forgia-exe.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const EXE = path.resolve(ROOT, arg.exe || 'release/fase-c/win-unpacked/Forgia.exe');
const CLAUDE = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'conectar');
fs.mkdirSync(OUT, { recursive: true });
const AGENTS = ['claudecode', 'codex', 'cursor', 'generico']; // Agent Code é a integração, sem texto
const USER_CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const userHasForgia = () => {
  try {
    return fs.readFileSync(USER_CLAUDE_JSON, 'utf8').includes('forgia-mcp.cjs');
  } catch {
    return null;
  }
};

const res = { exe: EXE, textos: {}, capturas: [], claude: {} };
const profile = tempProfile('forgia-conectar-');
const saved = readClipboardText();
const app = await Forgia.open(EXE, profile);
try {
  const center = (sel) => app.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const click = async (sel) => {
    const c = await center(sel);
    await app.mouse('mouseMoved', c.x, c.y);
    await app.mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 });
    await app.mouse('mouseReleased', c.x, c.y, { button: 'left', buttons: 0, clickCount: 1 });
    await wait(250);
  };
  await app.waitFor("!!document.querySelector('.ia-chat')", 10000, 'conversa da IA montada');
  for (const tema of ['claro', 'escuro']) {
    await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
    // botão real: "Pedir à IA" na barra de status, e Conectar IA dentro da conversa
    if (!(await app.js("!!document.querySelector('.ia-chat:not([hidden])')"))) await click('#sb-pedir');
    await click('.ia-chat [data-ia="conectar"]');
    await app.waitFor("!!document.querySelector('.modal .conectar textarea')", 3000, 'diálogo Conectar IA');
    for (const a of AGENTS) {
      await click(`.modal [data-agente="${a}"]`);
      const s = await app.js(`(() => ({ texto: document.querySelector('.modal .conectar-texto').value, pressionado: document.querySelector('.modal [data-agente="${a}"]').getAttribute('aria-pressed') }))()`);
      if (s.pressionado !== 'true') throw new Error(`${a}: botão do agente não ficou pressionado`);
      if (tema === 'claro') {
        res.textos[a] = s.texto;
        fs.writeFileSync(path.join(OUT, `${a}.txt`), s.texto);
      } else if (res.textos[a] !== s.texto) throw new Error(`${a}: texto muda com o tema`);
      await app.js("document.querySelector('.modal .conectar-texto').scrollTop = 0, true");
      await wait(150);
      res.capturas.push(path.basename(await app.screenshot(path.join(OUT, `${a}-${tema}.png`))));
    }
    // Copiar (botão real) com o agente atual
    await click('.modal [data-agente="claudecode"]');
    await click('.modal [data-conectar="copiar"]');
    await wait(300);
    if (tema === 'claro') {
      const got = readClipboardText().replace(/\r\n/g, '\n'); // o Windows guarda o texto com CRLF
      res.copiar = { igualAoTexto: got === res.textos.claudecode, aviso: await app.js("[...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ')"), inicio: got.slice(0, 80) };
    }
    await app.js("document.getElementById('modal-root').innerHTML = '', true");
  }
  writeClipboardText(saved);

  // o comando claude mcp add do texto, como o agente o rodaria, numa configuração isolada
  const add = res.textos.claudecode.split('\n').map((l) => l.trim()).find((l) => l.startsWith('claude mcp add '));
  res.claude.comando = add;
  res.claude.usuarioAntes = userHasForgia();
  for (const shell of ['bash', 'powershell']) {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-claude-cfg-'));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
    delete env.CLAUDECODE;
    const line = add.replace(/^claude /, shell === 'bash' ? `"${CLAUDE.replace(/\\/g, '/')}" ` : `& "${CLAUDE}" `);
    const r = shell === 'bash'
      ? spawnSync('bash', ['-c', line], { env, encoding: 'utf8', windowsHide: true })
      : spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], { env, encoding: 'utf8', windowsHide: true });
    const get = spawnSync(CLAUDE, ['mcp', 'get', 'forgia'], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    const list = spawnSync(CLAUDE, ['mcp', 'list'], { env, encoding: 'utf8', windowsHide: true, timeout: 90000 });
    let registrado = null;
    try {
      registrado = JSON.parse(fs.readFileSync(path.join(cfg, '.claude.json'), 'utf8')).mcpServers?.forgia || null;
    } catch {}
    res.claude[shell] = {
      add: { status: r.status, saida: (r.stdout + r.stderr).trim().slice(0, 400) },
      get: (get.stdout + get.stderr).trim().slice(0, 800),
      list: (list.stdout + list.stderr).trim().slice(0, 600),
      conectado: /forgia:.*(✓|Connected)/i.test(list.stdout || ''),
      registrado,
    };
    fs.rmSync(cfg, { recursive: true, force: true });
  }
  res.claude.usuarioDepois = userHasForgia();
} finally {
  writeClipboardText(saved);
  await app.close();
  await wait(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ capturas: res.capturas.length, copiar: res.copiar, comando: res.claude.comando, bash: { add: res.claude.bash.add.status, conectado: res.claude.bash.conectado, registrado: res.claude.bash.registrado }, powershell: { add: res.claude.powershell.add.status, conectado: res.claude.powershell.conectado }, usuarioAntes: res.claude.usuarioAntes, usuarioDepois: res.claude.usuarioDepois }, null, 1));
