import assert from 'node:assert/strict';
import { createMission } from '../src/missions.js';
import { destination, bearing, haversine } from '../src/geo.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

// straight flight at 300 m/s on heading hdg, optionally steering to each target in turn
function fly(m, lat, lon, hdg, { steer = false, maxS = 3000 } = {}) {
  const evs = [];
  for (let t = 0; t < maxS && !m.done; t += 0.5) {
    let h = hdg;
    if (steer && m.targets[m.i]) h = bearing(lat, lon, m.targets[m.i].lat, m.targets[m.i].lon);
    const p = destination(lat, lon, h, 150); lat = p.lat; lon = p.lon;
    const ev = m.update(0.5, { lat, lon, hdg: h, M: 1, alt: 5000 });
    if (ev) evs.push(ev);
  }
  return evs;
}
const A = { lat: 35.0, lon: -117.0, hdg: 342 };

check('recon: steering to every target scores near full marks', () => {
  const m = createMission('recon', A); fly(m, A.lat, A.lon, A.hdg, { steer: true });
  assert.ok(m.done); assert.ok(m.total >= 350, 'total ' + m.total);
  assert.ok(m.targets.every((t) => t.score > 0));
});
check('recon: flying straight misses the offset targets but hits T1', () => {
  const m = createMission('recon', A); fly(m, A.lat, A.lon, A.hdg);
  assert.ok(m.targets[0].score >= 90, 'T1 ' + m.targets[0].score);
  assert.equal(m.targets[1].score, 0);   // 6 km off the track
  assert.ok(m.done);
});
check('recon: hud lists next target bearing and score', () => {
  const m = createMission('recon', A); m.update(0.5, { lat: A.lat, lon: A.lon, hdg: A.hdg, M: 0, alt: 0 });
  const h = m.hud(); assert.equal(h.title, 'RECON RUN'); assert.ok(h.lines.join('').includes('T1'));
});
check('high & fast: needs M3 above 70,000 ft held 20 s', () => {
  const m = createMission('highfast', A); let done = null;
  for (let t = 0; t < 19; t += 0.5) m.update(0.5, { lat: 0, lon: 0, hdg: 0, M: 3.2, alt: 22000 });
  assert.ok(!m.done, 'not done at 19 s');
  for (let t = 0; t < 3; t += 0.5) done = m.update(0.5, { lat: 0, lon: 0, hdg: 0, M: 3.2, alt: 22000 }) || done;
  assert.ok(m.done && done && done.event === 'done');
});
check('high & fast: too low or too slow does not count', () => {
  const m = createMission('highfast', A);
  for (let t = 0; t < 60; t += 0.5) m.update(0.5, { lat: 0, lon: 0, hdg: 0, M: 3.2, alt: 15000 });
  for (let t = 0; t < 60; t += 0.5) m.update(0.5, { lat: 0, lon: 0, hdg: 0, M: 2.0, alt: 22000 });
  assert.ok(!m.done);
});
check('free flight and guided flight create no scored mission', () => { assert.equal(createMission('free', A), null); assert.equal(createMission('tour', A), null); });
if (fails) { console.log(`\n${fails} failed`); process.exit(1); } else console.log('\nall mission tests passed');
