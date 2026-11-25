import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural traffic models, one shared geometry per type class. Axes: nose +x, up +y, wings along z, metres at real size.
// Parts carry vertex colours (white airframe, grey engines and gear, dark glass), so a class is a single draw call.
const col = (g, r, gr, b) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gr; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const plain = (g) => { if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
const WHITE = [0.9, 0.92, 0.95], GREY = [0.42, 0.45, 0.5], DARK = [0.08, 0.1, 0.14];

// fuselage of revolution along x: ogive nose, straight barrel, tail taper that rises toward the tail cone
function fuselage(len, rad, { noseFrac = 0.13, tailFrac = 0.26, tailUp = 0.25, c = WHITE } = {}) {
  const pts = [], N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = len / 2 - t * len; let r = rad; // t = 0 at the nose (+x)
    if (t < noseFrac) r = rad * Math.sqrt(1 - ((noseFrac - t) / noseFrac) ** 2) * 0.98 + rad * 0.02;
    else if (t > 1 - tailFrac) { const u = (t - (1 - tailFrac)) / tailFrac; r = rad * (1 - 0.88 * u * u * (1.2 - 0.2 * u)); }
    pts.push(new THREE.Vector2(Math.max(0.04, r), x));
  }
  pts.reverse(); // ascending along the axis: tail first
  const g = new THREE.LatheGeometry(pts, 14); g.rotateZ(-Math.PI / 2); // lathe axis y -> x (nose at +x)
  const p = g.attributes.position; // lift the tail cone, so the aft body sweeps up like a real airliner
  for (let i = 0; i < p.count; i++) { const t = 1 - (p.getX(i) + len / 2) / len; if (t > 1 - tailFrac) { const u = (t - (1 - tailFrac)) / tailFrac; p.setY(i, p.getY(i) + rad * tailUp * u * u); } }
  g.computeVertexNormals();
  const cockpit = new THREE.BoxGeometry(rad * 0.9, rad * 0.32, rad * 1.28); cockpit.translate(len / 2 - len * noseFrac * 0.55, rad * 0.42, 0); col(cockpit, ...DARK);
  return [col(plain(g), ...c), plain(cockpit)];
}

// thin swept panel from root to tip on both sides of the centreline, in the x-z plane at height y
function wingPanel({ x0, rootChord, tipChord, span, sweepDeg, thick = 0.22, y = 0, dihedral = 0.04, c = WHITE }) {
  const h = span / 2, sw = Math.tan((sweepDeg * Math.PI) / 180) * h;
  const s = new THREE.Shape(); s.moveTo(x0, 0); s.lineTo(x0 - sw, h); s.lineTo(x0 - sw - tipChord, h); s.lineTo(x0 - rootChord, 0); s.lineTo(x0 - sw - tipChord, -h); s.lineTo(x0 - sw, -h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, y + thick / 2, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getZ(i)) * dihedral);
  g.computeVertexNormals(); return col(plain(g), ...c);
}

function fin(x0, rootChord, tipChord, height, sweepDeg, base, thick = 0.2) {
  const sw = Math.tan((sweepDeg * Math.PI) / 180) * height;
  const s = new THREE.Shape(); s.moveTo(x0, 0); s.lineTo(x0 - sw, height); s.lineTo(x0 - sw - tipChord, height); s.lineTo(x0 - rootChord, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false }); g.translate(0, base, -thick / 2); g.computeVertexNormals(); return col(plain(g), ...WHITE);
}

function nacelle(x, y, z, r, l, c = GREY) {
  const body = new THREE.CylinderGeometry(r, r * 0.86, l, 12, 1, true); body.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(r * 0.96, r * 0.07, 6, 14); lip.rotateY(Math.PI / 2); lip.translate(l / 2, 0, 0);
  const cone = new THREE.ConeGeometry(r * 0.55, r * 1.7, 10); cone.rotateZ(Math.PI / 2); cone.translate(-l / 2 - r * 0.6, 0, 0);
  const fan = new THREE.CircleGeometry(r * 0.9, 12); fan.rotateY(Math.PI / 2); fan.translate(l / 2 - r * 0.2, 0, 0);
  const parts = [col(plain(body), ...c), col(plain(lip), 0.7, 0.72, 0.76), col(plain(cone), ...c), col(plain(fan), ...DARK)];
  for (const g of parts) g.translate(x, y, z); return parts;
}

function propDisc(x, y, z, r) { const g = new THREE.CircleGeometry(r, 14); g.rotateY(Math.PI / 2); g.translate(x, y, z); return col(plain(g), 0.2, 0.22, 0.26); }

function airliner({ len, rad, span, sweep, rootChord, tipChord, wingX, engines, engR, engL, tTail = false, rearEngines = false, gear = true }) {
  const parts = [...fuselage(len, rad)];
  parts.push(wingPanel({ x0: wingX, rootChord, tipChord, span, sweepDeg: sweep, y: -rad * 0.55 }));
  const h = rad * 4.1;
  parts.push(fin(-len * 0.32, len * 0.17, len * 0.075, h, 38, rad * 0.55 + rad * 0.18));
  parts.push(wingPanel({ x0: -len * 0.36, rootChord: len * 0.1, tipChord: len * 0.045, span: span * 0.36, sweepDeg: sweep, y: tTail ? rad * 0.55 + rad * 0.18 + h * 0.97 : rad * 0.1, thick: 0.15, dihedral: 0.06 }));
  for (const z of engines) {
    if (rearEngines) parts.push(...nacelle(-len * 0.36, rad * 0.5, z, engR, engL)); else parts.push(...nacelle(wingX + engL * 0.15, -rad * 0.55 - engR * 0.95, z, engR, engL));
  }
  if (gear) { const wh = new THREE.BoxGeometry(rad * 1.2, rad * 0.45, rad * 0.5); wh.translate(wingX - rootChord * 0.7, -rad * 1.0, 0); parts.push(col(plain(wh), ...GREY)); }
  return mergeGeometries(parts);
}

function helicopter() {
  const body = new THREE.SphereGeometry(1.25, 12, 9); body.scale(1.7, 1.05, 0.95); body.translate(0, 0, 0);
  const boom = new THREE.CylinderGeometry(0.28, 0.12, 5.6, 8); boom.rotateZ(Math.PI / 2); boom.translate(-4.1, 0.35, 0);
  const tailFin = new THREE.BoxGeometry(0.9, 1.5, 0.12); tailFin.translate(-6.7, 1.0, 0);
  const glass = new THREE.SphereGeometry(1.0, 10, 8, 0, Math.PI, 0, Math.PI / 2); glass.rotateY(-Math.PI / 2); glass.scale(1.2, 0.9, 0.95); glass.translate(0.8, 0.15, 0);
  const mast = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6); mast.translate(0, 1.4, 0);
  const rotor = new THREE.CylinderGeometry(5.4, 5.4, 0.04, 20); rotor.translate(0, 1.8, 0);
  const tailRotor = new THREE.CylinderGeometry(0.9, 0.9, 0.04, 12); tailRotor.rotateX(Math.PI / 2); tailRotor.translate(-6.7, 1.0, 0.2);
  const skidL = new THREE.BoxGeometry(3.4, 0.08, 0.1); skidL.translate(0.2, -1.35, -0.8); const skidR = skidL.clone(); skidR.translate(0, 0, 1.6);
  return mergeGeometries([col(plain(body), 0.85, 0.2, 0.18), col(plain(boom), 0.85, 0.2, 0.18), col(plain(tailFin), 0.85, 0.2, 0.18), col(plain(glass), ...DARK), col(plain(mast), ...GREY),
    col(plain(rotor), 0.15, 0.17, 0.2), col(plain(tailRotor), 0.15, 0.17, 0.2), col(plain(skidL), ...GREY), col(plain(skidR), ...GREY)]);
}

function lightAircraft() {
  const parts = [...fuselage(8.2, 0.62, { noseFrac: 0.2, tailFrac: 0.38, tailUp: 0.1 })];
  parts.push(wingPanel({ x0: 1.3, rootChord: 1.6, tipChord: 1.2, span: 10.8, sweepDeg: 0, y: 0.7, thick: 0.1, dihedral: 0.0 }));
  parts.push(fin(-3.2, 1.3, 0.8, 1.5, 28, 0.35, 0.1)); parts.push(wingPanel({ x0: -3.0, rootChord: 1.0, tipChord: 0.7, span: 3.4, sweepDeg: 5, y: 0.35, thick: 0.08 }));
  parts.push(propDisc(4.15, 0, 0, 0.95)); const strut = new THREE.BoxGeometry(0.05, 0.9, 0.05); strut.translate(1.4, 0.2, 1.7); const sp = col(plain(strut), ...GREY); parts.push(sp); const s2 = sp.clone(); s2.translate(0, 0, -3.4); parts.push(s2);
  return mergeGeometries(parts);
}

function turboprop() {
  const parts = [...fuselage(24, 1.35, { noseFrac: 0.1, tailFrac: 0.3, tailUp: 0.18 })];
  parts.push(wingPanel({ x0: 1.5, rootChord: 3.0, tipChord: 1.7, span: 27, sweepDeg: 3, y: 1.0, thick: 0.28, dihedral: 0.01 }));
  parts.push(fin(-8.8, 4.4, 1.9, 5.4, 34, 1.2)); parts.push(wingPanel({ x0: -9.0, rootChord: 2.6, tipChord: 1.3, span: 9, sweepDeg: 8, y: 6.2, thick: 0.14 }));
  for (const z of [-4.6, 4.6]) { parts.push(...nacelle(1.8, 0.9, z, 0.62, 3.4)); parts.push(propDisc(3.7, 0.9, z, 1.95)); }
  return mergeGeometries(parts);
}

function fighter() {
  const parts = [...fuselage(15, 0.85, { noseFrac: 0.3, tailFrac: 0.2, tailUp: 0 })];
  const dl = new THREE.Shape(); dl.moveTo(1.5, 0); dl.lineTo(-3.8, 4.8); dl.lineTo(-4.6, 4.8); dl.lineTo(-5.2, 0); dl.lineTo(-4.6, -4.8); dl.lineTo(-3.8, -4.8); dl.closePath();
  const wg = new THREE.ExtrudeGeometry(dl, { depth: 0.14, bevelEnabled: false }); wg.rotateX(Math.PI / 2); wg.translate(0, 0.07, 0); wg.computeVertexNormals(); parts.push(col(plain(wg), ...WHITE));
  parts.push(fin(-5.4, 2.6, 1.1, 2.6, 35, 0.6, 0.12)); parts.push(wingPanel({ x0: -5.6, rootChord: 1.8, tipChord: 0.9, span: 5.4, sweepDeg: 40, y: 0.1, thick: 0.1 }));
  parts.push(...nacelle(-6.2, 0, 0, 0.62, 2.6, [0.25, 0.25, 0.28]));
  const intake = new THREE.BoxGeometry(2.2, 0.8, 1.9); intake.translate(1.2, -0.65, 0); parts.push(col(plain(intake), ...GREY));
  return mergeGeometries(parts);
}

// type class -> geometry (built on first use, then shared)
const BUILDERS = {
  widebody: () => airliner({ len: 64, rad: 3.1, span: 61, sweep: 33, rootChord: 13, tipChord: 3.2, wingX: 6, engines: [-10.5, 10.5], engR: 1.65, engL: 5 }),
  widebody4: () => airliner({ len: 70, rad: 3.2, span: 64, sweep: 36, rootChord: 14, tipChord: 3.4, wingX: 6, engines: [-21, -12, 12, 21], engR: 1.3, engL: 4.5 }),
  narrowbody: () => airliner({ len: 37, rad: 1.95, span: 34, sweep: 25, rootChord: 7.3, tipChord: 1.9, wingX: 3, engines: [-5.6, 5.6], engR: 1.1, engL: 3.4 }),
  regional: () => airliner({ len: 31, rad: 1.5, span: 28, sweep: 24, rootChord: 5.4, tipChord: 1.6, wingX: 2, engines: [-1.9, 1.9], engR: 0.8, engL: 2.8, tTail: true, rearEngines: true }),
  bizjet: () => airliner({ len: 19, rad: 1.15, span: 18, sweep: 28, rootChord: 3.5, tipChord: 1.1, wingX: 0.6, engines: [-1.45, 1.45], engR: 0.6, engL: 2.2, tTail: true, rearEngines: true, gear: false }),
  turboprop, helicopter, ga: lightAircraft, fighter,
};
const geomCache = new Map();
export function trafficGeometry(cls, type = '') {
  const key = cls === 'widebody' && /^(B74|A38|A34|A340)/i.test(type) ? 'widebody4' : (BUILDERS[cls] ? cls : 'narrowbody');
  if (!geomCache.has(key)) geomCache.set(key, BUILDERS[key]());
  return geomCache.get(key);
}
export const TRAFFIC_CLASSES = Object.keys(BUILDERS);
