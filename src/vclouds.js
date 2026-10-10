import * as THREE from 'three';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';

const Mm = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  cu = 7e4;
function W0(s) {
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}
function ra(s, t, e) {
  const n = W0(e),
    i = new Float32Array(t ** 3 * 3).map(() => n()),
    r = new Float32Array(s ** 3),
    a = (l) => ((l % t) + t) % t;
  for (let l = 0, h = 0; l < s; l++)
    for (let u = 0; u < s; u++)
      for (let f = 0; f < s; f++, h++) {
        const d = ((f + 0.5) / s) * t,
          p = ((u + 0.5) / s) * t,
          v = ((l + 0.5) / s) * t,
          y = Math.floor(d),
          x = Math.floor(p),
          g = Math.floor(v);
        let _ = 9;
        for (let w = -1; w <= 1; w++)
          for (let b = -1; b <= 1; b++)
            for (let S = -1; S <= 1; S++) {
              const E = (a(g + w) * t * t + a(x + b) * t + a(y + S)) * 3,
                A = y + S + i[E] - d,
                D = x + b + i[E + 1] - p,
                N = g + w + i[E + 2] - v,
                R = A * A + D * D + N * N;
              R < _ && (_ = R);
            }
        r[h] = 1 - Math.min(1, Math.sqrt(_));
      }
  return r;
}
function wm(s, t, e) {
  const n = W0(e),
    i = new Float32Array(t ** 3).map(() => n()),
    r = new Float32Array(s ** 3),
    a = (h, u, f) => i[(((f % t) + t) % t) * t * t + (((u % t) + t) % t) * t + (((h % t) + t) % t)],
    l = (h) => h * h * (3 - 2 * h);
  for (let h = 0, u = 0; h < s; h++)
    for (let f = 0; f < s; f++)
      for (let d = 0; d < s; d++, u++) {
        const p = (d / s) * t,
          v = (f / s) * t,
          y = (h / s) * t,
          x = Math.floor(p),
          g = Math.floor(v),
          _ = Math.floor(y),
          w = l(p - x),
          b = l(v - g),
          S = l(y - _),
          E = a(x, g, _) + (a(x + 1, g, _) - a(x, g, _)) * w,
          A = a(x, g + 1, _) + (a(x + 1, g + 1, _) - a(x, g + 1, _)) * w,
          D = a(x, g, _ + 1) + (a(x + 1, g, _ + 1) - a(x, g, _ + 1)) * w,
          N = a(x, g + 1, _ + 1) + (a(x + 1, g + 1, _ + 1) - a(x, g + 1, _ + 1)) * w;
        r[u] = E + (A - E) * b + (D + (N - D) * b - (E + (A - E) * b)) * S;
      }
  return r;
}
function bm(s, t) {
  const e = new Float32Array(s ** 3);
  for (const [l, h] of t) for (let u = 0; u < e.length; u++) e[u] += l[u] * h;
  let n = 1e9,
    i = -1e9;
  for (const l of e) (l < n && (n = l), l > i && (i = l));
  const r = new Uint8Array(e.length);
  for (let l = 0; l < e.length; l++) r[l] = Math.round(((e[l] - n) / (i - n)) * 255);
  const a = new THREE.Data3DTexture(r, s, s, s);
  return (
    (a.format = 1028),
    (a.type = 1009),
    (a.unpackAlignment = 1),
    (a.wrapS = a.wrapT = a.wrapR = 1e3),
    (a.minFilter = a.magFilter = 1006),
    (a.generateMipmaps = !1),
    (a.needsUpdate = !0),
    a
  );
}
const G2 = `
uniform highp sampler2D tDepth; uniform highp sampler3D tShape, tDetail;
uniform mat4 uProjInv, uCamRot; uniform vec3 uCamFwd; uniform vec2 uOff;
uniform float uLogF, uCamAlt, uBase, uTop, uCover;
varying vec2 vUv;
${ATM_FRAG}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
// large-scale coverage: where clouds cluster and where gaps open
float weather(vec2 xz) { vec2 p = xz / 26000.0; return 0.55 * vn2(p) + 0.3 * vn2(p * 2.7 + 7.1) + 0.15 * vn2(p * 6.3 + 3.3); }
float density(vec3 rel, float h, bool fine) {
  float hn = (h - uBase) / (uTop - uBase);
  if (hn <= 0.0 || hn >= 1.0) return 0.0;
  vec3 wp = vec3(rel.x + uOff.x, h, rel.z + uOff.y);
  float cov = clamp(uCover * (0.45 + 1.1 * weather(wp.xz)), 0.0, 1.0);
  float top = mix(0.4, 1.0, cov); // sparse cumulus stay low, heavy cover builds up
  float prof = smoothstep(0.0, 0.08, hn) * (1.0 - smoothstep(top * 0.45, top, hn));
  // two lookups at non-commensurate scales, the second rotated, so the 64^3 tile never shows as a grid from altitude
  vec3 wr = vec3(0.8 * wp.x - 0.6 * wp.z, wp.y, 0.6 * wp.x + 0.8 * wp.z);
  float s = texture(tShape, wp * vec3(1.0 / 5600.0, 1.0 / 3800.0, 1.0 / 5600.0)).r * 0.62
          + texture(tShape, wr * vec3(1.0 / 14300.0, 1.0 / 5100.0, 1.0 / 14300.0) + 0.37).r * 0.38;
  float d = clamp((s * prof - (1.0 - cov)) / max(cov, 0.1), 0.0, 1.0);
  if (fine && d > 0.0) {
    float e = texture(tDetail, wp / 900.0).r;
    d = clamp((d - e * 0.55 * (1.0 - d)) * 2.0, 0.0, 1.0); // wispy, billowy edges; cores stay solid
  }
  return d;
}
void main() {
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(mat3(uCamRot) * (v.xyz / v.w));
  float dz = texture2D(tDepth, vUv).r;
  float sceneT = dz > 0.99999 ? 1e12 : (exp2(dz * uLogF) - 1.0) / max(dot(dir, uCamFwd), 1e-4);
  vec3 O = vec3(0.0, ATM_RP + uCamAlt, 0.0);
  vec2 si = atmRaySphere(O, dir, ATM_RP + uBase), so = atmRaySphere(O, dir, ATM_RP + uTop), sg = atmRaySphere(O, dir, ATM_RP);
  float t0, t1;
  if (uCamAlt < uBase) { t0 = si.y; t1 = sg.x > 0.0 ? -1.0 : so.y; }
  else if (uCamAlt < uTop) { t0 = 0.0; t1 = si.x > 0.0 ? si.x : so.y; }
  else { t0 = so.x; t1 = so.x < 0.0 ? -1.0 : (si.x > 0.0 ? si.x : so.y); }
  t1 = min(t1, min(sceneT, t0 + ${cu}.0));
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float L = t1 - t0, j = h21(gl_FragCoord.xy * 1.37 + 17.0); // white-noise jitter: IGN's diagonal pattern shows as stripes once upsampled
  float cosT = dot(dir, uAtmSun), ph = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
  vec3 sunC = uAtmSunCol * 2.0, ambC = uAtmAmb * 3.14159 * 0.9;
  float T = 1.0, tw = 0.0, ts = 0.0; vec3 S = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    // samples bunch up near the entry point, where detail is visible
    float u = (float(i) + j) / float(STEPS), t = t0 + L * u * u, dt = L * (2.0 * u + 1.0 / float(STEPS)) / float(STEPS);
    vec3 p = dir * t; float h = length(O + p) - ATM_RP;
    float d = density(p, h, true);
    if (d > 0.003) {
      float sig = 0.05 * d, od = 0.0, ls = 60.0; vec3 q = p;
      for (int k = 0; k < LSTEPS; k++) { q += uAtmSun * ls; od += density(q, length(O + q) - ATM_RP, false) * ls; ls *= 1.9; }
      float Tl = exp(-0.05 * od), hn = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
      // single scattering + a cheap multiple-scattering floor (keeps cloud interiors from going black)
      vec3 Lsc = sunC * (ph * Tl + 0.03 * pow(Tl, 0.25)) + ambC * (0.5 + 0.5 * hn) + uAtmNight * 0.5;
      float ext = exp(-sig * dt), a = T * (1.0 - ext);
      S += Lsc * a; ts += a * t; tw += a;
      T *= ext;
      if (T < 0.02) break;
    }
  }
  if (tw < 1e-4) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float tm = ts / tw, a = (1.0 - T) * (1.0 - smoothstep(${cu * 0.55}.0, ${cu}.0, tm - t0));
  vec3 col = atmAerial(atmTone(S / tw), dir * tm);
  gl_FragColor = vec4(col * a, 1.0 - a);
}`,
  V2 = `
uniform sampler2D tLow; uniform highp sampler2D tDepth; uniform vec2 uLowRes; uniform float uLogF;
varying vec2 vUv;
float lz(vec2 uv) { return texture2D(tDepth, uv).r * uLogF; } // log2(1 + w): depth comparisons in log space
void main() {
  float zc = lz(vUv);
  vec2 st = vUv * uLowRes - 0.5, i0 = floor(st + 0.5);
  vec4 acc = vec4(0.0); float ws = 0.0;
  // 3x3 tent around the nearest low-res texel: upsamples and smooths the march jitter in one pass
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = i0 + vec2(float(i), float(j)), cuv = (c + 0.5) / uLowRes, dd = abs(c - st);
    float wb = max(0.0, 1.5 - dd.x) * max(0.0, 1.5 - dd.y);
    float w = wb / (0.02 + abs(lz(cuv) - zc)) + 1e-5;
    acc += texture2D(tLow, cuv) * w; ws += w;
  }
  gl_FragColor = acc / ws;
}`;
class VolumetricClouds {
  constructor(t) {
    ((this.renderer = t),
      (this.w = 1),
      (this.h = 1),
      (this.scale = 0.5),
      (this.steps = 0),
      (this.lightSteps = 0),
      (this.lowRT = new THREE.WebGLRenderTarget(1, 1, { type: 1016, depthBuffer: !1 })),
      (this.outRT = new THREE.WebGLRenderTarget(1, 1, { type: 1016, depthBuffer: !1 })),
      (this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))),
      (this.quad.frustumCulled = !1),
      (this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)),
      (this.march = null),
      (this.tex = null),
      (this.up = new THREE.ShaderMaterial({
        uniforms: {
          tLow: { value: null },
          tDepth: { value: null },
          uLowRes: { value: new THREE.Vector2() },
          uLogF: { value: 1 },
        },
        vertexShader: Mm,
        fragmentShader: V2,
        depthTest: !1,
        depthWrite: !1,
      })),
      (this._fwd = new THREE.Vector3()));
  }
  _noise() {
    this.tex = {
      shape: bm(64, [
        [ra(64, 4, 11), 0.45],
        [ra(64, 8, 23), 0.25],
        [wm(64, 8, 5), 0.2],
        [wm(64, 16, 9), 0.1],
      ]),
      detail: bm(32, [
        [ra(32, 4, 31), 0.55],
        [ra(32, 8, 41), 0.3],
        [ra(32, 16, 53), 0.15],
      ]),
    };
  }
  setQuality({ scale: t = 0.5, steps: e = 48, lightSteps: n = 5 }) {
    ((this.scale = t),
      (e !== this.steps || n !== this.lightSteps || !this.march) &&
        ((this.steps = e),
        (this.lightSteps = n),
        this.march && this.march.dispose(),
        (this.march = new THREE.ShaderMaterial({
          defines: { STEPS: e, LSTEPS: n },
          uniforms: {
            ...ATMOS_UNIFORMS,
            tDepth: { value: null },
            tShape: { value: null },
            tDetail: { value: null },
            uProjInv: { value: new THREE.Matrix4() },
            uCamRot: { value: new THREE.Matrix4() },
            uCamFwd: { value: new THREE.Vector3() },
            uOff: { value: new THREE.Vector2() },
            uLogF: { value: 1 },
            uCamAlt: { value: 0 },
            uBase: { value: 2e3 },
            uTop: { value: 3500 },
            uCover: { value: 0.3 },
          },
          vertexShader: Mm,
          fragmentShader: G2,
          depthTest: !1,
          depthWrite: !1,
        }))),
      this.setSize(this.w, this.h));
  }
  setSize(t, e) {
    ((this.w = t),
      (this.h = e),
      this.lowRT.setSize(Math.max(1, Math.round(t * this.scale)), Math.max(1, Math.round(e * this.scale))),
      this.outRT.setSize(t, e));
  }
  render(t, { camera: e, depthTexture: n, camAlt: i, camXZ: r, coverage: a, base: l, time: h, wind: u }) {
    (this.march || this.setQuality({}), this.tex || this._noise());
    const f = t.getRenderTarget(),
      d = this.march.uniforms,
      p = Math.log2(e.far + 1);
    ((d.tDepth.value = n),
      (d.tShape.value = this.tex.shape),
      (d.tDetail.value = this.tex.detail),
      d.uProjInv.value.copy(e.projectionMatrixInverse),
      d.uCamRot.value.extractRotation(e.matrixWorld),
      d.uCamFwd.value.copy(this._fwd.set(0, 0, -1).applyQuaternion(e.quaternion)),
      d.uOff.value.set(r.x - u.x * h, r.y - u.y * h),
      (d.uLogF.value = p),
      (d.uCamAlt.value = i),
      (d.uCover.value = a),
      (d.uBase.value = l),
      (d.uTop.value = l + 900 + 1700 * a),
      (this.quad.material = this.march),
      t.setRenderTarget(this.lowRT),
      t.render(this.quad, this.cam));
    const v = this.up.uniforms;
    return (
      (v.tLow.value = this.lowRT.texture),
      (v.tDepth.value = n),
      v.uLowRes.value.set(this.lowRT.width, this.lowRT.height),
      (v.uLogF.value = p),
      (this.quad.material = this.up),
      t.setRenderTarget(this.outRT),
      t.render(this.quad, this.cam),
      t.setRenderTarget(f),
      this.outRT.texture
    );
  }
  dispose() {
    (this.lowRT.dispose(),
      this.outRT.dispose(),
      this.up.dispose(),
      this.march && this.march.dispose(),
      this.tex && (this.tex.shape.dispose(), this.tex.detail.dispose()));
  }
}

export { VolumetricClouds };
