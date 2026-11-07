// Synthesised SR-71 audio, built from physical cues rather than looped samples:
//  - each J58 is a stack of core rumble, mixing-noise roar, exhaust hiss and compressor whine, with the slow random
//    wobble of real jet noise; afterburner adds a deep rolling roar, a mid growl and crackle
//  - wind scales with dynamic pressure, tyres rumble and thump over runway joints, gear has a hydraulic pump and clunks
//  - impacts are modal: struck metal is a handful of damped inharmonic partials, tearing is rough band-passed noise,
//    explosions are a sub-bass sweep plus a filtered whoomp that arrives late and dull with distance, fire crackles
import { VOICE_KEYS, VoiceScheduler, voiceStyle, voiceUrl, DEFAULT_VOICE_STYLE } from './voicewarn.js';
import { AltCallouts, CALLOUT_KEYS } from './callouts.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

function lowpass(d, fc, sr, passes = 1) {
  const a = Math.exp(-TAU * fc / sr);
  for (let p = 0; p < passes; p++) { let y = 0; for (let i = 0; i < d.length; i++) { y = (1 - a) * d[i] + a * y; d[i] = y; } }
}
function normalise(d, peak) {
  let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
}
// the tail is faded into the head so the looped buffer has no click
function loopable(d, fade) {
  const n = d.length - fade, o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = d[i];
  for (let i = 0; i < fade; i++) { const t = i / fade; o[i] = d[i] * t + d[n + i] * (1 - t); }
  return o;
}

const WRECK_SOUNDS = new Set(['impact', 'crunch', 'scrape', 'grind', 'explosion', 'fire', 'crash']);

const NO_FAN = { cabin: 1, rumble: 1, roar: 1, hiss: 1, pitch: 1, whine: 1, whineLo: 1100, whineSpan: 3400 };
const FAN = { cabin: 0.55, rumble: 0.4, roar: 0.55, hiss: 1.1, pitch: 1.5, whine: 2.6, whineLo: 1900, whineSpan: 3800 };

export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.volume = 0.7; this.held = false; this.last = new WeakMap(); this.wreckBus = null; this.route = null;
    this.voiceOn = true; this.voiceStyle = DEFAULT_VOICE_STYLE; this.voiceBase = '/'; this.voiceClips = {}; this.voiceSrc = null; this.voiceSched = new VoiceScheduler(); this.calloutsOn = true; this.callouts = new AltCallouts(); this.calloutClips = null; this.calloutSrc = null; }

  // ctx: an existing (e.g. offline) context, for tests
  init(ctx) {
    if (this.ctx) { if (!this.held && this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
    const C = this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const sr = C.sampleRate;
    const mk = (secs, fill) => {
      const fade = Math.floor(sr * 0.1), d = new Float32Array(Math.floor(sr * secs) + fade);
      fill(d);
      const o = loopable(d, fade), b = C.createBuffer(1, o.length, sr);
      b.getChannelData(0).set(o);
      return b;
    };
    this.white = mk(6, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.pink = mk(6, (d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    });
    this.brown = mk(6, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    // slow bipolar wobble (about 0.5-3 Hz) that modulates gains: jet noise is never steady
    this.wobble = mk(8, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; lowpass(d, 2.2, sr, 2); normalise(d, 1); });
    // combustion roughness as a modulator: bipolar noise around 20-45 Hz
    this.rough = mk(6, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; lowpass(d, 38, sr, 2); normalise(d, 1); });
    // grit: pink-ish noise whose loudness flutters at that rate: tearing metal, the afterburner growl
    this.grit = mk(6, (d) => {
      const n = new Float32Array(d.length); let b0 = 0, b1 = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + w * 0.2; b1 = 0.78 * b1 + w * 0.5; d[i] = b0 + b1 + w * 0.3; n[i] = Math.random() * 2 - 1; }
      lowpass(n, 42, sr, 2); normalise(n, 1);
      for (let i = 0; i < d.length; i++) d[i] *= 0.25 + 0.75 * Math.min(1, Math.abs(n[i]) * 1.8);
      normalise(d, 0.9);
    });
    // sparse sharp pops of widely varying size
    this.crackle = mk(14, (d) => {
      for (let i = 0; i < d.length - 600; i++) if (Math.random() < 0.00055) {
        const a = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1), L = 30 + Math.random() * 260;
        for (let k = 0; k < L; k++) d[i + k] += a * Math.exp(-k / (L * 0.22)) * (Math.random() * 2 - 1);
      }
      normalise(d, 0.95);
    });
    // one thump at the start of a second of silence: played faster or slower it is a joint every so often
    this.thumpBuf = (() => {
      const b = C.createBuffer(1, sr, sr), d = b.getChannelData(0);
      for (let i = 0; i < sr * 0.12; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.028));
      lowpass(d, 110, sr, 2); normalise(d, 0.9);
      return b;
    })();

    const filt = (type, f, q = 0.707) => { const n = C.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const gain = (v = 0) => { const g = C.createGain(); g.gain.value = v; return g; };
    this._filt = filt; this._gain = gain;

    // master: cabin muffling, gentle compression, then a limiter so a crash on top of afterburners cannot clip
    this.limiter = C.createDynamicsCompressor();
    this.limiter.threshold.value = -8; this.limiter.knee.value = 4; this.limiter.ratio.value = 14; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.14;
    this.comp = C.createDynamicsCompressor(); this.comp.threshold.value = -22; this.comp.knee.value = 18; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.master = gain(0); this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(C.destination);
    this.cabin = filt('lowpass', 20000, 0.5); this.cabin.connect(this.master);
    this.hp = filt('highpass', 30, 0.5); this.hp.connect(this.cabin);
    this.mix = gain(1); this.mix.connect(this.hp);
    this.wreckBus = gain(1); this.wreckBus.connect(this.mix);
    this.dopplerSources = [];

    const src = (buf, rate = 1, doppler = false) => {
      const s = C.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
      s.start(0, Math.random() * buf.duration);
      if (doppler) this.dopplerSources.push([s, rate]);
      return s;
    };
    // buffer -> filter -> gain -> dest, plus an optional wobble that moves the gain around its set value
    const voice = (buf, type, f, q, dest, wob = 0, doppler = false) => {
      const s = src(buf, 1, doppler), fl = filt(type, f, q), g = gain(0); s.connect(fl); fl.connect(g); g.connect(dest);
      const v = { s, fl, g, wob: null };
      if (wob) { const w = src(this.wobble, rnd(0.6, 1.5)), wg = gain(0); w.connect(wg); wg.connect(g.gain); v.wob = wg; v.wobDepth = wob; }
      return v;
    };
    this._voice = voice;

    this.eng = [-0.22, 0.22].map((pan) => {
      const out = C.createStereoPanner(); out.pan.value = pan; out.connect(this.mix);
      const e = {
        rumble: voice(this.brown, 'bandpass', 140, 0.45, out, 0.25, true),
        roar: voice(this.pink, 'bandpass', 600, 0.6, out, 0.2, true),
        hiss: voice(this.white, 'highpass', 3000, 0.5, out, 0.15, true),
        abLow: voice(this.brown, 'bandpass', 95, 0.6, out, 0.45, true),
        abMid: voice(this.grit, 'bandpass', 300, 0.7, out, 0.3, true),
        abHigh: voice(this.pink, 'bandpass', 1250, 0.6, out, 0.25, true),
        crack: voice(this.crackle, 'highpass', 500, 0.7, out, 0, true),
      };
      // compressor whine: the blade-pass tone and two upper partials, slightly detuned so two engines beat
      const detune = rnd(0.985, 1.015);
      const oscs = [[1, 'sine', 1], [2.003, 'sine', 0.45], [3.01, 'triangle', 0.22]].map(([m, type, a]) => {
        const o = C.createOscillator(); o.type = type; o.frequency.value = 2000; const og = gain(a); o.connect(og); o.start(); return { o, og, m };
      });
      const wf = filt('lowpass', 9000), wg = gain(0);
      for (const x of oscs) x.og.connect(wf);
      wf.connect(wg); wg.connect(out);
      e.whine = { oscs, wf, g: wg, detune };
      return e;
    });

    // airflow, tyres, cabin
    this.wind = voice(this.pink, 'bandpass', 900, 0.4, this.mix, 0.12);
    this.windHi = voice(this.white, 'highpass', 5000, 0.5, this.mix);
    this.whistle = [1850, 2630].map((f) => { const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = gain(0); o.connect(g); g.connect(this.mix); o.start(); return { o, g, f }; });
    this.roll = voice(this.brown, 'bandpass', 110, 0.9, this.mix, 0.1);
    this.rollHiss = voice(this.pink, 'bandpass', 1400, 0.6, this.mix);
    this.thump = (() => { const s = C.createBufferSource(); s.buffer = this.thumpBuf; s.loop = true; s.playbackRate.value = 1; const g = gain(0); s.connect(g); g.connect(this.mix); s.start(); return { s, g }; })();
    this.ac = voice(this.white, 'lowpass', 2400, 0.5, this.mix);
    this.breath = voice(this.pink, 'bandpass', 900, 0.8, this.mix);
    // rain: a hiss on the airframe, and a patter on the canopy that you only hear from inside
    this.rainHiss = voice(this.white, 'highpass', 1800, 0.5, this.mix);
    this.rainBand = voice(this.pink, 'bandpass', 4300, 0.6, this.mix, 0.25);
    this.rainPatter = voice(this.pink, 'bandpass', 2300, 1.1, this.mix, 0.55);
    const hum = C.createOscillator(); hum.type = 'sine'; hum.frequency.value = 400; this.humGain = gain(0); hum.connect(this.humGain); this.humGain.connect(this.mix); hum.start();

    // hydraulics: pump tone with motor noise
    const pump = C.createOscillator(); pump.type = 'sawtooth'; pump.frequency.value = 150;
    const pumpLp = filt('lowpass', 650, 0.9), pumpG = gain(0); pump.connect(pumpLp); pumpLp.connect(pumpG); pumpG.connect(this.mix); pump.start();
    const pump2 = C.createOscillator(); pump2.type = 'sine'; pump2.frequency.value = 450; const pump2G = gain(0); pump2.connect(pump2G); pump2G.connect(this.mix); pump2.start();
    this.hyd = { pump, pumpG, pump2, pump2G, noise: voice(this.pink, 'bandpass', 1100, 1.2, this.mix) };

    // wreck: rumble, grinding, crackling and the roar of the fire
    this.crashLayers = {
      rumble: voice(this.brown, 'lowpass', 76, 0.7, this.mix),
      scrape: voice(this.pink, 'bandpass', 700, 1.1, this.mix, 0.35),
      crackle: voice(this.crackle, 'bandpass', 1900, 0.9, this.mix),
      fire: voice(this.brown, 'lowpass', 280, 0.7, this.mix, 0.4),
    };
    this.wreckFadeUntil = 0; this.wreckFadeLength = 12;
    this.wreckScrapeUntil = 0; this.wreckScrapeLevel = 0;
    this.wreckFireUntil = 0; this.wreckFireLevel = 0; this.wreckLevel = 0;

    // warnings
    const wo = C.createOscillator(); wo.type = 'triangle'; wo.frequency.value = 880; const wo2 = C.createOscillator(); wo2.type = 'square'; wo2.frequency.value = 880;
    const wf = filt('lowpass', 3200, 0.7), w2g = gain(0.18); this.warnGain = gain(0);
    wo.connect(wf); wo2.connect(w2g); w2g.connect(wf); wf.connect(this.warnGain); this.warnGain.connect(this.master); wo.start(); wo2.start();
    this.warnOsc = [wo, wo2];
    this.warnPhase = 0;

    // voice call-outs bypass the cabin muffling, like the intercom they come through
    this.voiceGain = gain(0.6); this.voiceGain.connect(this.master);
    this._loadVoices();
  }

  // ---------- voice warnings ----------
  // style: a key of VOICE_STYLES; base: the app's base URL. Clips are fetched once per style, after the first user gesture.
  setVoice(enabled, style, base) {
    this.voiceOn = !!enabled; this.voiceStyle = voiceStyle(style);
    if (base !== undefined) this.voiceBase = base;
    if (!this.voiceOn) this._stopVoice();
    this._loadVoices();
  }
  _loadVoices() {
    if (!this.ctx || !this.voiceOn || typeof window === 'undefined') return; // node tests use an offline context
    const style = this.voiceStyle, C = this.ctx;
    this.voiceClips = this.voiceClips || {};
    const prev = this.voiceClips[style];
    if (prev && !prev.failed) return;
    // a set that failed (offline, server restart) is retried at most every 5 s, keeping the clips it did get
    if (prev && performance.now() - prev.at < 5000) return;
    const clips = this.voiceClips[style] = Object.assign(prev || {}, { failed: false, at: performance.now() });
    for (const key of VOICE_KEYS) {
      if (clips[key]) continue;
      fetch(voiceUrl(this.voiceBase || '/', style, key))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${key}`))))
        .then((b) => C.decodeAudioData(b))
        .then((buf) => { clips[key] = buf; })
        .catch((e) => { clips.failed = true; console.warn('voice clip', style, key, e.message || e); });
    }
  }
  // radio-altitude call-outs (100 ... 10, Retard): one clip set whatever the warning voice, fetched once after the first gesture
  setCallouts(on) { this.calloutsOn = !!on; if (!on) this.callouts.reset(); this._loadCallouts(); }
  _loadCallouts() {
    if (!this.ctx || !this.calloutsOn || typeof window === 'undefined' || (this.calloutClips && !this.calloutClips.failed)) return;
    if (this.calloutClips && performance.now() - this.calloutClips.at < 5000) return;
    const clips = this.calloutClips = Object.assign(this.calloutClips || {}, { failed: false, at: performance.now() }), C = this.ctx;
    for (const key of CALLOUT_KEYS) {
      if (clips[key]) continue;
      fetch(`${this.voiceBase || '/'}audio/voice/callouts/${key}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${key}`))))
        .then((b) => C.decodeAudioData(b)).then((buf) => { clips[key] = buf; }).catch((e) => { clips.failed = true; console.warn('call-out clip', key, e.message || e); });
    }
  }
  _calloutStep(s, t, dt) {
    if (!this.calloutsOn || !s.callout || s.paused) return;
    this._loadCallouts();
    const clips = this.calloutClips || {}, dur = (k) => (clips[k] ? clips[k].duration : 0);
    if (this.voiceSched.speaking(t)) return; // a warning is talking: the call-out waits (the next one due replaces it)
    const key = this.callouts.step(s.callout, dt, dur);
    if (!key || !clips[key]) return;
    if (this.calloutSrc) { try { this.calloutSrc.stop(); } catch { /* ended */ } }
    const src = this.ctx.createBufferSource(); src.buffer = clips[key]; src.connect(this.voiceGain); src.start(); this.calloutSrc = src;
  }
  _voiceDuration(key) {
    const set = this.voiceClips && this.voiceClips[this.voiceStyle], buf = set && set[key];
    if (!buf && this.voiceOn && set && set.failed) this._loadVoices();
    return buf ? buf.duration : 0;
  }
  _speak(key) {
    const buf = this.voiceClips[this.voiceStyle][key], s = this.ctx.createBufferSource();
    s.buffer = buf; s.connect(this.voiceGain); s.start();
    this.voiceSrc = s;
  }
  _stopVoice() {
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* already ended */ } this.voiceSrc = null; }
    this.voiceSched.reset();
  }
  // the selected style's pull-up call-out, so the choice can be heard in the settings
  previewVoice() {
    if (!this.ctx || !this.voiceOn) return;
    this._loadVoices();
    if (!this._voiceDuration('pullUp')) { setTimeout(() => this._voiceDuration('pullUp') && this.previewVoice(), 400); return; }
    this._stopVoice(); this._speak('pullUp');
    this.voiceSched.playing = 'pullUp'; this.voiceSched.until = this.ctx.currentTime + this._voiceDuration('pullUp');
  }

  // ---------- one-shot building blocks ----------
  _out(dest) { return dest || this.route || this.mix; }
  _set(p, v, tc, t) {
    const l = this.last.get(p);
    if (l !== undefined && Math.abs(v - l) <= 2e-3 * Math.abs(v) + 1e-5) return;
    this.last.set(p, v); p.setTargetAtTime(v, t, tc);
  }
  suspend(fadeMs = 120) {
    if (!this.ctx) return;
    this.held = true; this._set(this.master.gain, 0, 0.03, this.ctx.currentTime);
    setTimeout(() => { this.held && this.ctx.state === 'running' && this.ctx.suspend(); }, fadeMs);
  }
  resume() {
    if (!this.ctx) return;
    this.held = false; this.ctx.state === 'suspended' && this.ctx.resume && this.ctx.resume();
  }
  resetForSpawn() {
    if (this.voiceSrc || this.voiceSched.playing) this._stopVoice();
    this.callouts.reset(); if (this.calloutSrc) { try { this.calloutSrc.stop(); } catch { /* ended */ } this.calloutSrc = null; }
    this.wreckFadeUntil = this.wreckScrapeUntil = this.wreckFireUntil = 0; this.wreckLevel = this.wreckScrapeLevel = this.wreckFireLevel = 0;
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    for (const v of Object.values(this.crashLayers)) { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(0, t); this.last.set(v.g.gain, 0); }
    this.wreckBus.disconnect(); this.wreckBus = C.createGain(); this.wreckBus.connect(this.mix);
  }
  // an enveloped tone, optionally sweeping to f1
  tone(f0, dur, vol, { type = 'sine', delay = 0, f1 = null, attack = 0.004, dest } = {}) {
    if (!this.ctx || !this.enabled) return;
    const C = this.ctx, t = C.currentTime + delay, o = C.createOscillator(), g = C.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this._out(dest)); o.start(t); o.stop(t + dur + 0.05);
  }
  // an enveloped noise burst through a filter that can sweep
  burst(dur, f0, vol, { type = 'lowpass', buf, attack = 0.005, delay = 0, f1 = null, q = 0.7, dest } = {}) {
    if (!this.ctx || !this.enabled) return;
    const C = this.ctx, t = C.currentTime + delay, s = C.createBufferSource(), fl = C.createBiquadFilter(), g = C.createGain();
    s.buffer = buf || this.white; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this._out(dest)); s.start(t, rnd(0, 4)); s.stop(t + dur + 0.05);
  }
  // struck metal: damped inharmonic partials (bar-like ratios) plus a bright transient
  modal(base, vol, decay, delay = 0, dest) {
    if (!this.ctx || !this.enabled) return;
    const C = this.ctx, t = C.currentTime + delay;
    [[1, 1], [2.76, 0.6], [5.4, 0.38], [8.93, 0.22]].forEach(([r, a], i) => {
      const o = C.createOscillator(), g = C.createGain(), f = base * r * rnd(0.985, 1.015), d = decay / (1 + 0.7 * i);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0003, t + d);
      o.connect(g); g.connect(this._out(dest)); o.start(t); o.stop(t + d + 0.05);
    });
    this.burst(0.03 + decay * 0.05, Math.min(9000, base * 5), vol * 0.55, { type: 'highpass', delay, attack: 0.001, dest });
  }
  // everything an explosion at `distance` metres sounds like: late, quieter and duller the farther it is
  _bang(level, distance) {
    const C = this.ctx, delay = clamp(distance / 343, 0, 9), air = clamp(1 / (1 + distance / 350), 0.18, 1);
    const dull = this._filt('lowpass', clamp(15000 / (1 + distance / 450), 500, 15000), 0.5), g = this._gain(1);
    dull.connect(g); g.connect(this._out());
    const o = { dest: dull }, a = level * air * 1.7;
    this.tone(64, 2.4, 1.5 * a, { type: 'sine', delay, f1: 21, attack: 0.012, dest: dull });
    this.burst(1.5, 1400, 1.3 * a, { type: 'lowpass', buf: this.brown, delay, f1: 70, attack: 0.012, ...o });
    this.burst(0.5, 4200, 0.8 * a, { type: 'lowpass', buf: this.pink, delay, f1: 260, attack: 0.003, ...o });
    if (distance < 1800) this.burst(0.14, 1200, 0.7 * a, { type: 'highpass', buf: this.white, delay, attack: 0.001, ...o });
    this.burst(3.8, 190, 0.8 * a, { type: 'lowpass', buf: this.brown, delay: delay + 0.35, attack: 0.25, ...o });
    for (let i = 0; i < 3; i++) this.burst(rnd(0.5, 1.1), rnd(500, 900), rnd(0.25, 0.5) * a, { type: 'lowpass', buf: this.brown, delay: delay + rnd(0.5, 3.2), f1: 70, ...o });
    setTimeout(() => { try { dull.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } }, (delay + 7) * 1000);
  }

  play(name, k = 1, distance = 0) {
    const prev = this.route;
    if (WRECK_SOUNDS.has(name)) this.route = this.wreckBus;
    try { this._play(name, k, distance); } finally { this.route = prev; }
  }
  _play(name, k, distance) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'gear-lock':
        this.modal(150, 0.5 * k, 0.22); this.modal(430, 0.28 * k, 0.12, 0.012);
        this.tone(70, 0.28, 0.6 * k, { f1: 38 }); this.burst(0.09, 700, 0.18 * k, { type: 'bandpass' }); break;
      case 'gear-door':
        // k < 0: doors opening (a pneumatic whoosh and a latch release); k >= 0: doors shutting (a heavier clunk)
        if (k < 0) { this.burst(0.35, 800, 0.2, { type: 'bandpass', q: 0.9, buf: this.pink, attack: 0.04 }); this.modal(320, 0.14, 0.09, 0.02); }
        else { this.modal(210, 0.36, 0.2); this.modal(560, 0.18, 0.1, 0.015); this.burst(0.18, 600, 0.2, { type: 'bandpass', buf: this.pink }); this.tone(66, 0.2, 0.35, { f1: 40 }); }
        break;
      case 'touch': {
        const hard = clamp(k, 0.1, 1.6);
        this.tone(82, 0.32, 0.55 * hard, { f1: 44 });
        this.burst(0.2, 380, 0.5 * hard, { type: 'lowpass', buf: this.brown });
        // tyres spinning up: a short narrow-band squeal, then a puff of rubbery hiss
        this.burst(0.5 * hard + 0.25, 1500, 0.2 * hard, { type: 'bandpass', q: 9, f1: 1000, buf: this.white, attack: 0.03 });
        this.burst(0.7, 2600, 0.12 * hard, { type: 'bandpass', q: 1.2, buf: this.pink, attack: 0.04 }); break;
      }
      case 'ab-light':
        this.tone(78, 1.0, 1.1 * k, { f1: 30, attack: 0.02 }); this.burst(1.2, 700, 1.0 * k, { type: 'lowpass', buf: this.brown, f1: 90, attack: 0.04 });
        this.burst(0.18, 1800, 0.35 * k, { type: 'bandpass', buf: this.crackle, delay: 0.03 }); break;
      case 'unstart':
        this.tone(58, 1.0, 1.7, { f1: 26, attack: 0.004 }); this.burst(0.45, 2400, 1.5, { type: 'bandpass', q: 0.8, buf: this.white, attack: 0.002, f1: 500 });
        this.burst(1.5, 520, 1.5, { type: 'lowpass', buf: this.brown, attack: 0.01, f1: 70 }); this.modal(210, 0.4, 0.35, 0.04); break;
      case 'boom':
        // an N-wave: two low thumps a fraction of a second apart and a sharp crack
        this.tone(64, 0.42, 1.6, { f1: 24, attack: 0.003 }); this.tone(58, 0.45, 1.4, { f1: 22, delay: 0.17, attack: 0.003 });
        this.burst(0.06, 2400, 0.8, { type: 'highpass', attack: 0.001 }); this.burst(0.05, 2200, 0.6, { type: 'highpass', attack: 0.001, delay: 0.17 });
        this.burst(2.2, 160, 0.6, { type: 'lowpass', buf: this.brown, delay: 0.3, attack: 0.1 }); break;
      case 'chute':
        this.burst(0.4, 650, 0.5, { type: 'bandpass', q: 0.8, buf: this.pink, attack: 0.02 }); this.tone(88, 0.3, 0.6, { f1: 44, delay: 0.1 }); break;
      case 'impact': {
        const L = clamp(k, 0, 1.6);
        this.tone(96, 0.9, 1.5 * L, { f1: 27, attack: 0.003 });
        this.burst(0.42, 2200, 1.1 * L, { type: 'lowpass', buf: this.pink, attack: 0.002, f1: 140 });
        this.burst(0.25, 700, 0.7 * L, { type: 'highpass', buf: this.white, attack: 0.001 }); break;
      }
      case 'crunch': {
        // struck, bending metal: modal clanks over 0.8 s and a rough tearing noise that falls in pitch
        const L = clamp(k, 0, 1.6), n = 5 + Math.round(6 * L);
        // unpitched clanks (broad noise bursts, no ringing tones: random bell pitches in a row sound like a tune) over two fixed low thuds
        this.modal(140, 0.3 * L, 0.3); this.modal(220, 0.18 * L, 0.2, 0.03);
        for (let i = 0; i < n; i++) { const d = Math.pow(Math.random(), 1.6) * 0.8; this.burst(rnd(0.03, 0.11), rnd(500, 2600), 0.34 * L * (1 - 0.7 * d), { type: 'bandpass', q: 0.6, buf: this.grit, attack: 0.002, delay: d }); }
        this.burst(1.1 + 0.5 * L, 2200, 0.55 * L, { type: 'bandpass', q: 2.2, buf: this.grit, f1: 500, attack: 0.02 });
        this.burst(0.9, 1800, 0.5 * L, { type: 'bandpass', q: 1.5, buf: this.pink, f1: 600, attack: 0.01, delay: 0.05 });
        // debris coming down for several seconds, thinning out
        const m = 8 + Math.round(10 * L);
        for (let i = 0; i < m; i++) { const d = 0.9 + Math.pow(Math.random(), 1.8) * 5; this.burst(rnd(0.04, 0.16), rnd(400, 2400), rnd(0.1, 0.24) * L, { type: 'bandpass', q: 0.5, buf: this.grit, attack: 0.002, delay: d }); }
        break;
      }
      case 'scrape':
      case 'grind': {
        const level = clamp(k, 0, 1.4), now = this.ctx.currentTime;
        this.wreckScrapeLevel = level; this.wreckScrapeUntil = now + 3 + level * 7;
        this.burst(0.8, 1700, 0.28 * level, { type: 'bandpass', q: 5, buf: this.pink, f1: 600, attack: 0.04 });
        this.burst(0.4, 3200, 0.14 * level, { type: 'highpass', buf: this.white, attack: 0.005, delay: 0.12 }); break;
      }
      case 'explosion': {
        const level = clamp(k, 0, 1.6), delay = clamp(distance / 343, 0, 9), now = this.ctx.currentTime;
        this._bang(level, distance);
        this.wreckLevel = Math.max(this.wreckLevel, level); this.wreckFadeUntil = now + delay + 14; this.wreckFadeLength = 14;
        this.wreckFireLevel = Math.max(this.wreckFireLevel, 0.3 * level); this.wreckFireUntil = now + delay + 26; break;
      }
      case 'fire':
        this.wreckFireLevel = clamp(k, 0, 1.5); this.wreckFireUntil = this.ctx.currentTime + 8 + this.wreckFireLevel * 26; break;
      case 'crash': {
        const level = clamp(k, 0, 1.6), now = this.ctx.currentTime;
        this.play('impact', level); this.play('crunch', level);
        this.wreckLevel = level; this.wreckFadeUntil = now + 11; this.wreckFadeLength = 11;
        this.wreckFireLevel = Math.max(this.wreckFireLevel, 0.08 * level); this.wreckFireUntil = now + 6; break;
      }
      case 'thunder': {
        // a crack for close strikes, then a long rolling rumble; dull and late when far away
        const L = clamp(k, 0.1, 1.2), dull = this._filt('lowpass', clamp(9000 / (1 + distance / 700), 450, 9000), 0.5), g = this._gain(1);
        dull.connect(g); g.connect(this.mix);
        const d = clamp(distance / 343, 0.2, 16), o = { dest: dull };
        if (distance < 3500) this.burst(0.3, 2600, 0.7 * L, { type: 'highpass', buf: this.white, delay: d, attack: 0.002, ...o });
        this.burst(2.4, 900, 1.0 * L, { type: 'lowpass', buf: this.brown, delay: d, f1: 90, attack: 0.02, ...o });
        this.burst(7.5, 170, 0.8 * L, { type: 'lowpass', buf: this.brown, delay: d + 0.4, attack: 0.9, ...o });
        this.tone(48, 3.5, 0.9 * L, { f1: 24, delay: d + 0.1, attack: 0.1, dest: dull });
        setTimeout(() => { try { dull.disconnect(); g.disconnect(); } catch (e) { /* gone */ } }, (d + 10) * 1000);
        break;
      }
      case 'click': this.burst(0.03, 3000, 0.15, { type: 'bandpass' }); break;
      default:
    }
  }

  // Lycoming four-cylinder + two-blade propeller (C172): firing pulses at rpm/30 Hz through an exhaust-stack resonance, a half-order
  // thump (cylinder-to-cylinder unevenness), combustion grit, and the propeller's blade-pass buzz and swish, louder ahead of the disc
  _pistonVoice() {
    const C = this.ctx, osc = (type) => { const o = C.createOscillator(); o.type = type; o.start(); return o; }, g = (v, to) => { const x = C.createGain(); x.gain.value = v; if (to) x.connect(to); return x; };
    const bq = (type, f, q, to) => { const x = C.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; if (to) x.connect(to); return x; };
    const src = (buf) => { const x = C.createBufferSource(); x.buffer = buf; x.loop = true; x.start(); return x; };
    const out = g(0, this.mix), stack = bq('lowpass', 400, 5, out), body = g(1, stack);
    const fire = osc('sawtooth'); fire.connect(body);
    const half = osc('square'), halfG = g(0.3, body); half.connect(halfG);
    const grit = src(this.brown), gritF = bq('bandpass', 180, 1.1, null), gritG = g(0.6, out); grit.connect(gritF); gritF.connect(gritG);
    const propOut = g(0, this.mix), buzz = osc('triangle'), buzzG = g(0.5, propOut); buzz.connect(buzzG);
    const swish = src(this.pink), swishF = bq('bandpass', 700, 0.7, null), swishG = g(0.0, propOut); swish.connect(swishF); swishF.connect(swishG);
    const swishAm = osc('sine'), amG = g(0.0, swishG.gain); swishAm.connect(amG);
    this.pistonV = { out, stack, fire, half, gritF, gritG, propOut, buzz, swishF, swishG, swishAm, amG };
  }
  _pistonUpdate(pv, s, set, near, dens, dop, ext) {
    if (!this.pistonV) this._pistonVoice();
    const V = this.pistonV, rpm = s.crashed ? 0 : pv.rpm, on = rpm > 150 ? 1 : 0, f = Math.max(5, rpm / 30) * dop, load = clamp(pv.thr, 0, 1);
    set(V.fire.frequency, f, 0.03); set(V.half.frequency, f / 2, 0.03);
    set(V.stack.frequency, 260 + 2.2 * f + 500 * load, 0.08); set(V.gritF.frequency, 120 + 1.5 * f, 0.1);
    set(V.out.gain, on * (0.05 + 0.16 * load + 0.06 * rpm / 2700) * near * dens * (s.cockpit ? 1.1 : 1), 0.06);
    set(V.gritG.gain, 0.45 + 0.6 * load, 0.1);
    const blade = rpm / 30; // two blades
    set(V.buzz.frequency, Math.max(5, blade) * dop, 0.03); set(V.swishAm.frequency, Math.max(1, blade), 0.03);
    set(V.swishF.frequency, 500 + 0.5 * rpm, 0.1); set(V.swishG.gain, 0.25, 0.1); set(V.amG.gain, 0.2, 0.1);
    const front = ext ? 0.6 + 0.4 * s.camFwdDot : 0.8;
    set(V.propOut.gain, (rpm > 60 ? 1 : 0) * (0.02 + 0.08 * Math.pow(rpm / 2700, 2)) * near * dens * front, 0.06);
  }
  update(s) {
    if (!this.ctx || (this.held && this.ctx.state !== 'running')) return;
    const C = this.ctx, t = C.currentTime, set = (p, v, tc = 0.06) => this._set(p, v, tc, t);
    set(this.master.gain, this.enabled && !s.paused ? this.volume : 0, 0.1);
    const ext = !s.cockpit;
    // outside: inverse-distance level, louder behind the jet (exhaust) and in front for the inlet whine
    const dist = ext ? Math.max(20, s.camDist) : 15;
    const near = ext ? clamp(45 / dist, 0, 1.2) : 0.5;
    const rear = ext ? 0.55 + 0.45 * -s.camFwdDot : 0.7;     // camFwdDot: +1 camera ahead of the nose, -1 behind
    const front = ext ? 0.5 + 0.5 * s.camFwdDot : 0.35;
    const silent = ext && s.mach > 1 && s.inMachConeAhead ? 0.02 : 1;
    const dop = ext ? clamp(s.doppler, 0.5, 2) : 1;
    const dens = clamp(s.rho / 1.225 + 0.1, 0.1, 1.1);
    for (const [src, base] of this.dopplerSources) set(src.playbackRate, base * dop, 0.2);
    // air absorption: distant outside sounds lose their highs
    set(this.cabin.frequency, s.cockpit ? 1500 : clamp(16000 / (1 + dist / 900), 2500, 16000), 0.15);

    const mod = (v, level) => { if (v.wob) set(v.wob.gain, level * v.wobDepth, 0.2); };
    const level = (v, g, f) => { set(v.g.gain, g); if (f != null) set(v.fl.frequency, f); mod(v, g); };
    const jet = s.piston ? 0 : 1; // the Skyhawk: jet voices silent, the piston voice below instead
    if (s.piston) this._pistonUpdate(s.piston, s, set, near, dens, dop, ext);
    // the Vision Jet: one small aft-mounted turbofan (pass it alone in s.engines): lighter rumble, a higher and louder fan whine, quieter behind the cabin wall
    const F = s.fan ? FAN : NO_FAN;
    s.engines.forEach((e, i) => {
      const n = s.crashed ? 0 : e.dry, ab = s.crashed ? 0 : e.ab, un = e.unstart > 0 ? 0.35 : 1;
      const E = this.eng[i], base = near * silent * dens * un * jet * (ext ? 1 : F.cabin), p = clamp(n, 0, 1);
      level(E.rumble, (0.04 + 0.3 * p) * base * rear * F.rumble, (110 + 260 * p) * dop * F.pitch);
      level(E.roar, (0.012 + 0.2 * Math.pow(p, 1.3)) * base * (0.6 + 0.4 * rear) * F.roar, (340 + 1200 * p) * dop * F.pitch);
      level(E.hiss, (0.008 + 0.075 * Math.pow(p, 2.2)) * base * rear * (ext ? 1 : 0.25) * F.hiss, 2400 + 1800 * p);
      level(E.abLow, 0.5 * ab * base * rear, 80 + 40 * ab);
      level(E.abMid, 0.62 * ab * base * rear, 260 + 360 * ab);
      level(E.abHigh, 0.26 * ab * base * rear * (ext ? 1 : 0.4), 1000 + 600 * ab);
      level(E.crack, 0.5 * ab * base * rear * (ext ? 1 : 0.35));
      const f = (F.whineLo + F.whineSpan * p) * dop * E.whine.detune;
      E.whine.oscs.forEach((x) => set(x.o.frequency, f * x.m, 0.08));
      set(E.whine.wf.frequency, ext ? 7000 : 3500);
      set(E.whine.g.gain, 0.016 * F.whine * Math.pow(p, 0.8) * near * silent * front * un * jet * (ext ? 1 : F.cabin));
    });

    const w = clamp(s.ias / 250, 0, 1.6), cab = s.cockpit ? 1 : 0;
    level(this.wind, 0.2 * w * w * (cab ? 0.95 : 0.22) * dens, 380 + 1500 * w);
    set(this.windHi.g.gain, 0.03 * w * w * (cab ? 1 : 0.1)); set(this.windHi.fl.frequency, 4200 + 1500 * w);
    this.whistle.forEach((x, i) => { set(x.g.gain, cab ? 0.004 * Math.pow(w, 3) * (i ? 0.7 : 1) : 0); set(x.o.frequency, x.f * (0.92 + 0.12 * w), 0.3); });
    const ground = s.onGround ? clamp(s.gs / 60, 0, 1) : 0;
    level(this.roll, ground * 0.34 * (cab ? 1 : near), 70 + s.gs * 1.2);
    set(this.rollHiss.g.gain, ground * 0.04 * (cab ? 1 : near)); set(this.rollHiss.fl.frequency, 900 + s.gs * 14);
    set(this.thump.g.gain, ground * clamp(s.gs / 70, 0, 1) * 0.22 * (cab ? 1 : near)); set(this.thump.s.playbackRate, clamp(s.gs / 6, 0.2, 14), 0.1);
    set(this.ac.g.gain, cab ? 0.011 : 0); set(this.humGain.gain, cab ? 0.0035 : 0);
    // pressure-suit breathing: a short rasping inhale, a longer exhale through the regulator, then a clear pause. Quiet, and silent
    // in between, so it reads as someone breathing rather than a constant hiss.
    {
      const T = 4.8, ph = (t % T) / T, inh = ph < 0.13 ? Math.sin(Math.PI * ph / 0.13) : 0, exh = ph >= 0.2 && ph < 0.42 ? Math.sin(Math.PI * (ph - 0.2) / 0.22) : 0;
      const env = inh * 0.6 + exh, live = cab && !s.crashed ? 1 : 0;
      set(this.breath.g.gain, live * env * 0.16, 0.03); set(this.breath.fl.frequency, inh > 0 ? 1300 : 700, 0.08);
    }

    // hydraulics: the pump climbs in pitch with load while the gear is moving
    const moving = s.gearMoving ? 1 : 0, hv = moving * (cab ? 0.05 : 0.012 * near / 0.5);
    set(this.hyd.pumpG.gain, hv, 0.18); set(this.hyd.pump2G.gain, hv * 0.35, 0.18);
    set(this.hyd.pump.frequency, 140 + 55 * Math.sin(t * 0.9) * moving + (s.gearMoving ? 30 : 0), 0.3);
    set(this.hyd.pump2.frequency, 420 + 90 * Math.sin(t * 0.9 + 1) * moving, 0.3);
    set(this.hyd.noise.g.gain, moving * (cab ? 0.012 : 0.004 * near), 0.2);

    const rn = clamp(s.rain || 0, 0, 1);
    set(this.rainHiss.g.gain, rn * (cab ? 0.014 : 0.03)); set(this.rainBand.g.gain, rn * (cab ? 0.02 : 0.04)); mod(this.rainBand, rn * 0.04);
    set(this.rainPatter.g.gain, rn * (cab ? 0.07 : 0.012)); mod(this.rainPatter, rn * (cab ? 0.07 : 0.012));
    const crashMix = clamp((this.wreckFadeUntil - t) / this.wreckFadeLength, 0, 1);
    const scrapeMix = clamp((this.wreckScrapeUntil - t) / 8, 0, 1) * this.wreckScrapeLevel;
    const fireMix = clamp((this.wreckFireUntil - t) / 24, 0, 1) * this.wreckFireLevel;
    const wn = near * (cab ? 1.4 : 1);
    set(this.crashLayers.rumble.g.gain, crashMix * this.wreckLevel * 0.1 * wn * dens);
    level(this.crashLayers.scrape, scrapeMix * 0.08 * wn, 500 + 700 * clamp(scrapeMix, 0, 1));
    set(this.crashLayers.crackle.g.gain, fireMix * 0.075 * wn);
    level(this.crashLayers.fire, fireMix * 0.14 * wn);

    // warnings: stall = pulsed horn, pull-up = rising whoop-whoop siren
    const warn = s.crashed ? 0 : s.warnTone, now = performance.now();
    let on = 0, f = 880;
    if (warn === 1) { on = Math.floor(now / 110) % 2 === 0 ? 1 : 0; f = 1180; }
    else if (warn === 2) { const ph = (now % 760) / 760; on = ph < 0.62 ? 1 : 0; f = 520 + 640 * Math.min(1, ph / 0.62); }
    // spoken call-outs: the tones step aside while a phrase plays, so it is heard as "whoop whoop, PULL UP"
    if (s.crashed || !this.voiceOn) { if (this.voiceSrc || this.voiceSched.playing) this._stopVoice(); }
    else if (!s.paused) {
      const pick = this.voiceSched.step(s.warn, t, (k) => this._voiceDuration(k));
      if (pick) { if (pick.interrupt && this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* ended */ } } this._speak(pick.key); }
    }
    if (s.crashed) this.callouts.reset(); else this._calloutStep(s, t, Math.max(0, Math.min(0.25, t - (this._coT || t)))); this._coT = t;
    const speaking = this.voiceOn && this.voiceSched.speaking(t);
    set(this.warnGain.gain, on * (speaking ? 0.02 : 0.1), 0.012);
    for (const o of this.warnOsc) set(o.frequency, f, 0.01);
  }
}
