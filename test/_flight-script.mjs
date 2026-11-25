import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
export function scriptedFlight(F = FlightModel) {
  const D = Math.PI / 180, _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), f = new F(), flat = () => 0, wind = new THREE.Vector3(); const dt = 1 / 240;
  f.reset(new THREE.Vector3(0, 2.42, 0), 90, 0, true); f.setEngines(1, true); f.throttle = 1;
  const trace = []; let rotated = false, lift = -1;
  for (let i = 0, t = 0; i < 240 * 60; i++, t += dt) {
    if (f.onGround) wind.set(0, 0, 0); else wind.set(6 + 3 * Math.sin(t * 0.7), 0.8 * Math.sin(t * 1.9), 2 * Math.cos(t * 0.4));
    const v = f.vel.length(), fwd = _f.set(1, 0, 0).applyQuaternion(f.quat), pitch = Math.asin(fwd.y), bank = Math.atan2(-_r.set(0, 0, 1).applyQuaternion(f.quat).y, _u.set(0, 1, 0).applyQuaternion(f.quat).y);
    if (v > 95) rotated = true; if (!f.onGround && v > 60 && lift < 0) lift = t;
    const tl = lift < 0 ? -1 : t - lift, pt = tl < 0 ? 0 : tl < 12 ? 9 : tl < 28 ? 5 : 0, bt = tl > 8 && tl < 20 ? 25 : tl >= 20 && tl < 28 ? -20 : 0;
    f.ctrl.de = !rotated ? 0 : f.onGround ? 0.12 : Math.max(-1, Math.min(1, 0.9 * (pt * D - pitch) - 0.6 * f.w.z)); f.ctrl.da = f.onGround ? 0 : Math.max(-1, Math.min(1, 0.8 * (bt * D - bank) - 0.8 * f.w.x)); f.ctrl.dr = tl > 5 && tl < 7 ? 0.1 : 0;
    if (tl > 4) f.gearDown = false; f.throttle = tl < 14 && tl >= 0 || tl < 0 ? 1 : 0.8;
    f.step(dt, flat, wind);
    if (i % 1200 === 0) trace.push([f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z, f.quat.x, f.quat.y, f.quat.z, f.quat.w, f.w.x, f.w.y, f.w.z, f.fuel, f.out.nz, f.out.alpha, f.trim, f.engines[0].thrust, f.engines[1].dry, f.gearPos]);
  }
  return { trace, final: trace[trace.length - 1], crashed: f.crashed, v: f.vel.length(), y: f.pos.y };
}
