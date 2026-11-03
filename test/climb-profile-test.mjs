import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { attitude } from '../src/autopilot.js';
import { TakeoffAid } from '../src/autotakeoff.js';
import { stickGearing } from '../src/handling.js';

const flat = () => 0, calm = new THREE.Vector3(), R = 180 / Math.PI, KT = 1 / 0.5144, FT = 3.28084;
const shape = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4);

function realProfile(climbPitch) {
  const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true);
  const to = new TakeoffAid(); to.start(90);
  let phase = 'takeoff', t = 0, t20 = null, eas20 = 0, maxAlpha = 0, crashed = false;
  for (; t < 300; t += dt) {
    const eas = f.out.ias ?? 0, att = attitude(f.quat);
    if (phase === 'takeoff') {
      const c = to.update(dt, { fdm: f, ias: eas, agl: f.pos.y - 2.42 }); f.ctrl.de = c.de; f.ctrl.dr = c.dr; f.ctrl.da = 0; f.setEngines(1, true); if (c.gearUp) f.gearDown = false;
      if (c.done) phase = 'accelerate';
    } else {
      if (phase === 'accelerate' && eas * KT >= 400) phase = 'climb';
      const want = phase === 'accelerate' ? 6 : climbPitch, err = want - att.pitch * R;
      const axis = Math.max(-1, Math.min(1, err * 0.12 + f.w.z * R * 0.05));
      f.ctrl.de = stickGearing(shape(axis), f.out.qbar || 0, f.out.M || 0); f.ctrl.da = 0; f.ctrl.dr = 0; f.setEngines(1, true);
      if (phase === 'climb') maxAlpha = Math.max(maxAlpha, f.out.alpha * R);
    }
    f.step(dt, flat, calm);
    if (f.crashed) { crashed = true; break; }
    if (t20 === null && f.pos.y * FT >= 20000) { t20 = t; eas20 = eas * KT; break; }
  }
  return { t20, eas20, maxAlpha, crashed };
}

const t = (n, f) => { f(); console.log('PASS ', n); };

t('the real profile (auto take-off, low to 400 kt, then pitch up) reaches 20,000 ft inside 2.5 minutes of brake release without nearing the stall', () => {
  const r = realProfile(18);
  assert.ok(!r.crashed);
  assert.ok(r.t20 !== null && r.t20 < 150, `20,000 ft at ${r.t20}`);
  assert.ok(r.eas20 > 300, `${r.eas20} KEAS at 20,000 ft`);
  assert.ok(r.maxAlpha < 12, `max alpha ${r.maxAlpha}`);
});
t('a steeper 22 degree climb is also flyable and not slower to 20,000 ft by more than 20 s', () => {
  const a = realProfile(18), b = realProfile(22);
  assert.ok(!b.crashed && b.t20 !== null && b.t20 < a.t20 + 20, `${a.t20} vs ${b.t20}`);
});
console.log('all climb profile tests passed');
