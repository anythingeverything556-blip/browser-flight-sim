import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { DA40_CG, DA40_FLAP_DEG } from './da40.js';

const D2R = Math.PI / 180;
const SOURCE_OFFSET = new THREE.Vector3(-3.078, 0.994, 0);
export const DA40_EYE = new THREE.Vector3(-1.628, 1.594, -0.32).sub(DA40_CG);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const sourceName = (object) => object.userData?.name || object.name;

function instances(scene) {
  const result = new Map();
  scene.traverse((object) => { if (/^da40-instance-\d+$/.test(object.name)) result.set(object.name, object); });
  return result;
}

function targets(instance, name) {
  const result = [];
  if (!instance) return result;
  const visit = (object) => {
    if (object !== instance && /^da40-instance-\d+$/.test(object.name)) return;
    if (object !== instance && sourceName(object) === name) result.push(object);
    for (const child of object.children) visit(child);
  };
  visit(instance);
  return result;
}

function pivotFor(scene, instance, rule) {
  const pivot = new THREE.Vector3(...rule.pivot);
  const center = rule.details?.center;
  if (center && Object.values(center).some((value) => typeof value === 'string' && Number.isFinite(parseFloat(value)))) {
    const number = (name) => parseFloat(center[name]) || 0;
    pivot.set(number('x-m'), number('z-m'), -number('y-m'));
    instance.localToWorld(pivot);
    scene.worldToLocal(pivot);
  }
  return pivot;
}

function wrap(scene, object, pivot, axis) {
  const parent = object.parent;
  scene.updateWorldMatrix(true, true);
  const point = scene.localToWorld(pivot.clone());
  parent.worldToLocal(point);
  const worldAxis = axis.clone().applyQuaternion(scene.getWorldQuaternion(new THREE.Quaternion()));
  const localAxis = worldAxis.applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
  const group = new THREE.Group();
  group.name = `DA40 pivot: ${sourceName(object)}`;
  group.position.copy(point);
  parent.add(group);
  group.updateWorldMatrix(true, false);
  group.attach(object);
  return { group, axis: localAxis };
}

function interpolate(entries, value) {
  if (!entries?.length) return value;
  if (value <= Number(entries[0].ind)) return Number(entries[0].dep);
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1], next = entries[index];
    if (value <= Number(next.ind)) {
      const fraction = (value - Number(previous.ind)) / (Number(next.ind) - Number(previous.ind));
      return Number(previous.dep) + fraction * (Number(next.dep) - Number(previous.dep));
    }
  }
  return Number(entries[entries.length - 1].dep);
}

function text(context, value, x, y, size = 18, color = '#fff', align = 'left') {
  context.fillStyle = color; context.font = `bold ${size}px sans-serif`;
  context.textAlign = align; context.fillText(String(value), x, y);
}

function drawPFD(canvas, state) {
  const context = canvas.getContext('2d'), width = 512, height = 384;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  const pitch = clamp(finite(state.pitch), -60, 60), bank = clamp(finite(state.bank), -180, 180);
  context.fillStyle = '#111b25'; context.fillRect(0, 0, width, height);
  context.save(); context.beginPath(); context.rect(85, 38, width - 170, 230); context.clip();
  context.translate(width / 2, 155); context.rotate(-bank * D2R); context.translate(0, pitch * 3);
  context.fillStyle = '#2479b3'; context.fillRect(-500, -700, 1000, 700);
  context.fillStyle = '#856142'; context.fillRect(-500, 0, 1000, 700);
  context.strokeStyle = '#fff'; context.lineWidth = 2; context.beginPath(); context.moveTo(-500, 0); context.lineTo(500, 0); context.stroke();
  for (let angle = -40; angle <= 40; angle += 10) {
    if (!angle) continue; const y = -angle * 3;
    context.beginPath(); context.moveTo(-22, y); context.lineTo(22, y); context.stroke();
    text(context, Math.abs(angle), 30, y + 5, 13);
  }
  context.restore();
  context.strokeStyle = '#ffdf31'; context.lineWidth = 4; context.beginPath();
  context.moveTo(width / 2 - 47, 155); context.lineTo(width / 2 - 15, 155); context.lineTo(width / 2, 163);
  context.lineTo(width / 2 + 15, 155); context.lineTo(width / 2 + 47, 155); context.stroke();
  context.fillStyle = '#252c30'; context.fillRect(0, 38, 84, 230); context.fillRect(width - 84, 38, 84, 230);
  text(context, 'IAS KT', 8, 63, 15); text(context, Math.round(finite(state.ias)), 42, 159, 29, '#fff', 'center');
  text(context, 'ALT FT', width - 42, 63, 15, '#fff', 'center'); text(context, Math.round(finite(state.alt)), width - 42, 159, 25, '#fff', 'center');
  text(context, `VS ${Math.round(finite(state.vs))} FPM`, width / 2, 296, 18, '#fff', 'center');
  text(context, `HDG ${String(Math.round((finite(state.hdg) + 360) % 360)).padStart(3, '0')}°`, width / 2, 325, 24, '#7bffce', 'center');
  text(context, `GS ${Math.round(finite(state.gs))} KT`, 10, 371, 18);
  text(context, 'PFD • SIMPLIFIED', width - 10, 371, 14, '#aab8c4', 'right');
}

function drawMFD(canvas, state) {
  const context = canvas.getContext('2d'), width = 512, height = 384, nav = state.nav || {};
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.fillStyle = '#101a20'; context.fillRect(0, 0, width, height);
  text(context, 'NAV / ENGINE', 16, 29, 22, '#8afac1');
  context.strokeStyle = '#526b73'; context.strokeRect(12, 40, width - 24, 150);
  text(context, nav.valid ? `TO ${String(nav.ident || 'WAYPOINT').slice(0, 14)}` : 'NO ACTIVE NAV', 24, 72, 22);
  if (nav.valid) {
    text(context, `BRG ${Math.round(finite(nav.brgDeg))}°    DIST ${finite(nav.distNm).toFixed(1)} NM`, 24, 106, 20);
    text(context, `CRS ${Math.round(finite(nav.course))}°    XTK ${finite(nav.xtkNm).toFixed(1)} NM`, 24, 139, 20);
  }
  text(context, `RPM ${Math.round(finite(state.rpm))}`, 24, 225, 22);
  text(context, `FUEL ${finite(state.fuel).toFixed(0)} KG`, 270, 225, 22);
  text(context, `POWER ${Math.round(clamp(finite(state.throttle), 0, 1) * 100)}%`, 24, 256, 20);
  text(context, `FLAPS ${Math.round(finite(state.flaps))}°`, 270, 256, 20);
  const warning = state.warn || {};
  const alerts = Object.entries(warning).filter(([, active]) => active === true).slice(0, 3).map(([name]) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase());
  if (alerts.length) alerts.forEach((alert, index) => text(context, alert, 24, 296 + index * 22, 18, '#ffb43f'));
  else text(context, 'NO ACTIVE WARNINGS', 24, 305, 18, '#a4c2b4');
  text(context, 'NAV / CAS • SIMPLIFIED', width - 10, 371, 14, '#aab8c4', 'right');
}

export class DA40Visual {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = 'DA40'; scene.add(this.root);
    this.model = new THREE.Group(); this.model.name = 'DA40_Source'; this.model.position.copy(DA40_CG).negate(); this.root.add(this.model);
    this.shadow = new THREE.Object3D(); this.shadow.visible = false;
    this.cockpit = []; this.casters = []; this.engines = []; this.lateReady = Promise.resolve([]);
    this.eye = DA40_EYE.clone(); this.bindings = []; this.textures = []; this.cabinDoor = { cmd: 0, pos: 0 }; this.door = this.cabinDoor;
    this.gearRig = { onDoor: null }; this.displayTime = 1; this.loaded = false; this.lights = []; this.lightTime = 0;
  }
  cockpitTextures() { return this.textures; }
  registerOccluders() { return 0; }
  attachSelfShadow() { return false; }
  setEnv() {}
  event() {}
  setDoors(open) { if (open && this.onGround === false) return false; this.door.cmd = open ? 1 : 0; return true; }

  async load(url, onProgress = () => {}) {
    const modelURL = new URL(url, globalThis.location?.href || 'https://local.invalid/');
    const response = await fetch(new URL('rig.json', modelURL));
    if (!response.ok) throw new Error(`DA40 animation rig: HTTP ${response.status}`);
    const rig = await response.json();
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env?.BASE_URL || '/'}draco/`);
    try {
      const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(modelURL.href, (event) => { if (event.total) onProgress(event.loaded / event.total); });
      this.attachModel(gltf.scene, rig);
    } finally { draco.dispose(); }
    return this;
  }

  attachModel(scene, rig) {
    if (rig.schema !== 1 || !Array.isArray(rig.rules)) throw new Error('Unsupported DA40 animation rig');
    scene.position.copy(SOURCE_OFFSET); scene.rotation.y = -Math.PI / 2; this.model.add(scene);
    this.source = scene; this.instanceNodes = instances(scene); this.bindings = [];
    const supported = new Set(['engines/engine[0]/rpm', 'surface-positions/elevator-pos-norm', 'controls/flight/elevator-trim', 'surface-positions/rudder-pos-norm', 'surface-positions/left-aileron-pos-norm', 'surface-positions/right-aileron-pos-norm', 'surface-positions/flap-pos-norm', 'gear/gear[0]/compression-norm', 'gear/gear[1]/compression-norm', 'gear/gear[2]/compression-norm', 'gear/gear[0]/steering-norm', 'gear/gear[0]/rollspeed-ms', 'gear/gear[1]/rollspeed-ms', 'gear/gear[2]/rollspeed-ms', 'da40/canopy-norm', 'da40/door-left-norm', 'instrumentation/magnetic-compass/indicated-heading-deg', 'instrumentation/airspeed-indicator/indicated-speed-kt', '/instrumentation/attitude-indicator/indicated-roll-deg', '/instrumentation/attitude-indicator/indicated-pitch-deg', 'instrumentation/altimeter/indicated-altitude-ft']);
    for (const rule of rig.rules) {
      if (!supported.has(rule.details?.property) || !rule.pivot || !rule.axis) continue;
      const instance = this.instanceNodes.get(rule.instance);
      if (!instance) continue;
      for (const name of rule.matchingTargets || rule.targets || []) for (const object of targets(instance, name)) {
        const binding = wrap(scene, object, pivotFor(scene, instance, rule), new THREE.Vector3(...rule.axis));
        Object.assign(binding, { rule, object, angle: 0 }); this.bindings.push(binding);
      }
    }
    this.addCockpitControls();
    this.setupDisplays(rig);
    scene.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        if (material.map) material.map.anisotropy = 8;
        if (material.isMeshStandardMaterial && material.name === 'DA40NG') material.roughness = 0.48;
        if (material.isMeshStandardMaterial && ['dark_glass', 'int_glass'].includes(material.name)) material.roughness = 0.32;
      }
      object.castShadow = !object.material?.transparent; object.receiveShadow = !object.material?.transparent;
      if (object.castShadow) this.casters.push(object);
    });
    for (const entry of rig.instances || []) {
      const match = /\/Lights\/lights\/(LandingLight|TaxiLight|RedLight|GreenLight|WhiteLight|StrobeLight)\.xml$/i.exec(entry.xml || '');
      if (!match) continue;
      const kind = match[1].toLowerCase();
      for (const light of targets(this.instanceNodes.get(entry.id), 'Light')) {
        const color = kind === 'redlight' ? 0xff2525 : kind === 'greenlight' ? 0x24ff70 : 0xffffff;
        light.material = new THREE.MeshBasicMaterial({ map: light.material?.map || null, color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
        light.scale.multiplyScalar(0.09); light.castShadow = false; light.visible = false;
        this.lights.push({ object: light, kind });
      }
    }
    this.prop = targets(this.instanceNodes.get('da40-instance-000'), 'prop')[0];
    this.propDisc = targets(this.instanceNodes.get('da40-instance-000'), 'propdisc')[0];
    this.loaded = true;
    return this;
  }

  addCockpitControls() {
    const scene = this.source, interior = this.instanceNodes.get('da40-instance-001');
    if (!interior) return;
    const approximations = [
      ['throttle_lever', [0, 0, 0], [0, 0, -1], 'throttle', 0.1],
      ['elevator_trim', [0.0037, 0.061148, -1.74988], [1, 0, 0], 'trimWheel', -720],
      ['rudder_pedal_LL', [-0.38, -0.24, -2.45], [1, 0, 0], 'pedalLeft', 12],
      ['rudder_pedal_LL.001', [0.38, -0.24, -2.45], [1, 0, 0], 'pedalLeft', 12],
      ['rudder_pedal_LR', [-0.16, -0.24, -2.45], [1, 0, 0], 'pedalRight', -12],
      ['rudder_pedal_LR.001', [0.16, -0.24, -2.45], [1, 0, 0], 'pedalRight', -12],
      ['brake_pedal_LL', [-0.38, -0.24, -2.45], [1, 0, 0], 'pedalLeft', 12],
      ['brake_pedal_LL.001', [0.38, -0.24, -2.45], [1, 0, 0], 'pedalLeft', 12],
      ['brake_pedal_LR', [-0.16, -0.24, -2.45], [1, 0, 0], 'pedalRight', -12],
      ['brake_pedal_LR.001', [0.16, -0.24, -2.45], [1, 0, 0], 'pedalRight', -12],
    ];
    for (const [name, point, direction, property, factor] of approximations) for (const object of targets(interior, name)) {
      const binding = wrap(scene, object, new THREE.Vector3(...point), new THREE.Vector3(...direction));
      Object.assign(binding, { object, approximate: property, factor }); this.bindings.push(binding);
    }
    const panel = this.instanceNodes.get('da40-instance-002');
    for (const object of targets(panel, 'g1000_sw.flaps')) {
      const binding = wrap(scene, object, new THREE.Vector3(0, 0.2332, -2.202456), new THREE.Vector3(1, 0, 0));
      Object.assign(binding, { object, approximate: 'flapSwitch', factor: 45 }); this.bindings.push(binding);
    }
  }

  setupDisplays(rig) {
    if (typeof document === 'undefined') return;
    const instanceFor = (pattern) => this.instanceNodes.get((rig.instances || []).find((entry) => pattern.test(entry.xml || ''))?.id);
    const mfd = instanceFor(/GDU-1044\.2\.xml$/i);
    if (!mfd || !targets(mfd, 'Screen2').length) return;
    let pfd = instanceFor(/GDU-1040\.1\.xml$/i), pfdScreen = pfd && targets(pfd, 'Screen1')[0];
    if (!pfdScreen) {
      pfd = mfd.clone(true); pfd.name = 'DA40 approximate PFD'; pfd.position.z += 0.34; mfd.parent.add(pfd);
      pfdScreen = targets(pfd, 'Screen2')[0];
    }
    for (const [screen, kind, draw] of [[pfdScreen, 'pfd', drawPFD], [targets(mfd, 'Screen2')[0], 'mfd', drawMFD]]) {
      if (!screen) continue;
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = 8;
      screen.material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
      draw(canvas, {}); texture.needsUpdate = true; this.textures.push(texture);
      (this.displays ||= {})[kind] = { canvas, texture, draw };
    }
  }

  update(dt, fdm, camera, view, env, groundY, feed) {
    this.root.position.copy(fdm.pos).sub(camera); this.root.quaternion.copy(fdm.quat);
    if (!this.loaded) return;
    const seconds = Math.max(0, finite(dt)); this.onGround = !!fdm.onGround;
    this.lightTime += seconds;
    if (this.onGround || this.door.cmd === 0) this.door.pos += clamp(this.door.cmd - this.door.pos, -seconds * 0.5, seconds * 0.5);
    const controls = fdm.surf || fdm.ctrl || {}, trim = clamp(finite(fdm.trim), -1, 1);
    const rpm = Math.max(0, finite(fdm.rpm, finite(fdm.engines?.[0]?.rpm)));
    const properties = {
      'engines/engine[0]/rpm': rpm,
      'surface-positions/elevator-pos-norm': -clamp(finite(controls.de) + trim * 0.6, -1, 1),
      'controls/flight/elevator-trim': trim,
      'surface-positions/rudder-pos-norm': clamp(finite(controls.dr), -1, 1),
      'surface-positions/left-aileron-pos-norm': clamp(finite(controls.da), -1, 1),
      'surface-positions/right-aileron-pos-norm': -clamp(finite(controls.da), -1, 1),
      'surface-positions/flap-pos-norm': clamp(finite(fdm.flaps) / DA40_FLAP_DEG.at(-1), 0, 1),
      'gear/gear[0]/steering-norm': fdm.onGround ? clamp(finite(controls.dr), -1, 1) * 12 / 360 : 0,
      'da40/canopy-norm': this.door.pos, 'da40/door-left-norm': this.door.pos,
    };
    for (let index = 0; index < 3; index++) {
      properties[`gear/gear[${index}]/compression-norm`] = clamp(finite(fdm.compress?.[index]) / 0.25, 0, 1);
      properties[`gear/gear[${index}]/rollspeed-ms`] = finite(fdm.wheel?.[index]);
    }
    let state = null;
    if (view === 'cockpit' && feed) {
      this.displayTime += seconds;
      if (this.displayTime >= 0.1) { state = typeof feed === 'function' ? feed() : feed; this.displayTime = 0; }
    }
    if (state) {
      Object.assign(properties, {
        'instrumentation/magnetic-compass/indicated-heading-deg': finite(state.hdg),
        'instrumentation/airspeed-indicator/indicated-speed-kt': finite(state.ias),
        '/instrumentation/attitude-indicator/indicated-roll-deg': finite(state.bank),
        '/instrumentation/attitude-indicator/indicated-pitch-deg': finite(state.pitch),
        'instrumentation/altimeter/indicated-altitude-ft': finite(state.alt),
      });
      this.lastDisplayState = state;
      for (const display of Object.values(this.displays || {})) { display.draw(display.canvas, state); display.texture.needsUpdate = true; }
    } else if (this.lastDisplayState) {
      const previous = this.lastDisplayState;
      properties['instrumentation/magnetic-compass/indicated-heading-deg'] = finite(previous.hdg);
      properties['instrumentation/airspeed-indicator/indicated-speed-kt'] = finite(previous.ias);
      properties['/instrumentation/attitude-indicator/indicated-roll-deg'] = finite(previous.bank);
      properties['/instrumentation/attitude-indicator/indicated-pitch-deg'] = finite(previous.pitch);
      properties['instrumentation/altimeter/indicated-altitude-ft'] = finite(previous.alt);
    }
    for (const binding of this.bindings) {
      if (binding.approximate) {
        const value = binding.approximate === 'throttle' ? clamp(finite(fdm.throttle), 0, 1) : binding.approximate === 'trimWheel' ? trim : binding.approximate === 'flapSwitch' ? clamp(finite(fdm.flapCmd) / 2, 0, 1) : clamp(finite(controls.dr), -1, 1);
        if (binding.approximate === 'throttle') {
          if (!binding.restPosition) binding.restPosition = binding.group.position.clone();
          binding.group.position.copy(binding.restPosition).addScaledVector(binding.axis, value * binding.factor - 0.05); continue;
        }
        binding.group.quaternion.setFromAxisAngle(binding.axis, value * binding.factor * D2R); continue;
      }
      const { rule } = binding, detail = rule.details, value = finite(properties[detail.property]);
      if (rule.type === 'spin') {
        const velocity = detail.property.includes('rollspeed') ? value : value * 2 * Math.PI / 60;
        binding.angle = (binding.angle + velocity * seconds) % (2 * Math.PI);
        binding.group.quaternion.setFromAxisAngle(binding.axis, binding.angle);
      } else {
        const amount = interpolate(detail.interpolation?.entry, value) * finite(detail.factor, 1) + finite(detail['offset-deg']);
        if (rule.type === 'rotate') binding.group.quaternion.setFromAxisAngle(binding.axis, amount * D2R);
        else if (rule.type === 'translate') {
          const distance = clamp(amount, finite(detail['min-m'], -Infinity), finite(detail['max-m'], Infinity));
          if (!binding.restPosition) binding.restPosition = binding.group.position.clone();
          binding.group.position.copy(binding.restPosition).addScaledVector(binding.axis, distance);
        }
      }
    }
    if (this.prop) this.prop.visible = rpm < 750;
    if (this.propDisc) this.propDisc.visible = rpm >= 750;
    const powered = rpm > 150 && !fdm.crashed;
    for (const light of this.lights) {
      const landing = light.kind === 'landinglight', taxi = light.kind === 'taxilight', strobe = light.kind === 'strobelight';
      light.object.visible = powered && (landing ? fdm.pos.y - groundY < 300 : taxi ? fdm.onGround : strobe ? this.lightTime % 1.2 < 0.12 : true);
    }
  }
}
