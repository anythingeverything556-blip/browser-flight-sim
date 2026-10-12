import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Pilot's cockpit and canopy rebuilt from museum photographs of the SR-71 (model space: x nose, y up, z right; eye at 11.22, 3.31, 0).
// The original cockpit meshes are hidden by the caller. Everything here shares edges with its neighbours so nothing floats.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const cnv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const mkTex = (c, rep) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; };
const FONT = 'Arial Narrow, Arial, Helvetica, sans-serif';

// quad a-b-c-d: bottom-left, bottom-right, top-right, top-left as seen by the pilot; uv = [u0, v0, u1, v1]
function quad(a, b, c, d, uv = [0, 0, 1, 1]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, d].flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return g;
}
function polyY(pts, yAt) { // flat-ish polygon given as [x, z] pairs, y from a function
  const sh = pts.map(([x, z]) => new THREE.Vector2(x, z)), tri = THREE.ShapeUtils.triangulateShape(sh, []);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(([x, z]) => [x, yAt(x, z), z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap(([x, z]) => [(z + 0.7) / 1.4, (x - 11.8) / 0.9]), 2));
  g.setIndex(tri.flat()); g.computeVertexNormals();
  return g;
}
function beam(a, b, t, h = t) { // box from a to b, t wide, h deep
  const d = b.clone().sub(a), len = d.length(), g = new THREE.BoxGeometry(len, h, t);
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), d.normalize()), V(1, 1, 1));
  return g.applyMatrix4(m);
}
function tube(pts, r, seg = 160, rad = 8) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, rad, false); }
function helix(c0, c1, radius, turns, n, axis = 'x') { // coil about the line c0->c1
  const a = c1.clone().sub(c0), len = a.length(); a.normalize();
  const u = Math.abs(a.y) < 0.9 ? V(0, 1, 0).cross(a).normalize() : V(1, 0, 0).cross(a).normalize(), w = a.clone().cross(u);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, ang = t * turns * Math.PI * 2; pts.push(c0.clone().addScaledVector(a, t * len).addScaledVector(u, Math.cos(ang) * radius).addScaledVector(w, Math.sin(ang) * radius)); }
  return pts;
}

// ---------- canvas art ----------
function paint(w, h, { base = '#4a5766', chips = 0.5, rivets = false, stencil = [], seed = 1 } = {}) {
  const c = cnv(w, h), x = c.getContext('2d'), r = lcg(seed);
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 90; i++) { x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; x.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 2); }
  const edge = (n) => { // rust-orange chips hugging the borders
    for (let i = 0; i < n; i++) {
      const side = (r() * 4) | 0, t = r(), off = Math.pow(r(), 3) * Math.min(w, h) * 0.035, s = 1.2 + r() * Math.min(w, h) * 0.004;
      const px = side < 2 ? t * w : side === 2 ? off : w - off, py = side < 2 ? (side === 0 ? off : h - off) : t * h;
      x.fillStyle = r() < 0.7 ? '#a8501d' : '#7a8088'; x.beginPath(); x.ellipse(px, py, s * (1 + r()), s, r() * 3, 0, Math.PI * 2); x.fill();
    }
  };
  edge(Math.round(chips * (w + h) * 0.5));
  if (rivets) { x.fillStyle = 'rgba(210,214,218,0.75)'; const m = Math.min(w, h) * 0.035, st = Math.min(w, h) * 0.07; for (let p = m; p < w - m; p += st) { for (const yy of [m, h - m]) { x.beginPath(); x.arc(p, yy, 2.2, 0, 7); x.fill(); } } for (let p = m; p < h - m; p += st) { for (const xx of [m, w - m]) { x.beginPath(); x.arc(xx, p, 2.2, 0, 7); x.fill(); } } }
  x.fillStyle = 'rgba(8,8,8,0.82)'; x.textBaseline = 'middle';
  for (const [t, px, py, sz, rot] of stencil) { x.save(); x.translate(px * w, py * h); x.rotate(rot || 0); x.font = `bold ${sz * h}px ${FONT}`; x.textAlign = 'center'; x.fillText(t, 0, 0); x.restore(); }
  return c;
}

function switchBank(w, h, seed, opts = {}) {
  const c = cnv(w, h), x = c.getContext('2d'), r = lcg(seed);
  x.fillStyle = '#17191c'; x.fillRect(0, 0, w, h);
  const cell = opts.cell || 56, pad = 8;
  for (let gy = 0; gy < h / cell; gy++) for (let gx = 0; gx < w / cell; gx++) {
    const cx = gx * cell + cell / 2, cy = gy * cell + cell / 2, k = r();
    if (opts.skip && opts.skip(cx / w, 1 - cy / h)) continue;
    x.fillStyle = '#d8dadc'; x.font = `${cell * 0.16}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (k < 0.34) { // toggle switch
      x.fillStyle = '#0b0b0c'; x.beginPath(); x.arc(cx, cy + 4, cell * 0.2, 0, 7); x.fill();
      x.fillStyle = '#aeb3b8'; x.fillRect(cx - 3, cy - cell * 0.22, 6, cell * 0.34); x.beginPath(); x.arc(cx, cy - cell * 0.22, 5, 0, 7); x.fill();
      x.fillStyle = '#d8dadc'; x.fillText(['ON', 'OFF', 'AUTO', 'NORM', 'TEST', 'ARM'][(r() * 6) | 0], cx, cy + cell * 0.36);
    } else if (k < 0.5) { // rotary knob
      x.fillStyle = '#080808'; x.beginPath(); x.arc(cx, cy, cell * 0.3, 0, 7); x.fill();
      x.strokeStyle = '#6c7076'; x.lineWidth = 2; x.stroke(); const a = r() * 6.28; x.strokeStyle = '#eee'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * cell * 0.27, cy + Math.sin(a) * cell * 0.27); x.stroke();
    } else if (k < 0.66) { // lamp cap
      const col = ['#c93a2a', '#d8a22a', '#3ea55a', '#e8e8e0'][(r() * 4) | 0];
      x.fillStyle = '#050505'; x.fillRect(cx - cell * 0.3, cy - cell * 0.2, cell * 0.6, cell * 0.4); x.fillStyle = col; x.fillRect(cx - cell * 0.25, cy - cell * 0.15, cell * 0.5, cell * 0.3);
      x.fillStyle = '#111'; x.fillText(['PWR', 'FUEL', 'HYD', 'OXY', 'TEMP'][(r() * 5) | 0], cx, cy);
    } else if (k < 0.74) { // guarded switch
      x.fillStyle = '#b62e22'; x.fillRect(cx - cell * 0.22, cy - cell * 0.22, cell * 0.44, cell * 0.44); x.fillStyle = '#111'; x.fillRect(cx - cell * 0.14, cy - cell * 0.14, cell * 0.28, cell * 0.28);
    } else if (k < 0.86) { x.fillStyle = '#d8dadc'; x.fillText(['CAUTION', 'NAV', 'ENG', 'AFCS', 'IFF', 'RADIO', 'LIGHTS', 'FUEL'][(r() * 8) | 0], cx, cy); }
  }
  if (opts.after) opts.after(x, w, h);
  x.strokeStyle = 'rgba(160,165,170,0.55)'; x.lineWidth = 2;
  for (let i = 1; i < 4; i++) { const yy = (h / 4) * i + (r() - 0.5) * 20; x.beginPath(); x.moveTo(pad, yy); x.lineTo(w - pad, yy); x.stroke(); }
  x.strokeStyle = '#2e3236'; x.lineWidth = 8; x.strokeRect(0, 0, w, h);
  return c;
}

function breakerPanel(w, h) {
  const c = cnv(w, h), x = c.getContext('2d');
  x.fillStyle = '#23262a'; x.fillRect(0, 0, w, h);
  const st = Math.round(w / 14);
  for (let j = st; j < h - st / 2; j += st) for (let i = st; i < w - st / 2; i += st) { x.fillStyle = '#050505'; x.beginPath(); x.arc(i, j, st * 0.3, 0, 7); x.fill(); x.strokeStyle = '#4a4e54'; x.lineWidth = 1.5; x.stroke(); }
  x.fillStyle = '#d8dadc'; x.font = `bold ${st * 0.5}px ${FONT}`; x.textAlign = 'center'; x.fillText('CIRCUIT BREAKERS', w / 2, st * 0.5);
  x.strokeStyle = '#3a3e44'; x.lineWidth = 6; x.strokeRect(0, 0, w, h);
  return c;
}

// Side-cheek gauges: every dial is driven by real sim state (no decorative needles), laid out on a grid so none overlap.
const psiAt = (ft) => 14.696 * Math.pow(Math.max(0.05, 1 - 6.8756e-6 * ft), 5.2559); // standard atmosphere
const rpmOf = (st, i) => (st.rpm ? st.rpm[i] : 0);
const nzOf = (st, i) => (st.noz ? st.noz[i] : 0), bpOf = (st, i) => (st.bypass ? st.bypass[i] : 0), egtOf = (st, i) => (st.egt ? st.egt[i] : 0), ffOf = (st, i) => (st.ff ? st.ff[i] : 0);
const LEFT_DIALS = [
  { t: 'HYD L', u: 'PSI x1000', min: 0, max: 4, major: 1, red: [0, 2], v: (st) => 3.0 * Math.min(1, rpmOf(st, 0) / 55) - (st.gearMoving ? 0.35 : 0) },
  { t: 'HYD R', u: 'PSI x1000', min: 0, max: 4, major: 1, red: [0, 2], v: (st) => 3.0 * Math.min(1, rpmOf(st, 1) / 55) - (st.gearMoving ? 0.35 : 0) },
  { t: 'HYD ACC', u: 'PSI x1000', min: 0, max: 4, major: 1, red: [0, 1.5], v: (st) => 2.9 - (st.brakes ? 0.5 : 0) },
  { t: 'OIL L', u: 'PSI', min: 0, max: 100, major: 25, red: [0, 10], v: (st) => rpmOf(st, 0) * 0.55 + (rpmOf(st, 0) > 5 ? 8 : 0) },
  { t: 'OIL R', u: 'PSI', min: 0, max: 100, major: 25, red: [0, 10], v: (st) => rpmOf(st, 1) * 0.55 + (rpmOf(st, 1) > 5 ? 8 : 0) },
  { t: 'OIL TEMP', u: '°C', min: 0, max: 200, major: 50, red: [160, 200], v: (st) => 40 + 0.9 * Math.max(rpmOf(st, 0), rpmOf(st, 1)) + 0.1 * (st.cit || 15) },
  { t: 'FUEL TEMP', u: '°C', min: -50, max: 150, major: 50, red: [120, 150], v: (st) => 15 + 0.42 * (st.cit || 15) },
  { t: 'CABIN ALT', u: 'FT x1000', min: 0, max: 50, major: 10, red: [35, 50], v: (st) => Math.min(26, 2 + (st.altFt / 1000) * 0.5) },
  { t: 'BRAKE', u: 'PSI x1000', min: 0, max: 4, major: 1, red: [3.6, 4], v: (st) => 3 - (st.brakes ? 1.4 : 0) },
];
const RIGHT_DIALS = [
  { t: 'OXY', u: 'LITRES', min: 0, max: 10, major: 2, red: [0, 1.5], v: (st) => Math.max(1, 8.6 - (st.flightTime || 0) / 3600 * 1.2) },
  { t: 'CABIN dP', u: 'PSI', min: 0, max: 6, major: 1, red: [5.2, 6], v: (st) => Math.max(0, psiAt(Math.min(26000, 2000 + st.altFt * 0.5)) - psiAt(st.altFt)) },
  { t: 'SUIT', u: '°C', min: 0, max: 60, major: 10, red: [45, 60], v: (st) => 18 + 0.05 * (st.cit || 15) },
  { t: 'DUCT', u: '°C x10', min: 0, max: 60, major: 10, red: [50, 60], v: (st) => 6 + 0.12 * (st.cit || 15) },
  { t: 'DC AMPS', u: 'A', min: 0, max: 400, major: 100, red: [350, 400], v: (st) => (rpmOf(st, 0) + rpmOf(st, 1)) * 0.9 + 40 },
  { t: 'DC VOLTS', u: 'V', min: 0, max: 30, major: 10, red: [0, 22], v: (st) => (rpmOf(st, 0) > 30 || rpmOf(st, 1) > 30 ? 28.2 : 24.1) },
  { t: 'TANK PRESS', u: 'PSI', min: 0, max: 20, major: 5, red: [15, 20], v: (st) => Math.min(9, 1.5 + st.altFt / 9000) },
  { t: 'FUEL', u: 'LB x1000', min: 0, max: 80, major: 20, red: [0, 6], v: (st) => st.fuelLb / 1000 },
  { t: 'OAT', u: '°C', min: -80, max: 40, major: 40, red: [30, 40], v: (st) => 15 - 6.5 * Math.min(11, Math.max(0, st.altFt * 0.0003048)) },
  { t: 'EGT L', u: '°C x100', min: 0, max: 10, major: 2, red: [8.6, 10], v: (st) => egtOf(st, 0) / 100 },
  { t: 'EGT R', u: '°C x100', min: 0, max: 10, major: 2, red: [8.6, 10], v: (st) => egtOf(st, 1) / 100 },
  { t: 'SPIKE L', u: 'IN AFT', min: 0, max: 26, major: 5, red: [0, 0], v: (st) => st.spikeIn || 0 },
  { t: 'SPIKE R', u: 'IN AFT', min: 0, max: 26, major: 5, red: [0, 0], v: (st) => st.spikeIn || 0 },
  { t: 'BYPASS L', u: '%', min: 0, max: 100, major: 25, red: [90, 100], v: (st) => bpOf(st, 0) },
  { t: 'BYPASS R', u: '%', min: 0, max: 100, major: 25, red: [90, 100], v: (st) => bpOf(st, 1) },
  { t: 'FUEL FLOW', u: 'PPH x1000', min: 0, max: 40, major: 10, red: [0, 0], v: (st) => ffOf(st, 0) / 1000 },
  { t: 'FUEL FLOW', u: 'PPH x1000', min: 0, max: 40, major: 10, red: [0, 0], v: (st) => ffOf(st, 1) / 1000 },
  { t: 'INLET T', u: '°C', min: -50, max: 450, major: 100, red: [410, 450], v: (st) => st.cit || 15 },
];
function dialGrid(w, h, cols, rows, top, specs, deco) {
  const face = cnv(w, h), x = face.getContext('2d'), cw = w / cols, ch = (h - top) / rows, rad = Math.min(cw, ch) * 0.44;
  x.fillStyle = '#15171a'; x.fillRect(0, 0, w, h);
  if (deco) deco(x, w, top);
  const cells = specs.map((sp, k) => ({ sp, cx: (k % cols + 0.5) * cw, cy: top + (((k / cols) | 0) + 0.5) * ch }));
  const ang = (sp, v) => -2.3 + 4.6 * (Math.min(sp.max, Math.max(sp.min, v)) - sp.min) / (sp.max - sp.min);
  for (const { sp, cx, cy } of cells) {
    x.fillStyle = '#2b2e32'; x.beginPath(); x.arc(cx, cy, rad * 1.1, 0, 7); x.fill();
    x.fillStyle = '#070707'; x.beginPath(); x.arc(cx, cy, rad, 0, 7); x.fill();
    if (sp.red) { x.strokeStyle = '#c92a1e'; x.lineWidth = rad * 0.07; x.beginPath(); x.arc(cx, cy, rad * 0.93, ang(sp, sp.red[0]) - Math.PI / 2, ang(sp, sp.red[1]) - Math.PI / 2); x.stroke(); }
    x.strokeStyle = '#e8e8e8'; x.fillStyle = '#e8e8e8'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const n = Math.round((sp.max - sp.min) / sp.major);
    for (let k = 0; k <= n * 4; k++) {
      const a = -2.3 + (4.6 * k) / (n * 4), big = k % 4 === 0;
      x.lineWidth = big ? 2.2 : 1; x.beginPath(); x.moveTo(cx + Math.sin(a) * rad * (big ? 0.74 : 0.82), cy - Math.cos(a) * rad * (big ? 0.74 : 0.82)); x.lineTo(cx + Math.sin(a) * rad * 0.88, cy - Math.cos(a) * rad * 0.88); x.stroke();
      if (big) { x.font = `bold ${Math.round(rad * 0.19)}px ${FONT}`; x.fillText(String(sp.min + (k / 4) * sp.major), cx + Math.sin(a) * rad * 0.58, cy - Math.cos(a) * rad * 0.58); }
    }
    x.fillStyle = '#cfd3d6'; x.font = `bold ${Math.round(rad * 0.19)}px ${FONT}`; x.fillText(sp.t, cx, cy + rad * 0.32);
    x.font = `${Math.round(rad * 0.15)}px ${FONT}`; x.fillText(sp.u, cx, cy + rad * 0.52);
  }
  const live = cnv(w, h), lx = live.getContext('2d');
  return { canvas: live, draw(st, dt = 0.15) {
    lx.drawImage(face, 0, 0);
    for (const c of cells) { const { sp, cx, cy } = c, tv = sp.v(st); c.val = c.val === undefined ? tv : c.val + (tv - c.val) * (1 - Math.exp(-dt * 4)); const a = ang(sp, c.val); lx.save(); lx.translate(cx, cy); lx.rotate(a); lx.fillStyle = '#f4f4f4'; lx.beginPath(); lx.moveTo(-rad * 0.04, 0); lx.lineTo(0, -rad * 0.8); lx.lineTo(rad * 0.04, 0); lx.closePath(); lx.fill(); lx.fillStyle = '#2c2e30'; lx.beginPath(); lx.arc(0, 0, rad * 0.07, 0, 7); lx.fill(); lx.restore(); }
  } };
}

function ringDisplay(size) { // round display ringed by push buttons
  const c = cnv(size, size), x = c.getContext('2d'), m = size / 2;
  x.fillStyle = '#17191c'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#2d3034'; x.beginPath(); x.arc(m, m, m * 0.97, 0, 7); x.fill();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283; x.fillStyle = '#d9d6c8'; x.fillRect(m + Math.cos(a) * m * 0.83 - 9, m + Math.sin(a) * m * 0.83 - 9, 18, 18); x.fillStyle = '#4a4a46'; x.fillRect(m + Math.cos(a) * m * 0.83 - 5, m + Math.sin(a) * m * 0.83 - 5, 10, 10); }
  x.fillStyle = '#050805'; x.beginPath(); x.arc(m, m, m * 0.66, 0, 7); x.fill();
  x.strokeStyle = '#0f5a30'; x.lineWidth = 1.5; for (let i = -4; i <= 4; i++) { x.beginPath(); x.moveTo(m + i * m * 0.14, m - m * 0.6); x.lineTo(m + i * m * 0.14, m + m * 0.6); x.stroke(); x.beginPath(); x.moveTo(m - m * 0.6, m + i * m * 0.14); x.lineTo(m + m * 0.6, m + i * m * 0.14); x.stroke(); }
  x.strokeStyle = '#38d878'; x.lineWidth = 3; x.beginPath(); x.arc(m, m, m * 0.25, 0, 7); x.stroke(); x.beginPath(); x.moveTo(m - m * 0.4, m); x.lineTo(m + m * 0.4, m); x.moveTo(m, m - m * 0.4); x.lineTo(m, m + m * 0.4); x.stroke();
  return c;
}

// Hooded top-centre Mach indicator: a static dial (0-3.5, 300 degrees of sweep) and a needle drawn on top for the current Mach.
const MACH_SWEEP = 300, MACH_MAX = 3.5, machAngle = (m) => (-MACH_SWEEP / 2 + Math.min(MACH_MAX, Math.max(0, m)) / MACH_MAX * MACH_SWEEP) * Math.PI / 180;
function roundGaugeFace(size) {
  const c = cnv(size, size), x = c.getContext('2d'), m = size / 2;
  x.fillStyle = '#111'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#e9e6dc'; x.beginPath(); x.arc(m, m, m * 0.94, 0, 7); x.fill();
  x.strokeStyle = '#111'; x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i <= 35; i++) { // minor tick every 0.1 Mach, long tick every 0.5, number every 1.0
    const mach = i / 10, a = machAngle(mach), major = i % 5 === 0, r0 = m * (major ? 0.72 : 0.8), r1 = m * 0.88;
    x.lineWidth = major ? 3 : 1.5; x.beginPath(); x.moveTo(m + Math.sin(a) * r0, m - Math.cos(a) * r0); x.lineTo(m + Math.sin(a) * r1, m - Math.cos(a) * r1); x.stroke();
    if (i % 10 === 0) { x.font = `bold ${size * 0.1}px ${FONT}`; x.fillText(String(i / 10), m + Math.sin(a) * m * 0.58, m - Math.cos(a) * m * 0.58); }
  }
  x.font = `bold ${size * 0.075}px ${FONT}`; x.fillText('MACH', m, m + m * 0.42);
  return c;
}
function drawMachNeedle(ctx, face, size, mach) {
  const m = size / 2, a = machAngle(mach);
  ctx.drawImage(face, 0, 0);
  ctx.save(); ctx.translate(m, m); ctx.rotate(a);
  ctx.fillStyle = '#c83a24'; ctx.beginPath(); ctx.moveTo(0, -m * 0.8); ctx.lineTo(6, 0); ctx.lineTo(3, m * 0.18); ctx.lineTo(-3, m * 0.18); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(m, m, 9, 0, 7); ctx.fill();
}

function trayScreen(w, h) {
  const c = cnv(w, h), x = c.getContext('2d');
  x.fillStyle = '#6d7278'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; x.fillRect(Math.random() * w, Math.random() * h, 3, 1); }
  x.fillStyle = '#0b0e0c'; x.fillRect(w * 0.08, h * 0.12, w * 0.84, h * 0.62);
  x.strokeStyle = '#2f7a50'; x.lineWidth = 1.5; for (let i = 1; i < 9; i++) { x.beginPath(); x.moveTo(w * 0.08 + (i * w * 0.84) / 9, h * 0.12); x.lineTo(w * 0.08 + (i * w * 0.84) / 9, h * 0.74); x.stroke(); }
  x.strokeStyle = '#46c880'; x.lineWidth = 3; x.beginPath(); x.moveTo(w * 0.12, h * 0.6); x.bezierCurveTo(w * 0.35, h * 0.2, w * 0.6, h * 0.7, w * 0.88, h * 0.3); x.stroke();
  for (let i = 0; i < 7; i++) { x.fillStyle = '#1a1c1e'; x.fillRect(w * 0.1 + i * w * 0.12, h * 0.82, w * 0.08, h * 0.1); }
  x.strokeStyle = '#4b5056'; x.lineWidth = 6; x.strokeRect(0, 0, w, h);
  return c;
}

function hoseTex() { const c = cnv(16, 256), x = c.getContext('2d'); for (let i = 0; i < 64; i++) { x.fillStyle = i % 2 ? '#b8bcc0' : '#6f7378'; x.fillRect(0, i * 4, 16, 4); } return c; }
function stripeTex() { const c = cnv(16, 256), x = c.getContext('2d'); for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#101010' : '#e6c21c'; x.fillRect(0, i * 16, 16, 16); } return c; }

// ---------- builder ----------
export function buildRealCockpit(model, panel, skinMat) {
  const panelTex = panel.texture;
  const root = new THREE.Group(); root.name = 'SR71_RealCockpit';
  const interior = new THREE.Group(), canopy = new THREE.Group(); root.add(interior, canopy); model.add(root);
  const stdMats = [], panelMats = [], lamps = [];
  const std = (o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide, ...o }); stdMats.push(m); return m; };
  const lit = (map) => { const m = new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide }); panelMats.push(m); return m; };
  const add = (parent, geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.castShadow = false; m.receiveShadow = false; if (name) m.name = name; parent.add(m); return m; };
  const merged = (parent, geos, mat, name) => add(parent, mergeGeometries(geos, false), mat, name);

  const paintBlue = std({ color: 0xffffff, map: mkTex(paint(1024, 1024, { base: '#44505e', rivets: true, chips: 0.7, seed: 3, stencil: [['C2', 0.14, 0.9, 0.07], ['NO STEP', 0.7, 0.12, 0.04]] })), roughness: 0.78 });
  const black = std({ color: 0x15171a, roughness: 0.55, metalness: 0.2 });
  const greyTray = std({ color: 0x6d7378, roughness: 0.5, metalness: 0.35 });
  const metal = std({ color: 0x9a968a, roughness: 0.42, metalness: 0.7 });
  const frameMat = std({ color: 0x6a665c, roughness: 0.5, metalness: 0.6 });
  const redMat = std({ color: 0xb42a1c, roughness: 0.4, metalness: 0.1 });

  // ===== canopy: one lofted gable shared by all glass, rails and bows =====
  // outline measured from the exterior canopy mesh (half-width and roof height along the aircraft) so inside and outside are one shape:
  // a domed hatch 0.7 m half-width, roof 3.62 m, and a windscreen raked down to the nose from x = 12.05
  const HW = [[10.62, 0.74], [10.9, 0.70], [11.3, 0.65], [11.7, 0.57], [12.1, 0.47], [12.3, 0.39], [12.45, 0.30], [12.57, 0.08]];
  const hwAt = (x) => { for (let i = 1; i < HW.length; i++) if (x <= HW[i][0]) { const [x0, a] = HW[i - 1], [x1, b] = HW[i]; return a + ((b - a) * (x - x0)) / (x1 - x0); } return HW[HW.length - 1][1]; };
  const SILL = 3.09, RIDGE = [[10.62, 3.50], [10.9, 3.61], [11.0, 3.62], [12.0, 3.62], [12.1, 3.57], [12.3, 3.40], [12.5, 3.23], [12.57, 3.17]];
  const ridgeY = (x) => { for (let i = 1; i < RIDGE.length; i++) if (x <= RIDGE[i][0]) { const [x0, a] = RIDGE[i - 1], [x1, b] = RIDGE[i]; return a + ((b - a) * (x - x0)) / (x1 - x0); } return RIDGE[RIDGE.length - 1][1]; };
  const shY = (x) => Math.max(SILL + 0.03, ridgeY(x) - 0.27);
  const XS = [10.62, 10.95, 11.3, 11.65, 12.0, 12.2, 12.4, 12.57];
  const sec = XS.map((x) => { const w = hwAt(x) + 0.02; return { S: [V(x, SILL, -w), V(x, SILL, w)], H: [V(x, shY(x), -w * 0.8), V(x, shY(x), w * 0.8)], R: V(x, ridgeY(x), 0) }; });
  const glassGeos = [];
  for (let k = 0; k < XS.length - 1; k++) for (const s of [0, 1]) {
    const a = sec[k], b = sec[k + 1], sg = s ? 1 : -1;
    const pts = (p, q, r, t) => (s ? quad(p, q, r, t) : quad(q, p, t, r));
    glassGeos.push(pts(a.S[s], b.S[s], b.H[s], a.H[s]), pts(a.H[s], b.H[s], b.R, a.R));
    void sg;
  }
  // The canopy glass covers the whole forward view, two layers deep (both faces). As a lit PBR material it cost a full lighting + environment lookup
  // on every pixel of the screen; it is a plain tint, so a flat transparent material gives the same picture for a fraction of the fill cost.
  const glass = new THREE.MeshBasicMaterial({ color: 0x1b332d, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const gm = merged(canopy, glassGeos, glass, 'RC_Glass'); gm.renderOrder = 3;
  root.userData.glass = gm;

  const rail = [], rib = [];
  const T = 0.03;
  for (let k = 0; k < XS.length - 1; k++) for (const s of [0, 1]) {
    rail.push(beam(sec[k].S[s], sec[k + 1].S[s], 0.03, 0.026), beam(sec[k].H[s], sec[k + 1].H[s], 0.02, 0.02));
  }
  for (let k = 0; k < XS.length - 1; k++) rail.push(beam(sec[k].R, sec[k + 1].R, 0.02, 0.02));
  const ribAt = (k, t) => { const q = sec[k]; rib.push(beam(q.S[0], q.H[0], t), beam(q.H[0], q.R, t), beam(q.R, q.H[1], t), beam(q.H[1], q.S[1], t)); };
  ribAt(0, 0.04); ribAt(3, 0.024); ribAt(5, 0.03); ribAt(7, 0.03);
  rail.push(beam(V(12.57, SILL, 0), V(12.57, ridgeY(12.57), 0), 0.026, 0.02)); // front centre post
  merged(canopy, rail.concat(rib), frameMat, 'RC_Frame');
  // rear closing bow so the hatch has a back wall
  { const q = sec[0], g = new THREE.BufferGeometry(), P = [q.S[0], q.H[0], q.R, q.H[1], q.S[1]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((p) => [p.x - 0.02, p.y, p.z]), 3)); g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]); g.computeVertexNormals();
    add(canopy, g, skinMat ? skinMat : black, 'RC_RearBow'); }
  // rivets along the sill rails
  { const n = 70, im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.007, 6, 4), metal, n * 2), M = new THREE.Matrix4(); let i = 0;
    for (const s of [-1, 1]) for (let j = 0; j < n; j++) { const x = 10.66 + (j / (n - 1)) * 1.9, w = hwAt(x); M.setPosition(x, SILL + 0.017, s * (w - 0.012)); im.setMatrixAt(i++, M); }
    canopy.add(im); }
  // windshield A-pillars: in the photographs each runs from the panel's side corner up to the apex and carries the row of orange lamps
  { const n = 11, lampMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5410, emissiveIntensity: 1.6, roughness: 0.3 }), im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0085, 10, 8), lampMat, n * 2), M = new THREE.Matrix4(); let i = 0;
    const post = [];
    for (const sd of [-1, 1]) {
      const a = V(12.1, SILL + 0.01, sd * (hwAt(12.1) - 0.01)), b = V(12.56, ridgeY(12.56) - 0.02, sd * 0.045);
      post.push(beam(a, b, 0.034, 0.03));
      const dir = b.clone().sub(a);
      for (let j = 0; j < n; j++) { const p = a.clone().addScaledVector(dir, 0.08 + (0.84 * j) / (n - 1)); p.x -= 0.022; p.z -= sd * 0.012; M.setPosition(p); im.setMatrixAt(i++, M); }
    }
    merged(canopy, post, frameMat, 'RC_APillars'); lamps.push(lampMat); canopy.add(im); }

  // ===== instrument panel: three facets, centre flat, wings angled in =====
  const Y0 = 2.52, Y1 = 3.05, LEAN = 0.045, ZC = 0.158, TH = 33 * Math.PI / 180;
  const WLw = 0.267, WRw = 0.362;
  const outerL = V(12.03 - Math.sin(TH) * WLw, 0, -ZC - Math.cos(TH) * WLw), outerR = V(12.03 - Math.sin(TH) * WRw, 0, ZC + Math.cos(TH) * WRw);
  const facet = (xl, zl, xr, zr, uv) => quad(V(xl, Y0, zl), V(xr, Y0, zr), V(xr + LEAN, Y1, zr), V(xl + LEAN, Y1, zl), uv);
  const pm = new THREE.MeshBasicMaterial({ map: panelTex, toneMapped: false, side: THREE.DoubleSide });
  pm.onBeforeCompile = (shader) => {
    shader.uniforms.uPanelDynamicMap = { value: panel.dynamicTexture };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uPanelDynamicMap;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nvec4 panelOverlayColor = texture2D(uPanelDynamicMap, vMapUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, panelOverlayColor.rgb, panelOverlayColor.a);');
  };
  pm.customProgramCacheKey = () => 'sr71-panel-dynamic-overlay-v1';
  panelMats.push(pm);
  const U = [580 / 2048, 1262 / 2048];
  const panelPick = [add(interior, facet(outerL.x, outerL.z, 12.03, -ZC, [0, 0, U[0], 1]), pm, 'RC_PanelL'), add(interior, facet(12.03, -ZC, 12.03, ZC, [U[0], 0, U[1], 1]), pm, 'RC_PanelC'), add(interior, facet(12.03, ZC, outerR.x, outerR.z, [U[1], 0, 1, 1]), pm, 'RC_PanelR')];
  // cheeks beside the wings: the left carries the button-ringed display (painted on the same face, so it can never float), the right a dial cluster
  const cheekY0 = Y0 - 0.06, cheekY1 = Y1;
  const cL = quad(V(11.74, cheekY0, -0.60), V(outerL.x, cheekY0, outerL.z), V(outerL.x + LEAN, cheekY1, outerL.z), V(11.74 + LEAN, cheekY1, -0.60));
  const cR = quad(V(outerR.x, cheekY0, outerR.z), V(11.70, cheekY0, 0.60), V(11.70 + LEAN, cheekY1, 0.60), V(outerR.x + LEAN, cheekY1, outerR.z));
  const ringImg = ringDisplay(256);
  const gridL = dialGrid(512, 1024, 3, 3, 472, LEFT_DIALS, (x, w, top) => x.drawImage(ringImg, w / 2 - 224, 12, 448, 448)), gridR = dialGrid(512, 1024, 3, 6, 0, RIGHT_DIALS);
  const texL = mkTex(gridL.canvas), texR = mkTex(gridR.canvas);
  add(interior, cL, lit(texL), 'RC_CheekL');
  add(interior, cR, lit(texR), 'RC_CheekR');
  const cheek = { acc: 1, update(st, dt) { this.acc += dt; if (this.acc < 0.12) return; const d = this.acc; this.acc = 0; gridL.draw(st, d); gridR.draw(st, d); texL.needsUpdate = texR.needsUpdate = true; } };
  { const z = { rpm: [0, 0], cit: 15, altFt: 0, fuelLb: 0, noz: [0, 0], bypass: [0, 0], egt: [0, 0], ff: [0, 0], spikeIn: 0 }; gridL.draw(z); gridR.draw(z); }
  // glare shield: V-shaped shelf closing the nose end of the opening, sloping up to the windshield sill
  const shelfPts = [[outerL.x + LEAN, outerL.z], [12.03 + LEAN, -ZC], [12.03 + LEAN, ZC], [outerR.x + LEAN, outerR.z], [11.8, 0.56], [12.1, 0.49], [12.3, 0.41], [12.45, 0.31], [12.58, 0.1], [12.58, -0.1], [12.45, -0.31], [12.3, -0.41], [12.1, -0.49], [11.8, -0.56]];
  const shelfOrder = [shelfPts[0], shelfPts[1], shelfPts[2], shelfPts[3], shelfPts[4], shelfPts[5], shelfPts[6], shelfPts[7], shelfPts[8], shelfPts[9], shelfPts[10], shelfPts[11], shelfPts[12], shelfPts[13]];
  const glareMat = std({ color: 0xffffff, map: mkTex(paint(512, 512, { base: '#3a4552', rivets: true, chips: 0.9, seed: 5, stencil: [['C2', 0.5, 0.18, 0.1], ['NO STEP', 0.5, 0.86, 0.05]] })), roughness: 0.8 });
  add(interior, polyY(shelfOrder, (x) => 3.06 + (x - 12.05) * 0.06), glareMat, 'RC_Glare');
  // hooded round indicator at the top centre and its shroud
  const machFace = roundGaugeFace(256), machCv = cnv(256, 256), machCtx = machCv.getContext('2d'); drawMachNeedle(machCtx, machFace, 256, 0);
  const machTex = mkTex(machCv); let machShown = -1;
  { const faceMat = lit(machTex), face = new THREE.Mesh(new THREE.CircleGeometry(0.062, 32), faceMat); face.position.set(12.215, 3.155, 0); face.rotation.y = -Math.PI / 2; interior.add(face);
    const hood = new THREE.CylinderGeometry(0.078, 0.078, 0.1, 28, 1, true).rotateZ(Math.PI / 2).translate(12.165, 3.155, 0);
    add(interior, hood, black, 'RC_Hood');
 }
  // large hinged grey display tray under the centre panel
  { const w = 0.34, d = 0.075, h = 0.19, g = new THREE.Group(); g.position.set(12.015, 2.5, 0); g.rotation.z = 0.32;
    const body = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), greyTray); body.position.set(-d / 2, -h / 2, 0); g.add(body);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, h * 0.9), lit(mkTex(trayScreen(256, 160)))); scr.rotation.y = -Math.PI / 2; scr.position.set(-d - 0.002, -h / 2, 0); g.add(scr);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, w * 1.04, 12), metal); hinge.rotation.x = Math.PI / 2; hinge.position.set(0, 0, 0); g.add(hinge);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), metal); arm.position.set(-0.03, -0.1, s * (w / 2 + 0.012)); g.add(arm); }
    interior.add(g); }
  // kick panel closing the footwell below the panel
  add(interior, quad(V(12.03, Y0, -0.45), V(12.03, Y0, 0.45), V(12.1, 2.2, 0.4), V(12.1, 2.2, -0.4)), black, 'RC_Kick');

  // ===== side consoles: each is a tilted group so every panel, housing and lever sits ON the sloping top, not through it =====
  const SL = 0.35, TILT = Math.atan(SL);
  const cons = (side) => { const g = new THREE.Group(), zc = side * 0.4; g.position.set(0, side < 0 ? 2.78 - SL * (zc + 0.6) : 2.64 + SL * (zc - 0.2), zc); g.rotation.x = side < 0 ? TILT : -TILT; interior.add(g); return g; };
  const consL = cons(-1), consR = cons(1);
  const topQ = (g, w, texMat, name) => { const m = add(g, quad(V(10.85, 0, -w / 2), V(10.85, 0, w / 2), V(11.8, 0, w / 2), V(11.8, 0, -w / 2)), texMat, name); return m; };
  // The throttle plate (left) and the circuit-breaker panel (right) are painted into the console textures themselves, so they are exactly flush
  // with the surface and can never overlap the printed switches around them. Console texture: u across (outboard -> inboard), v along (aft -> nose).
  const throttlePlate = (x, w, h) => {
    const X = (u) => u * w, Y = (v) => (1 - v) * h;
    x.fillStyle = '#0c0d0f'; x.beginPath(); x.roundRect(X(0.1), Y(0.7), X(0.4) - X(0.1), Y(0.18) - Y(0.7), 10); x.fill();
    x.strokeStyle = '#3a3e44'; x.lineWidth = 4; x.stroke();
    x.fillStyle = '#020202'; x.beginPath(); x.roundRect(X(0.2), Y(0.653), X(0.4) - X(0.2), Y(0.295) - Y(0.653), 9); x.fill();
    x.strokeStyle = '#555a61'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#8a8f96'; for (const [u, v] of [[0.13, 0.21], [0.47, 0.21], [0.13, 0.67], [0.47, 0.67]]) { x.beginPath(); x.arc(X(u), Y(v), 5, 0, 7); x.fill(); }
    x.fillStyle = '#d8dadc'; x.font = `bold 13px ${FONT}`; x.textAlign = 'center'; x.fillText('IDLE', X(0.3), Y(0.285) + 14); x.fillText('MAX A/B', X(0.3), Y(0.665) - 6);
  };
  const breakerCv = breakerPanel(190, 430);
  topQ(consL, 0.424, std({ map: mkTex(switchBank(512, 1024, 11, { skip: (u, v) => u < 0.12 || (u < 0.5 && v > 0.1 && v < 0.76), after: throttlePlate })), roughness: 0.6 }), 'RC_ConsoleL');
  topQ(consR, 0.424, std({ map: mkTex(switchBank(512, 1024, 12, { skip: (u, v) => u < 0.12 || (u > 0.5 && v < 0.52) || (u > 0.12 && u < 0.45 && v > 0.6 && v < 0.96), after: (x, w, h) => x.drawImage(breakerCv, 0.55 * w, 0.53 * h, 190, 430) })), roughness: 0.6 }), 'RC_ConsoleR');
  // walls: console sides, front end caps and the inboard faces, so no black gap shows between console, panel and floor
  for (const side of [-1, 1]) {
    const zi = side * 0.2, zo = side * 0.6, yTop = (z) => (side < 0 ? 2.78 - SL * (z + 0.6) : 2.64 + SL * (z - 0.2));
    add(interior, quad(V(10.85, 2.2, zi), V(11.8, 2.2, zi), V(11.8, yTop(zi), zi), V(10.85, yTop(zi), zi)), paintBlue);
    add(interior, quad(V(10.85, 2.2, zo), V(11.8, 2.2, zo), V(11.8, yTop(zo), zo), V(10.85, yTop(zo), zo)), paintBlue);
    add(interior, quad(V(11.8, 2.2, zi), V(11.8, 2.2, zo), V(11.8, yTop(zo), zo), V(11.8, yTop(zi), zi)), paintBlue);
    add(interior, quad(V(10.85, 2.2, zi), V(10.85, 2.2, zo), V(10.85, yTop(zo), zo), V(10.85, yTop(zi), zi)), paintBlue);
  }
  // throttle quadrant (left console, outboard half): housing with a slot, two black levers with red knobs, and a coiled cord down the outside
  const throttles = [];
  {
    for (const dz of [-0.025, 0.025]) {
      const piv = new THREE.Group(); piv.position.set(11.3, 0.004, -0.085 + dz); piv.rotation.z = 0.5; consL.add(piv);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.011, 0.19, 12), black); lever.position.y = 0.095; piv.add(lever);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.014, 12), metal); collar.position.y = 0.17; piv.add(collar);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.05, 18), redMat); knob.position.y = 0.2; piv.add(knob);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), redMat); cap.position.y = 0.225; piv.add(cap);
      throttles.push(piv); piv.traverse((o) => { if (o.isMesh) o.userData.thr = true; });
    }
    const coil = helix(V(11.04, 0.012, -0.188), V(10.9, 0.012, -0.188), 0.009, 10, 90);
    add(consL, tube(coil, 0.0028, 180, 6), black, 'RC_ThrottleCable');
    add(consL, tube([V(10.9, 0.012, -0.188), V(10.86, 0.0, -0.2), V(10.86, -0.08, -0.215), V(10.9, -0.2, -0.215)], 0.004, 30, 6), black, 'RC_ThrottleLead'); }
  // right console: silver oxygen hose and a black lever with a red tip
  { const hoseMat = std({ color: 0xffffff, map: mkTex(hoseTex(), [1, 1]), roughness: 0.35, metalness: 0.7 });
    add(consR, tube([V(10.9, 0.02, -0.18), V(11.1, 0.035, -0.185), V(11.4, 0.04, -0.185), V(11.66, 0.03, -0.18), V(11.8, 0.0, -0.17)], 0.011, 120, 8), hoseMat, 'RC_Hose');
    const lp = new THREE.Group(); lp.position.set(11.55, 0.01, -0.1); lp.rotation.z = 0.9; consR.add(lp);
    const lev = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.17, 10), black); lev.position.y = 0.085; lp.add(lev);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.045, 14), redMat); knob.position.y = 0.19; lp.add(knob); }

  // ===== stick, pedestal and the yellow-and-black coiled hose =====
  let stick = null;
  { const g = new THREE.Group(); g.position.set(11.8, 2.2, 0); interior.add(g); stick = g;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.14, 16), black); boot.position.y = 0.07; g.add(boot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.38, 12), metal); shaft.position.set(-0.03, 0.27, 0); shaft.rotation.z = 0.15; g.add(shaft);
    const gr = new THREE.Group(); gr.position.set(-0.075, 0.47, 0); gr.rotation.z = 0.28; g.add(gr);
    const rub = std({ color: 0x131416, roughness: 0.45, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.085, 6, 16), rub); body.position.y = 0.05; gr.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.033, 16, 12), rub); head.position.y = 0.115; head.scale.set(1, 0.7, 1.15); gr.add(head);
    for (const [px, py, pz, col] of [[0.024, 0.1, -0.012, 0xcfcfc8], [0.026, 0.075, 0.012, 0xcfcfc8], [0.027, 0.03, -0.014, 0xc62a1e]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10), std({ color: col })); b.position.set(px, py, pz); b.rotation.z = Math.PI / 2; gr.add(b); }
    const hose = tube(helix(V(11.8, 2.3, 0.06), V(11.55, 2.62, 0.04), 0.045, 7, 140), 0.011, 280, 8);
    add(interior, hose, std({ color: 0xffffff, map: mkTex(stripeTex(), [1, 1]), roughness: 0.55 }), 'RC_StickHose');
    add(interior, tube([V(11.55, 2.62, 0.04), V(11.4, 2.62, 0.2), V(11.2, 2.55, 0.25)], 0.011, 40, 8), std({ color: 0xe6c21c, roughness: 0.55 })); }

  // ===== seat: sits between the consoles (never inside them): khaki cushion, tan stencilled back, black rails and head cushion =====
  { const tan = std({ color: 0xffffff, map: mkTex(paint(512, 768, { base: '#a89066', chips: 0.02, seed: 21, stencil: [['EJECTION', 0.5, 0.2, 0.05], ['SEAT', 0.5, 0.26, 0.05], ['WARNING', 0.5, 0.5, 0.04], ['C2', 0.5, 0.75, 0.09], ['PULL', 0.5, 0.9, 0.04]] })), roughness: 0.92 });
    const khaki = std({ color: 0x867a52, roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.33), tan); back.position.set(10.74, 3.02, 0); back.rotation.z = -0.1; interior.add(back);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.26), black); head.position.set(10.69, 3.5, 0); head.rotation.z = -0.1; interior.add(head);
    for (const s2 of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.03), black); r.position.set(10.73, 3.0, s2 * 0.18); r.rotation.z = -0.1; interior.add(r); }
    const cush = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.34), khaki); cush.position.set(11.0, 2.55, 0); interior.add(cush);
    for (const z of [0.09, -0.09]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.8, 0.045), std({ color: 0x5b6048 })); strap.position.set(10.775, 3.0, z); strap.rotation.z = -0.1; interior.add(strap); }
    // red bottles low behind the seat, clear of the pilot's view
    const bottle = std({ color: 0xb02a1a, roughness: 0.4, metalness: 0.25 });
    for (const z of [-0.3, 0.3]) add(interior, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 20).translate(10.62, 2.42, z), bottle, 'RC_Bottle'); }

  void T;
  const THR_IDLE = 0.5, THR_FULL = -0.4;
  const controls = { set(st) {
    if (st.throttle !== undefined) for (const t of throttles) t.rotation.z = THR_IDLE + (THR_FULL - THR_IDLE) * Math.min(1, Math.max(0, st.throttle));
    if (st.mach !== undefined && Math.abs(st.mach - machShown) > 0.008) { machShown = st.mach; drawMachNeedle(machCtx, machFace, 256, st.mach); machTex.needsUpdate = true; }
    if (stick && st.stick) { stick.rotation.z = st.stick.p * 0.2; stick.rotation.x = st.stick.r * 0.2; }
  } };
  return { group: root, interior, canopy, stdMats, panelMats, lamps, cheek, controls, machDial: machCv, pick: { panels: panelPick, throttles } };
}
