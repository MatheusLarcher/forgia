// O manual da IA confere com o Forgia.exe de verdade: todo exemplo de lote do guia e das receitas
// roda sem erro, as medidas que o texto promete saem certas, e as orientações descritas (cunha,
// rotacao de placa e de cilindro) são as que o programa faz.
//   FORGIA_EXE=release\fase-c\win-unpacked\Forgia.exe node --test tests/manual-exe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { exePath, tempProfile, Forgia, bridgeRequest, wait } from './forgia-exe.mjs';
import { lotes } from './mcp-manual.test.mjs';
import { SCENARIOS } from './agente-pedidos.mjs';

const require = createRequire(import.meta.url);
const { GUIA, SECTIONS } = require('../electron/mcp/manual.cjs');
const EXE = exePath();

test('manual × Forgia.exe', { skip: !EXE && 'defina FORGIA_EXE com o Forgia.exe gerado', timeout: 180000 }, async (t) => {
  const profile = tempProfile('forgia-manual-');
  const app = await Forgia.open(EXE, profile, {});
  const api = async (cmd, args = {}) => (await bridgeRequest(app.bridge.porta, { token: app.bridge.token, cmd, args })).json;
  const clear = async () => {
    const st = await api('estado');
    if (st.objetos.length) await api('excluir', { ids: st.objetos.map((o) => o.id) });
  };
  // alturas (Z do usuário) e Y do usuário dos vértices da malha de um objeto, do jeito que ela é desenhada
  const extremes = (id) => app.js(`(() => { const m = forgia.editor.meshes.get(${JSON.stringify(id)}); m.updateMatrixWorld(true); const p = m.geometry.attributes.position, v = new m.position.constructor(); let top = null, bot = null; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const z = v.y, y = -v.z; if (!top || z > top.z + 1e-6) top = { z, y }; if (!bot || z < bot.z - 1e-6) bot = { z, y }; } return { top, bot }; })()`);
  try {
    await t.test('todos os lotes do guia e das receitas rodam sem erro', async () => {
      const all = [...lotes(GUIA), ...lotes(SECTIONS.receitas)];
      for (const src of all) {
        await clear();
        const r = await api('lote', JSON.parse(src));
        assert.equal(r.ok, true, `${src.slice(0, 80)}… → ${JSON.stringify(r).slice(0, 300)}`);
      }
    });

    await t.test('suporte do guia: 80 mm em X e furo 8×8×7 no centro, como o texto diz', async () => {
      await clear();
      const r = await api('lote', JSON.parse(lotes(GUIA)[0]));
      const g = r.objetos.find((o) => o.tipo === 'grupo');
      assert.deepEqual([g.caixa.min[0], g.caixa.max[0]], [-40, 40]);
      const st = await api('estado', { filhos: true });
      const furo = st.objetos[0].filhos.find((c) => c.furo);
      assert.deepEqual(furo.medidas, [8, 8, 7]);
      assert.deepEqual(furo.centro.slice(0, 2), [0, 0]);
      assert.equal(SCENARIOS.p1.check(st).ok, true, 'o próprio exemplo passa na conferência do pedido 1');
    });

    await t.test('caixa com tampa da receita: folga de 0,2 mm por lado', async () => {
      await clear();
      const src = lotes(SECTIONS.receitas).find((s) => s.includes('"tampo"'));
      await api('lote', JSON.parse(src));
      const check = SCENARIOS.p3.check(await api('estado', { filhos: true }));
      assert.equal(check.ok, true, JSON.stringify(check));
      assert.deepEqual(check.folga.porLado, [0.2, 0.2]);
    });

    await t.test('chaveiro da receita: texto sobre a base e argola', async () => {
      await clear();
      const src = lotes(SECTIONS.receitas).find((s) => s.includes('"ANA"'));
      await api('lote', JSON.parse(src));
      const check = SCENARIOS.p2.check(await api('estado', { filhos: true }));
      assert.equal(check.ok, true, JSON.stringify(check));
    });

    await t.test('orientações do guia: cunha sobe para o fundo; [-15,0,0] inclina o topo para o fundo; [90,0,0] deita o cilindro em Y', async () => {
      await clear();
      const r = await api('lote', { comandos: [
        { cmd: 'criar', ref: 'c', tipo: 'cunha', medidas: [20, 20, 20] },
        { cmd: 'criar', ref: 'p', tipo: 'caixa', medidas: [80, 6, 70], rotacao: [-15, 0, 0], centro: [60, 0, null] },
        { cmd: 'criar', ref: 'k', tipo: 'cilindro', medidas: [8, 8, 30], rotacao: [90, 0, 0], centro: [-60, 0, 10] },
      ] });
      const [c, p, k] = r.criados;
      const wedge = await extremes(c);
      // a base da cunha ocupa o Y inteiro (−10 a 10): o que conta é o topo ficar no fundo (+Y)
      assert.ok(wedge.top.y > 0, `cunha centrada em Y 0: topo em Y ${wedge.top.y}`);
      const plate = await extremes(p);
      assert.ok(plate.top.y > plate.bot.y, `placa: topo em Y ${plate.top.y}, base em Y ${plate.bot.y}`);
      const cyl = r.objetos.find((o) => o.id === k);
      const size = [0, 1, 2].map((i) => Math.round((cyl.caixa.max[i] - cyl.caixa.min[i]) * 100) / 100);
      assert.deepEqual(size, [8, 30, 8], 'cilindro deitado ao longo de Y');
    });
  } finally {
    await app.close();
    await wait(500);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
});
