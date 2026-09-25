'use strict';
// Preload mínimo (contextIsolation ligado, sem Node na página). Só expõe a ponte da IA:
//   aoPedido(fn)        recebe os pedidos do agente ({ id, cmd, args, arquivos }) vindos do main
//   responder(id, res)  devolve a resposta de um pedido
//   configurar(cfg)     { permitir, codigo } das Configurações; devolve o estado da ponte
//   info()              caminhos e porta, para o Conectar IA
//   aoEstado(fn)        a ponte subiu (porta) ou falhou
//   copiar(texto, png)  área de transferência com texto + imagem (Marcar parte)
// Nada de leitura ou gravação de arquivo por aqui: importar/exportar pela ponte é feito no main,
// no caminho que o agente mandou.
const { contextBridge, ipcRenderer } = require('electron');

let onRequest = null;
let onState = null;
ipcRenderer.on('ponte:pedido', (_e, msg) => onRequest && onRequest(msg));
ipcRenderer.on('ponte:estado', (_e, st) => onState && onState(st));

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
