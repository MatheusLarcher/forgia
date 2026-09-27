import './style.css';
import { t, applyTexts } from './textos/index.js';
import { Editor } from './editor.js';
import { UI } from './ui.js';
import { gpuInfo, GpuUnavailableError } from './gpu.js';
import { theme } from './theme.js';
import { Ponte } from './ponte.js';
import { StatusBar } from './statusbar.js';
import { Arquivo } from './arquivo.js';
import { AgentCode } from './agentcode.js';
import { PedidoIA } from './pedido-ia.js';

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
  // projeto em arquivo e cópia de segurança (src/arquivo.js); a ponte da IA só atende depois que
  // o projeto chegou (recuperação, migração do localStorage antigo ou .forgia pedido pelo Windows)
  const arquivo = new Arquivo(editor);
  const ponte = new Ponte(editor, arquivo.ready);
  // pedido escrito aqui e enviado ao Agent Code (src/agentcode.js); o Marcar parte usa pelo editor
  const agentCode = (editor.agentCode = new AgentCode(editor));
  const ui = new UI(editor, ponte, arquivo, agentCode);
  new StatusBar(editor, ponte, { onConnect: () => ui.connectDialog() });
  new PedidoIA(editor, agentCode, { onConnect: (agente) => ui.connectDialog(agente) });
  if (gpuInfo.mode === 'software') ui.toast(t.avisos.modoSoftware);
  // acesso para depuração no console
  window.forgia = { editor, ui, gpu: gpuInfo, theme, ponte, arquivo, agentCode };
  arquivo.start(ui);
} catch (err) {
  if (!(err instanceof GpuUnavailableError)) throw err;
  console.error(err.cause || err);
  showGpuFailure(viewport);
  window.forgia = { gpu: gpuInfo, theme };
}
