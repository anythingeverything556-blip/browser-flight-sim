// Solid buildings: segment/box/triangle sweeps and the per-tile test with a synthetic 20 x 30 x 20 m building.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { segBox, segTri, buildingBoxes, BuildingCollider, COLLIDE_POINTS, C172_COLLIDE_POINTS, C172_PAD } from '../src/buildcollide.js';
const t = (n, f) => { f(); console.log('PASS ', n); };

// a closed box (12 triangles) from (x0,y0,z0) to (x1,y1,z1), as flat vertex triples
function boxMesh(x0, y0, z0, x1, y1, z1) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]], v = [];
  for (const [a, b, d, e] of f) for (const i of [a, b, d, a, d, e]) v.push(...c[i]);
  return new Float32Array(v);
}
const tile = (verts, count = 1) => ({ mesh: { geometry: { attributes: { position: { array: verts, version: 1 } } }, scale: { x: 1 } }, wx: 0, wz: 0, W: 1000, H: 1000, count, bStart: [0], bCount: [verts.length / 3], sited: true });

t('segBox: through, beside, above, and a segment that stops short', () => {
  const b = new Float32Array([0, 0, 0, 20, 30, 20]);
  assert.equal(segBox(-10, 10, 10, 40, 0, 0, b, 0, 0), true); assert.equal(segBox(-10, 10, 40, 40, 0, 0, b, 0, 0), false);
  assert.equal(segBox(-10, 50, 10, 40, 0, 0, b, 0, 0), false); assert.equal(segBox(-10, 10, 10, 5, 0, 0, b, 0, 0), false); assert.equal(segBox(-10, 10, 10, 9.5, 0, 0, b, 0, 0.6), true);
});
t('segTri crosses a triangle once, from both sides', () => {
  const a = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  assert.equal(segTri(2, 2, -1, 0, 0, 2, a, 0, 1, 2), true); assert.equal(segTri(2, 2, 1, 0, 0, -2, a, 0, 1, 2), true); assert.equal(segTri(8, 8, -1, 0, 0, 2, a, 0, 1, 2), false); assert.equal(segTri(2, 2, -1, 0, 0, 0.5, a, 0, 1, 2), false);
});
t('buildingBoxes finds the extent and the tile top', () => {
  const tl = tile(boxMesh(5, 0, 5, 25, 30, 25)); const b = buildingBoxes(tl);
  assert.deepEqual([...b], [5, 0, 5, 25, 30, 25]); assert.equal(tl.cbMaxY, 30);
});
// a fake aircraft: one body at pos with identity attitude; the hard points are at their body offsets
const fdm = (x, y, z) => ({ pos: new THREE.Vector3(x, y, z), quat: new THREE.Quaternion() });
const run = (verts, path) => { const c = new BuildingCollider(), tiles = new Map([['a', tile(verts)]]); let hit = null; for (const [x, y, z] of path) { hit = c.test(tiles, fdm(x, y, z)) || hit; } return hit; };
const B = boxMesh(100, 0, -10, 120, 30, 10);
t('flying into a wall is a hit', () => { const path = []; for (let x = -100; x <= 140; x += 10) path.push([x, 15, 0]); assert.ok(run(B, path), 'no hit'); });
t('flying over the roof is not', () => { const path = []; for (let x = -100; x <= 140; x += 10) path.push([x, 60, 0]); assert.equal(run(B, path), null); });
t('passing beside the building is not', () => { const path = []; for (let x = -100; x <= 140; x += 10) path.push([x, 15, 40]); assert.equal(run(B, path), null); });
t('a fast pass (300 m between frames) through a thin building is still caught', () => { assert.ok(run(boxMesh(100, 0, -10, 106, 30, 10), [[-60, 15, 0], [-30, 15, 0], [0, 15, 0], [30, 15, 0], [60, 15, 0], [90, 15, 0], [140, 15, 0], [190, 15, 0]])); });
t('a courtyard: flying through the gap of a U-shaped pair of buildings is not a hit', () => {
  const two = new Float32Array([...boxMesh(100, 0, -40, 120, 30, -15), ...boxMesh(100, 0, 15, 120, 30, 40)]);
  const tl = tile(two); tl.bStart = [0, 36]; tl.bCount = [36, 36]; tl.count = 2;
  const c = new BuildingCollider(), tiles = new Map([['a', tl]]); let hit = null;
  for (let x = -100; x <= 220; x += 10) hit = c.test(tiles, fdm(x, 15, 0)) || hit;
  // wingtips (+-8.4 m) clear 15 m of gap on each side
  assert.equal(hit, null);
});
t('a teleport (respawn) between frames is not a hit', () => { const c = new BuildingCollider(), tiles = new Map([['a', tile(B)]]); c.test(tiles, fdm(-500, 15, 0)); assert.equal(c.test(tiles, fdm(110, 15, 0)), null); });
t('hard points include the nose, wingtips and the extra wing points', () => { assert.ok(COLLIDE_POINTS.length >= 17); });
// Skyhawk: its own points (11 m span, wheels 1.15 m below the CG), not the SR-71's (17 m span)
const gap = (half) => { const two = new Float32Array([...boxMesh(100, 0, -40, 120, 30, -half), ...boxMesh(100, 0, half, 120, 30, 40)]); const tl = tile(two); tl.bStart = [0, 36]; tl.bCount = [36, 36]; tl.count = 2; return tl; };
const pass = (c, tl, y = 15) => { const tiles = new Map([['a', tl]]); let hit = null; for (let x = -100; x <= 220; x += 10) hit = c.test(tiles, fdm(x, y, 0)) || hit; return hit; };
t('Skyhawk: the wingtips span 11 m and the wheels hang below the CG', () => {
  const zs = C172_COLLIDE_POINTS.map((p) => p.z), ys = C172_COLLIDE_POINTS.map((p) => p.y);
  assert.ok(Math.abs(Math.max(...zs) - 5.5) < 0.01 && Math.abs(Math.min(...zs) + 5.5) < 0.01); assert.ok(Math.min(...ys) < -1.1 && Math.min(...ys) > -1.4);
});
t('Skyhawk: a 14 m gap the SR-71 hits is clear for the Skyhawk; a 9 m gap is not', () => {
  assert.ok(pass(new BuildingCollider(), gap(7)), 'SR-71 should hit');
  assert.equal(pass(new BuildingCollider(C172_COLLIDE_POINTS, C172_PAD), gap(7)), null);
  assert.ok(pass(new BuildingCollider(C172_COLLIDE_POINTS, C172_PAD), gap(4.5)), 'Skyhawk wingtip should hit');
});
t('Skyhawk: the wheels skimming a 30 m roof are a hit, 2 m above it are not', () => {
  assert.ok(pass(new BuildingCollider(C172_COLLIDE_POINTS, C172_PAD), tile(boxMesh(100, 0, -10, 120, 30, 10)), 31));
  assert.equal(pass(new BuildingCollider(C172_COLLIDE_POINTS, C172_PAD), tile(boxMesh(100, 0, -10, 120, 30, 10)), 33.5), null);
});
console.log('all building collision tests passed');
