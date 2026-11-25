import * as THREE from 'three';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';
import { landingLimits, modeOf } from './difficulty.js';
import { FlightModel, lerpTable, smooth, clamp, UP, newEngine, tyre, MU_PEAK, TYRE_B, TYRE_C, KAPPA_PK, V_REG } from './flight.js';

// Airbus A380-842 / FlyByWire A380X visual companion. Indicative browser-game dynamics,
// NOT the MSFS/FlyByWire flight model, avionics or certified Airbus control laws.
// Dimensions/limits: Airbus A380 Aircraft Characteristics (AC), EASA A.110 type data;
// Rolls-Royce Trent 972-84 rated takeoff thrust. Masses reflect a representative -842.
// Aerodynamic derivatives, inertias, ground contacts, spool and trim are engineering
// Frame: metres, +X nose, +Y up, +Z starboard; model origin defined by conversion manifest.
const KT = 1.943844;
export const A380X = {
  S: 845, B: 79.75, C: 12.2, LENGTH: 72.72, HEIGHT: 24.09, AR: 7.53,
  EMPTY: 277000, PAYLOAD: 55000, FUEL_MAX: 243000, FUEL_START: 150000,
  MTOW: 575000, MLW: 394000, MZFW: 369000,
  THRUST0: 341000, VMO: 340, MMO: 0.89,
  VLE: 250, VLO: 250, VLE_EMERG: 280, V_PANEL_MAX: 320,
  NZ_LIMIT: 2.5, NZ_NEG_LIMIT: -1, NZ_FLAP_LIMIT: 2, NZ_FLAP_NEG: 0,
  VS_CLEAN_575: 210, VR_575: 165, V2_575: 178, VREF_575: 170, VMCG: 115,
  CEILING: 13106, CRUISE_ALT: 10668, CRUISE_MS: 250,
  GEAR_UP_TIME: 18, GEAR_DOWN_TIME: 18,
};
// Simplified Airbus lever positions; degrees are visual/physics estimates, not an FCOM schedule.
export const NOTCHES = [
  { name: 'UP', slat: 0, flap: 0, vfe: Infinity },
  { name: 'CONF 1', slat: 20, flap: 8, vfe: 263 },
  { name: 'CONF 2', slat: 23, flap: 17, vfe: 222 },
  { name: 'CONF 3', slat: 23, flap: 26, vfe: 196 },
  { name: 'FULL', slat: 23, flap: 33, vfe: 182 },
];
export const NOTCH_TAKEOFF = 2, NOTCH_APPROACH = 3, NOTCH_LANDING = 4;
const FLAP_RATE = 33 / 22, SLAT_RATE = 23 / 15;
const SPOILER_TIME = 3.5;
const REV_TIME = 1.8;

// Simulation reference CG, ground-relative. Conversion manifest aligns the imported mesh to this origin.
export const A380X_CG = new THREE.Vector3(0, 7.7, 0);
const MAC_LE_X = 0.25 * A380X.C;
const CG_AFT_SHIFT = 0.45;
const B = (x, y, z) => new THREE.Vector3(x - A380X_CG.x, y - A380X_CG.y, z);
// 22 wheels: 2 nose, two 4-wheel wing bogies, two 6-wheel body bogies.
export const A380X_GEAR = [
  { name: 'nose', p: B(24, -0.18, 0), k: 2.8e6, c: 2.9e5, steer: true, brake: false, R: 0.60, J: 95, TB: 0 },
  { name: 'left wing', p: B(-2.5, -0.18, -6.4), k: 6.0e6, c: 6.2e5, steer: false, brake: true, R: 0.70, J: 350, TB: 2.0e5 },
  { name: 'left body', p: B(-6.5, -0.18, -2.8), k: 8.0e6, c: 7.2e5, steer: false, brake: true, R: 0.70, J: 525, TB: 3.0e5 },
  { name: 'right wing', p: B(-2.5, -0.18, 6.4), k: 6.0e6, c: 6.2e5, steer: false, brake: true, R: 0.70, J: 350, TB: 2.0e5 },
  { name: 'right body', p: B(-6.5, -0.18, 2.8), k: 8.0e6, c: 7.2e5, steer: false, brake: true, R: 0.70, J: 525, TB: 3.0e5 },
];
export const A380X_HARD = [
  ['nose', B(32, 5, 0)], ['belly', B(5, 3.5, 0)], ['tail', B(-28, 7, 0)],
  ['left wingtip', B(-13, 8, -39.8)], ['right wingtip', B(-13, 8, 39.8)],
  ['left stabiliser', B(-32, 12, -15)], ['right stabiliser', B(-32, 12, 15)], ['fin', B(-31, 24, 0)],
  ['left outer engine', B(1, 2, -25.5)], ['right outer engine', B(1, 2, 25.5)],
  ['left inner engine', B(8, 2, -14.5)], ['right inner engine', B(8, 2, 14.5)],
];
export const A380X_ENGINES = [B(1, 4, -25.5), B(8, 4, -14.5), B(8, 4, 14.5), B(1, 4, 25.5)];

// ---- controls (B unless noted) ----
const D2R = Math.PI / 180;
const DE_UP = 25 * D2R, DE_DN = 20 * D2R, DA_MAX = 25 * D2R, DR_MAX = 30 * D2R;
export const TRIM_AUTH = 0.6;
const STEER_LO = 60, STEER_HI = 6, STEER_FADE = 20;
const CASTOR_MIN = 0.3, CASTOR_V0 = 10, CASTOR_V1 = 35;

// ---- aerodynamics ----
const FLAP_CL = [[0, 0], [8, 0.22], [17, 0.48], [26, 0.70], [33, 0.88]];
const FLAP_CD = [[0, 0], [8, 0.006], [17, 0.018], [26, 0.035], [33, 0.055]];
const SLAT_CD = [[0, 0], [20, 0.003], [23, 0.005]];
const FLAP_CM = [[0, 0], [8, -0.025], [17, -0.055], [26, -0.085], [33, -0.12]];
const FLAP_CLMAX = [[0, 0], [8, 0.22], [17, 0.48], [26, 0.72], [33, 1.05]];
const SLAT_CLMAX = [[0, 0], [20, 0.30], [23, 0.38]];
export const CL0 = 0.28, CLA = 5.2, CLMAX0 = 1.50, CLQ = 7, CL_DE = 0.30, CD0 = 0.020, K_IND = 0.043;
const CM0 = 0.04, CMA = -1.20, CMQ = -26, CMAD = -7, CM_DE = 1.22;
const GEAR_CD = 0.015, SPOIL_CD = 0.05, ENG_OUT_CD = 0.004, WAVE_M0 = 0.86, WAVE_K = 4;
const CY_B = -0.55, CY_DR = -0.16, CL_B = -0.10, CL_P = -0.58, CL_R = 0.15, CL_DA = 0.065, CL_DR = 0.012;
const CN_B = 0.15, CN_P = -0.04, CN_R = -0.20, CN_DA = -0.012, CN_DR = 0.11;
const SPOILER_DLIFT_GND = 0.45, SPOILER_DLIFT_AIR = 0.18;
const pgFac = (M) => 1 / Math.sqrt(1 - Math.min(0.9 * M, 0.55) ** 2);
const clmaxAt = (flapDeg, slatDeg, M, mx = 1) => (CLMAX0 + lerpTable(FLAP_CLMAX, flapDeg) + lerpTable(SLAT_CLMAX, slatDeg)) * mx * (1 - 0.5 * Math.max(0, M - 0.35));

// Lift coefficient with a gentle stall: linear to CLmax, then a drop over 7 degrees blending into flat-plate lift.
export function a380xLift(alpha, flapDeg, slatDeg, M = 0, mx = 1, drop = 0.22) {
  const cla = CLA * pgFac(M), cl0 = CL0 + lerpTable(FLAP_CL, flapDeg), clmax = clmaxAt(flapDeg, slatDeg, M, mx), as = (clmax - cl0) / cla, an = (-0.9 - cl0) / cla;
  const lin = cl0 + cla * alpha, plate = 1.05 * Math.sin(2 * alpha);
  if (alpha > as) { const t = smooth(as, as + 0.12, alpha); return (clmax * (1 - drop * t)) * (1 - smooth(0.45, 0.8, alpha)) + plate * smooth(0.45, 0.8, alpha); }
  if (alpha < an) { const t = smooth(an, an - 0.14, alpha); return -0.9 * (1 - 0.3 * t) * (1 - smooth(-0.45, -0.8, alpha)) + plate * smooth(-0.45, -0.8, alpha); }
  return lin;
}
export const stallAlpha = (flapDeg, slatDeg, M = 0, mx = 1) => (clmaxAt(flapDeg, slatDeg, M, mx) - CL0 - lerpTable(FLAP_CL, flapDeg)) / (CLA * pgFac(M));
export const zeroLiftAlpha = (flapDeg, M = 0) => -(CL0 + lerpTable(FLAP_CL, flapDeg)) / (CLA * pgFac(M));

// Take-off thrust 156.9 kN per engine static (16,000 kgf, A). The lever sets the spool state `dry` (N1 30 % idle .. 100 % take-off); thrust follows the
export const ratingAt = (iasKt) => 1 - 0.05 * smooth(180, 280, iasKt);
export const thrustMax = (rho, M, iasKt = 0) => A380X.THRUST0 * (rho / 1.225) ** 0.78 * (1 - 0.12 * M - 0.12 * M * M) * ratingAt(iasKt);
const THR_FRAC = [[0, 0.035], [0.2, 0.075], [0.4, 0.18], [0.6, 0.36], [0.8, 0.62], [0.9, 0.80], [1, 1]];
export const thrustFrac = (dry) => lerpTable(THR_FRAC, dry);
const REV_PEAK = 105000;
const REV_ENGINES_REAL = [1, 2];
const SFC = (M) => 0.30 + (0.54 - 0.30) * Math.min(1, M / 0.8);
const FF_IDLE = 850 / 3600;
const SPOOL_TAU = 2.0, SPOOL_UP = 0.14, SPOOL_DN = 0.4;
const N1_IDLE = 22, N2_IDLE = 58, EGT_IDLE = 380, EGT_TO = 900;
const REV_SPEED_OFF = 14;

// ---- difficulty: one row of multipliers per mode; realistic = the researched values above, the others are guesses that each step easier ----
// damp: roll/pitch/yaw damping; stab: static stability; ctrl: control power; clmax: CLmax multiplier (lower stall speed); stallDrop: lift lost past the
// stall; wingDrop: how much a stalled wing rolls off; spool: engine response; thrust: thrust; brake: brake torque; reverse: reverse thrust;
// revEngines: engines with a reverser; autoSpoilers: ground spoilers deploy on touchdown; autoRev: the lever is not needed for reverse power, and the
// reverser stows itself at walking speed; flapRate / gearTime: transit speed-up; vlim: flap and gear limit speeds; struct: structure margin; protect: easy-mode envelope guard.
export const A380X_MODES = {
  realistic: { damp: 1, stab: 1, ctrl: 1, clmax: 1, stallDrop: 0.22, wingDrop: 1, spool: 1, thrust: 1, brake: 1, reverse: 1, revEngines: REV_ENGINES_REAL, autoSpoilers: false, autoRev: false, flapRate: 1, gearTime: 1, vlim: 1, struct: 1 },
  medium: { damp: 1.3, stab: 1.12, ctrl: 1.15, clmax: 1.04, stallDrop: 0.12, wingDrop: 0.5, spool: 1.4, thrust: 1.03, brake: 1.25, reverse: 1.8, revEngines: REV_ENGINES_REAL, autoSpoilers: true, autoRev: false, flapRate: 2, gearTime: 0.75, vlim: 1.08, struct: 1.25 },
  easy: { damp: 1.7, stab: 1.25, ctrl: 1.3, clmax: 1.09, stallDrop: 0.04, wingDrop: 0, spool: 2, thrust: 1.06, brake: 1.6, reverse: 3, revEngines: REV_ENGINES_REAL, autoSpoilers: true, autoRev: true, flapRate: 3, gearTime: 0.6, vlim: 1.18, struct: 1.5, protect: true },
};

const IXX_575 = 110e6, IYY_575 = 180e6, IZZ_575 = 145e6;

// speed limit (kt IAS) for the surfaces as they are now; NOTCHES[n].vfe is the limit of a selected notch
export const vfeFor = (flapDeg, slatDeg) => flapDeg > 27 ? 182 : flapDeg > 18 ? 196 : flapDeg > 9 ? 222 : flapDeg > 1 || slatDeg > 1 ? 263 : Infinity;
const ENG_OUT_DRAG = (rho, V) => ENG_OUT_CD * 0.5 * rho * V * V * A380X.S;

const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const V3 = () => new THREE.Vector3();
const _air = V3(), _vb = V3(), _d = V3(), _lift = V3(), _side = V3(), _fa = V3(), _mb = V3(), _F = V3(), _T = V3(), _w = V3(), _fwd = V3(), _r = V3(), _vp = V3(),
  _fh = V3(), _right = V3(), _Fg = V3(), _rc = V3(), _I = V3(), _Iw = V3(), _gyro = V3(), _w2 = V3(), _t = V3(), _cg = V3();
const _mp = { m: 0, cgx: 0, Ix: 0, Iy: 0, Iz: 0 };
const NG = A380X_GEAR.length, NE = 4;

export class A380XModel extends FlightModel {
  constructor() {
    super();
    this.type = 'a380x';
    this.mode = 'medium'; this.mx = A380X_MODES.medium;
    this.land = landingLimits('a380x', 'medium');
    this.fuel = A380X.FUEL_MAX; this.cgx = A380X_CG.x; this.payload = A380X.PAYLOAD;
    this.flaps = 0; this.slats = 0; this.flapCmd = 0;
    this.spoilers = 0; this.spoilerCmd = false; this.rollSpoil = { l: 0, r: 0 };
    this.reverserCmd = false; this.rpm = 0;
    this.engines = Array.from({ length: NE }, () => this.newEng());
    this.sasOn = true; this.antiSkid = true;
    this.contacts = new Array(NG).fill(0); this.compress = new Array(NG).fill(0); this.wheel = new Array(NG).fill(0); this.brakePress = new Array(NG).fill(0);
    this.tailGearCmd = false; this.tailGearPos = 0; this.tailContact = 0; this.tailWheel = 0;
    this.gearOverspeed = false; this.noTrim = false; this.pushing = false; this.nosteer = 0;
    this.surfN = { el: 0, ail: 0, rud: 0 };
  }
  newEng() { const e = newEngine(); Object.assign(e, { n1: 0, n2: 0, itt: 15, egt: 15, rpm: 0, lit: true, fail: false, spin: 1, rev: 0, revPow: 0, ffLbh: 0 }); return e; }
  setTailGear() { return false; }
  get magnetos() { return this.engines.some((e) => !e.fail); }
  set magnetos(v) { for (const e of this.engines) e.fail = !v; }
  get mass() { return A380X.EMPTY + this.payload + this.fuel; }
  setMode(mode) { this.mode = modeOf(mode); this.mx = A380X_MODES[this.mode]; this.land = landingLimits('a380x', this.mode); }
  failEngine(i, fail = true) { if (this.engines[i]) this.engines[i].fail = !!fail; }
  massProps() {
    const m = A380X.EMPTY + this.payload + this.fuel, s = m / 575000;
    _mp.m = m; _mp.cgx = A380X_CG.x - CG_AFT_SHIFT * (1 - clamp(this.fuel / A380X.FUEL_MAX, 0, 1));
    _mp.Ix = IXX_575 * s; _mp.Iy = IYY_575 * s; _mp.Iz = IZZ_575 * s;
    return _mp;
  }
  scheduleCG() {}
  updateSas(V) {
    const s = this.sas; s.de = 0; s.da = 0;
    if (!this.sasOn || this.onGround || V < 60) { s.dr = 0; return; }
    s.dr = clamp(60 / V * this.w.y * 0.9, -0.3, 0.3);
  }
  setFlaps(notch) { this.flapCmd = clamp(Math.round(notch), 0, NOTCHES.length - 1); }
  // gear lever: up is refused while the wheels carry weight; returns whether the command was accepted
  setGear(down) {
    if (!down && this.weightOnWheels()) return false;
    this.gearDown = !!down; return true;
  }
  setSpoilers(on) { this.spoilerCmd = !!on; return true; }
  // thrust reverser lever: only with weight on the wheels; returns whether it was accepted
  setReverser(on) {
    if (on && !this.weightOnWheels()) return false;
    this.reverserCmd = !!on; return true;
  }
  weightOnWheels() { let s = 0; for (let i = 0; i < NG; i++) s += this.contacts[i]; return s > 0.1 * this.mass * gravityAt(this.pos ? this.pos.y : 0); }
  nrev() { return this.engines.reduce((n, e) => n + (e.rev > 0.9 ? 1 : 0), 0); }

  // steady-state engines for a lever setting (reset / trim)
  setEngines(th) {
    this.throttle = th;
    const fuelOk = this.fuel > 0 || this.unlimitedFuel;
    for (const e of this.engines) {
      e.lit = fuelOk && !e.fail; e.spin = e.lit ? 1 : 0.12; e.rev = 0; e.revPow = 0;
      e.dry = e.lit ? clamp(th, 0, 1) : 0; e.ab = 0; e.abLit = false; e.unstart = 0;
      this.engineGauges(e, isa(this.pos ? this.pos.y : 0), true);
    }
    this.spool = th;
  }
  engineGauges(e, atm, snap, dt = 0) {
    const n1 = e.lit ? N1_IDLE + (100 - N1_IDLE) * e.dry : 30 * e.spin, n2 = e.lit ? N2_IDLE + (100 - N2_IDLE) * e.dry : 60 * e.spin;
    const egtT = e.lit ? EGT_IDLE + (EGT_TO - EGT_IDLE) * e.dry ** 1.3 : atm.T - 273.15;
    e.n1 = n1; e.n2 = n2; e.egt = snap ? egtT : e.egt + (egtT - e.egt) * Math.min(1, dt / 6); e.itt = e.egt;
    e.rpm = n1;
  }
  // spool, thrust and fuel flow of every engine for this step. Fills this.eThrust[i] (N, + forward, - reverse) and returns their sum.
  updateEngines(dt, atm, M, V, gs) {
    const mx = this.mx, fuelOk = this.fuel > 0 || this.unlimitedFuel, wow = this.onGround;
    const rho = atm.rho, sig = rho / 1.225, tmax = thrustMax(rho, M, V * Math.sqrt(sig) * KT) * mx.thrust;
    if (this.eThrust === undefined) this.eThrust = new Array(NE).fill(0);
    if (this.reverserCmd && !this.weightOnWheels()) this.reverserCmd = false;
    if (this.reverserCmd && mx.autoRev && gs < 8) this.reverserCmd = false;
    let total = 0, ff = 0;
    for (let i = 0; i < NE; i++) {
      const e = this.engines[i], hasRev = mx.revEngines.includes(i);
      e.lit = fuelOk && !e.fail;
      const rcmd = this.reverserCmd && hasRev ? 1 : 0;
      e.rev += clamp(rcmd - e.rev, -dt / REV_TIME, dt / REV_TIME);
      const revOpen = e.rev > 0.9, revBusy = e.rev > 0.02 && !revOpen;
      // lever target: forward power; with the sleeves out it is reverse power (the FADEC holds idle until they are open)
      const own = clamp(this.throttle + ((this.leverTrim && this.leverTrim[i]) || 0), 0, 1);
      const lever = revBusy || (this.reverserCmd && !hasRev) ? 0 : revOpen ? (mx.autoRev ? 0.9 : Math.min(own, 0.9)) : own;
      const target = e.lit ? clamp(lever, 0, 1) : 0;
      e.dry += clamp((target - e.dry) / (SPOOL_TAU / mx.spool), -SPOOL_DN * mx.spool, SPOOL_UP * mx.spool) * dt;
      e.dry = clamp(e.dry, 0, 1);
      e.spin += ((e.lit ? 1 : 0.12) - e.spin) * Math.min(1, dt / 8);
      e.ab = 0; e.abLit = false; e.unstart = 0;
      let T = 0;
      const frac = thrustFrac(e.dry);
      if (e.lit) {
        const fwd = tmax * frac * (1 - smooth(0.05, 0.5, e.rev));
        const rev = REV_PEAK * mx.reverse * frac * (0.4 + 0.6 * Math.min(1, V / 70)) * sig * smooth(0.6, 0.95, e.rev) * smooth(REV_SPEED_OFF - 6, REV_SPEED_OFF, gs);
        T = fwd - rev;
        e.ff = (Math.abs(T) / 9.80665 * SFC(M) / 3600 * (1 + 0.35 * (1 - e.dry)) + FF_IDLE * Math.sqrt(sig) * (1 - 0.7 * e.dry));
      } else { T = -ENG_OUT_DRAG(atm.rho, V); e.ff = 0; }
      e.thrust = T; e.revPow = revOpen ? e.dry : 0; e.ffLbh = e.ff * 3600 * 2.20462;
      this.eThrust[i] = T; total += T; ff += e.ff;
      this.engineGauges(e, atm, false, dt);
    }
    this.rpm = this.engines.reduce((s, e) => s + e.n1, 0) / NE;
    this.spool = this.engines[0].dry;
    this.ffTotal = ff;
    return total;
  }

  reset(pos, headingDeg, speed, onGround, gammaDeg = 0) {
    if (!Number.isFinite(this.fuel) || this.fuel > A380X.FUEL_MAX) this.fuel = A380X.FUEL_MAX;
    const kias = speed * KT;
    const notch = onGround ? 0 : kias < 175 ? NOTCH_LANDING : kias < 195 ? NOTCH_APPROACH : kias < 240 ? 1 : 0;
    this.flapCmd = notch; this.flaps = NOTCHES[notch].flap; this.slats = NOTCHES[notch].slat;
    this.spoilers = 0; this.spoilerCmd = false; this.reverserCmd = false; this.rollSpoil = { l: 0, r: 0 };
    this.engines = Array.from({ length: NE }, () => this.newEng());
    this.noTrim = true;
    super.reset(pos, headingDeg, speed, onGround, gammaDeg);
    this.noTrim = false;
    this.engines = Array.from({ length: NE }, () => this.newEng());
    this.eThrust = new Array(NE).fill(0);
    this.gearDown = onGround || kias < A380X.VLO * 0.85; this.gearPos = this.gearDown ? 1 : 0; this.chute = 'stowed'; this.gearOverspeed = false;
    this.contacts = new Array(NG).fill(0); this.compress = new Array(NG).fill(0); this.brakePress = new Array(NG).fill(0);
    this.wheel = A380X_GEAR.map((g) => (this.gearDown ? speed / g.R : 0));
    this.surfN = { el: 0, ail: 0, rud: 0 };
    if (onGround) this.setEngines(0); else { this.setEngines(0.6); if (speed > 30) this.trimLevel(gammaDeg); }
    this.out.flaps = this.flaps; this.out.slats = this.slats;
  }

  // Straight steady flight along gamma at true airspeed V with the flaps (deg), slats (deg) and gear position given. Pure: moves nothing.
  // Returns alpha, the elevator that zeroes Cm (thrust moment included) and the total thrust that balances drag.
  trimSolve(V, gammaDeg, flapDeg, gearPos, slatDeg = this.slats) {
    const atm = isa(this.pos.y), M = V / atm.a, mp = this.massProps(), g = gammaDeg * D2R, qS = 0.5 * atm.rho * V * V * A380X.S;
    const W = mp.m * (gravityAt(this.pos.y) - V * V * Math.cos(g) ** 2 / (R_EARTH + Math.max(0, this.pos.y))), pg = pgFac(M), mx = this.mx;
    const dCg = (A380X_CG.x - mp.cgx) / A380X.C, fcm = lerpTable(FLAP_CM, flapDeg);
    const cdCfg = CD0 + lerpTable(FLAP_CD, flapDeg) + lerpTable(SLAT_CD, slatDeg) + GEAR_CD * gearPos + WAVE_K * Math.max(0, M - WAVE_M0) ** 2;
    const arm = 3.7;
    let alpha = 0.05, de = 0, T = 0;
    for (let it = 0; it < 14; it++) {
      const need = W * Math.cos(g) / qS;
      let lo = -0.2, hi = stallAlpha(flapDeg, slatDeg, M, mx.clmax) - 0.005;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (a380xLift(mid, flapDeg, slatDeg, M, mx.clmax, mx.stallDrop) - CL_DE * pg * de * mx.ctrl < need) lo = mid; else hi = mid; }
      alpha = (lo + hi) / 2;
      const CD = cdCfg + K_IND * need * need;
      T = Math.max(0, CD * qS + W * Math.sin(g));
      de = clamp(-(CM0 + CMA * mx.stab * pg * alpha + fcm + dCg * need + arm * T / (qS * A380X.C)) / (CM_DE * pg * mx.ctrl), -DE_DN, DE_UP);
    }
    return { alpha, de, T, trim: clamp(de / (de > 0 ? DE_UP : DE_DN) / TRIM_AUTH, -1, 1), M, rho: atm.rho };
  }
  trimLevel(gammaDeg = 0) {
    if (this.noTrim) return;
    const V = this.vel.length(), g = gammaDeg * D2R, s = this.trimSolve(V, gammaDeg, this.flaps, this.gearPos), alpha = s.alpha;
    this.trim = s.trim;
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), alpha + g));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat), side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(fwd).applyAxisAngle(side, -alpha).multiplyScalar(V);
    const tmax = thrustMax(s.rho, s.M, V * Math.sqrt(s.rho / 1.225) * KT) * this.mx.thrust * NE;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (tmax * thrustFrac(mid) < s.T) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2);
  }
  setTakeoffTrim() {
    const rho = isa(this.pos.y).rho, V = 1.05 * this.vSpeed(A380X.V2_575) / KT / Math.sqrt(rho / 1.225);
    this.trim = this.trimSolve(V, 0, NOTCHES[this.flapCmd].flap, 1, NOTCHES[this.flapCmd].slat).trim;
    return this.trim;
  }
  vSpeed(v210) { return v210 * Math.sqrt(this.mass / 575000); }
  vref() { return A380X.VREF_575 * Math.sqrt(this.mass / 575000); }

  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    const { S, B: SPAN, C } = A380X, mx = this.mx;
    _qi.copy(this.quat).invert();
    const air = _air.copy(this.vel).sub(wind), vb = _vb.copy(air).applyQuaternion(_qi), V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y), M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0, beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz); this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - A380X_CG.x, 0, 0);
    const ias = V * Math.sqrt(atm.rho / 1.225), iasKt = ias * KT, gs = this.vel.length();

    // flaps and slats (hydraulic): the lever commands a notch, each surface runs to its own angle
    const nt = NOTCHES[this.flapCmd];
    this.flaps += clamp(nt.flap - this.flaps, -FLAP_RATE * mx.flapRate * dt, FLAP_RATE * mx.flapRate * dt);
    this.slats += clamp(nt.slat - this.slats, -SLAT_RATE * mx.flapRate * dt, SLAT_RATE * mx.flapRate * dt);
    // gear: the squat switch holds it down on the ground; events as in the base model
    if (!this.gearDown && this.gearPos >= 0.98 && this.weightOnWheels()) { this.gearDown = true; this.events.push({ type: 'gear-interlock' }); }
    const gearTarget = this.gearDown ? 1 : 0;
    if (this.gearPos !== gearTarget) {
      const tt = (this.gearDown ? A380X.GEAR_DOWN_TIME : A380X.GEAR_UP_TIME) * mx.gearTime;
      this.gearPos += clamp(gearTarget - this.gearPos, -dt / tt, dt / tt);
      if (this.gearPos === gearTarget) this.events.push('gear-lock');
    }
    const gearOver = this.gearPos > 0.02 && iasKt > A380X.VLE * mx.vlim;
    if (gearOver && !this.gearOverspeed) this.events.push({ type: 'gear-overspeed' });
    this.gearOverspeed = gearOver;

    // spoilers / brake panels: the lever, or automatically on touchdown with the thrust at idle (medium and easy)
    const autoSp = mx.autoSpoilers && this.weightOnWheels() && this.throttle < 0.35 && gs > 25;
    const spCap = iasKt > A380X.V_PANEL_MAX && !this.onGround ? 0.5 : 1;
    const spTarget = (this.spoilerCmd ? spCap : 0) || (autoSp ? 1 : 0);
    const sp0 = this.spoilers;
    this.spoilers += clamp(spTarget - this.spoilers, -dt / SPOILER_TIME, dt / SPOILER_TIME);
    if ((sp0 < 0.5) !== (this.spoilers < 0.5)) this.events.push({ type: this.spoilers >= 0.5 ? 'spoilers-out' : 'spoilers-in' });

    this.updateSas(V);
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.05 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de, 3); this.surf.da = act(this.surf.da, this.ctrl.da, 3); this.surf.dr = act(this.surf.dr, this.ctrl.dr + this.sas.dr, 3);
    const deCmd = clamp(this.surf.de + this.trim * TRIM_AUTH, -1, 1), dEc = deCmd * (deCmd > 0 ? DE_UP : DE_DN), dRc = this.surf.dr * DR_MAX, dA = this.surf.da * DA_MAX;
    const dE = dEc, dR = dRc;
    this.surfN.el = deCmd; this.surfN.ail = this.surf.da; this.surfN.rud = this.surf.dr;
    const rollIn = Math.abs(this.surf.da) < 0.08 ? 0 : (Math.abs(this.surf.da) - 0.08) / 0.92;
    this.rollSpoil.l = this.surf.da < 0 ? rollIn : 0; this.rollSpoil.r = this.surf.da > 0 ? rollIn : 0;

    // ----- engines (thrust at each mount: lateral stations give the yaw moment of an engine failure) -----
    const thrustSum = this.updateEngines(dt, atm, M, V, gs), fuelOk = this.fuel > 0 || this.unlimitedFuel;
    let nOut = 0; for (const e of this.engines) if (!e.lit) nOut++;

    // ground effect (wing about 1.2 m above the CG)
    const hWing = Math.max(0.3, this.pos.y - 0.7 - groundAt(this.pos.x, this.pos.z));
    const r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16);

    // ----- aerodynamics -----
    const Vk = Math.max(V, 20), bv = SPAN / (2 * Vk), cv = C / (2 * Vk), pg = pgFac(M);
    const p = this.w.x, q = this.w.z, r = -this.w.y;
    const flapDeg = this.flaps, slatDeg = this.slats;
    const as = stallAlpha(flapDeg, slatDeg, M, mx.clmax), stall = smooth(as, as + 0.1, alpha);
    const sp = this.spoilers, dLift = (this.onGround ? SPOILER_DLIFT_GND : SPOILER_DLIFT_AIR) * sp;
    const CL = a380xLift(alpha, flapDeg, slatDeg, M, mx.clmax, mx.stallDrop) - CL_DE * pg * dE * mx.ctrl + CLQ * q * cv - dLift;
    const kInd = K_IND;
    const CD = CD0 + lerpTable(FLAP_CD, flapDeg) + lerpTable(SLAT_CD, slatDeg) + GEAR_CD * this.gearPos + SPOIL_CD * sp + WAVE_K * Math.max(0, M - WAVE_M0) ** 2
      + kInd * CL * CL * ge + 0.6 * stall * Math.sin(alpha) ** 2 + 0.25 * Math.abs(Math.sin(beta));
    const bC = clamp(beta, -0.5, 0.5), qS = qbar * S;
    const Cy = CY_B * bC + CY_DR * dR;
    const fa = _fa.set(0, 0, 0);
    if (V > 0.5) {
      const d = _d.copy(vb).divideScalar(V);
      const lift = _lift.set(0, 1, 0).addScaledVector(d, -d.y); if (lift.lengthSq() > 1e-6) lift.normalize();
      const side = _side.set(0, 0, 1).addScaledVector(d, -d.z); if (side.lengthSq() > 1e-6) side.normalize();
      fa.addScaledVector(d, -qS * CD).addScaledVector(lift, qS * CL).addScaledVector(side, qS * Cy);
    }
    const fb = fa; fb.x += thrustSum;
    const mb = _mb.set(0, 0, 0);
    for (let i = 0; i < NE; i++) { const pe = A380X_ENGINES[i], Ti = this.eThrust[i]; mb.y += pe.z * Ti; mb.z -= pe.y * Ti; }
    if (V > 1) {
      const fcm = lerpTable(FLAP_CM, flapDeg);
      const Cm = CM0 + CMA * mx.stab * pg * alpha * (1 - 0.15 * stall) - 0.10 * stall + fcm + mx.damp * (CMQ * q * cv + CMAD * this.alphaDot * cv) + CL * (A380X_CG.x - mp.cgx) / C;
      mb.z += qS * C * (Cm + CM_DE * pg * dE * mx.ctrl);
      // stalled: roll damping fades and yaw rate drives roll (wing drop); easier modes soften both
      const wd = mx.wingDrop;
      const Cl = CL_B * mx.stab * bC + CL_P * mx.damp * (1 - 0.8 * stall * wd) * p * bv + CL_R * (1 + 4 * stall * wd) * r * bv + CL_DA * mx.ctrl * (1 - 0.5 * stall * wd) * dA * (1 + 0.15 * Math.max(0, this.rollSpoil.l + this.rollSpoil.r)) + CL_DR * dR;
      const Cn = CN_B * mx.stab * bC + CN_P * p * bv + CN_R * mx.damp * r * bv + CN_DA * dA + CN_DR * mx.ctrl * dR;
      mb.x += qS * SPAN * Cl;
      mb.y -= qS * SPAN * Cn;
    }

    const F = _F.copy(fb).applyQuaternion(this.quat), T = _T.set(0, 0, 0);
    F.y -= m * grav;
    F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }

    // ----- landing gear: nose unit + four main bogies, strut spring/damper + tyre, brakes with anti-skid, nose wheel steered by the pedals -----
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat), fwd = _fwd.set(1, 0, 0).applyQuaternion(this.quat);
    const dead = this.crashOff;
    for (let i = 0; i < NG; i++) {
      const g = A380X_GEAR[i];
      const rr = _r.copy(g.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z;
      let pen = groundAt(px, pz) - py;
      const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0 || this.gearPos < 0.98) {
        this.wheel[i] *= 1 - (this.gearPos < 0.98 ? 3 : 0.3) * dt;
        this.brakePress[i] = 0; continue;
      }
      onGround = true;
      const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      // touchdown limits follow the flying mode (this.land, see difficulty.js)
      if (!was && vp.y < -this.land.sinkMax) { if (!dead) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
      if (pen > 0.5) {
        if (vp.y < -this.land.sinkBottom) { if (!dead) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
        this.pos.y += pen - 0.15; pen = 0.15;
      }
      const Fn = Math.max(0, g.k * pen - g.c * vp.y);
      this.contacts[i] = Fn; this.compress[i] = Math.min(0.5, pen);
      const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
      // nose wheel: 50 deg at a walk, 7 deg on the take-off roll (a keyboard pedal is all or nothing)
      let steer = 0;
      if (g.steer) { steer = -this.ctrl.dr * (STEER_HI + (STEER_LO - STEER_HI) * clamp(1 - gs / STEER_FADE, 0, 1)); fh.applyAxisAngle(UP, steer * D2R); this.nosteer = steer; }
      const right = _right.crossVectors(fh, UP);
      const vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], tanA = vLat / vref, kap = (om * g.R - vLong) / vref;
      const ty = tyre(kap, tanA, Fn), fx = ty[0];
      let fy = ty[1];
      if (g.steer) fy *= CASTOR_MIN + (1 - CASTOR_MIN) * (1 - smooth(CASTOR_V0, CASTOR_V1, gs));
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * g.R / vref;
      let demand = g.brake ? Math.max(this.brakes, this.parkingBrake ? 0.8 : 0) : 0;
      if (this.antiSkid && !this.parkingBrake && Math.abs(vLong) > 4) demand *= 1 - clamp((-kap - 0.10) / 0.10, 0, 1);
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.15);
      const tqMax = g.TB * mx.brake * this.brakePress[i] + (0.02 + 0.02 * (1 - smooth(0.5, 3, Math.abs(vLong)))) * Fn * g.R, th = Math.tanh(om / 0.2);
      const dom = -dt * (g.R * fx + tqMax * th) / (g.J + dt * g.R * dF + dt * tqMax * (1 - th * th) / 0.2);
      const fxEff = clamp(fx + dF * dom, -MU_PEAK * Fn, MU_PEAK * Fn);
      this.wheel[i] = Math.max(-5, om + dom);
      const Fg = _Fg.set(0, Fn, 0).addScaledVector(fh, fxEff).addScaledVector(right, fy);
      F.add(Fg); T.add(_rc.copy(rr).cross(Fg));
    }
    this.onGround = onGround;

    // ----- integrate -----
    const a = F.multiplyScalar(1 / m);
    this.pos.addScaledVector(this.vel, dt).addScaledVector(a, 0.5 * dt * dt);
    this.vel.addScaledVector(a, dt);
    const tb = T.applyQuaternion(_qi).add(mb);
    const Iw = _Iw.set(I.x * this.w.x, I.y * this.w.y, I.z * this.w.z), gyro = _gyro.crossVectors(this.w, Iw), w0 = _w2.copy(this.w);
    this.w.x += (tb.x - gyro.x) / I.x * dt; this.w.y += (tb.y - gyro.y) / I.y * dt; this.w.z += (tb.z - gyro.z) / I.z * dt;
    const wm = _t.copy(w0).add(this.w).multiplyScalar(0.5), ang = wm.length() * dt;
    if (ang > 1e-9) { _dq.setFromAxisAngle(wm.normalize(), ang); this.quat.multiply(_dq).normalize(); }

    if (!this.unlimitedFuel) this.fuel = Math.max(0, this.fuel - this.ffTotal * dt);

    // hard points: the tail ramp scrapes on over-rotation (minor), everything else is a crash
    if (this.scrapeT) this.scrapeT = Math.max(0, this.scrapeT - dt);
    for (let hi = 0; hi < A380X_HARD.length; hi++) {
      const name = A380X_HARD[hi][0], rr = _r.copy(A380X_HARD[hi][1]).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z, gy = groundAt(px, pz);
      if (py < gy - 0.03) {
        if (onGround && gs < 6 && Math.abs(this.vel.y) < 1) { this.pos.y += gy - py + 0.03; continue; }
        if (name === 'tail' && gs < 100 && this.vel.y > -this.land.scrapeVs) {
          this.pos.y += gy - py + 0.03; if (this.w.z > 0) this.w.z *= 0.2;
          if (!this.scrapeT) this.events.push({ type: 'scrape', part: 'tail' });
          this.scrapeT = 1; continue;
        }
        if (dead) { this.absorb(gy - py + 0.03); continue; }
        this.crash(`${name} hit the ground`); return;
      }
    }

    const nz = fb.y / (m * grav) + (onGround ? this.contacts.reduce((s, c) => s + c, 0) / (m * grav) : 0);
    const nzAero = fb.y / (m * grav);
    // structure: ultimate load factor 1.5 x limit (more in the easier modes); the negative side never below -1 g; or far past VMO
    const flapped = this.flaps > 1, nzUlt = 1.5 * (flapped ? A380X.NZ_FLAP_LIMIT : A380X.NZ_LIMIT) * mx.struct, nzNeg = Math.max(-1, 1.5 * (flapped ? -0.5 : A380X.NZ_NEG_LIMIT) * mx.struct);
    if (!dead && (nzAero > nzUlt || nzAero < nzNeg || iasKt > A380X.VMO * 1.2 * mx.struct)) { this.crash(iasKt > A380X.VMO * 1.2 * mx.struct ? 'airframe failed past VMO' : `airframe overstressed (${nzAero.toFixed(1)} g)`, 'overstress'); return; }
    const z0 = zeroLiftAlpha(this.flaps, M);
    const aoaNorm = clamp((alpha - z0) / (as - z0), 0, 1);
    const vfe = vfeFor(this.flaps, this.slats) * mx.vlim;
    const buffet = 0.6 * smooth(as - 0.05, as + 0.03, alpha) + (onGround ? Math.min(1, gs / 60) * 0.15 : 0) + Math.max(0, iasKt - 300) / 40 * 0.2
      + this.gearPos * Math.max(0, iasKt - A380X.VLE) / 20 * 0.3 + sp * Math.min(1, iasKt / 200) * 0.2;
    const Pde = CM_DE * pg * DE_UP * mx.ctrl;
    const n1m = this.rpm;
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust: thrustSum, nz, nzAero, CL, CD, buffet, ff: this.ffTotal, ias, rpm: n1m, flaps: this.flaps, slats: this.slats,
      cg: (MAC_LE_X - mp.cgx) / C, staticMargin: -CMA * mx.stab / CLA + (mp.cgx - A380X_CG.x) / C, inletStress: 0, stall,
      aoaNorm, shaker: !onGround && aoaNorm > 0.85, pusher: false, n1: n1m, n2: this.engines.reduce((s, e) => s + e.n2, 0) / NE, itt: this.engines.reduce((s, e) => s + e.egt, 0) / NE,
      flapOverspeed: iasKt > vfe, gearOverspeed: gearOver, spoilers: sp, enginesOut: nOut,
      pitchPower: Pde * qS * C / I.z, rollPower: CL_DA * mx.ctrl * DA_MAX * qS * SPAN / I.x, yawPower: CN_DR * mx.ctrl * DR_MAX * qS * SPAN / I.y,
      dePerG: qS > 1 ? Math.min(1.5, Math.max(-CMA * mx.stab / CLA, 0.02) * m * grav / (qS * Pde)) : 1.5, vfe };
  }
}
