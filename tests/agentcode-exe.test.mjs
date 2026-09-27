// Integração com o Agent Code no exe gerado (perfil temporário), contra o Agent Code FALSO na faixa
// de teste 47450–47489 (FORGIA_AGENTCODE_PORTAS; tests/agentcode-falso.mjs). O "agente" do falso sobe o servidor MCP que o
// Forgia mandou em mcp_servers.forgia e chama as ferramentas forgia_* de verdade: a peça muda no
// Forgia aberto. O Agent Code de verdade ainda não tem esse servidor: o teste de ponta a ponta com
// o Claude depende dele.
// FORGIA_EXE=release\regua\win-unpacked\Forgia.exe node --test tests/agentcode-exe.test.mjs
// Capturas em %TEMP%\forgia-agentcode-shots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Forgia, exePath, tempProfile, wait, readClipboardText, writeClipboardText } from './forgia-exe.mjs';
import { fakeAgentCode, mcpStdio, TOKEN } from './agentcode-falso.mjs';

const exe = exePath();
const shots = path.join(os.tmpdir(), 'forgia-agentcode-shots');
// faixa só do teste (FORGIA_AGENTCODE_PORTAS): roda mesmo com o Agent Code de verdade aberto na 47110–47149
const FAIXA = { de: 47450, ate: 47489 };
const ENV = { FORGIA_AGENTCODE_PORTAS: `${FAIXA.de}-${FAIXA.ate}` };

// algo já responde na faixa do teste? então o teste não pode usar a faixa
const rangeBusy = () =>
  Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      new Promise((r) => {
        const req = http.get({ host: '127.0.0.1', port: FAIXA.de + i, path: '/agent-code', timeout: 300 }, (res) => (res.resume(), r(true)));
        req.on('timeout', () => req.destroy());
        req.on('error', () => r(false));
      }),
    ),
  ).then((a) => a.some(Boolean));

// o "agente": faz o pedido pelas ferramentas forgia_* do servidor recebido
async function executor(args, task) {
  const f = mcpStdio(args.mcp_servers.forgia);
  await f.init();
  try {
    const pedido = args.prompt.split('Pedido do usuário:\n')[1] || '';
    if (/demorad/.test(pedido)) {
      while (!task.cancelada) await wait(100);
      return null;
    }
    if (/Marcação 1/.test(pedido)) {
      const r = await f.call('forgia_marcacoes', {});
      const m = (r.marcacoes || r)[0];
      await f.call('forgia_alterar', { id: m.parte.id, esticar: { lado: m.lado_da_parte, mm: 2 } });
      return 'Aumentei a aba em 2 mm.';
    }
    await f.call('forgia_lote', { comandos: [{ cmd: 'criar', tipo: 'caixa', nome: 'caixa da IA', medidas: [30, 30, 10] }] });
    return 'Criei uma caixa de 30 × 30 × 10 mm.';
  } finally {
    f.close();
  }
}

async function key(app, k, code, vk) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : k.length === 1 ? k : undefined });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await wait(120);
}

test('integração com o Agent Code no exe', { skip: !exe && 'defina FORGIA_EXE', timeout: 300000 }, async (t) => {
  if (await rangeBusy()) return t.skip(`já há algo respondendo em ${FAIXA.de}–${FAIXA.ate}`);
  const profile = tempProfile('forgia-agentcode-');
  const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'agent-code.json'), 'utf8'));
  let app = await Forgia.open(exe, profile, { env: ENV });
  let fake = null;
  const clipboard = readClipboardText();
  const center = (sel) => app.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const clickAt = async (c) => {
    await app.mouse('mouseMoved', c.x, c.y);
    await app.mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 });
    await app.mouse('mouseReleased', c.x, c.y, { button: 'left', buttons: 0, clickCount: 1 });
    await wait(200);
  };
  const click = async (sel) => clickAt(await center(sel));
  // o Conectar IA fica dentro da conversa do botão "Pedir à IA"
  const abrirConectar = async () => {
    if (!(await app.js("!!document.querySelector('.ia-chat:not([hidden])')"))) await click('#sb-pedir');
    await click('.ia-chat [data-ia="conectar"]');
  };
  const shot = (n) => app.screenshot(path.join(shots, n + '.png'));
  const estadoTexto = () => app.js(`(() => { const e = document.querySelector('.modal .ac-estado'); return e ? { estado: e.dataset.estado, texto: e.textContent } : null; })()`);
  const conversaAberta = () => app.js(`!document.querySelector('.ia-chat').hidden`);
  const ferramenta = () => app.js('forgia.editor.tool ? forgia.editor.tool.name : null');
  // pedido pela conversa do botão "Pedir à IA"
  const pedir = async (texto) => {
    if (!(await conversaAberta())) await click('#sb-pedir');
    await click('.ia-chat textarea');
    await app.send('Input.insertText', { text: texto });
    await key(app, 'Enter', 'Enter', 13);
  };
  // a última resposta da IA na conversa
  const tarefa = () => app.js(`(() => { const l = document.querySelectorAll('.ia-chat .ia-msg.ia'); const e = l[l.length - 1]; return e ? { status: e.dataset.status, texto: e.textContent } : null; })()`);
  const untilTask = async (status, ms = 30000, ler = tarefa) => {
    const t0 = Date.now();
    for (;;) {
      const s = await ler();
      if (s && s.status === status) return s;
      if (Date.now() - t0 > ms) throw new Error(`tarefa não chegou a ${status}: ${JSON.stringify(s)}`);
      await wait(150);
    }
  };
  const balao = () => app.js(`(() => { const e = document.querySelector('.pin-balao'); return e ? { status: e.dataset.status, texto: e.textContent } : null; })()`);
  const objetos = () => app.js('forgia.editor.objects.map((o) => o.name)');
  const screen = (p) => app.js(`(() => { const ed = forgia.editor; const c = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(new (ed.camera.position.constructor)(${p.join(',')})); return { x: c.x + s.x, y: c.y + s.y }; })()`);
  const marcas = () => app.js('forgia.editor.marks.map((m) => m.n)');
  try {
    await t.test('ao abrir: convite para pedir à IA; sem botão de Conectar IA na barra nem Marcar em cima', async () => {
      await app.waitFor("!!document.querySelector('.ia-convite')", 3000, 'convite');
      assert.match(await app.js("document.querySelector('.ia-convite').textContent"), /Peça para a IA/);
      assert.equal(await app.js("!!document.getElementById('btn-conectar-ia')"), false);
      assert.equal(await app.js(`!!document.querySelector('#toolbar [data-cmd="mark"], .toolbar [data-cmd="mark"]')`), false);
      await shot('00-convite');
      // parar o mouse no Pedir à IA: o cartão com o vídeo do pedido (e a conversa ainda fechada)
      const p = await center('#sb-pedir');
      await app.mouse('mouseMoved', p.x, p.y);
      await app.waitFor(`(() => { const v = document.querySelector('.dica.aberta video'); return !!v && /pedir-(claro|escuro)\.webm/.test(v.src); })()`, 3000, 'vídeo do Pedir à IA');
      await app.waitFor("(() => { const v = document.querySelector('.dica.aberta video'); return !!v && v.readyState >= 2 && !v.paused; })()", 5000, 'vídeo do Pedir à IA tocando');
      await shot('00b-dica-pedir');
      await app.mouse('mouseMoved', 5, 5);
    });

    await t.test('Agent Code fechado: "não encontrado" em menos de 1 s, sem travar a tela', async () => {
      await abrirConectar();
      assert.equal(await app.js("!!document.querySelector('.ia-convite')"), false, 'o convite some ao abrir a conversa');
      await app.waitFor("!!document.querySelector('.modal .conectar-agentcode')", 3000, 'Conectar IA');
      assert.equal(await app.js(`document.querySelector('.modal [data-agente="agentcode"]').getAttribute('aria-pressed')`), 'true', 'abre na opção Agent Code');
      // mede do clique em Integrar até o estado, contando quadros no meio (a tela não trava)
      await app.js(`(window.__q = 0, (function f() { window.__q++; requestAnimationFrame(f); })(), true)`);
      const t0 = Date.now();
      await click('.modal [data-agentcode="integrar"]');
      await app.waitFor(`document.querySelector('.modal .ac-estado').dataset.estado === 'ausente'`, 1500, 'não encontrado');
      const ms = Date.now() - t0;
      const q = await app.js('window.__q');
      assert.ok(ms < 1000, `${ms} ms`);
      assert.ok(q >= 10, `${q} quadros enquanto procurava`);
      const s = await estadoTexto();
      assert.match(s.texto, /Agent Code não encontrado/);
      assert.ok(await app.js(`[...document.querySelectorAll('.modal .conectar-agentcode a')].some((a) => a.href === 'https://github.com/MatheusLarcher/agent-code' && a.target === '_blank')`), 'link de download');
      await shot('01-nao-encontrado');
    });

    await t.test('texto da opção Agent Code: o que é, vantagem, o que exige e links', async () => {
      // cada aba tem o vídeo tutorial de como conectar (o Cursor ainda não)
      const tutorial = () => app.js(`(() => { const v = document.querySelector('.modal .conectar-tutorial:not([hidden]) video'); return v ? v.getAttribute('src') : null; })()`);
      const doTema = (base) => new RegExp(`^\\./ajuda/${base}-(claro|escuro)\\.webm$`);
      assert.match(await tutorial(), doTema('conectar-agentcode'));
      await app.waitFor("(() => { const v = document.querySelector('.modal .conectar-tutorial video'); return !!v && v.readyState >= 2 && !v.paused; })()", 5000, 'vídeo do Agent Code tocando');
      await shot('01b-conectar-agentcode-video');
      const txt = await app.js(`document.querySelector('.modal .conectar-agentcode').innerText`);
      for (const must of [/app para Windows, em português/, /sem terminal/, /Pedir à IA/, /aqui mesmo no Forgia/, /sem copiar e colar/, /plano pago/, /Pro ou Max/, /Baixar o Agent Code/]) assert.match(txt, must);
      const hrefs = await app.js(`[...document.querySelectorAll('.modal .conectar-agentcode a')].map((a) => a.href)`);
      assert.ok(hrefs.includes('https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan'));
      // Claude (opção "Claude", o Claude Code) continua com o texto para colar, com a explicação em dois parágrafos
      assert.equal(await app.js(`document.querySelector('.modal [data-agente="claudecode"]').textContent`), 'Claude');
      await click('.modal [data-agente="claudecode"]');
      assert.match(await app.js(`document.querySelector('.modal .conectar-texto').value`), /claude mcp add/);
      assert.equal(await app.js(`document.querySelector('.modal .conectar-agentcode').hidden`), true);
      const explica = await app.js(`[...document.querySelectorAll('.modal .conectar-explica p')].map((p) => p.textContent)`);
      assert.equal(explica.length, 2);
      assert.match(explica[0], /^Escolha o seu agente de IA, copie o texto e cole numa conversa com ele\. O agente instala o servidor MCP do Forgia/);
      assert.match(explica[1], /Cole o texto de novo/);
      await shot('02a-conectar-claude');
      assert.match(await tutorial(), doTema('conectar-claude'));
      for (const [a, base] of [['codex', 'conectar-codex'], ['cursor', null], ['generico', 'conectar-outro']]) {
        await click(`.modal [data-agente="${a}"]`);
        const got = await tutorial();
        if (base) assert.match(got, doTema(base), a);
        else assert.equal(got, null, 'Cursor ainda sem vídeo');
      }
      await click('.modal [data-agente="claudecode"]');
      await click('.modal [data-agente="agentcode"]');
    });

    await t.test('sem conta Claude: "Abra o Agent Code e entre na sua conta Claude"', async () => {
      fake = await fakeAgentCode({ porta: 47457, pronto: false, motivo: 'login' });
      await click('.modal [data-agentcode="integrar"]');
      await app.waitFor(`document.querySelector('.modal .ac-estado').dataset.estado === 'login'`, 2000, 'login');
      assert.match((await estadoTexto()).texto, /entre na sua conta Claude/);
      await shot('02-login');
      await fake.close();
    });

    await t.test('Integrar: estado "Integrado" e a porta salva', async () => {
      fake = await fakeAgentCode({ porta: 47453, executor });
      await click('.modal [data-agentcode="integrar"]');
      await app.waitFor(`document.querySelector('.modal .ac-estado').dataset.estado === 'integrado'`, 2000, 'integrado');
      assert.match((await estadoTexto()).texto, /Integrado \(Agent Code 9\.9\.9\)/);
      assert.deepEqual(saved(), { porta: 47453, integrado: true });
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
        await wait(200);
        await shot(`03-integrado-${tema}`);
      }
      await app.js(`forgia.theme.set('claro'), true`);
      await click('.modal .modal-actions .btn');
    });

    await t.test('"Pedir à IA": o botão abre a conversa (com o Marcar e o Conectar IA); a peça aparece, com o aviso e um desfazer', async () => {
      assert.equal(await app.js(`document.getElementById('sb-pedir').textContent`), 'Pedir à IA');
      assert.equal(await app.js(`!!document.querySelector('#sb-pedir input, #sb-pedido-texto')`), false, 'sem caixa de texto na barra');
      await click('#sb-pedir');
      assert.equal(await conversaAberta(), true);
      assert.equal(await ferramenta(), null, 'a conversa não liga o marcador sozinha');
      assert.match(await app.js(`document.querySelector('.ia-chat').textContent`), /use o Marcar, aqui em cima/);
      assert.equal(await app.js(`document.querySelector('.ia-chat [data-ia="marcar"]').dataset.dica`), 'mark', 'a dica animada do marcador vem junto');
      // parar o mouse sobre o Marcar abre o cartão com o vídeo do marcador (o mesmo da barra, antes)
      const m = await center('.ia-chat [data-ia="marcar"]');
      await app.mouse('mouseMoved', m.x, m.y);
      await app.waitFor(`(() => { const v = document.querySelector('.dica.com-video video'); return !!v && /mark-(claro|escuro)\.webm/.test(v.src); })()`, 3000, 'vídeo do Marcar');
      await shot('04b-dica-marcar');
      await app.mouse('mouseMoved', 5, 5);
      await shot('04a-conversa-vazia');
      const h0 = await app.js('forgia.editor.historyIndex');
      await pedir('faça uma caixa de 30 mm');
      assert.equal(await app.js(`document.getElementById('sb-pedir').textContent`), 'IA trabalhando…');
      await untilTask('rodando', 5000).catch(() => null);
      await shot('04-rodando');
      const fim = await untilTask('concluida');
      assert.match(fim.texto, /Criei uma caixa de 30 × 30 × 10 mm/);
      assert.ok((await objetos()).includes('caixa da IA'));
      assert.equal(await app.js('forgia.editor.historyIndex'), h0 + 1, 'um passo de desfazer');
      assert.ok(await app.js(`!!document.querySelector('.ia-canto .ia-aviso')`), 'aviso "IA: criou…"');
      assert.equal(await app.js(`document.querySelector('.ia-chat textarea').value`), '', 'campo limpo');
      const msgs = await app.js(`[...document.querySelectorAll('.ia-chat .ia-msg')].map((e) => e.className.split(' ').pop() + ':' + e.textContent)`);
      assert.deepEqual(msgs, ['voce:faça uma caixa de 30 mm', 'ia:Criei uma caixa de 30 × 30 × 10 mm.']);
      await wait(1100); // o botão volta a "Pedir à IA" (a tarefa terminou)
      assert.equal(await app.js(`document.getElementById('sb-pedir').textContent`), 'Pedir à IA');
      await shot('05-concluida');
      const call = fake.log.filter((r) => r.rpc && r.rpc.params && r.rpc.params.name === 'agent_code_enviar').pop().rpc.params.arguments;
      assert.equal(call.cliente, 'Forgia');
      assert.equal(call.projeto, path.join(profile, 'agente'));
      assert.deepEqual(call.mcp_servers.forgia.env, { ELECTRON_RUN_AS_NODE: '1', FORGIA_DADOS: profile });
      assert.equal(call.conversa_id, undefined, 'primeiro pedido abre conversa');
      assert.ok(fake.log.every((r) => !r.headers.origin), 'nada com Origin: tudo do main');
    });

    await t.test('clicar fora da conversa fecha e desliga o marcador', async () => {
      await click('#sb-coords');
      assert.equal(await conversaAberta(), false);
      assert.equal(await ferramenta(), null);
      // reabre com a conversa guardada; o × também fecha e desliga
      await click('#sb-pedir');
      assert.equal(await app.js(`document.querySelectorAll('.ia-chat .ia-msg').length`), 2, 'a conversa continua');
      await click('.ia-chat-fechar');
      assert.equal(await conversaAberta(), false);
      assert.equal(await ferramenta(), null);
    });

    const frente = [0, 5, 15.01]; // frente da caixa (+z interno = −Y do usuário)
    await t.test('Marcar parte: Enter envia; o balão do alfinete mostra o andamento e o que a IA fez', async () => {
      const before = await app.js(`forgia.editor.objects.find((o) => o.name === 'caixa da IA').size`);
      await app.js('(forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)');
      await wait(800);
      await app.mouse('mouseMoved', 5, 5);
      // o Marcar da conversa liga o marcador (a tecla N também)
      await click('#sb-pedir');
      await click('.ia-chat [data-ia="marcar"]');
      assert.equal(await ferramenta(), 'mark');
      assert.equal(await app.js(`document.querySelector('.ia-chat [data-ia="marcar"]').getAttribute('aria-pressed')`), 'true');
      const p = await screen(frente);
      for (let i = 0; i < 3; i++) await app.mouse('mouseMoved', p.x + i, p.y);
      await clickAt({ x: p.x + 2, y: p.y });
      assert.equal(await app.js(`document.querySelector('.marca-chat [data-marca="enviar"]')?.textContent`), 'Enviar à IA');
      assert.equal(await app.js(`document.querySelector('.marca-chat [data-marca="excluir"]')?.textContent`), 'Excluir marcador');
      assert.match(await app.js(`document.querySelector('.marca-chat textarea').placeholder`), /Enter envia à IA/);
      await app.js('document.querySelector(".marca-chat textarea").focus(), true');
      await app.send('Input.insertText', { text: 'aumenta essa face em 2 mm' });
      await key(app, 'Enter', 'Enter', 13);
      assert.equal(await app.js('!!document.querySelector(".marca-chat")'), false, 'mini-chat fecha ao enviar');
      assert.equal(await ferramenta(), null, 'o marcador desliga ao enviar');
      await app.waitFor(`!!document.querySelector('.pin-balao')`, 2000, 'balão do alfinete');
      assert.match((await balao()).texto, /A IA está trabalhando/);
      await shot('05a-balao-trabalhando');
      const fim = await untilTask('concluida', 30000, balao);
      assert.match(fim.texto, /A IA terminou: Aumentei a aba em 2 mm\./);
      const after = await app.js(`forgia.editor.objects.find((o) => o.name === 'caixa da IA').size`);
      assert.equal(Math.round((after[2] - before[2]) * 100) / 100, 2, `${before} -> ${after}`);
      const prompt = fake.log.filter((r) => r.rpc && r.rpc.params && r.rpc.params.name === 'agent_code_enviar').pop().rpc.params.arguments;
      assert.match(prompt.prompt, /Marcação 1:.*\n[\s\S]*forgia-pedido/);
      assert.ok(prompt.conversa_id, 'segundo pedido do mesmo projeto continua a conversa');
      await shot('05b-balao-terminou');
      // o pedido do alfinete também entra na conversa
      await click('#sb-pedir');
      const msgs = await app.js(`[...document.querySelectorAll('.ia-chat .ia-msg')].map((e) => e.textContent)`);
      assert.deepEqual(msgs.slice(-2), ['Marcação 1aumenta essa face em 2 mm', 'Aumentei a aba em 2 mm.']);
      // resumido; o clique expande e mostra a referência da parte que foi para a IA
      assert.equal(await app.js(`!!document.querySelector('.ia-chat .ia-msg-detalhe')`), false);
      await click('.ia-chat .ia-msg.marcacao');
      assert.match(await app.js(`document.querySelector('.ia-chat .ia-msg-detalhe').textContent`), /^Marcação 1: Caixa 'caixa da IA'/);
      await shot('05d-conversa-marcacao-aberta');
      await click('.ia-chat-fechar');
      await click('.pin-balao [data-balao="fechar"]');
      assert.equal(await balao(), null);
    });

    await t.test('com o mini-chat aberto, clicar noutra parte só desliga (não põe outro alfinete)', async () => {
      await key(app, 'n', 'KeyN', 78);
      const p = await screen([0, 5, 15.01]);
      await clickAt({ x: p.x - 12, y: p.y });
      assert.deepEqual(await marcas(), [1, 2]);
      assert.equal(await app.js('!!document.querySelector(".marca-chat")'), true);
      await clickAt({ x: p.x + 12, y: p.y + 6 }); // outro ponto da peça
      assert.deepEqual(await marcas(), [1, 2], 'nenhum alfinete a mais');
      assert.equal(await app.js('!!document.querySelector(".marca-chat")'), false);
      assert.equal(await ferramenta(), null);
      // marcador ligado sem mini-chat: clicar fora da peça também desliga, sem alfinete
      await key(app, 'n', 'KeyN', 78);
      await clickAt(await app.js(`(() => { const r = forgia.editor.renderer.domElement.getBoundingClientRect(); return { x: r.x + r.width - 80, y: r.y + r.height - 50 }; })()`));
      assert.deepEqual(await marcas(), [1, 2]);
      assert.equal(await ferramenta(), null);
    });

    await t.test('Excluir marcador tira só aquele alfinete', async () => {
      await click('.pin:nth-child(2)');
      assert.match(await app.js(`document.querySelector('.marca-chat').textContent`), /Marcação 2/);
      await click('.marca-chat [data-marca="excluir"]');
      assert.deepEqual(await marcas(), [1]);
      assert.equal(await app.js(`document.querySelectorAll('.pin').length`), 1);
    });

    await t.test('Copiar: o balão do alfinete diz para colar na IA', async () => {
      await click('.pin');
      await click('.marca-chat [data-marca="copiar"]');
      await app.waitFor(`!!document.querySelector('.pin-balao')`, 3000, 'balão de copiado');
      assert.match((await balao()).texto, /Pedido copiado! Cole numa conversa com a sua IA \(Claude, Codex…\)/);
      assert.match(readClipboardText(), /forgia-pedido/);
      assert.equal(await app.js('!!document.querySelector(".marca-chat")'), false, 'mini-chat fecha ao copiar');
      await shot('05c-balao-copiado');
      await app.js('(forgia.editor.clearMarks(), true)');
      assert.equal(await balao(), null, 'limpar marcações tira o balão');
    });

    await t.test('Agent Code reiniciado noutra porta: o próximo pedido funciona sozinho', async () => {
      await fake.close();
      fake = await fakeAgentCode({ porta: 47471, executor });
      await pedir('faça outra caixa de 30 mm');
      await untilTask('concluida');
      assert.equal(saved().porta, 47471);
      assert.equal((await objetos()).filter((n) => n === 'caixa da IA').length, 2);
    });

    await t.test('Cancelar interrompe a tarefa', async () => {
      await pedir('uma peça demorada');
      await untilTask('rodando');
      await click('.ia-chat [data-tarefa="cancelar"]');
      const fim = await untilTask('cancelada', 8000);
      assert.match(fim.texto, /Cancelado/);
      assert.equal([...fake.tasks.values()].pop().status, 'cancelada');
      await shot('06-cancelada');
    });

    await t.test('Agent Code sem responder por um tempo: a tarefa continua e avisa', async () => {
      await pedir('uma peça demorada');
      await untilTask('rodando');
      const last = `(() => { const l = document.querySelectorAll('.ia-chat .ia-msg.ia'); return l[l.length - 1].textContent; })()`;
      fake.falhar.add('agent_code_tarefa');
      await app.waitFor(`/não está respondendo/.test(${last})`, 5000, 'aviso de sem resposta');
      assert.equal((await tarefa()).status, 'rodando');
      await shot('06a-sem-resposta');
      fake.falhar.delete('agent_code_tarefa');
      await app.waitFor(`!/não está respondendo/.test(${last})`, 5000, 'aviso some');
      assert.equal((await tarefa()).status, 'rodando');
      // cancelar que falha: avisa e a tarefa segue; de novo, cancela
      fake.falhar.add('agent_code_cancelar');
      await click('.ia-chat [data-tarefa="cancelar"]');
      await app.waitFor(`/Não deu para cancelar/.test(${last})`, 3000, 'aviso de não cancelou');
      assert.equal((await tarefa()).status, 'rodando');
      assert.equal(await app.js(`document.querySelector('.ia-chat [data-tarefa="cancelar"]').disabled`), false);
      fake.falhar.delete('agent_code_cancelar');
      await click('.ia-chat [data-tarefa="cancelar"]');
      await untilTask('cancelada', 8000);
    });

    const novoProjeto = async () => {
      await app.js('(forgia.arquivo.newProject(), true)');
      await wait(400);
      if (await app.js(`!!document.querySelector('.modal [data-escolha="nao"]')`)) await click('.modal [data-escolha="nao"]');
      await wait(300);
    };

    await t.test('outro projeto aberto com pedido rodando: cancela a tarefa', async () => {
      await pedir('uma peça demorada');
      await untilTask('rodando');
      await novoProjeto();
      if (!(await conversaAberta())) await click('#sb-pedir');
      const fim = await untilTask('cancelada', 8000);
      assert.match(fim.texto, /Outro projeto foi aberto/);
      assert.equal([...fake.tasks.values()].pop().status, 'cancelada');
      assert.equal(await app.js(`document.querySelectorAll('.ia-chat .ia-msg').length`), 2, 'conversa nova: só o pedido cancelado');
      await shot('06b-cancelada-projeto');
    });

    await t.test('outro projeto aberto enquanto o pedido ainda ia: cancela quando ele chega', async () => {
      fake.demoraEnviarMs = 1500;
      const n = fake.tasks.size;
      await pedir('uma peça demorada');
      assert.equal((await tarefa()).status, 'enviando');
      await novoProjeto();
      if (!(await conversaAberta())) await click('#sb-pedir');
      const fim = await untilTask('cancelada', 8000);
      fake.demoraEnviarMs = 0;
      assert.match(fim.texto, /Outro projeto foi aberto/);
      assert.equal(fake.tasks.size, n + 1);
      assert.equal([...fake.tasks.values()].pop().status, 'cancelada');
    });

    await t.test('Novo projeto começa conversa nova', async () => {
      await novoProjeto();
      await pedir('faça uma caixa de 30 mm');
      await untilTask('concluida');
      const call = fake.log.filter((r) => r.rpc && r.rpc.params && r.rpc.params.name === 'agent_code_enviar').pop().rpc.params.arguments;
      assert.equal(call.conversa_id, undefined);
      assert.equal(await app.js(`document.querySelectorAll('.ia-chat .ia-msg').length`), 2);
    });

    await t.test('o renderer não vê token, porta nem URL', async () => {
      const r = await app.js(`(async () => {
        const api = window.forgiaAgentCode;
        const out = JSON.stringify([Object.keys(api), await api.estado()]);
        const html = document.documentElement.outerHTML;
        return { keys: Object.keys(api), out, html: html.includes(${JSON.stringify(TOKEN)}) || html.includes('47471') };
      })()`);
      assert.deepEqual(r.keys.sort(), ['cancelar', 'desligar', 'enviar', 'estado', 'integrar', 'tarefa']);
      assert.ok(!r.out.includes(TOKEN) && !r.out.includes('47471') && !r.out.includes('127.0.0.1'), r.out);
      assert.equal(r.html, false);
    });
    assert.deepEqual(app.console.filter((m) => /exceção/i.test(m)), []);
  } finally {
    await app.close();
    writeClipboardText(clipboard);
  }

  // fechar e reabrir: continua integrado, sem varredura (a porta salva responde)
  const before = fake.log.length;
  app = await Forgia.open(exe, profile, { env: ENV });
  try {
    await app.waitFor('forgia.agentCode.estado && forgia.agentCode.estado.estado === "integrado"', 5000, 'integrado ao reabrir');
    assert.equal(await app.js("!!document.querySelector('.ia-convite')"), false, 'o convite não volta depois de usada a conversa');
    assert.equal(fake.log.slice(before).filter((r) => r.url === '/agent-code').length, 1, 'só a porta salva');
    // Agent Code fechado: o pedido avisa, sem travar
    await fake.close();
    fake = null;
    await pedir('faça uma caixa');
    const fim = await untilTask('erro', 5000);
    assert.match(fim.texto, /Agent Code não encontrado/);
    await app.screenshot(path.join(shots, '07-fechado.png'));
  } finally {
    await app.close();
    if (fake) await fake.close();
  }
});
