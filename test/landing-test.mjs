// The landing aid on the real flight model: a steady 3 degree approach flown "hands off", with and without the aid.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { Autopilot, attitude, flareSink, AID_AGL } from '../src/autopilot.js';
const KT = 1.943844;

function land({ aid, kt = 185, gamma = -3, fuel = 12000 }) {
  const f = new FlightModel(); f.fuel = fuel; const ap = new Autopilot(), wind = new THREE.Vector3(), flat = () => 0, dt = 1 / 120;
  f.reset(new THREE.Vector3(0, 2.42 + 140, 0), 90, kt / KT, false, gamma); f.gearDown = true; f.gearPos = 1;
  let engaged = false, touch = null;
  for (let t = 0; t < 80; t += dt) {
    const agl = f.pos.y - 2.42;
    if (agl < 14) f.throttle = Math.max(0, f.throttle - 0.5 * dt);
    if (aid && agl < AID_AGL && agl > 0 && f.vel.y < -0.2) {
      if (!engaged) { ap.engage({ ctrl: f.ctrl, throttle: f.throttle }); Object.keys(ap.modes).forEach((k) => { ap.modes[k] = false; }); ap.modes.vs = true; ap.target.vsLimit = 20; ap.tauV = 1.6; ap.kiDiv = 8; engaged = true; }
      ap.target.vs = flareSink(agl);
      f.ctrl.de = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? 0, nav: {} }).de;
    }
    f.step(dt, flat, wind);
    if (f.crashed) return { crashed: f.crashed };
    if (f.onGround && !touch) touch = { vs: -f.vel.y, t };
    if (touch && t - touch.t > 10) break;
  }
  return { touch };
}
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };
const base = land({}), aided = land({ aid: true });
ok('without the aid a hands-off 3 degree approach touches down hard', base.crashed || base.touch.vs > 3.5, base.crashed || `${base.touch.vs.toFixed(2)} m/s`);
for (const [label, o] of [['185 kt', {}], ['165 kt', { kt: 165 }], ['200 kt', { kt: 200 }], ['4.5 degree glide', { gamma: -4.5 }], ['light, 170 kt', { fuel: 4000, kt: 170 }]]) {
  const r = land({ aid: true, ...o });
  ok(`landing aid ${label}: soft touchdown, no crash`, !r.crashed && r.touch && r.touch.vs < 3.0, r.crashed || `${r.touch.vs.toFixed(2)} m/s (limit for a hard landing is 5.5)`);
}
ok('the flare profile never asks for less than 0.6 m/s and is capped by height', flareSink(0) === -0.6 && Math.abs(flareSink(40) + 4.4) < 1e-9);
console.log('all landing tests passed');
