export const cloudTop = (base, cover) => base + 700 + 1100 * cover;
export const clearSkyEdge = (cover) => {
  const t = Math.min(1, Math.max(0, (cover - 0.85) / 0.15));
  return 0.38 - 0.03 * t * t * (3 - 2 * t);
};
export const CLEAR_SKY_WIDTH = 0.08;

// Where the cloud field sits on the Earth. The clouds are drawn at (position relative to the world origin) + anchor - wind * time, and the
// world origin moves to every spawn, so without an anchor every flight, at every airport, on every day, showed the same cloud field round
// the aircraft. The anchor is the origin's absolute position (same map projection as geo.js) plus a per-day shift: the same place on the
// same day shows the same sky, other places and other days do not. Wrapped to ANCHOR_WRAP so the GPU's 32-bit floats stay precise
// (a wrap boundary only matters between two origins, never inside one flight). evo0 starts the clouds' slow growth at a per-day phase.
export const ANCHOR_WRAP = 524288;
// The cloud field's offset (anchor + camera - wind * time) is ~10^5-10^6 m. Fed to the GPU whole, every noise lookup started at a texture
// coordinate in the hundreds (tens of thousands of texels), where the Direct3D texture units' fixed-point addressing (Chrome on Windows)
// made the clouds grainy and flicker. The noise textures repeat every 1.0, so the shaders get only the fractional part of offset * scale
// for each lookup (worked out here in double precision) and add it to coordinates built from small camera-relative positions.
const fr = (v) => v - Math.floor(v);
// ox, oz: offset in metres. Returns [cumulus 3400 m, rotated 8800 m] [rotated 26000 m, detail 900 m] [cirrus 26000/7000 m, cirrus 9500/3000 m]
export function cloudTexOffsets(ox, oz, out = [new Float64Array(4), new Float64Array(4), new Float64Array(4)]) {
  const [a, b, c] = out;
  a[0] = fr(ox / 3400); a[1] = fr(oz / 3400); a[2] = fr((0.8 * ox - 0.6 * oz) / 8800); a[3] = fr((0.6 * ox + 0.8 * oz) / 8800);
  b[0] = fr((0.28 * ox + 0.96 * oz) / 26000); b[1] = fr((-0.96 * ox + 0.28 * oz) / 26000); b[2] = fr(ox / 900); b[3] = fr(oz / 900);
  c[0] = fr(ox / 26000); c[1] = fr(oz / 7000); c[2] = fr(ox / 9500); c[3] = fr(oz / 3000);
  return out;
}
const R_EARTH_M = 6371000, D2R_ = Math.PI / 180;
const hash01 = (n) => { let s = (n * 2654435761) >>> 0; s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0; s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0; return ((s ^ (s >>> 16)) >>> 0) / 4294967296; };
export function cloudAnchor(lat0, lon0, date = new Date()) {
  const day = Math.floor(date.getTime() / 86400000), wrap = (v) => ((v % ANCHOR_WRAP) + ANCHOR_WRAP) % ANCHOR_WRAP;
  const x = lon0 * D2R_ * R_EARTH_M * Math.cos(lat0 * D2R_), z = -lat0 * D2R_ * R_EARTH_M;
  return { x: wrap(x + hash01(day) * ANCHOR_WRAP), z: wrap(z + hash01(day + 7919) * ANCHOR_WRAP), evo0: hash01(day + 104729) * 64, day };
}
