// The cloud field is anchored to the Earth (cloudlayer.js cloudAnchor): it used to be the same around every spawn point, on every day.
import assert from 'node:assert/strict';
import { cloudAnchor, ANCHOR_WRAP } from '../src/cloudlayer.js';

const day = new Date('2026-11-04T12:00:00Z'), next = new Date('2026-11-05T12:00:00Z');
const kbab = cloudAnchor(39.136, -121.436, day), egll = cloudAnchor(51.47, -0.454, day), kbab2 = cloudAnchor(39.136, -121.436, new Date('2026-11-04T18:00:00Z'));
const near = cloudAnchor(39.136, -121.426, day); // ~860 m east of KBAB

assert.deepEqual(kbab, kbab2, 'the same place on the same day must show the same sky');
assert.ok(Math.hypot(kbab.x - egll.x, kbab.z - egll.z) > 20000, 'two airports got the same cloud field');
const tomorrow = cloudAnchor(39.136, -121.436, next);
assert.ok(Math.hypot(kbab.x - tomorrow.x, kbab.z - tomorrow.z) > 20000 || Math.abs(kbab.evo0 - tomorrow.evo0) > 1, 'the next day got the same cloud field');
// moving the origin a little moves the anchor by the same distance (the field stays put on the ground)
const dx = near.x - kbab.x; assert.ok(Math.abs(dx - 864) < 5 || Math.abs(Math.abs(dx) - ANCHOR_WRAP + 864) < 5, `anchor moved ${dx.toFixed(0)} m for 864 m`);
assert.ok(Math.abs(near.z - kbab.z) < 1);
// GPU precision: the anchor stays within the wrap
for (const a of [kbab, egll, tomorrow, cloudAnchor(-89, 179), cloudAnchor(89, -179)]) { assert.ok(a.x >= 0 && a.x < ANCHOR_WRAP && a.z >= 0 && a.z < ANCHOR_WRAP); }
console.log('cloud-anchor-test ok', JSON.stringify({ kbab: [kbab.x, kbab.z].map(Math.round), egll: [egll.x, egll.z].map(Math.round) }));
