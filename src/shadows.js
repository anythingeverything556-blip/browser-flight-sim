import * as THREE from 'three';
import { stat } from './workstats.js';

const SHADOW_LAYER = 2,
  SHADOW_UNIFORMS = {
    uSh0: { value: null },
    uSh1: { value: null },
    uSh2: { value: null },
    uShM0: { value: new THREE.Matrix4() },
    uShM1: { value: new THREE.Matrix4() },
    uShM2: { value: new THREE.Matrix4() },
    uShP: { value: new THREE.Vector4(0, 1, 2, 0) },
    uShB: { value: new THREE.Vector4() },
    uShZ: { value: new THREE.Vector3() },
  },
  sd = `
#ifdef WORLD_SHADOWS
uniform highp sampler2DShadow uSh0, uSh1, uSh2;
uniform mat4 uShM0, uShM1, uShM2;
uniform vec4 uShP, uShB; uniform vec3 uShZ;
float wsPcf(highp sampler2DShadow m, vec3 c, float t) {
  // four bilinear compare taps on a rotated grid: a soft 4x4-texel footprint
  return 0.25 * (texture(m, vec3(c.xy + vec2(-0.5, -1.5) * t, c.z)) + texture(m, vec3(c.xy + vec2(1.5, -0.5) * t, c.z))
               + texture(m, vec3(c.xy + vec2(0.5, 1.5) * t, c.z)) + texture(m, vec3(c.xy + vec2(-1.5, 0.5) * t, c.z)));
}
bool wsIn(vec3 c) { return all(greaterThan(c, vec3(0.004, 0.004, 0.0))) && all(lessThan(c, vec3(0.996, 0.996, 1.0))); }
// rel: camera-relative world position (curvature applied), n: unit world normal. 1 = sunlit, 0 = shadowed.
float worldShadow(vec3 rel, vec3 n) {
  if (uShP.x < 0.5 || uShP.w <= 0.0) return 1.0;
  float d = length(rel);
  if (d > uShP.z) return 1.0;
  // cascades blend into the next one across the outer 8 % of their map, so the edge of a cascade is not a visible seam that crawls
  float s = 1.0;
  vec3 c0 = (uShM0 * vec4(rel + n * uShB.y * 1.5, 1.0)).xyz; c0.z -= uShZ.x;
  vec3 c1 = (uShM1 * vec4(rel + n * uShB.z * 1.5, 1.0)).xyz; c1.z -= uShZ.y;
  vec3 c2 = (uShM2 * vec4(rel + n * uShB.w * 1.5, 1.0)).xyz; c2.z -= uShZ.z;
  bool i0 = wsIn(c0), i1 = uShP.x > 1.5 && wsIn(c1), i2 = uShP.x > 2.5 && wsIn(c2);
  float s0 = i0 ? wsPcf(uSh0, c0, uShB.x) : 1.0;
  if (i0) {
    float e0 = min(min(c0.x, 1.0 - c0.x), min(c0.y, 1.0 - c0.y)), w0 = smoothstep(0.0, 0.08, e0);
    s = s0;
    if (w0 < 1.0) { float s1 = i1 ? wsPcf(uSh1, c1, uShB.x) : 1.0; s = mix(s1, s0, w0); }
  } else if (i1) {
    float e1 = min(min(c1.x, 1.0 - c1.x), min(c1.y, 1.0 - c1.y)), w1 = smoothstep(0.0, 0.08, e1);
    float s1 = wsPcf(uSh1, c1, uShB.x); s = s1;
    if (w1 < 1.0) { float s2 = i2 ? wsPcf(uSh2, c2, uShB.x) : 1.0; s = mix(s2, s1, w1); }
  } else if (i2) s = wsPcf(uSh2, c2, uShB.x);
  return mix(1.0, s, (1.0 - smoothstep(uShP.y, uShP.z, d)) * uShP.w);
}
#else
float worldShadow(vec3 rel, vec3 n) { return 1.0; }
#endif
`,
  Nb = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1),
  qp = 900;
class WorldShadows {
  constructor(t, e) {
    this.roots = t;
    const n = new THREE.DepthTexture(1, 1, 1015);
    ((n.compareFunction = 515),
      (n.minFilter = n.magFilter = 1006),
      (this.dummy = new THREE.WebGLRenderTarget(1, 1, { depthTexture: n, format: 1028, generateMipmaps: !1 })));
    const i = e.getRenderTarget();
    (e.setRenderTarget(this.dummy), e.clear(!0, !0, !1), e.setRenderTarget(i));
    for (const r of ['uSh0', 'uSh1', 'uSh2']) SHADOW_UNIFORMS[r].value = n;
    ((this.count = 0),
      (this.size = 0),
      (this.splits = []),
      (this.cams = [0, 1, 2].map(() => {
        const r = new THREE.OrthographicCamera();
        return (r.layers.set(SHADOW_LAYER), r);
      })),
      (this.rts = []),
      (this.active = !1),
      (this._q = new THREE.Quaternion()),
      (this._qi = new THREE.Quaternion()),
      (this._v = new THREE.Vector3()),
      (this._f = new THREE.Vector3()),
      (this._swap = []),
      (this.frame = 0),
      (this.mats = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()]),
      (this.ats = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
      (this._m = new THREE.Matrix4()),
      (this.fresh = [!1, !1, !1]),
      (this.lastFrame = [0, 0, 0]),
      (this.sunAt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
      (this.sigAt = [0, 0, 0]),
      (this.R = [0, 0, 0]),
      (this.fwdAt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
      (this.fovAt = [0, 0, 0]),
      (this.stats = { drawn: 0, skipped: 0 }));
  }
  // cheap signature of what the casters are: changes when a tile, tree chunk or building mesh is added, removed or shown/hidden
  casterSig() {
    let n = 0;
    for (const r of this.roots) {
      for (const c of r.children) n += c.visible ? 1 + (c.children.length << 8) : 0;
      n = (n * 31 + r.children.length) % 2147483647;
    }
    return n;
  }
  // Does cascade E need to be drawn again? A cascade is a depth map of fixed world geometry snapped to its texel grid, and the stale path
  // below already shifts it exactly with the camera, so it only has to be redrawn when something it shows has really changed:
  //   - the camera got close to the edge of what it covers, - the sun moved by more than a fraction of a texel over a caster height,
  //   - the set of casters changed (rate limited), - the moving aircraft may be in it (the two inner cascades, near the ground).
  needsRefresh(E, cam, sunDir, sig, agl, fwd, fov) {
    if (!this.fresh[E] || this.every === 0) return true;
    const age = this.frame - this.lastFrame[E], R = this.R[E], k = this.every || 1;
    if (age >= (E === 0 ? 1 : E === 1 ? 24 : 90) * k) return true;
    if (E === 0) return true; // holds the aircraft and the finest ground shadows: every frame
    if (E === 1 && agl < 600 && age >= 2 * k) return true; // aircraft shadow lands in cascade 1 near the ground
    if (cam.distanceToSquared(this.ats[E]) > (0.05 * R) ** 2) return true;
    // the slices follow where the camera looks: a head turn or a zoom moves what must be covered
    if (fwd.dot(this.fwdAt[E]) < 0.9992 || Math.abs(fov - this.fovAt[E]) > 0.5) return true;
    if (sunDir.dot(this.sunAt[E]) < Math.cos(0.5 * (2 * R / this.size) / 80)) return true;
    if (sig !== this.sigAt[E] && age >= (E === 1 ? 4 : 8) * k) return true;
    return false;
  }
  configure(t, e, n) {
    if (((this.count = t), (this.splits = n), e !== this.size)) {
      for (const r of this.rts) (r.depthTexture.dispose(), r.dispose());
      ((this.rts = []), (this.size = e));
    }
    for (this.fresh = [!1, !1, !1]; this.rts.length < t;) {
      const r = new THREE.DepthTexture(e, e, 1015);
      ((r.compareFunction = 515),
        (r.minFilter = r.magFilter = 1006),
        this.rts.push(
          new THREE.WebGLRenderTarget(e, e, { depthTexture: r, format: 1028, type: 1009, generateMipmaps: !1 }),
        ));
    }
    const i = SHADOW_UNIFORMS;
    (['uSh0', 'uSh1', 'uSh2'].forEach((r) => {
      i[r].value = this.dummy.depthTexture;
    }),
      t || ((i.uShP.value.x = 0), (this.active = !1)));
  }
  update(t, e, n, i, r, a) {
    const l = SHADOW_UNIFORMS,
      h = l.uShP.value,
      // fade the shadows out between 4.2 and 6 km above the ground instead of switching them off at 6 km
      u = THREE.MathUtils.smoothstep(a.y, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(r, 4200, 6000));
    if (((this.active = this.count > 0 && u > 0.002), !this.active)) {
      ((h.x = 0), (this.fresh = [!1, !1, !1]));
      return;
    }
    this.frame++;
    // cascade size follows altitude in steps: a size that changed every frame would defeat the texel snapping and make shadows crawl
    // with hysteresis: climbing past a step grows the cascades at once (they must still cover the view), but they only shrink again once
    // well below it, so hovering around a step height cannot flip the whole shadow map between two scales every frame
    const kRaw = Math.log(Math.max(1, r / 150)) / Math.log(1.3);
    let kStep = this._k === undefined ? Math.ceil(kRaw) : this._k;
    if (kRaw > kStep || kRaw < kStep - 1.7) kStep = Math.ceil(kRaw);
    if (kStep !== this._k) { this._k = kStep; this.fresh = [!1, !1, !1]; } // every cascade redraws at the new scale together
    const f = Math.pow(1.3, kStep),
      d = [];
    for (let E = 0; E < this.count; E++) d.push(Math.min(1e4, this.splits[E] * f));
    const p = Math.tan(THREE.MathUtils.degToRad(n.fov) / 2),
      v = p * n.aspect,
      y = v * v + p * p,
      x = this._f.set(0, 0, -1).applyQuaternion(n.quaternion),
      g = this.cams[0];
    (g.position.copy(a),
      g.up.set(0, 1, 0),
      Math.abs(a.y) > 0.99 && g.up.set(0, 0, 1),
      g.lookAt(0, 0, 0),
      this._q.copy(g.quaternion),
      this._qi.copy(this._q).invert());
    const _ = this._swap, sig = this.casterSig(), need = [];
    _.length = 0;
    for (let E = 0; E < this.count; E++) need.push(this.needsRefresh(E, i, a, sig, r, x, n.fov));
    if (need.includes(true))
      for (const E of this.roots)
        E.traverseVisible((A) => {
          A.userData.casterMat && (_.push(A, A.material), (A.material = A.userData.casterMat));
        });
    const w = t.getRenderTarget(),
      b = t.shadowMap.autoUpdate;
    t.shadowMap.autoUpdate = !1;
    let S = n.near;
    for (let E = 0; E < this.count; E++) {
      const A = S,
        D = d[E];
      S = D * 0.9;
      if (!need[E]) {
        // a cascade that is not redrawn this frame is still correct in world space, but its matrix is relative to where the camera was
        // when it was drawn: shift it by the camera's movement since, or it slides against the scene at flight speed
        l[`uShM${E}`].value.copy(this.mats[E]).multiply(this._m.makeTranslation(i.x - this.ats[E].x, i.y - this.ats[E].y, i.z - this.ats[E].z));
        this.stats.skipped++; stat.skip('shadow' + E);
        continue;
      }
      this.stats.drawn++; stat.did('shadow' + E);
      this.fresh[E] = !0;
      const N = Math.min(D, (D + A) * 0.5 * (1 + y)),
        R = Math.sqrt((D - N) ** 2 + D * D * y),
        C = (2 * R) / this.size,
        F = this._v.copy(x).multiplyScalar(N).add(i).applyQuaternion(this._qi);
      ((F.x = Math.round(F.x / C) * C), (F.y = Math.round(F.y / C) * C), F.applyQuaternion(this._q).sub(i));
      const k = this.cams[E];
      (k.quaternion.copy(this._q),
        k.position.copy(F).addScaledVector(a, R + qp),
        (k.left = -R),
        (k.right = R),
        (k.top = R),
        (k.bottom = -R),
        (k.near = 1),
        (k.far = 2 * R + qp + 200),
        k.updateProjectionMatrix(),
        k.updateMatrixWorld(!0),
        t.setRenderTarget(this.rts[E]),
        t.clear(!0, !0, !1),
        t.render(e, k),
        (l[`uSh${E}`].value = this.rts[E].depthTexture),
        l[`uShM${E}`].value.multiplyMatrices(Nb, k.projectionMatrix).multiply(k.matrixWorldInverse),
        this.mats[E].copy(l[`uShM${E}`].value),
        this.ats[E].copy(i), this.sunAt[E].copy(a), (this.sigAt[E] = sig), (this.lastFrame[E] = this.frame), (this.R[E] = R), this.fwdAt[E].copy(x), (this.fovAt[E] = n.fov),
        l.uShB.value.setComponent(E + 1, C),
        l.uShZ.value.setComponent(E, (C * 1.2 + 0.05) / (k.far - k.near)));
    }
    (t.setRenderTarget(w), (t.shadowMap.autoUpdate = b));
    for (let E = 0; E < _.length; E += 2) _[E].material = _[E + 1];
    ((l.uShB.value.x = 1 / this.size), h.set(this.count, d[this.count - 1] * 0.8, d[this.count - 1], u));
  }
  dispose() {
    for (const t of this.rts) (t.depthTexture.dispose(), t.dispose());
    this.rts = [];
  }
}

export { SHADOW_LAYER, SHADOW_UNIFORMS, WorldShadows, sd };
