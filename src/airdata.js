const GAMMA = 1.4, R_AIR = 287.05, P0 = 101325, A0 = 340.294, KT = 1 / 0.514444;

export function staticPressure(rho, T) { return rho * R_AIR * T; }

export function pitotImpactPressure(M, p) {
  if (M <= 0) return 0;
  if (M < 1) return p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return p * (166.92158 * Math.pow(M, 7) / Math.pow(7 * M * M - 1, 2.5) - 1);
}

export function calibratedAirspeed(M, p) {
  const qc = pitotImpactPressure(M, p);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}

export function airData({ V = 0, M = 0, rho = 1.225, T = 288.15 }) {
  const p = staticPressure(rho, T);
  return { tas: V, eas: V * Math.sqrt(rho / 1.225), cas: calibratedAirspeed(M, p), p };
}

export const toKnots = (ms) => ms * KT;
export { GAMMA };

// Cockpit IAS is approximated by CAS: position/instrument-error tables are not
// modeled. The SR-71 controller's published schedule is deliberately in EAS.
export function controlAirspeed(type, out) {
  const data = airData(out);
  return type === 'sr71' || type === 'a380x' ? data.eas : data.cas; // A380X retains its archival behavior
}

// Inverse pitot conversion for spawn/selected-speed inputs, not a density-only
// EAS conversion. Bisection also handles the existing supersonic pitot branch.
export function trueAirspeedFromCas(cas, { rho, T, a = Math.sqrt(GAMMA * R_AIR * T) }) {
  if (!(cas > 0)) return 0;
  const p = staticPressure(rho, T);
  let lo = 0, hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (calibratedAirspeed(mid, p) < cas) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2 * a;
}
