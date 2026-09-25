import * as THREE from 'three';
import { theme } from './theme.js';

const solids = new Map();

export function solidMaterial(hex) {
  const key = (hex || '#e3302d').toLowerCase();
  let m = solids.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: key,
      roughness: 0.62,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    m.userData.colorHex = key;
    solids.set(key, m);
  }
  return m;
}

// Furo: cinza translúcido com listras diagonais (em coordenadas de mundo)
function stripes(material, opacityScale = 1) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStripePos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvStripePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStripePos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float stripe = step(0.5, fract((vStripePos.x + vStripePos.y - vStripePos.z) * 0.2));
        diffuseColor.rgb *= mix(1.0, 0.78, stripe);
        diffuseColor.a *= ${opacityScale.toFixed(2)};`,
      );
  };
  return material;
}

export const holeMaterial = stripes(
  new THREE.MeshStandardMaterial({
    roughness: 0.7,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }),
);
holeMaterial.userData.isHole = true;

export const holeThumbMaterial = stripes(new THREE.MeshStandardMaterial({ roughness: 0.7 }));

export const outlineSelected = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
export const outlineHover = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 });

// Cores do tema: furo e contornos trocam só .color/.opacity (materiais compartilhados por todas
// as malhas, inclusive grupos já calculados). As cores das peças não mudam com o tema.
theme.watch((c) => {
  holeMaterial.color.set(c.hole);
  holeMaterial.opacity = c.holeOpacity;
  holeThumbMaterial.color.set(c.holeThumb);
  outlineSelected.color.set(c.outline);
  outlineHover.color.set(c.outlineHover);
});
