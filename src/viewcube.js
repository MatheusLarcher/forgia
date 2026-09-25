import * as THREE from 'three';
import { createRenderer } from './gpu.js';

// Cubo de navegação (canto superior esquerdo). Clique em face, aresta ou vértice.
const LABELS = ['DIREITA', 'ESQUERDA', 'SUPERIOR', 'INFERIOR', 'FRENTE', 'TRÁS'];

function faceTexture(text, hover = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = hover ? '#cfe6fb' : '#f4f5f6';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#b9bec4';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  g.fillStyle = '#5b6168';
  g.font = `600 ${text.length > 7 ? 36 : 42}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
    this.textures = LABELS.map((l) => faceTexture(l));
    this.hoverTextures = LABELS.map((l) => faceTexture(l, true));
    this.materials = this.textures.map((t) => new THREE.MeshBasicMaterial({ map: t }));
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.cube = new THREE.Mesh(geo, this.materials);
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x9aa1a8 }));
    this.cube.add(edges);

    // sombra/base sob o cubo
    const base = new THREE.Mesh(
      new THREE.RingGeometry(0.74, 0.82, 48),
      new THREE.MeshBasicMaterial({ color: 0xc9ced3, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.56;
    this.scene.add(base);

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
