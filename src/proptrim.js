// Steady airborne trim for the two piston trainers. Match the pitch moment
// in their step() equations: propwash increases tail pressure, and the thrust
// line above the CG adds a nose-down moment. No live state changes here.
export function solvePropTrim({ qbar, area, chord, weight, gamma, flapMoment, flapDrag, lift, stallAngle,
  liftElevator, moment0, momentAlpha, momentElevator, drag0, inducedDrag, propArea, thrustArm, upTravel, downTravel }) {
  const qS = qbar * area;
  let alpha = 0, de = 0, thrust = 0;
  for (let i = 0; i < 12; i++) {
    const need = (weight * Math.cos(gamma) - thrust * Math.sin(alpha)) / qS;
    let lo = -0.2, hi = stallAngle - 0.005;
    for (let j = 0; j < 27; j++) {
      const mid = (lo + hi) / 2;
      if (lift(mid) - liftElevator * de < need) lo = mid; else hi = mid;
    }
    alpha = (lo + hi) / 2;
    thrust = Math.max(0, ((drag0 + flapDrag + inducedDrag * need ** 2) * qS + weight * Math.sin(gamma)) / Math.cos(alpha));
    const tailRatio = 1 + 0.55 * thrust / (propArea * qbar);
    const moment = moment0 + momentAlpha * alpha + flapMoment - thrustArm * thrust / (qS * chord);
    de = Math.max(-downTravel, Math.min(upTravel, -moment / (momentElevator * tailRatio)));
  }
  return { alpha, thrust, trim: Math.max(-1, Math.min(1, de / (0.6 * (de >= 0 ? upTravel : downTravel)))) };
}
