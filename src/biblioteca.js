import { t } from './textos/index.js';
import { SHAPES, getMesh, setMesh } from './shapes.js';
import { renderThumbnails } from './thumbs.js';
import { ICONS } from './icons.js';
import { INICIANTES } from './iniciantes.js';
import { packProject, unpackProject } from './projeto.js';
import { groupResult, aliasGroupResult } from './csg.js';

// Biblioteca em categorias (como o Tinkercad): Suas criações, Favoritos, Formas básicas, Letras e
// números, Iniciantes do projeto, Hardware e Geradores de forma. O seletor mostra um ícone por
// categoria, desenhado pelo próprio Forgia (thumbs.js), nada copiado do Tinkercad.
// - Hardware e Geradores: os tipos de SHAPES com category (src/geradores/).
// - Iniciantes: grupos prontos de public/iniciantes/*.json (src/iniciantes.js).
// - Suas criações: a seleção salva como .forgia na pasta fixa %APPDATA%\Forgia\criacoes (main,
//   pelo preload); no npm run dev, no localStorage. Renomear e excluir pelo botão do bloco.
// - Favoritos: estrela em qualquer bloco; as chaves ficam em localStorage['forgia.favoritos'].

const FAV_KEY = 'forgia.favoritos';
const DEV_CRIACOES = 'forgia.criacoes';
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);

export const CATEGORY_ORDER = ['criacoes', 'favoritos', 'basic', 'letters', 'iniciantes', 'hardware', 'geradores'];

// sem versões "(furo)": qualquer forma vira furo com H ou o botão Furo do inspetor
const BASIC = ['box', 'cylinder', 'sphere', 'roof', 'cone', 'roundRoof', 'text', 'wedge', 'pyramid', 'halfSphere', 'polygon', 'paraboloid', 'torus', 'tube', 'star', 'heart', 'icosahedron'];
const LETTER_COLORS = ['#e3302d', '#f38a00', '#f7c511', '#3fb34f', '#1b8bd2', '#8e44ad'];

const typesOf = (cat) => Object.keys(SHAPES).filter((k) => SHAPES[k].category === cat);
const shapeItem = (cat, type) => ({ key: `${cat}:${type}`, label: SHAPES[type].label, spec: { type, name: SHAPES[type].label } });

function fixedItems(cat) {
  if (cat === 'basic') return BASIC.map((type) => shapeItem(cat, type));
  if (cat === 'letters')
    return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((ch, i) => ({
      key: `letters:${ch}`,
      label: ch,
      spec: { type: 'text', params: { text: ch }, name: ch, color: LETTER_COLORS[i % LETTER_COLORS.length] },
    }));
  if (cat === 'hardware' || cat === 'geradores') return typesOf(cat).map((type) => shapeItem(cat, type));
  if (cat === 'iniciantes') return INICIANTES.map((it) => ({ key: `iniciantes:${it.key}`, label: t.biblioteca.iniciantes[it.key], spec: { object: it.object, name: t.biblioteca.iniciantes[it.key] } }));
  return [];
}

// ícones das categorias: cenas pequenas renderizadas pelo Forgia
function categoryIconSpecs() {
  const foguete = INICIANTES.find((i) => i.key === 'foguete');
  return {
    criacoes: { parts: [{ type: 'box', size: [16, 12, 16], color: '#1b8bd2', pos: [0, 0, 0] }, { type: 'roof', size: [18, 9, 16], color: '#e3302d', pos: [0, 10.5, 0] }] },
    favoritos: { type: 'star', color: '#f7c511', flat: false },
    basic: { parts: [{ type: 'box', size: [12, 12, 12], color: '#e3302d', pos: [-9, 0, 4] }, { type: 'cylinder', size: [11, 14, 11], color: '#f38a00', pos: [6, 1, 6] }, { type: 'sphere', size: [11, 11, 11], color: '#1b8bd2', pos: [2, -0.5, -9] }] },
    letters: { type: 'text', params: { text: 'AB12' }, color: '#3fb34f' },
    iniciantes: foguete ? { object: foguete.object } : { type: 'cone' },
    hardware: { type: 'nut', params: { m: 8 } },
    geradores: { type: 'gear', params: { teeth: 16, module: 2 } },
  };
}

export class Library {
  constructor({ api, toast }) {
    this.api = api;
    this.toast = toast;
    this.thumbs = new Map(); // key do item -> PNG
    this.creations = []; // { id, nome, object, meshes: Map }
    this.favorites = new Set(this.readFavorites());
    this.icons = null;
  }

  categoryIcons() {
    if (!this.icons) {
      const specs = categoryIconSpecs();
      const imgs = renderThumbnails(CATEGORY_ORDER.map((c) => specs[c]), 96);
      this.icons = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c, imgs[i]]));
    }
    return this.icons;
  }

  // ---------- itens ----------

  creationItems() {
    return this.creations.map((c) => ({ key: `criacoes:${c.id}`, label: c.nome, creation: c, spec: { object: c.object, meshes: c.meshes, name: c.nome } }));
  }

  allItems() {
    return [...this.creationItems(), ...['basic', 'letters', 'iniciantes', 'hardware', 'geradores'].flatMap(fixedItems)];
  }

  items(cat) {
    if (cat === 'criacoes') return this.creationItems();
    if (cat === 'favoritos') return this.allItems().filter((it) => this.favorites.has(it.key));
    return fixedItems(cat);
  }

  // miniaturas que faltam, numa leva só
  thumbsFor(items) {
    const missing = items.filter((it) => !this.thumbs.has(it.key));
    if (missing.length) {
      for (const it of missing) if (it.spec.meshes) for (const [ref, pos] of it.spec.meshes) setMesh(ref, pos);
      const imgs = renderThumbnails(missing.map((it) => (it.spec.object ? { object: it.spec.object } : it.spec)));
      missing.forEach((it, i) => this.thumbs.set(it.key, imgs[i]));
    }
    return items.map((it) => this.thumbs.get(it.key));
  }

  // ---------- favoritos ----------

  readFavorites() {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  toggleFavorite(key) {
    if (this.favorites.has(key)) this.favorites.delete(key);
    else this.favorites.add(key);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...this.favorites]));
    } catch {}
    return this.favorites.has(key);
  }

  // ---------- Suas criações ----------

  async loadCreations() {
    let list = [];
    try {
      if (this.api) list = (await this.api.criacoes()) || [];
      else {
        const raw = JSON.parse(localStorage.getItem(DEV_CRIACOES) || '{}');
        list = Object.entries(raw).map(([id, v]) => ({ id, nome: v.nome, criadaEm: v.criadaEm, dados: Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)) }));
      }
    } catch (err) {
      console.warn('[biblioteca] criações', err);
    }
    this.creations = [];
    for (const c of list) {
      try {
        const { data, meshes } = unpackProject(c.dados);
        if (!data.objects[0]) continue;
        this.creations.push({ id: c.id, nome: c.nome, object: data.objects[0], meshes });
      } catch (err) {
        console.warn('[biblioteca] criação ilegível', c.id, err);
      }
    }
  }

  // a seleção vira uma peça só (uma forma ou um grupo novo, sem mexer no projeto)
  static creationObject(sel) {
    // uma forma sem giro vai como está; girada (ou várias) vai dentro de um grupo, que guarda o giro
    const q = sel[0].quat;
    if (sel.length === 1 && Math.abs(q[3]) > 0.999999) {
      const o = clone(sel[0]);
      delete o.locked;
      o.pos = [0, o.pos[1], 0];
      return o;
    }
    const children = clone(sel);
    const res = groupResult({ type: 'group', children });
    const c = res.center;
    for (const ch of children) {
      ch.pos = ch.pos.map((v, k) => Math.round((v - c[k]) * 1000) / 1000);
      delete ch.locked;
    }
    aliasGroupResult(children, res);
    return { id: uid(), type: 'group', name: '', color: null, hole: res.isHole, params: {}, size: [...res.baseSize], pos: [0, c[1], 0], quat: [0, 0, 0, 1], flip: [1, 1, 1], children };
  }

  async saveCreation(sel, nome) {
    const object = Library.creationObject(sel);
    object.name = nome;
    const bytes = await packProject({ name: nome, grid: 1, workplane: null, objects: [object] }, getMesh);
    if (this.api) {
      const r = await this.api.salvarCriacao(bytes, nome);
      if (!r || !r.ok) return false;
    } else {
      const raw = JSON.parse(localStorage.getItem(DEV_CRIACOES) || '{}');
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      raw[uid()] = { nome, criadaEm: new Date().toISOString(), b64: btoa(s) };
      localStorage.setItem(DEV_CRIACOES, JSON.stringify(raw));
    }
    await this.loadCreations();
    return true;
  }

  async renameCreation(id, nome) {
    if (this.api) await this.api.renomearCriacao(id, nome);
    else {
      const raw = JSON.parse(localStorage.getItem(DEV_CRIACOES) || '{}');
      if (raw[id]) raw[id].nome = nome;
      localStorage.setItem(DEV_CRIACOES, JSON.stringify(raw));
    }
    await this.loadCreations();
  }

  async deleteCreation(id) {
    if (this.api) await this.api.excluirCriacao(id);
    else {
      const raw = JSON.parse(localStorage.getItem(DEV_CRIACOES) || '{}');
      delete raw[id];
      localStorage.setItem(DEV_CRIACOES, JSON.stringify(raw));
    }
    this.thumbs.delete(`criacoes:${id}`);
    this.favorites.delete(`criacoes:${id}`);
    await this.loadCreations();
  }
}

// ícones pequenos dos botões do bloco (estrela, lápis, lixeira)
export const TILE_ICONS = { star: ICONS.star, rename: ICONS.rename, delete: ICONS.delete };
