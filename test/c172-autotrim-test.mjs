import assert from 'node:assert/strict';
import * as THREE from 'three';
import { C172Model } from '../src/c172.js';
import { attitude } from '../src/autopilot.js';
import { makeAutoTrim, autoTrimStep, AT_C172 } from '../src/autotrim.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const D = 180 / Math.PI, wind = new THREE.Vector3(), ground = () => -1e4;
// cruise, pull the nose up 1.5 s, let go and fly 15 s hands-off; returns the pitch just after the pull and at the end, in degrees
function pullAndRelease(auto) {
  const f = new C172Model(); f.reset(new THREE.Vector3(0, 1500, 0), 90, 52, false, 0); const at = makeAutoTrim(); let p1 = 0;
  for (let t = 0; t < 18; t += 1 / 60) {
    const stick = t > 1 && t < 2 ? 0.12 : 0; // a gentle pull, about 5-10 deg of pitch f.ctrl.de = stick; f.ctrl.da = 0; f.ctrl.dr = 0;
    if (auto) f.trim = autoTrimStep(at, { enabled: true, trim: f.trim, q: f.w.z, power: f.out.pitchPower * 0.6, alpha: f.out.alpha || 0, stick, V: f.out.V || 0, onGround: false, dt: 1 / 60 }, AT_C172);
    for (let k = 0; k < 4; k++) f.step(1 / 240, ground, wind);
    if (t < 3) p1 = attitude(f.quat).pitch * D;
  }
  return { p1, end: attitude(f.quat).pitch * D };
}
const off = pullAndRelease(false), on = pullAndRelease(true);
console.log(`      no auto-trim: ${off.p1.toFixed(1)} -> ${off.end.toFixed(1)} deg; auto-trim: ${on.p1.toFixed(1)} -> ${on.end.toFixed(1)} deg`);
check('Skyhawk auto-trim keeps the attitude the pilot left (no drift back nose-down after a pull)', () => {
  assert.ok(Math.abs(on.end - on.p1) < Math.abs(off.end - off.p1), `drift ${(on.end - on.p1).toFixed(1)} vs ${(off.end - off.p1).toFixed(1)} without`);
  assert.ok(Math.abs(on.end - on.p1) < 4, `drift ${(on.end - on.p1).toFixed(1)} deg`);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('c172 auto-trim OK');
