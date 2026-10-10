// Flight-model sanity: take-off roll, rotation, climb and a zero timestep. Offline.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';

const f = new FlightModel(), flat = () => 0, calm = new THREE.Vector3();
f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true);
f.setEngines(1, true);
f.step(0, flat, calm); // a zero timestep must not change or poison the state
assert.ok(Number.isFinite(f.pos.y) && Number.isFinite(f.out.V ?? 0), 'zero timestep left NaNs');

const dt = 1 / 240;
let t = 0, airborne = 0;
for (; t < 70; t += dt) {
  if (f.vel.length() > 95) f.ctrl.de = 0.12; // rotate
  f.step(dt, flat, calm);
  assert.ok(Number.isFinite(f.pos.x + f.pos.y + f.pos.z + f.vel.x + f.vel.y + f.vel.z), `NaN in state at ${t.toFixed(2)} s`);
  assert.ok(!f.crashed, `crashed at ${t.toFixed(1)} s: ${f.crashed}`);
  if (!f.onGround && !airborne) airborne = t;
}
console.log(`lift-off at ${airborne.toFixed(1)} s, then ${f.vel.length().toFixed(0)} m/s, ${f.pos.y.toFixed(0)} m after ${t.toFixed(0)} s`);
assert.ok(airborne > 5 && airborne < 60, 'should rotate and lift off within a minute');
assert.ok(f.pos.y > 100, 'should be climbing');
assert.ok(f.engines.every((e) => e.dry > 0.9), 'engines should have spooled up');
console.log('fdm-test ok');
