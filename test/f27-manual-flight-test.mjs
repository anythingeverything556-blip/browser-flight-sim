import assert from 'node:assert/strict';
import { isa } from '../src/atmosphere.js';
import { loadF27, fresh, run, iasKt, KT, DT, ground, wind } from './helpers/f27-fdm.mjs';
const api = await loadF27(), { F27, stallSpeed } = api;
const measureOnly = process.argv.includes('--measure');
const measurements = { source: process.env.F27_FDM_BASELINE ? 'saved-before' : 'current', approaches: [] };
// Both landing configurations: settle the actual force/moment integrator at a
// configuration-specific 1.3 Vs reference, no altitude/speed/pitch autopilot.
for (const mass of [15000, 18600]) for (const flaps of [26.5, 40]) {
  const target = 1.3 * stallSpeed(mass, flaps) * KT;
  const m = fresh(api, 1200, target, mass);
  m.flapCmd = flaps === 40 ? 4 : 3; m.flaps = flaps;
  m.gearDown = true; m.gearPos = 1;
  m.quat.identity(); m.vel.set(target / KT / Math.sqrt(isa(1200).rho / 1.225), 0, 0); m.trimLevel(-3);
  const start = m.pos.y, reference = m.vref();
  run(m, 60);
  const row = { massKg: mass, flapsDeg: flaps, expectedReferenceKt: target, modelReferenceKt: reference, finalKias: iasKt(m), heightChangeM: m.pos.y - start, finalStall: m.out.stall };
  measurements.approaches.push(row);
  if (!measureOnly) {
    assert.ok(Math.abs(reference - target) < 1e-9, 'reference uses actual flap setting and mass');
    assert.ok(Math.abs(m.vref(40) - 1.3 * stallSpeed(m.mass, 40) * KT) < 1e-9, 'explicit full-flap planning reference');
    assert.ok(Math.abs(iasKt(m) - target) < 3, 'approach speed stable without speed/pitch assists');
    assert.ok(m.pos.y - start < -100 && m.pos.y - start > -210, 'descending at approximately three degrees');
    assert.equal(m.out.stall, 0);
  }
}
{
  const m = fresh(api); m.setEngines(0.9);
  const before = { rpm: m.engines[0].rpm, otherPower: m.engines[1].power };
  m.engines[0].feather = true; m.updateEngines(0, isa(m.pos.y), 80);
  const atSelection = { rpm: m.engines[0].rpm, lit: m.engines[0].lit, ffKgS: m.engines[0].ff, powerW: m.engines[0].power, torqueNm: m.engines[0].torque, thrustN: m.engines[0].thrust };
  for (let i = 0; i < 5 / DT; i++) m.updateEngines(DT, isa(m.pos.y), 80);
  measurements.feather = { beforeRpm: before.rpm, atSelection, rpmAfter5s: m.engines[0].rpm, otherEnginePowerW: m.engines[1].power };
  if (!measureOnly) {
    assert.equal(atSelection.rpm, before.rpm, 'feather cannot teleport the geared rotor');
    assert.equal(atSelection.lit, false); assert.equal(atSelection.ffKgS, 0); assert.equal(atSelection.powerW, 0); assert.equal(atSelection.torqueNm, 0);
    assert.ok(atSelection.thrustN < 0, 'feathered engine supplies drag, not powered thrust');
    assert.ok(m.engines[0].rpm < before.rpm * 0.25 && m.engines[0].rpm > 0, 'continuous rundown retained');
    assert.equal(m.engines[1].power, before.otherPower, 'independent engines');
    m.engineRunning = false; m.engines[0].feather = false;
    m.updateEngines(0, isa(m.pos.y), 80);
    assert.equal(m.engines[0].lit, false, 'unfeather cannot override engine cutoff');
  }
}
{
  const m = fresh(api); m.flaps = 0; m.flapCmd = 0; m.gearDown = false; m.gearPos = 0;
  m.setEngines(0.9); m.throttle = 0; m.step(DT, ground, wind);
  const retard = { gearWarning: m.out.gearWarning, rpm: m.rpm };
  m.setEngines(0); m.throttle = 0.9; m.step(DT, ground, wind);
  const advance = { gearWarning: m.out.gearWarning, rpm: m.rpm };
  m.setEngines(0.9); m.leverTrim = [-0.6, 0]; m.step(DT, ground, wind);
  const leftLeverLow = m.out.gearWarning;
  measurements.gearWarning = { retard, advance, leftLeverLow };
  if (!measureOnly) {
    assert.equal(retard.gearWarning, true, 'horn follows retarded lever immediately, not spool lag');
    assert.equal(advance.gearWarning, false, 'advanced lever clears throttle warning during spool-up');
    assert.equal(leftLeverLow, true, 'either individual lever can trigger horn');
    m.gearDown = true; m.gearPos = 1; m.step(DT, ground, wind); assert.equal(m.out.gearWarning, false);
  }
}
{
  const m = fresh(api); m.setEngines(0.9);
  if (!measureOnly) {
    assert.equal(m.setFeather(-1), false); assert.equal(m.setFeather(2), false);
    assert.equal(m.setFeather(0.5), false);
    assert.equal(m.setFeather(0), true);
    assert.equal(m.engines[0].lit, false, 'public selection cuts fuel immediately');
  } else m.engines[0].feather = true;
  m.step(DT, ground, wind);
  const initialYawRate = m.w.y;
  run(m, 5);
  measurements.featherFlight = { initialYawRateRadS: initialYawRate, leftThrustN: m.engines[0].thrust, rightThrustN: m.engines[1].thrust, leftRpm: m.engines[0].rpm, leftFuelKgS: m.engines[0].ff, finalKias: iasKt(m) };
  if (!measureOnly) {
    assert.ok(initialYawRate > 0, 'live right engine yaws toward the feathered left engine');
    assert.ok(m.engines[0].thrust < 0 && m.engines[1].thrust > 0);
    assert.equal(m.engines[0].ff, 0);
    assert.equal(m.setFeather(0, false), true);
    assert.ok(m.engines[0].starting && !m.engines[0].lit, 'unfeather reuses existing simplified spool-up, no RPM reset');
  }
}
console.log(JSON.stringify(measurements, null, 2));
if (!measureOnly) console.log('f27-manual-flight-test ok');
