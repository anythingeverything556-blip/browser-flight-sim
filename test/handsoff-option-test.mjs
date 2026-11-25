// Hands-off assist switched off (Options, or the Realistic flying mode): the pilot must still get the full stick. Each frame used to reset the
// slewed stick with the assist's state, which held the Skyhawk and the Vision Jet to one frame's slew (about 4 % elevator, 7 % aileron).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { C172Model } from '../src/c172.js';
import { SF50Model } from '../src/sf50.js';
import { gaControlFrame } from '../src/handsoff.js';
import { SF50_STICK } from '../src/c172stick.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const KT = 1.943844, dt = 1 / 60, g = () => 0, wind = new THREE.Vector3();
const bankDeg = (f) => Math.asin(Math.max(-1, Math.min(1, -new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).y))) * 180 / Math.PI;
const pitchDeg = (f) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y) * 180 / Math.PI;

// hold the axes for secs at 60 fps through the game's control frame; returns the aircraft and the largest commands seen
function hold(Model, cfg, V, axes, assist, secs = 3) {
  const f = new Model(); f.reset(new THREE.Vector3(0, 1500, 0), 90, V, false); f.gearDown = false; f.gearPos = 0; f.throttle = 0.7;
  const st = { stick: { de: 0, da: 0 }, h: {} }; let de = 0, da = 0;
  for (let i = 0; i < secs * 60 && !f.crashed; i++) {
    gaControlFrame(f, axes, st, { kias: (f.out.ias || f.out.V) * KT, dt, cfg, assist, frozen: false });
    de = Math.max(de, Math.abs(f.ctrl.de)); da = Math.max(da, Math.abs(f.ctrl.da));
    for (let k = 0; k < 2; k++) f.step(dt / 2, g, wind);
  }
  return { f, de, da };
}
for (const [name, Model, cfg, V] of [['Skyhawk', C172Model, undefined, 50], ['Vision Jet', SF50Model, SF50_STICK, 70]]) {
  for (const assist of [false, true]) {
    const tag = `${name}, hands-off ${assist ? 'on' : 'off'}`;
    check(`${tag}: full roll reaches full aileron and banks past 30° in 3 s`, () => {
      const r = hold(Model, cfg, V, { pitch: 0, roll: 1, yaw: 0 }, assist);
      assert.ok(r.da > 0.95, `aileron ${r.da.toFixed(2)}`); assert.ok(bankDeg(r.f) > 30, `bank ${bankDeg(r.f).toFixed(0)}°`);
    });
    check(`${tag}: full back stick raises the nose past 10° in 3 s`, () => {
      const r = hold(Model, cfg, V, { pitch: 1, roll: 0, yaw: 0 }, assist);
      assert.ok(r.de > 0.3, `elevator ${r.de.toFixed(2)}`); assert.ok(pitchDeg(r.f) > 10, `pitch ${pitchDeg(r.f).toFixed(0)}°`);
    });
  }
  check(`${name}: with the assist off, the stick is the pilot's alone (no aileron from the leveller when let go)`, () => {
    const f = new Model(); f.reset(new THREE.Vector3(0, 1500, 0), 90, V, false);
    f.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4)); // banked, hands off
    const st = { stick: { de: 0, da: 0 }, h: {} };
    gaControlFrame(f, { pitch: 0, roll: 0, yaw: 0 }, st, { kias: V * KT, dt, cfg, assist: false, frozen: false });
    assert.equal(f.ctrl.da, 0); assert.equal(f.ctrl.dr, 0);
    gaControlFrame(f, { pitch: 0, roll: 0, yaw: 0 }, st, { kias: V * KT, dt, cfg, assist: true, frozen: false });
    for (let i = 0; i < 60; i++) gaControlFrame(f, { pitch: 0, roll: 0, yaw: 0 }, st, { kias: V * KT, dt, cfg, assist: true, frozen: false });
    assert.notEqual(f.ctrl.da, 0, 'the assist levels the wings when on');
  });
}
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('hands-off option OK');
