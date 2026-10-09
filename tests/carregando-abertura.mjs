// Mede a abertura do Forgia.exe GERADO (não é teste de aceite; imprime JSON). Perfil temporário,
// sem as flags de "não frear janela em segundo plano" dos outros testes (abre como o usuário abre).
//   FORGIA_EXE=release\splash\win-unpacked\Forgia.exe node tests/carregando-abertura.mjs [vezes] [pasta-capturas]
// Marcos (ms desde o spawn): main (main.cjs começou), ready (app.whenReady), splashPintou (abertura
// desenhada; show() chamado), splash (evento show da abertura), principal (janela do editor visível),
// sinalCarregado (a página avisou que tirou o loading), readyToShow (1ª pintura do editor).
// primeiraJanela = a 1ª janela na tela; editorPronto = editor carregado E na tela.
// A 1ª abertura (perfil novo) sai à parte; a média é das seguintes.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { exePath, tempProfile, Cdp, wait } from './forgia-exe.mjs';

const EXE = exePath();
if (!EXE) {
  console.error('defina FORGIA_EXE com o Forgia.exe gerado');
  process.exit(2);
}
const VEZES = parseInt(process.argv[2] || '3', 10);
const CAPTURAS = process.argv[3] ? path.resolve(process.argv[3]) : null;

const CARREGADO = `new Promise((r) => {
  const el = document.documentElement;
  const ok = () => el.dataset.carregado === '1';
  if (ok()) return r(-1);
  new MutationObserver((_, o) => { if (ok()) { o.disconnect(); r(performance.timeOrigin + performance.now()); } })
    .observe(el, { attributes: true, attributeFilter: ['data-carregado'] });
})`;

const TEMPOS_PAGINA = `(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const t = { inicio: 0, html: n.responseEnd, domInteractive: n.domInteractive, dcl: n.domContentLoadedEventStart, load: n.loadEventStart };
  for (const e of performance.getEntriesByType('paint')) t[e.name] = e.startTime;
  for (const e of performance.getEntriesByType('mark')) t[e.name] = e.startTime;
  return { origem: performance.timeOrigin, t };
})()`;

async function alvo(cdp, re, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const t = targetInfos.find((x) => x.type === 'page' && re.test(x.url));
    if (t) return t;
    if (Date.now() - t0 > timeout) return null;
    await wait(15);
  }
}

async function captura(cdp, targetId, file) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function abrir(profile, n) {
  fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
  const marcos = {};
  const t0 = Date.now();
  const child = spawn(EXE, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, FORGIA_MEDIR_ABERTURA: '1' },
  });
  let saiu = false;
  const exit = new Promise((r) => child.on('exit', () => r((saiu = true))));
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = /\[abertura\] (\S+) (\d+)/.exec(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m && !(m[1] in marcos)) marcos[m[1]] = Number(m[2]) - t0;
    }
  });
  let port = 0;
  while (!port) {
    if (saiu) throw new Error('o exe fechou ao abrir');
    if (Date.now() - t0 > 30000) throw new Error('DevToolsActivePort não apareceu');
    try {
      port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10) || 0;
    } catch {}
    if (!port) await wait(10);
  }
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = new Cdp(ver.webSocketDebuggerUrl);
  await cdp.connect();
  const res = { n };
  try {
    // splash: capturada no meio da animação (só na abertura com perfil novo, fora da média)
    if (CAPTURAS && n === 0) {
      const s = await alvo(cdp, /splash\.html/, 5000);
      if (s) {
        await wait(450);
        await captura(cdp, s.targetId, path.join(CAPTURAS, 'splash.png')).catch((e) => (res.erroCapturaSplash = e.message));
        // tema claro/escuro e movimento reduzido emulados na própria abertura
        const varia = [
          ['splash-claro.png', [{ name: 'prefers-color-scheme', value: 'light' }]],
          ['splash-escuro.png', [{ name: 'prefers-color-scheme', value: 'dark' }]],
          ['splash-reduzido.png', [{ name: 'prefers-reduced-motion', value: 'reduce' }]],
        ];
        const { sessionId: ss } = await cdp.send('Target.attachToTarget', { targetId: s.targetId, flatten: true }).catch(() => ({}));
        for (const [nome, features] of ss ? varia : []) {
          try {
            await cdp.send('Emulation.setEmulatedMedia', { features }, ss);
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, ss);
            fs.writeFileSync(path.join(CAPTURAS, nome), Buffer.from(data, 'base64'));
          } catch (e) {
            res.erroCapturaSplash = e.message;
          }
        }
      }
    }
    const pagina = await alvo(cdp, /index\.html/);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pagina.targetId, flatten: true });
    const erros = [];
    cdp.handlers.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') erros.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erros.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    // a 1ª avaliação pode cair no documento inicial (trocado na navegação): repete até valer
    let carregado;
    for (let i = 0; i < 200 && typeof carregado !== 'number'; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: CARREGADO, awaitPromise: true, returnByValue: true }, sessionId).catch(() => null);
      carregado = r && !r.exceptionDetails ? r.result.value : undefined;
      if (typeof carregado !== 'number') await wait(20);
    }
    res.carregado = carregado > 0 ? Math.round(carregado - t0) : 'antes de medir';
    // a janela principal aparece logo depois do sinal (IPC); espera o marco
    for (let i = 0; i < 100 && !('principal-visivel' in marcos); i++) await wait(20);
    await wait(600);
    // linha do tempo da página (ms desde o spawn): navegação, pinturas e performance.mark do src/main.js
    const pg = (await cdp.send('Runtime.evaluate', { expression: TEMPOS_PAGINA, returnByValue: true }, sessionId)).result.value;
    res.pagina = Object.fromEntries(Object.entries(pg.t).map(([k, v]) => [k, Math.round(pg.origem + v - t0)]));
    const { targetInfos } = await cdp.send('Target.getTargets');
    res.splashAindaAberto = targetInfos.some((x) => x.type === 'page' && /splash\.html/.test(x.url));
    // a janela em primeiro plano no Windows é deste processo? (o editor tem que vir para a frente)
    const ps = `Add-Type -Name F -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'; $p = 0; [void][W.F]::GetWindowThreadProcessId([W.F]::GetForegroundWindow(), [ref]$p); $p`;
    const fg = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    res.emFrente = parseInt(fg.stdout, 10) === child.pid;
    res.erros = erros;
    if (CAPTURAS && n === 0) await captura(cdp, pagina.targetId, path.join(CAPTURAS, 'editor.png'));
    // fecha como o X ("Não salvar" se perguntar)
    cdp.send('Browser.close').catch(() => {});
    const tf = Date.now();
    while (!saiu && Date.now() - tf < 15000) {
      await Promise.race([cdp.send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('.modal [data-escolha="nao"]'); if (b) b.click(); return !!b; })()` }, sessionId).catch(() => {}), wait(500)]);
      await Promise.race([exit, wait(200)]);
    }
  } finally {
    cdp.close();
    if (!saiu) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await Promise.race([exit, wait(5000)]);
  }
  res.marcos = marcos;
  const vis = [marcos['splash-visivel'], marcos['principal-visivel']].filter((x) => x !== undefined);
  res.primeiraJanela = Math.min(...vis);
  res.editorPronto = Math.max(marcos['principal-visivel'] ?? 0, typeof res.carregado === 'number' ? res.carregado : 0);
  return res;
}

const profile = tempProfile('forgia-abertura-');
const rodadas = [];
for (let n = 0; n <= VEZES; n++) {
  rodadas.push(await abrir(profile, n));
  await wait(1500);
}
const media = (k) => Math.round(rodadas.slice(1).reduce((s, r) => s + r[k], 0) / VEZES);
const mediaMarco = (k) => {
  const v = rodadas.slice(1).map((r) => r.marcos[k]).filter((x) => x !== undefined);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
const out = {
  exe: EXE,
  perfilNovo: { primeiraJanela: rodadas[0].primeiraJanela, editorPronto: rodadas[0].editorPronto },
  media: {
    primeiraJanela: media('primeiraJanela'),
    editorPronto: media('editorPronto'),
    main: mediaMarco('main'),
    ready: mediaMarco('ready'),
    splashPintou: mediaMarco('splash-pintou'),
    splash: mediaMarco('splash-visivel'),
    principal: mediaMarco('principal-visivel'),
    readyToShow: mediaMarco('ready-to-show'),
    sinalCarregado: mediaMarco('carregado'),
  },
  rodadas,
};
console.log(JSON.stringify(out, null, 2));
if (CAPTURAS) fs.writeFileSync(path.join(CAPTURAS, 'medidas.json'), JSON.stringify(out, null, 2));
fs.rmSync(profile, { recursive: true, force: true });
