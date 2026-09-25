// Pedidos de teste do manual da IA (aprovados pelo usuário) e a conferência das medidas pelo
// estado final do Forgia (forgia_estado com filhos: true; partes de grupo em coordenadas do mundo).
// Usado por tests/agente-real.mjs.

const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;
const size = (o) => [0, 1, 2].map((k) => o.caixa.max[k] - o.caixa.min[k]);
const center = (o) => [0, 1, 2].map((k) => (o.caixa.max[k] + o.caixa.min[k]) / 2);

// todos os objetos, com as partes de grupo, e quem é o topo de cada um
function flat(estado) {
  const out = [];
  const walk = (list, top) => {
    for (const o of list) {
      out.push({ ...o, topo: top || o.id });
      if (Array.isArray(o.filhos)) walk(o.filhos, top || o.id);
    }
  };
  walk(estado.objetos || [], null);
  return out;
}

const round = (v) => Math.round(v * 100) / 100;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const SCENARIOS = {
  // pedido 4: o usuário marca o topo da aba de um suporte pronto (Marcar parte, tecla N, cliques
  // reais), escreve "aumenta essa aba em 2 mm" e aperta Enter; o prompt do agente é exatamente o
  // texto copiado. Certo = só a aba cresce 2 mm para cima (base da aba parada), o resto não mexe.
  p4: {
    async setup({ app, api }) {
      const built = await api('lote', { comandos: [
        { cmd: 'criar', ref: 'base', tipo: 'caixa', medidas: [80, 60, 5], nome: 'base' },
        { cmd: 'criar', ref: 'aba', tipo: 'caixa', medidas: [80, 5, 40], sobre: '$base', centro: [null, 27.5, null], nome: 'aba' },
        { cmd: 'criar', ref: 'furo', tipo: 'cilindro', medidas: [8, 8, 5], centro: [0, -10, null], furo: true, nome: 'furo', params: { lados: 48 } },
        { cmd: 'agrupar', ids: ['$base', '$aba', '$furo'], nome: 'suporte', ref: 'sup' },
      ] });
      const ids = built.refs;
      const before = await api('estado', { ids: [ids.sup], filhos: true });
      await app.js('(forgia.editor.homeViewInstant(), forgia.editor.fitView(), true)');
      await wait(900);
      const key = async (k, code, vk) => {
        await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k.length === 1 ? k : undefined });
        await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await wait(120);
      };
      await app.mouse('mouseMoved', 5, 5);
      await key('n', 'KeyN', 78);
      // topo da aba: Z = 45 (y interno), meio da espessura (Y = 27,5 → z interno −27,5)
      const p = await app.js("(() => { const ed = forgia.editor; const c = ed.renderer.domElement.getBoundingClientRect(); const s = ed.project(new (ed.camera.position.constructor)(10, 45.01, -27.5)); return { x: c.x + s.x, y: c.y + s.y }; })()");
      await app.mouse('mouseMoved', p.x, p.y);
      await app.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
      await app.mouse('mouseReleased', p.x, p.y, { button: 'left', buttons: 0, clickCount: 1 });
      await wait(300);
      const mark = await app.js('forgia.editor.marks[0] && forgia.editor.marks[0].info()');
      if (!mark || !mark.parte || mark.parte.id !== ids.aba || mark.face !== '+Z') throw new Error('a marcação não caiu no topo da aba: ' + JSON.stringify(mark));
      await app.js('document.querySelector(".marca-chat textarea").focus(), true');
      await app.send('Input.insertText', { text: 'aumenta essa aba em 2 mm' });
      await key('Enter', 'Enter', 13);
      await wait(800);
      const copied = await app.js('forgia.editor.tools.mark.lastCopy');
      await key('Escape', 'Escape', 27);
      await key('Escape', 'Escape', 27);
      return { ids, before: before.objetos[0], prompt: copied.text };
    },
    prompt: (setup) => setup.prompt,
    check(estado, setup) {
      const g = estado.objetos.find((o) => o.id === setup.ids.sup) || estado.objetos[0];
      const part = (grp, id) => (grp && Array.isArray(grp.filhos) ? grp.filhos.find((c) => c.id === id) : null);
      const b = setup.before;
      const aba0 = part(b, setup.ids.aba);
      const aba1 = part(g, setup.ids.aba);
      const same = (x, y) => !!(x && y) && JSON.stringify(x.caixa) === JSON.stringify(y.caixa) && JSON.stringify(x.medidas) === JSON.stringify(y.medidas);
      const grewUp = !!(aba0 && aba1 && near(aba1.medidas[2], aba0.medidas[2] + 2, 0.01) && near(aba1.caixa.min[2], aba0.caixa.min[2], 0.01) && near(aba1.caixa.max[2], aba0.caixa.max[2] + 2, 0.01));
      const others = same(part(b, setup.ids.base), part(g, setup.ids.base)) && same(part(b, setup.ids.furo), part(g, setup.ids.furo));
      const xy = !!(aba0 && aba1 && near(aba1.medidas[0], aba0.medidas[0], 0.01) && near(aba1.medidas[1], aba0.medidas[1], 0.01));
      const ok = grewUp && others && xy && estado.objetos.length === 1;
      return {
        ok,
        motivo: ok ? null : !aba1 ? 'a aba sumiu ou saiu do grupo' : !grewUp ? 'a aba não cresceu 2 mm para cima' : !xy ? 'mudou outra medida da aba' : !others ? 'mexeu em outra parte' : 'o projeto ganhou ou perdeu objetos',
        abaAntes: aba0 ? { medidas: aba0.medidas, caixa: aba0.caixa } : null,
        abaDepois: aba1 ? { medidas: aba1.medidas, caixa: aba1.caixa } : null,
        outrasPartesIguais: others,
        objetosNoTopo: estado.objetos.length,
      };
    },
  },

  cubo: {
    prompt: 'faça um cubo de 20 mm',
    check(estado) {
      const all = flat(estado);
      const cube = all.find((o) => o.tipo === 'caixa' && !o.furo && o.medidas.every((v) => near(v, 20)));
      return { ok: !!cube && estado.objetos.length === 1, cubo: cube ? { medidas: cube.medidas, caixa: cube.caixa, apoiado_em: cube.apoiado_em } : null, objetos: estado.objetos.length, motivo: cube ? null : 'sem caixa 20×20×20' };
    },
  },

  p1: {
    prompt: 'faça um suporte de celular de 80 mm com furo de 8 mm no centro',
    check(estado) {
      const all = flat(estado);
      const holes = all.filter((o) => o.furo && near(o.medidas[0], 8) && near(o.medidas[1], 8));
      const tops = estado.objetos.filter((o) => !o.furo);
      const body = tops.find((o) => size(o).some((v) => near(v, 80, 0.5)));
      const hole = holes.find((h) => body && h.topo === body.id);
      const c = body && center(body);
      const hc = hole && hole.centro;
      const centered = !!(hole && near(hc[0], c[0], 1) && hc[1] >= body.caixa.min[1] && hc[1] <= body.caixa.max[1]);
      const ok = !!(body && hole && centered);
      return {
        ok,
        motivo: ok ? null : !body ? 'nenhuma peça com 80 mm' : !hole ? 'sem furo de 8 mm dentro da peça' : 'furo fora do centro em X',
        peca: body ? { id: body.id, tipo: body.tipo, caixa: body.caixa, tamanho: size(body).map(round) } : null,
        furo: hole ? { medidas: hole.medidas, centro: hole.centro, rotacao: hole.rotacao || [0, 0, 0] } : holes.map((h) => ({ medidas: h.medidas, centro: h.centro })),
        objetosNoTopo: estado.objetos.length,
      };
    },
  },

  p2: keychain('ANA'),
  // fora das receitas do manual (as receitas usam ANA e 60×40×30): confere se o agente generaliza
  p2b: keychain('LUCAS'),
  p3: lidBox(60, 40, 30),
  p3b: lidBox(80, 50, 25),
};

function keychain(name) {
  return {
    prompt: `faça um chaveiro com o nome ${name}`,
    check(estado) {
      const all = flat(estado);
      const text = all.find((o) => o.tipo === 'texto' && o.params && new RegExp(name, 'i').test(o.params.texto || ''));
      const solids = all.filter((o) => !o.furo && o.tipo !== 'texto' && o.tipo !== 'grupo');
      const tc = text && center(text);
      const base = text && solids.find((s) => tc[0] >= s.caixa.min[0] && tc[0] <= s.caixa.max[0] && tc[1] >= s.caixa.min[1] && tc[1] <= s.caixa.max[1]);
      const onTop = !!(text && base && (near(text.caixa.min[2], base.caixa.max[2], 0.3) || text.caixa.min[2] < base.caixa.max[2]));
      // argola: um furo na peça, ou um tubo/toroide (anel com furo no meio) na mesma peça
      const ring = all.find((o) => (o.furo || o.tipo === 'tubo' || o.tipo === 'toroide') && (!base || o.topo === base.topo));
      const ok = !!(text && base && onTop && ring);
      return {
        ok,
        motivo: ok ? null : !text ? `sem texto ${name}` : !base ? 'texto sem base embaixo' : !onTop ? 'texto solto da base' : 'sem furo para a argola',
        texto: text ? { medidas: text.medidas, caixa: text.caixa } : null,
        base: base ? { tipo: base.tipo, medidas: base.medidas, caixa: base.caixa } : null,
        argola: ring ? { tipo: ring.tipo, medidas: ring.medidas, centro: ring.centro } : null,
        objetosNoTopo: estado.objetos.length,
      };
    },
  };
}

// caixa X×Y×Z com tampa e folga: corpo com essas medidas (altura do corpo de 2/3 de Z até Z, tampa
// à parte), oco dentro e folga entre 0,05 e 1 mm por lado entre a tampa e a caixa
function lidBox(X, Y, Z) {
  return {
    prompt: `faça uma caixa de ${X}×${Y}×${Z} mm com tampa e folga`,
    check(estado) {
      const all = flat(estado);
      const tops = estado.objetos.filter((o) => !o.furo);
      const fits = (s, a, b) => near(s[0], a, 0.6) && near(s[1], b, 0.6) && s[2] >= (Z * 2) / 3 && s[2] <= Z + 0.6;
      const body = tops.find((o) => fits(size(o), X, Y)) || tops.find((o) => fits(size(o), Y, X));
      const cavity = body && all.filter((o) => o.furo && o.topo === body.id).sort((a, b) => size(b)[0] * size(b)[1] - size(a)[0] * size(a)[1])[0];
      const lid = body && tops.find((o) => o.id !== body.id && size(o)[0] >= 30 && size(o)[1] >= 30);
      let folga = null;
      if (cavity && lid) {
        // tampa com aba que entra na caixa: a aba é a parte sólida da tampa menor que a caixa
        const cs = size(cavity);
        const parts = all.filter((o) => o.topo === lid.id && !o.furo && o.tipo !== 'grupo');
        for (const p of parts) {
          const ps = size(p);
          const gx = (cs[0] - ps[0]) / 2;
          const gy = (cs[1] - ps[1]) / 2;
          if (gx > 0.05 && gx <= 1 && gy > 0.05 && gy <= 1) folga = { tipo: 'aba dentro da caixa', porLado: [round(gx), round(gy)] };
        }
        // tampa que veste por fora: o oco da tampa maior que a caixa
        const bs = size(body);
        for (const hole of all.filter((o) => o.topo === lid.id && o.furo)) {
          const hs = size(hole);
          const gx = (hs[0] - bs[0]) / 2;
          const gy = (hs[1] - bs[1]) / 2;
          if (gx > 0.05 && gx <= 1 && gy > 0.05 && gy <= 1) folga = { tipo: 'tampa por fora', porLado: [round(gx), round(gy)] };
        }
      }
      const ok = !!(body && cavity && lid && folga);
      return {
        ok,
        motivo: ok ? null : !body ? `sem corpo ${X}×${Y} (altura até ${Z})` : !cavity ? 'corpo sem oco' : !lid ? 'sem tampa' : 'sem folga entre 0,05 e 1 mm por lado',
        corpo: body ? { tamanho: size(body).map(round), caixa: body.caixa } : null,
        oco: cavity ? { tamanho: size(cavity).map(round) } : null,
        tampa: lid ? { tamanho: size(lid).map(round), caixa: lid.caixa } : null,
        folga,
        objetosNoTopo: estado.objetos.length,
      };
    },
  };
}
