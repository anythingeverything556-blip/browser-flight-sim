import assert from 'node:assert/strict';
import { F27Model, F27 } from '../src/f27.js';
import { isa } from '../src/atmosphere.js';
const atm = isa(0);
const advance = (m, seconds, speed = 0, dt = 1 / 120) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) m.updateEngines(dt, atm, speed);
};
// Normal parked cutoff cannot teleport a rotor to rest. Combustion stops NOW;
// its rotational inertia never creates fuel flow, powered torque or thrust.
const m = new F27Model(); m.onGround = true; m.throttle = 0;
const rpm = m.engines.map(e => e.rpm); m.setEngineRunning(false);
assert.deepEqual(m.engines.map(e => e.rpm), rpm);
assert.ok(m.engines.every(e => !e.lit && !e.starting && e.ff === 0 && e.power === 0 && e.thrust === 0));
advance(m, 1); const after1 = m.rpm;
assert.ok(after1 > 5000 && after1 < 5500);
assert.equal(m.propRpm, m.rpm * F27.GEAR_RATIO);
advance(m, 4); const after5 = m.rpm;
assert.ok(after5 > 1400 && after5 < 1600);
assert.ok(m.engines.every(e => !e.lit && e.ff === 0 && e.power === 0 && e.thrust === 0));
// Restart an already rotating rotor: no RPM reset and no second-engine coupling.
m.setEngineRunning(true); assert.equal(m.rpm, after5);
advance(m, 12); assert.ok(m.engines.every(e => e.lit && !e.starting && e.rpm > 6800));
m.throttle = 1; advance(m, 20); m.failEngine(0);
const right = {...m.engines[1]}, left = m.engines[0].rpm;
advance(m, 1);
assert.ok(!m.engines[0].lit && !m.engines[0].starting && m.engines[0].rpm < left && m.engines[0].rpm > left * 0.7);
assert.equal(m.engines[0].power, 0); assert.equal(m.engines[0].ff, 0); assert.ok(m.engines[0].thrust === 0);
assert.ok(m.engines[1].lit && m.engines[1].rpm >= right.rpm && m.engines[1].power > 0);
m.failEngine(0, false); const restartRpm = m.engines[0].rpm; m.updateEngines(0, atm, 0);
assert.equal(m.engines[0].rpm, restartRpm, 'failure recovery cannot reset rotational state');
advance(m, 15); assert.ok(m.engines.every(e => e.lit && e.rpm > 14900));
// Fuel-empty high-speed windmill is rotating, unlit and NOT starting. Thrust is drag only.
m.fuel = 0; advance(m, 10, 70);
assert.ok(m.engines.every(e => !e.lit && !e.starting && e.rpm > 4000 && e.ff === 0 && e.power === 0 && e.thrust < 0));
advance(m, 45); assert.ok(m.engines.every(e => e.rpm === 0 && e.propRpm === 0));
const cold = new F27Model(); cold.setEngineRunning(false, {immediate:true});
assert.ok(cold.engines.every(e => e.rpm === 0 && e.propRpm === 0 && !e.lit && !e.starting));
const a = new F27Model(), b = new F27Model(); a.setEngineRunning(false); b.setEngineRunning(false);
advance(a, 5, 0, 1/30); advance(b, 5, 0, 1/120);
assert.ok(Math.abs(a.rpm - b.rpm) < 1e-8, 'rundown is frame-rate independent');
console.log(JSON.stringify({pass:true,cutoffRpm:rpm[0],after1s:after1,after5s:after5,rundownTauSeconds:3.2}));
