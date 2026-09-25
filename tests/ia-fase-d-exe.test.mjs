// IA da Fase D no Forgia.exe gerado (perfil temporário), pelo MCP do próprio exe:
// forgia_criar_encaixe (sozinho e no lote com "$ref", erros que ensinam, um desfazer),
// forgia_exportar_3mf (arquivo gravado pelo main, uma peça por objeto e cores; caminho recusado),
// hardware e geradores pelo forgia_criar (medidas saindo dos params) e o manual novo.
//   FORGIA_EXE=release\fase-d\win-unpacked\Forgia.exe node --test tests/ia-fase-d-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Forgia, McpClient, exePath, tempProfile, ROOT } from './forgia-exe.mjs';
import { unzipFiles } from '../src/zip.js';

const EXE = exePath();
const skip = !EXE && 'defina FORGIA_EXE (exe gerado da Fase D)';
const EVID = path.join(ROOT, 'docs', 'fase-d-evidence', 'ia');
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test('IA da Fase D pelo MCP do exe', { skip, timeout: 300000 }, async (t) => {
  fs.mkdirSync(EVID, { recursive: true });
  const perfil = tempProfile('forgia-fase-d-ia-');
  const app = await Forgia.open(EXE, perfil);
  const mcp = new McpClient(EXE, perfil);
  const call = async (name, args) => {
    const r = await mcp.call(name, args);
    return { erro: !!r.isError, body: JSON.parse(r.content.find((c) => c.type === 'text').text) };
  };
  const log = {};
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
    mcp.notify('notifications/initialized');

    await t.test('instructions ≤ 2 KB com hardware, encaixe e 3MF; 24 ferramentas', async () => {
      const ins = init.result.instructions;
      log.instructionsBytes = Buffer.byteLength(ins, 'utf8');
      assert.ok(log.instructionsBytes <= 2048, `${log.instructionsBytes} bytes`);
      assert.match(ins, /forgia_criar_encaixe/);
      assert.match(ins, /forgia_exportar_3mf/);
      const list = await mcp.request('tools/list', {});
      const names = list.result.tools.map((x) => x.name);
      assert.equal(names.length, 24);
      for (const n of ['forgia_criar_encaixe', 'forgia_exportar_3mf']) assert.ok(names.includes(n), n);
      const guia = (await mcp.call('forgia_manual', {})).content[0].text;
      assert.match(guia, /## Hardware e geradores/);
      const rec = (await mcp.call('forgia_manual', { secao: 'receitas' })).content[0].text;
      assert.match(rec, /Par de engrenagens/);
    });

    let peca;
    await t.test('forgia_criar_encaixe: bloco e cópia com 0,25 mm, um desfazer', async () => {
      const r = await call('forgia_lote', { comandos: [
        { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [30, 20, 10], nome: 'base' },
        { cmd: 'criar', ref: 'c', tipo: 'cilindro', medidas: [10, 10, 15], sobre: '$b', nome: 'pino' },
        { cmd: 'agrupar', ids: ['$b', '$c'], nome: 'peça', ref: 'g' },
      ] });
      assert.equal(r.erro, false);
      peca = r.body.objetos.find((o) => o.nome === 'peça');
      const h0 = await app.js('forgia.editor.historyIndex');
      const e = await call('forgia_criar_encaixe', { id: peca.id });
      assert.equal(e.erro, false, JSON.stringify(e.body));
      assert.equal(await app.js('forgia.editor.historyIndex') - h0, 1, 'um passo de desfazer');
      const enc = e.body.encaixes[0];
      assert.equal(enc.folga, 0.25);
      assert.equal(enc.margem, 3);
      assert.equal(enc.folga_exata, true);
      const by = Object.fromEntries(e.body.objetos.map((o) => [o.id, o]));
      const bloco = by[enc.bloco];
      const copia = by[enc.copia];
      assert.equal(by[enc.grupo].nome, 'Encaixe de peça');
      assert.equal(copia.furo, true);
      for (let k = 0; k < 3; k++) assert.ok(near(copia.medidas[k], peca.medidas[k] + 0.5), `cópia ${copia.medidas}`);
      assert.ok(near(bloco.medidas[0], peca.medidas[0] + 6) && near(bloco.medidas[1], peca.medidas[1] + 6), `bloco ${bloco.medidas}`);
      assert.ok(near(bloco.caixa.min[2], 0), 'bloco na mesa');
      assert.ok(copia.caixa.max[2] > bloco.caixa.max[2], 'aberto em cima');
      assert.deepEqual(e.body.criados.sort(), [enc.grupo, enc.bloco, enc.copia].sort());
      log.encaixe = { peca: peca.medidas, bloco: bloco.medidas, copia: copia.medidas, avisos: e.body.avisos || [] };
      const u = await call('forgia_desfazer', {});
      assert.equal(u.body.feito, true);
      assert.equal(await app.js('forgia.editor.objects.length'), 1, 'desfazer tira o encaixe inteiro');
    });

    await t.test('criar_encaixe no lote com $ref e folga 0,4; malha/gerador avisa folga aproximada', async () => {
      const r = await call('forgia_lote', { comandos: [
        { cmd: 'criar', ref: 'p', tipo: 'porca', params: { m: 5 }, centro: [0, 80, null], nome: 'porca M5' },
        { cmd: 'criar_encaixe', id: '$p', folga: 0.4, ref: 'e', nome: 'soquete da porca' },
        { cmd: 'alterar', id: '$e', mover: [0, 0, 0] },
      ] });
      assert.equal(r.erro, false, JSON.stringify(r.body));
      const enc = r.body.encaixes[0];
      assert.equal(enc.folga, 0.4);
      assert.equal(enc.folga_exata, false);
      assert.match(r.body.avisos.join(' '), /Folga aproximada/);
      const g = r.body.objetos.find((o) => o.id === enc.grupo);
      assert.equal(g.nome, 'soquete da porca');
      const porca = r.body.objetos.find((o) => o.nome === 'porca M5');
      const copia = r.body.objetos.find((o) => o.id === enc.copia);
      for (let k = 0; k < 3; k++) assert.ok(near(copia.medidas[k], porca.medidas[k] + 0.8), `cópia ${copia.medidas} × porca ${porca.medidas}`);
      log.encaixeGerador = { porca: porca.medidas, copia: copia.medidas, avisos: r.body.avisos };
    });

    await t.test('criar_encaixe: erros que ensinam e nada muda', async () => {
      const n0 = await app.js('forgia.editor.objects.length');
      const semId = await call('forgia_criar_encaixe', {});
      assert.equal(semId.erro, true);
      assert.match(semId.body.erro, /precisa de "id"/);
      assert.ok(semId.body.exemplo);
      const folga = await call('forgia_criar_encaixe', { id: peca.id, folga: 2 });
      assert.equal(folga.erro, true);
      assert.match(folga.body.erro, /folga = 2 está fora do limite \(0 a 1\)/);
      const furo = await call('forgia_criar', { tipo: 'cilindro', medidas: [5, 5, 5], furo: true, centro: [80, 0, null] });
      const deFuro = await call('forgia_criar_encaixe', { id: furo.body.criados[0] });
      assert.equal(deFuro.erro, true);
      assert.match(deFuro.body.erro, /é um furo/);
      await call('forgia_desfazer', {});
      assert.equal(await app.js('forgia.editor.objects.length'), n0);
    });

    await t.test('forgia_exportar_3mf: gravado pelo main, uma peça por objeto, com as cores', async () => {
      await app.js('(forgia.editor.loadProject(null), true)');
      const r = await call('forgia_lote', { comandos: [
        { cmd: 'criar', tipo: 'caixa', medidas: [20, 20, 10], cor: '#e3302d', centro: [-30, 0, null], nome: 'vermelha' },
        { cmd: 'criar', tipo: 'engrenagem', params: { modulo: 1.5, dentes: 20 }, cor: '#1b8bd2', nome: 'engrenagem' },
        { cmd: 'criar', tipo: 'porca', params: { m: 3 }, cor: '#3fb34f', centro: [30, 0, null], nome: 'porca' },
      ] });
      assert.equal(r.erro, false);
      const file = path.join(EVID, 'tres-pecas.3mf');
      fs.rmSync(file, { force: true });
      const e = await call('forgia_exportar_3mf', { caminho: file });
      assert.equal(e.erro, false, JSON.stringify(e.body));
      assert.equal(e.body.caminho, file);
      assert.equal(e.body.objetos, 3);
      assert.deepEqual(e.body.cores, ['#e3302d', '#1b8bd2', '#3fb34f']);
      assert.equal(e.body.bytes, fs.statSync(file).size);
      assert.equal(e.body.tresmf, undefined, 'os bytes não vão para o agente');
      const model = new TextDecoder().decode(unzipFiles(fs.readFileSync(file))['3D/3dmodel.model']);
      assert.equal((model.match(/<object /g) || []).length, 3);
      assert.equal((model.match(/<base /g) || []).length, 3);
      const so = await call('forgia_exportar_3mf', { caminho: path.join(EVID, 'so-porca.3mf'), ids: [r.body.criados[2]] });
      assert.equal(so.body.objetos, 1);
      log.tresmf = { arquivo: file, bytes: e.body.bytes, pecas: e.body.pecas, cores: e.body.cores };
      // reimportado: mesmas medidas do conjunto
      const imp = await call('forgia_importar', { caminho: file, centro: [0, 80, null] });
      assert.equal(imp.erro, false);
      const est = await call('forgia_estado', {});
      const orig = est.body.objetos.slice(0, 3);
      const caixa = [0, 1, 2].map((k) => Math.max(...orig.map((o) => o.caixa.max[k])) - Math.min(...orig.map((o) => o.caixa.min[k])));
      for (let k = 0; k < 3; k++) assert.ok(near(imp.body.objetos[0].medidas[k], caixa[k]), `reimportado ${imp.body.objetos[0].medidas} × ${caixa}`);
    });

    await t.test('forgia_exportar_3mf: caminho relativo, extensão errada e pasta que não existe são recusados', async () => {
      const rel = await call('forgia_exportar_3mf', { caminho: 'pecas.3mf' });
      assert.equal(rel.erro, true);
      assert.match(rel.body.erro, /absoluto/);
      const ext = await call('forgia_exportar_3mf', { caminho: path.join(EVID, 'pecas.stl') });
      assert.equal(ext.erro, true);
      assert.match(ext.body.erro, /terminar em \.3mf/);
      const dir = await call('forgia_exportar_3mf', { caminho: path.join(EVID, 'nao-existe', 'x.3mf') });
      assert.equal(dir.erro, true);
      assert.match(dir.body.erro, /A pasta não existe/);
      assert.equal(fs.existsSync(path.join(EVID, 'pecas.stl')), false);
    });

    await t.test('receitas do manual rodam como estão e batem com o "Confira no retorno"', async () => {
      const rec = (await mcp.call('forgia_manual', { secao: 'receitas' })).content[0].text;
      const lots = [];
      for (let i = rec.indexOf('{"comandos":['); i >= 0; i = rec.indexOf('{"comandos":[', i + 1)) {
        let depth = 0;
        let j = i;
        for (; j < rec.length; j++) if (rec[j] === '{') depth++;
        else if (rec[j] === '}' && --depth === 0) break;
        lots.push(JSON.parse(rec.slice(i, j + 1)));
      }
      const out = {};
      for (const l of lots) {
        await app.js('(forgia.editor.loadProject(null), true)');
        const r = await call('forgia_lote', l);
        assert.equal(r.erro, false, JSON.stringify(r.body).slice(0, 300));
        const by = (nome) => r.body.objetos.find((o) => o.nome === nome);
        if (by('caixa com tampa')) out.caixa = by('caixa com tampa').medidas;
        if (by('furo M3')) out.furoM3 = by('furo M3').caixa;
        if (by('engrenagem 20 dentes')) {
          const g1 = by('engrenagem 20 dentes');
          const g2 = by('engrenagem 12 dentes');
          const vol = `(ids) => ids.reduce((v, id) => { const m = forgia.editor.meshes.get(id); m.updateMatrixWorld(true); const g = m.geometry; const p = g.attributes.position; const ix = g.index; const n = ix ? ix.count : p.count; const a = m.position.clone(), b = a.clone(), c = a.clone(); for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(p, ix ? ix.getX(i) : i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, ix ? ix.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, ix ? ix.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld); v += a.dot(b.clone().cross(c)) / 6; } return v; }, 0)`;
          const soma = await app.js(`(${vol})(${JSON.stringify([g1.id, g2.id])})`);
          const grp = await call('forgia_agrupar', { ids: [g1.id, g2.id] });
          const uniao = await app.js(`(${vol})([${JSON.stringify(grp.body.criados[0])}])`);
          out.engrenagens = { medidas: [g1.medidas, g2.medidas], centros: [g1.centro, g2.centro], sobra: soma - uniao };
        }
      }
      assert.equal(lots.length, 4, `${lots.length} lotes nas receitas (chaveiro, caixa com tampa, furo M3, engrenagens)`);
      assert.deepEqual(out.caixa, [125, 40, 28]);
      assert.ok(near(out.furoM3.min[0], 11.95) && near(out.furoM3.max[0], 20.05), `furo M3 ${JSON.stringify(out.furoM3)}`);
      assert.ok(near((out.furoM3.min[2] + out.furoM3.max[2]) / 2, 16.5), 'centro Z 16,5');
      assert.deepEqual(out.engrenagens.medidas, [[33, 33, 6], [21, 21, 6]]);
      assert.deepEqual(out.engrenagens.centros.map((c) => c[0]), [-12, 12]);
      assert.ok(Math.abs(out.engrenagens.sobra) < 0.01, `engrenagens da receita se sobrepõem ${out.engrenagens.sobra} mm³`);
      log.receitas = out;
    });

    await t.test('hardware e geradores pelo forgia_criar: medidas saem dos params', async () => {
      await app.js('(forgia.editor.loadProject(null), true)');
      const r = await call('forgia_lote', { comandos: [
        { cmd: 'criar', ref: 'p', tipo: 'porca', params: { m: 3 } },
        { cmd: 'criar', ref: 'f', tipo: 'furo_parafuso', params: { m: 3, comprimento: 8.1, cabeca: 'cilindrica', bolsao_porca: 'sim' }, rotacao: [0, 90, 0], centro: [40, 0, 15] },
        { cmd: 'criar', ref: 'c', tipo: 'caixa_com_tampa', params: { largura: 60, profundidade: 40, altura: 30, folga: 0.25 }, centro: [0, 60, null] },
      ] });
      assert.equal(r.erro, false, JSON.stringify(r.body));
      const [porca, furo, caixa] = r.body.criados.map((id) => r.body.objetos.find((o) => o.id === id));
      assert.deepEqual(porca.medidas, [5.5, 6.35, 2.4]);
      assert.equal(furo.furo, true, 'furo_parafuso nasce furo');
      assert.ok(near(furo.caixa.max[0] - furo.caixa.min[0], 8.1), 'deitado: comprimento em X');
      assert.deepEqual(caixa.medidas, [125, 40, 28]);
      log.hardware = { porca: porca.medidas, furo: { medidas: furo.medidas, caixa: furo.caixa }, caixaComTampa: caixa.medidas };
    });
  } finally {
    fs.writeFileSync(path.join(EVID, 'resultado.json'), JSON.stringify(log, null, 2));
    await mcp.close();
    await app.close();
  }
});
