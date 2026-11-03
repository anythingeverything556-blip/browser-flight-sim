import * as THREE from 'three';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';
import { FlightModel, lerpTable, smooth, clamp, UP, newEngine, tyre, MU_PEAK, TYRE_B, TYRE_C, KAPPA_PK, V_REG } from './flight.js';

// Cirrus Vision Jet SF50 (G3, 2026): one Williams FJ33-5A on the aft fuselage, V-tail (no horizontal stabiliser), retractable tricycle gear.
// Published data (G3 brochure, Cirrus AFM / type-certificate figures as quoted by pilot references; ISA, MTOW unless noted):
//   cirrusaircraft.com/aircraft/vision-jet and cirrus.cz/en/our-planes/vision-jet-1: 317 KTAS max cruise, 1,910 ft take-off, 1,622 ft landing ground
//     roll, 6,000 lb MTOW, 2,450 lb useful load, 1,275 nm; learn-atc.com (G2+): VMO 250 KIAS, MMO 0.53, ceiling FL310.
//   zachsimms.com/aviation/msfs-2024/vision-jet (AFM P/N 31452-001 / PIM figures): VFE 190 KIAS (50 %, 15 deg) and 150 KIAS (100 %, 39 deg);
//     VLO/VLE gear extend 210, VLO retract 150; stall 67 KCAS at 6,000 lb full flaps (60 at 4,800 lb); VREF flaps 100 % 89 KIAS at 6,000 lb
//     (85 at 5,500 lb), flaps UP 109; weights 6,040 ramp / 6,000 MTOW / 5,550 MLW / 4,900 MZFW; 296 US gal (2,001 lb) usable; 1,846 lbf take-off
//     thrust; ~400-430 lb/h at FL310; VR ~85-90 KIAS; Vx 91 (flaps 50 %), climb 175-190 KIAS falling to 140 by FL280.
//   brainscape.com/flashcards/sf50-15970177 (pilot study cards): g limits +3.6/-1.44 flaps up, +2/0 flaps 50 % and 100 %; flap angles 15/40 deg.
// Not published, estimated here (marked "est."): basic empty weight, inertias, every aerodynamic coefficient, brake torque, engine lapse and spool.
// Coefficients are per radian on S, c, b. The V-tail pitch/yaw split follows its geometry: 5.0 m2 of panels at 39 deg dihedral give an effective
// 3.0 m2 of horizontal and 2.0 m2 of vertical tail, tail volumes V_h = 0.51 and V_v = 0.045 (est. from the measured 3D model).
export const SF50 = {
  S: 18.18, B: 11.8, C: 1.583, LENGTH: 9.36, HEIGHT: 3.32, AR: 11.8 * 11.8 / 18.18,
  EMPTY: 1815,          // 1,610 kg basic empty (3,550 lb, est.) + 205 kg pilot/payload: full tanks give the 2,722 kg MTOW
  FUEL_MAX: 907,        // 296 US gal usable Jet-A, 2,000 lb
  MTOW: 2722, MLW: 2517, MZFW: 2222, MAX_RAMP: 2740,
  THRUST0: 8210,        // FJ33-5A static sea-level take-off thrust, 1,846 lbf
  VMO: 250, MMO: 0.53, VFE50: 190, VFE100: 150, VFE: 150, VLE: 210, VLO_EXT: 210, VLO_RET: 150, // KIAS (VFE: the most restrictive)
  VS0: 67, VS1: 86,     // KIAS, MTOW, idle (AFM stall table)
  VR: 90, VREF: 89, VX: 91, VY: 170,   // KIAS at MTOW
  NZ_LIMIT: 3.6, NZ_NEG_LIMIT: -1.44, NZ_FLAP_LIMIT: 2.0, // flaps up / flaps extended
  FLAP_NOTCHES: 2,      // max notch for setFlaps(): 0 = UP, 1 = 50 % (take-off), 2 = 100 % (landing)
};
// Model frame (three.js, +x nose, +y up, +z right wing), origin as in the measured model; wheel bottoms at y = 0. CG at 25 % MAC, full fuel.
export const SF50_CG = new THREE.Vector3(1.135, 1.20, 0);
const MAC_LE_X = 1.53;
const B = (x, y, z) => new THREE.Vector3(x - SF50_CG.x, y - SF50_CG.y, z - SF50_CG.z);
// struts: static sink 0.08 m at MTOW (nose 23 % of the weight / 7.8e4, each main 38 % / 1.3e5); damping about half critical
export const SF50_GEAR = [
  { name: 'nose', p: B(3.38, -0.08, 0), k: 7.8e4, c: 7.0e3, steer: true, brake: false, R: 0.18, J: 0.35 },
  { name: 'left', p: B(0.45, -0.08, -1.65), k: 1.3e5, c: 1.2e4, steer: false, brake: true, R: 0.20, J: 0.8 },
  { name: 'right', p: B(0.45, -0.08, 1.65), k: 1.3e5, c: 1.2e4, steer: false, brake: true, R: 0.20, J: 0.8 },
];
export const SF50_HARD = [
  ['nose', B(4.68, 0.99, 0)], ['belly', B(1.48, 0.55, 0)], ['ventral strake', B(-4.02, 1.20, 0)], ['tail cone', B(-4.58, 1.58, 0)],
  ['left wingtip', B(0.45, 1.30, -5.90)], ['right wingtip', B(0.45, 1.30, 5.90)],
  ['left V-tail tip', B(-4.35, 3.32, -2.12)], ['right V-tail tip', B(-4.35, 3.32, 2.12)], ['engine nozzle', B(-2.49, 1.98, 0)],
];
// The FJ33-5A sits 0.78 m above the CG with its exhaust canted up, so the thrust vector points about 10 deg below the body axis and passes only
// ~0.14 m above the CG: power changes barely move the nose (AFM; pilot reports of "little pitch change with power").
const THRUST_ARM = 0.14, THRUST_CANT = 10 * Math.PI / 180;
const THR_COS = Math.cos(THRUST_CANT), THR_SIN = Math.sin(THRUST_CANT);
const D2R = Math.PI / 180;
const DE_UP = 26 * D2R, DE_DN = 20 * D2R, DA_MAX = 18 * D2R, DR_MAX = 16 * D2R; // pitch / roll / yaw command travel at |command| = 1
const PANEL_UP = 30 * D2R, PANEL_DN = 24 * D2R; // one ruddervator panel's travel, pitch and yaw are mixed into it and saturate together
export const TRIM_AUTH = 0.6; // trim wheel at +-1 moves the elevator this share of full travel
export const FLAP_POS = [0, 50, 100];          // % per notch
export const FLAP_DEG = [0, 15, 39];           // actual deflection per notch
const FLAP_RATE = 4.5;                          // deg/s: UP to 100 % in about 9 s
const GEAR_TIME = 6;                            // s for a full retraction or extension (electric-hydraulic, est.)
const STEER_LO = 20, STEER_HI = 2, STEER_FADE = 14; // nose-wheel angle at full pedal (deg): standing still, and from STEER_FADE m/s
const CASTOR_MIN = 0.25, CASTOR_V0 = 8, CASTOR_V1 = 25;
const TB_SF50 = 308; // N m per main wheel at full pedal (est.; fitted so max braking from VREF gives the published 1,622 ft landing ground roll)
const TAIL_SCRAPE_VS = 1.5;

// ---- aerodynamics (est.) ----
// lift / drag / pitch by flap angle (deg): incremental CL, CD and Cm, and CLmax (Fowler flaps)
const FLAP_CL = [[0, 0], [15, 0.34], [39, 0.64]];
const FLAP_CD = [[0, 0], [15, 0.020], [39, 0.065]];
const FLAP_CM = [[0, 0], [15, -0.12], [39, -0.16]]; // 50 % at 150 KIAS drops the nose about 5 deg in 2 s (Aviation Week flight report)
const CLMAX = [[0, 1.24], [15, 1.53], [39, 2.02]]; // AFM stall table, 6,000 lb, idle: 86 KCAS clean, 77 at 50 %, 67 at 100 %
// CL0: lift at zero body angle, i.e. the wing's incidence on the fuselage (0.52 = about 6.5 deg of incidence). Set so the attitudes match the Aviation Week
// flight report (2021): ~5 deg nose-down at 200 kt and ~2 deg nose-down at 150 kt, level and clean, then ~5 deg lower again with 50 % flaps.
// The polar is fitted to the AFM 14.7:1 best glide.
export const CL0 = 0.52, CLA = 4.6, CLQ = 2.8, CL_DE = 0.2, CD0 = 0.0215, K_IND = 0.046;
const CM0 = 0.019, CMA = -1.0, CMQ = -9, CMAD = -3.5, CM_DE = 1.1; // tail volume 0.51, SM ~0.2; CM_DE above the ~0.6 of the panel geometry alone so the nose rotates at VR against the high thrust line
const GEAR_CD = 0.020, WAVE_M0 = 0.52, WAVE_K = 3;
const CY_B = -0.30, CY_DR = -0.11, CL_B = -0.10, CL_P = -0.50, CL_R = 0.09, CL_DA = 0.085, CL_DR = -0.009;
const CN_B = 0.07, CN_P = -0.03, CN_R = -0.12, CN_DA = -0.015, CN_DR = 0.05;
const pgFac = (M) => 1 / Math.sqrt(1 - Math.min(M, 0.6) ** 2); // Prandtl-Glauert on the lift and tail slopes
const clmaxAt = (flapDeg, M) => lerpTable(CLMAX, flapDeg) * (1 - 0.5 * Math.max(0, M - 0.35));

// Lift coefficient with a gentle stall: linear to CLmax, then a ~22 % drop over 7 degrees, blending into flat-plate lift at high alpha.
export function sf50Lift(alpha, flapDeg, M = 0) {
  const cla = CLA * pgFac(M), cl0 = CL0 + lerpTable(FLAP_CL, flapDeg), clmax = clmaxAt(flapDeg, M), as = (clmax - cl0) / cla, an = (-0.9 - cl0) / cla;
  const lin = cl0 + cla * alpha, plate = 1.05 * Math.sin(2 * alpha);
  if (alpha > as) { const t = smooth(as, as + 0.12, alpha); return (clmax * (1 - 0.22 * t)) * (1 - smooth(0.45, 0.8, alpha)) + plate * smooth(0.45, 0.8, alpha); }
  if (alpha < an) { const t = smooth(an, an - 0.14, alpha); return -0.9 * (1 - 0.3 * t) * (1 - smooth(-0.45, -0.8, alpha)) + plate * smooth(-0.45, -0.8, alpha); }
  return lin;
}
export const stallAlpha = (flapDeg, M = 0) => (clmaxAt(flapDeg, M) - CL0 - lerpTable(FLAP_CL, flapDeg)) / (CLA * pgFac(M));
export const zeroLiftAlpha = (flapDeg, M = 0) => -(CL0 + lerpTable(FLAP_CL, flapDeg)) / (CLA * pgFac(M));

// ---- FJ33-5A turbofan (est. lapse, spool and fuel) ----
// Static take-off thrust 8.21 kN. The single lever gives take-off thrust on the runway and the FADEC's max-continuous rating once flying; the MCT
// share, the density lapse and the ram term are fitted together to the AFM MCT tables (6,000 lb, ISA): 1,860 fpm at 177 KIAS at sea level,
// FL100 / FL200 / FL280 in 6 / 13 / 21 min, and 307 KTAS at about 78 gph at FL250.
export const MCT_RATIO = 0.65;
const LAPSE = 0.65, RAM = 0.1;
// take-off rating: the fan's thrust falls with airspeed over the ground roll (ram drag and installation, 0.18 % per knot: 16 % by 90 kt), then the FADEC
// blends to max continuous between 90 and 110 KIAS. Fitted with the wing incidence to the published G3 take-off: rotate at VR 90 to 5 deg, 1,910 ft roll (the model gives ~1,860 ft).
const TO_LAPSE = 0.0018;
export const ratingAt = (iasKt) => { const to = 1 - TO_LAPSE * Math.min(100, Math.max(0, iasKt)); const k = Math.min(1, Math.max(0, (iasKt - 90) / 20)); return to * (1 - k) + MCT_RATIO * k; };
export const thrustMax = (rho, M, iasKt = 0) => SF50.THRUST0 * (rho / 1.225) ** LAPSE * (1 - RAM * M + 0.1 * M * M) * ratingAt(iasKt);
// thrust fraction vs N1-like spool state dry (0 = ground idle, 1 = take-off): idle ~4.5 %, 26 % at half lever
const THR_FRAC = [[0, 0.045], [0.15, 0.07], [0.3, 0.13], [0.5, 0.26], [0.7, 0.46], [0.85, 0.70], [1, 1]];
export const thrustFrac = (dry) => lerpTable(THR_FRAC, dry);
// TSFC lb/lbf/h: ~0.50 static, rising with Mach to ~0.74 at M 0.54 (~500 lb/h at FL280 max cruise, ~430 at FL310)
const tsfc = (M) => 0.50 + 0.45 * M;
const LBH = 0.45359237 / 3600; // kg/s per lb/h
const FF_IDLE = 55; // lb/h burned by the core in ground idle at sea level (scales with air density)
const SPOOL_TAU = 1.3, SPOOL_UP = 0.2, SPOOL_DN = 0.5; // s, and 1/s rate limits: idle to take-off thrust in ~6 s

const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const V3 = () => new THREE.Vector3();
const _air = V3(), _vb = V3(), _d = V3(), _lift = V3(), _side = V3(), _fa = V3(), _mb = V3(), _F = V3(), _T = V3(), _w = V3(), _fwd = V3(), _r = V3(), _vp = V3(),
  _fh = V3(), _right = V3(), _Fg = V3(), _rc = V3(), _I = V3(), _Iw = V3(), _gyro = V3(), _w2 = V3(), _t = V3(), _cg = V3();
const _mp = { m: 0, cgx: 0, Ix: 0, Iy: 0, Iz: 0 };

export class SF50Model extends FlightModel {
  constructor() {
    super();
    this.type = 'sf50';
    this.fuel = SF50.FUEL_MAX; this.cgx = SF50_CG.x;
    this.flaps = 0; this.flapCmd = 0; // actual degrees (FLAP_DEG), commanded notch 0..2
    this.engineOn = true; this.rpm = 0; // rpm mirrors N1 (%)
    const e = newEngine(); e.n1 = 0; e.n2 = 0; e.itt = 15; e.rpm = 0; e.lit = true; e.spin = 1; this.engines = [e, e]; // one engine; two references so engines[0..1] agree
    this.sasOn = true; this.antiSkid = true; // SAS = the yaw damper
    this.wheel = [0, 0, 0];
    this.vtail = { l: 0, r: 0 }; // ruddervator panels, -1..1 of their travel (+ = trailing edge up)
    this.tailGearCmd = false; this.tailGearPos = 0; this.tailContact = 0; this.tailWheel = 0; // no tail wheel; kept so shared code that reads them works
    this.gearOverspeed = false; this.noTrim = false;
  }
  setTailGear() { return false; }
  // the C172 calls this switch "magnetos"; here it is the fuel shut-off / engine master
  get magnetos() { return this.engineOn; }
  set magnetos(v) { this.engineOn = !!v; }
  get mass() { return SF50.EMPTY + this.fuel; }
  massProps() {
    const m = SF50.EMPTY + this.fuel;
    // wet-wing fuel sits a little aft of the CG: burning it moves the CG forward (about 5 % MAC from full to empty)
    _mp.m = m; _mp.cgx = SF50_CG.x + 0.08 * (1 - this.fuel / SF50.FUEL_MAX);
    _mp.Ix = 2900 + 0.9 * this.fuel; _mp.Iy = 8000 + 2.4 * this.fuel; _mp.Iz = 6500 + 2.2 * this.fuel;
    return _mp;
  }
  scheduleCG() {}
  // yaw damper (the only SAS axis): rudder against yaw rate, gain scaled with 1/V so the added damping is constant; off on the ground
  updateSas(V) {
    const s = this.sas; s.de = 0; s.da = 0;
    if (!this.sasOn || this.onGround || V < 35) { s.dr = 0; return; }
    s.dr = clamp(42 / V * this.w.y * 0.6, -0.25, 0.25);
  }
  setFlaps(notch) { this.flapCmd = clamp(Math.round(notch), 0, SF50.FLAP_NOTCHES); }
  // gear lever: false (up) is refused while the main wheels carry weight; returns whether the command was accepted
  setGear(down) {
    if (!down && this.weightOnWheels()) return false;
    this.gearDown = !!down; return true;
  }
  weightOnWheels() { return this.contacts[0] + this.contacts[1] + this.contacts[2] > 0.1 * this.mass * gravityAt(this.pos ? this.pos.y : 0); }

  // steady-state engine state for a thrust-lever setting (reset / trim)
  setEngines(th) {
    this.throttle = th;
    const e = this.engines[0], fuelOk = this.fuel > 0 || this.unlimitedFuel;
    e.lit = fuelOk && this.engineOn; e.spin = e.lit ? 1 : 0.12;
    e.dry = e.lit ? clamp(th, 0, 1) : 0; e.ab = 0; e.abLit = false; e.unstart = 0;
    this.spool = th; this.engineGauges(e, isa(this.pos ? this.pos.y : 0), true);
  }
  engineGauges(e, atm, snap, dt = 0) {
    const n1 = e.lit ? 32 + 68 * e.dry : 32 * e.spin, n2 = e.lit ? 62 + 38 * e.dry : 62 * e.spin;
    const ittT = e.lit ? 400 + 430 * e.dry ** 1.3 : atm.T - 273.15;
    e.n1 = n1; e.n2 = n2; e.itt = snap ? ittT : e.itt + (ittT - e.itt) * Math.min(1, dt / 6);
    e.rpm = n1; this.rpm = n1;
  }
  // spool, thrust and fuel flow for this step; returns thrust (N). The FADEC maps the lever onto thrust: lever 0 idle ... 1 take-off.
  updateEngines(dt, atm, M, iasKt = 0) {
    const e = this.engines[0], fuelOk = this.fuel > 0 || this.unlimitedFuel;
    e.lit = fuelOk && this.engineOn;
    const target = e.lit ? clamp(this.throttle, 0, 1) : 0;
    e.dry += clamp((target - e.dry) / SPOOL_TAU, -SPOOL_DN, SPOOL_UP) * dt;
    e.dry = clamp(e.dry, 0, 1);
    e.spin += ((e.lit ? 1 : 0.12) - e.spin) * Math.min(1, dt / 8);
    e.ab = 0; e.abLit = false; e.unstart = 0;
    const thrust = e.lit ? thrustMax(atm.rho, M, iasKt) * thrustFrac(e.dry) : 0;
    e.thrust = thrust;
    const sig = atm.rho / 1.225;
    e.ff = e.lit ? (thrust * 0.2248 * tsfc(M) * (1 + 0.35 * (1 - e.dry)) + FF_IDLE * Math.sqrt(sig) * (1 - 0.7 * e.dry)) * LBH : 0;
    e.ffLbh = e.ff / LBH;
    this.engineGauges(e, atm, false, dt);
    this.spool = e.dry;
    return thrust;
  }

  reset(pos, headingDeg, speed, onGround, gammaDeg = 0) {
    if (!Number.isFinite(this.fuel) || this.fuel > SF50.FUEL_MAX) this.fuel = SF50.FUEL_MAX;
    this.flaps = onGround ? 0 : speed < 55 ? FLAP_DEG[2] : speed < 70 ? FLAP_DEG[1] : 0;
    this.flapCmd = onGround ? 0 : speed < 55 ? 2 : speed < 70 ? 1 : 0;
    const e = newEngine(); this.engines = [e, e];
    // FlightModel.reset would trim before the gear state below is known: trim once, here
    this.noTrim = true;
    super.reset(pos, headingDeg, speed, onGround, gammaDeg);
    this.noTrim = false;
    const e0 = this.engines[0]; e0.n1 = 0; e0.n2 = 0; e0.itt = 15; e0.rpm = 0; e0.lit = true; e0.spin = 1; this.engines[1] = e0;
    this.engineOn = true;
    this.gearDown = onGround || speed < SF50.VLO_RET / 1.943844; this.gearPos = this.gearDown ? 1 : 0; this.chute = 'stowed'; this.gearOverspeed = false;
    this.tailGearCmd = false; this.tailGearPos = 0; this.tailContact = 0; this.tailWheel = 0; this.vtail = { l: 0, r: 0 };
    this.wheel = SF50_GEAR.map((g) => (this.gearDown ? speed / g.R : 0));
    if (onGround) this.setEngines(0); else { this.setEngines(0.6); if (speed > 30) this.trimLevel(gammaDeg); }
    this.out.flaps = this.flaps;
  }

  // straight steady flight along gamma at true airspeed V: alpha for the weight (thrust's share across the path included), ruddervator for Cm = 0
  // (thrust moment included) and the thrust for thrust = drag; flaps (deg) and gear position as given. Pure: moves nothing.
  trimSolve(V, gammaDeg, flapDeg, gearPos) {
    const atm = isa(this.pos.y), M = V / atm.a, mp = this.massProps(), g = gammaDeg * D2R, qS = 0.5 * atm.rho * V * V * SF50.S;
    const W = mp.m * (gravityAt(this.pos.y) - V * V * Math.cos(g) ** 2 / (R_EARTH + Math.max(0, this.pos.y))), pg = pgFac(M);
    const dCg = (SF50_CG.x - mp.cgx) / SF50.C, fcm = lerpTable(FLAP_CM, flapDeg);
    const kInd = K_IND * (1 + 0.15 * flapDeg / 39), cdFlap = lerpTable(FLAP_CD, flapDeg) + GEAR_CD * gearPos + WAVE_K * Math.max(0, M - WAVE_M0) ** 2;
    let alpha = 0.05, de = 0, T = 0;
    for (let it = 0; it < 14; it++) {
      const need = (W * Math.cos(g) - T * Math.sin(alpha - THRUST_CANT)) / qS;
      let lo = -0.2, hi = stallAlpha(flapDeg, M) - 0.005;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (sf50Lift(mid, flapDeg, M) - CL_DE * pg * de < need) lo = mid; else hi = mid; }
      alpha = (lo + hi) / 2;
      const CD = CD0 + cdFlap + kInd * need * need;
      T = Math.max(0, (CD * qS + W * Math.sin(g)) / Math.cos(alpha - THRUST_CANT));
      de = clamp(-(CM0 + CMA * pg * alpha + fcm + dCg * need - THRUST_ARM * T / (qS * SF50.C)) / (CM_DE * pg), -DE_DN, DE_UP);
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
    const tmax = thrustMax(s.rho, s.M, V * Math.sqrt(s.rho / 1.225) * 1.943844);
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (tmax * thrustFrac(mid) < s.T) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2);
  }
  // the take-off band: trim for the initial climb (1.15 VR) with the flaps where they are, so rotation at VR is a light pull and the climb-out
  // holds its speed hands-off (trimming for VR itself left the jet slow and nose-high once the flaps came up)
  setTakeoffTrim() {
    const rho = isa(this.pos.y).rho, V = 1.15 * SF50.VR / 1.943844 / Math.sqrt(rho / 1.225);
    this.trim = this.trimSolve(V, 0, FLAP_DEG[this.flapCmd] ?? this.flaps, 1).trim;
    return this.trim;
  }

  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    const { S, B: SPAN, C } = SF50;
    _qi.copy(this.quat).invert();
    const air = _air.copy(this.vel).sub(wind), vb = _vb.copy(air).applyQuaternion(_qi), V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y), M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0, beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz); this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - SF50_CG.x, 0, 0);
    const ias = V * Math.sqrt(atm.rho / 1.225), iasKt = ias * 1.943844;

    // flaps: electric, UP to 100 % in about 9 s
    this.flaps += clamp((FLAP_DEG[this.flapCmd] || 0) - this.flaps, -FLAP_RATE * dt, FLAP_RATE * dt);
    // gear: the squat switch holds it down while the wheels carry weight (a lever left up on touchdown is refused); events as in the base model
    if (!this.gearDown && this.gearPos >= 0.98 && this.weightOnWheels()) { this.gearDown = true; this.events.push({ type: 'gear-interlock' }); }
    const gearTarget = this.gearDown ? 1 : 0;
    if (this.gearPos !== gearTarget) {
      this.gearPos += clamp(gearTarget - this.gearPos, -dt / GEAR_TIME, dt / GEAR_TIME);
      if (this.gearPos === gearTarget) this.events.push('gear-lock');
    }
    const gearOver = this.gearPos > 0.02 && iasKt > SF50.VLE;
    if (gearOver && !this.gearOverspeed) this.events.push({ type: 'gear-overspeed' });
    this.gearOverspeed = gearOver;

    // controls: cable-driven, quick; the V-tail mixes pitch (elevator, with trim) and yaw (rudder pedals + yaw damper) into the two ruddervators
    this.updateSas(V);
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.03 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de, 4); this.surf.da = act(this.surf.da, this.ctrl.da, 4); this.surf.dr = act(this.surf.dr, this.ctrl.dr + this.sas.dr, 4);
    // stick pusher: past the wing's stall angle in the air it overpowers the pilot's pull and drives the elevator nose-down until the angle of attack comes back
    const asNow = stallAlpha(this.flaps, M), push = this.onGround ? 0 : clamp((alpha + 0.15 * this.alphaDot - asNow) / 0.03, 0, 1); // leads a fast pull by its alpha rate
    this.pushing = push > 0;
    const deCmd = clamp(this.surf.de + this.trim * TRIM_AUTH, -1, 1) * (1 - push) - 0.5 * push, dEc = deCmd * (deCmd > 0 ? DE_UP : DE_DN), dRc = this.surf.dr * DR_MAX, dA = this.surf.da * DA_MAX;
    const pl = clamp(dEc + dRc, -PANEL_DN, PANEL_UP), pr = clamp(dEc - dRc, -PANEL_DN, PANEL_UP);
    const dE = (pl + pr) / 2, dR = (pl - pr) / 2; // effective elevator (rad, + = nose up) and rudder (+ = nose right)
    this.vtail.l = pl / (pl > 0 ? PANEL_UP : PANEL_DN); this.vtail.r = pr / (pr > 0 ? PANEL_UP : PANEL_DN);

    // ----- engine -----
    const thrust = this.updateEngines(dt, atm, M, iasKt), e = this.engines[0], fuelOk = this.fuel > 0 || this.unlimitedFuel;

    // ground effect (wing root 0.37 m below the CG)
    const hWing = Math.max(0.3, this.pos.y - 0.37 - groundAt(this.pos.x, this.pos.z));
    const r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16);

    // ----- aerodynamics -----
    const Vk = Math.max(V, 15), bv = SPAN / (2 * Vk), cv = C / (2 * Vk), pg = pgFac(M);
    const p = this.w.x, q = this.w.z, r = -this.w.y;
    const as = stallAlpha(this.flaps, M), stall = smooth(as, as + 0.1, alpha);
    const CL = sf50Lift(alpha, this.flaps, M) - CL_DE * pg * dE + CLQ * q * cv;
    const kInd = K_IND * (1 + 0.15 * this.flaps / 39);
    const CD = CD0 + lerpTable(FLAP_CD, this.flaps) + GEAR_CD * this.gearPos + WAVE_K * Math.max(0, M - WAVE_M0) ** 2 + (e.lit ? 0 : 0.004)
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
    const fb = fa; fb.x += thrust * THR_COS; fb.y -= thrust * THR_SIN;
    const mb = _mb.set(0, 0, 0);
    mb.z -= THRUST_ARM * thrust; // thrust line just above the CG: a little nose-down with power
    if (V > 1) {
      const Cm = CM0 + CMA * pg * alpha * (1 - 0.15 * stall) - 0.10 * stall + lerpTable(FLAP_CM, this.flaps) + CMQ * q * cv + CMAD * this.alphaDot * cv
        - 0.04 * (1 - ge) + CL * (SF50_CG.x - mp.cgx) / C;
      mb.z += qS * C * (Cm + CM_DE * pg * dE);
      // stalled: roll damping fades and yaw rate drives roll (wing drop)
      const Cl = CL_B * bC + CL_P * (1 - 0.8 * stall) * p * bv + CL_R * (1 + 4 * stall) * r * bv + CL_DA * (1 - 0.5 * stall) * dA + CL_DR * dR;
      const Cn = CN_B * bC + CN_P * p * bv + CN_R * r * bv + CN_DA * dA + CN_DR * dR;
      mb.x += qS * SPAN * Cl;
      mb.y -= qS * SPAN * Cn;
    }

    const F = _F.copy(fb).applyQuaternion(this.quat), T = _T.set(0, 0, 0);
    F.y -= m * grav;
    F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }

    // ----- landing gear: retractable tricycle, strut spring/damper + tyre, toe brakes with anti-skid, nose wheel steered by the rudder pedals -----
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat), fwd = _fwd.set(1, 0, 0).applyQuaternion(this.quat), gs = this.vel.length();
    for (let i = 0; i < SF50_GEAR.length; i++) {
      const g = SF50_GEAR[i];
      const rr = _r.copy(g.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z;
      let pen = groundAt(px, pz) - py;
      const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0 || this.gearPos < 0.98) {
        this.wheel[i] *= 1 - (this.gearPos < 0.98 ? 3 : 0.3) * dt; // braked on retraction, windmilling otherwise
        this.brakePress[i] = 0; continue;
      }
      onGround = true;
      const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      if (!was && vp.y < -4.5) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
      if (pen > 0.35) {
        if (vp.y < -3) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
        this.pos.y += pen - 0.1; pen = 0.1;
      }
      const Fn = Math.max(0, g.k * pen - g.c * vp.y);
      this.contacts[i] = Fn; this.compress[i] = Math.min(0.25, pen);
      const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
      // nose wheel: steered by the pedals, 20 deg at a walk, 2 deg from ~14 m/s (a keyboard pedal is all or nothing)
      if (g.steer) fh.applyAxisAngle(UP, -this.ctrl.dr * (STEER_HI + (STEER_LO - STEER_HI) * clamp(1 - gs / STEER_FADE, 0, 1)) * D2R);
      const right = _right.crossVectors(fh, UP);
      const vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], tanA = vLat / vref, kap = (om * g.R - vLong) / vref;
      const ty = tyre(kap, tanA, Fn), fx = ty[0];
      let fy = ty[1];
      if (g.steer) fy *= CASTOR_MIN + (1 - CASTOR_MIN) * (1 - smooth(CASTOR_V0, CASTOR_V1, gs));
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * g.R / vref;
      let demand = g.brake ? Math.max(this.brakes, this.parkingBrake ? 1 : 0) : 0;
      if (this.antiSkid && !this.parkingBrake && Math.abs(vLong) > 4) demand *= 1 - clamp((-kap - 0.10) / 0.10, 0, 1);
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.1);
      const tqMax = TB_SF50 * (this.parkingBrake ? 3.5 : 1) * this.brakePress[i] + (0.02 + 0.02 * (1 - smooth(0.5, 3, Math.abs(vLong)))) * Fn * g.R, th = Math.tanh(om / 0.2);
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

    const ff = e.ff;
    if (!this.unlimitedFuel) this.fuel = Math.max(0, this.fuel - ff * dt);

    // hard points
    if (this.scrapeT) this.scrapeT = Math.max(0, this.scrapeT - dt);
    for (let hi = 0; hi < SF50_HARD.length; hi++) {
      const name = SF50_HARD[hi][0], rr = _r.copy(SF50_HARD[hi][1]).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z, gy = groundAt(px, pz);
      if (py < gy - 0.03) {
        if (onGround && gs < 6 && Math.abs(this.vel.y) < 1) { this.pos.y += gy - py + 0.03; continue; }
        // over-rotation on the runway: the ventral strake scrapes (minor damage), not a crash; a sinking flare onto it still crashes
        if (name === 'ventral strake' && gs < 60 && this.vel.y > -TAIL_SCRAPE_VS) {
          this.pos.y += gy - py + 0.03; if (this.w.z > 0) this.w.z *= 0.2;
          if (!this.scrapeT) this.events.push({ type: 'scrape', part: 'tail' });
          this.scrapeT = 1; continue;
        }
        if (this.crashOff) { this.absorb(gy - py + 0.03); continue; }
        this.crash(`${name} hit the ground`); return;
      }
    }

    const nz = fb.y / (m * grav) + (onGround ? this.contacts.reduce((s, c) => s + c, 0) / (m * grav) : 0);
    // structure: ultimate load factor (1.5 x limit; flaps out +2 / 0 g, so -0.5 g is the floor there), or far past VMO
    const flapped = this.flaps > 1, nzUlt = 1.5 * (flapped ? SF50.NZ_FLAP_LIMIT : SF50.NZ_LIMIT), nzNeg = flapped ? -0.5 : 1.5 * SF50.NZ_NEG_LIMIT;
    if (!this.crashOff && (nz > nzUlt || nz < nzNeg || iasKt > SF50.VMO * 1.2)) { this.crash(iasKt > SF50.VMO * 1.2 ? 'airframe failed past VMO' : `airframe overstressed (${nz.toFixed(1)} g)`, 'overstress'); return; }
    const aoaNorm = clamp((alpha - zeroLiftAlpha(this.flaps, M)) / (as - zeroLiftAlpha(this.flaps, M)), 0, 1);
    const vfe = this.flaps > FLAP_DEG[1] + 1 ? SF50.VFE100 : this.flaps > 1 ? SF50.VFE50 : Infinity;
    const buffet = 0.6 * smooth(as - 0.05, as + 0.03, alpha) + (onGround ? Math.min(1, gs / 40) * 0.2 : 0) + Math.max(0, iasKt - 200) / 60 * 0.2
      + this.gearPos * Math.max(0, iasKt - SF50.VLE) / 15 * 0.3;
    const Pde = CM_DE * pg * DE_UP;
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust, nz, CL, CD, buffet, ff, ias, rpm: this.rpm, flaps: this.flaps,
      cg: (MAC_LE_X - mp.cgx) / C, staticMargin: -CMA / CLA + (mp.cgx - SF50_CG.x) / C, inletStress: 0, stall,
      aoaNorm, shaker: !onGround && aoaNorm > 0.85, pusher: !!this.pushing, n1: e.n1, n2: e.n2, itt: e.itt, flapOverspeed: iasKt > vfe, gearOverspeed: gearOver,
      pitchPower: Pde * qS * C / I.z, rollPower: CL_DA * DA_MAX * qS * SPAN / I.x, yawPower: CN_DR * DR_MAX * qS * SPAN / I.y,
      dePerG: qS > 1 ? Math.min(1.5, Math.max(-CMA / CLA, 0.02) * m * grav / (qS * Pde)) : 1.5 };
  }
}
