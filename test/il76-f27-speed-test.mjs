// Sustained acceleration, not a warm start at the claimed cruise speed.
// Standalone: node test/il76-f27-speed-test.mjs
// Compare saved model modules: SPEED_BASELINE_DIR=/absolute/folder node ...
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { isa } from '../src/atmosphere.js';
import { airData } from '../src/airdata.js';
const KT = 1.943844, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
async function load(name) {
  if (!process.env.SPEED_BASELINE_DIR) return import(`../src/${name}.js`);
  let source = await readFile(`${process.env.SPEED_BASELINE_DIR}/${name}.js`, 'utf8');
  source = source.replace(/from '([^']+)'/g, (whole, name) => {
    if (name === 'three') return `from '${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`;
    return name.startsWith('.') ? `from '${new URL(`../src/${name.slice(2)}`, import.meta.url).href}'` : whole;
  });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const il = await load('il76'), f27 = await load('f27');
const cases = [
  { name: 'F27 normal 4000m', type: 'f27', h: 4000, mass: 18349.6428, start: 190 / KT, lever: 0.9 },
  { name: 'F27 normal 15000ft', type: 'f27', h: 4572, mass: 18349.6428, start: 190 / KT, lever: 0.9 },
  { name: 'F27 full 4000m', type: 'f27', h: 4000, mass: 18349.6428, start: 190 / KT, lever: 1 },
  { name: 'F27 full 15000ft', type: 'f27', h: 4572, mass: 18349.6428, start: 190 / KT, lever: 1 },
  { name: 'F27 normal 15000ft full tanks, default payload', type: 'f27', h: 4572, mass: f27.F27.EMPTY + f27.F27.PAYLOAD + f27.F27.FUEL_MAX, start: 190 / KT, lever: 0.9, referenceOnly: true },
  { name: 'Il76 normal 10000m 170t', type: 'il76', h: 10000, mass: 170000, start: 650 / 3.6, lever: 1 },
  { name: 'Il76 normal 10000m 190t', type: 'il76', h: 10000, mass: 190000, start: 650 / 3.6, lever: 1 },
  { name: 'Il76 full 10000m 140t', type: 'il76', h: 10000, mass: 140000, start: 650 / 3.6, lever: 1 },
  { name: 'Il76 fast 11000m 170t', type: 'il76', h: 11000, mass: 170000, start: 650 / 3.6, lever: 1 },
];
assert.equal(il.IL76.VMO, 600 / 1.852); assert.equal(il.IL76.MMO, 0.80);
assert.equal(f27.F27.VMO, 227); assert.equal(f27.F27.MMO, 0.48);
for (const c of cases) {
  const isIl = c.type === 'il76', m = isIl ? new il.IL76Model() : new f27.F27Model(), spec = isIl ? il.IL76 : f27.F27;
  m.setMode('realistic'); m.unlimitedFuel = true; m.fuel = c.mass - spec.EMPTY - m.payload;
  m.reset(new THREE.Vector3(0, c.h, 0), 90, c.start, false);
  assert.ok(Math.abs(m.mass - c.mass) < 1e-4, `${c.name}: actual mass must match declared reference condition`);
  // Explicit clean reference condition, no automatic spawn flap selection.
  m.flapCmd = 0; m.flaps = 0; if (isIl) m.slats = 0;
  m.gearDown = false; m.gearPos = 0;
  // One initial trim below target is allowed. No state/velocity writes after this.
  m.quat.identity(); m.vel.set(c.start, 0, 0); m.w.set(0, 0, 0); m.trimLevel();
  let alpha = 0, maxMach = 0, maxKCAS = 0, maxAltError = 0, at60 = null, at300 = null, at840 = null, crossing = null;
  for (let i = 0; i < 900 / dt; i++) {
    if (i % 120 === 0) {
      const s = isIl ? m.trimSolve(m.vel.length(), 0, 0, 0, 0) : m.trimSolve(m.vel.length(), 0, 0, 0);
      alpha = s.alpha; m.trim = s.trim;
    }
    const pitch = Math.asin(clamp(new THREE.Vector3(1, 0, 0).applyQuaternion(m.quat).y));
    const bank = Math.asin(clamp(-new THREE.Vector3(0, 0, 1).applyQuaternion(m.quat).y));
    const target = alpha + clamp((c.h - m.pos.y) * 0.0002 - m.vel.y * 0.015, -0.04, 0.04);
    m.ctrl.de = clamp(3 * (target - pitch) - 1.2 * m.w.z);
    m.ctrl.da = clamp(-2 * bank - 0.7 * m.w.x);
    m.ctrl.dr = clamp(3 * (m.out.beta || 0) + 0.7 * m.w.y);
    m.throttle = c.lever; m.step(dt, ground, wind);
    assert.equal(m.crashed, null, `${c.name}: unexpected crash`);
    maxMach = Math.max(maxMach, m.out.M); maxKCAS = Math.max(maxKCAS, m.out.cas * KT);
    maxAltError = Math.max(maxAltError, Math.abs(m.pos.y - c.h));
    const t = (i + 1) * dt;
    if (Math.abs(t - 60) < dt / 2) at60 = m.vel.length();
    if (Math.abs(t - 300) < dt / 2) at300 = m.vel.length();
    if (Math.abs(t - 840) < dt / 2) at840 = m.vel.length();
    const targetSpeed = isIl ? 770 / 3.6 : 240 / KT;
    if (crossing === null && m.vel.length() >= targetSpeed) crossing = t;
  }
  const atm = isa(m.pos.y), V = m.vel.length(), ad = airData({ V, M: V / atm.a, rho: atm.rho, T: atm.T });
  const result = { case: c.name, mass: m.mass, lever: c.lever, startKTAS: c.start * KT, at60KTAS: at60 * KT, at300KTAS: at300 * KT, finalKTAS: V * KT, finalKCAS: ad.cas * KT, finalKmhTAS: V * 3.6, Mach: V / atm.a, last60DeltaKTAS: (V - at840) * KT, altitudeErrorM: m.pos.y - c.h, maxAltError, targetCrossSeconds: crossing, thrustN: m.out.thrust, dragN: m.out.CD * m.out.qbar * spec.S, rpm: m.rpm, vy: m.vel.y, alpha: m.out.alpha, beta: m.out.beta, w: m.w.toArray() };
  assert.ok(Object.values(result).filter(v => typeof v === 'number').every(Number.isFinite), `${c.name}: finite measurement`);
  console.log(JSON.stringify(result));
  assert.ok(V > c.start + 10, `${c.name}: must actually accelerate from below target`);
  assert.ok(maxMach < spec.MMO && maxKCAS < spec.VMO, `${c.name}: below retained operating limits`);
  if (!c.referenceOnly) assert.notEqual(crossing, null, `${c.name}: must cross normal-cruise TAS after accelerating`);
  if (!isIl && c.lever === 0.9) {
    assert.ok(V * KT > 235 && V * KT < 245, `${c.name}: approximate manual normal cruise at 14,200 RPM`);
    assert.ok(Math.abs(m.rpm - 14200) < 1, `${c.name}: correct gas turbine RPM`);
  }
  assert.ok(Math.abs(V - at840) * KT < 0.3 && Math.abs(m.vel.y) < 0.01, `${c.name}: settled speed/height, not a momentary peak`);
  assert.ok(maxAltError < 30, `${c.name}: level flight, no dive-assisted speed`);
}
