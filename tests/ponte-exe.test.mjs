// Ponte da IA no Forgia.exe GERADO (não no Vite): segurança no servidor real, MCP pelo próprio exe,
// comandos, um pedido = um desfazer, código livre (erro, laço infinito, projeto inválido), ocupado,
// captura com a janela minimizada, parte de grupo, exportar/importar, fechar e reabrir.
// Só roda com FORGIA_EXE apontando o exe (senão pula), com perfil temporário:
//   FORGIA_EXE=release\fase-c\win-unpacked\Forgia.exe node --test tests/ponte-exe.test.mjs
// Evidências (capturas e resultado.json) em docs/fase-c-evidence/ponte/ (fora do Git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exePath, tempProfile, Forgia, McpClient, bridgeRequest, pngSize, wait, ROOT } from './forgia-exe.mjs';

const EXE = exePath();
const OUT = path.join(ROOT, 'docs', 'fase-c-evidence', 'ponte');
const results = {};
const note = (k, v) => (results[k] = v);

test('ponte da IA no Forgia.exe', { skip: !EXE && 'defina FORGIA_EXE com o Forgia.exe gerado', timeout: 300000 }, async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = tempProfile();
  let app = await Forgia.open(EXE, profile);
  const mcp = new McpClient(EXE, profile);
  const api = (cmd, args) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd, args });
  const ed = (expr) => app.js(`(() => { const ed = forgia.editor; return ${expr}; })()`);
  try {
    await t.test('ponte.json no perfil (porta e token), porta 47821 ou livre', async () => {
      assert.ok(Number.isInteger(app.bridge.porta) && app.bridge.porta > 0);
      assert.equal(app.bridge.token.length, 64);
      note('ponte', { porta: app.bridge.porta, pid: app.bridge.pid, arquivo: path.join(profile, 'ponte.json') });
    });

    await t.test('segurança no servidor real: sem token, token errado, Origin, Host de fora', async () => {
      const p = app.bridge.porta;
      const noTok = await bridgeRequest(p, { cmd: 'criar', args: { tipo: 'caixa' } });
      const badTok = await bridgeRequest(p, { token: 'f'.repeat(64), cmd: 'criar', args: { tipo: 'caixa' } });
      const origin = await bridgeRequest(p, { token: app.bridge.token, cmd: 'criar', args: { tipo: 'caixa' }, headers: { Origin: 'https://site.example' } });
      const host = await bridgeRequest(p, { token: app.bridge.token, cmd: 'criar', args: { tipo: 'caixa' }, headers: { Host: `evil.example:${p}` } });
      assert.deepEqual([noTok.status, badTok.status, origin.status, host.status], [401, 401, 403, 403]);
      assert.equal(await ed('ed.objects.length'), 0, 'nada criado');
      note('seguranca_exe', { semToken: noTok.status, tokenErrado: badTok.status, comOrigin: origin.status, hostDeFora: host.status, objetos: 0 });
    });

    await t.test('MCP pelo exe: initialize (instructions ≤ 2 KB), tools/list, stdout só JSON-RPC', async () => {
      const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
      mcp.notify('notifications/initialized');
      const ins = init.result.instructions;
      const bytes = Buffer.byteLength(ins, 'utf8');
      assert.ok(bytes <= 2048, `instructions com ${bytes} bytes`);
      const list = await mcp.request('tools/list', {});
      const names = list.result.tools.map((x) => x.name);
      for (const n of ['forgia_estado', 'forgia_formas', 'forgia_criar', 'forgia_alterar', 'forgia_excluir', 'forgia_agrupar', 'forgia_desagrupar', 'forgia_alinhar', 'forgia_espelhar', 'forgia_soltar_na_mesa', 'forgia_selecionar', 'forgia_duplicar', 'forgia_lote', 'forgia_captura', 'forgia_medir', 'forgia_marcacoes', 'forgia_exportar_stl', 'forgia_importar', 'forgia_desfazer', 'forgia_refazer', 'forgia_executar_codigo', 'forgia_manual']) assert.ok(names.includes(n), n);
      note('mcp', { protocolo: init.result.protocolVersion, instructionsBytes: bytes, ferramentas: names });
    });

    let cube;
    await t.test('"cubo de 20 mm" pelo MCP: aparece, aviso da IA, pisca, seleção intacta, um Ctrl+Z', async () => {
      const h0 = await ed('ed.historyIndex');
      const r = await mcp.call('forgia_criar', { tipo: 'caixa', medidas: [20, 20, 20] });
      assert.ok(!r.isError, r.content[0].text);
      const body = JSON.parse(r.content[0].text);
      cube = body.criados[0];
      assert.deepEqual(body.objetos[0].medidas, [20, 20, 20]);
      assert.deepEqual(body.objetos[0].caixa, { min: [-10, -10, 0], max: [10, 10, 20] });
      assert.equal(body.objetos[0].apoiado_em, 'mesa');
      const ui = await ed(`({ aviso: document.querySelector('.ia-aviso')?.textContent || null, pisca: ed.flashUntil > performance.now(), sel: ed.selection.length, hist: ed.historyIndex, barra: document.getElementById('sb-ia').dataset.estado })`);
      assert.match(ui.aviso, /^IA: criou 1 · Desfazer$/);
      assert.equal(ui.pisca, true);
      assert.equal(ui.sel, 0, 'a IA não seleciona sozinha');
      assert.equal(ui.hist, h0 + 1);
      assert.equal(ui.barra, 'conectada');
      await app.screenshot(path.join(OUT, 'cubo-aviso-' + (await app.js('document.documentElement.dataset.tema')) + '.png'));
      note('cubo', { id: cube, retorno: body.objetos[0], interface: ui });
    });

    await t.test('X/Y/Z da barra de status = forgia_estado da mesma peça', async () => {
      await api('alterar', { id: cube, centro: [12.5, -30, null], rotacao: [0, 0, 30] });
      await ed(`(ed.select([${JSON.stringify(cube)}]), true)`);
      const st = (await api('estado', { ids: [cube] })).json.objetos[0];
      const bar = await ed(`[document.getElementById('sb-coords').textContent, document.getElementById('sb-size').textContent]`);
      const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
      assert.equal(bar[0], `X ${fmt(st.centro[0])}   Y ${fmt(st.centro[1])}   Z ${fmt(st.centro[2])}`);
      assert.equal(bar[1], `${st.medidas.map(fmt).join(' × ')} mm`);
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set(${JSON.stringify(tema)}), true`);
        await app.screenshot(path.join(OUT, `barra-de-status-${tema}.png`));
      }
      note('barra_vs_estado', { estado: { centro: st.centro, medidas: st.medidas, rotacao: st.rotacao }, barra: bar });
    });

    await t.test('lote = um desfazer; refs; erro no meio não aplica nada', async () => {
      const h0 = await ed('ed.historyIndex');
      const n0 = await ed('ed.objects.length');
      const r = await api('lote', { comandos: [
        { cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [80, 60, 5], centro: [0, 60, null] },
        { cmd: 'criar', ref: 'aba', tipo: 'caixa', medidas: [80, 5, 40], sobre: '$base', centro: [null, 32.5, null] },
        { cmd: 'criar', ref: 'furo', tipo: 'cilindro', medidas: [8, 8, 5], alinhar_com: '$base', furo: true },
        { cmd: 'agrupar', ids: ['$base', '$aba', '$furo'], nome: 'suporte', ref: 'sup' },
      ] });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(await ed('ed.historyIndex'), h0 + 1, 'um passo só');
      assert.equal(await ed('ed.objects.length'), n0 + 1);
      const g = r.json.objetos.find((o) => o.tipo === 'grupo');
      assert.ok(g, 'grupo no retorno');
      const bad = await api('lote', { comandos: [{ cmd: 'criar', tipo: 'caixa' }, { cmd: 'criar', tipo: 'nao_existe' }] });
      assert.equal(bad.status, 422);
      assert.match(bad.json.erro, /comando 2 \(criar\).*Tipo de forma desconhecido/);
      assert.ok(Array.isArray(bad.json.validos));
      assert.equal(await ed('ed.objects.length'), n0 + 1, 'nada do lote com erro ficou');
      assert.equal(await ed('ed.historyIndex'), h0 + 1);
      await ed('(ed.undo(), true)');
      assert.equal(await ed('ed.objects.length'), n0, 'um Ctrl+Z tira o lote inteiro');
      await ed('(ed.redo(), true)');
      note('lote', { refs: r.json.refs, grupo: g, erroQueEnsina: bad.json });
      results.grupo = r.json.refs;
    });

    await t.test('parte de grupo: esticar só a aba; o resto não sai do lugar', async () => {
      const { aba, base, furo, sup } = results.grupo;
      const before = (await api('estado', { ids: [sup], filhos: true })).json.objetos[0];
      const r = await api('alterar', { id: aba, esticar: { lado: '+Z', mm: 2 } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const after = (await api('estado', { ids: [sup], filhos: true })).json.objetos[0];
      const part = (g, id) => g.filhos.find((c) => c.id === id);
      assert.equal(part(after, aba).medidas[2], part(before, aba).medidas[2] + 2);
      assert.equal(part(after, aba).caixa.min[2], part(before, aba).caixa.min[2], 'a base da aba fica');
      assert.equal(part(after, aba).caixa.max[2], part(before, aba).caixa.max[2] + 2);
      assert.deepEqual(part(after, base).caixa, part(before, base).caixa, 'a base do suporte não mexe');
      assert.deepEqual(part(after, furo).caixa, part(before, furo).caixa, 'o furo não mexe');
      assert.equal(after.caixa.max[2], before.caixa.max[2] + 2);
      note('parte_de_grupo', { antes: part(before, aba).caixa, depois: part(after, aba).caixa, base: part(after, base).caixa });
    });

    await t.test('executar_codigo: fachada, um desfazer, "IA executou código"', async () => {
      const h0 = await ed('ed.historyIndex');
      const n0 = await ed('ed.objects.length');
      const r = await mcp.call('forgia_executar_codigo', { codigo: "const ids = []; for (let i = 0; i < 6; i++) { const a = forgia.util.rad(60 * i); ids.push(forgia.criar({ tipo: 'cilindro', medidas: [4, 4, 6], centro: [80 + 15 * Math.cos(a), 15 * Math.sin(a), null] })); } forgia.agrupar(ids, { nome: 'anel' }); console.log('ok', ids.length); return forgia.objetos().length;" });
      assert.ok(!r.isError, r.content[0].text);
      const body = JSON.parse(r.content[0].text);
      assert.equal(body.comandos, 7);
      assert.equal(await ed('ed.objects.length'), n0 + 1);
      assert.equal(await ed('ed.historyIndex'), h0 + 1);
      assert.match(await ed(`document.querySelector('.ia-aviso')?.textContent || ''`), /^IA executou código: criou 1/);
      note('codigo_ok', { comandos: body.comandos, retorno: body.retorno, saida: body.saida });
    });

    await t.test('executar_codigo com erro: nada aplicado', async () => {
      const snap = await ed('ed.snapshot()');
      const h0 = await ed('ed.historyIndex');
      const r = await api('executar_codigo', { codigo: "forgia.criar({ tipo: 'caixa' }); throw new Error('falhou de propósito');" });
      assert.equal(r.json.ok, false);
      assert.match(r.json.erro, /falhou de propósito/);
      const bad = await api('executar_codigo', { codigo: "forgia.criar({ tipo: 'caixa' }); forgia.criar({ tipo: 'caixa', medidas: [0, 1, 1] });" });
      assert.equal(bad.json.ok, false);
      assert.match(bad.json.erro, /comando 2 \(criar\)/);
      assert.equal(await ed('ed.snapshot()'), snap);
      assert.equal(await ed('ed.historyIndex'), h0);
      note('codigo_erro', { erro: r.json.erro, erroNoComando: bad.json.erro });
    });

    await t.test('projeto inválido depois do código: restaurado', async () => {
      const snap = await ed('ed.snapshot()');
      const r = await api('executar_codigo', { codigo: `forgia.alterar(${JSON.stringify(cube)}, { mover: [1e308, 0, 0] }); forgia.alterar(${JSON.stringify(cube)}, { mover: [1e308, 0, 0] });` });
      assert.equal(r.json.ok, false);
      assert.match(r.json.erro, /Projeto inválido depois do pedido/);
      assert.equal(await ed('ed.snapshot()'), snap);
      note('projeto_invalido', r.json);
    });

    await t.test('laço infinito: cortado em 10 s e a janela segue respondendo', async () => {
      const t0 = Date.now();
      const pending = api('executar_codigo', { codigo: 'while (true) {}' });
      await wait(1500);
      const t1 = Date.now();
      const alive = await app.js('new Promise((r) => requestAnimationFrame(() => r(performance.now())))');
      const uiMs = Date.now() - t1;
      const r = await pending;
      const total = Date.now() - t0;
      assert.ok(alive > 0 && uiMs < 1000, `a página respondeu em ${uiMs} ms durante o laço`);
      assert.equal(r.json.ok, false);
      assert.match(r.json.erro, /Tempo esgotado/);
      assert.ok(total >= 9500 && total < 20000, `tempo total ${total} ms`);
      note('laco_infinito', { respostaDaJanelaMs: uiMs, totalMs: total, erro: r.json.erro });
    });

    await t.test('Permitir IA desligado: recusado; Permitir código livre desligado: só o código recusa', async () => {
      await app.js('forgia.ponte.setConfig({ permitir: false }), true');
      await wait(300);
      const off = await api('estado', {});
      assert.equal(off.status, 403);
      const viaMcp = await mcp.call('forgia_estado', {});
      assert.equal(viaMcp.isError, true);
      assert.match(viaMcp.content[0].text, /IA está desligada/);
      await app.js('forgia.ponte.setConfig({ permitir: true, codigo: false }), true');
      await wait(300);
      const code = await api('executar_codigo', { codigo: 'return 1' });
      assert.equal(code.status, 403);
      assert.equal((await api('estado', {})).status, 200);
      await app.js('forgia.ponte.setConfig({ codigo: true }), true');
      await wait(300);
      note('permitir', { iaDesligada: off.json, codigoDesligado: code.json });
    });

    await t.test('arrastando uma peça: "ocupado" e nada muda', async () => {
      await ed(`(ed.select([]), ed.fitView(), true)`);
      await wait(700);
      const p = await ed(`(() => { const c = ed.renderer.domElement.getBoundingClientRect(); const m = ed.meshes.get(${JSON.stringify(cube)}); const v = new m.position.constructor(); m.getWorldPosition(v); const s = ed.project(v); return { x: c.x + s.x, y: c.y + s.y }; })()`);
      await app.mouse('mouseMoved', p.x, p.y);
      await app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) await app.mouse('mouseMoved', p.x + i * 6, p.y, { button: 'left', buttons: 1 });
      const dragging = await ed('!!(ed.drag && ed.drag.kind)');
      const n0 = await ed('ed.objects.length');
      const r = await api('criar', { tipo: 'esfera' });
      await app.mouse('mouseReleased', p.x + 36, p.y, { button: 'left', buttons: 0, clickCount: 1 });
      assert.equal(dragging, true, 'o arraste começou');
      assert.equal(r.status, 409);
      assert.equal(r.json.ocupado, true);
      assert.equal(await ed('ed.objects.length'), n0);
      await wait(200);
      assert.equal((await api('criar', { tipo: 'esfera', centro: [-60, -60, null] })).status, 200, 'depois de soltar, volta a aceitar');
      note('ocupado', r.json);
    });

    await t.test('captura: vistas fixas, PNG; também com a janela minimizada', async () => {
      const shots = {};
      for (const vista of ['iso', 'frente', 'topo']) {
        const r = await mcp.call('forgia_captura', { vista, largura: 640, altura: 480 });
        assert.equal(r.content[0].type, 'image');
        const buf = Buffer.from(r.content[0].data, 'base64');
        const s = pngSize(buf);
        assert.deepEqual([s.png, s.w, s.h], [true, 640, 480]);
        fs.writeFileSync(path.join(OUT, `captura-${vista}.png`), buf);
        shots[vista] = buf.length;
      }
      const iconic = app.windowState('minimized');
      await wait(1500);
      const min = await app.js('document.visibilityState');
      const r = await mcp.call('forgia_captura', { vista: 'iso', largura: 640, altura: 480 });
      const buf = Buffer.from(r.content[0].data, 'base64');
      fs.writeFileSync(path.join(OUT, 'captura-minimizada.png'), buf);
      app.windowState('normal');
      assert.equal(iconic, true, 'a janela ficou minimizada');
      assert.equal(pngSize(buf).w, 640);
      assert.ok(buf.length > 20000, `PNG com conteúdo (${buf.length} bytes)`);
      assert.ok(Math.abs(buf.length - shots.iso) / shots.iso < 0.35, `a minimizada parece a normal (${buf.length} x ${shots.iso})`);
      note('captura', { bytes: shots, minimizada: { iconic, visibilityState: min, bytes: buf.length } });
    });

    await t.test('exportar_stl e importar pelo caminho', async () => {
      const file = path.join(OUT, 'exportado.stl');
      fs.rmSync(file, { force: true });
      const r = await api('exportar_stl', { caminho: file, ids: [cube] });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(fs.statSync(file).size, 84 + 50 * r.json.triangulos);
      const bad = await api('exportar_stl', { caminho: 'relativo.stl' });
      assert.equal(bad.status, 422);
      const imp = await api('importar', { caminho: file, nome: 'cubo importado', centro: [-80, 40, null] });
      assert.equal(imp.status, 200, JSON.stringify(imp.json));
      const o = imp.json.objetos[0];
      assert.equal(o.tipo, 'importado');
      assert.equal(o.caixa.min[2], 0);
      note('arquivos', { exportado: r.json, importado: o });
    });

    await t.test('fechar: "Abra o Forgia"; reabrir: porta e token novos e a próxima chamada funciona', async () => {
      const old = app.bridge;
      const n = await ed('ed.objects.length');
      await app.close();
      assert.equal(fs.existsSync(path.join(profile, 'ponte.json')), false, 'ponte.json apagado ao fechar');
      const closed = await mcp.call('forgia_estado', {});
      assert.equal(closed.isError, true);
      assert.match(closed.content[0].text, /Abra o Forgia/);
      app = await Forgia.open(EXE, profile);
      assert.notEqual(app.bridge.token, old.token);
      const again = await mcp.call('forgia_estado', {});
      assert.ok(!again.isError, again.content[0].text);
      assert.equal(JSON.parse(again.content[0].text).total, n, 'o projeto voltou salvo');
      note('reabrir', { antes: { porta: old.porta }, depois: { porta: app.bridge.porta }, tokenNovo: true, fechado: closed.content[0].text });
    });

    await t.test('stdout do MCP só teve JSON-RPC', async () => {
      const bad = mcp.raw.filter((l) => {
        try {
          return JSON.parse(l).jsonrpc !== '2.0';
        } catch {
          return true;
        }
      });
      assert.deepEqual(bad, []);
      note('stdout', { linhas: mcp.raw.length, naoJson: bad.length, stderr: mcp.stderr.slice(0, 500) });
    });
  } finally {
    note('console_da_pagina', app.console.slice(0, 30));
    await mcp.close();
    await app.close();
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(results, null, 2));
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await wait(500);
      }
    }
  }
});
