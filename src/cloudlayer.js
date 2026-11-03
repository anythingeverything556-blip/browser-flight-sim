export const cloudTop = (base, cover) => base + 700 + 1100 * cover;
export const clearSkyEdge = (cover) => {
  const t = Math.min(1, Math.max(0, (cover - 0.85) / 0.15));
  return 0.38 - 0.03 * t * t * (3 - 2 * t);
};
export const CLEAR_SKY_WIDTH = 0.08;
