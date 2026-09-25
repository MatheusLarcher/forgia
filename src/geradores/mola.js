// Mola helicoidal: fio de seção redonda varrido numa hélice à direita em torno de Y, com as pontas
// fechadas por discos planos. Diâmetro externo, diâmetro do fio, passo e número de espiras.
// Limites de impressão: entre espiras sobra pelo menos 0,4 mm (o passo cresce se preciso) e o
// furo interno tem pelo menos 1 mm. Em FDM, imprima em pé com suporte ou use fio ≥ 1,2 mm.
import * as THREE from 'three';
import { MeshBuilder, roundTo } from './malha.js';
import { paramFactory, resolveParams } from './parametros.js';

const P = paramFactory('spring');
export const SPRING_PARAMS = [
  P('diameter', { value: 20, min: 4, max: 200, step: 0.5, unit: 'mm', bridge: 'diametro' }),
  P('wire', { value: 2, min: 0.6, max: 20, step: 0.1, unit: 'mm', bridge: 'fio' }),
  P('pitch', { value: 5, min: 1, max: 100, step: 0.1, unit: 'mm', bridge: 'passo' }),
  P('coils', { value: 5, min: 1, max: 50, step: 0.5, bridge: 'espiras' }),
  P('sides', { value: 12, min: 8, max: 32, step: 4, bridge: 'lados' }),
  P('segments', { value: 32, min: 12, max: 96, step: 4, bridge: 'segmentos' }),
];

const MIN_GAP = 0.4;

export function springDims(params) {
  const p = resolveParams(SPRING_PARAMS, params);
  const wire = Math.min(p.wire, (p.diameter - 1) / 2);
  const R = (p.diameter - wire) / 2; // raio da linha de centro
  // folga entre espiras medida na normal do fio: passo·cos(λ) − fio ≥ 0,4
  let pitch = p.pitch;
  for (let i = 0; i < 4; i++) {
    const cosL = (2 * Math.PI * R) / Math.hypot(2 * Math.PI * R, pitch);
    pitch = Math.max(p.pitch, (wire + MIN_GAP) / cosL);
  }
  const cosL = (2 * Math.PI * R) / Math.hypot(2 * Math.PI * R, pitch);
  return { p, wire, R, pitch, cosL, height: p.coils * pitch + wire * cosL };
}

export function springSize(params) {
  const d = springDims(params);
  return [2 * d.R + d.wire, d.height, 2 * d.R + d.wire];
}

export function buildSpring(params) {
  const { p, wire, R, pitch } = springDims(params);
  const sides = roundTo(p.sides, 4);
  const perTurn = roundTo(p.segments, 4);
  const steps = Math.max(2, Math.round(p.coils * perTurn));
  const total = p.coils * 2 * Math.PI;
  const rho = wire / 2;
  const b = new MeshBuilder();
  const rings = [];
  const centers = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let j = 0; j <= steps; j++) {
    const t = (total * j) / steps;
    const c = new THREE.Vector3(R * Math.sin(t), (pitch * t) / (2 * Math.PI), R * Math.cos(t));
    T.set(R * Math.cos(t), pitch / (2 * Math.PI), -R * Math.sin(t)).normalize();
    N.set(Math.sin(t), 0, Math.cos(t)); // para fora, perpendicular a T
    B.crossVectors(T, N).normalize();
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (2 * Math.PI * k) / sides;
      const ca = Math.cos(a) * rho;
      const sa = Math.sin(a) * rho;
      ring.push(b.vertex(c.x + ca * N.x + sa * B.x, c.y + ca * N.y + sa * B.y, c.z + ca * N.z + sa * B.z));
    }
    rings.push(ring);
    centers.push(c);
  }
  for (let j = 0; j < steps; j++) {
    const A = rings[j];
    const C = rings[j + 1];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      b.tri(A[k], C[k], C[k1]);
      b.tri(A[k], C[k1], A[k1]);
    }
  }
  const c0 = centers[0];
  const c1 = centers[steps];
  const s0 = b.vertex(c0.x, c0.y, c0.z);
  const s1 = b.vertex(c1.x, c1.y, c1.z);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    b.tri(s0, rings[0][k], rings[0][k1]);
    b.tri(s1, rings[steps][k1], rings[steps][k]);
  }
  b.orient();
  return b.toGeometry();
}
