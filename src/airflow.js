import * as THREE from 'three';

// Visible airflow around the jet, driven by what the flight model says the air is doing:
//  * wingtip and chine vortices: vortex cores drop below the dew point and show as vapour ropes once the wing is loaded (high angle of
//    attack or load factor) in humid air at low level, like the vapour streaming off a delta wing on landing or in a hard turn;
//  * engine contrails: the exhaust freezes into ice trails in cold air (about 7 to 16 km), longer and denser the more humid it is;
//  * transonic condensation: a vapour sheath that forms over the wing and fuselage around Mach 1 in humid air, where the air expands
//    and cools (the Prandtl-Glauert cloud).
// Trails are particles left in the air, so they hang where the jet passed, are blown by the wind and spread as they age.
const VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aA, aS, aR;
uniform float uPx; varying float vA, vR;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float z = max(-mv.z, 0.2), px = aS * uPx * projectionMatrix[1][1] / z;
  gl_PointSize = clamp(px, 0.0, 420.0);
  vA = aA * smoothstep(0.0, 1.0, z / max(aS * 1.5, 1.0)) * step(0.6, px);
  vR = aR;
  #include <logdepthbuf_vertex>
}`;
const FRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; varying float vA, vR;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0; float c = cos(vR * 6.2832), s = sin(vR * 6.2832); q = mat2(c, -s, s, c) * q;
  float r = length(q); if (r > 1.0) discard;
  float w = n2(q * 3.0 + vR * 17.0) * 0.6 + n2(q * 7.0 + vR * 5.0) * 0.4;
  float a = (1.0 - smoothstep(0.2 + 0.35 * w, 1.0, r)) * (0.5 + 0.7 * w) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol * (0.82 + 0.28 * w), a);
}`;

const D2R = Math.PI / 180, sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Airflow {
  constructor(scene) {
    this.N = 6000; this.i = 0;
    const N = this.N;
    this.abs = new Float64Array(N * 3); this.rel = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).fill(1e9); this.life = new Float32Array(N).fill(1); this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N); this.drag = new Float32Array(N); this.sink = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rel, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(N), 1)); g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('aR', new THREE.BufferAttribute(Float32Array.from({ length: N }, () => Math.random()), 1));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, uniforms: { uPx: { value: 500 }, uCol: { value: new THREE.Color(0.9, 0.93, 1) } }, vertexShader: VERT, fragmentShader: FRAG });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 8; scene.add(this.pts); this.g = g;
    this.em = { tipL: {}, tipR: {}, chL: {}, chR: {}, nzL: {}, nzR: {} };
    this.p = new THREE.Vector3(); this.q = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.gv = null; this.sprites = null; this.force = null; this.state = { vortex: 0, contrail: 0, mach: 0 };
  }

  clear() { this.age.fill(1e9); for (const k in this.em) this.em[k] = {}; }

  emit(x, y, z, vx, vy, vz, life, s0, s1, a0, drag, sink = 0) {
    const k = this.i++ % this.N, j = k * 3;
    this.abs[j] = x; this.abs[j + 1] = y; this.abs[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.age[k] = 0; this.life[k] = life; this.s0[k] = s0; this.s1[k] = s1; this.a0[k] = a0; this.drag[k] = drag; this.sink[k] = sink;
  }

  // lay puffs every `spacing` metres along the path the emitter travelled this frame
  trail(e, p, spacing, fn) {
    if (!e.last) { e.last = p.clone(); e.acc = 0; return; }
    const d = p.distanceTo(e.last);
    if (d > 3000 || d < 1e-4) { e.last.copy(p); e.acc = 0; return; }
    let need = spacing - e.acc, n = 0;
    while (need <= d && n++ < 60) { const t = need / d; fn(e.last.x + (p.x - e.last.x) * t, e.last.y + (p.y - e.last.y) * t, e.last.z + (p.z - e.last.z) * t); need += spacing; }
    e.acc = d - (need - spacing); e.last.copy(p);
  }

  // c: { fdm, model, camWorld, humidity, daylight, px, geoVersion, wind: {x, z} m/s }
  update(dt, c) {
    const { fdm, model, camWorld: cw } = c, out = fdm.out || {}, V = out.V || 0;
    if (c.geoVersion !== this.gv) { this.gv = c.geoVersion; this.clear(); }
    this.mat.uniforms.uPx.value = c.px;
    this.mat.uniforms.uCol.value.setRGB(0.93, 0.95, 1).multiplyScalar(0.07 + 0.93 * c.daylight);
    const alt = fdm.pos.y, H = Math.min(1, Math.max(0, c.humidity)), F = this.force || {};
    const alphaDeg = Math.abs(out.alpha || 0) / D2R, nz = out.nz || 1, M = out.M || 0, thr = fdm.crashed ? 0 : Math.max(0.25, fdm.throttle);
    // strengths 0..1
    const lowAir = 1 - sm(4500, 9000, alt);
    const vortex = F.vortex ?? Math.min(1, H * lowAir * (0.85 * sm(3.5, 12, alphaDeg) + 0.6 * sm(1.5, 3.2, nz)) * sm(35, 70, V) * (fdm.onGround ? 0 : 1));
    const contrail = F.contrail ?? Math.min(1, (0.25 + 0.75 * H) * sm(6500, 9500, alt) * (1 - sm(15000, 19500, alt)) * thr * (V > 60 ? 1 : 0));
    const mach = F.mach ?? Math.min(1, H * lowAir * Math.exp(-(((M - 1.0) / 0.085) ** 2)) * 1.4);
    Object.assign(this.state, { vortex, contrail, mach });
    if (dt > 0 && model) {
      (model.parent || model).updateMatrixWorld(true); // this frame's root position, not last frame's render
      const at = (x, y, z) => this.p.set(x, y, z).applyMatrix4(model.matrixWorld).add(cw);
      const vel = fdm.vel, sp = Math.max(V, 1), em = this.em;
      // wingtip vortex ropes: thin, bright, tight; left in the air where the tip passed
      if (vortex > 0.04) {
        const sx = Math.max(1.4, sp * 0.012); // dense enough that the puffs overlap into one continuous rope
        for (const [key, z] of [['tipL', -8.45], ['tipR', 8.45]]) this.trail(em[key], at(-11.0, 2.05, z), sx, (x, y, zz) =>
          this.emit(x, y, zz, vel.x * 0.05, vel.y * 0.05 + 0.3, vel.z * 0.05, 3 + 3 * vortex, 0.45, 3.5 + 4 * vortex, 0.2 * vortex, 0.6, 0));
        // chine vortices: the vapour that streams back over the wing from the forward fuselage edge
        for (const [key, z] of [['chL', -1.75], ['chR', 1.75]]) this.trail(em[key], at(3.0, 2.55, z * 0.9), sx * 0.7, (x, y, zz) =>
          this.emit(x, y, zz, vel.x * 0.82, vel.y * 0.82, vel.z * 0.82, 1.1 + 0.9 * vortex, 0.7, 3.2, 0.14 * vortex, 3.2, 0));
      } else { em.tipL.last = em.tipR.last = em.chL.last = em.chR.last = null; }
      // engine contrails: wide, slow to fade, they hang and spread
      if (contrail > 0.04) {
        const sx = Math.max(16, sp * 0.034);
        for (const [i, key] of [[0, 'nzL'], [1, 'nzR']]) { const nz2 = i ? 4.3 : -4.3; this.trail(em[key], at(-14.2, 2.2, nz2), sx, (x, y, zz) =>
          this.emit(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, zz + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2 + (c.wind ? c.wind.x : 0), (Math.random() - 0.5) * 0.6 - 0.35, (Math.random() - 0.5) * 2 + (c.wind ? c.wind.z : 0), 30 + 20 * contrail, 9, 60 + 40 * contrail, 0.3 * contrail, 0.45, 0.3)); }
      } else { em.nzL.last = em.nzR.last = null; }
    }
    // age and move the puffs
    const A = this.g.attributes.aA.array, S = this.g.attributes.aS.array;
    for (let k = 0; k < this.N; k++) {
      const j = k * 3;
      if (this.age[k] >= this.life[k]) { A[k] = 0; this.rel[j] = this.rel[j + 1] = this.rel[j + 2] = 0; continue; }
      this.age[k] += dt; const f = Math.min(1, this.age[k] / this.life[k]), dr = Math.exp(-dt * this.drag[k]);
      this.vel[j] *= dr; this.vel[j + 1] = this.vel[j + 1] * dr - this.sink[k] * dt; this.vel[j + 2] *= dr;
      this.abs[j] += this.vel[j] * dt; this.abs[j + 1] += this.vel[j + 1] * dt; this.abs[j + 2] += this.vel[j + 2] * dt;
      this.rel[j] = this.abs[j] - cw.x; this.rel[j + 1] = this.abs[j + 1] - cw.y; this.rel[j + 2] = this.abs[j + 2] - cw.z;
      A[k] = this.a0[k] * Math.pow(1 - f, 1.3) * Math.min(1, this.age[k] / Math.min(0.25, 0.04 * this.life[k])); S[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * Math.sqrt(f);
    }
    this.g.attributes.position.needsUpdate = this.g.attributes.aA.needsUpdate = this.g.attributes.aS.needsUpdate = true;
    this.updateSprites(model, c);
  }

  // transonic condensation: soft vapour sheets lying over the wing, tail and nacelles, attached to the airframe
  updateSprites(model, c) {
    if (!model) return;
    if (!this.sprites) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
      for (let k = 0; k < 40; k++) { const px = 64 + (Math.random() - 0.5) * 56, py = 64 + (Math.random() - 0.5) * 56, r = 14 + Math.random() * 30, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      this.sprites = [];
      const spots = [[-3, 2.55, 1.6, 5], [-3, 2.55, -1.6, 5], [-6.5, 2.4, 3.2, 6], [-6.5, 2.4, -3.2, 6], [-9, 2.4, 2.2, 5], [-9, 2.4, -2.2, 5], [-7, 3.1, 4.3, 4.5], [-7, 3.1, -4.3, 4.5], [1.5, 2.9, 0.9, 4], [1.5, 2.9, -0.9, 4], [-11.5, 2.2, 6, 5], [-11.5, 2.2, -6, 5], [8, 3.5, 0, 3.5]];
      for (const [x, y, z, sc] of spots) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff, toneMapped: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor }));
        sp.position.set(x, y, z); sp.scale.setScalar(sc); sp.userData.base = sc; sp.userData.ph = Math.random() * 6; sp.renderOrder = 7; sp.visible = false; model.add(sp); this.sprites.push(sp);
      }
    }
    const m = this.state.mach, t = performance.now() / 1000, day = 0.1 + 0.9 * c.daylight;
    for (const sp of this.sprites) {
      sp.visible = m > 0.02; if (!sp.visible) continue;
      const flick = 0.75 + 0.25 * Math.sin(t * 3.1 + sp.userData.ph);
      sp.material.opacity = Math.min(0.55, m * flick * 0.7); sp.material.color.setScalar(day); sp.scale.setScalar(sp.userData.base * (0.9 + 0.2 * Math.sin(t * 1.7 + sp.userData.ph)));
    }
  }
}
