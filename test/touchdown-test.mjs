// "Touchdown" is reported once per landing (src/touchdown.js), not for every wheel contact: the flight models over slightly uneven ground
// emitted 10-16 main-wheel 'touch' events on one take-off roll, each of which became a "Touchdown ... fpm" message.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TouchdownReporter, AIR_MIN } from '../src/touchdown.js';
import { SF50Model, SF50_CG, SF50 } from '../src/sf50.js';
import { C172Model, C172_CG } from '../src/c172.js';

const dt = 1 / 120, frame = 1 / 60, wind = new THREE.Vector3(), KT = 1.943844;
// ground with the few-centimetre kinks of bilinear elevation tiles
const bumpy = (x, z) => 0.06 * Math.sin(x / 9.0) + 0.04 * Math.sin(z / 7.0 + x / 31) + 0.03 * Math.sign(Math.sin(x / 15));
const pitchOf = (f) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y);
const bankOf = (f) => Math.asin(Math.max(-1, Math.min(1, -new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).y)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kq = (f) => clamp(1800 / Math.max((f.out && f.out.qbar) || 1800, 300), 0.25, 1.5); // elevator authority grows with dynamic pressure
let fails = 0;
const check = (name, fn) => { try { console.log('PASS ', name, fn() || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

// fly like simulate(): two physics steps per 60 Hz frame, then the frame's events go to the reporter
function fly(f, secs, ctl) {
  const rep = new TouchdownReporter(), reports = []; let raw = 0;
  for (let t = 0; t < secs; t += frame) {
    ctl(f, t);
    for (let k = 0; k < 2; k++) f.step(dt, bumpy, wind);
    raw += f.events.filter((e) => e && e.type === 'touch' && e.wheel > 0 && e.vs > 0.3).length;
    const s = rep.frame(f.events, frame, f.onGround); if (s !== null) reports.push({ t: +t.toFixed(1), fpm: Math.round(s * 196.85) });
    f.events.length = 0;
    if (f.crashed) throw new Error(`crashed: ${f.crashed}`);
  }
  return { raw, reports };
}
const thrust = (f, v) => (f.setEngines ? f.setEngines(v) : (f.throttle = v));
const MODELS = {
  'Vision Jet': { mk: () => new SF50Model(), cg: SF50_CG, vapp: 95, vtaxi: 30 },
  Skyhawk: { mk: () => new C172Model(), cg: C172_CG, vapp: 62, vtaxi: 30 },
};
for (const [name, M] of Object.entries(MODELS)) {
  check(`${name}: a fast taxi and a full-power take-off roll over uneven ground report no touchdown`, () => {
    const a = M.mk(); a.reset(new THREE.Vector3(0, M.cg.y, 0), 90, 0, true);
    const taxi = fly(a, 45, (f) => { f.parkingBrake = false; f.brakes = 0; thrust(f, f.vel.length() * KT > M.vtaxi ? 0.05 : 0.5); });
    const b = M.mk(); b.reset(new THREE.Vector3(0, M.cg.y, 0), 90, 0, true);
    const roll = fly(b, 18, (f) => { f.parkingBrake = false; f.brakes = 0; thrust(f, 1); if (!f.onGround) f.ctrl.de = 0; });
    assert.ok(taxi.raw + roll.raw > 0, 'the ground was not uneven enough to test anything');
    assert.equal(taxi.reports.length + roll.reports.length, 0, JSON.stringify([...taxi.reports, ...roll.reports]));
    return `${taxi.raw + roll.raw} wheel contacts, 0 messages (was ${taxi.raw + roll.raw})`;
  });
}
// a Vision Jet landing on the uneven runway, flown by the approach-and-flare pilot of sf50-fdm-test (section 10) from 60 m on a 3 degree glidepath
check('Vision Jet: one landing (bounces and both main wheels) on an uneven runway is reported once', () => {
  const gam = 3, h0 = 60, x0 = -h0 / Math.tan(gam * Math.PI / 180), wheelsY = SF50_CG.y - 0.08, VREF = 89, KIAS = (f) => (f.out.ias ?? f.out.V) * KT;
  const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(x0, h0 + wheelsY, 0), 90, VREF / KT, false, -gam);
  let thr = f.throttle, pT = pitchOf(f); const pApp = pT; let iT = 0, fI = 0, down = false;
  const level = (g) => { g.ctrl.da = clamp(-2 * bankOf(g) - 0.5 * g.w.x, -1, 1); g.ctrl.dr = clamp(3 * (g.out.beta || 0) + 0.3 * g.w.y, -1, 1); };
  const r = fly(f, 40, (g) => {
    const h = g.pos.y - wheelsY, k = kq(g);
    if (g.onGround) down = true;
    if (!down) {
      const hid = -g.pos.x * Math.tan(gam * Math.PI / 180);
      const vsT = h > 10 ? -g.out.V * Math.sin(gam * Math.PI / 180) - clamp((h - hid) * 0.03, -1.5, 1.5) : -(0.45 + 0.17 * h);
      if (h > 10) iT = clamp(iT + (vsT - g.vel.y) * 0.0015 * frame, -0.1, 0.1);
      pT = clamp(pApp + iT + 0.03 * (vsT - g.vel.y), -0.12, 0.2);
      if (h < 10) pT = Math.max(pT, 0.045 * (1 - h / 10));
      thr = h < 6 ? 0 : clamp(thr - (KIAS(g) - VREF) * 0.004 * frame, 0, 1); g.throttle = thr;
      if (h < 10) fI = clamp(fI + 2.5 * (pT - pitchOf(g)) * frame, 0, 0.6);
      g.ctrl.de = clamp(fI + k * (h < 10 ? 10 : 4) * (pT - pitchOf(g)) - (h < 10 ? 2.5 : 1.0) * k * g.w.z, -1, 1); level(g);
    } else { g.throttle = 0; g.brakes = 1; g.ctrl.de = clamp(-0.1 - 2 * (pitchOf(g) + 0.01) - 0.5 * g.w.z, -1, 1); level(g); }
  });
  assert.ok(down, 'never landed');
  assert.equal(r.reports.length, 1, `reports ${JSON.stringify(r.reports)} from ${r.raw} contacts`);
  assert.ok(r.reports[0].fpm > 50 && r.reports[0].fpm < 600, `${r.reports[0].fpm} fpm`);
  return `${r.raw} main-wheel contacts -> 1 message (${r.reports[0].fpm} fpm at ${r.reports[0].t} s)`;
});
check('reporter: a hop shorter than AIR_MIN is not a landing; a bounce is not a second one; a later landing (nose wheel first) is reported with the mains\' sink', () => {
  const rep = new TouchdownReporter(), touch = [{ type: 'touch', wheel: 1, vs: 1.2 }];
  rep.frame([], 0.5, true);
  for (let t = 0; t < AIR_MIN - 0.3; t += 0.1) rep.frame([], 0.1, false);
  assert.equal(rep.frame(touch, 0.1, true), null, 'short hop reported');
  for (let t = 0; t < 30; t += 0.1) rep.frame([], 0.1, false);
  assert.equal(rep.frame(touch, 0.1, true), 1.2, 'landing not reported');
  for (let t = 0; t < 2; t += 0.1) rep.frame([], 0.1, false);
  assert.equal(rep.frame(touch, 0.1, true), null, 'bounce 2 s later reported');
  for (let t = 0; t < 60; t += 0.1) rep.frame([], 0.1, false);
  assert.equal(rep.frame([{ type: 'touch', wheel: 0, vs: 2 }], 0.1, true), null, 'nose wheel reported as the touchdown');
  assert.equal(rep.frame([{ type: 'touch', wheel: 2, vs: 0.9 }, { type: 'touch', wheel: 1, vs: 1.4 }], 0.1, true), 1.4, 'second landing (nose first, mains a frame later) missing or not the worst sink');
});
if (fails) { console.log(`touchdown-test: ${fails} failed`); process.exit(1); }
console.log('touchdown-test ok');
