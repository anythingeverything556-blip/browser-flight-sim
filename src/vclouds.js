import * as THREE from 'three';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';

const Mm = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  cu = 7e4;
import { makeCloudNoise } from './cloud-noise.js';
function tex3(r, n) {
  const a = new THREE.Data3DTexture(r, n, n, n);
  return ((a.format = 1028), (a.type = 1009), (a.unpackAlignment = 1), (a.wrapS = a.wrapT = a.wrapR = 1e3), (a.minFilter = a.magFilter = 1006), (a.generateMipmaps = !1), (a.needsUpdate = !0), a);
}
const G2 = `
uniform highp sampler2D tDepth; uniform highp sampler3D tShape, tDetail;
uniform vec4 uCarve[12]; uniform int uCarveN; // tunnels the aircraft has cut through the cloud: xyz camera-relative, w radius
uniform mat4 uProjInv, uCamRot; uniform vec3 uCamFwd; uniform vec2 uOff, uTan;
uniform float uLogF, uCamAlt, uBase, uTop, uCover, uEvo; // uEvo: slow drift of the noise field through itself, so cloud shapes grow and fade
varying vec2 vUv;
${ATM_FRAG}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
// large-scale coverage: where clouds cluster and where gaps open
float weather(vec2 xz) { vec2 p = xz / 26000.0; return 0.3 * vn2(xz / 110000.0 + 19.0) + 0.3 * vn2(p) + 0.25 * vn2(p * 2.7 + 7.1) + 0.15 * vn2(p * 6.3 + 3.3); }
float density(vec3 rel, float h, float fine) {
  float hn = (h - uBase) / (uTop - uBase);
  if (hn <= 0.0 || hn >= 1.0) return 0.0;
  vec3 wp = vec3(rel.x + uOff.x, h, rel.z + uOff.y);
  float cov = clamp(uCover * (0.45 + 1.1 * weather(wp.xz)), 0.0, 1.0);
  float top = mix(0.4, 1.0, cov); // sparse cumulus stay low, heavy cover builds up
  float prof = smoothstep(0.0, 0.08, hn) * (1.0 - smoothstep(top * 0.45, top, hn));
  // two lookups at non-commensurate scales, the second rotated, so the 64^3 tile never shows as a grid from altitude
  vec3 wr = vec3(0.8 * wp.x - 0.6 * wp.z, wp.y, 0.6 * wp.x + 0.8 * wp.z);
  vec3 w3 = vec3(0.28 * wp.x + 0.96 * wp.z, wp.y, -0.96 * wp.x + 0.28 * wp.z); // a third scale at another angle, so the 64-cell noise tile never reads as a repeat
  float s = texture(tShape, wp * vec3(1.0 / 5600.0, 1.0 / 3800.0, 1.0 / 5600.0) + vec3(0.0, uEvo, 0.0)).r * 0.45
          + texture(tShape, wr * vec3(1.0 / 14300.0, 1.0 / 5100.0, 1.0 / 14300.0) + vec3(0.37, 0.37 + uEvo * 0.7, 0.37)).r * 0.3
          + texture(tShape, w3 * vec3(1.0 / 41000.0, 1.0 / 6700.0, 1.0 / 41000.0) + vec3(0.71, 0.13 + uEvo * 0.5, 0.29)).r * 0.25;
  float d = clamp((s * prof - (1.0 - cov)) / max(cov, 0.1), 0.0, 1.0);
  if (fine > 0.0 && d > 0.0) {
    float e = texture(tDetail, wp / 900.0).r;
    // wispy, billowy edges; cores stay solid. The detail repeats every 900 m, so a sample spacing near that or wider aliases into shimmer (the
    // flicker of far clouds): the caller fades it out as the march step grows.
    d = mix(d, clamp((d - e * 0.55 * (1.0 - d)) * 2.0, 0.0, 1.0), fine);
  }
  return d;
}
void main() {
  // view ray from the field of view: inverting the projection at the far plane loses all precision once near is a few cm and far is 12,000 km
  vec3 dir = normalize(mat3(uCamRot) * vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  float dz = texture2D(tDepth, vUv).r;
  float sceneT = dz > 0.99999 ? 1e12 : (exp2(dz * uLogF) - 1.0) / max(dot(dir, uCamFwd), 1e-4);
  vec3 O = vec3(0.0, ATM_RP + uCamAlt, 0.0);
  vec2 si = atmRaySphere(O, dir, ATM_RP + uBase), so = atmRaySphere(O, dir, ATM_RP + uTop), sg = atmRaySphere(O, dir, ATM_RP);
  float t0, t1;
  if (uCamAlt < uBase) { t0 = si.y; t1 = sg.x > 0.0 ? -1.0 : so.y; }
  else if (uCamAlt < uTop) { t0 = 0.0; t1 = si.x > 0.0 ? si.x : so.y; }
  // above the layer: only a forward hit counts. Looking up, both roots are behind the camera, and a negative t0 made the march run backwards through the clouds behind
  else { t0 = max(so.x, 0.0); t1 = so.x < 0.0 ? -1.0 : (si.x > 0.0 ? si.x : so.y); }
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
    float d = density(p, h, 1.0 - smoothstep(120.0, 420.0, dt));
    if (uCarveN > 0 && d > 0.0) { float k = 1.0; for (int c = 0; c < 12; c++) { if (c >= uCarveN) break; vec4 cv = uCarve[c]; k = min(k, smoothstep(cv.w * 0.35, cv.w, length(p - cv.xyz))); } d *= k; }
    if (d > 0.003) {
      float sig = 0.05 * d, od = 0.0, ls = 60.0; vec3 q = p;
      for (int k = 0; k < LSTEPS; k++) { q += uAtmSun * ls; od += density(q, length(O + q) - ATM_RP, 0.0) * ls; ls *= 1.9; }
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
// seconds for the cloud noise field to drift once through its own height (one period); larger = calmer clouds
const EVO_SECONDS = 300;
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
  // the noise volumes come from a worker (about a second of arithmetic); until they arrive render() draws no clouds
  // resolution of the cloud march only (not the picture): lets the game shed cloud cost under load without softening the imagery
  setScale(sc) {
    sc = Math.max(0.25, Math.min(1, sc)); if (Math.abs(sc - this.scale) < 0.01) return; this.scale = sc;
    this._sizeLow();
  }
  // the march target is scale x the picture, but never larger than scale x the screen's own pixels
  _sizeLow() {
    const k = this.nativeW ? Math.min(1, this.nativeW / this.w) : 1;
    this.lowRT.setSize(Math.max(1, Math.round(this.w * this.scale * k)), Math.max(1, Math.round(this.h * this.scale * k)));
  }
  _noise() {
    if (this.noiseBusy) return; this.noiseBusy = true;
    const done = (d) => { this.tex = { shape: tex3(d.shape, 64), detail: tex3(d.detail, 32) }; this.noiseBusy = false; };
    try {
      const w = new Worker(new URL('./cloud-noise-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { done(e.data); w.terminate(); };
      w.onerror = () => { w.terminate(); done(makeCloudNoise()); };
    } catch { done(makeCloudNoise()); }
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
            uTan: { value: new THREE.Vector2(1, 1) },
            uLogF: { value: 1 },
            uCamAlt: { value: 0 },
            uBase: { value: 2e3 },
            uTop: { value: 3500 },
            uCover: { value: 0.3 },
            uEvo: { value: 0 },
            uCarve: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
            uCarveN: { value: 0 },
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
      this._sizeLow(),
      this.outRT.setSize(t, e));
  }
  // tunnels cut by the aircraft: pts = [{ x, y, z (camera-relative, metres), r }]; at most 12, nearest first is best
  setCarve(pts) {
    this.carvePts = pts; this.carveN = Math.min(12, pts.length);
  }
  render(t, { camera: e, depthTexture: n, camAlt: i, camXZ: r, coverage: a, base: l, time: h, wind: u }) {
    if ((this.march || this.setQuality({}), !this.tex)) { this._noise(); return null; }
    const f = t.getRenderTarget(),
      d = this.march.uniforms,
      p = Math.log2(e.far + 1);
    ((d.tDepth.value = n),
      (d.tShape.value = this.tex.shape),
      (d.tDetail.value = this.tex.detail),
      d.uProjInv.value.copy(e.projectionMatrixInverse),
      d.uTan.value.set(1 / e.projectionMatrix.elements[0], 1 / e.projectionMatrix.elements[5]),
      d.uCamRot.value.extractRotation(e.matrixWorld),
      d.uCamFwd.value.copy(this._fwd.set(0, 0, -1).applyQuaternion(e.quaternion)),
      d.uOff.value.set(r.x - u.x * h, r.y - u.y * h),
      (d.uLogF.value = p),
      (d.uCamAlt.value = i),
      (d.uCover.value = a),
      (d.uEvo.value = h / EVO_SECONDS),
      (d.uCarveN.value = this.carveN || 0),
      this.carveN && this.carvePts.forEach((q, i) => i < 12 && d.uCarve.value[i].set(q.x, q.y, q.z, q.r)),
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
  // coarse cloud density (0..1) at the camera, the same field the shader marches through: tells the cockpit it is inside a cloud
  densityAt(y, cover, base, time = 0) {
    if (!this.tex || !this.march || cover <= 0.01) return 0;
    const top = base + 900 + 1700 * cover, hn = (y - base) / (top - base);
    if (hn <= 0 || hn >= 1) return 0;
    const u = this.march.uniforms.uOff.value, wx = u.x, wz = u.y, fr = (v) => v - Math.floor(v);
    const h21 = (a, b) => { a = fr(a * 0.1031); b = fr(b * 0.103); const d = a * (b + 33.33) + b * (a + 33.33); a += d; b += d; return fr((a + b) * a); };
    const vn = (a, b) => { const ia = Math.floor(a), ib = Math.floor(b); let fa = a - ia, fb = b - ib; fa = fa * fa * (3 - 2 * fa); fb = fb * fb * (3 - 2 * fb);
      return (h21(ia, ib) * (1 - fa) + h21(ia + 1, ib) * fa) * (1 - fb) + (h21(ia, ib + 1) * (1 - fa) + h21(ia + 1, ib + 1) * fa) * fb; };
    const px = wx / 26000, pz = wz / 26000;
    const cov = Math.min(1, Math.max(0, cover * (0.45 + 1.1 * (0.3 * vn(wx / 110000 + 19, wz / 110000 + 19) + 0.3 * vn(px, pz) + 0.25 * vn(px * 2.7 + 7.1, pz * 2.7 + 7.1) + 0.15 * vn(px * 6.3 + 3.3, pz * 6.3 + 3.3)))));
    const topf = 0.4 + 0.6 * cov, sm = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const prof = sm(0, 0.08, hn) * (1 - sm(topf * 0.45, topf, hn)), D = this.tex.shape.image.data, N = 64;
    const tri = (a, b, c) => { const fx = (((a * N - 0.5) % N) + N) % N, fy = (((b * N - 0.5) % N) + N) % N, fz = (((c * N - 0.5) % N) + N) % N, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const g = (i, j, k) => D[((k % N) * N + (j % N)) * N + (i % N)] / 255, l = (p, q, t) => p + (q - p) * t;
      return l(l(l(g(x0, y0, z0), g(x0 + 1, y0, z0), tx), l(g(x0, y0 + 1, z0), g(x0 + 1, y0 + 1, z0), tx), ty), l(l(g(x0, y0, z0 + 1), g(x0 + 1, y0, z0 + 1), tx), l(g(x0, y0 + 1, z0 + 1), g(x0 + 1, y0 + 1, z0 + 1), tx), ty), tz); };
    const wrx = 0.8 * wx - 0.6 * wz, wrz = 0.6 * wx + 0.8 * wz;
    const evo = time / EVO_SECONDS, w3x = 0.28 * wx + 0.96 * wz, w3z = -0.96 * wx + 0.28 * wz;
    const sh = tri(wx / 5600, y / 3800 + evo, wz / 5600) * 0.45 + tri(wrx / 14300 + 0.37, y / 5100 + 0.37 + evo * 0.7, wrz / 14300 + 0.37) * 0.3 + tri(w3x / 41000 + 0.71, y / 6700 + 0.13 + evo * 0.5, w3z / 41000 + 0.29) * 0.25;
    return Math.min(1, Math.max(0, (sh * prof - (1 - cov)) / Math.max(cov, 0.1)));
  }
  dispose() {
    (this.lowRT.dispose(),
      this.outRT.dispose(),
      this.up.dispose(),
      this.march && this.march.dispose(),
      this.tex && (this.tex.shape.dispose(), this.tex.detail.dispose()));
  }
}

export { VolumetricClouds, EVO_SECONDS };
