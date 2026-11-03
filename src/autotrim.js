// Automatic pitch trim. Without it the jet needs a different elevon trim at every speed, altitude and Mach (0.05-0.22 of full travel across the
// envelope), so a stick let go after a speed change or a climb pulls the nose down or up: the "nose heavy" feel, and a climb that will not stay up.
// While the stick is idle the trim integrates the pitch rate to zero, so whatever attitude the pilot left it at is the one it keeps.
// The integrator is divided by the control power so the loop has the same time constant everywhere in the envelope.

export const AT = {
  idleAfter: 0.35,   // s of idle stick before the trim starts to move
  rate: 0.25,        // 1/s: pitch rate decays with this time constant's inverse
  maxStep: 0.08,     // largest trim change per second (fraction of full travel)
  alphaSoft: 0.17,   // rad: above this trimming nose-up is blocked ...
  alphaHard: 0.23,   // ... and above this it trims nose-down (the stall protection onset)
  limit: 0.6,
};

export function makeAutoTrim() { return { idle: 0 }; }

// s: state from makeAutoTrim; in: { trim, q (rad/s, + = nose up), power (rad/s^2 per unit elevon command), alpha, stick, V, onGround, enabled, dt }
export function autoTrimStep(s, i, cfg = AT) {
  if (!i.enabled || i.onGround || i.V < 50 || Math.abs(i.stick) > 0.03) { s.idle = 0; return i.trim; }
  s.idle += i.dt;
  if (s.idle < cfg.idleAfter) return i.trim;
  const p = Math.max(0.3, i.power || 1);
  let d = -cfg.rate * i.q / p;                       // nulls the pitch rate
  if (i.alpha > cfg.alphaSoft && d > 0) d = 0;        // never trim into a stall
  if (i.alpha > cfg.alphaHard) d = -cfg.maxStep * 0.5 * Math.min(1, (i.alpha - cfg.alphaHard) / 0.05 + 0.2);
  d = Math.max(-cfg.maxStep, Math.min(cfg.maxStep, d));
  return Math.max(-cfg.limit, Math.min(cfg.limit, i.trim + d * i.dt));
}
