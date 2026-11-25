// Toy-sim regression: actual controller + deterministic clock, browser speech and live UI callbacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Atc } from '../src/atc.js';

let now = 0, id = 0, cancelled = 0;
const timers = new Map(), spoken = [], active = [];
globalThis.setTimeout = (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; };
globalThis.clearTimeout = (key) => timers.delete(key);
const tick = (ms) => {
  const end = now + ms;
  for (;;) {
    const next = [...timers].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  now = end;
};
globalThis.window = { speechSynthesis: {} };
globalThis.speechSynthesis = { speak(u) { spoken.push(u); active.push(u); }, cancel() { cancelled++; active.length = 0; } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.document = { createElement() { return { classList: { add() {} }, firstChild: {}, lastChild: {}, remove() {} }; } };
const make = () => {
  const children = [], audio = { enabled: true, volume: 0.7 };
  const box = { children, appendChild(m) { children.push(m); }, get firstChild() { return { remove() { children.shift(); } }; } };
  return { audio, atc: new Atc(box, audio) };
};
const base = { started: true, crashed: false, onGround: false, gearDown: true, gsKt: 150,
  apt: { name: 'Departure Airport' }, rwy: '15', arrApt: { name: 'Arrival Airport' }, arrRwy: '22L', wind: { dir: 270, kt: 5 } };
const { atc } = make(), lines = [];
atc.say = (from, text) => lines.push({ from, text });
const approach = (distance, agl, ilsValid = true) => atc.update(0.1, { ...base, agl, nav: { ilsValid, thrDist: distance } });
approach(20000, 3000); approach(8200, 1100);
assert.equal(atc.s.land, true);
// EW-41: this used to send both go-around and landing in a single update.
approach(8900, 1250);
assert.match(lines.at(-1).text, /go around/i);
assert.equal(lines.filter((m) => /cleared to land/i.test(m.text)).length, 1);
assert.equal(atc.s.goAround, true); assert.equal(atc.s.land, false);
assert.equal(atc.s.phase, 'goAround');
assert.equal(atc.timers.size, 1, 'only the missed-approach readback survives');
for (const [d, h] of [[9200, 1500], [9100, 1700], [10000, 2100], [16000, 3000], [15900, 2990]]) approach(d, h);
assert.equal(atc.s.goAround, true, 'outbound/climb and small reversals cannot re-clear');
assert.equal(lines.filter((m) => /cleared to land/i.test(m.text)).length, 1);
approach(15000, 2800);
assert.equal(atc.s.goAround, false); assert.equal(atc.s.land, false);
assert.equal(lines.filter((m) => /cleared ILS/i.test(m.text)).length, 2, 'new inbound descending approach gets a fresh clearance');
approach(9000, 1400);
assert.equal(lines.filter((m) => /cleared to land/i.test(m.text)).length, 2);
assert.ok(lines.every((m) => m.from.startsWith('Arrival')), 'arrival naming preserved');
atc.reset(); assert.equal(atc.s.goAround, false); assert.equal(atc.s.land, false);
console.log('PASS EW-41 exclusive missed approach, stale readback cancellation, distinct inbound re-entry and reset');

// EW-43: delayed speech reads current state, including changes outside UI callbacks.
for (const change of [(a) => { a.enabled = false; }, (a) => { a.volume = 0; }, (a) => { a.held = true; }]) {
  const { audio, atc } = make(); const count = spoken.length;
  atc.say('Tower', 'queued', 'queued'); change(audio); tick(140);
  assert.equal(spoken.length, count); atc.hush();
}
{
  const { audio, atc } = make();
  atc.say('Tower', 'volume changed', 'current volume'); audio.volume = 0.2; tick(140);
  assert.equal(spoken.at(-1).volume, 0.2 * 0.9);
  atc.hush();
}
// Execute all three actual control entry points rather than only testing a helper in isolation.
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
for (const entry of ["$('vol').addEventListener('input'", "$('b-sound').addEventListener('click'", "controls.on('sound'"]) {
  const { audio, atc } = make(), handlers = {}, elements = {};
  const $ = (key) => elements[key] ||= { value: '0', classList: { toggle() {} }, addEventListener(event, fn) { handlers[event] = fn; } };
  const line = source.split('\n').find((text) => text.startsWith(entry)); assert.ok(line, entry);
  vm.runInNewContext(line, { $, audio, atc, settings: {}, saveSettings() {}, controls: { on(event, fn) { handlers[event] = fn; } } });
  atc.say('Tower', 'active', 'active'); tick(140);
  atc.say('Tower', 'pending', 'pending');
  const before = spoken.length, cancels = cancelled;
  Object.values(handlers)[0]();
  assert.ok(cancelled > cancels, `${entry} cancels active browser speech`);
  assert.equal(active.length, 0); assert.equal(atc.timers.size, 0);
  tick(5000); assert.equal(spoken.length, before, `${entry} drops delayed speech and readbacks`);
  // Muting keeps text/logging operational and restoring sound permits a new transmission.
  audio.enabled = true; audio.volume = 0.7;
  atc.say('Tower', 'restored', 'restored'); tick(140);
  assert.equal(spoken.at(-1).text, 'restored'); atc.hush();
}
console.log('PASS EW-43 late state/volume check and immediate cancellation via slider, button and keyboard');
