// Exit within an aircraft-specific toy-sim EAS envelope, preserving the entry speed where safe.
export const SLEW_MIN_EAS = 120;
const EAS_RANGE = { f27: [50, 125], c172: [30, 75], da40: [32, 80], sf50: [60, 120], il76: [90, 180], sr71: [SLEW_MIN_EAS, Infinity] };
export function slewExitSpeed(entrySpeed, altM, aircraft = 'sr71') {
  const sigma = Math.exp(-Math.max(0, altM) / 8500), [lo, hi] = EAS_RANGE[aircraft] || EAS_RANGE.sr71;
  const speed = Number.isFinite(entrySpeed) ? entrySpeed : 0;
  return Math.max(lo, Math.min(hi, speed * Math.sqrt(sigma))) / Math.sqrt(sigma);
}
export function slewExit(fdm, entrySpeed, agl, aircraft = 'sr71') {
  fdm.w.set(0, 0, 0);
  if (!(agl > 5)) { fdm.vel.set(0, 0, 0); return; }
  fdm.vel.set(1, 0, 0).applyQuaternion(fdm.quat).multiplyScalar(slewExitSpeed(entrySpeed, fdm.pos.y, aircraft));
}
