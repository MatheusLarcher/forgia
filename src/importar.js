import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parse3MF } from './threemf.js';

// Leitura de STL/OBJ/3MF para uma malha do Forgia, usada pelo botão Importar (ui.js) e pelo comando
// importar da ponte da IA (o arquivo chega do processo main). Devolve
//   { positions: Float32Array (triângulos soltos, Y para cima), size: [x, y, z] em mm }
// ou lança erro: ImportError('formato') para extensão não suportada, ImportError('vazio') sem
// triângulos; qualquer outro erro é de leitura do arquivo (mensagem do leitor).
export class ImportError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

export const MODEL_EXTS = ['stl', 'obj', '3mf'];

export function parseModel(name, buffer) {
  const ext = String(name).split('.').pop().toLowerCase();
  let geo;
  if (ext === 'stl') {
    geo = new STLLoader().parse(buffer);
  } else if (ext === '3mf') {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(parse3MF(buffer), 3));
  } else if (ext === 'obj') {
    const root = new OBJLoader().parse(new TextDecoder().decode(buffer));
    const pos = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      pos.push(...g.attributes.position.array);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  } else {
    throw new ImportError('formato');
  }
  if (geo.index) geo = geo.toNonIndexed();
  if (ext === 'stl' || ext === '3mf') geo.rotateX(-Math.PI / 2); // Z para cima -> Y para cima
  if (!geo.attributes.position.count) throw new ImportError('vazio');
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return {
    positions: new Float32Array(geo.attributes.position.array),
    size: [s.x || 1, s.y || 1, s.z || 1].map((v) => Math.round(v * 100) / 100),
  };
}
