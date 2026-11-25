// Elevation repair: corrupt Terrarium rows/columns are rebuilt, real relief is left alone. Offline, no network.
import assert from 'node:assert/strict';
import { terrariumToHeights, demStats } from '../src/terrain-dem.js';

const N = 256, Z = 14, X = 12146, Y = 6863; // a z14 tile in the Himalaya (about 8 m/px)
const encode = (h) => {
  const px = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = h[i] + 32768, r = Math.floor(v / 256), g = Math.floor(v % 256), b = Math.floor((v - Math.floor(v)) * 256);
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  return px;
};
const terrain = () => {
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = 5200 + 380 * Math.sin(x / 38) + 300 * Math.cos(y / 51) + 2.1 * x + 1.4 * y;
  return h;
};
const maxDiff = (a, b, skip = 6) => { let m = 0; for (let y = skip; y < N - skip; y++) for (let x = skip; x < N - skip; x++) m = Math.max(m, Math.abs(a[y * N + x] - b[y * N + x])); return m; };

const clean = terrariumToHeights(encode(terrain()), N, Z, X, Y);

// a full corrupt row and a partial corrupt column
const bad = terrain();
for (let x = 0; x < N; x++) bad[120 * N + x] = -1900 + x * 0.4;
for (let y = 40; y < 250; y++) bad[y * N + 200] = 8800;
const before = demStats.lines;
const fixed = terrariumToHeights(encode(bad), N, Z, X, Y);
assert.ok(demStats.lines - before >= 2, 'both corrupt lines should be detected');
assert.ok(maxDiff(fixed, clean) < 25, `repaired tile should match the clean one (max diff ${maxDiff(fixed, clean).toFixed(1)} m)`);

// the generator's resampling can split one bad source line over adjacent lines: a bad row plus a partly bad neighbour (as seen in a
// real Himalayan z15 tile), an even split, three lines, and the same on columns
const band = (axis, lines, offsets) => {
  const h = terrain();
  lines.forEach((l, i) => { for (let k = 0; k < N; k++) h[axis ? k * N + l : l * N + k] += offsets[i]; });
  return h;
};
for (const [name, axis, lines, offsets] of [
  ['bad row + partly bad neighbour', 0, [120, 121], [-14336, -4448]],
  ['partly bad row + bad neighbour', 0, [120, 121], [-4448, -14336]],
  ['even two-row split', 0, [120, 121], [-7168, -7168]],
  ['three-row band', 0, [119, 120, 121], [-3000, -9000, -5000]],
  ['bad column + partly bad neighbour', 1, [90, 91], [-14336, -4448]],
]) {
  const got = terrariumToHeights(encode(band(axis, lines, offsets)), N, Z, X, Y);
  assert.ok(maxDiff(got, clean) < 25, `${name}: repaired tile should match the clean one (max diff ${maxDiff(got, clean).toFixed(1)} m)`);
}

// a row-aligned escarpment (a 150 m step) is real relief, not a corrupt line
const stepBefore = demStats.lines;
const step = terrain();
for (let y = 128; y < N; y++) for (let x = 0; x < N; x++) step[y * N + x] += 150;
const stepped = terrariumToHeights(encode(step), N, Z, X, Y);
assert.equal(demStats.lines, stepBefore, 'an escarpment must not be treated as a corrupt line');
assert.ok(stepped[150 * N + 100] - stepped[106 * N + 100] - (clean[150 * N + 100] - clean[106 * N + 100]) > 120, 'escarpment flattened');

// smooth terrain is not touched
const lines = demStats.lines;
terrariumToHeights(encode(terrain()), N, Z, X, Y);
assert.equal(demStats.lines, lines, 'no repairs on clean terrain');

// a real, steep, row-aligned ridge (3 px wide, 300 m high) must survive
const ridge = terrain();
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ridge[y * N + x] += 300 * Math.exp(-(((y - 128) / 1.6) ** 2));
const kept = terrariumToHeights(encode(ridge), N, Z, X, Y);
const peak = kept[128 * N + 100] - clean[128 * N + 100];
assert.ok(peak > 150, `real ridge flattened (peak ${peak.toFixed(0)} m of 300)`);

console.log('dem-test ok: corrupt lines repaired, clean terrain and real ridges untouched');
