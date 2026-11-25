import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { IL76_CG, NOTCHES } from './il76.js';
import { IL76Gauges } from './il76gauges.js';
import { IL76Displays } from './il76displays.js';
import { SilShadow } from './silshadow.js';
import { TERRAIN_UNIFORMS } from './terrain-shader.js';
import { GlassWater } from './glasswater.js';

// The Il-76's 3D model (public/models/IL76_v6.glb): +Z nose, +Y up, +X port wing, metres, wheels on y = 0, origin = ground point under 25 % MAC. Rotated a
// quarter turn it is in the simulator's frame (+x nose, +y up, +z right wing) and drawn at fdm.pos - IL76_CG.
// The visual is data-driven: every node whose extras carry hinge_axis (+ max_deg) or slide_axis (+ max_m) is a mover, posed as rest * R(axis, fraction * max)
// or rest position + axis * fraction * max. A positive fraction is the documented sense of the node (trailing edge down, door open, leg stowed, ...), so no
// pivot, axis or angle is written here. Optional extras seq_start / seq_end (the window of the cycle in which the node opens or travels) and
// seq_close_start / seq_close_end (the window in which it closes again) set the order of the gear and door sequences; nodes without them get the
// defaults below. Parts the model does not have are skipped silently, so a richer model needs no code change.
const D2R = Math.PI / 180;
const LIGHTS = ['Light_Nav_L', 'Light_Nav_R', 'Light_Nav_Tail', 'Light_Strobe_L', 'Light_Strobe_R', 'Light_Beacon_Top', 'Light_Beacon_Bottom', 'Light_Landing_L', 'Light_Landing_R',
  'Light_Taxi', 'Light_Inspection_L', 'Light_Inspection_R', 'Light_Cabin_Strips'];
const GLOW = { Light_Nav_L: [0xff2a1a, 1.1], Light_Nav_R: [0x30ff60, 1.1], Light_Nav_Tail: [0xffffff, 0.9], Light_Strobe_L: [0xffffff, 2.2], Light_Strobe_R: [0xffffff, 2.2],
  Light_Beacon_Top: [0xff2a1a, 1.4], Light_Beacon_Bottom: [0xff2a1a, 1.4], Light_Landing_L: [0xfff1dd, 1.6], Light_Landing_R: [0xfff1dd, 1.6], Light_Taxi: [0xfff1dd, 1.2] };
const SPIN_FAN = 0.5; // fan rad/s per % N1: a visible turn, not the real 4,340 rpm
const SIL_R = 30, SIL_D = 110;
const WS_COCKPIT_OPACITY = 0.07;
const GEAR_STATIC_SINK = 0.15; // strut compression at rest (IL76_GEAR)
// the default windows of a cycle (0..1) for nodes without seq extras
const DEFAULT_SEQ = { leg: [0.10, 0.85], bogie: [0.04, 0.5], door: [0, 0.15, 0.85, 1], cargo: { clam: [0, 0.55], ramp: [0.3, 1], upper: [0, 0.5] } };
// door cycle times (s): the cargo hatch is compressed from the real 60-90 s so it stays playable (D)
const TIME = { crew: 4, para: 5, cargo: 30, hoist: 5 };
const WHEEL_UNIT = { Wheel_Nose: 0, Wheel_Main_L1: 1, Wheel_Main_L2: 2, Wheel_Main_R1: 3, Wheel_Main_R2: 4 };
const LEG_UNIT = { Gear_Nose: 0, Gear_Main_L1: 1, Gear_Main_L2: 2, Gear_Main_R1: 3, Gear_Main_R2: 4 };
// Captain's eye (sim frame, relative to the CG), from the stand-in's flight deck: 0.53 m port of the centreline, just over the yoke wheel, 0.35 m behind it.
// IL76Visual.eyeFromModel() derives the same point from the yoke node; the tests keep the two within 0.2 m.
export const IL76_EYE = new THREE.Vector3(16.58, 5.2, -0.53).sub(IL76_CG);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _box = new THREE.Box3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const seqWindow = (r, s, e) => clamp((r - s) / Math.max(1e-6, e - s), 0, 1);
// opening fraction at cycle position r: eased open window, then (if the node has one) the closing window
export const seqOpen = (r, [s, e, cs, ce]) => ease(seqWindow(r, s, e)) * (cs === undefined ? 1 : 1 - ease(seqWindow(r, cs, ce)));

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const seqOf = (ex, dflt) => (ex.seq_start === undefined ? dflt : [ex.seq_start, ex.seq_end, ex.seq_close_start, ex.seq_close_end]);

export class IL76Visual {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.time = 0; this.glassWater = null; this.real = null; this.cockpit = []; this.gearGroup = null; this.engines = undefined;
    this.lateReady = Promise.resolve([]); this.casters = []; this.castsWorldShadow = false; this.nodes = {}; this.movers = {};
    this.rainEff = 0; this.rainGround = 0; this.shadow = { visible: false }; this.sil = null; this.displays = null;
    this.lights = {}; this.wheelAng = [0, 0, 0, 0, 0]; this.fanAng = [0, 0, 0, 0]; this.dispT = 0; this.dispStep = 0; this.dispWas = false; this.cabinLit = -1;
    this.crewDoor = { cmd: 0, pos: 0 }; this.cabinDoor = this.crewDoor; this.para = { cmd: 0, pos: 0 }; this.cargo = { cmd: 0, pos: 0 }; this.hoist = { pos: 0 };
    this.gearRig = { onDoor: null }; this.onDoorSound = null; this.doorWas = null; this.cabinCasters = []; this.cabinShadows = false;
    this.ctrlList = []; this.gearList = []; this.cargoList = []; this.crewList = []; this.paraList = []; this.hoistList = []; this.wheelList = []; this.fanList = []; this.revList = [];
    this.leverList = []; this.yokeList = []; this.thrList = []; this.eye = IL76_EYE.clone();
  }
  cockpitTextures() { return this.dispTex ? [this.dispTex.pfd, this.dispTex.nd, this.dispTex.eicas] : []; }
  registerOccluders() { return 0; }
  attachSelfShadow() { return false; }
  event() {}

  async load(url, onProgress) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    let gltf;
    try { gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url, (e) => e.total && onProgress && onProgress(e.loaded / e.total)); } finally { draco.dispose(); }
    const scene = gltf.scene;
    scene.rotation.y = Math.PI / 2;
    const model = this.model = new THREE.Group(); model.name = 'IL76'; model.add(scene);
    model.position.copy(IL76_CG).negate();
    this.root.add(model);
    model.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.name && !this.nodes[o.name]) this.nodes[o.name] = o; });
    const N = this.nodes;
    this.discoverMovers(scene);
    this.interior = N.Interior || null; this.glazing = N.Glazing || null; this.glassMats = [];
    if (this.glazing) this.glazing.traverse((o) => { if (o.isMesh && !this.glassMats.includes(o.material)) this.glassMats.push(o.material); });
    this.glassBase = this.glassMats.map((m) => m.opacity);
    if (this.glazing) {
      this.glassWater = new GlassWater({ ridge: 5.9 });
      const panes = []; this.glazing.traverse((o) => { if (o.isMesh) panes.push(o); }); // collected first: attach() adds children
      for (const o of panes) this.glassWater.attach(o, this.model);
    }
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      // no transmission pass (a second full scene render), no sheen / anisotropy lobes: glass is plain transparency
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.32); m.depthWrite = false; m.roughness = Math.min(m.roughness, 0.08); m.metalness = 0; }
      if ('sheen' in m) m.sheen = 0;
      if ('anisotropy' in m) m.anisotropy = 0;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].anisotropy = 8;
    });
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
    // live needles on the painted dials (the model lists them in its root extras; an older model has none)
    const groot = scene.getObjectByName('IL76') || scene, glist = groot.userData && groot.userData.gauges;
    this.gauges = new IL76Gauges(groot, typeof glist === 'string' ? JSON.parse(glist) : glist || []);
    this.sil = new SilShadow(this.scene, this.casters, { size: 512, r: SIL_R, d: SIL_D });
    this.shadow = this.sil.mesh;
    this.eye = this.eyeFromModel() || this.eye;
    this.cabinLight = new THREE.PointLight(0xffe6c8, 0, 9, 1.4);
    this.cabinLight.position.copy(this.eye).add(new THREE.Vector3(-0.8, 0.2, 0)); this.root.add(this.cabinLight);
    // landing / taxi lights: one spot light, always in the scene so switching it never changes the light count (no shader recompiles)
    const ll = this.lightWorldPos('Light_Landing_L'), lr = this.lightWorldPos('Light_Landing_R');
    this.landLight = new THREE.SpotLight(0xfff1dd, 0, 900, 0.3, 0.55, 1.4);
    this.landLight.position.copy(ll && lr ? ll.add(lr).multiplyScalar(0.5) : new THREE.Vector3(19, 2.3, 0).sub(IL76_CG)); this.landLight.target.position.set(80, -8, 0);
    this.root.add(this.landLight, this.landLight.target);
    // the four exhaust nozzles, for the ground blast: the aft end of each nacelle
    this.engines = [];
    for (let i = 1; i <= 4; i++) {
      const rv = N[`Engine_Reverser_${i}`], fan = N[`Engine_Fan_${i}`], src = rv || fan; if (!src) continue;
      const noz = new THREE.Object3D(); noz.position.copy(src.position); src.parent.add(noz); this.engines.push({ grp: noz });
    }
    let draws = 0, tris = 0; model.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count) { draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    this.stats = { draws, tris: Math.round(tris), movers: Object.keys(this.movers).length };
    this.setEnv(this.scene.environment);
    return this;
  }

  // ---- movers: found by their extras, grouped by role from the node name ----
  discoverMovers(scene) {
    scene.traverse((o) => {
      const ex = o.userData || {}; if (!o.name || !(ex.hinge_axis || ex.slide_axis)) return;
      const slide = !!ex.slide_axis;
      this.movers[o.name] = { name: o.name, o, slide, axis: new THREE.Vector3(...(slide ? ex.slide_axis : ex.hinge_axis)).normalize(), max: slide ? ex.max_m || 0 : ex.max_deg || 0,
        rest: o.quaternion.clone(), restPos: o.position.clone(), ex };
    });
    const M = this.movers;
    for (const [name, m] of Object.entries(M)) {
      let r;
      if (/^Ctrl_(Aileron|Tab_Aileron)_[LR]/.test(name)) { const left = /_L\d$/.test(name); this.ctrlList.push({ m, f: (x) => (left ? x.ail : -x.ail) }); }
      else if (/^Ctrl_(Elevator|Tab_Elevator)/.test(name)) this.ctrlList.push({ m, f: (x) => -x.el });
      else if (/^Ctrl_(Rudder|Tab_Rudder)/.test(name)) this.ctrlList.push({ m, f: (x) => -x.rud });
      else if (/^Ctrl_Flap_/.test(name)) this.ctrlList.push({ m, f: (x) => x.flap });
      else if (/^Ctrl_Slat_/.test(name)) this.ctrlList.push({ m, f: (x) => x.slat });
      else if ((r = /^Ctrl_Spoiler_([LR])(\d)/.exec(name))) {
        const left = r[1] === 'L', k = +r[2], outer = k >= 4;
        this.ctrlList.push({ m, f: (x) => clamp(x.sp * (outer ? 0.4 : 0.8) + (outer ? 0.4 * (left ? x.rollL : x.rollR) : 0), 0, 1) });
      } else if (/^GearDoor_/.test(name)) this.gearList.push({ m, kind: 'door', seq: seqOf(m.ex, DEFAULT_SEQ.door), nose: /Nose/.test(name) });
      else if ((r = /^(Gear_Nose|Gear_Main_[LR][12])$/.exec(name))) this.gearList.push({ m, kind: 'leg', unit: LEG_UNIT[r[1]], seq: seqOf(m.ex, DEFAULT_SEQ.leg) });
      else if (/^Gear_Main_[LR][12]_Bogie$/.test(name)) this.gearList.push({ m, kind: 'bogie', seq: seqOf(m.ex, DEFAULT_SEQ.bogie) });
      else if (name === 'Gear_Nose_Steer') this.steer = m;
      else if ((r = /^(Wheel_(?:Nose|Main_[LR][12]))/.exec(name))) this.wheelList.push({ m, unit: WHEEL_UNIT[r[1]] });
      else if ((r = /^Engine_Fan_(\d)/.exec(name))) this.fanList.push({ m, i: +r[1] - 1 });
      else if ((r = /^Engine_Reverser_(\d)/.exec(name))) this.revList.push({ m, i: +r[1] - 1 });
      else if (/^Door_Crew_/.test(name)) this.crewList.push({ m, seq: seqOf(m.ex, [0, 1]) });
      else if (/^Door_Paratroop_/.test(name)) this.paraList.push({ m, seq: seqOf(m.ex, [0, 1]) });
      else if (/^Door_Clamshell_/.test(name)) this.cargoList.push({ m, seq: seqOf(m.ex, DEFAULT_SEQ.cargo.clam) });
      else if (name === 'Door_Ramp') this.cargoList.push({ m, seq: seqOf(m.ex, DEFAULT_SEQ.cargo.ramp) });
      else if (name === 'Door_RearUpper') this.cargoList.push({ m, seq: seqOf(m.ex, DEFAULT_SEQ.cargo.upper) });
      else if (/^Cargo_Hoist_/.test(name)) this.hoistList.push({ m });
      else if (/^Yoke_(Pilot|CoPilot)$/.test(name)) this.yokeList.push({ m, wheel: false });
      else if (/^Yoke_(Pilot|CoPilot)_Wheel$/.test(name)) this.yokeList.push({ m, wheel: true });
      else if (/^Throttle_Lever_(\d)/.test(name)) this.thrList.push({ m, i: +/(\d)$/.exec(name)[1] - 1 });
      else if (/^Lever_(Flaps|Spoilers|ParkBrake)$/.test(name)) this.leverList.push({ m, kind: name.slice(6) });
    }
  }

  // a node's pose: fraction of its travel (+ = its documented sense)
  pose(m, f) {
    if (!m) return;
    if (m.slide) m.o.position.copy(m.restPos).addScaledVector(m.axis, f * m.max);
    else m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, f * m.max * D2R));
  }
  poseName(name, f) { this.pose(this.movers[name], f); }

  lightWorldPos(name) { const o = this.nodes[name]; if (!o) return null; this.model.updateMatrixWorld(true); return this.root.worldToLocal(o.getWorldPosition(new THREE.Vector3())); }

  // The captain's eye from the yoke: over the yoke wheel's top, a little behind it, on the yoke's side of the centreline (glTF frame -> sim frame)
  eyeFromModel() {
    const o = this.nodes.Yoke_Pilot_Wheel || this.nodes.Yoke_Pilot; if (!o) return null;
    // measured with the root at the origin and unturned, where the model's own frame is the simulator's frame relative to the CG
    const p = this.root.position.clone(), qq = this.root.quaternion.clone(); this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.updateMatrixWorld(true);
    _box.setFromObject(o); this.root.position.copy(p); this.root.quaternion.copy(qq); this.root.updateMatrixWorld(true);
    return new THREE.Vector3(_box.min.x - 0.35, _box.max.y + 0.09, (_box.min.z + _box.max.z) / 2);
  }

  // three.js only honours envMapIntensity when material.envMap is set (with just scene.environment every material reflects the sky at full strength)
  setEnv(tex) {
    this.envTex = tex;
    const inter = new Set(); if (this.interior) this.interior.traverse((o) => { if (o.isMesh) inter.add(o.material); });
    this.model.traverse((o) => {
      const m = o.material; if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
      if (!m.envMap) m.needsUpdate = true; m.envMap = tex;
      if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
      m.envMapIntensity = m.userData.envBase * (inter.has(m) ? 0.7 : 0.8);
    });
  }

  // each light gets its own material (the GLB shares one between several) and a glow sprite that keeps a minimum size on screen at distance
  setupLights() {
    const tex = glowTexture();
    for (const name of LIGHTS) {
      const o = this.nodes[name]; if (!o || !o.isMesh) continue;
      o.material = o.material.clone(); const L = { node: o, base: o.material.emissiveIntensity || 1, sp: null, size: 0 };
      const g = GLOW[name];
      if (g) {
        L.sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: g[0], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        L.sp.position.copy(o.position); L.sp.scale.setScalar(g[1]); L.sp.renderOrder = 5; L.sp.visible = false; L.size = g[1]; o.parent.add(L.sp);
      }
      o.material.emissiveIntensity = 0; this.lights[name] = L;
    }
  }

  // the flight-deck screens: PFD, ND and engine display canvases on whichever Display_* quads the model has (none in a model with analogue dials only)
  setupDisplays() {
    this.displays = new IL76Displays({ scale: 1 });
    // raw sRGB upload decoded in the shader: an sRGB canvas upload takes ANGLE's slow CPU-conversion path on Direct3D 11
    const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = true; t.flipY = false; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; return t; };
    this.dispTex = { pfd: mk(this.displays.pfd), nd: mk(this.displays.nd), eicas: mk(this.displays.eicas) };
    this.dispMat = [];
    const KIND = { Display_PFD_L: 'pfd', Display_PFD_R: 'pfd', Display_ND_L: 'nd', Display_ND_R: 'nd', Display_Nav_1: 'nd', Display_Nav_2: 'nd', Display_EICAS_1: 'eicas', Display_EICAS_2: 'eicas', Display_Engineer: 'eicas' };
    // The game model merges the nine screens into the Interior mesh, one primitive each, so they are found by their material
    // (DISP_PFD_L ...); a model that keeps them as Display_* nodes works too.
    const MAT = [[/^DISP_PFD/, 'pfd'], [/^DISP_(ND|Nav)/, 'nd'], [/^DISP_(EICAS|Engineer)/, 'eicas']], screens = [];
    for (const [n, k] of Object.entries(KIND)) { const o = this.nodes[n]; if (o && o.isMesh) screens.push([o, k]); }
    if (this.model) this.model.traverse((o) => { if (!o.isMesh || !o.material || screens.some((s) => s[0] === o)) return; const m = MAT.find(([re]) => re.test(o.material.name || '')); if (m) screens.push([o, m[1]]); });
    for (const [o, k] of screens) {
      o.material = o.material.clone(); const m = o.material, d = { mat: m, kind: k, glb: m.emissiveMap, baseEmissive: m.emissive.clone() };
      m.userData.rawEmissive = false;
      m.customProgramCacheKey = () => (m.userData.rawEmissive ? 'il76-raw-emissive' : 'il76-emissive');
      m.onBeforeCompile = (sh) => { if (m.userData.rawEmissive) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#ifdef USE_EMISSIVEMAP\n\tvec4 emissiveColor = sRGBTransferEOTF( texture2D( emissiveMap, vEmissiveMapUv ) );\n\ttotalEmissiveRadiance *= emissiveColor.rgb;\n#endif'); };
      this.dispMat.push(d);
    }
  }

  // ---- doors: crew doors, paratroop doors and the cargo hatch (clamshell doors, ramp, upper door) as separate timed sequences ----
  setDoors(open) { this.crewDoor.cmd = open ? 1 : 0; }
  setParatroop(open) { this.para.cmd = open ? 1 : 0; }
  setCargo(open) { this.cargo.cmd = open ? 1 : 0; }
  cargoMoving() { return Math.abs(this.cargo.cmd - this.cargo.pos) > 1e-3 || (this.cargo.cmd > 0 && this.hoist.pos > 0 && this.hoist.pos < 1); }
  poseDoors(dt) {
    const step = (d, T) => { d.pos += clamp(d.cmd - d.pos, -dt / T, dt / T); };
    step(this.crewDoor, TIME.crew); step(this.para, TIME.para);
    // the hoists run aft once the ramp is down and come home before the hatch closes
    const c = this.cargo, h = this.hoist, wasC = c.pos;
    if (c.cmd > 0 || h.pos <= 0) step(c, TIME.cargo);
    h.pos += clamp((c.cmd > 0 && c.pos >= 0.999 ? 1 : 0) - h.pos, -dt / TIME.hoist, dt / TIME.hoist);
    if (this.onDoorSound && Math.abs(c.pos - wasC) > 0) { if (c.pos >= 1 && wasC < 1) this.onDoorSound('cargo-open'); else if (c.pos <= 0 && wasC > 0) this.onDoorSound('cargo-closed'); }
    for (const { m, seq } of this.crewList) this.pose(m, seqOpen(this.crewDoor.pos, seq));
    for (const { m, seq } of this.paraList) this.pose(m, seqOpen(this.para.pos, seq));
    for (const { m, seq } of this.cargoList) this.pose(m, seqOpen(c.pos, seq));
    for (const { m } of this.hoistList) this.pose(m, ease(h.pos));
  }

  // fdm.surfN: elevator (+ nose up) / aileron (+ roll right) / rudder (+ nose right) in -1..1 of their travel; flaps, slats in degrees, spoilers 0..1
  poseControls(fdm) {
    const n = fdm.surfN || { el: 0, ail: 0, rud: 0 }, rs = fdm.rollSpoil || { l: 0, r: 0 }, top = NOTCHES[NOTCHES.length - 1];
    const x = this._x || (this._x = {});
    x.ail = n.ail; x.el = n.el; x.rud = n.rud; x.flap = (fdm.flaps || 0) / top.flap; x.slat = (fdm.slats || 0) / top.slat; x.sp = fdm.spoilers || 0; x.rollL = rs.l; x.rollR = rs.r;
    for (const { m, f } of this.ctrlList) this.pose(m, f(x));
  }

  // gear: r = 0 down .. 1 up (the reverse of the flight model's gearPos); doors open, the bogies turn, the legs swing, the doors close (seq extras)
  poseGear(fdm, dt) {
    const r = clamp(1 - (fdm.gearPos ?? 1), 0, 1);
    let door = 0, doorNose = 0, nDoor = 0;
    const leg = {};
    for (const g of this.gearList) {
      const f = g.kind === 'door' ? seqOpen(r, g.seq) : ease(seqWindow(r, g.seq[0], g.seq[1]));
      this.pose(g.m, f);
      if (g.kind === 'door') { door = Math.max(door, f); if (g.nose) { doorNose += f; nDoor++; } }
      if (g.kind === 'leg') { leg[g.m.name] = f; }
    }
    doorNose = nDoor ? doorNose / nDoor : door;
    // main.js plays the door sounds through gearRig.onDoor; a jump (reset, teleport) is silent
    const was = this.doorWas; this.doorWas = doorNose;
    if (was !== null && Math.abs(doorNose - was) < 0.5 && this.gearRig.onDoor) { if (was === 0 && doorNose > 0) this.gearRig.onDoor('open'); else if (was > 0 && doorNose === 0) this.gearRig.onDoor('close'); }
    // struts hang a little longer in the air and compress on touchdown; a leg is hidden only once it is fully stowed and its doors are shut
    for (const g of this.gearList) {
      if (g.kind !== 'leg') continue;
      const f = leg[g.m.name], i = g.unit;
      g.m.o.position.copy(g.m.restPos); g.m.o.position.y -= clamp(GEAR_STATIC_SINK - (fdm.compress ? fdm.compress[i] : GEAR_STATIC_SINK), -0.1, 0.1) * (1 - f);
      g.m.o.visible = !(f >= 0.999 && door < 0.001);
    }
    // wheels: spin from the flight model's wheel rates; the nose wheels turn with the steering
    for (let u = 0; u < this.wheelAng.length; u++) this.wheelAng[u] = (this.wheelAng[u] + (fdm.wheel ? fdm.wheel[u] || 0 : 0) * dt) % (2 * Math.PI);
    for (const { m, unit } of this.wheelList) m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, this.wheelAng[unit]));
    if (this.steer) { const a = fdm.onGround ? clamp(fdm.nosteer || 0, -this.steer.max, this.steer.max) : 0; this.steer.o.quaternion.copy(this.steer.rest).multiply(_q.setFromAxisAngle(this.steer.axis, a * D2R)); }
    this.lastGear = { strut: leg.Gear_Nose !== undefined ? leg.Gear_Nose : Math.max(0, ...Object.values(leg), 0) };
  }

  // engine fans turn with N1; the reverser sleeves slide aft with the flight model's reverser position
  poseEngines(fdm, dt) {
    for (const { m, i } of this.fanList) {
      const e = fdm.engines[i]; this.fanAng[i] = (this.fanAng[i] + (fdm.crashed || !e ? 0 : (e.n1 || 0) * SPIN_FAN) * dt) % (2 * Math.PI);
      m.o.quaternion.copy(m.rest).multiply(_q.setFromAxisAngle(m.axis, this.fanAng[i]));
    }
    for (const { m, i } of this.revList) { const e = fdm.engines[i]; this.pose(m, e ? clamp(e.rev || 0, 0, 1) : 0); }
  }

  // yokes (pull = column aft, roll = wheel turn), the thrust levers (reverse = back past idle), and the flap, spoiler and park-brake levers
  poseCockpit(fdm) {
    const n = fdm.surfN || { el: 0, ail: 0, rud: 0 };
    for (const { m, wheel } of this.yokeList) this.pose(m, wheel ? clamp(n.ail, -1, 1) : clamp(n.el, -1, 1));
    for (const { m, i } of this.thrList) { const e = fdm.engines[i]; this.pose(m, e && e.rev > 0.5 ? -0.4 * clamp(e.revPow || 0, 0, 1) - 0.05 : clamp(fdm.throttle || 0, 0, 1)); }
    for (const { m, kind } of this.leverList) this.pose(m, kind === 'Flaps' ? (fdm.flapCmd || 0) / (NOTCHES.length - 1) : kind === 'Spoilers' ? clamp(fdm.spoilers || 0, 0, 1) : fdm.parkingBrake ? 1 : 0);
  }

  // lights: nav steady, two-flash strobes every 1.2 s, beacons flash once a second with the engines running, landing / taxi with the dark
  poseLights(fdm, env, camDist, agl) {
    const L = this.lights, t = this.time, dark = 1 - Math.min(1, (env && env.daylight != null ? env.daylight : 1) * 1.2), on = fdm.crashed ? 0 : 1;
    const k = Math.max(1, camDist / 90), ph = t % 1.2, strobe = ph < 0.05 || (ph > 0.12 && ph < 0.17) ? 1 : 0, beacon = (t % 1) < 0.18 && fdm.engines.some((e) => e.lit) ? 1 : 0;
    const set = (name, v, glowMul, intensity) => {
      const l = L[name]; if (!l) return;
      l.node.material.emissiveIntensity = l.base * intensity * v;
      if (l.sp) { l.sp.material.opacity = Math.min(1, v * glowMul); l.sp.scale.setScalar(l.size * k * (0.6 + 0.4 * v)); l.sp.visible = v > 0.01; }
    };
    const navGlow = 0.35 + 0.65 * dark, ground = fdm.onGround && (fdm.gearPos ?? 1) > 0.98;
    for (const n of ['Light_Nav_L', 'Light_Nav_R', 'Light_Nav_Tail']) set(n, on, navGlow, 0.25 + 0.75 * dark);
    for (const n of ['Light_Strobe_L', 'Light_Strobe_R']) set(n, on * strobe, 1, 1);
    for (const n of ['Light_Beacon_Top', 'Light_Beacon_Bottom']) set(n, on * beacon, 1, 1);
    const landOn = on && dark > 0.25 && agl < 800 && !ground ? 1 : 0, taxiOn = on && dark > 0.25 && ground ? 1 : 0;
    for (const n of ['Light_Landing_L', 'Light_Landing_R']) set(n, landOn || taxiOn * 0.3, 0.5, 1);
    set('Light_Taxi', landOn * 0.5 + taxiOn, 0.5, 1);
    const q = Math.min(1, (dark - 0.25) * 3), strength = landOn ? q : taxiOn ? 0.4 * q : 0;
    this.landLight.intensity = strength > 0 ? (landOn ? 160 : 60) * Math.max(0.3, dark) : 0;
    this.landLight.angle = landOn ? 0.3 : 0.5;
    this.landLight.target.position.set(landOn ? 80 : 40, landOn ? -8 : -6, 0);
    this.root.updateMatrixWorld(true);
    _c.copy(this.landLight.position).applyMatrix4(this.root.matrixWorld);
    _v.set(1, -0.1, 0).applyQuaternion(this.root.quaternion).normalize();
    TERRAIN_UNIFORMS.uLand.value.set(_c.x, _c.y, _c.z, strength); TERRAIN_UNIFORMS.uLandDir.value.copy(_v);
    // the flight deck is lit by day through the glazing and by the cabin lights after dusk
    const cab = on ? clamp((dark - 0.15) / 0.5, 0, 1) : 0;
    set('Light_Inspection_L', cab * 0.5, 0.3, 0.6); set('Light_Inspection_R', cab * 0.5, 0.3, 0.6); set('Light_Cabin_Strips', cab, 0.3, 0.8);
    this.setCabinLights(cab, env);
  }

  // the seats, panel and glareshield shade each other only where it shows: in the cockpit view
  setCabinShadows(on) {
    if (on === this.cabinShadows) return; this.cabinShadows = on;
    for (const o of this.cabinCasters) o.castShadow = on;
  }
  setCabinLights(k, env) {
    const day = env && env.daylight != null ? clamp(env.daylight, 0, 1) : 1;
    const i = 0.9 * day + 0.9 * k; if (Math.abs(i - this.cabinLit) < 0.01) return; this.cabinLit = i;
    this.cabinLight.intensity = i;
  }

  // the live screens: only while the cockpit is on screen, one canvas per 0.07 s in the order PFD, ND, PFD, engine display (under 15 redraws a second)
  updateDisplays(dt, view, feed) {
    const cockpit = view === 'cockpit' && this.dispMat.length > 0;
    if (!cockpit) { if (this.dispWas) this.showDisplays(false); return; }
    if (!this.dispWas) { this.showDisplays(true); this.dispT = 1; this.dispStep = 0; this.dispFirst = false; }
    if (!(dt > 0) || !feed) return;
    this.dispT += dt;
    if (this.dispT < 0.07) return;
    this.dispT = 0;
    const s = typeof feed === 'function' ? feed() : feed, D = this.displays, T = this.dispTex;
    if (!this.dispFirst) { D.drawPFD(s); D.drawND(s); D.drawEICAS(s); T.pfd.needsUpdate = T.nd.needsUpdate = T.eicas.needsUpdate = true; this.dispFirst = true; return; }
    const step = this.dispStep++ % 4;
    if (step === 1) { D.drawND(s); T.nd.needsUpdate = true; } else if (step === 3) { D.drawEICAS(s); T.eicas.needsUpdate = true; } else { D.drawPFD(s); T.pfd.needsUpdate = true; }
  }
  showDisplays(on) {
    this.dispWas = on;
    for (const d of this.dispMat) {
      d.mat.emissiveMap = on ? this.dispTex[d.kind] : d.glb; d.mat.userData.rawEmissive = on;
      if (on) { d.mat.emissive.set(0xffffff); d.mat.emissiveIntensity = 1; } else d.mat.emissive.copy(d.baseEmissive);
      d.mat.needsUpdate = true;
    }
  }

  update(dt, fdm, camWorld, view, env, groundY, feed) {
    if (this.scene.environment !== this.envTex && this.model) this.setEnv(this.scene.environment);
    this.time += dt;
    this.root.position.copy(fdm.pos).sub(camWorld);
    this.root.quaternion.copy(fdm.quat);
    if (!this.model) return;
    const camDist = this.root.position.length(), agl = fdm.pos.y - groundY - IL76_CG.y;
    this.poseControls(fdm); this.poseGear(fdm, dt); this.poseEngines(fdm, dt); this.poseCockpit(fdm); this.poseDoors(dt);
    this.lastFlaps = (fdm.flaps || 0) / NOTCHES[NOTCHES.length - 1].flap;
    // the hold and flight deck are drawn in the cockpit view and when the camera is close enough to look in through the glazing
    // ... and whenever a door, the ramp or the cargo hatch is open or moving, so the aircraft is never hollow from outside
    const open = this.cargo.pos > 0.01 || this.crewDoor.pos > 0.01 || this.para.pos > 0.01;
    const inside = view === 'cockpit' || camDist < 24 || (open && camDist < 400);
    if (this.interior) this.interior.visible = inside;
    if (this.gauges) { this.gauges.visible = inside; if (inside && feed && this.gauges.count) this.gauges.update(dt, this.gaugeFeed(fdm, feed)); }
    this.glassMats.forEach((m, i) => { m.opacity = view === 'cockpit' ? Math.min(this.glassBase[i], WS_COCKPIT_OPACITY) : this.glassBase[i]; });
    this.setCabinShadows(view === 'cockpit');
    this.poseLights(fdm, env, camDist, agl);
    this.updateDisplays(dt, view, feed);
    if (this.glassWater) {
      const sun = (this._sunM ||= new THREE.Vector3()).copy(env.sunDir || _v.set(0, 1, 0)).applyQuaternion(_q2.copy(this.root.quaternion).invert());
      this.glassWater.update(dt, { rain: this.rainEff || 0, V: (fdm.out && fdm.out.V) || 0, sun, daylight: env.daylight ?? 1, near: view === 'cockpit' || camDist < 60 });
    }
    this.sil.place(fdm, camWorld, env, groundY, agl);
  }

  // the dial needles read the display feed (computed once and shared with the screens within a frame) plus the brake pressure
  gaugeFeed(fdm, feed) { const s = typeof feed === 'function' ? feed() : feed; s.brakes = fdm.brakes || 0; return s; }

  // called by main.js after update() and before the scene pass
  renderShadowMap(renderer) { if (this.sil) this.sil.render(renderer, this.root, [(this.lastFlaps || 0), this.lastGear ? this.lastGear.strut : 0]); }
}
