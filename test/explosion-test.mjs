// Crash explosions: the fireball lasts a couple of seconds and stops expanding under drag, smoke rises buoyantly then
// slows and drifts downwind, staged soot waits invisibly, and a fuelled Skyhawk crash gets a fireball scaled to it.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Wreck, SR71_SCALE, __fx } from '../src/crash.js';

const t = (n, f) => { try { f(); console.log('PASS ', n); } catch (e) { console.error('FAIL ', n, '\n', e); process.exit(1); } };
const cam = new THREE.Vector3(), wind = { x: 8, z: 0 }, still = { x: 0, z: 0 };
const run = (p, secs, w = still, each) => { for (let s = 0; s < secs; s += 1 / 60) { p.update(1 / 60, cam, w, 1, null); each && each(s); } };
const alpha = (p, i) => p.aCol.array[i * 4 + 3];

t('fireball: blasts out, drag stops the shell, glows for 2-3 s and rolls upward', () => {
  const p = new __fx.Particles(new THREE.Scene(), 8, true);
  p.emit(0, 0, 0, 60, 10, 0, 3.0, 4, 20, 5);
  run(p, 1.0); const x1 = p.p[0], y1 = p.p[1];
  run(p, 1.0); const x2 = p.p[0], y2 = p.p[1];
  assert.ok(x1 > 15 && x1 < 40, `shell radius after 1 s ${x1.toFixed(1)} m`);
  assert.ok(x2 - x1 < 0.25 * x1, `drag stops it: +${(x2 - x1).toFixed(1)} m in the next second`);
  assert.ok(y2 - y1 > 3, `the hot ball rises ${(y2 - y1).toFixed(1)} m in its second second`);
  assert.ok(p.n === 1 && alpha(p, 0) > 0.05, 'still visible at 2 s');
  run(p, 1.2); assert.equal(p.n, 0, 'gone after its life');
});

t('plume: buoyant rise slows as it cools, and it bends downwind', () => {
  const p = new __fx.Particles(new THREE.Scene(), 8, false);
  p.emit(0, 0, 0, 0, 8, 0, 60, 6, 60, 1);
  let vEarly = 0; run(p, 2, wind, () => { vEarly = p.v[1]; });
  run(p, 25, wind); const vLate = p.v[1];
  assert.ok(vEarly > 8, `early rise ${vEarly.toFixed(1)} m/s`);
  assert.ok(vLate < 0.5 * vEarly && vLate > 0.5, `late rise ${vLate.toFixed(1)} m/s`);
  assert.ok(p.p[0] > 80 && p.p[1] > 120, `drifted ${p.p[0].toFixed(0)} m downwind at ${p.p[1].toFixed(0)} m`);
  assert.ok(p.v[0] > wind.x, `carried by the stronger wind aloft: ${p.v[0].toFixed(1)} m/s`);
});

t('staged soot: invisible and still until its delay, then rolls out glowing', () => {
  const p = new __fx.Particles(new THREE.Scene(), 8, false);
  p.emit(5, 5, 5, 0, 10, 0, 10, 4, 30, 6, 1.0);
  run(p, 0.5); assert.equal(alpha(p, 0), 0); assert.equal(p.p[1], 5);
  run(p, 0.7); assert.ok(alpha(p, 0) > 0 && p.p[1] > 5, 'appears and moves after the delay');
  assert.ok(p.aCol.array[0] > p.aCol.array[2] * 2, 'lit orange from inside at first');
});

const crash = (scale, fuel, vel = new THREE.Vector3(45, -22, 0)) => {
  const w = new Wreck(new THREE.Scene()); w.scale = scale ? { ...SR71_SCALE, ...scale } : SR71_SCALE;
  const fdm = { pos: new THREE.Vector3(0, 100, 0), crashVel: vel, fuel, quat: new THREE.Quaternion(), crashInfo: { pitch: 0.6, bank: 0.3, gearPosition: 1 }, out: { V: 50, M: 0.15, nz: 1 } };
  const info = w._classify(null, fdm, 'impact', fdm.crashVel, new THREE.Vector3(0, 1, 0));
  w.pieces = [{ pos: new THREE.Vector3(0, 100, 0) }];
  w._initialEffects(fdm, info);
  return w;
};
const C172 = { fuelCap: 144, speedRef: 75, sinkRef: 28, size: 0.3 };

t('a fuelled Skyhawk nose-in gets a fireball, secondary bursts and burning debris', () => {
  const old = crash(null, 120); // the old SR-71 thresholds: 120 kg of 36,300 never lit
  assert.ok(old.fireIntensity < 0.1, `old scale: fire ${old.fireIntensity.toFixed(2)}`);
  const w = crash(C172, 120);
  assert.ok(w.fireIntensity > 0.44, `fire intensity ${w.fireIntensity.toFixed(2)}`);
  assert.ok(w.fireRadius > 15 && w.fireRadius < 40, `fireball radius ${w.fireRadius.toFixed(1)} m`);
  assert.ok(w.bursts.length >= 2 && w.bursts.every((b) => b.t > 0.3 && b.t < 3), `${w.bursts.length} secondary bursts`);
  assert.ok(w.fire.n > 200 && w.smoke.n > 100, `${w.fire.n} flame and ${w.smoke.n} smoke particles`);
  let trails = 0; for (let i = 0; i < w.fragments.count; i++) trails += w.fragments.trail[i]; assert.ok(trails > 3, `${trails} burning fragments`);
});

t('an empty-tank Skyhawk crash does not explode', () => {
  const w = crash(C172, 0);
  assert.equal(w.fireIntensity, 0); assert.equal(w.bursts.length, 0);
});

t('a fuelled SR-71 fireball is far bigger than the Skyhawk one', () => {
  const big = crash(null, 30000, new THREE.Vector3(160, -60, 0)), small = crash(C172, 140);
  assert.ok(big.fireIntensity > 0.44, `SR-71 fire ${big.fireIntensity.toFixed(2)}`);
  assert.ok(big.fireRadius > 2 * small.fireRadius, `${big.fireRadius.toFixed(0)} m vs ${small.fireRadius.toFixed(0)} m`);
});
// a nacelle-shaped piece from an ordinary 160 kt impact; the old spin integration ran away to ~600 rad/s here (on to NaN in the browser)
export const runNacelle = (Piece) => {
  const box = new THREE.Box3(new THREE.Vector3(-6.7, -0.98, -0.95), new THREE.Vector3(6.7, 0.98, 0.95));
  const pc = new Piece(new THREE.Group(), 3929, new THREE.Vector3(0, 34.94, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(4.78, 1.73, 0.066)), new THREE.Vector3(82.35, -4.56, -9.97), new THREE.Vector3(0.701, -1.612, 1.447), box);
  let maxW = 0;
  for (let i = 0; i < 8 * 250; i++) {
    const slow = i * 0.004 < 1.8 ? 0.3 + 0.7 * Math.pow(i * 0.004 / 1.8, 1.4) : 1;
    pc.groundY = 31.84; pc.slopeX = -0.003; pc.slopeZ = 0; pc.step(0.004 * slow, 1.225, null); maxW = Math.max(maxW, pc.w.length() || Infinity);
  }
  return { pc, maxW };
};
t('a tumbling engine nacelle stays finite (its spin used to run away to NaN and black out the screen)', () => {
  const { pc, maxW } = runNacelle(__fx.Piece);
  assert.ok(Number.isFinite(pc.pos.x + pc.pos.y + pc.vel.x + pc.w.x + pc.q.w), 'finite after 8 s');
  assert.ok(maxW <= 25.0001, `spin capped: ${maxW.toFixed(1)} rad/s`);
  assert.ok(pc.pos.y > 30 && pc.pos.y < 40, `rests on the ground: y ${pc.pos.y.toFixed(1)}`);
});
console.log('explosion-test: ok');
