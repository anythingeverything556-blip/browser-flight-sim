import * as THREE from 'three';
import { liftCoef, SPEC } from './flight.js';

const IAS_LIMIT = 228; // m/s indicated (~443 kt)
const MACH_LIMIT = 3.25; // protection ramps in from M3.23 (the default cruise target is M3.2, which used to sit on the old M3.20 onset) to full at M3.30
// Angle-of-attack envelope (rad). The chine vortex keeps lift growing to ~27 deg, but the elevons lose bite and buffet is heavy well before
// that, and the approach AOA at 180 kt is ~13 deg. Protection starts at aOn (stop climbing, add thrust, ease the nose down), is full push at
// aMax, and stays latched until the AOA is back under aSafe.
export const PROT = { aOn: 0.23, aMax: 0.31, aSafe: 0.19 };
// 1 g equivalent airspeed (m/s) at the protection AOA: below it the jet cannot hold altitude without exceeding the protected AOA.
export const minSpeedEas = (mass, M) => Math.sqrt(2 * mass * 9.80665 / (1.225 * SPEC.S * Math.max(0.2, liftCoef(PROT.aOn, M))));
// touchdown reference (EAS): the landing aid's own flare floor, 1.1x the protection speed, ~11 deg AOA and ~10 deg of pitch on a 2 m/s sink. The nozzles
// strike at 16 deg level and 15 with 6 deg of bank, minus the strut compression: a fixed 160 kt target needed 15-17 deg AOA at landing weights.
export const vrefEas = (mass) => 1.1 * minSpeedEas(mass, 0.25);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((a + 540) % 360) - 180;

// Per-aircraft autopilot limits and gains (speeds m/s, equivalent / calibrated). The Blackbird's are the original constants; the Vision Jet's are in sf50ap.js.
export const SR71_AP = {
  iasLimit: IAS_LIMIT, machLimit: MACH_LIMIT, citLimit: 420,
  prot: () => PROT,
  vmin: (fdm, M) => minSpeedEas(fdm.mass || 55000, M),
  climbIas: () => 196,          // FLCH climb speed when no speed target is set (~380 KEAS)
  vFloor: 60,                   // speed floor for the loop gains
  kiDiv: (V) => clamp(20 + (V - 130) * (40 / 120), 20, 60),
  bank: (M, nav) => (M > 1 ? (nav ? 35 : 25) : 30), // deg
  locBank: 20,
  hdgGain: 0.03, locHdgGain: 0.06, // bank per degree of heading error (share of the bank limit)
  rollKp: 0.5, rollKd: 1.2,     // roll loop: rad/s^2 per rad of bank error and per rad/s of roll rate, over the roll power
  locKi: 0.0005, locKp: 0,      // localizer: crosswind integrator (deg per m s) and extra intercept (deg per m)
  spdGain: 40,                  // m/s of speed error for a full throttle step
  protSink: 12,                 // m/s of descent the stall protection trades for AOA
  recNz: (ias) => (ias > 190 ? 3 : 2.5), recSpdMax: 200,
  gaSpd: [120, 160], gaClimb: 600,
  target: { alt: 9144, hdg: 341, spd: 205, mach: 3.2, vsLimit: 30, vs: 0 },
};

// Attitude helpers shared with the HUD.
export function attitude(quat) {
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  const right = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  const pitch = Math.asin(clamp(fwd.y, -1, 1));
  const heading = (Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI + 360) % 360;
  // bank: angle of the right wing below the horizon, positive = right wing down
  const bank = Math.atan2(-right.y, up.y);
  return { pitch, heading, bank, fwd, up, right };
}

// Climb speed schedule: the commanded speed if a speed mode is set, otherwise ~380 KEAS (the real climb schedule is 450 KEAS up to M3,
// kept lower here for margin against the inlet and CIT limits). Returns { active, vs, th }.
export function flightLevelChange(ap, s, ias, vmin, rec) {
  const off = { active: false, vs: 0, th: 0 }, c = ap.cfg || SR71_AP;
  if (!ap.modes.flch || rec) return off;
  const err = ap.target.alt - s.alt, vc = clamp(ap.modes.spd ? ap.target.spd : c.climbIas(s.alt), vmin * 1.25, c.iasLimit * 0.9);
  const capture = 150 + 4 * Math.abs(s.vs);
  if (Math.abs(err) < capture) { // capture: hand over to altitude hold at the current speed
    ap.modes.flch = false; ap.modes.alt = true; ap.modes.vs = false;
    if (!ap.modes.mach) { ap.modes.spd = true; ap.target.spd = Math.round(clamp(ias, vmin * 1.25, c.iasLimit * 0.9)); }
    ap.status.msg = 'ALT captured'; ap.ga = false;
    return off;
  }
  const vsMax = clamp(ap.target.vsLimit * 2, 20, 70), agl = s.nav?.agl ?? 1e9;
  if (err > 0) {
    // below the climb speed it levels or accelerates, but close to the ground it keeps a positive climb
    const floor = agl < 300 ? 6 : -3;
    // with a Mach target the climb speed is the equivalent airspeed that gives that Mach here, and the thrust eases off as the Mach target is reached
    // (full power through the target overshoots it into the overspeed protection)
    const M = s.out?.M || 0;
    const vcm = ap.modes.mach && s.out?.rho ? Math.min(vc, ap.target.mach * s.out.a * Math.sqrt(s.out.rho / 1.225)) : vc;
    const th = ap.modes.mach ? clamp(1 - 25 * (M - ap.target.mach), 0.3, 1) : 1; // full power until the target Mach, then modulate: the old early easing slowed the top of the climb
    return { active: true, vs: clamp(6 + 2.5 * (ias - vcm), floor, vsMax), th };
  }
  const vd = Math.min(vc * 1.12, c.iasLimit * 0.9); // descending, the speed may float up a little: idle thrust and a steeper path
  return { active: true, vs: -clamp(8 + 2.5 * (vd - ias), 2, vsMax), th: 0.12 };
}

export class Autopilot {
  constructor(cfg = SR71_AP) {
    this.on = false; this.cfg = cfg;
    this.modes = { alt: true, hdg: true, spd: false, mach: false, nav: false, appr: false, vs: false, flch: false };
    this.target = { ...cfg.target };
    this.status = { lat: 'HDG', vert: 'ALT', loc: false, gs: false, prot: '', warn: '', recover: false };
    this.stallHold = 0; this.overHold = 0; this.recovering = false; this.recT = 0; this.altErrT = 0;
    this.deI = 0; this.thI = 0.6; this.locI = 0; this.holdVs = null;
    this.kiDiv = null; // elevator integrator time scale override; normally scheduled with speed (see update)
  }
  engage(state) {
    this.on = true; this.lastTh = null; this.pilotThr = false;
    this.deI = state.ctrl.de; this.thI = state.throttle;
    this.reset();
  }
  disengage() { this.on = false; this.ga = false; this.reset(); }
  // Go-around (TO/GA): full power, wings level on the present heading, climb at the best-climb speed to 600 m above the present altitude, gear up in the climb.
  startGoAround(state, att, alt, ias) {
    if (!this.on) this.engage(state);
    Object.keys(this.modes).forEach((k) => { this.modes[k] = false; });
    Object.assign(this.modes, { flch: true, hdg: true, spd: true });
    const c = this.cfg;
    Object.assign(this.target, { alt: alt + c.gaClimb, hdg: Math.round(att.heading), spd: Math.max(c.gaSpd[0], Math.min(c.gaSpd[1], ias + 15)), vsLimit: c.target.vsLimit });
    this.ga = true; this.status.msg = 'GO AROUND';
  }
  // drop approach latches and the PITCH-hold target so nothing stale survives a re-engage or respawn
  reset() {
    this.vsOverride = null;
    this.status.loc = false; this.status.gs = false; this.locI = 0; this.holdVs = null;
    this.stallHold = 0; this.overHold = 0; this.recovering = false; this.status.recover = false; this.status.prot = ''; this.status.warn = ''; this.altErrT = 0;
  }
  // Unusual-attitude / stall recovery: unload, level the wings, full power, then level off and hold the altitude it ends at.
  startRecovery(state) {
    if (!this.on) this.engage(state);
    this.recovering = true; this.recT = 0; this.status.recover = true;
    this.modes.vs = false; this.modes.appr = false; this.modes.nav = false;
  }

  // returns control commands; s = { fdm, out, att, vs, alt, ias, nav }. th is the throttle to apply when thrOverride is set (or a speed mode is on).
  update(dt, s) {
    const { fdm, out, att } = s, c = this.cfg, PROT = c.prot(fdm, out.M || 0), IAS_LIMIT = c.iasLimit, MACH_LIMIT = c.machLimit;
    const V = Math.max(c.vFloor, out.V), G = 9.80665;
    const nav = s.nav || {};
    const ias = s.ias, M = out.M || 0;

    // ---- protections: stall / minimum speed / overspeed ----
    const alpha = (out.alpha || 0) + 0.2 * (fdm.alphaDot || 0); // lead term: react to a fast-growing AOA before it gets there
    const sev = clamp((alpha - PROT.aOn) / (PROT.aMax - PROT.aOn), 0, 1);
    const vmin = c.vmin(fdm, M);
    const airborne = !fdm.onGround && ias > 25;
    if (sev > 0.02 && airborne) this.stallHold = 2;
    else if (this.stallHold > 0 && (out.alpha || 0) > PROT.aSafe) this.stallHold = Math.max(this.stallHold, 0.5);
    else this.stallHold = Math.max(0, this.stallHold - dt);
    const flare = this.tauV != null;
    const stallProt = airborne && !flare && (this.stallHold > 0 || ias < vmin * 0.97);
    const cit = (out.T ?? 216) * (1 + 0.2 * M * M) - 273.15;
    const overSev = airborne ? Math.max(clamp((ias - (IAS_LIMIT - 10)) / 10, 0, 1), clamp((M - (MACH_LIMIT - 0.02)) / 0.07, 0, 1), clamp((cit - c.citLimit) / 12, 0, 1)) : 0;
    if (overSev > 0) this.overHold = 2; else this.overHold = Math.max(0, this.overHold - dt);
    const overProt = this.overHold > 0;

    // ---- recovery mode (unusual attitude / stall): wings level, unload, power, then level off ----
    const rec = this.recovering;
    if (rec) {
      this.recT += dt;
      const done = (out.alpha || 0) < PROT.aSafe && Math.abs(att.bank) < 0.2 && Math.abs(att.pitch) < 0.4 && ias > vmin * 1.05 && Math.abs(s.vs) < 25;
      if (done || this.recT > 90 || fdm.onGround) {
        this.recovering = false; this.status.recover = false;
        this.modes.alt = true; this.modes.vs = false; this.modes.hdg = true;
        this.target.alt = s.alt; this.target.hdg = Math.round(att.heading); this.deI = clamp(this.deI, -0.4, 0.4);
        if (!this.modes.mach) { this.modes.spd = true; this.target.spd = clamp(ias, vmin * 1.25, c.recSpdMax); }
        this.thI = fdm.throttle;
      }
    }

    // flight level change: thrust sets the energy (full power to climb, idle to descend) and the pitch holds the climb speed, so the jet climbs as
    // fast as its speed allows and never trades its airspeed for height. At 150 m (plus a lead on the climb rate) from the target it captures ALT.
    const flch = flightLevelChange(this, s, ias, vmin, rec);
    // vertical: altitude -> flight-path angle -> elevator (PI with pitch-rate damping)
    let vsT;
    // approach mode: localizer captures inside 2.5°, glideslope once within half a degree of the path
    if (this.modes.appr && nav.ilsValid && !rec) {
      // the localizer captures on an intercept heading (not flying away from the runway), the glideslope only in front of its origin: past it the
      // path's deviation reads zero, which captured G/S over the airfield
      const onIntercept = nav.locHdg == null || Math.abs(wrap180(att.heading - nav.locHdg)) < 75;
      if (!this.status.loc && Math.abs(nav.locDev) < 2.5 && onIntercept) this.status.loc = true;
      if (this.status.loc && !this.status.gs && Math.abs(nav.gsDev) < 0.5 && (nav.thrDist == null || nav.thrDist > -250)) this.status.gs = true;
    } else { this.status.loc = false; this.status.gs = false; }
    if (rec) vsT = 0;
    else if (this.status.gs) vsT = Math.max(-this.target.vsLimit * 1.5, Math.min(5, nav.gsVs));
    else if (this.modes.flch && flch.active) vsT = flch.vs;
    else if (this.modes.vs) vsT = this.target.vs;
    else if (this.modes.alt) {
      const err = this.target.alt - s.alt;
      vsT = clamp(err * 0.06, -this.target.vsLimit, this.target.vsLimit);
    } else { this.holdVs ??= s.vs; vsT = this.holdVs; }
    if (this.status.gs || this.modes.vs || this.modes.alt) this.holdVs = null;
    if (this.vsOverride != null && !rec) vsT = this.vsOverride; // an outer loop (the Vision Jet's autoland flare) flies the sink rate
    // speed protection: this delta wing is on the back side of the power curve near the minimum speed, so a climb (or holding the glideslope)
    // that costs airspeed ends in a stall. Fade climbs out between 1.17 and 1.02 x the minimum speed and trade height for speed below it.
    const vLo = vmin * 1.02, vHi = vmin * 1.17;
    if (vsT > 0) vsT *= clamp((ias - vLo) / (vHi - vLo), 0, 1);
    if (ias < vLo) vsT = Math.min(vsT, -(vLo - ias) * 0.6);
    // energy: with a speed mode on, a climb only goes as fast as the speed allows. Climbing at full rate while well below the commanded speed
    // trades all the airspeed for height and ends hanging on the minimum speed (the jet then needs minutes to accelerate), so the climb rate
    // fades out when the speed is more than ~10 % below the climb speed (the target, or ~370 KEAS when a Mach target is set).
    if (vsT > 2 && (this.modes.spd || this.modes.mach) && !this.status.gs && !flch.active) { // small altitude corrections are left alone; only a real climb is scheduled
      // with a Mach target the climb speed is the equivalent airspeed that gives that Mach at this height (it falls as the jet climbs: ~341 kt at 81,000 ft), not a fixed
      // 381 kt: the fixed value stopped every Mach-hold climb at ~81,000 ft, below the 85,000 ft the jet can hold
      const machEas = this.modes.mach && out.rho && out.a ? this.target.mach * out.a * Math.sqrt(out.rho / 1.225) : 1e9;
      const vc = this.modes.mach ? Math.min(IAS_LIMIT * 0.86, c.climbIas(s.alt), machEas) : Math.max(this.target.spd, vmin * 1.2);
      vsT = 2 + (vsT - 2) * clamp((ias - vc * 0.9) / (vc * 0.08), -0.3, 1); // below it the jet levels off and then trades a little height for speed
    }
    if (stallProt) vsT = Math.min(vsT, -Math.max(sev, 0.15) * c.protSink); // stop commanding a climb, then trade height for AOA
    // overspeed: allow a gentle zoom climb to bleed energy instead of holding level into the limit
    if (overProt && !stallProt) vsT = Math.max(vsT, overSev * 8);
    // Vertical speed error -> load-factor command (about 5 s time constant, independent of speed) -> elevator through the
    // aircraft's own static gain (out.dePerG = SM * W / (qS * elevator power)), so the loop gain follows q, Mach and CG instead of
    // being tuned for one flight condition. Pitch-rate damping is scaled by elevator power the same way.
    let evs = clamp(vsT - s.vs, -60, 60);
    if (flare && att.pitch > FLARE_PITCH_MAX) evs = Math.min(evs, -(att.pitch - FLARE_PITCH_MAX) * 40);
    const kn = out.dePerG ?? 0.1, mde = Math.max(0.05, out.pitchPower ?? 1);
    // fast trim on approach, where the trim must follow the speed changes, slow in fast cruise, where a quick integrator sets up a phugoid
    const kiDiv = this.kiDiv ?? c.kiDiv(V);
    const bankAbs = Math.abs(att.bank);
    let recDe = 0;
    // anti-windup: the trim integrator may not wind up a pull while the protection is holding the nose down
    if (rec) { // recovery flies a load-factor command to capture level flight: no V/S trim integrator, the integrator works on the g error
      const gam = Math.asin(clamp(s.vs / V, -1, 1));
      const gamCmd = -0.08 * clamp((vmin * 1.15 - ias) / (vmin * 0.1), 0, 1); // short of the minimum speed, trade height for it
      const nzCmd = bankAbs > 1.05 ? 0 : clamp(Math.cos(gam) + (gamCmd - gam) * V / (G * 4), 0, c.recNz(ias));
      const enz = nzCmd - (out.nz ?? 1);
      this.deI = clamp(this.deI + kn * enz * 0.5 * dt, -0.8, 0.8);
      recDe = kn * 0.6 * enz;
    } else if (!(stallProt && evs > 0)) this.deI = clamp(this.deI + kn * evs / (G * kiDiv) * dt, -0.8, 0.8);
    // tighter V/S loop on the glideslope (2.5 s) than for altitude changes (5 s)
    const tau = this.tauV ?? (this.status.gs ? 2.5 : 5); // tauV: a faster vertical loop for the landing flare
    const damp = -0.3 / mde * fdm.w.z;
    let de = clamp(this.deI + (rec ? recDe : kn * clamp(evs / (tau * G), -1, 1)) + damp, -1, 1);
    // stall protection: no pull beyond trim, and up to 1.2 g of unloading (relative to trim) as the AOA rises towards the full-push limit
    if (stallProt) de = Math.min(de, this.deI + damp - 1.2 * kn * sev);
    // absolute AOA limiter: every radian over the onset angle takes elevator off, however large the trim integrator has become
    if (airborne) de -= 8 * kn * Math.max(0, alpha - PROT.aOn);
    de = clamp(de, -1, 1);

    // lateral: heading -> bank -> aileron
    const bankLim = c.bank(M, this.modes.nav) * Math.PI / 180;
    let hdgT = this.modes.hdg ? this.target.hdg : null;
    if (this.modes.nav && nav.lnavHdg != null && !rec) hdgT = nav.lnavHdg;
    // localizer: integral term trims out the crosswind so the jet sits on the centreline
    if (this.status.loc && nav.locHdg != null) { const x = nav.locXtk || 0; this.locI = clamp((this.locI || 0) - x * c.locKi * dt, -8, 8); hdgT = (nav.locHdg + this.locI - clamp(x * c.locKp, -10, 10) + 360) % 360; } else this.locI = 0;
    this.status.lat = rec ? 'WLV' : this.status.loc ? 'LOC' : (this.modes.nav && nav.lnavHdg != null ? 'LNAV' : (this.modes.hdg ? 'HDG' : 'WLV'));
    this.status.vert = rec ? 'RECOVER' : this.status.gs ? 'G/S' : (this.modes.flch && flch.active) ? 'FLCH' : (this.modes.vs ? 'V/S' : (this.modes.alt ? 'ALT' : 'PITCH'));
    this.cmdHdg = hdgT;
    // on the localizer, damp with the heading rate so small corrections don't weave
    const hk = this.status.loc ? c.locHdgGain : c.hdgGain;
    let bankT = hdgT != null && !rec ? clamp(wrap180(hdgT - att.heading) * hk, -1, 1) * (this.status.loc ? Math.min(bankLim, c.locBank * Math.PI / 180) : bankLim) : 0;
    if (stallProt) bankT *= 1 - sev; // near the stall, wings level first
    const eb = rec ? wrap180(-att.bank * 180 / Math.PI) * Math.PI / 180 : bankT - att.bank;
    const da = clamp(((rec ? 0.9 : flare ? FLARE_ROLL_GAIN : c.rollKp) * eb - c.rollKd * fdm.w.x) / Math.max(0.05, out.rollPower ?? 1), -1, 1);
    // positive rudder yaws the nose right, toward air arriving from the right (beta > 0)
    const dr = clamp(1.5 * out.beta, -1, 1);

    // speed: IAS (m/s) or Mach -> throttle. The target never goes below the minimum-speed floor.
    let th = fdm.throttle, thrOverride = false;
    if (this.modes.mach || this.modes.spd) {
      // never chase a target through the 450 KEAS structural / inlet limit (the real climb schedule is 450 KEAS up to M3)
      const tgt = Math.max(this.target.spd, vmin * 1.03);
      const e = Math.min(this.modes.mach ? (this.target.mach - M) * 4 : (tgt - ias) / c.spdGain, (IAS_LIMIT - ias) / 20);
      this.thI = clamp(this.thI + 0.3 * e * dt, 0, 1);
      th = clamp(this.thI + 0.8 * e, 0, 1);
    }
    // thrust demand from the protections applies in any mode, whether or not a speed mode is on
    const lowDemand = clamp((vmin * 1.1 - ias) / (vmin * 0.1), 0, 1);
    const need = stallProt ? 1 : (airborne ? lowDemand : 0);
    if (need > 0 && need > th - 0.001) { th = Math.max(th, need); this.thI = Math.max(this.thI, th); thrOverride = true; }
    if (flch.active) { th = flch.th; this.thI = th; thrOverride = true; }
    if (rec) { th = 1; thrOverride = true; }
    if (flare) {
      if (this.lastTh != null && Math.abs(fdm.throttle - this.lastTh) > 0.03) this.pilotThr = true;
      this.lastTh = null;
      if (!this.pilotThr && s.agl != null && s.agl < FLARE_THR_AGL) { th = s.agl > 3 ? FLARE_POWER * clamp((vmin * 1.1 - ias) / (vmin * 0.08), 0, 1) : 0; this.lastTh = th; thrOverride = true; }
    }
    if (overProt && !stallProt && !rec) { th = Math.min(th, 1 - overSev); this.thI = Math.min(this.thI, th); thrOverride = true; }

    // ---- status line and cue before a target can no longer be held ----
    this.status.prot = rec ? 'RECOVERING' : stallProt ? 'STALL PROTECT' : overProt ? (cit > c.citLimit ? 'CIT LIMIT' : 'OVERSPEED PROTECT') : '';
    let warn = '';
    const altHold = this.modes.alt && !this.modes.vs && !this.status.gs && !rec;
    if (altHold && airborne && Math.abs(this.target.alt - s.alt) > 150 && Math.abs(s.vs) < 1 && (stallProt || ias < vHi)) warn = 'CANNOT CLIMB — LOW SPEED';
    else if (!rec && !stallProt && airborne && ias < vHi * 1.02 && (this.modes.alt || this.status.gs)) warn = 'SPEED LOW';
    else if (!rec && airborne && this.modes.nav && M > 1 && cit > c.citLimit - 10) warn = 'CIT NEAR LIMIT';
    this.status.warn = warn;
    return { de, da, dr, th, thrOverride };
  }
}

// Landing aid: below 150 ft with the gear down, the sink rate is eased toward a flare profile (an exponential: 0.11 per second of height, never gentler
// than 0.6 m/s so the jet does settle onto the runway). The pilot's own pitch input switches it off.
export const AID_AGL = 46;
export const FLARE_PITCH_MAX = 11 * Math.PI / 180, FLARE_THR_AGL = 12, FLARE_POWER = 0.45, FLARE_ROLL_GAIN = 2;
export const flareSink = (agl) => -Math.max(0.6, 0.11 * agl);
// Landing aid engage rule. s: { enabled, onGround, crashed, gearPos, agl, vs, iasKt, pitch (stick), latched (the aid is already flying) }. Entry needs a
// sink rate; once engaged (always below AID_AGL) it stays latched until touchdown, a go-around or pilot pitch input. Its own flare, or a gust, slows the
// sink past the entry test at about 13 m: it used to let go there with the nose up and power on, and the jet climbed away.
export function landingAidOn(s) {
  // the 260 kt gate is for entry only: a gust (seen at 261 kt) or power left on mid-flare must not hand a nose-up jet back to a neutral stick
  if (!s.enabled || s.onGround || s.crashed || !(s.gearPos > 0.9) || !(s.agl > 0) || !(s.agl < AID_AGL) || (!s.latched && !(s.iasKt < 260)) || Math.abs(s.pitch) >= 0.25) return false;
  return !!s.latched || s.vs < -0.2;
}
