import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };

const KEEP = new Set(['fuel', 'unlimitedFuel', 'latDeg', 'sasOn', 'realism', 'crashOff', 'antiSkid']);
const plain = (v) => v instanceof THREE.Vector3 ? ['v3', v.x, v.y, v.z] : v instanceof THREE.Quaternion ? ['q', v.x, v.y, v.z, v.w]
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, plain(v[k])])) : typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v;
const state = (f) => Object.fromEntries(Object.keys(f).filter((k) => !KEEP.has(k)).sort().map((k) => [k, plain(f[k])]));
const diff = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

function dirty(f) {
  const n = (x) => (typeof x === 'number' ? x : NaN);
  f.pos.set(NaN, 1e6, -5e5); f.vel.set(NaN, 900, -3); f.quat.set(0.3, NaN, 0.1, 0.2); f.w.set(NaN, 2, 9);
  f.fuelAft = NaN; f.cgx = NaN; f.throttle = NaN; f.spool = NaN; f.gearPos = 0.37; f.gearDown = false;
  for (const e of f.engines) for (const k of Object.keys(e)) e[k] = typeof e[k] === 'number' ? NaN : e[k];
  f.engines.forEach((e) => { e.dry = 0.4; e.ab = 0.9; e.spike = 7; e.stress = 3; e.thrust = NaN; });
  f.chute = 'deployed'; f.chuteOpen = 0.8; f.trim = NaN;
  f.brakes = 1; f.parkingBrake = true;
  f.ctrl = { de: NaN, da: 0.9, dr: -1 }; f.sas = { de: 0.5, da: NaN, dr: 0.3 }; f.surf = { de: NaN, da: 0.2, dr: 0.2 };
  f.out = { V: NaN, M: 9, qbar: NaN, alpha: 3, beta: NaN, rho: 0, a: 0, T: 0, nz: NaN, buffet: 4, stale: 1 };
  f.onGround = true; f.crashed = 'test crash'; f.crashVel = new THREE.Vector3(1, 2, 3); f.crashW = new THREE.Vector3(NaN, 0, 0); f.crashKind = 'ground'; f.crashInfo = { why: 'x' };
  f.contacts = [NaN, 5e5, 9]; f.compress = [0.4, NaN, 0.1]; f.wheel = [NaN, 400, 1]; f.brakePress = [1, NaN, 1];
  f.alphaPrev = 0.7; f.alphaDot = NaN; f.exceed = 9; f.inletStress = NaN; f.unstartCool = 4;
  f.events.push('crash', { type: 'touch' });
  f.fuel = NaN;
  return n;
}

let checked = 0;
for (const [label, args] of [['airborne', [new THREE.Vector3(0, 3000, 0), 90, 220, false, 0]], ['on the runway', [new THREE.Vector3(0, 2.42, 0), 270, 0, true, 0]], ['airborne with a climb angle', [new THREE.Vector3(100, 800, -40), 45, 140, false, 5]]]) {
  const fresh = new FlightModel(), used = new FlightModel();
  fresh.reset(...args.map((a) => (a instanceof THREE.Vector3 ? a.clone() : a)));
  dirty(used); used.reset(...args.map((a) => (a instanceof THREE.Vector3 ? a.clone() : a)));
  const d = diff(state(fresh), state(used)); checked = Object.keys(state(fresh)).length;
  ok(`reset after dirtying every field matches a new model (${label})`, d.length === 0, d.length ? `differs: ${d.join(', ')}` : `${checked} fields`);
  ok(`fuel NaN is replaced by a full load (${label})`, used.fuel === fresh.fuel && Number.isFinite(used.fuel));
  const wind = new THREE.Vector3(); let nan = false;
  for (let i = 0; i < 480; i++) { fresh.step(1 / 240, () => 0, wind); used.step(1 / 240, () => 0, wind); }
  const s = state(fresh), u = state(used), dd = diff(s, u);
  ok(`the same 2 s of flight after reset is identical (${label})`, dd.length === 0, dd.length ? `differs: ${dd.join(', ')}` : '');
}
{
  const f = new FlightModel(); f.fuel = 1234; f.reset(new THREE.Vector3(0, 100, 0), 0, 150, false, 0);
  ok('a finite fuel load survives reset (spawn sets it)', f.fuel === 1234);
}
console.log('all fdm reset tests passed');
