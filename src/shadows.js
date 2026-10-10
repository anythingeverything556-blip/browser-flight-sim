import * as THREE from 'three';

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
  float s = 1.0;
  vec3 c = (uShM0 * vec4(rel + n * uShB.y * 1.5, 1.0)).xyz; c.z -= uShZ.x;
  if (wsIn(c)) s = wsPcf(uSh0, c, uShB.x);
  else {
    c = (uShM1 * vec4(rel + n * uShB.z * 1.5, 1.0)).xyz; c.z -= uShZ.y;
    if (uShP.x > 1.5 && wsIn(c)) s = wsPcf(uSh1, c, uShB.x);
    else {
      c = (uShM2 * vec4(rel + n * uShB.w * 1.5, 1.0)).xyz; c.z -= uShZ.z;
      if (uShP.x > 2.5 && wsIn(c)) s = wsPcf(uSh2, c, uShB.x);
    }
  }
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
      (this.fresh = [!1, !1, !1]));
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
      u = THREE.MathUtils.smoothstep(a.y, 0, 0.08);
    if (((this.active = this.count > 0 && r < 6e3 && u > 0), !this.active)) {
      ((h.x = 0), (this.fresh = [!1, !1, !1]));
      return;
    }
    this.frame++;
    const f = Math.max(1, r / 150),
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
    const _ = this._swap;
    _.length = 0;
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
      if (((S = D * 0.9), this.fresh[E] && this.frame % (1 << E))) continue;
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
