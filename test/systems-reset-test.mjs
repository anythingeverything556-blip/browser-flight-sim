import assert from 'node:assert/strict';
import { AircraftSystems } from '../src/systems.js';
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };

const run = { engineRpm: [90, 90], altitudeFt: 60000, fuelKg: 20000, fuelAftKg: 3000, afterburner: [true, true] };
const s = new AircraftSystems();
for (let i = 0; i < 3600; i++) s.step(1, run);
ok('an hour at 60,000 ft uses oxygen', s.oxygenQuantityPct < 100 && s.oxygenQuantityPct > 0, `${s.oxygenQuantityPct.toFixed(2)} %`);
const before = JSON.stringify(s.step(0, run));
for (let i = 0; i < 6000; i++) s.step(1, { ...run, active: false });
ok('minutes in the menu or paused change nothing', JSON.stringify(s.step(0, run)) === before, `${s.oxygenQuantityPct.toFixed(2)} % oxygen`);
s.reset();
const fresh = new AircraftSystems();
ok('reset gives a full oxygen supply and cold temperatures', s.oxygenQuantityPct === 100 && JSON.stringify(s.step(0, run)) === JSON.stringify(fresh.step(0, run)));
console.log('all systems reset tests passed');
