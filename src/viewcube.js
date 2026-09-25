import * as THREE from 'three';
import { createRenderer } from './gpu.js';
import { t } from './textos/index.js';
import { theme } from './theme.js';

// Cubo de navegação (canto superior esquerdo). Clique em face, aresta ou vértice.
const LABELS = t.vista.cubo;

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// desenha a face (fundo, borda e rótulo) no canvas da própria textura, com as cores do tema
function paintFace(tex, text, fill, c) {
  const g = tex.image.getContext('2d');
  g.fillStyle = fill;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = c.border;
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  g.fillStyle = c.text;
  g.font = `600 ${text.length > 7 ? 36 : 42}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 132);
  tex.needsUpdate = true;
}

export class ViewCube {
  constructor(container, onPick) {
    this.onPick = onPick;
    this.size = 104;
    this.renderer = createRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.size, this.size);
    this.renderer.domElement.className = 'viewcube-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    this.textures = LABELS.map(() => faceTexture());
    this.hoverTextures = LABELS.map(() => faceTexture());
    this.materials = this.textures.map((tex) => new THREE.MeshBasicMaterial({ map: tex }));
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.cube = new THREE.Mesh(geo, this.materials);
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial());
    this.cube.add(edges);

    // sombra/base sob o cubo
    const base = new THREE.Mesh(
      new THREE.RingGeometry(0.74, 0.82, 48),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.56;
    this.scene.add(base);

    // cores do tema: redesenha as faces (normal e hover) e troca a cor das arestas e do anel
    theme.watch(({ cube: c }) => {
      LABELS.forEach((label, i) => {
        paintFace(this.textures[i], label, c.face, c);
        paintFace(this.hoverTextures[i], label, c.faceHover, c);
      });
      edges.material.color.set(c.edges);
      base.material.color.set(c.ring);
      base.material.opacity = c.ringOpacity;
    });

    this.raycaster = new THREE.Raycaster();
    this.hoverFace = -1;
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.hover(e));
    el.addEventListener('pointerleave', () => this.setHover(-1));
    el.addEventListener('click', (e) => this.click(e));
  }

  hit(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    return this.raycaster.intersectObject(this.cube, false)[0];
  }

  setHover(face) {
    if (face === this.hoverFace) return;
    if (this.hoverFace >= 0) this.materials[this.hoverFace].map = this.textures[this.hoverFace];
    this.hoverFace = face;
    if (face >= 0) this.materials[face].map = this.hoverTextures[face];
    this.renderer.domElement.style.cursor = face >= 0 ? 'pointer' : 'default';
  }

  hover(e) {
    const h = this.hit(e);
    this.setHover(h ? h.face.materialIndex : -1);
  }

  click(e) {
    const h = this.hit(e);
    if (!h) return;
    const p = h.point;
    const v = new THREE.Vector3(
      Math.abs(p.x) > 0.3 ? Math.sign(p.x) : 0,
      Math.abs(p.y) > 0.3 ? Math.sign(p.y) : 0,
      Math.abs(p.z) > 0.3 ? Math.sign(p.z) : 0,
    );
    if (v.lengthSq() === 0) return;
    this.onPick(v.normalize());
  }

  update(camera, target) {
    const dir = camera.position.clone().sub(target).normalize();
    this.camera.position.copy(dir.multiplyScalar(4.1));
    this.camera.up.copy(camera.up);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
