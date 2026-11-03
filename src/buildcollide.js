// Solid buildings: the jet's hard points are swept against the building meshes every frame.
//
// Each building is a range of vertices (bStart / bCount) in its tile's mesh, in tile-local coordinates (x east, scaled by mesh.scale.x; z south; y absolute height).
// A per-building bounding box is built once per tile (and again when the terrain heights refit the mesh) and is the broad phase; a hit on it is confirmed
// against the building's own triangles, so flying through a courtyard or between two towers is not a crash, but a wall, a roof or a corner is.
import * as THREE from 'three';
import { HARD, CG_MODEL } from './flight.js';
import { C172_HARD, C172_CG, C172_GEAR } from './c172.js';
import { SF50_HARD, SF50_CG, SF50_GEAR } from './sf50.js';

// airframe points that must never touch a building: the 13 ground-contact hard points plus mid-wing and wing-root points the wings sweep through
const EXTRA = [[-6, 2.0, -4.5], [-6, 2.0, 4.5], [-2, 2.0, -2.5], [-2, 2.0, 2.5]].map(([x, y, z]) => new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z));
export const COLLIDE_POINTS = [...HARD.map((h) => h[1]), ...EXTRA];
const PAD = 0.6; // metres of skin around a point
// Skyhawk: its 8 hard points, the three wheels, and the high wing at mid-span, the wing roots over the cabin and the stabiliser tips
const C172_EXTRA = [[-1.4, 1.95, -2.8], [-1.4, 1.95, 2.8], [-1.2, 2.0, -0.6], [-1.2, 2.0, 0.6], [-6.2, 1.15, -1.7], [-6.2, 1.15, 1.7]]
  .map(([x, y, z]) => new THREE.Vector3(x - C172_CG.x, y - C172_CG.y, z - C172_CG.z));
export const C172_COLLIDE_POINTS = [...C172_HARD.map((h) => h[1]), ...C172_GEAR.map((g) => g.p), ...C172_EXTRA];
export const C172_PAD = 0.35;
// Vision Jet: its 9 hard points, the three wheels, mid-wing, the wing roots and the cabin roof
const SF50_EXTRA = [[0.6, 1.3, -3.0], [0.6, 1.3, 3.0], [1.2, 1.4, -1.2], [1.2, 1.4, 1.2], [1.7, 2.3, 0]]
  .map(([x, y, z]) => new THREE.Vector3(x - SF50_CG.x, y - SF50_CG.y, z - SF50_CG.z));
export const SF50_COLLIDE_POINTS = [...SF50_HARD.map((h) => h[1]), ...SF50_GEAR.map((g) => g.p), ...SF50_EXTRA];
export const SF50_PAD = 0.4;

export function buildingBoxes(tile) {
  const pos = tile.mesh.geometry.attributes.position, arr = pos.array, ver = pos.version ?? 0;
  if (tile.cb && tile.cbVer === ver) return tile.cb;
  const n = tile.count, b = new Float32Array(n * 6); let maxY = -1e9;
  for (let d = 0; d < n; d++) {
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let v = tile.bStart[d], e = v + tile.bCount[d]; v < e; v++) {
      const x = arr[v * 3], y = arr[v * 3 + 1], z = arr[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    b.set([x0, y0, z0, x1, y1, z1], d * 6); if (y1 > maxY) maxY = y1;
  }
  tile.cb = b; tile.cbVer = ver; tile.cbMaxY = maxY; return b;
}

// segment p0 -> p0 + d against the box (slab test), padded
export function segBox(px, py, pz, dx, dy, dz, b, o, pad) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const p = k === 0 ? px : k === 1 ? py : pz, d = k === 0 ? dx : k === 1 ? dy : dz, lo = b[o + k] - pad, hi = b[o + 3 + k] + pad;
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, c = (hi - p) / d; if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return false;
  }
  return true;
}

// Moller-Trumbore, segment form: does p + t d (0 <= t <= 1) cross the triangle at vertices i, j, k of arr?
export function segTri(px, py, pz, dx, dy, dz, arr, i, j, k) {
  const ax = arr[i * 3], ay = arr[i * 3 + 1], az = arr[i * 3 + 2];
  const e1x = arr[j * 3] - ax, e1y = arr[j * 3 + 1] - ay, e1z = arr[j * 3 + 2] - az, e2x = arr[k * 3] - ax, e2y = arr[k * 3 + 1] - ay, e2z = arr[k * 3 + 2] - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x, det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det, sx = px - ax, sy = py - ay, sz = pz - az, u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t >= 0 && t <= 1;
}

export class BuildingCollider {
  // points: airframe points relative to the CG (flight-model frame); pad: metres of skin around each
  constructor(points = COLLIDE_POINTS, pad = PAD) { this.points = points; this.pad = pad; this.prev = null; this.pts = points.map(() => new THREE.Vector3()); this.hit = null; this.checks = 0; this.broad = true; this.cand = new Int32Array(256); }
  reset() { this.prev = null; }
  // tiles: Buildings.tiles (Map); fdm: pos, quat. Returns { tile, building, point } for the first crossing, else null.
  test(tiles, fdm) {
    const P = this.points, n = P.length;
    if (!this.prev) this.prev = new Float64Array(n * 3);
    const cur = this.pts, prev = this.prev, fresh = !this.hasPrev; let teleport = false;
    for (let i = 0; i < n; i++) cur[i].copy(P[i]).applyQuaternion(fdm.quat).add(fdm.pos);
    if (fresh) teleport = true; else if (Math.hypot(cur[0].x - prev[0], cur[0].y - prev[1], cur[0].z - prev[2]) > 250) teleport = true;
    let result = null;
    if (!teleport) {
      for (const tile of tiles.values()) {
        if (!tile.mesh || !tile.sited || tile.uploaded === false || !tile.bStart || !tile.count) continue;
        const sx = tile.mesh.scale.x || 1;
        if (Math.abs(fdm.pos.x - tile.wx) > (tile.W || 1500) * 0.5 * sx + 400 || Math.abs(fdm.pos.z - tile.wz) > (tile.H || 1500) * 0.5 + 400) continue;
        const boxes = buildingBoxes(tile), arr = tile.mesh.geometry.attributes.position.array;
        if (fdm.pos.y - 20 > tile.cbMaxY) continue; // above every roof in the tile
        let cn = tile.count, cand = null;
        if (this.broad) {
          let ax0 = 1e9, ay0 = 1e9, az0 = 1e9, ax1 = -1e9, ay1 = -1e9, az1 = -1e9;
          for (let i = 0; i < n; i++) {
            const o = i * 3, px = (prev[o] - tile.wx) / sx, pz = prev[o + 2] - tile.wz, qx = (cur[i].x - tile.wx) / sx, qz = cur[i].z - tile.wz, py = prev[o + 1], qy = cur[i].y;
            if (px < ax0) ax0 = px; if (px > ax1) ax1 = px; if (qx < ax0) ax0 = qx; if (qx > ax1) ax1 = qx;
            if (py < ay0) ay0 = py; if (py > ay1) ay1 = py; if (qy < ay0) ay0 = qy; if (qy > ay1) ay1 = qy;
            if (pz < az0) az0 = pz; if (pz > az1) az1 = pz; if (qz < az0) az0 = qz; if (qz > az1) az1 = qz;
          }
          const m = this.pad + 1e-6; ax0 -= m; ay0 -= m; az0 -= m; ax1 += m; ay1 += m; az1 += m;
          if (this.cand.length < tile.count) this.cand = new Int32Array(tile.count * 2);
          cand = this.cand; cn = 0;
          for (let d = 0, o = 0; d < tile.count; d++, o += 6) if (boxes[o] <= ax1 && boxes[o + 3] >= ax0 && boxes[o + 1] <= ay1 && boxes[o + 4] >= ay0 && boxes[o + 2] <= az1 && boxes[o + 5] >= az0) cand[cn++] = d;
          if (!cn) continue;
        }
        for (let i = 0; i < n && !result; i++) {
          const p = cur[i], o = i * 3;
          const x0 = (prev[o] - tile.wx) / sx, y0 = prev[o + 1], z0 = prev[o + 2] - tile.wz, dx = (p.x - tile.wx) / sx - x0, dy = p.y - y0, dz = p.z - tile.wz - z0;
          const pad = this.pad;
          for (let c = 0; c < cn; c++) {
            const d = cand ? cand[c] : c;
            this.checks++;
            if (!segBox(x0, y0, z0, dx, dy, dz, boxes, d * 6, pad)) continue;
            const s = tile.bStart[d], e = s + tile.bCount[d];
            let inside = false;
            for (let v = s; v + 2 < e; v += 3) if (segTri(x0, y0, z0, dx, dy, dz, arr, v, v + 1, v + 2)) { inside = true; break; }
            // a point that starts and ends inside a box without crossing a face (spawned in one, or the mesh changed under it): count it when it is clearly inside
            if (!inside && x0 > boxes[d * 6] && x0 < boxes[d * 6 + 3] && z0 > boxes[d * 6 + 2] && z0 < boxes[d * 6 + 5] && y0 > boxes[d * 6 + 1] + 2 && y0 < boxes[d * 6 + 4] - 2) inside = this.insideCheck(arr, s, e, x0, y0, z0);
            if (inside) { result = { tile, building: d, point: i }; break; }
          }
        }
        if (result) break;
      }
    }
    for (let i = 0; i < n; i++) { prev[i * 3] = cur[i].x; prev[i * 3 + 1] = cur[i].y; prev[i * 3 + 2] = cur[i].z; }
    this.hasPrev = true; this.hit = result; return result;
  }
  // ray up from the point: an odd number of roof/floor crossings means inside the building
  insideCheck(arr, s, e, x, y, z) {
    let c = 0;
    for (let v = s; v + 2 < e; v += 3) if (segTri(x, y, z, 0, 400, 0, arr, v, v + 1, v + 2)) c++;
    return c % 2 === 1;
  }
}
