// Standalone rigid-body F27 test fixture. No browser, app assists or replacement physics.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { isa } from '../../src/atmosphere.js';
export const KT = 1.943844, DT = 1 / 120;
export const ground = () => 0, wind = new THREE.Vector3();
export const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
export const iasKt = m => (m.out.ias ?? m.vel.length() * Math.sqrt(isa(m.pos.y).rho / 1.225)) * KT;
export const pitch = m => Math.asin(clamp(new THREE.Vector3(1, 0, 0).applyQuaternion(m.quat).y));
export function wingsLevel(m) {
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quat);
  m.ctrl.da = clamp(-2 * Math.asin(clamp(-right.y)) - 0.7 * m.w.x);
  m.ctrl.dr = clamp(3 * (m.out.beta || 0) + 0.7 * m.w.y);
}
export function holdPitch(m, target) {
  m.ctrl.de = clamp(3 * (target - pitch(m)) - 1.2 * m.w.z); wingsLevel(m);
}
export function run(m, seconds, pilot = wingsLevel, dt = DT) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    pilot(m, i * dt); m.step(dt, ground, wind);
    assert.equal(m.crashed, null, `unexpected crash: ${m.crashed}`);
    assert.ok([...m.pos.toArray(), ...m.vel.toArray(), ...m.quat.toArray(), ...m.w.toArray(), m.out.CL, m.out.CD].every(Number.isFinite), 'finite rigid-body state');
  }
}
export function fresh(api, height = 1500, knots = 160, mass) {
  const m = new api.F27Model();
  if (mass !== undefined) {
    assert.ok(mass >= api.F27.EMPTY, 'test mass cannot be below empty mass');
    m.fuel = Math.min(m.fuel, mass - api.F27.EMPTY);
    m.payload = mass - api.F27.EMPTY - m.fuel;
  }
  m.unlimitedFuel = true;
  m.reset(new THREE.Vector3(0, height, 0), 90, knots / KT / Math.sqrt(isa(height).rho / 1.225), false);
  return m;
}
// A saved pre-change module can be run through the SAME integrator and scenarios.
// Rebind its relative imports to the source directory; never replace model equations.
export async function loadF27() {
  if (!process.env.F27_FDM_BASELINE) return import('../../src/f27.js');
  let source = await readFile(process.env.F27_FDM_BASELINE, 'utf8');
  source = source.replace(/from '([^']+)'/g, (whole, name) => {
    if (name === 'three') return `from '${new URL('../../node_modules/three/build/three.module.js', import.meta.url).href}'`;
    return name.startsWith('.') ? `from '${new URL(`../../src/${name.slice(2)}`, import.meta.url).href}'` : whole;
  });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
