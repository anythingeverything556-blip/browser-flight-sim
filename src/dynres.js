// Adaptive render resolution controller (pure logic, no DOM) so it can be unit tested.
//
// Pixel cost grows with the square of the render ratio, so the step that restores the frame budget is sqrt(target / measured). Jumping straight
// there costs one render-target reallocation instead of a chain of them. The floor is the screen's own resolution (times `floorNative`), never
// the 75 % of a supersampled ratio the old controller stopped at, which left a 2x supersampled picture at 2x the pixels it needed.

export const DYN = {
  target: 1 / 60,      // frame budget, seconds
  downAt: 1 / 54,      // median frame time that triggers a step down
  downP90: 1 / 30,     // or a 90th-percentile frame time this bad
  upMed: 1 / 78,       // headroom needed to step back up
  upP90: 1 / 52,
  upHold: 6000,        // ms since the last change before stepping up
  step: 0.05,          // size of one step up
  floorNative: 0.75,   // lowest ratio, as a fraction of the screen's own pixel ratio
  probeMed: 1 / 57.5,  // a 60 Hz screen rounds every frame to 16.7 ms, so a median under 1/78 never happens there: at the budget with a clean
  probeHold: 20000,    // p90 the scale probes one step up after this long (and a probe that turns out too slow sets a ceiling for a while)
  downHold: 4000,      // ms between steps down (each one reallocates every render target), unless frames are under 30 fps
};

// state: { scale, base, changed }, native = device pixel ratio. Returns the new scale (fraction of base), or the old one.
// state may also carry: noDown (lowering the resolution did not help: the frame is CPU-bound), ceil / ceilUntil (a probe up that was too slow).
export function nextScale(state, med, p90, now, native = 1, cfg = DYN) {
  const base = Math.max(0.01, state.base), since = now - (state.changed || 0);
  const minScale = Math.min(1, Math.max(0.3, (cfg.floorNative * Math.max(1, native)) / base));
  const ceil = state.ceil && now < (state.ceilUntil || 0) ? state.ceil : 1;
  let s = state.scale;
  if (med > cfg.downAt || p90 > cfg.downP90) {
    if (state.noDown || (since < (cfg.downHold ?? 0) && med < 1 / 30)) return s;
    const k = Math.sqrt(cfg.target / Math.max(med, p90 * 0.6, 1e-4));
    s = Math.max(minScale, Math.min(s - 0.02, s * Math.max(0.5, Math.min(0.97, k))));
  } else if (p90 < cfg.upP90 && ((med < cfg.upMed && since > cfg.upHold) || (med < (cfg.probeMed ?? 0) && since > (cfg.probeHold ?? Infinity)))) {
    s = Math.min(1, ceil - 1e-9 < s + cfg.step ? s : s + cfg.step);
  }
  return Math.round(s * 1000) / 1000;
}

// Pressure ladder: extra cuts once resolution is already at its floor and the frame is still over budget.
// 0 = none, 1 = ambient occlusion off, 2 = also halve the shadow update rate, 3 = emergency: the resolution floor itself drops by
// `emergencyDrop` (below 30 fps a softer picture beats a slideshow). Each level needs `need` consecutive slow checks and `recover` consecutive fast
// ones to come back, so a loading hitch never flips it. Level 3 only counts frames slower than 1/30 s.
export const EMERGENCY_DROP = 0.2;
// When to look at the frame times: after at least 1.5 s and 12 frames. The old rule wanted 30 frames, which at 5 fps is 6 s of a slideshow before the first step.
export const dynReady = (frames, sinceMs) => sinceMs >= 1500 && frames >= 12;
// Graphics preset fallback: a GPU that is still under 30 fps with every other cut applied drops one preset (never to Low, which has no post pipeline).
export const lowerPreset = (name) => ({ ultra: 'high', high: 'normal' })[name] || null;
export function nextPressure(p, atFloor, med, cfg = {}) {
  const need = cfg.need ?? 2, recover = cfg.recover ?? 6;
  let { level, slowN, fastN } = p, drop = false;
  const slow = atFloor && med > (level >= 2 ? 1 / 30 : 1 / 40), fast = med < 1 / 66;
  if (slow) { slowN++; fastN = 0; } else if (fast) { fastN++; slowN = 0; } else { slowN = 0; fastN = 0; }
  if (slowN >= need && level < 3) { level++; slowN = 0; }
  else if (slowN >= need + 2 && level >= 3) { drop = true; slowN = 0; } // still slow with the emergency floor: one preset down
  if (fastN >= recover && level > 0) { level--; fastN = 0; }
  return { level, slowN, fastN, drop };
}
// the resolution floor for a pressure level
export const floorFor = (level, cfg = DYN) => cfg.floorNative - (level >= 3 ? EMERGENCY_DROP : 0);
