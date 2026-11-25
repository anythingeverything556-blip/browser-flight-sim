import * as THREE from 'three';
import { whenIdle } from './warmup.js';
import { DEPTH_GLSL } from './depth.js';

// Crash physics: instead of freezing on impact, the airframe becomes one or more free rigid bodies (it breaks up on a hard
// impact or an in-flight overstress, slides in one piece after a gear-up or collapsed-gear landing) that tumble, bounce
// and slide on the terrain with Coulomb friction, plus a fuel fireball, burning wreckage, a smoke column and sparks.
// Coordinates are the flight model's world frame (x east, y up, z south, metres); everything is drawn camera-relative.
const G = 9.81;
// what "a lot of fuel" and "fast" mean for each aircraft; main.js passes the Skyhawk's
const MAX_SPIN = 25; // rad/s, about 4 turns a second: a hard tumble for a wreck piece
export const SR71_SCALE = { fuelCap: 36300, speedRef: 280, sinkRef: 58, size: 1 };

// ---------- particles: one instanced billboard mesh per blend mode ----------
// Billboards are shaped by per-particle rotated fractal noise, so fire licks and smoke billows instead of fading as round
// dots; smoke is shaded by the sun (dark underside, lit top) so a column reads as a volume.
const PVERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iPos; attribute vec4 iCol; attribute float iSize; attribute vec2 iMisc;
uniform vec3 uSunW;
varying vec4 vCol; varying vec2 vQ; varying vec2 vP; varying vec2 vMisc; varying vec3 vSunV; varying float vW; varying float vSize;
void main() {
  vCol = iCol; vSize = iSize; vMisc = iMisc; vP = position.xy * 2.0;
  float c = cos(iMisc.x), s = sin(iMisc.x);
  vQ = vec2(c * vP.x - s * vP.y, s * vP.x + c * vP.y);
  vSunV = mat3(viewMatrix) * uSunW;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vW = -mv.z;
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  if (iCol.a <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PFRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uBillow, uSoft; uniform vec2 uRes; uniform highp sampler2D tDepth;
${DEPTH_GLSL}
varying vec4 vCol; varying vec2 vQ; varying vec2 vP; varying vec2 vMisc; varying vec3 vSunV; varying float vW; varying float vSize;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * vn(p) + 0.3 * vn(p * 2.1 + 7.3) + 0.2 * vn(p * 4.3 + 3.1); }
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vP);
  if (d > 1.0) discard;
  float n = fbm(vQ * 1.6 + vMisc.y * 37.0);
  float edge = 1.0 - smoothstep(0.3, 1.0, d + (n - 0.45) * uBillow);
  if (edge <= 0.004) discard;
  // drawn after the cloud composite, so occlusion by terrain and buildings is tested here against the scene depth
  float vis = 1.0;
  if (uSoft > 0.5) {
    float sceneW = depthW(textureLod(tDepth, gl_FragCoord.xy / uRes, 0.0).r);
    vis = clamp((sceneW - vW) / max(1.0, vSize * 0.35), 0.0, 1.0);
    if (vis <= 0.0) discard;
  }
  #ifdef ADDITIVE
  float core = 1.0 - smoothstep(0.0, 0.85, d);
  float a = vCol.a * vis * edge * (0.45 + 1.0 * n) * (0.3 + 0.7 * core);
  gl_FragColor = vec4(vCol.rgb * a, a);
  #else
  vec3 N = normalize(vec3(vP * 0.85, sqrt(max(0.06, 1.0 - d * d))));
  float lit = clamp(dot(N, normalize(vSunV)) * 0.5 + 0.5, 0.0, 1.0);
  float shade = mix(0.5, 1.35, lit) * (0.78 + 0.44 * n);
  float a = vCol.a * vis * edge * (0.55 + 0.7 * n);
  gl_FragColor = vec4(vCol.rgb * shade, min(a, 1.0));
  #endif
}`;
const SUN_W = new THREE.Vector3(0.4, 0.8, 0.3).normalize();

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float64Array(max * 3); this.v = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.tint = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.kind = new Uint8Array(max);
    this.rot = new Float32Array(max); this.spin = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSize', this.aSize); g.setAttribute('iMisc', this.aMisc);
    g.instanceCount = 0;
    this.uniforms = { uBillow: { value: 1.0 }, uSunW: { value: SUN_W.clone() }, uSoft: { value: 0 }, uDepthK: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) }, tDepth: { value: null } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PVERT, fragmentShader: PFRAG,
      defines: additive ? { ADDITIVE: '' } : {}, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 7 : 8;
    scene.add(this.mesh);
  }
  // soft: drawn by the post pass after the clouds, with a depth test done in the shader
  attach(scene, soft) {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    scene.add(this.mesh); this.uniforms.uSoft.value = soft ? 1 : 0;
  }
  // kind: 0 fire, 1 soot/smoke, 2 sparks, 3 dust, 4 flash, 5 fireball flame, 6 fire-lit soot rolling out of a fireball
  // delay: seconds before the particle appears (it waits invisible and still), so a burst can stage its own smoke
  emit(x, y, z, vx, vy, vz, life, s0, s1, kind, delay = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = -delay; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.kind[i] = kind; this.tint[i] = Math.random();
    this.rot[i] = Math.random() * 6.2832; this.spin[i] = (Math.random() - 0.5) * (kind === 1 ? 0.7 : 1.8);
  }
  update(dt, camWorld, wind, day, sunDir) {
    if (sunDir) this.uniforms.uSunW.value.copy(sunDir);
    let n = 0;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, M = this.aMisc.array;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact live particles to the front
      const k = this.kind[i], j = n++;
      if (j !== i) {
        for (let c = 0; c < 3; c++) { this.p[j * 3 + c] = this.p[i * 3 + c]; this.v[j * 3 + c] = this.v[i * 3 + c]; }
        this.life[j] = this.life[i]; this.s0[j] = this.s0[i]; this.s1[j] = this.s1[i]; this.kind[j] = k; this.tint[j] = this.tint[i];
        this.rot[j] = this.rot[i]; this.spin[j] = this.spin[i];
      }
      this.age[j] = age;
      if (age < 0) { C[j * 4 + 3] = 0; P[j * 3] = P[j * 3 + 1] = P[j * 3 + 2] = 0; continue; } // waiting for its delayed start
      this.rot[j] += this.spin[j] * dt;
      const t = age / this.life[j], v = this.v;
      if (k === 1 || k === 6) {
        // smoke plume: hot gas is buoyant at first and cools as it entrains air, so the rise slows to a gentle drift;
        // near the ground the fire's own inflow shelters it from the wind, higher up it bends over and is carried off
        const lift = 0.55 + (k === 6 ? 5.5 : 3.4) * Math.exp(-age / (k === 6 ? 3 : 5.5));
        const shear = 0.45 + 0.85 * Math.min(1, age / 14), pull = dt * (0.22 + 0.25 * Math.min(1, age / 6));
        const swirl = Math.sin(age * 0.8 + this.tint[j] * 31) * 0.9 * dt; // slow eddies so the column billows instead of streaming
        v[j * 3] += (wind.x * shear - v[j * 3]) * pull + swirl; v[j * 3 + 2] += (wind.z * shear - v[j * 3 + 2]) * pull - swirl;
        v[j * 3 + 1] = v[j * 3 + 1] * Math.exp(-dt * 0.32) + lift * dt;
      } else if (k === 5) { // fireball: blasts out, air drag stops the shell within a second, then the hot ball rolls upward
        const dr = Math.exp(-dt * 2.4);
        v[j * 3] = v[j * 3] * dr + wind.x * 0.4 * (1 - dr); v[j * 3 + 2] = v[j * 3 + 2] * dr + wind.z * 0.4 * (1 - dr);
        v[j * 3 + 1] = v[j * 3 + 1] * Math.exp(-dt * 1.6) + (4 + 14 * Math.min(1, age / 0.8)) * dt;
      } else if (k === 2) { v[j * 3 + 1] -= G * dt; } // sparks fall
      else if (k === 3) { v[j * 3] *= Math.exp(-dt * 0.65); v[j * 3 + 1] = v[j * 3 + 1] * Math.exp(-dt * 0.25) - 2.4 * dt; v[j * 3 + 2] *= Math.exp(-dt * 0.65); }
      else if (k === 4) { /* flash: stays put */ }
      else { // fire: buoyant, leaning downwind
        const dr = Math.exp(-dt * 1.3);
        v[j * 3] = v[j * 3] * dr + wind.x * 0.35 * (1 - dr); v[j * 3 + 1] = v[j * 3 + 1] * dr + 7 * dt; v[j * 3 + 2] = v[j * 3 + 2] * dr + wind.z * 0.35 * (1 - dr);
      }
      for (let c = 0; c < 3; c++) this.p[j * 3 + c] += v[j * 3 + c] * dt;
      P[j * 3] = this.p[j * 3] - camWorld.x; P[j * 3 + 1] = this.p[j * 3 + 1] - camWorld.y; P[j * 3 + 2] = this.p[j * 3 + 2] - camWorld.z;
      S[j] = this.s0[j] + (this.s1[j] - this.s0[j]) * Math.sqrt(t);
      M[j * 2] = this.rot[j]; M[j * 2 + 1] = this.tint[j];
      const o = j * 4, r = this.tint[j];
      if (k === 0) { // white-yellow core -> orange -> deep red -> gone, each particle a slightly different flame
        const h = 1 - t, e = 0.95 + 1.0 * h * h;
        C[o] = e; C[o + 1] = e * (0.16 + 0.5 * h * h + 0.1 * r); C[o + 2] = e * (0.02 + 0.22 * h * h * h * h); C[o + 3] = Math.min(1, t * 8) * Math.pow(h, 1.2) * (0.34 + 0.26 * r);
      } else if (k === 5) { // white-hot core, a long orange plateau, then a dull red roll that fades into the soot around it
        const h = 1 - t, e = 1.15 + 1.9 * h * h * h;
        C[o] = e; C[o + 1] = e * (0.17 + 0.58 * h * h + 0.08 * r); C[o + 2] = e * (0.025 + 0.32 * Math.pow(h, 6));
        C[o + 3] = Math.min(1, t * 14) * (t < 0.5 ? 1 : Math.pow((1 - t) / 0.5, 1.5)) * (0.42 + 0.24 * r);
      } else if (k === 6) { // soot lit orange from inside by the fireball, going black, then grey and thin as it climbs
        const glow = Math.max(0, 1 - t * 9), g = (0.03 + 0.12 * t * t + 0.03 * r) * (0.35 + 0.65 * day);
        C[o] = g + 0.95 * glow; C[o + 1] = g * 0.9 + 0.36 * glow; C[o + 2] = g * 0.78 + 0.06 * glow; C[o + 3] = Math.min(1, t * 6) * Math.pow(1 - t, 0.7) * 0.95;
      } else if (k === 1) {
        // soot black near the fire, greying and thinning as it rises; a warm brown tinge low down
        const warm = Math.max(0, 1 - t * 3), g = (0.035 + 0.14 * t * t + 0.03 * r) * (0.35 + 0.65 * day);
        C[o] = g * (1 + 0.5 * warm); C[o + 1] = g * (0.9 + 0.1 * warm); C[o + 2] = g * 0.78; C[o + 3] = Math.min(1, t * 4) * Math.pow(1 - t, 0.8) * 0.9;
      } else if (k === 3) { const d = 0.3 + 0.2 * r; C[o] = d * 1.16; C[o + 1] = d * 0.88; C[o + 2] = d * 0.58; C[o + 3] = Math.min(0.8, (1 - t) * 0.8); }
      else if (k === 4) { const h = 1 - t; C[o] = 6 * h; C[o + 1] = 5 * h; C[o + 2] = 3.2 * h; C[o + 3] = h * h; }
      else { C[o] = 3; C[o + 1] = 1.8; C[o + 2] = 0.6; C[o + 3] = 1 - t; }
    }
    this.n = n;
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aMisc.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 3);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, n * 4);
    this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, n);
    this.aMisc.clearUpdateRanges(); this.aMisc.addUpdateRange(0, n * 2);
  }
  clear() { this.n = 0; this.mesh.geometry.instanceCount = 0; }
}

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _box = new THREE.Box3(), _m = new THREE.Matrix4(), _normalMat = new THREE.Matrix3();
const _force = new THREE.Vector3(), _torque = new THREE.Vector3(), _torqueBody = new THREE.Vector3();
const _arm = new THREE.Vector3(), _vp = new THREE.Vector3(), _friction = new THREE.Vector3();
const _normal = new THREE.Vector3(), _worldW = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _center = new THREE.Vector3(), _worldCenter = new THREE.Vector3(), _offset = new THREE.Vector3(), _sep = new THREE.Vector3();
const _bodyX = new THREE.Vector3(), _bodyY = new THREE.Vector3(), _bodyZ = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _forward = new THREE.Vector3(1, 0, 0), _right = new THREE.Vector3(0, 0, 1);
const _zAxis = new THREE.Vector3(0, 0, 1), _scale = new THREE.Vector3(), _euler = new THREE.Euler();
const _color = new THREE.Color();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function within(obj, ancestor) {
  for (let p = obj; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function meshRootName(mesh, model) {
  for (let p = mesh; p && p !== model; p = p.parent) if (p.name && p.name.indexOf('SR71_') === 0) return p.name;
  return '';
}

function worldBoxInRoot(mesh, rootInverse) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const rel = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
  return _box.copy(g.boundingBox).applyMatrix4(rel);
}

// model bounds in root space from each mesh's own box. Box3.setFromObject boxed the model in world axes, so the breakup zones, and with them the
// index runs warmPieces() draws ahead of time, changed with the jet's attitude at impact (identical when the jet is level and heading along x)
function modelBoundsInRoot(model, rootInverse) {
  const out = new THREE.Box3();
  model.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) out.union(worldBoxInRoot(o, rootInverse)); });
  return out;
}

function readComponent(attr, index, component) {
  if (component === 0) return attr.getX(index);
  if (component === 1) return attr.getY(index);
  if (component === 2) return attr.getZ(index);
  if (component === 3) return attr.getW(index);
  return 0;
}

function recordFor(records, key) {
  let rec = records.get(key);
  if (!rec) {
    rec = { key, box: new THREE.Box3().makeEmpty(), parts: [], weight: 0 };
    records.set(key, rec);
  }
  return rec;
}

function longitudinalKey(x, bounds, segments) {
  if (segments <= 1) return 'body';
  const span = Math.max(0.1, bounds.max.x - bounds.min.x);
  const t = clamp((x - bounds.min.x) / span, 0, 0.99999);
  return 'fuse-' + Math.min(segments - 1, Math.floor(t * segments));
}

function surfaceKey(x, z, name, bounds, plan) {
  const wing = /^SR71_Wing_([LR])/.exec(name);
  if (wing && plan.wingSections > 1) {
    const span = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z), 1);
    const zone = Math.min(plan.wingSections - 1, Math.floor(clamp(Math.abs(z) / span, 0, 0.999) * plan.wingSections));
    return 'wing-' + wing[1] + '-' + zone;
  }
  const nacelle = /^SR71_(Nacelle|Spike|Ejector)_([LR])/.exec(name);
  if (nacelle) return 'engine-' + nacelle[2];
  const fin = /^SR71_(Fin|TailNo)_([LR])/.exec(name);
  if (fin && plan.separateTail) return 'tail-' + fin[2];
  return longitudinalKey(x, bounds, plan.fuselageSegments);
}

function addSplitMesh(mesh, name, rootInverse, modelBounds, plan, records, createdGeometries, noCache = false) {
  const g = mesh.geometry, pos = g.attributes.position;
  if (!pos) return 'none';
  const rel = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
  const cached = noCache ? null : splitReady(mesh, rel);
  if (cached) { addCachedSplit(cached, mesh, name, modelBounds, plan, records); return 'cached'; }
  _normalMat.getNormalMatrix(rel);
  const attrs = Object.entries(g.attributes);
  const indices = g.index ? g.index.array : null;
  const drawStart = g.drawRange.start || 0;
  const end = Math.min(indices ? indices.length : pos.count, Number.isFinite(g.drawRange.count) ? drawStart + g.drawRange.count : (indices ? indices.length : pos.count));
  const groups = g.groups.length ? g.groups : [{ start: 0, count: end, materialIndex: 0 }];
  const bins = new Map();
  for (const group of groups) {
    const start = Math.max(drawStart, group.start);
    const stop = Math.min(end, group.start + group.count);
    for (let t = start; t + 2 < stop; t += 3) {
      const i0 = indices ? indices[t] : t, i1 = indices ? indices[t + 1] : t + 1, i2 = indices ? indices[t + 2] : t + 2;
      _p0.fromBufferAttribute(pos, i0).applyMatrix4(rel);
      _p1.fromBufferAttribute(pos, i1).applyMatrix4(rel);
      _p2.fromBufferAttribute(pos, i2).applyMatrix4(rel);
      const cx = (_p0.x + _p1.x + _p2.x) / 3, cz = (_p0.z + _p1.z + _p2.z) / 3;
      const key = surfaceKey(cx, cz, name, modelBounds, plan);
      let mats = bins.get(key);
      if (!mats) { mats = new Map(); bins.set(key, mats); }
      const mi = Array.isArray(mesh.material) ? group.materialIndex : 0;
      let data = mats.get(mi);
      if (!data) { data = Object.create(null); for (const [n] of attrs) data[n] = []; mats.set(mi, data); }
      const ids = [i0, i1, i2];
      for (let v = 0; v < 3; v++) {
        const id = ids[v];
        for (const [attrName, attr] of attrs) {
          const out = data[attrName];
          if (attrName === 'position') {
            const p = v === 0 ? _p0 : v === 1 ? _p1 : _p2;
            out.push(p.x, p.y, p.z);
          } else if (attrName === 'normal') {
            _v.set(readComponent(attr, id, 0), readComponent(attr, id, 1), readComponent(attr, id, 2));
            _v.applyMatrix3(_normalMat).normalize();
            out.push(_v.x, _v.y, _v.z);
          } else {
            for (let c = 0; c < attr.itemSize; c++) out.push(readComponent(attr, id, c));
          }
        }
      }
      const rec = recordFor(records, key);
      rec.box.expandByPoint(_p0); rec.box.expandByPoint(_p1); rec.box.expandByPoint(_p2);
    }
  }
  for (const [key, mats] of bins) {
    const rec = recordFor(records, key), frag = new THREE.BufferGeometry();
    let vertexOffset = 0;
    for (const [mi, data] of mats) {
      const count = data.position.length / 3;
      for (const [attrName, values] of Object.entries(data)) {
        const template = g.attributes[attrName], oldAttr = frag.getAttribute(attrName);
        const old = oldAttr ? oldAttr.array : new Float32Array(0), merged = new Float32Array(old.length + values.length);
        merged.set(old); merged.set(values, old.length);
        frag.setAttribute(attrName, new THREE.BufferAttribute(merged, template.itemSize, template.normalized));
      }
      frag.addGroup(vertexOffset, count, mi); vertexOffset += count;
    }
    if (frag.attributes.position) { frag.computeBoundingBox(); frag.computeBoundingSphere(); }
    createdGeometries.push(frag);
    rec.parts.push({ geometry: frag, material: mesh.material, matrix: null, split: true });
  }
  return 'split';
}

// why a split mesh would miss the precomputed cache (for wreck.startStats; '' = it would hit)
function splitMissReason(mesh, rel) {
  const c = splitCache.get(mesh.geometry), g = mesh.geometry;
  if (!c) return 'not prepared';
  if (g.groups.length) return 'groups';
  if (Array.isArray(mesh.material)) return 'material array';
  if (Object.keys(g.attributes).length !== 2 || !g.attributes.normal) return 'attributes ' + Object.keys(g.attributes).join(',');
  let worst = 0; for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(c.rel.elements[i] - rel.elements[i]));
  const t = (m) => [12, 13, 14].map((i) => +m.elements[i].toFixed(3)).join(',');
  return splitReady(mesh, rel) ? '' : 'matrix moved ' + worst.toExponential(1) + ' (prepared t ' + t(c.rel) + ', now ' + t(rel) + ', prepared sx ' + c.rel.elements[0].toFixed(4) + ', now ' + rel.elements[0].toFixed(4) + ')';
}

// The fuselage and wing breakup splits ~250k triangles by where they sit, which took ~1.9 s on the main thread at the moment of impact. The geometry never changes,
// so it is turned into a triangle soup in root space (positions and normals, three vertices per triangle) sorted by the coordinate the bins are cut on: a bin is then one
// contiguous run and impact is a binary search plus a copy. Built in small time slices while the browser is idle (see Wreck.prepare); a mesh that is not ready yet is split
// the old way.
const splitCache = new WeakMap();
const splitAxis = (name) => (/^SR71_Wing_[LR]/.test(name) ? 'wing' : /^SR71_Fuselage/.test(name) ? 'fuse' : null);
const sortable = (keys) => {
  const n = keys.length, bits = new Uint32Array(keys.buffer, keys.byteOffset, n * 2);
  let order = new Uint32Array(n), tmp = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = 0; i < n; i++) { const hi = bits[2 * i + 1], neg = hi >>> 31; if (neg) { bits[2 * i] = ~bits[2 * i] >>> 0; bits[2 * i + 1] = ~hi >>> 0; } else bits[2 * i + 1] = (hi ^ 0x80000000) >>> 0; }
  return { bits, order, tmp, restore() { for (let i = 0; i < n; i++) { const hi = bits[2 * i + 1]; if (hi >>> 31) bits[2 * i + 1] = (hi ^ 0x80000000) >>> 0; else { bits[2 * i] = ~bits[2 * i] >>> 0; bits[2 * i + 1] = ~hi >>> 0; } } } };
};
function* radixPass(st, word, shift) {
  const { bits, order, tmp } = st, n = order.length, count = new Uint32Array(65537);
  for (let i = 0; i < n; i++) count[((bits[2 * order[i] + word] >>> shift) & 0xffff) + 1]++;
  for (let i = 0; i < 65536; i++) count[i + 1] += count[i];
  for (let i = 0; i < n; i++) { const o = order[i]; tmp[count[(bits[2 * o + word] >>> shift) & 0xffff]++] = o; }
  st.order = tmp; st.tmp = order;
  yield;
}

// mesh-to-root matrix from the local matrices in between. It does not depend on when the world matrices were last brought up to date: prepare()
// builds the caches in idle slices over several frames while the render loop moves and turns the root, and an inverse root world matrix taken
// when prepare() was called against a mesh world matrix read frames later gave every cache a wrong matrix, so in a browser every impact split
// ~250k triangles again (1.2-2.0 s of wreck.start). Node never moved the root between the slices, so its tests hit the cache.
function relToRoot(mesh, root, out) {
  out.identity();
  for (let o = mesh; o !== root; o = o.parent) {
    if (!o) return null;
    if (o.matrixAutoUpdate) o.updateMatrix();
    out.premultiply(o.matrix);
  }
  return out;
}

function* buildSplitCache(mesh, root, axis) {
  const g = mesh.geometry, pos = g.attributes.position;
  const rel = relToRoot(mesh, root, new THREE.Matrix4());
  if (!rel) return null;
  const me = rel.elements;
  const indices = g.index ? g.index.array : null, drawStart = g.drawRange.start || 0;
  const end = Math.min(indices ? indices.length : pos.count, Number.isFinite(g.drawRange.count) ? drawStart + g.drawRange.count : (indices ? indices.length : pos.count));
  const nv = pos.count, wp = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), w = 1 / (me[3] * x + me[7] * y + me[11] * z + me[15]);
    wp[3 * i] = (me[0] * x + me[4] * y + me[8] * z + me[12]) * w; wp[3 * i + 1] = (me[1] * x + me[5] * y + me[9] * z + me[13]) * w; wp[3 * i + 2] = (me[2] * x + me[6] * y + me[10] * z + me[14]) * w;
    if ((i & 0x7fff) === 0x7fff) yield;
  }
  const T = Math.max(0, Math.floor((end - drawStart) / 3)), tri = new Uint32Array(T * 3), keys = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const a = drawStart + t * 3, i0 = indices ? indices[a] : a, i1 = indices ? indices[a + 1] : a + 1, i2 = indices ? indices[a + 2] : a + 2;
    tri[3 * t] = i0; tri[3 * t + 1] = i1; tri[3 * t + 2] = i2;
    keys[t] = axis === 'wing' ? (wp[3 * i0 + 2] + wp[3 * i1 + 2] + wp[3 * i2 + 2]) / 3 : (wp[3 * i0] + wp[3 * i1] + wp[3 * i2]) / 3;
    if ((t & 0x3fff) === 0x3fff) yield;
  }
  if (axis === 'wing') for (let t = 0; t < T; t++) keys[t] = Math.abs(keys[t]);
  const st = sortable(keys);
  yield; yield* radixPass(st, 0, 0); yield* radixPass(st, 0, 16); yield* radixPass(st, 1, 0); yield* radixPass(st, 1, 16);
  st.restore();
  // the pieces draw runs of this sorted index over the mesh's own position and normal buffers, which the GPU already holds for the intact jet:
  // nothing is copied at impact and the only upload is this index (~3 MB, once; it is kept for the next crash)
  const order = st.order, sortedKeys = new Float64Array(T), sorted = new Uint32Array(T * 3), rootPos = new Float32Array(nv * 3);
  for (let k = 0; k < T; k++) {
    const t = order[k]; sortedKeys[k] = keys[t];
    sorted[3 * k] = tri[3 * t]; sorted[3 * k + 1] = tri[3 * t + 1]; sorted[3 * k + 2] = tri[3 * t + 2];
    if ((k & 0x3fff) === 0x3fff) yield;
  }
  for (let i = 0; i < nv * 3; i++) rootPos[i] = wp[i];
  // root-space box of every SPLIT_BLOCK sorted triangles, so a run's box at impact reads a few hundred vertices, not the whole run
  const nb = Math.ceil(T / SPLIT_BLOCK), blocks = new Float32Array(nb * 6);
  for (let b = 0; b < nb; b++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = b * SPLIT_BLOCK * 3, e = Math.min(T, (b + 1) * SPLIT_BLOCK) * 3; o < e; o++) { const v = sorted[o] * 3, x = rootPos[v], y = rootPos[v + 1], z = rootPos[v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    blocks.set([x0, y0, z0, x1, y1, z1], b * 6);
    if ((b & 63) === 63) yield;
  }
  return { axis, T, keys: sortedKeys, index: new THREE.BufferAttribute(sorted, 1), rootPos, blocks, rel: rel.clone(), relInverse: rel.clone().invert(), frags: new Map(),
    bytes: sorted.byteLength + rootPos.byteLength + sortedKeys.byteLength + blocks.byteLength };
}

const splitReady = (mesh, rel) => {
  const c = splitCache.get(mesh.geometry), g = mesh.geometry;
  if (!c || g.groups.length || Array.isArray(mesh.material) || Object.keys(g.attributes).length !== 2 || !g.attributes.normal) return null;
  // rotation to 1e-5, translation to 1 mm: rel = inverse(root) x mesh loses digits once the jet is far from the world origin (at 1,000 km every
  // breakup missed the cache and split ~250k triangles at impact, 1.1 of a 2.1 s wreck.start in a browser profile)
  for (let i = 0; i < 16; i++) if (Math.abs(c.rel.elements[i] - rel.elements[i]) > (i >= 12 && i <= 14 ? 1e-3 : 1e-5)) return null;
  return c;
};

const SPLIT_BLOCK = 256;
// root-space box of sorted triangles [t0, t1): whole blocks from the cache's block boxes, the partial blocks at either end vertex by vertex
function runBox(c, t0, t1, out) {
  const ix = c.index.array, rp = c.rootPos, bl = c.blocks;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const tris = (a, e) => { for (let o = a * 3, end = e * 3; o < end; o++) { const v = ix[o] * 3, x = rp[v], y = rp[v + 1], z = rp[v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; } };
  const b0 = Math.ceil(t0 / SPLIT_BLOCK), b1 = Math.floor(t1 / SPLIT_BLOCK);
  if (b0 >= b1) tris(t0, t1);
  else {
    tris(t0, b0 * SPLIT_BLOCK); tris(b1 * SPLIT_BLOCK, t1);
    for (let b = b0; b < b1; b++) { const k = b * 6; if (bl[k] < x0) x0 = bl[k]; if (bl[k + 1] < y0) y0 = bl[k + 1]; if (bl[k + 2] < z0) z0 = bl[k + 2]; if (bl[k + 3] > x1) x1 = bl[k + 3]; if (bl[k + 4] > y1) y1 = bl[k + 4]; if (bl[k + 5] > z1) z1 = bl[k + 5]; }
  }
  return out.set(out.min.set(x0, y0, z0), out.max.set(x1, y1, z1));
}

function addCachedSplit(c, mesh, name, modelBounds, plan, records) {
  const keyAt = (i) => (c.axis === 'wing' ? surfaceKey(0, c.keys[i], name, modelBounds, plan) : surfaceKey(c.keys[i], 0, name, modelBounds, plan));
  const g = mesh.geometry;
  for (let i = 0; i < c.T;) {
    const key = keyAt(i);
    let lo = i + 1, hi = c.T;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keyAt(mid) === key) lo = mid + 1; else hi = mid; }
    // one geometry per run, kept with the cache and reused by later crashes. Never disposed: its position and normal are the intact jet's own
    // buffers, and disposing it would free them on the GPU
    const runKey = i + ':' + lo;
    let frag = c.frags.get(runKey);
    if (!frag) {
      frag = new THREE.BufferGeometry();
      frag.setIndex(c.index); frag.setAttribute('position', g.attributes.position); frag.setAttribute('normal', g.attributes.normal);
      frag.setDrawRange(i * 3, (lo - i) * 3);
      frag.userData.rootBox = runBox(c, i, lo, new THREE.Box3());
      // mesh-space bounds set here: a lazy computeBoundingSphere would walk the whole shared position buffer, not this run
      frag.boundingBox = frag.userData.rootBox.clone().applyMatrix4(c.relInverse);
      frag.boundingSphere = frag.boundingBox.getBoundingSphere(new THREE.Sphere());
      c.frags.set(runKey, frag);
    }
    const rec = recordFor(records, key); rec.box.union(frag.userData.rootBox);
    // drawn like a whole mesh: mesh matrix = piece offset x mesh-to-root (the vertices stay in mesh space, as the elevon shader expects)
    rec.parts.push({ geometry: frag, material: mesh.material, matrix: c.rel, split: false });
    i = lo;
  }
}

function addWholeMesh(mesh, rootInverse, rec) {
  const rel = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
  rec.box.union(worldBoxInRoot(mesh, rootInverse));
  rec.parts.push({ geometry: mesh.geometry, material: mesh.material, matrix: rel, split: false });
}

class Piece {
  constructor(group, mass, pos, quat, vel, w, box) {
    this.g = group; this.m = mass; this.pos = pos.clone(); this.q = quat.clone();
    this.vel = vel.clone(); this.w = w.clone();
    const d = box.getSize(new THREE.Vector3());
    d.set(Math.max(0.15, d.x), Math.max(0.15, d.y), Math.max(0.15, d.z));
    this.I = new THREE.Vector3(
      Math.max(mass * 0.04, mass / 12 * (d.y * d.y + d.z * d.z)),
      Math.max(mass * 0.04, mass / 12 * (d.x * d.x + d.z * d.z)),
      Math.max(mass * 0.04, mass / 12 * (d.x * d.x + d.y * d.y)),
    );
    const cx = (box.min.x + box.max.x) * 0.5, cz = (box.min.z + box.max.z) * 0.5;
    const y0 = box.min.y, y1 = box.max.y;
    this.pts = [
      new THREE.Vector3(box.min.x, y0, box.min.z), new THREE.Vector3(box.max.x, y0, box.min.z),
      new THREE.Vector3(box.min.x, y0, box.max.z), new THREE.Vector3(box.max.x, y0, box.max.z),
      new THREE.Vector3(cx, y0, cz), new THREE.Vector3(cx, y1, cz),
    ];
    this.radius = Math.max(1, Math.hypot(d.x, d.y, d.z) * 0.48);
    this.area = Math.max(1.2, (d.x * d.y + d.x * d.z + d.y * d.z) * 0.11);
    this.burn = 0; this.contact = false; this.slide = 0; this.key = '';
    this.mu = 0.48; this.markX = pos.x; this.markZ = pos.z; this.skidTravel = 0;
    this.safePos = pos.clone(); this.safeQ = quat.clone();
  }

  sampleGround(groundAt) {
    const x = this.pos.x, z = this.pos.z, e = 4;
    this.groundY = groundAt(x, z); this.slopeX = 0; this.slopeZ = 0;
    if (this.pos.y < this.groundY + this.radius + 3) {
      this.slopeX = clamp((groundAt(x + e, z) - this.groundY) / e, -0.8, 0.8);
      this.slopeZ = clamp((groundAt(x, z + e) - this.groundY) / e, -0.8, 0.8);
    }
  }

  step(h, rho, onSpark) {
    this.safePos.copy(this.pos); this.safeQ.copy(this.q);
    const m = this.m, kTotal = m * 1700, k = kTotal / this.pts.length;
    const damp = 2 * 0.78 * Math.sqrt(kTotal * m) / this.pts.length;
    const F = _force.set(0, -m * G, 0), T = _torque.set(0, 0, 0);
    const speed = this.vel.length();
    if (speed > 0.1) F.addScaledVector(this.vel, -0.5 * rho * 0.72 * this.area * speed);
    this.contact = false; this.slide = 0;
    const centerGround = this.groundY, slopeX = this.slopeX, slopeZ = this.slopeZ;
    const nearGround = this.pos.y < centerGround + this.radius + 3;
    if (nearGround) {
      _normal.set(-slopeX, 1, -slopeZ).normalize();
      _worldW.copy(this.w).applyQuaternion(this.q);
      for (let pointIndex = 0; pointIndex < this.pts.length; pointIndex++) {
        _arm.copy(this.pts[pointIndex]).applyQuaternion(this.q);
        const px = this.pos.x + _arm.x, py = this.pos.y + _arm.y, pz = this.pos.z + _arm.z;
        const gy = centerGround + slopeX * (px - this.pos.x) + slopeZ * (pz - this.pos.z), pen0 = gy - py;
        if (pen0 <= 0) continue;
        const pen = Math.min(2, pen0 / Math.max(0.65, _normal.y));
        this.contact = true;
        _vp.crossVectors(_worldW, _arm).add(this.vel);
        const vn = _vp.dot(_normal), fn = Math.max(0, k * pen - damp * vn);
        _friction.copy(_vp).addScaledVector(_normal, -vn);
        const vt = _friction.length();
        const ft = Math.min(this.mu * fn, m * vt / Math.max(h, 0.001));
        if (vt > 0.001) _friction.multiplyScalar(-ft / vt);
        _f.copy(_normal).multiplyScalar(fn).add(_friction);
        F.add(_f); _r.crossVectors(_arm, _f); T.add(_r);
        if (vt > this.slide) this.slide = vt;
        if (vt > 18 && onSpark && Math.random() < h * 18) onSpark(px, gy + 0.16, pz, _vp);
      }
      if (this.contact) { F.x -= m * G * slopeX / (1 + slopeX * slopeX + slopeZ * slopeZ); F.z -= m * G * slopeZ / (1 + slopeX * slopeX + slopeZ * slopeZ); }
    }
    this.vel.addScaledVector(F, h / m);
    this.pos.addScaledVector(this.vel, h);
    _torqueBody.copy(T).applyQuaternion(_qi.copy(this.q).invert());
    const I = this.I, w = this.w;
    const gx = w.y * w.z * (I.z - I.y), gy = w.z * w.x * (I.x - I.z), gz = w.x * w.y * (I.y - I.x);
    // the gyroscopic term only turns the spin, it never adds energy; explicit Euler does, so hold the energy it had
    const e0 = I.x * w.x * w.x + I.y * w.y * w.y + I.z * w.z * w.z;
    w.x -= gx / I.x * h; w.y -= gy / I.y * h; w.z -= gz / I.z * h;
    const e1 = I.x * w.x * w.x + I.y * w.y * w.y + I.z * w.z * w.z;
    if (e1 > e0 && e1 > 0) w.multiplyScalar(Math.sqrt(e0 / e1));
    w.x += _torqueBody.x / I.x * h; w.y += _torqueBody.y / I.y * h; w.z += _torqueBody.z / I.z * h;
    w.multiplyScalar(Math.exp(-(this.contact ? 0.9 : 0.08) * h));
    // backstop: a runaway spin once reached millions of rad/s, then NaN, and the NaN fire it emitted blanked the frame
    const wl = w.length();
    if (wl > MAX_SPIN) w.multiplyScalar(MAX_SPIN / wl);
    const ang = Math.min(wl, MAX_SPIN) * h;
    if (ang > 1e-8) this.q.multiply(_q.setFromAxisAngle(_v.copy(w).normalize(), ang)).normalize();
    if (this.contact && this.vel.lengthSq() < 0.04 && w.lengthSq() < 0.004) { this.vel.multiplyScalar(0.88); w.multiplyScalar(0.86); }
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z + w.x + w.y + w.z + this.q.w)) {
      this.pos.copy(this.safePos); this.q.copy(this.safeQ); this.vel.set(0, 0, 0); w.set(0, 0, 0);
    }
  }
}

class DebrisField {
  constructor(scene, max = 112) {
    this.max = max; this.count = 0; this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3); this.spin = new Float32Array(max * 3);
    this.scale = new Float32Array(max); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.ground = new Float32Array(max); this.sampleIn = new Float32Array(max); this.trail = new Uint8Array(max);
    const geo = new THREE.OctahedronGeometry(0.5, 0); geo.scale(1, 0.16, 0.72);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.62, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.mesh);
  }
  // trail: 1 = a burning fragment that streams flame and smoke while it flies
  emit(x, y, z, vx, vy, vz, size, life, tint = 0.6, trail = 0) {
    if (this.count >= this.max) return;
    const i = this.count++, j = i * 3;
    this.trail[i] = trail;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z;
    this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.rot[j] = Math.random() * Math.PI; this.rot[j + 1] = Math.random() * Math.PI; this.rot[j + 2] = Math.random() * Math.PI;
    this.spin[j] = (Math.random() - 0.5) * 9; this.spin[j + 1] = (Math.random() - 0.5) * 9; this.spin[j + 2] = (Math.random() - 0.5) * 9;
    this.scale[i] = size; this.age[i] = 0; this.life[i] = life; this.ground[i] = -1e6; this.sampleIn[i] = 0;
    if (tint > 0.9) this.mesh.setColorAt(i, _color.setRGB(0.55, 0.57, 0.6)); // bare aluminium
    else this.mesh.setColorAt(i, _color.setRGB(0.05 + tint * 0.12, 0.06 + tint * 0.13, 0.08 + tint * 0.15));
  }
  update(dt, groundAt, cam) {
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      if (this.age[i] >= this.life[i]) { _m.compose(_center.set(0, 0, 0), _q.identity(), _scale.setScalar(0)); this.mesh.setMatrixAt(i, _m); continue; }
      this.age[i] += dt;
      this.v[j] *= Math.exp(-dt * 0.025); this.v[j + 1] -= G * dt; this.v[j + 2] *= Math.exp(-dt * 0.025);
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.rot[j] += this.spin[j] * dt; this.rot[j + 1] += this.spin[j + 1] * dt; this.rot[j + 2] += this.spin[j + 2] * dt;
      this.sampleIn[i] -= dt;
      if (this.sampleIn[i] <= 0) { this.ground[i] = groundAt(this.p[j], this.p[j + 2]); this.sampleIn[i] = 0.24; }
      const r = this.scale[i] * 0.35;
      if (this.p[j + 1] < this.ground[i] + r) {
        this.p[j + 1] = this.ground[i] + r;
        if (this.v[j + 1] < -1.2) this.v[j + 1] *= -0.22; else this.v[j + 1] = 0;
        this.v[j] *= 0.72; this.v[j + 2] *= 0.72;
        this.spin[j] *= 0.72; this.spin[j + 1] *= 0.72; this.spin[j + 2] *= 0.72;
      }
      _euler.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]);
      _q.setFromEuler(_euler); _center.set(this.p[j] - cam.x, this.p[j + 1] - cam.y, this.p[j + 2] - cam.z);
      _scale.setScalar(this.scale[i]); _m.compose(_center, _q, _scale); this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.count = 0; this.mesh.count = 0; this.mesh.instanceMatrix.needsUpdate = true; }
}

class GroundEffects {
  constructor(scene, max = 144) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x17140f, transparent: true, opacity: 0.56, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.skid = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.skid.count = 0; this.skid.frustumCulled = false; this.skid.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.skid);
    const sootMat = new THREE.MeshBasicMaterial({ color: 0x211710, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.soot = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 24), sootMat, 16);
    this.soot.count = 0; this.soot.frustumCulled = false; this.soot.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.soot);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xc1a176, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), this.ringMat);
    this.ring.visible = false; this.ring.frustumCulled = false; scene.add(this.ring);
    this.marks = []; this.sootMarks = []; this.max = max; this.shockAge = 1e6; this.shockLife = 1; this.shockRadius = 1;
  }
  addSkid(x, y, z, sx, sz, angle, width, length) {
    if (this.marks.length >= this.max) this.marks.shift();
    this.marks.push({ x, y, z, sx, sz, angle, width, length });
  }
  addSoot(x, y, z, sx, sz, radius) {
    if (this.sootMarks.length >= 16) return;
    this.sootMarks.push({ x, y, z, sx, sz, radius });
  }
  shock(x, y, z, sx, sz, radius, life) {
    this.shockX = x; this.shockY = y; this.shockZ = z; this.shockSx = sx; this.shockSz = sz;
    this.shockRadius = radius; this.shockLife = life; this.shockAge = 0; this.ring.visible = true;
  }
  _matrix(mesh, i, x, y, z, sx, sz, angle, w, l, cam) {
    _normal.set(-sx, 1, -sz).normalize(); _q.setFromUnitVectors(_zAxis, _normal);
    _q2.setFromAxisAngle(_zAxis, angle); _q.multiply(_q2);
    _center.set(x - cam.x, y - cam.y, z - cam.z); _scale.set(w, l, 1);
    _m.compose(_center, _q, _scale); mesh.setMatrixAt(i, _m);
  }
  update(dt, cam) {
    for (let i = 0; i < this.marks.length; i++) {
      const a = this.marks[i]; this._matrix(this.skid, i, a.x, a.y + 0.12, a.z, a.sx, a.sz, a.angle, a.width, a.length, cam);
    }
    this.skid.count = this.marks.length; this.skid.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.sootMarks.length; i++) {
      const a = this.sootMarks[i]; this._matrix(this.soot, i, a.x, a.y + 0.16, a.z, a.sx, a.sz, 0, a.radius * 2, a.radius * 2, cam);
    }
    this.soot.count = this.sootMarks.length; this.soot.instanceMatrix.needsUpdate = true;
    if (this.ring.visible) {
      this.shockAge += dt;
      if (this.shockAge >= this.shockLife) { this.ring.visible = false; this.ringMat.opacity = 0; }
      else {
        const t = this.shockAge / this.shockLife, radius = this.shockRadius * (0.2 + 0.8 * smooth01(t));
        _normal.set(-this.shockSx, 1, -this.shockSz).normalize(); _q.setFromUnitVectors(_zAxis, _normal);
        this.ring.position.set(this.shockX - cam.x, this.shockY - cam.y + 0.25, this.shockZ - cam.z);
        this.ring.quaternion.copy(_q); this.ring.scale.setScalar(radius); this.ringMat.opacity = (1 - t) * 0.56;
      }
    }
  }
  clear() {
    this.marks.length = 0; this.sootMarks.length = 0; this.skid.count = 0; this.soot.count = 0;
    this.skid.instanceMatrix.needsUpdate = this.soot.instanceMatrix.needsUpdate = true;
    this.ring.visible = false; this.ringMat.opacity = 0; this.shockAge = 1e6;
  }
}

export class Wreck {
  constructor(scene) {
    this.scene = scene; this.group = new THREE.Group(); scene.add(this.group);
    this.fire = new Particles(scene, 2600, true); this.smoke = new Particles(scene, 4400, false);
    this.setOverlay = (ov) => { for (const q of [this.fire, this.smoke]) q.attach(ov || scene, !!ov); };
    this.fragments = new DebrisField(scene, 200); this.ground = new GroundEffects(scene, 144);
    // always present (at zero) so adding it never recompiles every lit material at the moment of a crash
    this.light = new THREE.PointLight(0xff8a3a, 0, 0, 2); scene.add(this.light);
    this.pieces = []; this.active = false; this.t = 0; this.createdGeometries = [];
    this.bursts = []; this.events = []; this.flashT = -1e6; this.flashK = 0; this.scale = SR71_SCALE;
    this._spark = (x, y, z, vp) => this.fire.emit(x, y, z, vp.x * 0.36 + (Math.random() - 0.5) * 8, 2 + Math.random() * 6, vp.z * 0.36 + (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.25, 0.5, 0.22, 2);
  }

  // Builds the fuselage/wing split caches in idle time (~6 ms slices). Resolves with { meshes, tris, bytes, ms } once every mesh is ready.
  prepare(visual, budgetMs = 6) {
    const model = visual.model, root = visual.root, jobs = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || !o.geometry.attributes.normal || o.userData.shadowProxy || splitCache.has(o.geometry)) return;
      const axis = splitAxis(meshRootName(o, model)); if (axis) jobs.push({ mesh: o, axis });
    });
    const stats = { meshes: 0, tris: 0, bytes: 0, ms: 0 };
    this.prepared = new Promise((resolve) => {
      const next = () => {
        const job = jobs.shift(); if (!job) { resolve(stats); return; }
        const gen = buildSplitCache(job.mesh, root, job.axis), slice = () => {
          const t0 = performance.now();
          for (;;) {
            const r = gen.next();
            if (r.done) { if (r.value) { splitCache.set(job.mesh.geometry, r.value); stats.meshes++; stats.tris += r.value.T; stats.bytes += r.value.bytes; } stats.ms += performance.now() - t0; next(); return; }
            if (performance.now() - t0 > budgetMs) break;
          }
          stats.ms += performance.now() - t0;
          whenIdle(slice, 2000);
        };
        whenIdle(slice, 2000);
      };
      next();
    });
    return this.prepared;
  }

  // The first frames after impact made a vertex array object for every new piece geometry (runs of the sorted index over the jet's own buffers;
  // three makes one per geometry and program at its first draw) and uploaded the ~3 MB sorted index. Builds the runs of every breakup plan here,
  // once the split caches exist, and draws each run once, scaled to nothing, with the jet's own materials and the real scene's lights (so the
  // programs, and with them the VAOs, are the ones the impact draws with). target: the scene pass's target (post.sceneRT, or null on Low).
  warmPieces(visual, renderer, scene, camera, target) {
    const t0 = performance.now(), model = visual.model, root = visual.root;
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    model.updateMatrixWorld(true);
    const modelBounds = modelBoundsInRoot(model, rootInverse);
    // every plan _plan() can return: fuselage runs depend on fuselageSegments only, wing runs on wingSections only
    const plans = [['hard-landing', 0.4], ['hard-landing', 0.51], ['hard-landing', 0.6], ['fast-shallow', 1], ['steep-impact', 1], ['structural-failure', 1]].map(([outcome, score]) => this._plan({ outcome, score }));
    const frags = new Map();
    model.traverse((o) => {
      if (!o.isMesh || o.userData.shadowProxy || !splitCache.has(o.geometry)) return;
      const c = splitCache.get(o.geometry), name = meshRootName(o, model), fuse = /^SR71_Fuselage/.test(name), wing = /^SR71_Wing_[LR]/.test(name);
      for (const plan of plans) {
        if (!(fuse && plan.fuselageSegments > 1) && !(wing && plan.wingSections > 1)) continue;
        const records = new Map(); addCachedSplit(c, o, name, modelBounds, plan, records);
        for (const rec of records.values()) for (const p of rec.parts) if (!p.geometry.userData.warmed) frags.set(p.geometry, p.material);
      }
    });
    const stats = this.warmStats = { runs: frags.size, ms: 0 };
    if (!frags.size) return stats;
    const L = 30, group = new THREE.Group(), lights = [];
    for (const [geo, mat] of frags) { const m = new THREE.Mesh(geo, mat); m.layers.set(L); m.frustumCulled = false; m.scale.setScalar(0); group.add(m); }
    group.layers.set(L); scene.add(group);
    scene.traverse((o) => { if (o.isLight) { lights.push([o, o.layers.mask]); o.layers.enable(L); } });
    const camMask = camera.layers.mask, bg = scene.background, auto = renderer.autoClear, shAuto = renderer.shadowMap.autoUpdate, prevRT = renderer.getRenderTarget();
    try {
      camera.layers.set(L); scene.background = null; renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      for (const geo of frags.keys()) geo.userData.warmed = true;
    } finally {
      camera.layers.mask = camMask; scene.background = bg; renderer.autoClear = auto; renderer.shadowMap.autoUpdate = shAuto; renderer.setRenderTarget(prevRT);
      for (const [o, mask] of lights) o.layers.mask = mask;
      scene.remove(group);
    }
    stats.ms = Math.round(performance.now() - t0);
    return stats;
  }

  _classify(visual, fdm, kind, vel, up) {
    const c = fdm.crashInfo || {}, speed = c.speed === undefined ? vel.length() : c.speed;
    const sink = c.sinkRate === undefined ? Math.max(0, -vel.y) : c.sinkRate;
    const pitch = Math.abs(c.pitch || 0), bank = Math.abs(c.bank || 0);
    const gear = c.gearPosition === undefined ? (fdm.gearPos || 0) : c.gearPosition;
    const airspeed = c.airspeed === undefined ? ((fdm.out && fdm.out.V) || speed) : c.airspeed;
    const mach = c.mach === undefined ? ((fdm.out && fdm.out.M) || 0) : c.mach;
    const g = Math.abs(c.loadFactor === undefined ? ((fdm.out && fdm.out.nz) || 1) : c.loadFactor);
    const horizontal = Math.hypot(vel.x, vel.z), yaw = c.yaw || 0, sc = this.scale || SR71_SCALE;
    const ks = sc.speedRef / 280, kz = sc.sinkRef / 58;
    const course = Math.atan2(vel.z, vel.x), yawError = speed > 5 ? Math.atan2(Math.sin(yaw - course), Math.cos(yaw - course)) : 0;
    const attitude = clamp(pitch / 0.95 + bank / 1.1 + Math.abs(yawError) / 1.3 + Math.max(0, 0.65 - up.y) * 0.65, 0, 1.5);
    let outcome, score;
    if (kind === 'overstress') {
      const failure = Math.max(clamp((airspeed - 180) / 720, 0, 1), clamp((mach - 1.5) / 2.1, 0, 1), clamp((g - 2) / 10, 0, 1));
      score = clamp(0.68 + failure * 0.32, 0.7, 1);
      outcome = 'structural-failure';
    } else {
      score = clamp(0.08 + 0.32 * clamp(speed / sc.speedRef, 0, 1) + 0.42 * clamp(sink / sc.sinkRef, 0, 1) + 0.12 * attitude + (gear < 0.45 ? 0.04 : 0), 0, 1);
      const upright = up.y > 0.76 && pitch < 0.42 && bank < 0.62 && Math.abs(yawError) < 0.65;
      if (speed < 125 * ks && sink < 9 * kz && upright) {
        outcome = 'belly-slide'; score = Math.min(0.29, score);
      } else if (sink > 40 * kz || up.y < 0.13 || (speed > 285 * ks && sink > 19 * kz)) {
        outcome = 'steep-impact'; score = Math.max(0.78, score);
      } else if (horizontal > 175 * ks && sink < 24 * kz) {
        outcome = 'fast-shallow'; score = Math.max(0.72, score + 0.22);
      } else {
        outcome = 'hard-landing'; score = Math.max(0.34, score);
      }
    }
    return { outcome, score, speed, sink, horizontal, pitch, bank, yaw, yawError, gear, airspeed, mach, g, fuel: Math.max(0, fdm.fuel || 0), up: up.clone() };
  }

  _plan(info) {
    if (info.outcome === 'belly-slide') return { fuselageSegments: 1, wingSections: 1, separateTail: false };
    if (info.outcome === 'hard-landing') return { fuselageSegments: info.score > 0.5 ? 3 : 2, wingSections: info.score > 0.52 ? 2 : 1, separateTail: false };
    if (info.outcome === 'fast-shallow') return { fuselageSegments: 6, wingSections: 2, separateTail: true };
    if (info.outcome === 'steep-impact') return { fuselageSegments: 8, wingSections: 3, separateTail: true };
    return { fuselageSegments: 5, wingSections: 2, separateTail: true };
  }

  _description(info) {
    if (info.outcome === 'belly-slide') return 'The aircraft skidded on its belly; the main airframe stayed intact and only light fittings or gear separated.';
    if (info.outcome === 'hard-landing') return 'The landing loads collapsed the gear and tore away several assemblies, leaving a partly intact fuselage.';
    if (info.outcome === 'fast-shallow') return 'A fast, shallow impact tore off the wings and broke the fuselage into a long debris field.';
    if (info.outcome === 'steep-impact') return 'A steep, high-energy impact fragmented nearly the whole airframe at the impact site.';
    return 'The airframe failed in flight; major sections separated and fell independently.';
  }

  _makePieces(visual, fdm, info, plan, vel, wb) {
    const model = visual.model, root = visual.root, records = new Map();
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const modelBounds = modelBoundsInRoot(model, rootInverse);
    const gearRoots = [];
    if (visual.gearGroup && info.gear > 0.22) {
      for (const child of visual.gearGroup.children) {
        if (child.isGroup && child.children.length) {
          const side = child.position.x > 3 ? 'N' : child.position.z < 0 ? 'L' : 'R';
          const key = 'gear-' + side, rec = recordFor(records, key);
          gearRoots.push(child);
          child.traverse((o) => { if (o.isMesh && o.geometry) addWholeMesh(o, rootInverse, rec); });
        }
      }
    }
    const whole = (name, mesh) => {
      const box = worldBoxInRoot(mesh, rootInverse), cen = box.getCenter(_center);
      const key = info.outcome === 'belly-slide' ? 'body' : surfaceKey(cen.x, cen.z, name, modelBounds, plan);
      addWholeMesh(mesh, rootInverse, recordFor(records, key));
    };
    // parts under a hidden group (the cockpit interior outside the cockpit view, 111 meshes) are not drawn and do not break up: copying them was
    // a good part of the impact frame
    const shown = (o) => { for (let q = o; q && q !== model; q = q.parent) if (!q.visible) return false; return true; };
    // which split meshes took the precomputed cache and which were split triangle by triangle at impact (and why): wreck.startStats
    const stats = this.startStats = { cached: 0, perTriangle: 0, misses: [] };
    const split = (o, name) => {
      const t0 = performance.now(), how = addSplitMesh(o, name, rootInverse, modelBounds, plan, records, this.createdGeometries);
      if (how === 'cached') stats.cached++;
      else if (how === 'split') { stats.perTriangle++; stats.misses.push({ name: o.name || name, root: name, tris: Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3), ms: Math.round(performance.now() - t0), why: splitMissReason(o, new THREE.Matrix4().multiplyMatrices(rootInverse, o.matrixWorld)) }); }
    };
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || !shown(o) || o.userData.shadowProxy) return;
      if (gearRoots.some((gear) => within(o, gear))) return;
      const name = meshRootName(o, model);
      if (o.userData.mergedParts) {
        for (const part of o.userData.mergedParts) whole(name, { geometry: part.geometry, material: part.material, matrixWorld: new THREE.Matrix4().multiplyMatrices(o.matrixWorld, part.matrix) });
        return;
      }
      if (info.outcome !== 'belly-slide' && plan.fuselageSegments > 1 && /^SR71_Fuselage/.test(name)) {
        split(o, name);
        return;
      }
      if (info.outcome !== 'belly-slide' && plan.wingSections > 1 && /^SR71_Wing_[LR]/.test(name)) {
        split(o, name);
        return;
      }
      whole(name, o);
    });

    const modelCenter = modelBounds.getCenter(_center);
    let totalWeight = 0;
    for (const rec of records.values()) {
      if (rec.box.isEmpty()) continue;
      const d = rec.box.getSize(_v);
      const volume = Math.max(0.15, d.x * d.y * d.z);
      rec.weight = rec.key.indexOf('gear-') === 0 ? Math.max(0.05, volume * 0.018) : Math.max(0.5, volume);
      totalWeight += rec.weight;
    }
    const totalMass = Math.max(28000, fdm.mass || 55000);
    const bodyX = _bodyX.copy(_forward).applyQuaternion(fdm.quat), bodyY = _bodyY.copy(_up).applyQuaternion(fdm.quat), bodyZ = _bodyZ.copy(_right).applyQuaternion(fdm.quat);
    const wbWorld = _worldW.copy(wb).applyQuaternion(fdm.quat);
    for (const rec of records.values()) {
      if (rec.box.isEmpty()) continue;
      const cen = rec.box.getCenter(_center), localBox = rec.box.clone().translate(_offset.copy(cen).negate());
      const worldPos = _worldCenter.copy(cen).applyQuaternion(fdm.quat).add(fdm.pos);
      const g = new THREE.Group(); this.group.add(g); g.position.copy(worldPos); g.quaternion.copy(fdm.quat);
      for (const part of rec.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
        if (part.split) {
          const a = part.geometry.attributes.position.array;
          for (let i = 0; i < a.length; i += 3) { a[i] -= cen.x; a[i + 1] -= cen.y; a[i + 2] -= cen.z; }
          part.geometry.attributes.position.needsUpdate = true; part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
          mesh.matrix.identity();
        } else {
          mesh.matrix.copy(part.matrix); mesh.matrix.elements[12] -= cen.x; mesh.matrix.elements[13] -= cen.y; mesh.matrix.elements[14] -= cen.z;
          mesh.matrixAutoUpdate = false;
        }
        g.add(mesh);
      }
      const mass = totalMass * rec.weight / Math.max(1, totalWeight);
      const v = _v.copy(vel).add(_r.copy(wbWorld).cross(_offset.copy(cen).applyQuaternion(fdm.quat)));
      const separation = info.outcome === 'belly-slide' ? 0 : 1.2 + info.score * 16;
      const localX = cen.x - modelCenter.x, localZ = cen.z - modelCenter.z;
      if (rec.key.indexOf('gear-') === 0) {
        const side = rec.key.endsWith('L') ? -1 : rec.key.endsWith('R') ? 1 : 0;
        v.addScaledVector(bodyZ, side * (2 + info.score * 10)).addScaledVector(bodyY, 1 + info.score * 4);
      } else if (rec.key.indexOf('wing-') === 0 || rec.key.indexOf('engine-') === 0 || rec.key.indexOf('tail-') === 0) {
        const side = localZ < 0 ? -1 : 1;
        v.addScaledVector(bodyZ, side * separation * (rec.key.indexOf('tail-') === 0 ? 0.38 : 0.72));
        v.addScaledVector(bodyY, 1.4 + info.score * 7);
      } else if (rec.key.indexOf('fuse-') === 0) {
        v.addScaledVector(bodyX, (localX < 0 ? -1 : 1) * separation * 0.42);
        v.addScaledVector(bodyY, 0.8 + info.score * 4);
      }
      if (info.outcome === 'steep-impact' || info.outcome === 'fast-shallow') {
        _sep.copy(worldPos).sub(fdm.pos); _sep.y = 0;
        if (_sep.lengthSq() > 1) v.addScaledVector(_sep.normalize(), info.score * (info.outcome === 'steep-impact' ? 12 : 7));
        v.y += info.score * 8;
      }
      const w = wb.clone(), spin = info.outcome === 'belly-slide' ? 0.12 : 0.6 + info.score * 2.4;
      w.x += (Math.random() - 0.5) * spin; w.y += (Math.random() - 0.5) * spin; w.z += (Math.random() - 0.5) * spin;
      const pc = new Piece(g, Math.max(1, mass), worldPos, fdm.quat, v, w, localBox);
      pc.key = rec.key; pc.mu = rec.key.indexOf('gear-') === 0 ? 0.58 : info.outcome === 'belly-slide' ? 0.38 : 0.66;
      this.pieces.push(pc);
      if (!this.main || (this.main.key.indexOf('gear-') === 0 && rec.key.indexOf('gear-') !== 0) || pc.m > this.main.m) this.main = pc;
    }
    if (!this.pieces.length) {
      const box = new THREE.Box3().setFromObject(model).applyMatrix4(rootInverse);
      const center = box.getCenter(new THREE.Vector3()); box.translate(center.clone().negate());
      const g = new THREE.Group(); this.group.add(g); g.position.copy(fdm.pos); g.quaternion.copy(fdm.quat);
      this.main = new Piece(g, totalMass, fdm.pos, fdm.quat, vel, wb, box); this.main.key = 'body'; this.pieces.push(this.main);
    }
  }

  // One fireball: a flash, a shell of flame that blasts out and is stopped by drag, a hot core that rolls upward for
  // 2-3 s, and soot that rolls out of it (lit orange at first) as the flames die. k scales a secondary burst.
  _fireball(px, py, pz, radius, k, cvx, cvz) {
    this.fire.emit(px, py + radius * 0.15, pz, 0, 0, 0, 0.32, radius * 1.4, radius * 3.2, 4);
    const n = Math.round((150 + 230 * this.fireIntensity) * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, d = Math.sqrt(1 - u * u);
      const sp = radius * (0.7 + 1.6 * Math.pow(Math.random(), 0.6)); // drag stops the shell near its radius
      this.fire.emit(px + (Math.random() - 0.5) * 4, py + 1.5, pz + (Math.random() - 0.5) * 4,
        Math.cos(a) * d * sp + cvx * 0.14, (Math.abs(u) * 0.75 + 0.3) * sp + 3, Math.sin(a) * d * sp + cvz * 0.14,
        2.1 + Math.random() * 1.5, radius * (0.14 + 0.14 * Math.random()), radius * (0.6 + 0.6 * Math.random()), 5);
    }
    // the hot core that stays bright longest and lifts the mushroom cap
    for (let i = 0; i < 26 * k; i++) {
      this.fire.emit(px + (Math.random() - 0.5) * radius * 0.4, py + radius * 0.2, pz + (Math.random() - 0.5) * radius * 0.4,
        (Math.random() - 0.5) * radius * 0.4, radius * (0.3 + 0.3 * Math.random()), (Math.random() - 0.5) * radius * 0.4,
        2.6 + Math.random() * 0.9, radius * 0.3, radius * (0.75 + 0.35 * Math.random()), 5);
    }
    // soot boiling out as the flame burns through, staged to appear where the fireball will have risen
    const ns = Math.round((90 + 130 * this.fireIntensity) * k);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 1.6 - 0.4, d = Math.sqrt(Math.max(0, 1 - u * u)), rr = radius * (0.5 + 0.7 * Math.random());
      const delay = 0.15 + Math.random() * 1.9, rise = radius * (0.2 + 0.55 * delay);
      this.smoke.emit(px + Math.cos(a) * d * rr, py + 2 + rise + Math.max(0, u) * rr * 0.6, pz + Math.sin(a) * d * rr,
        Math.cos(a) * d * radius * 0.35, 4 + Math.max(0, u) * radius * 0.35 + radius * 0.25, Math.sin(a) * d * radius * 0.35,
        14 + Math.random() * 14, radius * 0.45, radius * (1.1 + 1.0 * Math.random()), 6, delay);
    }
    const left = this.flashK * Math.exp(-Math.max(0, this.t - this.flashT) / 0.3);
    this.flashK = Math.max(k, left); this.flashT = this.t;
  }

  _initialEffects(fdm, info) {
    const sc = this.scale || SR71_SCALE;
    const fuelFraction = clamp(info.fuel / sc.fuelCap, 0, 1);
    const ignition = clamp((info.score - 0.16) / 0.6, 0, 1) * clamp(info.fuel / (sc.fuelCap * 0.138), 0, 1);
    this.fireIntensity = ignition * (info.outcome === 'belly-slide' ? 0.18 : 0.82 + fuelFraction * 0.18);
    if (info.outcome === 'structural-failure') this.fireIntensity *= clamp(0.38 + info.mach * 0.18 + info.airspeed / (1200 * sc.speedRef / 280), 0, 1);
    const fireball = this.fireIntensity > 0.44 && info.outcome !== 'structural-failure';
    const px = fdm.pos.x, py = fdm.pos.y, pz = fdm.pos.z, fi = this.fireIntensity, cv = fdm.crashVel;
    if (fireball) {
      // a light aircraft's few hundred litres still make a 20-30 m ball; the jet's tanks make one ~100 m across
      const radius = (10 + 52 * Math.sqrt(fuelFraction)) * (0.55 + fi * 0.65) * sc.size + 8 * (1 - sc.size);
      this.fireRadius = radius;
      this._fireball(px, py, pz, radius, 1, cv.x, cv.z);
      // tanks and lines cooking off over the next couple of seconds: smaller fireballs, each with its own bang
      const nb = 2 + Math.round(2 * fi * Math.random() + fi);
      for (let i = 0; i < nb; i++) {
        const a = Math.random() * Math.PI * 2, d = radius * (0.25 + 0.6 * Math.random());
        this.bursts.push({ t: 0.35 + i * (0.35 + 0.35 * Math.random()), x: px + Math.cos(a) * d + cv.x * 0.08, y: py + 1, z: pz + Math.sin(a) * d + cv.z * 0.08, r: radius * (0.42 + 0.25 * Math.random()), k: 0.35 + 0.25 * Math.random() });
      }
      // the blast raises a skirt of dust that runs out along the ground
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2 + Math.random() * 0.1, sp = radius * (0.8 + 0.7 * Math.random());
        this.smoke.emit(px + Math.cos(a) * radius * 0.3, py + 0.8, pz + Math.sin(a) * radius * 0.3, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp,
          1.2 + Math.random() * 1.0, radius * 0.12, radius * (0.3 + 0.25 * Math.random()), 3);
      }
    }
    // pools of burning fuel along the slide path: low, wide flames that keep burning after the fireball is gone
    if (fi > 0.2 && info.outcome !== 'structural-failure' && info.outcome !== 'belly-slide') {
      const sp = Math.hypot(cv.x, cv.z), dx = sp > 1 ? cv.x / sp : 1, dz = sp > 1 ? cv.z / sp : 0, len = clamp(sp * 0.9, 12, 150) * (0.5 + fi) * (0.4 + 0.6 * sc.size);
      for (let i = 0; i < 90; i++) {
        const t = Math.pow(Math.random(), 0.8) * len, off = (Math.random() - 0.5) * 16 * (0.4 + 0.6 * sc.size);
        this.fire.emit(px + dx * t - dz * off, py + 0.8, pz + dz * t + dx * off, (Math.random() - 0.5) * 2, 1 + Math.random() * 3, (Math.random() - 0.5) * 2, 3 + Math.random() * 7, 3 + Math.random() * 3, 7 + Math.random() * 9, 0);
      }
    }
    const count = info.outcome === 'belly-slide' ? 24 : Math.round(44 + info.score * 150);
    for (let i = 0; i < count; i++) {
      const source = this.pieces[(Math.random() * this.pieces.length) | 0];
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const d = Math.sqrt(1 - u * u), impulse = (info.outcome === 'belly-slide' ? 2.5 : 6 + info.score * 26) * (0.35 + Math.random()) * (fireball ? 1.5 : 1);
      const x = source.pos.x + Math.cos(a) * d * 1.5, y = source.pos.y + u * 1.5, z = source.pos.z + Math.sin(a) * d * 1.5;
      // with a fireball some fragments are flung burning, trailing flame and smoke along their arcs
      const trail = fireball && i % 5 === 0 ? 1 : 0;
      this.fragments.emit(x, y, z, fdm.crashVel.x + Math.cos(a) * d * impulse, fdm.crashVel.y + Math.abs(u) * impulse * (trail ? 1.4 : 1) + 1, fdm.crashVel.z + Math.sin(a) * d * impulse, 0.25 + Math.random() * (0.6 + info.score * 1.1), 5 + Math.random() * 9, Math.random(), trail);
    }
  }

  // visual: AircraftVisual; fdm: FlightModel at impact, with crashVel/crashW captured before the freeze.
  // opts: { fuelCap, speedRef, sinkRef, size } for aircraft other than the SR-71 (see SR71_SCALE)
  start(visual, fdm, kind, opts) {
    this.clear(visual);
    this.scale = opts ? { ...SR71_SCALE, ...opts } : SR71_SCALE;
    const vel = fdm.crashVel || new THREE.Vector3(), wb = fdm.crashW || new THREE.Vector3();
    const up = _up.clone().applyQuaternion(fdm.quat);
    const info = this.info = this._classify(visual, fdm, kind, vel, up);
    this.kind = kind; this.mode = info.outcome === 'belly-slide' ? 'slide' : (kind === 'overstress' ? 'breakup' : 'impact');
    this.severity = info.score >= 0.72 ? 'catastrophic' : info.score >= 0.3 ? 'major' : 'minor';
    this.description = this._description(info); this.plan = this._plan(info);
    this.active = true; this.t = 0; this.main = null; this.fireIntensity = 0;
    this.impactPos = fdm.pos.clone(); this.impactGroundY = fdm.pos.y; this.terrainSlope = 0; this.terrainReady = false;
    this.createdGeometries.length = 0; this.pieces.length = 0;
    const t0 = performance.now();
    this._makePieces(visual, fdm, info, this.plan, vel, wb);
    const t1 = performance.now();
    // Hiding the aircraft hides its lights too, and three.js bakes the light count into every lit material's shader, so terrain, buildings
    // and trees would all recompile mid-crash. Zero-intensity stand-ins keep the count (and so the programs) unchanged.
    this.standIns = [];
    visual.root.traverseVisible((o) => { if (o.isLight) { const c = o.clone(); c.intensity = 0; this.scene.add(c); this.standIns.push(c); } });
    visual.root.visible = false;
    const t2 = performance.now();
    this._initialEffects(fdm, info);
    const st = this.startStats; st.piecesMs = Math.round(t1 - t0); st.lightsMs = Math.round(t2 - t1); st.effectsMs = Math.round(performance.now() - t2);
    const fuel = clamp(info.fuel / this.scale.fuelCap, 0, 1);
    for (const p of this.pieces) {
      p.burn = this.fireIntensity > 0.08 ? (info.outcome === 'belly-slide' ? 5 + 7 * this.fireIntensity : (10 + 32 * fuel) * this.fireIntensity) : 0;
      if (info.outcome === 'structural-failure') p.burn = this.fireIntensity > 0.04 ? 8 + 22 * this.fireIntensity : 0;
    }
  }

  _resolveTerrain(groundAt) {
    if (this.terrainReady) return;
    const x = this.impactPos.x, z = this.impactPos.z, e = 4;
    this.impactGroundY = groundAt(x, z);
    this.slopeX = clamp((groundAt(x + e, z) - groundAt(x - e, z)) / (2 * e), -0.8, 0.8);
    this.slopeZ = clamp((groundAt(x, z + e) - groundAt(x, z - e)) / (2 * e), -0.8, 0.8);
    this.terrainSlope = Math.hypot(this.slopeX, this.slopeZ);
    this.info.terrainSlope = this.terrainSlope;
    const slopeLoad = clamp((this.terrainSlope - 0.06) * 0.32, 0, 0.18);
    this.info.score = clamp(this.info.score + slopeLoad, 0, 1);
    this.severity = this.info.score >= 0.72 ? 'catastrophic' : this.info.score >= 0.3 ? 'major' : 'minor';
    this.fireIntensity = clamp(this.fireIntensity * (1 + slopeLoad), 0, 1.4);
    if (slopeLoad > 0) for (const p of this.pieces) if (p.burn > 0) p.burn *= 1 + slopeLoad;
    if (this.fireIntensity > 0.16 || this.info.score >= 0.72) this.ground.addSoot(x, this.impactGroundY, z, this.slopeX, this.slopeZ, 5 + this.info.score * 18);
    const blast = this.fireIntensity > 0.44 && this.info.outcome !== 'structural-failure';
    if (this.info.outcome === 'steep-impact' || blast) this.ground.shock(x, this.impactGroundY, z, this.slopeX, this.slopeZ, (this.fireRadius || 30) * 1.6 + this.info.score * 40, 1.25);
    if (blast) {
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2, speed = 13 + Math.random() * 45;
        this.smoke.emit(x + Math.cos(a) * 2, this.impactGroundY + 0.4, z + Math.sin(a) * 2, Math.cos(a) * speed, 1 + Math.random() * 5, Math.sin(a) * speed, 3 + Math.random() * 4, 4 + Math.random() * 5, 16 + Math.random() * 22, 3);
      }
    }
    if (this.terrainSlope > 0.14) this.description += ' The impact was on a slope; loose sections tumble and slide downhill.';
    this.terrainReady = true;
  }

  _skids(p, groundAt) {
    if (!p.contact || p.slide < 9) { p.skidTravel = 0; p.markX = p.pos.x; p.markZ = p.pos.z; return; }
    const dx = p.pos.x - p.markX, dz = p.pos.z - p.markZ;
    p.skidTravel += Math.hypot(dx, dz);
    if (p.skidTravel < 4) return;
    const x = (p.markX + p.pos.x) * 0.5, z = (p.markZ + p.pos.z) * 0.5;
    const angle = Math.atan2(p.vel.x, p.vel.z), length = clamp(p.skidTravel, 2.2, 10);
    this.ground.addSkid(x, groundAt(x, z), z, this.slopeX || 0, this.slopeZ || 0, angle, p.key.indexOf('wing-') === 0 ? 0.8 : 0.55, length);
    p.markX = p.pos.x; p.markZ = p.pos.z; p.skidTravel = 0;
  }

  update(dt, groundAt, camWorld, wind, day, rho, sunDir) {
    if (!this.active) return;
    this.t += dt; this._resolveTerrain(groundAt);
    const sub = Math.max(1, Math.ceil(dt / 0.004)), h = dt / sub;
    for (let pieceIndex = 0; pieceIndex < this.pieces.length; pieceIndex++) {
      const p = this.pieces[pieceIndex];
      p.sampleGround(groundAt);
      for (let i = 0; i < sub; i++) p.step(h, rho, this._spark);
      if (p.burn > 0) {
        p.burn -= dt;
        const k = Math.min(1, p.burn / 12), x = p.pos.x, y = p.pos.y, z = p.pos.z;
        const nf = dt * (12 + 34 * this.fireIntensity) * (p.key.indexOf('fuse-') === 0 || p.key === 'body' ? 1 : 0.46) * k;
        const ns = dt * (2 + 4 * this.fireIntensity) * (0.3 + 0.7 * k);
        for (let i = 0; i < nf; i++) if (Math.random() < nf - i) this.fire.emit(x + (Math.random() - 0.5) * 6, y + Math.random() * 2, z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, 2.5 + Math.random() * 4, (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.0, 3.2, 9 + 5 * k, 0);
        for (let i = 0; i < ns; i++) if (Math.random() < ns - i) this.smoke.emit(x + (Math.random() - 0.5) * 5, y + 2.5, z + (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 1.8, 5 + Math.random() * 6, (Math.random() - 0.5) * 1.8, 10 + Math.random() * 10, 6, 30 + 28 * this.fireIntensity, 1);
      }
      if (p.contact && p.slide > 8 && Math.random() < dt * 20) {
        this.smoke.emit(p.pos.x, groundAt(p.pos.x, p.pos.z) + 0.4, p.pos.z, p.vel.x * 0.12, 1.5 + Math.random() * 2.5, p.vel.z * 0.12, 0.6, 2 + Math.random() * 3, 4 + Math.random() * 7, 3);
      }
      this._skids(p, groundAt);
      p.g.position.set(p.pos.x - camWorld.x, p.pos.y - camWorld.y, p.pos.z - camWorld.z); p.g.quaternion.copy(p.q);
    }
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      if (b.done || this.t < b.t) continue;
      b.done = true; this._fireball(b.x, b.y, b.z, b.r, b.k, 0, 0); this.events.push(b.k);
    }
    // burning fragments stream flame and smoke along their arcs
    const fr = this.fragments;
    for (let i = 0; i < fr.count; i++) {
      if (!fr.trail[i] || fr.age[i] > 3.2 || fr.age[i] >= fr.life[i]) continue;
      const j = i * 3, x = fr.p[j], y = fr.p[j + 1], z = fr.p[j + 2], fade = 1 - fr.age[i] / 3.2;
      if (Math.random() < dt * 34 * fade) this.fire.emit(x, y, z, 0, 0.5, 0, 0.35 + 0.2 * Math.random(), 1.2, 3.5 * fade + 1, 0);
      if (Math.random() < dt * 14 * fade) this.smoke.emit(x, y, z, fr.v[j] * 0.1, 1, fr.v[j + 2] * 0.1, 5 + Math.random() * 4, 1.5, 7 + 6 * fade, 1);
    }
    // a tall, dark column that keeps climbing for as long as the wreck burns, bending downwind as it rises
    if (this.fireIntensity > 0.08 && this.t < 110) {
      const fade = clamp(1 - (this.t - 45) / 65, 0, 1), cx = (this.main || this.pieces[0] || { pos: this.impactPos }).pos, sz = this.scale.size;
      const rate = (22 + 44 * this.fireIntensity) * fade * dt * (0.55 + 0.45 * sz);
      for (let i = 0; i < rate; i++) if (Math.random() < rate - i) this.smoke.emit(cx.x + (Math.random() - 0.5) * 8 * sz, cx.y + 3, cx.z + (Math.random() - 0.5) * 8 * sz, (Math.random() - 0.5) * 3, 8 + Math.random() * 7, (Math.random() - 0.5) * 3, 20 + Math.random() * 16, (8 + Math.random() * 6) * (0.5 + 0.5 * sz), (48 + Math.random() * 55 + 40 * this.fireIntensity) * (0.45 + 0.55 * sz), 1);
    }
    // the fire lights its surroundings, flickering and dying with the flames; each fireball flashes it bright
    const lk = clamp(1 - this.t / 40, 0, 1) * Math.min(1.2, this.fireIntensity), lp = (this.main || { pos: this.impactPos }).pos;
    const flash = this.flashK * Math.exp(-Math.max(0, this.t - this.flashT) / 0.3);
    this.light.intensity = (lk * (4200 + 1800 * Math.sin(this.t * 23) + 1300 * Math.sin(this.t * 41 + 1.3)) + flash * 26000 * this.scale.size) * (0.25 + 0.75 * clamp(1 - day * 0.7, 0, 1));
    this.light.position.set(lp.x - camWorld.x, lp.y + 8 - camWorld.y, lp.z - camWorld.z);
    this.fire.update(dt, camWorld, wind, day, sunDir); this.smoke.update(dt, camWorld, wind, day, sunDir);
    this.fragments.update(dt, groundAt, camWorld); this.ground.update(dt, camWorld);
  }

  spread() { let m = 0; if (!this.main) return 0; for (const p of this.pieces) m = Math.max(m, p.pos.distanceTo(this.main.pos)); return m; }
  summary() { return { severity: this.severity || 'minor', description: this.description || 'No crash damage recorded.' }; }
  settled() {
    if (this.t > 16) return true;
    if (this.t <= 5) return false;
    for (let i = 0; i < this.pieces.length; i++) if (this.pieces[i].vel.length() >= 1.65 || this.pieces[i].w.length() >= 0.32) return false;
    return true;
  }

  clear(visual) {
    for (const p of this.pieces) this.group.remove(p.g);
    this.pieces.length = 0; this.main = null; this.active = false; this.t = 0;
    for (const g of this.createdGeometries) g.dispose();
    this.createdGeometries.length = 0;
    this.fire.clear(); this.smoke.clear(); this.fragments.clear(); this.ground.clear();
    this.info = null; this.description = ''; this.severity = 'minor'; this.fireIntensity = 0; this.light.intensity = 0; this.fireRadius = 0;
    this.bursts.length = 0; this.events.length = 0; this.flashT = -1e6; this.flashK = 0;
    if (visual && visual.root) visual.root.visible = true;
    if (this.standIns) { for (const l of this.standIns) this.scene.remove(l); this.standIns = null; }
  }
}

export const __split = { addSplitMesh, buildSplitCache, splitCache, splitAxis, meshRootName, surfaceKey };
export const __fx = { Particles, Piece };
