import assert from 'node:assert/strict';
import * as THREE from 'three';
import { F27Model, F27, F27_CG, F27_GEAR, F27_FLAP_DEG, f27Lift, stallAlpha, stallSpeed } from '../src/f27.js';
import { isa } from '../src/atmosphere.js';

// Deterministic engineering checks, not certification or comparisons to flight-test data.
const KT = 1.943844, FT = 3.28084, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const limit = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const pitch = m => Math.asin(limit(new THREE.Vector3(1, 0, 0).applyQuaternion(m.quat).y));
const kias = m => (m.out.ias ?? m.vel.length() * Math.sqrt(isa(m.pos.y).rho / 1.225)) * KT;
const fresh = (height = 1000, knots = 160, onGround = false, gamma = 0) => {
  const m = new F27Model();
  m.reset(new THREE.Vector3(0, onGround ? F27_CG.y : height, 0), 90, knots / KT / Math.sqrt(isa(onGround ? 0 : height).rho / 1.225), onGround, gamma);
  return m;
};
const fly = (m, seconds, pilot = () => {}) => {
  for (let i = 0; i < Math.round(seconds / dt) && !m.crashed; i++) { pilot(m, i * dt); m.step(dt, ground, wind); }
  assert.equal(m.crashed, null, m.crashed ?? 'not crashed');
  for (const x of [m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z, m.rpm, m.out.CL, m.out.CD, ...m.quat.toArray(), ...m.w.toArray()]) assert.ok(Number.isFinite(x), `finite state ${x}`);
};
const wings = m => {
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quat), bank = Math.asin(limit(-right.y));
  m.ctrl.da = limit(-2 * bank - 0.7 * m.w.x);
  m.ctrl.dr = limit(3 * (m.out.beta || 0) + 0.7 * m.w.y);
};
const holdPitch = (m, target) => { m.ctrl.de = limit(3 * (target - pitch(m)) - 1.2 * m.w.z); wings(m); };

assert.equal(F27.MTOW, 19730); assert.equal(F27.MLW, 18600);
assert.ok(Math.abs(F27.S - 70.049) < 0.01 && Math.abs(F27.B - 29.002) < 0.01);
assert.deepEqual(F27_FLAP_DEG, [0, 11.5, 16.5, 26.5, 40]);
assert.ok(F27_GEAR[0].p.x > 8 && F27_GEAR[1].p.x < 0 && F27_GEAR[2].p.x < 0);
assert.deepEqual(F27_GEAR.map(g => g.brake), [false, true, true]);
for (const [flaps, min, max] of [[0, 89, 93], [16.5, 81, 85], [40, 72, 76]]) {
  const v = stallSpeed(F27.MTOW, flaps) * KT, a = stallAlpha(flaps), peak = f27Lift(a, flaps);
  assert.ok(v > min && v < max, `source-calibrated stall ${flaps} ${v}`);
  assert.ok(f27Lift(a + 0.10, flaps) < peak * 0.8, `post-stall drop ${flaps}`);
  assert.ok(Math.abs(stallSpeed(F27.MTOW * 0.81, flaps) / stallSpeed(F27.MTOW, flaps) - 0.9) < 1e-10);
  console.log(`MTOW static stall: flaps ${flaps} = ${v.toFixed(2)} KIAS, alpha ${(a * 180 / Math.PI).toFixed(1)} deg`);
}
{
  const m = fresh(0, 0, true); m.parkingBrake = true;
  assert.notEqual(m.engines[0], m.engines[1]); assert.equal(m.type, 'f27');
  assert.equal(m.setGear(false), false); assert.equal(m.gearDown, true);
  m.setFlaps(4); fly(m, 7.5); assert.ok(Math.abs(m.flaps - 20) < 0.01);
  fly(m, 8); assert.equal(m.flaps, 40); assert.ok(m.contacts.every(n => n > 0));
  assert.ok(Math.abs(m.pos.y - F27_CG.y) < 0.15 && Math.hypot(m.pos.x, m.pos.z) < 0.3);
  m.setFlaps(-9); fly(m, 15.1); assert.equal(m.flaps, 0);
  assert.equal(m.setFlaps(NaN), false); m.setFlaps(99); assert.equal(m.flapCmd, 4);
  console.log(`parked: CG height ${m.pos.y.toFixed(3)} m, supported load ${(m.contacts.reduce((a,b)=>a+b,0)/m.mass/9.80665).toFixed(3)} g`);
}
{
  const m = fresh(0, 0, true); m.parkingBrake = true;
  const staticThrust = 2 * m.engineThrust(15000, 0, isa(0));
  assert.ok(staticThrust > 50000 && staticThrust < 100000);
  assert.ok(m.engineThrust(15000, 60, isa(0)) < staticThrust / 2);
  assert.ok(m.enginePower(15000, isa(6000).rho) < m.enginePower(15000, isa(0).rho));
  m.throttle = 1; fly(m, 1); const early = m.rpm; assert.ok(early > 7000 && early < 10000);
  fly(m, 14); const after15 = m.rpm; assert.ok(m.rpm > 14900 && m.rpm <= 15000); assert.ok(Math.abs(m.propRpm / m.rpm - 0.093) < 1e-12);
  assert.ok(m.engines.every(e => e.ff > 0 && e.power > 1.3e6));
  const fuel = m.fuel; fly(m, 2); assert.ok(m.fuel < fuel);
  m.unlimitedFuel = true; const keep = m.fuel; fly(m, 1); assert.equal(m.fuel, keep);
  m.unlimitedFuel = false; m.fuel = 0; fly(m, 2); assert.equal(m.out.ff, 0); assert.ok(m.out.thrust <= 0);
  console.log(`Dart spool: rpm after 1 s ${early.toFixed(0)}, after 15 s ${after15.toFixed(0)}; static pair ${Math.round(staticThrust)} N`);
}
{
  const m = fresh(1800, 160); assert.equal(m.gearPos, 0); m.setFlaps(3); m.flaps = 26.5; m.step(dt, ground, wind); assert.ok(m.out.flapOverspeed && m.out.gearWarning); m.setFlaps(0); m.flaps = 0;
  assert.equal(m.setGear(true), true); fly(m, 7.1, wings); assert.equal(m.gearPos, 1);
  assert.equal(m.setGear(false), true); fly(m, 17.1, wings); assert.equal(m.gearPos, 0);
  m.pneumatic = 500; assert.equal(m.setGear(true), false);
  m.pneumatic = 2800; m.onGround = true; assert.equal(m.setGear(false), false);
}
// Warm starts are selected by equivalent/indicated airspeed, not true airspeed.
for (const [height, knots, gamma] of [[300, 100, -3], [1500, 160, 0], [6000, 190, 0], [7620, 180, 0]]) {
  const m = fresh(height, knots, false, gamma), initial = m.pos.y;
  fly(m, 30, wings);
  assert.ok(Math.abs(kias(m) - knots) < 16, `warm speed ${height} ${kias(m)}`);
  assert.ok(Math.abs(m.pos.y - (initial + knots / KT / Math.sqrt(isa(height).rho / 1.225) * Math.sin(gamma * Math.PI / 180) * 30)) < 120, `warm altitude ${height} -> ${m.pos.y}`);
  console.log(`warm start ${height} m / ${knots} KIAS / gamma ${gamma}: after 30 s ${kias(m).toFixed(2)} KIAS, dh ${(m.pos.y - initial).toFixed(1)} m`);
}
{
  const m = fresh(0, 0, true); m.setFlaps(2); m.parkingBrake = true; fly(m, 7);
  m.setTakeoffTrim(); m.parkingBrake = false; let roll = 0, lift = null;
  fly(m, 60, a => {
    a.throttle = 1;
    if (kias(a) > a.vSpeed(96)) holdPitch(a, 8 * Math.PI / 180); else { a.ctrl.de = 0; wings(a); }
    if (a.onGround) roll = a.pos.x;
    else if (lift === null && kias(a) > 75) lift = kias(a);
    if (!a.onGround && a.pos.y > 8) a.setGear(false);
  });
  assert.ok(lift > 85 && lift < 115, `liftoff ${lift}`); assert.ok(roll > 350 && roll < 1300, `roll ${roll}`);
  assert.ok(m.pos.y > 50 && !m.onGround); assert.equal(m.gearPos, 0);
  console.log(`takeoff 18.35 t / flaps 16.5: ground roll ${roll.toFixed(0)} m, liftoff ${lift.toFixed(1)} KIAS, altitude after 60 s ${m.pos.y.toFixed(0)} m`);
}
// Hold altitude while reducing power: both configurations must develop a real stall,
// lose lift after the maximum, and recover by unloading plus forward power.
for (const flaps of [0, 40]) {
  const m = fresh(2500, flaps ? 110 : 125);
  m.flaps = flaps; m.flapCmd = flaps ? 4 : 0; m.gearPos = flaps ? 1 : 0; m.gearDown = !!flaps;
  m.quat.identity(); m.vel.set((flaps ? 110 : 125) / KT / Math.sqrt(isa(2500).rho / 1.225), 0, 0); m.trimLevel();
  m.throttle = 0; let stallAt = null, peakAlpha = 0, target = pitch(m), stallNz = 0;
  for (let i = 0; i < 180 / dt && stallAt === null; i++) {
    target = limit(target + limit(-m.vel.y * 0.012, -0.025, 0.025) * dt, -0.15, 0.55);
    holdPitch(m, target); m.step(dt, ground, wind);
    peakAlpha = Math.max(peakAlpha, m.out.alpha);
    if (m.out.stall > 0.45) { stallAt = kias(m); stallNz = m.out.nz; }
  }
  assert.equal(m.crashed, null); assert.ok(stallAt !== null, `dynamic stall reached flaps ${flaps}, alpha ${peakAlpha}`);
  assert.ok(stallAt > (flaps ? 60 : 74) && stallAt < (flaps ? 95 : 113), `dynamic stall speed ${stallAt}`);
  m.throttle = 1; fly(m, 15, a => holdPitch(a, -0.12)); assert.ok(m.out.stall < 0.1);
  console.log(`dynamic stall/recovery: flaps ${flaps}, developed at ${stallAt.toFixed(1)} KIAS / ${stallNz.toFixed(2)} g; recovered ${kias(m).toFixed(1)} KIAS, alpha ${(m.out.alpha * 180 / Math.PI).toFixed(1)} deg`);
}
{
  const a = fresh(0, 25, true), b = fresh(0, 25, true); b.brakes = 1;
  fly(a, 6); fly(b, 6);
  assert.ok(b.vel.length() < 1.5 && b.pos.x < a.pos.x * 0.65, `braking distance ${b.pos.x} vs ${a.pos.x}`);
  const m = fresh(1500, 160); const live = m.engines[1].thrust;
  m.failEngine(0); m.step(dt, ground, wind); assert.ok(m.w.y > 0, 'live right engine yaws left after left failure'); fly(m, 1, wings); assert.equal(m.engines[0].ff, 0); assert.ok(m.engines[0].thrust < 0 && m.engines[1].thrust > live * 0.7);
}
{
  const a = fresh(0, 0, true), b = fresh(0, 0, true); a.parkingBrake = b.parkingBrake = true;
  for (let i = 0; i < 600; i++) a.step(1 / 120, ground, wind);
  for (let i = 0; i < 150; i++) b.step(1 / 30, ground, wind);
  assert.ok(a.pos.distanceTo(b.pos) < 1e-8 && a.vel.distanceTo(b.vel) < 1e-8, 'frame subdivision equals 120 Hz');
}
{
  const m = fresh(0, 0, true); m.parkingBrake = true; m.setEngineRunning(false, { immediate: true });
  assert.ok(m.engines.every(e => !e.lit && e.rpm === 0 && e.propRpm === 0));
  fly(m, 2); assert.equal(m.out.ff, 0); assert.equal(m.out.thrust, 0);
  m.setEngineRunning(true); fly(m, 12); assert.ok(m.engines.every(e => e.lit && e.rpm > 6800 && e.rpm <= 7000));
  m.pneumatic = 1700; fly(m, 2); assert.equal(m.pneumatic, 1700);
  m.throttle = 0.9; fly(m, 15); assert.ok(m.pneumatic > 2700);
}
{
  const height = 4000, tas = 240, m = fresh(height, tas * Math.sqrt(isa(height).rho / 1.225));
  const initialFuel = m.fuel; fly(m, 300, wings);
  assert.ok(Math.abs(m.pos.y - height) < 50 && Math.abs(m.out.V * KT - tas) < 4);
  assert.ok(m.rpm > 13900 && m.rpm < 14500, `manual cruise rpm ${m.rpm}`);
  assert.ok(m.fuel < initialFuel);
  console.log(`five-minute manual-style cruise: ${Math.round(m.out.V * KT)} KTAS, ${Math.round(kias(m))} KIAS, ${Math.round(m.rpm)} gas rpm, ${Math.round(m.out.ff * 3600)} kg/h pair, dh ${(m.pos.y-height).toFixed(1)} m`);
}
{
  const m = fresh(300, 138); m.throttle = (14200 - 7000) / 8000;
  let target = pitch(m), altitudeAt90 = 0;
  fly(m, 120, (a, t) => {
    target = limit(target + (kias(a) - 138) * 0.001 * dt, -0.1, 0.35);
    holdPitch(a, target); if (t >= 90 && !altitudeAt90) altitudeAt90 = a.pos.y;
  });
  const climb = (m.pos.y - altitudeAt90) / 30 * 60 * FT;
  assert.ok(climb > 500 && climb < 1500, `manual 14200 rpm climb ${climb}`);
  assert.ok(Math.abs(kias(m) - 138) < 5);
  console.log(`manual-style climb: ${Math.round(climb)} ft/min at ${kias(m).toFixed(1)} KIAS and ${Math.round(m.rpm)} gas rpm`);
}
console.log('f27-fdm-test ok');
