import * as THREE from 'three';

// Captura da vista em PNG, para a IA (forgia_captura) e para o Marcar parte (Copiar).
// O canvas já é criado com preserveDrawingBuffer: true (src/editor.js). A captura desenha uma vez
// com uma câmera temporária numa região do próprio canvas (viewport + scissor), copia essa região
// para um canvas 2D com o fundo degradê do tema e os alfinetes das marcações, e redesenha a vista
// do usuário antes de devolver: tudo na mesma tarefa, então a tela nunca mostra a vista temporária.
// Não depende do requestAnimationFrame, que o Chromium quase para com a janela minimizada.
// Alças, transferidor, realce verde e contornos de seleção ficam de fora da imagem.

const HOME_DIR = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
// vistas fixas: de onde a câmera olha (eixos internos; frente = −Y do usuário = +z interno)
const VIEWS = {
  iso: { dir: HOME_DIR, ortho: false },
  frente: { dir: new THREE.Vector3(0, 0, 1), ortho: true },
  tras: { dir: new THREE.Vector3(0, 0, -1), ortho: true },
  direita: { dir: new THREE.Vector3(1, 0, 0), ortho: true },
  esquerda: { dir: new THREE.Vector3(-1, 0, 0), ortho: true },
  topo: { dir: new THREE.Vector3(0, 1, 0), ortho: true, up: new THREE.Vector3(0, 0, -1) },
};
export const VIEW_NAMES = [...Object.keys(VIEWS), 'atual'];

function frameBox(ed, ids) {
  const box = new THREE.Box3();
  const list = ids && ids.length ? ids.map((id) => ed.obj(id)).filter(Boolean) : ed.objects.filter((o) => !o.hidden);
  for (const o of list) box.union(ed.worldBox(o));
  if (box.isEmpty()) {
    const { w, l } = ed.workplane;
    box.set(new THREE.Vector3(-w / 2, 0, -l / 2), new THREE.Vector3(w / 2, 1, l / 2));
  }
  return box;
}

function tempCamera(ed, view, box, aspect) {
  if (view === 'atual') {
    const cam = ed.camera.clone();
    if (cam.isPerspectiveCamera) cam.aspect = aspect;
    else {
      const h = cam.top - cam.bottom;
      cam.left = (-h * aspect) / 2;
      cam.right = (h * aspect) / 2;
    }
    cam.updateProjectionMatrix();
    return cam;
  }
  const v = VIEWS[view];
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 5);
  const up = v.up || new THREE.Vector3(0, 1, 0);
  let cam;
  if (v.ortho) {
    // meia-largura e meia-altura da caixa vistas dessa direção, com 12% de margem
    const look = v.dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(look, up).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, look).normalize();
    let hw = 0;
    let hh = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      hw = Math.max(hw, Math.abs(p.dot(right)));
      hh = Math.max(hh, Math.abs(p.dot(camUp)));
    }
    hw = Math.max(hw, 2) * 1.12;
    hh = Math.max(hh, 2) * 1.12;
    if (hw / hh > aspect) hh = hw / aspect;
    else hw = hh * aspect;
    cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, radius * 8 + 100);
  } else {
    cam = new THREE.PerspectiveCamera(35, aspect, 0.5, 20000);
    const half = THREE.MathUtils.degToRad(35 / 2);
    const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
    cam.far = radius * 20 + 1000;
    cam.userData.dist = (radius * 1.1) / Math.sin(fit);
  }
  const dist = cam.userData.dist || radius * 4 + 50;
  cam.position.copy(center).addScaledVector(v.dir, dist);
  cam.up.copy(up);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// alfinete numerado (mesmo desenho da tela: círculo laranja com o número)
function drawPin(g, x, y, n, scale) {
  const r = 11 * scale;
  g.save();
  g.beginPath();
  g.arc(x, y - r * 1.25, r, 0, Math.PI * 2);
  g.moveTo(x, y);
  g.lineTo(x - r * 0.55, y - r * 0.6);
  g.lineTo(x + r * 0.55, y - r * 0.6);
  g.closePath();
  g.fillStyle = cssVar('--accent', '#f58220');
  g.strokeStyle = cssVar('--dim-bg', '#ffffff');
  g.lineWidth = 2 * scale;
  g.fill();
  g.stroke();
  g.fillStyle = cssVar('--on-accent', '#1b1e22');
  g.font = `600 ${Math.round(12 * scale)}px 'Segoe UI', system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), x, y - r * 1.25 + 0.5);
  g.restore();
}

// { vista, ids, largura, altura, marcacoes } -> { imagem: dataURL PNG, largura, altura, vista }
export function capture(ed, { vista = 'iso', ids = null, largura = 800, altura = 600, marcacoes = true } = {}) {
  const r = ed.renderer;
  const canvas = r.domElement;
  const pr = r.getPixelRatio();
  let W = canvas.clientWidth;
  let H = canvas.clientHeight;
  if (!W || !H) {
    W = canvas.width / pr;
    H = canvas.height / pr;
  }
  const aspect = largura / altura;
  // maior região com a proporção pedida, centrada no canvas
  let cw = W;
  let ch = W / aspect;
  if (ch > H) {
    ch = H;
    cw = H * aspect;
  }
  const x = (W - cw) / 2;
  const y = (H - ch) / 2;
  const box = frameBox(ed, ids);
  const cam = tempCamera(ed, vista, box, aspect);

  // tira da imagem o que é só da interface
  const hide = [ed.handles.root, ed.protractor.root, ed.surface.fill, ed.surface.edges, ed.ruler.root];
  if (ed.tools && ed.tools.mark) hide.push(ed.tools.mark.outline); // realce da parte sob o cursor
  for (const m of ed.meshes.values()) if (m.userData.outline) hide.push(m.userData.outline);
  const was = hide.map((o) => o.visible);
  hide.forEach((o) => (o.visible = false));
  const out = document.createElement('canvas');
  out.width = largura;
  out.height = altura;
  const g = out.getContext('2d');
  try {
    r.setViewport(x, y, cw, ch);
    r.setScissor(x, y, cw, ch);
    r.setScissorTest(true);
    r.render(ed.scene, cam);
    const grad = g.createLinearGradient(0, 0, 0, altura);
    grad.addColorStop(0, cssVar('--view-top', '#f3f5f7'));
    grad.addColorStop(1, cssVar('--view-bottom', '#dfe3e8'));
    g.fillStyle = grad;
    g.fillRect(0, 0, largura, altura);
    // região do canvas em pixels do buffer (y de cima para baixo no drawImage)
    g.drawImage(canvas, x * pr, y * pr, cw * pr, ch * pr, 0, 0, largura, altura);
  } finally {
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    hide.forEach((o, i) => (o.visible = was[i]));
    r.render(ed.scene, ed.camera); // a vista do usuário volta no mesmo quadro
  }
  if (marcacoes && ed.marks && ed.marks.length) {
    const scale = Math.max(1, largura / 800);
    for (const m of ed.marks) {
      const p = new THREE.Vector3(...m.p).project(cam);
      if (p.z < -1 || p.z > 1) continue;
      drawPin(g, ((p.x + 1) / 2) * largura, ((1 - p.y) / 2) * altura, m.n, scale);
    }
  }
  return { imagem: out.toDataURL('image/png'), largura, altura, vista };
}
