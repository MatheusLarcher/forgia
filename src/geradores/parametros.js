// Descritores de parâmetro dos geradores, prontos para virar P() em SHAPES (src/shapes.js) e
// entrada do catálogo forgia_formas (src/ponte-comandos.js). Os textos (rótulo, significado,
// nomes das opções) não ficam aqui: são chaves para TEXTOS_SUGERIDOS (textos-sugeridos.js), que o
// integrador leva para src/textos/pt-BR.js.
//
// Descritor: {
//   key,         chave em params (e do rótulo: TEXTOS_SUGERIDOS.params[key], como t.formas.params)
//   labelKey,    = key
//   meaningKey,  'tipo.key' -> TEXTOS_SUGERIDOS.significados[tipo][key] (o_que, para a IA)
//   unit,        'mm' | '°' | '' (contagem)
//   kind,        'number' | 'choice' | 'toggle' (0/1) | 'text'
//   value, min, max, step,
//   options,     (choice) valores aceitos; rótulos em TEXTOS_SUGERIDOS.opcoes[optionsKey][valor]
//   optionsKey,
//   bridge,      nome do parâmetro na ponte da IA (português, sem acento)
//   bridgeOptions (choice/toggle) nome na ponte -> valor, ex.: { sextavada: 1 }
// }
// O inspetor de hoje só tem 'number' e 'text': choice e toggle funcionam como número (min, max,
// step coerentes) e o gerador ajusta para a opção válida mais próxima.

export function paramFactory(type) {
  return (key, o) => {
    const d = {
      key,
      labelKey: key,
      meaningKey: `${type}.${key}`,
      unit: o.unit ?? '',
      kind: o.kind ?? 'number',
      value: o.value,
      min: o.min ?? 0,
      max: o.max ?? 0,
      step: o.step ?? 1,
      bridge: o.bridge ?? key,
    };
    if (o.options) {
      d.options = o.options;
      d.optionsKey = o.optionsKey ?? key;
    }
    if (o.bridgeOptions) d.bridgeOptions = o.bridgeOptions;
    return d;
  };
}

export function defaultsOf(descs) {
  const out = {};
  for (const d of descs) out[d.key] = d.value;
  return out;
}

// valores efetivos: padrão onde faltar ou for inválido, limitado a [min, max], opção mais próxima
export function resolveParams(descs, input = {}) {
  const out = {};
  for (const d of descs) {
    const raw = input?.[d.key];
    if (d.kind === 'text') {
      out[d.key] = typeof raw === 'string' ? raw : d.value;
      continue;
    }
    let v = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(v)) v = d.value;
    v = Math.min(d.max, Math.max(d.min, v));
    if (d.kind === 'toggle') v = v >= 0.5 ? 1 : 0;
    if (d.kind === 'choice') v = d.options.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), d.options[0]);
    out[d.key] = v;
  }
  return out;
}
