import * as THREE from 'three';

// Cessna 172 detail built in code (the .blend is not available): overhead console, fresh-air vents, throttle / mixture / flap lever, the
// retractable tail wheel, flap tracks and hinge fittings, the propeller blur disc, and the procedural surface detail (leather grain,
// fabric, carpet, plastic grain, paint orange peel, rivet lines, brushed metal) with the daylight cabin fill.
// Everything here is in the model frame: +x nose, +y up, +z right wing, metres, wheels on y = 0 (the frame of C172Visual.model).

const mat = (name, color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ name, color, roughness, metalness, ...extra });
const MATS = {
  console: () => mat('Console_Grey', 0x6d6862, 0.62),
  black: () => mat('Black_Plastic', 0x242427, 0.45),
  chrome: () => mat('Chrome', 0xf3f3f6, 0.07, 1),
  alu: () => mat('Aluminium', 0xb9bbbf, 0.35, 1),
  aluDark: () => mat('Aluminium_Dark', 0x6f7176, 0.45, 1),
  steel: () => mat('Steel', 0x818186, 0.35, 1),
  red: () => mat('Knob_Red', 0xa5161a, 0.4),
  rubber: () => mat('Rubber', 0x1d1d1f, 0.85),
  white: () => mat('Paint_White', 0xefefec, 0.33),
  lens: () => mat('Lens_Frost', 0xe9e6dd, 0.25, 0, { emissive: 0xfff0d8, emissiveIntensity: 0 }),
};
// the console, vents and levers share a handful of materials, so the vertex-colour merge folds them into a few draws
export function cabinMaterials() { const m = {}; for (const [k, f] of Object.entries(MATS)) m[k] = f(); m.lens.userData.noMerge = true; return m; }

const place = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };
const mesh = (name, geo, m) => { const o = new THREE.Mesh(geo, m); o.name = name; return o; };
// a lathe about +x (knobs and shafts pointing aft out of the panel): profile [r, x] pairs
function latheX(profile, seg = 24) { const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg); g.rotateZ(-Math.PI / 2); return g; }
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// ---------- overhead console (POH 7-37: two rotatable front flood lights and a rear dome light, push switches by each, cabin speaker) ----------
export function buildOverhead(M) {
  const g = new THREE.Group(); g.name = 'Overhead_Console_New';
  const X0 = -1.10, Y0 = 1.863, L = 0.30, W = 0.32, D = 0.032;
  // body: rounded slab with a bevel, hanging from the headliner
  const s = new THREE.Shape(), r = 0.03, hx = L / 2, hz = W / 2;
  s.moveTo(-hx + r, -hz); s.lineTo(hx - r, -hz); s.quadraticCurveTo(hx, -hz, hx, -hz + r); s.lineTo(hx, hz - r); s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz); s.quadraticCurveTo(-hx, hz, -hx, hz - r); s.lineTo(-hx, -hz + r); s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  const body = new THREE.ExtrudeGeometry(s, { depth: D - 0.008, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 6 });
  body.rotateX(Math.PI / 2); // shape (x, y) -> model (x, z), extrusion -> -y
  place(body, X0, Y0 + 0.002, 0);
  g.add(mesh('Overhead_Console_Body', body, M.console));
  // face plate: placards, speaker perforation, screws (canvas)
  const tex = canvasTex(512, 544, (c, w, h) => {
    c.fillStyle = '#6a655f'; c.fillRect(0, 0, w, h);
    const n = c.createLinearGradient(0, 0, w, h); n.addColorStop(0, 'rgba(255,255,255,0.05)'); n.addColorStop(1, 'rgba(0,0,0,0.08)'); c.fillStyle = n; c.fillRect(0, 0, w, h);
    // speaker grille: a recessed disc of holes in the middle
    c.fillStyle = '#4c4843'; c.beginPath(); c.arc(w / 2, h * 0.5, 80, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#151515'; for (let yy = -72; yy <= 72; yy += 9) for (let xx = -72; xx <= 72; xx += 9) if (xx * xx + yy * yy < 72 * 72) { c.beginPath(); c.arc(w / 2 + xx + ((yy / 9) % 2 ? 4 : 0), h * 0.5 + yy, 2.6, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#3a3733'; c.lineWidth = 4; c.beginPath(); c.arc(w / 2, h * 0.5, 82, 0, Math.PI * 2); c.stroke();
    // placards (white on dark), read from the front seats (text runs along the console's span)
    c.fillStyle = '#e9e6de'; c.font = '600 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MAP', w * 0.36, h * 0.2); c.fillText('MAP', w * 0.64, h * 0.2);
    c.font = '500 13px sans-serif'; c.fillText('PUSH', w * 0.36, h * 0.38); c.fillText('PUSH', w * 0.64, h * 0.38);
    c.font = '600 18px sans-serif'; c.fillText('DOME', w * 0.5, h * 0.72); c.font = '500 13px sans-serif'; c.fillText('PUSH', w * 0.77, h * 0.74);
    c.fillText('CABIN SPEAKER', w * 0.5, h * 0.3);
    // screws
    for (const [sx, sy] of [[0.07, 0.07], [0.93, 0.07], [0.07, 0.93], [0.93, 0.93]]) { c.fillStyle = '#9a968f'; c.beginPath(); c.arc(w * sx, h * sy, 8, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#3a3733'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(w * sx - 6, h * sy); c.lineTo(w * sx + 6, h * sy); c.stroke(); }
  });
  const face = new THREE.PlaneGeometry(W - 0.012, L - 0.012); face.rotateX(Math.PI / 2); face.rotateY(Math.PI / 2); // faces down; u along +z (span), v along +x
  place(face, X0, Y0 - D - 0.0005, 0);
  const faceMat = new THREE.MeshStandardMaterial({ name: 'Console_Face', map: tex, roughness: 0.6 }); faceMat.userData.noMerge = true;
  g.add(mesh('Overhead_Console_Face', face, faceMat));
  // two eyeball map lights, aimed at the front seats' laps, with a push switch aft of each
  const yb = Y0 - D;
  for (const side of [-1, 1]) {
    const lx = X0 + 0.085, lz = 0.115 * side;
    const ring = new THREE.TorusGeometry(0.025, 0.0045, 10, 32); ring.rotateX(Math.PI / 2); g.add(mesh('Overhead_MapLight_Ring', place(ring, lx, yb - 0.002, lz), M.chrome));
    const ball = new THREE.SphereGeometry(0.021, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); g.add(mesh('Overhead_MapLight_Ball', place(ball, lx, yb, lz), M.black));
    // lens on the ball, facing down, aft and toward the seat
    const dir = new THREE.Vector3(-0.55, -1, 0.35 * side).normalize(), lens = new THREE.CircleGeometry(0.0125, 24);
    lens.lookAt(dir); place(lens, lx + dir.x * 0.0205, yb + dir.y * 0.0205, lz + dir.z * 0.0205);
    g.add(mesh('Overhead_MapLight_Lens', lens, M.lens));
    const btn = latheX([[0.0001, 0], [0.0075, 0], [0.0075, 0.006], [0.006, 0.008], [0.0001, 0.008]], 20); btn.rotateZ(Math.PI / 2); // axis -> -y (hangs down)
    g.add(mesh('Overhead_Switch', place(btn, lx - 0.05, yb, lz), M.black));
    const bez = new THREE.TorusGeometry(0.009, 0.0015, 8, 20); bez.rotateX(Math.PI / 2); g.add(mesh('Overhead_Switch_Bezel', place(bez, lx - 0.05, yb - 0.0008, lz), M.chrome));
  }
  // rear dome light: frosted lens in a chrome frame, push switch beside it
  const dl = new THREE.BoxGeometry(0.06, 0.006, 0.11); g.add(mesh('Overhead_Dome_Frame', place(dl, X0 - 0.105, yb - 0.003, 0), M.chrome));
  const dlens = new THREE.BoxGeometry(0.05, 0.004, 0.10); g.add(mesh('Overhead_Dome_Lens', place(dlens, X0 - 0.105, yb - 0.0065, 0), M.lens));
  const dbtn = latheX([[0.0001, 0], [0.007, 0], [0.007, 0.006], [0.0001, 0.007]], 18); dbtn.rotateZ(Math.PI / 2);
  g.add(mesh('Overhead_Switch', place(dbtn, X0 - 0.105, yb, 0.085), M.black));
  // fresh-air ventilators in the upper front corners (ball vents with a pull tube), on the side liner
  for (const side of [-1, 1]) {
    const vx = -0.86, vy = 1.765, vz = 0.548 * side, n = new THREE.Vector3(0, 0, -side);
    const ring = new THREE.TorusGeometry(0.03, 0.006, 10, 28); ring.lookAt(n); g.add(mesh('Overhead_Vent_Ring', place(ring, vx, vy, vz), M.console));
    const ball = new THREE.SphereGeometry(0.026, 20, 12); ball.scale(1, 1, 0.55); g.add(mesh('Overhead_Vent_Ball', place(ball, vx, vy, vz - side * 0.004), M.black));
    const tube = new THREE.CylinderGeometry(0.012, 0.014, 0.035, 18); tube.rotateX(Math.PI / 2); g.add(mesh('Overhead_Vent_Tube', place(tube, vx, vy, vz - side * 0.022), M.black));
    const grille = new THREE.CircleGeometry(0.0105, 18); grille.lookAt(n); g.add(mesh('Overhead_Vent_Grille', place(grille, vx, vy, vz - side * 0.0402), M.rubber));
  }
  return g;
}

// ---------- engine and flap controls on the lower panel (POH 7-13: flap lever in a slotted panel, stops at 10/20/30, pointer to its left) ----------
export const THROTTLE_AT = new THREE.Vector3(-0.286, 1.057, 0.047), MIXTURE_AT = new THREE.Vector3(-0.286, 1.030, 0.120), FLAP_AT = new THREE.Vector3(-0.287, 1.050, 0.178);
export const THROTTLE_TRAVEL = 0.065; // m pulled out at idle
export function buildControls(M) {
  const throttle = new THREE.Group(); throttle.name = 'Ctl_Throttle'; throttle.position.copy(THROTTLE_AT);
  const tshaft = new THREE.CylinderGeometry(0.0045, 0.0045, 0.09, 14); tshaft.rotateZ(Math.PI / 2); tshaft.translate(-0.04, 0, 0);
  throttle.add(mesh('Ctl_Throttle_Shaft', tshaft, M.chrome));
  throttle.add(mesh('Ctl_Throttle_Knob', latheX([[0.0001, -0.008], [0.009, -0.008], [0.0165, -0.014], [0.0175, -0.022], [0.0165, -0.032], [0.010, -0.036], [0.0001, -0.037]], 28), M.black));
  const mixture = new THREE.Group(); mixture.name = 'Ctl_Mixture'; mixture.position.copy(MIXTURE_AT);
  const mshaft = new THREE.CylinderGeometry(0.0035, 0.0035, 0.09, 12); mshaft.rotateZ(Math.PI / 2); mshaft.translate(-0.04, 0, 0);
  mixture.add(mesh('Ctl_Mixture_Shaft', mshaft, M.chrome));
  // ribbed red knob (the mixture's shape is a rule: the pilot finds it by feel)
  const prof = [[0.0001, -0.006]]; for (let i = 0; i <= 12; i++) { const xx = -0.008 - i * 0.0018; prof.push([i % 2 ? 0.0128 : 0.0142, xx]); } prof.push([0.009, -0.033], [0.0001, -0.034]);
  mixture.add(mesh('Ctl_Mixture_Knob', latheX(prof, 32), M.red));
  // flap selector: slotted plate with a label strip; the lever (white airfoil knob) moves down 10/20/30, the pointer follows the flaps
  const plate = new THREE.Group(); plate.name = 'Ctl_FlapPlate';
  const ptex = canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = '#1d1d1f'; c.fillRect(0, 0, w, h); c.fillStyle = '#060606'; c.fillRect(w * 0.6, h * 0.1, 14, h * 0.8);
    c.fillStyle = '#e8e6e0'; c.font = '600 20px sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    ['0°', '10°', '20°', '30°'].forEach((t, i) => { const y = h * (0.15 + i * 0.233); c.fillText(t, w * 0.42, y); c.fillRect(w * 0.45, y - 1.5, 14, 3); });
    c.font = '700 18px sans-serif'; c.textAlign = 'center'; c.fillText('FLAP', w * 0.5, h * 0.04 + 6);
  });
  const pm = new THREE.MeshStandardMaterial({ name: 'Flap_Plate', map: ptex, roughness: 0.55 }); pm.userData.noMerge = true;
  const pg = new THREE.PlaneGeometry(0.045, 0.09); pg.rotateY(-Math.PI / 2); pg.translate(FLAP_AT.x - 0.0005, FLAP_AT.y, FLAP_AT.z);
  plate.add(mesh('Ctl_FlapPlate_Face', pg, pm));
  const lever = new THREE.Group(); lever.name = 'Ctl_FlapLever'; lever.position.set(FLAP_AT.x, FLAP_AT.y + 0.032, FLAP_AT.z + 0.0042);
  const stem = new THREE.BoxGeometry(0.02, 0.004, 0.004); stem.translate(-0.01, 0, 0); lever.add(mesh('Ctl_FlapLever_Stem', stem, M.chrome));
  // knob shaped like a little flap (an airfoil section), the Cessna flap-lever shape
  const kshape = new THREE.Shape(); kshape.moveTo(0, 0); kshape.quadraticCurveTo(0.004, 0.009, 0.013, 0.006); kshape.lineTo(0.03, 0.0); kshape.lineTo(0.013, -0.002); kshape.quadraticCurveTo(0.004, -0.004, 0, 0);
  const knob = new THREE.ExtrudeGeometry(kshape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 });
  knob.rotateY(Math.PI / 2); knob.translate(-0.028, 0, 0.01); lever.add(mesh('Ctl_FlapLever_Knob', knob, M.white));
  const pointer = new THREE.Group(); pointer.name = 'Ctl_FlapPointer'; pointer.position.set(FLAP_AT.x - 0.0012, FLAP_AT.y + 0.032, FLAP_AT.z - 0.016);
  const pt = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.003, 0.004), new THREE.Vector3(0, -0.003, 0.004), new THREE.Vector3(0, 0, -0.006)]); pt.computeVertexNormals();
  pointer.add(mesh('Ctl_FlapPointer_Tip', pt, M.white));
  return { throttle, mixture, plate, lever, pointer, flapY0: FLAP_AT.y + 0.032, flapDy: -0.0209 };
}

// ---------- retractable tail wheel (owner request): spring-steel leg from a fitting under the tail cone, a castoring fork and a small wheel ----------
// Hinge at TW_HINGE; extended, the leg runs aft and down so the wheel bottom is at TW_CONTACT (touches the runway at about 8.6 deg nose-up on the
// mains, before the tail cone at 12.9 deg); retracted, it swings up 34 deg and the wheel tucks half into the belly.
export const TW_HINGE = new THREE.Vector3(-5.05, 0.772, 0), TW_AXLE = new THREE.Vector3(-5.40, 0.620, 0), TW_R = 0.075, TW_RETRACT = -34 * Math.PI / 180;
export const TW_CONTACT = TW_AXLE.clone().add(new THREE.Vector3(0, -TW_R, 0));
export function buildTailWheel(M) {
  const pivot = new THREE.Group(); pivot.name = 'TailGear'; pivot.position.copy(TW_HINGE);
  const ax = TW_AXLE.clone().sub(TW_HINGE), len = ax.length(), ang = Math.atan2(ax.y, ax.x);
  // tapered leaf spring
  const leaf = new THREE.BufferGeometry(), w0 = 0.022, w1 = 0.012, t0 = 0.012, t1 = 0.008, P = [];
  const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
  const v = (s, side, top) => { const w = (w0 + (w1 - w0) * s) / 2, t = (t0 + (t1 - t0) * s) / 2; return [s * len, top ? t : -t, side * w]; };
  quad(v(0, -1, 1), v(1, -1, 1), v(1, 1, 1), v(0, 1, 1)); quad(v(0, 1, 0), v(1, 1, 0), v(1, -1, 0), v(0, -1, 0));
  quad(v(0, 1, 1), v(1, 1, 1), v(1, 1, 0), v(0, 1, 0)); quad(v(0, -1, 0), v(1, -1, 0), v(1, -1, 1), v(0, -1, 1));
  leaf.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); leaf.computeVertexNormals(); leaf.rotateZ(ang);
  pivot.add(mesh('TailGear_Leaf', leaf, M.steel));
  // hinge fitting (a short barrel) and the fork
  const barrel = new THREE.CylinderGeometry(0.016, 0.016, 0.05, 16); barrel.rotateX(Math.PI / 2); pivot.add(mesh('TailGear_Hinge', barrel, M.aluDark));
  const fork = new THREE.Group(); fork.name = 'TailGear_Fork'; fork.position.copy(ax);
  const head = new THREE.CylinderGeometry(0.012, 0.012, 0.04, 14); head.translate(0, 0.02, 0); fork.add(mesh('TailGear_ForkHead', head, M.steel));
  for (const s of [-1, 1]) { const arm = new THREE.BoxGeometry(0.05, 0.008, 0.006); arm.translate(-0.012, 0, s * 0.027); fork.add(mesh('TailGear_ForkArm', arm, M.steel)); }
  const wheel = new THREE.Group(); wheel.name = 'TailGear_Wheel';
  const tyre = new THREE.TorusGeometry(TW_R - 0.018, 0.018, 14, 32); wheel.add(mesh('TailGear_Tyre', tyre, M.rubber));
  const hub = new THREE.CylinderGeometry(TW_R - 0.03, TW_R - 0.03, 0.03, 24); hub.rotateX(Math.PI / 2); wheel.add(mesh('TailGear_Hub', hub, M.alu));
  const axle = new THREE.CylinderGeometry(0.005, 0.005, 0.062, 10); axle.rotateX(Math.PI / 2); wheel.add(mesh('TailGear_Axle', axle, M.chrome));
  fork.add(wheel);
  pivot.add(fork);
  return { pivot, fork, wheel, len };
}

// ---------- propeller blur: a soft grey sweep, darker over the inner blade, a faint painted-tip arc; no colour fringes ----------
export function propDiscTexture() {
  return canvasTex(256, 256, (c, w, h) => {
    const img = c.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w * 2 - 1, dy = (y + 0.5) / h * 2 - 1, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx), i = (y * w + x) * 4;
      let a = 0;
      if (r > 0.12 && r < 1) {
        const chord = r < 0.25 ? (r - 0.12) / 0.13 : 1 - 0.45 * (r - 0.25) / 0.75;       // blade root fairing in, then the taper
        const sweep = 0.75 + 0.25 * Math.pow(Math.abs(Math.cos(th)), 6);              // two blades: a little denser where they are
        const streak = 0.9 + 0.1 * Math.sin(th * 90 + Math.sin(r * 9) * 3);              // fine radial streaks (no rings)
        a = 0.42 * chord * sweep * streak;
        if (r > 0.9 && r < 0.965) a += 0.05 * Math.sin((r - 0.9) / 0.065 * Math.PI);    // painted tips: a faint light arc
        a *= Math.min(1, (1 - r) / 0.03);
      }
      const tip = r > 0.9 ? 1 : 0, g = tip ? 150 : 28;
      d[i] = g; d[i + 1] = g; d[i + 2] = g + 2; d[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
    c.putImageData(img, 0, 0);
  });
}

// ---------- procedural surface detail ----------
// kind of finish from a material name (null: leave the material alone)
export function surfaceKind(name = '') {
  if (/Leather/i.test(name)) return 'leather';
  if (/Carpet/i.test(name)) return 'carpet';
  if (/Webbing|Headliner|Fabric|Cabin_Inner|Trim_Tan|Vinyl|Foam|Dash_Pad|Console_Tan/i.test(name)) return 'fabric';
  if (/Paint/i.test(name)) return 'paint';
  if (/Rubber|Tire|Tyre/i.test(name)) return 'rubber';
  if (/Alumin|Steel|Chrome|Zinc|Metal|Exhaust|Yoke_Shaft/i.test(name)) return 'metal';
  if (/Plastic|Panel_Black|Knob|Yoke_Black|Bezel|Seat_Frame|Console|Btn|Slab|Cover/i.test(name)) return 'plastic';
  return null;
}
// [scale 1/m, slope, albedo variation, roughness variation, low-frequency mottle]
const KIND = {
  leather: [240, 0.16, 0.07, 0.30, 0.05], fabric: [650, 0.22, 0.05, 0.12, 0.04], carpet: [900, 0.55, 0.16, 0.12, 0.05],
  plastic: [1400, 0.07, 0.015, 0.18, 0.02], paint: [420, 0.012, 0.0, 0.10, 0.025], rubber: [1100, 0.12, 0.04, 0.10, 0.04], metal: [1800, 0.03, 0.02, 0.35, 0.06],
};
export const CABIN_FILL = { value: 0 }; // shared: daylight scattered into the cabin, added to interior surfaces
const GLSL_COMMON = /* glsl */`
varying vec3 vSdPos; varying vec3 vSdNrm;
float sdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sdNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sdHash(i), sdHash(i + vec3(1, 0, 0)), f.x), mix(sdHash(i + vec3(0, 1, 0)), sdHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sdHash(i + vec3(0, 0, 1)), sdHash(i + vec3(1, 0, 1)), f.x), mix(sdHash(i + vec3(0, 1, 1)), sdHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
vec3 sdPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos), r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * faceDir; vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - grad); }
// rivet heads (2.5 mm domes every 30 mm) along fuselage frames, wing spars and ribs, stabiliser ribs: height in metres
float sdRivet(float lineD, float along) { float a = (fract(along / 0.03) - 0.5) * 0.03; float d = length(vec2(lineD, a)); return 0.0005 * max(0.0, 1.0 - d * d / (0.0025 * 0.0025)); }
float sdRivets(vec3 p, vec3 n) {
  float h = 0.0; vec3 an = abs(n); float az = abs(p.z);
  if (az < 0.6 && p.x < -0.25 && p.x > -6.2 && an.x < 0.6) { float d = (fract((p.x + 0.16) / 0.32) - 0.5) * 0.32; h += sdRivet(d, an.y > an.z ? p.z : p.y); }
  else if (az >= 0.6 && p.y > 1.75) {
    if (an.x < 0.6) { h += sdRivet(p.x + 0.80, p.z); h += sdRivet(p.x + 1.74, p.z); }
    if (an.z < 0.6 && az < 5.35) { float d = (fract((az - 0.62) / 0.30) - 0.5) * 0.30; h += sdRivet(d, p.x); }
  } else if (az >= 0.6 && p.y < 1.4 && p.x < -4.9) { if (an.z < 0.6) { float d = (fract(az / 0.25) - 0.5) * 0.25; h += sdRivet(d, p.x); } }
  return h; }
`;
// patch a material: kind (above), interior (cabin fill), rivets (static exterior paint in the model frame)
export function patchSurface(m, { kind, interior, rivets }) {
  if (!m || m.userData.sdPatched || (!kind && !interior)) return m;
  m.userData.sdPatched = true;
  const K = KIND[kind] || null, prev = m.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey'), prevKey = own ? m.customProgramCacheKey.bind(m) : () => '';
  const f = (x) => Number(x).toFixed(5);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uCabinFill = CABIN_FILL;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSdPos; varying vec3 vSdNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSdPos = position; vSdNrm = normal;');
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nuniform float uCabinFill;`);
    if (K) {
      const [sc, slope, alb, rough, mot] = K;
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sdP = vSdPos * ${f(sc)};
        float sdFade = clamp(1.6 - length(fwidth(sdP)) * 1.4, 0.0, 1.0);
        float sdN = sdNoise(sdP) * 0.65 + sdNoise(sdP * 2.7 + 7.1) * 0.35;
        float sdLow = sdNoise(vSdPos * 6.0 + 3.3);
        diffuseColor.rgb *= 1.0 + ${f(alb)} * (sdN - 0.5) * 2.0 * sdFade + ${f(mot)} * (sdLow - 0.5) * 2.0;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + ${f(rough)} * ((sdLow * 0.6 + sdN * 0.4) - 0.5) * 2.0), 0.03, 1.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float sdH = (sdN - 0.5) * ${f(slope / sc)} * sdFade;
          ${rivets ? `float sdR = sdRivets(vSdPos, normalize(vSdNrm)); sdH += sdR * clamp(1.6 - length(fwidth(vSdPos)) * 250.0, 0.0, 1.0);` : ''}
          normal = sdPerturb(-vViewPosition, normal, vec2(dFdx(sdH), dFdy(sdH)), faceDirection);
        }`);
    }
    if (interior) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uCabinFill;');
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => `${prevKey()}|sd:${kind || '-'}:${interior ? 1 : 0}:${rivets ? 1 : 0}`;
  m.needsUpdate = true;
  return m;
}
