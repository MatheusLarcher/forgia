import * as THREE from 'three';
import { t } from './textos/index.js';
import { theme } from './theme.js';

// Plano de trabalho (tecla P): uma face vira o "chão" temporário. Fica só no editor
// (editor.wplane), fora do projeto e do histórico: fechar e abrir de novo volta para a mesa.
// Enquanto está ativo, formas novas, arraste, setas do teclado, o cone de elevar, "soltar"
// (Shift+D), a elevação nas cotas e o X/Y/Z da barra de status usam o quadro do plano.
//
// Quadro: origem no ponto clicado, eixo local y = normal da face, eixo local x = direção da aresta
// da face mais perto do clique (projetada no plano) e z = x × y, como a mesa (x, y para cima, z).
// No sistema do usuário (src/coords.js), relativo ao plano: X = x, Y = −z, Z = y (a normal).

const EXTENT = 100; // meia largura da grade desenhada (mm)
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class WorkplaneFrame {
  constructor(origin, normal, xAxis) {
    this.origin = origin.clone();
    this.normal = normal.clone().normalize();
    let x = xAxis ? xAxis.clone() : null;
    if (!x || x.lengthSq() < 1e-10) {
      // sem aresta (face curva): o X da mesa projetado no plano (ou o Z, se a face for vertical em X)
      x = V3(1, 0, 0);
      if (Math.abs(x.dot(this.normal)) > 0.9) x = V3(0, 0, 1);
    }
    x.addScaledVector(this.normal, -x.dot(this.normal)).normalize();
    this.x = x;
    this.z = new THREE.Vector3().crossVectors(this.x, this.normal).normalize();
    this.quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.x, this.normal, this.z));
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, this.origin);
    this.id = Math.random().toString(36).slice(2, 8);
    this.visual = buildGrid(this);
  }

  // mundo -> coordenadas do plano [x, y (altura sobre o plano), z]
  toLocal(v) {
    const d = V3().subVectors(v, this.origin);
    return V3(d.dot(this.x), d.dot(this.normal), d.dot(this.z));
  }
  dirToLocal(d) {
    return V3(d.dot(this.x), d.dot(this.normal), d.dot(this.z));
  }
  toWorld(l) {
    return this.origin.clone().addScaledVector(this.x, l.x).addScaledVector(this.normal, l.y).addScaledVector(this.z, l.z);
  }
  dirToWorld(dx, dy, dz) {
    return V3().addScaledVector(this.x, dx).addScaledVector(this.normal, dy).addScaledVector(this.z, dz);
  }
  // ponto do plano mais perto de p, com x/z na grade do plano (step mm, 0 = sem grade)
  snapPoint(p, step) {
    const l = this.toLocal(p);
    const s = (v) => (step > 0 ? Math.round(v / step) * step : v);
    return this.toWorld(V3(s(l.x), 0, s(l.z)));
  }
  intersectRay(ray) {
    const p = V3();
    return ray.intersectPlane(this.plane, p) ? p : null;
  }
  // o ponto (e a normal) estão no próprio plano (a face que o criou)?
  contains(point, normal) {
    return Math.abs(V3().subVectors(point, this.origin).dot(this.normal)) < 0.05 && (!normal || normal.dot(this.normal) > 0.999);
  }
  // coordenadas do usuário relativas ao plano: [X, Y, Z] = [x, −z, y]
  toUser(v) {
    const l = this.toLocal(v);
    return [l.x, -l.z, l.y];
  }
  dispose() {
    this.visual.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.stopTheme) this.stopTheme();
  }
}

// grade 2D no plano: linhas de 1 mm e de 10 mm em volta da origem, uma placa translúcida e os eixos
function buildGrid(frame) {
  const g = new THREE.Group();
  g.name = 'plano-de-trabalho';
  const minor = [];
  const major = [];
  for (let i = -EXTENT; i <= EXTENT; i++) {
    const arr = i % 10 === 0 ? major : minor;
    arr.push(i, 0, -EXTENT, i, 0, EXTENT, -EXTENT, 0, i, EXTENT, 0, i);
  }
  const lines = (arr, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const ls = new THREE.LineSegments(geo, mat);
    ls.raycast = () => {};
    ls.renderOrder = 4;
    return ls;
  };
  const mats = {
    plate: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    minor: new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }),
    major: new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }),
    axis: new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, depthTest: false }),
  };
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2), mats.plate);
  plate.rotation.x = -Math.PI / 2;
  plate.raycast = () => {};
  plate.renderOrder = 3;
  const axis = lines([0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, -12], mats.axis);
  axis.renderOrder = 5;
  g.add(plate, lines(minor, mats.minor), lines(major, mats.major), axis);
  // um fio acima da face, para não brigar com ela na profundidade
  g.position.copy(frame.origin).addScaledVector(frame.normal, 0.03);
  g.quaternion.copy(frame.quat);
  frame.stopTheme = theme.watch((c) => {
    mats.plate.color.set(c.outline);
    mats.plate.opacity = 0.08;
    mats.minor.color.set(c.gridMajor);
    mats.minor.opacity = 0.35;
    mats.major.color.set(c.outline);
    mats.major.opacity = 0.7;
    mats.axis.color.set(c.outline);
    mats.axis.opacity = 1;
  });
  return g;
}

// Ferramenta de escolher a face (P). Clique numa face: ela vira o plano de trabalho. Clique na
// mesa: volta para a mesa. Em qualquer caso a ferramenta sai. P com o plano ativo volta à mesa
// (ui.js), sem passar por aqui.
export class WorkplaneTool {
  constructor(editor) {
    this.ed = editor;
    this.name = 'workplane';
  }

  enter() {
    this.ed.viewport.classList.add('picking-plane');
  }

  exit() {
    this.ed.viewport.classList.remove('picking-plane');
    this.ed.surface.hide();
  }

  hint() {
    return t.modos.plano;
  }

  onMove(e) {
    if (e.buttons) return false; // botão direito/meio: a vista gira ou anda
    const h = this.ed.surface.hit(e);
    if (h && !h.table) this.ed.surface.show(h, 20);
    else this.ed.surface.hide();
    return true;
  }

  onDown(e) {
    const ed = this.ed;
    const h = ed.surface.hit(e);
    if (h && !h.table) ed.setWorkplaneFrame(new WorkplaneFrame(h.point, h.normal, ed.surface.nearestEdgeDir(h)));
    else ed.clearWorkplaneFrame();
    ed.setTool(null);
    return true;
  }

  onUp() {
    return true;
  }
}
