// Pedidos de teste do manual da IA (aprovados pelo usuário) e a conferência das medidas pelo
// estado final do Forgia (forgia_estado com filhos: true; partes de grupo em coordenadas do mundo).
// Usado por tests/agente-real.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { unzipFiles } from '../src/zip.js';

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
  p5: boltInWall(),
  p6: gearPair(),
  // forgia_criar_encaixe e forgia_exportar_3mf por um agente real, numa peça pronta
  encaixe: fitAnd3mf(0.3),
};

// ---------------- Fase D ----------------

// eixo (direção de +Z local) de um objeto girado por rotacao [X, Y, Z] em graus, nos eixos fixos
// da mesa (gira em X, depois Y, depois Z), no sistema do usuário
function axisOf(rot = [0, 0, 0]) {
  const [a, b, c] = rot.map((d) => (d * Math.PI) / 180);
  let v = [0, -Math.sin(a), Math.cos(a)];
  v = [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
  v = [v[0] * Math.cos(c) - v[1] * Math.sin(c), v[0] * Math.sin(c) + v[1] * Math.cos(c), v[2]];
  return v;
}

// volume (mm³) das malhas do topo da cena, pelo divergente (renderer do exe)
const VOL = `(ids) => { const ed = forgia.editor; let v = 0; for (const id of ids) { const m = ed.meshes.get(id); m.updateMatrixWorld(true); const g = m.geometry; const p = g.attributes.position; const idx = g.index; const n = idx ? idx.count : p.count; const a = m.position.clone(), b = a.clone(), c = a.clone(); for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld); v += a.dot(b.clone().cross(c)) / 6; } } return v; }`;

// sobreposição de dois objetos (mm³) = soma dos volumes − volume da união. Desagrupa o que for
// preciso para os dois ficarem no topo, agrupa os dois e desfaz tudo no fim (o projeto volta igual).
async function overlap(app, api, ids) {
  let undo = 0;
  try {
    for (let guard = 0; guard < 5; guard++) {
      const fl = flat(await api('estado', { filhos: true }));
      const tops = [...new Set(ids.map((id) => fl.find((o) => o.id === id).topo).filter((t) => !ids.includes(t)))];
      if (!tops.length) break;
      const r = await api('desagrupar', { ids: tops });
      if (!r.ok) throw new Error('desagrupar: ' + r.erro);
      undo++;
    }
    const soma = await app.js(`(${VOL})(${JSON.stringify(ids)})`);
    const g = await api('agrupar', { ids });
    if (!g.ok) throw new Error('agrupar: ' + g.erro);
    undo++;
    const uniao = await app.js(`(${VOL})([${JSON.stringify(g.criados[0])}])`);
    return { soma: round(soma), uniao: round(uniao), sobra: Math.round((soma - uniao) * 1e4) / 1e4 };
  } finally {
    for (let i = 0; i < undo; i++) await api('desfazer');
  }
}

// pedido 5: furo_parafuso M3 com bolsão (ou furo + bolsão separados) deitado numa parede, no grupo
// dela, passando de fora a fora (ou até o oco), com o bolsão aberto numa face e dentro da parede
function boltInWall() {
  return {
    prompt: 'faça um furo para parafuso M3 com porca numa parede lateral',
    check(estado) {
      const all = flat(estado);
      const holes = all.filter((o) => o.furo && o.tipo === 'furo_parafuso' && o.params && o.params.m === 3);
      const res = { ok: false, motivo: null, objetosNoTopo: estado.objetos.length };
      if (!holes.length) return { ...res, motivo: 'sem furo_parafuso M3 (furo)' };
      for (const h of holes) {
        const v = axisOf(h.rotacao);
        const a = Math.abs(v[0]) > Math.abs(v[1]) ? 0 : 1;
        const horizontal = Math.abs(v[2]) < 0.1 && Math.abs(v[a]) > 0.99;
        const nutPocket = h.params.bolsao_porca === 'sim' || all.some((o) => o.furo && o.topo === h.topo && o.id !== h.id && (o.tipo === 'porca' || (o.tipo === 'poligono' && o.params && o.params.lados === 6)));
        const b = [0, 1, 2].filter((k) => k !== a);
        const c = center(h);
        // parede: sólido do mesmo grupo que o furo atravessa, com o furo aberto numa face dela
        const walls = all.filter((s) => !s.furo && s.tipo !== 'grupo' && s.topo === h.topo && s.id !== h.id && b.every((k) => c[k] > s.caixa.min[k] && c[k] < s.caixa.max[k]) && h.caixa.min[a] < s.caixa.max[a] && h.caixa.max[a] > s.caixa.min[a]);
        const info = { furo: { id: h.id, medidas: h.medidas, centro: h.centro, caixa: h.caixa, rotacao: h.rotacao || [0, 0, 0], params: h.params }, eixo: 'XY'[a], horizontal, bolsaoDePorca: nutPocket };
        for (const s of walls) {
          const outMax = h.caixa.max[a] >= s.caixa.max[a] - 0.05;
          const outMin = h.caixa.min[a] <= s.caixa.min[a] + 0.05;
          if (!outMax && !outMin) continue;
          // do lado de dentro: outra face da parede, ou um oco (furo) do mesmo grupo
          let w0 = s.caixa.min[a];
          let w1 = s.caixa.max[a];
          let through = outMax && outMin;
          if (!through) {
            const cav = all.find((o) => o.furo && o.id !== h.id && o.topo === h.topo && b.every((k) => c[k] > o.caixa.min[k] && c[k] < o.caixa.max[k]) && (outMax ? o.caixa.max[a] >= h.caixa.min[a] - 0.05 && o.caixa.max[a] < s.caixa.max[a] : o.caixa.min[a] <= h.caixa.max[a] + 0.05 && o.caixa.min[a] > s.caixa.min[a]));
            if (cav) {
              through = true;
              if (outMax) w0 = cav.caixa.max[a];
              else w1 = cav.caixa.min[a];
            }
          }
          if (!through) continue;
          // bolsão da porca na ponta −eixo local (base do furo): aberto (0 a 0,25 mm além da face)
          const up = v[a] > 0;
          const pocketEnd = up ? h.caixa.min[a] : h.caixa.max[a];
          const pocketFace = up ? w0 : w1;
          const alem = round(up ? pocketFace - pocketEnd : pocketEnd - pocketFace);
          const espessura = round(w1 - w0);
          const pocketOk = h.params.bolsao_porca !== 'sim' || (alem >= -0.01 && alem <= 0.25);
          const ok = horizontal && nutPocket && pocketOk;
          const out = { ...res, ...info, parede: { id: s.id, tipo: s.tipo, medidas: s.medidas, caixa: s.caixa, espessuraNoFuro: espessura }, bolsaoAlemDaFace: alem, ok, motivo: ok ? null : !horizontal ? 'furo não está deitado (eixo não é horizontal)' : !nutPocket ? 'sem bolsão para a porca' : 'bolsão da porca fechado dentro da parede ou longe da face' };
          if (ok) return out;
          res.melhor = out;
        }
        res.melhor = res.melhor || info;
      }
      return { ...res, ...(res.melhor || {}), ok: false, motivo: (res.melhor && res.melhor.motivo) || 'o furo M3 não atravessa uma parede do mesmo grupo' };
    },
  };
}

// pedido 6: engrenagem de 20 dentes e outra do mesmo módulo, eixos em Z, no mesmo plano, centros a
// m·(z1 + z2)/2 e sem sobreposição dos dentes (volume da união = soma, conferido no exe)
function gearPair() {
  return {
    prompt: 'faça uma engrenagem de 20 dentes encaixando noutra',
    async check(estado, _setup, { app, api }) {
      const all = flat(estado);
      const gears = all.filter((o) => o.tipo === 'engrenagem' && !o.furo);
      const res = { ok: false, objetosNoTopo: estado.objetos.length, engrenagens: gears.map((g) => ({ id: g.id, params: g.params, medidas: g.medidas, centro: g.centro, rotacao: g.rotacao || [0, 0, 0] })) };
      const g20 = gears.filter((g) => g.params.dentes === 20);
      let best = null;
      for (const a of g20) {
        for (const b of gears) {
          if (a === b || !near(a.params.modulo, b.params.modulo, 1e-6)) continue;
          const d = Math.hypot(a.centro[0] - b.centro[0], a.centro[1] - b.centro[1]);
          const want = (a.params.modulo * (a.params.dentes + b.params.dentes)) / 2;
          if (!best || Math.abs(d - want) < Math.abs(best.d - best.want)) best = { a, b, d, want };
        }
      }
      if (!best) return { ...res, motivo: g20.length ? 'sem outra engrenagem do mesmo módulo' : 'sem engrenagem de 20 dentes' };
      const { a, b, d, want } = best;
      const zOverlap = Math.min(a.caixa.max[2], b.caixa.max[2]) - Math.max(a.caixa.min[2], b.caixa.min[2]);
      const flat0 = (g) => !g.rotacao || (Math.abs(Math.sin((g.rotacao[0] * Math.PI) / 180)) < 1e-3 && Math.abs(Math.sin((g.rotacao[1] * Math.PI) / 180)) < 1e-3);
      const distOk = Math.abs(d - want) <= 0.05;
      const planeOk = zOverlap >= Math.min(a.medidas[2], b.medidas[2]) - 0.05;
      const axesOk = flat0(a) && flat0(b);
      const vol = distOk && planeOk && axesOk ? await overlap(app, api, [a.id, b.id]) : null;
      const noClash = !!vol && vol.sobra < 0.01;
      const ok = distOk && planeOk && axesOk && noClash;
      return {
        ...res,
        ok,
        motivo: ok ? null : !distOk ? `centros a ${round(d)} mm; deviam estar a ${round(want)} mm` : !planeOk ? 'as duas não estão no mesmo plano' : !axesOk ? 'eixos não são verticais' : 'os dentes se sobrepõem (fase errada)',
        par: { z: [a.params.dentes, b.params.dentes], modulo: a.params.modulo, distancia: round(d), esperada: round(want), sobreposicaoZ: round(zOverlap), volume: vol },
      };
    },
  };
}

// encaixe com folga f de uma peça pronta (caixa + cilindro) e o projeto exportado em 3MF
function fitAnd3mf(f) {
  return {
    async setup({ api, out }) {
      const r = await api('lote', { comandos: [
        { cmd: 'criar', ref: 'b', tipo: 'caixa', medidas: [30, 20, 10], cor: '#1b8bd2', nome: 'base' },
        { cmd: 'criar', ref: 'c', tipo: 'cilindro', medidas: [10, 10, 15], sobre: '$b', cor: '#1b8bd2', nome: 'pino' },
        { cmd: 'agrupar', ids: ['$b', '$c'], nome: 'peça', ref: 'g' },
      ] });
      const file = path.join(out, 'encaixe.3mf');
      fs.rmSync(file, { force: true });
      return { peca: r.objetos.find((o) => o.nome === 'peça'), file };
    },
    prompt: (s) => `crie um encaixe com folga de 0,3 mm para a peça que está na mesa e exporte o projeto em 3MF para ${s.file}`,
    check(estado, s) {
      const all = flat(estado);
      const copia = all.find((o) => o.furo && o.topo !== s.peca.id && o.tipo === 'grupo' && [0, 1, 2].every((k) => near(o.medidas[k], s.peca.medidas[k] + 2 * f, 0.02)));
      const bloco = copia && all.find((o) => !o.furo && o.topo === copia.topo && o.tipo === 'caixa');
      let tresmf = null;
      if (fs.existsSync(s.file)) {
        const model = new TextDecoder().decode(unzipFiles(fs.readFileSync(s.file))['3D/3dmodel.model'] || new Uint8Array());
        tresmf = { bytes: fs.statSync(s.file).size, objetos: (model.match(/<object /g) || []).length, cores: (model.match(/<base /g) || []).length };
      }
      const ok = !!(copia && bloco && tresmf && tresmf.objetos === estado.objetos.length);
      return {
        ok,
        motivo: ok ? null : !copia ? `sem cópia da peça como furo com +${2 * f} mm` : !bloco ? 'sem bloco no encaixe' : !tresmf ? 'o 3MF não foi gravado' : '3MF sem uma peça por objeto',
        peca: s.peca.medidas,
        copia: copia ? { medidas: copia.medidas, caixa: copia.caixa } : null,
        bloco: bloco ? { medidas: bloco.medidas, caixa: bloco.caixa } : null,
        tresmf,
        objetosNoTopo: estado.objetos.length,
      };
    },
  };
}

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
      // Fase D: a caixa paramétrica (caixa_com_tampa), inteira ou em duas (pecas caixa + tampa)
      const gens = all.filter((o) => o.tipo === 'caixa_com_tampa' && o.params);
      const dimsOk = (p) => ((near(p.largura, X, 0.01) && near(p.profundidade, Y, 0.01)) || (near(p.largura, Y, 0.01) && near(p.profundidade, X, 0.01))) && near(p.altura, Z, 0.01);
      const folgaOk = (p) => p.folga > 0.05 && p.folga <= 1;
      const whole = gens.find((g) => g.params.pecas === 'caixa_e_tampa' && dimsOk(g.params) && folgaOk(g.params));
      const pair = [gens.find((g) => g.params.pecas === 'caixa' && dimsOk(g.params)), gens.find((g) => g.params.pecas === 'tampa' && dimsOk(g.params))];
      const pairOk = pair[0] && pair[1] && pair[0].params.folga === pair[1].params.folga && folgaOk(pair[0].params);
      if (whole || pairOk || gens.length) {
        const g = whole || pair[0] || gens[0];
        const p = g.params;
        // medidas no retorno: lado a lado 2 × largura + 5; altura da caixa = altura − tampa
        const medidasOk = !whole || (near(g.medidas[0], 2 * p.largura + 5, 0.05) && near(g.medidas[1], p.profundidade, 0.05) && near(g.medidas[2], Math.max(p.altura - p.tampa, p.tampa + p.aba), 0.05));
        const ok = !!((whole || pairOk) && medidasOk);
        return {
          ok,
          motivo: ok ? null : !(whole || pairOk) ? `caixa_com_tampa sem ${X}×${Y}×${Z} e folga entre 0,05 e 1 mm` : 'medidas do retorno não batem com os params',
          modo: 'caixa paramétrica (caixa_com_tampa)',
          corpo: { largura: p.largura, profundidade: p.profundidade, altura: p.altura, parede: p.parede },
          folga: { tipo: 'aba dentro da caixa', porLado: [p.folga, p.folga] },
          medidas: g.medidas,
          objetosNoTopo: estado.objetos.length,
        };
      }
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
