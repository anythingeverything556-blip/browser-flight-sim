// ATC radio: one shared AudioContext and one cached noise buffer for every squelch; hush() / hidden stop speech and pending readbacks.
import assert from 'node:assert/strict';
import { Atc } from '../src/atc.js';

let made = 0, buffers = 0, spoken = [], cancelled = 0;
const mkCtx = () => { made++; return { state: 'running', sampleRate: 8000, destination: {}, createBuffer: (c, n) => { buffers++; return { getChannelData: () => new Float32Array(n) }; },
  createBufferSource: () => ({ connect() {}, disconnect() {}, start() {} }), createBiquadFilter: () => ({ connect() {}, disconnect() {}, frequency: {}, Q: {} }), createGain: () => ({ connect() {}, disconnect() {}, gain: {} }) }; };
globalThis.window = { AudioContext: function () { return mkCtx(); }, speechSynthesis: {} };
globalThis.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel: () => cancelled++ };
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
const el = () => { const kids = []; return { children: kids, appendChild: (c) => kids.push(c), get firstChild() { return { remove: () => kids.shift() }; } }; };
globalThis.document = { createElement: () => ({ classList: { add() {} }, remove() {}, set innerHTML(v) {}, firstChild: {}, lastChild: {} }) };
const t = async (n, f) => { try { await f(); console.log('PASS ', n); } catch (e) { console.error('FAIL ', n, '\n', e); process.exit(1); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await t('squelch without the game context makes one context and one buffer for many messages', () => {
  const atc = new Atc(el(), { enabled: true, volume: 0.5 }); for (let i = 0; i < 20; i++) atc.squelch();
  assert.equal(made, 1); assert.equal(buffers, 1);
});
await t('squelch reuses the game audio context (no second context)', () => {
  made = 0; buffers = 0; const ctx = mkCtx(); made = 0; const atc = new Atc(el(), { enabled: true, volume: 0.5, ctx });
  for (let i = 0; i < 20; i++) atc.squelch(); assert.equal(made, 0); assert.equal(buffers, 1);
});
await t('a held (paused / hidden) game audio stays silent', () => {
  buffers = 0; const atc = new Atc(el(), { enabled: true, volume: 0.5, ctx: mkCtx(), held: true }); atc.squelch(); assert.equal(buffers, 0);
});
await t('hidden tab: no voice, pending speech and readbacks are dropped', async () => {
  spoken = []; cancelled = 0; const atc = new Atc(el(), { enabled: true, volume: 0.5, ctx: mkCtx() });
  atc.say('Tower', 'cleared', 'cleared for take-off'); assert.equal(atc.timers.size, 1); atc.setHidden(true); assert.equal(atc.timers.size, 0); assert.ok(cancelled >= 1);
  await wait(200); assert.deepEqual(spoken, []); atc.say('Tower', 'again', 'again'); await wait(200); assert.deepEqual(spoken, [], 'nothing voiced while hidden');
  atc.setHidden(false); atc.say('Tower', 'back', 'back'); await wait(200); assert.deepEqual(spoken, ['back']);
});
await t('reset (respawn) drops pending radio', () => { const atc = new Atc(el(), { enabled: true, volume: 0.5, ctx: mkCtx() }); atc.say('Tower', 'x', 'x'); atc.reset(); assert.equal(atc.timers.size, 0); });
console.log('all atc audio tests passed'); process.exit(0);
