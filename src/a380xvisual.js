import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { A380X_CG } from './a380x.js';
import { configureA380TextureManager, applyA380NativeMaterials } from '../tools/a380-native-textures.mjs';
import { readAsset, prepareGltf } from './a380xassets.js';
import { decodeA380SkinPalettes } from './a380xskin.js';
import { loadA380Transport, configureA380TransportLoader } from './a380xtransport.js';

// All geometry here is the converted external model; never substitute procedural airframe geometry.
// Manifest scene entries accept {url, buffers, rotation:[rx,ry,rz], position:[x,y,z], scale}.
// Model-to-simulator convention defaults to MSFS (+Z forward, +X right, +Y up), metres.
export const A380X_EYE = new THREE.Vector3(31.9, 6.64, -0.65).sub(A380X_CG);
// Original lower-deck aisle: source [1.35, 2.55, 12.5], rotated +PI/2 and raised 3.24 m.
export const A380X_CABIN = new THREE.Vector3(12.5, 5.79, -1.35).sub(A380X_CG);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function animationRole(name) {
  const s = name.toLowerCase().replace(/[ ._-]/g, '');
  const side = /left|(?:^|_)l(?:_|$)/i.test(name) || /aileronl|elevatorl|flapl|slatl/.test(s) ? 'left' : /right|(?:^|_)r(?:_|$)/i.test(name) || /aileronr|elevatorr|flapr|slatr/.test(s) ? 'right' : '';
  if (/thrustrev/.test(s)) return { role: 'reverse', engine: /2/.test(s) ? 2 : 1 };
  if (/gearcomp/.test(s)) return { role: 'compression', unit: 0 };
  if (/tire|tyre/.test(s)) return { role: 'wheel', unit: /^c/.test(s) ? 0 : /^l/.test(s) ? 1 : /^r/.test(s) ? 3 : 2 };
  if (/trimtab/.test(s)) return { role: 'trim' };
  if (/cwheel/.test(s)) return { role: 'steer' };
  if (/elevatorflex/.test(s)) return null; // aeroelastic flex is not the pilot elevator
  if (/aileron/.test(s)) return { role: 'aileron', side };
  if (/elevator/.test(s)) return { role: 'elevator', side };
  if (/rudder/.test(s)) return { role: 'rudder' };
  if (/slat/.test(s)) return { role: 'slats' };
  if (/flap/.test(s) && !/handle|lever/.test(s)) return { role: 'flaps' };
  if (/spoiler|speedbrake/.test(s)) return { role: 'spoilers', side };
  if (/gear|landing/.test(s) && !/steer|wheel|lever|handle|light/.test(s)) return { role: 'gear' };
  if (/steer/.test(s)) return { role: 'steer' };
  if (/throttle|thrustlever/.test(s)) return { role: 'throttle' };
  if (/n1|fan|engine.*rot/.test(s)) return { role: 'fan', engine: Math.max(0, Number(s.match(/n1([1-4])/)?.[1] || s.match(/[1-4]/)?.[0] || 1) - 1) };
  return null;
}
export function animationFraction(binding, fdm, time = 0) {
  const surf = fdm.surfN || {}, role = binding.role;
  let v = 0;
  if (role === 'compression') v = clamp((fdm.compress?.[binding.unit || 0] || 0) / 0.5);
  if (role === 'wheel') v = (time * Math.abs(fdm.wheel?.[binding.unit || 0] || 0) / (2 * Math.PI)) % 1;
  if (role === 'trim') v = 0.5 + (fdm.trim || 0) * 0.5;
  if (role === 'gear') v = fdm.gearPos;
  if (role === 'flaps') v = (fdm.flaps || 0) / 33;
  if (role === 'slats') v = (fdm.slats || 0) / 23;
  if (role === 'spoilers') v = Math.max(fdm.spoilers || 0, binding.side ? fdm.rollSpoil?.[binding.side === 'left' ? 'l' : 'r'] || 0 : 0);
  if (role === 'elevator') v = 0.5 + (surf.el || 0) * 0.5;
  if (role === 'aileron') v = 0.5 + (surf.ail || 0) * (binding.side === 'left' ? -0.5 : 0.5);
  if (role === 'rudder') v = 0.5 + (surf.rud || 0) * 0.5;
  if (role === 'steer') v = 0.5 + (fdm.nosteer || 0) / 120;
  if (role === 'throttle') v = fdm.throttle || 0;
  if (role === 'reverse') v = fdm.engines?.[binding.engine ?? 1]?.rev || 0;
  if (role === 'fan') v = time * (0.3 + (fdm.engines?.[binding.engine || 0]?.n1 || 0) * 0.025) % 1;
  if (binding.invert) v = 1 - v;
  return (binding.min ?? 0) + clamp(v) * ((binding.max ?? 1) - (binding.min ?? 0));
}
export class A380XVisual {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.scene = scene; this.root = new THREE.Group(); this.root.name = 'A380X'; scene.add(this.root);
    this.model = new THREE.Group(); this.model.name = 'A380X_Source'; this.model.position.copy(A380X_CG).negate(); this.root.add(this.model);
    this.cockpit = []; this.casters = []; this.engines = []; this.parts = {}; this.partGroups = {}; this.mixers = []; this.time = 0; this.lateReady = Promise.resolve([]);
    this.shadow = new THREE.Object3D(); this.shadow.visible = false;
    this.viewStatus = { exterior: 'idle', cockpit: 'idle', cabin: 'idle' };
    this.eye = A380X_EYE.clone(); this.cabinEye = A380X_CABIN.clone();
  }
  registerOccluders() { return 0; }
  attachSelfShadow() { return false; }
  cockpitTextures() { return []; }
  event() {}
  cargoMoving() { return false; }
  setEnv() {} // preserve source PBR materials and the scene environment
  async load(url, onProgress = () => {}) {
    this.manifestURL = new URL(url, globalThis.location?.href || 'https://local.invalid/').href;
    this.manifest = /\.gltf(?:\?|$)/i.test(this.manifestURL) ? {
      exterior: this.manifestURL, cockpit: 'a380_cockpit.native.gltf', cabin: 'a380_cockpit.native.gltf',
      rotation: [0, Math.PI / 2, 0], position: [0, 3.24, 0],
    } : await readAsset(this.manifestURL);
    if (this.renderer && /\.native\.gltf/i.test(this.manifest.exterior?.url || this.manifest.exterior)) {
      const required = ['EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc'];
      const missing = required.filter(name => !this.renderer.extensions.has(name));
      if (missing.length) throw new Error('Original A380X textures require a desktop GPU/browser with BC7 and BC5 compressed texture support. Missing: ' + missing.join(', '));
    }
    if (!this.manifest.exterior) throw new Error('A380X manifest has no exterior scene');
    // Compression is explicit opt-in. Resolve the asset root from the exterior,
    // not this manifest's folder (a view partition manifest may be nested).
    if (this.manifest.transport) {
      const exteriorURL = typeof this.manifest.exterior === 'string' ? this.manifest.exterior : this.manifest.exterior.url;
      const sourceBase = new URL('.', new URL(exteriorURL, this.manifestURL)).href;
      this.transport = await loadA380Transport(new URL(this.manifest.transport, this.manifestURL).href, sourceBase);
      if (this.manifest.transportRequired && !this.transport.enabled) throw new Error('This lossless preview needs a modern HTTPS browser with gzip decompression. The uncompressed preview remains available separately');
    }
    const points = this.manifest.cameras || {};
    if (points.eye) this.eye.fromArray(points.eye).sub(A380X_CG);
    if (points.cabin) this.cabinEye.fromArray(points.cabin).sub(A380X_CG);
    await this.loadPart('exterior', onProgress);
    return this;
  }
  async loadPart(name, progress = () => {}) {
    if (this.parts[name]) return this.parts[name];
    const entry = this.manifest[name] || (name === 'cabin' ? this.manifest.cockpit : null);
    if (!entry) { this.viewStatus[name] = 'unavailable'; throw new Error(`No converted ${name} scene supplied`); }
    const descriptor = typeof entry === 'string' ? { url: entry } : entry;
    const other = name === 'cabin' ? 'cockpit' : name === 'cockpit' ? 'cabin' : null;
    const otherEntry = other && (this.manifest[other] || (other === 'cabin' ? this.manifest.cockpit : null));
    if (other && this.parts[other] && (typeof otherEntry === 'string' ? otherEntry : otherEntry?.url) === descriptor.url) {
      this.viewStatus[name] = 'loading'; this.onViewStatus?.(name, 'loading');
      return this.parts[other].then(group => { this.partGroups[name] = group; this.viewStatus[name] = 'ready'; this.onViewStatus?.(name, 'ready'); return group; });
    }
    this.viewStatus[name] = 'loading'; this.onViewStatus?.(name, 'loading');
    this.parts[name] = (async () => {
      const url = new URL(descriptor.url, this.manifestURL).href, loader = configureA380TransportLoader(new GLTFLoader(configureA380TextureManager(this.renderer, undefined, { transport: this.transport })));
      const draco = new DRACOLoader().setDecoderPath(`${import.meta.env?.BASE_URL || '/'}draco/`); loader.setDRACOLoader(draco);
      let prepared;
      try {
        let gltf;
        if (/\.glb(?:\?|$)/i.test(url)) gltf = await loader.loadAsync(url, e => e.total && progress(e.loaded / e.total));
        else { prepared = await prepareGltf(url, descriptor, { progress, fetcher: this.transport?.fetch || fetch }); gltf = await loader.parseAsync(JSON.stringify(prepared.json), prepared.base); }
        decodeA380SkinPalettes(gltf.scene);
        applyA380NativeMaterials(gltf.scene);
        const group = new THREE.Group(); group.name = `A380X_${name}`; group.add(gltf.scene);
        group.rotation.fromArray(descriptor.rotation || this.manifest.rotation || [0, Math.PI / 2, 0]);
        group.position.fromArray(descriptor.position || this.manifest.position || [0, 0, 0]);
        group.scale.setScalar(descriptor.scale || this.manifest.scale || 1);
        group.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = name === 'exterior'; o.receiveShadow = true;
          if (o.castShadow) this.casters.push(o);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.22); m.depthWrite = false; }
            // The original conversion marks windscreen/cabin windows; remove opaque windscreen occlusion only inside.
            if (/glass|windscreen|windshield/i.test(m.name)) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.24); m.depthWrite = false; }
          }
        });
        this.model.add(group); if (name !== 'exterior') { this.partGroups[name] = group; this.cockpit.push(group); }
        const mixer = new THREE.AnimationMixer(gltf.scene), bindings = [];
        for (const clip of gltf.animations) {
          const explicit = (descriptor.animations || this.manifest.animations || {})[clip.name];
          const binding = explicit || animationRole(clip.name); if (!binding) continue;
          const action = mixer.clipAction(clip); action.play(); action.paused = true;
          bindings.push({ ...binding, action, duration: clip.duration, clip: clip.name });
        }
        this.mixers.push({ mixer, bindings });
        let tris = 0, draws = 0; this.model.traverse(o => { if (o.isMesh) { draws++; tris += (o.geometry.index?.count || o.geometry.attributes.position?.count || 0) / 3; } });
        this.stats = { tris: Math.round(tris), draws, clips: this.mixers.reduce((n, m) => n + m.bindings.length, 0) };
        this.viewStatus[name] = 'ready'; this.onViewStatus?.(name, 'ready'); progress(1);
        return group;
      } catch (error) { this.viewStatus[name] = 'error'; this.onViewStatus?.(name, 'error', error); delete this.parts[name]; throw error; }
      finally { prepared?.dispose(); draco.dispose(); }
    })();
    return this.parts[name];
  }
  async ensureView(view) {
    const name = view === 'cockpit' ? 'cockpit' : view === 'cabin' ? 'cabin' : null;
    if (!name) return;
    // Opt-in source partitions share the original bulkhead/front-galley shell.
    // Keep the legacy combined interior entrypoint and loader contract intact.
    if (this.manifest.interior) {
      const [, group] = await Promise.all([this.loadPart('interior'), this.loadPart(name)]);
      return group;
    }
    return this.loadPart(name);
  }
  pose(fdm, dt) {
    this.time += dt;
    for (const { mixer, bindings } of this.mixers) {
      for (const b of bindings) b.action.time = clamp(animationFraction(b, fdm, this.time)) * b.duration;
      mixer.update(0);
    }
  }
  update(dt, fdm, camera, view) {
    this.root.position.copy(fdm.pos).sub(camera); this.root.quaternion.copy(fdm.quat);
    if (this.partGroups.interior) this.partGroups.interior.visible = view === 'cockpit' || view === 'cabin';
    if (this.partGroups.cockpit) this.partGroups.cockpit.visible = view === 'cockpit';
    if (this.partGroups.cabin) this.partGroups.cabin.visible = view === 'cabin' || (this.partGroups.cabin === this.partGroups.cockpit && view === 'cockpit');
    if (this.partGroups.cockpit && !this.partGroups.cabin && view === 'cabin') this.partGroups.cockpit.visible = true;
    this.pose(fdm, dt);
  }
}
