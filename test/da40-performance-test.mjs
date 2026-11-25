import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DA40, DA40Model, DA40_CG, da40Lift, stallAlpha } from '../src/da40.js';
import { isa } from '../src/atmosphere.js';

const KT = 1.943844, FT = 3.28084, DT = 1 / 120;
const ground = () => 0, wind = new THREE.Vector3();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const kias = (model) => (model.out.ias ?? model.vel.length() * Math.sqrt(isa(model.pos.y).rho / 1.225)) * KT;
const pitch = (model) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(model.quat).y);
const level = (model) => {
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quat);
  model.ctrl.da = clamp(-2 * Math.asin(clamp(-right.y, -1, 1)) - 0.5 * model.w.x, -1, 1);
  model.ctrl.dr = clamp(3 * (model.out.beta || 0) + 0.3 * model.w.y, -1, 1);
};
const make = (alt, speed, onGround = false, mass = 1310) => {
  const model = new DA40Model();
  model.fuel = DA40.FUEL_MAX; model.payload = mass - DA40.EMPTY - model.fuel;
  model.reset(new THREE.Vector3(0, onGround ? DA40_CG.y : alt, 0), 90, speed, onGround);
  model.unlimitedFuel = true;
  return model;
};
const fly = (model, seconds, pilot) => {
  for (let step = 0; step < Math.round(seconds / DT) && !model.crashed; step++) {
    if (pilot(model, step * DT) === false) break;
    model.step(DT, ground, wind);
  }
  assert.equal(model.crashed, null);
};
const failures = [];
const close = (name, actual, expected, tolerance, unit) => {
  console.log(`${name}: ${actual.toFixed(1)} ${unit}; reference ${expected} ± ${tolerance} ${unit}`);
  if (!(Math.abs(actual - expected) <= tolerance)) failures.push(`${name}: ${actual} vs ${expected} ${unit}`);
};

const stalled = make(1000, 100 / KT);
assert.equal(stalled.mass, 1310);
const landingStall = Math.sqrt(2 * stalled.mass * 9.80665 / (1.225 * DA40.S * da40Lift(stallAlpha(42), 42))) * KT;
close('landing stall ideal EAS ≈ CAS', landingStall, 58, 2, 'kt');
for (const [flaps, reference] of [[0, 63], [42, 58]]) {
  const speed = Math.sqrt(2 * 1280 * 9.80665 / (1.225 * DA40.S * da40Lift(stallAlpha(flaps), flaps))) * KT;
  close(`1280 kg stall flaps ${flaps}`, speed, reference, 1, 'kt EAS ≈ CAS');
}

for (const [mass, reference] of [[1280, 370], [1310, 397]]) {
  const model = make(0, 0, true, mass);
  model.setFlaps(1); model.flaps = 20; model.setEngines(1);
  let lastGroundX = 0, liftOff = null;
  fly(model, 55, (aircraft) => {
    aircraft.throttle = 1;
    aircraft.ctrl.de = kias(aircraft) > 60 ? clamp(3 * (8 * Math.PI / 180 - pitch(aircraft)) - 0.8 * aircraft.w.z, -1, 1) : 0;
    level(aircraft);
    if (aircraft.onGround) lastGroundX = aircraft.pos.x;
    else if (liftOff === null && kias(aircraft) > 45) liftOff = kias(aircraft);
  });
  close(`${mass} kg ground roll`, lastGroundX, reference, 40, 'm');
  console.log(`${mass} kg liftoff: ${liftOff.toFixed(1)} kt EAS (simulation only)`);
  assert.ok(liftOff > 58 && liftOff < 80);
}

for (const [mass, reference] of [[1280, 690], [1310, 651]]) {
  const model = make(100, 72 / KT, false, mass); model.setFlaps(0); model.flaps = 0; model.setEngines(1);
  let targetPitch = pitch(model), altitudeAt60 = 0, speedSum = 0, samples = 0;
  fly(model, 120, (aircraft, time) => {
    targetPitch = clamp(targetPitch + (kias(aircraft) - 72) * 0.002 * DT * 15, -0.35, 0.3);
    aircraft.ctrl.de = clamp(3 * (targetPitch - pitch(aircraft)) - 0.8 * aircraft.w.z, -1, 1);
    level(aircraft);
    if (time >= 60 && !altitudeAt60) altitudeAt60 = aircraft.pos.y;
    if (time >= 60) { speedSum += kias(aircraft); samples++; }
  });
  close(`${mass} kg low-altitude climb`, (model.pos.y - altitudeAt60) / 60 * 60 * FT, reference, 110, 'ft/min');
  console.log(`climb speed: ${(speedSum / samples).toFixed(1)} kt EAS; simulated pilot target 72 kt`);
  assert.ok(Math.abs(speedSum / samples - 72) <= 5);
}

for (const flaps of [0, 42]) {
  const model = make(600, 85 / KT, false, 1280); model.flaps = flaps; model.setFlaps(flaps ? 2 : 0); model.setEngines(0);
  let integral = 0, stallSpeed = null;
  fly(model, 50, (aircraft) => {
    const error = (600 - aircraft.pos.y) / 30 - aircraft.vel.y / 6;
    integral = clamp(integral + error * DT * 0.5, -2, 2);
    aircraft.ctrl.de = clamp(0.5 * error + 0.3 * integral - 0.6 * aircraft.w.z, -1, 1);
    aircraft.throttle = 0; level(aircraft);
    if (aircraft.out.alpha >= stallAlpha(flaps)) { stallSpeed = kias(aircraft); return false; }
  });
  assert.notEqual(stallSpeed, null, `flaps ${flaps} dynamic stall was not reached`);
  close(`1280 kg dynamic stall flaps ${flaps}`, stallSpeed, flaps ? 58 : 63, 5, 'kt EAS ≈ CAS');
}

{
  const altitude = 14000 / FT, model = make(altitude, 124 / KT);
  const throttle = (0.6 - 0.045) / 0.955;
  model.setEngines(throttle); let integral = 0;
  fly(model, 360, (aircraft) => {
    const error = (altitude - aircraft.pos.y) / 30 - aircraft.vel.y / 6;
    integral = clamp(integral + error * DT * 0.5, -2, 2);
    aircraft.ctrl.de = clamp(0.5 * error + 0.3 * integral - 0.6 * aircraft.w.z, -1, 1);
    aircraft.throttle = throttle; level(aircraft);
  });
  close('cruise', model.out.V * KT, 124, 8, 'kt TAS');
  close('fuel flow', model.out.ff * 3600 / 0.8, 19.3, 1.5, 'L/h');
  assert.ok(Math.abs(model.pos.y - altitude) < 50);
}
assert.deepEqual(failures, []);
console.log('da40-performance-test ok');
