// The Il-76 was added next to the SR-71, Skyhawk and Vision Jet without changing them. These are the numbers the three flight models gave, and the parameter
// writes their audio made, before the Il-76 existed (same inputs, deterministic). If you tune one of those aircraft on purpose, update the numbers here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { C172Model, C172_CG } from '../src/c172.js';
import { SF50Model, SF50_CG } from '../src/sf50.js';
import { landingLimits } from '../src/difficulty.js';
import { Audio } from '../src/audio.js';

let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const GOLDEN = {
  'sr71-air': [15884.8272, 6967.32541, 225.662904, 267.068181, 29.8158311, 24802.2538, 0.0570437209],
  'sr71-run': [6893.5793, 2.30694559, 11.6648571, 224.041645, -0.00608774476, 24060.2261, -0.0026617485],
  'c172-air': [2888.29541, 1518.80754, 693.514582, 43.1418167, 1.05461393, 143.684124, 0.0375602884],
  'c172-run': [1945.08319, 93.6568454, -682.329514, 30.6092335, 1.93261615, 143.448507, 0.0352377811],
  'sf50-air': [5953.90371, 2956.80267, 266.103678, 98.1227975, 0.064538232, 904.442785, -0.042390935],
  'sf50-run': [2779.73106, 149.473648, 9.87699068, 60.5762934, 12.1586924, 901.344306, 0.0105447875],
};
const dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
for (const [name, M, y, spd, onG] of [['sr71-air', FlightModel, 6000, 250, false], ['sr71-run', FlightModel, 2.42, 0, true], ['c172-air', C172Model, 1500, 50, false], ['c172-run', C172Model, C172_CG.y, 0, true], ['sf50-air', SF50Model, 3000, 100, false], ['sf50-run', SF50Model, SF50_CG.y, 0, true]]) {
  check(`${name}: a 60 s run with stick inputs gives exactly the numbers it gave before the Il-76`, () => {
    const f = new M(); f.reset(new THREE.Vector3(0, y, 0), 90, spd, onG, 0); f.throttle = onG ? 1 : 0.7; if (onG) f.parkingBrake = false;
    for (let t = 0; t < 60; t += dt) { f.ctrl.de = 0.02 * Math.sin(t); f.ctrl.da = 0.03 * Math.sin(0.7 * t); f.step(dt, ground, wind); f.events.length = 0; }
    const got = [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.fuel, f.out.alpha];
    got.forEach((v, i) => assert.ok(Math.abs(v - GOLDEN[name][i]) <= 1e-6 * Math.max(1, Math.abs(GOLDEN[name][i])), `value ${i}: ${v} vs ${GOLDEN[name][i]}`));
    assert.equal(f.contacts.length, 3, 'three contact slots'); assert.equal(f.engines.length, 2, 'two engine slots');
  });
}
check('touchdown limits of the three aircraft are unchanged in every mode', () => {
  const exp = { sr71: [[8.5, 6, 3.5], [7, 4.5, 2.5], [5.5, 3, 1.5]], c172: [[7, 4.5, 3.5], [5.5, 3.5, 2.5], [4, 2.5, 1.5]], sf50: [[7.5, 6, 3.5], [6, 4.5, 2.5], [4.5, 3, 1.5]] };
  for (const [ac, rows] of Object.entries(exp)) ['easy', 'medium', 'realistic'].forEach((m, i) => assert.deepEqual(Object.values(landingLimits(ac, m)), rows[i], `${ac} ${m}`));
});
check('the audio of the SR-71 and the Vision Jet (two- and one-engine profiles, afterburner layers, fan whine) writes exactly the parameters it wrote before', () => {
  let seed = 12345; const mathRandom = Math.random; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  try {
    const log = []; let ctxTime = 0, id = 0;
    const rec = (path) => ({ value: 0, setTargetAtTime(v, t, tc) { log.push([path, +(+v).toFixed(6), +(+tc).toFixed(4)]); }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => { const me = id++; return new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {}, getChannelData: () => new Float32Array(1 << 20) }, {
      get(o, k) { if (k in o) return o[k]; if (typeof k === 'symbol') return undefined; return (o[k] = /gain|frequency|Q|pan|playbackRate|detune|threshold|knee|ratio|attack|release/.test(k) ? rec(`${me}.${k}`) : undefined); }, set(o, k, v) { o[k] = v; return true; } }); };
    const ctx = { state: 'running', sampleRate: 8000, get currentTime() { return ctxTime; }, destination: node(), suspend() { return Promise.resolve(); }, resume() { return Promise.resolve(); }, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n), length: n }) };
    for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createDynamicsCompressor', 'createStereoPanner', 'createConvolver', 'createWaveShaper', 'createDelay', 'createAnalyser']) ctx[k] = node;
    const a = new Audio(); a.init(ctx);
    const states = [{ fan: false, engines: [{ dry: 0.8, ab: 0.4, unstart: 0 }, { dry: 0.8, ab: 0.2, unstart: 0 }], ias: 300 }, { fan: true, engines: [{ dry: 0.6, ab: 0, unstart: 0 }], ias: 120, cockpit: true },
      { fan: false, engines: [{ dry: 1, ab: 1, unstart: 0 }, { dry: 1, ab: 1, unstart: 1 }], ias: 700, mach: 2.2 }];
    for (const s of states) { ctxTime += 1; a.update({ paused: false, cockpit: false, camDist: 80, camFwdDot: -0.5, inMachConeAhead: false, doppler: 1, mach: 0.6, crashed: false, rho: 1.2, ias: 150, onGround: false, gs: 150, rain: 0, gearMoving: true, warnTone: 0, ...s }); }
    assert.equal(log.length, 211); assert.equal(createHash('sha1').update(JSON.stringify(log)).digest('hex'), 'fdb85d0e965f53cf4533cb81f6986ac74ae5ce11');
  } finally { Math.random = mathRandom; }
});
check('main.js: the Il-76 is neither IS_GA nor the SR-71, and the SR-71 keeps its own stick and assist path', () => {
  const m = src('src/main.js');
  assert.ok(/IS_GA = IS_C172 \|\| IS_SF50,/.test(m), 'IS_GA stays the light aircraft'); assert.ok(/const STICK_GA = IS_GA \|\| IS_IL76;/.test(m));
  assert.ok(/if \(!STICK_GA\) \{\n\s+fdm\.ctrl\.de = rotAssist\.apply/.test(m), 'rotation assist, flight assist and the landing aid stay SR-71 only');
  assert.ok(/stickGearing\(shape\(controls\.axes\.pitch\)/.test(m), 'the SR-71 stick gearing is still there');
  const audio = src('src/audio.js'); assert.ok(/const NO_FAN = \{ cabin: 1, rumble: 1, roar: 1, hiss: 1, pitch: 1, whine: 1, whineLo: 1100, whineSpan: 3400 \};/.test(audio));
});
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
