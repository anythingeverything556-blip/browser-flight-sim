// The Mach dial needle path must be a simple polygon: a stray repeated vertex once cancelled the long half of the needle (only the tail showed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/cockpitreal.js', import.meta.url), 'utf8');
const m = src.match(/function drawMachNeedle[\s\S]*?\n}\n/)[0];
const pts = [...m.matchAll(/(moveTo|lineTo)\(([^)]*)\)/g)].map((x) => x[2].replace(/m \*/g, 'm*').trim());
assert.equal(new Set(pts).size, pts.length, `needle path repeats a vertex: ${pts.join(' | ')}`);
assert.match(m, /closePath/, 'needle path should be closed');
// the sweep: 0 at the lower left, 3.5 at the lower right, 300 degrees in all
const ang = (mach) => -150 + Math.min(3.5, Math.max(0, mach)) / 3.5 * 300;
assert.equal(ang(0), -150); assert.equal(ang(3.5), 150); assert.ok(Math.abs(ang(3.28) - 131.1) < 0.2);
console.log('mach-dial-test ok');
