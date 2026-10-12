import * as THREE from 'three';
import { liftCoef, SPEC } from './flight.js';

const IAS_LIMIT = 228; // m/s indicated (~443 kt)
const MACH_LIMIT = 3.25;
// Angle-of-attack envelope (rad). The chine vortex keeps lift growing to ~27 deg, but the elevons lose bite and buffet is heavy well before
// that, and the approach AOA at 180 kt is ~13 deg. Protection starts at aOn (stop climbing, add thrust, ease the nose down), is full push at
// aMax, and stays latched until the AOA is back under aSafe.
export const PROT = { aOn: 0.23, aMax: 0.31, aSafe: 0.19 };
// 1 g equivalent airspeed (m/s) at the protection AOA: below it the jet cannot hold altitude without exceeding the protected AOA.
export const minSpeedEas = (mass, M) => Math.sqrt(2 * mass * 9.80665 / (1.225 * SPEC.S * Math.max(0.2, liftCoef(PROT.aOn, M))));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((a + 540) % 360) - 180;

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

export class Autopilot {
  constructor() {
    this.on = false;
    this.modes = { alt: true, hdg: true, spd: false, mach: false, nav: false, appr: false, vs: false };
    this.target = { alt: 9144, hdg: 341, spd: 205, mach: 3.2, vsLimit: 30, vs: 0 };
    this.status = { lat: 'HDG', vert: 'ALT', loc: false, gs: false, prot: '', warn: '', recover: false };
    this.stallHold = 0; this.overHold = 0; this.recovering = false; this.recT = 0; this.altErrT = 0;
    this.deI = 0; this.thI = 0.6; this.locI = 0; this.holdVs = null;
    this.kiDiv = null; // elevator integrator time scale override; normally scheduled with speed (see update)
  }
  engage(state) {
    this.on = true;
    this.deI = state.ctrl.de; this.thI = state.throttle;
    this.reset();
  }
  disengage() { this.on = false; this.reset(); }
  // drop approach latches and the PITCH-hold target so nothing stale survives a re-engage or respawn
  reset() {
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
    const { fdm, out, att } = s;
    const V = Math.max(60, out.V), G = 9.80665;
    const nav = s.nav || {};
    const ias = s.ias, M = out.M || 0;

    // ---- protections: stall / minimum speed / overspeed ----
    const alpha = (out.alpha || 0) + 0.2 * (fdm.alphaDot || 0); // lead term: react to a fast-growing AOA before it gets there
    const sev = clamp((alpha - PROT.aOn) / (PROT.aMax - PROT.aOn), 0, 1);
    const vmin = minSpeedEas(fdm.mass || 55000, M);
    const airborne = !fdm.onGround && ias > 25;
    if (sev > 0.02 && airborne) this.stallHold = 2;
    else if (this.stallHold > 0 && (out.alpha || 0) > PROT.aSafe) this.stallHold = Math.max(this.stallHold, 0.5);
    else this.stallHold = Math.max(0, this.stallHold - dt);
    const stallProt = airborne && (this.stallHold > 0 || ias < vmin * 0.97);
    const cit = (out.T ?? 216) * (1 + 0.2 * M * M) - 273.15;
    const overSev = airborne ? Math.max(clamp((ias - (IAS_LIMIT - 10)) / 10, 0, 1), clamp((M - (MACH_LIMIT - 0.05)) / 0.1, 0, 1), clamp((cit - 420) / 12, 0, 1)) : 0;
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
        if (!this.modes.mach) { this.modes.spd = true; this.target.spd = clamp(ias, vmin * 1.25, 200); }
        this.thI = fdm.throttle;
      }
    }

    // vertical: altitude -> flight-path angle -> elevator (PI with pitch-rate damping)
    let vsT;
    // approach mode: localizer captures inside 2.5°, glideslope once within half a degree of the path
    if (this.modes.appr && nav.ilsValid && !rec) {
      if (!this.status.loc && Math.abs(nav.locDev) < 2.5) this.status.loc = true;
      if (this.status.loc && !this.status.gs && Math.abs(nav.gsDev) < 0.5) this.status.gs = true;
    } else { this.status.loc = false; this.status.gs = false; }
    if (rec) vsT = 0;
    else if (this.status.gs) vsT = Math.max(-this.target.vsLimit * 1.5, Math.min(5, nav.gsVs));
    else if (this.modes.vs) vsT = this.target.vs;
    else if (this.modes.alt) {
      const err = this.target.alt - s.alt;
      vsT = clamp(err * 0.06, -this.target.vsLimit, this.target.vsLimit);
    } else { this.holdVs ??= s.vs; vsT = this.holdVs; }
    if (this.status.gs || this.modes.vs || this.modes.alt) this.holdVs = null;
    // speed protection: this delta wing is on the back side of the power curve near the minimum speed, so a climb (or holding the glideslope)
    // that costs airspeed ends in a stall. Fade climbs out between 1.17 and 1.02 x the minimum speed and trade height for speed below it.
    const vLo = vmin * 1.02, vHi = vmin * 1.17;
    if (vsT > 0) vsT *= clamp((ias - vLo) / (vHi - vLo), 0, 1);
    if (ias < vLo) vsT = Math.min(vsT, -(vLo - ias) * 0.6);
    // energy: with a speed mode on, a climb only goes as fast as the speed allows. Climbing at full rate while well below the commanded speed
    // trades all the airspeed for height and ends hanging on the minimum speed (the jet then needs minutes to accelerate), so the climb rate
    // fades out when the speed is more than ~10 % below the climb speed (the target, or ~370 KEAS when a Mach target is set).
    if (vsT > 2 && (this.modes.spd || this.modes.mach) && !this.status.gs) { // small altitude corrections are left alone; only a real climb is scheduled
      const vc = this.modes.mach ? Math.min(IAS_LIMIT * 0.86, 196) : Math.max(this.target.spd, vmin * 1.2);
      vsT = 2 + (vsT - 2) * clamp((ias - vc * 0.9) / (vc * 0.08), -0.3, 1); // below it the jet levels off and then trades a little height for speed
    }
    if (stallProt) vsT = Math.min(vsT, -Math.max(sev, 0.15) * 12); // stop commanding a climb, then trade height for AOA
    // overspeed: allow a gentle zoom climb to bleed energy instead of holding level into the limit
    if (overProt && !stallProt) vsT = Math.max(vsT, overSev * 8);
    // Vertical speed error -> load-factor command (about 5 s time constant, independent of speed) -> elevator through the
    // aircraft's own static gain (out.dePerG = SM * W / (qS * elevator power)), so the loop gain follows q, Mach and CG instead of
    // being tuned for one flight condition. Pitch-rate damping is scaled by elevator power the same way.
    const evs = clamp(vsT - s.vs, -60, 60), kn = out.dePerG ?? 0.1, mde = Math.max(0.05, out.pitchPower ?? 1);
    // fast trim on approach, where the trim must follow the speed changes, slow in fast cruise, where a quick integrator sets up a phugoid
    const kiDiv = this.kiDiv ?? clamp(20 + (V - 130) * (40 / 120), 20, 60);
    const bankAbs = Math.abs(att.bank);
    let recDe = 0;
    // anti-windup: the trim integrator may not wind up a pull while the protection is holding the nose down
    if (rec) { // recovery flies a load-factor command to capture level flight: no V/S trim integrator, the integrator works on the g error
      const gam = Math.asin(clamp(s.vs / V, -1, 1));
      const gamCmd = -0.08 * clamp((vmin * 1.15 - ias) / (vmin * 0.1), 0, 1); // short of the minimum speed, trade height for it
      const nzCmd = bankAbs > 1.05 ? 0 : clamp(Math.cos(gam) + (gamCmd - gam) * V / (G * 4), 0, ias > 190 ? 3 : 2.5);
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
    const bankLim = (M > 1 ? (this.modes.nav ? 35 : 25) : 30) * Math.PI / 180;
    let hdgT = this.modes.hdg ? this.target.hdg : null;
    if (this.modes.nav && nav.lnavHdg != null && !rec) hdgT = nav.lnavHdg;
    // localizer: integral term trims out the crosswind so the jet sits on the centreline
    if (this.status.loc && nav.locHdg != null) { this.locI = clamp((this.locI || 0) - (nav.locXtk || 0) * 0.0005 * dt, -8, 8); hdgT = (nav.locHdg + this.locI + 360) % 360; } else this.locI = 0;
    this.status.lat = rec ? 'WLV' : this.status.loc ? 'LOC' : (this.modes.nav && nav.lnavHdg != null ? 'LNAV' : (this.modes.hdg ? 'HDG' : 'WLV'));
    this.status.vert = rec ? 'RECOVER' : this.status.gs ? 'G/S' : (this.modes.vs ? 'V/S' : (this.modes.alt ? 'ALT' : 'PITCH'));
    this.cmdHdg = hdgT;
    // on the localizer, damp with the heading rate so small corrections don't weave
    const hk = this.status.loc ? 0.06 : 0.03;
    let bankT = hdgT != null && !rec ? clamp(wrap180(hdgT - att.heading) * hk, -1, 1) * (this.status.loc ? Math.min(bankLim, 20 * Math.PI / 180) : bankLim) : 0;
    if (stallProt) bankT *= 1 - sev; // near the stall, wings level first
    const eb = rec ? wrap180(-att.bank * 180 / Math.PI) * Math.PI / 180 : bankT - att.bank;
    const da = clamp(((rec ? 0.9 : 0.5) * eb - 1.2 * fdm.w.x) / Math.max(0.05, out.rollPower ?? 1), -1, 1);
    // positive rudder yaws the nose right, toward air arriving from the right (beta > 0)
    const dr = clamp(1.5 * out.beta, -1, 1);

    // speed: IAS (m/s) or Mach -> throttle. The target never goes below the minimum-speed floor.
    let th = fdm.throttle, thrOverride = false;
    if (this.modes.mach || this.modes.spd) {
      // never chase a target through the 450 KEAS structural / inlet limit (the real climb schedule is 450 KEAS up to M3)
      const tgt = Math.max(this.target.spd, vmin * 1.03);
      const e = Math.min(this.modes.mach ? (this.target.mach - M) * 4 : (tgt - ias) / 40, (IAS_LIMIT - ias) / 20);
      this.thI = clamp(this.thI + 0.3 * e * dt, 0, 1);
      th = clamp(this.thI + 0.8 * e, 0, 1);
    }
    // thrust demand from the protections applies in any mode, whether or not a speed mode is on
    const lowDemand = clamp((vmin * 1.1 - ias) / (vmin * 0.1), 0, 1);
    const need = stallProt ? 1 : (airborne ? lowDemand : 0);
    if (need > 0 && need > th - 0.001) { th = Math.max(th, need); this.thI = Math.max(this.thI, th); thrOverride = true; }
    if (rec) { th = 1; thrOverride = true; }
    if (overProt && !stallProt && !rec) { th = Math.min(th, 1 - overSev); this.thI = Math.min(this.thI, th); thrOverride = true; }

    // ---- status line and cue before a target can no longer be held ----
    this.status.prot = rec ? 'RECOVERING' : stallProt ? 'STALL PROTECT' : overProt ? (cit > 420 ? 'CIT LIMIT' : 'OVERSPEED PROTECT') : '';
    let warn = '';
    const altHold = this.modes.alt && !this.modes.vs && !this.status.gs && !rec;
    if (altHold && airborne && Math.abs(this.target.alt - s.alt) > 150 && Math.abs(s.vs) < 1 && (stallProt || ias < vHi)) warn = 'CANNOT CLIMB — LOW SPEED';
    else if (!rec && !stallProt && airborne && ias < vHi * 1.02 && (this.modes.alt || this.status.gs)) warn = 'SPEED LOW';
    else if (!rec && airborne && this.modes.nav && M > 1 && cit > 410) warn = 'CIT NEAR LIMIT';
    this.status.warn = warn;
    return { de, da, dr, th, thrOverride };
  }
}

// Landing aid: below 150 ft with the gear down, the sink rate is eased toward a flare profile (an exponential: 0.11 per second of height, never gentler
// than 0.6 m/s so the jet does settle onto the runway). The pilot's own pitch input switches it off.
export const AID_AGL = 46;
export const flareSink = (agl) => -Math.max(0.6, 0.11 * agl);
