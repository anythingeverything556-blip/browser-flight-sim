// Synthesised SR-71 audio, built from physical cues rather than looped samples:
//  - each J58 is a stack of core rumble, mixing-noise roar, exhaust hiss and compressor whine, with the slow random
//    wobble of real jet noise; afterburner adds a deep rolling roar, a mid growl and crackle
//  - wind scales with dynamic pressure, tyres rumble and thump over runway joints, gear has a hydraulic pump and clunks
//  - impacts are modal: struck metal is a handful of damped inharmonic partials, tearing is rough band-passed noise,
//    explosions are a sub-bass sweep plus a filtered whoomp that arrives late and dull with distance, fire crackles
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

export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.volume = 0.7; }

  // ctx: an existing (e.g. offline) context, for tests
  init(ctx) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
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
    this.crackle = mk(6, (d) => {
      for (let i = 0; i < d.length - 600; i++) if (Math.random() < 0.0011) {
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
  }

  // ---------- one-shot building blocks ----------
  _out(dest) { return dest || this.mix; }
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
    dull.connect(g); g.connect(this.mix);
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
        for (let i = 0; i < n; i++) { const d = Math.pow(Math.random(), 1.6) * 0.8; this.modal(rnd(170, 1100), 0.3 * L * (1 - 0.7 * d), rnd(0.18, 0.55), d); }
        this.burst(1.1 + 0.5 * L, 2200, 0.55 * L, { type: 'bandpass', q: 2.2, buf: this.grit, f1: 500, attack: 0.02 });
        this.burst(0.9, 1800, 0.5 * L, { type: 'bandpass', q: 1.5, buf: this.pink, f1: 600, attack: 0.01, delay: 0.05 });
        // debris coming down for several seconds, thinning out
        const m = 8 + Math.round(10 * L);
        for (let i = 0; i < m; i++) { const d = 0.9 + Math.pow(Math.random(), 1.8) * 5; this.modal(rnd(380, 2200), rnd(0.04, 0.12) * L, rnd(0.08, 0.3), d); }
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

  update(s) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, set = (p, v, tc = 0.06) => p.setTargetAtTime(v, t, tc);
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
    s.engines.forEach((e, i) => {
      const n = s.crashed ? 0 : e.dry, ab = s.crashed ? 0 : e.ab, un = e.unstart > 0 ? 0.35 : 1;
      const E = this.eng[i], base = near * silent * dens * un, p = clamp(n, 0, 1);
      level(E.rumble, (0.04 + 0.3 * p) * base * rear, (110 + 260 * p) * dop);
      level(E.roar, (0.012 + 0.2 * Math.pow(p, 1.3)) * base * (0.6 + 0.4 * rear), (340 + 1200 * p) * dop);
      level(E.hiss, (0.008 + 0.075 * Math.pow(p, 2.2)) * base * rear * (ext ? 1 : 0.25), 2400 + 1800 * p);
      level(E.abLow, 0.5 * ab * base * rear, 80 + 40 * ab);
      level(E.abMid, 0.62 * ab * base * rear, 260 + 360 * ab);
      level(E.abHigh, 0.26 * ab * base * rear * (ext ? 1 : 0.4), 1000 + 600 * ab);
      level(E.crack, 0.5 * ab * base * rear * (ext ? 1 : 0.35));
      const f = (1100 + 3400 * p) * dop * E.whine.detune;
      E.whine.oscs.forEach((x) => set(x.o.frequency, f * x.m, 0.08));
      set(E.whine.wf.frequency, ext ? 7000 : 3500);
      set(E.whine.g.gain, 0.016 * Math.pow(p, 0.8) * near * silent * front * un);
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
    const warn = s.warnTone, now = performance.now();
    let on = 0, f = 880;
    if (warn === 1) { on = Math.floor(now / 110) % 2 === 0 ? 1 : 0; f = 1180; }
    else if (warn === 2) { const ph = (now % 760) / 760; on = ph < 0.62 ? 1 : 0; f = 520 + 640 * Math.min(1, ph / 0.62); }
    set(this.warnGain.gain, on * 0.1, 0.012);
    for (const o of this.warnOsc) set(o.frequency, f, 0.01);
  }
}
