import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DA40Model, DA40, DA40_CG, DA40_GEAR, DA40_FLAP_DEG, da40Lift, stallAlpha } from '../src/da40.js';
import { isa } from '../src/atmosphere.js';

// Sanity checks only; manufacturer comparisons are in da40-performance-test.mjs.
const KT = 1.943844, FT = 3.28084, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const fresh = (altitude, knots, onGround = false) => {
  const model = new DA40Model();
  model.reset(new THREE.Vector3(0, onGround ? DA40_CG.y : altitude, 0), 90, knots / KT, onGround);
  return model;
};
const fly = (model, seconds, pilot = () => {}) => {
  const steps = Math.round(seconds / dt);
  for (let step = 0; step < steps && !model.crashed; step++) { pilot(model, step * dt); model.step(dt, ground, wind); }
  assert.equal(model.crashed, null);
};
const kias = (model) => (model.out.ias ?? model.out.V) * KT;
const pitch = (model) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(model.quat).y);
const level = (model) => {
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quat), bank = Math.asin(Math.max(-1, Math.min(1, -right.y)));
  model.ctrl.da = Math.max(-1, Math.min(1, -2 * bank - 0.5 * model.w.x));
  model.ctrl.dr = Math.max(-1, Math.min(1, 3 * (model.out.beta || 0) + 0.3 * model.w.y));
};

assert.equal(DA40.S, 13.244); assert.equal(DA40.B, 11.63); assert.equal(DA40.C, 1.28);
assert.equal(DA40.EMPTY, 903); assert.equal(DA40.PAYLOAD, 160); assert.equal(DA40.FUEL_MAX, 118); assert.equal(DA40.MTOM, 1310);
assert.ok(Math.abs(DA40.PMAX / 745.7 - 165.613) < 0.1); assert.equal(DA40.PROP_D, 1.9);
assert.deepEqual(DA40_FLAP_DEG, [0, 20, 42]);
assert.deepEqual(DA40_GEAR.map((gear) => gear.name), ['nose', 'left', 'right']);
assert.ok(DA40_GEAR[0].p.x > 0 && DA40_GEAR[1].p.x < 0 && DA40_GEAR[2].p.x < 0);
assert.ok(DA40_GEAR[0].steer && !DA40_GEAR[0].brake && DA40_GEAR[1].brake && DA40_GEAR[2].brake);

for (const [angle, minimum, maximum] of [[0, 56, 63], [20, 54, 61], [42, 52, 59]]) {
  const alpha = stallAlpha(angle), coefficient = da40Lift(alpha, angle);
  const speed = Math.sqrt(2 * (DA40.EMPTY + DA40.PAYLOAD + DA40.FUEL_MAX) * 9.80665 / (1.225 * DA40.S * coefficient)) * KT;
  assert.ok(speed > minimum && speed < maximum, `flaps ${angle} stall estimate ${speed.toFixed(1)} kt`);
  assert.ok(da40Lift(alpha + 0.08, angle) < coefficient);
  console.log(`flaps ${angle}: estimated unaccelerated stall ${speed.toFixed(1)} kt`);
}

{
  const model = fresh(0, 0, true); model.parkingBrake = true;
  assert.equal(model.type, 'da40'); assert.equal(model.engines[0], model.engines[1]);
  assert.equal(typeof model.setTailGear, 'undefined'); assert.equal('tailWheel' in model, false);
  model.gearDown = false; model.gearPos = 0; model.setFlaps(2); fly(model, 4);
  assert.equal(model.gearDown, true); assert.equal(model.gearPos, 1); assert.equal(model.contacts.length, 3);
  assert.ok(Math.abs(model.flaps - 20) < 0.1, `flaps after 4 s: ${model.flaps}`);
  fly(model, 3.1); assert.equal(model.flaps, 42);
  model.setFlaps(99); assert.equal(model.flapCmd, 2); model.setFlaps(-1); assert.equal(model.flapCmd, 0);
  fly(model, 7.2); assert.equal(model.flaps, 0);
  assert.ok(model.contacts.every((force) => force > 0)); assert.ok(model.pos.distanceTo(new THREE.Vector3(0, DA40_CG.y, 0)) < 0.5);
}

{
  const model = fresh(1000, 100), sea = isa(0).rho, high = isa(5500).rho;
  assert.ok(model.enginePower(2300, 1, sea) > 123000);
  assert.ok(model.enginePower(700 / 1.69, 1, sea) < model.enginePower(2300, 1, sea) / 4);
  assert.equal(model.enginePower(2300, 1, isa(3048).rho), model.enginePower(2300, 1, sea));
  assert.ok(model.enginePower(2300, 1, high) < model.enginePower(2300, 1, sea));
  assert.ok(model.prop(2300 * Math.PI / 30, 0, sea, 1).T > model.prop(2300 * Math.PI / 30, 50, sea, 1).T);
  assert.ok(Math.abs(model.steadyOmega(1, 0, sea) * 30 / Math.PI - 2300) < 0.01);
  assert.ok(Math.abs(model.steadyOmega(0, 0, sea) * 30 / Math.PI - 700 / 1.69) < 0.01);
  model.magnetos = false;
  assert.equal(model.steadyOmega(0, 0, sea), 0);
  assert.ok(model.steadyOmega(0, 40, sea) > 0);
  assert.ok(model.prop(model.steadyOmega(0, 40, sea), 40, sea, 0).T < 0);
  model.magnetos = true;
  const fuel = model.fuel; fly(model, 10); assert.ok(model.fuel < fuel && model.out.ff > 0);
  model.unlimitedFuel = true; const remaining = model.fuel; fly(model, 2); assert.equal(model.fuel, remaining);
  model.unlimitedFuel = false; model.fuel = 0; fly(model, 2); assert.equal(model.out.ff, 0); assert.ok(model.out.thrust <= 0);
  model.fuel = DA40.FUEL_MAX; model.magnetos = false; fly(model, 1); assert.equal(model.out.ff, 0); assert.ok(model.out.thrust <= 0);
}

{
  const model = fresh(300, 72); model.throttle = 1; let targetPitch = pitch(model), altitudeAt40 = 0;
  fly(model, 70, (aircraft, time) => {
    targetPitch = Math.max(-0.35, Math.min(0.3, targetPitch + (kias(aircraft) - 72) * 0.004 * dt * 15));
    aircraft.ctrl.de = Math.max(-1, Math.min(1, 3 * (targetPitch - pitch(aircraft)) - 0.8 * aircraft.w.z)); level(aircraft);
    if (time >= 40 && !altitudeAt40) altitudeAt40 = aircraft.pos.y;
  });
  const climb = (model.pos.y - altitudeAt40) / 30 * 60 * FT;
  assert.ok(climb > 350 && climb < 1300, `climb ${climb.toFixed(0)} ft/min`);
  assert.ok(kias(model) > 60 && kias(model) < 90);
  assert.ok([model.pos.x, model.pos.y, model.pos.z, model.vel.x, model.vel.y, model.w.z, model.out.CL, model.rpm].every(Number.isFinite));
  console.log(`piloted climb: ${climb.toFixed(0)} ft/min at ${kias(model).toFixed(0)} KIAS`);
}

{
  const model = fresh(1500, 100), fuel = model.fuel; let integral = 0;
  fly(model, 300, (aircraft) => {
    const error = (1500 - aircraft.pos.y) / 30 - aircraft.vel.y / 6;
    integral = Math.max(-2, Math.min(2, integral + error * dt * 0.5));
    aircraft.ctrl.de = Math.max(-1, Math.min(1, 0.5 * error + 0.3 * integral - 0.6 * aircraft.w.z));
    level(aircraft);
  });
  assert.ok(Math.abs(model.pos.y - 1500) < 50 && model.fuel < fuel);
  const { iasReference, ...values } = model.out;
  assert.equal(iasReference, 'CAS');
  assert.ok(Object.values(values).every(Number.isFinite));
}

{
  const model = fresh(0, 0, true); model.parkingBrake = false; model.setFlaps(1);
  let lastGroundX = 0, offSpeed = null;
  fly(model, 50, (aircraft) => {
    aircraft.throttle = 1;
    aircraft.ctrl.de = kias(aircraft) > 60 ? Math.max(-1, Math.min(1, 3 * (8 * Math.PI / 180 - pitch(aircraft)) - 0.8 * aircraft.w.z)) : 0;
    level(aircraft);
    if (aircraft.onGround) lastGroundX = aircraft.pos.x; else if (offSpeed === null && kias(aircraft) > 45) offSpeed = kias(aircraft);
  });
  assert.ok(offSpeed > 50 && offSpeed < 75, `liftoff ${offSpeed} KIAS`);
  assert.ok(lastGroundX > 120 && lastGroundX < 600, `ground roll ${lastGroundX} m`);
  assert.ok(model.pos.y > 20 && !model.onGround);
  console.log(`takeoff: ${lastGroundX.toFixed(0)} m ground roll, ${offSpeed.toFixed(0)} KIAS liftoff`);
}

{
  const coast = fresh(0, 8 * KT, true), turn = fresh(0, 8 * KT, true), brake = fresh(0, 8 * KT, true);
  turn.ctrl.dr = 0.6; brake.brakes = 1;
  fly(coast, 5); fly(turn, 5); fly(brake, 5);
  assert.ok(Math.abs(turn.pos.z) > 10 && Math.abs(coast.pos.z) < 2);
  assert.ok(brake.vel.length() < 1 && brake.pos.x < coast.pos.x / 2);
}
console.log('da40-fdm-test ok');
