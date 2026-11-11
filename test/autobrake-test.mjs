// Autobrake logic (src/autobrake.js): arming, touchdown, the held deceleration, take-over by the pilot, go-around, rejected take-off.
import assert from 'node:assert/strict';
import { Autobrake, AUTOBRAKE } from '../src/autobrake.js';
let fails = 0; const check = (name, fn) => { try { const r = fn(); console.log('PASS ', name, r ?? ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
// a 150 t aircraft rolling out: brake command 1 = 3.2 m/s2, plus 0.4 m/s2 of drag
const land = (a, { v0 = 65, pedalAt = Infinity, leverAt = Infinity, secs = 80 } = {}) => {
  let v = v0, x = 0, acc = 0, t = 0; const dt = 1 / 60, log = [];
  for (; t < secs && v > 0.5; t += dt) { const b = a.update({ onGround: true, gs: v, accel: acc, throttle: t > leverAt ? 0.8 : 0, pedal: t > pedalAt ? 0.6 : 0 }, dt); acc = -(0.4 + 3.2 * Math.max(b, t > pedalAt ? 0.6 : 0)); v += acc * dt; x += v * dt; log.push([t, b, acc]); }
  return { t, x, v, log };
};
const armed = (n) => { const a = new Autobrake(); for (let i = 0; i < n; i++) a.cycle(); a.update({ onGround: false, gs: 70, accel: 0, throttle: 0.3, pedal: 0 }, 0.1); return a; };
check('the key cycles OFF, LOW, MED, MAX and back to OFF', () => { const a = new Autobrake(); assert.deepEqual([a.cycle(), a.cycle(), a.cycle(), a.cycle()], ['LOW', 'MED', 'MAX', 'OFF']); assert.equal(AUTOBRAKE.length, 4); });
check('OFF never brakes', () => { const a = new Autobrake(); a.update({ onGround: false, gs: 70, accel: 0, throttle: 0, pedal: 0 }, 0.1); assert.equal(land(a, { secs: 5 }).log.every((r) => r[1] === 0), true); });
check('LOW holds about 1.2 m/s2 and MED about 2.0 m/s2 after touchdown; MAX is the full pedal and stops shortest', () => {
  const dec = (n) => { const r = land(armed(n)); const mid = r.log.filter((q) => q[0] > 6 && q[0] < 15); return [-mid.reduce((s, q) => s + q[2], 0) / mid.length, r.x]; };
  const [l, xl] = dec(1), [m, xm] = dec(2), [, xx] = dec(3);
  assert.ok(Math.abs(l - 1.2) < 0.15 && Math.abs(m - 2.0) < 0.15, `${l.toFixed(2)} / ${m.toFixed(2)} m/s2`); assert.ok(xx < xm && xm < xl, `${xl.toFixed(0)} > ${xm.toFixed(0)} > ${xx.toFixed(0)} m`);
  return `${l.toFixed(2)}, ${m.toFixed(2)} m/s2; ${xl.toFixed(0)} / ${xm.toFixed(0)} / ${xx.toFixed(0)} m`;
});
check('it waits for the thrust lever to close, and lets go when the lever goes up again (go-around) without switching off', () => {
  const a = armed(2); assert.equal(a.update({ onGround: true, gs: 60, accel: 0, throttle: 0.5, pedal: 0 }, 0.1), 0);
  assert.ok(a.update({ onGround: true, gs: 60, accel: 0, throttle: 0, pedal: 0 }, 0.1) > 0); assert.equal(a.update({ onGround: true, gs: 60, accel: 0, throttle: 0.8, pedal: 0 }, 0.1), 0); assert.equal(a.level, 2);
});
check('pressing the brakes takes over and switches it off', () => { const a = armed(2); const r = land(a, { pedalAt: 4 }); assert.equal(a.level, 0); assert.ok(r.log.filter((q) => q[0] > 4.1).every((q) => q[1] === 0)); });
check('it releases when the aircraft has stopped and does not brake a taxi or the next take-off roll', () => {
  const a = armed(3); land(a); assert.equal(a.active, false); assert.equal(a.level, 3);
  assert.equal(a.update({ onGround: true, gs: 8, accel: 0, throttle: 0, pedal: 0 }, 0.1), 0, 'taxi'); assert.equal(a.update({ onGround: true, gs: 30, accel: 2, throttle: 1, pedal: 0 }, 0.1), 0, 'take-off roll');
});
check('rejected take-off: closing the lever above 40 m/s on the roll brakes', () => { const a = new Autobrake(); a.cycle(); a.cycle(); a.cycle(); a.update({ onGround: true, gs: 55, accel: 2, throttle: 1, pedal: 0 }, 0.1); assert.equal(a.update({ onGround: true, gs: 55, accel: 0, throttle: 0, pedal: 0 }, 0.1), 1); });
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
