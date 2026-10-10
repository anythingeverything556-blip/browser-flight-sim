import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function merge(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return geometry;
}

function cylinderAlongZ(radius, length, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1, false);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function makeTireGeometry() {
  const profile = [
    [0.54, -0.21], [0.67, -0.25], [0.84, -0.235], [0.96, -0.18],
    [1.0, -0.105], [1.0, 0.105], [0.96, 0.18], [0.84, 0.235],
    [0.67, 0.25], [0.54, 0.21],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(profile, 56);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function makeTireTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#202426'; ctx.fillRect(0, 0, 512, 128);
  const side = ctx.createLinearGradient(0, 0, 0, 128);
  side.addColorStop(0, '#282c2e'); side.addColorStop(0.18, '#1d2123');
  side.addColorStop(0.48, '#303436'); side.addColorStop(0.7, '#1c2022'); side.addColorStop(1, '#272b2d');
  ctx.fillStyle = side; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#121516'; ctx.fillRect(0, 44, 512, 3); ctx.fillRect(0, 81, 512, 3);
  ctx.strokeStyle = '#111415'; ctx.lineWidth = 2;
  for (let x = -28; x < 540; x += 13) {
    ctx.beginPath(); ctx.moveTo(x, 47); ctx.lineTo(x + 9, 63); ctx.lineTo(x + 2, 80); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(92,98,99,0.25)'; ctx.lineWidth = 1;
  for (let x = -28; x < 540; x += 26) {
    ctx.beginPath(); ctx.moveTo(x + 4, 48); ctx.lineTo(x + 13, 63); ctx.lineTo(x + 6, 79); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(175,181,180,0.3)'; ctx.font = 'bold 8px sans-serif';
  for (let x = 12; x < 512; x += 86) ctx.fillText('SR-71  HIGH SPEED', x, 27);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function makeRimGeometry() {
  const parts = [
    new THREE.TorusGeometry(0.5, 0.045, 8, 28),
    new THREE.TorusGeometry(0.29, 0.025, 6, 20),
    cylinderAlongZ(0.17, 0.42, 20),
  ];
  const spokeGeo = new THREE.BoxGeometry(0.052, 0.34, 0.055);
  for (let i = 0; i < 8; i++) {
    const spoke = spokeGeo.clone();
    spoke.translate(0, 0.39, 0);
    spoke.rotateZ(i / 8 * TWO_PI);
    parts.push(spoke);
  }
  spokeGeo.dispose();
  const boltGeo = cylinderAlongZ(0.027, 0.045, 8);
  for (const face of [-1, 1]) for (let i = 0; i < 8; i++) {
    const a = i / 8 * TWO_PI;
    const bolt = boltGeo.clone();
    bolt.translate(Math.cos(a) * 0.25, Math.sin(a) * 0.25, face * 0.19);
    parts.push(bolt);
  }
  boltGeo.dispose();
  return merge(parts);
}

// a short matte white creep mark on each sidewall, as painted on real tyres, so the spin reads without looking like a lamp
function makeMarkerGeometry() {
  const parts = [];
  for (const face of [-1, 1]) {
    const stripe = new THREE.BoxGeometry(0.022, 0.2, 0.012);
    stripe.translate(0, 0.8, face * 0.2535);
    parts.push(stripe);
  }
  return merge(parts);
}

function makeDoorTextureMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1b252b, metalness: 0.22, roughness: 0.38,
    clearcoat: 0.42, clearcoatRoughness: 0.3, side: THREE.DoubleSide,
  });
}

function addRod(parent, geometry, material, a, b, radius) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.sub(start);
  const length = delta.length();
  const rod = new THREE.Mesh(geometry, material);
  rod.position.copy(start).addScaledVector(delta, 0.5);
  rod.quaternion.setFromUnitVectors(AXIS_Y, delta.normalize());
  rod.scale.set(radius, length, radius);
  rod.castShadow = true;
  parent.add(rod);
  return rod;
}

function retainWheelWell(gear) {
  const meshes = [];
  gear.traverse((object) => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const index = materials.findIndex((material) => material?.name === 'SR71_WheelWell');
    if (index < 0) {
      if (mesh === gear) {
        mesh.geometry = new THREE.BufferGeometry();
        mesh.material = new THREE.MeshStandardMaterial({ color: 0x131719, roughness: 0.68, metalness: 0.12 });
      } else mesh.parent?.remove(mesh);
      continue;
    }
    if (materials.length === 1) continue;
    const groups = (geometry.groups || []).filter((group) => materials[group.materialIndex]?.name === 'SR71_WheelWell');
    if (groups.length) {
      const well = geometry.clone();
      well.clearGroups();
      for (const group of groups) well.addGroup(group.start, group.count, 0);
      well.computeBoundingSphere();
      mesh.geometry = well;
      mesh.material = materials[index];
    } else if (mesh === gear) {
      mesh.geometry = new THREE.BufferGeometry();
      mesh.material = materials[index];
    } else mesh.parent?.remove(mesh);
  }
}

function createTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(225,229,229,0.68)');
  gradient.addColorStop(0.22, 'rgba(191,198,199,0.43)');
  gradient.addColorStop(0.58, 'rgba(149,156,158,0.16)');
  gradient.addColorStop(1, 'rgba(110,116,118,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

class GearRig {
  constructor(gear) {
    this.group = gear;
    retainWheelWell(gear);
    this.doors = [];
    this.frames = [];
    this.wheels = [];
    this.puffs = [];
    this.puffCursor = 0;
    this.touching = [false, false, false];
    this.previousOmega = [0, 0, 0];
    this.brakeHeat = 0;
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.buildGeometry();
    this.buildDoors();
    this.buildPuffs();
  }

  buildGeometry() {
    this.rubber = new THREE.MeshStandardMaterial({ map: makeTireTexture(), roughness: 0.86, metalness: 0.01 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x72797b, roughness: 0.29, metalness: 0.82 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xaeb6b8, roughness: 0.2, metalness: 0.9 });
    this.darkSteel = new THREE.MeshStandardMaterial({ color: 0x252c2f, roughness: 0.45, metalness: 0.72 });
    this.brass = new THREE.MeshStandardMaterial({ color: 0x95774a, roughness: 0.34, metalness: 0.72 });
    this.marker = new THREE.MeshStandardMaterial({ color: 0xc9c9c2, roughness: 0.94, metalness: 0 });
    this.caliperMaterial = new THREE.MeshStandardMaterial({ color: 0x743923, roughness: 0.36, metalness: 0.56 });
    this.discMaterial = new THREE.MeshStandardMaterial({ color: 0x50585a, roughness: 0.4, metalness: 0.88, emissive: 0x5d1805, emissiveIntensity: 0 });
    this.doorMaterial = makeDoorTextureMaterial();

    this.outerGeo = new THREE.CylinderGeometry(0.105, 0.13, 1, 12, 1, false);
    this.slideGeo = new THREE.CylinderGeometry(0.055, 0.075, 1, 10, 1, false);
    this.axleGeo = cylinderAlongZ(0.075, 1, 12);
    this.rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
    this.jointGeo = new THREE.SphereGeometry(0.105, 12, 8);
    this.axleCapGeo = new THREE.SphereGeometry(0.075, 10, 8);

    const nose = this.makeFrame('nose', 7.32, 0.02, 0, 0, 0.4, -1.97, Math.PI / 2, 'z');
    const left = this.makeFrame('main-left', -4.90, 0.02, -2.54, 1, 0.52, -1.85, -Math.PI / 2, 'x');
    const right = this.makeFrame('main-right', -4.90, 0.02, 2.54, 2, 0.52, -1.85, Math.PI / 2, 'x');
    this.frames.push(nose, left, right);
    this.buildLamp(nose);

    const tireGeo = makeTireGeometry();
    this.tires = this.makeInstanced(tireGeo, this.rubber, 8);
    this.rims = this.makeInstanced(makeRimGeometry(), this.steel, 8);
    this.markers = this.makeInstanced(makeMarkerGeometry(), this.marker, 8);
    const discGeo = cylinderAlongZ(0.42, 0.19, 24);
    this.discs = this.makeInstanced(discGeo, this.discMaterial, 8);
    const caliperGeo = new THREE.BoxGeometry(0.24, 0.27, 0.16);
    caliperGeo.translate(-0.31, 0.14, 0);
    this.calipers = this.makeInstanced(caliperGeo, this.caliperMaterial, 8);

    this.wheels.length = 0;
    for (const [frame, offsets] of [
      [nose, [-0.115, 0.115]], [left, [-0.28, 0, 0.28]], [right, [-0.28, 0, 0.28]],
    ]) {
      for (let i = 0; i < offsets.length; i++) {
        const offset = offsets[i];
        this.wheels.push({
          frame, offset, radius: frame.radius,
          angle: 0, fdmIndex: frame.fdmIndex,
        });
      }
    }
    for (const mesh of [this.tires, this.rims, this.markers, this.discs, this.calipers]) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.tires, this.rims, this.markers, this.discs, this.calipers);
  }

  makeInstanced(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    return mesh;
  }

  makeFrame(name, x, y, z, fdmIndex, radius, wheelY, up, axis) {
    const pivot = new THREE.Group();
    pivot.name = 'SR71_' + name + '_gearPivot';
    pivot.position.set(x, y, z);
    this.group.add(pivot);
    const frame = { name, pivot, fdmIndex, radius, wheelY, up, axis, isNose: fdmIndex === 0 };

    const outer = new THREE.Mesh(this.outerGeo, this.darkSteel);
    outer.position.y = -0.58; outer.scale.y = 1.18; outer.castShadow = true;
    pivot.add(outer);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.018, 6, 16), this.chrome);
    collar.rotation.x = Math.PI / 2; collar.position.y = -1.08;
    pivot.add(collar);
    const slide = new THREE.Mesh(this.slideGeo, this.chrome);
    slide.position.y = -1.42; slide.scale.y = 0.78; slide.castShadow = true;
    pivot.add(slide); frame.slide = slide;
    const topJoint = new THREE.Mesh(this.jointGeo, this.steel);
    topJoint.position.y = -0.02; pivot.add(topJoint);

    const axleGroup = new THREE.Group();
    axleGroup.position.y = wheelY;
    pivot.add(axleGroup); frame.axleGroup = axleGroup;
    const axle = new THREE.Mesh(this.axleGeo, this.chrome);
    axle.scale.z = frame.isNose ? 0.5 : 0.8; axle.castShadow = true;
    axleGroup.add(axle);
    const axleJoint = new THREE.Mesh(this.axleCapGeo, this.steel);
    axleJoint.position.y = 0.02; axleGroup.add(axleJoint);
    addRod(axleGroup, this.rodGeo, this.steel, [-0.08, 0.34, -0.11], [0.12, 0.03, 0.08], 0.022);
    addRod(axleGroup, this.rodGeo, this.chrome, [-0.08, 0.34, 0.11], [0.12, 0.03, -0.08], 0.022);
    const scissorPin = new THREE.Mesh(this.axleCapGeo, this.brass);
    scissorPin.position.set(0.02, 0.18, 0); axleGroup.add(scissorPin);
    frame.fork = axleGroup;

    addRod(pivot, this.rodGeo, this.brass, [0.18, -0.14, 0], [-0.22, -0.82, 0], 0.038);
    addRod(pivot, this.rodGeo, this.chrome, [-0.22, -0.82, 0], [-0.08, -1.14, 0], 0.023);
    addRod(pivot, this.rodGeo, this.chrome, [-0.14, -0.92, -0.1], [0.14, -1.46, 0.1], 0.021);
    addRod(pivot, this.rodGeo, this.chrome, [-0.14, -0.92, 0.1], [0.14, -1.46, -0.1], 0.021);

    const hoseGeometry = new THREE.BufferGeometry();
    hoseGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0.13, -0.24, 0.12, 0.2, -0.42, 0.14, 0.12, -0.73, 0.15,
      -0.01, -0.94, 0.15, 0.02, -1.2, 0.11,
    ], 3));
    const hose = new THREE.Line(hoseGeometry, new THREE.LineBasicMaterial({ color: 0x9b784b, transparent: true, opacity: 0.9 }));
    pivot.add(hose);
    return frame;
  }

  // landing/taxi lamp bolted to the front of the nose strut: bezel, lens, a halo and a faint beam, lit only when it matters
  buildLamp(nose) {
    const lamp = new THREE.Group();
    lamp.position.set(0.2, -0.92, 0);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.088, 0.08, 20), this.darkSteel);
    bezel.rotation.z = -Math.PI / 2;
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x2a2f33, toneMapped: false });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.063, 20), lensMat);
    lens.rotation.y = Math.PI / 2; lens.position.x = 0.0415;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,248,232,1)'); gr.addColorStop(0.25, 'rgba(255,236,200,0.55)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    halo.scale.setScalar(0.62); halo.position.x = 0.07; halo.visible = false;
    const L = 38, R = 5.2, segs = 24, pos = [], col = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(0, 0.04 * ca, 0.04 * sa, L, R * ca, R * sa);
      col.push(1, 0.95, 0.82, 0.9, 1, 0.95, 0.82, 0);
      if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    bg.setIndex(idx);
    const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.rotation.z = -0.07; beam.visible = false; beam.frustumCulled = false;
    lamp.add(bezel, lens, halo, beam);
    nose.pivot.add(lamp);
    this.lamp = { lens, halo, beam };
  }

  // on: gear down and slow; night 0..1. Dull glass by day, a lit lens with halo and beam in the dark
  setLamp(on, night) {
    const l = this.lamp; if (!l) return;
    const k = on ? night : 0;
    l.lens.material.color.setScalar(on ? 0.16 + 1.3 * k : 0.16);
    l.halo.visible = k > 0.2; l.halo.material.opacity = Math.min(1, k * 1.2);
    l.beam.visible = k > 0.2; l.beam.material.opacity = 0.2 * k;
  }

  buildDoors() {
    const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const hingeGeometry = cylinderAlongZ(0.045, 0.42, 10);
    const addDoor = (name, position, side, length, width, opening) => {
      const pivot = new THREE.Group();
      pivot.name = 'SR71_' + name + '_doorHinge';
      pivot.position.set(position[0], position[1], position[2]);
      const panel = new THREE.Mesh(panelGeometry, this.doorMaterial);
      panel.scale.set(length, 0.036, width);
      panel.position.set(0, -0.018, side * width * 0.5);
      panel.castShadow = true; panel.receiveShadow = true;
      pivot.add(panel);
      const hinge = new THREE.Mesh(hingeGeometry, this.darkSteel);
      hinge.rotation.y = Math.PI / 2;
      hinge.position.set(-length * 0.24, 0.035, 0);
      pivot.add(hinge);
      this.group.add(pivot);
      this.doors.push({ pivot, side, opening });
    };
    for (const side of [-1, 1]) {
      for (const longitudinal of [-0.82, 0.82]) {
        addDoor('main_' + side + '_' + longitudinal, [-4.9 + longitudinal, -0.065, side * 1.32], side, 0.46, 1.2, -side * 1.18);
      }
      for (const longitudinal of [-0.59, 0.59]) {
        addDoor('nose_' + side + '_' + longitudinal, [7.32 + longitudinal, -0.07, side * 0.17], side, 0.32, 0.3, -side * 1.35);
      }
    }
  }

  buildPuffs() {
    const texture = createTexture();
    this.puffs.length = 12;
    for (let i = 0; i < this.puffs.length; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture, color: i % 3 === 1 ? 0x82766a : 0xd0d3d2,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false; sprite.renderOrder = 5;
      this.group.add(sprite);
      this.puffs[i] = { sprite, material, age: 0, life: 1, alpha: 0, size: 1, vx: 0, vy: 0, vz: 0 };
    }
  }

  spawnPuff(index, intensity, speed = 0) {
    const frame = this.frames[index];
    if (!frame) return;
    this._p.copy(frame.pivot.position);
    this._p2.set(0, frame.wheelY - frame.radius + 0.045, 0).applyQuaternion(frame.pivot.quaternion);
    this._p.add(this._p2);
    const count = 1 + Math.floor(intensity * 2);
    for (let n = 0; n < count; n++) {
      const puff = this.puffs[this.puffCursor++ % this.puffs.length];
      const offset = (n - (count - 1) * 0.5) * 0.12;
      puff.age = 0; puff.life = 0.9 + intensity * 0.7;
      puff.alpha = 0.3 + intensity * 0.4; puff.size = 1.3 + intensity * 1.5;
      // the smoke is left behind by a fast roll rather than riding along with the wheel
      puff.vx = -0.28 - intensity * 0.45 - Math.min(speed, 90) * 0.3; puff.vy = 0.28 + intensity * 0.52;
      puff.vz = ((this.puffCursor + n) % 2 ? 1 : -1) * (0.1 + intensity * 0.16);
      puff.sprite.position.set(this._p.x + offset, this._p.y, this._p.z + offset * 0.7);
      puff.sprite.scale.set(puff.size, puff.size, 1);
      puff.material.opacity = puff.alpha;
      puff.sprite.visible = true;
    }
  }

  update(dt, fdm) {
    const g = clamp(fdm.gearPos ?? 1, 0, 1);
    const doorOpen = smooth(0.06, 0.23, g) * (1 - smooth(0.8, 0.96, g));
    const legDown = smooth(0.21, 0.83, g);
    const settle = 0.052 * Math.exp(-Math.pow((g - 0.855) / 0.052, 2));
    this.group.visible = g > 0.025;
    // doors swing open before the legs move and shut after them, in both directions: tell the sound engine
    const open = doorOpen > 0.5 ? 1 : doorOpen < 0.04 ? 0 : this._doorOpen;
    if (this._doorOpen !== undefined && open !== this._doorOpen && this.onDoor) this.onDoor(open ? 'open' : 'shut');
    this._doorOpen = open;

    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];
      const overshoot = Math.sign(frame.up) * settle;
      frame.pivot.rotation.set(0, 0, 0);
      frame.pivot.rotation[frame.axis] = (1 - legDown) * frame.up - overshoot;
      const compression = clamp(fdm.compress?.[i] || 0, 0, 0.4);
      frame.axleGroup.position.y = frame.wheelY + compression * 0.72;
      frame.slide.position.y = -1.42 + compression * 0.62;
      if (frame.isNose) {
        const speed = fdm.vel ? Math.hypot(fdm.vel.x, fdm.vel.z) : 0;
        const steer = clamp(fdm.ctrl?.dr || 0, -1, 1) * 0.34 * (1 - smooth(12, 36, speed));
        frame.axleGroup.rotation.y = steer;
      }
    }
    for (const door of this.doors) {
      door.pivot.rotation.set(0, 0, 0);
      door.pivot.rotation.x = door.opening * doorOpen;
    }

    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i], frame = wheel.frame;
      const omega = fdm.wheel?.[wheel.fdmIndex] || 0;
      wheel.angle = (wheel.angle - omega * dt) % TWO_PI;
      const qPivot = frame.pivot.quaternion;
      this._q.copy(qPivot);
      if (frame.isNose) this._q.multiply(frame.axleGroup.quaternion);
      this._p.copy(frame.pivot.position);
      this._p2.set(0, frame.wheelY + clamp(fdm.compress?.[wheel.fdmIndex] || 0, 0, 0.4) * 0.72, 0).applyQuaternion(qPivot);
      this._p.add(this._p2);
      this._p2.set(0, 0, wheel.offset).applyQuaternion(this._q);
      this._p.add(this._p2);
      this._q2.setFromAxisAngle(AXIS_Z, wheel.angle);
      this._q3.copy(this._q).multiply(this._q2);
      this._s.setScalar(wheel.radius);
      this._m.compose(this._p, this._q3, this._s);
      this.tires.setMatrixAt(i, this._m);
      this.rims.setMatrixAt(i, this._m);
      this.markers.setMatrixAt(i, this._m);
      this.discs.setMatrixAt(i, this._m);
      this._m.compose(this._p, this._q, this._s);
      this.calipers.setMatrixAt(i, this._m);
    }
    this.tires.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
    this.markers.instanceMatrix.needsUpdate = true;
    this.discs.instanceMatrix.needsUpdate = true;
    this.calipers.instanceMatrix.needsUpdate = true;

    let brake = 0;
    for (let i = 1; i <= 2; i++) brake = Math.max(brake, fdm.brakePress?.[i] || 0, fdm.brakes || 0);
    this.brakeHeat = clamp(this.brakeHeat + dt * (brake * 0.92 - this.brakeHeat * 0.11), 0, 1);
    this.discMaterial.emissiveIntensity = this.brakeHeat * this.brakeHeat * 2.2;
    this.discMaterial.color.setRGB(0.25 + this.brakeHeat * 0.3, 0.28 - this.brakeHeat * 0.12, 0.3 - this.brakeHeat * 0.18);

    for (let i = 0; i < 3; i++) {
      const omega = fdm.wheel?.[i] || 0;
      const contact = (fdm.contacts?.[i] || 0) > 600 && g > 0.94;
      if (contact && !this.touching[i]) {
        const sink = Math.max(0, -(fdm.vel?.y || 0));
        const spinUp = Math.abs(omega - this.previousOmega[i]) / Math.max(dt, 0.02);
        const intensity = clamp(0.12 + clamp(sink / 6, 0, 1) * 0.5 + clamp(spinUp / 180, 0, 1) * 0.42, 0.12, 1);
        this.spawnPuff(i, intensity, fdm.vel?.length?.() || 0);
      }
      this.touching[i] = contact;
      this.previousOmega[i] = omega;
    }
    for (const puff of this.puffs) {
      if (!puff.sprite.visible) continue;
      puff.age += dt;
      if (puff.age >= puff.life) { puff.sprite.visible = false; continue; }
      const fade = 1 - puff.age / puff.life;
      puff.sprite.position.x += puff.vx * dt;
      puff.sprite.position.y += puff.vy * dt;
      puff.sprite.position.z += puff.vz * dt;
      puff.material.opacity = puff.alpha * fade * fade;
      const size = puff.size * (0.8 + (1 - fade) * 0.8);
      puff.sprite.scale.set(size, size, 1);
    }
  }
}

export function createGearRig(gear) {
  return gear ? new GearRig(gear) : null;
}
