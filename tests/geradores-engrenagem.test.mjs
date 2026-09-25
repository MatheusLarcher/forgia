// Engrenagem (src/geradores/engrenagem.js): malha fechada, medidas, e duas engrenagens do mesmo
// módulo (z = 20 e z = 12) girando juntas na distância m·(z1 + z2)/2 sem interferência (2D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGear, gearOutline, gearSize, centerDistance, meshRotation, toothFlank, toothOutline } from '../src/geradores/engrenagem.js';
import { meshReport } from '../src/geradores/malha.js';

function assertClosed(r, name) {
  assert.equal(r.openEdges, 0, `${name}: arestas abertas`);
  assert.equal(r.nonManifoldEdges, 0, `${name}: arestas com mais de 2 triângulos`);
  assert.equal(r.flippedEdges, 0, `${name}: sentido invertido`);
  assert.equal(r.degenerate, 0, `${name}: degenerados`);
  assert.ok(r.volume > 0, `${name}: volume ${r.volume}`);
}

// ---------- geometria 2D para o teste de engrenamento ----------

const transform = (pts, a, dx) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([u, v]) => [u * c - v * s + dx, u * s + v * c]);
};

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// só os trechos perto da zona de engrenamento (dentro do círculo de cabeça da outra)
const near = (pts, cx, R) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]).filter(([p, q]) => Math.hypot(p[0] - cx, p[1]) < R || Math.hypot(q[0] - cx, q[1]) < R);

function meshCheck(m, z1, z2, backlash, steps = 90) {
  const g1 = gearOutline({ module: m, teeth: z1, backlash });
  const g2 = gearOutline({ module: m, teeth: z2, backlash });
  const a = centerDistance(m, z1, z2);
  let minGap = Infinity;
  let overlaps = 0;
  const pitch1 = (2 * Math.PI) / z1;
  for (let k = 0; k < steps; k++) {
    const phi = (pitch1 * k) / steps;
    const A = transform(g1.points, phi, 0);
    const B = transform(g2.points, meshRotation(z2) - (phi * z1) / z2, a);
    const sa = near(A, a, g2.ra + 0.1);
    const sb = near(B, 0, g1.ra + 0.1);
    for (const [p] of sa) if (pointInPolygon(p, B)) overlaps++;
    for (const [p] of sb) if (pointInPolygon(p, A)) overlaps++;
    for (const [p, q] of sa) for (const [c, d] of sb) if (segmentsCross(p, q, c, d)) overlaps++;
    for (const [p] of sa) for (const [c, d] of sb) minGap = Math.min(minGap, segDist(p, c, d));
    for (const [p] of sb) for (const [c, d] of sa) minGap = Math.min(minGap, segDist(p, c, d));
  }
  return { minGap, overlaps, a };
}

test('engrenagem: malha fechada, diâmetro externo m·(z + 2), espessura e furo', (t) => {
  for (const [m, z] of [
    [1.5, 20],
    [1.5, 12],
    [1, 8],
    [2, 40],
    [0.8, 60],
  ]) {
    const name = `engrenagem m${m} z${z}`;
    const r = meshReport(buildGear({ module: m, teeth: z, thickness: 5 }));
    assertClosed(r, name);
    const s = gearSize({ module: m, teeth: z, thickness: 5 });
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(r.size[k] - s[k]) < 1e-3, `${name}: ${r.size} ≠ ${s}`);
    if (z % 4 === 0) {
      assert.ok(Math.abs(r.size[0] - m * (z + 2)) < 1e-3, `${name}: Ø externo ${r.size[0]}`);
      assert.ok(Math.abs(r.size[2] - m * (z + 2)) < 1e-3, `${name}: Ø externo ${r.size[2]}`);
    }
    assert.ok(Math.abs(r.size[1] - 5) < 1e-4);
  }
  // o furo tira volume; sem furo, volume maior
  const withBore = meshReport(buildGear({ bore: 5 }));
  const noBore = meshReport(buildGear({ bore: 0 }));
  assertClosed(noBore, 'engrenagem sem furo');
  const expected = (Math.PI * 2.5 ** 2 * 6);
  assert.ok(Math.abs(noBore.volume - withBore.volume - expected) / expected < 0.01, 'volume do furo Ø5');
  const def = meshReport(buildGear({}));
  t.diagnostic(`engrenagem padrão (m 1,5, z 20): ${def.triangles} triângulos`);
  assert.ok(def.triangles <= 4000);
});

test('engrenagens z = 20 e z = 12 do mesmo módulo engrenam na distância m·(z1 + z2)/2 sem interferência', (t) => {
  for (const m of [1.5, 1]) {
    const r = meshCheck(m, 20, 12, 0.2);
    t.diagnostic(`m ${m}: distância ${r.a} mm; folga mínima entre perfis ${r.minGap.toFixed(4)} mm em 90 posições de um passo; sobreposições ${r.overlaps}`);
    assert.equal(r.overlaps, 0, `m ${m}: perfis se sobrepõem`);
    assert.ok(r.minGap > 0.02, `m ${m}: folga mínima ${r.minGap}`);
    assert.ok(r.minGap < 0.2, `m ${m}: folga mínima ${r.minGap} grande demais: os dentes não estão engrenados`);
  }
});

test('o teste de engrenamento enxerga a fase: sem o meio passo da segunda engrenagem, colide', () => {
  const g1 = gearOutline({ teeth: 20 });
  const g2 = gearOutline({ teeth: 12 });
  const a = centerDistance(1.5, 20, 12);
  const A = transform(g1.points, 0, 0);
  const B = transform(g2.points, 0, a); // dente contra dente
  assert.ok(near(A, a, g2.ra).some(([p]) => pointInPolygon(p, B)));
});

// maior penetração (mm) de vértices da engrenagem z2 (na origem) dentro do pinhão, ao longo de um passo
function penetration(pinion, z1, g2, z2, a, steps = 120) {
  let depth = 0;
  for (let k = 0; k < steps; k++) {
    const phi = ((2 * Math.PI) / z2) * (k / steps);
    const A = transform(g2.points, phi, 0);
    const B = transform(pinion, meshRotation(z1) - (phi * z2) / z1, a);
    const segsB = near(B, 0, g2.ra + 0.1);
    for (const [p] of near(A, a, g2.ra + 0.1)) {
      if (!pointInPolygon(p, B)) continue;
      let d = Infinity;
      for (const [c, e] of segsB) d = Math.min(d, segDist(p, c, e));
      depth = Math.max(depth, d);
    }
  }
  return depth;
}

test('contraprova sem folga: z = 12 com flanco radial abaixo da base interfere; a gerada pela cremalheira não', (t) => {
  const m = 1.5;
  for (const z2 of [20, 60, 120]) {
    const f = toothFlank(m, 12, 0);
    const ra = f.r + m;
    // evolvente pura acima da base e flanco radial abaixo dela: o perfil "ingênuo"
    const flank = [];
    for (let i = 0; i <= 60; i++) {
      const R = f.rRoot + ((ra - f.rRoot) * i) / 60;
      flank.push([R, f.betaInv(Math.max(R, f.rb))]);
    }
    const naive = toothOutline(12, flank);
    const g2 = gearOutline({ module: m, teeth: z2, backlash: 0 });
    const a = centerDistance(m, z2, 12);
    const bad = penetration(naive, 12, g2, z2, a);
    const good = penetration(gearOutline({ module: m, teeth: 12, backlash: 0, resolution: 30 }).points, 12, g2, z2, a);
    t.diagnostic(`z12 × z${z2}, folga 0: penetração com flanco radial ${bad.toFixed(4)} mm; com o perfil gerado ${good.toFixed(4)} mm`);
    assert.ok(bad > 0.001, `z${z2}: o flanco radial deveria interferir`);
    assert.ok(good < 0.001, `z${z2}: o perfil gerado interfere ${good} mm`);
  }
});
