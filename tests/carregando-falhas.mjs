// Provoca de verdade as falhas da abertura (janela de abertura electron/splash.html + editor escondido
// até carregar) e registra a linha do tempo das janelas na tela. Não é teste de aceite automático da
// suíte (nome sem .test): roda o Electron de verdade, com perfil TEMPORÁRIO, e imprime/grava JSON.
//   node tests/carregando-falhas.mjs [depois|antes|exe] [cenário...]
// depois: Electron do node_modules com uma CÓPIA do app em %TEMP% (electron/ + dist/ atuais), em que
//         o dist é quebrado de propósito em cada cenário (o dist do projeto não é tocado)
// antes:  igual, mas com electron/main.cjs, electron/preload.cjs e o script de index.html de
//         docs/fase-c-evidence/abertura/falhas/antes/ (a versão antes desta correção)
// exe:    o Forgia.exe gerado (FORGIA_EXE), só cenários que não precisam quebrar o dist
// Um PowerShell fica vigiando as janelas do PID aberto (EnumWindows a cada ~25 ms) e, conforme o
// cenário, manda Alt+F4 (WM_SYSCOMMAND SC_CLOSE) à abertura ou WM_CLOSE à janela escondida do editor.
// Encerra só os PIDs que abriu. Resultado em docs/fase-c-evidence/abertura/falhas/<variante>.json.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, Cdp, wait, tempProfile, exePath, Forgia, bridgeRequest, fileDialog } from './forgia-exe.mjs';

const VARIANTE = process.argv[2] || 'depois';
const SO = process.argv.slice(3);
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'abertura', 'falhas');
const ANTES = path.join(OUT, 'antes');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'forgia-falhas-'));

// ---------- cópia do app com o dist quebrado de propósito ----------
const bundle = (dist) => fs.readdirSync(path.join(dist, 'assets')).find((f) => /^index-.*\.js$/.test(f));
const QUEBRAS = {
  normal: () => {},
  // erro ao ligar os módulos: importa um nome que o chunk do three não exporta (nenhum módulo roda)
  link: (dist) => {
    const b = path.join(dist, 'assets', bundle(dist));
    const three = fs.readdirSync(path.join(dist, 'assets')).find((f) => /^three-.*\.js$/.test(f));
    fs.writeFileSync(b, `import{naoExiste as __quebra}from"./${three}";` + fs.readFileSync(b, 'utf8'));
  },
  // o bundle do editor não está no dist (erro no <script>)
  'sem-bundle': (dist) => fs.rmSync(path.join(dist, 'assets', bundle(dist))),
  // nem o index.html (did-fail-load)
  'sem-dist': (dist) => fs.rmSync(path.join(dist, 'index.html')),
  // página ocupada 8 s logo no início do JS (a abertura demora de verdade; o Chromium marca "sem resposta")
  lenta: (dist) => {
    const b = path.join(dist, 'assets', bundle(dist));
    fs.writeFileSync(b, '{const __t=Date.now();while(Date.now()-__t<8000);}' + fs.readFileSync(b, 'utf8'));
  },
};

function trocarScriptAntes(html) {
  // o bloco do script de abertura em index.html (do comentário "app desktop" até o </script>)
  const re = /      \/\/ app desktop:[\s\S]*?(?=    <\/script>)/;
  const antigo = fs.readFileSync(path.join(ANTES, 'index.html'), 'utf8').match(re);
  if (!antigo) throw new Error('script antigo não achado');
  return html.replace(re, antigo[0]);
}

const apps = new Map();
function appDir(quebra) {
  if (apps.has(quebra)) return apps.get(quebra);
  const dir = path.join(BASE, `app-${VARIANTE}-${quebra}`);
  fs.cpSync(path.join(ROOT, 'electron'), path.join(dir, 'electron'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  if (VARIANTE === 'antes') {
    for (const f of ['main.cjs', 'preload.cjs']) fs.copyFileSync(path.join(ANTES, f), path.join(dir, 'electron', f));
    const html = path.join(dir, 'dist', 'index.html');
    fs.writeFileSync(html, trocarScriptAntes(fs.readFileSync(html, 'utf8')));
  }
  QUEBRAS[quebra](path.join(dir, 'dist'));
  apps.set(quebra, dir);
  return dir;
}

// ---------- vigia das janelas (PowerShell) ----------
const VIGIA = (modo, dur) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class JW {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public struct R { public int L, T, Rt, B; }
  public static string Lista(uint pid) {
    var o = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      R r; GetWindowRect(h, out r);
      o.Add(h.ToInt64() + "," + (IsWindowVisible(h) ? 1 : 0) + "," + (r.Rt - r.L) + "," + (r.B - r.T) + "," + (IsZoomed(h) ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    return string.Join(";", o);
  }
}
"@
function Agora { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
[Console]::Out.WriteLine("pronto"); [Console]::Out.Flush()
$alvo = [int][Console]::In.ReadLine()
$t0 = Agora; $ult = $null; $feito = $false
while ($true) {
  $agora = Agora
  if ($agora - $t0 -gt ${dur}) { [Console]::Out.WriteLine("$agora fim"); break }
  if (-not (Get-Process -Id $alvo -ErrorAction SilentlyContinue)) { [Console]::Out.WriteLine("$agora saiu"); break }
  $l = [JW]::Lista($alvo)
  if ($l -ne $ult) { [Console]::Out.WriteLine("$agora janelas $l"); $ult = $l }
  if (-not $feito -and '${modo}' -ne 'nada') {
    $ws = @($l.Split(';') | Where-Object { $_ } | ForEach-Object { $f = $_.Split(','); [pscustomobject]@{ h = [int64]$f[0]; vis = $f[1] -eq '1'; w = [int]$f[2] } })
    $abertura = @($ws | Where-Object { $_.vis -and $_.w -gt 100 -and $_.w -lt 1000 })
    if ($abertura.Count) {
      if ('${modo}' -eq 'altf4') {
        [void][JW]::PostMessage([IntPtr]$abertura[0].h, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero)
        [Console]::Out.WriteLine("$agora acao altf4-abertura"); $feito = $true
      } elseif ('${modo}' -eq 'fechar-editor') {
        $ed = @($ws | Where-Object { -not $_.vis -and $_.w -ge 1000 })
        if ($ed.Count) { [void][JW]::PostMessage([IntPtr]$ed[0].h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); [Console]::Out.WriteLine("$agora acao wm_close-editor-escondido"); $feito = $true }
      }
    }
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 25
}
[Console]::Out.Flush()
`;

function vigiar(modo, dur) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(VIGIA(modo, dur), 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const linhas = [];
  let buf = '';
  let err = '';
  let avisarPronto;
  const pronto = new Promise((r) => (avisarPronto = r));
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (l === 'pronto') avisarPronto();
      else if (l) linhas.push(l);
    }
  });
  ps.stderr.on('data', (c) => (err += c));
  const fim = new Promise((r) => ps.on('exit', r));
  return { ps, linhas, pronto, fim, erro: () => err };
}

// linha do tempo -> marcos (ms desde o spawn)
function analisar(linhas, t0) {
  const r = { abertura: null, aberturaSaiu: null, editor: null, editorMax: null, acao: null, saiu: null, fim: null, ultimas: null };
  for (const l of linhas) {
    const [ts, tipo, resto = ''] = l.split(' ');
    const t = +ts - t0;
    if (tipo === 'acao') r.acao = { t, oque: resto };
    if (tipo === 'saiu') r.saiu = t;
    if (tipo === 'fim') r.fim = t;
    if (tipo !== 'janelas') continue;
    const ws = resto.split(';').filter(Boolean).map((s) => {
      const [, vis, w, h, max] = s.split(',');
      return { vis: vis === '1', w: +w, h: +h, max: max === '1' };
    });
    const ab = ws.some((w) => w.vis && w.w > 100 && w.w < 1000);
    const ed = ws.find((w) => w.vis && w.w >= 1000);
    if (ab && r.abertura === null) r.abertura = t;
    if (!ab && r.abertura !== null && r.aberturaSaiu === null) r.aberturaSaiu = t;
    if (ed && r.editor === null) r.editor = t;
    if (ed && ed.max && r.editorMax === null) r.editorMax = t;
    r.ultimas = ws.filter((w) => w.vis).map((w) => `${w.w}x${w.h}${w.max ? ' max' : ''}`);
  }
  r.aberturaPresaNoFim = r.saiu === null && !!r.ultimas && r.ultimas.some((s) => +s.split('x')[0] < 1000);
  return r;
}

// página do editor pelo CDP (perfil do cenário)
async function pagina(profile) {
  const port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10);
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = new Cdp(ver.webSocketDebuggerUrl);
  await cdp.connect();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page' && /index\.html/.test(x.url));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const js = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { cdp, js };
}

const matar = (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });

// um cenário: abre, vigia (e age), opcionalmente manda a 2ª instância, junta a linha do tempo
async function rodar(nome, { quebra = 'normal', modo = 'nada', dur = 12000, segunda = null, conferir = null }) {
  const exe = VARIANTE === 'exe' ? exePath() : ELECTRON;
  const pre = VARIANTE === 'exe' ? [] : [appDir(quebra)];
  const profile = tempProfile('forgia-falhas-perfil-');
  const v = vigiar(modo, dur);
  await Promise.race([v.pronto, wait(30000)]);
  const t0 = Date.now();
  // log do Chromium/Electron no stderr: guardado quando o processo sai sozinho (para entender a saída)
  const child = spawn(exe, [...pre, `--user-data-dir=${profile}`, '--remote-debugging-port=0'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
  let log = '';
  child.stderr.on('data', (c) => (log = (log + c).slice(-4000)));
  let saiuCod = null;
  child.on('exit', (code) => (saiuCod = { code, t: Date.now() - t0 }));
  v.ps.stdin.write(child.pid + '\n');
  let segundaRes = null;
  let s = null;
  if (segunda) {
    (async () => {
      await wait(segunda.ms);
      const ts = Date.now() - t0;
      s = spawn(exe, [...pre, `--user-data-dir=${profile}`, segunda.arquivo], { stdio: 'ignore' });
      segundaRes = { lancada: ts };
      const code = await new Promise((r) => s.on('exit', r));
      Object.assign(segundaRes, { saiu: Date.now() - t0, code });
    })();
  }
  await v.fim;
  if (segunda) await wait(2500); // a 2ª instância termina de sair
  const res = { cenario: nome, variante: VARIANTE, quebra, modo, ...analisar(v.linhas, t0), processoSaiu: saiuCod, segunda: segundaRes };
  if (saiuCod) res.log = log;
  if (conferir && !saiuCod) {
    try {
      const p = await pagina(profile);
      res.pagina = await conferir(p.js);
      p.cdp.close();
    } catch (e) {
      res.pagina = { erro: String(e.message || e) };
    }
  }
  res.vivoNoFim = !saiuCod;
  if (!saiuCod) matar(child.pid);
  // a 2ª instância que não saiu (virou a principal) também é deste roteiro: encerra
  if (s && s.exitCode === null && s.signalCode === null) {
    res.segundaFicouAberta = true;
    matar(s.pid);
  }
  res.linhas = v.linhas.map((l) => l.replace(/^(\d+)/, (m) => `+${+m - t0}`));
  if (v.erro()) res.erroVigia = v.erro().slice(0, 500);
  console.log(JSON.stringify({ ...res, linhas: undefined }));
  return res;
}

// um .forgia de verdade (salvo pelo próprio app, pelo diálogo do Windows) para a 2ª instância
async function criarForgia() {
  const pasta = tempProfile('forgia-falhas-arq-');
  const arquivo = path.join(pasta, 'falhas.forgia');
  const exe = VARIANTE === 'exe' ? exePath() : ELECTRON;
  const app = await Forgia.open(exe, tempProfile('forgia-falhas-salvar-'), { extraArgs: VARIANTE === 'exe' ? [] : [appDir('normal')] });
  try {
    await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: 'criar', args: { tipo: 'cone', medidas: [14, 14, 20], nome: 'cone das falhas' } });
    await app.js('void forgia.arquivo.save({ como: true })');
    const r = fileDialog(app.pid, arquivo);
    if (r !== 'ok') throw new Error('diálogo de salvar: ' + r);
    await app.waitFor('!!forgia.arquivo.file && !forgia.arquivo.isDirty()', 20000, 'salvo');
  } finally {
    await app.close();
  }
  return arquivo;
}

const ESTADO = `(async () => {
  const t0 = Date.now();
  while (!(window.forgia && forgia.arquivo) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  if (!(window.forgia && forgia.arquivo)) return { semEditor: true, carregado: document.documentElement.dataset.carregado || null };
  await forgia.arquivo.ready;
  await new Promise((r) => setTimeout(r, 1500));
  return {
    carregado: document.documentElement.dataset.carregado || null,
    arquivo: forgia.arquivo.file ? forgia.arquivo.file.nome : null,
    objetos: forgia.editor.objects.map((o) => o.name),
    modal: !!document.querySelector('.modal'),
  };
})()`;

const CENARIOS = {
  normal: () => rodar('normal', { dur: 8000 }),
  'erro-link': () => rodar('erro-link', { quebra: 'link', dur: 25000 }),
  'sem-bundle': () => rodar('sem-bundle', { quebra: 'sem-bundle', dur: 10000 }),
  'sem-dist': () => rodar('sem-dist', { quebra: 'sem-dist', dur: 10000 }),
  // editor destruído antes de aparecer: a abertura não pode ficar sozinha na tela
  'editor-fechado': () => rodar('editor-fechado', { modo: 'fechar-editor', quebra: VARIANTE === 'exe' ? 'normal' : 'lenta', dur: 12000 }),
  // página ocupada 8 s: o editor só aparece quando ela avisa (não no "sem resposta")
  lenta: () => rodar('lenta', { quebra: 'lenta', dur: 16000, conferir: (js) => js(ESTADO) }),
  // Alt+F4 na abertura com a página ainda carregando
  altf4: () => rodar('altf4', { modo: 'altf4', quebra: VARIANTE === 'exe' ? 'normal' : 'lenta', dur: VARIANTE === 'exe' ? 6000 : 14000, conferir: (js) => js(ESTADO) }),
  // Alt+F4 na abertura e, depois, duplo clique num .forgia (2ª instância), ainda carregando
  'altf4-segunda': async (arquivo) =>
    rodar('altf4-segunda', { modo: 'altf4', quebra: VARIANTE === 'exe' ? 'normal' : 'lenta', dur: VARIANTE === 'exe' ? 6000 : 16000, segunda: { ms: VARIANTE === 'exe' ? 900 : 2500, arquivo }, conferir: (js) => js(ESTADO) }),
};

const nomes = SO.length ? SO : Object.keys(CENARIOS).filter((n) => VARIANTE !== 'exe' || ['normal', 'editor-fechado', 'altf4', 'altf4-segunda'].includes(n));
const resultados = [];
try {
  const arquivo = nomes.includes('altf4-segunda') ? await criarForgia() : null;
  for (const n of nomes) resultados.push(await CENARIOS[n](arquivo));
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${VARIANTE}.json`), JSON.stringify(resultados, null, 2));
  fs.rmSync(BASE, { recursive: true, force: true });
}
