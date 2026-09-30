// Conversa feita direto no agente (forgia_conversa e a atividade da ponte) no exe GERADO, com perfil
// temporário: pelo MCP stdio do próprio exe, o chat "Pedir à IA" mostra o pedido, o que a IA fez
// na peça e a resposta; fechar e reabrir mantém; atividade sem pedido vira balão; ponto no botão
// com a conversa fechada; pedido sem resposta fecha sozinho; Novo projeto limpa; erro de args
// volta isError com exemplo; com uma tarefa do próprio Forgia rodando (Agent Code falso, faixa de
// teste 47490–47529) nada se duplica; recarregar a janela (F5) volta vazio e segue funcionando.
// FORGIA_EXE=release\conversa\win-unpacked\Forgia.exe node --test tests/conversa-exe.test.mjs
// Capturas em release\conversa-evidencias (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Forgia, McpClient, exePath, tempProfile, wait, ROOT } from './forgia-exe.mjs';
import { fakeAgentCode, mcpStdio } from './agentcode-falso.mjs';

const exe = exePath();
const OUT = path.join(ROOT, 'release', 'conversa-evidencias');
const FAIXA = { de: 47490, ate: 47529 };
const ENV = { FORGIA_AGENTCODE_PORTAS: `${FAIXA.de}-${FAIXA.ate}` };

const rangeBusy = () =>
  Promise.all(
    Array.from({ length: FAIXA.ate - FAIXA.de + 1 }, (_, i) =>
      new Promise((r) => {
        const req = http.get({ host: '127.0.0.1', port: FAIXA.de + i, path: '/agent-code', timeout: 300 }, (res) => (res.resume(), r(true)));
        req.on('timeout', () => req.destroy());
        req.on('error', () => r(false));
      }),
    ),
  ).then((a) => a.some(Boolean));

async function key(app, k, code, vk) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : undefined });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await wait(120);
}

test('conversa feita direto no agente aparece no chat do Forgia (exe)', { skip: !exe && 'defina FORGIA_EXE', timeout: 300000 }, async (t) => {
  if (await rangeBusy()) return t.skip(`já há algo respondendo em ${FAIXA.de}–${FAIXA.ate}`);
  fs.mkdirSync(OUT, { recursive: true });
  const profile = tempProfile('forgia-conversa-');
  const app = await Forgia.open(exe, profile, { env: ENV });
  const mcp = new McpClient(exe, profile);
  let fake = null;
  const resultados = {};
  const center = (sel) => app.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const click = async (sel) => {
    const c = await center(sel);
    await app.mouse('mouseMoved', c.x, c.y);
    await app.mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 });
    await app.mouse('mouseReleased', c.x, c.y, { button: 'left', buttons: 0, clickCount: 1 });
    await wait(200);
  };
  const shot = (n) => app.screenshot(path.join(OUT, n + '.png'));
  const aberta = () => app.js(`!document.querySelector('.ia-chat').hidden`);
  const abrir = async () => {
    if (!(await aberta())) await click('#sb-pedir');
    assert.equal(await aberta(), true);
    await app.mouse('mouseMoved', 5, 5); // sem o cartão de dica por cima
  };
  const fechar = async () => {
    if (await aberta()) await click('.ia-chat-fechar');
    assert.equal(await aberta(), false);
  };
  // os balões da conversa, como o usuário vê
  const msgs = () =>
    app.js(`[...document.querySelectorAll('.ia-chat .ia-msg')].map((e) => ({
      de: e.classList.contains('voce') ? 'voce' : 'ia',
      externo: e.classList.contains('externo'),
      status: e.dataset.status || null,
      origem: e.querySelector('.ia-msg-origem')?.textContent || null,
      atividades: [...e.querySelectorAll('.ia-msg-atividades li')].map((l) => l.textContent),
      texto: e.textContent,
    }))`);
  const ultima = async () => (await msgs()).pop();
  const novidade = () => app.js(`(() => { const b = document.getElementById('sb-pedir'); return { ponto: b.classList.contains('novidade'), aria: b.getAttribute('aria-label'), texto: b.textContent }; })()`);
  const hist = () => app.js('forgia.editor.historyIndex');
  const init = async (c) => {
    await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste-conversa', version: '1' } });
    c.notify('notifications/initialized');
  };
  const call = async (name, args) => {
    const r = await mcp.call(name, args);
    const text = r.content.find((c) => c.type === 'text').text;
    return { isError: !!r.isError, json: JSON.parse(text) };
  };
  const conversa = (args) => call('forgia_conversa', args);
  const novoProjeto = async () => {
    await app.js('(forgia.arquivo.newProject(), true)');
    await wait(400);
    if (await app.js(`!!document.querySelector('.modal [data-escolha="nao"]')`)) await click('.modal [data-escolha="nao"]');
    await wait(300);
  };
  try {
    await init(mcp);

    await t.test('tools/list do exe tem forgia_conversa (25 ferramentas)', async () => {
      const list = await mcp.request('tools/list', {});
      const names = list.result.tools.map((x) => x.name);
      assert.equal(names.length, 25);
      assert.ok(names.includes('forgia_conversa'));
    });

    await t.test('estado vazio: a conversa abre sem mensagens', async () => {
      await abrir();
      assert.deepEqual(await msgs(), []);
      assert.ok(await app.js(`!!document.querySelector('.ia-chat .ia-chat-vazio')`));
      await shot('01-vazio');
    });

    let caixa;
    await t.test('pedido -> lote -> resposta: o chat aberto mostra os 3, sem passo de desfazer a mais', async () => {
      const h0 = await hist();
      const r1 = await conversa({ pedido: 'faça uma caixa de 30 mm' });
      assert.equal(r1.isError, false, JSON.stringify(r1.json));
      assert.deepEqual(r1.json, { ok: true, chat: 'mostrado' });
      assert.equal(await hist(), h0, 'forgia_conversa não vira passo de desfazer');
      let m = await msgs();
      assert.equal(m.length, 2);
      assert.deepEqual([m[0].de, m[0].externo, m[0].origem], ['voce', true, 'Pelo agente']);
      assert.match(m[0].texto, /faça uma caixa de 30 mm$/);
      assert.deepEqual([m[1].de, m[1].externo, m[1].status], ['ia', true, 'rodando']);
      assert.match(m[1].texto, /A IA está trabalhando pelo agente/);
      await shot('02-pedido');
      const r2 = await call('forgia_lote', { comandos: [{ cmd: 'criar', tipo: 'caixa', nome: 'caixa do agente', medidas: [30, 30, 10] }] });
      assert.equal(r2.isError, false);
      caixa = r2.json.criados[0];
      await app.waitFor(`(() => { const l = document.querySelectorAll('.ia-chat .ia-msg-atividades li'); return l.length === 1 && l[0].textContent === 'IA: criou 1'; })()`, 3000, 'atividade no balão');
      assert.equal((await ultima()).status, 'rodando', 'segue em andamento até a resposta');
      await shot('03-atividade');
      const r3 = await conversa({ resposta: 'Criei uma caixa de **30 × 30 × 10 mm**, apoiada na mesa.' });
      assert.deepEqual(r3.json, { ok: true, chat: 'mostrado' });
      m = await msgs();
      assert.equal(m.length, 2, 'a resposta conclui o mesmo balão');
      assert.equal(m[1].status, 'concluida');
      assert.deepEqual(m[1].atividades, ['IA: criou 1']);
      assert.match(m[1].texto, /Criei uma caixa de 30 × 30 × 10 mm, apoiada na mesa\.$/);
      assert.equal(await app.js(`document.querySelector('.ia-chat .ia-msg.externo.ia strong')?.textContent`), '30 × 30 × 10 mm', 'markdown da resposta');
      assert.equal(await hist(), h0 + 1, 'só o lote virou passo');
      assert.equal((await novidade()).ponto, false, 'com a conversa aberta, sem ponto no botão');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
        await wait(200);
        await shot(`04-resposta-${tema}`);
      }
      await app.js(`forgia.theme.set('claro'), true`);
      resultados.pedidoAtividadeResposta = m;
    });

    await t.test('fechar e reabrir a conversa mantém as mensagens (× e clique fora)', async () => {
      const antes = await msgs();
      await fechar();
      await abrir();
      assert.deepEqual(await msgs(), antes);
      await click('#sb-coords'); // clique fora fecha
      assert.equal(await aberta(), false);
      await abrir();
      assert.deepEqual(await msgs(), antes);
    });

    await t.test('atividade sem pedido vira balão; com a conversa fechada, o ponto acende no botão', async () => {
      await fechar();
      assert.equal((await novidade()).ponto, false);
      const r = await call('forgia_criar', { tipo: 'cilindro', medidas: [10, 10, 20], centro: [40, 0, null] });
      assert.equal(r.isError, false);
      await app.waitFor(`document.getElementById('sb-pedir').classList.contains('novidade')`, 3000, 'ponto no botão');
      const nv = await novidade();
      assert.equal(nv.texto, 'Pedir à IA', 'o texto do botão não muda');
      assert.match(nv.aria, /mensagem nova/);
      await shot('05-ponto-no-botao');
      await call('forgia_desfazer', {});
      await abrir();
      assert.equal((await novidade()).ponto, false, 'abrir apaga o ponto');
      const m = await msgs();
      assert.equal(m.length, 3);
      assert.deepEqual({ ...m[2], texto: undefined }, { de: 'ia', externo: true, status: 'concluida', origem: 'Pelo agente', atividades: ['IA: criou 1', 'IA: desfez o último passo'], texto: undefined });
      await shot('06-atividade-sem-pedido');
      // parada há mais que o tempo de juntar: a próxima atividade abre outro balão
      await app.js('(forgia.pedidoIA.juntarMs = 300, true)');
      await wait(500);
      await call('forgia_refazer', {});
      await app.js('(forgia.pedidoIA.juntarMs = 60000, true)');
      const m2 = await msgs();
      assert.equal(m2.length, 4);
      assert.deepEqual(m2[3].atividades, ['IA: refez o passo desfeito']);
    });

    await t.test('pedido sem resposta fecha sozinho mostrando o que a IA fez', async () => {
      await app.js('(forgia.pedidoIA.turnoMs = 1500, true)');
      try {
        await conversa({ pedido: 'gire a caixa 45 graus' });
        await call('forgia_alterar', { id: caixa, rotacao: [0, 0, 45] });
        assert.equal((await ultima()).status, 'rodando');
        await app.waitFor(`(() => { const l = document.querySelectorAll('.ia-chat .ia-msg'); return l[l.length - 1].dataset.status === 'concluida'; })()`, 4000, 'turno fechado');
        const u = await ultima();
        assert.deepEqual(u.atividades, ['IA: alterou 1']);
        assert.match(u.texto, /O agente não mandou resposta\.$/);
        await shot('07-sem-resposta');
        // depois de fechado, a resposta atrasada volta ao mesmo balão (sem "não mandou resposta")
        const n = (await msgs()).length;
        await conversa({ resposta: 'Girei a caixa 45° em Z.' });
        const m = await msgs();
        assert.equal(m.length, n, 'nenhum balão novo');
        const u2 = m[m.length - 1];
        assert.deepEqual(u2.atividades, ['IA: alterou 1']);
        assert.match(u2.texto, /Girei a caixa 45° em Z\.$/);
        assert.doesNotMatch(u2.texto, /não mandou resposta/);
      } finally {
        await app.js('(forgia.pedidoIA.turnoMs = 180000, true)');
      }
    });

    await t.test('pedido igual ao último em até 10 s não se repete', async () => {
      const n = (await msgs()).length;
      assert.equal((await conversa({ pedido: 'deixe a caixa vermelha' })).json.chat, 'mostrado');
      const r = await conversa({ pedido: 'deixe a caixa vermelha' });
      assert.equal(r.json.chat, 'ignorado');
      assert.match(r.json.aviso, /já está no chat/);
      assert.equal((await msgs()).length, n + 2);
      await conversa({ resposta: 'Pronto: caixa vermelha.' });
    });

    await t.test('erro de argumentos: isError com o exemplo, e nada muda no chat', async () => {
      const antes = await msgs();
      const casos = [
        [{}, /precisa de "pedido" .* ou "resposta"/],
        [{ pedido: 12 }, /"pedido" precisa ser texto/],
        [{ pedido: '   ' }, /"pedido" está vazio/],
        [{ pedido: 'x'.repeat(4001) }, /"pedido" passa de 4000 caracteres/],
        [{ resposta: 'y'.repeat(20001) }, /"resposta" passa de 20000 caracteres/],
        [{ texto: 'oi' }, /parâmetro desconhecido "texto"/],
      ];
      const erros = [];
      for (const [args, re] of casos) {
        const r = await conversa(args);
        assert.equal(r.isError, true, JSON.stringify(args).slice(0, 60));
        assert.equal(r.json.ok, false);
        assert.match(r.json.erro, re);
        assert.deepEqual(r.json.exemplo, { pedido: 'faça uma caixa de 30 mm' });
        erros.push(r.json.erro);
      }
      assert.deepEqual(await msgs(), antes);
      resultados.erros = erros;
    });

    await t.test('Novo projeto limpa as mensagens do agente e o ponto do botão', async () => {
      await fechar();
      await conversa({ pedido: 'mais uma peça' });
      assert.equal((await novidade()).ponto, true);
      await novoProjeto();
      assert.equal((await novidade()).ponto, false);
      await abrir();
      assert.deepEqual(await msgs(), []);
      assert.ok(await app.js(`!!document.querySelector('.ia-chat .ia-chat-vazio')`));
      // o pedido que ficou aberto no projeto velho não recebe mais nada
      await call('forgia_criar', { tipo: 'caixa', nome: 'depois do novo' });
      const m = await msgs();
      assert.equal(m.length, 1);
      assert.deepEqual([m[0].origem, m[0].atividades], ['Pelo agente', ['IA: criou 1']]);
      await shot('08-novo-projeto');
      await novoProjeto();
    });

    await t.test('com tarefa do Forgia rodando (Agent Code falso), forgia_conversa e a atividade não duplicam', async () => {
      const chamadas = [];
      // o "agente" chama forgia_conversa como se o pedido tivesse sido escrito nele
      const executor = async (args) => {
        const f = mcpStdio(args.mcp_servers.forgia);
        await f.init();
        try {
          const pedido = args.prompt.split('Pedido do usuário:\n')[1] || '';
          chamadas.push(await f.call('forgia_conversa', { pedido }));
          await f.call('forgia_lote', { comandos: [{ cmd: 'criar', tipo: 'caixa', nome: 'caixa da tarefa', medidas: [20, 20, 10] }] });
          chamadas.push(await f.call('forgia_conversa', { resposta: 'Criei uma caixa de 20 × 20 × 10 mm.' }));
          return 'Criei uma caixa de 20 × 20 × 10 mm.';
        } finally {
          f.close();
        }
      };
      fake = await fakeAgentCode({ porta: FAIXA.de + 3, executor });
      const s = await app.js('forgia.agentCode.integrar().then((e) => e.estado)');
      assert.equal(s, 'integrado');
      await abrir();
      await click('.ia-chat textarea');
      await app.send('Input.insertText', { text: 'faça uma caixa de 20 mm' });
      await key(app, 'Enter', 'Enter', 13);
      await app.waitFor(`(() => { const l = document.querySelectorAll('.ia-chat .ia-msg.ia'); return l.length && l[l.length - 1].dataset.status === 'concluida'; })()`, 30000, 'tarefa concluída');
      const m = await msgs();
      assert.deepEqual(m.map((x) => [x.de, x.externo, x.texto]), [['voce', false, 'faça uma caixa de 20 mm'], ['ia', false, 'Criei uma caixa de 20 × 20 × 10 mm.']]);
      assert.equal(chamadas.length, 2);
      for (const c of chamadas) {
        assert.equal(c.chat, 'ignorado');
        assert.match(c.aviso, /veio do Forgia/);
      }
      assert.ok(await app.js(`forgia.editor.objects.some((o) => o.name === 'caixa da tarefa')`));
      await shot('09-tarefa-do-forgia-sem-duplicar');
      // terminada a tarefa, o agente volta a poder escrever no chat
      assert.equal((await conversa({ pedido: 'agora pelo agente' })).json.chat, 'mostrado');
      assert.equal((await ultima()).status, 'rodando');
      resultados.tarefaDoForgia = { mensagens: await msgs(), chamadas };
    });

    await t.test('recarregar a janela (F5): a conversa volta vazia e segue recebendo', async () => {
      await app.js('(location.reload(), true)');
      await wait(500);
      await app.waitFor('!!(window.forgia && window.forgia.pedidoIA && window.forgia.ponte && window.forgia.ponte.info && window.forgia.ponte.info.porta)', 30000, 'Forgia recarregado');
      let r;
      for (let i = 0; i < 50; i++) {
        r = await conversa({ pedido: 'depois do F5' });
        if (!r.isError) break;
        await wait(200); // ponte "abrindo" logo depois da recarga
      }
      assert.equal(r.isError, false, JSON.stringify(r.json));
      assert.equal((await novidade()).ponto, true);
      await abrir();
      const m = await msgs();
      assert.equal(m.length, 2);
      assert.match(m[0].texto, /depois do F5$/);
      await shot('10-depois-do-f5');
    });

    assert.deepEqual(app.console.filter((x) => /exceção/i.test(x)), []);
  } finally {
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resultados, null, 2));
    await mcp.close();
    await app.close();
    if (fake) await fake.close();
  }
});
