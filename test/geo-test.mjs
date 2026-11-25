import assert from 'node:assert/strict';
import { Geo, wrapLon, dLon, lon2tx, tx2lon, R_EARTH, D2R } from '../src/geo.js';
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };

const g = new Geo(52.0, 179.95), ll = g.toLatLon(20000, 0);
ok('20 km east of 179.95 wraps to a negative longitude', ll.lon < -179 && ll.lon > -180, ll.lon.toFixed(4));
const tileLon = tx2lon(Math.floor(lon2tx(ll.lon, 14)) % (1 << 14), 14), p = g.toXZ(ll.lat, tileLon);
ok('the tile under the jet is placed near the origin, not 24,645 km away', Math.abs(p.x) < 50e3 && Math.abs(p.z) < 50e3, `x = ${(p.x / 1000).toFixed(1)} km`);
g.setOrigin(ll.lat, ll.lon);
ok('re-basing on the wrapped longitude keeps the origin in range', g.lon0 >= -180 && g.lon0 < 180, g.lon0.toFixed(4));
const back = g.toXZ(52.0, 179.95);
ok('a point west of the origin across the line is at x = -20 km', Math.abs(back.x + 20000) < 30, `x = ${back.x.toFixed(0)} m`);
const h = new Geo(0, -179.99);
ok('toXZ is symmetric over the line', Math.abs(h.toXZ(0, 179.99).x + 0.02 * D2R * R_EARTH) < 1, `x = ${h.toXZ(0, 179.99).x.toFixed(0)} m`);
let worst = 0;
for (const lon0 of [179.9, -179.9, 180, -180, 179.999, 0, 90, -90]) for (const dx of [-60000, -1, 0, 1, 60000]) {
  const q = new Geo(30, lon0), r = q.toLatLon(dx, 5000), b = q.toXZ(r.lat, r.lon);
  assert.ok(r.lon >= -180 && r.lon < 180, `lon ${r.lon} out of range`); worst = Math.max(worst, Math.abs(b.x - dx), Math.abs(b.z - 5000));
}
ok('toLatLon -> toXZ round trip across origins on and near the line', worst < 1e-3, `worst ${worst.toExponential(1)} m`);
ok('ordinary longitudes are unchanged', Math.abs(new Geo(10, 8.123456789).toLatLon(0, 0).lon - 8.123456789) < 1e-12);
ok('wrapLon and dLon', wrapLon(190) === -170 && wrapLon(-190) === 170 && wrapLon(180) === -180 && Math.abs(dLon(-179, 179) - 2) < 1e-9 && Math.abs(dLon(179, -179) + 2) < 1e-9);
console.log('all geo tests passed');
