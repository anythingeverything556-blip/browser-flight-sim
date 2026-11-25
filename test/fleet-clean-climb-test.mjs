// Additional sustained manual-control evidence; no autopilot, state clamps or force injections.
// These are engineering regressions, not flight-test trajectory validation.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { C172Model } from '../src/c172.js';
import { DA40Model } from '../src/da40.js';
import { SF50Model, SF50 } from '../src/sf50.js';
import { IL76Model, IL76 } from '../src/il76.js';
import { isa } from '../src/atmosphere.js';
import { trueAirspeedFromCas } from '../src/airdata.js';
const KT = 1.943844, dt = 1 / 120, calm = new THREE.Vector3(), flat = () => 0;
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const pitch = f => Math.asin(clamp(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y));
const cases = [
 { name: 'C172S', make: () => new C172Model(), speed: 74, min: 400, max: 1100 },
 { name: 'DA40 NG', make: () => new DA40Model(), speed: 72, min: 500, max: 1100 },
 { name: 'SF50 G3 MTOW', make: () => { const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; return f; }, speed: 170, min: 1000, max: 2400 },
 { name: 'Il76MD-90A 190t realistic', make: () => { const f = new IL76Model(); f.setMode('realistic'); f.fuel = 190000 - IL76.EMPTY - IL76.PAYLOAD; return f; }, speed: 450 / 1.852, rate: 0.0002, speedPitch: 0.004, min: 1800, max: 5000 },
];
const rows = [];
for (const c of cases) {
 const f = c.make(), height = c.height ?? 300;
 const tas = trueAirspeedFromCas(c.speed / KT, isa(height));
 f.reset(new THREE.Vector3(0, height, 0), 90, tas, false);
 if (f.setFlaps) f.setFlaps(0); f.flaps = 0;
 if ('slats' in f) f.slats = 0;
 if (!['c172', 'da40'].includes(f.type)) { f.gearDown = false; f.gearPos = 0; }
 f.unlimitedFuel = true; f.throttle = 1;
 let target = pitch(f), start = null, minSpeed = Infinity, maxAlpha = -Infinity;
 for (let i = 0; i < 180 / dt; i++) {
   const speed = (f.out.ias ?? f.vel.length() * Math.sqrt(isa(f.pos.y).rho / 1.225)) * KT;
   target = clamp(target + (speed - c.speed) * (c.rate ?? 0.001) * dt, -0.2, 0.35);
   const want = clamp(target + (c.speedPitch ?? 0) * (speed - c.speed), -0.2, 0.35);
   f.ctrl.de = clamp(3 * (want - pitch(f)) - 1.2 * f.w.z);
   const right = new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat);
   f.ctrl.da = clamp(-2 * Math.asin(clamp(-right.y)) - 0.5 * f.w.x);
   f.ctrl.dr = clamp(3 * (f.out.beta || 0) + 0.3 * f.w.y);
   f.step(dt, flat, calm);
   assert.equal(f.crashed, null, `${c.name}: ${f.crashed}`);
   assert.ok([...f.pos.toArray(), ...f.vel.toArray(), ...f.quat.toArray()].every(Number.isFinite));
   if (i >= 150 / dt) { if (start === null) start = f.pos.y; minSpeed = Math.min(minSpeed, speed); maxAlpha = Math.max(maxAlpha, f.out.alpha); }
 }
 const row = { aircraft: c.name, massKg: f.mass, finalAltitudeM: f.pos.y, targetKt: c.speed, speedReference: 'CAS', minSpeedLast30sKt: minSpeed, finalClimbFpm: (f.pos.y - start) / 30 * 196.850394, maxAlphaLast30sDeg: maxAlpha * 180 / Math.PI };
 rows.push(row); console.log(JSON.stringify(row));
 assert.ok(row.finalClimbFpm > c.min && row.finalClimbFpm < c.max, JSON.stringify(row));
 assert.ok(minSpeed > c.speed * 0.9, 'pilot retains energy in sustained clean climb');
}
console.log('fleet-clean-climb-test ok');
