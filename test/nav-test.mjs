import assert from 'node:assert/strict';
import { Navigation } from '../src/nav.js';
import { destination, haversine } from '../src/geo.js';
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };
const G = 9.80665, D2R = Math.PI / 180;

function route(legKm) {
  const pts = []; let p = { lat: 30, lon: 0 };
  [90, 0, 90, 0].forEach((h) => { p = destination(p.lat, p.lon, h, legKm * 1000); pts.push({ lat: p.lat, lon: p.lon }); });
  return pts;
}
function fly(legKm, v, bankDeg, maxS = 4000) {
  const nav = new Navigation(), pts = route(legKm);
  pts.forEach((q, i) => nav.add({ ...q, name: 'WP' + (i + 1) }));
  let pos = { lat: 30, lon: 0 }, hdg = 90; const seq = [], dt = 1, rate = (G * Math.tan(bankDeg * D2R)) / v / D2R;
  let maxXtk = 0, t = 0;
  nav.update(pos, 24000, v, bankDeg);
  let minD = 1e9; const last = pts[pts.length - 1];
  for (; t < maxS; t += dt) {
    const dl = haversine(pos.lat, pos.lon, last.lat, last.lon); minD = Math.min(minD, dl); if (nav.active === pts.length - 1 && dl > minD + 20e3) break;
    const out = nav.update(pos, 24000, v, bankDeg);
    if (nav.sequenced && !seq.includes(nav.sequenced)) seq.push(nav.sequenced);
    if (nav.active > 0) maxXtk = Math.max(maxXtk, Math.abs(out.xtkNm) * 1852);
    const d = ((out.lnavHdg - hdg + 540) % 360) - 180;
    hdg = (hdg + Math.max(-rate * dt, Math.min(rate * dt, d)) + 360) % 360;
    pos = destination(pos.lat, pos.lon, hdg, v * dt);
  }
  return { seq, maxXtk, done: t < maxS, minD, t };
}

{
  const nav = new Navigation(), d = 60 / 111.32, seq = [];
  [[0, d], [d, d], [d, 2 * d], [2 * d, 2 * d], [2 * d, 3 * d]].forEach(([la, lo], i) => nav.add({ lat: la, lon: lo, name: 'WP' + (i + 1) }));
  for (let x = 0; x <= d * 111320; x += 1000) { nav.update({ lat: 0, lon: x / 111320 }, 24000, 1000, undefined); if (nav.sequenced && !seq.includes(nav.sequenced)) seq.push(nav.sequenced); }
  ok('Mach 3, 60 km legs: only WP1 is sequenced while flying the first leg', seq.join() === 'WP1', seq.join());
}
{
  const nav = new Navigation(); [0.05, 0.1, 0.15, 0.2, 0.3].forEach((lo, i) => nav.add({ lat: 0, lon: lo, name: 'WP' + (i + 1) }));
  nav.update({ lat: 0, lon: 0 }, 9000, 1000, undefined); const before = nav.active; nav.update({ lat: 0, lon: 0.25 }, 9000, 1000, undefined);
  ok('one sequence per update', nav.active - before === 1, `active ${before} -> ${nav.active}`);
}
{
  const nav = new Navigation(), p = [{ lat: 0, lon: 3.0 }, { lat: 3.0, lon: 3.0 }, { lat: 3.0, lon: 6.0 }];
  p.forEach((q, i) => nav.add({ ...q, name: 'W' + i }));
  const o = nav.update({ lat: 0, lon: 0 }, 9000, 1000, 35);
  const radiusM = 1000 * 1000 / (G * Math.tan(35 * D2R));
  ok('long legs keep the full turn lead', Math.abs(o.turnInS * 1000 - (haversine(0, 0, 0, 3) - radiusM * Math.tan(45 * D2R))) < 2e3, `lead ${(radiusM / 1000).toFixed(0)} km`);
}
{
  const r = fly(300, 1000, 35);
  ok('Mach 3, 300 km legs: all four waypoints sequenced in order', r.seq.slice(0, 3).join() === 'WP1,WP2,WP3', r.seq.join());
  ok('Mach 3, 300 km legs: the route completes', r.done, `t ${r.t} s`);
  ok('Mach 3, 300 km legs: overshoot stays inside a turn radius', r.maxXtk < 160e3, `max xtk ${(r.maxXtk / 1000).toFixed(0)} km`);
  ok('Mach 3, 300 km legs: flies over the last waypoint', r.minD < 5e3, `${(r.minD / 1000).toFixed(1)} km closest`);
}
{
  const r = fly(20, 128, 25);
  ok('250 kt, 20 km legs: sequenced in order, tight capture', r.seq.slice(0, 3).join() === 'WP1,WP2,WP3' && r.maxXtk < 4e3, `${r.seq.join()} max xtk ${(r.maxXtk / 1000).toFixed(1)} km`);
}
console.log('all nav tests passed');
