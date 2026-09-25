import ptBR from './pt-BR.js';

// Textos da interface. Traduzir = escrever outro arquivo com as mesmas chaves e trocar aqui.
export const t = ptBR;

// 'barra.importar' -> t.barra.importar (chave ausente aparece como a própria chave, fácil de notar)
const lookup = (key) => key.split('.').reduce((o, k) => o?.[k], t) ?? key;

// Preenche o HTML marcado: data-t (texto), data-t-aria (aria-label) e data-t-placeholder
export function applyTexts(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = lookup(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', lookup(el.dataset.tAria));
  for (const el of root.querySelectorAll('[data-t-placeholder]')) el.placeholder = lookup(el.dataset.tPlaceholder);
}
