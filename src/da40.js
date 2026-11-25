import * as THREE from 'three';
import { solvePropTrim } from './proptrim.js';
import { airData } from './airdata.js';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';
import { landingLimits } from './difficulty.js';
import { FlightModel, lerpTable, smooth, clamp, UP, newEngine, tyre, MU_PEAK, TYRE_B, TYRE_C, KAPPA_PK, V_REG } from './flight.js';

// Baseline: .scratch/da40/source/da40ng-jsb.xml (metrics, gear and aero),
// Engines/AE300.xml and Engines/MTV-6-R.xml (power/propeller), Systems/da40-fcs.xml
// (actuation/governor), and gui/dialogs/da40-help.xml (reference speeds). This is an
// approximation using the C172Model solver, NOT a port or validation of JSBSim.
// The smooth lift curve, propeller disk, landing response, unlisted derivatives
// and limits not given in the quick reference are estimates; simulation only.
export const DA40 = {
  S: 13.244, B: 11.63, C: 1.28,
  EMPTY: 903, PAYLOAD: 160, MTOM: 1310, FUEL_MAX: 118,
  PMAX: 123500, RPM_MAX: 2300, PROP_D: 1.90, BSFC: 5.79e-8,
  VNE: 172, VNO: 130, VFE: 110, VFE_TO: 110, VFE_LDG: 98, VS0: 58, VS1: 63, VR: 62, VX: 66, VY: 72,
  NZ_LIMIT: 3.8, NZ_ULT: 5.7, NZ_NEG_ULT: -2.28,
};
// +x forward, +y up, +z right; source gear/CG offsets converted to this frame.
export const DA40_CG = new THREE.Vector3(-1.358, 0.79, 0);
const B = (x, y, z) => new THREE.Vector3(x - DA40_CG.x, y - DA40_CG.y, z);
export const DA40_GEAR = [
  { name: 'nose', p: B(0.034, 0, -0.078), k: 67125, c: 11675, steer: true, brake: false, R: 0.18, J: 0.25 },
  { name: 'left', p: B(-1.741, 0, -1.446), k: 49600, c: 17500, steer: false, brake: true, R: 0.20, J: 0.35 },
  { name: 'right', p: B(-1.741, 0, 1.446), k: 49600, c: 17500, steer: false, brake: true, R: 0.20, J: 0.35 },
];
export const DA40_HARD = [
  ['propeller', B(0.77, 0.16, 0)], ['spinner', B(0.85, 0.98, 0)], ['cowling', B(0.30, 0.33, 0)],
  ['belly', B(-1.3, 0.35, 0)], ['tail', B(-6.9, 0.60, 0)],
  ['left wingtip', B(-1.4, 0.65, -5.815)], ['right wingtip', B(-1.4, 0.65, 5.815)], ['fin', B(-7.0, 2.20, 0)],
];
export const DA40_FLAP_DEG = [0, 20, 42];
const D2R = Math.PI / 180;
const DE_UP = 25 * D2R, DE_DN = 21 * D2R, DA_MAX = 18 * D2R, DR_MAX = 18 * D2R;
const FLAP_CL = [[0, 0], [20, 0.1845], [42, 0.369]], FLAP_CD = [[0, 0], [20, 0.027], [42, 0.054]];
const FLAP_CM = [[0, 0], [20, -0.02], [42, -0.04]], CLMAX = [[0, 1.47], [20, 1.61], [42, 1.74]];
export const CL0 = 0.64, CLA = 6.15, CLQ = 7.3499, CL_DE = 0.4739, CD0 = 0.029, K_IND = 0.04;
const CM0 = 0.04, CMA = -0.7, CMQ = -20, CMAD = -5.2, CM_DE = 2.3876;
const CY_B = -0.5615, CY_DR = -0.187, CL_B = -0.089, CL_P = -0.47, CL_R = 0.096, CL_DA = 0.178, CL_DR = -0.0147;
const CN_B = 0.065, CN_P = -0.03, CN_R = -0.099, CN_DA = -0.02, CN_DR = 0.0657;
export function da40Lift(alpha, flapDeg) {
  const cl0 = CL0 + lerpTable(FLAP_CL, flapDeg), clmax = lerpTable(CLMAX, flapDeg), as = (clmax - cl0) / CLA, an = (-0.9 - cl0) / CLA;
  const lin = cl0 + CLA * alpha, plate = 1.05 * Math.sin(2 * alpha);
  if (alpha > as) { const t = smooth(as, as + 0.14, alpha), blend = smooth(0.45, 0.8, alpha); return clmax * (1 - 0.3 * t) * (1 - blend) + plate * blend; }
  if (alpha < an) { const t = smooth(an, an - 0.14, alpha), blend = smooth(-0.45, -0.8, alpha); return -0.9 * (1 - 0.3 * t) * (1 - blend) + plate * blend; }
  return lin;
}
export const stallAlpha = (flapDeg) => (lerpTable(CLMAX, flapDeg) - CL0 - lerpTable(FLAP_CL, flapDeg)) / CLA;

const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const V3 = () => new THREE.Vector3();
const _air = V3(), _vb = V3(), _d = V3(), _lift = V3(), _side = V3(), _fa = V3(), _mb = V3(), _F = V3(), _T = V3(), _w = V3(), _fwd = V3(), _r = V3(), _vp = V3(),
  _fh = V3(), _right = V3(), _Fg = V3(), _rc = V3(), _I = V3(), _Iw = V3(), _gyro = V3(), _w2 = V3(), _t = V3(), _cg = V3();
const _mp = { m: 0, cgx: 0, Ix: 0, Iy: 0, Iz: 0 };

export class DA40Model extends FlightModel {
  constructor() {
    super();
    this.type = 'da40'; this.land = landingLimits('c172', 'medium');
    this.fuel = DA40.FUEL_MAX; this.payload = DA40.PAYLOAD; this.cgx = DA40_CG.x;
    this.flaps = 0; this.flapCmd = 0; this.rpm = 0; this.omega = 0; this.magnetos = true;
    const engine = newEngine(); this.engines = [engine, engine];
    this.sasOn = false; this.antiSkid = false; this.wheel = [0, 0, 0];
  }
  get mass() { return DA40.EMPTY + this.fuel + this.payload; }
  massProps() {
    const mass = this.mass;
    _mp.m = mass; _mp.cgx = DA40_CG.x - 0.242 * this.fuel / mass;
    _mp.Ix = 1220 + 4 * this.fuel; _mp.Iy = 6779 + 4 * this.fuel; _mp.Iz = 1627 + 0.1 * this.fuel;
    return _mp;
  }
  scheduleCG() {}
  updateSas() { this.sas.de = 0; this.sas.da = 0; this.sas.dr = 0; }
  setFlaps(notch) { this.flapCmd = clamp(Math.round(notch), 0, DA40_FLAP_DEG.length - 1); }
  // Turbocharged AE300 is approximately flat-rated to 10,000 ft. The C172 API's
  // magnetos flag here is an engine-stop control, not a diesel ignition model.
  enginePower(rpm, throttle, rho) {
    if (!(this.fuel > 0 || this.unlimitedFuel) || !this.magnetos || rpm <= 0) return 0;
    const lapse = Math.min(1, Math.max(0, (rho / isa(3048).rho - 0.05) / 0.95));
    return DA40.PMAX * Math.min(lapse, clamp(rpm / DA40.RPM_MAX, 0, 1), 0.045 + 0.955 * clamp(throttle, 0, 1));
  }
  // Momentum-disk approximation, not the source's blade-pitch/advance-ratio tables.
  prop(omega, speed, rho, throttle = this.throttle) {
    const n = Math.max(omega, 0) / (2 * Math.PI), J = n > 0.5 ? speed / (n * DA40.PROP_D) : 5;
    const power = this.enginePower(n * 60, throttle, rho);
    if (power <= 0) return { T: -0.025 * rho * speed * speed, P: 0, J };
    const area = Math.PI * (DA40.PROP_D / 2) ** 2, useful = power * (0.52 + 0.35 * smooth(0, 60, speed));
    let lo = 0, hi = 8000;
    for (let i = 0; i < 25; i++) {
      const thrust = (lo + hi) / 2, diskSpeed = (speed + Math.sqrt(speed * speed + 2 * thrust / (rho * area))) / 2;
      if (thrust * diskSpeed < useful) lo = thrust; else hi = thrust;
    }
    return { T: (lo + hi) / 2, P: power, J };
  }
  // The governor schedule follows da40-fcs.xml above idle; at zero load the
  // engine's 700-rpm idle is converted through the 1.69:1 reduction gearbox.
  steadyOmega(throttle, speed, rho) {
    const windmillRpm = Math.min(1800, Math.max(0, speed) * 20);
    if (!(this.fuel > 0 || this.unlimitedFuel) || !this.magnetos) return windmillRpm * Math.PI / 30;
    return Math.max(windmillRpm, lerpTable([[0, 700 / 1.69], [0.2, 1800], [0.92, 2100], [1, 2300]], clamp(throttle, 0, 1))) * Math.PI / 30;
  }
  setEngines(throttle) {
    this.throttle = throttle;
    const speed = this.vel ? this.vel.length() : 0, rho = isa(this.pos ? this.pos.y : 0).rho;
    this.omega = this.steadyOmega(throttle, speed, rho); this.rpm = this.omega * 30 / Math.PI; this.spool = throttle;
    const engine = this.engines[0]; engine.dry = this.rpm / DA40.RPM_MAX; engine.ab = 0; engine.abLit = false; engine.unstart = 0;
  }
  updateEngines() {}
  reset(pos, headingDeg, speed, onGround, gammaDeg = 0, config = {}) {
    const spawnAtm = isa(pos.y), casMs = airData({ V: speed, M: speed / spawnAtm.a, rho: spawnAtm.rho, T: spawnAtm.T }).cas;
    if (!Number.isFinite(this.fuel) || this.fuel > DA40.FUEL_MAX) this.fuel = DA40.FUEL_MAX;
    this.fuel = Math.max(0, this.fuel);
    this.setFlaps(config.flapNotch ?? (!onGround && casMs < 35 ? 1 : 0)); this.flaps = DA40_FLAP_DEG[this.flapCmd];
    const engine = newEngine(); this.engines = [engine, engine];
    super.reset(pos, headingDeg, speed, onGround, gammaDeg);
    this.engines[1] = this.engines[0]; this.gearDown = true; this.gearPos = 1; this.chute = 'stowed';
    this.wheel = DA40_GEAR.map((gear) => speed / gear.R);
    if (onGround) this.setEngines(0); else if (speed <= 30 && speed > 15) this.trimLevel(gammaDeg);
  }
  trimLevel(gammaDeg = 0) {
    const atm = isa(this.pos.y), speed = this.vel.length(), gamma = gammaDeg * D2R;
    const { alpha, thrust: drag, trim } = solvePropTrim({ qbar: 0.5 * atm.rho * speed ** 2, area: DA40.S, chord: DA40.C,
      weight: this.mass * gravityAt(this.pos.y), gamma: gamma, flapMoment: lerpTable(FLAP_CM, this.flaps), flapDrag: lerpTable(FLAP_CD, this.flaps),
      lift: a => da40Lift(a, this.flaps), stallAngle: stallAlpha(this.flaps), liftElevator: CL_DE,
      moment0: CM0, momentAlpha: CMA, momentElevator: CM_DE, drag0: CD0, inducedDrag: K_IND,
      propArea: Math.PI * (DA40.PROP_D / 2) ** 2, thrustArm: 0.23, upTravel: DE_UP, downTravel: DE_DN });
    this.trim = trim;
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), alpha + gamma));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat), side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(fwd).applyAxisAngle(side, -alpha).multiplyScalar(speed);
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2, omega = this.steadyOmega(mid, speed * Math.cos(alpha), atm.rho); if (this.prop(omega, speed * Math.cos(alpha), atm.rho, mid).T < drag) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2);
  }
  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    this.gearDown = true; this.gearPos = 1;
    const { S, B: SPAN, C } = DA40;
    _qi.copy(this.quat).invert();
    const air = _air.copy(this.vel).sub(wind), vb = _vb.copy(air).applyQuaternion(_qi), V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y), M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0, beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz); this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - DA40_CG.x, 0, 0);
    const flapTarget = DA40_FLAP_DEG[this.flapCmd] || 0, flapRate = this.flaps < 20 || (this.flaps === 20 && flapTarget < 20) ? 20 / 4 : 22 / 3;
    let flapStep = clamp(flapTarget - this.flaps, -flapRate * dt, flapRate * dt);
    if (this.flaps < 20 && this.flaps + flapStep > 20) flapStep = 20 - this.flaps;
    if (this.flaps > 20 && this.flaps + flapStep < 20) flapStep = 20 - this.flaps;
    this.flaps += flapStep;
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.03 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de, 4); this.surf.da = act(this.surf.da, this.ctrl.da, 4); this.surf.dr = act(this.surf.dr, this.ctrl.dr, 4);
    const deCmd = clamp(this.surf.de + this.trim * 0.6, -1, 1), dE = deCmd * (deCmd > 0 ? DE_UP : DE_DN), dA = this.surf.da * DA_MAX, dR = this.surf.dr * DR_MAX;
    const fuelOk = this.fuel > 0 || this.unlimitedFuel, Vax = Math.max(0, vb.x), targetOmega = this.steadyOmega(this.throttle, Vax, atm.rho);
    this.omega += (targetOmega - this.omega) * Math.min(1, dt); this.rpm = this.omega * 30 / Math.PI;
    const pr = this.prop(this.omega, Vax, atm.rho), Peng = this.enginePower(this.rpm, this.throttle, atm.rho), thrust = pr.T, Qprop = Peng / Math.max(this.omega, 1);
    const engine = this.engines[0]; engine.thrust = thrust; engine.dry = Math.min(1, this.rpm / DA40.RPM_MAX); engine.ab = 0; engine.ff = fuelOk ? Peng * DA40.BSFC : 0; engine.rpm = this.rpm;
    const qTail = qbar + 0.55 * Math.max(0, thrust) / (Math.PI * (DA40.PROP_D / 2) ** 2);
    const hWing = Math.max(0.3, this.pos.y + 0.06 - groundAt(this.pos.x, this.pos.z)), r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16);
    const Vk = Math.max(V, 15), bv = SPAN / (2 * Vk), cv = C / (2 * Vk), p = this.w.x, q = this.w.z, r = -this.w.y;
    const stall = smooth(stallAlpha(this.flaps), stallAlpha(this.flaps) + 0.1, alpha);
    const CL = da40Lift(alpha, this.flaps) - CL_DE * dE + CLQ * q * cv;
    const CD = CD0 + lerpTable(FLAP_CD, this.flaps) + K_IND * CL * CL * ge + 0.6 * stall * Math.sin(alpha) ** 2 + 0.25 * Math.abs(Math.sin(beta));
    const bC = clamp(beta, -0.5, 0.5), qS = qbar * S, Cy = CY_B * bC + CY_DR * dR * (qTail / Math.max(qbar, 1));
    const fa = _fa.set(0, 0, 0);
    if (V > 0.5) {
      const direction = _d.copy(vb).divideScalar(V), lift = _lift.set(0, 1, 0).addScaledVector(direction, -direction.y), side = _side.set(0, 0, 1).addScaledVector(direction, -direction.z);
      if (lift.lengthSq() > 1e-6) lift.normalize(); if (side.lengthSq() > 1e-6) side.normalize();
      fa.addScaledVector(direction, -qS * CD).addScaledVector(lift, qS * CL).addScaledVector(side, qS * Cy);
    }
    const fb = fa; fb.x += thrust;
    const mb = _mb.set(-Qprop * 0.6, 0.035 * thrust * clamp(1 - V / 55, 0, 1), -0.23 * thrust);
    if (V > 1 || qTail > 1) {
      const qT = qTail * S, Cm = CM0 + CMA * alpha * (1 - 0.15 * stall) - 0.12 * stall + lerpTable(FLAP_CM, this.flaps) + CMQ * q * cv + CMAD * this.alphaDot * cv - 0.05 * (1 - ge);
      mb.z += qS * C * Cm + qT * C * CM_DE * dE;
      const Cl = 0.0008 + CL_B * bC + CL_P * (1 - 0.8 * stall) * p * bv + CL_R * (1 + 4 * stall) * r * bv + CL_DA * (1 - 0.5 * stall) * dA;
      const Cn = CN_B * bC + CN_P * p * bv + CN_R * r * bv + CN_DA * dA;
      mb.x += qS * SPAN * Cl + qT * SPAN * CL_DR * dR; mb.y -= qS * SPAN * Cn + qT * SPAN * CN_DR * dR;
    }
    const F = _F.copy(fb).applyQuaternion(this.quat), T = _T.set(0, 0, 0);
    F.y -= m * grav; F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat), fwd = _fwd.set(1, 0, 0).applyQuaternion(this.quat), gs = this.vel.length();
    for (let i = 0; i < DA40_GEAR.length; i++) {
      const gear = DA40_GEAR[i], rr = _r.copy(gear.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z;
      let pen = groundAt(px, pz) - py; const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0) { this.wheel[i] *= 1 - 0.3 * dt; this.brakePress[i] = 0; continue; }
      onGround = true; const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      if (!was && vp.y < -this.land.sinkMax) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
      if (pen > 0.35) { if (vp.y < -this.land.sinkBottom) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); } this.pos.y += pen - 0.1; pen = 0.1; }
      const Fn = Math.max(0, gear.k * pen - gear.c * vp.y); this.contacts[i] = Fn; this.compress[i] = Math.min(0.25, pen);
      const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
      if (gear.steer) fh.applyAxisAngle(UP, -this.ctrl.dr * (1.5 + 28.5 * clamp(1 - gs / 10, 0, 1)) * D2R);
      const right = _right.crossVectors(fh, UP), vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], ty = tyre((om * gear.R - vLong) / vref, vLat / vref, Fn), fx = ty[0];
      let fy = ty[1]; if (gear.steer) fy *= 0.25 + 0.75 * (1 - smooth(8, 25, gs));
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * gear.R / vref, demand = gear.brake ? Math.max(this.brakes, this.parkingBrake ? 1 : 0) : 0;
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.08);
      const tqMax = 520 * (this.parkingBrake ? 1.5 : 1) * this.brakePress[i] + (0.028 + 0.02 * (1 - smooth(0.5, 3, Math.abs(vLong)))) * Fn * gear.R, th = Math.tanh(om / 0.2);
      const dom = -dt * (gear.R * fx + tqMax * th) / (gear.J + dt * gear.R * dF + dt * tqMax * (1 - th * th) / 0.2);
      const fxEff = clamp(fx + dF * dom, -MU_PEAK * Fn, MU_PEAK * Fn); this.wheel[i] = Math.max(-5, om + dom);
      const Fg = _Fg.set(0, Fn, 0).addScaledVector(fh, fxEff).addScaledVector(right, fy); F.add(Fg); T.add(_rc.copy(rr).cross(Fg));
    }
    this.onGround = onGround;
    const acceleration = F.multiplyScalar(1 / m); this.pos.addScaledVector(this.vel, dt).addScaledVector(acceleration, 0.5 * dt * dt); this.vel.addScaledVector(acceleration, dt);
    const tb = T.applyQuaternion(_qi).add(mb), Iw = _Iw.set(I.x * this.w.x, I.y * this.w.y, I.z * this.w.z), gyro = _gyro.crossVectors(this.w, Iw), w0 = _w2.copy(this.w);
    this.w.x += (tb.x - gyro.x) / I.x * dt; this.w.y += (tb.y - gyro.y) / I.y * dt; this.w.z += (tb.z - gyro.z) / I.z * dt;
    const wm = _t.copy(w0).add(this.w).multiplyScalar(0.5), ang = wm.length() * dt;
    if (ang > 1e-9) { _dq.setFromAxisAngle(wm.normalize(), ang); this.quat.multiply(_dq).normalize(); }
    const ff = engine.ff; if (!this.unlimitedFuel) this.fuel = Math.max(0, this.fuel - ff * dt);
    if (this.scrapeT) this.scrapeT = Math.max(0, this.scrapeT - dt);
    for (const [name, point] of DA40_HARD) {
      const rr = _r.copy(point).sub(cgv).applyQuaternion(this.quat), px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z, gy = groundAt(px, pz);
      if (py < gy - 0.03) {
        if (onGround && gs < 6 && Math.abs(this.vel.y) < 1) { this.pos.y += gy - py + 0.03; continue; }
        if (name === 'tail' && gs < 45 && this.vel.y > -this.land.scrapeVs) { this.pos.y += gy - py + 0.03; if (this.w.z > 0) this.w.z *= 0.2; if (!this.scrapeT) this.events.push({ type: 'scrape', part: 'tail' }); this.scrapeT = 1; continue; }
        if (this.crashOff) { this.absorb(gy - py + 0.03); continue; }
        this.crash(name === 'propeller' ? 'propeller strike' : `${name} hit the ground`); return;
      }
    }
    const nz = fb.y / (m * grav) + (onGround ? this.contacts.reduce((sum, contact) => sum + contact, 0) / (m * grav) : 0), nzAero = fb.y / (m * grav);
    const { eas, cas } = airData({ V, M, rho: atm.rho, T: atm.T });
    const ias = cas, iasKt = cas * 1.943844;
    if (!this.crashOff && (nzAero > DA40.NZ_ULT || nzAero < DA40.NZ_NEG_ULT || iasKt > DA40.VNE * 1.2)) { this.crash(iasKt > DA40.VNE * 1.2 ? 'airframe failed past Vne' : `airframe overstressed (${nzAero.toFixed(1)} g)`, 'overstress'); return; }
    const buffet = 0.6 * smooth(stallAlpha(this.flaps) - 0.05, stallAlpha(this.flaps) + 0.03, alpha) + (onGround ? Math.min(1, gs / 30) * 0.25 : 0) + Math.max(0, iasKt - DA40.VNO) / 60 * 0.2;
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust, nz, nzAero, CL, CD, buffet, ff, eas, cas, ias, iasReference: 'CAS', rpm: this.rpm, flaps: this.flaps,
      cg: 0.25, staticMargin: 0.15, inletStress: 0, stall, pitchPower: CM_DE * DE_UP * Math.max(qTail, 1) * S * C / I.z, rollPower: CL_DA * DA_MAX * qS * SPAN / I.x,
      yawPower: CN_DR * DR_MAX * Math.max(qTail, 1) * S * SPAN / I.y, dePerG: qS > 1 ? Math.min(1.5, 0.15 * m * grav / (qS * CM_DE * DE_UP / CMA * -CLA)) : 1.5 };
  }
}
