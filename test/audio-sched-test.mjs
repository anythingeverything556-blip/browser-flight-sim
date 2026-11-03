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
console.log('all audio scheduling tests passed'); process.exit(0);
