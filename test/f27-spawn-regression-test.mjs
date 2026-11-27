// Execute the real spawn and engine-master handler with real FDMs. Only world,
// DOM, audio and navigation effects are inert; no copied reset/trim equations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { F27Model, F27, F27_GEAR, F27_FLAP_DEG } from '../src/f27.js';
import { C172Model, C172, C172_CG } from '../src/c172.js';
import { DA40Model, DA40, DA40_CG, DA40_FLAP_DEG } from '../src/da40.js';
import { SF50Model, SF50, SF50_CG, FLAP_DEG as SF50_FLAP_DEG } from '../src/sf50.js';
import { isa } from '../src/atmosphere.js';
import { makeSF50Feed } from '../src/sf50feed.js';
import { SF50Autoland } from '../src/sf50ap.js';
import { airData, trueAirspeedFromCas } from '../src/airdata.js';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const spawnSource = main.slice(main.indexOf('function spawn(s, meta) {'), main.indexOf('// How ready is the ground'));
const masterSource = main.slice(main.indexOf("controls.on('engineStart',"), main.indexOf("controls.on('fullAB',"));
assert.ok(spawnSource.startsWith('function spawn(') && masterSource.startsWith("controls.on('engineStart',"));
const noop = () => {}, zero = new THREE.Vector3(), KT = 1.943844;
function fixture(id = 'f27', mode = 'medium') {
  const fdm = new ({ f27: F27Model, c172: C172Model, da40: DA40Model, sf50: SF50Model }[id])();
  const cold = { checked: false }, element = { style: {} };
  const controls = { engTrim: [0, 0], handlers: {}, on(name, fn) { this.handlers[name] = fn; } };
  const ctx = vm.createContext({ THREE, F27, F27_FLAP_DEG, C172, DA40, DA40_FLAP_DEG, SF50, SF50_FLAP_DEG, isa, airData,
    fdm, controls, state: {}, settings: { mode }, autoland: new SF50Autoland(), sf50Feed: id === 'sf50' ? makeSF50Feed() : null, IS_F27: id === 'f27', IS_C172: id === 'c172', IS_DA40: id === 'da40',
    IS_PROP: ['c172', 'da40'].includes(id), IS_SF50: id === 'sf50', IS_HEAVY: false, IS_IL76: false, IS_A380X: false,
    CG_H: id === 'f27' ? -Math.min(...F27_GEAR.map(g => g.p.y)) : ({ c172: C172_CG, da40: DA40_CG, sf50: SF50_CG }[id]).y,
    invalidateWeatherRequest: noop, logbook: { cancel: noop }, warp: { i: 0 }, buildingHit: { reset: noop }, wreck: { active: false },
    moveOrigin: noop, turb: { reset: noop }, resetGaControls: noop, terrain: { refreshNear: noop, requestHeight: noop },
    visual: { setDoors: noop }, audio: { resetForSpawn: noop, play: noop }, syncF27Feather: noop, toast: noop,
    f27RadioAltimeter: { reset: noop }, f27RadioAltOn: false, f27RadioAltValid: false,
    autobrake: { reset: noop }, takeoff: { stop: noop }, landAid: { on: false }, resetApState: noop, nav: { wps: [] },
    aircraftSystems: { reset: noop }, sr71ExteriorLights: null, touchdown: { reset: noop }, atc: { reset: noop },
    mapPanel: null, rig: {}, performance, $: () => element, document: { getElementById: () => cold } });
  vm.runInContext(masterSource + '\n' + spawnSource, ctx);
  fdm.setMode?.(mode);
  return { fdm, controls, cold, spawn: ctx.spawn };
}
const start = (overrides = {}) => ({ lat: 0, lon: 0, alt: 1500, hdg: 90,
  speed: trueAirspeedFromCas(125 / KT, isa(1500)), ground: false, gamma: 0, ...overrides });
const near = (a, b, label, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);
const gammaOf = fdm => Math.asin(fdm.vel.y / fdm.vel.length()) * 180 / Math.PI;
let trimCases = 0, engineCases = 0, controlCases = 0;
// B04: explicit flaps/gear must be in place before exactly one initial trim.
for (const hdg of [0, 90, 237]) for (const gamma of [0, -3, 10]) for (const flapNotch of [0, 3, 4]) {
  const { fdm, spawn } = fixture();
  const originalTrim = fdm.trimLevel; let solves = 0;
  fdm.trimLevel = function (...args) { if (!this.noTrim) solves++; return originalTrim.apply(this, args); };
  const s = start({ hdg, gamma, config: { flapNotch, gearDown: flapNotch > 0 } });
  spawn(s);
  assert.equal(solves, 1, 'one actual trim solve per airborne spawn');
  near(gammaOf(fdm), gamma, 'requested flight path'); near(fdm.vel.length(), s.speed, 'requested TAS');
  const path = fdm.vel.clone().normalize();
  near(Math.atan2(path.x, -path.z), Math.atan2(Math.sin(hdg * Math.PI / 180), Math.cos(hdg * Math.PI / 180)), 'heading');
  assert.equal(fdm.flapCmd, flapNotch); assert.equal(fdm.flaps, F27_FLAP_DEG[flapNotch]);
  assert.equal(fdm.gearDown, flapNotch > 0); assert.equal(fdm.gearPos, +(flapNotch > 0));
  near(fdm.trim, fdm.trimSolve(s.speed, gamma, F27_FLAP_DEG[flapNotch], +(flapNotch > 0)).trim, 'configured trim');
  fdm.step(1 / 240, () => 0, zero);
  assert.ok(Math.abs(gammaOf(fdm) - gamma) < 0.01, 'first physics step keeps requested gamma');
  trimCases++;
}
// Q02: real reachable master and feather controls survive repeated free teleports.
for (const mode of ['easy', 'medium', 'realistic']) for (const selection of ['master-off', 'left-feather', 'right-feather', 'both-feather', 'off-and-feather']) {
  const { fdm, controls, spawn } = fixture('f27', mode);
  spawn(start(), {}); fdm.fuel = 42;
  if (selection.includes('off')) controls.handlers.engineStart();
  if (selection.includes('left') || selection.includes('both') || selection === 'off-and-feather') fdm.setFeather(0, true);
  if (selection.includes('right') || selection.includes('both')) fdm.setFeather(1, true);
  const master = fdm.engineRunning, feathers = fdm.engines.map(e => e.feather);
  for (let repeat = 0; repeat < 3; repeat++) {
    const fuel = fdm.fuel;
    spawn(start({ lat: repeat + 1, gamma: -3, config: { flapNotch: 3, gearDown: true } }));
    assert.equal(fdm.engineRunning, master); assert.deepEqual(fdm.engines.map(e => e.feather), feathers);
    assert.equal(fdm.fuel, fuel, 'free relocation retains current fuel load');
    const checkEngines = () => fdm.engines.forEach((e, i) => {
      if (!master || feathers[i]) {
        assert.equal(e.lit, false); assert.equal(e.ff, 0); assert.equal(e.power, 0); assert.ok(e.thrust <= 0);
        if (feathers[i]) assert.equal(e.rpm, 0, 'initial feathered indication is not hot-spooled');
      } else { assert.equal(e.lit, true); assert.ok(e.ff > 0 && e.power > 0); }
    });
    checkEngines(); fdm.step(1 / 240, () => 0, zero); checkEngines(); engineCases++;
  }
  spawn(start(), {}); assert.equal(fdm.engineRunning, true); assert.ok(fdm.engines.every(e => !e.feather && e.lit));
}
// Deliberate ground hot/cold starts and reset's legacy approach boolean stay supported.
for (const coldBy of ['hot', 'spawn', 'checkbox']) {
  const { fdm, controls, cold, spawn } = fixture();
  spawn(start(), {}); controls.handlers.engineStart(); fdm.setFeather(0, true);
  cold.checked = coldBy === 'checkbox';
  spawn(start({ ground: true, speed: 0, cold: coldBy === 'spawn' }), {});
  assert.equal(fdm.engineRunning, coldBy === 'hot'); assert.ok(fdm.engines.every(e => !e.feather));
  assert.equal(fdm.flapCmd, 2); assert.equal(fdm.gearDown, true);
  if (coldBy !== 'hot') assert.ok(fdm.engines.every(e => !e.lit && e.rpm === 0 && e.ff === 0));
}
for (const approach of [false, true]) {
  const fdm = new F27Model(); fdm.reset(new THREE.Vector3(0, 1500, 0), 20, 80, false, -3, approach);
  assert.equal(fdm.flapCmd, approach ? 3 : 0); assert.equal(fdm.gearDown, approach); near(gammaOf(fdm), -3, 'legacy approach gamma');
}
// Other aircraft retain their own established free-relocation and hot-preset policies.
for (const id of ['c172', 'da40', 'sf50']) for (const mode of ['medium', 'realistic']) {
  const { fdm, controls, spawn } = fixture(id, mode);
  spawn(start(), {}); controls.handlers.engineStart();
  for (let repeat = 0; repeat < 3; repeat++) {
    spawn(start()); fdm.step(1 / 240, () => 0, zero);
    assert.equal(id === 'sf50' ? fdm.engineOn : fdm.magnetos, false); controlCases++;
  }
  spawn(start(), {}); assert.equal(id === 'sf50' ? fdm.engineOn : fdm.magnetos, true);
}
console.log(`PASS B04/Q02: ${trimCases} configured flight-path cases, ${engineCases} engine-state teleports, ${controlCases} other-aircraft negative controls; hot/cold and legacy approach policies retained`);
