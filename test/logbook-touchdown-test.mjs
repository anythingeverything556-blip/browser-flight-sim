// B12: exercise the real landing-write block with real C172 contact events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { C172Model } from '../src/c172.js';
import { FlightLogbook } from '../src/logbook.js';
import { TouchdownReporter, AIR_MIN } from '../src/touchdown.js';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('  // one message per landing, not one per wheel contact');
const end = main.indexOf('  fdm.events.length = 0;', start);
assert.ok(start >= 0 && end > start, 'real landing-write block must be found');
const recordLanding = main.slice(start, end);
const setup = { aircraft: 'c172', airport: 'KBAB', rwy: 0, end: 1, mode: 'approach', mission: 'free', weather: 'clear', hour: 15 };
const dt = 1 / 60;
function fixture(sink, crashOff = false) {
  const fdm = new C172Model();
  fdm.reset(new THREE.Vector3(0, 1.2, 0), 90, 32, false);
  fdm.quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.15);
  fdm.w.set(0, 0, 0); fdm.vel.set(32, -sink, 0); fdm.crashOff = crashOff;
  fdm.step(1 / 240, () => 0, new THREE.Vector3());
  assert.ok(fdm.events.some(e => e?.type === 'touch' && e.wheel > 0), 'real main-wheel contact required');
  let text = null, renders = 0;
  const logbook = new FlightLogbook(() => ({ getItem: () => text, setItem: (_, value) => { text = value; } }));
  // A failed flight must not damage earlier completed flights or the resumable setup.
  logbook.begin(setup); logbook.tick(5); logbook.land('KSQL', 0.8);
  const previous = logbook.read().entries[0];
  logbook.begin(setup); logbook.tick(30);
  const touchdown = new TouchdownReporter(); touchdown.frame([], AIR_MIN + 1, false);
  const messages = [];
  const scope = { fdm, logbook, touchdown, dt, toast: value => messages.push(value),
    aircraftLatLon: () => ({ lat: 0, lon: 0 }), db: { nearest: () => ({ ident: 'KBAB', lat: 0, lon: 0 }) },
    haversine: () => 0, renderLogbook: () => { renders++; } };
  return { fdm, logbook, previous, messages, run: () => vm.runInNewContext(recordLanding, scope), renders: () => renders };
}
{
  const f = fixture(12);
  assert.ok(f.fdm.crashed); assert.ok(f.fdm.events.includes('crash'));
  const events = structuredClone(f.fdm.events);
  f.run();
  assert.deepEqual(f.logbook.read().entries, [f.previous], 'fatal touch/crash must not be saved as a completed landing');
  assert.equal(f.logbook.active, null, 'fatal flight must be cancelled');
  assert.equal(f.renders(), 0); assert.deepEqual(f.messages, []);
  assert.deepEqual(f.logbook.read().last, setup);
  assert.deepEqual(f.fdm.events, events, 'accounting must not consume contact or crash effects');
  // No later main-wheel report on the wreck can finish the cancelled flight.
  f.fdm.events = [{ type: 'touch', wheel: 2, vs: 2 }]; f.run();
  assert.deepEqual(f.logbook.read().entries, [f.previous]);
}
{
  const f = fixture(1.2);
  assert.ok(!f.fdm.crashed); f.run();
  const entries = f.logbook.read().entries;
  assert.equal(entries.length, 2); assert.deepEqual(entries[1], f.previous);
  assert.equal(entries[0].arrival, 'KBAB'); assert.equal(entries[0].sinkFpm, 236);
  assert.equal(entries[0].quality, 'Firm'); assert.equal(f.renders(), 1);
  assert.deepEqual(f.messages, ['Touchdown 236 fpm']);
  f.run(); assert.equal(f.logbook.read().entries.length, 2); assert.equal(f.renders(), 1);
}
{
  const f = fixture(12, true);
  assert.ok(!f.fdm.crashed); assert.ok(f.fdm.events.includes('crash-absorbed'));
  f.run(); assert.equal(f.logbook.read().entries.length, 2, 'Crash off still allows nonfatal contact');
  assert.equal(f.renders(), 1); assert.equal(f.messages.length, 1);
}
{
  const f = fixture(1.2);
  // Crash without a reportable main-wheel contact (e.g. nose-first or obstacle).
  f.fdm.crashed = 'fatal impact'; f.fdm.events = ['crash']; f.run();
  assert.equal(f.logbook.active, null); assert.deepEqual(f.logbook.read().entries, [f.previous]);
}
console.log('PASS B12: real same-step fatal touch/crash excluded; normal touchdown saved once; contact events, Crash off and earlier flights preserved');
