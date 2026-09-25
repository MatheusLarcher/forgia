import * as THREE from 'three';
import { SHAPES, shapeGeometry, defaultParams, defaultSize } from './shapes.js';
import { solidMaterial, holeThumbMaterial } from './materials.js';
import { createRenderer } from './gpu.js';

// Gera miniaturas 3D das formas da biblioteca com um renderizador fora da tela
export function renderThumbnails(specs, px = 160) {
  const renderer = createRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(px, px);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f98a3, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-1.2, 2.4, 1.6);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const out = [];
  for (const spec of specs) {
    const params = defaultParams(spec.type, spec.params);
    const size = spec.size || defaultSize(spec.type, params);
    const geo = shapeGeometry({ type: spec.type, params, size });
    const mesh = new THREE.Mesh(geo, spec.hole ? holeThumbMaterial : solidMaterial(spec.color || SHAPES[spec.type].color));
    scene.add(mesh);
    // formas planas (texto) ficam mais legíveis vistas de cima
    const flat = spec.type === 'text';
    const r = flat ? Math.max(size[0], size[2]) / 2 : Math.hypot(...size) / 2;
    const dir = (flat ? new THREE.Vector3(0.15, 1.3, 0.75) : new THREE.Vector3(0.9, 0.85, 1.25)).normalize();
    camera.position.copy(dir.multiplyScalar((r / Math.sin(THREE.MathUtils.degToRad(15))) * (flat ? 1.12 : 1.02)));
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    out.push(renderer.domElement.toDataURL('image/png'));
    scene.remove(mesh);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
