// The valid fifth burst can arrive after 3 s: exercise both PRNG boundaries deterministically.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Wreck, SR71_SCALE } from '../src/crash.js';
for (const sample of [0, 0.5, 1 - Number.EPSILON]) {
  const original = Math.random; Math.random = () => sample;
  try {
    const w = new Wreck(new THREE.Scene());
    w.scale = { ...SR71_SCALE, fuelCap: 144, speedRef: 75, sinkRef: 28, size: 0.3 };
    const fdm = { pos: new THREE.Vector3(0, 100, 0), crashVel: new THREE.Vector3(45, -22, 0), fuel: 120,
      quat: new THREE.Quaternion(), crashInfo: { pitch: 0.6, bank: 0.3, gearPosition: 1 }, out: { V: 50, M: 0.15, nz: 1 } };
    const info = w._classify(null, fdm, 'impact', fdm.crashVel, new THREE.Vector3(0, 1, 0));
    w.pieces = [{ pos: fdm.pos.clone() }]; w._initialEffects(fdm, info);
    assert.ok(w.bursts.length >= 2 && w.bursts.length <= 5);
    assert.ok(w.bursts.every((b) => Number.isFinite(b.t) && b.t >= 0.35 && b.t <= 3.15 + 1e-12));
    if (sample > 0.99) {
      assert.equal(w.bursts.length, 5);
      assert.ok(w.bursts.at(-1).t > 3, 'the valid late fifth burst is not a failure');
    }
  } finally { Math.random = original; }
}
console.log('PASS EW-17 fixed boundary samples cover valid delayed secondary bursts');
