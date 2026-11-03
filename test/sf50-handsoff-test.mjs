// Vision Jet SF50 with nobody on the roll / yaw axes: the flight model alone, and with the shared hands-off assist (src/handsoff.js, written for the
// Skyhawk) flying the let-go axes; take-off roll and lift-off in the game's default weather. Flat ground at 0 m.
import * as THREE from 'three';
import { SF50Model, SF50, SF50_CG } from '../src/sf50.js';
import { c172HandsOffCommand } from '../src/handsoff.js';
import { Turbulence, windSpeedAt } from '../src/turbulence.js';

let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const KT = 1.943844, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3(), cl = (v, a, b) => Math.max(a, Math.min(b, v));
const att = (f) => { const fw = new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat), right = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat);
  return { bank: Math.asin(cl(-right.y, -1, 1)) * 180 / Math.PI, hdg: Math.atan2(fw.z, fw.x) * 180 / Math.PI, pitch: Math.asin(fw.y) * 180 / Math.PI }; };
const wrap = (d) => ((d + 540) % 360) - 180;
const fresh = (alt, ktas, onGround) => { const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(0, onGround ? SF50_CG.y : alt, 0), 90, ktas / KT, onGround); return f; };
// the pilot holds pitch with the elevator (the assist only has the roll and yaw axes)
const elev = (f, target) => { const k = cl(1800 / Math.max(f.out.qbar || 1800, 300), 0.25, 1.5); f.ctrl.de = cl(k * 3 * (target * Math.PI / 180 - Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y)) - 0.8 * k * f.w.z, -1, 1); };
const run = (f, secs, assist, pitchHold, step = dt) => {
  const h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg; let maxBank = 0;
  for (let t = 0; t < secs; t += step) {
    f.ctrl.da = 0; f.ctrl.dr = 0; if (pitchHold !== null) elev(f, pitchHold(f)); else f.ctrl.de = 0;
    if (assist) { const c = c172HandsOffCommand(f, ax, h, step); if (c.da !== null) f.ctrl.da = c.da; if (c.dr !== null) f.ctrl.dr = c.dr; }
    f.step(step, ground, wind); if (f.crashed) break; maxBank = Math.max(maxBank, Math.abs(att(f).bank));
  }
  return { f, maxBank, dh: wrap(att(f).hdg - h0), kias: (f.out.ias || 0) * KT };
};
for (const [name, mk] of [['cruise FL100, 220 KTAS', () => fresh(3048, 220, false)], ['approach, flaps 100 %, gear down', () => fresh(600, 95, false)]]) {
  const f0 = mk(), p0 = att(f0).pitch;
  const a = run(f0, 60, false, null); check(`no assist: ${name} hands off flies straight`, !a.f.crashed && a.maxBank < 3 && Math.abs(a.dh) < 3, `max bank ${a.maxBank.toFixed(2)} deg, heading ${a.dh.toFixed(2)} deg in 60 s`);
  const f1 = mk(); f1.ctrl.da = 0; const b = run(f1, 60, true, null); check(`assist: ${name} holds the wings level and the heading`, !b.f.crashed && b.maxBank < 3 && Math.abs(b.dh) < 3, `max bank ${b.maxBank.toFixed(2)} deg, heading ${b.dh.toFixed(2)} deg in 60 s, ${b.kias.toFixed(0)} KIAS`);
}
{ const f = fresh(0, 0, true); f.setFlaps(1); f.parkingBrake = true; for (let t = 0; t < 8; t += dt) { f.throttle = 1; f.step(dt, ground, wind); } f.parkingBrake = false;
  const h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg; let lifted = null, maxDev = 0;
  for (let t = 0; t < 45; t += dt) {
    const rot = (f.out.ias || 0) * KT > SF50.VR; f.throttle = 1; f.ctrl.da = 0; f.ctrl.dr = 0; if (rot) elev(f, 10); else f.ctrl.de = 0;
    const c = c172HandsOffCommand(f, ax, h, dt); if (c.da !== null) f.ctrl.da = c.da; if (c.dr !== null) f.ctrl.dr = c.dr;
    f.step(dt, ground, wind); if (f.crashed) break; if (lifted === null && !f.onGround) lifted = t; maxDev = Math.max(maxDev, Math.abs(wrap(att(f).hdg - h0)));
  }
  check('assist: full-thrust take-off roll and climb keep the runway heading', !f.crashed && lifted !== null && maxDev < 1.5, `lift-off at ${lifted && lifted.toFixed(1)} s, heading held within ${maxDev.toFixed(2)} deg, ${(f.pos.y - SF50_CG.y).toFixed(0)} m up`);
}
{ // default weather (8 kt crosswind, light turbulence) at 60 Hz, take-off and the first 90 s of the climb at 10 deg pitch
  let seed = 7; const rnd = Math.random; Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = fresh(0, 0, true); f.setFlaps(1); f.parkingBrake = true; for (let t = 0; t < 8; t += dt) { f.throttle = 1; f.step(dt, ground, wind); } f.parkingBrake = false;
  const tb = new Turbulence(), h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg, step = 1 / 60; let maxBank = 0, lo = 0, hi = 0, lifted = null;
  for (let t = 0; t < 120; t += step) {
    const agl = f.pos.y - SF50_CG.y, to = (320 + 180) * Math.PI / 180, v = windSpeedAt(8 / KT, Math.max(agl, 0), f.pos.y), g = tb.update(step, f.out.V || 30, Math.max(agl, 0), 0.1, f.vel);
    const rot = (f.out.ias || 0) * KT > SF50.VR; f.throttle = 1; f.ctrl.da = 0; f.ctrl.dr = 0; if (rot) elev(f, 10); else f.ctrl.de = 0;
    const c = c172HandsOffCommand(f, ax, h, step); if (c.da !== null) f.ctrl.da = c.da; if (c.dr !== null) f.ctrl.dr = c.dr;
    f.step(step, ground, new THREE.Vector3(Math.sin(to) * v + g.x, g.y, -Math.cos(to) * v + g.z)); if (f.crashed) break;
    if (lifted === null && !f.onGround) lifted = t;
    if (lifted !== null && t > lifted + 20) { const a = att(f), d = wrap(a.hdg - h0); lo = Math.min(lo, d); hi = Math.max(hi, d); maxBank = Math.max(maxBank, Math.abs(a.bank)); }
  }
  Math.random = rnd;
  check('assist, default weather: take-off and climb keep the runway heading', !f.crashed && lifted !== null && lo > -6 && hi < 6 && maxBank < 7, `lift-off at ${lifted && lifted.toFixed(0)} s; heading ${lo.toFixed(1)}..${hi.toFixed(1)} deg from 20 s after it, max bank ${maxBank.toFixed(1)} deg, ${(f.pos.y - SF50_CG.y).toFixed(0)} m up`);
}
{ // a slow roll on the ground at a little thrust: the nose wheel holds the heading by groundspeed
  const f = fresh(0, 0, true); f.throttle = 0.3; f.parkingBrake = false; const h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg;
  for (let t = 0; t < 60; t += dt) { f.ctrl.da = 0; f.ctrl.dr = 0; const c = c172HandsOffCommand(f, ax, h, dt); if (c.dr !== null) f.ctrl.dr = c.dr; f.step(dt, ground, wind); }
  check('assist: a slow roll on the ground holds the heading', !f.crashed && Math.abs(wrap(att(f).hdg - h0)) < 1, `heading ${wrap(att(f).hdg - h0).toFixed(2)} deg in 60 s at ${(Math.hypot(f.vel.x, f.vel.z) * KT).toFixed(1)} kt`);
}
{ // the pilot's input wins: a held roll key banks the jet; let go, the wings come level
  const f = fresh(3000, 200, false), h = {}, ax = { pitch: 0, roll: 0.5, yaw: 0 };
  for (let t = 0; t < 3; t += dt) { elev(f, att(f).pitch); const c = c172HandsOffCommand(f, ax, h, dt); f.ctrl.da = c.da === null ? 0.5 : c.da; f.ctrl.dr = c.dr ?? 0; f.step(dt, ground, wind); }
  const banked = att(f).bank; ax.roll = 0;
  for (let t = 0; t < 20; t += dt) { elev(f, att(f).pitch * 0.5); const c = c172HandsOffCommand(f, ax, h, dt); f.ctrl.da = c.da ?? 0; f.ctrl.dr = c.dr ?? 0; f.step(dt, ground, wind); }
  check('a held roll key banks the jet; let go, the wings come level', !f.crashed && Math.abs(banked) > 10 && Math.abs(att(f).bank) < 3, `bank ${banked.toFixed(1)} deg after 3 s of half roll, ${att(f).bank.toFixed(1)} deg 20 s after letting go`);
}
if (fails) { console.log(`${fails} hands-off checks failed`); process.exit(1); }
console.log('sf50-handsoff-test ok');
