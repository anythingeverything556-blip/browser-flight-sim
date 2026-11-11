// Flying modes (difficulty.js): presets, touchdown limits per mode and Easy mode envelope protection
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { C172Model, C172, stallAlpha as c172Stall } from '../src/c172.js';
import { SF50Model, SF50, stallAlpha as sf50Stall } from '../src/sf50.js';
import { IL76Model, IL76, IL76_CG, stallAlpha as il76Stall } from '../src/il76.js';
import { MODES, PRESETS, modeOf, presetChanged, landingLimits, envelopeProtect, PROT_A_ON, PROT_A_MAX, BANK_MAX } from '../src/difficulty.js';
import { attitude } from '../src/autopilot.js';
import { stickGearing, rollGearing } from '../src/handling.js';
import { c172Stick, c172PitchAuthority, C172_STICK, SF50_STICK, IL76_STICK } from '../src/c172stick.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const g = () => 0, wind = new THREE.Vector3(), D = 180 / Math.PI;

check('three modes, unknown or missing falls back to Medium', () => {
  assert.deepEqual(MODES, ['easy', 'medium', 'realistic']);
  assert.equal(modeOf(undefined), 'medium'); assert.equal(modeOf('hard'), 'medium'); assert.equal(modeOf('realistic'), 'realistic');
});
check('Medium is the sim as it was: the shipped assist defaults', () => assert.deepEqual(PRESETS.medium,
  { assist: false, handsOff: true, rotAssist: true, autoTrim: true, landAid: true, unstarts: true, fuel: false }));
check('Realistic switches every assist off; Easy switches them all on', () => {
  for (const k of ['assist', 'handsOff', 'rotAssist', 'autoTrim', 'landAid']) { assert.equal(PRESETS.realistic[k], false, k); assert.equal(PRESETS.easy[k], true, k); }
  assert.equal(PRESETS.realistic.crash, true); assert.equal(PRESETS.realistic.fuel, false); assert.equal(PRESETS.easy.fuel, true); assert.equal(PRESETS.easy.unstarts, false);
});
check('presetChanged spots an option changed after picking a mode', () => {
  assert.equal(presetChanged('medium', { ...PRESETS.medium }), false);
  assert.equal(presetChanged('medium', { ...PRESETS.medium, autoTrim: false }), true);
});
check('the flight models default to the Medium touchdown limits', () => {
  assert.deepEqual(new FlightModel().land, landingLimits('sr71', 'medium'));
  assert.deepEqual(new C172Model().land, landingLimits('c172', 'medium'));
  assert.deepEqual(new SF50Model().land, landingLimits('sf50', 'medium'));
});

// a level arrival sinking at vs (m/s) from just above the wheels; true when it crashed within 6 s
function crashes(Model, ac, mode, cgH, speed, vs) {
  const f = new Model(); f.land = landingLimits(ac, mode); f.reset(new THREE.Vector3(0, cgH + 0.4, 0), 90, speed, false); f.gearDown = true; f.gearPos = 1; f.vel.y = -vs; f.throttle = 0;
  for (let i = 0; i < 1440 && !f.crashed; i++) f.step(1 / 240, g, wind);
  return !!f.crashed;
}
for (const [Model, ac, cgH, V, real, medium, easy] of [[FlightModel, 'sr71', 2.42, 95, 6, 7.5, 9.5], [C172Model, 'c172', 1.15, 30, 5, 6.5, 8], [SF50Model, 'sf50', 1.2, 50, 5, 6.5, 8.5], [IL76Model, 'il76', IL76_CG.y, 80, 4.2, 5.4, 6.8]]) {
  check(`${ac}: ${real} m/s lands in Medium and Easy, crashes in Realistic`, () => {
    assert.equal(crashes(Model, ac, 'realistic', cgH, V, real), true); assert.equal(crashes(Model, ac, 'medium', cgH, V, real), false); assert.equal(crashes(Model, ac, 'easy', cgH, V, real), false);
  });
  check(`${ac}: ${medium} m/s lands only in Easy`, () => { assert.equal(crashes(Model, ac, 'medium', cgH, V, medium), true); assert.equal(crashes(Model, ac, 'easy', cgH, V, medium), false); });
  check(`${ac}: ${easy} m/s crashes even in Easy`, () => assert.equal(crashes(Model, ac, 'easy', cgH, V, easy), true));
}

// hold full back stick (or full roll, or full forward) through the game's own stick shaping, at 60 frames a second
function fly(kind, alt, V, { pitch = 0, roll = 0, secs = 12, prot = true } = {}) {
  const f = kind === 'sr71' ? new FlightModel() : kind === 'c172' ? new C172Model() : kind === 'il76' ? new IL76Model() : new SF50Model(); if (kind === 'il76') f.setMode('easy');
  const cfgOf = () => (kind === 'sf50' ? SF50_STICK : kind === 'il76' ? IL76_STICK : C172_STICK);
  f.reset(new THREE.Vector3(0, alt, 0), 90, V, false); f.gearDown = false; f.gearPos = 0; f.throttle = kind === 'sr71' ? 0.9 : 0.8;
  const st = {}, stk = {}, r = { alpha: -9, nz: -9, nzMin: 9, bank: 0, pitch: -9, pitchMin: 9, stall: -9, crashed: null };
  const nzMax = kind === 'sr71' ? 3.5 : kind === 'c172' ? C172.NZ_LIMIT : kind === 'il76' ? IL76.NZ_LIMIT : SF50.NZ_LIMIT, nzMin = kind === 'sr71' ? -1.5 : kind === 'c172' ? -1.52 : kind === 'il76' ? IL76.NZ_FLAP_NEG : SF50.NZ_NEG_LIMIT;
  for (let fr = 0; fr < secs * 60 && !f.crashed; fr++) {
    const q = f.out.qbar || 0, M = f.out.M || 0;
    if (kind === 'sr71') { f.ctrl.de = stickGearing(pitch, q, M, 0); f.ctrl.da = rollGearing(roll, q, M); }
    else { c172Stick(stk, { pitch, roll }, (f.out.ias || f.out.V) * 1.94384, 1 / 60, kind === 'c172' ? undefined : cfgOf()); f.ctrl.de = stk.de; f.ctrl.da = stk.da; }
    f.ctrl.dr = 0;
    const aS = kind === 'c172' ? c172Stall(f.flaps || 0) : kind === 'sf50' ? sf50Stall(f.flaps || 0, M) : kind === 'il76' ? il76Stall(f.flaps || 0, f.slats || 0, M, f.mx.clmax) : 0.26, at = attitude(f.quat);
    if (prot) envelopeProtect(f.ctrl, { alpha: f.out.alpha || 0, aOn: aS - PROT_A_ON, aMax: aS - PROT_A_MAX, nz: f.out.nz || 1, nzMax, nzMin, pitch: at.pitch, bank: at.bank, onGround: f.onGround, dt: 1 / 60,
      auth: kind === 'sr71' ? stickGearing(1, q, M, 0) : c172PitchAuthority((f.out.ias || f.out.V) * 1.94384, cfgOf()) }, st);
    for (let k = 0; k < 4 && !f.crashed; k++) f.step(1 / 240, g, wind);
    if (fr > 6) {
      const a = attitude(f.quat);
      r.alpha = Math.max(r.alpha, f.out.alpha); r.stall = Math.max(r.stall, f.out.alpha - aS); r.nz = Math.max(r.nz, f.out.nz); r.nzMin = Math.min(r.nzMin, f.out.nz);
      r.bank = Math.max(r.bank, Math.abs(a.bank)); r.pitch = Math.max(r.pitch, a.pitch); r.pitchMin = Math.min(r.pitchMin, a.pitch);
    }
  }
  r.crashed = f.crashed;
  return r;
}
check('without protection a held pull stalls the Skyhawk (the test can tell)', () => assert.ok(fly('c172', 1000, 45, { pitch: 1, prot: false }).stall > 0.05));
for (const [kind, alt, V] of [['sr71', 3000, 130], ['sr71', 20000, 700], ['c172', 1000, 45], ['c172', 1000, 70], ['sf50', 2000, 70], ['sf50', 2000, 120], ['il76', 3000, 100], ['il76', 8000, 170]]) {
  check(`Easy ${kind} at ${V} m/s: a held full pull stays below the stall, the g limit and 32° nose up`, () => {
    const r = fly(kind, alt, V, { pitch: 1, secs: 20 });
    assert.equal(r.crashed, null); assert.ok(r.stall < 0, `alpha ${(r.alpha * D).toFixed(1)}° past the stall`);
    assert.ok(r.nz < (kind === 'sr71' ? 3.5 : kind === 'c172' ? C172.NZ_LIMIT : kind === 'il76' ? IL76.NZ_LIMIT : SF50.NZ_LIMIT), `nz ${r.nz.toFixed(2)}`); assert.ok(r.pitch < 32 / D, `pitch ${(r.pitch * D).toFixed(0)}°`);
  });
  check(`Easy ${kind} at ${V} m/s: a held full push stays above the negative g limit and 27° nose down`, () => {
    const r = fly(kind, alt, V, { pitch: -1 });
    assert.equal(r.crashed, null); assert.ok(r.nzMin > (kind === 'sf50' ? 1.5 * SF50.NZ_NEG_LIMIT : kind === 'il76' ? -1 : -1.9), `nz ${r.nzMin.toFixed(2)}`); assert.ok(r.pitchMin > -27 / D, `pitch ${(r.pitchMin * D).toFixed(0)}°`);
  });
  check(`Easy ${kind} at ${V} m/s: a held full roll stops near ${Math.round(BANK_MAX * D)}° of bank`, () => {
    const r = fly(kind, alt, V, { roll: 1 }); assert.equal(r.crashed, null); assert.ok(r.bank < 75 / D, `bank ${(r.bank * D).toFixed(0)}°`);
  });
}
check('protection leaves gentle flying and the ground alone', () => {
  const c = { de: 0.3, da: 0.4 };
  envelopeProtect(c, { alpha: 0.05, aOn: 0.17, aMax: 0.215, nz: 1.1, nzMax: 3.8, nzMin: -1.5, pitch: 0.1, bank: 0.3, onGround: false, dt: 1 / 60 }, {});
  assert.deepEqual(c, { de: 0.3, da: 0.4 });
  const d = { de: 1, da: 1 };
  envelopeProtect(d, { alpha: 0.5, aOn: 0.17, aMax: 0.215, nz: 5, nzMax: 3.8, nzMin: -1.5, pitch: 0.8, bank: 1.5, onGround: true, dt: 1 / 60 }, {});
  assert.deepEqual(d, { de: 1, da: 1 });
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('difficulty OK');
