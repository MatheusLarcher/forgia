// Rosca: porca M3 real × parafuso M3 real do Forgia. Folga medida nas malhas (raios do eixo para
// fora, com BVH) e no perfil; a porca fica a um número inteiro de passos da base do parafuso, onde
// as hélices casam sem girar (veja a fase em src/geradores/rosca.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { buildNut, buildBolt } from '../src/geradores/hardware.js';
import { METRIC, METRIC_SIZES, threadProfile, threadDims, autoThreadClearance } from '../src/geradores/rosca.js';

// raio da primeira superfície atravessada por um raio que sai do eixo, na altura y e no ângulo θ
function radialHit(bvh, theta, y) {
  const ray = new THREE.Ray(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)));
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit ? hit.distance : Infinity;
}

// peça no quadro natural: base em y = 0 (o gerador devolve a caixa centrada; o eixo continua em x = z = 0)
function natural(geo) {
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  return geo;
}

// clearance 0 = folga automática do gerador (o padrão do parâmetro)
function fit(m, { clearance = 0, shift = 0 } = {}) {
  const spec = METRIC[m];
  const P = spec.pitch;
  const bolt = natural(buildBolt({ m, length: 10, head: 1, clearance }));
  const k = spec.hexHead.k;
  const y0 = Math.ceil((k + 1) / P) * P + shift; // base da porca: múltiplo do passo (+ desvio de teste)
  const H = spec.nut.m;
  const nut = natural(buildNut({ m, clearance }));
  nut.translate(0, y0, 0);
  const bb = new MeshBVH(bolt);
  const bn = new MeshBVH(nut);
  let minGap = Infinity;
  let at = null;
  let boltMax = 0;
  let nutMin = Infinity;
  const NT = 240;
  const NY = 80;
  for (let i = 0; i < NT; i++) {
    const th = (2 * Math.PI * (i + 0.37)) / NT;
    for (let j = 0; j <= NY; j++) {
      const y = y0 + 0.02 + ((H - 0.04) * j) / NY;
      const rb = radialHit(bb, th, y);
      const rn = radialHit(bn, th, y);
      if (rn - rb < minGap) {
        minGap = rn - rb;
        at = { th, y, rb, rn };
      }
      boltMax = Math.max(boltMax, rb);
      nutMin = Math.min(nutMin, rn);
    }
  }
  // também em cada vértice do parafuso dentro da altura da porca
  const pos = bolt.attributes.position;
  let vertexGap = Infinity;
  let nv = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < y0 + 0.02 || y > y0 + H - 0.02) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const rn = radialHit(bn, Math.atan2(x, z), y);
    vertexGap = Math.min(vertexGap, rn - r);
    nv++;
  }
  return { minGap, at, engagement: boltMax - nutMin, boltMax, nutMin, vertexGap, nv };
}

function profileFit(m, c) {
  const P = METRIC[m].pitch;
  const screw = threadProfile(m, P, c, false);
  const nut = threadProfile(m, P, c, true);
  let gap = Infinity;
  for (let i = 0; i <= 4000; i++) gap = Math.min(gap, nut.radiusAt(i / 4000) - screw.radiusAt(i / 4000));
  const depth = threadDims(m, P).depth;
  return { gap, engagement: screw.rMax - nut.rMin, depth };
}

test('perfil ISO: passo grosso e diâmetro menor D − 1,0825·P', () => {
  const pitches = { 2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25 };
  for (const m of METRIC_SIZES) {
    assert.equal(METRIC[m].pitch, pitches[m]);
    assert.ok(Math.abs(threadDims(m, pitches[m]).minor - (m - 1.082532 * pitches[m])) < 1e-5);
  }
});

test('perfil ISO com a folga automática: folga radial ≥ 2·folga e engate ≥ 50% do filete de M2 a M8', (t) => {
  for (const m of METRIC_SIZES) {
    const c = autoThreadClearance(METRIC[m].pitch);
    const r = profileFit(m, c);
    t.diagnostic(`M${m}: folga ${c.toFixed(4)} mm/peça; folga radial mínima ${r.gap.toFixed(4)} mm; engate ${r.engagement.toFixed(3)} de ${r.depth.toFixed(3)} mm (${Math.round((100 * r.engagement) / r.depth)}%)`);
    assert.ok(r.gap >= 2 * c - 1e-9, `M${m}: folga radial mínima ${r.gap} < 2·folga`);
    assert.ok(r.engagement >= 0.5 * r.depth, `M${m}: engate ${r.engagement} < 50% de ${r.depth}`);
  }
  // por que automática: 0,1 mm fixo por peça deixa a M2 sem engate nenhum
  assert.ok(profileFit(2, 0.1).engagement < 0);
});

test('porca M3 real × parafuso M3 real: folga positiva em toda a porca, sem interseção, engatados', (t) => {
  const r = fit(3);
  const c = autoThreadClearance(METRIC[3].pitch);
  t.diagnostic(`M3 (folga ${c} mm/peça): folga radial mínima nas malhas ${r.minGap.toFixed(4)} mm (θ=${r.at.th.toFixed(3)}, y=${r.at.y.toFixed(3)}); nos ${r.nv} vértices do parafuso ${r.vertexGap.toFixed(4)} mm; engate ${r.engagement.toFixed(4)} mm (crista do parafuso ${r.boltMax.toFixed(4)} > menor raio da porca ${r.nutMin.toFixed(4)})`);
  // 2·folga menos a corda das facetas (48 segmentos: ~0,003 mm em r = 1,5)
  assert.ok(r.minGap > 2 * c - 0.01, `folga mínima ${r.minGap} (esperado ~2·folga = ${2 * c})`);
  assert.ok(r.vertexGap > 2 * c - 0.01, `folga nos vértices ${r.vertexGap}`);
  assert.ok(r.nv > 500, 'poucos vértices do parafuso dentro da porca');
  assert.ok(r.engagement > 0.1, `engate ${r.engagement}: a porca passaria direto`);
});

test('porca M3 × parafuso M3 com folga maior (0,1 mm/peça): folga cresce, engate diminui', (t) => {
  const r = fit(3, { clearance: 0.1 });
  t.diagnostic(`M3 com 0,1 mm/peça: folga mínima ${r.minGap.toFixed(4)} mm, engate ${r.engagement.toFixed(4)} mm`);
  assert.ok(r.minGap > 0.19);
  assert.ok(r.engagement > 0 && r.engagement < 0.05);
});

test('o teste de encaixe enxerga a fase: porca meio passo fora da hélice colide', () => {
  const r = fit(3, { shift: METRIC[3].pitch / 2 });
  assert.ok(r.minGap < 0, `meio passo fora ainda deu folga ${r.minGap}`);
});

test('M8 real: engate de verdade com a folga padrão', (t) => {
  const r = fit(8);
  t.diagnostic(`M8: folga mínima ${r.minGap.toFixed(4)} mm, engate ${r.engagement.toFixed(4)} mm`);
  assert.ok(r.minGap > 0.19);
  assert.ok(r.engagement > 0.4);
});
