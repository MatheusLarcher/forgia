import { t } from './textos/index.js';
import { packProject, unpackProject, meshRefsOf, ProjectFileError } from './projeto.js';
import { getMesh, setMesh, keepMeshes, setMeshPersister, f32ToB64, b64ToF32 } from './shapes.js';
import { validateProject } from './ponte-comandos.js';
import { capture } from './captura.js';

// Projeto em arquivo (.forgia) no lado da página: título com "•", Salvar / Salvar como / Abrir /
// Recentes, cópia de segurança a cada alteração, recuperação depois de travar, pergunta ao fechar
// e a migração do projeto antigo do localStorage. Veja docs/arquitetura.md, "Projeto em arquivo".
//
// - O arquivo só muda quando o usuário salva. A cópia de segurança (pasta fixa do main,
//   %APPDATA%\Forgia\recuperacao) é gravada ~0,4 s depois de cada alteração: o projeto (JSON) e
//   só as malhas que o main ainda não tem.
// - "sujo" = o projeto difere do que foi salvo (ou aberto). Projeto que nunca foi salvo em arquivo
//   fica sujo quando tem peças; ele volta sozinho ao abrir o Forgia (como antes, agora pela cópia).
// - Migração: sem cópia de segurança e com o projeto antigo no localStorage (forgia.design.v1 e
//   forgia.meshes.v1, até a Fase C), ele vira o projeto atual e a cópia é gravada na hora. As chaves
//   antigas ficam onde estão (não se apaga nada do usuário).
// - Sem o preload (npm run dev no navegador): o projeto vai para o localStorage como antes, e Salvar
//   baixa o .forgia / Abrir usa o seletor de arquivo do navegador.

const LS_DESIGN = 'forgia.design.v1';
const LS_MESHES = 'forgia.meshes.v1';
const LS_MIGRADO = 'forgia.migrado.v1';
const BACKUP_MS = 400;
const EMPTY_KEY = '\u0000vazio';

const f32Bytes = (arr) => new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
const bytesF32 = (u8) => new Float32Array(u8.slice().buffer);

export class Arquivo extends EventTarget {
  constructor(editor) {
    super();
    this.ed = editor;
    this.api = window.forgiaProjeto || null;
    this.ui = null;
    this.file = null; // { nome, caminho } do .forgia aberto
    this.savedKey = EMPTY_KEY;
    this.dirty = false;
    this.sentRefs = new Set(); // malhas que a cópia de segurança do main já tem
    this.timer = null;
    this.chain = Promise.resolve();
    this.loading = true;
    this.ready = new Promise((r) => (this.resolveReady = r));
    editor.addEventListener('persist', () => this.touch());
  }

  // ---------- início ----------

  async start(ui) {
    this.ui = ui;
    try {
      if (this.api) await this.startDesktop();
      else this.startLocal();
    } catch (err) {
      console.error('[arquivo] início', err);
      this.ed.loadProject(null);
      this.markSaved(null);
    }
    this.loading = false;
    this.refresh();
    this.resolveReady();
    if (this.api) this.backupNow();
  }

  async startDesktop() {
    const api = this.api;
    api.aoFechar(() => this.onCloseRequest());
    api.aoAbrirArquivo((r) => this.onSystemOpen(r));
    const ini = await api.inicio();
    await api.pronto();
    const c = ini && ini.copia;
    const valuable = c && c.projeto && (c.meta.sujo || (!c.meta.arquivo && (c.projeto.objects || []).length > 0));
    // o Windows mandou abrir um .forgia
    if (ini && ini.abrir) {
      if (!ini.abrir.ok) this.toast(t.arquivo.naoAbriu(ini.abrir.nome, t.arquivo.motivos[ini.abrir.erro] || ''));
      else {
        if (valuable) {
          const choice = await this.askRecover(c.meta, t.arquivo.recuperar.abrirOutro(ini.abrir.nome));
          if (choice === 'recuperar') {
            await api.recusar(ini.abrir.id);
            this.loadBackup(c);
            return;
          }
        }
        if (await this.openResult(ini.abrir)) {
          this.abertoPeloSistema = true; // vai direto para o editor, sem a tela inicial
          return;
        }
      }
    }
    if (!c) {
      if (this.migrateLocal()) return;
      this.ed.loadProject(null);
      this.markSaved(null);
      return;
    }
    if (c.meta.arquivo && (c.meta.recarregar || !c.projeto)) {
      // "Não salvar" da última vez: vale o arquivo como foi salvo
      if (await this.reopenFile()) return;
      this.ed.loadProject(null);
      this.markSaved(null);
      return;
    }
    if (!c.projeto) {
      this.ed.loadProject(null);
      this.markSaved(null);
      return;
    }
    if (c.meta.arquivo && c.meta.sujo) {
      const choice = await this.askRecover(c.meta, t.arquivo.recuperar.descartar);
      if (choice !== 'recuperar' && (await this.reopenFile())) return;
    }
    this.loadBackup(c);
  }

  // cópia de segurança -> projeto atual (com o arquivo de antes, se houver)
  loadBackup(c) {
    keepMeshes([]);
    for (const [ref, bytes] of Object.entries(c.malhas || {})) setMesh(ref, bytesF32(bytes));
    this.sentRefs = new Set(Object.keys(c.malhas || {}));
    this.ed.loadProject(c.projeto);
    this.file = c.meta.arquivo;
    if (!this.file) this.savedKey = EMPTY_KEY;
    else this.savedKey = c.meta.sujo ? null : this.key();
    this.refresh();
  }

  async reopenFile() {
    const r = await this.api.abrir({ reabrir: true });
    if (r && r.ok) return this.openResult(r);
    if (r && r.nome) this.toast(t.arquivo.naoAbriu(r.nome, t.arquivo.motivos[r.erro] || ''));
    return false;
  }

  // localStorage da versão antiga (ou do npm run dev) -> projeto atual
  readLocal() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(LS_DESIGN) || 'null');
    } catch {
      data = null;
    }
    if (!data || !Array.isArray(data.objects)) return null;
    let meshes = {};
    try {
      meshes = JSON.parse(localStorage.getItem(LS_MESHES) || '{}') || {};
    } catch {
      meshes = {};
    }
    return { data, meshes };
  }

  migrateLocal() {
    const old = this.readLocal();
    if (!old) return false;
    keepMeshes([]);
    let n = 0;
    for (const [ref, b64] of Object.entries(old.meshes)) {
      try {
        setMesh(ref, b64ToF32(b64));
        n++;
      } catch {
        /* malha corrompida: a peça aparece como caixa, como antes */
      }
    }
    this.ed.loadProject(old.data);
    this.file = null;
    this.savedKey = EMPTY_KEY;
    this.migrated = { objetos: old.data.objects.length, malhas: n };
    try {
      localStorage.setItem(LS_MIGRADO, new Date().toISOString());
    } catch {}
    return true;
  }

  // npm run dev: tudo no localStorage, como antes da Fase D
  startLocal() {
    const old = this.readLocal();
    if (old) {
      for (const [ref, b64] of Object.entries(old.meshes)) {
        try {
          setMesh(ref, b64ToF32(b64));
        } catch {}
      }
    }
    setMeshPersister((ref, positions) => {
      try {
        const raw = JSON.parse(localStorage.getItem(LS_MESHES) || '{}');
        raw[ref] = f32ToB64(positions);
        localStorage.setItem(LS_MESHES, JSON.stringify(raw));
        return true;
      } catch {
        return false;
      }
    });
    this.ed.loadProject(old ? old.data : null);
    this.markSaved(null);
  }

  // ---------- estado: sujo, título ----------

  key() {
    return JSON.stringify(this.ed.projectData());
  }

  markSaved(key = this.key()) {
    this.savedKey = key === null ? (this.file ? this.key() : EMPTY_KEY) : key;
    this.refresh();
  }

  isDirty(key = this.key()) {
    if (this.savedKey === EMPTY_KEY) return this.ed.objects.length > 0;
    return key !== this.savedKey;
  }

  touch() {
    if (this.loading) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), BACKUP_MS);
  }

  refresh(key) {
    this.dirty = this.isDirty(key);
    const nome = this.file ? this.file.nome : this.ed.name;
    document.title = t.app.tituloJanela(nome, this.dirty);
    this.dispatchEvent(new CustomEvent('estado', { detail: { file: this.file, dirty: this.dirty } }));
  }

  // grava a cópia de segurança agora (e atualiza o "•"); as gravações ficam em fila
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.chain = this.chain.then(() => this.writeBackup()).catch((err) => console.warn('[arquivo] cópia de segurança', err));
    return this.chain;
  }

  backupNow() {
    return this.flush();
  }

  async writeBackup() {
    const key = this.key();
    this.refresh(key);
    if (!this.api) {
      try {
        localStorage.setItem(LS_DESIGN, key);
      } catch (e) {
        console.warn('Não foi possível salvar', e);
      }
      return;
    }
    const refs = [...meshRefsOf(this.ed.objects)];
    const malhas = {};
    for (const ref of refs) {
      if (this.sentRefs.has(ref)) continue;
      const pos = getMesh(ref);
      if (pos) malhas[ref] = f32Bytes(pos);
    }
    const r = await this.api.copia({ projeto: key, nome: this.ed.name, sujo: this.dirty, malhas, refs });
    if (r && r.ok) this.sentRefs = new Set(r.refs);
  }

  // ---------- salvar ----------

  suggestName() {
    return this.file ? this.file.nome.replace(/\.forgia$/i, '') : this.ed.name || t.dialogos.exportar.arquivo;
  }

  async thumbnail() {
    try {
      const shot = capture(this.ed, { vista: 'iso', largura: 256, altura: 256, marcacoes: false });
      const b64 = shot.imagem.split(',')[1];
      const s = atob(b64);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }

  async save({ como = false } = {}) {
    if (this.saving) return false;
    this.saving = true;
    try {
      const data = this.ed.projectData();
      const key = JSON.stringify(data);
      const png = await this.thumbnail();
      const bytes = await packProject(data, getMesh, { png, app: `Forgia ${__APP_VERSION__}` });
      if (!this.api) {
        this.ui.download(new Blob([bytes], { type: 'application/zip' }), this.suggestName() + '.forgia');
        this.markSaved(key);
        return true;
      }
      const r = await this.api.salvar(bytes, { como, sugestao: this.suggestName(), titulo: t.arquivo.dialogoSalvar, filtro: t.arquivo.filtro, miniatura: png });
      if (!r || r.cancelado) return false;
      if (!r.ok) {
        this.toast(t.arquivo.naoSalvou(r.nome || this.suggestName(), t.arquivo.motivos[r.erro] || r.detalhe || ''));
        return false;
      }
      this.file = { nome: r.nome, caminho: r.caminho };
      this.markSaved(key);
      this.toast(t.arquivo.salvo(r.nome));
      await this.flush();
      return true;
    } finally {
      this.saving = false;
    }
  }

  // ---------- abrir ----------

  // bytes lidos pelo main (diálogo, Recentes, Windows) -> projeto atual; false se não deu
  async openResult(r) {
    let parsed;
    try {
      parsed = unpackProject(r.dados);
      validateProject(parsed.data.objects);
    } catch (err) {
      const motivo = err instanceof ProjectFileError ? t.arquivo.motivos[err.kind] : err.message;
      this.toast(t.arquivo.naoAbriu(r.nome, motivo || ''));
      if (this.api && r.id) await this.api.recusar(r.id);
      return false;
    }
    keepMeshes([]);
    for (const [ref, pos] of parsed.meshes) setMesh(ref, pos);
    this.sentRefs = new Set();
    this.ed.loadProject(parsed.data);
    if (this.api && r.id) {
      const a = await this.api.adotar(r.id, parsed.miniatura);
      this.file = a && a.ok ? { nome: a.nome, caminho: a.caminho } : { nome: r.nome, caminho: r.caminho };
    } else this.file = { nome: r.nome, caminho: r.caminho || null };
    this.markSaved();
    if (parsed.faltando.length) this.toast(t.arquivo.malhasFaltando(parsed.faltando.length));
    this.flush();
    this.dispatchEvent(new CustomEvent('aberto', { detail: { file: this.file } }));
    return true;
  }

  async open(opts = {}) {
    if (!(await this.confirmReplace())) return false;
    if (!this.api) {
      const file = await this.ui.pickFile('.forgia');
      if (!file) return false;
      return this.openResult({ nome: file.name, dados: new Uint8Array(await file.arrayBuffer()) });
    }
    const r = await this.api.abrir({ ...opts, titulo: t.arquivo.dialogoAbrir, filtro: t.arquivo.filtro });
    if (!r || r.cancelado) return false;
    if (!r.ok) {
      this.toast(t.arquivo.naoAbriu(r.nome || '', t.arquivo.motivos[r.erro] || ''));
      return false;
    }
    return this.openResult(r);
  }

  openRecent(i) {
    return this.open({ recente: i });
  }

  async recents() {
    return this.api ? (await this.api.recentes()) || [] : [];
  }

  // ---------- histórico (tela inicial e menu lateral, src/inicio.js) ----------

  // [{ i, nome, caminho, existe, alteradoEm, miniatura }]; vazio sem o preload (npm run dev)
  async history() {
    const lista = this.api ? (await this.api.historico()) || [] : [];
    return lista.map((p, i) => ({ ...p, i }));
  }

  openHistory(item) {
    return this.open({ recente: item.i, caminho: item.caminho });
  }

  // renomeia o arquivo do histórico; se é o aberto, o título acompanha. Devolve o novo nome ou null
  async rename(item, nome) {
    const r = await this.api.renomear(item.i, item.caminho, nome);
    if (!r || !r.ok) {
      const tx = t.arquivo;
      this.toast(r && r.erro === 'nomeExiste' ? tx.nomeExiste(r.nome) : tx.naoRenomeou(item.nome, (r && (tx.motivos[r.erro] || r.detalhe)) || ''));
      return null;
    }
    if (r.atual && this.file) {
      this.file = { nome: r.nome, caminho: r.caminho };
      this.refresh();
    }
    return r.nome;
  }

  async newProject() {
    if (!(await this.confirmReplace())) return false;
    keepMeshes([]);
    this.sentRefs = new Set();
    this.ed.loadProject({ name: t.editor.nomePadrao, objects: [], grid: this.ed.grid, workplane: this.ed.workplane });
    this.file = null;
    if (this.api) await this.api.novo();
    this.markSaved(null);
    this.flush();
    return true;
  }

  // o Windows mandou abrir um .forgia com o Forgia aberto
  async onSystemOpen(r) {
    if (!r || !r.ok) {
      if (r) this.toast(t.arquivo.naoAbriu(r.nome || '', t.arquivo.motivos[r.erro] || ''));
      return;
    }
    if (await this.confirmReplace()) await this.openResult(r);
    else await this.api.recusar(r.id);
  }

  // ---------- perguntas ----------

  // antes de trocar de projeto: Salvar / Não salvar / Cancelar (true = pode trocar)
  async confirmReplace() {
    await this.flush();
    if (!this.dirty) return true;
    const q = t.arquivo.pergunta;
    const choice = await this.ui.choose(q.titulo, this.file ? q.arquivo(this.file.nome) : q.trocarNovo(this.ed.name), [
      ['cancelar', q.cancelar],
      ['nao', q.naoSalvar],
      ['salvar', q.salvar, true],
    ]);
    if (choice === 'salvar') return this.save();
    return choice === 'nao';
  }

  // o usuário fechou a janela
  async onCloseRequest() {
    this.api.fechando();
    await this.flush();
    if (!this.dirty) return this.api.fechar(true);
    const q = t.arquivo.pergunta;
    const choice = await this.ui.choose(q.titulo, this.file ? q.arquivo(this.file.nome) : q.fecharNovo(this.ed.name), [
      ['cancelar', q.cancelar],
      ['nao', q.naoSalvar],
      ['salvar', q.salvar, true],
    ]);
    if (choice === 'salvar') {
      if (!(await this.save())) return this.api.fechar(false);
      await this.flush();
      return this.api.fechar(true);
    }
    if (choice === 'nao') {
      // projeto com arquivo: a próxima abertura volta ao arquivo salvo; sem arquivo, a cópia fica
      if (this.file) await this.api.descartar();
      return this.api.fechar(true);
    }
    return this.api.fechar(false);
  }

  // "Há alterações não salvas de <projeto> (<data/hora>). Recuperar?"
  askRecover(meta, otherLabel) {
    const r = t.arquivo.recuperar;
    const when = meta.alteradoEm ? new Date(meta.alteradoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const nome = meta.arquivo ? meta.arquivo.nome : meta.nome;
    return this.ui.choose(r.titulo, r.texto(nome, when), [
      ['outro', otherLabel],
      ['recuperar', r.recuperar, true],
    ], 'recuperar');
  }

  toast(msg) {
    if (this.ui) this.ui.toast(msg);
  }
}
