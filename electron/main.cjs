// Janela desktop do Forgia: carrega o build do Vite (dist/index.html)
// medição da abertura (FORGIA_MEDIR_ABERTURA=1, tests/carregando-abertura.mjs): marcos no stdout
// com o relógio de parede (ms), para comparar com a hora em que o processo foi lançado
const MEDIR = process.env.FORGIA_MEDIR_ABERTURA === '1';
const marco = (nome) => MEDIR && console.log(`[abertura] ${nome} ${Date.now()}`);
marco('main');
const { app, BrowserWindow, Menu, shell, nativeTheme, ipcMain } = require('electron');
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
const primeiraInstancia = app.requestSingleInstanceLock();
if (!primeiraInstancia) app.quit();

const ICONE = path.join(__dirname, '..', 'dist', 'branding', 'forgia-forge-v1.ico');
// a janela do editor fica escondida até a página avisar que carregou; sem aviso, aparece assim mesmo
const LIMITE_ABERTURA = 20000;
// fundo (--bg) do tema do Windows: sem clarão branco antes da primeira pintura
const fundo = () => (nativeTheme.shouldUseDarkColors ? '#16181b' : '#e9ecef');

let win;
let splash = null;
let mostrada = false;
let limiteAbertura = null;
// .forgia da 2ª instância pedido antes de a página poder recebê-lo: fica até o projeto da abertura
// chegar (abertura:projeto), mesmo que a janela já tenha aparecido por tempo, erro ou splash fechado
let arquivoNaFila = null;
let paginaPronta = false;
let projeto = null;

// Janela de abertura (electron/splash.html, autocontida): logo animada enquanto o editor carrega
function createSplash() {
  splash = new BrowserWindow({
    width: 360,
    height: 340,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // aparece já desenhada (ready-to-show): sem o retângulo vazio antes da logo
    show: false,
    center: true,
    backgroundColor: fundo(),
    title: 'Forgia',
    icon: ICONE,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  splash.on('show', () => marco('splash-visivel'));
  // aparece sem ativar (show() com ativação segura o main ~100 ms antes de pintar) e logo depois
  // pega o foco: o processo fica em primeiro plano e o editor pode vir para a frente quando abrir
  splash.once('ready-to-show', () => {
    marco('splash-pintou');
    if (!splash || splash.isDestroyed() || mostrada) return;
    splash.showInactive();
    setImmediate(() => splash && !splash.isDestroyed() && splash.focus());
  });
  // fechada antes da hora (Alt+F4): o editor aparece como estiver, nunca fica tudo escondido
  splash.on('closed', () => {
    splash = null;
    mostrarPrincipal();
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
}

// mostra o editor (uma vez só) maximizado e fecha a abertura: a página carregou, deu erro ou o
// tempo acabou. O editor aparece antes de a abertura sair, para não ficar um instante sem janela.
function mostrarPrincipal() {
  if (mostrada || !win || win.isDestroyed()) return;
  mostrada = true;
  clearTimeout(limiteAbertura);
  win.maximize();
  win.show();
  if (splash && !splash.isDestroyed()) splash.destroy();
}

// a página registrou quem recebe o arquivo e o projeto da abertura já chegou: entrega o da fila
function entregarFila() {
  paginaPronta = true;
  const file = arquivoNaFila;
  arquivoNaFila = null;
  if (file && projeto) projeto.abrirDoSistema(file);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // escondida até a página avisar que carregou (abertura:carregado); até lá, a abertura
    show: false,
    backgroundColor: fundo(),
    title: 'Forgia',
    icon: ICONE,
    // preload mínimo (electron/preload.cjs): só a ponte da IA, sem Node na página
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  marco('janela');
  win.on('show', () => marco('principal-visivel'));
  win.once('ready-to-show', () => marco('ready-to-show'));
  // fechada antes de aparecer: a abertura sai junto e o app encerra (window-all-closed)
  win.on('closed', () => {
    clearTimeout(limiteAbertura);
    if (splash && !splash.isDestroyed()) splash.destroy();
  });
  const wc = win.webContents;
  // src/carregando.js avisa quando tira o loading: projeto e cena prontos, pergunta na abertura
  // (recuperar cópia) ou erro (index.html cobre o JS que nem carregou). Página que não chega lá
  // também não prende o editor escondido: falha ao carregar, preload, processo caído ou o limite.
  // 'unresponsive' não entra: a página ocupada na abertura é normal e mostraria o editor cedo.
  ipcMain.on('abertura:carregado', (e) => {
    if (e.sender !== wc) return;
    marco('carregado');
    mostrarPrincipal();
  });
  ipcMain.on('abertura:projeto', (e) => e.sender === wc && entregarFila());
  wc.on('did-fail-load', (_e, _code, _desc, _url, mainFrame) => mainFrame && mostrarPrincipal());
  wc.on('preload-error', mostrarPrincipal);
  wc.on('render-process-gone', mostrarPrincipal);
  limiteAbertura = setTimeout(mostrarPrincipal, LIMITE_ABERTURA);
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
  // ainda abrindo: foca a abertura (o editor escondido aparece quando carregar)
  const alvo = mostrada ? win : splash;
  if (alvo && !alvo.isDestroyed()) {
    if (alvo.isMinimized()) alvo.restore();
    alvo.focus();
  }
  const file = fileFromArgv(argv);
  // com a página ainda abrindo, ela nem ouve o pedido (ou o projeto da abertura o cobriria)
  if (file && !paginaPronta) arquivoNaFila = file;
  else if (file && projeto) projeto.abrirDoSistema(file);
});
app.whenReady().then(() => {
  marco('ready');
  if (!primeiraInstancia) return;
  Menu.setApplicationMenu(null);
  // a abertura primeiro: aparece enquanto o editor (escondido) carrega
  createSplash();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
