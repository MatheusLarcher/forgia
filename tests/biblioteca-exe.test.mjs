// Biblioteca em categorias no Forgia.exe gerado (perfil temporário): 7 categorias com ícones
// desenhados pelo Forgia, favoritos, Suas criações (salvar, reabrir, usar, renomear, excluir), cada
// Iniciante arrastado para a mesa, e Hardware/Geradores de verdade: porca M3 com rosca real no
// parafuso M3 e duas engrenagens do mesmo módulo sem sobreposição (volume da união = soma), com as
// contraprovas (meio passo fora; engrenagem sem o giro de meio dente).
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe node --test tests/biblioteca-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, McpClient, exePath, tempProfile, wait, bridgeRequest, ROOT } from './forgia-exe.mjs';
import { unzipFiles } from '../src/zip.js';

const EXE = exePath();
const skip = !EXE && 'defina FORGIA_EXE (exe gerado da Fase D)';
const EVID = path.join(ROOT, 'docs', 'fase-d-evidence', 'biblioteca');
const cmd = (app, c, args = {}) => bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd: c, args }).then((r) => r.json);

async function drag(app, from, to) {
  await app.mouse('mouseMoved', from[0], from[1]);
  await wait(60);
  await app.mouse('mousePressed', from[0], from[1], { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await app.mouse('mouseMoved', Math.round(from[0] + ((to[0] - from[0]) * i) / 14), Math.round(from[1] + ((to[1] - from[1]) * i) / 14), { button: 'left', buttons: 1 });
    await wait(25);
  }
  await app.mouse('mouseReleased', to[0], to[1], { button: 'left', buttons: 0, clickCount: 1 });
  await wait(300);
}
const tileAt = (app, sel) => app.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
const mesa = (app, x = 0, z = 0) => app.js(`(() => { const ed = forgia.editor; const r = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(ed.camera.position.clone().set(${x}, 0, ${z})); return [Math.round(r.left + s.x), Math.round(r.top + s.y)]; })()`);
const escolher = async (app, cat) => {
  await app.js(`document.getElementById('lib-category').click()`);
  await app.waitFor(`!!document.querySelector('#menu-categorias [data-categoria="${cat}"]')`, 5000, 'menu de categorias');
  await app.js(`document.querySelector('#menu-categorias [data-categoria="${cat}"]').click()`);
  await wait(200);
};
// volume (mm³) das malhas da cena dos ids, com a matriz de cada uma
const VOL = `(ids) => { const ed = forgia.editor; let v = 0; for (const id of ids) { const m = ed.meshes.get(id); m.updateMatrixWorld(true); const g = m.geometry; const p = g.attributes.position; const idx = g.index; const n = idx ? idx.count : p.count; const a = m.position.clone(), b = a.clone(), c = a.clone(); for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld); v += a.dot(b.clone().cross(c)) / 6; } } return v; }`;

async function sobreposicao(app, comandos) {
  await app.js('(forgia.editor.loadProject(null), true)');
  const r = await cmd(app, 'lote', { comandos });
  assert.ok(r.ok, JSON.stringify(r));
  const ids = r.criados;
  const soma = await app.js(`(${VOL})(${JSON.stringify(ids)})`);
  const g = await cmd(app, 'agrupar', { ids });
  assert.ok(g.ok);
  const uniao = await app.js(`(${VOL})([forgia.editor.objects[0].id])`);
  return { soma, uniao, sobra: soma - uniao };
}

test('Biblioteca em categorias no exe', { skip, timeout: 600000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const perfil = tempProfile('forgia-fase-d-biblioteca-');
  let app = await Forgia.open(EXE, perfil);
  const log = {};
  try {
    await t.test('7 categorias no seletor, cada uma com ícone desenhado pelo Forgia', async () => {
      await app.js(`document.getElementById('lib-category').click()`);
      await app.waitFor(`document.querySelectorAll('#menu-categorias [data-categoria]').length === 7`, 5000, 'menu');
      const cats = await app.js(`[...document.querySelectorAll('#menu-categorias [data-categoria]')].map((b) => ({ cat: b.dataset.categoria, nome: b.textContent, png: b.querySelector('img').src.startsWith('data:image/png') && b.querySelector('img').src.length > 1500 }))`);
      assert.deepEqual(cats.map((c) => c.nome), ['Suas criações', 'Favoritos', 'Formas básicas', 'Letras e números', 'Iniciantes do projeto', 'Hardware', 'Geradores de forma']);
      assert.ok(cats.every((c) => c.png), 'ícone PNG renderizado em cada categoria');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await wait(250);
        await app.screenshot(path.join(EVID, `categorias-${tema}.png`));
      }
      await app.js(`document.getElementById('lib-category').click()`);
      const contagem = {};
      for (const c of ['basic', 'letters', 'iniciantes', 'hardware', 'geradores', 'criacoes', 'favoritos']) {
        await escolher(app, c);
        contagem[c] = await app.js(`document.querySelectorAll('#lib-grid .tile').length`);
        if (c === 'hardware' || c === 'geradores' || c === 'iniciantes') await app.screenshot(path.join(EVID, `categoria-${c}.png`));
      }
      assert.deepEqual(contagem, { basic: 17, letters: 36, iniciantes: 5, hardware: 4, geradores: 6, criacoes: 0, favoritos: 0 });
      log.contagem = contagem;
    });

    await t.test('Hardware e Geradores no forgia_formas (MCP pelo próprio exe)', async () => {
      const mcp = new McpClient(EXE, perfil);
      try {
        await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
        mcp.notify('notifications/initialized');
        const r = await mcp.call('forgia_formas', {});
        const body = JSON.parse(r.content[0].text);
        const gen = body.tipos.filter((x) => x.categoria);
        assert.deepEqual(gen.map((x) => x.tipo), ['porca', 'parafuso', 'furo_parafuso', 'furo_inserto', 'engrenagem', 'grade', 'mola', 'dobradica', 'texto_curvo', 'caixa_com_tampa']);
        assert.deepEqual(gen.filter((x) => x.nasce_como_furo).map((x) => x.tipo), ['furo_parafuso', 'furo_inserto']);
        const porca = gen.find((x) => x.tipo === 'porca');
        assert.deepEqual(porca.params.rosca.opcoes, ['lisa', 'real']);
        log.formas = { total: body.tipos.length, geradores: gen.map((x) => `${x.tipo} (${x.categoria})`) };
      } finally {
        await mcp.close();
      }
    });

    await t.test('abrir cada Iniciante: arrastar para a mesa dá o grupo editável', async () => {
      await escolher(app, 'iniciantes');
      const nomes = await app.js(`[...document.querySelectorAll('#lib-grid .tile')].map((e) => e.dataset.label)`);
      assert.deepEqual(nomes, ['Chaveiro com nome', 'Suporte de celular', 'Caixa com tampa', 'Boneco de neve', 'Foguete']);
      const res = [];
      for (const nome of nomes) {
        await app.js('(forgia.editor.loadProject(null), true)');
        await drag(app, await tileAt(app, `#lib-grid .tile[data-label="${nome}"]`), await mesa(app));
        const o = await app.js(`(() => { const o = forgia.editor.objects[0]; return o && { nome: o.name, tipo: o.type, partes: o.children.length, sel: forgia.editor.selection[0] === o.id }; })()`);
        assert.ok(o && o.tipo === 'group' && o.nome === nome && o.sel, `${nome}: ${JSON.stringify(o)}`);
        const un = await cmd(app, 'desagrupar', { ids: [await app.js('forgia.editor.objects[0].id')] });
        assert.ok(un.ok, `${nome} desagrupa`);
        await app.js('forgia.editor.undo()');
        res.push({ nome, partes: o.partes });
        await app.js('(forgia.editor.fitView(), true)');
        await wait(600);
        await app.screenshot(path.join(EVID, `iniciante-${res.length}.png`));
      }
      log.iniciantes = res;
    });

    await t.test('favoritar: a estrela junta em Favoritos e vale depois de reabrir', async () => {
      await escolher(app, 'hardware');
      await app.js(`document.querySelector('#lib-grid .tile[data-label="Porca sextavada"] .tile-fav').click()`);
      await escolher(app, 'basic');
      await app.js(`document.querySelector('#lib-grid .tile[data-label="Cilindro"] .tile-fav').click()`);
      await escolher(app, 'favoritos');
      assert.deepEqual(await app.js(`[...document.querySelectorAll('#lib-grid .tile')].map((e) => e.dataset.label).sort()`), ['Cilindro', 'Porca sextavada']);
      await app.screenshot(path.join(EVID, 'favoritos.png'));
    });

    await t.test('Suas criações: salvar a seleção, reabrir o Forgia e usar de novo; renomear e excluir', async () => {
      await app.js('(forgia.editor.loadProject(null), true)');
      const r = await cmd(app, 'lote', { comandos: [
        { cmd: 'criar', ref: 'a', tipo: 'caixa', medidas: [30, 20, 6], cor: '#8e44ad', nome: 'base' },
        { cmd: 'criar', ref: 'b', tipo: 'cilindro', medidas: [8, 8, 12], sobre: '$a', cor: '#f7c511', nome: 'pino' },
        { cmd: 'selecionar', ids: ['$a', '$b'] },
      ] });
      assert.ok(r.ok);
      await escolher(app, 'criacoes');
      assert.equal(await app.js(`document.getElementById('btn-salvar-criacao').hidden`), false);
      await app.js(`document.getElementById('btn-salvar-criacao').click()`);
      await app.waitFor(`!!document.querySelector('[data-criacao="nome"]')`, 5000, 'diálogo');
      await app.js(`document.querySelector('[data-criacao="nome"]').value = 'Minha base com pino'`);
      await app.js(`document.querySelector('[data-escolha="salvar-criacao"]').click()`);
      await app.waitFor(`!!document.querySelector('#lib-grid .tile[data-label="Minha base com pino"]')`, 10000, 'criação na biblioteca');
      const arquivos = fs.readdirSync(path.join(perfil, 'criacoes'));
      assert.ok(arquivos.some((f) => f.endsWith('.forgia')) && arquivos.includes('indice.json'), `pasta fixa criacoes: ${arquivos}`);
      await app.close();
      app = await Forgia.open(EXE, perfil);
      await app.js('(forgia.editor.loadProject(null), true)');
      await escolher(app, 'criacoes');
      await app.waitFor(`!!document.querySelector('#lib-grid .tile[data-label="Minha base com pino"]')`, 10000, 'criação depois de reabrir');
      await drag(app, await tileAt(app, '#lib-grid .tile[data-label="Minha base com pino"]'), await mesa(app));
      const o = await app.js(`(() => { const o = forgia.editor.objects[0]; return o && { nome: o.name, tipo: o.type, partes: o.children.map((c) => c.name) }; })()`);
      assert.deepEqual(o, { nome: 'Minha base com pino', tipo: 'group', partes: ['base', 'pino'] });
      await app.screenshot(path.join(EVID, 'criacao-usada.png'));
      // renomear e excluir pelos botões do bloco
      await app.js(`document.querySelector('#lib-grid .tile[data-label="Minha base com pino"] .tile-ren').click()`);
      await app.waitFor(`!!document.querySelector('[data-criacao="nome"]')`, 5000, 'renomear');
      await app.js(`document.querySelector('[data-criacao="nome"]').value = 'Base renomeada'`);
      await app.js(`document.querySelector('[data-escolha="renomear-criacao"]').click()`);
      await app.waitFor(`!!document.querySelector('#lib-grid .tile[data-label="Base renomeada"]')`, 5000, 'renomeada');
      await app.js(`document.querySelector('#lib-grid .tile[data-label="Base renomeada"] .tile-del').click()`);
      await app.waitFor(`!!document.querySelector('.modal .btn.primary')`, 5000, 'confirmar exclusão');
      await app.js(`document.querySelector('.modal .btn.primary').click()`);
      await app.waitFor(`document.querySelectorAll('#lib-grid .tile').length === 0`, 5000, 'excluída');
      // favoritos continuam depois de reabrir
      await escolher(app, 'favoritos');
      assert.deepEqual(await app.js(`[...document.querySelectorAll('#lib-grid .tile')].map((e) => e.dataset.label).sort()`), ['Cilindro', 'Porca sextavada']);
    });

    await t.test('Hardware no inspetor: M e rosca em lista; a medida acompanha; dica de rosca fina', async () => {
      await app.js('(forgia.editor.loadProject(null), true)');
      await escolher(app, 'hardware');
      await drag(app, await tileAt(app, '#lib-grid .tile[data-label="Porca sextavada"]'), await mesa(app));
      const antes = await app.js('forgia.editor.objects[0].size');
      assert.ok(await app.js(`!!document.querySelector('#inspector select[data-param="m"]')`), 'lista da medida M');
      assert.equal(await app.js(`document.querySelector('#inspector [data-dica-peca="nut"]').classList.contains('aviso')`), true, 'M3 com rosca real: dica em destaque');
      await app.js(`(() => { const s = document.querySelector('#inspector select[data-param="m"]'); s.value = '8'; s.dispatchEvent(new Event('change')); })()`);
      await wait(300);
      const depois = await app.js('forgia.editor.objects[0].size');
      assert.equal(Math.round(depois[0] * 100) / 100, 13, 'M8: 13 mm entre faces');
      assert.ok(depois[0] > antes[0]);
      assert.equal(await app.js(`document.querySelector('#inspector [data-dica-peca="nut"]').classList.contains('aviso')`), false, 'M8: sem destaque');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await app.js('(forgia.editor.fitView(), true)');
        await wait(700);
        await app.screenshot(path.join(EVID, `porca-inspetor-${tema}.png`));
      }
    });

    await t.test('porca M3 com rosca real encaixa no parafuso M3 do Forgia (e meio passo fora colide)', async () => {
      const base = [
        { cmd: 'criar', tipo: 'parafuso', params: { m: 3, comprimento: 10 }, centro: [0, 0, null], base_z: 0, nome: 'parafuso M3' },
      ];
      const ok = await sobreposicao(app, [...base, { cmd: 'criar', tipo: 'porca', params: { m: 3 }, centro: [0, 0, null], base_z: 4, nome: 'porca M3' }]);
      const est = await cmd(app, 'estado', { filhos: true });
      log.medidasM3 = est.objetos[0].filhos.map((f) => ({ nome: f.nome, medidas: f.medidas }));
      await app.js('(forgia.editor.select([]), forgia.editor.fitView(), true)');
      await wait(700);
      await app.screenshot(path.join(EVID, 'porca-no-parafuso.png'));
      const fora = await sobreposicao(app, [...base, { cmd: 'criar', tipo: 'porca', params: { m: 3 }, centro: [0, 0, null], base_z: 4.25, nome: 'porca M3 meio passo' }]);
      log.rosca = { encaixada: ok, meioPasso: fora };
      // encaixada: soma = união (ruído da booleana ~1e-5 mm³); meio passo fora: os filetes se
      // cruzam (a rosca M3 é miúda: ~0,24 mm³, ainda 4 ordens acima do ruído)
      assert.ok(Math.abs(ok.sobra) < 0.001, `sem sobreposição: soma ${ok.soma.toFixed(4)} × união ${ok.uniao.toFixed(4)} mm³`);
      assert.ok(fora.sobra > 0.05, `contraprova colide: ${fora.sobra.toFixed(4)} mm³`);
    });

    await t.test('duas engrenagens do mesmo módulo engrenam (centros a m·(z1+z2)/2; sem o meio dente colide)', async () => {
      const g1 = { cmd: 'criar', tipo: 'engrenagem', params: { modulo: 1.5, dentes: 20, furo: 5 }, centro: [0, 0, null], base_z: 0, nome: 'z20' };
      const dist = (1.5 * (20 + 12)) / 2;
      const ok = await sobreposicao(app, [g1, { cmd: 'criar', tipo: 'engrenagem', params: { modulo: 1.5, dentes: 12, furo: 5 }, centro: [dist, 0, null], base_z: 0, rotacao: [0, 0, 180 / 12], nome: 'z12' }]);
      const colide = await sobreposicao(app, [g1, { cmd: 'criar', tipo: 'engrenagem', params: { modulo: 1.5, dentes: 12, furo: 5 }, centro: [dist, 0, null], base_z: 0, nome: 'z12 sem giro' }]);
      log.engrenagens = { distancia: dist, engrenadas: ok, semGiro: colide };
      assert.ok(Math.abs(ok.sobra) < 0.01, `sem sobreposição: soma ${ok.soma.toFixed(4)} × união ${ok.uniao.toFixed(4)} mm³`);
      assert.ok(colide.sobra > 5, `contraprova colide: ${colide.sobra.toFixed(2)} mm³`);
      await app.js('(forgia.editor.fitView(), true)');
      await wait(700);
      await app.screenshot(path.join(EVID, 'engrenagens.png'));
    });

    await t.test('hardware e geradores exportam em 3MF e voltam pelo leitor sem erro de malha', async () => {
      await app.js('(forgia.editor.loadProject(null), true)');
      const lugar = { porca: [-100, -60], parafuso: [-70, -60], engrenagem: [-20, -60], grade: [60, -60], mola: [-100, 10], dobradica: [-50, 10], texto_curvo: [20, 10], caixa_com_tampa: [30, 75] };
      const tipos = Object.keys(lugar);
      const r = await cmd(app, 'lote', { comandos: tipos.map((tipo) => ({ cmd: 'criar', tipo, centro: [...lugar[tipo], null], base_z: 0 })) });
      assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
      const b64 = await app.js(`(async () => { const r = await forgia.ui.make3MF(false); let s = ''; for (let i = 0; i < r.dados.length; i += 0x8000) s += String.fromCharCode.apply(null, r.dados.subarray(i, i + 0x8000)); return btoa(s); })()`);
      const file = path.join(EVID, 'geradores.3mf');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      // o que o fatiador confere: cada objeto do 3MF fechado e orientado (cada aresta em exatamente
      // 2 triângulos, em sentidos opostos) e sem triângulo degenerado
      const model = new TextDecoder().decode(unzipFiles(fs.readFileSync(file))['3D/3dmodel.model']);
      const objetos = [];
      for (const [, id, corpo] of model.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
        const tris = [...corpo.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
        const arestas = new Map();
        let degenerados = 0;
        for (const [a, b, c] of tris) {
          if (a === b || b === c || a === c) degenerados++;
          for (const [p, q] of [[a, b], [b, c], [c, a]]) arestas.set(`${p},${q}`, (arestas.get(`${p},${q}`) || 0) + 1);
        }
        let abertas = 0;
        for (const [k, n] of arestas) {
          const [p, q] = k.split(',');
          if (n !== 1 || arestas.get(`${q},${p}`) !== 1) abertas++;
        }
        objetos.push({ id, triangulos: tris.length, abertas, degenerados });
      }
      assert.equal(objetos.length, tipos.length, 'um objeto por peça');
      for (const o of objetos) assert.ok(o.abertas === 0 && o.degenerados === 0 && o.triangulos > 0, `objeto ${o.id}: ${JSON.stringify(o)}`);
      await escolher(app, 'geradores');
      for (const tema of ['claro', 'escuro']) {
        await app.js(`forgia.theme.set('${tema}', { save: false })`);
        await app.js('(forgia.editor.select([]), forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)');
        await wait(800);
        await app.screenshot(path.join(EVID, `geradores-${tema}.png`));
      }
      // de volta pelo leitor de 3MF do Forgia, numa cena vazia: a caixa do conjunto é a mesma
      const est = await cmd(app, 'estado');
      const caixa = [0, 1, 2].map((k) => Math.max(...est.objetos.map((o) => o.caixa.max[k])) - Math.min(...est.objetos.map((o) => o.caixa.min[k])));
      await app.js('(forgia.editor.loadProject(null), true)');
      const imp = await cmd(app, 'importar', { caminho: file, centro: [0, 0, null] });
      assert.ok(imp.ok, JSON.stringify(imp));
      const lida = imp.objetos[0].medidas;
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(lida[k] - caixa[k]) < 0.02, `3MF relido ${lida} × conjunto ${caixa}`);
      log.geradores3mf = { arquivo: file, bytes: fs.statSync(file).size, objetos, conjunto: caixa, relido: lida };
    });
  } finally {
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    await app.close();
  }
});
