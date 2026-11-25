// International Standard Atmosphere up to 32 km (enough for the SR-71's 26 km ceiling), isothermal above.
const Rs = 287.053, GAMMA = 1.4;
export const G0 = 9.80665, R_EARTH = 6371000, OMEGA_EARTH = 7.2921159e-5;
export const RHO0 = 1.225;

// Inverse-square gravity at geometric height h above mean sea level.
export const gravityAt = (h) => { const k = R_EARTH / (R_EARTH + Math.max(0, h)); return G0 * k * k; };

export function isa(h) {
  h = Math.max(-500, h);
  h = R_EARTH * h / (R_EARTH + h); // ISA tables are in geopotential altitude
  let T, p;
  if (h < 11000) {
    T = 288.15 - 0.0065 * h;
    p = 101325 * Math.pow(T / 288.15, G0 / (0.0065 * Rs));
  } else if (h < 20000) {
    T = 216.65;
    p = 22632.1 * Math.exp(-G0 * (h - 11000) / (Rs * T));
  } else {
    T = 216.65 + 0.001 * (Math.min(h, 32000) - 20000);
    p = 5474.89 * Math.pow(T / 216.65, -G0 / (0.001 * Rs));
    if (h > 32000) p *= Math.exp(-G0 * (h - 32000) / (Rs * T));
  }
  const rho = p / (Rs * T);
  return { T, p, rho, a: Math.sqrt(GAMMA * Rs * T) };
}
