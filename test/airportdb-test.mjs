import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AirportDB } from '../src/airportdb.js';
import { haversine } from '../src/geo.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const load = async (data) => { const old = globalThis.fetch; globalThis.fetch = async () => ({ json: async () => structuredClone(data) }); try { return await new AirportDB().load('x'); } finally { globalThis.fetch = old; } };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const oldFlatten = (runways, lat, lon, h) => { // the allocating original: Runway.local() + a {f, h} per runway
  let best = null;
  for (const r of runways) {
    const { s, t } = r.local(lat, lon);
    const ds = Math.max(0, Math.abs(s) - (r.len / 2 + 300)), dt = Math.max(0, Math.abs(t) - (r.width / 2 + 120)), d = Math.hypot(ds, dt);
    const f = d > 450 ? null : { f: smooth(0, 450, d), h: r.surfaceAt(s) };
    if (f && (!best || f.f < best.f)) best = f;
  }
  if (!best) return h;
  return h === null ? best.h : best.h * (1 - best.f) + h * best.f;
};

const db = await load(raw);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const picks = [...new Set(['KSFO', 'KBAB', 'KLAX', 'EGLL', 'LFPG', 'KLTS', 'SAOL', 'RJTT', 'YSSY', 'UNHU', 'BGGH', 'NZCH'].map((i) => db.get(i)).filter(Boolean))];
let compared = 0, nearHits = 0;
for (const a of picks) {
  db.activeRunways = a.runways.concat(db.near(a.lat, a.lon, 45).slice(0, 6).flatMap((x) => x.a.runways)); db.setActiveBox();
  for (let i = 0; i < 4000; i++) {
    const near = i % 2 === 0, spread = near ? 0.012 : 0.6;
    const r = db.activeRunways[Math.floor(rnd() * db.activeRunways.length)];
    const lat = r.lat + (rnd() - 0.5) * spread, lon = r.lon + (rnd() - 0.5) * spread / Math.max(0.2, r.cos), h = i % 7 === 0 ? null : rnd() * 3000;
    const want = oldFlatten(db.activeRunways, lat, lon, h), got = db.flatten(lat, lon, h);
    assert.ok(want === got || Object.is(want, got), `flatten differs at ${lat},${lon},${h}: ${want} vs ${got}`);
    if (want !== h) nearHits++;
    compared++;
  }
}
assert.ok(nearHits > 2000, 'the sampling must exercise the levelled strips, not only the early-out');
{ // runways either side of the antimeridian
  const shift = (rec, id, dlon) => { const c = structuredClone(rec); c[0] = id; c[7] = c[7] + dlon; for (const w of c[9]) { w[3] += dlon; w[5] += dlon; } return c; };
  const ksfo = raw.find((x) => x[0] === 'KSFO'), dbA = await load([shift(ksfo, 'AM01', 122.38 + 179.98), shift(ksfo, 'AM02', 122.38 - 179.98)]);
  dbA.activeRunways = dbA.list.flatMap((x) => x.runways); dbA.setActiveBox();
  let hit = 0;
  for (let i = 0; i < 20000; i++) { const r = dbA.activeRunways[i & 1], lat = r.lat + (rnd() - 0.5) * 0.03, lon = ((r.lon + (rnd() - 0.5) * 0.06 + 540) % 360) - 180, want = oldFlatten(dbA.activeRunways, lat, lon, 50), got = dbA.flatten(lat, lon, 50); assert.equal(got, want, `antimeridian ${lat},${lon}`); if (want !== 50) hit++; }
  assert.ok(hit > 1000, 'antimeridian sampling reaches the strips');
}
assert.equal(db.flatten(0, 0, 123), 123, 'far from every active runway the terrain height passes through');
const empty = new AirportDB(); assert.equal(empty.flatten(1, 2, 5), 5, 'no active runways: pass-through');
console.log(`PASS flatten: ${compared} random points near and far, identical to the allocating original (${nearHits} on/near a strip)`);

const r0 = db.get('KSFO').runways[0], allocBefore = process.memoryUsage().heapUsed;
db.activeRunways = db.get('KSFO').runways; db.setActiveBox();
let acc = 0; for (let i = 0; i < 400000; i++) acc += db.flatten(r0.lat + (i % 1000) * 1e-4, r0.lon + 0.5, 10);
assert.ok(Number.isFinite(acc));
assert.ok(process.memoryUsage().heapUsed - allocBefore < 20e6, 'flatten allocates per call');
console.log('PASS flatten: no per-call allocation (400k calls)');

// airports whose runways all fail the 25 km sanity check are dropped; none of the data now needs it
const bad = structuredClone(raw.find((a) => a[0] === 'KSFO')); bad[0] = 'ZZBAD'; bad[1] = ''; bad[9] = [['16', '34', -22.1511, -65.5756, -22.1736, -65.5642, 100, 100, 30, 1, 0]];
const bad2 = structuredClone(bad); bad2[0] = 'ZZNONE'; bad2[9] = [];
const dbBad = await load([...raw.slice(0, 50), bad, bad2]);
assert.equal(dbBad.get('ZZBAD'), undefined); assert.equal(dbBad.get('ZZNONE'), undefined);
assert.ok(dbBad.list.every((a) => a.runways.length > 0 && a.longest && Number.isFinite(a.towerLatLon().lat)), 'every listed airport has a runway');
assert.equal(dbBad.list.length, 50);
console.log('PASS airportdb: airports without a usable runway are skipped, so longest/towerLatLon never throw');

// data: idents unique, every runway within 25 km of its airport, ident roughly matches the true heading
const seen = new Set(); for (const a of raw) { assert.ok(!seen.has(a[0].toUpperCase()), `duplicate ident ${a[0]}`); seen.add(a[0].toUpperCase()); }
assert.equal(db.list.length, raw.length, 'no airport lost to the runway sanity check');
for (const a of db.list) for (const r of a.runways) {
  assert.ok(haversine(a.lat, a.lon, r.a.lat, r.a.lon) < 25000 && haversine(a.lat, a.lon, r.b.lat, r.b.lon) < 25000, `${a.ident} ${r.name} far from airport`);
  const m = /^(\d{1,2})/.exec(r.leIdent);
  if (m && r.len > 150 && Math.abs(a.lat) < 70) { const idH = (+m[1] % 36) * 10, diff = Math.abs(((r.hdg - idH + 540) % 360) - 180); assert.ok(diff <= 40, `${a.ident} ${r.name}: ident ${idH} vs geometry ${r.hdg.toFixed(0)}`); }
}
for (const a of raw.filter((x) => x[8] === 0)) for (const w of a[9]) assert.ok(Math.abs(w[6]) < 300 && Math.abs(w[7]) < 300, `${a[0]} runway elevation far from airport elevation 0`);
for (const id of ['TJ-0011', 'KPRS', 'OEKF']) { const a = db.get(id); for (const r of a.runways) assert.ok(Math.abs(r.ea - a.elev) < 300 && Math.abs(r.eb - a.elev) < 300, `${id} elevation`); }
console.log('PASS airports.json: unique idents, runways near their airport, idents match the geometry, runway and airport elevations agree');
