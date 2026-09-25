// Worker do código livre da IA (forgia_executar_codigo). Roda fora da thread da interface: um laço
// infinito não congela a janela, e o limite de tempo (worker.terminate(), em src/ponte.js) corta o
// código de verdade. Aqui não há DOM, Node, disco nem os internos do editor: só a fachada estável
// forgia.*, que ENFILEIRA comandos (os mesmos do forgia_lote). No fim, a fila volta para a página,
// que aplica tudo como um lote só: um passo de desfazer, validado; erro -> nada fica.
//
// Mensagem de entrada: { codigo, estado, formas }. Saída: { ok, comandos, retorno, saida } ou
// { ok: false, erro, saida }.
import {
  Vector2, Vector3, Matrix3, Matrix4, Quaternion, Euler, MathUtils, Box2, Box3, Sphere, Plane, Ray, Line3, Triangle,
  Spherical, Cylindrical, Shape, Path, ShapeUtils, CatmullRomCurve3, CubicBezierCurve, CubicBezierCurve3,
  QuadraticBezierCurve, QuadraticBezierCurve3, EllipseCurve, ArcCurve, SplineCurve, LineCurve, LineCurve3,
} from 'three';

// só matemática e curvas do three.js (nada de cena ou WebGL no Worker)
const THREE = Object.freeze({
  Vector2, Vector3, Matrix3, Matrix4, Quaternion, Euler, MathUtils, Box2, Box3, Sphere, Plane, Ray, Line3, Triangle,
  Spherical, Cylindrical, Shape, Path, ShapeUtils, CatmullRomCurve3, CubicBezierCurve, CubicBezierCurve3,
  QuadraticBezierCurve, QuadraticBezierCurve3, EllipseCurve, ArcCurve, SplineCurve, LineCurve, LineCurve3,
});

const MAX_COMANDOS = 5000;
const MAX_SAIDA = 200;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const list = (v) => (Array.isArray(v) ? v : [v]);

function show(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

self.onmessage = async (e) => {
  const { codigo, estado, formas } = e.data || {};
  const comandos = [];
  const saida = [];
  let n = 0;
  const push = (cmd, args) => {
    if (comandos.length >= MAX_COMANDOS) throw new Error(`o código passou de ${MAX_COMANDOS} comandos`);
    comandos.push({ cmd, ...clone(args || {}) });
  };
  // apelido do que acabou de ser criado: '$<ref>' vale como id nos comandos seguintes
  const refOf = (args, prefix) => String((args && args.ref) || `_${prefix}${++n}`).replace(/^\$/, '');
  const forgia = Object.freeze({
    objetos: () => clone(estado.objetos),
    estado: () => clone(estado),
    formas: () => clone(formas),
    criar(args) {
      const ref = refOf(args, 'c');
      push('criar', { ...args, ref });
      return '$' + ref;
    },
    alterar(id, args) {
      push('alterar', { ...args, id });
    },
    excluir(ids) {
      push('excluir', { ids: list(ids) });
    },
    agrupar(ids, args) {
      const ref = refOf(args, 'g');
      push('agrupar', { ...args, ids: list(ids), ref });
      return '$' + ref;
    },
    desagrupar(ids) {
      push('desagrupar', { ids: list(ids) });
    },
    alinhar(ids, eixo, onde, referencia) {
      push('alinhar', { ids: list(ids), eixo, onde, ...(referencia ? { referencia } : {}) });
    },
    espelhar(ids, eixo) {
      push('espelhar', { ids: list(ids), eixo });
    },
    soltar_na_mesa(ids) {
      push('soltar_na_mesa', { ids: list(ids) });
    },
    duplicar(ids, args) {
      const ref = refOf(args, 'd');
      push('duplicar', { ...args, ids: list(ids), ref });
      return '$' + ref;
    },
    selecionar(ids) {
      push('selecionar', { ids: list(ids) });
    },
    util: Object.freeze({
      rad: (graus) => (graus * Math.PI) / 180,
      graus: (rad) => (rad * 180) / Math.PI,
      // pontos de um círculo (ou polígono regular) no plano XY, para contornos de desenho
      circulo: (raio, lados = 32, centro = [0, 0]) =>
        Array.from({ length: lados }, (_, i) => {
          const a = (i / lados) * Math.PI * 2;
          return [centro[0] + raio * Math.cos(a), centro[1] + raio * Math.sin(a)];
        }),
      arredondar: (v, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas,
    }),
  });
  const log = (...a) => {
    if (saida.length < MAX_SAIDA) saida.push(a.map(show).join(' ').slice(0, 2000));
  };
  const fakeConsole = Object.freeze({ log, info: log, warn: log, error: log });
  try {
    // corpo async: permite return e await; "use strict" evita globais sem querer
    const fn = new Function('forgia', 'THREE', 'console', `"use strict";\nreturn (async () => {\n${codigo}\n})();`);
    const retorno = await fn(forgia, THREE, fakeConsole);
    let ret;
    try {
      ret = retorno === undefined ? undefined : JSON.parse(JSON.stringify(retorno));
    } catch {
      ret = String(retorno);
    }
    self.postMessage({ ok: true, comandos, retorno: ret, saida });
  } catch (err) {
    self.postMessage({ ok: false, erro: (err && err.message) || String(err), tipo: err && err.name, saida });
  }
};
