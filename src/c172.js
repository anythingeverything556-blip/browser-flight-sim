import * as THREE from 'three';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';
import { FlightModel, lerpTable, smooth, clamp, UP, newEngine, tyre, MU_PEAK, TYRE_B, TYRE_C, KAPPA_PK, V_REG } from './flight.js';

// Cessna 172SP Skyhawk. Sources: C172SP Pilot's Operating Handbook (weights, speeds, performance tables), Roskam "Airplane Flight Dynamics"
// Part I appendix B (Cessna 182/172-class stability derivatives), JSBSim c172p (inertia, gear). Coefficients are per radian on S, c, b.
export const C172 = {
  S: 16.2, B: 11.0, C: 1.49,
  EMPTY: 937,          // 767 kg basic empty + two 85 kg occupants
  FUEL_MAX: 144,       // 53 US gal usable avgas
  PMAX: 134.2e3, RPM_MAX: 2700, PROP_D: 1.905, J_ENG: 2.4, // IO-360-L2A 180 hp, 75 in fixed-pitch prop, engine + prop inertia
  BSFC: 7.6e-8,        // kg/J (0.45 lb/hp/h, best power)
  VNE: 163, VNO: 129, VFE: 85, VS0: 40, VS1: 48, VR: 55, VX: 62, VY: 74, // KIAS
  NZ_LIMIT: 3.8, NZ_ULT: 5.7, NZ_NEG_ULT: -2.28,
};
// Model frame (three.js, +x nose, +y up, +z right wing), origin on the centreline at the firewall line, wheel bottoms at y = 0.
export const C172_CG = new THREE.Vector3(-1.0, 1.15, 0);
const B = (x, y, z) => new THREE.Vector3(x - C172_CG.x, y - C172_CG.y, z - C172_CG.z);
// struts: static sink = share of the weight / k, so the model's wheels rest on the runway at the design weight
export const C172_GEAR = [
  { name: 'nose', p: B(0.165, -0.10, 0), k: 3.0e4, c: 3.0e3, steer: true, brake: false, R: 0.19, J: 0.25 },
  { name: 'left', p: B(-1.486, -0.047, -1.276), k: 8.0e4, c: 6.0e3, steer: false, brake: true, R: 0.22, J: 0.35 },
  { name: 'right', p: B(-1.486, -0.047, 1.276), k: 8.0e4, c: 6.0e3, steer: false, brake: true, R: 0.22, J: 0.35 },
];
export const C172_HARD = [
  ['propeller', B(1.0, 0.27, 0)], ['spinner', B(1.32, 1.1, 0)], ['cowling', B(0.6, 0.5, 0)], ['belly', B(-0.9, 0.42, 0)],
  ['tail', B(-6.3, 1.05, 0)], ['left wingtip', B(-1.4, 1.95, -5.5)], ['right wingtip', B(-1.4, 1.95, 5.5)], ['fin', B(-6.6, 2.65, 0)],
];
const THRUST_Y = 1.25 - C172_CG.y; // propeller axis above the CG
const D2R = Math.PI / 180;
const DE_UP = 25 * D2R, DE_DN = 21 * D2R, DA_MAX = 18 * D2R, DR_MAX = 18 * D2R; // surface travel at |command| = 1 (c172visual.js matches)
export const FLAP_DEG = [0, 10, 20, 30];
// retractable tail wheel (owner request; not on the production 172): contact point under the tail cone, model frame. It meets the runway at
// about 8.6 deg nose-up on the main wheels, ahead of the tail cone (12.9 deg), so it takes over-rotations and tail-low landings.
export const TAIL_WHEEL = { p: B(-5.40, 0.545, 0), k: 2.5e4, c: 2.5e3, R: 0.075, travel: 0.12 };
const TAIL_GEAR_TIME = 3; // s for a full retraction or extension (electric)
const STEER_LO = 30, STEER_HI = 1.5, STEER_FADE = 10; // nose-wheel angle at full pedal (deg): standing still, and from STEER_FADE m/s
const CASTOR_MIN = 0.25, CASTOR_V0 = 8, CASTOR_V1 = 25; // nose tyre side force kept at speed, and the m/s band it fades over
const PFACTOR = 0.075; // m: P-factor and slipstream yaw moment per newton of thrust, fading out by 55 m/s
// rigging (the wings' incidence and aileron droop set at the factory): a rolling-moment coefficient that balances the engine torque in cruise
// (75 % power, ~105 KIAS), so hands off it flies straight; at climb power and low speed the torque still wins and it rolls left, as a real one
const CL_RIG = 0.0008;
const TAIL_SCRAPE_VS = 1.5; // m/s: a tail touch with the CG sinking slower than this scrapes
const TB_C172 = 520; // N m per main wheel at full pedal

// lift / drag / pitch by flap angle (deg): incremental CL, CD and Cm, and CLmax
const FLAP_CL = [[0, 0], [10, 0.20], [20, 0.38], [30, 0.50]];
const FLAP_CD = [[0, 0], [10, 0.006], [20, 0.016], [30, 0.034]];
const FLAP_CM = [[0, 0], [10, -0.02], [20, -0.04], [30, -0.055]];
const CLMAX = [[0, 1.55], [10, 1.68], [20, 1.80], [30, 1.88]];
export const CL0 = 0.31, CLA = 4.8, CLQ = 3.9, CL_DE = 0.43, CD0 = 0.031, K_IND = 0.0568;
const CM0 = 0.04, CMA = -0.89, CMQ = -12.4, CMAD = -5.2, CM_DE = 1.28;
const CY_B = -0.31, CY_DR = -0.187, CL_B = -0.089, CL_P = -0.47, CL_R = 0.096, CL_DA = 0.178, CL_DR = -0.0147;
const CN_B = 0.065, CN_P = -0.03, CN_R = -0.099, CN_DA = -0.02, CN_DR = 0.0657;
// fixed-pitch climb/cruise propeller: thrust and power coefficients by advance ratio J = V / (n D)
const PROP_CT = [[0, 0.096], [0.2, 0.091], [0.4, 0.081], [0.6, 0.066], [0.8, 0.046], [1.0, 0.020], [1.2, -0.012], [1.5, -0.06]];
const PROP_CP = [[0, 0.058], [0.2, 0.059], [0.4, 0.058], [0.6, 0.054], [0.8, 0.045], [1.0, 0.030], [1.2, 0.010], [1.5, -0.03]];

// Lift coefficient with a soft stall: linear to CLmax, then a drop of ~30 % over 8 degrees, blending into flat-plate lift at high alpha.
export function c172Lift(alpha, flapDeg) {
  const cl0 = CL0 + lerpTable(FLAP_CL, flapDeg), clmax = lerpTable(CLMAX, flapDeg), as = (clmax - cl0) / CLA, an = (-0.9 - cl0) / CLA;
  const lin = cl0 + CLA * alpha, plate = 1.05 * Math.sin(2 * alpha);
  if (alpha > as) { const t = smooth(as, as + 0.14, alpha); return (clmax * (1 - 0.3 * t)) * (1 - smooth(0.45, 0.8, alpha)) + plate * smooth(0.45, 0.8, alpha); }
  if (alpha < an) { const t = smooth(an, an - 0.14, alpha); return -0.9 * (1 - 0.3 * t) * (1 - smooth(-0.45, -0.8, alpha)) + plate * smooth(-0.45, -0.8, alpha); }
  return lin;
}
export const stallAlpha = (flapDeg) => (lerpTable(CLMAX, flapDeg) - CL0 - lerpTable(FLAP_CL, flapDeg)) / CLA;

const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const V3 = () => new THREE.Vector3();
const _air = V3(), _vb = V3(), _d = V3(), _lift = V3(), _side = V3(), _fa = V3(), _mb = V3(), _F = V3(), _T = V3(), _w = V3(), _fwd = V3(), _r = V3(), _vp = V3(),
  _fh = V3(), _right = V3(), _Fg = V3(), _rc = V3(), _I = V3(), _Iw = V3(), _gyro = V3(), _w2 = V3(), _t = V3(), _cg = V3();
const _mp = { m: 0, cgx: 0, Ix: 0, Iy: 0, Iz: 0 };

export class C172Model extends FlightModel {
  constructor() {
    super();
    this.type = 'c172';
    this.fuel = C172.FUEL_MAX; this.cgx = C172_CG.x;
    this.flaps = 0; this.flapCmd = 0; // actual degrees, commanded notch 0..3
    this.rpm = 0; this.omega = 0; this.magnetos = true;
    const e = newEngine(); this.engines = [e, e]; // one engine; two references so code that reads engines[0..1] sees the same one
    this.sasOn = false; this.antiSkid = false;
    this.wheel = [0, 0, 0];
    this.tailGearCmd = true; this.tailGearPos = 1; this.tailContact = 0; this.tailWheel = 0;
  }
  // tail wheel: down = true / up = false; it cannot be raised while it carries weight
  setTailGear(down) { if (!down && this.tailContact > 0) return false; this.tailGearCmd = !!down; return true; }
  get mass() { return C172.EMPTY + this.fuel; }
  massProps() {
    const m = C172.EMPTY + this.fuel;
    _mp.m = m; _mp.cgx = C172_CG.x + 0.05 * (this.fuel / C172.FUEL_MAX - 0.5); // tanks sit a little aft of the CG
    _mp.Ix = 1285 + 1.6 * this.fuel * 9; _mp.Iy = 2667 + 2 * this.fuel; _mp.Iz = 1825 + 0.5 * this.fuel;
    return _mp;
  }
  scheduleCG() {}
  updateSas() { this.sas.de = 0; this.sas.da = 0; this.sas.dr = 0; }
  setFlaps(notch) { this.flapCmd = clamp(Math.round(notch), 0, 3); }

  // engine power (W) at this rpm, throttle and air density: constant torque below red line, Gagg-Ferrar altitude lapse, idle stop
  enginePower(rpm, th, rho) {
    if (!(this.fuel > 0 || this.unlimitedFuel) || !this.magnetos) return 0;
    const sig = rho / 1.225, alt = Math.max(0, (sig - 0.05) / 0.95), map = 0.2 + 0.8 * clamp(th, 0, 1);
    return C172.PMAX * alt * Math.max(0, (map - 0.1) / 0.9) * Math.min(rpm, C172.RPM_MAX * 1.05) / C172.RPM_MAX;
  }
  prop(omega, V, rho) {
    const n = Math.max(omega, 0) / (2 * Math.PI), D = C172.PROP_D, J = n > 0.5 ? V / (n * D) : 5;
    const ct = n > 0.5 ? lerpTable(PROP_CT, J) : 0, cp = n > 0.5 ? lerpTable(PROP_CP, J) : 0;
    // thrust tapers to 40 % between 1050 rpm and idle (restored from the live 2026-10-28 build, missing from the zip source)
    const lowRpm = clamp((n * 60 - 650) / 400, 0.4, 1);
    // below ~5 rev/s the blades windmill or stop: no thrust table there, just a drag torque
    return { T: ct * lowRpm * rho * n * n * D ** 4, P: cp * rho * n * n * n * D ** 5, J };
  }
  // steady rpm for a throttle setting (used by reset/trim): power absorbed by the prop = engine power
  steadyOmega(th, V, rho) {
    let lo = 0, hi = C172.RPM_MAX * 1.25 * Math.PI / 30;
    for (let i = 0; i < 40; i++) { const w = (lo + hi) / 2, rpm = w * 30 / Math.PI; if (this.enginePower(rpm, th, rho) - this.prop(w, V, rho).P - 14 * w > 0) lo = w; else hi = w; }
    return (lo + hi) / 2;
  }
  setEngines(th) {
    this.throttle = th;
    const V = this.vel ? this.vel.length() : 0, rho = isa(this.pos ? this.pos.y : 0).rho;
    this.omega = this.steadyOmega(th, V, rho); this.rpm = this.omega * 30 / Math.PI; this.spool = th;
    const e = this.engines[0]; e.dry = this.rpm / C172.RPM_MAX; e.ab = 0; e.abLit = false; e.unstart = 0;
  }
  updateEngines() {}

  reset(pos, headingDeg, speed, onGround, gammaDeg = 0) {
    if (!Number.isFinite(this.fuel) || this.fuel > C172.FUEL_MAX) this.fuel = C172.FUEL_MAX;
    this.flaps = onGround ? 0 : speed < 30 ? 20 : 0; this.flapCmd = this.flaps / 10;
    const e = newEngine(); this.engines = [e, e];
    // FlightModel.reset trims (this class's trimLevel) above 30 m/s; slower air starts are trimmed here
    super.reset(pos, headingDeg, speed, onGround, gammaDeg);
    this.engines[1] = this.engines[0];
    this.gearDown = true; this.gearPos = 1; this.chute = 'stowed';
    this.tailGearCmd = true; this.tailGearPos = 1; this.tailContact = 0; this.tailWheel = 0;
    this.wheel = C172_GEAR.map((g) => speed / g.R);
    if (onGround) this.setEngines(0); else if (speed <= 30 && speed > 15) this.trimLevel(gammaDeg);
  }

  // straight steady flight along gamma: alpha for the weight, elevator for Cm = 0 (as trim), throttle for thrust = drag
  trimLevel(gammaDeg = 0) {
    const atm = isa(this.pos.y), V = this.vel.length(), mp = this.massProps(), g = gammaDeg * D2R, qS = 0.5 * atm.rho * V * V * C172.S;
    const W = mp.m * gravityAt(this.pos.y), need = W * Math.cos(g) / qS;
    let alpha = 0.05, de = 0;
    for (let it = 0; it < 8; it++) {
      let lo = -0.2, hi = stallAlpha(this.flaps) - 0.005;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (c172Lift(mid, this.flaps) - CL_DE * de < need) lo = mid; else hi = mid; }
      alpha = (lo + hi) / 2;
      de = clamp(-(CM0 + CMA * alpha + lerpTable(FLAP_CM, this.flaps)) / CM_DE, -DE_DN, DE_UP);
    }
    const CL = need, CD = CD0 + lerpTable(FLAP_CD, this.flaps) + K_IND * CL * CL, T = CD * qS + W * Math.sin(g);
    this.trim = clamp(de / DE_UP, -1, 1);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), alpha + g));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat), side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(fwd).applyAxisAngle(side, -alpha).multiplyScalar(V);
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2, w = this.steadyOmega(mid, V, atm.rho); if (this.prop(w, V, atm.rho).T < T) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2);
  }

  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    const { S, B: SPAN, C } = C172;
    _qi.copy(this.quat).invert();
    const air = _air.copy(this.vel).sub(wind), vb = _vb.copy(air).applyQuaternion(_qi), V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y), M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0, beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz); this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - C172_CG.x, 0, 0);

    // flaps: electric, about 2.5 s per 10 degrees
    const flapT = FLAP_DEG[this.flapCmd] || 0;
    this.flaps += clamp(flapT - this.flaps, -4 * dt, 4 * dt);
    // cable controls: quick, no SAS
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.03 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de, 4); this.surf.da = act(this.surf.da, this.ctrl.da, 4); this.surf.dr = act(this.surf.dr, this.ctrl.dr, 4);
    const deCmd = clamp(this.surf.de + this.trim * 0.6, -1, 1), dE = deCmd * (deCmd > 0 ? DE_UP : DE_DN), dA = this.surf.da * DA_MAX, dR = this.surf.dr * DR_MAX;

    // ----- engine and propeller -----
    const fuelOk = this.fuel > 0 || this.unlimitedFuel;
    const Vax = Math.max(0, vb.x), pr = this.prop(this.omega, Vax, atm.rho);
    const Peng = this.enginePower(this.rpm, this.throttle, atm.rho);
    const Qeng = Peng / Math.max(this.omega, 30), Qprop = pr.P / Math.max(this.omega, 1), Qfric = 14 * Math.tanh(this.omega / 5);
    this.omega = Math.max(0, this.omega + (Qeng - Qprop - Qfric) / C172.J_ENG * dt);
    this.rpm = this.omega * 30 / Math.PI;
    const thrust = this.omega > 3 ? pr.T : 0;
    const e = this.engines[0]; e.thrust = thrust; e.dry = Math.min(1, this.rpm / C172.RPM_MAX); e.ab = 0; e.ff = fuelOk ? Peng * C172.BSFC : 0; e.rpm = this.rpm;
    // slipstream over the tail: elevator and rudder keep authority at low speed with power on (taxi, rotation)
    const qTail = qbar + 0.55 * Math.max(0, thrust) / (Math.PI * (C172.PROP_D / 2) ** 2);

    // ground effect
    const hWing = Math.max(0.3, this.pos.y + 0.85 - groundAt(this.pos.x, this.pos.z));
    const r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16);

    // ----- aerodynamics -----
    const Vk = Math.max(V, 15), bv = SPAN / (2 * Vk), cv = C / (2 * Vk);
    const p = this.w.x, q = this.w.z, r = -this.w.y;
    const stall = smooth(stallAlpha(this.flaps), stallAlpha(this.flaps) + 0.1, alpha);
    const CL = c172Lift(alpha, this.flaps) - CL_DE * dE + CLQ * q * cv;
    const CD = CD0 + lerpTable(FLAP_CD, this.flaps) + K_IND * CL * CL * ge + 0.6 * stall * Math.sin(alpha) ** 2 + 0.25 * Math.abs(Math.sin(beta));
    const bC = clamp(beta, -0.5, 0.5), qS = qbar * S;
    const Cy = CY_B * bC + CY_DR * dR * (qTail / Math.max(qbar, 1));
    const fa = _fa.set(0, 0, 0);
    if (V > 0.5) {
      const d = _d.copy(vb).divideScalar(V);
      const lift = _lift.set(0, 1, 0).addScaledVector(d, -d.y); if (lift.lengthSq() > 1e-6) lift.normalize();
      const side = _side.set(0, 0, 1).addScaledVector(d, -d.z); if (side.lengthSq() > 1e-6) side.normalize();
      fa.addScaledVector(d, -qS * CD).addScaledVector(lift, qS * CL).addScaledVector(side, qS * Cy);
    }
    const fb = fa; fb.x += thrust;
    const mb = _mb.set(0, 0, 0);
    mb.z -= THRUST_Y * thrust;                               // thrust line above the CG: nose down with power
    mb.x -= Qprop * 0.6;                                     // engine torque reaction rolls left
    mb.y += PFACTOR * thrust * clamp(1 - V / 55, 0, 1);        // P-factor and slipstream swirl yaw left at high power, low speed
    if (V > 1 || qTail > 1) {
      const qT = qTail * S, cmQ = Math.min(qbar, qbar + 1);
      const Cm = CM0 + CMA * alpha * (1 - 0.15 * stall) - 0.12 * stall + lerpTable(FLAP_CM, this.flaps) + CMQ * q * cv + CMAD * this.alphaDot * cv - 0.05 * (1 - ge);
      mb.z += cmQ * S * C * Cm + qT * C * CM_DE * dE;
      // stalled: roll damping fades and yaw rate drives roll (wing drop, spin entry)
      const Cl = CL_RIG + CL_B * bC + CL_P * (1 - 0.8 * stall) * p * bv + CL_R * (1 + 4 * stall) * r * bv + CL_DA * (1 - 0.5 * stall) * dA;
      const Cn = CN_B * bC + CN_P * p * bv + CN_R * r * bv + CN_DA * dA;
      mb.x += qS * SPAN * Cl + qT * SPAN * CL_DR * dR;
      mb.y -= qS * SPAN * Cn + qT * SPAN * CN_DR * dR;
    }

    const F = _F.copy(fb).applyQuaternion(this.quat), T = _T.set(0, 0, 0);
    F.y -= m * grav;
    F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }

    // ----- landing gear (fixed tricycle): strut spring/damper + tyre, toe brakes, nose wheel steered by the rudder pedals -----
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat), fwd = _fwd.set(1, 0, 0).applyQuaternion(this.quat), gs = this.vel.length();
    for (let i = 0; i < C172_GEAR.length; i++) {
      const g = C172_GEAR[i];
      const rr = _r.copy(g.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z;
      let pen = groundAt(px, pz) - py;
      const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0) { this.wheel[i] *= 1 - 0.3 * dt; this.brakePress[i] = 0; continue; }
      onGround = true;
      const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      if (!was && vp.y < -4.0) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
      if (pen > 0.35) {
        if (vp.y < -2.5) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
        this.pos.y += pen - 0.1; pen = 0.1;
      }
      const Fn = Math.max(0, g.k * pen - g.c * vp.y);
      this.contacts[i] = Fn; this.compress[i] = Math.min(0.25, pen);
      const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
      // nose wheel: full pedal is 30 deg at a walk, 3 deg from ~25 kt (a keyboard pedal is all or nothing, and 10 deg at 50 kt is a 2 g swerve)
      if (g.steer) fh.applyAxisAngle(UP, -this.ctrl.dr * (STEER_HI + (STEER_LO - STEER_HI) * clamp(1 - gs / STEER_FADE, 0, 1)) * D2R);
      const right = _right.crossVectors(fh, UP);
      const vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], tanA = vLat / vref, kap = (om * g.R - vLong) / vref;
      const ty = tyre(kap, tanA, Fn), fx = ty[0];
      let fy = ty[1];
      // nose tyre ahead of the CG is directionally unstable when it grips fully at speed (the hands-off roll swung 28 deg): its side force fades
      // with speed, as for the SR-71, and the rudder takes over
      if (g.steer) fy *= CASTOR_MIN + (1 - CASTOR_MIN) * (1 - smooth(CASTOR_V0, CASTOR_V1, gs));
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * g.R / vref;
      const demand = g.brake ? Math.max(this.brakes, this.parkingBrake ? 1 : 0) : 0;
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.08);
      const tqMax = TB_C172 * (this.parkingBrake ? 1.5 : 1) * this.brakePress[i] + (0.028 + 0.02 * (1 - smooth(0.5, 3, Math.abs(vLong)))) * Fn * g.R, th = Math.tanh(om / 0.2);
      const dom = -dt * (g.R * fx + tqMax * th) / (g.J + dt * g.R * dF + dt * tqMax * (1 - th * th) / 0.2);
      const fxEff = clamp(fx + dF * dom, -MU_PEAK * Fn, MU_PEAK * Fn);
      this.wheel[i] = Math.max(-5, om + dom);
      const Fg = _Fg.set(0, Fn, 0).addScaledVector(fh, fxEff).addScaledVector(right, fy);
      F.add(Fg); T.add(_rc.copy(rr).cross(Fg));
    }
    // tail wheel: a castoring wheel on a spring leg, only when fully down; no side force (it swivels), light rolling drag
    this.tailGearPos = clamp(this.tailGearPos + (this.tailGearCmd ? 1 : -1) * dt / TAIL_GEAR_TIME, 0, 1);
    this.tailContact = 0;
    if (this.tailGearPos > 0.98) {
      const rr = _r.copy(TAIL_WHEEL.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z, pen = groundAt(px, pz) - py;
      if (pen > 0) {
        const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
        if (vp.y < -0.5 && !this.tailWas) this.events.push({ type: 'touch', vs: -vp.y, wheel: 3 });
        const Fn = Math.max(0, TAIL_WHEEL.k * Math.min(pen, TAIL_WHEEL.travel) - TAIL_WHEEL.c * vp.y);
        const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
        const vLong = vp.dot(fh), Fx = -Math.sign(vLong) * Math.min(1, Math.abs(vLong) / 0.5) * 0.03 * Fn;
        const Fg = _Fg.set(0, Fn, 0).addScaledVector(fh, Fx);
        F.add(Fg); T.add(_rc.copy(rr).cross(Fg));
        this.tailContact = Fn; this.tailWheel = vLong / TAIL_WHEEL.R; onGround = true;
      }
    }
    this.tailWas = this.tailContact > 0;
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
    for (let hi = 0; hi < C172_HARD.length; hi++) {
      const name = C172_HARD[hi][0], rr = _r.copy(C172_HARD[hi][1]).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z, gy = groundAt(px, pz);
      if (py < gy - 0.03) {
        if (onGround && gs < 6 && Math.abs(this.vel.y) < 1) { this.pos.y += gy - py + 0.03; continue; }
        // over-rotation on the runway: the tail tie-down ring scrapes (minor damage in the real aircraft), not a crash; an aircraft that drops
        // onto its tail (sinking flare) still crashes
        if (name === 'tail' && gs < 45 && this.vel.y > -TAIL_SCRAPE_VS) {
          this.pos.y += gy - py + 0.03; if (this.w.z > 0) this.w.z *= 0.2;
          if (!this.scrapeT) this.events.push({ type: 'scrape', part: 'tail' });
          this.scrapeT = 1; continue;
        }
        if (this.crashOff) { this.absorb(gy - py + 0.03); continue; }
        this.crash(name === 'propeller' ? 'propeller strike' : `${name} hit the ground`); return;
      }
    }

    const nz = fb.y / (m * grav) + (onGround ? this.contacts.reduce((s, c) => s + c, 0) / (m * grav) : 0);
    const ias = V * Math.sqrt(atm.rho / 1.225), iasKt = ias * 1.943844;
    // structure: ultimate load factor, or far past Vne (flutter)
    if (!this.crashOff && (nz > C172.NZ_ULT || nz < C172.NZ_NEG_ULT || iasKt > C172.VNE * 1.2)) { this.crash(iasKt > C172.VNE * 1.2 ? 'airframe failed past Vne' : `airframe overstressed (${nz.toFixed(1)} g)`, 'overstress'); return; }
    const buffet = 0.6 * smooth(stallAlpha(this.flaps) - 0.05, stallAlpha(this.flaps) + 0.03, alpha) + (onGround ? Math.min(1, gs / 30) * 0.25 : 0) + Math.max(0, iasKt - C172.VNO) / 60 * 0.2;
    const Pde = CM_DE * DE_UP;
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust, nz, CL, CD, buffet, ff, ias, rpm: this.rpm, flaps: this.flaps,
      cg: 0.25, staticMargin: 0.15, inletStress: 0, stall, pitchPower: Pde * Math.max(qTail, 1) * S * C / I.z, rollPower: CL_DA * DA_MAX * qS * SPAN / I.x,
      yawPower: CN_DR * DR_MAX * Math.max(qTail, 1) * S * SPAN / I.y, dePerG: qS > 1 ? Math.min(1.5, 0.15 * m * grav / (qS * CM_DE * DE_UP / CMA * -CLA)) : 1.5 };
  }
}
