// Counts how often a subsystem did real work versus skipped it because nothing changed. F3 shows the per-second rates.
const c = Object.create(null);
const e = (n) => (c[n] ??= { d: 0, s: 0 });
export const stat = {
  did(n) { e(n).d++; },
  skip(n) { e(n).s++; },
  snapshot() { return Object.entries(c).map(([n, v]) => [n, v.d, v.s]); },
  reset() { for (const k in c) delete c[k]; },
};

// Rate limiter with a "dirty" flag for canvases: run(now) says whether to redraw; blank() says whether the canvas needs one clearing.
export class Redraw {
  constructor(name, maxHz = 30) { this.name = name; this.minMs = 1000 / maxHz - 1; this.last = -1e9; this.dirty = false; }
  // active: the layer has something to show. Returns 'draw', 'clear' (once, after it stops showing anything) or 'skip'.
  next(now, active) {
    if (!active) {
      if (this.dirty) { this.dirty = false; stat.did(this.name + '.clear'); return 'clear'; }
      stat.skip(this.name); return 'skip';
    }
    if (now - this.last < this.minMs) { stat.skip(this.name); return 'skip'; }
    this.last = now; this.dirty = true; stat.did(this.name); return 'draw';
  }
}

// Signature of a numeric state object at display precision (4 significant digits; flightTime to whole seconds), for "did anything change?" checks.
export function stateSig(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'number' ? (k === 'flightTime' ? Math.floor(v) : +v.toPrecision(4)) : v));
}

// Gate for a layer that is redrawn from state at a fixed rate. Redraws while the state changes and for `settle` more draws afterwards
// (eased needles are still converging), then skips until the state changes again.
export class ChangeGate {
  static debug = false; // set true (window.__sim.ChangeGate) to count which keys of the state made each redraw happen
  constructor(name, settle = 16) { this.name = name; this.settle = settle; this.sig = ''; this.left = 0; }
  should(state, extra = '') {
    const sig = stateSig(state) + extra;
    if (sig !== this.sig) {
      if (ChangeGate.debug && this.prev) for (const k in state) if (stateSig(state[k]) !== stateSig(this.prev[k])) stat.did(`${this.name}.changed:${k}`);
      this.sig = sig; this.left = this.settle;
      if (ChangeGate.debug) this.prev = JSON.parse(JSON.stringify(state));
    }
    if (this.left > 0) { this.left--; stat.did(this.name); return true; }
    stat.skip(this.name); return false;
  }
}
