// Exterior shape pass for public/models/SF50.glb, from photo comparison with the official G3 renders:
//   - V-tail: new tapered, swept, thin-section fixed surfaces + ruddervators (same pivots / hinge axes / extras; livery X texture re-mapped on the planform)
//   - engine: the red capsule + dark pylon become one smooth nacelle that blends into the aft fuselage with filleted flanks
//   - nose cone: slimmer, more pointed (nose tip stays at z = +4.68, the length / bbox is unchanged)
// Every other node, mesh, material and extras entry is left as it is.
// usage (see sf50-optimize.mjs for the packages):  node tools/sf50-fix-exterior.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { compactPrimitive } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const [inPath, outPath] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const doc = await io.read(inPath), root = doc.getRoot();
const node = (n) => root.listNodes().find((x) => x.getName() === n);
const ext = node('Exterior'), T = ext.getTranslation();
const prims = ext.getMesh().listPrimitives();
const prim = (mat) => prims.find((p) => p.getMaterial().getName() === mat);
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- generic helpers ----------
// drop triangles of a primitive whose world-space centroid satisfies pred(x, y, z, componentId); components = position-welded connected pieces
function dropTris(p, pred) {
  const P = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray(), nv = P.length / 3;
  const map = new Map(), rep = new Int32Array(nv);
  for (let k = 0; k < nv; k++) { const s = `${P[3*k].toFixed(4)},${P[3*k+1].toFixed(4)},${P[3*k+2].toFixed(4)}`; if (!map.has(s)) map.set(s, k); rep[k] = map.get(s); }
  const par = Int32Array.from({ length: nv }, (_, k) => k), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let k = 0; k < I.length; k += 3) { const a = find(rep[I[k]]); par[find(rep[I[k+1]])] = a; par[find(rep[I[k+2]])] = a; }
  const keep = []; let dropped = 0;
  for (let k = 0; k < I.length; k += 3) {
    const [a, b, c] = [I[k], I[k+1], I[k+2]];
    const x = (P[3*a] + P[3*b] + P[3*c]) / 3 + T[0], y = (P[3*a+1] + P[3*b+1] + P[3*c+1]) / 3 + T[1], z = (P[3*a+2] + P[3*b+2] + P[3*c+2]) / 3 + T[2];
    if (pred(x, y, z, find(rep[a]))) dropped++; else keep.push(a, b, c);
  }
  p.getIndices().setArray(Uint32Array.from(keep)); compactPrimitive(p); return dropped;
}
// append {pos, nrm, uv?, idx} (world space minus `origin`) to a primitive that has POSITION/NORMAL (and TEXCOORD_0 when uv is given)
function appendGeo(p, g, origin = T) {
  const cat = (acc, add) => { const old = acc.getArray(), out = new Float32Array(old.length + add.length); out.set(old); out.set(add, old.length); acc.setArray(out); };
  const base = p.getAttribute('POSITION').getCount(), idxOld = p.getIndices().getArray();
  const pos = Float32Array.from(g.pos, (v, i) => v - origin[i % 3]);
  cat(p.getAttribute('POSITION'), pos); cat(p.getAttribute('NORMAL'), g.nrm);
  if (p.getAttribute('TEXCOORD_0')) cat(p.getAttribute('TEXCOORD_0'), g.uv || new Float32Array((g.pos.length / 3) * 2));
  const idx = new Uint32Array(idxOld.length + g.idx.length); idx.set(idxOld); for (let i = 0; i < g.idx.length; i++) idx[idxOld.length + i] = g.idx[i] + base;
  p.getIndices().setArray(idx);
}
const setGeo = (p, g, origin) => { // replace all geometry of a primitive
  const pos = Float32Array.from(g.pos, (v, i) => v - origin[i % 3]);
  p.getAttribute('POSITION').setArray(pos); p.getAttribute('NORMAL').setArray(g.nrm); p.getAttribute('TEXCOORD_0').setArray(g.uv); p.getIndices().setArray(Uint32Array.from(g.idx));
};
class Geo {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  vert(p, uv = [0, 0], n = [0, 0, 0]) { this.pos.push(...p); this.nrm.push(...n); this.uv.push(...uv); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // area-weighted vertex normals for the triangles in [from, to) (shared vertices only get the faces that use them)
  smoothNormals(from = 0) {
    const n = new Float64Array(this.pos.length);
    for (let k = from; k < this.idx.length; k += 3) {
      const [a, b, c] = [this.idx[k], this.idx[k+1], this.idx[k+2]], P = this.pos;
      const u = [0,1,2].map((i) => P[3*b+i] - P[3*a+i]), v = [0,1,2].map((i) => P[3*c+i] - P[3*a+i]);
      const f = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      for (const q of [a, b, c]) for (let i = 0; i < 3; i++) n[3*q+i] += f[i];
    }
    for (let q = 0; q < n.length / 3; q++) { const l = Math.hypot(n[3*q], n[3*q+1], n[3*q+2]); if (l > 1e-12) for (let i = 0; i < 3; i++) this.nrm[3*q+i] = n[3*q+i] / l; }
  }
  flip(from) { for (let k = from; k < this.idx.length; k += 3) [this.idx[k+1], this.idx[k+2]] = [this.idx[k+2], this.idx[k+1]]; }
  out() { return { pos: Float32Array.from(this.pos), nrm: Float32Array.from(this.nrm), uv: Float32Array.from(this.uv), idx: Uint32Array.from(this.idx) }; }
}

// ---------- V-tail ----------
const DIH = 39.0 * Math.PI / 180, CD = Math.cos(DIH), SD = Math.sin(DIH), YC = 1.5987; // span axis: 39 deg above horizontal, through the ruddervator pivots
const S_TIP = 2.72, S_R0 = 0.2, S_R1 = 2.5;                                            // span stations, along the surface
const zLE = (s) => -3.0 - 0.46 * s;                                                      // leading edge: 25 deg sweep
const zTE = (s) => -4.22 - (0.46 / S_TIP) * s - 0.00005 * 0;                             // trailing edge reaches z = -4.68 at the tip, as before
const zHinge = (s) => -4.182 - 0.2409 * (s - 1.4116);                                    // ruddervator hinge line (the extras' hinge_axis)
const tc = (s) => 0.095 - 0.032 * (s / S_TIP);                                           // thickness / chord
const xHinge = (s) => (zLE(s) - zHinge(s)) / (zLE(s) - zTE(s));                          // hinge position as a chord fraction
const naca = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

// one lofted piece between chord fractions xa(s)..xb(s) over the span stations `ss`; side = +1 left (+x), -1 right
function loft(g, ss, xa, xb, side, { capRoot = false, capTip = false, tipThin = 1 } = {}) {
  const NC = 11, NU = NC + 1, first = g.idx.length, rings = [];
  const surf = (s, x, sg) => { // point at chord fraction x on the upper (+1) / lower (-1) surface
    const ch = zLE(s) - zTE(s), h = naca(x, tc(s)) * ch * (s >= S_TIP - 1e-6 ? tipThin : 1);
    return [side * (s * CD - sg * h * SD), YC + s * SD + sg * h * CD, zLE(s) - ch * x];
  };
  for (const s of ss) {
    const a = xa(s), b = xb(s), ring = [], xs = [];
    for (let k = 0; k <= NC; k++) xs.push(a + (b - a) * (1 - Math.cos(Math.PI * k / NC)) / 2); // a -> b, clustered at both ends
    for (let k = NC; k >= 0; k--) ring.push(g.vert(surf(s, xs[k], +1), [s / S_TIP, xs[k] * (zLE(s) - zTE(s)) / (zLE(s) - zTE(s))]));
    for (let k = a > 1e-6 ? 0 : 1; k <= NC; k++) ring.push(g.vert(surf(s, xs[k], -1), [s / S_TIP, xs[k]]));
    rings.push(ring);
  }
  for (let r = 0; r < rings.length - 1; r++) { const A = rings[r], B = rings[r + 1];
    for (let k = 0; k < A.length - 1; k++) { g.tri(A[k], B[k], A[k + 1]); g.tri(A[k + 1], B[k], B[k + 1]); } }
  g.smoothNormals(first);
  const q = rings[0][2];
  if (g.nrm[3*q] * side * -SD + g.nrm[3*q+1] * CD < 0) { g.flip(first); g.smoothNormals(first); }
  const faceNormal = (f0) => { const [a, b, c] = [g.idx[f0], g.idx[f0+1], g.idx[f0+2]], P = g.pos;
    const u = [0,1,2].map((i) => P[3*b+i] - P[3*a+i]), v = [0,1,2].map((i) => P[3*c+i] - P[3*a+i]); return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; };
  const orient = (f0, want) => { const n = faceNormal(f0); if (n[0]*want[0] + n[1]*want[1] + n[2]*want[2] < 0) g.flip(f0); g.smoothNormals(f0); };
  const copy = (i) => g.vert(g.pos.slice(3*i, 3*i+3));
  const seal = (ring, want) => { const f0 = g.idx.length, n = ring.length; let c = [0, 0, 0];
    for (const i of ring) for (let k = 0; k < 3; k++) c[k] += g.pos[3*i+k] / n;
    const ci = g.vert(c), vs = ring.map(copy); for (let k = 0; k < n; k++) g.tri(ci, vs[k], vs[(k + 1) % n]); orient(f0, want); };
  const strip = (ia, ib, want) => { const f0 = g.idx.length, ids = rings.map((r) => [copy(r[ia]), copy(r[ib])]);
    for (let r = 0; r < ids.length - 1; r++) { const [a0, b0] = ids[r], [a1, b1] = ids[r + 1]; g.tri(a0, b0, a1); g.tri(a1, b0, b1); } orient(f0, want); };
  const span = [side * CD, SD, 0];
  if (capTip) seal(rings[rings.length - 1], span);
  if (capRoot) seal(rings[0], span.map((v) => -v));
  if (xa(ss[0]) > 1e-6) strip(NU - 1, NU, [0, 0, 1]);   // flat face at the leading chord end (hinge side of the ruddervator)
  strip(0, rings[0].length - 1, [0, 0, -1]);            // blunt trailing edge / hinge-side face of the fixed part
}

function buildTail(side, pivot) {
  const piece = (ss, xa, xb, opts) => { const g = new Geo(); loft(g, ss, xa, xb, side, opts); return g; };
  const O = pivot;
  const parts = {
    root: piece([0, 0.1, S_R0], () => 0, () => 1, { capRoot: true }),
    main: piece([S_R0, 0.6, 1.0, 1.4, 1.8, 2.2, S_R1], () => 0, xHinge, {}),
    tip: piece([S_R1, 2.6, 2.68, S_TIP], () => 0, () => 1, { capTip: true, tipThin: 0.4 }),
    rud: piece([S_R0, 0.6, 1.0, 1.4, 1.8, 2.2, S_R1], xHinge, () => 1, {}),
  };
  void O; return parts;
}
const merge = (list) => { const g = new Geo(); for (const p of list) { const b = g.pos.length / 3; g.pos.push(...p.pos); g.nrm.push(...p.nrm); g.uv.push(...p.uv); for (const i of p.idx) g.idx.push(i + b); } return g; };

for (const [side, rn] of [[1, 'Ctrl_Ruddervator_L'], [-1, 'Ctrl_Ruddervator_R']]) {
  const rud = node(rn), O = rud.getTranslation(), parts = buildTail(side, O);
  setGeo(rud.getMesh().listPrimitives()[0], parts.rud.out(), O);
  parts.fixed = merge([parts.root, parts.main, parts.tip]);
  if (side === 1) { // replace the whole fixed V-tail primitive (both sides) once the right half exists
    parts.left = parts.fixed;
  }
  (buildTail.fixed ||= []).push(parts.fixed);
}
setGeo(prim('G3_Paint_VTail_X'), merge(buildTail.fixed).out(), T);

// ---------- engine nacelle ----------
const skinY = (() => { // fuselage top skin height at (x, z): highest livery vertex in a small window
  const p = prim('G3_Paint_Livery'), P = p.getAttribute('POSITION').getArray(), pts = [];
  for (let k = 0; k < P.length; k += 3) { const z = P[k+2] + T[2]; if (z < -2.8 || z > 0.2) continue; pts.push([P[k] + T[0], P[k+1] + T[1], z]); }
  return (x, z) => { for (let w = 1; w < 8; w++) { let best = -1e9; for (const [px, py, pz] of pts) if (Math.abs(pz - z) < 0.07 * w && Math.abs(px - x) < 0.06 * w && py > best) best = py; if (best > -1e8) return best; } return 1.8; };
})();
const inZone = (x, y, z) => z > -2.75 && z < -0.15 && Math.abs(x) < 0.6 && y > 1.7;
const removed = {
  pod: dropTris(prim('G3_Paint_CirrusRed'), (x, y, z) => inZone(x, y, z) && y > 1.85),
  rails: dropTris(prim('G3_Paint_GlossBlack'), (x, y, z) => inZone(x, y, z) && y > 1.7 && y < 2.3),
  pin: dropTris(prim('G3_Paint_Pinstripe_White'), inZone),
  seam: dropTris(prim('G3_Seam_Dark'), (x, y, z) => inZone(x, y, z) && y > 1.85 && z < -0.4),
  tube: dropTris(prim('G3_Composite_Inner'), (x, y, z) => z > -2.5 && z < -0.15 && Math.abs(x) < 0.45 && y > skinY(x, z) + 0.035),
};
console.log('dropped triangles', JSON.stringify(removed));

const NAC_Z0 = -0.3, NAC_Z1 = -2.46;
const yc = (z) => (z > -1.0 ? 2.3 : 2.3 - 0.35 * smooth(-1.0, -2.55, z));
const rx = (z) => lerp(0.34, 0.255, smooth(-0.3, -2.4, z)), ry = (z) => lerp(0.245, 0.225, smooth(-0.3, -2.4, z));
const nacelle = new Geo(), RING = []; const NSEC = 28;
for (let i = 0; i <= NSEC; i++) {
  const z = lerp(NAC_Z0, NAC_Z1, i / NSEC), cy = yc(z), a = rx(z), b = ry(z), flare = lerp(0.1, 0.07, smooth(-0.3, -2.4, z));
  const edge = (sg) => { const x = sg * (a + flare); return [x, Math.min(skinY(x, z) - 0.03, cy - 0.04)]; };
  const pts = [];
  const left = edge(-1), right = edge(+1);
  const NS = 7, NT = 14;
  for (let k = 0; k <= NS; k++) { const t = k / NS; const e = (1 - t) * (1 - t); pts.push([left[0] + (-a - left[0]) * (1 - e), lerp(left[1], cy, t)]); }   // left flank, flared at the skin
  for (let k = 1; k < NT; k++) { const th = Math.PI - Math.PI * k / NT; pts.push([a * Math.cos(th), cy + b * Math.sin(th)]); }                         // crown
  for (let k = NS; k >= 0; k--) { const t = k / NS; const e = (1 - t) * (1 - t); pts.push([right[0] + (a - right[0]) * (1 - e), lerp(right[1], cy, t)]); } // right flank
  RING.push(pts.map(([x, y]) => nacelle.vert([x, y, z], [0, 0])));
}
for (let i = 0; i < RING.length - 1; i++) for (let k = 0; k < RING[i].length - 1; k++) { const A = RING[i], B = RING[i + 1]; nacelle.tri(A[k], A[k + 1], B[k]); nacelle.tri(A[k + 1], B[k + 1], B[k]); }
nacelle.smoothNormals();
{ const k = Math.floor(RING[3].length / 2), q = RING[3][k]; if (nacelle.nrm[3*q+1] < 0) { nacelle.flip(0); nacelle.smoothNormals(); } }
{ // rear closure (behind the exhaust nozzle)
  const f0 = nacelle.idx.length, ids = RING[RING.length - 1].map((i) => nacelle.vert(nacelle.pos.slice(3*i, 3*i+3)));
  const c = nacelle.vert([0, 2.0, NAC_Z1]); for (let k = 0; k < ids.length - 1; k++) nacelle.tri(c, ids[k + 1], ids[k]); nacelle.smoothNormals(f0);
  if (nacelle.nrm[3*c+2] > 0) { nacelle.flip(f0); nacelle.smoothNormals(f0); }
}
appendGeo(prim('G3_Paint_CirrusRed'), nacelle.out());

// ---------- nose cone ----------
{
  const L0 = 3.35, L1 = 4.68, ax = {}; // section centre line y(z), from the livery skin
  const pl = prim('G3_Paint_Livery').getAttribute('POSITION').getArray();
  for (let k = 0; k < pl.length; k += 3) { const z = pl[k+2] + T[2]; if (z < L0 - 0.1) continue; const b = Math.round(z / 0.05); const e = (ax[b] ||= [9, -9]); e[0] = Math.min(e[0], pl[k+1] + T[1]); e[1] = Math.max(e[1], pl[k+1] + T[1]); }
  const cy = (z) => { const e = ax[Math.round(z / 0.05)]; return e ? (e[0] + e[1]) / 2 : 1.0; };
  let n = 0;
  for (const p of prims) { const A = p.getAttribute('POSITION'), P = A.getArray(); for (let k = 0; k < P.length; k += 3) {
    const z = P[k+2] + T[2]; if (z <= L0) continue; const t = (z - L0) / (L1 - L0), f = Math.pow(t, 1.3), c = cy(z);
    P[k] *= 1 - 0.17 * f; const y = P[k+1] + T[1]; P[k+1] = c + (y - c) * (1 - 0.11 * f) - T[1]; n++; } A.setArray(P); }
  console.log('nose vertices moved', n);
}

for (const m of root.listMeshes()) for (const p of m.listPrimitives()) if (!p.getIndices().getCount()) { m.removePrimitive(p); p.dispose(); }
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) { const a = p.getAttribute(sem).getArray(); for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`non-finite ${sem} in ${m.getName()} ${p.getMaterial().getName()}`); }
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 } });
await io.write(outPath, doc);
