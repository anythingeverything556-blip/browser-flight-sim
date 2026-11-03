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
