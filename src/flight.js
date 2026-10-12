import * as THREE from 'three';
import { isa, gravityAt, R_EARTH, OMEGA_EARTH } from './atmosphere.js';

// SR-71A: wing area 170 m^2 (1,800 ft^2), span 16.94 m, empty ~30.6 t, fuel 36.3 t, 2 x J58 (111 kN dry / 145 kN A/B static each).
// Sources: SR-71A Flight Manual (SAS, CG / aerodynamic-centre notes), NASA TP-2002-210718 / TM-104330 (stability & performance estimates),
// Pratt & Whitney J58 propulsion notes (inlet 54 % / engine 17 % / ejector 29 % of thrust at M3.2). Tabulated aero values are
// engineering estimates shaped by those references, not a published data set.
export const SPEC = {
  S: 170, B: 16.94, C: 10.0,
  EMPTY: 30600, FUEL_MAX: 36300,
  DRY: 2 * 111e3, AB: 2 * 145e3,
  I: new THREE.Vector3(0.6e6, 3.8e6, 3.5e6), // nominal (half fuel) roll (x), yaw (y), pitch (z); the model recomputes it from fuel state
};

// Model-frame position of the nominal centre of gravity. Body frame = model frame shifted so the instantaneous CG is the origin.
// Body axes (three.js): +x nose, +y up, +z right wing.
export const CG_MODEL = new THREE.Vector3(-3.0, 2.3, 0);
const MAC_LE = -0.8;            // model x of the mean-aerodynamic-chord leading edge (CG_MODEL = 22 % MAC)
const X_E = -3.1, X_F = -2.2, X_A = -7.5; // model x of: empty airframe, forward tanks 1-4, aft trim tank 5/6
const AFT_CAP = 10000, XFER_RATE = 15;   // kg movable aft, pump rate kg/s
const B = (x, y, z) => new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z);
const STATIC_SINK = 0.12; // contact points sit lower by the static strut compression so the wheels rest on the ground
export const GEAR = [
  { name: 'nose', p: B(7.32, -STATIC_SINK, 0), k: 6.5e5, c: 9e4, steer: true, brake: false, R: 0.40, J: 6 },
  { name: 'left', p: B(-4.90, -STATIC_SINK, -2.54), k: 1.7e6, c: 2.8e5, steer: false, brake: true, R: 0.52, J: 22 },
  { name: 'right', p: B(-4.90, -STATIC_SINK, 2.54), k: 1.7e6, c: 2.8e5, steer: false, brake: true, R: 0.52, J: 22 },
];
// Airframe points that must never touch the ground.
export const HARD = [
  ['nose probe', B(17.6, 2.25, 0)], ['tail cone', B(-15.3, 2.7, 0)],
  ['left wingtip', B(-11.5, 2.05, -8.42)], ['right wingtip', B(-11.5, 2.05, 8.42)],
  ['left nacelle', B(-1.0, 1.5, -4.3)], ['right nacelle', B(-1.0, 1.5, 4.3)],
  ['left nozzle', B(-12.6, 1.55, -4.3)], ['right nozzle', B(-12.6, 1.55, 4.3)],
  ['belly', B(5.0, 1.83, 0)], ['aft belly', B(-6.0, 1.83, 0)],
  ['left fin', B(-11.0, 5.6, -4.9)], ['right fin', B(-11.0, 5.6, 4.9)], ['canopy', B(11.0, 3.6, 0)],
];
export const CHUTE_POINT = B(-15.3, 2.7, 0);
const ENGINE_ARM = 4.30;           // nacelle axis from the centreline
const THRUST_LINE = 2.47 - CG_MODEL.y;
const D2R = Math.PI / 180;
const DE_MAX = 18 * D2R, DA_MAX = 12 * D2R, DR_MAX = 20 * D2R; // surface travel at |command| = 1 (matches aircraft.js)

const lerpTable = (t, x) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x < t[i][0]) {
    const [x0, y0] = t[i - 1], [x1, y1] = t[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return t[t.length - 1][1];
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---- aerodynamic data (per rad, reference S = 170 m^2, c = 10 m, b = 16.94 m) ----
// CL-alpha: low-AR swept delta (AR 1.7): Helmbold-like ~2.4 subsonic, slender-body peak near M1, Ackeret with finite-span correction above.
const CLA = [[0, 2.35], [0.6, 2.4], [0.8, 2.5], [0.9, 2.6], [1.0, 2.7], [1.1, 2.7], [1.2, 2.6], [1.5, 2.3], [2, 1.9], [2.5, 1.55], [3, 1.3], [3.5, 1.12]];
const KV = [[0, 1.8], [0.9, 1.8], [1.4, 1.0], [2, 0.5], [3, 0.3]];   // Polhamus chine/leading-edge vortex lift, fades supersonic
const CL0 = 0.02;
// Zero-lift drag = skin friction (falls with Mach/Re) + area-ruled wave drag (peak at M~1.05) + nacelle/inlet spill.
const CD_FRIC = [[0, 0.0100], [0.9, 0.0098], [2, 0.0083], [3, 0.0072], [3.5, 0.0068]];
const CD_WAVE = [[0, 0], [0.85, 0.0004], [0.95, 0.0078], [1.05, 0.0190], [1.2, 0.0150], [1.5, 0.0105], [2, 0.0075], [2.5, 0.0065], [3, 0.0062], [3.5, 0.0062]];
const CD_INLET = [[0, 0], [1.6, 0.0008], [2.5, 0.0018], [3.5, 0.0024]];
// Lift-induced drag factor K (CD = CD0 + K CL^2): 1/(pi AR e) subsonic, leading-edge suction lost progressively supersonic. SR-71 L/D ~ 6 at M3.
const KIND = [[0, 0.22], [0.9, 0.24], [1.2, 0.3], [2, 0.36], [3, 0.4], [3.5, 0.42]];
// Aerodynamic centre (fraction of MAC): ~27 % subsonic, jumps aft to 35-40 % transonic and creeps forward to just aft of 25 % at M3.2
// (SR-71A Flight Manual, "Chines"). CG is scheduled by fuel transfer: forward subsonic, ~25 % supersonic.
const AC_TAB = [[0, 0.27], [0.85, 0.275], [1.15, 0.375], [1.4, 0.38], [2, 0.345], [2.6, 0.30], [3.2, 0.28], [3.6, 0.275]];
const CG_SCHED = [[0, 0.20], [1.0, 0.20], [2.5, 0.25], [4, 0.25]];
const CM_Q = [[0, -2.8], [1, -3.0], [3.5, -1.8]], CM_AD = [[0, -1.2], [3.5, -0.6]];     // pitch damping Cmq, Cm-alpha-dot
const CL_P = [[0, -0.25], [0.9, -0.26], [1.2, -0.22], [2, -0.15], [3.5, -0.11]];       // roll damping Clp
const CN_R = [[0, -0.22], [1, -0.22], [3.5, -0.12]];                                     // yaw damping Cnr
const CN_B = [[0, 0.10], [0.9, 0.10], [1.2, 0.08], [2, 0.065], [3.2, 0.045]];          // weathercock stability Cnb (fins lose bite supersonic)
const CL_B = [[0, -0.05], [1, -0.06], [2, -0.045], [3.5, -0.025]];                       // dihedral effect Clb
const CY_B = [[0, -0.5], [1.1, -0.6], [2, -0.45], [3.5, -0.3]];
const CM_DE = 0.7, CL_DE = 0.3, CL_DA = 0.1, CN_DR = 0.10, CY_DR = -0.12, CN_DA = -0.01, CL_R = 0.04, CN_P = -0.015, CM0 = 0.0;

// Control power follows the lift-curve slope (surface effectiveness ~ CL-alpha): the SR-71 is flown with small, slow inputs at Mach 3.
export const pitchEff = (M) => clamp(lerpTable(CLA, M) / 2.5, 0.35, 1);
export const rollEff = (M) => Math.pow(pitchEff(M), 1.6);
const yawEff = (M) => Math.pow(pitchEff(M), 0.6);
export const ELEVON_PITCH = CM_DE * DE_MAX; // Cm per unit elevon command (subsonic)
export const nominalSM = (M) => lerpTable(AC_TAB, M) - lerpTable(CG_SCHED, M); // static margin with the scheduled CG (fraction of MAC)

export function liftCoef(alpha, M) {
  const a = Math.abs(alpha), s = Math.sin(a), c = Math.cos(a);
  const att = lerpTable(CLA, M) * s * c + lerpTable(KV, M) * s * s * c; // potential + vortex lift (Polhamus)
  const w = smooth(0.46, 0.62, a);                                       // vortex burst: blend to flat plate
  return Math.sign(alpha) * (att * (1 - w) + 1.1 * Math.sin(2 * a) * w) + CL0 * (1 - w);
}

// J58 installed net thrust. g tables are thrust / (ambient pressure ratio x static thrust): ram recovery + inlet/ejector thrust
// make the bleed-bypass turbojet ramjet-like by M3 (thrust ~ 15x static x p/p0 at M3.2; sized for ~1.2-1.3 thrust/drag margin along the climb).
const G_DRY = [[0, 1.0], [0.6, 1.0], [0.9, 1.3], [1.05, 2.56], [1.2, 2.8], [1.5, 3.2], [1.8, 4.1], [2.1, 5.1], [2.4, 6.7], [2.7, 9.0], [3.0, 11.8], [3.2, 14.1], [3.5, 14.6], [3.8, 11.3]];
const G_AB = [[0, 1.0], [0.6, 1.0], [0.9, 1.3], [1.05, 2.8], [1.2, 3.1], [1.5, 3.8], [1.8, 4.8], [2.1, 6.0], [2.4, 7.8], [2.7, 10.2], [3.0, 13.0], [3.2, 15.0], [3.5, 15.5], [3.8, 12]];
// TSFC, lb/lbf/h (x 2.833e-5 = kg/N/s): turbojet-like dry, ~1.9-2.5 in A/B
const TSFC_DRY = [[0, 0.9], [1, 1.05], [2, 1.25], [3.2, 1.6]], TSFC_AB = [[0, 2.5], [1, 2.5], [2, 2.4], [3, 2.3], [3.5, 2.25]];
const LBH = 2.833e-5;
// One J58: dry = 0..1 (idle..military), ab = 0..1 afterburner (0.35 = minimum A/B once lit). atm = isa() result.
export function engineThrust(dry, ab, atm, M) {
  const d = atm.p / 101325, FD = SPEC.DRY / 2 * lerpTable(G_DRY, M), FA = SPEC.AB / 2 * lerpTable(G_AB, M);
  return d * ((0.05 + 0.95 * dry) * FD + ab * (FA - FD));
}
export const throttleSplit = (th) => ({ dry: Math.min(1, th / 0.75), ab: th > 0.75 ? 0.35 + 0.65 * (th - 0.75) / 0.25 : 0 });
// steady-state total thrust for a throttle setting (both engines, afterburner lit)
export function thrustAvail(th, atm, M) { const s = throttleSplit(th); return 2 * engineThrust(s.dry, s.ab, atm, M); }

const _r = new THREE.Vector3(), _t = new THREE.Vector3(), _I = new THREE.Vector3(), _cg = new THREE.Vector3(), _w2 = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const newEngine = () => ({ dry: 0, ab: 0, abLit: false, abTimer: 0, unstart: 0, thrust: 0, ff: 0, spike: 0, stress: 0 });

// Tyre force from combined slip: friction circle with a Pacejka-style sin(C atan(B s)) shape (peak at normalised slip s = 1).
const TYRE_C = 1.5, TYRE_B = Math.tan(Math.PI / (2 * TYRE_C)), MU_PEAK = 0.85, KAPPA_PK = 0.12, ALPHA_PK = Math.tan(8 * D2R), V_REG = 1.2;
const TB_MAX = 3.8e4; // N m per main wheel set at full pedal
function tyre(kappa, tanA, Fn) {
  const sx = kappa / KAPPA_PK, sy = tanA / ALPHA_PK, s = Math.hypot(sx, sy);
  if (s < 1e-9) return [0, 0];
  const f = MU_PEAK * Fn * Math.sin(TYRE_C * Math.atan(TYRE_B * s)) / s;
  return [f * sx, -f * sy];
}

export class FlightModel {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.w = new THREE.Vector3(); // body angular rate (rad/s)
    this.fuel = 25000; this.unlimitedFuel = false; this.fuelAft = 0; this.cgx = CG_MODEL.x;
    this.latDeg = 30; // latitude for the Coriolis term; main.js may update it after re-basing the origin
    this.throttle = 0; this.spool = 0;
    this.engines = [newEngine(), newEngine()]; // [left, right]
    this.gearPos = 1; this.gearDown = true;
    this.chute = 'stowed'; this.chuteOpen = 0;
    this.trim = 0;
    this.brakes = 0; this.parkingBrake = false; this.antiSkid = true;
    this.ctrl = { de: 0, da: 0, dr: 0 };   // commanded (stick / autopilot)
    this.sas = { de: 0, da: 0, dr: 0 };    // damper commands added to the pilot's
    this.sasOn = true;
    this.surf = { de: 0, da: 0, dr: 0 };   // actual surface positions (lagged, rate limited actuators), pilot + SAS
    this.realism = { unstarts: true };
    this.out = { V: 0, M: 0, qbar: 0, alpha: 0, beta: 0, rho: 1.225, a: 340, T: 288, nz: 1, buffet: 0 };
    this.onGround = false; this.crashed = null;
    this.contacts = [0, 0, 0]; this.compress = [0, 0, 0];
    this.wheel = [0, 0, 0]; this.brakePress = [0, 0, 0]; // wheel spin (rad/s), brake pressure 0..1
    this.alphaPrev = null; this.alphaDot = 0; this.exceed = 0; this.inletStress = 0; this.unstartCool = 0;
    this.events = [];
  }

  get mass() { return SPEC.EMPTY + this.fuel; }

  // Mass, CG (model x) and inertia from the empty airframe plus forward / aft fuel pools.
  massProps() {
    const aft = clamp(this.fuelAft, 0, Math.max(0, this.fuel)), fwd = Math.max(0, this.fuel - aft), m = SPEC.EMPTY + this.fuel;
    const cgx = (SPEC.EMPTY * X_E + fwd * X_F + aft * X_A) / m;
    const pool = (x, mm) => mm * (13 + (x - cgx) ** 2);
    const iyz = SPEC.EMPTY * (X_E - cgx) ** 2 + pool(X_F, fwd) + pool(X_A, aft);
    return { m, cgx, Ix: 0.42e6 + 9 * this.fuel, Iy: 3.55e6 + iyz, Iz: 3.25e6 + iyz };
  }

  // Automatic fuel-tank sequencing: pump fuel to the aft trim tank to put the CG at the scheduled %MAC for this Mach.
  scheduleCG(M, dt) {
    const xT = MAC_LE - lerpTable(CG_SCHED, M) * SPEC.C, m = this.mass;
    const aT = clamp((m * xT - SPEC.EMPTY * X_E - this.fuel * X_F) / (X_A - X_F), 0, Math.min(this.fuel, AFT_CAP));
    this.fuelAft = Math.min(this.fuel, this.fuelAft + clamp(aT - this.fuelAft, -XFER_RATE * dt, XFER_RATE * dt));
  }

  setEngines(th, lit) {
    const s = throttleSplit(th);
    for (const e of this.engines) { e.dry = s.dry; e.ab = lit ? s.ab : 0; e.abLit = lit && s.ab > 0; e.abTimer = 0; e.unstart = 0; }
    this.throttle = th;
  }

  reset(pos, headingDeg, speed, onGround, gammaDeg = 0) {
    this.pos.copy(pos);
    // heading 0 = north (-z), 90 = east (+x). Body +x is the nose.
    this.quat.setFromAxisAngle(UP, Math.PI / 2 - headingDeg * Math.PI / 180);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    this.vel.copy(fwd).multiplyScalar(speed);
    this.w.set(0, 0, 0);
    this.crashed = null; this.chute = 'stowed'; this.chuteOpen = 0; this.trim = 0;
    this.gearDown = onGround || speed < 120; this.gearPos = this.gearDown ? 1 : 0;
    this.setEngines(onGround ? 0 : (speed > 600 ? 0.95 : 0.55), true);
    this.surf = { de: 0, da: 0, dr: 0 }; this.ctrl = { de: 0, da: 0, dr: 0 }; this.sas = { de: 0, da: 0, dr: 0 };
    this.parkingBrake = false; this.contacts = [0, 0, 0]; this.compress = [0, 0, 0];
    this.wheel = GEAR.map((g) => this.gearDown ? speed / g.R : 0); this.brakePress = [0, 0, 0];
    this.alphaPrev = null; this.alphaDot = 0; this.exceed = 0; this.inletStress = 0; this.unstartCool = 0;
    const M = speed / isa(pos.y).a;
    this.scheduleCG(M, Infinity); this.cgx = this.massProps().cgx;
    for (const e of this.engines) { e.spike = smooth(1.6, 3.2, M); e.stress = 0; }
    this.spool = this.throttle;
    if (!onGround && speed > 30) this.trimLevel(gammaDeg);
  }

  // Trim for a steady straight path: angle of attack that carries the (centrifugally relieved) weight, the elevon that zeroes the
  // pitching moment about the current CG, and the throttle that balances drag along the flight path angle gamma.
  trimLevel(gammaDeg = 0) {
    const atm = isa(this.pos.y), V = this.vel.length(), M = V / atm.a, mp = this.massProps();
    const g = gammaDeg * D2R, qS = 0.5 * atm.rho * V * V * SPEC.S, eff = pitchEff(M);
    const W = mp.m * (gravityAt(this.pos.y) - V * V * Math.cos(g) ** 2 / (R_EARTH + this.pos.y)), need = W * Math.cos(g) / qS;
    const dAC = (MAC_LE - lerpTable(AC_TAB, M) * SPEC.C) - mp.cgx; // aerodynamic centre aft of the CG (negative x)
    let alpha = 0.05, dRad = 0, T = 0, CD = 0.02;
    for (let it = 0; it < 12; it++) {
      let lo = -0.05, hi = 0.45;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (liftCoef(mid, M) - CL_DE * eff * dRad < need) lo = mid; else hi = mid; }
      alpha = (lo + hi) / 2;
      const CN = need * Math.cos(alpha) + CD * Math.sin(alpha);
      CD = lerpTable(CD_FRIC, M) + lerpTable(CD_WAVE, M) + lerpTable(CD_INLET, M) + lerpTable(KIND, M) * need * need + 1.1 * Math.abs(Math.sin(alpha)) ** 3 + 0.018 * this.gearPos;
      T = CD * qS + W * Math.sin(g);
      // Cm = dAC/c * CN - thrust-line moment + CM_DE eff dE = 0
      dRad = clamp(((-dAC / SPEC.C) * CN + THRUST_LINE * T / (SPEC.C * qS) - CM0) / (CM_DE * eff), -DE_MAX * 1.2, DE_MAX * 1.2);
    }
    this.trim = clamp(dRad / DE_MAX, -0.6, 0.6);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), alpha + g));
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(fwd).applyAxisAngle(side, -alpha).multiplyScalar(V);
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (thrustAvail(mid, atm, M) < T) lo = mid; else hi = mid; }
    this.setEngines((lo + hi) / 2, true);
    this.spool = this.throttle;
  }

  updateEngines(dt, M, alpha, beta, atm) {
    const fuelOk = this.fuel > 0 || this.unlimitedFuel;
    const cmd = throttleSplit(this.throttle);
    const pBurn = atm.p * Math.pow(1 + 0.2 * M * M, 3.5) / 101325; // burner-inlet pressure ratio: sets spool rate and A/B light-off limits
    const spoolRate = clamp(0.55 + 0.45 * Math.sqrt(pBurn), 0.55, 1);
    // Inlet start margin: the shock must stay on the cowl lip. Boundaries shrink with Mach; spike lag behind the Mach schedule and
    // throttle chops (back-pressure) eat margin too. stress = 1 is the edge of the stable envelope.
    const spikeT = smooth(1.6, 3.2, M);
    const aMax = lerpTable([[2.3, 0.20], [3.0, 0.15], [3.5, 0.12]], M), bMax = lerpTable([[2.3, 0.08], [3.0, 0.055], [3.5, 0.04]], M);
    const sa = alpha > 0.03 ? (alpha - 0.03) / (aMax - 0.03) : (0.03 - alpha) / 0.10, sb = Math.abs(beta) / bMax;
    let worst = 0;
    this.engines.forEach((e, i) => {
      const target = fuelOk ? cmd.dry : 0, d0 = e.dry;
      // J58 spools from idle to military in about 6 s (slower at low burner pressure) and runs down a little faster
      e.dry += clamp((target - e.dry) / 1.3, -0.25, 0.16 * spoolRate) * dt;
      const wantAB = fuelOk && (cmd.ab > 0 || (e.abLit && this.throttle > 0.72)) && e.dry > 0.97 && e.unstart <= 0 && pBurn > (e.abLit ? 0.08 : 0.12);
      if (wantAB && !e.abLit) {
        e.abTimer += dt;
        if (e.abTimer > 0.9) { e.abLit = true; e.ab = 0; this.events.push({ type: 'ab-light', engine: i }); } // TEB ignition
      } else if (!wantAB) {
        if (e.abLit) this.events.push({ type: 'ab-out', engine: i });
        e.abLit = false; e.abTimer = 0;
      }
      e.ab += clamp((e.abLit ? Math.max(0.35, cmd.ab) : 0) - e.ab, -1.2 * dt, 0.45 * dt);
      e.spike += clamp(spikeT - e.spike, -0.05 * dt, 0.05 * dt);
      const bp = M > 2.3 ? 0.3 * Math.max(0, -(e.dry - d0) / dt - 0.1) / 0.15 : 0;
      e.stress = Math.hypot(sa, sb) + 4 * Math.abs(e.spike - spikeT) + bp;
      worst = Math.max(worst, e.stress);
      if (e.unstart > 0) {
        e.unstart -= dt;
        if (e.unstart <= 0) { e.unstart = 0; this.exceed = 0; this.unstartCool = 6; this.events.push({ type: 'restart', engine: i }); } // spike/bypass doors cycle and re-swallow the shock
      }
    });
    this.inletStress = M > 2.0 ? worst : 0;
    this.unstartCool = Math.max(0, this.unstartCool - dt); // refractory time after a restart while the airframe settles
    // Unstart: deterministic once the envelope is exceeded for a moment, plus a small random hazard (real unstarts were partly unpredictable).
    if (this.realism.unstarts && M > 2.3 && !this.onGround && this.unstartCool <= 0 && this.engines.every((e) => e.unstart <= 0)) {
      const s = this.inletStress;
      this.exceed = s > 1.2 ? this.exceed + (s - 1.2) * dt : Math.max(0, this.exceed - 0.5 * dt);
      if (Math.random() < (1.5e-4 + 0.08 * Math.max(0, s - 0.85) ** 2) * dt || this.exceed > 0.12) {
        const i = Math.abs(beta) > 0.02 ? (beta > 0 ? 1 : 0) : (Math.random() < 0.5 ? 0 : 1);
        const e = this.engines[i];
        e.unstart = 2.8; e.abLit = false; e.abTimer = 0; e.ab = 0; this.exceed = 0;
        this.events.push({ type: 'unstart', engine: i });
      }
    }
    this.spool = this.engines.reduce((s, e) => s + 0.75 * e.dry + (e.ab > 0 ? 0.25 * (e.ab - 0.35) / 0.65 + 0.0001 : 0), 0) / 2;
  }

  // Pitch / roll / yaw dampers. Like the real SR-71 SAS they command surfaces (summed with the pilot input before the
  // actuators), gain-scheduled so the added damping is constant as control power changes with q and Mach, and limited in authority.
  updateSas(qbar, M, I) {
    const s = this.sas;
    if (!this.sasOn) { s.de = s.da = s.dr = 0; return; }
    const qS = qbar * SPEC.S, fade = smooth(1200, 3500, qbar);
    const Mde = CM_DE * pitchEff(M) * qS * SPEC.C / I.z, Lda = CL_DA * rollEff(M) * qS * SPEC.B / I.x, Ndr = CN_DR * yawEff(M) * qS * SPEC.B / I.y;
    const kq = Math.min(1.5, 0.6 / Math.max(Mde, 1e-3)), kp = Math.min(1.5, 1.2 / Math.max(Lda, 1e-3)), kr = Math.min(1.5, 1.0 / Math.max(Ndr, 1e-3));
    s.de = clamp(-fade * kq * this.w.z / DE_MAX, -0.35, 0.35);
    s.da = clamp(-fade * kp * this.w.x / DA_MAX, -0.3, 0.3);
    s.dr = clamp(fade * kr * this.w.y / DR_MAX, -0.3, 0.3);
  }

  // groundAt(x, z) -> terrain height (m MSL) in world coordinates; wind = world-frame air velocity (m/s)
  step(dt, groundAt, wind) {
    if (this.crashed || !(dt > 0)) return;
    const { S, B: SPAN, C } = SPEC;
    _qi.copy(this.quat).invert();

    const air = this.vel.clone().sub(wind);
    const vb = air.clone().applyQuaternion(_qi);
    const V = vb.length();
    const atm = isa(this.pos.y), grav = gravityAt(this.pos.y);
    const M = V / atm.a, qbar = 0.5 * atm.rho * V * V;
    const alpha = V > 1 ? Math.atan2(-vb.y, vb.x) : 0;
    const beta = V > 1 ? Math.asin(clamp(vb.z / V, -1, 1)) : 0;
    if (this.alphaPrev == null) this.alphaPrev = alpha;
    this.alphaDot += (clamp((alpha - this.alphaPrev) / dt, -3, 3) - this.alphaDot) * Math.min(1, 20 * dt); this.alphaPrev = alpha;

    this.scheduleCG(M, dt);
    const mp = this.massProps(), m = mp.m, I = _I.set(mp.Ix, mp.Iy, mp.Iz);
    this.cgx = mp.cgx;
    const cgv = _cg.set(mp.cgx - CG_MODEL.x, 0, 0); // body points are stored relative to CG_MODEL
    this.updateEngines(dt, M, alpha, beta, atm);
    const gearTarget = this.gearDown ? 1 : 0;
    if (this.gearPos !== gearTarget) {
      this.gearPos += clamp(gearTarget - this.gearPos, -dt / 7, dt / 7);
      if (this.gearPos === gearTarget) this.events.push('gear-lock');
    }
    // actuators: pilot/autopilot + SAS command, 40 ms lag, rate limit (elevons ~36 deg/s, all-moving fins a little slower)
    this.updateSas(qbar, M, I);
    const act = (cur, cmd, rate) => cur + clamp((clamp(cmd, -1, 1) - cur) * dt / (0.04 + dt), -rate * dt, rate * dt);
    this.surf.de = act(this.surf.de, this.ctrl.de + this.sas.de, 2.0);
    this.surf.da = act(this.surf.da, this.ctrl.da + this.sas.da, 2.0);
    this.surf.dr = act(this.surf.dr, this.ctrl.dr + this.sas.dr, 1.5);
    const dE = clamp(this.surf.de + this.trim, -1, 1) * DE_MAX, dA = this.surf.da * DA_MAX, dR = this.surf.dr * DR_MAX; // rad; dE +ve = trailing edge up (nose up)

    // ground effect (McCormick): less induced drag, more lift, nose-down moment with the wing within about a span of the runway
    const hWing = Math.max(0.3, this.pos.y - 0.4 - groundAt(this.pos.x, this.pos.z));
    const r16 = (16 * hWing / SPAN) ** 2, ge = r16 / (1 + r16), gnd = 1 - ge;

    // ----- aerodynamic forces (body) -----
    const eff = pitchEff(M);
    const CL = liftCoef(alpha, M) * (1 + 0.15 * gnd) - CL_DE * eff * dE;
    const CD = lerpTable(CD_FRIC, M) + lerpTable(CD_WAVE, M) + lerpTable(CD_INLET, M) + lerpTable(KIND, M) * CL * CL * ge
      + 1.1 * Math.pow(Math.abs(Math.sin(alpha)), 3) + 0.018 * this.gearPos;
    const bC = clamp(beta, -0.6, 0.6), qS = qbar * S;
    const Cy = lerpTable(CY_B, M) * bC + CY_DR * yawEff(M) * dR;
    const fa = new THREE.Vector3(); // aerodynamic force, acting at the aerodynamic centre
    if (V > 0.5) {
      const d = vb.clone().divideScalar(V);
      const lift = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y);
      if (lift.lengthSq() > 1e-6) lift.normalize();
      const side = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z);
      if (side.lengthSq() > 1e-6) side.normalize();
      fa.addScaledVector(d, -qS * CD).addScaledVector(lift, qS * CL).addScaledVector(side, qS * Cy);
    }
    const fb = fa.clone();
    const fuelOk = this.fuel > 0 || this.unlimitedFuel;
    let thrust = 0;
    const mb = new THREE.Vector3();
    // The J58 fuel control holds the compressor inlet temperature to 427 C (the airframe and engine limit): the faster the jet goes the
    // hotter the ram air, and past about 410 C the control cuts fuel flow, which is what stops the real aircraft near Mach 3.3 in
    // standard air. In hot air the limit arrives at a lower Mach.
    const cit = atm.T * (1 + 0.2 * M * M) - 273.15, citT = Math.min(1, Math.max(0, (cit - 410) / 30)), citCut = 1 - citT * citT * (3 - 2 * citT);
    this.engines.forEach((e, i) => {
      e.thrust = fuelOk ? engineThrust(e.dry, e.ab, atm, M) * (e.unstart > 0 ? 0.25 : 1) * (this.citLimit === false ? 1 : citCut) : 0;
      thrust += e.thrust;
      const arm = i === 0 ? -ENGINE_ARM : ENGINE_ARM;
      mb.y += arm * e.thrust;               // asymmetric thrust yaws towards the weaker engine
      mb.z -= THRUST_LINE * e.thrust;
      if (e.unstart > 0) mb.y -= arm * 0.02 * qS; // spillage drag behind the unstarted inlet (~2x the lost thrust at M3.2)
    });
    fb.x += thrust;

    // ----- aerodynamic moments about the CG (body): x roll (+ = right wing down), y yaw (+ = nose left), z pitch (+ = nose up) -----
    // Static pitch stability is geometric: the normal force acts at the aerodynamic centre, so Cm_alpha = -CN_alpha (h_ac - h_cg).
    if (V > 1) {
      const Vk = Math.max(V, 20), bv = SPAN / (2 * Vk), cv = C / (2 * Vk);
      const p = this.w.x, q = this.w.z, r = -this.w.y; // standard p, q, r (r +ve = nose right)
      const hAC = lerpTable(AC_TAB, M) - 0.12 * smooth(0.25, 0.45, Math.abs(alpha)) * (1 - smooth(0.5, 0.8, Math.abs(alpha))) * (1 - smooth(1.2, 2.0, M))
        + 0.22 * smooth(0.55, 1.3, Math.abs(alpha)); // chine vortex lift: centre of pressure moves forward (pitch-up) in the 15-30 deg range; fully separated flow moves it aft (restoring)
      mb.z += ((MAC_LE - hAC * C) - mp.cgx) * fa.y;
      const Cm = CM0 + CM_DE * eff * (1 - 0.5 * smooth(0.3, 0.7, Math.abs(alpha))) * dE + // elevons lose bite in separated flow
         lerpTable(CM_Q, M) * q * cv + lerpTable(CM_AD, M) * this.alphaDot * cv - 0.08 * gnd * CL;
      mb.z += qS * C * Cm;
      const Cl = (lerpTable(CL_B, M) - 0.08 * Math.abs(CL) * (1 - smooth(1, 2.5, M))) * bC + lerpTable(CL_P, M) * p * bv + (CL_R + 0.15 * CL) * r * bv + CL_DA * rollEff(M) * dA;
      const armF = (mp.cgx + 13) / (CG_MODEL.x + 13); // fin arm shrinks as the CG moves aft
      const Cn = lerpTable(CN_B, M) * armF * bC + CN_P * p * bv + lerpTable(CN_R, M) * r * bv + CN_DR * yawEff(M) * dR + CN_DA * dA;
      mb.x += qS * SPAN * Cl;
      mb.y -= qS * SPAN * Cn;
    }

    const F = fb.clone().applyQuaternion(this.quat);
    const T = new THREE.Vector3();
    F.y -= m * grav;
    // Round-Earth terms in the local tangent plane (x east, y up, z south): centrifugal relief and Coriolis (Earth rotation)
    F.y += m * (this.vel.x * this.vel.x + this.vel.z * this.vel.z) / (R_EARTH + Math.max(0, this.pos.y));
    { const lat = this.latDeg * D2R, Oy = OMEGA_EARTH * Math.sin(lat), Oz = -OMEGA_EARTH * Math.cos(lat), v = this.vel;
      F.x -= 2 * m * (Oy * v.z - Oz * v.y); F.y -= 2 * m * (Oz * v.x); F.z -= 2 * m * (-Oy * v.x); }

    // ----- drag chute -----
    if (this.chute === 'deployed') {
      this.chuteOpen = Math.min(1, this.chuteOpen + dt / 1.5);
      const ias = V * Math.sqrt(atm.rho / 1.225);
      if (ias > 110) { this.chute = 'failed'; this.events.push('chute-fail'); }
      else if (V > 1) {
        const D = 0.5 * atm.rho * V * V * 45 * this.chuteOpen;
        const fc = air.clone().normalize().multiplyScalar(-D);
        F.add(fc);
        T.add(CHUTE_POINT.clone().sub(cgv).applyQuaternion(this.quat).cross(fc));
      }
    }

    // ----- landing gear: strut spring/damper + tyre with wheel spin, brake torque and anti-skid -----
    let onGround = false;
    const wWorld = _w.copy(this.w).applyQuaternion(this.quat);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const gs = this.vel.length();
    for (let i = 0; i < GEAR.length; i++) {
      const g = GEAR[i];
      const r = _r.copy(g.p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + r.x, py = this.pos.y + r.y, pz = this.pos.z + r.z;
      let pen = groundAt(px, pz) - py;
      const was = this.contacts[i];
      this.contacts[i] = 0; this.compress[i] = 0;
      if (pen <= 0 || this.gearPos < 0.98) {
        this.wheel[i] *= 1 - (this.gearPos < 0.98 ? 3 : 0.25) * dt; // wheels braked on retraction, windmilling otherwise
        this.brakePress[i] = 0;
        continue;
      }
      onGround = true;
      const vp = new THREE.Vector3().crossVectors(wWorld, r).add(this.vel);
      if (!was && vp.y < -0.3) this.events.push({ type: 'touch', vs: -vp.y, wheel: i });
      if (!was && vp.y < -5.5) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; }
      if (pen > 0.75) {
        if (vp.y < -3) { this.crash(`hard landing (${(-vp.y).toFixed(1)} m/s sink)`); return; }
        // ground rose under a slowly sinking wheel: finer elevation data arrived, not an impact
        this.pos.y += pen - 0.12; pen = 0.12;
      }
      const Fn = Math.max(0, g.k * pen - g.c * vp.y);
      this.contacts[i] = Fn; this.compress[i] = Math.min(0.4, pen);
      const fh = new THREE.Vector3(fwd.x, 0, fwd.z);
      if (fh.lengthSq() < 1e-6) fh.set(1, 0, 0);
      fh.normalize();
      if (g.steer) {
        const maxSteer = (3 + 32 * clamp(1 - gs / 40, 0, 1)) * D2R;
        fh.applyAxisAngle(UP, -this.ctrl.dr * maxSteer);
      }
      const right = new THREE.Vector3().crossVectors(fh, UP);
      const vLong = vp.dot(fh), vLat = vp.dot(right), vref = Math.max(Math.abs(vLong), V_REG);
      const om = this.wheel[i], tanA = vLat / vref, kap = (om * g.R - vLong) / vref;
      let [fx, fy] = tyre(kap, tanA, Fn);
      if (g.steer) fy *= 0.15 + 0.85 * (1 - smooth(15, 40, gs)); // nose wheel castors at speed: a loaded nose tyre ahead of the CG would be directionally unstable
      // Semi-implicit wheel update: tyre force linearised about the current slip (small-slip slope, so it stays stable past the peak
      // and at walking speed) and brake / rolling-resistance torque (opposing spin, smoothed through zero) solved together. The
      // airframe gets the same linearised force, so wheel and aircraft stay consistent.
      const dF = MU_PEAK * Fn * TYRE_B * TYRE_C / KAPPA_PK * g.R / vref;
      let demand = g.brake ? Math.max(this.brakes, this.parkingBrake ? 1 : 0) : 0;
      if (this.antiSkid && !this.parkingBrake && Math.abs(vLong) > 4) demand *= 1 - clamp((-kap - 0.10) / 0.10, 0, 1); // release as slip passes ~10 %
      this.brakePress[i] += (demand - this.brakePress[i]) * Math.min(1, dt / 0.12);
      const tqMax = TB_MAX * (this.parkingBrake ? 1.8 : 1) * this.brakePress[i] + 0.015 * Fn * g.R, th = Math.tanh(om / 0.2);
      const dom = -dt * (g.R * fx + tqMax * th) / (g.J + dt * g.R * dF + dt * tqMax * (1 - th * th) / 0.2);
      const fxEff = clamp(fx + dF * dom, -MU_PEAK * Fn, MU_PEAK * Fn);
      this.wheel[i] = Math.max(-5, om + dom);
      const Fg = new THREE.Vector3(0, Fn, 0).addScaledVector(fh, fxEff).addScaledVector(right, fy);
      F.add(Fg);
      T.add(r.clone().cross(Fg));
    }
    this.onGround = onGround;

    // ----- integrate: velocity-Verlet translation, Euler's equations + exponential-map quaternion update -----
    const a = F.multiplyScalar(1 / m);
    this.pos.addScaledVector(this.vel, dt).addScaledVector(a, 0.5 * dt * dt);
    this.vel.addScaledVector(a, dt);
    const tb = T.applyQuaternion(_qi).add(mb);
    const Iw = new THREE.Vector3(I.x * this.w.x, I.y * this.w.y, I.z * this.w.z);
    const gyro = new THREE.Vector3().crossVectors(this.w, Iw);
    const w0 = _w2.copy(this.w);
    this.w.x += (tb.x - gyro.x) / I.x * dt;
    this.w.y += (tb.y - gyro.y) / I.y * dt;
    this.w.z += (tb.z - gyro.z) / I.z * dt;
    _t.copy(w0).add(this.w).multiplyScalar(0.5);
    const ang = _t.length() * dt;
    if (ang > 1e-9) {
      _dq.setFromAxisAngle(_t.normalize(), ang);
      this.quat.multiply(_dq).normalize();
    }

    // fuel burn (forward pool; the pump keeps the aft tank on schedule). TSFC rises with ram temperature, A/B roughly doubles it
    let ffTotal = 0;
    for (const e of this.engines) {
      e.ff = e.thrust * (lerpTable(TSFC_DRY, M) + (lerpTable(TSFC_AB, M) - lerpTable(TSFC_DRY, M)) * e.ab) * LBH; ffTotal += e.ff;
    }
    if (!this.unlimitedFuel) this.fuel = Math.max(0, this.fuel - ffTotal * dt);

    // hard points
    for (const [name, p] of HARD) {
      const r = _r.copy(p).sub(cgv).applyQuaternion(this.quat);
      const px = this.pos.x + r.x, py = this.pos.y + r.y, pz = this.pos.z + r.z;
      const gy = groundAt(px, pz);
      if (py < gy - 0.05) {
        // parked or taxiing slowly when the terrain refines: lift clear instead of declaring a crash
        if (onGround && gs < 15 && Math.abs(this.vel.y) < 2) { this.pos.y += gy - py + 0.05; continue; }
        this.crash(`${name} hit the ground`); return;
      }
    }

    const nz = fb.y / (m * grav) + (onGround ? this.contacts.reduce((s, c) => s + c, 0) / (m * grav) : 0);
    const ias = V * Math.sqrt(atm.rho / 1.225);
    const buffet = smooth(0.2, 0.32, alpha) * 0.8 + (M > 0.93 && M < 1.1 ? 0.12 : 0)
      + (onGround ? Math.min(1, gs / 90) * 0.18 : 0) + this.gearPos * Math.max(0, ias - 140) / 120 * 0.25
      + (this.chute === 'deployed' ? 0.15 * this.chuteOpen : 0);
    const hCG = (MAC_LE - mp.cgx) / C, sm = lerpTable(AC_TAB, M) - hCG, Pde = CM_DE * eff * DE_MAX;
    // control-power read-outs for the autopilot's gain scheduling: angular accel per unit command, and elevator per g (static)
    const power = { pitchPower: Pde * qS * C / I.z, rollPower: CL_DA * rollEff(M) * DA_MAX * qS * SPAN / I.x, yawPower: CN_DR * yawEff(M) * DR_MAX * qS * SPAN / I.y,
      dePerG: qS > 1 ? Math.min(1.5, Math.max(sm, 0.02) * m * grav / (qS * Pde)) : 1.5 };
    this.out = { V, M, qbar, alpha, beta, rho: atm.rho, a: atm.a, T: atm.T, thrust, nz, CL, CD, buffet, ff: ffTotal, ias,
      cg: hCG, staticMargin: sm, inletStress: this.inletStress, ...power };
  }

  // kind: 'impact' (ground) or 'overstress' (in-flight break-up); the motion before the crash drives the wreck (crash.js)
  crash(why, kind = 'impact') {
    if (this.crashed) return;
    this.crashVel = this.vel.clone(); this.crashW = this.w.clone(); this.crashKind = kind;
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const speed = this.crashVel.length(), out = this.out || {};
    this.crashInfo = {
      kind, speed, horizontalSpeed: Math.hypot(this.crashVel.x, this.crashVel.z),
      verticalSpeed: this.crashVel.y, sinkRate: Math.max(0, -this.crashVel.y),
      pitch: Math.atan2(forward.y, Math.hypot(forward.x, forward.z)),
      bank: Math.atan2(-right.y, up.y), yaw: Math.atan2(forward.z, forward.x),
      airspeed: out.V || speed, mach: out.M || 0, dynamicPressure: out.qbar || 0,
      angleOfAttack: out.alpha || 0, sideslip: out.beta || 0, loadFactor: out.nz || 1,
      fuel: this.fuel, gearDown: this.gearDown, gearPosition: this.gearPos,
      mass: this.mass, kineticEnergy: 0.5 * this.mass * speed * speed,
    };
    this.crashed = why; this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.events.push('crash');
  }
}
