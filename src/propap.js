// Representative two-axis fits, controlled through the game's AP sheet, not invented cockpit switches.
// F27 Mk500: conventional transport heading/altitude servos; DA40 NG: GFC700-style subset;
// C172SP/172S: optional retrofit two-axis fit (the supplied six-pack art has no AP panel).
// Deliberately no autothrottle, FLCH, automatic recovery, takeoff, go-around or autoland.
import { C172, c172Lift, stallAlpha as c172Stall } from './c172.js';
import { DA40, da40Lift, stallAlpha as da40Stall } from './da40.js';
import { F27, f27Lift, stallAlpha as f27Stall } from './f27.js';

const KT = 1.943844, FT = 3.28084;
const MODES = Object.freeze(['hdg', 'alt', 'vs', 'nav', 'appr']);
function profile(spec, lift, stall, tune) {
  const prot = fdm => { const a = stall(fdm.flaps || 0); return { aOn: a - 0.045, aMax: a - 0.005, aSafe: a - 0.08 }; };
  return {
    manualThrottle: true, supportedModes: MODES, vsCapture: true,
    iasLimit: (spec.VMO || spec.VNE) / KT, machLimit: spec.MMO || Infinity, citLimit: Infinity,
    speedLimit: fdm => Math.min(spec.VMO || spec.VNE,
      fdm.flaps > 0.5 ? (spec === DA40 ? (fdm.flaps > 20.5 ? spec.VFE_LDG : spec.VFE_TO) : spec.VFE) : Infinity,
      fdm.gearPos > 0.05 && spec.VLE ? spec.VLE : Infinity) / KT,
    iasMargin: 5 / KT, prot,
    vmin: fdm => Math.sqrt(2 * fdm.mass * 9.80665 / (1.225 * spec.S * Math.max(0.3, lift(prot(fdm).aOn, fdm.flaps || 0)))),
    vFloor: 25, kiDiv: () => 8, bank: () => 20, locBank: 15,
    hdgGain: 0.06, locHdgGain: 0.08, rollKp: 2.2, rollKd: 2.5,
    locKi: 0.003, locKp: 0.04, protSink: 3,
    ceiling: tune.ceiling, maxVs: tune.maxVs / 196.85, minApAgl: 200 / FT,
    target: { alt: tune.alt / FT, hdg: 0, spd: tune.speed / KT, mach: 0, vsLimit: tune.vs / 196.85, vs: 0 },
    ...tune, maxVs: tune.maxVs / 196.85,
  };
}
export const C172_AP = profile(C172, c172Lift, c172Stall, { label: 'C172SP optional two-axis fit', ceiling: 14000 / FT, alt: 8000, speed: 105, vs: 500, maxVs: 1000 });
export const DA40_AP = profile(DA40, da40Lift, da40Stall, { label: 'DA40 NG representative GFC 700 subset', ceiling: 16400 / FT, alt: 8000, speed: 125, vs: 500, maxVs: 1500 });
export const F27_AP = profile(F27, f27Lift, f27Stall, { label: 'F27 Mk500 representative two-axis fit', ceiling: F27.CEILING, alt: 15000, speed: 192, vs: 1000, maxVs: 1500, rollKp: 0.8, rollKd: 1.6, kiDiv: () => 10 });

// The same gate is used by panel mode buttons and the controller, including stale/programmatic modes.
export function supportsApMode(cfg, mode) { return !cfg?.supportedModes || cfg.supportedModes.includes(mode); }
export function sanitizeApModes(ap) {
  for (const key of Object.keys(ap.modes)) if (!supportsApMode(ap.cfg, key)) ap.modes[key] = false;
  if (ap.cfg.manualThrottle) {
    ap.target.alt = Math.min(ap.cfg.ceiling, ap.target.alt);
    ap.target.vs = Math.max(-ap.cfg.maxVs, Math.min(ap.cfg.maxVs, ap.target.vs));
    ap.target.vsLimit = Math.max(100 / 196.85, Math.min(ap.cfg.maxVs, ap.target.vsLimit));
  }
}
