// Crash breakup: the cached fuselage/wing split must cut the same triangles into the same bins as the per-triangle split it replaces, and the aircraft merge
// must keep the original parts for the breakup. Loads the real GLBs in node (no GPU, no browser).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual } = await load('/src/aircraft.js');
const { __split, Wreck } = await load('/src/crash.js');
const { addSplitMesh, splitCache, splitAxis, meshRootName } = __split;

const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
await new Promise((r) => setTimeout(r, 500));
visual.root.updateMatrixWorld(true);
const rootInverse = new THREE.Matrix4().copy(visual.root.matrixWorld).invert(), modelBounds = new THREE.Box3().setFromObject(visual.model).applyMatrix4(rootInverse);

const wreck = new Wreck(scene);
const t0 = performance.now(), stats = await wreck.prepare(visual, 50);
const prepMs = performance.now() - t0;
assert.ok(stats.meshes >= 5 && stats.tris > 250000, `prepared ${stats.meshes} meshes / ${stats.tris} triangles`);
console.log(`PASS prepare: ${stats.meshes} meshes, ${stats.tris} triangles, ${(stats.bytes / 2 ** 20).toFixed(1)} MB, ${prepMs.toFixed(0)} ms wall, ${stats.ms.toFixed(0)} ms of slices`);

const plans = [{ fuselageSegments: 2, wingSections: 1 }, { fuselageSegments: 3, wingSections: 2 }, { fuselageSegments: 5, wingSections: 2 }, { fuselageSegments: 6, wingSections: 2 }, { fuselageSegments: 8, wingSections: 3 }];
const targets = []; visual.model.traverse((o) => { if (o.isMesh && o.visible && !o.userData.shadowProxy && splitAxis(meshRootName(o, visual.model))) targets.push(o); });
assert.ok(targets.length >= 5, 'split targets found');

const triKey = (a, o) => [0, 1, 2].map((v) => [0, 1, 2].map((c) => a[o + v * 3 + c].toFixed(4)).join(',')).sort().join('|');
// a part's triangles in root space: the per-triangle path stores root-space soup, the cached path (round 5) draws a range of a sorted index over
// the mesh's own buffers with the mesh-to-root matrix
const _tp = new THREE.Vector3(), _tri = new Float64Array(9);
const eachRootTri = (part, fn) => { const g = part.geometry, a = g.attributes.position, ix = g.index ? g.index.array : null, s = g.drawRange.start || 0, n = Math.min(g.drawRange.count, (ix ? ix.length : a.count) - s);
  for (let t = s; t + 2 < s + n; t += 3) { for (let v = 0; v < 3; v++) { _tp.fromBufferAttribute(a, ix ? ix[t + v] : t + v); if (part.matrix) _tp.applyMatrix4(part.matrix); _tri[v * 3] = Math.fround(_tp.x); _tri[v * 3 + 1] = Math.fround(_tp.y); _tri[v * 3 + 2] = Math.fround(_tp.z); } fn(_tri, 0); } };
const bins = (records) => { const out = new Map(); for (const [k, rec] of records) { const set = new Map(); for (const part of rec.parts) eachRootTri(part, (a, o) => { const key = triKey(a, o); set.set(key, (set.get(key) || 0) + 1); }); out.set(k, set); } return out; };
let slowMs = 0, fastMs = 0;
for (const plan of plans) {
  const run = (noCache) => { const records = new Map(), made = []; const t = performance.now(); for (const m of targets) addSplitMesh(m, meshRootName(m, visual.model), rootInverse, modelBounds, plan, records, made, noCache); const ms = performance.now() - t; return { records, ms }; };
  const slow = run(true), fast = run(false);
  slowMs += slow.ms; fastMs += fast.ms;
  const a = bins(slow.records), b = bins(fast.records);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), `same bins for ${JSON.stringify(plan)}`);
  let total = 0, mismatched = 0;
  for (const [k, set] of a) { const other = b.get(k); for (const [key, n] of set) { total += n; if (other.get(key) !== n) mismatched++; } assert.equal([...other.values()].reduce((x, y) => x + y, 0), [...set.values()].reduce((x, y) => x + y, 0), `bin ${k} triangle count`); }
  assert.ok(mismatched <= total * 1e-4, `${mismatched}/${total} triangles landed in another bin (${JSON.stringify(plan)})`);
  for (const [k, rec] of slow.records) { const f = fast.records.get(k); for (const c of ['min', 'max']) for (const ax of ['x', 'y', 'z']) assert.ok(Math.abs(rec.box[c][ax] - f.box[c][ax]) < 1e-4, `bin ${k} box ${c}.${ax}`); }
  console.log(`PASS split ${JSON.stringify(plan)}: ${a.size} bins, ${total} triangles, ${mismatched} moved bins, per-triangle ${slow.ms.toFixed(0)} ms -> cached ${fast.ms.toFixed(1)} ms`);
}
console.log(`impact-time split over ${plans.length} plans: per-triangle ${slowMs.toFixed(0)} ms total -> cached ${fastMs.toFixed(1)} ms total`);

const mergedMeshes = []; visual.model.traverse((o) => { if (o.userData.mergedParts) mergedMeshes.push(o); });
assert.ok(mergedMeshes.length >= 8, 'merged meshes carry their source parts');
for (const m of mergedMeshes) { const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3; assert.equal(m.userData.mergedParts.reduce((n, p) => n + tris(p.geometry), 0), tris(m.geometry), `${m.name}: merged triangle count equals the sum of its parts`); }
console.log(`PASS merged meshes keep ${mergedMeshes.reduce((n, m) => n + m.userData.mergedParts.length, 0)} source parts in ${mergedMeshes.length} draws`);
// round 4: far from the world origin (Mach 3 for an hour) the mesh-to-root matrix differs in the last digits and every breakup missed the cache
{ const plan = { fuselageSegments: 8, wingSections: 3, separateTail: true }, split = (noCache) => { visual.root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(visual.root.matrixWorld).invert(), mb = new THREE.Box3().setFromObject(visual.model).applyMatrix4(inv);
    const t = performance.now(); for (const m of targets) addSplitMesh(m, meshRootName(m, visual.model), inv, mb, plan, new Map(), [], noCache); return performance.now() - t; };
  visual.root.position.set(1e6, 2e4, -3e6); visual.root.quaternion.setFromEuler(new THREE.Euler(0.3, 1.2, -0.4));
  const slow = split(true), fast = split(false); assert.ok(fast < slow * 0.4, `cached ${fast.toFixed(0)} ms vs per-triangle ${slow.toFixed(0)} ms`);
  console.log(`PASS 1,000 km from the origin, rotated: cached split ${fast.toFixed(0)} ms vs per-triangle ${slow.toFixed(0)} ms (missed the cache before round 4)`); }
console.log('crash-split-test ok');
await vite.close(); process.exit(0);
