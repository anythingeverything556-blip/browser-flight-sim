import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { C172Model } from '../src/c172.js';
import { SF50Model } from '../src/sf50.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const g = () => 0, wind = new THREE.Vector3();
// a level arrival at speed (m/s) sinking at vs (m/s) from just above the wheels; returns the crash reason or null after 6 s
function arrive(Model, cgH, speed, vs, pitchDeg = 0) {
  const f = new Model(); f.reset(new THREE.Vector3(0, cgH + 0.4, 0), 90, speed, false); f.gearDown = true; f.gearPos = 1; f.vel.y = -vs; f.throttle = 0;
  if (pitchDeg) f.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitchDeg * Math.PI / 180));
  for (let i = 0; i < 1440 && !f.crashed; i++) f.step(1 / 240, g, wind);
  return f.crashed;
}
check('Blackbird: a firm 5.5 m/s touchdown at 185 kt is a landing now (crashed before)', () => assert.equal(arrive(FlightModel, 2.42, 95, 5.5), null));
check('Blackbird: 9 m/s still crashes', () => assert.ok(arrive(FlightModel, 2.42, 85, 9)));
check('Skyhawk: a firm 4.5 m/s touchdown is a landing now (crashed above 4)', () => assert.equal(arrive(C172Model, 1.15, 30, 4.5), null));
check('Vision Jet: a firm 5 m/s touchdown is a landing now (crashed above 4.5)', () => assert.equal(arrive(SF50Model, 1.20, 50, 5), null));
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('landing forgiveness OK');
