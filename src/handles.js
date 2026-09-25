import * as THREE from 'three';
import { theme } from './theme.js';

// Alças de manipulação no estilo Tinkercad:
// quadrados brancos nos cantos (redimensiona 2 eixos), pretos nas arestas (1 eixo),
// quadrado branco no topo (altura), cone preto (elevar) e 3 setas curvas (girar).
// As cores vêm do tema; na troca, só texturas e cores de material mudam.

// transparent: true põe as alças na mesma passada do plano de trabalho (translúcido),
// e o renderOrder alto garante que sejam desenhadas por cima dele
const solidMat = () => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

// quadrado 2D (sprite) com borda; o miolo ocupa 60% da textura, o resto é área de clique
function squareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// redesenha o mesmo canvas com as cores do tema
function paintSquare(tex, { fill, stroke }) {
  const g = tex.image.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = stroke;
  g.fillRect(13, 13, 38, 38);
  g.fillStyle = fill;
  g.fillRect(18, 18, 28, 28);
  tex.needsUpdate = true;
}
const TEX = { corner: squareTexture(), edge: squareTexture(), hover: squareTexture() };
theme.watch((c) => {
  paintSquare(TEX.corner, c.handleCorner);
  paintSquare(TEX.edge, c.handleEdge);
  paintSquare(TEX.hover, c.handleHover);
});

function squareHandle(kind) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[kind], depthTest: false, depthWrite: false, transparent: true }));
  m.renderOrder = 1001;
  m.userData.fill = m;
  m.userData.baseMap = TEX[kind];
  return m;
}

function arrowGeometry() {
  // arco de ~110° com pontas de seta nas duas extremidades, no plano XY
  const R = 1;
  const a0 = 35 * (Math.PI / 180);
  const a1 = 145 * (Math.PI / 180);
  const arcG = new THREE.TorusGeometry(R, 0.09, 6, 28, a1 - a0);
  arcG.rotateZ(a0);
  const parts = [arcG];
  for (const [a, dir] of [[a0, -1], [a1, 1]]) {
    const cone = new THREE.ConeGeometry(0.24, 0.45, 12);
    // tangente no ponto a
    const tx = -Math.sin(a) * dir;
    const ty = Math.cos(a) * dir;
    cone.rotateZ(Math.atan2(ty, tx) - Math.PI / 2);
    cone.translate(R * Math.cos(a) + tx * 0.15, R * Math.sin(a) + ty * 0.15, 0);
    parts.push(cone);
  }
  const merged = mergeSimple(parts);
  merged.translate(0, -R * 0.75, 0);
  return merged;
}

function mergeSimple(geos) {
  const pos = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}

export class Handles {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.items = [];
    this.hovered = null;

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.add({ type: 'corner', sx, sz }, squareHandle('corner'));
    }
    for (const s of [-1, 1]) {
      this.add({ type: 'edge', axis: 'x', s }, squareHandle('edge'));
      this.add({ type: 'edge', axis: 'z', s }, squareHandle('edge'));
    }
    this.add({ type: 'top' }, squareHandle('corner'));

    const cone = new THREE.Group();
    const coneMesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 20), solidMat());
    coneMesh.renderOrder = 1001;
    const coneHit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8), hitMat);
    cone.add(coneMesh, coneHit);
    cone.userData.fill = coneMesh;
    this.add({ type: 'lift' }, cone);

    const arrowGeo = arrowGeometry();
    for (const axis of ['x', 'y', 'z']) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      const m = new THREE.Mesh(arrowGeo, solidMat());
      m.renderOrder = 1001;
      const hit = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 6, 16, Math.PI * 0.75), hitMat);
      hit.geometry.rotateZ(Math.PI * 0.125);
      hit.geometry.translate(0, -0.75, 0);
      inner.add(m, hit);
      if (axis === 'x') inner.rotation.y = Math.PI / 2;
      if (axis === 'y') inner.rotation.x = -Math.PI / 2;
      g.add(inner);
      g.userData.fill = m;
      this.add({ type: 'rot', axis }, g);
    }

    // cone e setas pintados com a paleta atual (os quadrados usam as texturas do tema)
    theme.watch((colors) => {
      this.colors = colors;
      for (const it of this.items) this.paint(it, it === this.hovered);
    });
  }

  add(info, obj) {
    obj.userData.handle = info;
    info.object = obj;
    this.root.add(obj);
    this.items.push(info);
  }

  // frame: { pos: Vector3, quat: Quaternion, size: Vector3 }, px: tamanho de 1 pixel em unidades do mundo
  update(frame, px, opts = {}) {
    if (!frame) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.root.position.copy(frame.pos);
    this.root.quaternion.copy(frame.quat);
    const hw = frame.size.x / 2;
    const hh = frame.size.y / 2;
    const hd = frame.size.z / 2;
    const sq = 17 * px; // sprite: miolo visível ≈ 10 px, resto é área de clique
    for (const it of this.items) {
      const o = it.object;
      o.visible = !opts.only || opts.only === it;
      if (opts.locked) o.visible = false;
      switch (it.type) {
        case 'corner':
          o.position.set(it.sx * hw, -hh, it.sz * hd);
          o.scale.setScalar(sq);
          break;
        case 'edge':
          o.position.set(it.axis === 'x' ? it.s * hw : 0, -hh, it.axis === 'z' ? it.s * hd : 0);
          o.scale.setScalar(sq * 0.8);
          break;
        case 'top':
          o.position.set(0, hh, 0);
          o.scale.setScalar(sq);
          break;
        case 'lift':
          o.position.set(0, hh + 26 * px, 0);
          o.scale.setScalar(12 * px);
          break;
        case 'rot': {
          const off = 24 * px;
          if (it.axis === 'y') o.position.set(-hw - off * 0.7, -hh, hd + off * 0.7);
          if (it.axis === 'z') o.position.set(-hw - off, 0, hd);
          if (it.axis === 'x') o.position.set(hw, 0, hd + off);
          o.scale.setScalar(16 * px);
          if (it.axis === 'y') o.rotation.y = Math.PI / 4;
          break;
        }
      }
    }
  }

  pick(raycaster) {
    if (!this.root.visible) return null;
    const objs = this.items.filter((i) => i.object.visible).map((i) => i.object);
    const hits = raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.handle) o = o.parent;
      if (o) return o.userData.handle;
    }
    return null;
  }

  setHover(item) {
    if (this.hovered === item) return;
    if (this.hovered) this.paint(this.hovered, false);
    this.hovered = item;
    if (item) this.paint(item, true);
  }

  paint(item, on) {
    const fill = item.object.userData.fill;
    if (fill.isSprite) fill.material.map = on ? TEX.hover : fill.userData.baseMap;
    else fill.material.color.set(on ? this.colors.handleSolidHover : this.colors.handleSolid);
  }
}

// Transferidor exibido durante a rotação
export class Protractor {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 96),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.renderOrder = 990;
    const ticks = [];
    for (let i = 0; i < 360; i += 5) {
      const a = (i * Math.PI) / 180;
      const major = i % 22.5 === 0 || i % 45 === 0;
      const r0 = major ? 0.8 : 0.9;
      ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a), Math.sin(a), 0);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i * 22.5 * Math.PI) / 180;
      ticks.push(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0, Math.cos(a), Math.sin(a), 0);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    const tickLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ depthTest: false }));
    tickLines.renderOrder = 991;
    this.sector = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 48, 0, 0.001),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthTest: false }),
    );
    this.sector.renderOrder = 992;
    this.root.add(ring, tickLines, this.sector);
    theme.watch(({ protractor: p }) => {
      ring.material.color.set(p.ring);
      ring.material.opacity = p.ringOpacity;
      tickLines.material.color.set(p.ticks);
      this.sector.material.color.set(p.sector);
      this.sector.material.opacity = p.sectorOpacity;
    });
  }

  show(center, axis, refDir, radius) {
    const z = axis.clone().normalize();
    const x = refDir.clone().sub(z.clone().multiplyScalar(refDir.dot(z))).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.root.position.copy(center);
    this.root.scale.setScalar(radius);
    this.root.visible = true;
    this.setAngle(0);
  }

  setAngle(rad) {
    this.sector.geometry.dispose();
    const len = Math.abs(rad) < 1e-4 ? 0.0001 : rad;
    this.sector.geometry = new THREE.CircleGeometry(0.72, 48, Math.min(0, len), Math.abs(len));
  }

  hide() {
    this.root.visible = false;
  }
}
