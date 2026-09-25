import * as THREE from 'three';

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
    color: '#aab2ba',
    roughness: 0.7,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }),
);
holeMaterial.userData.isHole = true;

export const holeThumbMaterial = stripes(new THREE.MeshStandardMaterial({ color: '#b3bac1', roughness: 0.7 }));

export const outlineSelected = new THREE.LineBasicMaterial({ color: '#2f9bea', transparent: true, opacity: 0.95 });
export const outlineHover = new THREE.LineBasicMaterial({ color: '#7cc2f5', transparent: true, opacity: 0.8 });
