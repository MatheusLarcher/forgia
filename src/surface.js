import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { outlineGeometry } from './edges.js';
import { theme } from './theme.js';

// Superfície das peças sob o cursor: raio acelerado (BVH do three-mesh-bvh), normal da face no
// mundo e a região realçada em verde (Cruzeiro e forma nova arrastada da biblioteca).
//
// - O raio usa uma BVH por geometria, feita na primeira vez que a geometria é consultada. A opção
//   'indirect' não mexe no índice da geometria (as geometrias são compartilhadas pelo cache de
//   formas e usadas pelo CSG e pelo contorno de seleção).
// - Região plana: os triângulos vizinhos no mesmo plano do triângulo atingido. Vizinho = divide um
//   vértice, com os vértices agrupados por posição (a malha de resultado de booleana tem vértices
//   repetidos e junções em T). A topologia fica numa WeakMap por geometria (vai embora junto com
//   ela), e cada região achada fica marcada nos triângulos dela: passar de novo pela mesma face não
//   refaz nada. A geometria do verde é só a da face mostrada: outra face a troca com dispose().
// - Face curva (esfera, lateral de cilindro): a "região plana" é só uma faceta pequena com vizinhos
//   quase alinhados; aí o realce é uma área em volta do ponto, com a borda esmaecida no shader.
// - Malha grande (mais de MAX_TOPOLOGY_TRIS triângulos, ex.: STL importado de 1 milhão): montar a
//   topologia e o contorno da peça travaria a tela por segundos. O verde é sempre a área em volta
//   do ponto, achada pela BVH do raio (triângulos perto e quase alinhados com a face atingida, sem
//   seguir vizinhos), e o contorno verde da peça não aparece.

// com BVH na geometria, o raio usa a árvore; sem BVH, cai no raycast normal do three
THREE.Mesh.prototype.raycast = acceleratedRaycast;
const ours = new WeakSet(); // BVHs feitas aqui (uma BVH de outra origem pode estar desatualizada)

export function ensureBVH(geometry) {
  if (!geometry.boundsTree || !ours.has(geometry.boundsTree)) {
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    ours.add(geometry.boundsTree);
  }
  return geometry.boundsTree;
}

const UP = new THREE.Vector3(0, 1, 0);
const TABLE = new THREE.Plane(UP.clone(), 0);
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
const COPLANAR = Math.cos(THREE.MathUtils.degToRad(1.5)); // normais "iguais" na mesma face plana
const SMOOTH = Math.cos(THREE.MathUtils.degToRad(40)); // vizinho quase alinhado = superfície curva
const PATCH = Math.cos(THREE.MathUtils.degToRad(75)); // até onde a área em volta do ponto se estende

// normal perto de um eixo (menos de ~0,5°) vira o eixo exato: face de cima de caixa ou de grupo não
// deixa a peça torta por arredondamento
function snapAxis(n) {
  for (const a of AXES) if (n.dot(a) > 0.99996) return n.copy(a);
  return n;
}

// ---------------- topologia (cache por geometria) ----------------

// acima disso não há topologia nem contorno da peça: só a área em volta do ponto (veja o topo)
export const MAX_TOPOLOGY_TRIS = 100000;

const triCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

const topoCache = new WeakMap(); // geometria -> topologia, como o contorno em src/edges.js

function topology(geo) {
  let t = topoCache.get(geo);
  if (!t) topoCache.set(geo, (t = buildTopology(geo)));
  return t;
}

function buildTopology(geo) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const n = (index ? index.count : pos.count) / 3;
  geo.computeBoundingSphere();
  const scale = Math.max(geo.boundingSphere.radius, 1e-3);
  const q = 1e5 / scale;
  const weld = new Map();
  const vid = new Int32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const dist = new Float32Array(n);
  const cen = new Float32Array(n * 3);
  const area = new Float32Array(n);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t * 3 + k) : t * 3 + k;
      v[k].fromBufferAttribute(pos, i);
      const key = `${Math.round(v[k].x * q)},${Math.round(v[k].y * q)},${Math.round(v[k].z * q)}`;
      let id = weld.get(key);
      if (id === undefined) weld.set(key, (id = weld.size));
      vid[t * 3 + k] = id;
    }
    ab.subVectors(v[1], v[0]);
    ac.subVectors(v[2], v[0]);
    ab.cross(ac);
    const len = ab.length();
    area[t] = len / 2;
    if (len > 1e-12) ab.divideScalar(len);
    else ab.set(0, 0, 0); // triângulo degenerado: nunca entra numa região
    normal.set([ab.x, ab.y, ab.z], t * 3);
    dist[t] = ab.dot(v[0]);
    cen.set([(v[0].x + v[1].x + v[2].x) / 3, (v[0].y + v[1].y + v[2].y) / 3, (v[0].z + v[1].z + v[2].z) / 3], t * 3);
  }
  // vértice (agrupado) -> triângulos que o usam
  const nv = weld.size;
  const start = new Int32Array(nv + 1);
  for (let i = 0; i < vid.length; i++) start[vid[i] + 1]++;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nv);
  const tris = new Int32Array(vid.length);
  for (let i = 0; i < vid.length; i++) tris[fill[vid[i]]++] = (i / 3) | 0;
  return { n, vid, normal, dist, cen, area, start, tris, eps: scale * 1e-4, region: new Int32Array(n).fill(-1), regions: [] };
}

const dotN = (T, a, b) => T.normal[a * 3] * T.normal[b * 3] + T.normal[a * 3 + 1] * T.normal[b * 3 + 1] + T.normal[a * 3 + 2] * T.normal[b * 3 + 2];

// percorre os triângulos que dividem vértice com t
function eachNeighbor(T, t, fn) {
  for (let k = 0; k < 3; k++) {
    const id = T.vid[t * 3 + k];
    for (let j = T.start[id]; j < T.start[id + 1]; j++) fn(T.tris[j]);
  }
}

// região plana que contém o triângulo seed (calculada uma vez por região)
function planarRegion(T, seed) {
  if (T.region[seed] >= 0) return T.regions[T.region[seed]];
  const id = T.regions.length;
  const seen = new Set([seed]);
  const out = [seed];
  let area = 0;
  let smooth = false;
  for (let s = 0; s < out.length; s++) {
    const t = out[s];
    area += T.area[t];
    eachNeighbor(T, t, (u) => {
      if (seen.has(u)) return;
      seen.add(u);
      const d = dotN(T, u, seed);
      if (d > COPLANAR && Math.abs(T.dist[u] - T.dist[seed]) < T.eps) out.push(u);
      else if (d > SMOOTH && T.area[u] > 0) smooth = true;
    });
  }
  const r = { id, tris: Int32Array.from(out), area, smooth };
  for (const t of out) T.region[t] = id;
  T.regions.push(r);
  return r;
}

// área em volta do ponto numa superfície curva: triângulos ligados ao seed, quase alinhados com ele
// e com o centro a menos de "radius" (mundo) do ponto
function patchAround(T, seed, pointWorld, radius, matrixWorld) {
  const c = new THREE.Vector3();
  const seen = new Set([seed]);
  const out = [seed];
  const lim = radius * 1.15;
  for (let s = 0; s < out.length && out.length < 20000; s++) {
    eachNeighbor(T, out[s], (u) => {
      if (seen.has(u)) return;
      seen.add(u);
      if (T.area[u] <= 0 || dotN(T, u, seed) < PATCH) return;
      c.fromArray(T.cen, u * 3).applyMatrix4(matrixWorld);
      if (c.distanceTo(pointWorld) < lim) out.push(u);
    });
  }
  return out;
}

// a mesma área, sem topologia (malha grande): a BVH do raio dá os triângulos com o centro a menos
// de "radius" (mundo) do ponto e quase alinhados com o seed. Sem seguir vizinhos, uma face paralela
// muito perto do ponto (menos que o raio) também entra.
function patchByBVH(geo, seed, pointWorld, radius, matrixWorld) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const corner = (t, k, v) => v.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n0 = new THREE.Triangle(corner(seed, 0, a), corner(seed, 1, b), corner(seed, 2, c)).getNormal(new THREE.Vector3());
  // esfera no espaço da geometria que cobre a do mundo (a escala da peça pode mudar por eixo)
  const s = new THREE.Vector3().setFromMatrixScale(matrixWorld);
  const minScale = Math.max(Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)), 1e-9);
  const lim = radius * 1.15;
  const sphere = new THREE.Sphere(pointWorld.clone().applyMatrix4(matrixWorld.clone().invert()), lim / minScale);
  const n = new THREE.Vector3();
  const out = [];
  ensureBVH(geo).shapecast({
    intersectsBounds: (box) => sphere.intersectsBox(box),
    intersectsTriangle: (tri, t) => {
      if (tri.getNormal(n).dot(n0) < PATCH) return false;
      if (tri.getMidpoint(c).applyMatrix4(matrixWorld).distanceTo(pointWorld) < lim) out.push(t);
      return out.length >= 20000; // true = para a busca
    },
  });
  return out;
}

// triângulos (espaço da geometria) -> geometria só com posições
function trianglesGeometry(geo, tris) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const arr = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t * 3 + k) : t * 3 + k;
      arr[o++] = pos.getX(i);
      arr[o++] = pos.getY(i);
      arr[o++] = pos.getZ(i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

// verde translúcido; com radius > 0 a borda esmaece em volta de center (face curva)
function highlightMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color() },
      opacity: { value: 0.4 },
      center: { value: new THREE.Vector3() },
      radius: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      uniform vec3 center;
      uniform float radius;
      varying vec3 vWorld;
      void main() {
        float a = opacity;
        if (radius > 0.0) a *= 1.0 - smoothstep(radius * 0.6, radius, distance(vWorld, center));
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class Surface {
  constructor(editor) {
    this.ed = editor;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), highlightMaterial());
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
    for (const o of [this.fill, this.edges]) {
      o.matrixAutoUpdate = false;
      o.visible = false;
      o.raycast = () => {};
      o.renderOrder = 3;
      editor.scene.add(o);
    }
    this.fillGeo = null; // geometria do verde agora (setFill)
    this.fillKey = null; // região plana dela (null = área em volta do ponto, refeita a cada ponto)
    theme.watch(({ cruise }) => {
      this.fill.material.uniforms.color.value.set(cruise.face);
      this.fill.material.uniforms.opacity.value = cruise.faceOpacity;
      this.edges.material.color.set(cruise.edge);
      this.edges.material.opacity = cruise.edgeOpacity;
    });
  }

  // Ponto da superfície sob o cursor, sem as peças de exclude (Set de ids):
  // { point, normal (mundo, unitária), mesh, id, tri } numa peça, ou { point, normal: +Y, table: true }
  // na mesa; null se o raio não pega nada.
  hit(e, exclude = new Set()) {
    const ed = this.ed;
    ed.setRay(e);
    this.raycaster.ray.copy(ed.raycaster.ray);
    this.raycaster.camera = ed.camera;
    const meshes = [];
    for (const m of ed.meshes.values()) {
      if (!m.visible || exclude.has(m.userData.id)) continue;
      ensureBVH(m.geometry);
      meshes.push(m);
    }
    const h = this.raycaster.intersectObjects(meshes, false)[0];
    if (h && h.face) {
      const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
      const normal = snapAxis(h.face.normal.clone().applyMatrix3(nm).normalize());
      return { point: h.point.clone(), normal, mesh: h.object, id: h.object.userData.id, tri: h.faceIndex };
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(TABLE, p)) return { point: p, normal: UP.clone(), table: true };
    return null;
  }

  // realça a face de h (resultado de hit) e o contorno da peça-alvo; size (mm) = maior lado da
  // base da peça que vai apoiar: decide se a face é "curva" e dá o tamanho da área em volta do ponto
  show(h, size) {
    if (!h || h.table || !h.mesh) return this.hide();
    const mesh = h.mesh;
    const geo = mesh.geometry;
    const big = triCount(geo) > MAX_TOPOLOGY_TRIS;
    const radius = patchRadius(size);
    let curved = true;
    let reg = null;
    let T = null;
    if (!big) {
      T = topology(geo);
      reg = planarRegion(T, h.tri);
      const m3 = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld);
      const nLocal = new THREE.Vector3().fromArray(T.normal, h.tri * 3);
      const areaScale = Math.abs(m3.determinant()) * nLocal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).length();
      // curva: faceta menor que metade de um disco do tamanho da base da peça, com vizinho alinhado
      const rBase = Math.max(size, 2) * 0.6;
      curved = reg.smooth && reg.area * areaScale < 0.5 * Math.PI * rBase * rBase;
    }
    const u = this.fill.material.uniforms;
    if (curved) {
      const tris = big ? patchByBVH(geo, h.tri, h.point, radius, mesh.matrixWorld) : patchAround(T, h.tri, h.point, radius, mesh.matrixWorld);
      this.setFill(null, () => trianglesGeometry(geo, tris));
      u.center.value.copy(h.point);
      u.radius.value = radius;
    } else {
      this.setFill(reg, () => trianglesGeometry(geo, reg.tris));
      u.radius.value = 0;
    }
    if (!big) this.edges.geometry = outlineGeometry(geo, 28);
    for (const o of [this.fill, this.edges]) {
      o.matrix.copy(mesh.matrixWorld);
      o.matrixWorldNeedsUpdate = true;
    }
    this.fill.visible = true;
    this.edges.visible = !big;
    this.shown = { id: h.id, curved, big, tris: this.fill.geometry.attributes.position.count / 3 };
  }

  // troca a geometria do verde; a anterior recebe dispose(). key = região plana (a mesma face
  // reaproveita a geometria), null = área em volta do ponto (sempre refeita)
  setFill(key, build) {
    if (key && key === this.fillKey && this.fillGeo) return;
    if (this.fillGeo) this.fillGeo.dispose();
    this.fillGeo = build();
    this.fillKey = key;
    this.fill.geometry = this.fillGeo;
  }

  hide() {
    this.fill.visible = false;
    this.edges.visible = false;
    this.shown = null;
  }

  // Plano de trabalho (src/plano.js): direção (mundo, unitária, no plano da face) da aresta da
  // borda da face plana de h mais perto do ponto clicado. null em face curva, malha grande ou mesa.
  nearestEdgeDir(h) {
    if (!h || h.table || !h.mesh) return null;
    const geo = h.mesh.geometry;
    if (triCount(geo) > MAX_TOPOLOGY_TRIS) return null;
    const T = topology(geo);
    const reg = planarRegion(T, h.tri);
    if (reg.smooth && reg.tris.length < 3) return null;
    // arestas da borda: as que só um triângulo da região usa (vértices agrupados por posição)
    const count = new Map();
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    for (const t of reg.tris) {
      for (let k = 0; k < 3; k++) {
        const a = T.vid[t * 3 + k];
        const b = T.vid[t * 3 + ((k + 1) % 3)];
        const kk = key(a, b);
        const e = count.get(kk);
        if (e) e.n++;
        else count.set(kk, { n: 1, t, k });
      }
    }
    const pos = geo.attributes.position;
    const index = geo.index;
    const corner = (t, k, v) => v.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(h.mesh.matrixWorld);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const line = new THREE.Line3();
    const q = new THREE.Vector3();
    let best = null;
    let bestD = Infinity;
    for (const e of count.values()) {
      if (e.n !== 1) continue;
      corner(e.t, e.k, a);
      corner(e.t, (e.k + 1) % 3, b);
      if (a.distanceToSquared(b) < 1e-8) continue;
      line.set(a, b);
      const d = line.closestPointToPoint(h.point, true, q).distanceToSquared(h.point);
      if (d < bestD) {
        bestD = d;
        best = b.clone().sub(a);
      }
    }
    if (!best) return null;
    best.addScaledVector(h.normal, -best.dot(h.normal));
    return best.lengthSq() > 1e-10 ? best.normalize() : null;
  }
}

// raio da área em volta do ponto (face curva): passa da base da peça para o verde aparecer em volta
const patchRadius = (size) => THREE.MathUtils.clamp(1.3 * size, 4, 60);
