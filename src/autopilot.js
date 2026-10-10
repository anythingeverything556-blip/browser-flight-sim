import * as THREE from 'three';

const IAS_LIMIT = 228; // m/s indicated (~443 kt)
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
    this.status = { lat: 'HDG', vert: 'ALT', loc: false, gs: false };
    this.deI = 0; this.thI = 0.6; this.locI = 0; this.holdVs = null;
  }
  engage(state) {
    this.on = true;
    this.deI = state.ctrl.de; this.thI = state.throttle;
    this.reset();
  }
  disengage() { this.on = false; this.reset(); }
  // drop approach latches and the PITCH-hold target so nothing stale survives a re-engage or respawn
  reset() { this.status.loc = false; this.status.gs = false; this.locI = 0; this.holdVs = null; }

  // returns control commands; s = { fdm, out, att, vs, alt, ias, nav }
  update(dt, s) {
    const { fdm, out, att } = s;
    const V = Math.max(60, out.V);
    // vertical: altitude -> flight-path angle -> elevator (PI with pitch-rate damping)
    let vsT;
    const nav = s.nav || {};
    // approach mode: localizer captures inside 2.5°, glideslope once within half a degree of the path
    if (this.modes.appr && nav.ilsValid) {
      if (!this.status.loc && Math.abs(nav.locDev) < 2.5) this.status.loc = true;
      if (this.status.loc && !this.status.gs && Math.abs(nav.gsDev) < 0.5) this.status.gs = true;
    } else { this.status.loc = false; this.status.gs = false; }
    if (this.status.gs) vsT = Math.max(-this.target.vsLimit * 1.5, Math.min(5, nav.gsVs));
    else if (this.modes.vs) vsT = this.target.vs;
    else if (this.modes.alt) {
      const err = this.target.alt - s.alt;
      vsT = clamp(err * 0.06, -this.target.vsLimit, this.target.vsLimit);
    } else { this.holdVs ??= s.vs; vsT = this.holdVs; }
    if (this.status.gs || this.modes.vs || this.modes.alt) this.holdVs = null;
    // Vertical speed error -> load-factor command (about 5 s time constant, independent of speed) -> elevator through the
    // aircraft's own static gain (out.dePerG = SM * W / (qS * elevator power)), so the loop gain follows q, Mach and CG instead of
    // being tuned for one flight condition. Pitch-rate damping is scaled by elevator power the same way.
    const G = 9.80665, evs = clamp(vsT - s.vs, -60, 60), kn = out.dePerG ?? 0.1, mde = Math.max(0.05, out.pitchPower ?? 1);
    this.deI = clamp(this.deI + kn * evs / (G * 60) * dt, -0.8, 0.8);
    // tighter V/S loop on the glideslope (2.5 s) than for altitude changes (5 s)
    const tau = this.status.gs ? 2.5 : 5;
    const de = clamp(this.deI + kn * clamp(evs / (tau * G), -1, 1) - 0.3 / mde * fdm.w.z, -1, 1);

    // lateral: heading -> bank -> aileron
    const bankLim = (out.M > 1 ? (this.modes.nav ? 35 : 25) : 30) * Math.PI / 180;
    let hdgT = this.modes.hdg ? this.target.hdg : null;
    if (this.modes.nav && nav.lnavHdg != null) hdgT = nav.lnavHdg;
    // localizer: integral term trims out the crosswind so the jet sits on the centreline
    if (this.status.loc && nav.locHdg != null) { this.locI = clamp((this.locI || 0) - (nav.locXtk || 0) * 0.0005 * dt, -8, 8); hdgT = (nav.locHdg + this.locI + 360) % 360; } else this.locI = 0;
    this.status.lat = this.status.loc ? 'LOC' : (this.modes.nav && nav.lnavHdg != null ? 'LNAV' : (this.modes.hdg ? 'HDG' : 'WLV'));
    this.status.vert = this.status.gs ? 'G/S' : (this.modes.vs ? 'V/S' : (this.modes.alt ? 'ALT' : 'PITCH'));
    this.cmdHdg = hdgT;
    // on the localizer, damp with the heading rate so small corrections don't weave
    const hk = this.status.loc ? 0.06 : 0.03;
    const bankT = hdgT != null ? clamp(wrap180(hdgT - att.heading) * hk, -1, 1) * (this.status.loc ? Math.min(bankLim, 20 * Math.PI / 180) : bankLim) : 0;
    const eb = bankT - att.bank;
    const da = clamp((0.5 * eb - 1.2 * fdm.w.x) / Math.max(0.05, out.rollPower ?? 1), -1, 1);
    // positive rudder yaws the nose right, toward air arriving from the right (beta > 0)
    const dr = clamp(1.5 * out.beta, -1, 1);

    // speed: IAS (m/s) or Mach -> throttle
    let th = fdm.throttle;
    if (this.modes.mach || this.modes.spd) {
      // never chase a target through the 450 KEAS structural / inlet limit (the real climb schedule is 450 KEAS up to M3)
      const e = Math.min(this.modes.mach ? (this.target.mach - out.M) * 4 : (this.target.spd - s.ias) / 40, (IAS_LIMIT - s.ias) / 20);
      this.thI = clamp(this.thI + 0.12 * e * dt, 0, 1);
      th = clamp(this.thI + 0.6 * e, 0, 1);
    }
    return { de, da, dr, th };
  }
}
