import * as THREE from 'three';
import { SHAPES, shapeGeometry, defaultParams, defaultSize } from './shapes.js';
import { solidMaterial, holeThumbMaterial } from './materials.js';
import { groupResult } from './csg.js';
import { createRenderer } from './gpu.js';

// Gera miniaturas 3D (PNG) com um renderizador fora da tela: as formas da biblioteca e os ícones
// das categorias (desenhados pelo próprio Forgia, nada copiado). Cada spec é:
//   { type, params?, size?, color?, hole? }       uma forma
//   { object }                                    um objeto do projeto (forma ou grupo, com a booleana)
//   { parts: [{ type, params?, size?, color?, pos? }] }  várias formas numa cena (ícone de categoria)
//   { ..., flat: true }                           vista de cima (texto)

function shapeMesh(spec) {
  const params = defaultParams(spec.type, spec.params);
  const size = spec.size || defaultSize(spec.type, params);
  const geo = shapeGeometry({ type: spec.type, params, size });
  const hole = spec.hole ?? SHAPES[spec.type].hole;
  const mesh = new THREE.Mesh(geo, hole ? holeThumbMaterial : solidMaterial(spec.color || SHAPES[spec.type].color));
  if (spec.pos) mesh.position.fromArray(spec.pos);
  if (spec.quat) mesh.quaternion.fromArray(spec.quat);
  return mesh;
}

// objeto do projeto como na cena (src/editor.js updateMesh): geometria unitária escalada pelo size
function objectMesh(o) {
  let geo;
  let base;
  let mat;
  if (o.type === 'group') {
    const r = groupResult(o);
    geo = r.geometry;
    base = r.baseSize;
    mat = o.hole ? holeThumbMaterial : o.color ? solidMaterial(o.color) : r.materials;
  } else {
    geo = shapeGeometry(o);
    base = o.size;
    mat = o.hole ? holeThumbMaterial : solidMaterial(o.color);
  }
  const mesh = new THREE.Mesh(geo, mat);
  const f = o.flip || [1, 1, 1];
  mesh.quaternion.fromArray(o.quat || [0, 0, 0, 1]);
  mesh.scale.set((o.size[0] / base[0]) * f[0], (o.size[1] / base[1]) * f[1], (o.size[2] / base[2]) * f[2]);
  return mesh;
}

function sceneFor(spec) {
  const root = new THREE.Group();
  if (spec.object) root.add(objectMesh(spec.object));
  else if (spec.parts) for (const p of spec.parts) root.add(shapeMesh(p));
  else root.add(shapeMesh(spec));
  return root;
}

export function renderThumbnails(specs, px = 160) {
  const renderer = createRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(px, px);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f98a3, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-1.2, 2.4, 1.6);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
  const out = [];
  for (const spec of specs) {
    let url = '';
    try {
      const root = sceneFor(spec);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      root.position.sub(c);
      scene.add(root);
      const size = box.getSize(new THREE.Vector3());
      // formas planas (texto) ficam mais legíveis vistas de cima
      const flat = spec.flat ?? spec.type === 'text';
      const r = flat ? Math.max(size.x, size.z) / 2 : size.length() / 2;
      const dir = (flat ? new THREE.Vector3(0.15, 1.3, 0.75) : new THREE.Vector3(0.9, 0.85, 1.25)).normalize();
      camera.position.copy(dir.multiplyScalar((r / Math.sin(THREE.MathUtils.degToRad(15))) * (flat ? 1.12 : 1.02)));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL('image/png');
      scene.remove(root);
    } catch (err) {
      console.warn('[thumbs] miniatura não gerada', err);
    }
    out.push(url);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
