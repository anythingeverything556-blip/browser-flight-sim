// Diagnostics overlay (F3). Shows frame-time percentiles, the CPU time of each phase of a frame, GPU time of the scene render when
// the browser exposes timer queries, renderer counters, and a log of recent hitches (frames over 40 ms) with the phase that
// took the time: a long CPU phase is JavaScript or upload work on the main thread, time no phase explains is the GPU or driver.
export class PerfMonitor {
  constructor(renderer, counters = () => '') {
    this.renderer = renderer; this.counters = counters; this.on = false;
    renderer.info.autoReset = false; // counters then cover the whole frame, not just the last pass
    this.N = 360; this.dt = new Float32Array(this.N); this.n = 0; this.pos = 0;
    this.last = 0; this.tm = 0; this.cur = {}; this.prev = {}; this.avg = {}; this.hitches = []; this.drawn = { calls: 0, tris: 0 };
    this.gl = renderer.getContext(); this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.active = null; this.gpuMs = null;
    this.el = document.createElement('pre');
    this.el.setAttribute('aria-hidden', 'true');
    Object.assign(this.el.style, {
      position: 'fixed', left: '92px', top: '58px', zIndex: 60, margin: 0, padding: '8px 10px', maxWidth: '520px', pointerEvents: 'none',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: '#cfe8ff', background: 'rgba(8,12,18,0.78)',
      border: '1px solid rgba(120,170,220,0.25)', borderRadius: '6px', whiteSpace: 'pre', display: 'none',
    });
    document.body.appendChild(this.el);
    this.shownAt = 0;
    addEventListener('keydown', (e) => { if (e.key === 'F3') { e.preventDefault(); this.toggle(); } });
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
    if (this.on && t - this.shownAt > 250) { this.shownAt = t; this.show(); }
  }

  // attribute the time since the previous mark to a phase
  mark(name) { const t = performance.now(); this.cur[name] = (this.cur[name] || 0) + (t - this.tm); this.tm = t; }

  gpuBegin() {
    if (!this.ext || !this.on || this.active || this.queries.length > 6) return;
    const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q;
  }
  gpuEnd() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.queries.push(this.active); this.active = null;
  }
  pollGpu() {
    const gl = this.gl;
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.gpuMs = this.gpuMs === null ? ms : this.gpuMs * 0.9 + ms * 0.1; }
      gl.deleteQuery(q); this.queries.shift();
    }
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
      this.ext ? `GPU scene+post ${this.gpuMs === null ? '…' : this.gpuMs.toFixed(1)} ms` : 'GPU time: not exposed by this browser',
      `${this.drawn.calls} draws  ${(this.drawn.tris / 1e3).toFixed(0)}k tris  ${i.memory.geometries} geometries  ${i.memory.textures} textures  ${heap}`,
      this.counters(),
      this.hitches.length ? 'hitches (>40 ms), CPU ms per phase of that frame:' : 'no hitches over 40 ms yet',
      ...this.hitches,
    ].filter(Boolean).join('\n');
  }
}
