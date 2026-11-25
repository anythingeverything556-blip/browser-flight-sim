import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { F27_CG, F27_GEAR, F27_FLAP_DEG } from './f27.js';
import { createFokkerAdapter } from './f27adapter.js';
import lighting from './f27lighting.json';
import { gateF27DormantLights } from './f27materials.js';
import { GlassWater } from './glasswater.js';
import { batchF27Cockpit } from './f27batch.js';
import { prepareF27ViewCasters } from './f27view.js';

// Fit the *rendered, gear-down tire* rather than CFG datum (-6.85 ft).
// Precise decoded v1/v2 main tire vertex minimum is -1.831394 m; the CFG
// minimum -2.08788 m left a 25.65 cm air gap before suspension sag.
const sourceLeftContact = new THREE.Vector3(-0.43 * 0.3048, -1.831394, -11.84 * 0.3048);
export const F27_SOURCE_OFFSET = F27_GEAR[1].p.clone().add(F27_CG).sub(sourceLeftContact);
const bodyPoint = (x, y, z) => new THREE.Vector3(z, y, -x).add(F27_SOURCE_OFFSET).sub(F27_CG);
export const F27_EYE = bodyPoint(0.48, 0.90, 8.25);
// Eight centimetres below the source eye: seated, without changing fore/aft or lateral framing.
export const F27_COCKPIT_MODEL = 'models/f27/f27-white-vc-v2.glb';
export const F27_EXTERIOR_MODEL = 'models/f27/f27-white-ext-v3.glb';
// BGT source: frames 0..100 = deployment, 100..200 = loaded suspension.
// Normalizing each clip independently finished short clips early and then
// drove the struts into the suspension half, including its frame-101 jump.
export const F27_GEAR_DEPLOY_END = 100 / 24;
const STEER_AXIS = new THREE.Vector3(0, 1, 0);
const PROP_AXIS = new THREE.Vector3(0, 0, 1);
// Readable shutter/strobe representation, NOT gearbox RPM. Four blades at the
// true 651–1395 RPM can alias to a stationary cross on a fixed-rate display.
export const propellerDisplayRps = rpm => rpm <= 0 ? 0 : Math.min(rpm / 60, 1.25 + Math.max(0, rpm - 143) / 1252);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const fraction = x => clamp((Number.isFinite(x) ? x : 0) * 0.5 + 0.5);
export const propellerMode = rpm => rpm < 143 ? 'Still' : rpm < 287.5 ? 'Slow' : 'Blurred';
// Blend in RPM space: shutdown must transition from disc through visible
// blades rather than flipping material/program flags at one arbitrary RPM.
export const propellerBlend = rpm => {
  const t=clamp((rpm-95)/370), blur=t*t*(3-2*t);
  return { blades:1-0.39*blur, disc:0.27*blur };
};

export function applyF27DefaultVisibility(root) {
  root.traverse(o => { if (o.userData?.webDefaultVisible === false) o.visible = false; });
}
function clipBindings(gltf) {
  // Only a small named subset is activated. Never play() the entire 726-clip inventory.
  const names = (gltf.animations || []).map(c => c.name);
  const match = expression => names.filter(n => expression.test(n));
  return {
    aileron: match(/^x0_Aileron_(Left|Right)_Empt$/),
    elevator: match(/^x0_Elev(Right|Left)_empt$/),
    rudder: match(/^x0_Rudder_empt$/),
    trim: match(/^x0_ElevTrim_empt$/),
    flaps: match(/^x0_Flaps_(Left|Right)(In|Out)_Empt$/),
    flapLever: match(/^HANDLING_Lever_Flaps$/),
    gear: match(/^x0_(GEAR_|UNDERCARRIAGE_)/).filter(n => !/Tire|Steer/.test(n) && !/^x0_GEAR_Central(?:Dump[12]|SupportV3)$/.test(n)),
    doors: match(/^x0_FUSELAGE_Door(Aft|Fwd|Cargo.*)$/),
    throttle: match(/^x0_Lever_Throttle0[12]$/),
    // The source column clips are a hide/stow toggle, NOT the flight axes.
    yokeRoll: match(/^x0_Yoke0[12]_Upper$/),
    yokePitch: match(/^x0_Yoke_Base$/),
    rudderPedals: match(/^x0_Rudder_Ped0[1-4]$/),
    prop: match(/^ENGINE_Propeller_[12]$/),
    vsi: match(/^x0_VSI_0[12]_Aig$/),
    engineRpm: match(/^x0_RPM_0[12]_Aig$/),
    engineRpmDecimal: match(/^x0_RPM_0[12]_AigDecim$/),
  };
}
export class F27Visual {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = 'F27'; scene.add(this.root);
    this.model = new THREE.Group(); this.model.name = 'F27 model'; this.root.add(this.model);
    this.model.position.copy(F27_SOURCE_OFFSET).sub(F27_CG);
    this.eye = F27_EYE.clone(); this.real = null; this.cockpit = []; this.casters = [];
    this.dormantLightGate = { value: true };
    this.parts = []; this.time = 0; this.propPhase = [0, 0]; this.propDisplayPhase = [0, 0]; this.cabinDoor = { cmd: 0, pos: 0 };
    this.lateReady = Promise.resolve([]); this.shadow = { visible: false }; this.castsWorldShadow = true;
    this.lights = { navigation: true, beacon: true, landing: false, taxi: false, wingInspection: false, cockpitDome: false, cockpitDomeRed: false, instruments: false };
    this.onViewStatus = null; this.viewStatus = {}; this.view = 'orbit';
  }
  cockpitTextures() { return []; }
  registerOccluders() { return 0; }
  attachSelfShadow() { return true; }
  event() {}
  setEnv(tex) {
    this.envTex = tex;
    this.model.traverse(o => {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m?.isMeshStandardMaterial) continue;
        if (m.envMap !== tex) { m.envMap = tex; m.needsUpdate = true; }
        m.envMapIntensity = 0.65;
      }
    });
  }
  async loadPart(url, kind, onProgress) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    let gltf;
    try {
      gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(url, e => { if (e.total) onProgress?.(e.loaded / e.total); });
    } finally { draco.dispose(); }
    const root = gltf.scene;
    applyF27DefaultVisibility(root); // authored gear-down/closed-door/neutral transforms remain intact
    root.rotation.y = Math.PI / 2; // GLB +Z nose,+X port -> game +X nose,+Z right
    root.visible = kind !== 'cockpit'; // never expose a partially prepared cockpit
    root.traverse(o => {
      if (!o.isMesh) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const opaque = materials.every(m => !m.transparent);
      o.castShadow = kind === 'exterior' && opaque; o.receiveShadow = opaque;
      if (o.castShadow) this.casters.push(o);
      for (const m of materials) {
        for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'])
          if (m[k]) m[k].anisotropy = 4;
        // Keep the converted white PBR base colour, winding and normal-map convention.
        if (m.transparent) m.depthWrite = false;
        if (m.emissive) m.emissiveIntensity = 0; // simulator circuit maps must not make the white fuselage self-lit
      }
    });
    const instrumentMaterials = [];
    if (kind === 'cockpit') root.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m?.emissiveMap && /^int_/.test(m.name) && !instrumentMaterials.includes(m.name)) instrumentMaterials.push(m.name); });
    let staticBatch;
    if (kind === 'cockpit') {
      prepareF27ViewCasters({ root, kind });
      staticBatch = batchF27Cockpit(root, gltf.animations);
      this.glassWater = new GlassWater({ ridge: this.eye.y - this.model.position.y + 0.25, overlayOnly: true });
      // Exact VC panes, NOT instrument lenses or wing landing-light glass.
      for (const name of ['x0_Windows_Main_Side', 'x0_WindshieldWipersWet']) this.glassWater.attach(root.getObjectByName(name), root, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    }
    const adapter = createFokkerAdapter(THREE, gltf, { lighting, instrumentMaterials, model: kind === 'exterior' ? 'exterior' : 'cockpit', wingSpots: kind === 'exterior' });
    const steering = root.getObjectByName('x0_GEAR_CentralSupportV2');
    // The exported bind pose is 180 degrees. Source frame 0 is straight
    // ahead; its midpoint is the BACK of a full 360-degree lookup, not neutral.
    const steeringTrack = (gltf.animations || []).find(c => c.name === 'GEAR_Steering')?.tracks.find(t => t.name.endsWith('.quaternion'));
    const steeringBind = steeringTrack ? new THREE.Quaternion().fromArray(steeringTrack.createInterpolant().evaluate(0)) : new THREE.Quaternion();
    if (steering) steering.quaternion.copy(steeringBind);
    const part = { root, adapter, staticBatch, clips: clipBindings(gltf), kind, props: [], gear: [], wheels: [], steering, steeringBind };
    for (let i = 1; i <= 2; i++) {
      const still = root.getObjectByName(`ENGINE_Propeller_Still_${i}`);
      const cone = root.getObjectByName(`ENGINE_Propeller_Blurred_${i}_Cone`);
      const blur = root.getObjectByName(`x0_PROPELLER_BLURRED_${i}`);
      const blades = [];
      still?.traverse(o => {
        if (!o.isMesh || !/STILL_.*_Blade_/.test(o.name)) return;
        // Only clone the blade materials, not shared nacelle/fuselage materials.
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { m.transparent=true; m.depthWrite=false; }
        o.castShadow=false;
        blades.push(o);
      });
      // Cone is the hidden ancestor of the disc. Render its child, not a
      // duplicate opaque spinner on top of the retained still-model spinner.
      if (cone?.material) {
        cone.material = Array.isArray(cone.material) ? cone.material.map(m => m.clone()) : cone.material.clone();
        for (const m of (Array.isArray(cone.material) ? cone.material : [cone.material])) m.visible = false;
        cone.castShadow = false;
      }
      if (blur?.material) {
        blur.material = Array.isArray(blur.material) ? blur.material.map(m => m.clone()) : blur.material.clone();
        for (const m of (Array.isArray(blur.material) ? blur.material : [blur.material])) { m.transparent=true; m.depthWrite=false; }
        blur.castShadow = false;
      }
      part.props.push({ hub: root.getObjectByName(`ENGINE_Propeller_${i}`), still, cone, blur, blades,
        slow: root.getObjectByName(`ENGINE_Propeller_Slow_${i}`) });
    }
    // Main Shok/linkage tracks include deployment; nose Dump1/2 + SupportV3
    // are suspension-only (constant 0..100, discontinuous at 101). Retain
    // their authored rest angles; physical suspension below supplies travel.
    adapter.scrub(part.clips.gear, 1, { defer: true, endTime: F27_GEAR_DEPLOY_END });
    adapter.evaluatePose();
    // Calibrate the small residual nose/main discrepancy independently. The
    // model datum remains fixed thereafter, preserving camera and lamp anchors.
    root.updateMatrixWorld(true);
    // Authored Tire pivots (not Support/axle meshes) have local-X spin clips.
    // Resolve sign after straight-ahead steering replaces the mirrored export bind.
    const rootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const [index, label] of ['Center', 'Left', 'Right'].entries()) {
      const tire = root.getObjectByName(`GEAR_${label}_Tire`);
      if (!tire) continue;
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(tire.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(rootRotation);
      part.wheels.push({ index, tire, bind: tire.quaternion.clone(), sign: axis.x < 0 ? -1 : 1 });
    }
    const inv = root.matrixWorld.clone().invert(), point = new THREE.Vector3();
    for (const [i, label, strut] of [[0, 'Center', 'Central'], [1, 'Left', 'Left'], [2, 'Right', 'Right']]) {
      const tire = root.getObjectByName(`GEAR_${label}_Tire_Still`) || root.getObjectByName(`GEAR_${label}_Tire_Base`);
      const rig = root.getObjectByName(`x0_GEAR_${strut}SupportV3`);
      if (!tire || !rig) continue;
      let bottom = Infinity;
      tire.traverse(mesh => {
        const positions = mesh.geometry?.attributes.position; if (!positions) return;
        const matrix = inv.clone().multiply(mesh.matrixWorld);
        for (let k = 0; k < positions.count; k++) bottom = Math.min(bottom, point.fromBufferAttribute(positions, k).applyMatrix4(matrix).y);
      });
      if (!Number.isFinite(bottom)) continue;
      const bodyY = bottom + this.model.position.y;
      part.gear.push({ index: i, rig, bindPosition: rig.position.clone(), offset: F27_GEAR[i].p.y - bodyY });
    }
    // GLTFLoader normally decodes before resolving. Explicit decode covers HTML
    // image-backed loaders too; ImageBitmap-backed textures are already decoded.
    const images = new Set();
    root.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m) for (const value of Object.values(m)) if (value?.isTexture && value.image?.decode) images.add(value.image);
    } });
    await Promise.all([...images].map(image => image.decode()));
    adapter.setLights(this.lights);
    // Cockpit leaf meshes that have no animated transform can retain their
    // authored local matrix. Visibility, materials, instruments and world
    // matrices remain live; animated needles/switches are explicitly excluded.
    if (kind === 'cockpit') {
      const animated = new Set((gltf.animations || []).flatMap(c => c.tracks.map(t => THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
      part.staticMatrices = 0;
      root.traverse(o => {
        if (!o.isMesh || o.children.length || animated.has(o.name) || animated.has(o.uuid) || o.isSkinnedMesh) return;
        o.updateMatrix(); o.matrixAutoUpdate = false; part.staticMatrices++;
      });
    }
    gateF27DormantLights(root, this.dormantLightGate);
    await this.preparePart?.(part); // optional renderer texture-upload/shader warmup
    this.model.add(root); this.parts.push(part); this.setEnv(this.envTex || this.scene.environment);
    return part;
  }
  async load(url, onProgress) {
    this.exterior = await this.loadPart(url, 'exterior', onProgress);
    this.real = { scene: this.exterior.root, interior: this.interior?.root || null };
    this.loaded = true; return this;
  }
  ensureView(view) {
    this.view = view;
    return view === 'cockpit' ? this.preloadCockpit() : Promise.resolve(this.interior);
  }
  preloadCockpit() {
    // Preloading does not request a view, and shares the on-demand promise.
    if (this.cockpitPromise) return this.cockpitPromise;
    if (this.interior) return Promise.resolve(this.interior);
    this.viewStatus.cockpit = 'loading'; this.onViewStatus?.('cockpit', 'loading');
    this.cockpitPromise = this.loadPart(`${import.meta.env.BASE_URL}${F27_COCKPIT_MODEL}`, 'cockpit')
      .then(part => {
        this.interior = part; if (this.real) this.real.interior = part.root; this.cockpit = [part.root];
        // The next update swaps both representations together after posing.
        part.root.visible = false;
        this.viewStatus.cockpit = 'ready'; this.onViewStatus?.('cockpit', 'ready'); return part;
      }).catch(error => {
        this.cockpitPromise = null; this.viewStatus.cockpit = 'error'; this.onViewStatus?.('cockpit', 'error'); throw error;
      });
    return this.cockpitPromise;
  }
  setDoors(open) { this.cabinDoor.cmd = open ? 1 : 0; }
  setLights(values) {
    Object.assign(this.lights, values);
    this.parts.forEach(p => p.adapter.setLights(this.lights));
  }
  update(dt, fdm, camWorld, view, env, _ground, instrumentFeed, pilotAxes) {
    this.view = view; this.time += Math.max(0, dt);
    if (this.envTex !== this.scene.environment) this.setEnv(this.scene.environment);
    if (this.glassWater) {
      const sun = (env?.sunDir || new THREE.Vector3(0, 1, 0)).clone().applyQuaternion(fdm.quat.clone().invert());
      this.glassWater.update(dt, { rain: this.rainEff || 0, V: fdm.out?.V || 0, sun, daylight: env?.daylight ?? 1, near: view === 'cockpit' });
    }
    this.root.position.copy(fdm.pos).sub(camWorld); this.root.quaternion.copy(fdm.quat);
    // Ground AND stopped AND engines stopped. Close before taxi or engine start.
    const engineRunning = fdm.engines.some(e => (e.propRpm || 0) > 60 || e.lit === true);
    if (!fdm.onGround || fdm.vel.length() > 1 || engineRunning) this.setDoors(false);
    this.cabinDoor.pos += clamp(this.cabinDoor.cmd - this.cabinDoor.pos, -dt / 4, dt / 4);
    const rpms = fdm.engines.map(e => e.propRpm ?? fdm.propRpm ?? 0);
    for (let i = 0; i < 2; i++) {
      this.propPhase[i] = (this.propPhase[i] + Math.max(0, rpms[i] || 0) / 60 * Math.max(0, dt)) % 1;
      this.propDisplayPhase[i] = (this.propDisplayPhase[i] + propellerDisplayRps(rpms[i] || 0) * Math.max(0, dt)) % 1;
    }
    for (const part of this.parts) {
      // Cockpit file contains overlapping exterior geometry: draw just one representation.
      part.root.visible = part.kind === 'cockpit' ? view === 'cockpit' : view !== 'cockpit' || !this.interior;
      if (!part.root.visible) continue;
      const { adapter: a, clips: c } = part, scrub = (names, value) => { if (names.length) a.scrub(names, clamp(value), { defer: true }); };
      scrub(c.aileron, fraction(fdm.surfN?.ail ?? fdm.ctrl.da)); scrub(c.elevator, fraction(fdm.surfN?.el ?? fdm.ctrl.de));
      scrub(c.rudder, fraction(fdm.surfN?.rud ?? fdm.ctrl.dr)); scrub(c.trim, fraction(fdm.trim));
      scrub(c.flaps, (fdm.flaps || 0) / F27_FLAP_DEG.at(-1));
      // Source lever keys are evenly spaced detents, not flap degrees; it moves
      // with the command while the wing surfaces take 15 s end to end.
      scrub(c.flapLever, fdm.flapCmd / (F27_FLAP_DEG.length - 1));
      a.scrub(c.gear, clamp(fdm.gearPos), { defer: true, endTime: F27_GEAR_DEPLOY_END });
      if (part.steering) part.steering.quaternion.copy(part.steeringBind)
        .multiply(new THREE.Quaternion().setFromAxisAngle(STEER_AXIS, (fdm.noseSteeringAngle?.() || 0) * clamp(fdm.gearPos)));
      scrub(c.doors, this.cabinDoor.pos); scrub(c.throttle, fdm.throttle);
      // Mirror the *pilot command* before the flight-control assist, trim or
      // surface response. Positive pitch pulls the column aft; positive roll
      // lowers its right side. The source's opposing pedal tracks do the linkage.
      if (part.kind === 'cockpit') {
        scrub(c.yokePitch, fraction(pilotAxes?.pitch ?? fdm.ctrl.de));
        scrub(c.yokeRoll, fraction(pilotAxes?.roll ?? fdm.ctrl.da));
        scrub(c.rudderPedals, fraction(pilotAxes?.yaw ?? fdm.ctrl.dr));
      }
      // GAUGES: native source animation binding; no external simulator required.
      // Optional system/navigation feed may be assigned by the owning game loop.
      a.updateInstruments?.(fdm, { ...instrumentFeed, doorOpen: this.cabinDoor.pos > 0.001 }, this.time);
      // Restore translation before evaluation: nose deployment only animates
      // rotation, whereas the main lower-strut deployment also animates position.
      for (const g of part.gear || []) g.rig.position.copy(g.bindPosition);
      a.evaluatePose({ updateMatrices: false });
      for (const wheel of part.wheels || []) {
        wheel.tire.quaternion.copy(wheel.bind).multiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), wheel.sign * (fdm.wheelAngle?.[wheel.index] || 0)));
      }
      // Refresh current camera-relative ancestors + this visible model once.
      part.root.updateWorldMatrix(true, true);
      const down = clamp((fdm.gearPos - 0.9) / 0.1);
      for (const g of part.gear || []) {
        const compression = Math.max(0, fdm.compress?.[g.index] || 0) * down;
        const delta = new THREE.Vector3(0, g.offset * down, 0).applyQuaternion(this.root.quaternion);
        // Solver penetration is world-vertical, including sloped/rolled stances.
        delta.y += compression;
        const target = g.rig.getWorldPosition(new THREE.Vector3()).add(delta);
        g.rig.position.copy(g.rig.parent.worldToLocal(target));
      }
      for (let i = 0; i < 2; i++) {
        const p=part.props[i], blend=propellerBlend(rpms[i]||0);
        // Retain textured blades and spinner across the whole RPM range.
        if (p.still) p.still.visible=true;
        if (p.slow) p.slow.visible=false;
        if (p.cone) p.cone.visible=blend.disc>0.001;
        if (p.blur) {
          p.blur.visible=blend.disc>0.001;
          for (const m of (Array.isArray(p.blur.material)?p.blur.material:[p.blur.material])) if(m) m.opacity=blend.disc;
        }
        for (const blade of p.blades) for (const m of (Array.isArray(blade.material)?blade.material:[blade.material])) m.opacity=blend.blades;
        if (p.hub) p.hub.quaternion.setFromAxisAngle(PROP_AXIS, -this.propDisplayPhase[i] * Math.PI * 2);
      }
      a.update(this.time);

    }
  }
}
