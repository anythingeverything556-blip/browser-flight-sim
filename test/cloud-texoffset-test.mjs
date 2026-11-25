// The cloud shaders get small camera-relative positions plus per-lookup fractional offsets (cloudlayer.js cloudTexOffsets) instead of
// absolute positions of ~10^5-10^6 m, which made the clouds grainy and flicker on Direct3D (Chrome on Windows). The split must sample the
// same point of each repeating noise texture: (small + offset) * scale + frac(offset * scale) differs from the absolute coordinate by an integer.
import assert from 'node:assert/strict';
import { cloudTexOffsets, cloudAnchor } from '../src/cloudlayer.js';

// per lookup: offset's coordinate (x, z) from the offset in metres, as the shaders build them (vclouds.js density() and cirrus)
const LOOKUPS = [
  (x, z) => [x / 3400, z / 3400], (x, z) => [(0.8 * x - 0.6 * z) / 8800, (0.6 * x + 0.8 * z) / 8800],
  (x, z) => [(0.28 * x + 0.96 * z) / 26000, (-0.96 * x + 0.28 * z) / 26000], (x, z) => [x / 900, z / 900],
  (x, z) => [x / 26000, z / 7000], (x, z) => [x / 9500, z / 3000],
];
const a = cloudAnchor(39.136, -121.436, new Date('2026-11-04T12:00:00Z'));
let worst = 0;
for (const [ox, oz] of [[a.x, a.z], [a.x + 123456.7, a.z - 98765.4], [524287.9, 524287.9], [-3.2e5, 7.7e5], [0, 0]]) {
  const T = cloudTexOffsets(ox, oz), flat = [...T[0], ...T[1], ...T[2]];
  for (const v of flat) assert.ok(v >= 0 && v < 1, `offset ${v} not in [0, 1)`);
  for (const [rx, rz] of [[0, 0], [1234.5, -6789], [-70000, 70000]]) {
    LOOKUPS.forEach((f, k) => {
      const abs = f(ox + rx, oz + rz), small = f(rx, rz), off = [flat[2 * k], flat[2 * k + 1]];
      for (let c = 0; c < 2; c++) { const d = abs[c] - (small[c] + off[c]), e = Math.abs(d - Math.round(d)); worst = Math.max(worst, e); assert.ok(e < 1e-6, `lookup ${k}: off by ${e} of a tile`); }
      // and the GPU now sees coordinates under ~80 tiles (was hundreds)
      for (let c = 0; c < 2; c++) assert.ok(Math.abs(small[c] + off[c]) < 80, `lookup ${k}: coordinate ${small[c] + off[c]}`);
    });
  }
}
console.log('cloud-texoffset-test ok, worst mismatch', worst.toExponential(1), 'tile');
