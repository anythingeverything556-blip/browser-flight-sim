// Leaving slew mode: the jet keeps flying along its nose instead of being left with zero airspeed (slew-off used to set vel to 0 and the jet fell
// out of the sky). Below 5 m it stays put. The speed is the one it had when slew started, at least 120 m/s equivalent airspeed at the new altitude.
export const SLEW_MIN_EAS = 120;
export function slewExitSpeed(entrySpeed, altM) {
  const sigma = Math.exp(-Math.max(0, altM) / 8500);
  return Math.max(entrySpeed || 0, SLEW_MIN_EAS / Math.sqrt(sigma));
}
export function slewExit(fdm, entrySpeed, agl) {
  fdm.w.set(0, 0, 0);
  if (!(agl > 5)) { fdm.vel.set(0, 0, 0); return; }
  fdm.vel.set(1, 0, 0).applyQuaternion(fdm.quat).multiplyScalar(slewExitSpeed(entrySpeed, fdm.pos.y));
}
