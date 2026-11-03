// Automatic take-off: full power, hold the runway heading, rotate at VR to a fixed pitch, raise the gear in the climb and hand over to the
// autopilot's flight-level-change climb. Only the pilot's stick, brakes or the throttle cut-off stop it.
import { attitude } from './autopilot.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((a + 540) % 360) - 180;
export const TO = { vr: 92, pitch: 11, rate: 3, gearAgl: 25, handoffAgl: 120 }; // m/s IAS, deg, deg/s, m, m

export class TakeoffAid {
  constructor() { this.on = false; this.phase = 'off'; }
  start(hdg) { this.on = true; this.phase = 'roll'; this.hdg = hdg; this.thcmd = 0; this.t = 0; this.cmd = 0; this.deI = 0; this.msg = 'TAKE-OFF ROLL'; }
  stop() { const was = this.phase; this.on = false; this.phase = 'off'; return was; }
  // s = { fdm, ias, agl }. Returns { de, dr, th, gearUp, done }.
  update(dt, s) {
    const { fdm } = s, att = attitude(fdm.quat), pp = Math.max(0.3, fdm.out.pitchPower || 1);
    const out = { de: 0, dr: 0, th: 1, gearUp: false, done: false };
    this.t += dt;
    out.dr = clamp(0.05 * wrap180(this.hdg - att.heading) + 0.7 * fdm.w.y, -0.5, 0.5);
    if (this.phase === 'roll') {
      out.de = 0;
      if (s.ias >= TO.vr) { this.phase = 'rotate'; this.cmd = att.pitch * 180 / Math.PI; this.msg = 'ROTATE'; }
    }
    if (this.phase === 'rotate' || this.phase === 'climb') {
      this.cmd = Math.min(TO.pitch, this.cmd + TO.rate * dt);
      // alpha guard: never command more nose-up than the angle of attack allows
      const aMargin = clamp((0.2 - (fdm.out.alpha || 0)) / 0.04, 0, 1);
      const th = (this.cmd * Math.PI / 180) * (this.phase === 'climb' ? aMargin : 1);
      const qCmd = clamp(1.1 * (th - att.pitch), -0.12, 0.12);
      // on the gear the nose has to lift a lot of weight ahead of the mains: a firm bias plus a stiff rate loop; airborne the gentler loop holds the climb
      const k = fdm.onGround ? 6 : 1.4, bias = fdm.onGround ? 0.35 : 0;
      this.deI = clamp(this.deI + 0.12 * (qCmd - fdm.w.z) / pp * dt, -0.5, 0.8);
      out.de = clamp(bias + this.deI + k * (qCmd - fdm.w.z) / pp, -1, 1);
      out.dr = fdm.onGround ? out.dr : clamp(1.5 * (fdm.out.beta || 0), -1, 1);
      if (!fdm.onGround && this.phase === 'rotate') { this.phase = 'climb'; this.msg = 'CLIMB'; }
      if (this.phase === 'climb') {
        if (s.agl > TO.gearAgl && fdm.vel.y > 2) out.gearUp = true;
        if (s.agl > TO.handoffAgl && s.ias > 100 && fdm.vel.y > 3 && !fdm.gearDown) { out.done = true; this.stop(); }
      }
    }
    return out;
  }
}

// Rotation assist for a hand-flown take-off. The stock stick gearing leaves a part-stick pull far too weak to lift the nose off the runway (40 %
// stick was still rolling at 237 m/s), while a full-stick pull over-rotates into a nozzle strike. On the runway and just after lift-off the stick
// therefore commands a pitch attitude (3 deg + 9 deg x stick, never more than 12), and the command blends back to the normal stick by 60 m.
export const RA = { base: 3, span: 9, max: 12, fadeFrom: 30, fadeTo: 60, minIas: 60 };

export class RotationAssist {
  constructor() { this.w = 0; this.deI = 0; this.cmd = 0; }
  reset() { this.w = 0; this.deI = 0; }
  // s = { fdm, axis (-1..1 pitch stick), de (the normal stick's elevator), ias, agl, enabled, dt }. Returns the elevator command.
  apply(s) {
    const { fdm, axis, ias, agl, dt } = s;
    const low = fdm.onGround || agl < RA.fadeTo;
    const want = s.enabled && low && axis > 0.02 && ias > RA.minIas && fdm.vel.y > -1 && !fdm.crashed;
    const fade = fdm.onGround ? 1 : clamp((RA.fadeTo - agl) / (RA.fadeTo - RA.fadeFrom), 0, 1);
    const target = want ? fade : 0;
    this.w += clamp(target - this.w, -2 * dt, 4 * dt);
    if (this.w < 0.001) { this.deI = 0; return s.de; }
    const att = attitude(fdm.quat), pp = Math.max(0.3, fdm.out.pitchPower || 1);
    const cmd = Math.min(RA.max, RA.base + RA.span * clamp(axis, 0, 1)) * Math.PI / 180;
    const aMargin = clamp((0.2 - (fdm.out.alpha || 0)) / 0.04, 0, 1);
    const qCmd = clamp(1.1 * (cmd * (fdm.onGround ? 1 : aMargin) - att.pitch), -0.12, 0.12);
    const k = fdm.onGround ? 6 : 1.4, bias = fdm.onGround ? 0.35 : 0;
    this.deI = clamp(this.deI + 0.12 * (qCmd - fdm.w.z) / pp * dt, -0.5, 0.8);
    const de = clamp(bias + this.deI + k * (qCmd - fdm.w.z) / pp, -1, 1);
    return s.de + (de - s.de) * this.w;
  }
}
