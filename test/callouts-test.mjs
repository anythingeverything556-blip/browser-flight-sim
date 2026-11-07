import assert from 'node:assert/strict';
import { AltCallouts } from '../src/callouts.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
// a descent at vs ft/min from startFt to the ground, then a 4 s roll-out; throttle(aglFt) gives the thrust; returns [ [aglFt, key], ... ]
function fly({ startFt = 400, vs = -700, throttle = () => 0.3, dt = 1 / 60, len = () => 0.55 } = {}) {
  const c = new AltCallouts(), out = []; let h = startFt;
  for (let t = 0; t < 120; t += dt) {
    const onGround = h <= 0, s = { aglFt: Math.max(0, h), vsFpm: onGround ? 0 : vs, onGround, throttle: throttle(h, onGround), crashed: null };
    const k = c.step(s, dt, len); if (k) out.push([+s.aglFt.toFixed(1), k]);
    if (onGround && (t > 0) && out.length && h <= 0) { if ((c.groundT || 0) > 4) break; }
    h += (vs / 60) * dt;
  }
  return out;
}
check('a normal approach calls 100, 90 ... 10 in order, then Retard', () => {
  const keys = fly({ vs: -500, throttle: (h) => (h > 15 ? 0.3 : 0) }).map((x) => x[1]);
  assert.deepEqual(keys.slice(0, 10), ['h100', 'h90', 'h80', 'h70', 'h60', 'h50', 'h40', 'h30', 'h20', 'h10']); assert.equal(keys[10], 'retard');
});
check('Retard repeats while the thrust stays above idle, stops once it is idle', () => {
  const hold = fly({ vs: -500, throttle: () => 0.3 }).filter((x) => x[1] === 'retard').length; assert.ok(hold >= 2, `${hold} retards with thrust up`);
  const idle = fly({ vs: -500, throttle: (h) => (h > 5 ? 0.3 : 0) }).filter((x) => x[1] === 'retard').length; assert.equal(idle, 1);
});
check('a fast descent skips calls it has no time for instead of queueing stale ones', () => {
  const r = fly({ vs: -2400 }); const keys = r.map((x) => x[1]);
  assert.ok(keys.length < 11, keys.join(','));
  for (const [h, k] of r) if (k !== 'retard') assert.ok(Math.abs(h - +k.slice(1)) < 12, `${k} said at ${h} ft`);
});
check('nothing below 100 ft unless armed above 150 ft first (a ground start or a low take-off)', () => {
  const c = new AltCallouts(); let said = 0;
  for (let h = 0; h < 140; h += 1) if (c.step({ aglFt: h, vsFpm: 600, onGround: h === 0, throttle: 1 }, 0.1)) said++;
  for (let h = 140; h > 0; h -= 1) if (c.step({ aglFt: h, vsFpm: -600, onGround: false, throttle: 0.3 }, 0.1)) said++;
  assert.equal(said, 0);
});
check('a go-around re-arms: climbing back above 150 ft and descending again calls again', () => {
  const c = new AltCallouts(), keys = []; const step = (h, vs) => { const k = c.step({ aglFt: h, vsFpm: vs, onGround: false, throttle: 0.4 }, 0.05, () => 0.3); if (k) keys.push(k); };
  for (let h = 300; h > 60; h -= 0.5) step(h, -600); for (let h = 60; h < 400; h += 0.5) step(h, 900); for (let h = 400; h > 60; h -= 0.5) step(h, -600);
  assert.equal(keys.filter((k) => k === 'h100').length, 2, keys.join(','));
});
check('levelling off (no descent) holds the next call; a crash silences it', () => {
  const c = new AltCallouts(); c.step({ aglFt: 300, vsFpm: 0, onGround: false, throttle: 0.4 }, 0.1);
  assert.equal(c.step({ aglFt: 95, vsFpm: 0, onGround: false, throttle: 0.4 }, 0.1), null);
  assert.equal(c.step({ aglFt: 95, vsFpm: -500, onGround: false, throttle: 0.4 }, 0.1), 'h100');
  assert.equal(c.step({ aglFt: 85, vsFpm: -500, onGround: false, throttle: 0.4, crashed: 'x' }, 2), null);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('altitude call-outs OK');
