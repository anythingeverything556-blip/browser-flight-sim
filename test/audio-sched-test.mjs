// Audio: param writes are skipped when the target did not move, suspend/resume holds the context, resetForSpawn ends the wreck.
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';

let calls = 0, ctxTime = 0;
const param = () => ({ value: 0, setTargetAtTime() { calls++; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() { param.cancelled++; } });
param.cancelled = 0;
const node = () => new Proxy({ connect() {}, disconnect() { this.gone = true; }, start() {}, stop() {}, getChannelData: () => new Float32Array(1 << 20) }, {
  get(o, k) { if (k in o) return o[k]; if (typeof k === 'symbol') return undefined; return (o[k] = /gain|frequency|Q|pan|playbackRate|detune|threshold|knee|ratio|attack|release/.test(k) ? param() : undefined); },
  set(o, k, v) { o[k] = v; return true; },
});
const ctx = { state: 'running', sampleRate: 8000, get currentTime() { return ctxTime; }, destination: node(), suspended: 0, resumed: 0,
  suspend() { this.suspended++; this.state = 'suspended'; return Promise.resolve(); }, resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); },
  createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n), length: n }) };
for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createDynamicsCompressor', 'createStereoPanner', 'createConvolver', 'createWaveShaper', 'createDelay', 'createAnalyser']) ctx[k] = node;

const t = (n, f) => Promise.resolve().then(f).then(() => console.log('PASS ', n), (e) => { console.error('FAIL ', n, '\n', e); process.exit(1); });
const engines = [{ dry: 0.8, ab: 0, unstart: 0 }, { dry: 0.8, ab: 0, unstart: 0 }];
const st = (o = {}) => ({ paused: false, cockpit: false, camDist: 80, camFwdDot: -0.5, inMachConeAhead: false, doppler: 1, mach: 0.6, engines, crashed: false, rho: 1.2, ias: 150, onGround: false, gs: 150, rain: 0, gearMoving: false, warnTone: 0, ...o });

const a = new Audio(); a.init(ctx);
await t('steady state schedules (almost) nothing after the first frame', () => {
  a.update(st()); const first = calls; assert.ok(first > 40, `first frame sets everything (${first})`);
  calls = 0; for (let i = 0; i < 100; i++) { ctxTime += 0.016; a.update(st()); }
  console.log(`   first frame ${first} setTargetAtTime calls, then ${calls} over 100 steady frames`);
  assert.ok(calls / 100 < 5, `${calls / 100} per frame`);
});
await t('a real change still gets through', () => { calls = 0; a.update(st({ ias: 400 })); assert.ok(calls > 3); calls = 0; a.update(st({ ias: 400 })); assert.equal(calls, 0); });
await t('suspend fades then suspends; init() does not resume a held context; resume() does', async () => {
  a.suspend(10); await new Promise((r) => setTimeout(r, 30)); assert.equal(ctx.suspended, 1); a.init(); assert.equal(ctx.resumed, 0, 'a key press must not wake a paused game');
  calls = 0; a.update(st()); assert.equal(calls, 0, 'no scheduling while suspended'); a.resume(); assert.equal(ctx.resumed, 1); assert.equal(a.held, false);
});
await t('suspend then resume before the fade ends never suspends', async () => { a.suspend(20); a.resume(); await new Promise((r) => setTimeout(r, 40)); assert.equal(ctx.suspended, 1); });
await t('master gain comes back after resume', () => { calls = 0; ctxTime += 1; a.update(st()); assert.ok(calls >= 1); });
await t('resetForSpawn clears the wreck timers, silences the layers and replaces the wreck bus', () => {
  a.play('crash', 1); a.play('explosion', 1, 0); const bus = a.wreckBus;
  assert.ok(a.wreckFadeUntil > 0 && a.wreckFireUntil > 0);
  a.resetForSpawn(); assert.equal(a.wreckFadeUntil, 0); assert.equal(a.wreckScrapeUntil, 0); assert.equal(a.wreckFireUntil, 0); assert.equal(a.wreckLevel, 0); assert.equal(a.wreckFireLevel, 0);
  assert.equal(bus.gone, true, 'old bus disconnected'); assert.notEqual(a.wreckBus, bus); assert.ok(param.cancelled >= 4);
  assert.equal(a.route, null, 'routing restored');
});
await t('wreck sounds route to the bus, others to the mix', () => {
  assert.equal(a._out(), a.mix); a.route = a.wreckBus; assert.equal(a._out(), a.wreckBus); a.route = null;
});
// ---- the Il-76: four PS-90A-76 voices, panned by position, fan tone tied to N1 (33 blades, 4,340 rpm), reverse and systems layers, no afterburner layers ----
const rec = () => ({ value: 0, last: null, setTargetAtTime(v) { this.last = v; calls++; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const node2 = () => new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {}, getChannelData: () => new Float32Array(1 << 20) }, {
  get(o, k) { if (k in o) return o[k]; if (typeof k === 'symbol') return undefined; return (o[k] = /gain|frequency|Q|pan|playbackRate|detune|threshold|knee|ratio|attack|release/.test(k) ? rec() : undefined); },
  set(o, k, v) { o[k] = v; return true; },
});
const ctx2 = { state: 'running', sampleRate: 8000, get currentTime() { return ctxTime; }, destination: node2(), suspend() { return Promise.resolve(); }, resume() { return Promise.resolve(); }, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n), length: n }) };
for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createDynamicsCompressor', 'createStereoPanner', 'createConvolver', 'createWaveShaper', 'createDelay', 'createAnalyser']) ctx2[k] = node2;
const il = new Audio(); il.configure({ engines: 4 }); il.init(ctx2);
const eng4 = (dry, rev = 0) => dry.map((d, i) => ({ dry: d, ab: 0, unstart: 0, rev: Array.isArray(rev) ? rev[i] : rev, revPow: d, lit: true }));
const st4 = (engs, o = {}) => ({ ...st({ engines: engs, profile: 'turbofan4', ias: 120, cockpit: false }), ...o });
await t('four engine voices, no afterburner layers, buzz-saw and core voices on each', () => {
  assert.equal(il.eng.length, 4); assert.ok(il.eng.every((e) => !e.abLow && !e.crack && e.buzz && e.core && e.whine.oscs.length === 3), 'voices'); assert.ok(il.il && il.il.apu && il.il.buffet && il.il.hold, 'systems layers');
  assert.equal(a.eng.length, 2, 'the default stays two engines'); assert.ok(a.eng[0].abLow, 'afterburner layers kept for the SR-71');
});
await t('each engine\'s fan tone is the blade-passing frequency of its own N1: 716 Hz at idle to 2,387 Hz at take-off', () => {
  ctxTime += 1; il.update(st4(eng4([0, 0.5, 0.8, 1]))); const f = (i) => il.eng[i].whine.oscs[0].o.frequency.last / il.eng[i].whine.detune;
  const bpf = (p) => 33 * 4340 / 60 * (0.3 + 0.7 * p);
  for (const [i, p] of [[0, 0], [1, 0.5], [2, 0.8], [3, 1]]) assert.ok(Math.abs(f(i) - bpf(p)) < 2, `engine ${i + 1}: ${f(i).toFixed(0)} vs ${bpf(p).toFixed(0)} Hz`);
  assert.ok(Math.abs(f(0) - 716) < 3 && Math.abs(f(3) - 2387) < 3, 'idle and take-off figures');
  assert.ok(f(0) < f(1) && f(1) < f(2) && f(2) < f(3), 'four different tones');
});
await t('the buzz-saw comes in above about 85 % N1; a reverser out is louder and lower and mutes the fan tone', () => {
  ctxTime += 1; il.update(st4(eng4([0.4, 0.4, 1, 1], [0, 0, 0, 1]), { camFwdDot: 1 }));
  const g = (i, k) => il.eng[i][k].g.gain.last;
  assert.ok(g(0, 'buzz') < 1e-6 && g(2, 'buzz') > 1e-4, `buzz ${g(0, 'buzz')} ${g(2, 'buzz')}`); assert.ok(g(2, 'core') > g(0, 'core'), 'core whine follows N2');
  assert.ok(g(3, 'roar') > g(2, 'roar') * 1.4, 'reverse roar'); assert.ok(il.eng[3].roar.fl.frequency.last < il.eng[2].roar.fl.frequency.last, 'lower pitch in reverse'); assert.ok(il.eng[3].whine.g.gain.last < il.eng[2].whine.g.gain.last * 0.7, 'fan tone muted');
});
await t('four engines schedule (almost) nothing in steady state, and a change in one engine moves only its own voices', () => {
  const S = () => st4(eng4([0.8, 0.8, 0.8, 0.8])); ctxTime += 1; il.update(S()); calls = 0; for (let i = 0; i < 100; i++) { ctxTime += 0.016; il.update(S()); } assert.ok(calls / 100 < 5, `${calls / 100} per frame`);
  const before = il.eng.map((e) => e.roar.g.gain.last); ctxTime += 1; il.update(st4(eng4([0.8, 0.8, 0.8, 0.3])));
  assert.deepEqual(il.eng.slice(0, 3).map((e) => e.roar.g.gain.last), before.slice(0, 3)); assert.ok(il.eng[3].roar.g.gain.last < before[3]);
});
await t('APU on the ground, spoiler buffet, hydraulic pumps for flaps and cargo, cabin boom and wind scale to the airframe; the Il-76 one-shots and warning tones exist', () => {
  ctxTime += 1; il.update(st4(eng4([0.1, 0.1, 0.1, 0.1]), { cockpit: true, onGround: true, gs: 2, ias: 4, apu: true })); assert.ok(il.il.apu.g.gain.last > 0.005, 'APU whine in the cockpit');
  ctxTime += 1; il.update(st4(eng4([0.8, 0.8, 0.8, 0.8]), { cockpit: true, spoilers: 1, ias: 140, flapMoving: true })); assert.ok(il.il.buffet.g.gain.last > 0.05, 'buffet'); assert.ok(il.hyd.pumpG.gain.last > 0.03, 'flap motor'); assert.ok(il.il.hold.g.gain.last > 0.05, 'cabin boom');
  ctxTime += 1; il.update(st4(eng4([0.8, 0.8, 0.8, 0.8]), { cockpit: true, ias: 200, cargoMoving: true })); assert.ok(il.hyd.pump.frequency.last < 140 + 56, 'cargo drone is lower than the gear whine');
  for (const n of ['touch-bogies', 'reverser-deploy', 'reverser-stow', 'spoiler', 'cargo-clunk', 'flap-clunk', 'gear-lock', 'gear-door']) assert.doesNotThrow(() => il.play(n, n === 'spoiler' || n === 'cargo-clunk' ? -1 : 1), n);
  for (const w of [1, 2, 3, 4]) assert.doesNotThrow(() => il.update(st4(eng4([0.8, 0.8, 0.8, 0.8]), { warnTone: w })), `warning tone ${w}`);
  assert.doesNotThrow(() => a.update(st({ engines: eng4([0.5, 0.5, 0.5, 0.5]) })), 'a two-voice Audio given four engines plays the first two');
});
console.log('all audio scheduling tests passed'); process.exit(0);
