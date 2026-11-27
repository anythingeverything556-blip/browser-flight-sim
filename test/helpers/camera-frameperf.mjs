import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { CG_MODEL } from '../../src/flight.js';

// Frozen owner-archive implementation is loaded with the SAME Three revision,
// mock event sink and fixture as the candidate. No server, assets or network.
export const baselinePath = new URL('../fixtures/frameperf/camera-baseline-08e7f399.js', import.meta.url);
export const candidatePath = new URL('../../src/camera.js', import.meta.url);
export function loadCamera(path, three = THREE) {
  const source = readFileSync(path, 'utf8').replace(/^import .*;\n/gm, '')
    .replace('export function configureCameraAircraft', 'function configureCameraAircraft')
    .replace('export { CameraRig, VIEWS, VIEW_NAMES };', 'return { CameraRig, configureCameraAircraft, VIEWS };');
  return compileFunction(source, ['THREE', 'CG_MODEL', 'window'], { filename: path.pathname })(three, CG_MODEL, { addEventListener() {} });
}
export function allocationCounter() {
  const counts = { Vector3: 0, Quaternion: 0, Euler: 0, Matrix4: 0 };
  const three = { ...THREE };
  for (const name of Object.keys(counts)) {
    three[name] = class extends THREE[name] {
      constructor(...args) { super(...args); counts[name]++; }
    };
  }
  return { three, counts, reset() { for (const name of Object.keys(counts)) counts[name] = 0; } };
}
export function makeRig(api, view) {
  const events = {};
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, .05, 1.2e7);
  const rig = new api.CameraRig(camera, { addEventListener(name, fn) { events[name] = fn; } });
  rig.set(view);
  return { rig, camera, events };
}
export const ground = (x, z) => 40 * Math.sin(x / 1000) + 10 * Math.cos(z / 1000);
export const tower = new THREE.Vector3(100, 30, -80);
export const frames = Array.from({ length: 1024 }, (_, i) => {
  const t = i * Math.PI * 2 / 1024;
  return {
    pos: new THREE.Vector3(800 * Math.cos(t), 2100 + 70 * Math.sin(2 * t), 800 * Math.sin(t)),
    vel: new THREE.Vector3(-170 * Math.sin(t), 3 * Math.cos(t), 170 * Math.cos(t)),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(.06 * Math.sin(t), -t, .2 * Math.cos(t), 'YXZ')),
  };
});
export function sample(rig, frame, fixture = frames) { rig.update(1 / 60, fixture[frame & 1023], ground, tower, .2); }
// Vector3.clone() dispatches through the INPUT vector's constructor. Include
// clones of aircraft inputs, not only allocations explicitly spelled new THREE.
export function countedFrames(three) {
  return frames.map(f => ({ pos: new three.Vector3().copy(f.pos), vel: new three.Vector3().copy(f.vel), quat: new three.Quaternion().copy(f.quat) }));
}
