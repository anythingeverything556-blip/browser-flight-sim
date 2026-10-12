import * as THREE from 'three';
import { applyWear } from './cockpitwear.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wkey = (x, y, z) => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;

// The forward fuselage beside and ahead of the cockpit is a coarse mesh (cells of ~0.5 m): from the seat the chine edge shows as
// stair-steps. For the cockpit view only, take those triangles out of the hull, subdivide them once, relax the result (Taubin: shrink,
// then inflate, so the surface keeps its volume) and draw it as a separate mesh. Normals fade back to the hull's own at the border.
export function buildChineZone(model) {
  let fus = null; model.traverse((o) => { if (o.isMesh && o.name === 'SR71_Fuselage_mesh001') fus = o; });
  if (!fus || !fus.geometry.index || !(fus.geometry.attributes.position.array instanceof Float32Array)) return null;
  const g = fus.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
  model.updateMatrixWorld(true);
  const M = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(fus.matrixWorld), v = new THREE.Vector3();
  const inZone = (x, y, z) => { const az = Math.abs(z); return x > 10.45 && x < 19 && az > 0.55 && az < 3.4 && y > 2.25; };
  const zone = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); zone[i] = inZone(v.x, v.y, v.z) ? 1 : 0; }
  const keep = [], zt = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (zone[a] && zone[b] && zone[c]) zt.push(a, b, c); else keep.push(a, b, c);
  }
  if (zt.length < 300) return null;
  // weld the zone's vertices
  const ids = new Map(), P = [], N0 = [], T = [];
  const wid = (i) => {
    const k = wkey(pos.getX(i), pos.getY(i), pos.getZ(i)); let id = ids.get(k);
    if (id === undefined) { id = P.length / 3; ids.set(k, id); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N0.push(nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0); }
    return id;
  };
  for (let t = 0; t < zt.length; t += 3) T.push(wid(zt[t]), wid(zt[t + 1]), wid(zt[t + 2]));
  // boundary edges of the zone
  const ec = new Map(), ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const key = ek(T[t + k], T[t + (k + 1) % 3]); ec.set(key, (ec.get(key) || 0) + 1); }
  // one level of 1-to-4 subdivision with shared edge midpoints
  const mid = new Map(), V0 = P.length / 3, border = new Set(), T2 = [];
  const midpoint = (a, b) => {
    const key = ek(a, b); let m = mid.get(key);
    if (m === undefined) {
      m = P.length / 3; mid.set(key, m);
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      N0.push((N0[a * 3] + N0[b * 3]) / 2, (N0[a * 3 + 1] + N0[b * 3 + 1]) / 2, (N0[a * 3 + 2] + N0[b * 3 + 2]) / 2);
      if (ec.get(key) === 1) border.add(m);
    }
    return m;
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2], ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    T2.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  for (const [key, n] of ec) if (n === 1) { border.add(Math.floor(key / 4194304)); border.add(key % 4194304); }
  const G = P.length / 3, nb = Array.from({ length: G }, () => new Set());
  for (let t = 0; t < T2.length; t += 3) { const a = T2[t], b = T2[t + 1], c = T2[t + 2]; nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b); }
  const nbr = nb.map((s) => [...s]);
  // relax weight: 0 on the border, rising to 1 four rings in
  const ring = new Int16Array(G).fill(-1), q = [];
  for (const b of border) { ring[b] = 0; q.push(b); }
  for (let h = 0; h < q.length; h++) { const i = q[h]; if (ring[i] >= 4) continue; for (const j of nbr[i]) if (ring[j] < 0) { ring[j] = ring[i] + 1; q.push(j); } }
  const W = new Float32Array(G); for (let i = 0; i < G; i++) W[i] = ring[i] < 0 ? 1 : Math.min(1, ring[i] / 4);
  let cur = Float64Array.from(P), nxt = new Float64Array(cur.length);
  const pass = (lam) => {
    for (let i = 0; i < G; i++) {
      const wi = W[i], n = nbr[i];
      if (wi <= 0 || !n.length) { nxt[i * 3] = cur[i * 3]; nxt[i * 3 + 1] = cur[i * 3 + 1]; nxt[i * 3 + 2] = cur[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0; for (const j of n) { sx += cur[j * 3]; sy += cur[j * 3 + 1]; sz += cur[j * 3 + 2]; }
      const k = lam * wi / n.length;
      nxt[i * 3] = cur[i * 3] + k * (sx - n.length * cur[i * 3]); nxt[i * 3 + 1] = cur[i * 3 + 1] + k * (sy - n.length * cur[i * 3 + 1]); nxt[i * 3 + 2] = cur[i * 3 + 2] + k * (sz - n.length * cur[i * 3 + 2]);
    }
    [cur, nxt] = [nxt, cur];
  };
  for (let it = 0; it < 16; it++) { pass(0.6); pass(-0.63); }
  // normals from the relaxed surface, blended with the hull's own normals towards the border
  const acc = new Float32Array(G * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < T2.length; t += 3) {
    const i0 = T2[t], i1 = T2[t + 1], i2 = T2[t + 2];
    a.set(cur[i0 * 3], cur[i0 * 3 + 1], cur[i0 * 3 + 2]); b.set(cur[i1 * 3], cur[i1 * 3 + 1], cur[i1 * 3 + 2]); c.set(cur[i2 * 3], cur[i2 * 3 + 1], cur[i2 * 3 + 2]);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
    for (const k of [i0, i1, i2]) { acc[k * 3] += e1.x; acc[k * 3 + 1] += e1.y; acc[k * 3 + 2] += e1.z; }
  }
  const out = new Float32Array(G * 3), on = new Float32Array(G * 3);
  for (let i = 0; i < G; i++) {
    out[i * 3] = cur[i * 3]; out[i * 3 + 1] = cur[i * 3 + 1]; out[i * 3 + 2] = cur[i * 3 + 2];
    v.set(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]); if (v.lengthSq() > 1e-14) v.normalize(); else v.set(N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]);
    const k = W[i]; e1.set(N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]).normalize(); v.multiplyScalar(k).addScaledVector(e1, 1 - k).normalize();
    on[i * 3] = v.x; on[i * 3 + 1] = v.y; on[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(on, 3)); geo.setIndex(T2);
  const zoneMesh = new THREE.Mesh(geo, fus.material);
  zoneMesh.name = 'SR71_ChineZone'; zoneMesh.visible = false; zoneMesh.frustumCulled = false; zoneMesh.castShadow = false; zoneMesh.receiveShadow = true;
  zoneMesh.matrix.copy(fus.matrix); zoneMesh.matrixAutoUpdate = false; zoneMesh.position.copy(fus.position); zoneMesh.quaternion.copy(fus.quaternion); zoneMesh.scale.copy(fus.scale); zoneMesh.matrixAutoUpdate = true;
  zoneMesh.layers.mask = fus.layers.mask;
  fus.parent.add(zoneMesh);
  const full = idx, cut = new THREE.BufferAttribute(new Uint32Array(keep), 1);
  return { fus, zoneMesh, full, cut, verts: G, tris: T2.length / 3 };
}

// Thin dark frame strips around every pane of glass: a flat rim in the plane of the glass plus a small lip towards the pilot.
// Built from the glass mesh's own outline (edges used by one triangle once its vertices are welded).
export function buildGlassFrames(model, glass, eye) {
  if (!glass || !glass.geometry.index) return null;
  const pos = glass.geometry.attributes.position, idx = glass.geometry.index;
  model.updateMatrixWorld(true);
  const M = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(glass.matrixWorld), v = new THREE.Vector3();
  const ids = new Map(), P = [], gid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    const k = wkey(v.x, v.y, v.z); let id = ids.get(k);
    if (id === undefined) { id = P.length; ids.set(k, id); P.push(v.clone()); }
    gid[i] = id;
  }
  // panes: connected pieces of glass; tiny pieces (rain deflectors, probe fairings) get no frame
  const par = Int32Array.from({ length: P.length }, (_, i) => i), root = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.count; t += 3) { const r = root(gid[idx.getX(t)]); par[root(gid[idx.getX(t + 1)])] = r; par[root(gid[idx.getX(t + 2)])] = r; }
  const bb = new Map();
  for (let i = 0; i < P.length; i++) { const r = root(i), q = bb.get(r) || { mn: new THREE.Vector3(1e9, 1e9, 1e9), mx: new THREE.Vector3(-1e9, -1e9, -1e9) }; q.mn.min(P[i]); q.mx.max(P[i]); bb.set(r, q); }
  const bigPane = (i) => { const q = bb.get(root(i)); return q.mn.distanceTo(q.mx) > 0.32; };
  const edges = new Map();
  for (let t = 0; t < idx.count; t += 3) {
    const a = gid[idx.getX(t)], b = gid[idx.getX(t + 1)], c = gid[idx.getX(t + 2)];
    if (!bigPane(a)) continue;
    for (const [u, w, o] of [[a, b, c], [b, c, a], [c, a, b]]) {
      if (u === w) continue;
      const k = u < w ? u * 1e6 + w : w * 1e6 + u, e = edges.get(k);
      if (e) e.n++; else edges.set(k, { u, w, o, n: 1 });
    }
  }
  const verts = [], tris = [], W = 0.032, LIP = 0.03, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), d = new THREE.Vector3(), inward = new THREE.Vector3(), nrm = new THREE.Vector3(), tmp = new THREE.Vector3();
  let count = 0;
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    A.copy(P[e.u]); B.copy(P[e.w]); C.copy(P[e.o]);
    d.subVectors(B, A); const len = d.length(); if (len < 0.02) continue; d.divideScalar(len);
    inward.subVectors(C, A); inward.addScaledVector(d, -inward.dot(d)); if (inward.lengthSq() < 1e-10) continue; inward.normalize();
    nrm.crossVectors(d, inward).normalize(); if (nrm.dot(tmp.subVectors(eye, A)) < 0) nrm.negate();
    const base = verts.length / 3, push = (p) => verts.push(p.x, p.y, p.z);
    push(A); push(B); push(tmp.copy(B).addScaledVector(inward, -W)); push(tmp.copy(A).addScaledVector(inward, -W));
    push(tmp.copy(A).addScaledVector(inward, -W)); push(tmp.copy(B).addScaledVector(inward, -W));
    push(tmp.copy(B).addScaledVector(inward, -W).addScaledVector(nrm, LIP)); push(tmp.copy(A).addScaledVector(inward, -W).addScaledVector(nrm, LIP));
    tris.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
    count++;
  }
  if (!count) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(tris); geo.computeVertexNormals();
  const mat = applyWear(new THREE.MeshStandardMaterial({ color: 0x252c34, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }), { rust: 0.35, wear: 0.9 });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'SR71_Canopy_Strips'; mesh.visible = false; mesh.frustumCulled = false;
  model.add(mesh);
  return mesh;
}

// ---------- canvas art for the instrument-panel wings ----------
const TAU = Math.PI * 2;
function gauge(c, x, y, r, { label = '', unit = '', max = 10, majors = 5, start = -2.3, end = 2.3, value = 0.2, red = 0.82, digits = true } = {}) {
  c.save(); c.translate(x, y);
  c.fillStyle = '#050506'; c.beginPath(); c.arc(0, 0, r * 1.14, 0, TAU); c.fill();
  const g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, '#9aa0a8'); g.addColorStop(0.5, '#3b3f45'); g.addColorStop(1, '#7d838b');
  c.strokeStyle = g; c.lineWidth = r * 0.1; c.beginPath(); c.arc(0, 0, r * 1.06, 0, TAU); c.stroke();
  c.fillStyle = '#0d0e10'; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  for (let i = 0; i <= majors * 5; i++) {
    const a = start + (end - start) * i / (majors * 5), major = i % 5 === 0, hot = i / (majors * 5) >= red;
    c.strokeStyle = hot ? '#d8473a' : '#e8e6de'; c.lineWidth = major ? r * 0.045 : r * 0.022;
    c.beginPath(); c.moveTo(Math.sin(a) * r * (major ? 0.74 : 0.82), -Math.cos(a) * r * (major ? 0.74 : 0.82)); c.lineTo(Math.sin(a) * r * 0.93, -Math.cos(a) * r * 0.93); c.stroke();
    if (major && digits) { c.fillStyle = '#e8e6de'; c.font = `bold ${Math.round(r * 0.2)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(Math.round(max * i / (majors * 5))), Math.sin(a) * r * 0.58, -Math.cos(a) * r * 0.58); }
  }
  if (label) { c.fillStyle = '#cfcfc8'; c.font = `bold ${Math.round(r * 0.16)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(label, 0, r * 0.38); }
  if (unit) { c.fillStyle = '#9a9a94'; c.font = `${Math.round(r * 0.13)}px sans-serif`; c.fillText(unit, 0, r * 0.54); }
  const na = start + (end - start) * value;
  c.strokeStyle = '#f2f0e8'; c.lineWidth = r * 0.06; c.lineCap = 'round'; c.beginPath(); c.moveTo(-Math.sin(na) * r * 0.16, Math.cos(na) * r * 0.16); c.lineTo(Math.sin(na) * r * 0.86, -Math.cos(na) * r * 0.86); c.stroke();
  c.fillStyle = '#26282c'; c.beginPath(); c.arc(0, 0, r * 0.1, 0, TAU); c.fill();
  const gl = c.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * 1.1); gl.addColorStop(0, 'rgba(255,255,255,0.14)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gl; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  c.restore();
}
function toggles(c, x, y, n, gap, labels = []) {
  for (let i = 0; i < n; i++) {
    const px = x + i * gap; c.fillStyle = '#17181b'; c.fillRect(px - 9, y - 4, 18, 30); c.strokeStyle = '#6b7078'; c.lineWidth = 1.5; c.strokeRect(px - 9, y - 4, 18, 30);
    const up = (i * 7 + n) % 3 !== 0; c.fillStyle = '#bfc3c8'; c.fillRect(px - 3, up ? y : y + 10, 6, 14); c.fillStyle = '#e8e6de'; c.fillRect(px - 3, up ? y : y + 21, 6, 3);
    c.fillStyle = '#d8d6ce'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(labels[i] || '', px, y + 44);
  }
}
function lamp(c, x, y, w, h, text, color) {
  c.fillStyle = '#16100e'; c.fillRect(x, y, w, h); c.strokeStyle = '#555a60'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
  c.fillStyle = color; c.globalAlpha = 0.35; c.fillRect(x + 3, y + 3, w - 6, h - 6); c.globalAlpha = 1;
  c.fillStyle = '#f0e6d0'; c.font = `bold ${Math.round(h * 0.42)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + w / 2, y + h / 2 + 1);
}
function plate(c, W, H) {
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1b1e23'); g.addColorStop(1, '#101215'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; c.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1); }
  c.strokeStyle = '#2e3238'; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4);
}
function wearOver(c, W, H) {
  for (let i = 0; i < 60; i++) { c.strokeStyle = `rgba(210,214,220,${0.04 + Math.random() * 0.07})`; c.lineWidth = 0.6 + Math.random(); const x = Math.random() * W, y = Math.random() * H, a = Math.random() * TAU, l = 6 + Math.random() * 40; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  const v = c.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(0,0,0,0.3)'); v.addColorStop(0.15, 'rgba(0,0,0,0)'); v.addColorStop(0.85, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.34)'); c.fillStyle = v; c.fillRect(0, 0, W, H);
}
// left wing: a display with a ring of buttons, small gauges and a switch bank, like the left face of the real coaming
function drawLeftWing(c, W, H) {
  plate(c, W, H);
  c.fillStyle = '#08090a'; c.fillRect(60, 30, 392, 330); c.strokeStyle = '#575c63'; c.lineWidth = 3; c.strokeRect(60, 30, 392, 330);
  c.fillStyle = '#04100a'; c.fillRect(110, 76, 292, 238);
  for (let y = 80; y < 314; y += 4) { c.fillStyle = 'rgba(40,190,90,0.05)'; c.fillRect(110, y, 292, 1); }
  c.fillStyle = 'rgba(60,220,110,0.5)'; c.font = '16px monospace'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('SENSOR   STBY', 124, 112); c.fillText('NAV      ALIGN', 124, 138); c.fillText('FUEL SEQ AUTO', 124, 164);
  c.strokeStyle = 'rgba(60,220,110,0.3)'; c.lineWidth = 1.5; c.strokeRect(190, 196, 130, 90); c.beginPath(); c.moveTo(255, 196); c.lineTo(255, 286); c.moveTo(190, 241); c.lineTo(320, 241); c.stroke();
  for (let i = 0; i < 6; i++) for (const by of [42, 332]) { const bx = 84 + i * 62; c.fillStyle = '#2d3036'; c.fillRect(bx, by, 40, 18); c.fillStyle = '#c8ccd2'; c.fillRect(bx + 4, by + 5, 32, 8); }
  gauge(c, 130, 470, 64, { label: 'OIL', unit: 'PSI', max: 100, majors: 5, value: 0.55 }); gauge(c, 330, 470, 64, { label: 'HYD', unit: 'PSI', max: 4, majors: 4, value: 0.72 });
  gauge(c, 130, 640, 64, { label: 'CABIN', unit: 'ALT', max: 40, majors: 4, value: 0.18 }); gauge(c, 330, 640, 64, { label: 'O2', unit: 'PSI', max: 500, majors: 5, value: 0.64 });
  toggles(c, 70, 770, 8, 52, ['BAT', 'GEN', 'FUEL', 'PUMP', 'BYP', 'LGT', 'PTT', 'HTR']);
  lamp(c, 40, 880, 140, 54, 'BAILOUT', '#d8281c'); lamp(c, 196, 880, 130, 54, 'MASTER', '#d89a1c'); lamp(c, 342, 880, 130, 54, 'RADAR', '#2fc060');
  wearOver(c, W, H);
}
function drawRightWing(c, W, H) {
  plate(c, W, H);
  gauge(c, 256, 150, 110, { label: 'RANGE', unit: 'MILES', max: 10, majors: 10, value: 0.3, start: -2.5, end: 2.5 });
  gauge(c, 140, 410, 82, { label: 'ALT', unit: 'FT', max: 10, majors: 10, value: 0.45 }); gauge(c, 372, 410, 82, { label: 'VSI', unit: '1000 FPM', max: 6, majors: 6, value: 0.5, start: -2.0, end: 2.0 });
  gauge(c, 140, 610, 82, { label: 'MACH', unit: '', max: 4, majors: 8, value: 0.05, red: 0.9 }); gauge(c, 372, 610, 82, { label: 'EGT', unit: 'C x100', max: 10, majors: 5, value: 0.22 });
  toggles(c, 70, 750, 8, 52, ['ENG', 'A/B', 'INLT', 'BYP', 'TRIM', 'AFT', 'FWD', 'PWR']);
  lamp(c, 40, 850, 140, 54, 'MACH 3.0', '#d89a1c'); lamp(c, 196, 850, 130, 54, 'INLET', '#d8281c'); lamp(c, 342, 850, 130, 54, 'FUEL', '#2fc060');
  c.fillStyle = '#c9c7bf'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('PILOT  INSTRUMENT PANEL', 256, 940);
  wearOver(c, W, H);
}

// Angled panels either side of the live instrument panel and a raised bezel round the whole coaming. `plane` is the live panel quad;
// everything is parented to it so it follows its tilt. w, h: the quad's size in metres.
export function buildPanelWings(plane, w, h) {
  const out = { mats: [] };
  const mk = (draw) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 1024; draw(cv.getContext('2d'), 512, 1024);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }); out.mats.push(m); return m;
  };
  const ww = 0.15, ang = 0.75;
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, h), mk(s < 0 ? drawLeftWing : drawRightWing));
    m.rotation.y = -s * ang;
    m.position.set(s * (w / 2 + (ww / 2) * Math.cos(ang)), 0, (ww / 2) * Math.sin(ang));
    plane.add(m);
  }
  const bez = applyWear(new THREE.MeshStandardMaterial({ color: 0x2b323b, roughness: 0.55, metalness: 0.3 }), { rust: 0.3, wear: 1 });
  const T = 0.026, D = 0.045, total = w + 2 * ww * Math.cos(ang);
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(total + 0.04, T, D), bez); bar.position.set(0, s * (h / 2 + T / 2 - 0.003), D / 2 - 0.004); plane.add(bar);
    const e = new THREE.Mesh(new THREE.BoxGeometry(T, h + 2 * T - 0.006, D), bez);
    e.position.set(s * (total / 2 + T / 2 - 0.002), 0, ww * Math.sin(ang) + D / 2 - 0.004); plane.add(e);
  }
  return out;
}

