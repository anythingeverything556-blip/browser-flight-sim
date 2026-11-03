import * as THREE from 'three';

// Skyhawk hands-off assist (main.js applies it when the setting is on): the aileron and rudder commands for the axes the pilot has let go.
// f: the flight model (quat, w body rates, out.V / out.beta, onGround); ax: stick axes; h: state kept between frames.
//
// One held heading is kept from the runway into the air: it is captured once the roll and rudder axes are both let go (in the air, once the
// wings are level and the turn has stopped) and dropped by any roll or rudder input. On the ground the rudder and nose wheel hold it; in the
// air the rudder keeps the ball centred and the ailerons bank gently (at most 10 deg) back onto it, so gusts and the engine's torque do not
// leave the aircraft in a slow turn. Nothing resets at lift-off: the old ground / air split restarted both loops there, and full-power
// torque swung the nose left at every take-off (and at every bounce).
const _fw = new THREE.Vector3(), _right = new THREE.Vector3();
const clamp = (v, a) => Math.max(-a, Math.min(a, v));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const FREE = 0.02, BANK_MAX = 0.17, RAMP = 0.5;
export const HOLD_GAINS = { KP: 0.4, KD: 0, RATE_TAU: 1 };

export function c172HandsOffCommand(f, ax, h, dt) {
  h.roll = h.roll || 0; h.yaw = h.yaw || 0; h.rollI = h.rollI || 0; h.yawI = h.yawI || 0; h.gndI = h.gndI || 0;
  if (h.hold === undefined) h.hold = null;
  _fw.set(1, 0, 0).applyQuaternion(f.quat); _right.set(0, 0, 1).applyQuaternion(f.quat);
  const bank = Math.asin(clamp(-_right.y, 1)), hdg = Math.atan2(_fw.z, _fw.x), w = f.w, V = (f.out && f.out.V) || 0;
  // on the ground the nose wheel steers by groundspeed (a slow roll at idle has next to no airspeed near the ground)
  const moving = f.onGround ? Math.hypot(f.vel.x, f.vel.z) > 0.3 : V > 2;
  const rollFree = Math.abs(ax.roll) < FREE, yawFree = Math.abs(ax.yaw) < FREE;
  // heading error, in the sense of the body yaw rate (w.y > 0 turns the nose toward -z, which lowers hdg)
  if (!rollFree || !yawFree) h.hold = null;
  else if (h.hold === null && moving && (f.onGround || (Math.abs(bank) < 0.05 && Math.abs(w.y) < 0.03))) h.hold = hdg;
  const err = h.hold === null ? 0 : wrapPi(h.hold - hdg);
  const out = { da: null, dr: null };

  // ailerons: wings level (on the ground and in the air alike, so it is already flying at lift-off), banked a little toward the held heading
  if (rollFree && V > 15) {
    h.roll = Math.min(1, h.roll + dt / RAMP);
    // the error's rate, low-passed over ~2 s (the body yaw rate carries the turbulence's yaw wobble straight into the bank)
    const rate = h.lastErr === undefined ? 0 : wrapPi(err - h.lastErr) / Math.max(dt, 1e-4); h.lastErr = err;
    h.rate = (h.rate || 0) + (rate - (h.rate || 0)) * Math.min(1, dt / HOLD_GAINS.RATE_TAU);
    const want = f.onGround ? 0 : clamp(HOLD_GAINS.KP * err + HOLD_GAINS.KD * h.rate, BANK_MAX), e = bank - want;
    // a slow integral trims out the steady torque (a proportional leveller alone leaves a few tenths of a degree of bank: a slow turn)
    h.rollI = clamp(h.rollI + e * dt * h.roll, 0.3);
    out.da = h.roll * clamp(-1.2 * e - 0.4 * w.x - 0.6 * h.rollI, 0.4);
  } else { h.roll = 0; h.rollI = 0; h.rate = 0; h.lastErr = undefined; }

  // rudder: holds the heading on the ground; in the air centres the ball. Both terms are blended over the first metres of the climb (the
  // tyres leave the ground several times in a bouncy lift-off) and keep their state across the change
  if (yawFree && moving) {
    h.yaw = Math.min(1, h.yaw + dt / RAMP);
    const g = f.onGround ? 1 : 0; h.gnd = h.gnd === undefined ? g : h.gnd + clamp(g - h.gnd, dt / 1.5);
    h.gndI = clamp(h.gndI + err * dt * h.yaw * h.gnd, 0.3);
    const ground = 2 * err + 1.2 * w.y + 0.6 * h.gndI;
    const beta = (f.out && f.out.beta) || 0;
    h.yawI = clamp(h.yawI + beta * dt * h.yaw * (1 - h.gnd), 0.3);
    const air = 3 * beta + 0.3 * w.y + 1.5 * h.yawI;
    out.dr = h.yaw * clamp(h.gnd * ground + (1 - h.gnd) * air, 0.5);
  } else { h.yaw = 0; h.yawI = 0; h.gndI = 0; }
  return out;
}
