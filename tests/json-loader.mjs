// Gancho de carregamento para o node --test: o Vite importa .json sem "with { type: 'json' }"
// (a fonte do texto em src/shapes.js); aqui o .json vira um módulo que exporta o objeto.
// Registre com: register('./json-loader.mjs', import.meta.url) antes do import dinâmico.
import { readFile } from 'node:fs/promises';

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json') && !context.importAttributes?.type) {
    const text = await readFile(new URL(url), 'utf8');
    return { format: 'module', source: `export default ${text};`, shortCircuit: true };
  }
  return next(url, context);
}
