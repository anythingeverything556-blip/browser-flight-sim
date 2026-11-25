import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AirportDB } from '../src/airportdb.js';
import { Geo } from '../src/geo.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const old = globalThis.fetch; globalThis.fetch = async () => ({ json: async () => structuredClone(raw) });
const db = await new AirportDB().load('x'); globalThis.fetch = old;

// light i of runway r in the runway's own frame (s along, t across), recovered from its world position and the geo origin
const lightAt = (r, geo, i) => {
  const p = r.group.children[0].geometry.attributes.position.array, ll = geo.toLatLon(p[i * 3] + r.wx, p[i * 3 + 2] + r.wz);
  return { ...r.local(ll.lat, ll.lon), y: p[i * 3 + 1], lat: ll.lat, lon: ll.lon };
};
const pick = (id) => db.get(id).longest;
const farNorth = db.list.filter((a) => a.longest.len > 1200 && Math.abs(a.lat) < 85).sort((a, b) => Math.abs(b.lat) - Math.abs(a.lat))[0].longest;
const cases = [
  [pick('KEDW'), (r) => new Geo(r.lat, r.lon)],
  [pick('KBAB'), () => new Geo(39.1361, -121.4365)],
  [pick('KBAB'), () => new Geo(39.4, -121.0)],
  [pick('KSFO'), () => new Geo(37.0, -122.5)],
  [pick('ENGM'), () => new Geo(60.0, 11.0)],
  [farNorth, (r) => new Geo(r.lat - 0.27, r.lon + 0.3)],
  [pick('YSSY'), () => new Geo(-34.2, 150.9)],
];
let n = 0;
for (const [r, mk] of cases) {
  const geo = mk(r), W = r.width / 2, L = r.len / 2;
  r.group = null; r.buildLights(geo);
  // edge lights come first, in left/right pairs: 1.5 m outside the pavement edge, from one end to the other
  const nEdge = Math.floor((2 * L + 0.1) / 60 + 1) * 2;
  for (let k = 0; k < nEdge; k += 2) {
    const a = lightAt(r, geo, k), b = lightAt(r, geo, k + 1);
    assert.ok(Math.abs(a.t + W + 1.5) < 0.05 && Math.abs(b.t - W - 1.5) < 0.05, `${r.name} edge lights off the edges: ${a.t.toFixed(2)} / ${b.t.toFixed(2)}`);
    assert.ok(Math.abs(a.s) <= L + 0.05 && Math.abs(a.s - b.s) < 0.05, `${r.name} edge light off the runway length`);
    const f = r.flatF(a.lat, a.lon); assert.equal(f, 0, `${r.name} edge light is not on the levelled strip`);
    assert.ok(Math.abs(a.y - 0.4 - r.flatH) < 1e-3, `${r.name} edge light height vs levelled strip`);
    n++;
  }
  assert.ok(Math.abs(lightAt(r, geo, 0).s + L) < 0.05 && L - lightAt(r, geo, nEdge - 2).s < 60.1, `${r.name} edge lights do not span the runway`);
  // the runway ends, projected into the world, are where the threshold bars sit (green bar 2 m outside the end)
  const ends = [r.a, r.b].map((e) => geo.toXZ(e.lat, e.lon)), cx = ends[0].x - r.wx, cz = ends[0].z - r.wz;
  const p = r.group.children[0].geometry.attributes.position.array;
  let near = 1e9; for (let i = 0; i < p.length / 3; i++) near = Math.min(near, Math.hypot(p[i * 3] - cx, p[i * 3 + 2] - cz));
  assert.ok(near < 3, `${r.name} no light within 3 m of the runway end (${near.toFixed(1)} m)`);
  // world-frame heading of the lights' axis equals the world-frame bearing between the runway ends (no rotation)
  const l0 = lightAt(r, geo, 0), l1 = lightAt(r, geo, nEdge - 2), w0 = geo.toXZ(l0.lat, l0.lon), w1 = geo.toXZ(l1.lat, l1.lon);
  const dAxis = Math.atan2(w1.x - w0.x, -(w1.z - w0.z)), dEnds = Math.atan2(ends[1].x - ends[0].x, -(ends[1].z - ends[0].z));
  assert.ok(Math.abs(((dAxis - dEnds + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * r.len < 1, `${r.name} lights rotated against the runway`);
  r.disposeLights();
}
console.log(`PASS runway lights: ${n} edge-light pairs on the pavement edges, on the levelled strip, ends and axis agree, at ${cases.length} origins incl. ${farNorth.ap.ident} (lat ${farNorth.lat.toFixed(1)})`);

// an origin move rebuilds the lights in the new frame; positionLights keeps them on the runway relative to the camera
const scene = { added: 0, add() { this.added++; } }, geo = new Geo(39.1361, -121.4365), kb = pick('KBAB');
db.updateActive(39.1361, -121.4365, scene, geo, true);
assert.ok(kb.group, 'KBAB lights built');
const before = { wx: kb.wx, wz: kb.wz }, c0 = geo.toXZ(kb.lat, kb.lon);
assert.ok(Math.hypot(before.wx - c0.x, before.wz - c0.z) < 1e-6);
geo.setOrigin(39.3, -121.2);
assert.equal(db.updateActive(39.3, -121.2, scene, geo), true, 'origin move invalidates the lights');
const c1 = geo.toXZ(kb.lat, kb.lon);
assert.ok(Math.hypot(kb.wx - c1.x, kb.wz - c1.z) < 1e-6 && Math.hypot(kb.wx - before.wx, kb.wz - before.wz) > 1000, 'lights rebuilt around the new origin');
const cam = { x: c1.x + 120, y: kb.elev + 30, z: c1.z - 80 };
db.positionLights(cam, 1);
assert.ok(Math.abs(kb.group.position.x + 120) < 1e-6 && Math.abs(kb.group.position.z - 80) < 1e-6 && Math.abs(kb.group.position.y + cam.y) < 1e-9, 'group sits relative to the camera');
const g2 = lightAt(kb, geo, 0), g3 = lightAt(kb, geo, 1);
assert.ok(Math.abs(g2.t + kb.width / 2 + 1.5) < 0.05 && Math.abs(g3.t - kb.width / 2 - 1.5) < 0.05, 'edge lights still on the edges after the origin move');
db.activeRunways.forEach((r) => r.disposeLights());
console.log('PASS runway lights: an origin move rebuilds them and they stay on the runway');
