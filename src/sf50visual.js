import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SF50_CG, SF50_GEAR } from './sf50.js';
import { SF50Displays } from './sf50displays.js';
import { SilShadow } from './silshadow.js';
import { TERRAIN_UNIFORMS } from './terrain-shader.js';
import { GlassWater } from './glasswater.js';

// The Vision Jet's 3D model (public/models/SF50.glb): +Z nose, +Y up, +X left wing, wheels on y = 0, origin at the model datum. Rotated a quarter turn
// it is in the simulator's frame (+x nose, +y up, +z right wing) and drawn at fdm.pos - SF50_CG. Every moving part is a node whose extras carry
// hinge_axis (in the node's own frame) and max_deg: a positive angle about the axis is the documented sense, so a pose is rest * R(axis, angle).
const D2R = Math.PI / 180;
const MOVERS = ['Ctrl_Aileron_L', 'Ctrl_Aileron_R', 'Ctrl_Flap_L', 'Ctrl_Flap_R', 'Ctrl_Ruddervator_L', 'Ctrl_Ruddervator_R', 'Door_Main', 'Door_Exit', 'Door_Baggage',
  'Gear_Nose', 'Gear_Main_L', 'Gear_Main_R', 'GearDoor_Nose_L', 'GearDoor_Nose_R', 'Wheel_Nose', 'Wheel_Main_L', 'Wheel_Main_R', 'Engine_Fan', 'Stick_Pilot', 'Stick_CoPilot', 'Throttle_Lever'];
const WHEEL_OF = { Wheel_Nose: 0, Wheel_Main_L: 1, Wheel_Main_R: 2 }, GEAR_OF = { Gear_Nose: 0, Gear_Main_L: 1, Gear_Main_R: 2 };
const LIGHTS = ['Light_Nav_L', 'Light_Nav_R', 'Light_Strobe_L', 'Light_Strobe_R', 'Light_Landing_L', 'Light_Landing_R', 'Light_Halo_L', 'Light_Halo_R', 'Light_Taxi', 'Light_Courtesy'];
const GLOW = { Light_Nav_L: [0xff2a1a, 0.5], Light_Nav_R: [0x30ff60, 0.5], Light_Strobe_L: [0xffffff, 0.9], Light_Strobe_R: [0xffffff, 0.9], Light_Landing_L: [0xfff1dd, 0.7], Light_Landing_R: [0xfff1dd, 0.7], Light_Halo_L: [0xffffff, 0.45], Light_Halo_R: [0xffffff, 0.45], Light_Taxi: [0xfff1dd, 0.6] };
export const SF50_POSE = { ruddervator: 20, flapMax: 39, gearUpDeg: [110, 88, 88], doorDeg: 88, stickDeg: 15, throttleDeg: 30, aileronDeg: 18 };
const GEAR_STATIC_SINK = 0.08; // strut compression at rest: the model stands on its wheels with the struts this much compressed
const SPIN_FAN = 0.6; // fan rad/s per % N1: a visible turn, not the real 30,000 rpm
const SIL_R = 7, SIL_D = 30;
// Windshield tint seen from the seat. The glass and its black frit band end in a sawtooth short of the frame, which showed as jagged teeth
// round the windshield; from inside the frit is hidden and the glass nearly clear, so the smooth frame is the edge. Outside keeps the dark tint.
const WS_COCKPIT_OPACITY = 0.06;
const EYE = new THREE.Vector3(1.66, 1.84, -0.37).sub(SF50_CG);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SF50Visual {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.time = 0; this.glassWater = null; this.real = null; this.cockpit = []; this.gearGroup = null; this.engines = undefined;
    this.lateReady = Promise.resolve([]); this.casters = []; this.castsWorldShadow = false; this.nodes = {}; this.movers = {};
    this.rainEff = 0; this.rainGround = 0; this.shadow = { visible: false }; this.sil = null; this.displays = null;
    this.lights = {}; this.wheelAng = [0, 0, 0]; this.fanAng = 0; this.dispT = 0; this.dispStep = 0; this.dispWas = false; this.cabinLit = -1; this.cabinDoor = { cmd: 0, pos: 0 }; this.gearRig = { onDoor: null }; this.doorWas = null; this.cabinCasters = []; this.cabinShadows = false;
  }
  cockpitTextures() { return this.dispTex ? [this.dispTex.pfd, this.dispTex.mfd] : []; }
  registerOccluders() { return 0; }
  attachSelfShadow() { return false; }
  event() {}

  async load(url, onProgress) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    let gltf;
    try { gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url, (e) => e.total && onProgress && onProgress(e.loaded / e.total)); } finally { draco.dispose(); }
    const scene = gltf.scene;
    scene.rotation.y = Math.PI / 2;
    const model = this.model = new THREE.Group(); model.name = 'SF50'; model.add(scene);
    model.position.copy(SF50_CG).negate();
    this.root.add(model);
    model.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.name && !this.nodes[o.name]) this.nodes[o.name] = o; });
    const N = this.nodes;
    // movers: the pose is rest * R(hinge_axis, angle); a multi-material node is a Group whose extras sit in its userData
    for (const name of MOVERS) {
      const o = N[name]; if (!o) continue; const ex = o.userData || {};
      this.movers[name] = { o, axis: new THREE.Vector3(...(ex.hinge_axis || [1, 0, 0])).normalize(), max: ex.max_deg || 0, rest: o.quaternion.clone(), restPos: o.position.clone(),
        roll: ex.roll_axis ? new THREE.Vector3(...ex.roll_axis).normalize() : null };
    }
    this.interior = N.Interior || null; this.glazing = N.Glazing || null;
    this.frit = null; this.windshield = null;
    if (this.glazing) this.glazing.traverse((o) => { if (!o.isMesh) return; if (/Frit/i.test(o.material.name)) this.frit = o; else if (/Windshield/i.test(o.material.name)) this.windshield = o; });
    this.addGlareDeck();
    // rain on the glass: the same drops as the SR-71's canopy, on the windshield and the side windows
    if (this.glazing) {
      this.glassWater = new GlassWater({ ridge: 2.16 });
      const panes = []; this.glazing.traverse((o) => { if (o.isMesh && !/Frit/i.test(o.material.name)) panes.push(o); }); // collected first: attach() adds children
      for (const o of panes) this.glassWater.attach(o, this.model);
    }
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      // no transmission pass (a second full scene render), no sheen / anisotropy lobes: glass is plain transparency
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.32); m.depthWrite = false; m.roughness = Math.min(m.roughness, 0.08); m.metalness = 0; }
      if ('sheen' in m) m.sheen = 0;
      if ('anisotropy' in m) m.anisotropy = 0;
      // texture filtering: the panel, seats and placards are seen at grazing angles from the seat, where trilinear alone smears them
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].anisotropy = 8;
    });
    this.wsOpacity = this.windshield ? this.windshield.material.opacity : 0;
    const inside = (o) => { for (let p = o; p; p = p.parent) if (p === this.interior) return true; return false; };
    const lamps = new Set(LIGHTS.map((n) => N[n]));
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const inter = inside(o), transp = o.material.transparent;
      o.receiveShadow = !transp; o.castShadow = !inter && !transp && !lamps.has(o);
      if (o.castShadow) this.casters.push(o);
      else if (inter && !transp && !lamps.has(o)) this.cabinCasters.push(o); // cast only in the cockpit view (setCabinShadows)
    });
    this.setupLights();
    this.setupDisplays();
    this.sil = new SilShadow(this.scene, this.casters, { size: 512, r: SIL_R, d: SIL_D });
    this.shadow = this.sil.mesh;
    this.cabinLight = new THREE.PointLight(0xffe6c8, 0, 4.5, 1.4);
    this.cabinLight.position.copy(new THREE.Vector3(1.7, 1.95, 0).sub(SF50_CG)); this.root.add(this.cabinLight);
    // landing / taxi lights: one spot light, always in the scene so switching it never changes the light count (no shader recompiles)
    this.landLight = new THREE.SpotLight(0xfff1dd, 0, 700, 0.3, 0.55, 1.4);
    this.landLight.position.copy(new THREE.Vector3(3.3, 0.55, 0).sub(SF50_CG)); this.landLight.target.position.set(60, -6, 0);
    this.root.add(this.landLight, this.landLight.target);
    // the exhaust nozzle, for the ground blast
    const noz = new THREE.Object3D(); noz.position.copy(new THREE.Vector3(-2.49, 1.98, 0).sub(SF50_CG)); this.root.add(noz); this.engines = [{ grp: noz }];
    let draws = 0, tris = 0; model.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count) { draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    this.stats = { draws, tris: Math.round(tris), movers: Object.keys(this.movers).length };
    this.setEnv(this.scene.environment);
    return this;
  }

  // The GLB's glare shield stops about half a metre short of the windshield, and from the seat the gap looked down into the hollow nose (its
  // inner skin). This deck runs from the shield's crest to the windshield's bottom edge across the whole windshield, both taken from the model
  // itself, in the Interior's frame (glTF: +z forward, +y up, x across). It reuses the shield's material, so no new shader is compiled.
  addGlareDeck() {
    const ws = this.windshield, cab = this.interior; if (!ws || !cab) return;
    let mat = null; cab.traverse((o) => { if (!mat && o.isMesh && /Alcantara_Charcoal/i.test(o.material.name)) mat = o.material; });
    if (!mat) return;
    this.model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(cab.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    const HALF = 0.8, STEP = 0.05, BINS = Math.round((2 * HALF) / STEP) + 1, bin = (x) => Math.round((x + HALF) / STEP);
    const low = new Array(BINS).fill(null), crest = new Array(BINS).fill(null);
    const scan = (mesh, fn) => { m.multiplyMatrices(inv, mesh.matrixWorld); const p = mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) fn(v.fromBufferAttribute(p, i).applyMatrix4(m)); };
    // windshield bottom edge: its lowest point in each slice across
    scan(ws, (p) => { const b = bin(p.x); if (b >= 0 && b < BINS && (!low[b] || p.y < low[b].y)) low[b] = p.clone(); });
    // shield crest: the highest cabin surface just ahead of the displays (the windshield frame trim excluded)
    cab.traverse((o) => {
      if (!o.isMesh || /Frame_MatteBlack/i.test(o.material.name)) return;
      scan(o, (p) => { if (p.z < 2.44 || p.z > 2.62 || p.y < 1.2 || p.y > 1.66) return; const b = bin(p.x); if (b >= 0 && b < BINS && (!crest[b] || p.y > crest[b].y)) crest[b] = p.clone(); });
    });
    const pos = [];
    for (let b = 0; b < BINS; b++) {
      const f = low[b], c = crest[b]; if (!f || !c) continue;
      // the glass edge is ragged slice to slice: take the lowest of the neighbours and their mean depth, so the edge stays under the glass and smooth
      const near = [low[b - 1], f, low[b + 1]].filter(Boolean), fy = Math.min(...near.map((p) => p.y)), fz = near.reduce((s, p) => s + p.z, 0) / near.length;
      const x = -HALF + b * STEP;
      // rear edge tucked just under the crest, front edge just under and behind the glass, hidden by the frame
      pos.push(x, c.y - 0.004, c.z, x, fy - 0.004, fz - 0.006);
    }
    const rows = pos.length / 6; if (rows < 2) return;
    const idx = [];
    for (let r = 0; r + 1 < rows; r++) { const a = 2 * r, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, d, a, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setIndex(idx); g.computeVertexNormals();
    // the shared material is single-sided: face the deck up
    if (g.attributes.normal.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; g.setIndex(idx); g.computeVertexNormals(); }
    const deck = new THREE.Mesh(g, mat); deck.name = 'GlareDeck';
    cab.add(deck); this.glareDeck = deck;
  }

  // three.js only honours envMapIntensity when material.envMap is set (with just scene.environment every material reflects the sky at full strength)
  setEnv(tex) {
    this.envTex = tex;
    const inter = new Set(); if (this.interior) this.interior.traverse((o) => { if (o.isMesh) inter.add(o.material); });
    this.model.traverse((o) => {
      const m = o.material; if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
      if (!m.envMap) m.needsUpdate = true; m.envMap = tex;
      if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
      m.envMapIntensity = m.userData.envBase * (inter.has(m) ? 0.7 : 0.8); // the big glazing lets most of the sky into the cabin
    });
  }

  // each light gets its own material (the GLB shares one between several) and a glow sprite that keeps a minimum size on screen at distance
  setupLights() {
    const tex = glowTexture();
    for (const name of LIGHTS) {
      const o = this.nodes[name]; if (!o || !o.isMesh) continue;
      o.material = o.material.clone(); const L = { node: o, base: o.material.emissiveIntensity, sp: null, size: 0 };
      const g = GLOW[name];
      if (g) {
        L.sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: g[0], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        L.sp.position.copy(o.position); L.sp.scale.setScalar(g[1]); L.sp.renderOrder = 5; L.sp.visible = false; L.size = g[1]; o.parent.add(L.sp);
      }
      o.material.emissiveIntensity = 0; this.lights[name] = L;
    }
  }

  // the PFD and MFD screens: the GLB's emissive map is the fallback; once the cockpit is on screen the live canvases replace it
  setupDisplays() {
    this.displays = new SF50Displays({ scale: 0.75 }); // 1920 x 1200: the PFD and MFD fill much of the screen from the seat
    // Uploaded raw (premultiplied, no colour space) and decoded from sRGB in the shader: an sRGB texture upload from a canvas takes ANGLE's slow
    // CPU-conversion path on Direct3D 11, a 60-140 ms stall at every redraw (measured in Edge on an RTX 3050 and an AMD Radeon iGPU; raw: none).
    // Mipmapped: no shimmer when minified.
    const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = true; t.flipY = false; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; return t; };
    this.dispTex = { pfd: mk(this.displays.pfd), mfd: mk(this.displays.mfd) };
    this.dispMat = {};
    for (const [k, n] of [['pfd', 'Display_PFD'], ['mfd', 'Display_MFD']]) {
      const o = this.nodes[n]; if (!o || !o.isMesh) continue;
      o.material = o.material.clone(); this.dispMat[k] = { mat: o.material, glb: o.material.emissiveMap };
      // the live canvas is raw sRGB: decode it in the shader; the GLB fallback texture is a normal sRGB texture and is left alone
      const m = o.material; m.userData.rawEmissive = false;
      m.customProgramCacheKey = () => (m.userData.rawEmissive ? 'sf50-raw-emissive' : 'sf50-emissive');
      m.onBeforeCompile = (sh) => { if (m.userData.rawEmissive) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#ifdef USE_EMISSIVEMAP\n\tvec4 emissiveColor = sRGBTransferEOTF( texture2D( emissiveMap, vEmissiveMapUv ) );\n\ttotalEmissiveRadiance *= emissiveColor.rgb;\n#endif'); };
    }
  }

  // cabin, emergency-exit and baggage doors: the main door opens first, the baggage door follows; ~3 s end to end (gas struts)
  setDoors(open) { this.cabinDoor.cmd = open ? 1 : 0; }
  poseDoors(dt) {
    const d = this.cabinDoor; d.pos += Math.max(-dt / 3, Math.min(dt / 3, d.cmd - d.pos));
    const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    for (const [n, a, b] of [['Door_Main', 0, 0.8], ['Door_Baggage', 0.2, 1]]) { const m = this.movers[n]; if (m) this.pose(n, ease((d.pos - a) / (b - a)) * m.max); }
    if (this.movers.Door_Exit) this.pose('Door_Exit', 0); // the emergency exit stays shut
  }

  pose(name, deg) {
    const m = this.movers[name]; if (!m) return;
    m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, deg * D2R));
  }

  // fdm.surf: de/da/dr commands -1..1 (+ = nose up / roll right / nose right); fdm.vtail: ruddervator panels, + = trailing edge up
  poseControls(fdm) {
    const s = fdm.surf, P = SF50_POSE, vt = fdm.vtail || { l: 0, r: 0 };
    this.pose('Ctrl_Flap_L', fdm.flaps || 0); this.pose('Ctrl_Flap_R', fdm.flaps || 0);
    // right roll: the left aileron trails down, the right one up
    this.pose('Ctrl_Aileron_L', s.da * P.aileronDeg); this.pose('Ctrl_Aileron_R', -s.da * P.aileronDeg);
    // the model's + is the trailing edge toward the panel's lower face: pitch up (both trailing edges up) is negative on both
    this.pose('Ctrl_Ruddervator_L', -vt.l * P.ruddervator); this.pose('Ctrl_Ruddervator_R', -vt.r * P.ruddervator);
  }

  // retraction progress r (0 down, 1 up): the doors are open until the leg is nearly stowed, the legs fold between r = 0.1 and 0.85, then the doors close
  static gearSequence(gearPos) {
    const r = clamp(1 - gearPos, 0, 1);
    return { r, strut: clamp((r - 0.1) / 0.75, 0, 1), door: 1 - clamp((r - 0.85) / 0.15, 0, 1) };
  }

  poseGear(fdm, dt) {
    const { strut, door } = SF50Visual.gearSequence(fdm.gearPos ?? 1), P = SF50_POSE;
    this.pose('Gear_Nose', strut * P.gearUpDeg[0]); this.pose('Gear_Main_L', strut * P.gearUpDeg[1]); this.pose('Gear_Main_R', strut * P.gearUpDeg[2]);
    this.pose('GearDoor_Nose_L', door * P.doorDeg); this.pose('GearDoor_Nose_R', door * P.doorDeg);
    // main.js plays the door sounds through gearRig.onDoor, as for the Blackbird; a jump (reset, teleport) is silent
    const was = this.doorWas; this.doorWas = door;
    if (was !== null && Math.abs(door - was) < 0.5 && this.gearRig.onDoor) { if (was === 0 && door > 0) this.gearRig.onDoor('open'); else if (was > 0 && door === 0) this.gearRig.onDoor('close'); }
    const stowed = strut >= 0.999;
    for (const n of ['Gear_Main_L', 'Gear_Main_R']) if (this.movers[n]) this.movers[n].o.visible = !stowed; // no main-well doors: nothing shows when they are up
    if (this.movers.Gear_Nose) this.movers.Gear_Nose.o.visible = !stowed;
    // struts hang a little longer in the air and compress on touchdown
    for (const [n, i] of Object.entries(GEAR_OF)) { const m = this.movers[n]; if (!m) continue; m.o.position.copy(m.restPos); m.o.position.y -= clamp(GEAR_STATIC_SINK - (fdm.compress ? fdm.compress[i] : GEAR_STATIC_SINK), -0.1, 0.1) * (1 - strut); }
    // wheels: spin from the flight model's wheel rates; the nose wheel turns with the pedals on the ground
    for (const [n, i] of Object.entries(WHEEL_OF)) {
      const m = this.movers[n]; if (!m) continue;
      this.wheelAng[i] = (this.wheelAng[i] + (fdm.wheel ? fdm.wheel[i] || 0 : 0) * dt) % (2 * Math.PI);
      m.o.quaternion.copy(m.rest);
      if (i === 0 && fdm.onGround) m.o.quaternion.multiply(_q2.setFromAxisAngle(_v.set(0, 1, 0), -clamp(fdm.ctrl.dr || 0, -1, 1) * 12 * D2R));
      m.o.quaternion.multiply(_q.setFromAxisAngle(m.axis, this.wheelAng[i]));
    }
    this.lastGear = { strut, door };
  }

  // The stick and thrust lever go by the model's geometry, not by its extras' text: a positive angle about hinge_axis tips the stick forward and
  // the roll_axis one to the left, and swings the lever aft, so a pull (up elevator), a right roll and more thrust are negative angles.
  poseCockpit(fdm) {
    const s = fdm.surf, P = SF50_POSE;
    for (const n of ['Stick_Pilot', 'Stick_CoPilot']) {
      const m = this.movers[n]; if (!m) continue;
      m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, -clamp(s.de, -1, 1) * P.stickDeg * D2R));
      if (m.roll) m.o.quaternion.multiply(_q.setFromAxisAngle(m.roll, -clamp(s.da, -1, 1) * P.stickDeg * D2R));
    }
    this.pose('Throttle_Lever', -clamp(fdm.throttle || 0, 0, 1) * P.throttleDeg);
  }

  // lights: nav steady, two-flash strobes every 1.2 s, the landing / taxi lights with the dark
  poseLights(fdm, env, camDist, agl) {
    const L = this.lights, t = this.time, dark = 1 - Math.min(1, (env && env.daylight != null ? env.daylight : 1) * 1.2), on = fdm.crashed ? 0 : 1;
    const k = Math.max(1, camDist / 60), ph = t % 1.2, strobe = ph < 0.05 || (ph > 0.12 && ph < 0.17) ? 1 : 0;
    const set = (name, v, glowMul, intensity) => {
      const l = L[name]; if (!l) return;
      l.node.material.emissiveIntensity = l.base * intensity * v;
      if (l.sp) { l.sp.material.opacity = Math.min(1, v * glowMul); l.sp.scale.setScalar(l.size * k * (0.6 + 0.4 * v)); l.sp.visible = v > 0.01; }
    };
    const navGlow = 0.35 + 0.65 * dark, ground = fdm.onGround && (fdm.gearPos ?? 1) > 0.98;
    for (const n of ['Light_Nav_L', 'Light_Nav_R']) set(n, on, navGlow, 0.25 + 0.75 * dark);
    for (const n of ['Light_Halo_L', 'Light_Halo_R']) set(n, on, navGlow * 0.6, 0.2 + 0.4 * dark);
    for (const n of ['Light_Strobe_L', 'Light_Strobe_R']) set(n, on * strobe, 1, 1);
    // landing lights from dusk below 600 m, the taxi light on the ground; both are one spot light and the ground cone of the terrain shader
    const landOn = on && dark > 0.25 && agl < 600 && !ground ? 1 : 0, taxiOn = on && dark > 0.25 && ground ? 1 : 0;
    for (const n of ['Light_Landing_L', 'Light_Landing_R']) set(n, landOn || taxiOn * 0.3, 0.5, 1);
    set('Light_Taxi', landOn * 0.5 + taxiOn, 0.5, 1);
    set('Light_Courtesy', 0, 1, 1);
    const q = Math.min(1, (dark - 0.25) * 3), strength = landOn ? q : taxiOn ? 0.4 * q : 0;
    this.landLight.intensity = strength > 0 ? (landOn ? 110 : 45) * Math.max(0.3, dark) : 0;
    this.landLight.angle = landOn ? 0.3 : 0.5;
    this.landLight.target.position.set(landOn ? 60 : 30, landOn ? -5 : -4, 0);
    this.root.updateMatrixWorld(true);
    _c.copy(this.landLight.position).applyMatrix4(this.root.matrixWorld);
    _v.set(1, -0.1, 0).applyQuaternion(this.root.quaternion).normalize();
    TERRAIN_UNIFORMS.uLand.value.set(_c.x, _c.y, _c.z, strength); TERRAIN_UNIFORMS.uLandDir.value.copy(_v);
    // the cockpit is lit by day through the glazing and by the cabin lights after dusk
    this.setCabinLights(on ? clamp((dark - 0.15) / 0.5, 0, 1) : 0, env);
  }

  // the seats, panel and glareshield shade each other only where it shows: in the cockpit view (the cabin is ~200k triangles in the shadow pass)
  setCabinShadows(on) {
    if (on === this.cabinShadows) return; this.cabinShadows = on;
    for (const o of this.cabinCasters) o.castShadow = on;
  }

  setCabinLights(k, env) {
    const day = env && env.daylight != null ? clamp(env.daylight, 0, 1) : 1;
    const i = 0.9 * day + 0.9 * k; if (Math.abs(i - this.cabinLit) < 0.01) return; this.cabinLit = i;
    this.cabinLight.intensity = i;
    const c = this.lights.Light_Courtesy; if (c) c.node.material.emissiveIntensity = c.base * k * 0.4;
  }

  // the live PFD / MFD: only while the cockpit is on screen, alternately (PFD, MFD, PFD) every 0.1 s, since each redraw costs 10-30 ms in software rendering
  updateDisplays(dt, view, feed) {
    const cockpit = view === 'cockpit' && this.dispMat && this.dispMat.pfd;
    if (!cockpit) { if (this.dispWas) this.showDisplays(false); return; }
    if (!this.dispWas) { this.showDisplays(true); this.dispT = 1; this.dispStep = 0; }
    if (!(dt > 0) || !feed) return;
    this.dispT += dt;
    if (this.dispT < 0.1) return;
    this.dispT = 0;
    const s = typeof feed === 'function' ? feed() : feed;
    if (!this.dispFirst) { this.displays.drawPFD(s); this.displays.drawMFD(s); this.dispTex.pfd.needsUpdate = this.dispTex.mfd.needsUpdate = true; this.dispFirst = true; return; }
    if (this.dispStep++ % 3 === 1) { this.displays.drawMFD(s); this.dispTex.mfd.needsUpdate = true; } else { this.displays.drawPFD(s); this.dispTex.pfd.needsUpdate = true; }
  }

  showDisplays(on) {
    this.dispWas = on;
    for (const k of ['pfd', 'mfd']) { const d = this.dispMat[k]; if (d) { d.mat.emissiveMap = on ? this.dispTex[k] : d.glb; d.mat.userData.rawEmissive = on; d.mat.needsUpdate = true; } }
  }

  update(dt, fdm, camWorld, view, env, groundY, feed) {
    if (this.scene.environment !== this.envTex && this.model) this.setEnv(this.scene.environment);
    this.time += dt;
    this.root.position.copy(fdm.pos).sub(camWorld);
    this.root.quaternion.copy(fdm.quat);
    if (!this.model) return;
    const camDist = this.root.position.length(), agl = fdm.pos.y - groundY - SF50_CG.y;
    this.poseControls(fdm); this.poseGear(fdm, dt); this.poseCockpit(fdm); this.poseDoors(dt);
    this.lastFdmFlaps = (fdm.flaps || 0) / 39;
    const m = this.movers.Engine_Fan;
    if (m) { this.fanAng = (this.fanAng + (fdm.crashed ? 0 : (fdm.engines[0].n1 || 0) * SPIN_FAN) * dt) % (2 * Math.PI); m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, this.fanAng)); }
    // the cabin is ~200k triangles: drawn in the cockpit view and when the camera is close enough to look in through the glazing
    if (this.interior) this.interior.visible = view === 'cockpit' || camDist < 9;
    if (this.frit) this.frit.visible = view !== 'cockpit';
    if (this.windshield) this.windshield.material.opacity = view === 'cockpit' ? WS_COCKPIT_OPACITY : this.wsOpacity;
    this.setCabinShadows(view === 'cockpit');
    this.poseLights(fdm, env, camDist, agl);
    this.updateDisplays(dt, view, feed);
    if (this.glassWater) {
      const sun = (this._sunM ||= new THREE.Vector3()).copy(env.sunDir || _v.set(0, 1, 0)).applyQuaternion(_q2.copy(this.root.quaternion).invert());
      this.glassWater.update(dt, { rain: this.rainEff || 0, V: (fdm.out && fdm.out.V) || 0, sun, daylight: env.daylight ?? 1, near: view === 'cockpit' || camDist < 30 });
    }
    this.sil.place(fdm, camWorld, env, groundY, agl);
  }

  // called by main.js after update() and before the scene pass
  renderShadowMap(renderer) { if (this.sil) this.sil.render(renderer, this.root, [(this.lastFdmFlaps || 0), this.lastGear ? this.lastGear.strut : 0]); }
}
export { EYE as SF50_EYE };
