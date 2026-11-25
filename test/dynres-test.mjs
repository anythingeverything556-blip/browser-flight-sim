import assert from 'node:assert/strict';
import { nextScale, nextPressure, floorFor, dynReady, lowerPreset, DYN, EMERGENCY_DROP } from '../src/dynres.js';
const t = (n, f) => { f(); console.log('PASS ', n); };
const S = (scale, base = 3, changed = 0) => ({ scale, base, changed });

t('15 fps on a 3x ratio steps straight down, not by 5 %', () => {
  const s = nextScale(S(1), 1 / 15, 1 / 12, 10000, 1);
  assert.ok(s < 0.65 && s >= 0.3, `scale ${s}`);
});
t('never goes below the screen own pixels (times the floor)', () => {
  let s = 1;
  for (let i = 0; i < 4; i++) s = nextScale(S(s, 2), 1 / 5, 1 / 4, 10000, 1);
  assert.equal(s, DYN.floorNative / 2);
  assert.ok(2 * s >= DYN.floorNative - 1e-9);
});
t('holds when the frame time is inside the band', () => {
  assert.equal(nextScale(S(0.8), 1 / 60, 1 / 50, 10000, 1), 0.8);
});
t('steps up only after the hold time and with headroom', () => {
  assert.equal(nextScale(S(0.6, 3, 9000), 1 / 120, 1 / 90, 10000, 1), 0.6);
  assert.equal(nextScale(S(0.6, 3, 1000), 1 / 120, 1 / 90, 10000, 1), 0.65);
  assert.equal(nextScale(S(1, 3, 0), 1 / 200, 1 / 150, 10000, 1), 1);
});
t('a hitch (bad p90, fine median) still steps down a little', () => {
  const s = nextScale(S(1), 1 / 62, 1 / 20, 10000, 1);
  assert.ok(s < 1 && s > 0.5);
});
t('converges: pixel cost ~ ratio^2 reaches 60 fps in two checks', () => {
  let sc = 1, ms = 66.7; // 15 fps at scale 1
  for (let i = 0; i < 3; i++) { const n = nextScale(S(sc), ms / 1000, ms / 800, 99999 * (i + 1), 1); ms *= (n / sc) ** 2; sc = n; }
  assert.ok(ms < 20, `final ${ms.toFixed(1)} ms`);
});
t('pressure ladder needs consecutive slow checks and recovers slowly', () => {
  let p = { level: 0, slowN: 0, fastN: 0 };
  p = nextPressure(p, true, 1 / 30); assert.equal(p.level, 0);
  p = nextPressure(p, true, 1 / 30); assert.equal(p.level, 1);
  p = nextPressure(p, true, 1 / 30); p = nextPressure(p, true, 1 / 30); assert.equal(p.level, 2);
  p = nextPressure(p, true, 1 / 30); assert.equal(p.level, 2);
  for (let i = 0; i < 6; i++) p = nextPressure(p, false, 1 / 90);
  assert.equal(p.level, 1);
  p = nextPressure({ level: 1, slowN: 1, fastN: 0 }, false, 1 / 30); assert.equal(p.slowN, 0); // not at the floor: no escalation
});
t('emergency level 3 needs frames under 30 fps, drops the floor, and recovers', () => {
  let p = { level: 2, slowN: 0, fastN: 0 };
  for (let i = 0; i < 4; i++) p = nextPressure(p, true, 1 / 35); assert.equal(p.level, 2, '35 fps at the floor is not an emergency');
  for (let i = 0; i < 2; i++) p = nextPressure(p, true, 1 / 25); assert.equal(p.level, 3);
  assert.equal(floorFor(3), DYN.floorNative - EMERGENCY_DROP); assert.equal(floorFor(2), DYN.floorNative);
  assert.equal(nextScale(S(0.5, 1.5), 1 / 20, 1 / 15, 99999, 1, { ...DYN, floorNative: floorFor(3) }), Math.round((DYN.floorNative - EMERGENCY_DROP) / 1.5 * 1000) / 1000);
  for (let i = 0; i < 12; i++) p = nextPressure(p, false, 1 / 90); assert.equal(p.level, 1);
});
t('a 60 Hz screen (every frame 16.7 ms, clean p90) probes one step up after the probe hold', () => {
  assert.equal(nextScale(S(0.8, 2, 0), 1 / 60, 1 / 59, 21000, 1), 0.85);
  assert.equal(nextScale(S(0.8, 2, 5000), 1 / 60, 1 / 59, 21000, 1), 0.8, 'not before probeHold');
});
t('CPU-bound (noDown) holds the resolution instead of stepping down', () => {
  assert.equal(nextScale({ ...S(0.9, 2, 0), noDown: true }, 1 / 30, 1 / 25, 99999, 1), 0.9);
});
t('a failed probe sets a ceiling the scale does not climb past until it expires', () => {
  assert.equal(nextScale({ ...S(0.8, 2, 0), ceil: 0.85, ceilUntil: 50000 }, 1 / 120, 1 / 90, 30000, 1), 0.8);
  assert.equal(nextScale({ ...S(0.8, 2, 0), ceil: 0.85, ceilUntil: 20000 }, 1 / 120, 1 / 90, 30000, 1), 0.85);
});
t('steps down are spaced by downHold unless frames are under 30 fps', () => {
  assert.equal(nextScale(S(0.9, 2, 9000), 1 / 45, 1 / 40, 10000, 1), 0.9);
  assert.ok(nextScale(S(0.9, 2, 9000), 1 / 20, 1 / 15, 10000, 1) < 0.9);
});
t('first decision comes after 12 frames and 1.5 s, not 30 frames', () => {
  assert.equal(dynReady(11, 3000), false); assert.equal(dynReady(12, 1400), false); assert.equal(dynReady(12, 1500), true);
});
t('preset fallback: ultra -> high -> normal, never to Low', () => {
  assert.equal(lowerPreset('ultra'), 'high'); assert.equal(lowerPreset('high'), 'normal'); assert.equal(lowerPreset('normal'), null); assert.equal(lowerPreset('low'), null);
});
t('a preset drop needs two more slow checks after level 3 and fires once', () => {
  let p = { level: 3, slowN: 0, fastN: 0 }, drops = 0;
  for (let i = 0; i < 3; i++) { p = nextPressure(p, true, 1 / 20); drops += p.drop ? 1 : 0; } assert.equal(drops, 0, 'too early');
  p = nextPressure(p, true, 1 / 20); assert.equal(p.drop, true); assert.equal(p.slowN, 0);
  p = nextPressure(p, true, 1 / 20); assert.equal(p.drop, false);
  p = nextPressure({ level: 3, slowN: 3, fastN: 0 }, true, 1 / 50); assert.equal(p.drop, false, 'a recovered frame resets the count');
});
console.log('all dynres tests passed');
