// Climb and take-off aids on the real flight model: FLCH climb/descent with ALT capture, the automatic take-off, the hand-flown rotation assist
// (part-stick pulls used to leave the jet on the runway) and auto-trim. Offline.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { Autopilot, attitude } from '../src/autopilot.js';
import { TakeoffAid, RotationAssist } from '../src/autotakeoff.js';
import { stickGearing } from '../src/handling.js';
import { makeAutoTrim, autoTrimStep } from '../src/autotrim.js';

const flat = () => 0, calm = new THREE.Vector3(), R = 180 / Math.PI;
const t = (n, f) => { f(); console.log('PASS ', n); };
const shape = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4);

function flch(alt0, spd0, altT, thr0, secs) {
  const dt = 1 / 60, f = new FlightModel(); f.reset(new THREE.Vector3(0, alt0, 0), 90, spd0, false, 0); f.setEngines(thr0, thr0 > 0.9);
  const ap = new Autopilot(); ap.engage({ ctrl: f.ctrl, throttle: f.throttle });
  Object.keys(ap.modes).forEach((k) => (ap.modes[k] = false)); Object.assign(ap.modes, { flch: true, hdg: true }); Object.assign(ap.target, { alt: altT, hdg: 90, vsLimit: 30 });
  let captured = null, maxA = 0;
  for (let s = 0; s < secs; s += dt) {
    f.step(dt, flat, calm);
    const c = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? f.out.V, nav: { agl: f.pos.y } });
    f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; if (ap.modes.spd || ap.modes.mach || c.thrOverride) f.throttle = c.th; f.setEngines(f.throttle, f.throttle > 0.9);
    maxA = Math.max(maxA, f.out.alpha * R); if (captured === null && !ap.modes.flch) captured = s;
  }
  return { f, ap, captured, maxA };
}
t('FLCH climbs 5000 m, captures the altitude within 30 m and never nears the stall', () => {
  const r = flch(1000, 140, 6000, 1, 260);
  assert.ok(r.captured !== null && r.captured < 200, `captured at ${r.captured}`);
  assert.ok(Math.abs(r.f.pos.y - 6000) < 30, `h ${r.f.pos.y}`);
  assert.ok(r.maxA < 12, `max alpha ${r.maxA}`);
  assert.ok(!r.f.crashed);
});
t('FLCH climbs through the transonic range to 12 000 m', () => {
  const r = flch(3000, 200, 12000, 1, 300);
  assert.ok(Math.abs(r.f.pos.y - 12000) < 40, `h ${r.f.pos.y}`);
});
t('FLCH descends with idle thrust and captures', () => {
  const r = flch(9000, 230, 3000, 0.3, 420);
  assert.ok(Math.abs(r.f.pos.y - 3000) < 60, `h ${r.f.pos.y}`);
  assert.ok(r.f.out.alpha * R < 12);
});

t('automatic take-off: lifts off near 110 m/s, holds the heading, raises the gear and hands over', () => {
  const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true);
  const to = new TakeoffAid(); to.start(90);
  let lift = null, done = false, hdgErr = 0;
  for (let s = 0; s < 90 && !done; s += dt) {
    const ias = f.out.ias ?? 0, c = to.update(dt, { fdm: f, ias, agl: f.pos.y - 2.42 });
    f.ctrl.de = c.de; f.ctrl.dr = c.dr; f.ctrl.da = 0; f.setEngines(1, true); if (c.gearUp) f.gearDown = false;
    f.step(dt, flat, calm);
    if (lift === null && s > 3 && !f.onGround) lift = ias;
    hdgErr = Math.max(hdgErr, Math.abs(((attitude(f.quat).heading - 90 + 540) % 360) - 180)); done = c.done;
  }
  assert.ok(done, 'never handed over'); assert.ok(lift > 95 && lift < 125, `lift-off at ${lift}`);
  assert.ok(hdgErr < 2, `heading error ${hdgErr}`); assert.ok(!f.crashed); assert.ok(!f.gearDown, 'gear still down');
});

t('hand-flown rotation: every stick position from 20 % to 100 % lifts off without a strike; the stock gearing alone does not', () => {
  const run = (axis, enabled) => {
    const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true); const ra = new RotationAssist();
    let lift = null, maxP = 0;
    for (let s = 0; s < 60 && lift === null && !f.crashed; s += dt) {
      const ias = f.out.ias ?? 0, a = ias > 92 ? axis : 0;
      f.ctrl.de = ra.apply({ fdm: f, axis: a, de: stickGearing(shape(a), f.out.qbar || 0, f.out.M || 0), ias, agl: f.pos.y - 2.42, enabled, dt });
      f.step(dt, flat, calm); maxP = Math.max(maxP, attitude(f.quat).pitch * R);
      if (s > 3 && !f.onGround) lift = ias;
    }
    return { lift, maxP, crashed: f.crashed };
  };
  for (const axis of [0.2, 0.4, 0.7, 1]) { const r = run(axis, true); assert.ok(r.lift && r.lift < 135 && r.maxP < 13 && !r.crashed, `axis ${axis}: ${JSON.stringify(r)}`); }
  assert.equal(run(0.4, false).lift, null, 'stock gearing at 40 % stick used to leave the jet on the runway');
});

t('auto-trim holds the attitude through a speed change better than a fixed trim', () => {
  const drift = (auto) => {
    const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 3000, 0), 90, 200, false, 0); f.setEngines(1, true); const at = makeAutoTrim();
    const p0 = attitude(f.quat).pitch * R; let worst = 0;
    for (let s = 0; s < 40; s += dt) { f.trim = autoTrimStep(at, { enabled: auto, trim: f.trim, q: f.w.z, power: f.out.pitchPower, alpha: f.out.alpha, stick: 0, V: f.out.V, onGround: false, dt }); f.step(dt, flat, calm); worst = Math.max(worst, Math.abs(attitude(f.quat).pitch * R - p0)); }
    return worst;
  };
  const fixed = drift(false), auto = drift(true);
  assert.ok(auto < fixed * 0.7, `fixed ${fixed.toFixed(1)} deg, auto ${auto.toFixed(1)} deg`);
});
t('auto-trim never trims nose-up into the stall region', () => {
  const s = makeAutoTrim(); s.idle = 5;
  assert.ok(autoTrimStep(s, { enabled: true, trim: 0.2, q: -0.1, power: 1, alpha: 0.2, stick: 0, V: 100, onGround: false, dt: 0.1 }) <= 0.2);
  assert.ok(autoTrimStep(s, { enabled: true, trim: 0.2, q: 0, power: 1, alpha: 0.28, stick: 0, V: 100, onGround: false, dt: 0.1 }) < 0.2);
  assert.equal(autoTrimStep(s, { enabled: true, trim: 0.2, q: -0.1, power: 1, alpha: 0.05, stick: 0.5, V: 100, onGround: false, dt: 0.1 }), 0.2);
});


t('go-around from 80 m on final: climbs 600 m, gear comes up, never near the stall or the ground', () => {
  const dt = 1 / 60, f = new FlightModel(); f.reset(new THREE.Vector3(0, 80, 0), 90, 92, false, -3); f.setEngines(0.35, false); f.gearDown = true;
  const ap = new Autopilot(); ap.startGoAround({ ctrl: f.ctrl, throttle: f.throttle }, attitude(f.quat), f.pos.y, f.out.ias ?? 92);
  let minY = 1e9, maxA = 0, gearUpAt = null; const y0 = f.pos.y;
  for (let s = 0; s < 150; s += dt) {
    f.step(dt, flat, calm);
    const c = ap.update(dt, { fdm: f, out: f.out, att: attitude(f.quat), vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? f.out.V, nav: { agl: f.pos.y } });
    f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; f.throttle = c.th; f.setEngines(f.throttle, f.throttle > 0.9);
    if (ap.ga && f.gearDown && f.pos.y > 25 && f.vel.y > 2) { f.gearDown = false; gearUpAt = s; }
    minY = Math.min(minY, f.pos.y); maxA = Math.max(maxA, f.out.alpha * R);
  }
  assert.ok(minY > 60, `sank to ${minY.toFixed(0)} m`); assert.ok(maxA < 15, `alpha ${maxA.toFixed(1)}`); assert.ok(gearUpAt !== null && gearUpAt < 20, `gear up at ${gearUpAt}`);
  assert.ok(Math.abs(f.pos.y - (y0 + 600)) < 40, `final ${f.pos.y.toFixed(0)}`); assert.ok(!f.crashed);
});

t('stick gearing on the runway: a full pull lifts off sooner the faster the jet is rolling (it used to get weaker and never lift off)', () => {
  const liftTime = (pullKt) => {
    const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true); let t0 = null;
    for (let s = 0; s < 120 && !f.crashed; s += dt) {
      const ias = f.out.ias ?? 0, pull = ias * 1.94384 >= pullKt; if (pull && t0 === null) t0 = s;
      f.ctrl.de = stickGearing(pull ? 1 : 0, f.out.qbar || 0, f.out.M || 0, f.onGround ? 1 : Math.max(0, Math.min(1, (40 - (f.pos.y - 2.42)) / 25)));
      f.step(dt, flat, calm); if (t0 !== null && s > 3 && !f.onGround) return s - t0;
    }
    return Infinity;
  };
  const times = [175, 204, 243, 292, 350, 428].map(liftTime);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] <= times[i - 1] + 0.05, `lift-off times ${times.map((x) => x.toFixed(1)).join(' ')}`);
  assert.ok(times[times.length - 1] < 2, `at 428 kt ${times[5]}`);
  assert.equal(stickGearing(1, 29000, 0.9, 0) < stickGearing(1, 29000, 0.9, 1), true);
});
console.log('all climb tests passed');
