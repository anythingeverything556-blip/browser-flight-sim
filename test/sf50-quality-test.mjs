// Byte-level regression: native source textures, never the WIP's lower-detail geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readGLB, viewBytes, STOCK, SOURCE, OUTPUT } from '../tools/upgrade-sf50-textures.mjs';
import { AIRCRAFT_TYPES } from '../src/aircrafts.js';
const stock = readGLB(STOCK), source = readGLB(SOURCE), result = readGLB(OUTPUT);
const a = stock.json, b = result.json;
assert.equal(AIRCRAFT_TYPES.sf50.model, 'SF50_fullres_v1.glb', 'cache-busted model selected by the actual game');
for (const k of Object.keys(a).filter(k => !['buffers', 'bufferViews'].includes(k))) assert.deepEqual(b[k], a[k], k + ' unchanged, including every mesh, rig, pivot, material and animation');
const images = new Map(a.images.map(i => [i.bufferView, i]));
let changed = 0, geometryViews = 0;
for (let i = 0; i < a.bufferViews.length; i++) {
  const image = images.get(i), bytes = viewBytes(result, i);
  if (image) {
    const src = source.json.images.find(j => j.name === image.name);
    assert.ok(bytes.equals(viewBytes(source, src.bufferView)), image.name + ' exactly matches full-resolution owner source');
    if (!bytes.equals(viewBytes(stock, i))) changed++;
  } else { assert.ok(bytes.equals(viewBytes(stock, i)), 'geometry buffer ' + i + ' is byte-identical'); geometryViews++; }
}
assert.equal(changed, 9); assert.ok(geometryViews > 100);
const triangles = j => j.meshes.reduce((n, m) => n + m.primitives.reduce((t, p) => t + j.accessors[p.indices].count / 3, 0), 0);
assert.equal(triangles(b), 403431); assert.equal(triangles(b), triangles(a));
const dimensions = d => {
  assert.equal(d.toString('ascii', 0, 4), 'RIFF'); const kind = d.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [d.readUInt16LE(26) & 0x3fff, d.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const v = d.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [d.readUIntLE(24, 3) + 1, d.readUIntLE(27, 3) + 1];
  throw Error('Unsupported WebP: ' + kind);
};
for (const image of b.images) {
  const old = a.images.find(i => i.name === image.name);
  const now = dimensions(viewBytes(result, image.bufferView)), before = dimensions(viewBytes(stock, old.bufferView));
  assert.ok(now[0] >= before[0] && now[1] >= before[1], image.name + ' never downscaled');
  if (image.name.includes('Livery_Base')) assert.deepEqual(now, [4096, 2048]);
  if (image.name.includes('Display_PFD') || image.name.includes('Display_MFD')) assert.deepEqual(now, [2560, 1600]);
  if (image.name.includes('Display_GTC')) assert.deepEqual(now, [1600, 1000]);
}
const visual = fs.readFileSync('src/sf50visual.js', 'utf8');
assert.match(visual, /new SF50Displays\(\{ scale: 1 \}\)/, 'live displays also draw at native design resolution');
console.log(`PASS SF50 quality: ${triangles(b)} unchanged triangles; ${a.nodes.length} unchanged rig nodes; ${geometryViews} identical non-image buffers; ${changed} native image upgrades; no image reduced`);
