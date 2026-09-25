// Imitação mínima do navegador para importar módulos do Forgia no node --test:
// localStorage (com registro das gravações), matchMedia (tema do Windows controlável) e o
// <html> (setAttribute). Chame antes do import dinâmico do módulo testado; para um módulo novo a
// cada teste (theme.js é um singleton), importe com um ?sufixo diferente na URL.
export function installBrowserStubs({ dark = false, saved = null } = {}) {
  const data = new Map();
  if (saved) data.set('forgia.tema', saved);
  const writes = [];
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      writes.push([k, String(v)]);
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
    get length() {
      return data.size;
    },
  };
  const listeners = new Set();
  const media = {
    matches: dark,
    addEventListener: (type, fn) => type === 'change' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  globalThis.matchMedia = () => media;
  const attrs = {};
  globalThis.document = { documentElement: { setAttribute: (k, v) => (attrs[k] = String(v)), getAttribute: (k) => attrs[k] ?? null } };
  return {
    storage: globalThis.localStorage,
    writes,
    attrs,
    // o Windows troca de tema: dispara o 'change' do matchMedia
    setSystemDark(on) {
      media.matches = on;
      for (const fn of listeners) fn({ matches: on });
    },
  };
}
