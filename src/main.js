import './style.css';
import { t, applyTexts } from './textos/index.js';
import { Editor } from './editor.js';
import { UI } from './ui.js';
import { gpuInfo, GpuUnavailableError } from './gpu.js';
import { theme } from './theme.js';
import { Ponte } from './ponte.js';
import { StatusBar } from './statusbar.js';

// Sem WebGL algum: explica no lugar do 3D em vez de deixar a tela em branco
function showGpuFailure(viewport) {
  const box = document.createElement('div');
  box.className = 'gpu-fail';
  box.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  const text = document.createElement('p');
  title.textContent = t.erros.gpu.titulo;
  text.textContent = t.erros.gpu.texto;
  box.append(title, text);
  viewport.classList.add('no-gpu');
  viewport.append(box);
}

// textos do HTML antes de tudo: aparecem mesmo se o 3D não iniciar
document.title = t.app.titulo;
applyTexts();

const viewport = document.getElementById('viewport');
try {
  const editor = new Editor(viewport);
  // ponte da IA (só existe no Electron, pelo preload) e barra de status
  const ponte = new Ponte(editor);
  const ui = new UI(editor, ponte);
  new StatusBar(editor, ponte, { onConnect: () => ui.connectDialog() });
  if (gpuInfo.mode === 'software') ui.toast(t.avisos.modoSoftware);
  // acesso para depuração no console
  window.forgia = { editor, ui, gpu: gpuInfo, theme, ponte };
} catch (err) {
  if (!(err instanceof GpuUnavailableError)) throw err;
  console.error(err.cause || err);
  showGpuFailure(viewport);
  window.forgia = { gpu: gpuInfo, theme };
}
