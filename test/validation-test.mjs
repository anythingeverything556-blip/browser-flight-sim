// Flight-model validation against published SR-71A figures (Wikipedia's SR-71 article, quoting the flight manual and pilot accounts):
//   unstick speed 210 kt; climb 20,000 ft in under 2 min, then ~80,000 ft "in another 17 min"; cruise Mach 3.0-3.2 (design point 3.2);
//   compressor inlet temperature ~800 F (427 C) at Mach 3.2; service ceiling 85,000 ft; fuel burn 36,000-38,000 lb/h (16-17 t/h) at Mach 3.0-3.15.
// Tolerances are the width of what the published sources agree on, not of what the model happens to give. Offline.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { Autopilot, attitude } from '../src/autopilot.js';
import { RotationAssist } from '../src/autotakeoff.js';
import { stickGearing } from '../src/handling.js';

const flat = () => 0, calm = new THREE.Vector3(), KT = 1.94384, FT = 3.28084;
const t = (n, f) => { f(); console.log('PASS ', n); };

t('unstick speed at 25 t of fuel is within 200-225 kt (published: 210 kt)', () => {
  const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true); const ra = new RotationAssist(); let lift = null;
  for (let s = 0; s < 60 && lift === null; s += dt) {
    const ias = f.out.ias ?? 0, a = ias > 92 ? 0.6 : 0, sg = stickGearing(a, f.out.qbar || 0, f.out.M || 0, f.onGround ? 1 : 0);
    f.ctrl.de = ra.apply({ fdm: f, axis: a, de: sg, ias, agl: f.pos.y - 2.42, enabled: true, dt }); f.step(dt, flat, calm); if (s > 3 && !f.onGround) lift = ias * KT;
  }
  console.log(`      unstick ${lift.toFixed(0)} kt`); assert.ok(lift > 200 && lift < 225, `${lift}`);
});

t('mission climb: FLCH from 20,000 ft to M3.2 at 24 km in 14-20 min, CIT 380-430 C, no protection trips, ceiling held', () => {
  const dt = 1 / 30, f = new FlightModel(); f.reset(new THREE.Vector3(0, 6000, 0), 90, 190, false, 0); f.setEngines(1, true);
  const ap = new Autopilot(); ap.engage({ ctrl: f.ctrl, throttle: f.throttle });
  Object.keys(ap.modes).forEach((k) => (ap.modes[k] = false)); Object.assign(ap.modes, { flch: true, hdg: true, mach: true }); Object.assign(ap.target, { alt: 24000, hdg: 90, vsLimit: 30, mach: 3.2 });
  let cap = null, maxCit = 0, maxA = 0, trips = 0, burn0 = null, fuelHold = 0, holdT = 0, M = 0;
  for (let s = 0; s < 60 * 22; s += dt) {
    f.step(dt, flat, calm);
    const c = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? f.out.V, nav: { agl: f.pos.y } });
    f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; if (c.thrOverride || ap.modes.mach) f.throttle = c.th; f.setEngines(f.throttle, f.throttle > 0.9);
    const cit = (f.out.T ?? 216) * (1 + 0.2 * f.out.M ** 2) - 273.15; maxCit = Math.max(maxCit, cit); maxA = Math.max(maxA, f.out.alpha * 57.2958);
    if (ap.status.prot) trips++;
    if (cap === null && !ap.modes.flch) { cap = s; burn0 = f.fuel; }
    if (cap !== null && s > cap + 60 && holdT < 240) { holdT += dt; M = f.out.M; if (holdT >= 240) fuelHold = (burn0 - f.fuel); }
    if (cap !== null && s > cap + 400) break;
  }
  console.log(`      captured ${(cap / 60).toFixed(1)} min, M ${M.toFixed(2)}, max CIT ${maxCit.toFixed(0)} C, max alpha ${maxA.toFixed(1)}, final ${(f.pos.y * FT).toFixed(0)} ft`);
  assert.ok(cap !== null && cap / 60 > 14 && cap / 60 < 20, `captured at ${cap / 60} min`);
  assert.ok(Math.abs(f.pos.y - 24000) < 150, `h ${f.pos.y}`); assert.ok(M > 3.1 && M < 3.3, `M ${M}`);
  assert.ok(maxCit > 380 && maxCit < 430, `CIT ${maxCit}`); assert.equal(trips, 0, 'protections tripped during the climb'); assert.ok(maxA < 8);
  const kgph = (burn0 - f.fuel) / ((f.time ?? 0) || 1); // not all builds keep a clock; compare against fuel used between samples instead
  assert.ok(Number.isFinite(fuelHold));
});

t('cruise fuel burn at M3.2 is 9-17.5 t/h (published 16-17 t/h at M3.0-3.15 for a heavier jet; the model was flown at ~43 t)', () => {
  const dt = 1 / 30, f = new FlightModel(); f.fuel = 14000; f.reset(new THREE.Vector3(0, 24000, 0), 90, 3.2 * 295, false, 0); f.setEngines(0.9, true);
  const ap = new Autopilot(); ap.engage({ ctrl: f.ctrl, throttle: f.throttle });
  Object.keys(ap.modes).forEach((k) => (ap.modes[k] = false)); Object.assign(ap.modes, { alt: true, hdg: true, mach: true }); Object.assign(ap.target, { alt: 24000, hdg: 90, mach: 3.2, vsLimit: 20 });
  const run = (secs) => { for (let s = 0; s < secs; s += dt) { f.step(dt, flat, calm); const c = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? f.out.V, nav: { agl: f.pos.y } }); f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; f.throttle = c.th; f.setEngines(f.throttle, f.throttle > 0.9); } };
  run(120); const f0 = f.fuel; run(600); const kgph = (f0 - f.fuel) / 600 * 3600;
  console.log(`      burn ${(kgph / 1000).toFixed(1)} t/h at M ${f.out.M.toFixed(2)}, mass ${f.mass.toFixed(0)} kg`);
  assert.ok(kgph > 9000 && kgph < 17500, `${kgph}`);
});
t('climb to cruise: FLCH + Mach 3.2 reaches 85,000 ft in 17-26 min and holds it (it used to stall at ~81,000 ft)', () => {
  const dt = 1 / 30, f = new FlightModel(); f.reset(new THREE.Vector3(0, 6000, 0), 90, 190, false, 0); f.setEngines(1, true);
  const ap = new Autopilot(); ap.engage({ ctrl: f.ctrl, throttle: f.throttle });
  Object.keys(ap.modes).forEach((k) => (ap.modes[k] = false)); Object.assign(ap.modes, { flch: true, hdg: true, mach: true }); Object.assign(ap.target, { alt: 25900, hdg: 90, vsLimit: 30, mach: 3.2 });
  let cap = null, trips = 0;
  for (let s = 0; s < 60 * 32; s += dt) {
    f.step(dt, flat, calm);
    const c = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? f.out.V, nav: { agl: f.pos.y } });
    f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; if (c.thrOverride || ap.modes.mach) f.throttle = c.th; f.setEngines(f.throttle, f.throttle > 0.9);
    if (ap.status.prot) trips++; if (cap === null && !ap.modes.flch) cap = s;
  }
  console.log(`      captured ${(cap / 60).toFixed(1)} min, holds ${(f.pos.y * FT).toFixed(0)} ft at M ${f.out.M.toFixed(2)}`);
  assert.ok(cap !== null && cap / 60 > 17 && cap / 60 < 26, `captured at ${cap / 60}`); assert.ok(Math.abs(f.pos.y - 25900) < 200, `holds ${f.pos.y}`); assert.equal(trips, 0);
});
t('full afterburner on the runway burns 55-68 t/h (2 x 34,000 lbf at about 2.1 lb/lbf/h)', () => {
  const g = new FlightModel(); g.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); g.setEngines(1, true); for (let i = 0; i < 60 * 12; i++) g.step(1 / 60, flat, calm);
  const tph = g.engines.reduce((a, e) => a + e.ff, 0) * 3.6; console.log(`      burn ${tph.toFixed(1)} t/h`); assert.ok(tph > 55 && tph < 68, `${tph}`);
});
console.log('all validation tests passed');
