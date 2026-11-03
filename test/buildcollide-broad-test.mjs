// Broad phase of the building collider: identical results to the brute-force sweep on random layouts, and how much cheaper it is.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingCollider } from '../src/buildcollide.js';

let rs = 12345; const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
function boxVerts(x0, y0, z0, x1, y1, z1) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4]];
  return f.flatMap((t) => t.flatMap((i) => c[i]));
}
function makeTile(nb, span) {
  const all = [], bStart = [], bCount = []; let v = 0;
  for (let b = 0; b < nb; b++) {
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span, w = 8 + rnd() * 30, dpt = 8 + rnd() * 30, h = 10 + rnd() * 120;
    const vs = boxVerts(x, 0, z, x + w, h, z + dpt); bStart.push(v); bCount.push(vs.length / 3); v += vs.length / 3; all.push(...vs);
  }
  return { mesh: { geometry: { attributes: { position: { array: new Float32Array(all), version: 1 } } }, scale: { x: 1 } }, wx: 0, wz: 0, W: span, H: span, count: nb, bStart, bCount, sited: true };
}
const fdm = (x, y, z, q) => ({ pos: new THREE.Vector3(x, y, z), quat: q || new THREE.Quaternion() });

const nb = 1500, span = 3000;
let hits = 0, frames = 0;
const paths = [];
for (let k = 0; k < 60; k++) {
  const tile = makeTile(nb, span), tiles = new Map([['a', tile]]);
  const a = new BuildingCollider(), b = new BuildingCollider(); b.broad = false;
  let x = (rnd() - 0.5) * 2000, y = 20 + rnd() * 150, z = (rnd() - 0.5) * 2000;
  const vx = (rnd() - 0.5) * 260, vz = (rnd() - 0.5) * 260, vy = (rnd() - 0.5) * 20, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() - 0.5, rnd() * 6.28, rnd() - 0.5));
  for (let f = 0; f < 120; f++) {
    x += vx / 60; y += vy / 60; z += vz / 60; const ra = a.test(tiles, fdm(x, y, z, q)), rb = b.test(tiles, fdm(x, y, z, q)); frames++;
    assert.equal(ra ? `${ra.building}/${ra.point}` : null, rb ? `${rb.building}/${rb.point}` : null, `run ${k} frame ${f}`);
    if (ra) { hits++; break; }
  }
  paths.push({ tile, tiles, x, y, z, vx, vy, vz, q });
}
console.log(`PASS broad phase matches brute force on ${frames} frames, ${hits} collisions found`);
assert.ok(hits > 3, 'layout produces some hits so the comparison is meaningful');

const tile = makeTile(2500, 3000), tiles = new Map([['a', tile]]), a = new BuildingCollider(), b = new BuildingCollider(); b.broad = false;
const time = (c) => { let x = -1400; const t0 = process.hrtime.bigint(); for (let f = 0; f < 3000; f++) { x = -1400 + ((f * 1.2) % 2800); c.test(tiles, fdm(x, 40, 5 + (f % 10) * 0.01)); } return Number(process.hrtime.bigint() - t0) / 3000 / 1e3; };
time(a); time(b); const ta = time(a), tb = time(b);
console.log(`PASS timing, 2500 buildings: brute ${tb.toFixed(1)} us/frame, broad ${ta.toFixed(1)} us/frame (${(tb / ta).toFixed(1)}x), box checks ${a.checks} vs ${b.checks}`);
assert.ok(a.checks < b.checks / 5);
