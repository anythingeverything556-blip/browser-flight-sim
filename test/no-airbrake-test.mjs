// Round 5: the SR-71 had neither an air brake nor thrust reversers, so both (owner follow-up 5 additions) are gone: no keys, no flight-model state
// or forces, no HUD pills, no help rows, no aircraft panels or doors. Replaces brakes-test.mjs, which tested the two features.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const listeners = {};
globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
globalThis.innerWidth = 1000; globalThis.innerHeight = 800;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
const flight = await import('../src/flight.js');
const { Controls } = await import('../src/controls.js');
const { FlightModel } = flight;
const flat = () => 0, calm = new THREE.Vector3();
const t = (n, f) => { f(); console.log('PASS ', n); };
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

t('flight model: no air brake or reverser exports, state or events', () => {
  for (const k of ['AIRBRAKE_CD', 'AIRBRAKE_TIME', 'REVERSER_FRACTION', 'REVERSER_MIN_V']) assert.ok(!(k in flight), `${k} still exported`);
  const f = new FlightModel(); f.reset(new THREE.Vector3(0, 6000, 0), 90, 250, false, 0);
  for (const k of ['airbrake', 'airbrakeCmd', 'reverser']) assert.ok(!(k in f), `fdm.${k} still exists`);
});

t('a stray airbrake or reverser field on the model has no effect (drag and thrust ignore it)', () => {
  const fly = (stray) => { const dt = 1 / 60, f = new FlightModel(); f.reset(new THREE.Vector3(0, 6000, 0), 90, 250, false, 0); f.setEngines(0.7, false);
    if (stray) { f.airbrakeCmd = true; f.airbrake = 1; f.reverser = true; }
    for (let s = 0; s < 10; s += dt) { f.step(dt, flat, calm); f.events.length = 0; } return [f.pos.x, f.pos.y, f.vel.x, f.vel.y, f.out.thrust]; };
  assert.deepEqual(fly(true), fly(false));
});

t('thrust on a ground roll at full power is forward, never reversed', () => {
  const dt = 1 / 120, f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 90, 75, true, 0); f.setEngines(1, false);
  let events = [];
  for (let s = 0; s < 3; s += dt) { f.step(dt, flat, calm); events = events.concat(f.events); f.events.length = 0; }
  assert.ok(f.out.thrust > 0 && f.engines.every((e) => e.thrust > 0), `thrust ${f.out.thrust}`);
  assert.ok(!events.some((e) => /airbrake|reverser/.test(e)), events.join(','));
});

t('keys F and N do nothing (no air brake / reverse actions bound)', () => {
  const c = new Controls(); c.enabled = true; const fired = [];
  for (const a of ['airbrake', 'reverse']) c.on(a, () => fired.push(a));
  for (const code of ['KeyF', 'KeyN']) c.fire({ code, shiftKey: false, preventDefault() {} });
  assert.deepEqual(fired, []);
  // round 6: F is the Skyhawk's flaps key (Shift+F up); it may map to nothing else, and N stays unmapped
  const cs = src('src/controls.js'), f = /KeyF:\s*([^\n]*)/.exec(cs);
  assert.ok(!/KeyN:/.test(cs), 'KeyN still mapped');
  assert.ok(!f || (/flaps/.test(f[1]) && !/airbrake|reverse/.test(f[1])), `KeyF mapped to ${f && f[1]}`);
});

// The Il-76 (added later) does have spoilers and thrust reversers: its own key rows, help text and docs are allowed in the shared files, but only on lines
// that name the Il-76, and the SR-71's guide, tutorial and missions stay clean.
const BANNED = /air ?brake|reverse thrust|reverser|SPD BRK/i, IL76 = /il-?76/i;
const strayLines = (f) => src(f).split('\n').filter((l) => BANNED.test(l) && !IL76.test(l));
t('HUD, help, guide, tutorial and missions no longer offer them to the SR-71', () => {
  const html = src('index.html');
  assert.ok(!/id="p-spd"|id="p-rev"|SPD BRK/.test(html), 'HUD pills still in index.html');
  assert.ok(!/<td>F<\/td>|<td>N<\/td>/.test(html), 'help rows still in index.html');
  assert.deepEqual(strayLines('index.html'), [], 'index.html mentions them outside Il-76 text');
  for (const f of ['src/guide.js', 'src/tutorial.js', 'src/missions.js']) assert.ok(!BANNED.test(src(f)), `${f} still mentions them`);
  for (const f of ['src/main.js', 'README.md']) assert.deepEqual(strayLines(f), [], `${f} mentions them outside Il-76 text`);
});

t('the Il-76 keys exist but are bound to digits, never to F or N, and main.js refuses them in every other aircraft', () => {
  const cs = src('src/controls.js');
  for (const a of ['spoilers', 'reverse', 'cargo', 'paratroop']) assert.ok(new RegExp(`id: '${a}'[^\\n]*keys: \\['Digit[2-5]'\\]`).test(cs), `${a} on a digit`);
  assert.ok(/IS_IL76 \? il76c\[fn\]\(\) : toast\('This is an Il-76 control', true\)/.test(src('src/main.js')), 'other aircraft are refused');
});

t('aircraft visual has no air brake panels or reverser doors', () => {
  const a = src('src/aircraft.js');
  assert.ok(!/buildBrakes|updateBrakes|airbrakes|fx\.doors|revT/.test(a), 'brake/door geometry still built in aircraft.js');
});

console.log('all air brake / reverse thrust removal tests passed');
