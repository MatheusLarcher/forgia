'use strict';
// Preload mínimo (contextIsolation ligado, sem Node na página). Expõe só:
//
// window.forgiaPonte — a ponte da IA:
//   aoPedido(fn)        recebe os pedidos do agente ({ id, cmd, args, arquivos }) vindos do main
//   responder(id, res)  devolve a resposta de um pedido
//   configurar(cfg)     { permitir, codigo } das Configurações; devolve o estado da ponte
//   info()              caminhos e porta, para o Conectar IA
//   aoEstado(fn)        a ponte subiu (porta) ou falhou
//   copiar(texto, png)  área de transferência com texto + imagem (Marcar parte)
//
// window.forgiaProjeto — o projeto em arquivo (electron/projeto.cjs). A página NUNCA passa caminho
// para gravar: salvar/abrir vão por diálogo do Electron, pelos Recentes (lista do main) ou pelo
// arquivo que o Windows mandou abrir; a cópia de segurança grava numa pasta fixa do main.
//   inicio()                    cópia de segurança, arquivo pedido pelo Windows e Recentes
//   salvar(bytes, opts)         { como, sugestao, titulo, filtro }: grava no arquivo atual ou pergunta onde
//   abrir(opts)                 {} diálogo | { recente: i } | { reabrir: true } -> { id, nome, dados }
//   adotar(id) / recusar(id)    a página leu (ou não) o arquivo aberto
//   novo()                      projeto sem arquivo
//   recentes()                  últimos 5 arquivos
//   copia(msg) / descartar()    cópia de segurança (a cada alteração) / "Não salvar"
//   pronto(), aoFechar(fn), fechando(), fechar(ok)   pergunta ao fechar a janela
//   aoAbrirArquivo(fn)          o Windows mandou abrir um .forgia com o Forgia aberto
//   criacoes(), salvarCriacao(bytes, nome), renomearCriacao(id, nome), excluirCriacao(id)
//                               Suas criações da biblioteca, na pasta fixa <userData>\criacoes
//
// Nada de leitura ou gravação de arquivo em caminho escolhido pela página.
const { contextBridge, ipcRenderer } = require('electron');

let onRequest = null;
let onState = null;
let onClose = null;
let onOpenFile = null;
ipcRenderer.on('ponte:pedido', (_e, msg) => onRequest && onRequest(msg));
ipcRenderer.on('ponte:estado', (_e, st) => onState && onState(st));
ipcRenderer.on('projeto:fechar', () => onClose && onClose());
ipcRenderer.on('projeto:abrirArquivo', (_e, res) => onOpenFile && onOpenFile(res));

contextBridge.exposeInMainWorld('forgiaPonte', {
  aoPedido(fn) {
    onRequest = typeof fn === 'function' ? fn : null;
  },
  aoEstado(fn) {
    onState = typeof fn === 'function' ? fn : null;
  },
  responder(id, res) {
    ipcRenderer.send('ponte:resposta', id, res);
  },
  configurar(cfg) {
    return ipcRenderer.invoke('ponte:config', cfg);
  },
  info() {
    return ipcRenderer.invoke('ponte:info');
  },
  copiar(texto, png) {
    return ipcRenderer.invoke('ponte:copiar', { texto, png });
  },
});

contextBridge.exposeInMainWorld('forgiaProjeto', {
  inicio: () => ipcRenderer.invoke('projeto:inicio'),
  salvar: (bytes, opts) => ipcRenderer.invoke('projeto:salvar', bytes, opts),
  abrir: (opts) => ipcRenderer.invoke('projeto:abrir', opts || {}),
  adotar: (id) => ipcRenderer.invoke('projeto:adotar', id),
  recusar: (id) => ipcRenderer.invoke('projeto:recusar', id),
  novo: () => ipcRenderer.invoke('projeto:novo'),
  recentes: () => ipcRenderer.invoke('projeto:recentes'),
  copia: (msg) => ipcRenderer.invoke('projeto:copia', msg),
  descartar: () => ipcRenderer.invoke('projeto:descartar'),
  pronto: () => ipcRenderer.invoke('projeto:pronto'),
  fechando: () => ipcRenderer.invoke('projeto:fechando'),
  fechar: (ok) => ipcRenderer.invoke('projeto:fechar', !!ok),
  aoFechar(fn) {
    onClose = typeof fn === 'function' ? fn : null;
  },
  aoAbrirArquivo(fn) {
    onOpenFile = typeof fn === 'function' ? fn : null;
  },
  // Suas criações (biblioteca): pasta fixa <userData>\criacoes do main
  criacoes: () => ipcRenderer.invoke('criacoes:listar'),
  salvarCriacao: (bytes, nome) => ipcRenderer.invoke('criacoes:salvar', bytes, nome),
  renomearCriacao: (id, nome) => ipcRenderer.invoke('criacoes:renomear', id, nome),
  excluirCriacao: (id) => ipcRenderer.invoke('criacoes:excluir', id),
});
