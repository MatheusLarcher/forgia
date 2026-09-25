// Janela desktop do Forgia: carrega o build do Vite (dist/index.html)
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

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

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: 'Forgia',
    icon: path.join(__dirname, '..', 'dist', 'branding', 'forgia-forge-v1.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links externos abrem no navegador, não dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
