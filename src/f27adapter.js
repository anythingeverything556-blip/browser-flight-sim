import { createF27Instruments } from './f27instruments.js';
/** Optional Three.js reference adapter. No loaders, network calls, or game loop. */
export function createFokkerAdapter(THREE, gltf, {
  lighting, animations, model = 'exterior', groups, wingSpots = false,
  markerRadius = 0.075, instrumentMaterials = [], instrumentColor = '#ffd084',
} = {}) {
  const root = gltf?.scene;
  if (!root?.isObject3D || !lighting?.sourceLightDefinitions) {
    throw new TypeError('Supply THREE, a loaded GLTF with scene, and lighting.json.');
  }
  if (!(Number.isFinite(markerRadius) && markerRadius > 0)) throw new RangeError('markerRadius must be positive.');
  const sources = new Map(lighting.sourceLightDefinitions.map(x => [x.id, x]));
  const presets = lighting.presets ?? {}, anchors = lighting.anchors?.[model] ?? {};
  const groupNames = groups ?? animations?.models?.[model]?.groups ?? {};
  const clips = new Map((gltf.animations ?? []).map(c => [c.name, c]));
  const mixer = new THREE.AnimationMixer(root), actions = new Map();
  const mounts = [], ownedMaterials = [], materialRestores = [];
  const channels = new Map(), channelValues = new Map(), lights = [], diagnostics = [];
  const geometry = new THREE.SphereGeometry(markerRadius, 8, 6);
  // A small additive halo remains readable at orbit distance without an always-on bloom pass.
  const haloPixels = new Uint8Array(32 * 32 * 4);
  for (let y=0; y<32; y++) for (let x=0; x<32; x++) {
    const i=4*(y*32+x), r=Math.hypot(x-15.5,y-15.5)/15.5;
    haloPixels.set([255,255,255,Math.round(220 * Math.exp(-r*r*4.5) * Math.max(0,1-r))],i);
  }
  const haloMap=new THREE.DataTexture(haloPixels,32,32); haloMap.needsUpdate=true;
  let disposed = false, now = 0;
  const levels = { navigation: 0, beacon: 0, landing: 0, taxi: 0,
    wingInspection: 0, cockpitDome: 0, cockpitDomeRed: 0, instruments: 0 };
  const live = () => { if (disposed) throw new Error('Adapter is disposed.'); };
  const unit = value => {
    if (!Number.isFinite(value)) throw new TypeError('Expected a finite number.');
    return Math.max(0, Math.min(1, value));
  };
  function channel(name) {
    if (!channels.has(name)) channels.set(name, []);
    return channels.get(name);
  }
  function mount(parent, position = [0, 0, 0], rotation, scale) {
    const node = new THREE.Group(); node.name = 'FokkerAdapter';
    node.position.fromArray(position);
    if (rotation) node.quaternion.fromArray(rotation);
    if (scale) node.scale.fromArray(scale);
    parent.add(node); mounts.push(node); return node;
  }
  function atAnchor(name, sourceId) {
    const node = root.getObjectByName(name);
    if (node) return mount(node);
    const a = anchors[name];
    if (a) {
      const parent = a.parentName && root.getObjectByName(a.parentName);
      // A nose-gear translation is LOCAL, never an aircraft-root point.
      if (!a.parentName || parent) {
        diagnostics.push(`${name}: metadata fallback used.`);
        return mount(parent || root, a.translation, a.rotation, a.scale);
      }
    }
    const position = sources.get(sourceId)?.modelPositionOrOffsetM;
    if (position && position.some(n => n !== 0)) {
      diagnostics.push(`${name}: root-coordinate fallback; moving anchor unavailable.`);
      return mount(root, position);
    }
    diagnostics.push(`${name}: unavailable; lamp omitted.`); return null;
  }
  function marker(parent, color, group) {
    if (!parent) return;
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    ownedMaterials.push(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `FokkerMarker:${group}`;
    mesh.userData.fokkerAdapter = true; parent.add(mesh);
    const glowMat = new THREE.SpriteMaterial({ map:haloMap,color,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false });
    const glow = new THREE.Sprite(glowMat), size = group === 'beacon' ? 0.9 : 0.62;
    glow.name = `FokkerHalo:${group}`; glow.scale.set(size,size,1); glow.renderOrder = 4;
    ownedMaterials.push(glowMat); parent.add(glow);
    channel(group).push(value => { mesh.visible = glow.visible = value > 0; material.color.set(color).multiplyScalar(value); glowMat.opacity=value; });
  }
  function spot(parent, direction, color, group, intensity, distance, angle) {
    if (!parent) return;
    const light = new THREE.SpotLight(color, 0, distance, angle * Math.PI / 180, 0.35, 2);
    light.name = `FokkerLight:${group}`; light.position.set(0, 0, 0);
    // Three.js spots aim at targets; aircraft lamp-local forward is +Z, NOT -Z.
    const target = new THREE.Object3D(); target.position.fromArray(direction).normalize();
    parent.add(light, target); light.target = target; lights.push(light);
    channel(group).push(value => { light.intensity = value * intensity; light.visible = value > 0; });
  }
  function point(position, color, group) {
    if (!position) return;
    const parent = mount(root, position), light = new THREE.PointLight(color, 0, 7, 2);
    light.name = `FokkerLight:${group}`; parent.add(light); lights.push(light);
    channel(group).push(value => { light.intensity = value * (group === 'cockpitDomeRed' ? 3.2 : 8); light.visible = value > 0; });
  }
  // Clone selected lamp/instrument materials; never recolor shared fuselage materials.
  const bindings = new Map();
  function bindMaterial(mesh, index, group, color) {
    const key = `${mesh.uuid}:${index}`;
    if (bindings.has(key)) {
      if (bindings.get(key) !== group) diagnostics.push(`${mesh.name}: material already controlled by ${bindings.get(key)}.`);
      return;
    }
    bindings.set(key, group);
    const original = mesh.material, before = Array.isArray(original) ? original[index] : original;
    if (!before || (!before.emissive && !before.isMeshBasicMaterial)) return;
    const copy = before.clone(); ownedMaterials.push(copy);
    materialRestores.push(() => { mesh.material = original; });
    if (Array.isArray(original)) { mesh.material = [...original]; mesh.material[index] = copy; }
    else mesh.material = copy;
    channel(group).push(value => {
      if (copy.emissive) { copy.emissive.set(color); copy.emissiveIntensity = value; }
      else copy.color.set(color).multiplyScalar(value);
    });
  }
  function lamp(name, group, color) {
    if (!name) return;
    root.getObjectByName(name)?.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material || mesh.userData.fokkerAdapter) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((_, i) => bindMaterial(mesh, i, group, color));
    });
  }
  const colorOf = (preset, fallback) => presets[preset]?.colors?.[0] ?? fallback;
  for (const [id, color] of [[0, '#ff1529'], [1, '#22ff65'], [2, '#ffffff']]) {
    const name = sources.get(id)?.node;
    if (name) { marker(atAnchor(name, id), color, 'navigation'); lamp(name, 'navigation', color); }
  }
  for (const id of [3, 4]) {
    const name = sources.get(id)?.node;
    if (name) { marker(atAnchor(name, id), '#ff2220', 'beacon'); lamp(name, 'beacon', '#ff2220'); }
  }
  for (const id of [5, 6]) {
    const source = sources.get(id);
    if (!source?.modelPositionOrOffsetM) continue;
    // Landing emissive node positions differ from actual CFG beam origins.
    const parent = mount(root, source.modelPositionOrOffsetM), color = colorOf('landing', '#fff9ef');
    spot(parent, presets.landing?.directionModel ?? [0, -0.05234, 0.99863], color,
      'landing', 1200, 160, presets.landing?.exampleOuterHalfAngleDeg ?? 20);
    marker(parent, color, 'landing'); lamp(source.emissiveNode, 'landing', color);
  }
  const taxi = atAnchor('LIGHT_ASOBO_Taxi', 7);
  spot(taxi, [0, -0.23, 0.973], colorOf('taxi', '#fff6e6'),
    'taxi', 500, 80, presets.taxi?.exampleOuterHalfAngleDeg ?? 25);
  marker(taxi, colorOf('taxi', '#fff6e6'), 'taxi');
  lamp('LIGHT_ASOBO_Taxi', 'taxi', colorOf('taxi', '#fff6e6'));
  // Halo is the moving taxi marker, not the separate static fx_taxihalo.
  for (const id of [8, 9]) {
    const name = sources.get(id)?.node;
    if (!name) continue;
    const parent = atAnchor(name, id), color = colorOf('wingInspection', '#fff6e6');
    marker(parent, color, 'wingInspection'); lamp(name, 'wingInspection', color);
    if (wingSpots) spot(parent, [0, 0, 1], color, 'wingInspection', 100, 22, 35);
  }
  if (model === 'cockpit') for (const [id, group, name, fallback] of [
    [105, 'cockpitDome', 'LIGHT_ASOBO_Dome', '#ffd084'],
    [141, 'cockpitDomeRed', 'LIGHT_ASOBO_Dome_red', '#ff3628'],
  ]) {
    const color = colorOf(group, fallback);
    point(sources.get(id)?.modelPositionOrOffsetM, color, group); lamp(name, group, color);
  }
  const wanted = new Set(instrumentMaterials);
  if (wanted.size) root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material || mesh.userData.fokkerAdapter) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((material, i) => {
      if (wanted.has(material.name)) bindMaterial(mesh, i, 'instruments', instrumentColor);
    });
  });
  function refresh() {
    const period = presets.beacon?.examplePeriodSeconds ?? 1.2, on = presets.beacon?.exampleOnSeconds ?? 0.15;
    const pulse = period > 0 && now % period < on ? 1 : 0;
    for (const [name, setters] of channels) {
      const value = levels[name] * (name === 'beacon' ? pulse : 1);
      // Instrument materials are numerous; only circuit/flash transitions need
      // color/intensity writes. A steady dimmer is not a per-frame repaint.
      if (channelValues.get(name) === value) continue;
      channelValues.set(name, value);
      setters.forEach(set => set(value));
    }
  }
  function resolve(selection) {
    const result = new Set();
    for (const name of (Array.isArray(selection) ? selection : [selection])) {
      if (clips.has(name)) result.add(name);
      else if (Object.hasOwn(groupNames, name)) {
        groupNames[name].forEach(clip => { if (clips.has(clip)) result.add(clip); });
      } else throw new Error(`Unknown clip/group: ${name}`);
    }
    return [...result];
  }
  refresh();
  let instruments;
  const api = {
    root, lights, diagnostics,
    get instruments() { return instruments; },
    updateInstruments(fdm, feed, elapsed) { return instruments?.update(fdm, feed, elapsed); },
    get activeClips() { return [...actions.keys()]; },
    get lightLevels() { return { ...levels }; },
    availableClips: [...clips.keys()], availableGroups: Object.keys(groupNames),
    /** Fractions are clamped [0,1]; neutral control positions are caller-specific. */
    scrub(selection, fraction, { replace = false, defer = false, endTime = null } = {}) {
      live(); const t = unit(fraction), names = resolve(selection);
      if (replace) for (const [name, action] of actions) {
        if (!names.includes(name)) { action.stop(); actions.delete(name); }
      }
      for (const name of names) {
        let action = actions.get(name);
        if (!action) {
          action = mixer.clipAction(clips.get(name)); action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true; action.play(); action.paused = true; actions.set(name, action);
        }
        // Some source clips concatenate deployment and suspension on one
        // authoring timeline. All gear links must use the SAME deployment end.
        action.enabled = true; action.time = (endTime === null ? clips.get(name).duration : Math.min(clips.get(name).duration, Math.max(0, endTime))) * t;
      }
      if (!defer) { mixer.update(0); root.updateMatrixWorld(true); } return names;
    },
    evaluatePose({ updateMatrices = true } = {}) { live(); mixer.update(0); if (updateMatrices) root.updateMatrixWorld(true); },
    /** Stop selected actions (or all), restoring pre-animation transforms. */
    release(selection = null) {
      live(); const names = selection === null ? [...actions.keys()] : resolve(selection);
      for (const name of names) { actions.get(name)?.stop(); actions.delete(name); }
      mixer.update(0); root.updateMatrixWorld(true);
    },
    setLights(values) {
      live(); const next = {};
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(levels, key)) throw new Error(`Unknown light channel: ${key}`);
        next[key] = typeof value === 'boolean' ? Number(value) : unit(value);
      }
      Object.assign(levels, next); refresh();
    },
    /** Absolute elapsed seconds from the game's clock; never advances all clips. */
    update(elapsedSeconds) {
      live();
      if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new RangeError('Time must be finite and nonnegative.');
      now = elapsedSeconds; refresh();
    },
    /** Caller retains ownership of GLTF geometry/textures/materials. */
    dispose() {
      if (disposed) return;
      instruments?.dispose();
      mixer.stopAllAction(); mixer.uncacheRoot(root); actions.clear();
      materialRestores.reverse().forEach(restore => { restore(); });
      mounts.forEach(node => node.removeFromParent()); lights.forEach(light => light.dispose?.());
      ownedMaterials.forEach(material => material.dispose()); geometry.dispose(); haloMap.dispose();
      channels.clear(); channelValues.clear(); disposed = true;
    },
  };
  if (model === 'cockpit') instruments = createF27Instruments(gltf, api);
  return api;
}
