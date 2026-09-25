import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHAPES, shapeGeometry, defaultParams, defaultSize, textWidthFor } from './shapes.js';
import { solidMaterial, holeMaterial, outlineSelected, outlineHover } from './materials.js';
import { groupResult, aliasGroupResult, objectMatrix, geometrySize } from './csg.js';
import { Handles, Protractor } from './handles.js';
import { ViewCube } from './viewcube.js';
import { outlineGeometry } from './edges.js';
import { createRenderer } from './gpu.js';

const STORAGE = 'forgia.design.v1';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const r3 = (v) => Math.round(v * 1000) / 1000;
const HOME_DIR = V3(0.42, 0.62, 0.66).normalize();

export class Editor extends EventTarget {
  constructor(viewport) {
    super();
    this.viewport = viewport;
    this.objects = [];
    this.meshes = new Map();
    this.selection = [];
    this.history = [];
    this.historyIndex = -1;
    this.grid = 1;
    this.workplane = { w: 255, l: 255, h: 255 };
    this.name = 'Meu projeto 3D';
    this.mode = null; // 'align' | 'mirror'
    this.alignKey = null;
    this.clipboard = null;
    this.lastDuplicate = null;
    this.drag = null;
    this.placing = null;
    this.hoverId = null;
    this.dimsVisibleUntil = 0;

    this.initThree();
    this.initWorkplane();
    this.initOverlay();
    this.initEvents();
    this.load();
    this.loop();
  }

  // ---------------- cena ----------------

  initThree() {
    const r = (this.renderer = createRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'main-canvas';
    r.domElement.tabIndex = 0;
    this.viewport.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.objectsRoot = new THREE.Group();
    this.scene.add(this.objectsRoot);

    this.perspCam = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 20000);
    this.camera = this.perspCam;
    this.camera.position.copy(HOME_DIR.clone().multiplyScalar(330));
    this.scene.add(this.perspCam, this.orthoCam);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.9));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(-0.6, 1.0, 0.4);
    this.keyTarget = new THREE.Object3D();
    this.keyTarget.position.set(0, 0, -1);
    this.keyLight.target = this.keyTarget;
    this.camera.add(this.keyLight, this.keyTarget);

    // luz vertical só para a sombra projetada no plano de trabalho
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 0.02);
    this.shadowLight.position.set(0, 600, 0);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.camera.near = 1;
    this.shadowLight.shadow.camera.far = 2000;
    this.scene.add(this.shadowLight, this.shadowLight.target);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 5000;
    this.controls.zoomSpeed = 1.2;

    this.raycaster = new THREE.Raycaster();
    this.handles = new Handles(this.scene);
    this.protractor = new Protractor(this.scene);

    const cubeBox = this.viewport.querySelector('.viewcube');
    this.viewCube = new ViewCube(cubeBox, (dir) => this.viewFrom(dir));

    new ResizeObserver(() => this.resize()).observe(this.viewport);
    this.resize();
  }

  initWorkplane() {
    if (this.wp) {
      this.scene.remove(this.wp);
      this.wp.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const { w, l } = this.workplane;
    const g = (this.wp = new THREE.Group());
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({ color: '#d4e7f7', transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = -2;
    g.add(plane);

    const minor = [];
    const major = [];
    for (let x = -w / 2; x <= w / 2 + 1e-6; x += 1) {
      const k = Math.round(x + w / 2);
      (k % 10 === 0 ? major : minor).push(x, 0, -l / 2, x, 0, l / 2);
    }
    for (let z = -l / 2; z <= l / 2 + 1e-6; z += 1) {
      const k = Math.round(z + l / 2);
      (k % 10 === 0 ? major : minor).push(-w / 2, 0, z, w / 2, 0, z);
    }
    const mk = (arr, color, opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      ls.renderOrder = -1;
      return ls;
    };
    g.add(mk(minor, '#a9cbea', 0.35), mk(major, '#6aa6dc', 0.9));
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([V3(-w / 2, 0, -l / 2), V3(w / 2, 0, -l / 2), V3(w / 2, 0, l / 2), V3(-w / 2, 0, l / 2)]),
      new THREE.LineBasicMaterial({ color: '#3a86c8' }),
    );
    g.add(border);
    // volume de impressão (altura)
    const hgt = this.workplane.h || 0;
    if (hgt > 0) {
      const vol = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w, hgt, l)),
        new THREE.LineBasicMaterial({ color: '#3a86c8', transparent: true, opacity: 0.35, depthWrite: false }),
      );
      vol.position.y = hgt / 2;
      vol.raycast = () => {};
      g.add(vol);
    }

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 3, l * 3), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.receiveShadow = true;
    shadow.renderOrder = -1;
    g.add(shadow);
    this.scene.add(g);

    const sc = this.shadowLight.shadow.camera;
    const ext = Math.max(w, l) * 1.5;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.updateProjectionMatrix();
  }

  initOverlay() {
    this.overlay = this.viewport.querySelector('.overlay');
    this.marqueeEl = document.createElement('div');
    this.marqueeEl.className = 'marquee';
    this.overlay.appendChild(this.marqueeEl);
    this.dimEls = {};
    for (const k of ['w', 'd', 'h', 'e']) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      el.dataset.key = k;
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', () => this.editDim(k));
      el.addEventListener('pointerenter', () => (this.dimsHover = true));
      el.addEventListener('pointerleave', () => {
        this.dimsHover = false;
        this.dimsVisibleUntil = performance.now() + 900;
      });
      this.overlay.appendChild(el);
      this.dimEls[k] = el;
    }
    this.angleEl = document.createElement('div');
    this.angleEl.className = 'angle-label';
    this.overlay.appendChild(this.angleEl);
    this.modeEls = [];
  }

  resize() {
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this.updateOrthoFrustum();
  }

  updateOrthoFrustum() {
    const w = this.viewport.clientWidth || 1;
    const h = this.viewport.clientHeight || 1;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const fh = this.orthoHeight || 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
    this.orthoCam.left = (-fh * (w / h)) / 2;
    this.orthoCam.right = (fh * (w / h)) / 2;
    this.orthoCam.top = fh / 2;
    this.orthoCam.bottom = -fh / 2;
    this.orthoCam.updateProjectionMatrix();
  }

  // ---------------- câmera ----------------

  setOrtho(on) {
    if (on === (this.camera === this.orthoCam)) return;
    const from = this.camera;
    const to = on ? this.orthoCam : this.perspCam;
    const target = this.controls.target;
    if (on) {
      const dist = from.position.distanceTo(target);
      this.orthoHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
      to.zoom = 1;
      to.position.copy(from.position);
    } else {
      const fh = this.orthoHeight / this.orthoCam.zoom;
      const dist = fh / 2 / Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
      const dir = from.position.clone().sub(target).normalize();
      to.position.copy(target.clone().add(dir.multiplyScalar(dist)));
    }
    to.up.copy(from.up);
    to.lookAt(target);
    to.add(this.keyLight, this.keyTarget);
    this.camera = to;
    this.controls.object = to;
    this.updateOrthoFrustum();
    this.controls.update();
    this.emit('camera');
  }

  get isOrtho() {
    return this.camera === this.orthoCam;
  }

  animateCamera(pos, target, zoom) {
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const z0 = this.camera.zoom;
    const start = performance.now();
    const dur = 380;
    cancelAnimationFrame(this.camAnim);
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      if (zoom) {
        this.camera.zoom = z0 + (zoom - z0) * e;
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      if (k < 1) this.camAnim = requestAnimationFrame(step);
    };
    this.camAnim = requestAnimationFrame(step);
  }

  viewFrom(dir) {
    const d = dir.clone();
    if (Math.abs(d.y) > 0.999) d.z += 0.0015; // evita singularidade no topo/fundo
    d.normalize();
    const t = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(t);
    this.animateCamera(t.clone().add(d.multiplyScalar(dist)), t);
  }

  homeView() {
    const dist = Math.max(this.workplane.w, this.workplane.l) * 1.65;
    this.animateCamera(HOME_DIR.clone().multiplyScalar(dist), V3(0, 0, 0), this.isOrtho ? 1 : undefined);
  }

  fitView() {
    const box = new THREE.Box3();
    const ids = this.selection.length ? this.selection : this.objects.filter((o) => !o.hidden).map((o) => o.id);
    for (const id of ids) box.union(this.worldBox(this.obj(id)));
    if (box.isEmpty()) box.set(V3(-this.workplane.w / 2, 0, -this.workplane.l / 2), V3(this.workplane.w / 2, 1, this.workplane.l / 2));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const fov = THREE.MathUtils.degToRad(this.perspCam.fov / 2);
    const aspect = this.perspCam.aspect;
    const fit = Math.min(fov, Math.atan(Math.tan(fov) * aspect));
    const dist = (sphere.radius * 1.15) / Math.sin(fit);
    if (this.isOrtho) {
      const zoom = this.orthoHeight / (sphere.radius * 2.4);
      this.animateCamera(sphere.center.clone().add(dir.multiplyScalar(dist)), sphere.center.clone(), zoom);
    } else {
      this.animateCamera(sphere.center.clone().add(dir.multiplyScalar(dist)), sphere.center.clone());
    }
  }

  zoomBy(f) {
    if (this.isOrtho) {
      this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * f, 0.02, 200);
      this.camera.updateProjectionMatrix();
      return;
    }
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t).divideScalar(f);
    this.animateCamera(t.clone().add(off), t.clone());
  }

  // tamanho de um pixel (em mm) na posição p
  pixelSize(p) {
    const h = this.viewport.clientHeight || 1;
    if (this.isOrtho) return (this.orthoCam.top - this.orthoCam.bottom) / this.orthoCam.zoom / h;
    const dist = this.camera.position.distanceTo(p);
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2))) / h;
  }

  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.viewport.clientWidth, y: (-p.y * 0.5 + 0.5) * this.viewport.clientHeight, z: p.z };
  }

  // ---------------- objetos ----------------

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  obj(id) {
    return this.findIn(this.objects, id);
  }

  findIn(list, id) {
    for (const o of list) if (o.id === id) return o;
    return null;
  }

  get selected() {
    return this.selection.map((id) => this.obj(id)).filter(Boolean);
  }

  createObject(type, opts = {}) {
    const def = SHAPES[type];
    const params = defaultParams(type, opts.params);
    const size = opts.size ? [...opts.size] : defaultSize(type, params);
    return {
      id: uid(),
      type,
      name: opts.name || def.label,
      color: opts.color || def.color,
      hole: !!opts.hole,
      params,
      size,
      pos: [0, size[1] / 2, 0],
      quat: [0, 0, 0, 1],
      flip: [1, 1, 1],
    };
  }

  updateMesh(o) {
    let mesh = this.meshes.get(o.id);
    if (!mesh) {
      mesh = new THREE.Mesh();
      mesh.userData.id = o.id;
      this.objectsRoot.add(mesh);
      this.meshes.set(o.id, mesh);
    }
    let geo;
    let base;
    let mat;
    if (o.type === 'group') {
      const r = groupResult(o);
      geo = r.geometry;
      base = r.baseSize;
      mat = o.hole ? holeMaterial : o.color ? solidMaterial(o.color) : r.materials;
    } else {
      geo = shapeGeometry(o);
      base = o.size;
      mat = o.hole ? holeMaterial : solidMaterial(o.color);
    }
    if (mesh.geometry !== geo) {
      mesh.geometry = geo;
      if (mesh.userData.outline) {
        mesh.remove(mesh.userData.outline);
        mesh.userData.outline = null;
      }
    }
    mesh.material = mat;
    const f = o.flip || [1, 1, 1];
    mesh.position.fromArray(o.pos);
    mesh.quaternion.fromArray(o.quat);
    mesh.scale.set((o.size[0] / base[0]) * f[0], (o.size[1] / base[1]) * f[1], (o.size[2] / base[2]) * f[2]);
    mesh.visible = !o.hidden;
    mesh.castShadow = !o.hole;
    mesh.renderOrder = o.hole ? 2 : 0;
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  sync() {
    const ids = new Set(this.objects.map((o) => o.id));
    for (const [id, mesh] of this.meshes) {
      if (!ids.has(id)) {
        this.objectsRoot.remove(mesh);
        this.meshes.delete(id);
      }
    }
    for (const o of this.objects) this.updateMesh(o);
    this.selection = this.selection.filter((id) => ids.has(id));
    if (this.alignKey && !ids.has(this.alignKey)) this.alignKey = null;
    this.refreshOutlines();
    this.emit('change');
  }

  refreshOutlines() {
    for (const [id, mesh] of this.meshes) {
      const sel = this.selection.includes(id);
      const hov = !sel && this.hoverId === id;
      if (sel || hov) {
        if (!mesh.userData.outline) {
          const edges = outlineGeometry(mesh.geometry, 28);
          const line = new THREE.LineSegments(edges, outlineSelected);
          line.raycast = () => {};
          mesh.add(line);
          mesh.userData.outline = line;
        }
        mesh.userData.outline.material = sel ? (this.alignKey === id ? outlineHover : outlineSelected) : outlineHover;
        mesh.userData.outline.visible = true;
      } else if (mesh.userData.outline) {
        mesh.userData.outline.visible = false;
      }
    }
  }

  select(ids, { add = false, toggle = false } = {}) {
    let next;
    if (toggle) {
      next = [...this.selection];
      for (const id of ids) {
        const i = next.indexOf(id);
        if (i >= 0) next.splice(i, 1);
        else next.push(id);
      }
    } else if (add) {
      next = [...new Set([...this.selection, ...ids])];
    } else {
      next = [...ids];
    }
    const changed = next.join() !== this.selection.join();
    this.selection = next;
    if (changed) {
      if (this.mode) this.setMode(null);
      this.refreshOutlines();
      this.emit('selection');
    }
  }

  selectAll() {
    this.select(this.objects.filter((o) => !o.hidden).map((o) => o.id));
  }

  // ---------------- histórico / persistência ----------------

  snapshot() {
    return JSON.stringify(this.objects);
  }

  commit() {
    const s = this.snapshot();
    if (this.history[this.historyIndex] === s) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(s);
    if (this.history.length > 200) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.save();
    this.emit('history');
  }

  undo() {
    if (this.drag) return;
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.objects = JSON.parse(this.history[this.historyIndex]);
    this.sync();
    this.save();
    this.emit('history');
    this.emit('selection');
  }

  redo() {
    if (this.drag) return;
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.objects = JSON.parse(this.history[this.historyIndex]);
    this.sync();
    this.save();
    this.emit('history');
    this.emit('selection');
  }

  save() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ name: this.name, objects: this.objects, grid: this.grid, workplane: this.workplane }),
      );
    } catch (e) {
      console.warn('Não foi possível salvar', e);
    }
  }

  load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE) || 'null');
      if (data) {
        this.name = data.name || this.name;
        this.objects = Array.isArray(data.objects) ? data.objects : [];
        this.grid = data.grid ?? 1;
        if (data.workplane) {
          this.workplane = { h: 255, ...data.workplane };
          this.initWorkplane();
        }
      }
    } catch (e) {
      console.warn('Projeto salvo inválido; começando vazio', e);
      this.objects = [];
    }
    this.sync();
    this.history = [this.snapshot()];
    this.historyIndex = 0;
    this.homeViewInstant();
  }

  homeViewInstant() {
    const dist = Math.max(this.workplane.w, this.workplane.l) * 1.65;
    this.camera.position.copy(HOME_DIR.clone().multiplyScalar(dist));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  newDesign() {
    this.objects = [];
    this.selection = [];
    this.sync();
    this.commit();
    this.emit('selection');
  }

  setName(n) {
    this.name = n || 'Sem título';
    this.save();
  }

  setGrid(g) {
    this.grid = g;
    this.save();
  }

  setWorkplane(w, l, h = this.workplane.h) {
    this.workplane = { w: Math.max(10, w), l: Math.max(10, l), h: Math.max(10, h) };
    this.initWorkplane();
    this.save();
    this.emit('workplane');
  }

  snap(v) {
    return this.grid > 0 ? Math.round(v / this.grid) * this.grid : v;
  }

  // ---------------- operações ----------------

  // caixa envolvente exata (vértices transformados), com cache por geometria+matriz
  worldBox(o) {
    const m = this.meshes.get(o.id);
    if (!m) return new THREE.Box3();
    m.updateMatrixWorld(true);
    const key = m.geometry.uuid + m.matrixWorld.elements.join(',');
    if (m.userData.boxKey === key) return m.userData.box.clone();
    const b = new THREE.Box3();
    const pos = m.geometry.attributes.position;
    const v = V3();
    for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    m.userData.boxKey = key;
    m.userData.box = b;
    return b.clone();
  }

  selectionBox(objs = this.selected) {
    const b = new THREE.Box3();
    for (const o of objs) b.union(this.worldBox(o));
    return b;
  }

  change(fn, { commit = true } = {}) {
    fn();
    this.sync();
    if (commit) this.commit();
  }

  deleteSelected() {
    if (!this.selection.length) return;
    const ids = new Set(this.selection);
    this.change(() => {
      this.objects = this.objects.filter((o) => !ids.has(o.id));
    });
    this.select([]);
  }

  copy() {
    if (!this.selection.length) return;
    this.clipboard = clone(this.selected);
    this.emit('clipboard');
  }

  cut() {
    this.copy();
    this.deleteSelected();
  }

  paste() {
    if (!this.clipboard) return;
    const copies = this.clipboard.map((o) => this.reId(clone(o)));
    for (const c of copies) {
      c.pos[0] += 10;
      c.pos[2] += 10;
    }
    this.clipboard = clone(copies);
    this.change(() => this.objects.push(...copies));
    this.select(copies.map((c) => c.id));
  }

  reId(o) {
    o.id = uid();
    if (o.children) o.children.forEach((c) => this.reId(c));
    return o;
  }

  // Ctrl+D: duplica no lugar; se a cópia foi movida/girada, repete a transformação
  duplicate() {
    const sel = this.selected;
    if (!sel.length) return;
    const last = this.lastDuplicate;
    let copies;
    if (last && last.newIds.join() === this.selection.join()) {
      const src = last.srcIds.map((id) => this.obj(id));
      const now = sel;
      if (src.every(Boolean)) {
        copies = now.map((o, i) => {
          const s = src[i];
          const c = this.reId(clone(o));
          const qs = new THREE.Quaternion().fromArray(s.quat);
          const qo = new THREE.Quaternion().fromArray(o.quat);
          const dq = qo.clone().multiply(qs.clone().invert());
          const dp = V3().fromArray(o.pos).sub(V3().fromArray(s.pos));
          // gira o deslocamento para padrões circulares
          const ndp = dp.clone().applyQuaternion(dq);
          c.pos = V3().fromArray(o.pos).add(ndp).toArray().map(r3);
          c.quat = dq.clone().multiply(qo).normalize().toArray();
          return c;
        });
      }
    }
    if (!copies) copies = sel.map((o) => this.reId(clone(o)));
    this.lastDuplicate = { srcIds: [...this.selection], newIds: copies.map((c) => c.id) };
    this.change(() => this.objects.push(...copies));
    this.select(copies.map((c) => c.id));
    this.lastDuplicate = { srcIds: this.lastDuplicate.srcIds, newIds: [...this.selection] };
  }

  setHole(hole) {
    const sel = this.selected;
    if (!sel.length) return;
    this.change(() => sel.forEach((o) => (o.hole = hole)));
    this.emit('selection');
  }

  setColor(hex) {
    const sel = this.selected;
    if (!sel.length) return;
    this.change(() =>
      sel.forEach((o) => {
        o.color = hex;
        o.hole = false;
      }),
    );
    this.emit('selection');
  }

  setParam(key, value, commit = true) {
    const [o] = this.selected;
    if (!o || o.type === 'group') return;
    this.change(
      () => {
        o.params[key] = value;
        if (o.type === 'text' && key === 'text') o.size[0] = textWidthFor(o.params, o.size[2]);
      },
      { commit },
    );
  }

  setLocked(v) {
    const sel = this.selected;
    this.change(() => sel.forEach((o) => (o.locked = v)));
    this.emit('selection');
  }

  hideSelected() {
    const sel = this.selected;
    if (!sel.length) return;
    this.change(() => sel.forEach((o) => (o.hidden = true)));
    this.select([]);
  }

  showAll() {
    this.change(() => this.objects.forEach((o) => (o.hidden = false)));
  }

  dropToWorkplane() {
    const sel = this.selected.filter((o) => !o.locked);
    if (!sel.length) return;
    this.change(() =>
      sel.forEach((o) => {
        const b = this.worldBox(o);
        o.pos[1] = r3(o.pos[1] - b.min.y);
      }),
    );
  }

  nudge(dx, dy, dz) {
    const sel = this.selected.filter((o) => !o.locked);
    if (!sel.length) return;
    this.change(() =>
      sel.forEach((o) => {
        o.pos[0] = r3(o.pos[0] + dx);
        o.pos[1] = r3(o.pos[1] + dy);
        o.pos[2] = r3(o.pos[2] + dz);
      }),
    );
  }

  group() {
    const sel = this.selected;
    if (sel.length < 2) return;
    const ids = new Set(this.selection);
    const children = clone(sel);
    const temp = { type: 'group', children };
    const res = groupResult(temp);
    const c = res.center;
    for (const ch of children) {
      ch.pos = [r3(ch.pos[0] - c[0]), r3(ch.pos[1] - c[1]), r3(ch.pos[2] - c[2])];
      delete ch.locked;
    }
    aliasGroupResult(children, res);
    const g = {
      id: uid(),
      type: 'group',
      name: 'Grupo',
      color: null,
      hole: res.isHole,
      params: {},
      size: [...res.baseSize],
      pos: [...c],
      quat: [0, 0, 0, 1],
      flip: [1, 1, 1],
      children,
    };
    const firstIndex = this.objects.findIndex((o) => ids.has(o.id));
    this.change(() => {
      this.objects = this.objects.filter((o) => !ids.has(o.id));
      this.objects.splice(Math.max(0, firstIndex), 0, g);
    });
    this.select([g.id]);
    this.emit('selection');
  }

  ungroup() {
    const groups = this.selected.filter((o) => o.type === 'group');
    if (!groups.length) return;
    const newIds = [];
    this.change(() => {
      for (const g of groups) {
        const gm = objectMatrix(g);
        const out = g.children.map((ch) => {
          const c = clone(ch);
          const wm = gm.clone().multiply(objectMatrix(ch));
          const p = V3();
          const q = new THREE.Quaternion();
          const s = V3();
          wm.decompose(p, q, s);
          const base = geometrySize(ch);
          c.pos = p.toArray().map(r3);
          c.quat = q.toArray();
          c.size = [r3(Math.abs(s.x) * base[0]), r3(Math.abs(s.y) * base[1]), r3(Math.abs(s.z) * base[2])];
          c.flip = [Math.sign(s.x) || 1, Math.sign(s.y) || 1, Math.sign(s.z) || 1];
          if (g.hole) c.hole = true;
          else if (g.color && !c.hole) c.color = g.color;
          return c;
        });
        const i = this.objects.indexOf(g);
        this.objects.splice(i, 1, ...out);
        newIds.push(...out.map((c) => c.id));
      }
    });
    this.select(newIds);
    this.emit('selection');
  }

  // espelha em torno do centro da seleção, no eixo do mundo (0=x, 1=y, 2=z)
  mirror(axis) {
    const sel = this.selected.filter((o) => !o.locked);
    if (!sel.length) return;
    const c = this.selectionBox(sel).getCenter(V3());
    const s = V3(1, 1, 1);
    s.setComponent(axis, -1);
    const M = new THREE.Matrix4()
      .makeTranslation(c.x, c.y, c.z)
      .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    this.change(() => {
      for (const o of sel) {
        const wm = M.clone().multiply(objectMatrix(o));
        const p = V3();
        const q = new THREE.Quaternion();
        const sc = V3();
        wm.decompose(p, q, sc);
        o.pos = p.toArray().map(r3);
        o.quat = q.toArray();
        o.flip = [Math.sign(sc.x) || 1, Math.sign(sc.y) || 1, Math.sign(sc.z) || 1];
      }
    });
  }

  // alinha no eixo (0,1,2) em min(-1)/centro(0)/max(1)
  align(axis, where) {
    const sel = this.selected;
    if (sel.length < 2) return;
    const key = this.alignKey ? this.obj(this.alignKey) : null;
    const ref = key ? this.worldBox(key) : this.selectionBox(sel);
    const target = where < 0 ? ref.min.getComponent(axis) : where > 0 ? ref.max.getComponent(axis) : ref.getCenter(V3()).getComponent(axis);
    this.change(() => {
      for (const o of sel) {
        if (o === key || o.locked) continue;
        const b = this.worldBox(o);
        const cur = where < 0 ? b.min.getComponent(axis) : where > 0 ? b.max.getComponent(axis) : b.getCenter(V3()).getComponent(axis);
        o.pos[axis] = r3(o.pos[axis] + target - cur);
      }
    });
  }

  setMode(mode) {
    if (mode === this.mode) mode = null;
    if (mode === 'align' && this.selection.length < 2) mode = null;
    if (mode === 'mirror' && !this.selection.length) mode = null;
    this.mode = mode;
    this.alignKey = null;
    this.buildModeHandles();
    this.refreshOutlines();
    this.emit('mode');
  }

  // Dimensões editáveis: tamanho (mantém a base apoiada) e elevação
  setDimension(k, value) {
    const [o] = this.selected;
    if (!o || o.locked || !(value >= 0)) return;
    this.change(() => {
      if (k === 'e') {
        const b = this.worldBox(o);
        o.pos[1] = r3(o.pos[1] + value - b.min.y);
        return;
      }
      if (value <= 0) return;
      const i = { w: 0, h: 1, d: 2 }[k];
      const before = this.worldBox(o).min.y;
      o.size[i] = r3(value);
      this.updateMesh(o);
      const after = this.worldBox(o).min.y;
      o.pos[1] = r3(o.pos[1] + before - after);
    });
  }

  // ---------------- colocação de formas da biblioteca ----------------

  startPlacing(spec, sticky = false) {
    this.cancelPlacing();
    this.placing = { spec, obj: null, sticky };
    this.viewport.classList.add('placing');
  }

  cancelPlacing() {
    if (!this.placing) return;
    if (this.placing.obj) {
      this.objects = this.objects.filter((o) => o !== this.placing.obj);
      this.sync();
    }
    this.placing = null;
    this.viewport.classList.remove('placing');
  }

  updatePlacing(e) {
    const p = this.placing;
    if (!p) return;
    const inside = this.insideViewport(e);
    if (!inside) {
      if (p.obj) {
        this.objects = this.objects.filter((o) => o !== p.obj);
        p.obj = null;
        this.sync();
      }
      return;
    }
    if (!p.obj) {
      const { type, ...opts } = p.spec;
      p.obj = this.createObject(type, opts);
      this.objects.push(p.obj);
    }
    const s = this.surfacePoint(e, p.obj.id);
    p.obj.pos = [r3(this.snap(s.x)), r3(s.y + p.obj.size[1] / 2), r3(this.snap(s.z))];
    this.sync();
  }

  finishPlacing(e) {
    const p = this.placing;
    if (!p) return false;
    if (e) this.updatePlacing(e);
    if (!p.obj) {
      this.cancelPlacing();
      return false;
    }
    const id = p.obj.id;
    this.placing = null;
    this.viewport.classList.remove('placing');
    this.commit();
    this.select([id]);
    this.emit('selection');
    return true;
  }

  insideViewport(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!el && (el === this.renderer.domElement || this.overlay.contains(el) || el === this.viewport);
  }

  // ponto de apoio sob o cursor: topo de outro objeto ou o plano de trabalho
  surfacePoint(e, excludeId) {
    this.setRay(e);
    const meshes = [...this.meshes.values()].filter((m) => m.visible && m.userData.id !== excludeId);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit && hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.y > 0.7) return hit.point;
    }
    const pt = V3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(V3(0, 1, 0), 0), pt)) return pt;
    return V3();
  }

  // ---------------- interação ----------------

  setRay(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  pickObject(e) {
    this.setRay(e);
    const meshes = [...this.meshes.values()].filter((m) => m.visible);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? { id: hit.object.userData.id, point: hit.point } : null;
  }

  initEvents() {
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => {
      const hit = this.pickObject(e);
      if (hit) this.fitView();
    });
  }

  onDown(e) {
    this.renderer.domElement.focus({ preventScroll: true });
    if (e.button !== 0) return;
    if (this.placing) {
      this.finishPlacing(e);
      return;
    }
    this.setRay(e);
    const handle = this.mode ? null : this.handles.pick(this.raycaster);
    if (handle) {
      this.startHandleDrag(handle, e);
      return;
    }
    const hit = this.pickObject(e);
    if (hit) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (this.mode === 'align' && this.selection.includes(hit.id) && !additive) {
        this.alignKey = this.alignKey === hit.id ? null : hit.id;
        this.refreshOutlines();
        this.buildModeHandles();
        return;
      }
      if (additive) {
        this.select([hit.id], { toggle: true });
        if (!this.selection.includes(hit.id)) return;
      } else if (!this.selection.includes(hit.id)) {
        this.select([hit.id]);
      }
      this.startMoveDrag(hit, e);
      return;
    }
    this.drag = { kind: 'marquee', x0: this.pointer.x, y0: this.pointer.y, additive: e.shiftKey || e.ctrlKey };
  }

  startMoveDrag(hit, e) {
    const movable = this.selected.filter((o) => !o.locked);
    if (!movable.length) return;
    const plane = new THREE.Plane(V3(0, 1, 0), -hit.point.y);
    this.drag = {
      kind: 'move',
      plane,
      start: hit.point.clone(),
      startScreen: { ...this.pointer },
      alt: e.altKey,
      moved: false,
      items: movable.map((o) => ({ o, pos: [...o.pos] })),
    };
  }

  onMove(e) {
    if (this.placing) {
      this.updatePlacing(e);
      return;
    }
    const d = this.drag;
    if (!d) {
      if (e.target === this.renderer.domElement && e.buttons === 0) this.hover(e);
      return;
    }
    this.setRay(e);
    if (d.kind === 'marquee') {
      const x = Math.min(d.x0, this.pointer.x);
      const y = Math.min(d.y0, this.pointer.y);
      const w = Math.abs(this.pointer.x - d.x0);
      const h = Math.abs(this.pointer.y - d.y0);
      if (w + h > 4) {
        Object.assign(this.marqueeEl.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        d.active = true;
      }
      return;
    }
    if (d.kind === 'move') {
      if (!d.moved) {
        if (Math.hypot(this.pointer.x - d.startScreen.x, this.pointer.y - d.startScreen.y) < 3) return;
        d.moved = true;
        if (d.alt) {
          // Alt + arrastar: duplica e arrasta a cópia
          const copies = d.items.map((it) => this.reId(clone(it.o)));
          this.objects.push(...copies);
          d.items = copies.map((o) => ({ o, pos: [...o.pos] }));
          this.selection = copies.map((o) => o.id);
          this.emit('selection');
        }
      }
      const p = V3();
      if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
      const dx = this.snap(p.x - d.start.x);
      const dz = this.snap(p.z - d.start.z);
      for (const it of d.items) {
        it.o.pos[0] = r3(it.pos[0] + dx);
        it.o.pos[2] = r3(it.pos[2] + dz);
      }
      this.sync();
      return;
    }
    if (d.kind === 'handle') this.dragHandle(e);
  }

  onUp(e) {
    if (this.placing) {
      if (this.placing.sticky) return;
      if (this.insideViewport(e)) this.finishPlacing(e);
      else if (this.placing.tileDrag) {
        // soltou fora: vira colocação "grudada" (clique no plano para soltar)
        this.placing.sticky = true;
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'marquee') {
      this.marqueeEl.style.display = 'none';
      if (!d.active) {
        if (!d.additive) this.select([]);
        return;
      }
      const x0 = Math.min(d.x0, this.pointer.x);
      const x1 = Math.max(d.x0, this.pointer.x);
      const y0 = Math.min(d.y0, this.pointer.y);
      const y1 = Math.max(d.y0, this.pointer.y);
      const ids = this.objects
        .filter((o) => !o.hidden)
        .filter((o) => {
          const c = this.project(this.worldBox(o).getCenter(V3()));
          return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
        })
        .map((o) => o.id);
      this.select(ids, { add: d.additive });
      return;
    }
    if (d.kind === 'handle') {
      this.protractor.hide();
      this.angleEl.style.display = 'none';
      this.dimsVisibleUntil = performance.now() + 1500;
    }
    if (d.moved) this.commit();
    this.emit('selection');
  }

  hover(e) {
    this.setRay(e);
    const h = this.mode ? null : this.handles.pick(this.raycaster);
    const prev = this.handles.hovered;
    this.handles.setHover(h);
    if (h && ['corner', 'edge', 'top', 'lift'].includes(h.type)) {
      this.dimsFor = h.type === 'lift' ? 'lift' : 'size';
    } else if (prev && prev !== h) {
      // tempo para o mouse chegar até a cota e clicar nela
      this.dimsVisibleUntil = performance.now() + 1800;
    }
    let id = null;
    if (!h) {
      const hit = this.pickObject(e);
      id = hit ? hit.id : null;
    }
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.refreshOutlines();
    }
    this.renderer.domElement.style.cursor = h ? (h.type === 'rot' ? 'grab' : 'pointer') : id ? 'move' : 'default';
  }

  // quadro de referência das alças: o próprio objeto ou a caixa da seleção
  getFrame() {
    const sel = this.selected;
    if (!sel.length) return null;
    if (sel.length === 1) {
      const o = sel[0];
      return { pos: V3().fromArray(o.pos), quat: new THREE.Quaternion().fromArray(o.quat), size: V3(...o.size) };
    }
    const b = this.selectionBox(sel);
    return { pos: b.getCenter(V3()), quat: new THREE.Quaternion(), size: b.getSize(V3()) };
  }

  startHandleDrag(h, e) {
    const frame = this.getFrame();
    const sel = this.selected;
    if (!frame || sel.some((o) => o.locked)) return;
    const up = V3(0, 1, 0).applyQuaternion(frame.quat);
    const hp = V3();
    h.object.getWorldPosition(hp);
    let plane;
    let axis;
    if (h.type === 'corner' || h.type === 'edge') {
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(up, hp);
    } else if (h.type === 'top' || h.type === 'lift') {
      axis = h.type === 'lift' ? V3(0, 1, 0) : up;
      const toCam = this.camera.position.clone().sub(hp);
      if (this.isOrtho) toCam.copy(V3(0, 0, 1).applyQuaternion(this.camera.quaternion));
      const n = toCam.sub(axis.clone().multiplyScalar(toCam.dot(axis)));
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), hp);
    } else {
      axis = V3(h.axis === 'x' ? 1 : 0, h.axis === 'y' ? 1 : 0, h.axis === 'z' ? 1 : 0).applyQuaternion(frame.quat);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, frame.pos);
    }
    const start = V3();
    if (!this.raycaster.ray.intersectPlane(plane, start)) return;
    this.drag = {
      kind: 'handle',
      handle: h,
      plane,
      axis,
      start,
      frame0: { pos: frame.pos.clone(), quat: frame.quat.clone(), size: frame.size.clone() },
      frame: frame,
      items: sel.map((o) => ({ o, data: clone(o) })),
      moved: false,
    };
    this.handles.setHover(h);
    if (h.type === 'rot') {
      const radius = Math.max(frame.size.x, frame.size.y, frame.size.z) * 0.85 + 12 * this.pixelSize(frame.pos);
      this.drag.ringRadius = radius;
      this.protractor.show(frame.pos, axis, start.clone().sub(frame.pos), radius);
    } else {
      this.dimsFor = h.type === 'lift' ? 'lift' : 'size';
    }
  }

  dragHandle(e) {
    const d = this.drag;
    const h = d.handle;
    const p = V3();
    if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
    const f0 = d.frame0;
    const inv = f0.quat.clone().invert();
    const L0 = d.start.clone().sub(f0.pos).applyQuaternion(inv);
    const L = p.clone().sub(f0.pos).applyQuaternion(inv);
    const delta = L.clone().sub(L0);
    const size = f0.size.clone();
    const off = V3(); // deslocamento do centro, no espaço local
    let quat = f0.quat.clone();
    let pos = f0.pos.clone();
    const MIN = 0.1;
    d.moved = true;

    if (h.type === 'corner' || h.type === 'edge') {
      const axes = h.type === 'corner' ? [['x', h.sx], ['z', h.sz]] : [[h.axis, h.s]];
      for (const [a, s] of axes) {
        const s0 = f0.size[a];
        if (e.altKey) {
          size[a] = Math.max(MIN, this.snap(s0 + 2 * s * delta[a]));
        } else {
          size[a] = Math.max(MIN, this.snap(s0 + s * delta[a]));
          off[a] = (s * (size[a] - s0)) / 2;
        }
      }
      if (e.shiftKey) {
        // proporcional: usa o eixo com maior variação
        let k = 1;
        for (const [a] of axes) {
          const r = size[a] / f0.size[a];
          if (Math.abs(r - 1) > Math.abs(k - 1)) k = r;
        }
        for (const a of ['x', 'y', 'z']) size[a] = Math.max(MIN, f0.size[a] * k);
        for (const [a, s] of axes) off[a] = e.altKey ? 0 : (s * (size[a] - f0.size[a])) / 2;
        off.y = (size.y - f0.size.y) / 2;
      }
      pos = f0.pos.clone().add(off.applyQuaternion(f0.quat));
    } else if (h.type === 'top') {
      const s0 = f0.size.y;
      if (e.altKey) size.y = Math.max(MIN, this.snap(s0 + 2 * delta.y));
      else {
        size.y = Math.max(MIN, this.snap(s0 + delta.y));
        off.y = (size.y - s0) / 2;
      }
      if (e.shiftKey) {
        const k = size.y / s0;
        size.x = f0.size.x * k;
        size.z = f0.size.z * k;
      }
      pos = f0.pos.clone().add(off.applyQuaternion(f0.quat));
    } else if (h.type === 'lift') {
      const dy = this.snap(p.y - d.start.y);
      pos = f0.pos.clone().add(V3(0, dy, 0));
    } else if (h.type === 'rot') {
      const c = f0.pos;
      const v0 = d.start.clone().sub(c);
      const v = p.clone().sub(c);
      let ang = Math.atan2(d.axis.dot(v0.clone().cross(v)), v0.dot(v));
      const dist = v.length();
      const stepDeg = e.shiftKey ? 45 : dist < d.ringRadius ? 22.5 : 1;
      const step = THREE.MathUtils.degToRad(stepDeg);
      ang = Math.round(ang / step) * step;
      quat = new THREE.Quaternion().setFromAxisAngle(d.axis, ang).multiply(f0.quat);
      this.protractor.setAngle(ang);
      const deg = THREE.MathUtils.radToDeg(ang);
      const lp = this.project(p);
      Object.assign(this.angleEl.style, { display: 'block', left: lp.x + 16 + 'px', top: lp.y - 10 + 'px' });
      this.angleEl.textContent = `${Math.round(deg * 10) / 10}°`;
      d.rotAngle = ang;
    }

    d.frame = { pos, quat, size };
    this.applyFrame(d, { pos, quat, size });
    this.sync();
  }

  applyFrame(d, nf) {
    const f0 = d.frame0;
    if (d.items.length === 1) {
      const { o } = d.items[0];
      o.size = [r3(nf.size.x), r3(nf.size.y), r3(nf.size.z)];
      o.pos = nf.pos.toArray().map(r3);
      o.quat = nf.quat.toArray();
      return;
    }
    const R = nf.quat.clone().multiply(f0.quat.clone().invert());
    const fs = V3(nf.size.x / f0.size.x, nf.size.y / f0.size.y, nf.size.z / f0.size.z);
    for (const { o, data } of d.items) {
      const rel = V3().fromArray(data.pos).sub(f0.pos).multiply(fs).applyQuaternion(R);
      o.pos = nf.pos.clone().add(rel).toArray().map(r3);
      const q0 = new THREE.Quaternion().fromArray(data.quat);
      o.quat = R.clone().multiply(q0).toArray();
      const m = new THREE.Matrix4().makeRotationFromQuaternion(q0).elements;
      const ns = [0, 1, 2].map((i) => {
        const col = V3(m[i * 4], m[i * 4 + 1], m[i * 4 + 2]).multiply(fs);
        return r3(data.size[i] * col.length());
      });
      o.size = ns;
    }
  }

  // ---------------- alças de alinhar / espelhar (sobreposição HTML) ----------------

  buildModeHandles() {
    for (const el of this.modeEls) el.remove();
    this.modeEls = [];
    if (!this.mode) return;
    if (this.mode === 'align') {
      for (const axis of [0, 1, 2]) {
        for (const where of [-1, 0, 1]) {
          const el = document.createElement('button');
          el.className = 'align-dot';
          el.title = ['Esquerda', 'Centro', 'Direita'][where + 1];
          el.addEventListener('pointerdown', (e) => e.stopPropagation());
          el.addEventListener('click', () => this.align(axis, where));
          el.addEventListener('pointerenter', () => this.previewAlign(axis, where, true));
          el.addEventListener('pointerleave', () => this.previewAlign(axis, where, false));
          el.dataset.axis = axis;
          el.dataset.where = where;
          this.overlay.appendChild(el);
          this.modeEls.push(el);
        }
      }
    } else if (this.mode === 'mirror') {
      for (const axis of [0, 1, 2]) {
        const el = document.createElement('button');
        el.className = 'mirror-btn';
        el.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 12l5-5v3h8V7l5 5-5 5v-3H8v3z" fill="currentColor"/></svg>';
        el.title = 'Espelhar';
        el.dataset.axis = axis;
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', () => this.mirror(axis));
        this.overlay.appendChild(el);
        this.modeEls.push(el);
      }
    }
  }

  previewAlign(axis, where, on) {
    for (const el of this.modeEls) {
      el.classList.toggle('hot', on && +el.dataset.axis === axis && +el.dataset.where === where);
    }
  }

  updateModeHandles() {
    if (!this.mode || !this.selection.length) return;
    const b = this.selectionBox();
    if (b.isEmpty()) return;
    const px = this.pixelSize(b.getCenter(V3()));
    const off = 26 * px;
    const c = b.getCenter(V3());
    if (this.mode === 'align') {
      for (const el of this.modeEls) {
        const axis = +el.dataset.axis;
        const where = +el.dataset.where;
        const v = V3();
        if (axis === 0) v.set(where < 0 ? b.min.x : where > 0 ? b.max.x : c.x, b.min.y, b.max.z + off);
        if (axis === 2) v.set(b.max.x + off, b.min.y, where < 0 ? b.min.z : where > 0 ? b.max.z : c.z);
        if (axis === 1) v.set(b.min.x - off, where < 0 ? b.min.y : where > 0 ? b.max.y : c.y, b.max.z + off);
        const s = this.project(v);
        el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
    } else {
      for (const el of this.modeEls) {
        const axis = +el.dataset.axis;
        const v = V3();
        const dir = V3();
        dir.setComponent(axis, 1);
        if (axis === 0) v.set(c.x, b.min.y, b.max.z + off);
        if (axis === 2) v.set(b.max.x + off, b.min.y, c.z);
        if (axis === 1) v.set(b.min.x - off, c.y, b.max.z + off);
        const s = this.project(v);
        const s2 = this.project(v.clone().add(dir.multiplyScalar(10)));
        const ang = Math.atan2(s2.y - s.y, s2.x - s.x);
        el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${ang}rad)`;
      }
    }
  }

  // ---------------- cotas (dimensões) ----------------

  updateDims() {
    const now = performance.now();
    const sel = this.selected;
    const d = this.drag;
    const hv = this.handles.hovered;
    const hoveringSize = hv && hv.type !== 'rot' && this.handles.root.visible;
    const showing =
      sel.length === 1 &&
      !this.mode &&
      !sel[0].locked &&
      (this.editingDim ||
        this.dimsHover ||
        hoveringSize ||
        now < this.dimsVisibleUntil ||
        (d && d.kind === 'handle' && d.handle.type !== 'rot'));
    for (const k in this.dimEls) {
      if (!showing && this.editingDim !== k) this.dimEls[k].style.display = 'none';
    }
    if (!this.dimSvg) {
      this.dimSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.dimSvg.setAttribute('class', 'dim-lines');
      this.overlay.prepend(this.dimSvg);
    }
    if (!showing) {
      this.dimSvg.innerHTML = '';
      return;
    }
    const o = sel[0];
    const frame = this.getFrame();
    const px = this.pixelSize(frame.pos);
    const hw = frame.size.x / 2;
    const hh = frame.size.y / 2;
    const hd = frame.size.z / 2;
    const off = 22 * px;
    const toW = (x, y, z) => V3(x, y, z).applyQuaternion(frame.quat).add(frame.pos);
    const box = this.worldBox(o);
    const lift = this.dimsFor === 'lift';
    const items = {
      w: !lift && { p: toW(0, -hh, hd + off), v: o.size[0], seg: [toW(-hw, -hh, hd + off), toW(hw, -hh, hd + off)], ext: [[toW(-hw, -hh, hd), toW(-hw, -hh, hd + off)], [toW(hw, -hh, hd), toW(hw, -hh, hd + off)]] },
      d: !lift && { p: toW(hw + off, -hh, 0), v: o.size[2], seg: [toW(hw + off, -hh, -hd), toW(hw + off, -hh, hd)], ext: [[toW(hw, -hh, -hd), toW(hw + off, -hh, -hd)], [toW(hw, -hh, hd), toW(hw + off, -hh, hd)]] },
      h: !lift && { p: toW(hw + off * 0.7, 0, hd + off * 0.7), v: o.size[1], seg: [toW(hw + off * 0.7, -hh, hd + off * 0.7), toW(hw + off * 0.7, hh, hd + off * 0.7)], ext: [] },
      e: { p: V3(box.max.x + off, box.min.y / 2, box.max.z + off), v: box.min.y, show: lift || Math.abs(box.min.y) > 0.001, seg: [V3(box.max.x + off, 0, box.max.z + off), V3(box.max.x + off, box.min.y, box.max.z + off)], ext: [] },
    };
    let svg = '';
    const line = (a, b, cls) => {
      const p = this.project(a);
      const q = this.project(b);
      svg += `<line class="${cls}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
    };
    for (const k in items) {
      const it = items[k];
      if (!it || (k === 'e' && !it.show)) continue;
      line(it.seg[0], it.seg[1], 'dl');
      for (const [a, b] of it.ext) line(a, b, 'ext');
    }
    this.dimSvg.innerHTML = svg;
    for (const k in this.dimEls) {
      const el = this.dimEls[k];
      const it = items[k];
      if (!it || (k === 'e' && !it.show)) {
        if (this.editingDim !== k) el.style.display = 'none';
        continue;
      }
      const s = this.project(it.p);
      el.style.display = 'block';
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      if (this.editingDim !== k) el.textContent = fmt(it.v);
    }
  }

  editDim(k) {
    const [o] = this.selected;
    if (!o) return;
    const el = this.dimEls[k];
    this.editingDim = k;
    const current = el.textContent;
    el.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    el.appendChild(input);
    input.focus();
    input.select();
    const done = (apply) => {
      if (this.editingDim !== k) return;
      this.editingDim = null;
      const v = parseFloat(input.value.replace(',', '.'));
      el.innerHTML = '';
      if (apply && Number.isFinite(v)) this.setDimension(k, v);
      this.dimsVisibleUntil = performance.now() + 1200;
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
      if (e.key === 'Tab') {
        e.preventDefault();
        done(true);
        const order = ['w', 'd', 'h'];
        const next = order[(order.indexOf(k) + 1) % order.length];
        setTimeout(() => this.editDim(next), 0);
      }
    });
    input.addEventListener('blur', () => done(true));
  }

  // ---------------- laço de renderização ----------------

  // WASD: anda com a câmera no plano horizontal (câmera e alvo juntos)
  walk(dt) {
    const k = this.moveKeys;
    if (!k || !k.size) return;
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const side = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    if (!fwd && !side) return;
    const dir = this.controls.target.clone().sub(this.camera.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-8) this.camera.getWorldDirection(dir).setY(0);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(dist, 20) * 0.8 * dt;
    const move = dir.multiplyScalar(fwd).add(right.multiplyScalar(side)).normalize().multiplyScalar(speed);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  loop() {
    let last = performance.now();
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now();
      this.walk(Math.min((now - last) / 1000, 0.1));
      last = now;
      this.controls.update();
      const d = this.drag;
      const frame = d && d.kind === 'handle' ? d.frame : this.getFrame();
      const locked = this.selected.some((o) => o.locked);
      if (frame && !this.mode && !(d && d.kind === 'move' && d.moved)) {
        const only = d && d.kind === 'handle' ? d.handle : null;
        this.handles.update(frame, this.pixelSize(frame.pos), { only, locked });
      } else {
        this.handles.update(null);
      }
      this.updateDims();
      this.updateModeHandles();
      this.renderer.render(this.scene, this.camera);
      this.viewCube.update(this.camera, this.controls.target);
    };
    tick();
  }

  // cena para exportação: só sólidos visíveis, com transformações aplicadas
  exportScene(onlySelected = false) {
    const group = new THREE.Group();
    const list = onlySelected && this.selection.length ? this.selected : this.objects;
    for (const o of list) {
      if (o.hidden || o.hole) continue;
      const src = this.meshes.get(o.id);
      const mats = Array.isArray(src.material) ? src.material : [src.material];
      const m = new THREE.Mesh(src.geometry, mats.length === 1 ? mats[0] : mats);
      m.applyMatrix4(src.matrixWorld);
      group.add(m);
    }
    // Y para cima (three) -> Z para cima (impressão 3D)
    group.rotation.x = Math.PI / 2;
    group.updateMatrixWorld(true);
    return group;
  }
}

export function fmt(v) {
  const r = Math.round(v * 100) / 100;
  return String(r).replace('.', ',');
}
