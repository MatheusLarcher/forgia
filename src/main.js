import './style.css';
import { Editor } from './editor.js';
import { UI } from './ui.js';
import { gpuInfo, GpuUnavailableError } from './gpu.js';

// Sem WebGL algum: explica no lugar do 3D em vez de deixar a tela em branco
function showGpuFailure(viewport) {
  const box = document.createElement('div');
  box.className = 'gpu-fail';
  box.setAttribute('role', 'alert');
  box.innerHTML =
    '<h2>O 3D não pôde iniciar neste computador</h2>' +
    '<p>Atualize o driver da placa de vídeo ou ative a aceleração de hardware nas configurações do navegador e abra o Forgia de novo.</p>';
  viewport.classList.add('no-gpu');
  viewport.append(box);
}

const viewport = document.getElementById('viewport');
try {
  const editor = new Editor(viewport);
  const ui = new UI(editor);
  if (gpuInfo.mode === 'software') ui.toast('Aceleração de vídeo indisponível — o 3D vai funcionar, porém mais lento.');
  // acesso para depuração no console
  window.forgia = { editor, ui, gpu: gpuInfo };
} catch (err) {
  if (!(err instanceof GpuUnavailableError)) throw err;
  console.error(err.cause || err);
  showGpuFailure(viewport);
  window.forgia = { gpu: gpuInfo };
}
