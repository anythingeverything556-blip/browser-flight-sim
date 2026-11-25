// Basic game autopilot tuned to the A380 companion dynamics; not FlyByWire avionics or autoland.
import { A380X, stallAlpha, a380xLift } from './a380x.js';

const KT = 1.943844, FT = 3.28084, G = 9.80665;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// protection angles track the wing's stall angle for the flap and slat setting: on 4.5 deg short of it, full 0.3 deg short of it, released 4.6 deg short
const prot = (fdm, M) => { const as = stallAlpha(fdm.flaps || 0, fdm.slats || 0, M, (fdm.mx && fdm.mx.clmax) || 1); return { aOn: as - 0.045, aMax: as - 0.005, aSafe: as - 0.08 }; };

export const A380X_AP = {
  iasLimit: A380X.VMO / KT, machLimit: A380X.MMO, citLimit: Infinity,
  prot,
  // 1 g equivalent airspeed at the protection angle, for the weight and flaps
  vmin: (fdm, M) => Math.sqrt(2 * (fdm.mass || A380X.MTOW) * G / (1.225 * A380X.S * Math.max(0.3, a380xLift(prot(fdm, M).aOn, fdm.flaps || 0, fdm.slats || 0, M, (fdm.mx && fdm.mx.clmax) || 1)))),
  climbIas: () => 280 / KT, // the best climb speed, 450 km/h (the manual's three-engine climb speed is the same figure)
  vFloor: 60,
  kiDiv: (V) => clamp(15 + (V - 60) * 0.1, 15, 30),
  bank: () => 25, locBank: 15,
  hdgGain: 0.04, locHdgGain: 0.06,
  rollKp: 0.35, rollKd: 1.1,     // slow, heavy roll loop: the wing's roll power per unit aileron is a fortieth of the Vision Jet's
  locKi: 0.003, locKp: 0.04,
  spdGain: 25,
  protSink: 6,
  recNz: () => 1.4, recSpdMax: 230 / KT,
  gaSpd: [150 / KT, 180 / KT], gaClimb: 1000 / FT,
  target: { alt: 8000 / FT, hdg: 0, spd: 280 / KT, mach: 0.85, vsLimit: 1800 / 196.85, vs: 0 },
};
// approach speed: 1.3 x the landing-configuration stall speed (about VREF 300 km/h at 210 t, scaling with the square root of the weight) + 10 kt
export const a380xVrefKt = (mass) => A380X.VREF_210 * Math.sqrt(mass / A380X.MTOW);
