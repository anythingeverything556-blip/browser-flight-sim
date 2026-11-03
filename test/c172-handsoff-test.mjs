// Skyhawk with nobody on the controls: the flight model alone (rigged for cruise), and with the hands-off assist (src/handsoff.js) flying the
// let-go axes. Flat ground at 0 m, no wind.
import * as THREE from 'three';
import { C172Model, C172, C172_CG } from '../src/c172.js';
import { c172HandsOffCommand } from '../src/handsoff.js';
import { Turbulence, windSpeedAt } from '../src/turbulence.js';

let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const KT = 1.943844, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const att = (f) => { const fw = new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat), right = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat);
  return { bank: Math.asin(Math.max(-1, Math.min(1, -right.y))) * 180 / Math.PI, hdg: Math.atan2(fw.z, fw.x) * 180 / Math.PI }; };
const fly = (thr, kt, secs, assist, onGround = false) => {
  const f = new C172Model(); f.fuel = C172.FUEL_MAX; f.reset(new THREE.Vector3(0, onGround ? C172_CG.y : 1000, 0), 90, kt / KT, onGround); f.throttle = thr;
  const h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg; let maxBank = 0;
  for (let t = 0; t < secs; t += dt) {
    f.ctrl.de = 0; f.ctrl.da = 0; f.ctrl.dr = 0;
    if (assist) { const c = c172HandsOffCommand(f, ax, h, dt); if (c.da !== null) f.ctrl.da = c.da; if (c.dr !== null) f.ctrl.dr = c.dr; }
    f.step(dt, ground, wind); if (f.crashed) break; maxBank = Math.max(maxBank, Math.abs(att(f).bank));
  }
  let dh = att(f).hdg - h0; dh = ((dh + 540) % 360) - 180;
  return { f, maxBank, dh, ias: (f.out.V || 0) * KT };
};
{ const r = fly(0.75, 105, 30, false); check('rigged: cruise hands off, no assist, flies nearly straight', !r.f.crashed && r.maxBank < 5 && Math.abs(r.dh) < 10, `max bank ${r.maxBank.toFixed(1)} deg, heading ${r.dh.toFixed(1)} deg in 30 s`); }
{ const r = fly(1, 75, 30, false); check('no assist: climb power rolls and turns left (torque, P-factor), as a real one', r.dh < -10, `heading ${r.dh.toFixed(1)} deg, max bank ${r.maxBank.toFixed(1)} deg in 30 s`); }
for (const [name, thr, kt] of [['cruise', 0.75, 105], ['climb power', 1, 75], ['idle glide', 0, 70]]) {
  const r = fly(thr, kt, 60, true);
  check(`assist: ${name} hands off holds the wings level and the heading`, !r.f.crashed && r.maxBank < 3 && Math.abs(r.dh) < 3, `max bank ${r.maxBank.toFixed(1)} deg, heading ${r.dh.toFixed(1)} deg in 60 s, ${r.ias.toFixed(0)} KIAS`);
}
{ const r = fly(1, 0, 20, false, true); check('no assist: full-power take-off roll swings left', r.dh < -3, `heading ${r.dh.toFixed(1)} deg in 20 s, ${r.ias.toFixed(0)} KIAS`); }
{ const r = fly(1, 0, 20, true, true); check('assist: full-power take-off roll keeps the nose straight', !r.f.crashed && Math.abs(r.dh) < 1, `heading ${r.dh.toFixed(2)} deg in 20 s, ${r.ias.toFixed(0)} KIAS`); }
{ // the pilot's input always wins: a held roll key is not fought, and letting go levels the wings again
  const f = new C172Model(); f.fuel = C172.FUEL_MAX; f.reset(new THREE.Vector3(0, 1000, 0), 90, 105 / KT, false); f.throttle = 0.75;
  const h = {}, ax = { pitch: 0, roll: 0.5, yaw: 0 };
  for (let t = 0; t < 3; t += dt) { const c = c172HandsOffCommand(f, ax, h, dt); f.ctrl.da = c.da === null ? 0.5 : c.da; f.ctrl.dr = c.dr ?? 0; f.step(dt, ground, wind); }
  const banked = att(f).bank; ax.roll = 0;
  for (let t = 0; t < 15; t += dt) { const c = c172HandsOffCommand(f, ax, h, dt); f.ctrl.da = c.da ?? 0; f.ctrl.dr = c.dr ?? 0; f.step(dt, ground, wind); }
  check('a held roll key banks the aircraft; let go, the wings come level', Math.abs(banked) > 15 && Math.abs(att(f).bank) < 2, `bank ${banked.toFixed(1)} deg after 3 s of half roll, ${att(f).bank.toFixed(1)} deg 15 s after letting go`);
}
{ // the game's default weather (8 kt crosswind, light turbulence), 60 Hz steps, pitch flown the way the keys do it (full up elevator tapped
  // on and off to hold 7 deg): the held heading survives lift-off and the climb, with no slow turn either way; right after lift-off the
  // crosswind weathercocks the nose a few degrees, which the hold takes back
  let seed = 7; const rnd = Math.random; Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = new C172Model(); f.fuel = C172.FUEL_MAX; f.reset(new THREE.Vector3(0, C172_CG.y, 0), -108, 0, true); f.throttle = 1;
  const tb = new Turbulence(), h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg, step = 1 / 60; let pull = 0, on = false, maxBank = 0, lo = 0, hi = 0, lifted = null;
  for (let t = 0; t < 150; t += step) {
    const agl = f.pos.y - C172_CG.y, to = (320 + 180) * Math.PI / 180, v = windSpeedAt(8 / KT, Math.max(agl, 0), f.pos.y), g = tb.update(step, f.out.V || 30, Math.max(agl, 0), 0.1, f.vel);
    const pitch = Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y) * 180 / Math.PI;
    on = f.onGround ? (f.out.V || 0) * KT > 55 : pitch < 7;
    pull += ((on ? 1 : 0) - pull) * (1 - Math.exp(-step / 0.14)); f.ctrl.de = Math.pow(pull, 1.4); f.ctrl.da = 0; f.ctrl.dr = 0;
    const c = c172HandsOffCommand(f, ax, h, step); if (c.da !== null) f.ctrl.da = c.da; if (c.dr !== null) f.ctrl.dr = c.dr;
    f.step(step, ground, new THREE.Vector3(Math.sin(to) * v + g.x, g.y, -Math.cos(to) * v + g.z)); if (f.crashed) break;
    if (lifted === null && !f.onGround) lifted = t;
    if (lifted !== null && t > lifted + 30) { const a = att(f); let d = a.hdg - h0; d = ((d + 540) % 360) - 180; lo = Math.min(lo, d); hi = Math.max(hi, d); maxBank = Math.max(maxBank, Math.abs(a.bank)); }
  }
  Math.random = rnd;
  check('assist, default weather, key-tapped pitch: take-off and 2 min climb keep the runway heading', !f.crashed && lifted !== null && lo > -6 && hi < 6 && maxBank < 7,
    `lift-off at ${lifted?.toFixed(0)} s; from 30 s after it (the crosswind weathercocks it on the way): heading ${lo.toFixed(1)}..${hi.toFixed(1)} deg, max bank ${maxBank.toFixed(1)} deg, ${(f.pos.y - C172_CG.y).toFixed(0)} m up`);
}
{ // a slow roll on the ground at a little power (next to no airspeed near the ground): the nose wheel holds the heading by groundspeed
  const f = new C172Model(); f.fuel = C172.FUEL_MAX; f.reset(new THREE.Vector3(0, C172_CG.y, 0), 90, 0, true); f.throttle = 0.15; f.parkingBrake = false;
  const h = {}, ax = { pitch: 0, roll: 0, yaw: 0 }, h0 = att(f).hdg;
  for (let t = 0; t < 60; t += dt) { f.ctrl.da = 0; f.ctrl.dr = 0; const c = c172HandsOffCommand(f, ax, h, dt); if (c.dr !== null) f.ctrl.dr = c.dr; f.step(dt, ground, wind); }
  let d = att(f).hdg - h0; d = ((d + 540) % 360) - 180;
  check('assist: a slow roll on the ground holds the heading', Math.abs(d) < 0.5, `heading ${d.toFixed(2)} deg in 60 s at ${(Math.hypot(f.vel.x, f.vel.z) * KT).toFixed(1)} kt`);
}
if (fails) { console.log(`${fails} hands-off checks failed`); process.exit(1); }
console.log('hands-off tests passed');
