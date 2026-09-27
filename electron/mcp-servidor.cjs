'use strict';
// Como um agente sobe o servidor MCP do Forgia (stdio): { command, args, env }. Fonte única, no
// main: o Conectar IA recebe pronto pelo ponte:info (electron/ponte.cjs) e a integração com o
// Agent Code manda o mesmo em mcp_servers.forgia (electron/agentcode.cjs). Nunca vem do renderer:
// é um comando que o agente vai executar.
//
// Roda pelo próprio Forgia.exe com ELECTRON_RUN_AS_NODE=1 e o script fora do asar
// (resources\mcp\forgia-mcp.cjs); no desenvolvimento, electron.exe + electron/mcp/forgia-mcp.cjs.
// FORGIA_DADOS só entra quando a pasta de dados não é a padrão (%APPDATA%\Forgia), como num teste
// com --user-data-dir.

const path = require('node:path');

const samePath = (a, b) => String(a || '').toLowerCase().replace(/[\\/]+$/, '') === String(b || '').toLowerCase().replace(/[\\/]+$/, '');

// { exe, script, dados, dadosPadrao } -> { command, args, env }
function serverSpec({ exe, script, dados, dadosPadrao }) {
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  if (dados && !samePath(dados, dadosPadrao)) env.FORGIA_DADOS = dados;
  return { command: exe, args: [script], env };
}

// caminhos desta execução (instalado, win-unpacked ou npm run desktop)
function forgiaPaths(app) {
  return {
    exe: app.getPath('exe'),
    script: app.isPackaged ? path.join(process.resourcesPath, 'mcp', 'forgia-mcp.cjs') : path.join(__dirname, 'mcp', 'forgia-mcp.cjs'),
    dados: app.getPath('userData'),
    dadosPadrao: path.join(app.getPath('appData'), 'Forgia'),
  };
}

module.exports = { serverSpec, forgiaPaths };
