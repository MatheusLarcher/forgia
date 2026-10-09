// Gera tests/fixtures/tres-partes.stl (binário, Z para cima, mm): três partes soltas para o
// Desagrupar de peça importada. node tests/fixtures/gerar-tres-partes.mjs
import fs from 'node:fs';
import * as THREE from 'three';

const tris = [];
function add(g) {
  const a = g.toNonIndexed().attributes.position.array;
  for (let i = 0; i < a.length; i += 9) tris.push(Array.from(a.slice(i, i + 9)));
}
function cubo(x, y, z, l) {
  add(new THREE.BoxGeometry(l, l, l).translate(x + l / 2, y + l / 2, z + l / 2));
}
cubo(0, 0, 0, 10); // parte 1: cubo de 10
add(new THREE.CylinderGeometry(4, 4, 12, 48).rotateX(Math.PI / 2).translate(25, 5, 6)); // parte 2: cilindro Ø8 × 12
cubo(0, 20, 0, 6); // parte 3: dois cubos de 6 que só dividem uma aresta
cubo(6, 26, 0, 6);

const buf = Buffer.alloc(84 + 50 * tris.length);
buf.write('Forgia: tres partes soltas', 0);
buf.writeUInt32LE(tris.length, 80);
tris.forEach((t, i) => {
  for (let k = 0; k < 9; k++) buf.writeFloatLE(t[k], 84 + 50 * i + 12 + 4 * k);
});
fs.writeFileSync(new URL('./tres-partes.stl', import.meta.url), buf);
console.log(`${tris.length} triângulos`);
