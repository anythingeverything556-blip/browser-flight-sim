import * as THREE from 'three';

// Live Skyhawk six-pack and tachometer. The panel in C172.glb is one static mesh with the dials and needles drawn in, so each instrument is
// redrawn whole (face, markings, needles) on a canvas atlas and shown on a round cut-out quad 2 mm in front of the modelled face, behind the
// cover glass. One mesh, one draw call; the canvas is redrawn and uploaded at up to 20 Hz, only while the cockpit view is on.
// Face centres and radius were measured from a straight-on raster of the GLB panel (model frame: +x nose, +y up, +z right wing, metres).
const FACE_R = 0.0403, FACE_X = -0.2915, CELL = 256, PX_R = 122;
export const GAUGES = {
  asi: { z: -0.3343, y: 1.3642 }, ai: { z: -0.2253, y: 1.3687 }, alt: { z: -0.1208, y: 1.3632 },
  tc: { z: -0.3195, y: 1.2532 }, hi: { z: -0.2147, y: 1.2532 }, vsi: { z: -0.1143, y: 1.2545 }, tach: { z: -0.3103, y: 1.1643 },
};
const ORDER = Object.keys(GAUGES), COLS = 4, ROWS = 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class C172Gauges {
  constructor() {
    const c = this.canvas = document.createElement('canvas'); c.width = CELL * COLS; c.height = CELL * ROWS;
    this.ctx = c.getContext('2d');
    this.texture = new THREE.CanvasTexture(c); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
    // the quad's half-size is the face radius scaled from the drawn face (PX_R of the CELL / 2 px cell)
    const h = FACE_R * (CELL / 2) / PX_R, pos = [], uv = [], idx = [];
    ORDER.forEach((k, i) => {
      const g = GAUGES[k], col = i % COLS, row = Math.floor(i / COLS), u0 = col / COLS, u1 = (col + 1) / COLS, v1 = 1 - row / ROWS, v0 = 1 - (row + 1) / ROWS, b = i * 4;
      // seen from the seat (looking +x) screen-right is +z
      pos.push(FACE_X, g.y - h, g.z - h, FACE_X, g.y - h, g.z + h, FACE_X, g.y + h, g.z + h, FACE_X, g.y + h, g.z - h);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3); // front face toward the seat (-x)
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    // the emissive map is the face itself: at night the markings and needles glow (the instruments' own lamps), the black face stays dark
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.texture, emissiveMap: this.texture, emissive: 0xfff0dc, emissiveIntensity: 0, roughness: 0.55, metalness: 0, alphaTest: 0.5 }));
    this.mesh.name = 'C172_Gauges'; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.v = { ias: 0, alt: 0, pitch: 0, bank: 0, hdg: 0, vs: 0, turn: 0, ball: 0, rpm: 0 };
    this.lastHdg = null; this.acc = 1; this.draws = 0;
    this.draw();
  }

  setLight(k) { this.mesh.material.emissiveIntensity = k; }

  // s: { ias (kt), alt (ft), pitch, bank (rad), hdg (deg), vs (ft/min), beta (rad), rpm }; view: the camera view
  update(dt, s, view) {
    const v = this.v, k = 1 - Math.exp(-dt / 0.35);
    // the VSI and the turn needle lag like the real ones; the others follow directly
    if (this.lastHdg != null && dt > 0) { const d = ((s.hdg - this.lastHdg + 540) % 360) - 180; v.turn += (clamp(d / dt, -12, 12) - v.turn) * (1 - Math.exp(-dt / 0.5)); }
    this.lastHdg = s.hdg;
    v.vs += (s.vs - v.vs) * (1 - Math.exp(-dt / 1.2)); v.ball += (clamp(s.beta * 8, -1, 1) - v.ball) * k;
    v.ias = s.ias; v.alt = s.alt; v.pitch = s.pitch; v.bank = s.bank; v.hdg = s.hdg; v.rpm += (s.rpm - v.rpm) * k;
    this.mesh.visible = view === 'cockpit';
    if (!this.mesh.visible) return;
    this.acc += dt; if (this.acc < 0.05) return;
    this.acc = 0; this.draw();
  }

  draw() {
    const x = this.ctx;
    ORDER.forEach((k, i) => {
      x.save(); x.translate((i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2);
      x.clearRect(-CELL / 2, -CELL / 2, CELL, CELL);
      x.beginPath(); x.arc(0, 0, PX_R, 0, Math.PI * 2); x.fillStyle = '#19191b'; x.fill(); x.clip();
      this[k](x); x.restore();
    });
    this.texture.needsUpdate = true; this.draws++;
  }

  // ----- faces (0,0 at the centre, PX_R the face radius, angles clockwise from 12 o'clock) -----
  ticks(x, from, to, step, len, width, ang, color = '#e8e8e4') {
    x.strokeStyle = color; x.lineWidth = width;
    for (let v = from; v <= to + 1e-6; v += step) { const a = ang(v); x.beginPath(); x.moveTo(Math.sin(a) * (PX_R - 4), -Math.cos(a) * (PX_R - 4)); x.lineTo(Math.sin(a) * (PX_R - 4 - len), -Math.cos(a) * (PX_R - 4 - len)); x.stroke(); }
  }
  label(x, text, a, r, size = 24) { x.fillStyle = '#e8e8e4'; x.font = `600 ${size}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, Math.sin(a) * r, -Math.cos(a) * r); }
  arc(x, a0, a1, r, w, color) { x.beginPath(); x.arc(0, 0, r, a0 - Math.PI / 2, a1 - Math.PI / 2); x.strokeStyle = color; x.lineWidth = w; x.stroke(); }
  needle(x, a, len, w = 7, color = '#f4f4f0', tail = 18) {
    x.save(); x.rotate(a); x.fillStyle = color; x.beginPath(); x.moveTo(-w / 2, tail); x.lineTo(-w / 2, -len + 10); x.lineTo(0, -len); x.lineTo(w / 2, -len + 10); x.lineTo(w / 2, tail); x.closePath(); x.fill(); x.restore();
    x.beginPath(); x.arc(0, 0, 9, 0, Math.PI * 2); x.fillStyle = '#2a2a2c'; x.fill();
  }
  caption(x, text, y, size = 15) { x.fillStyle = '#bdbdb8'; x.font = `600 ${size}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 0, y); }

  asi(x) {
    const ang = (kt) => (-150 + (clamp(kt, 30, 200) - 30) * 300 / 170) * D2R;
    this.arc(x, ang(40), ang(85), PX_R - 18, 7, '#f2f2ee');                 // flap range (white)
    this.arc(x, ang(48), ang(129), PX_R - 9, 9, '#2fb24a');                 // normal (green)
    this.arc(x, ang(129), ang(163), PX_R - 9, 9, '#f2c230');                // caution (yellow)
    this.ticks(x, 163, 163, 1, 22, 6, ang, '#e0262a');                       // Vne
    this.ticks(x, 40, 200, 10, 14, 3, ang); this.ticks(x, 40, 200, 20, 22, 4, ang);
    for (let k = 40; k <= 200; k += 20) this.label(x, String(k), ang(k), PX_R - 48, 21);
    this.caption(x, 'KNOTS', 38); this.needle(x, ang(this.v.ias), PX_R - 14);
  }
  ai(x) {
    const v = this.v, ppd = 3.4; // pixels per degree of pitch
    x.save(); x.rotate(-v.bank); x.translate(0, clamp(v.pitch / D2R, -30, 30) * ppd);
    x.fillStyle = '#3b8fd6'; x.fillRect(-300, -600, 600, 600); x.fillStyle = '#8b5a2b'; x.fillRect(-300, 0, 600, 600);
    x.strokeStyle = '#ffffff'; x.lineWidth = 3; x.beginPath(); x.moveTo(-300, 0); x.lineTo(300, 0); x.stroke();
    for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) { const w = p % 10 ? 18 : 36; x.lineWidth = 2.5; x.beginPath(); x.moveTo(-w, -p * ppd); x.lineTo(w, -p * ppd); x.stroke(); if (!(p % 10)) { x.fillStyle = '#fff'; x.font = '600 15px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(Math.abs(p)), w + 16, -p * ppd); } }
    x.restore();
    // bank scale on the case, pointer on the rotating sky
    x.strokeStyle = '#ffffff';
    for (const b of [-60, -30, -20, -10, 10, 20, 30, 60]) { const a = b * D2R, l = Math.abs(b) % 30 ? 10 : 18; x.lineWidth = Math.abs(b) % 30 ? 2.5 : 4; x.beginPath(); x.moveTo(Math.sin(a) * (PX_R - 3), -Math.cos(a) * (PX_R - 3)); x.lineTo(Math.sin(a) * (PX_R - 3 - l), -Math.cos(a) * (PX_R - 3 - l)); x.stroke(); }
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(0, -PX_R + 3); x.lineTo(-8, -PX_R + 18); x.lineTo(8, -PX_R + 18); x.fill();
    x.save(); x.rotate(-v.bank); x.fillStyle = '#f39c32'; x.beginPath(); x.moveTo(0, -PX_R + 22); x.lineTo(-9, -PX_R + 38); x.lineTo(9, -PX_R + 38); x.fill(); x.restore();
    // miniature aircraft (fixed)
    x.fillStyle = '#f39c32'; x.fillRect(-62, -3, 40, 7); x.fillRect(22, -3, 40, 7); x.fillRect(-26, -3, 7, 14); x.fillRect(19, -3, 7, 14); x.beginPath(); x.arc(0, 0, 6, 0, Math.PI * 2); x.fill();
  }
  alt(x) {
    const a = this.v.alt, ang = (d) => (d / 10) * Math.PI * 2;
    this.ticks(x, 0, 9.8, 0.2, 10, 3, ang); this.ticks(x, 0, 9, 1, 22, 5, ang);
    for (let k = 0; k <= 9; k++) this.label(x, String(k), ang(k), PX_R - 46, 26);
    this.caption(x, 'ALT', -30); this.caption(x, '29.92', 34, 14);
    this.needle(x, ang(((a / 10000) % 1) * 10), PX_R - 10, 3, '#f4f4f0', 0);    // 10,000 ft pointer
    this.needle(x, ang(((a / 1000) % 10)), PX_R - 62, 11);                       // 1,000 ft hand
    this.needle(x, ang(((a / 100) % 10)), PX_R - 16, 7);                         // 100 ft hand
  }
  tc(x) {
    const v = this.v, ang = (d) => d;
    x.strokeStyle = '#e8e8e4'; x.lineWidth = 5;
    for (const d of [-15, 0, 15]) { const a = (d - 90) * D2R, b = (d + 90) * D2R; for (const t of [a, b]) { x.beginPath(); x.moveTo(Math.sin(t) * (PX_R - 6), -Math.cos(t) * (PX_R - 6)); x.lineTo(Math.sin(t) * (PX_R - 26), -Math.cos(t) * (PX_R - 26)); x.stroke(); } }
    this.label(x, 'L', -105 * D2R, PX_R - 40, 22); this.label(x, 'R', 105 * D2R, PX_R - 40, 22); this.caption(x, 'TURN COORDINATOR', -52, 12); this.caption(x, '2 MIN', 74, 13);
    // miniature aircraft banks 15 deg at standard rate (3 deg/s)
    x.save(); x.rotate(clamp(v.turn / 3, -2, 2) * 15 * D2R); x.fillStyle = '#f4f4f0'; x.fillRect(-82, -4, 164, 8); x.fillRect(-4, -24, 8, 22); x.beginPath(); x.arc(0, 0, 13, 0, Math.PI * 2); x.fill(); x.restore();
    // inclinometer
    x.fillStyle = '#2b2b2d'; x.beginPath(); x.ellipse(0, 48, 62, 15, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#e8e8e4'; x.lineWidth = 2; for (const s of [-15, 15]) { x.beginPath(); x.moveTo(s, 34); x.lineTo(s, 62); x.stroke(); }
    x.fillStyle = '#101010'; x.strokeStyle = '#cfcfcf'; x.beginPath(); x.arc(v.ball * 44, 48, 12, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  hi(x) {
    const v = this.v;
    x.save(); x.rotate(-v.hdg * D2R);
    this.ticks(x, 0, 355, 5, 10, 2.5, (d) => d * D2R); this.ticks(x, 0, 350, 10, 18, 4, (d) => d * D2R);
    const names = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
    for (let k = 0; k < 36; k += 3) this.label(x, names[k] || String(k), k * 10 * D2R, PX_R - 42, names[k] ? 26 : 22);
    x.restore();
    x.fillStyle = '#f39c32'; x.beginPath(); x.moveTo(0, -PX_R + 2); x.lineTo(-8, -PX_R + 20); x.lineTo(8, -PX_R + 20); x.fill(); // lubber line
    x.fillStyle = '#f4f4f0'; x.fillRect(-4, -34, 8, 70); x.fillRect(-34, -10, 68, 8); x.fillRect(-14, 26, 28, 6);              // aircraft
  }
  vsi(x) {
    const ang = (fpm) => (-90 + clamp(fpm, -2000, 2000) / 2000 * 170) * D2R;
    this.ticks(x, -2000, 2000, 100, 10, 3, ang); this.ticks(x, -2000, 2000, 500, 22, 5, ang);
    for (const k of [5, 10, 15, 20]) { this.label(x, String(k), ang(k * 100), PX_R - 46, 24); this.label(x, String(k), ang(-k * 100), PX_R - 46, 24); }
    this.label(x, '0', ang(0), PX_R - 46, 26); this.caption(x, 'UP', -36, 15); this.caption(x, 'DOWN', 36, 15); this.caption(x, '100 FT/MIN', 62, 11);
    this.needle(x, ang(this.v.vs), PX_R - 14);
  }
  tach(x) {
    const ang = (rpm) => (-135 + clamp(rpm, 0, 3500) / 3500 * 270) * D2R;
    this.arc(x, ang(2200), ang(2700), PX_R - 9, 10, '#2fb24a'); this.ticks(x, 2700, 2700, 1, 24, 6, ang, '#e0262a');
    this.ticks(x, 0, 3500, 100, 10, 3, ang); this.ticks(x, 0, 3500, 500, 22, 5, ang);
    for (let k = 0; k <= 35; k += 5) this.label(x, String(k), ang(k * 100), PX_R - 46, 23);
    this.caption(x, 'RPM', -34); this.caption(x, 'x100', 36, 14);
    this.needle(x, ang(this.v.rpm), PX_R - 14);
  }
}
