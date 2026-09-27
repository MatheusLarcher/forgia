// Janela desktop do Forgia: carrega o build do Vite (dist/index.html)
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
// ponte local com a IA (HTTP em 127.0.0.1 + IPC com a página); o MCP fica em electron/mcp/
const { startBridge } = require('./ponte.cjs');
// projeto em arquivo (.forgia), Recentes, cópia de segurança e a pergunta ao fechar
const { startProject, fileFromArgv } = require('./projeto.cjs');
// pedido escrito no Forgia enviado ao Agent Code aberto na mesma máquina (MCP por HTTP local)
const { startAgentCode } = require('./agentcode.cjs');

// GPU: usa a placa dedicada quando houver mais de uma; se não houver GPU utilizável,
// mantém o WebGL por software (SwiftShader) como fallback. Só carregamos arquivos locais.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// Preferência de GPU do Windows (Configurações > Gráficos) para o próprio exe: "alto desempenho".
// Só no app instalado, sem sobrescrever uma escolha já feita pelo usuário. Assíncrono e
// silencioso; o Windows aplica a partir do próximo lançamento. O desinstalador remove o valor.
const GPU_PREF_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
function preferHighPerformanceGpu(execFile, exe) {
  const opts = { windowsHide: true };
  execFile('reg.exe', ['query', GPU_PREF_KEY, '/v', exe], opts, (missing) => {
    if (!missing) return; // já existe: respeita a escolha do usuário
    if (missing.code !== 1) return console.warn('Forgia: preferência de GPU não verificada:', missing.message);
    execFile('reg.exe', ['add', GPU_PREF_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], opts, (err) => {
      if (err) console.warn('Forgia: preferência de GPU não gravada:', err.message);
    });
  });
}
if (app.isPackaged && process.platform === 'win32') {
  try {
    preferHighPerformanceGpu(require('child_process').execFile, process.execPath);
  } catch (err) {
    console.warn('Forgia: preferência de GPU ignorada:', err.message);
  }
}

// Uma instância só: abrir de novo foca a janela existente
if (!app.requestSingleInstanceLock()) app.quit();

let win;
let projeto = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // aparece só depois da primeira pintura, já no tema certo; até lá, o fundo (--bg) do
    // tema do Windows evita o clarão branco
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181b' : '#e9ecef',
    title: 'Forgia',
    icon: path.join(__dirname, '..', 'dist', 'branding', 'forgia-forge-v1.ico'),
    // preload mínimo (electron/preload.cjs): só a ponte da IA, sem Node na página
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links externos abrem no navegador, não dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  startBridge(win);
  startAgentCode(win);
  // .forgia pedido pelo Windows ao abrir (duplo clique no arquivo)
  projeto = startProject(win, { arquivoInicial: fileFromArgv(process.argv) });
}

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const file = fileFromArgv(argv);
  if (file && projeto) projeto.abrirDoSistema(file);
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
