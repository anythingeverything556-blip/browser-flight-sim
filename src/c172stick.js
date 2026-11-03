// Skyhawk stick feel for keyboard, mouse and gamepad. A light aircraft's elevator gets heavy with speed: the same pull
// that rotates at 55 kt overstresses the airframe at 120 kt. So the commanded elevator is scheduled with dynamic
// pressure (full travel up to ~70 KIAS, about a third at cruise) and slewed, so a key tap is a firm nudge, not a jolt.
export const C172_STICK = {
  FULL_KIAS: 70,       // full elevator authority at or below this speed (rotation, flare, stall recovery)
  MIN_AUTH: 0.32,      // never less than this, so a determined pull still reaches the g limit near Vne
  PITCH_EXP: 1.6,      // centre softness: small inputs make small changes
  ROLL_EXP: 1.4,
  PITCH_SLEW: 2.4,     // command units per second (0 -> full in ~0.4 s)
  ROLL_SLEW: 4,
};

// Vision Jet: stalls at 84 KIAS and flies to 250, so full authority holds a little longer; the floor still reaches the +3.6 g limit near VMO without breaking the airframe
export const SF50_STICK = { ...C172_STICK, FULL_KIAS: 95, MIN_AUTH: 0.24 };

const shape = (v, e) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), e);
const slew = (cur, target, rate, dt) => cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));

export function c172PitchAuthority(kias, cfg = C172_STICK) {
  const k = cfg.FULL_KIAS / Math.max(cfg.FULL_KIAS, kias);
  return Math.max(cfg.MIN_AUTH, k * k);
}

// axes: { pitch, roll } in [-1, 1]; state: a plain object kept across frames (reset it at every spawn).
export function c172Stick(state, axes, kias, dt, cfg = C172_STICK) {
  const de = shape(axes.pitch, cfg.PITCH_EXP) * c172PitchAuthority(kias, cfg);
  const da = shape(axes.roll, cfg.ROLL_EXP);
  state.de = slew(state.de || 0, de, cfg.PITCH_SLEW, dt);
  state.da = slew(state.da || 0, da, cfg.ROLL_SLEW, dt);
  return state;
}
