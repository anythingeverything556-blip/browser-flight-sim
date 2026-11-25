// The water-ditch check exempts runways of airports found by db.near(lat, lon, R): R must cover the far runway ends of big airports.
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const RAD = 6 * 1000, OLD = 1.5 * 1000, D = Math.PI / 180, R = 6371008.8;
const hav = (a, b, c, d) => { const x = Math.sin((c - a) * D / 2) ** 2 + Math.cos(a * D) * Math.cos(c * D) * Math.sin((d - b) * D / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); };
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fail++; };
const farEnd = (ap) => Math.max(...ap[9].flatMap((r) => [hav(ap[6], ap[7], r[2], r[3]), hav(ap[6], ap[7], r[4], r[5])]));
for (const id of ['KJFK', 'VHHH', 'LFPG', 'KSFO']) {
  const ap = data.find((a) => a[0] === id); const d = farEnd(ap);
  ok(d > OLD && d < RAD, `${id}: farthest runway end ${(d / 1000).toFixed(2)} km from the airport point (old radius 1.5 km missed it, new 6 km covers it)`);
}
let ends = 0, beyondOld = 0, beyondNew = 0;
for (const ap of data) { if (!Array.isArray(ap[9])) continue; for (const r of ap[9]) for (const [la, lo] of [[r[2], r[3]], [r[4], r[5]]]) { if (!Number.isFinite(la)) continue; const d = hav(ap[6], ap[7], la, lo); ends++; if (d > OLD) beyondOld++; if (d > RAD) beyondNew++; } }
ok(beyondNew * 500 < ends, `runway ends outside the radius worldwide: ${beyondOld} of ${ends} at 1.5 km, ${beyondNew} at 6 km`);
if (fail) process.exit(1); console.log('ditch radius tests passed');
