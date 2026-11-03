import assert from 'node:assert/strict';
import { marchSteps } from '../src/vclouds.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const base = 1800, top = 4300;
check('full step count inside the layer and within 2 km of it', () => {
  for (const alt of [0, base - 2000, base, 3000, top, top + 2000]) assert.equal(marchSteps(48, alt, base, top), 48, `alt ${alt}`);
});
check('fewer steps further away, never rising with distance, half from 15 km', () => {
  let prev = 48; for (let d = 2000; d <= 30000; d += 500) { const n = marchSteps(48, top + d, base, top); assert.ok(n <= prev, `${d}`); prev = n; }
  assert.equal(marchSteps(48, top + 15000, base, top), 24); assert.equal(marchSteps(48, 25000, base, top), 24); // Mach 3 cruise height above a low layer
});
check('a high layer seen from the runway is also marched with fewer steps; floor of 12', () => {
  assert.ok(marchSteps(48, 0, 16000, 18000) < 48); assert.equal(marchSteps(16, 30000, base, top), 12);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('cloud steps OK');
