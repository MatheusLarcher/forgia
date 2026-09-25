// Fase D, etapa app-pro, no Forgia.exe gerado, com perfis TEMPORÁRIOS (nunca %APPDATA%\Forgia):
// migração do localStorage antigo, .forgia com malha > 5 MB (Ctrl+S pelo diálogo real, fechar,
// reabrir pelo arquivo, por Recentes e pelo Windows), "•" no título, Fechar pergunta, matar o
// processo e recuperar, 3MF com 3 peças e 3 cores (ida e volta pelo src/threemf.js), lista de
// objetos (selecionar, ocultar, bloquear, renomear e desfazer) e a barra de status × forgia_estado.
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe node --test tests/projeto-exe.test.mjs
// Perfil antigo: FORGIA_PERFIL_ANTIGO=<pasta com perfil\ e antes.json> (tests/migracao-antiga.mjs,
// preparado com o exe da Fase C); sem ele, o teste de migração é pulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, exePath, tempProfile, wait, bridgeRequest, fileDialog, ROOT } from './forgia-exe.mjs';
import { stlEsfera } from './migracao-antiga.mjs';
import { unzipFiles } from '../src/zip.js';

const EXE = exePath();
const skip = !EXE && 'defina FORGIA_EXE (exe gerado da Fase D)';
const EVID = path.join(ROOT, 'docs', 'fase-d-evidence', 'projeto');
const ANTIGO = process.env.FORGIA_PERFIL_ANTIGO || null;

const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);
const key = async (app, k, { ctrl = false, shift = false } = {}) => {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const code = /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : k;
  const vk = /^[a-z]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0;
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
};
const estadoArquivo = (app) => app.js(`({ titulo: document.title, file: forgia.arquivo.file, dirty: forgia.arquivo.dirty, rotulo: document.getElementById('file-name').textContent, n: forgia.editor.objects.length })`);
const modal = (app) => app.js(`(() => { const m = document.querySelector('.modal'); return m ? { titulo: m.querySelector('.modal-head span').textContent, texto: m.querySelector('.modal-body').textContent, botoes: [...m.querySelectorAll('[data-escolha]')].map((b) => b.dataset.escolha) } : null; })()`);
const escolher = (app, v) => app.js(`document.querySelector('.modal [data-escolha="${v}"]').click()`);
// Novo projeto pelo botão; se o atual tiver alteração não salva, responde "Não salvar"
async function novo(app) {
  await app.js(`document.getElementById('btn-new').click()`);
  await wait(300);
  if (await modal(app)) await escolher(app, 'nao');
  await app.waitFor('forgia.editor.objects.length === 0 && !forgia.arquivo.file', 10000, 'novo projeto');
}

test('D1 no exe: projeto em arquivo, recuperação, 3MF, lista de objetos e barra de status', { skip, timeout: 900000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const work = tempProfile('forgia-fase-d-arquivos-');
  const log = [];
  const note = (k, v) => log.push({ k, v });

  await t.test('migração: o projeto e a malha do localStorage antigo continuam acessíveis', { skip: !ANTIGO && 'defina FORGIA_PERFIL_ANTIGO' }, async () => {
    const antes = JSON.parse(fs.readFileSync(path.join(ANTIGO, 'antes.json'), 'utf8'));
    const perfil = tempProfile('forgia-fase-d-migra-');
    fs.cpSync(path.join(ANTIGO, 'perfil'), perfil, { recursive: true });
    let app = await Forgia.open(EXE, perfil);
    try {
      const est = await cmd(app, 'estado');
      const agora = JSON.parse(JSON.stringify(est.objetos.map((o) => ({ id: o.id, nome: o.nome, tipo: o.tipo, medidas: o.medidas, centro: o.centro, cor: o.cor }))));
      assert.deepEqual(agora, antes.objetos, 'mesmos objetos, medidas e posições');
      const malha = await app.js(`(() => { const o = forgia.editor.objects.find((x) => x.type === 'mesh'); const m = forgia.editor.meshes.get(o.id); return m.geometry.attributes.position.count / 3; })()`);
      assert.equal(malha, antes.triangulos, 'a malha importada voltou inteira (não virou caixa)');
      await wait(800);
      assert.ok(fs.existsSync(path.join(perfil, 'recuperacao', 'projeto.json')), 'cópia de segurança gravada');
      assert.equal(fs.readdirSync(path.join(perfil, 'recuperacao', 'malhas')).length, 1, 'malha na cópia de segurança');
      const ls = await app.js(`[localStorage.getItem('forgia.design.v1') !== null, (localStorage.getItem('forgia.meshes.v1') || '').length, localStorage.getItem('forgia.migrado.v1')]`);
      assert.equal(ls[0], true, 'chave antiga do projeto fica onde estava');
      assert.equal(ls[1], antes.localStorage.meshes, 'chave antiga das malhas intacta');
      note('migracao', { objetos: agora.length, triangulos: malha, migradoEm: ls[2] });
      await app.screenshot(path.join(EVID, 'migracao.png'));
      await app.close();
      // segunda abertura: vem da cópia de segurança (não migra de novo)
      app = await Forgia.open(EXE, perfil);
      const est2 = await cmd(app, 'estado');
      assert.deepEqual(est2.objetos.map((o) => o.id), antes.objetos.map((o) => o.id));
      assert.equal(await app.js('forgia.arquivo.migrated === undefined'), true, 'não migrou de novo');
    } finally {
      await app.close();
    }
  });

  const perfil = tempProfile('forgia-fase-d-projeto-');
  const stl = path.join(work, 'grande.stl');
  const tris = stlEsfera(stl, 25, 195);
  const arquivo = path.join(work, 'suporte grande.forgia');
  let app = await Forgia.open(EXE, perfil);
  try {
    await t.test('estado vazio: sem arquivo, sem "•", título do projeto', async () => {
      const e = await estadoArquivo(app);
      assert.equal(e.n, 0);
      assert.equal(e.file, null);
      assert.equal(e.dirty, false);
      assert.equal(e.titulo, 'Meu projeto 3D — Forgia');
      assert.equal(e.rotulo, '');
    });

    await t.test('malha > 5 MB, Ctrl+S pelo diálogo do Windows, "•" até salvar', async () => {
      const imp = await cmd(app, 'importar', { caminho: stl, nome: 'esfera grande', centro: [40, 0, null] });
      assert.ok(imp.ok, JSON.stringify(imp));
      const lote = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [40, 30, 8], cor: '#e3302d', nome: 'base', centro: [-40, 0, null] },
        { cmd: 'criar', ref: 'p', tipo: 'cilindro', medidas: [10, 10, 16], sobre: '$b', cor: '#1b8bd2', nome: 'pino' },
      ] });
      assert.ok(lote.ok);
      const bytes = await app.js(`forgia.editor.objects.find((o) => o.type === 'mesh') && [...forgia.arquivo.sentRefs].length`);
      await wait(700);
      let e = await estadoArquivo(app);
      assert.equal(e.dirty, true);
      assert.match(e.titulo, /^Meu projeto 3D • — Forgia$/);
      assert.equal(await app.js('forgia.editor.meshes.get(forgia.editor.objects.find((o) => o.type === "mesh").id).geometry.attributes.position.count / 3'), tris);
      note('malha', { triangulos: tris, bytesPosicoes: tris * 36, enviadaCopia: bytes });
      await key(app, 's', { ctrl: true });
      const d = fileDialog(app.pid, arquivo);
      assert.equal(d, 'ok', 'diálogo Salvar preenchido: ' + d);
      await app.waitFor(`!!(forgia.arquivo.file && !forgia.arquivo.dirty)`, 60000, 'salvo');
      e = await estadoArquivo(app);
      assert.equal(e.file.nome, 'suporte grande.forgia');
      assert.equal(e.titulo, 'suporte grande.forgia — Forgia');
      assert.equal(e.rotulo, 'suporte grande.forgia');
      const st = fs.statSync(arquivo);
      const bytesArq = fs.readFileSync(arquivo);
      assert.equal(bytesArq.subarray(0, 4).toString('hex'), '504b0304', 'é ZIP');
      const dentro = unzipFiles(new Uint8Array(bytesArq));
      const json = JSON.parse(new TextDecoder().decode(dentro['projeto.json']));
      assert.equal(json.formato, 'forgia.projeto');
      assert.equal(json.versao, 1);
      const bins = Object.keys(dentro).filter((n) => n.startsWith('malhas/'));
      assert.equal(bins.length, 1);
      assert.equal(dentro[bins[0]].byteLength, tris * 36, 'malha inteira no arquivo (Float32, triângulos soltos)');
      assert.ok(dentro['miniatura.png'] && dentro['miniatura.png'][1] === 0x50, 'miniatura PNG');
      note('salvo', { arquivo, bytes: st.size, conteudo: Object.fromEntries(Object.entries(dentro).map(([n, b]) => [n, b.byteLength])) });
      // alteração: "•" volta; desfazer até o estado salvo tira o "•"
      await cmd(app, 'criar', { tipo: 'esfera', medidas: [12, 12, 12], centro: [0, 50, null], nome: 'extra' });
      await wait(700);
      e = await estadoArquivo(app);
      assert.equal(e.dirty, true);
      assert.equal(e.titulo, 'suporte grande.forgia • — Forgia');
      assert.equal(e.rotulo, 'suporte grande.forgia •');
      await app.screenshot(path.join(EVID, 'titulo-sujo.png'));
      await cmd(app, 'desfazer');
      await wait(700);
      assert.equal((await estadoArquivo(app)).dirty, false, 'desfazer até o salvo tira o "•"');
      await cmd(app, 'refazer');
      await wait(700);
      assert.equal((await estadoArquivo(app)).dirty, true);
    });

    await t.test('Fechar sem salvar pergunta: Cancelar fica, Não salvar fecha e volta ao arquivo salvo', async () => {
      assert.ok(app.windowClose(), 'WM_CLOSE');
      await app.waitFor(`!!document.querySelector('.modal [data-escolha="salvar"]')`, 10000, 'pergunta ao fechar');
      const m = await modal(app);
      assert.deepEqual(m.botoes, ['cancelar', 'nao', 'salvar']);
      assert.match(m.texto, /suporte grande\.forgia/);
      await app.screenshot(path.join(EVID, 'fechar-pergunta.png'));
      await escolher(app, 'cancelar');
      await wait(1500);
      assert.equal(app.exited, null, 'Cancelar: continua aberto');
      assert.ok(app.windowClose());
      await app.waitFor(`!!document.querySelector('.modal [data-escolha="nao"]')`, 10000, 'pergunta de novo');
      await escolher(app, 'nao');
      await Promise.race([app.exitPromise, wait(10000)]);
      assert.ok(app.exited, 'Não salvar: fechou');
      app.cdp.close();
      app = await Forgia.open(EXE, perfil);
      const e = await estadoArquivo(app);
      assert.equal(e.file && e.file.nome, 'suporte grande.forgia');
      assert.equal(e.dirty, false);
      const nomes = await app.js('forgia.editor.objects.map((o) => o.name).sort()');
      assert.deepEqual(nomes, ['base', 'esfera grande', 'pino'], 'o "extra" não salvo não voltou');
      assert.equal(await app.js('forgia.editor.meshes.get(forgia.editor.objects.find((o) => o.type === "mesh").id).geometry.attributes.position.count / 3'), tris, 'malha grande voltou');
    });

    await t.test('Recentes e Abrir (Ctrl+O): tudo volta', async () => {
      // novo projeto (sem pergunta: nada a salvar)
      await app.js(`document.getElementById('btn-new').click()`);
      await app.waitFor('forgia.editor.objects.length === 0 && !forgia.arquivo.file', 10000, 'novo');
      assert.equal(await modal(app), null, 'sem pergunta ao trocar um projeto salvo');
      await app.js(`document.getElementById('btn-arquivo').click()`);
      await app.waitFor(`!!document.querySelector('#menu-arquivo .menu-item[title]')`, 5000, 'menu com Recentes');
      const itens = await app.js(`[...document.querySelectorAll('#menu-arquivo .menu-item')].map((b) => b.textContent)`);
      note('menu', itens);
      assert.ok(itens.some((s) => s.startsWith('suporte grande.forgia')));
      await app.screenshot(path.join(EVID, 'menu-arquivo.png'));
      await app.js(`document.querySelector('#menu-arquivo .menu-item[title]').click()`);
      await app.waitFor(`forgia.editor.objects.length === 3 && forgia.arquivo.file && forgia.arquivo.file.nome === 'suporte grande.forgia'`, 30000, 'aberto pelos Recentes');
      assert.equal(await app.js('forgia.editor.meshes.get(forgia.editor.objects.find((o) => o.type === "mesh").id).geometry.attributes.position.count / 3'), tris);
      // Ctrl+O pelo diálogo
      await novo(app);
      await key(app, 'o', { ctrl: true });
      const d = fileDialog(app.pid, arquivo);
      assert.equal(d, 'ok', 'diálogo Abrir: ' + d);
      await app.waitFor(`forgia.editor.objects.length === 3 && !!forgia.arquivo.file`, 30000, 'aberto por Ctrl+O');
    });

    await t.test('matar o processo com alteração não salva: oferece recuperar e recupera', async () => {
      await cmd(app, 'criar', { tipo: 'cone', medidas: [14, 14, 20], centro: [0, -50, null], nome: 'cone recuperavel' });
      await wait(900); // a cópia de segurança sai ~0,4 s depois
      await app.kill();
      app = await Forgia.open(EXE, perfil, { ready: `!!document.querySelector('.modal [data-escolha="recuperar"]')` });
      const m = await modal(app);
      assert.match(m.texto, /^Há alterações não salvas de suporte grande\.forgia \(.+\)\. Recuperar\?$/);
      assert.deepEqual(m.botoes, ['outro', 'recuperar']);
      await app.screenshot(path.join(EVID, 'recuperar.png'));
      await escolher(app, 'recuperar');
      await app.waitFor('!!(window.forgia.ponte.info && window.forgia.ponte.info.porta)', 20000, 'ponte depois de recuperar');
      app.bridge = await app.waitBridgeFile();
      const e = await estadoArquivo(app);
      assert.equal(e.n, 4);
      assert.equal(e.dirty, true, 'recuperado continua sujo até salvar');
      assert.ok(await app.js(`forgia.editor.objects.some((o) => o.name === 'cone recuperavel')`));
      assert.equal(await app.js('forgia.editor.meshes.get(forgia.editor.objects.find((o) => o.type === "mesh").id).geometry.attributes.position.count / 3'), tris, 'malha grande recuperada');
      // Descartar: volta ao arquivo salvo
      await wait(900);
      await app.kill();
      app = await Forgia.open(EXE, perfil, { ready: `!!document.querySelector('.modal [data-escolha="outro"]')` });
      await escolher(app, 'outro');
      await app.waitFor('!!(window.forgia.ponte.info && window.forgia.ponte.info.porta) && forgia.editor.objects.length === 3', 20000, 'descartado');
      app.bridge = await app.waitBridgeFile();
      assert.equal((await estadoArquivo(app)).dirty, false);
    });

    await t.test('abrir pelo Windows (argumento, como o duplo clique no .forgia)', async () => {
      await app.close();
      const outro = tempProfile('forgia-fase-d-argv-');
      app = await Forgia.open(EXE, outro, { extraArgs: [arquivo] });
      const e = await estadoArquivo(app);
      assert.equal(e.file && e.file.nome, 'suporte grande.forgia');
      assert.equal(e.n, 3);
      await app.close();
      app = await Forgia.open(EXE, perfil);
    });

    await t.test('3MF: 3 peças com 3 cores, ida e volta pelo leitor do Forgia com as mesmas medidas', async () => {
      await novo(app);
      const r = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', tipo: 'caixa', medidas: [30, 20, 10], cor: '#e3302d', nome: 'vermelha', centro: [-40, 0, null] },
        { cmd: 'criar', tipo: 'cilindro', medidas: [20, 20, 25], cor: '#1b8bd2', nome: 'azul', centro: [0, 0, null] },
        { cmd: 'criar', tipo: 'esfera', medidas: [18, 18, 18], cor: '#3fb34f', nome: 'verde', centro: [40, 10, null] },
      ] });
      assert.ok(r.ok);
      const est = await cmd(app, 'estado');
      // o mesmo caminho do botão Exportar > .3MF, sem o diálogo de download do Chromium
      const b64 = await app.js(`(async () => { const r = await forgia.ui.make3MF(false); let s = ''; for (let i = 0; i < r.dados.length; i += 0x8000) s += String.fromCharCode.apply(null, r.dados.subarray(i, i + 0x8000)); return btoa(s); })()`);
      const file3mf = path.join(ROOT, 'docs', 'fase-d-evidence', 'tres-cores.3mf');
      fs.writeFileSync(file3mf, Buffer.from(b64, 'base64'));
      note('3mf', { arquivo: file3mf, bytes: fs.statSync(file3mf).size });
      // reimporta cada peça pelo importar (src/threemf.js): 3MF junta tudo numa malha só
      const imp = await cmd(app, 'importar', { caminho: file3mf, nome: 'reimportado', centro: [0, 60, null] });
      assert.ok(imp.ok, JSON.stringify(imp));
      const caixa = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const o of est.objetos) for (let k = 0; k < 3; k++) {
        caixa.min[k] = Math.min(caixa.min[k], o.caixa.min[k]);
        caixa.max[k] = Math.max(caixa.max[k], o.caixa.max[k]);
      }
      const medidas = [0, 1, 2].map((k) => Math.round((caixa.max[k] - caixa.min[k]) * 100) / 100);
      const back = imp.objetos[0].medidas;
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - medidas[k]) < 0.02, `medida ${'XYZ'[k]}: ${back[k]} × ${medidas[k]}`);
      note('3mf-medidas', { original: medidas, reimportado: back });
    });

    await t.test('lista de objetos: árvore, selecionar, ocultar, bloquear, renomear e desfazer; IA aparece', async () => {
      await novo(app);
      const r = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [40, 30, 8], nome: 'base' },
        { cmd: 'criar', ref: 'f', tipo: 'cilindro', medidas: [8, 8, 8], furo: true, nome: 'furo' },
        { cmd: 'agrupar', ids: ['$b', '$f'], nome: 'placa' },
        { cmd: 'criar', tipo: 'esfera', medidas: [10, 10, 10], centro: [40, 0, null], nome: 'bola' },
      ] });
      assert.ok(r.ok);
      await app.js(`document.getElementById('tab-objetos').click()`);
      await app.waitFor(`document.querySelectorAll('#obj-list .obj-row').length === 2`, 5000, 'duas linhas do topo');
      await app.js(`document.querySelector('#obj-list .obj-row[aria-expanded] .obj-toggle').click()`);
      await app.waitFor(`document.querySelectorAll('#obj-list .obj-row').length === 4`, 5000, 'grupo aberto');
      const rows = await app.js(`[...document.querySelectorAll('#obj-list .obj-row')].map((r) => [r.querySelector('.obj-nome').textContent, r.getAttribute('aria-level')])`);
      assert.deepEqual(rows, [['placa', '1'], ['base', '2'], ['furo', '2'], ['bola', '1']]);
      const h0 = await app.js('forgia.editor.historyIndex');
      // selecionar
      await app.js(`[...document.querySelectorAll('#obj-list .obj-row')].find((r) => r.textContent.includes('bola')).click()`);
      assert.deepEqual(await app.js('forgia.editor.selected.map((o) => o.name)'), ['bola']);
      // parte do grupo seleciona o grupo
      await app.js(`[...document.querySelectorAll('#obj-list .obj-row')].find((r) => r.querySelector('.obj-nome').textContent === 'furo').click()`);
      assert.deepEqual(await app.js('forgia.editor.selected.map((o) => o.name)'), ['placa']);
      // ocultar a bola, bloquear a placa, renomear a bola
      const row = (n) => `[...document.querySelectorAll('#obj-list .obj-row')].find((r) => r.querySelector('.obj-nome').textContent === '${n}')`;
      await app.js(`${row('bola')}.querySelector('.obj-olho').click()`);
      await app.waitFor(`forgia.editor.objects.find((o) => o.name === 'bola').hidden === true`, 3000, 'oculta');
      await app.js(`${row('placa')}.querySelector('.obj-cadeado').click()`);
      await app.waitFor(`forgia.editor.objects.find((o) => o.name === 'placa').locked === true`, 3000, 'bloqueada');
      // ocultar uma parte do grupo mantém a base no lugar
      const antes = await cmd(app, 'estado', { filhos: true });
      await app.js(`${row('furo')}.querySelector('.obj-olho').click()`);
      await app.waitFor(`forgia.editor.objects[0].children[1].hidden === true`, 3000, 'parte oculta');
      const depois = await cmd(app, 'estado', { filhos: true });
      assert.deepEqual(depois.objetos[0].filhos[0].centro, antes.objetos[0].filhos[0].centro, 'a base não saiu do lugar');
      await app.js(`${row('bola')}.querySelector('.obj-nome').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await app.waitFor(`!!document.querySelector('.obj-renomear')`, 3000, 'campo de renomear');
      await app.js(`(() => { const i = document.querySelector('.obj-renomear'); i.value = 'bola renomeada'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await app.waitFor(`forgia.editor.objects.some((o) => o.name === 'bola renomeada')`, 3000, 'renomeada');
      await app.screenshot(path.join(EVID, 'lista-objetos.png'));
      assert.equal(await app.js('forgia.editor.historyIndex') - h0, 4, 'quatro passos de desfazer');
      for (let i = 0; i < 4; i++) await app.js('forgia.editor.undo()');
      const back = await app.js(`forgia.editor.objects.map((o) => [o.name, !!o.hidden, !!o.locked, (o.children || []).map((c) => !!c.hidden)])`);
      assert.deepEqual(back, [['placa', false, false, [false, false]], ['bola', false, false, []]], 'desfazer volta tudo');
      // IA cria: aparece na lista
      await cmd(app, 'criar', { tipo: 'cone', nome: 'cone da IA', centro: [0, 40, null] });
      await app.waitFor(`[...document.querySelectorAll('#obj-list .obj-nome')].some((n) => n.textContent === 'cone da IA')`, 3000, 'objeto da IA na lista');
      assert.equal(await app.js(`document.getElementById('obj-count').textContent`), '3');
    });

    await t.test('barra de status: X/Y/Z bate com forgia_estado; crédito LarcherTech na ponta direita', async () => {
      const est = await cmd(app, 'estado');
      const alvo = est.objetos.find((o) => o.nome === 'cone da IA');
      await cmd(app, 'selecionar', { ids: [alvo.id] });
      await wait(200);
      const bar = await app.js(`[document.getElementById('sb-coords').textContent, document.getElementById('sb-size').textContent]`);
      const f = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
      assert.equal(bar[0], `X ${f(alvo.centro[0])}   Y ${f(alvo.centro[1])}   Z ${f(alvo.centro[2])}`);
      assert.equal(bar[1], `${f(alvo.medidas[0])} × ${f(alvo.medidas[1])} × ${f(alvo.medidas[2])} mm`);
      const cred = await app.js(`(() => { const a = document.querySelector('#statusbar a.credit'); const r = a.getBoundingClientRect(); const sb = document.getElementById('statusbar').getBoundingClientRect(); return { href: a.href, target: a.target, texto: a.textContent.trim(), direita: Math.round(sb.right - r.right), naBiblioteca: !!document.querySelector('#library .credit') }; })()`);
      assert.equal(cred.href, 'https://larchertech.com/');
      assert.equal(cred.target, '_blank');
      assert.equal(cred.texto, 'por LarcherTech');
      assert.ok(cred.direita <= 12, 'na ponta direita');
      assert.equal(cred.naBiblioteca, false, 'saiu do pé da biblioteca');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await wait(300);
        await app.screenshot(path.join(EVID, `barra-e-lista-${tema}.png`));
      }
    });
  } finally {
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    if (app.console.length) fs.writeFileSync(path.join(EVID, 'console.txt'), app.console.join('\n'));
    await app.close();
  }
});
