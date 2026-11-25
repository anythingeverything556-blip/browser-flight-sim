import assert from 'node:assert/strict';
import { AltCallouts } from '../src/callouts.js';
import { Audio } from '../src/audio.js';
import { AIRCRAFT_TYPES } from '../src/aircrafts.js';
import { VOICE_KEYS } from '../src/voicewarn.js';

const flight = (aglFt, vsFpm = -500, throttle = 1, onGround = false) => ({ aglFt, vsFpm, throttle, onGround });
const c = new AltCallouts(), step = (s, dt = 1) => c.step(s, dt, () => 0.1);
step(flight(300)); assert.equal(step(flight(10)), 'h10');
assert.equal(step(flight(8)), 'retard');
for (const h of [30, 70, 140]) assert.equal(step(flight(h, 900)), null, `no thrust reduction call at ${h} ft on go-around`);
assert.equal(step(flight(10)), null, 'missed approach stays disarmed even if descending below 150 ft');
step(flight(200, 900)); assert.equal(step(flight(100)), 'h100', 'a new approach re-arms above 150 ft');
const roll = new AltCallouts(); roll.step(flight(300), 0.1);
roll.step(flight(10), 1, () => 0.1);
assert.equal(roll.step(flight(0, 0, 0.8, true), 0.5, () => 0.1), 'retard', 'ground rollout policy remains active');
assert.equal(roll.step(flight(0, 0, 0.8, true), 1.2, () => 0.1), 'retard');
assert.equal(roll.step(flight(0, 0, 0.8, true), 1.3, () => 0.1), null, 'ground rollout ends at three seconds');
console.log('PASS EW-42 full-throttle climb silence, missed-approach latch, rearm and rollout');

// A strict fake Web Audio graph tests real routing/update without fetching clips or physical speakers.
const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const nodes = [];
const node = () => {
  const n = new Proxy({ start() { this.started = true; }, stop() { this.stopped = true; }, connect(to) { this.destination = to; }, disconnect() { this.disconnected = true; } }, {
    get(o, k) { if (k in o) return o[k]; if (typeof k !== 'string') return undefined; if (/gain|frequency|Q|pan|playbackRate|detune|threshold|knee|ratio|attack|release/.test(k)) return o[k] = param(); },
  }); nodes.push(n); return n;
};
const ctx = { currentTime: 0, state: 'running', sampleRate: 1000, destination: node(),
  createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n), length: n }; } };
for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createDynamicsCompressor', 'createStereoPanner', 'createConvolver', 'createWaveShaper', 'createDelay', 'createAnalyser']) ctx[k] = node;
const audio = new Audio(); audio.init(ctx);
audio.calloutClips = Object.fromEntries(['h100', 'h90', 'h80'].map((k) => [k, { key: k, duration: 0.5 }]));
audio.voiceClips[audio.voiceStyle] = Object.fromEntries(['pullUp', 'stall'].map((k) => [k, { key: k, duration: 1 }]));
const state = { paused: false, cockpit: true, camDist: 80, camFwdDot: 0, inMachConeAhead: false, doppler: 1, mach: 0.6,
  engines: [{ dry: 0.8, ab: 0, unstart: 0 }, { dry: 0.8, ab: 0, unstart: 0 }], crashed: false, rho: 1.2, ias: 150, onGround: false, gs: 150, rain: 0, warnTone: 0 };
audio._calloutStep({ callout: flight(300) }, 0, 0.1);
audio._calloutStep({ callout: flight(95) }, 0.1, 0.1);
const routine = audio.calloutSrc;
assert.equal(routine.buffer.key, 'h100'); assert.equal(routine.destination, audio.voiceGain);
ctx.currentTime = 0.2; audio.update({ ...state, warn: { pullUp: true }, callout: flight(85) });
assert.equal(routine.stopped, true, 'pull-up interrupts the actual playing routine source');
assert.equal(audio.calloutSrc, null);
assert.equal(audio.voiceSrc.buffer.key, 'pullUp');
assert.equal(audio.voiceSrc.destination, audio.voiceGain);
ctx.currentTime = 0.3; audio.update({ ...state, warn: { pullUp: true }, callout: flight(80) });
assert.equal(audio.calloutSrc, null, 'routine voice cannot overlap a critical warning');
// Positive control from the audit: a higher-priority warning still preempts a lower warning.
audio._stopVoice(); audio.voiceSched.step({ stall: true }, 0.4, () => 1); audio._speak('stall');
const stall = audio.voiceSrc;
ctx.currentTime = 0.5; audio.update({ ...state, warn: { pullUp: true, stall: true } });
assert.equal(stall.stopped, true); assert.equal(audio.voiceSrc.buffer.key, 'pullUp');
// The phase tracker must see a go-around even while a critical warning owns the channel.
audio.callouts.next = 10;
audio._calloutStep({ callout: flight(70, 900) }, 0.6, 0.1);
assert.equal(audio.callouts.armed, false);
audio._stopVoice();
audio._calloutStep({ callout: flight(200, 900) }, 2, 1);
audio._calloutStep({ callout: flight(95) }, 3, 1);
const replacement = audio.calloutSrc;
assert.ok(replacement && replacement !== routine);
routine.onended(); assert.equal(audio.calloutSrc, replacement, 'late onended cannot clear a replacement source');
audio.resetForSpawn(); assert.equal(replacement.stopped, true); assert.equal(audio.calloutSrc, null);
console.log('PASS EW-44 real source preemption, shared routing, warning priority, phase tracking and spawn reset');

// The six registered aircraft use one warning path; only F27 has its own height scheduler.
for (const id of Object.keys(AIRCRAFT_TYPES)) {
  const a = new Audio();
  if (id === 'f27') a.configure({ engines: 2, turboprop: true });
  if (id === 'il76') a.configure({ engines: 4 });
  ctx.currentTime = 0; a.init(ctx);
  a.calloutClips = Object.fromEntries(['h100', 'h90', 'h50', 'h40'].map(key => [key, { key, duration: 0.5 }]));
  a.voiceClips[a.voiceStyle] = Object.fromEntries(VOICE_KEYS.map(key => [key, { key, duration: 1 }]));
  const call = (h, t, extra = {}) => a._calloutStep({ callout: flight(h), ...extra }, t, 0.2);
  const armAndSpeak = () => { a.callouts.reset(); call(200, 0); call(110, 0.2); call(100, 0.4); assert.equal(a.calloutSrc?.buffer.key, 'h100', id); };
  armAndSpeak();
  const gearWarn = { gearUnsafe: true };
  // Sample the active half of the pulsing horn deterministically.
  const oldNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => 100 });
  try { ctx.currentTime = 0.5; a.update({ ...state, warn: gearWarn, warnTone: 3, callout: flight(99) }); }
  finally { if (oldNow) Object.defineProperty(performance, 'now', oldNow); else delete performance.now; }
  assert.equal(gearWarn.gearUnsafe, true, `${id}: warning input not mutated`);
  assert.equal(a.voiceSrc?.buffer.key, id === 'f27' ? undefined : 'gearUnsafe', `${id}: only F27 filters gear speech`);
  assert.equal(a.warnOsc[0].frequency.value, 740, `${id}: supplied configuration horn retained`);
  assert.ok(a.warnGain.gain.value > 0, `${id}: warning tone not muted by speech`);
  const prior = a.voiceSrc || a.calloutSrc;
  ctx.currentTime = 0.6; a.update({ ...state, warn: { pullUp: true, gearUnsafe: true }, warnTone: 2, callout: flight(99) });
  assert.equal(prior.stopped, true, `${id}: pull-up preempts routine/reminder`);
  assert.equal(a.voiceSrc.buffer.key, 'pullUp', id);
  assert.equal(a.calloutSrc, null, id);
  a._stopVoice();

  // Missing warning media still gives the emergency horn the floor and consumes heights.
  armAndSpeak(); const routine = a.calloutSrc;
  call(99, 0.5, { warn: { stall: true } });
  assert.equal(routine.stopped, true, `${id}: emergency stops a currently playing height even without warning speech`);
  call(50, 0.6, { warn: { stall: true } });
  call(50, 1.6); assert.equal(a.calloutSrc, null, `${id}: no delayed h50 after warning`);
  call(40, 1.8); assert.equal(a.calloutSrc?.buffer.key, 'h40', `${id}: next valid height retained`);

  for (const mode of ['enabled', 'volume', 'held', 'paused', 'slew', 'crashed']) {
    armAndSpeak(); const src = a.calloutSrc;
    const extra = {};
    if (mode === 'enabled') a.enabled = false;
    else if (mode === 'volume') a.volume = 0;
    else if (mode === 'held') a.held = true;
    else extra[mode] = true;
    call(99, 0.5, extra);
    assert.equal(src.stopped, true, `${id}/${mode}: stop current routine speech`);
    assert.equal(a.calloutSrc, null, `${id}/${mode}: no new routine speech`);
    a.enabled = true; a.volume = 0.7; a.held = false;
  }
  armAndSpeak(); const settingSrc = a.calloutSrc; a.setCallouts(false);
  assert.equal(settingSrc.stopped, true, `${id}: accessibility callout setting still stops speech`);
  console.log(`PASS ${id}: shared warning priority, F27-only gear filtering, no backlog, mute/pause/reset and callout setting`);
}
