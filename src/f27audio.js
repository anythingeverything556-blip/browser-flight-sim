// Original supplied Fokker bank media, never a synthesized Dart substitute.
// manifest.json records hash-verified events and the bank's four-way RTPC curves.
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
export function bankCurve(points, x) {
  if (!points?.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [b, y] = points[i], [a, v, shape] = points[i - 1];
    if (x > b) continue;
    let u = clamp((x - a) / Math.max(1e-8, b - a), 0, 1);
    if (shape === 9) u = 0;
    else if (shape === 1) u = Math.sin(u * Math.PI / 2);
    else if (shape === 7) u = 1 - Math.cos(u * Math.PI / 2);
    else if (shape === 5) u = u * u * (3 - 2 * u);
    return v + (y - v) * u;
  }
  return points.at(-1)[1];
}
// Keep the recovered bank curves/offsets as provenance. The browser mix uses
// zero-slope equal-power fades between their peak RPMs: no new layer attacks
// at full derivative, and sum(weight^2) stays one throughout the join.
const anchors = new WeakMap();
export function layerWeights(group, rpm) {
  if (!anchors.has(group)) anchors.set(group, group.clips.map((clip, index) => {
    const peak = Math.max(...clip.curve.map(p => p[1]));
    let i = clip.curve.findIndex(p => p[1] === peak);
    if (i === 0) while (clip.curve[i + 1]?.[1] === peak) i++;
    return { index, rpm: clip.curve[i][0] };
  }).sort((a, b) => a.rpm - b.rpm));
  const points = anchors.get(group), weights = group.clips.map(() => 0);
  if (!points.length) return weights;
  if (rpm <= points[0].rpm) weights[points[0].index] = 1;
  else if (rpm >= points.at(-1).rpm) weights[points.at(-1).index] = 1;
  else for (let i = 1; i < points.length; i++) if (rpm <= points[i].rpm) {
    const a = points[i - 1], b = points[i], angle = smooth(a.rpm, b.rpm, rpm) * Math.PI / 2;
    weights[a.index] = Math.cos(angle); weights[b.index] = Math.sin(angle); break;
  }
  return weights;
}
export function bufferRms(b) {
  let power = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) power += d[i] * d[i];
  }
  return Math.sqrt(power / Math.max(1, b.numberOfChannels * b.length));
}
// Re-loop decoded ORIGINAL PCM, with no oscillators or generated engine noise.
// 80 ms constant-power tail/head overlap avoids the former linear-fade dip.
// Ending exactly at the head waveform also removes a residual wrap discontinuity.
export function seamLoop(C, b) {
  const fade = Math.min(Math.floor(b.sampleRate * 0.08), Math.floor(b.length / 8));
  if (fade < 2) return b;
  const n = b.length - fade, out = C.createBuffer(b.numberOfChannels, n, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c), d = out.getChannelData(c);
    d.set(src.subarray(0, n));
    for (let i = 0; i < fade; i++) {
      const angle = i / (fade - 1) * Math.PI / 2;
      d[i] = src[n + i] * Math.cos(angle) + src[i] * Math.sin(angle);
    }
  }
  return out;
}
// -6.02 dB common F27 calibration vs v2's .22; normalize each loop to
// .25 RMS BEFORE mixing (v2 interior high layers were ~3.5x the low-mid).
export const F27_AUDIO_GAIN = 0.11, F27_LOOP_RMS = 0.25;
export class F27SampleAudio {
  constructor(C, destination, { base = '/', fetcher = (...a) => fetch(...a), set } = {}) {
    this.C = C; this.destination = destination; this.base = base; this.fetcher = fetcher;
    this.set = set || ((p, v, tc = 0.08) => p.setTargetAtTime(v, C.currentTime, tc));
    this.buffers = new Map(); this.loops = new Map(); this.voices = []; this.starters = [null, null];
    this.startLatch = [false, false]; this.oneshots = new Set(); this.status = 'idle'; this.errors = [];
  }
  url(file) { return this.base.replace(/\/?$/, '/') + 'models/f27/audio/' + file; }
  async load() {
    if (this.loading) return this.loading;
    if (this.status === 'ready' || Date.now() < (this.retryAt || 0)) return;
    this.status = 'loading'; this.errors = [];
    this.loading = (async () => {
      const read = async file => { const r = await this.fetcher(this.url(file)); if (!r.ok) throw new Error(file + ': HTTP ' + r.status); return r; };
      try {
        if (!this.manifest) this.manifest = await (await read('manifest.json')).json();
        await Promise.all(this.manifest.samples.map(async m => {
          if (this.buffers.has(m.id)) return;
          try {
            const b = await this.C.decodeAudioData(await (await read(m.file)).arrayBuffer());
            this.buffers.set(m.id, b);
          } catch (e) { this.errors.push(m.file + ': ' + String(e.message || e)); }
        }));
        this.status = this.errors.length ? 'partial' : 'ready';
      } catch (e) { this.errors.push(String(e.message || e)); this.status = 'failed'; }
      this.retryAt = Date.now() + 5000;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  loop(id, destination, phase = 0) {
    const b = this.buffers.get(id); if (!b) return null;
    if (!this.loops.has(id)) this.loops.set(id, seamLoop(this.C, b));
    const source = this.C.createBufferSource(), gain = this.C.createGain();
    source.buffer = this.loops.get(id); source.loop = true; gain.gain.value = 0;
    source.connect(gain); gain.connect(destination); source.start(0, phase * source.buffer.duration);
    return { source, gain, level: clamp(F27_LOOP_RMS / Math.max(0.025, bufferRms(source.buffer)), 0, 4) };
  }
  build() {
    if (!this.manifest) return;
    for (const group of this.manifest.groups) {
      let v = this.voices.find(v => v.group === group);
      if (!v) {
        const filter = this.C.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.5;
        const pan = this.C.createStereoPanner(); pan.pan.value = group.engine === 1 ? -0.32 : 0.32;
        filter.connect(pan); pan.connect(this.destination);
        v = { group, filter, pan, clips: new Map() }; this.voices.push(v);
      }
      for (const clip of group.clips) if (!v.clips.has(clip.id)) {
        const voice = this.loop(clip.id, v.filter, group.engine === 1 ? 0 : 0.37);
        if (voice) v.clips.set(clip.id, voice);
      }
    }
    for (const [key, id] of [['inverter', this.manifest.inverter], ['wind', this.manifest.wind], ['roll', this.manifest.roll]]) {
      if (!this[key]) this[key] = this.loop(id, this.destination);
    }
  }
  stopStarter(i) {
    const nodes = this.starters[i]; if (!nodes) return;
    for (const v of nodes) { this.set(v.gain.gain, 0, 0.025); v.source.stop(this.C.currentTime + 0.2); }
    this.starters[i] = null;
  }
  startStarter(i) {
    const nodes = [];
    for (const view of ['inside', 'outside']) {
      const b = this.buffers.get(this.manifest.starter[view]); if (!b) continue;
      const source = this.C.createBufferSource(), gain = this.C.createGain(), pan = this.C.createStereoPanner();
      source.buffer = b; gain.gain.value = 0; pan.pan.value = i ? 0.32 : -0.32;
      source.connect(gain); gain.connect(pan); pan.connect(this.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); };
      source.start(); nodes.push({ source, gain, view });
    }
    this.starters[i] = nodes.length ? nodes : null;
    return nodes.length > 0;
  }
  click(level = 1) {
    const b = this.buffers.get(this.manifest?.switch); if (!b || this.C.state !== 'running') return;
    const source = this.C.createBufferSource(), gain = this.C.createGain();
    source.buffer = b; gain.gain.value = 0.225 * clamp(level, 0, 1.5); source.connect(gain); gain.connect(this.destination);
    this.oneshots.add(source);
    source.onended = () => { this.oneshots.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
  }
  reset() {
    this.starters.forEach((_, i) => this.stopStarter(i)); this.startLatch.fill(false);
    for (const v of this.voices) for (const n of v.clips.values()) this.set(n.gain.gain, 0, 0.025);
    for (const key of ['inverter', 'wind', 'roll']) if (this[key]) this.set(this[key].gain.gain, 0, 0.025);
    for (const source of this.oneshots) source.stop();
    this.oneshots.clear();
  }
  update(s, { near = 0.5, dens = 1, dop = 1, enabled = true } = {}) {
    const awake = enabled && !s.paused && !s.crashed && this.C.state === 'running';
    if (awake) { void this.load(); this.build(); }
    const engines = s.turboprop || [], inside = !!s.cockpit;
    // Supplied FDM turbine RPM / 15,000 is the bank's 0..1.5 RPM parameter.
    // The prop RPM fallback preserves the existing main.js contract until richer state arrives.
    const state = engines.map((e, i) => {
      const turbine = e.turbineRpm ?? s.engines?.[i]?.rpm ?? (e.rpm || 0) / 1395 * 15000;
      const rpm = clamp(turbine / 15000, 0, 1.5);
      const lit = e.lit ?? s.engines?.[i]?.lit ?? turbine >= 6000;
      const failed = e.fail ?? s.engines?.[i]?.fail ?? false;
      const starting = e.starting ?? s.engines?.[i]?.starting ?? (s.engineRunning === true && !failed && !lit && turbine > 1 && turbine < 6000);
      return { rpm, lit, starting, load: clamp((turbine - 7000) / 8000, 0, 1) };
    });
    for (const v of this.voices) {
      const en = state[v.group.engine - 1], viewGain = (v.group.view === 'inside') === inside ? 1 : 0;
      // Rotation outlives combustion: coast/windmill until actual RPM stops.
      const live = awake && en ? smooth(0, 7000 / 15000, en.rpm) : 0;
      const spatial = inside ? 0.65 : near * dens;
      this.set(v.filter.frequency, inside ? 18000 : clamp(16000 / (1 + (s.camDist || 0) / 900), 2500, 16000), 0.15);
      const pitch = bankCurve(v.group.pitch, en?.rpm || 0);
      const weights = layerWeights(v.group, en?.rpm || 0);
      const coastRate = clamp((en?.rpm || 0) / (7000 / 15000), 0.08, 1);
      for (const [i, clip] of v.group.clips.entries()) {
        const n = v.clips.get(clip.id); if (!n) continue;
        const weight = weights[i];
        const volume = n.level * Math.pow(10, (en?.load || 0) * 3.15 / 20);
        this.set(n.gain.gain, live * viewGain * spatial * weight * volume * F27_AUDIO_GAIN, 0.16);
        this.set(n.source.playbackRate, clamp(Math.pow(2, (pitch + clip.cents) / 1200) * coastRate * (inside ? 1 : dop), 0.05, 2.5), 0.16);
      }
    }
    for (let i = 0; i < 2; i++) {
      const start = awake && state[i]?.starting;
      if (start && !this.startLatch[i] && this.manifest) this.startLatch[i] = this.startStarter(i);
      if (!start) { this.stopStarter(i); this.startLatch[i] = false; }
      for (const n of this.starters[i] || []) this.set(n.gain.gain, (n.view === 'inside') === inside ? 0.15 * (inside ? 0.7 : near) : 0, 0.08);
    }
    const power = awake && (s.electrical ?? state.some(e => e.lit || e.starting));
    if (this.inverter) this.set(this.inverter.gain.gain, power && inside ? 0.055 : 0, 0.12);
    if (this.wind) this.set(this.wind.gain.gain, awake ? Math.pow(clamp((s.ias || 0) / 250, 0, 1.3), 2) * (inside ? 0.065 : near * 0.02) : 0, 0.12);
    if (this.roll) this.set(this.roll.gain.gain, awake && s.onGround ? clamp((s.gs || 0) / 60, 0, 1) * (inside ? 0.1 : near * 0.06) : 0, 0.1);
  }
}
