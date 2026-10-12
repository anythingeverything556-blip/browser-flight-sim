import * as THREE from 'three';

// Water on the canopy glass, drawn as real refraction like a lens: each drop bends the picture behind it (upside down inside the drop),
// has a dark rim and a highlight, and sits on the glass in metres, so it stays put on the canopy when the head or the aircraft moves.
//
//  * Beads: tiny to medium drops that grow, stay pinned while they are small and are stretched along the airflow at speed.
//  * Runners: big drops that break loose once gravity along the glass slope plus the airflow overcome the pinning of the contact line,
//    slide with a stick-slip run and leave a wet trail that dries behind them.
//  * The flow direction is the balance of gravity down the slope and aerodynamic drag (dynamic pressure): at rest drops run down and
//    outwards, with speed they are driven aft; above ~250 m/s the glass is too hot for water to stay.
//
// The glass meshes get a child mesh on DROP_LAYER. PostFX renders that layer into a half-float target (offset.xy, highlight, rim) that
// the composite pass uses to bend the scene; on Low (no post pass) the same pattern is drawn as an alpha overlay instead.
export const DROP_LAYER = 5;

const VERT = `
uniform mat4 uLocal;
varying vec3 vP; varying float vZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = (uLocal * vec4(position, 1.0)).xyz;
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
precision highp float;
uniform float uWet, uTime, uSpeed, uForce, uRate, uRain, uMode, uLogF, uLightI;
uniform vec2 uDir, uLightP, uRes;
uniform highp sampler2D tDepth;
uniform float uSoft;
varying vec3 vP; varying float vZ;

vec3 h3(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }

vec2 gOff = vec2(0.0); float gDark = 0.0, gSpec = 0.0, gCov = 0.0, gPx = 0.0; vec2 gL = vec2(0.0);
// a layer is dropped once its cells shrink below a few pixels, so distant water never turns into sparkling noise
float lodVis(float cs) { return 1.0 - smoothstep(0.1, 0.26, gPx / cs); }

// a water dome of radius r (m) with its centre at -d (d = point - centre, m); u = |d| / r
void dome(vec2 d, float r, float u, float k) {
  float inside = (1.0 - smoothstep(0.93, 1.0, u)) * k;
  float ring = smoothstep(0.8, 1.0, u) * (1.0 - smoothstep(1.0, 1.13, u)) * k;
  vec2 nn = d / r;
  float hgt = sqrt(max(0.0, 1.0 - u * u));
  gOff += -d * 1.45 * inside;
  gDark = max(gDark, (0.07 + 0.5 * smoothstep(0.6, 0.97, u)) * inside + 0.3 * ring);
  vec3 N3 = normalize(vec3(nn * 0.95, hgt + 0.12));
  vec3 Lh = normalize(vec3(gL * 0.7, 0.8));
  gSpec += (pow(max(dot(N3, Lh), 0.0), 26.0) * 1.5 + 0.3 * pow(max(dot(vec3(-N3.xy, N3.z), Lh), 0.0), 7.0)) * inside;
  gCov = max(gCov, max(inside, ring * 0.6));
}

// pinned drops that grow, blow out along the flow (q.y) and burst or merge when old
void bead(vec2 q, float cs, float seed, float density, float stretch, float rate) {
  if (lodVis(cs) <= 0.0) return;
  density *= lodVis(cs);
  vec2 g = q / cs, id = floor(g), f = fract(g) - 0.5;
  vec3 n = h3(id + seed), m = h3(id + seed + 17.3);
  if (n.z > density) return;
  float ph = fract(uTime * rate * (0.4 + n.x) + n.y * 9.0);
  float life = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.92, 1.0, ph));
  float r = (0.08 + 0.15 * m.z * m.z) * mix(0.35, 1.0, smoothstep(0.0, 0.85, ph)) * life;
  if (r < 0.012) return;
  vec2 d = f - (m.xy - 0.5) * 0.5;
  d.y /= (1.0 + stretch);
  float u = length(d) / r;
  if (u > 1.15) return;
  dome(d * cs, r * cs, u, lodVis(cs));
}

// a drop that releases once its weight beats the pinning (earlier when the force is high), runs and leaves a trail
void slider(vec2 q, float cs, float aspect, float seed, float density, float rate) {
  if (lodVis(cs) <= 0.0) return;
  density *= lodVis(cs);
  float H = cs * aspect;
  vec2 g = vec2(q.x / cs, q.y / H), id = floor(g), f = fract(g) - 0.5;
  vec3 n = h3(id + seed), m = h3(id + seed + 31.7);
  if (n.z > density) return;
  vec2 p = vec2(f.x * cs, f.y * H);
  float ph = fract(uTime * rate * (0.6 + 0.8 * m.x) + n.y);
  float ur = clamp(mix(0.82, 0.1, uForce) * (0.65 + 0.7 * m.y), 0.06, 0.93);
  float rm = (0.11 + 0.08 * m.z) * cs;
  float y0 = -0.36 * H, travel = 0.72 * H * (0.55 + 0.45 * m.y);
  float w = clamp((ph - ur) / (1.0 - ur), 0.0, 1.0);
  float e = w * w * (3.0 - 2.0 * w);
  float yd = y0 + travel * e;
  float cx = (n.x - 0.5) * 0.45 * cs;
  float xd = cx + sin(yd / cs * 17.0 + n.y * 6.28) * 0.05 * cs * w;
  float rr = rm * (0.5 + 0.5 * min(ph / ur, 1.0)) * (1.0 - 0.45 * w) * (1.0 - smoothstep(0.96, 1.0, ph));
  if (w > 0.0) {
    float t = clamp((p.y - y0) / max(yd - y0, 1e-4), 0.0, 1.0);
    float xt = cx + sin(p.y / cs * 17.0 + n.y * 6.28) * 0.05 * cs * (w * t);
    float tw = rr * mix(0.2, 0.34, t);
    float dx = p.x - xt;
    float inTrail = step(y0, p.y) * step(p.y, yd) * (1.0 - smoothstep(0.55, 1.0, w)) * (1.0 - smoothstep(tw * 0.55, tw, abs(dx)));
    gOff += vec2(-dx / max(tw, 1e-4), 0.0) * tw * 0.9 * inTrail;
    gDark = max(gDark, 0.13 * inTrail);
    gSpec += 0.07 * inTrail;
    gCov = max(gCov, inTrail * 0.6);
  }
  vec2 d = p - vec2(xd, yd);
  d.y /= (1.0 + 0.7 * step(0.001, w) * (0.4 + uSpeed));
  float u = length(d) / max(rr, 1e-4);
  if (rr > 1e-4 && u < 1.15) dome(d, rr, u, lodVis(cs));
}

void main() {
  vec2 p = vec2(vP.x, abs(vP.z) * 1.15 + max(0.0, 3.40 - vP.y));
  vec2 perp = vec2(-uDir.y, uDir.x);
  vec2 q = vec2(dot(p, perp), dot(p, uDir));
  gL = vec2(dot(uLightP, perp), dot(uLightP, uDir));
  gPx = length(vec2(dFdx(q.x), dFdy(q.x)));
  float side = step(0.0, vP.z) * 53.0, wet = uWet;
  if (wet > 0.01) {
    bead(q, 0.0055, 1.0 + side, clamp(wet * 1.3, 0.0, 1.0) * 0.9, uSpeed * 1.6, uRate * 1.5);
    bead(q, 0.0130, 7.0 + side, wet * 0.85, uSpeed * 2.2, uRate);
    bead(q, 0.0260, 13.0 + side, wet * 0.4, uSpeed * 2.6, uRate * 0.7);
    slider(q, 0.026, 2.5 + 4.0 * uSpeed, 21.0 + side, wet * (0.25 + 0.75 * uRain), uRate * 0.8);
    slider(q, 0.052, 2.2 + 5.0 * uSpeed, 29.0 + side, wet * 0.45 * (0.3 + 0.7 * uRain), uRate * 0.5);
  }
  if (uMode > 0.5) {
    float a = clamp(gCov * 0.38 + gDark * 0.25 + gSpec * 0.2, 0.0, 0.75);
    gl_FragColor = vec4(vec3(0.62, 0.7, 0.78) * (0.3 + gSpec * uLightI), a);
    return;
  }
  if (uSoft > 0.5) {
    float sceneW = exp2(texture2D(tDepth, gl_FragCoord.xy / uRes).r * uLogF) - 1.0;
    if (sceneW < vZ - 0.02) { gl_FragColor = vec4(0.0); return; }
  }
  // metres in the pattern plane -> screen pixels through the screen-space derivatives of the pattern coordinates
  mat2 J = mat2(dFdx(q), dFdy(q));
  float det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
  vec2 uvOff = vec2(0.0);
  if (abs(det) > 1e-12) {
    vec2 pix = (mat2(J[1][1], -J[0][1], -J[1][0], J[0][0]) / det) * gOff;
    uvOff = clamp(pix, vec2(-48.0), vec2(48.0)) / uRes;
  }
  gl_FragColor = vec4(uvOff, gSpec * uLightI, clamp(gDark, 0.0, 0.85));
}`;

export class GlassWater {
  constructor() {
    this.wet = 0; this.time = 0; this.dir = new THREE.Vector2(0, 1); this.active = false; this.mode = 0; this.meshes = [];
    this.uniforms = {
      uWet: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: 0 }, uForce: { value: 0.2 }, uRate: { value: 0.05 }, uRain: { value: 0 },
      uMode: { value: 0 }, uLogF: { value: 1 }, uLightI: { value: 1 }, uDir: { value: this.dir }, uLightP: { value: new THREE.Vector2(0.3, 0.4) },
      uRes: { value: new THREE.Vector2(1, 1) }, tDepth: { value: null }, uSoft: { value: 1 },
    };
    this.light = new THREE.Vector3(1, 1, 1);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
  }

  // glass: a mesh of the aircraft; model: the aircraft model whose object space the pattern lives in
  attach(glass, model) {
    if (!glass) return;
    model.updateMatrixWorld(true); glass.updateMatrixWorld(true);
    const local = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(glass.matrixWorld);
    const mk = (overlay) => new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uLocal: { value: local }, uMode: { value: overlay ? 1 : 0 } }, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.DoubleSide, transparent: overlay, depthWrite: !overlay, blending: overlay ? THREE.NormalBlending : THREE.NoBlending, toneMapped: false,
    });
    const mats = [mk(false), mk(true)];
    const mesh = new THREE.Mesh(glass.geometry, mats[0]);
    mesh.userData.mats = mats; mesh.renderOrder = 4; mesh.castShadow = false; mesh.receiveShadow = false;
    glass.add(mesh); this.meshes.push(mesh); this.setMode(this.mode);
  }

  // 0: refraction through the post pass; 1: alpha overlay drawn in the normal pass (Low graphics has no post pass)
  setMode(m) {
    this.mode = m;
    for (const mesh of this.meshes) { mesh.material = mesh.userData.mats[m]; mesh.layers.set(m === 0 ? DROP_LAYER : 0); mesh.visible = true; }
  }

  // dt s; rain 0..1 at the aircraft; V airspeed m/s; sun: unit vector in aircraft axes (x nose, y up, z right); near: aircraft is close to the camera
  update(dt, { rain, ground, V, sun, daylight, near }) {
    const u = this.uniforms, q = Math.min(2.5, (V / 75) ** 2);
    // catch: heavier rain and faster flight sweep more water onto the glass; hot skin boils it off
    const hot = Math.max(0, V - 240) / 400;
    if (rain > 0.03) this.wet = Math.min(1, this.wet + dt * (0.12 + 0.3 * rain) * (1 - 0.6 * hot));
    this.wet = Math.max(0, this.wet - dt * (rain > 0.03 ? 0.02 * q : 0.012 + 0.1 * q + 0.5 * hot));
    if (this.wet < 0.004) this.wet = 0;
    // forces on a drop in the glass plane (x nose, s outward down the slope): aerodynamic drag aft, gravity down the slope
    const fx = -1.7 * q, fs = 0.55, mag = Math.hypot(fx, fs);
    this.dir.x += (fx / mag - this.dir.x) * (1 - Math.exp(-dt * 1.2));
    this.dir.y += (fs / mag - this.dir.y) * (1 - Math.exp(-dt * 1.2)); this.dir.normalize();
    this.time += dt;
    u.uWet.value = this.wet; u.uTime.value = this.time; u.uRain.value = Math.min(1, rain);
    u.uSpeed.value = Math.min(1, mag / 1.8); u.uForce.value = Math.min(1, Math.max(0, (mag - 0.3) / 1.2));
    u.uRate.value = 0.03 + 0.17 * Math.min(1, Math.max(rain, this.wet * 0.5));
    u.uLightP.value.set(sun.x * 0.8, 0.35 + Math.abs(sun.z) * 0.4);
    u.uLightI.value = 0.15 + 0.85 * daylight;
    this.light.setScalar(0.6 + 0.4 * daylight);
    this.active = near && this.wet > 0.02;
    // the alpha overlay of the Low preset covers the whole glass several layers deep: with nothing on the glass there is nothing to draw
    if (this.mode === 1) for (const m of this.meshes) m.visible = this.active;
  }

  anyVisible() {
    for (const m of this.meshes) { let o = m, ok = true; while (o) { if (!o.visible) { ok = false; break; } o = o.parent; } if (ok) return true; }
    return false;
  }

  setSize(w, h) { this.rt.setSize(w, h); }

  // called by PostFX after the scene pass; returns the target holding the refraction offsets, or null when there is nothing to draw
  render(r, scene, camera, depth, logF, w, h) {
    if (this.mode !== 0 || !this.active || !this.anyVisible()) return null;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const u = this.uniforms; u.tDepth.value = depth; u.uLogF.value = logF; u.uRes.value.set(w, h);
    const mask = camera.layers.mask, ac = r.autoClear, bg = scene.background, a = r.getClearAlpha(), c = r.getClearColor(new THREE.Color());
    camera.layers.set(DROP_LAYER); r.autoClear = false; scene.background = null;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(true, true, false); r.render(scene, camera);
    camera.layers.mask = mask; r.autoClear = ac; scene.background = bg; r.setClearColor(c, a);
    return this.rt;
  }
}
