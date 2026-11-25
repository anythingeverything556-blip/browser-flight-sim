// Dynamic manual climb/drag/trim regression. No AP, automatic trim or injected forces.
// Figures below describe this approximation, not certified F27 performance.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isa } from '../src/atmosphere.js';
import { trueAirspeedFromCas } from '../src/airdata.js';
import { loadF27, fresh, run, iasKt, holdPitch, pitch, KT, DT, clamp } from './helpers/f27-fdm.mjs';
const api = await loadF27(), { F27, F27_CG, F27_FLAP_DEG } = api;
const measure = process.argv.includes('--measure'), rows = [];
function configure(m, flaps, gear, kias) {
  m.setFlaps(flaps); m.flaps = F27_FLAP_DEG[flaps]; m.gearDown = gear; m.gearPos = +gear;
  m.quat.identity(); m.vel.set(trueAirspeedFromCas(kias / KT, isa(m.pos.y)), 0, 0);
  m.trimLevel(); m.w.set(0, 0, 0);
}
function climb(name, { height = 1500, mass = 18349.6428063, flaps = 0, gear = false, rpm = 14200, target = 138 } = {}) {
  const m = fresh(api, height, target, mass); configure(m, flaps, gear, target);
  m.throttle = (rpm - 7000) / 8000; let want = pitch(m), start = null, sum = { pitch: 0, alpha: 0, thrust: 0, drag: 0, n: 0 };
  run(m, 180, (a, t) => {
    want = clamp(want + (iasKt(a) - target) * 0.001 * DT, -0.4, 0.35); holdPitch(a, want);
    if (t >= 150) { if (start === null) start = a.pos.y;
      sum.pitch += pitch(a); sum.alpha += a.out.alpha; sum.thrust += a.out.thrust;
      sum.drag += a.out.qbar * F27.S * a.out.CD; sum.n++;
    }
  });
  const row = { name, massKg: m.mass, finalAltitudeM: m.pos.y, finalKias: iasKt(m), climbFpm: (m.pos.y - start) / 30 * 196.850394,
    pitchDeg: sum.pitch / sum.n * 180 / Math.PI, alphaDeg: sum.alpha / sum.n * 180 / Math.PI,
    thrustN: sum.thrust / sum.n, dragN: sum.drag / sum.n, trim: m.trim, elevator: m.ctrl.de, stall: m.out.stall };
  rows.push(row); return row;
}
const clean = climb('clean 138 KIAS / climb RPM');
const takeoff = climb('16.5 deg flaps / gear up', { flaps: 2 });
const landing = climb('40 deg flaps / gear down', { flaps: 4, gear: true });
const heavy = climb('MTOW clean', { mass: F27.MTOW });
const high = climb('6000 m MTOW clean', { height: 6000, mass: F27.MTOW });
const idle = climb('idle clean', { rpm: 7000, height: 3000 });
// Real takeoff sequence: pilot pitches up, later lowers the nose for speed,
// selects gear/flaps normally; no airborne state teleport or instant engine spool.
{
 const m = new api.F27Model(); m.unlimitedFuel = true;
 m.reset(new THREE.Vector3(0, F27_CG.y, 0), 90, 0, true);
 m.setFlaps(2); m.flaps = F27_FLAP_DEG[2]; m.setTakeoffTrim();
 m.parkingBrake = true; m.throttle = 1; run(m, 12, a => holdPitch(a, 0));
 m.parkingBrake = false; m.ctrl.de = 0; let lift = null, roll = 0, want = 8 * Math.PI / 180;
 run(m, 150, (a, t) => {
   if (iasKt(a) > a.vSpeed(96)) holdPitch(a, want); else holdPitch(a, 0);
   if (a.onGround) roll = a.pos.x;
   if (lift === null && !a.onGround && iasKt(a) > 75) lift = { seconds: t, kias: iasKt(a) };
   if (lift && a.pos.y > 15) a.setGear(false);
   if (lift && a.pos.y > 60 && iasKt(a) > 110) a.setFlaps(0);
   if (lift && t > lift.seconds + 20) want = clamp(want + (iasKt(a) - 138) * 0.001 * DT, 0, 0.22);
 });
 rows.push({ name: 'manual takeoff and clean climb', lift, groundRollM: roll, heightAt150sM: m.pos.y, finalKias: iasKt(m), finalFlaps: m.flaps, gearPos: m.gearPos, stall: m.out.stall });
 if (!measure) { assert.ok(lift && lift.kias > 85 && lift.kias < 115); assert.ok(roll > 350 && roll < 1300);
  assert.ok(m.pos.y > 400 && m.flaps === 0 && m.gearPos === 0 && Math.abs(iasKt(m) - 138) < 8); }
}
// A steady trim solution must remain steady with neutral elevator. In particular,
// body-axis thrust must be resolved along/normal to the flight path, not equal drag.
for (const [height, kias, gamma, flaps, gear] of [[300, 100, -3, 4, true], [1000, 138, 4, 0, false], [3000, 138, 1, 2, false]]) {
 const m = fresh(api, height, kias); configure(m, flaps, gear, kias);
 m.quat.identity(); m.vel.set(trueAirspeedFromCas(kias / KT, isa(height)), 0, 0); m.trimLevel(gamma);
 const speed = m.vel.length(), vertical = m.vel.y;
 run(m, 30); const drift = { name: 'neutral-stick trim', height, kias, gamma, flapsDeg: m.flaps,
  speedDriftKt: (m.vel.length() - speed) * KT, verticalSpeedDriftMs: m.vel.y - vertical, pitchRateRadS: m.w.z };
 rows.push(drift);
 if (!measure) {
  assert.ok(Math.abs(drift.speedDriftKt) < 1.2, JSON.stringify(drift));
  assert.ok(Math.abs(drift.verticalSpeedDriftMs) < 0.6, JSON.stringify(drift));
  if (flaps === 0) assert.ok(Math.abs(drift.verticalSpeedDriftMs) < 0.35, 'clean climb trim retains the flight path without pilot correction');
  if (flaps === 4) assert.ok(Math.abs(drift.pitchRateRadS) < 0.0004, 'landing trim does not retain the old thrust-projection pitch drift');
 }
}
// Same indicated rotation speed at high fields requires higher TAS. The takeoff
// trim solver takes TAS; supplying raw indicated speed incorrectly increases CL.
for (const height of [0, 2500]) {
 const m = new api.F27Model(); m.unlimitedFuel = true;
 m.reset(new THREE.Vector3(0, height + F27_CG.y, 0), 90, 0, true); m.setFlaps(2);
 const cas = m.vSpeed(108) / KT, tas = trueAirspeedFromCas(cas, isa(m.pos.y));
 const expected = m.trimSolve(tas, 0, F27_FLAP_DEG[2], 1).trim, actual = m.setTakeoffTrim();
 rows.push({ name: 'takeoff trim IAS/TAS', fieldElevationM: height, selectedTrim: actual, expectedTrim: expected, tasKt: tas * KT, casKt: cas * KT });
 if (!measure) assert.ok(Math.abs(actual - expected) < 1e-10, 'takeoff trim resolves indicated speed into local true speed');
}
// Isolated engine sensitivity only: flight step() uses ISA, so weather's
// temperature is NOT a validated hot-day trajectory input in these models.
{
 const m = fresh(api), cold = isa(1500), hot = { ...cold, T: cold.T + 20 };
 hot.rho = cold.rho * cold.T / hot.T; hot.a = cold.a * Math.sqrt(hot.T / cold.T);
 const coldV = trueAirspeedFromCas(138 / KT, cold), hotV = trueAirspeedFromCas(138 / KT, hot);
 const coldT = 2 * m.engineThrust(14200, coldV, cold), hotT = 2 * m.engineThrust(14200, hotV, hot);
 rows.push({ name: 'ISA+20 isolated engine sensitivity, not dynamic weather', altitudeM: 1500,
   coldPairThrustN: coldT, hotPairThrustN: hotT, thrustReductionPct: 100 * (coldT - hotT) / coldT });
 if (!measure) assert.ok(hotT < coldT && hotT > coldT * 0.8);
}
if (!measure) {
 assert.ok(clean.climbFpm > 700 && clean.climbFpm < 1600);
 assert.ok(takeoff.climbFpm < clean.climbFpm - 200, 'takeoff drag costs climb');
 assert.ok(landing.climbFpm < takeoff.climbFpm - 500, 'landing configuration is not a clean climb');
 assert.ok(heavy.climbFpm < clean.climbFpm && high.climbFpm < heavy.climbFpm, 'weight and altitude penalty retained');
 assert.ok(idle.climbFpm < -500, 'no climb without excess power');
 for (const row of [clean, takeoff, landing, heavy, high, idle]) { assert.ok(Math.abs(row.finalKias - 138) < 5, JSON.stringify(row)); assert.equal(row.stall, 0); }
}
console.log(JSON.stringify({ measurementsOnly: measure, rows }, null, 2));
