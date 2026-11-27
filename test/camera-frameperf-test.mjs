import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCamera, baselinePath, candidatePath, allocationCounter, makeRig, countedFrames, ground, tower, frames, sample } from './helpers/camera-frameperf.mjs';

assert.equal(createHash('sha256').update(readFileSync(baselinePath)).digest('hex'), '4593dc965269ee0f68542939888aa6f7566541c6e1b93435855dad514ada7fdf');
const before = loadCamera(baselinePath), after = loadCamera(candidatePath);
const snapshot = ({ rig: r, camera: c }) => ({ world: r.world.toArray(), quaternion: c.quaternion.toArray(), position: c.position.toArray(),
  projection: c.projectionMatrix.toArray(), inverse: c.projectionMatrixInverse.toArray(), fov: c.fov, near: c.near,
  chase: r.chasePos?.toArray() ?? null, fly: r.flyPos?.toArray() ?? null, shakeT: r.shakeT });
// These exercise aircraft-specific eye/wing/nearest-distance settings without
// touching flight physics or downloading models. Deliberately use distinct rigs.
const geometries = [
  [14.22, 1.01, 0, 12, 25, 40], [-1.15, 1.58, -.29, 4, 7, 13],
  [1.2, .7, -.4, 4, 7, 14], [2.3, 1.7, -.5, 4, 8, 15],
  [10, 2.8, -.5, 14, 30, 62], [20, 5, -1.2, 22, 48, 105],
];
let comparisons = 0;
for (const [x, y, z, look, minDist, chase] of geometries) {
  const geometry = { eye: new THREE.Vector3(x, y, z), cabin: new THREE.Vector3(-2, 3, .4), wing: new THREE.Vector3(-8, 1, -6), look, minDist, chase };
  before.configureCameraAircraft(geometry); after.configureCameraAircraft(geometry);
  const pairs = before.VIEWS.map(view => [makeRig(before, view), makeRig(after, view)]);
  for (let i = 0; i < 1200; i++) for (const [b, a] of pairs) {
    const input = frames[i & 1023];
    const fdm = { pos: input.pos.clone(), vel: input.vel.clone(), quat: input.quat.clone() };
    // Boundary cases: stopped/vertical fly-by, origin rebase/teleport,
    // terrain clamping, zero dt, view re-entry and zoom.
    if (i % 103 === 0) fdm.vel.set(0, 0, 0);
    if (i % 107 === 0) fdm.vel.set(0, 80, 0);
    if (i % 109 === 0) fdm.pos.set(100000, -40, -100000);
    if (i % 37 === 0) for (const s of [b, a]) s.events.wheel({ deltaY: i % 74 ? -300 : 600 });
    if (i === 600) for (const s of [b, a]) { const view = s.rig.view; s.rig.set('cabin'); s.rig.set(view); }
    const original = [fdm.pos.toArray(), fdm.vel.toArray(), fdm.quat.toArray()];
    for (const s of [b, a]) {
      if (i % 127 === 0) {
        // main.js rebases the retained positions directly.
        s.rig.chasePos?.addScalar(-10000); s.rig.flyPos?.addScalar(-10000);
      }
      s.rig.look.yaw += .001; s.rig.look.pitch = Math.sin(i * .01) * .8;
      s.rig.update(i % 19 === 0 ? 0 : i % 5 === 0 ? .1 : 1 / 60, fdm, ground, tower, i % 3 ? .4 : 0);
    }
    assert.deepEqual(snapshot(a), snapshot(b), `camera parity frame ${i} ${a.rig.view}`);
    assert.deepEqual([fdm.pos.toArray(), fdm.vel.toArray(), fdm.quat.toArray()], original, 'camera must not mutate physics inputs');
    comparisons++;
  }
}
const counter = allocationCounter(), api = loadCamera(candidatePath, counter.three);
api.configureCameraAircraft({ cabin: new THREE.Vector3(-2, 3, .4) });
const allocations = {};
for (const view of api.VIEWS) {
  const { rig } = makeRig(api, view);
  const fixture = countedFrames(counter.three);
  sample(rig, 0, fixture); counter.reset();
  for (let i = 1; i <= 1024; i++) sample(rig, i, fixture);
  allocations[view] = { ...counter.counts };
  assert.equal(Object.values(counter.counts).reduce((a, b) => a + b, 0), 0, `${view}: no per-frame Three math constructors after initialisation`);
}
console.log(JSON.stringify({ comparisons, exactCameraAndProjectionParity: true, physicsInputsUnchanged: true, per1024Frames: allocations }));
console.log('PASS camera hot-path exact parity, per-instance scratch isolation, view/zoom/shake/rebase boundaries and zero steady Three math construction');
