import { ELEVON_PITCH, SPEC, nominalSM, pitchEff } from './flight.js';

const Qu = (s, t, e) => Math.min(e, Math.max(t, s)),
  r0 = (s, t, e) => {
    const n = Qu((e - s) / (t - s), 0, 1);
    return n * n * (3 - 2 * n);
  },
  Zw = 2.6,
  Kw = 45e3 * 9.80665;
function stickGearing(s, t, e) {
  const n = Math.max(1500, t),
    i = e || 0,
    r = (Math.max(nominalSM(i), 0.03) * Kw) / (n * SPEC.S * ELEVON_PITCH * pitchEff(i)),
    a = Math.max(Qu(Zw * r, 0.08, 1), 0.65 * (1 - r0(6e3, 12e3, n)));
  return s * (s > 0 ? a : Math.min(1, a * 1.4));
}
function rollGearing(s, t, e = 0) {
  const n = Qu(Math.pow(8e3 / Math.max(1500, t), 0.6), 0.3, 1) * (1 - 0.35 * r0(1.5, 3, e));
  return s * n;
}

export { rollGearing, stickGearing };
