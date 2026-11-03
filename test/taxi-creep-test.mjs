import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const KT = 1.943844, ground = () => 0, wind = new THREE.Vector3();
// parked or rolling at idle with the brakes and parking brake off; returns ground speed (kt) after `secs`
function idle(secs, { fuel, speed = 0 } = {}) {
  const f = new FlightModel(); f.realism.unstarts = false; f.reset(new THREE.Vector3(0, 2.6, 0), 90, speed, true);
  if (fuel != null) f.fuel = fuel; f.parkingBrake = false; f.brakes = 0; f.throttle = 0;
  for (let t = 0; t < secs; t += 1 / 240) f.step(1 / 240, ground, wind);
  return f.vel.length() * KT;
}
check('at idle with the brakes off the jet stays put (was 6 kt after 1 min, 44 kt after 9)', () => {
  for (const fuel of [null, 15000, 2000]) { const v = idle(180, { fuel }); assert.ok(v < 1.5, `fuel ${fuel}: ${v.toFixed(1)} kt`); }
});
check('once taxiing it keeps rolling at idle (breakaway only below walking pace)', () => {
  const v = idle(30, { speed: 5.2 }); assert.ok(v > 10, `${v.toFixed(1)} kt`);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('taxi creep OK');
