import assert from 'node:assert/strict';
import { vrefEas, minSpeedEas } from '../src/autopilot.js';
import { liftCoef, SPEC } from '../src/flight.js';
import { scoreLanding } from '../src/missions.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const KT = 1.943844, D = 180 / Math.PI;
// angle of attack that holds 1 g at this EAS and mass (low Mach, out of ground effect)
const aoaFor = (eas, mass) => { let lo = 0, hi = 0.45; for (let i = 0; i < 60; i++) { const a = (lo + hi) / 2; if (0.5 * 1.225 * eas * eas * SPEC.S * liftCoef(a, 0.25) > mass * 9.80665) hi = a; else lo = a; } return lo * D; };
const STRIKE = 14.9; // nozzle strike pitch with 6 deg of bank, static gear (deep-fdm/d3-strike-geom: 16.3 level)
check('touchdown reference keeps the AOA near 11 deg at every landing weight', () => {
  for (const m of [38000, 45000, 50000, 55600]) { const a = aoaFor(vrefEas(m), m); assert.ok(a > 10 && a < 12, `${m} kg: ${a.toFixed(1)} deg at ${(vrefEas(m) * KT).toFixed(0)} kt`); }
});
check('pitch at the reference on a 2 m/s sink leaves >= 5 deg to a banked nozzle strike; the old 160 kt target left < 1 deg at full weight', () => {
  for (const m of [45000, 55600]) { const v = vrefEas(m), pitch = aoaFor(v, m) - Math.asin(2 / v) * D; assert.ok(STRIKE - pitch >= 5, `${m}: pitch ${pitch.toFixed(1)}`); }
  const v160 = 160 / KT, old = aoaFor(v160, 55600) - Math.asin(2 / v160) * D; assert.ok(STRIKE - old < 1, `old ${old.toFixed(1)}`);
});
check('reference sits just above the AOA-protection speed (the landing aid flare floor)', () => {
  for (const m of [40000, 55600]) assert.ok(Math.abs(vrefEas(m) / minSpeedEas(m, 0.25) - 1.1) < 1e-9);
});
check('landing score: slow (nose-high) touchdowns no longer earn the speed points, near the reference does', () => {
  const td = (kt) => ({ sink: 1, kt, vref: 180, off: 2, dist: 400, belly: false });
  assert.equal(scoreLanding(td(185)).spd, 20); assert.equal(scoreLanding(td(160)).spd, 0); assert.equal(scoreLanding(td(170)).spd, 14);
  assert.match(scoreLanding(td(158)).tips.join(' '), /tail strike/); assert.match(scoreLanding(td(215)).tips.join(' '), /fast/);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('landing reference OK');
