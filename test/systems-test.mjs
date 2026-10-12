import assert from 'node:assert/strict';
import { AircraftSystems } from '../src/systems.js';

const inputs = {
  altitudeFt: 0,
  engineRpm: [0, 0],
  gearMoving: false,
  fuelKg: 10000,
  fuelAftKg: 2000,
  lightsOn: false,
};
const advance = (systems, seconds, state) => {
  let output;
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) output = systems.step(Math.min(0.25, seconds - elapsed), state);
  return output;
};

const cold = new AircraftSystems();
const stopped = cold.step(0, inputs);
assert.equal(stopped.busVoltageV, 24.1);
assert.equal(stopped.busCurrentA, 20);
assert.equal(stopped.oxygenQuantityPct, 100);

const runningInput = { ...inputs, engineRpm: [75, 72], lightsOn: true };
const running = advance(cold, 60, runningInput);
assert.equal(running.busVoltageV, 28.2);
assert.ok(running.busCurrentA > 200);
assert.ok(running.oilPressurePsi[0] > 50);
assert.ok(running.oilTemperatureC[0] > 35);

const pressure = new AircraftSystems();
const moving = { ...runningInput, gearMoving: true };
const initialHyd = pressure.step(0, runningInput).hydraulicPressureKpsi[0];
const sagged = advance(pressure, 8, moving).hydraulicPressureKpsi[0];
assert.ok(sagged < initialHyd - 0.3, `expected hydraulic sag: ${initialHyd} -> ${sagged}`);
const recovered = advance(pressure, 20, runningInput).hydraulicPressureKpsi[0];
assert.ok(recovered > sagged + 0.3, `expected hydraulic recovery: ${sagged} -> ${recovered}`);

const highAltitude = new AircraftSystems();
const cabinAt25k = highAltitude.step(0, { ...runningInput, altitudeFt: 25000 });
const cabinAt50k = highAltitude.step(0, { ...runningInput, altitudeFt: 50000 });
assert.ok(cabinAt50k.cabinAltitudeFt > cabinAt25k.cabinAltitudeFt);
assert.ok(cabinAt50k.differentialPressurePsi <= 5.6);
const oxygenBefore = cabinAt25k.oxygenQuantityPct;
const oxygenAfter = advance(highAltitude, 120, { ...runningInput, altitudeFt: 50000 }).oxygenQuantityPct;
assert.ok(oxygenAfter < oxygenBefore);

const tankTotal = running.fuelTanksLb.reduce((sum, quantity) => sum + quantity, 0);
assert.ok(Math.abs(tankTotal - inputs.fuelKg * 2.20462) < 1e-8);
assert.ok(Math.abs(running.fuelTanksLb.slice(3).reduce((sum, quantity) => sum + quantity, 0) - inputs.fuelAftKg * 2.20462) < 1e-8);
assert.ok(running.fuelTanksLb[0] > running.fuelTanksLb[3]);

console.log('systems-test: pass');
