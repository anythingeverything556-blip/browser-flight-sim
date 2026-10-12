// Diagnostics overlay (F3). Shows frame-time percentiles, the CPU time of each phase of a frame, GPU time of the scene render when
// the browser exposes timer queries, renderer counters, and a log of recent hitches (frames over 40 ms) with the phase that
// took the time: a long CPU phase is JavaScript or upload work on the main thread, time no phase explains is the GPU or driver.
import { stat } from './workstats.js';

export class PerfMonitor {
  constructor(renderer, counters = () => '') {
    this.renderer = renderer; this.counters = counters; this.on = false;
    renderer.info.autoReset = false; // counters then cover the whole frame, not just the last pass
    this.N = 360; this.dt = new Float32Array(this.N); this.n = 0; this.pos = 0;
    this.last = 0; this.tm = 0; this.cur = {}; this.prev = {}; this.avg = {}; this.hitches = []; this.drawn = { calls: 0, tris: 0 };
    this.gl = renderer.getContext(); this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.active = null; this.gpuBy = {};
    this.el = document.createElement('pre');
    this.el.setAttribute('aria-hidden', 'true');
    Object.assign(this.el.style, {
      position: 'fixed', left: '92px', top: '58px', zIndex: 60, margin: 0, padding: '8px 10px', maxWidth: '520px', pointerEvents: 'none',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: '#cfe8ff', background: 'rgba(8,12,18,0.78)',
      border: '1px solid rgba(120,170,220,0.25)', borderRadius: '6px', whiteSpace: 'pre', display: 'none',
    });
    document.body.appendChild(this.el);
    this.shownAt = 0;
    addEventListener('keydown', (e) => {
      if (e.key === 'F3' && e.shiftKey) { e.preventDefault(); this.copyDiagnostics(); }
      else if (e.key === 'F3') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'F4') { e.preventDefault(); this.checker(); }
      else if (e.key === 'F10' && this.bisect) { e.preventDefault(); const b = this.bisect; b.mode = (b.mode + 1) % b.names.length; this.flash(`F10 test view: ${b.names[b.mode]} (watch the GPU line in F3; F10 again to cycle)`); }
      else if (this.switches && /^F[5-9]$/.test(e.key)) { e.preventDefault(); const k = this.switches.keys[e.key]; if (k) { this.switches.off[k] = !this.switches.off[k]; this.flash(`${k} ${this.switches.off[k] ? 'OFF' : 'on'} (F5 shadows · F6 AO · F7 clouds · F8 SMAA · F9 bloom)`); } }
    });
  }

  // Debug switches for finding a flicker or a slowdown on real hardware: F5 world shadows, F6 AO, F7 volumetric clouds, F8 SMAA, F9 bloom.
  // The overlay lists what is switched off. The caller reads switches.off[name] each frame.
  // F10 cycles a visibility bisect for real hardware: hide the terrain, the trees and buildings, the aircraft and cockpit, or the sky and effects, and read how the
  // GPU time in F3 drops. groups[mode] lists what to hide; names[0] is 'normal'.
  bindBisect(names) { this.bisect = { mode: 0, names }; return this.bisect; }
  bindSwitches() { this.switches = { keys: { F5: 'shadows', F6: 'ao', F7: 'clouds', F8: 'smaa', F9: 'bloom' }, off: {} }; return this.switches.off; }
  // Opt-in diagnostics for the owner to send: GPU, screen, F3 numbers and the last hitches. Nothing is sent anywhere; it goes to the clipboard.
  copyDiagnostics() {
    const gl = this.gl, dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? `${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}` : 'hidden by the browser';
    const was = this.on; this.n >= 5 && (this.on = true); this.show(); this.on = was;
    const text = [`GPU: ${gpu}`, `WebGL: ${gl.getParameter(gl.VERSION)}`, `UA: ${navigator.userAgent}`, `cores ${navigator.hardwareConcurrency}, memory ${navigator.deviceMemory ?? '?'} GB`,
      `parallel shader compile: ${!!gl.getExtension('KHR_parallel_shader_compile')}, timer queries: ${!!this.ext}`, '', this.el.textContent].join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => this.flash('Diagnostics copied to the clipboard'), () => { this.toggle(true); this.el.textContent = text; this.flash('Could not copy — the text is in the overlay'); });
  }
  flash(msg) { const d = document.createElement('div'); d.textContent = msg; Object.assign(d.style, { position: 'fixed', left: '50%', top: '70px', transform: 'translateX(-50%)', zIndex: 70, padding: '8px 14px', background: 'rgba(8,12,18,.9)', color: '#cfe8ff', font: '13px system-ui', borderRadius: '6px' }); document.body.appendChild(d); setTimeout(() => d.remove(), 2500); }
  // 1:1 mapping self-test (F4): a one-device-pixel checkerboard drawn at the real device resolution. Clean fine grid = the page maps 1:1 to the screen;
  // wide bands or moire = the browser is scaling (zoom, a non-integer pixel ratio, or a display scaled by the OS).
  checker() {
    if (this._chk) { this._chk.remove(); this._chk = null; return; }
    const c = document.createElement('canvas'), dpr = devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    c.width = w; c.height = h;
    const x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = (i + j) & 1 ? 255 : 0, o = (j * w + i) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
    x.putImageData(im, 0, 0);
    Object.assign(c.style, { position: 'fixed', left: 0, top: 0, width: innerWidth + 'px', height: innerHeight + 'px', zIndex: 80, pointerEvents: 'none', imageRendering: 'pixelated' });
    document.body.appendChild(c); this._chk = c;
    this.flash(`1:1 test: ${w}x${h} device px for ${innerWidth}x${innerHeight} CSS px (ratio ${dpr.toFixed(3)}). F4 to close`);
  }

  toggle(v) { this.on = v ?? !this.on; this.el.style.display = this.on ? 'block' : 'none'; }

  // call first thing in the frame with the rAF timestamp
  begin(now) {
    const t = performance.now();
    if (this.last) {
      const dt = now - this.last;
      this.dt[this.pos] = dt; this.pos = (this.pos + 1) % this.N; this.n = Math.min(this.N, this.n + 1);
      for (const k in this.cur) this.avg[k] = (this.avg[k] ?? this.cur[k]) * 0.95 + this.cur[k] * 0.05;
      this.drawn.calls = this.renderer.info.render.calls; this.drawn.tris = this.renderer.info.render.triangles;
      if (dt > 40 && this.n > 10) {
        const parts = Object.entries(this.cur).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ');
        this.hitches.unshift(`${new Date().toLocaleTimeString()}  ${dt.toFixed(0)} ms   ${parts}`);
        if (this.hitches.length > 6) this.hitches.pop();
      }
    }
    this.last = now; this.tm = t; this.prev = this.cur; this.cur = {};
    this.renderer.info.reset();
    if (this.on && this.ext) this.pollGpu();
    if (this.on && t - this.shownAt > 250) { this.shownAt = t; this.show(); }
  }

  // attribute the time since the previous mark to a phase
  mark(name) { const t = performance.now(); this.cur[name] = (this.cur[name] || 0) + (t - this.tm); this.tm = t; }

  // GPU time by pass: gpuSection(label) closes the open timer query and starts the next one, gpuEnd() closes the last. Timer queries cannot
  // nest, so the passes of a frame are measured back to back. Only runs while the overlay is open.
  gpuSection(label) {
    if (!this.ext || !this.on) return;
    this.gpuEnd();
    if (this.queries.length > 40) return;
    const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = { q, label };
  }
  gpuBegin() { this.gpuSection('frame'); }
  gpuEnd() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.queries.push(this.active); this.active = null;
  }
  pollGpu() {
    const gl = this.gl;
    while (this.queries.length) {
      const { q, label } = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6, o = this.gpuBy;
        o[label] = o[label] === undefined ? ms : o[label] * 0.92 + ms * 0.08;
      }
      gl.deleteQuery(q); this.queries.shift();
    }
  }

  // redundant-work counters: per second, how many times each layer really redrew and how many times it skipped because nothing had changed
  workLine() {
    const now = performance.now(), snap = stat.snapshot();
    if (!this._w || now - this._w.t >= 1000) {
      const prev = this._w;
      this._w = { t: now, snap: new Map(snap.map(([n, d, s]) => [n, [d, s]])), rate: prev ? prev.rate : '' };
      if (prev) {
        const dt = (now - prev.t) / 1000;
        this._w.rate = snap.map(([n, d, s]) => { const p = prev.snap.get(n) || [0, 0]; return `${n} ${((d - p[0]) / dt).toFixed(0)}/${((s - p[1]) / dt).toFixed(0)}`; }).join('  ');
      }
    }
    return this._w.rate ? `work per s (done/skipped): ${this._w.rate}` : '';
  }

  show() {
    if (this.ext) this.pollGpu();
    const n = this.n;
    if (n < 5) { this.el.textContent = 'collecting…'; return; }
    const a = Array.from(this.dt.subarray(0, n)).sort((x, y) => x - y), pct = (p) => a[Math.min(n - 1, Math.floor(n * p))];
    const mean = a.reduce((s, v) => s + v, 0) / n, cpu = Object.values(this.avg).reduce((s, v) => s + v, 0);
    const phases = Object.entries(this.avg).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ');
    const heap = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB heap  ` : '';
    const i = this.renderer.info;
    this.el.textContent = [
      `${(1000 / mean).toFixed(0)} fps   frame ${mean.toFixed(1)} ms   p95 ${pct(0.95).toFixed(1)}   p99 ${pct(0.99).toFixed(1)}   worst ${a[n - 1].toFixed(0)}`,
      `CPU ${cpu.toFixed(1)} ms:  ${phases}`,
      this.ext ? `GPU ${Object.values(this.gpuBy).reduce((x, y) => x + y, 0).toFixed(1)} ms:  ${Object.entries(this.gpuBy).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ') || '…'}` : 'GPU time: not exposed by this browser',
      `${this.drawn.calls} draws  ${(this.drawn.tris / 1e3).toFixed(0)}k tris  ${i.memory.geometries} geometries  ${i.memory.textures} textures  ${heap}`,
      this.counters(),
      this.workLine(),
      this.switches && Object.values(this.switches.off).some(Boolean) ? `switched OFF for testing: ${Object.entries(this.switches.off).filter(([, v]) => v).map(([k]) => k).join(', ')}` : '',
      this.hitches.length ? 'hitches (>40 ms), CPU ms per phase of that frame:' : 'no hitches over 40 ms yet',
      ...this.hitches,
    ].filter(Boolean).join('\n');
  }
}
