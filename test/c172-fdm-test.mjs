// Cessna 172SP flight model against the POH: stall speeds, sea-level climb at Vy, cruise at 75 % power / 8,000 ft, take-off ground roll,
// parked at idle with the brakes on, and a long flight with no NaN. Flat ground at 0 m, no wind, ISA.
import * as THREE from 'three';
import { C172Model, C172, C172_CG, c172Lift, stallAlpha, CL_DE } from '../src/c172.js';
import { isa } from '../src/atmosphere.js';

let fails = 0;
let last = null;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}${last && last.crashed ? ` [crashed: ${last.crashed}]` : ''}`); if (!ok) fails++; last = null; };
const KT = 1.943844, FT = 3.28084, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const kias = (f) => (f.out.ias ?? f.out.V) * KT;
const fly = (f, secs, ctl) => { last = f; for (let t = 0; t < secs; t += dt) { ctl && ctl(f, t); f.step(dt, ground, wind); if (f.crashed) break; } };
// simple pilot: elevator holds a target (IAS or altitude), ailerons hold wings level, rudder balances
const pid = () => ({ i: 0, last: null });
const pitchOf = (f) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y);
// speed held with pitch attitude (the way a pilot flies Vy): too fast -> raise the nose
const pilotIas = (target, st) => (f) => { if (st.last === null) st.last = pitchOf(f); st.last = Math.max(-0.35, Math.min(0.3, st.last + (kias(f) - target) * 0.004 * dt * 60 * 0.25)); f.ctrl.de = Math.max(-1, Math.min(1, 3 * (st.last - pitchOf(f)) - 0.8 * f.w.z)); level(f); };
const pilotAlt = (alt, st) => (f) => { const e = (alt - f.pos.y) / 30 - f.vel.y / 6; st.i = Math.max(-2, Math.min(2, st.i + e * dt * 0.5)); f.ctrl.de = Math.max(-1, Math.min(1, 0.5 * e + 0.3 * st.i + 0.6 * f.w.z * -1)); level(f); };
const level = (f) => { const right = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat), bank = Math.asin(Math.max(-1, Math.min(1, -right.y))); f.ctrl.da = Math.max(-1, Math.min(1, -2 * bank - 0.5 * f.w.x)); f.ctrl.dr = Math.max(-1, Math.min(1, 3 * (f.out.beta || 0) + 0.3 * f.w.y)); };
const fresh = (alt, kt, ground = false) => { const f = new C172Model(); f.fuel = C172.FUEL_MAX; f.reset(new THREE.Vector3(0, ground ? C172_CG.y : alt, 0), 90, kt / KT, ground); return f; };

// stall speed (trimmed CLmax at MTOW 1,111 kg), POH most-forward-CG calibrated speeds: 53 KCAS clean, 48 KCAS flaps 30 (the sim's IAS is CAS)
for (const [flaps, poh] of [[0, 53], [30, 48]]) {
  const a = stallAlpha(flaps), de = -(0.04 - 0.89 * a) / 1.28, cl = c172Lift(a, flaps) - CL_DE * de, W = 1111 * 9.80665;
  const vs = Math.sqrt(2 * W / (1.225 * C172.S * cl)) * KT;
  check(`stall speed flaps ${flaps}`, Math.abs(vs - poh) < 4, `${vs.toFixed(1)} KCAS (POH ${poh} KCAS, ${flaps ? 40 : 48} KIAS)`);
}
{ // sea-level climb at Vy, full throttle, MTOW: POH 730 fpm
  const f = fresh(300, 74); f.throttle = 1; const st = pid();
  fly(f, 40, pilotIas(74, st)); const y0 = f.pos.y; fly(f, 30, pilotIas(74, st));
  const fpm = (f.pos.y - y0) / 30 * 60 * FT;
  check('climb at Vy, sea level, full throttle', !f.crashed && fpm > 580 && fpm < 900, `${fpm.toFixed(0)} fpm at ${kias(f).toFixed(0)} KIAS, ${f.rpm.toFixed(0)} rpm (POH 730)`);
}
{ // cruise: 75 % power at 8,000 ft, level: POH ~122 KTAS
  const alt = 8000 / FT, f = fresh(alt, 110); const st = pid(); let thr = 0.8;
  fly(f, 150, (g, t) => { const pw = g.enginePower(g.rpm, g.throttle, g.out.rho || 0.96) / C172.PMAX; thr = Math.max(0, Math.min(1, thr + (0.75 - pw) * dt * 0.8)); g.throttle = thr; pilotAlt(alt, st)(g); });
  const ktas = f.out.V * KT, pw = f.enginePower(f.rpm, f.throttle, f.out.rho) / C172.PMAX;
  check('cruise 75 % power at 8,000 ft', !f.crashed && Math.abs(ktas - 122) < 8 && Math.abs(f.pos.y - alt) < 30, `${ktas.toFixed(0)} KTAS, ${(pw * 100).toFixed(0)} % power, ${f.rpm.toFixed(0)} rpm, ${(f.out.ff * 3600 / 2.72).toFixed(1)} gal/h (POH 122 KTAS, ~2550 rpm, ~10 gph)`);
}
// take-off: full throttle, flaps 10, rotate at 50 KIAS to 11 deg (POH short-field technique, lift-off 51 KIAS). Ground roll runs to the last wheel
// contact before 15 m. POH: 960 ft (293 m) at 2,550 lb; this model weighs 1,081 kg (2,383 lb), so ~256 m by the usual W^2 scaling.
const takeoff = (tailWheelDown) => {
  const f = fresh(0, 0, true); f.setFlaps(1); f.parkingBrake = false; if (!tailWheelDown) f.setTailGear(false);
  fly(f, 5, () => {}); const x0 = f.pos.clone(); let off = null, contact = null;
  fly(f, 60, (g) => {
    g.throttle = 1; g.ctrl.de = kias(g) > 50 ? Math.max(-1, Math.min(1, 8 * (11 * Math.PI / 180 - pitchOf(g)) - 0.8 * g.w.z)) : 0; level(g);
    if (g.onGround) contact = { d: g.pos.distanceTo(x0), kias: kias(g) }; else if (!off) off = kias(g);
  });
  return { f, roll: contact ? contact.d : Infinity, off: off ?? NaN, scraped: f.events.some((e) => e.type === 'scrape') };
};
{ // production 172 (no tail wheel): the POH case
  const r = takeoff(false);
  check('take-off ground roll, flaps 10, tail wheel up', !r.f.crashed && !r.scraped && r.roll > 220 && r.roll < 295 && r.off > 48 && r.off < 56,
    `${r.roll.toFixed(0)} m (POH ~256 m at this weight), wheels off at ${r.off.toFixed(1)} KIAS (POH 51), ${r.f.pos.y.toFixed(0)} m up after 60 s, ${kias(r.f).toFixed(0)} KIAS`);
}
{ // game default: the owner-requested tail wheel is down and meets the runway at ~8.6 deg, which caps the rotation and lengthens the roll a little
  const r = takeoff(true);
  check('take-off ground roll, flaps 10, tail wheel down (default)', !r.f.crashed && !r.scraped && r.roll > 220 && r.roll < 340,
    `${r.roll.toFixed(0)} m, wheels off at ${r.off.toFixed(1)} KIAS, ${r.f.pos.y.toFixed(0)} m up after 60 s`);
}
{ // parked at idle, brakes on: stays put; idle rpm 600-900
  const f = fresh(0, 0, true); f.parkingBrake = true; f.throttle = 0; const x0 = f.pos.clone();
  fly(f, 30, () => {});
  check('parked at idle with the brakes on', !f.crashed && f.pos.distanceTo(x0) < 0.3 && f.rpm > 550 && f.rpm < 950, `moved ${f.pos.distanceTo(x0).toFixed(2)} m, ${f.rpm.toFixed(0)} rpm, gear loads ${f.contacts.map((c) => (c / 9.81).toFixed(0)).join('/')} kg`);
}
{ // a long flight in turbulence-free air with control wiggles: finite state throughout, fuel burns
  const f = fresh(1500, 100); const st = pid(); const fuel0 = f.fuel; let bad = false;
  fly(f, 600, (g, t) => { g.throttle = 0.7; pilotAlt(1500, st)(g); g.ctrl.da += 0.3 * Math.sin(t * 0.7); if (![g.pos.x, g.pos.y, g.vel.x, g.w.x, g.rpm].every(Number.isFinite)) bad = true; });
  check('10 minutes of flight, finite state', !bad && !f.crashed && f.fuel < fuel0, `alt ${f.pos.y.toFixed(0)} m, burned ${(fuel0 - f.fuel).toFixed(1)} kg`);
}
{ // glide, engine off, best glide ~68 KIAS: POH ~9:1
  const f = fresh(2000, 68); f.magnetos = false; const st = pid(); fly(f, 20, pilotIas(68, st));
  const p0 = f.pos.clone(); fly(f, 60, pilotIas(68, st));
  const ratio = Math.hypot(f.pos.x - p0.x, f.pos.z - p0.z) / (p0.y - f.pos.y);
  check('glide ratio, engine off', !f.crashed && ratio > 7.5 && ratio < 11.5, `${ratio.toFixed(1)}:1 at ${kias(f).toFixed(0)} KIAS (POH ~9:1)`);
}
// ground handling with keyboard-style (all-or-nothing) pedals: the browser run ground-looped onto the propeller before the steering fix
const yawDeg = (f) => { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat); return Math.atan2(v.z, v.x) * 180 / Math.PI; };
{
  const f = fresh(0, 0, true); f.parkingBrake = false; fly(f, 2, () => {}); const y0 = yawDeg(f);
  while (kias(f) < 50 && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  const dev = Math.abs(((yawDeg(f) - y0 + 540) % 360) - 180);
  check('hands-off take-off roll: P-factor swing to 50 KIAS stays small', !f.crashed && dev < 12, `${dev.toFixed(1)} deg`);
}
for (const kt of [15, 30, 45]) {
  const f = fresh(0, 0, true); f.parkingBrake = false; while (kias(f) < kt && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  let minPitch = 99, maxRate = 0; fly(f, 2, (g) => { g.throttle = 1; g.ctrl.dr = 1; minPitch = Math.min(minPitch, pitchOf(g)); maxRate = Math.max(maxRate, Math.abs(g.w.y)); });
  check(`full pedal held 2 s at ${kt} KIAS: turns without tipping onto the propeller`, !f.crashed && minPitch > -5 * Math.PI / 180 && maxRate < 45 * Math.PI / 180,
    `min pitch ${(minPitch * 180 / Math.PI).toFixed(1)} deg, max yaw rate ${(maxRate * 180 / Math.PI).toFixed(0)} deg/s`);
}
{ // over-rotation at 50 KIAS: full up elevator until the tail scrapes, the pilot lets go for 0.3 s, then holds 8 deg nose up; no crash
  const f = fresh(0, 0, true); f.parkingBrake = false; f.setTailGear(false); f.tailGearPos = 0; while (kias(f) < 50 && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  f.events.length = 0; let maxPitch = 0, scrape = false;
  let eased = 0; fly(f, 6, (g) => { g.throttle = 1; if (scrape) eased += dt; g.ctrl.de = !scrape ? 1 : eased < 0.3 ? 0 : Math.max(-1, Math.min(1, 3 * (8 * Math.PI / 180 - pitchOf(g)) - 0.8 * g.w.z)); maxPitch = Math.max(maxPitch, pitchOf(g)); if (g.events.some((e) => e.type === 'scrape')) scrape = true; g.events.length = 0; });
  check('tail wheel up: over-rotation on the runway is a tail scrape, not a crash', !f.crashed && scrape, `max pitch ${(maxPitch * 180 / Math.PI).toFixed(1)} deg; 6 s later ${kias(f).toFixed(0)} KIAS, ${(f.pos.y - C172_CG.y).toFixed(1)} m up`);
}
{ // tail wheel down (the default): the same over-rotation is carried on the tail wheel, no scrape, no crash; it cannot be raised while loaded
  const f = fresh(0, 0, true); f.parkingBrake = false; while (kias(f) < 50 && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  f.events.length = 0; let maxPitch = 0, scrape = false, load = 0, refused = false;
  fly(f, 2, (g) => { g.throttle = 1; g.ctrl.de = 1; maxPitch = Math.max(maxPitch, pitchOf(g)); if (g.events.some((e) => e.type === 'scrape')) scrape = true; g.events.length = 0; if (g.tailContact > load) { load = g.tailContact; refused = refused || !g.setTailGear(false); } });
  check('tail wheel down: over-rotation rides on the tail wheel, no scrape or crash; no retraction under load', !f.crashed && !scrape && load > 500 && refused && f.tailGearCmd,
    `max pitch ${(maxPitch * 180 / Math.PI).toFixed(1)} deg, peak tail wheel load ${(load / 9.81).toFixed(0)} kg`);
}
{ // retraction takes 3 s; parked, the tail wheel carries nothing
  const f = fresh(0, 0, true); fly(f, 1, () => {}); const parked = f.tailContact; f.setTailGear(false); fly(f, 1.5, () => {}); const mid = f.tailGearPos; fly(f, 2, () => {});
  check('tail wheel: clear of the runway parked, retracts in 3 s', parked === 0 && mid > 0.4 && mid < 0.6 && f.tailGearPos === 0, `parked load ${parked}, half-way ${mid.toFixed(2)}, then ${f.tailGearPos}`);
}
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('c172-fdm-test ok');
