import * as THREE from 'three';
import { airData, trueAirspeedFromCas } from './airdata.js';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';
import { landingLimits, modeOf } from './difficulty.js';
import { FlightModel, lerpTable, smooth, clamp, UP, newEngine, tyre, MU_PEAK, TYRE_B, TYRE_C, KAPPA_PK, V_REG } from './flight.js';

// Independent F27-500 approximation. Source/estimate ledger: notes/F27-PERFORMANCE.md.
// Sources: supplied BGT flight_model/engines/systems.cfg, English manual pp 19,
// 25, 31-34, 56-61; EASA.A.036 issue 08 pp 8, 10-11. NOT an MSFS/JSBSim port.
// SI throughout; public V speeds are KIAS. +x nose, +y up, +z right wing.
const KT = 1.943844, D2R = Math.PI / 180, FT = 0.3048;
export const F27 = {
  S: 754 * FT ** 2, B: 95.15 * FT, C: 754 / 95.15 * FT, LENGTH: 78 * FT,
  EMPTY: 28990 * 0.45359237, PAYLOAD: 2200, // cfg empty / estimated fixed payload
  FUEL_MAX: 2 * 2535 * 0.8, FUEL_START: 3000, // manual tank litres x assumed Jet A density
  MTOW: 19730, MTOM: 19730, MLW: 18600, MZFW: 17460, // standard Mk500, not optional weight mods
  PMAX: 1835 * 745.699872, PMAX_WET: 1990 * 745.699872, // EASA shaft W per engine; dry used
  RESIDUAL: 479 * 4.4482216153, // EASA dry residual exhaust thrust per engine, N
  RPM_IDLE: 7000, RPM_MAX: 15000, RPM_CRUISE: 14200, GEAR_RATIO: 0.093, PROP_RPM_MAX: 1395,
  PROP_D: 11.5 * FT, BSFC: 0.735 * 0.45359237 / (745.699872 * 3600),
  VMO: 227, VNE: 227, VNO: 200, MMO: 0.48, VFE: 145, VLE: 220, VLO: 220,
  VS0: 74, VS1: 91, VR: 100, VY: 138, VREF: 100, CEILING: 7620,
  NZ_LIMIT: 3, NZ_NEG_LIMIT: -2, NZ_FLAP_LIMIT: 2,
  GEAR_UP_TIME: 17, GEAR_DOWN_TIME: 7, GEAR_CD: 0.026531,
};
export const F27_FLAP_DEG = [0, 11.5, 16.5, 26.5, 40]; // pilot-selected, no auto flap scheduling
// Datum x matches supplied cfg; vertical datum shifted for the visual's ground plane.
// Contact planes are equalised (cfg strut geometry/radii are incompatible with this point solver).
export const F27_CG = new THREE.Vector3(2.32 * FT, 2.29, 0);
const B = (x, y, z) => new THREE.Vector3(x - F27_CG.x, y - F27_CG.y, z);
export const F27_GEAR = [
  { name: 'nose', p: B(31.64 * FT, -0.10, 0), k: 180000, c: 28000, steer: true, brake: false, R: 0.8 * FT, J: 4 },
  { name: 'left', p: B(-0.43 * FT, -0.10, -11.84 * FT), k: 880000, c: 105000, steer: false, brake: true, R: 1.2 * FT, J: 12 },
  { name: 'right', p: B(-0.43 * FT, -0.10, 11.84 * FT), k: 880000, c: 105000, steer: false, brake: true, R: 1.2 * FT, J: 12 },
];
export const F27_HARD = [
  ['nose', B(37.31 * FT, 2.0, 0)], ['belly', B(0, 0.65, 0)], ['tail', B(-36.77 * FT, 3.3, 0)],
  ['left wingtip', B(2.9 * FT, 3.5, -47 * FT)], ['right wingtip', B(2.9 * FT, 3.5, 47 * FT)],
  ['left propeller', B(11.525 * FT, 0.7, -11.911 * FT)], ['right propeller', B(11.524 * FT, 0.7, 11.91 * FT)],
  ['fin', B(-32 * FT, 8.4, 0)],
];
const DE_UP = 25 * D2R, DE_DN = 22 * D2R, DA_MAX = 27.5 * D2R, DR_MAX = 20 * D2R;
const FLAP_CL = [[0, 0], [11.5, 0.38], [16.5, 0.60], [26.5, 1.0], [40, 1.45]];
const FLAP_CD = [[0, 0], [11.5, 0.012], [16.5, 0.025], [26.5, 0.055], [40, 0.106445]];
const FLAP_CM = [[0, 0], [11.5, -0.012], [16.5, -0.020], [26.5, -0.030], [40, -0.040]];
const CLMAX = [[0, 2.06], [11.5, 2.28], [16.5, 2.50], [26.5, 2.82], [40, 3.11]];
// CD0/source; induced factor from source span, area and e=.77. Other derivatives
// estimated/fitted to flyable stable response; CLmax fitted to cfg's 91/74 kt at MTOW.
export const CL0 = 0.54, CLA = 5.2, CLQ = 4, CL_DE = 0.372559, CD0 = 0.02539;
export const K_IND = 1 / (Math.PI * (F27.B ** 2 / F27.S) * 0.77);
const CM0 = 0.025, CMA = -0.8, CMQ = -22, CMAD = -5, CM_DE = 1.6;
const CY_B = -0.40, CY_DR = -0.20, CL_B = -0.073, CL_P = -0.65, CL_R = 0.10, CL_DA = 0.09, CL_DR = 0.015;
const CN_B = 0.10, CN_P = -0.03, CN_R = -0.20, CN_DA = -0.015, CN_DR = 0.11;
const THRUST_HEIGHT = (2.8 - 1) * FT;
export const stallAlpha = (flaps = 0) => (lerpTable(CLMAX, flaps) - CL0 - lerpTable(FLAP_CL, flaps)) / CLA;
export function f27Lift(alpha, flaps = 0) {
  const cl0 = CL0 + lerpTable(FLAP_CL, flaps), max = lerpTable(CLMAX, flaps), as = stallAlpha(flaps), an = (-1 - cl0) / CLA;
  const plate = 1.05 * Math.sin(2 * alpha);
  if (alpha > as) { const drop = smooth(as, as + 0.12, alpha), blend = smooth(as + 0.13, 0.95, alpha); return max * (1 - 0.30 * drop) * (1 - blend) + plate * blend; }
  if (alpha < an) { const drop = smooth(an, an - 0.14, alpha), blend = smooth(an - 0.15, -0.95, alpha); return -1 * (1 - 0.3 * drop) * (1 - blend) + plate * blend; }
  return cl0 + CLA * alpha;
}
export const stallSpeed = (mass, flaps = 0, rho = 1.225) => Math.sqrt(2 * mass * 9.80665 / (rho * F27.S * lerpTable(CLMAX, flaps)));
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const V3 = () => new THREE.Vector3();
const _air = V3(), _vb = V3(), _d = V3(), _lift = V3(), _side = V3(), _fa = V3(), _mb = V3(), _F = V3(), _T = V3(), _w = V3(), _fwd = V3(), _r = V3(), _vp = V3(),
  _fh = V3(), _right = V3(), _Fg = V3(), _rc = V3(), _I = V3(), _Iw = V3(), _gyro = V3(), _w2 = V3(), _t = V3(), _cg = V3();
const _mp = { m: 0, cgx: 0, Ix: 0, Iy: 0, Iz: 0 };

export class F27Model extends FlightModel {
  constructor() {
    super(); this.type = 'f27'; this.mode = 'medium'; this.land = landingLimits('il76', 'medium');
    this.engineRunning = true; this.fuel = F27.FUEL_START; this.payload = F27.PAYLOAD; this.cgx = F27_CG.x;
    this.flaps = 0; this.flapCmd = 0; this.rpm = 7000; this.propRpm = 651;
    this.engines = [this.newEng(), this.newEng()]; this.sasOn = false; this.antiSkid = false;
    this.wheel = [0, 0, 0]; this.wheelAngle = [0, 0, 0]; this.pneumatic = 2800; this.ffTotal = 0; this.surfN = { el: 0, ail: 0, rud: 0 };
  }
  newEng() { return Object.assign(newEngine(), { starting: false, rpm: 7000, propRpm: 651, n1: 46.667, n2: 46.667, itt: 300, egt: 300, lit: true, fail: false, feather: false, power: 0, torque: 0 }); }
  get mass() { return F27.EMPTY + this.payload + this.fuel; }
  get magnetos() { return this.engines.some(e => !e.fail); }
  set magnetos(on) { for (const e of this.engines) e.fail = !on; } // generic UI stop alias, not actual magnetos
  setEngineRunning(running, { immediate = false } = {}) {
    this.engineRunning = !!running;
    // Only explicit cold-spawn initialization skips inertia; a normal parked
    // shutdown must spool down just like an airborne one.
    if (!running && immediate) for (const e of this.engines) e.rpm = 0;
    this.updateEngines(0, isa(this.pos.y), this.vel.length());
    return true;
  }
  failEngine(i, fail = true) { if (this.engines[i]) this.engines[i].fail = !!fail; }
  // HP FEATHER cuts fuel as well as selecting low-drag blades (manual pp 24-25).
  // This is a simplified completed feather selection, not an electric pump/beta transient.
  setFeather(i, feather = true) {
    if (!Number.isInteger(i) || !this.engines[i]) return false;
    this.engines[i].feather = !!feather;
    this.updateEngines(0, isa(this.pos.y), this.vel.length());
    return true;
  }
  setMode(mode) { this.mode = modeOf(mode); this.land = landingLimits('il76', this.mode); }
  massProps() {
    const s = this.mass / F27.EMPTY, toSI = 1.35581795;
    _mp.m = this.mass; _mp.cgx = F27_CG.x;
    _mp.Ix = 231770 * toSI * s; _mp.Iy = 424160 * toSI * s; _mp.Iz = 303622 * toSI * s;
    return _mp;
  }
  scheduleCG() {} // fixed symmetric load; no SR71 fuel/CG transfer
  updateSas() { this.sas.de = 0; this.sas.da = 0; this.sas.dr = 0; }
  setFlaps(notch) { if (!Number.isFinite(notch)) return false; this.flapCmd = clamp(Math.round(notch), 0, 4); return true; }
  weightOnWheels() { return this.onGround || this.contacts.reduce((s, n) => s + n, 0) > this.mass * 9.80665 * 0.1; }
  setGear(down) {
    down = !!down;
    if (!down && this.weightOnWheels()) return false;
    if (down === this.gearDown) return true; // held commands do not consume air or reverse travel
    if (this.pneumatic < 600) return false;
    if (!!down !== this.gearDown) this.pneumatic = Math.max(0, this.pneumatic - 450);
    this.gearDown = !!down; return true;
  }
  // Shared by tire forces and visual steering: +rudder turns right, with less
  // authority at speed. Do not sample the source 360-degree steering lookup.
  noseSteeringAngle() { return -clamp(this.ctrl.dr, -1, 1) * (3 + 47 * clamp(1 - this.vel.length() / 18, 0, 1)) * D2R; }
  gearStatus() {
    const target = this.gearDown ? 1 : 0, remaining = Math.abs(target - this.gearPos);
    return { moving: remaining > 1e-6, down: this.gearDown, position: this.gearPos,
      seconds: remaining * (this.gearDown ? F27.GEAR_DOWN_TIME : F27.GEAR_UP_TIME) };
  }
  setTailGear() { return false; }
  // Direct-coupled Dart: throttle selects gas turbine rpm; prop rpm is gearbox rpm,
  // NOT the 15,000 rpm shown on engine instruments. Governor/pitch aerodynamics are approximated.
  targetRpm(throttle) { return 7000 + 8000 * clamp(throttle, 0, 1); }
  enginePower(rpm, rho) {
    if (rpm < 6000) return 0;
    const fraction = clamp((rpm - 7000) / 8000, 0, 1);
    return F27.PMAX * (0.025 + 0.975 * fraction ** 2.2) * Math.min(1, (rho / 1.225) ** 0.65);
  }
  prop(power, speed, rho) {
    if (power <= 0) return 0;
    const area = Math.PI * (F27.PROP_D / 2) ** 2, useful = power * (0.55 + 0.31 * smooth(0, 70, speed));
    let lo = 0, hi = 60000;
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2, vd = (speed + Math.sqrt(speed * speed + 2 * t / (rho * area))) / 2;
      if (t * vd < useful) lo = t; else hi = t;
    }
    return (lo + hi) / 2;
  }
  engineThrust(rpm, speed, atm) {
    const p = this.enginePower(rpm, atm.rho), f = clamp((rpm - 7000) / 8000, 0, 1);
    return this.prop(p, speed, atm.rho) + F27.RESIDUAL * f ** 2 * (atm.p / 101325) ** 0.8;
  }
  setEngines(throttle) {
    this.throttle = clamp(throttle, 0, 1);
    for (const e of this.engines) { e.rpm = this.engineRunning && !e.fail && !e.feather && (this.fuel > 0 || this.unlimitedFuel) ? this.targetRpm(this.throttle) : 0; e.dry = this.throttle; e.ab = 0; e.abLit = false; }
    this.rpm = this.engines.reduce((s, e) => s + e.rpm, 0) / 2; this.propRpm = this.rpm * F27.GEAR_RATIO; this.spool = this.throttle;
    this.updateEngines(0, isa(this.pos.y), this.vel.length());
  }
  updateEngines(dt, atm, speed) {
    let total = 0, ff = 0;
    for (let i = 0; i < 2; i++) {
      const e = this.engines[i], enabled = this.engineRunning && (this.fuel > 0 || this.unlimitedFuel) && !e.fail && !e.feather;
      const own = clamp(this.throttle + (this.leverTrim?.[i] || 0), 0, 1), windmill = e.feather ? 0 : Math.min(7000, speed * 60);
      const target = enabled ? this.targetRpm(own) : windmill;
      // Unpowered rundown is an estimated 3.2 s time constant, not a
      // combustion flag driving the rotor. Smooth and step-size independent.
      const tau = target > e.rpm ? 2.8 : enabled ? 1.6 : 3.2;
      const delta = (target - e.rpm) * -Math.expm1(-Math.max(0, dt) / tau);
      e.rpm = Math.max(0, e.rpm + clamp(delta, -4500 * dt, 1800 * dt));
      if (!enabled && target < 1 && e.rpm < 2) e.rpm = 0;
      const lit = enabled && e.rpm >= 6000;
      e.lit = lit; e.starting = enabled && !lit; e.propRpm = e.rpm * F27.GEAR_RATIO; e.dry = clamp((e.rpm - 7000) / 8000, 0, 1);
      e.n1 = e.n2 = e.rpm / 150; e.ab = 0; e.abLit = false;
      e.power = lit ? this.enginePower(e.rpm, atm.rho) : 0;
      e.thrust = lit ? this.engineThrust(e.rpm, speed, atm) : -(e.feather ? 0.15 : 2.0) * atm.rho * speed * speed;
      e.ff = lit ? Math.max(0.018, e.power * F27.BSFC) : 0;
      e.torque = e.power / Math.max(40, e.propRpm * Math.PI / 30); e.ffLbh = e.ff * 3600 / 0.45359237;
      const temp = lit ? 340 + 390 * e.dry ** 1.4 : atm.T - 273.15;
      e.itt += (temp - e.itt) * Math.min(1, dt / 4); e.egt = e.itt;
      total += e.thrust; ff += e.ff;
    }
    this.rpm = (this.engines[0].rpm + this.engines[1].rpm) / 2; this.propRpm = this.rpm * F27.GEAR_RATIO;
    this.spool = (this.engines[0].dry + this.engines[1].dry) / 2; this.ffTotal = ff;
    return total;
  }
  // Manual pp 47/56: reference = 1.3 Vs for the selected configuration.
  // Uses this model's estimated CLmax, NOT an approved F27 landing-speed table.
  // Pass 40 explicitly to plan a full-flap landing before selecting that setting.
  vref(flaps = this.flaps) { return 1.3 * stallSpeed(this.mass, flaps) * KT; }
  vSpeed(reference) { return reference * Math.sqrt(this.mass / F27.MTOW); }
  reset(pos, headingDeg, speed, onGround, gammaDeg = 0, config = {}) {
    // Keep the original boolean approach argument for standalone model callers.
    // Configuration and selected engine switches must precede the one initial trim.
    if (typeof config === 'boolean') config = { approach: config };
    config = config || {};
    const spawnAtm = isa(pos.y), casMs = airData({ V: speed, M: speed / spawnAtm.a, rho: spawnAtm.rho, T: spawnAtm.T }).cas;
    this.fuel = clamp(Number.isFinite(this.fuel) ? this.fuel : F27.FUEL_START, 0, F27.FUEL_MAX);
    this.engineRunning = config.engineRunning ?? true; this.engines = [this.newEng(), this.newEng()]; this.pneumatic = 2800;
    const kias = casMs * KT;
    this.flapCmd = onGround ? 0 : config.approach ? 3 : kias < 115 ? 4 : kias < 135 ? 2 : 0;
    if (Number.isFinite(config.flapNotch)) this.setFlaps(config.flapNotch);
    this.flaps = F27_FLAP_DEG[this.flapCmd]; this.noTrim = true;
    super.reset(pos, headingDeg, speed, onGround, gammaDeg);
    this.engines = [this.newEng(), this.newEng()]; this.noTrim = false;
    this.engines.forEach((e, i) => { e.feather = !!config.feather?.[i]; });
    this.gearDown = onGround || (config.gearDown ?? (config.approach || this.flapCmd === 4)); this.gearPos = this.gearDown ? 1 : 0;
    this.wheel = F27_GEAR.map(g => onGround ? speed / g.R : 0);
    this.wheelAngle.fill(0);
    if (onGround) this.setEngines(0); else { this.setEngines(0.8); if (speed > 30) this.trimLevel(gammaDeg); }
    this.out.flaps = this.flaps; this.out.rpm = this.rpm; this.surfN = { el: 0, ail: 0, rud: 0 };
  }
  trimSolve(speed, gammaDeg = 0, flaps = this.flaps, gear = this.gearPos) {
    const atm = isa(this.pos.y), qS = 0.5 * atm.rho * speed * speed * F27.S, gamma = gammaDeg * D2R;
    const weight = this.mass * gravityAt(this.pos.y);
    let alpha = 0, de = 0, thrust = 0;
    for (let it = 0; it < 14; it++) {
      // Engines push along body +X, not the flight path: resolve their
      // normal lift contribution and axial projection just as step() does.
      const need = (weight * Math.cos(gamma) - thrust * Math.sin(alpha)) / Math.max(qS, 1);
      let lo = -0.25, hi = stallAlpha(flaps) - 0.008;
      for (let i = 0; i < 32; i++) { const a = (lo + hi) / 2; if (f27Lift(a, flaps) - CL_DE * de < need) lo = a; else hi = a; }
      alpha = (lo + hi) / 2;
      thrust = Math.max(0, ((CD0 + lerpTable(FLAP_CD, flaps) + F27.GEAR_CD * gear + K_IND * need ** 2) * qS + weight * Math.sin(gamma)) / Math.cos(alpha));
      const qTailRatio = 1 + 0.08 * thrust / (Math.PI * (F27.PROP_D / 2) ** 2 * Math.max(qS / F27.S, 1));
      de = clamp(-(CM0 + CMA * alpha + lerpTable(FLAP_CM, flaps) - THRUST_HEIGHT * thrust / Math.max(qS * F27.C, 1)) / (CM_DE * qTailRatio), -DE_DN, DE_UP);
    }
    return { alpha, de, thrust, trim: clamp(de / (de > 0 ? DE_UP : DE_DN) / 0.6, -1, 1) };
  }
  setTakeoffTrim() {
    // The reference is indicated (CAS in this sim); trimSolve takes true m/s.
    // At elevated fields, using IAS as TAS falsely demands excessive lift/trim.
    const speed = trueAirspeedFromCas(this.vSpeed(108) / KT, isa(this.pos.y));
    this.trim = this.trimSolve(speed, 0, F27_FLAP_DEG[this.flapCmd], 1).trim; return this.trim;
  }
  trimLevel(gammaDeg = 0) {
    if (this.noTrim) return;
    const speed = this.vel.length(), atm = isa(this.pos.y), solved = this.trimSolve(speed, gammaDeg);
    this.trim = solved.trim;
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), solved.alpha + gammaDeg * D2R));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat), right = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(fwd).applyAxisAngle(right, -solved.alpha).multiplyScalar(speed);
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (2 * this.engineThrust(this.targetRpm(mid), speed * Math.cos(solved.alpha), atm) < solved.thrust) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2);
  }
  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    // Public stepping is frame-rate safe; the spring contact solver runs at <= 120 Hz.
    if (dt > 1 / 120 + 1e-9) {
      const n = Math.ceil(dt * 120);
      for (let i = 0; i < n; i++) this.step(dt / n, groundAt, wind);
      return;
    }
    const { S, B: SPAN, C } = F27;
    _qi.copy(this.quat).invert();
    const air = _air.copy(this.vel).sub(wind), vb = _vb.copy(air).applyQuaternion(_qi), V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y), M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0, beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz); this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - F27_CG.x, 0, 0);
    this.flaps += clamp(F27_FLAP_DEG[this.flapCmd] - this.flaps, -40 / 15 * dt, 40 / 15 * dt);
    const gearTarget = this.gearDown ? 1 : 0;
    const gearBefore = this.gearPos;
    this.gearPos += clamp(gearTarget - this.gearPos, -dt / F27.GEAR_UP_TIME, dt / F27.GEAR_DOWN_TIME);
    if (Math.abs(gearTarget - this.gearPos) < 1e-10) this.gearPos = gearTarget;
    if (gearBefore !== gearTarget && this.gearPos === gearTarget) this.events.push('gear-lock');
    if (this.engines.some(e => e.rpm > 10000)) this.pneumatic = Math.min(2800, this.pneumatic + 100 * dt);
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.03 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de, 4); this.surf.da = act(this.surf.da, this.ctrl.da, 4); this.surf.dr = act(this.surf.dr, this.ctrl.dr, 4);
    this.surfN.el = this.surf.de; this.surfN.ail = this.surf.da; this.surfN.rud = this.surf.dr;
    const deCmd = clamp(this.surf.de + this.trim * 0.6, -1, 1), dE = deCmd * (deCmd > 0 ? DE_UP : DE_DN), dA = this.surf.da * DA_MAX, dR = this.surf.dr * DR_MAX;
    const thrust = this.updateEngines(dt, atm, Math.max(0, vb.x));
    const qTail = qbar + 0.08 * Math.max(0, thrust) / (Math.PI * (F27.PROP_D / 2) ** 2);
    const hWing = Math.max(0.3, this.pos.y + 1.0 - groundAt(this.pos.x, this.pos.z)), r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16);
    const Vk = Math.max(V, 15), bv = SPAN / (2 * Vk), cv = C / (2 * Vk), p = this.w.x, q = this.w.z, r = -this.w.y;
    const stall = smooth(stallAlpha(this.flaps), stallAlpha(this.flaps) + 0.1, alpha);
    const CL = f27Lift(alpha, this.flaps) - CL_DE * dE + CLQ * q * cv;
    const CD = CD0 + lerpTable(FLAP_CD, this.flaps) + F27.GEAR_CD * this.gearPos + 5 * Math.max(0, M - F27.MMO) ** 2 + K_IND * CL * CL * ge + 0.6 * stall * Math.sin(alpha) ** 2 + 0.25 * Math.abs(Math.sin(beta));
    const bC = clamp(beta, -0.5, 0.5), qS = qbar * S, Cy = CY_B * bC + CY_DR * dR * (qTail / Math.max(qbar, 1));
    const fa = _fa.set(0, 0, 0);
    if (V > 0.5) {
      const direction = _d.copy(vb).divideScalar(V), lift = _lift.set(0, 1, 0).addScaledVector(direction, -direction.y), side = _side.set(0, 0, 1).addScaledVector(direction, -direction.z);
      if (lift.lengthSq() > 1e-6) lift.normalize(); if (side.lengthSq() > 1e-6) side.normalize();
      fa.addScaledVector(direction, -qS * CD).addScaledVector(lift, qS * CL).addScaledVector(side, qS * Cy);
    }
    const fb = fa; fb.x += thrust;
    // Same-rotation prop torque and asymmetric thrust; equal engines cancel yaw, not roll torque.
    const torque = this.engines.reduce((sum, e) => sum + e.power / Math.max(40, e.propRpm * Math.PI / 30), 0);
    const mb = _mb.set(-0.025 * torque, 3.6303 * (this.engines[1].thrust - this.engines[0].thrust), -THRUST_HEIGHT * thrust);
    if (V > 1 || qTail > 1) {
      const qT = qTail * S, Cm = CM0 + CMA * alpha * (1 - 0.15 * stall) - 0.12 * stall + lerpTable(FLAP_CM, this.flaps) + CMQ * q * cv + CMAD * this.alphaDot * cv - 0.05 * (1 - ge);
      mb.z += qS * C * Cm + qT * C * CM_DE * dE;
      const Cl = CL_B * bC + CL_P * (1 - 0.8 * stall) * p * bv + CL_R * (1 + 4 * stall) * r * bv + CL_DA * (1 - 0.5 * stall) * dA;
      const Cn = CN_B * bC + CN_P * p * bv + CN_R * r * bv + CN_DA * dA;
      mb.x += qS * SPAN * Cl + qT * SPAN * CL_DR * dR; mb.y -= qS * SPAN * Cn + qT * SPAN * CN_DR * dR;
    }
    const F = _F.copy(fb).applyQuaternion(this.quat), T = _T.set(0, 0, 0);
    F.y -= m * grav; F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat), fwd = _fwd.set(1, 0, 0).applyQuaternion(this.quat), gs = this.vel.length();
    for (let i = 0; i < F27_GEAR.length; i++) {
      const gear = F27_GEAR[i], rr = _r.copy(gear.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + rr.x, py = this.pos.y + rr.y, pz = this.pos.z + rr.z;
      let pen = groundAt(px, pz) - py; const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0 || this.gearPos < 0.98) { this.wheel[i] *= 1 - 0.3 * dt; this.brakePress[i] = 0; continue; }
      onGround = true; const vp = _vp.crossVectors(wWorld, rr).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      if (!was && vp.y < -this.land.sinkMax) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); }
      if (pen > 0.35) { if (vp.y < -this.land.sinkBottom) { if (!this.crashOff) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; } this.absorb(0); vp.y = Math.max(vp.y, -1); } this.pos.y += pen - 0.1; pen = 0.1; }
      const Fn = Math.max(0, gear.k * pen - gear.c * vp.y); this.contacts[i] = Fn; this.compress[i] = Math.min(0.25, pen);
      const fh = _fh.set(fwd.x, 0, fwd.z); if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0); fh.normalize();
      if (gear.steer) fh.applyAxisAngle(UP, this.noseSteeringAngle());
      const right = _right.crossVectors(fh, UP), vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], ty = tyre((om * gear.R - vLong) / vref, vLat / vref, Fn), fx = ty[0];
      let fy = ty[1]; if (gear.steer) fy *= 0.25 + 0.75 * (1 - smooth(8, 25, gs));
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * gear.R / vref, demand = gear.brake ? Math.max(this.brakes, this.parkingBrake ? 1 : 0) : 0;
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.08);
      const tqMax = 18000 * (this.parkingBrake ? 1.5 : 1) * this.brakePress[i] + (0.018 + 0.012 * (1 - smooth(0.5, 3, Math.abs(vLong)))) * Fn * gear.R, th = Math.tanh(om / 0.2);
      const dom = -dt * (gear.R * fx + tqMax * th) / (gear.J + dt * gear.R * dF + dt * tqMax * (1 - th * th) / 0.2);
      const fxEff = clamp(fx + dF * dom, -MU_PEAK * Fn, MU_PEAK * Fn); this.wheel[i] = Math.max(-5, om + dom);
      const Fg = _Fg.set(0, Fn, 0).addScaledVector(fh, fxEff).addScaledVector(right, fy); F.add(Fg); T.add(_rc.copy(rr).cross(Fg));
    }
    // Integrate only on the simulation clock: pause/render frames cannot turn
    // tires. The signed solver speed includes slip, braking and airborne coast.
    if (this.gearPos >= 0.98) for (let i = 0; i < 3; i++)
      this.wheelAngle[i] = (this.wheelAngle[i] + this.wheel[i] * dt) % (2 * Math.PI);
    this.onGround = onGround;
    const acceleration = F.multiplyScalar(1 / m); this.pos.addScaledVector(this.vel, dt).addScaledVector(acceleration, 0.5 * dt * dt); this.vel.addScaledVector(acceleration, dt);
    const tb = T.applyQuaternion(_qi).add(mb), Iw = _Iw.set(I.x * this.w.x, I.y * this.w.y, I.z * this.w.z), gyro = _gyro.crossVectors(this.w, Iw), w0 = _w2.copy(this.w);
    this.w.x += (tb.x - gyro.x) / I.x * dt; this.w.y += (tb.y - gyro.y) / I.y * dt; this.w.z += (tb.z - gyro.z) / I.z * dt;
    const wm = _t.copy(w0).add(this.w).multiplyScalar(0.5), ang = wm.length() * dt;
    if (ang > 1e-9) { _dq.setFromAxisAngle(wm.normalize(), ang); this.quat.multiply(_dq).normalize(); }
    const ff = this.ffTotal; if (!this.unlimitedFuel) this.fuel = Math.max(0, this.fuel - ff * dt);
    if (this.scrapeT) this.scrapeT = Math.max(0, this.scrapeT - dt);
    for (const [name, point] of F27_HARD) {
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
    if (!this.crashOff && (nzAero > (this.flaps > 1 ? F27.NZ_FLAP_LIMIT : F27.NZ_LIMIT) * 1.5 || nzAero < F27.NZ_NEG_LIMIT * 1.5 || iasKt > F27.VMO * 1.2)) { this.crash(iasKt > F27.VMO * 1.2 ? 'airframe failed past Vne' : `airframe overstressed (${nzAero.toFixed(1)} g)`, 'overstress'); return; }
    const buffet = 0.6 * smooth(stallAlpha(this.flaps) - 0.05, stallAlpha(this.flaps) + 0.03, alpha) + (onGround ? Math.min(1, gs / 30) * 0.25 : 0) + Math.max(0, iasKt - F27.VNO) / 60 * 0.2;
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust, nz, nzAero, CL, CD, buffet, ff, eas, cas, ias, iasReference: 'CAS', rpm: this.rpm, propRpm: this.propRpm, flaps: this.flaps,
      cg: 0.25, staticMargin: 0.15, inletStress: 0, stall, gearOverspeed: this.gearPos > 0.02 && iasKt > F27.VLE, flapOverspeed: this.flaps > 1 && iasKt > F27.VFE,
      // The horn is actuated by throttle position, not instantaneous turbine
      // RPM: spool lag and an engine failure must not masquerade as lever movement.
      gearWarning: !onGround && this.gearPos < 0.98 && (this.flaps >= 26.5 || this.engines.some((e, i) => this.targetRpm(this.throttle + (this.leverTrim?.[i] || 0)) < 10500)),
      pneumatic: this.pneumatic, n1: this.rpm / 150, n2: this.rpm / 150, itt: (this.engines[0].itt + this.engines[1].itt) / 2,
      vfe: this.flaps > 1 ? F27.VFE : Infinity, aoaNorm: clamp((alpha + CL0 / CLA) / (stallAlpha(this.flaps) + CL0 / CLA), 0, 1),
      pitchPower: CM_DE * DE_UP * Math.max(qTail, 1) * S * C / I.z, rollPower: CL_DA * DA_MAX * qS * SPAN / I.x,
      yawPower: CN_DR * DR_MAX * Math.max(qTail, 1) * S * SPAN / I.y, dePerG: qS > 1 ? Math.min(1.5, 0.15 * m * grav / (qS * CM_DE * DE_UP / CMA * -CLA)) : 1.5 };
  }
}

// Descriptive alias; integration uses F27Model.
export { F27Model as F27FlightModel };
