import { cloudTop, clearSkyEdge, CLEAR_SKY_WIDTH, cloudTexOffsets } from './cloudlayer.js';
import * as THREE from 'three';
import { DEPTH_GLSL, depthK, isReversed } from './depth.js';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';

const Mm = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  cu = 7e4;
import { makeCloudNoise } from './cloud-noise.js';
// uT0..2 from the offset in double precision (before it is rounded to the uniform's float32)
const _tOff = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
export function setTexOffsets(u, ox, oz) { cloudTexOffsets(ox, oz, _tOff); u.uT0.value.fromArray(_tOff[0]); u.uT1.value.fromArray(_tOff[1]); if (u.uT2) u.uT2.value.fromArray(_tOff[2]); }
function tex3(r, n) {
  const a = new THREE.Data3DTexture(r, n, n, n);
  return ((a.format = 1028), (a.type = 1009), (a.unpackAlignment = 1), (a.wrapS = a.wrapT = a.wrapR = 1e3), (a.minFilter = a.magFilter = 1006), (a.generateMipmaps = !1), (a.needsUpdate = !0), a);
}
const G2 = `
uniform highp sampler2D tDepth; uniform highp sampler3D tShape, tDetail;
uniform float uStepN; uniform vec4 uCarve[12]; uniform int uCarveN; // tunnels the aircraft has cut through the cloud: xyz camera-relative, w radius
uniform mat4 uProjInv, uCamRot; uniform vec3 uCamFwd; uniform vec2 uOff, uTan; uniform vec4 uT0, uT1, uT2; // uT*: cloudTexOffsets() of uOff
${DEPTH_GLSL}
uniform float uCamAlt, uBase, uTop, uCover, uEvo; // uEvo: slow drift of the noise field through itself, so cloud shapes grow and fade
varying vec2 vUv;
${ATM_FRAG}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
// large-scale coverage: where clouds cluster and where gaps open
float weather(vec2 xz) { vec2 p = xz / 26000.0; return 0.3 * vn2(xz / 110000.0 + 19.0) + 0.3 * vn2(p) + 0.25 * vn2(p * 2.7 + 7.1) + 0.15 * vn2(p * 6.3 + 3.3); }
float density(vec3 rel, float h, float fine, float wv) { // wv: weather() at this column
  float hn = (h - uBase) / (uTop - uBase);
  if (hn <= 0.0 || hn >= 1.0) return 0.0;
  // shifted by the coverage field, which varies over tens of km: neighbouring repeats of the 64^3 noise tile no longer line up
  // camera-relative: the large offset enters each lookup as uT* (cloudlayer.js cloudTexOffsets), keeping texture coordinates small
  vec3 wp = vec3(rel.x + wv * 5100.0, h, rel.z + wv * 3700.0);
  // full cover (Overcast, Rain, Storm) closes the large clear areas of the coverage field too: they put blue sky over the rain
  float closed = smoothstep(0.8, 1.0, uCover), cov = mix(clamp(uCover * (0.45 + 1.1 * wv), 0.0, 1.0), 1.0, closed);
  float clearLo = mix(0.38, 0.35, smoothstep(0.85, 1.0, uCover));
  float top = mix(0.4, 1.0, cov); // sparse cumulus stay low, heavy cover builds up
  float prof = smoothstep(0.0, 0.05, hn) * mix(1.0, 0.55, smoothstep(0.0, top, hn)) * (1.0 - smoothstep(top * 0.6, top, hn)); // flat bases, narrowing upward: cumulus towers
  // two lookups at non-commensurate scales, the second rotated, so the 64^3 tile never shows as a grid from altitude
  vec3 wr = vec3(0.8 * wp.x - 0.6 * wp.z, wp.y, 0.6 * wp.x + 0.8 * wp.z);
  vec3 w3 = vec3(0.28 * wp.x + 0.96 * wp.z, wp.y, -0.96 * wp.x + 0.28 * wp.z); // a third scale at another angle, so the 64-cell noise tile never reads as a repeat
  float s = textureLod(tShape, wp * vec3(1.0 / 3400.0, 1.0 / 2600.0, 1.0 / 3400.0) + vec3(uT0.x, uEvo, uT0.y), 0.0).r * 0.5
          + textureLod(tShape, wr * vec3(1.0 / 8800.0, 1.0 / 4400.0, 1.0 / 8800.0) + vec3(0.37 + uT0.z, 0.37 + uEvo * 0.7, 0.37 + uT0.w), 0.0).r * 0.32
          + textureLod(tShape, w3 * vec3(1.0 / 26000.0, 1.0 / 7000.0, 1.0 / 26000.0) + vec3(0.71 + uT1.x, 0.13 + uEvo * 0.5, 0.29 + uT1.y), 0.0).r * 0.18;
  // the three-lookup mix sits in 0.40-0.60 for 80 % of points: spread it so coverage gives separate clouds and gaps; towards full cover it
  // closes into a continuous deck (the spread alone left blue holes in Overcast and Rain)
  s = mix(smoothstep(0.38, 0.64, s), 0.5 + 0.5 * smoothstep(0.3, 0.64, s), smoothstep(0.75, 1.0, uCover));
  float d = clamp((s * prof - (1.0 - cov)) / max(cov * 0.55, 0.06), 0.0, 1.0) * mix(smoothstep(clearLo, clearLo + 0.08, wv), 1.0, closed);
  if (fine > 0.0 && d > 0.0) {
    float e = textureLod(tDetail, wp / 900.0 + vec3(uT1.z, 0.0, uT1.w), 0.0).r;
    // wispy, billowy edges; cores stay solid. The detail repeats every 900 m, so a sample spacing near that or wider aliases into shimmer (the
    // flicker of far clouds): the caller fades it out as the march step grows.
    d = mix(d, clamp((d - e * 0.35 * (1.0 - d)) * 1.6, 0.0, 1.0), fine);
  }
  return d;
}
vec4 cumulus() {
  // view ray from the field of view: inverting the projection at the far plane loses all precision once near is a few cm and far is 12,000 km
  vec3 dir = normalize(mat3(uCamRot) * vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  float dz = texture2D(tDepth, vUv).r;
  float sceneT = depthSky(dz) ? 1e12 : depthW(dz) / max(dot(dir, uCamFwd), 1e-4);
  vec3 O = vec3(0.0, ATM_RP + uCamAlt, 0.0);
  vec2 si = atmRaySphere(O, dir, ATM_RP + uBase), so = atmRaySphere(O, dir, ATM_RP + uTop), sg = atmRaySphere(O, dir, ATM_RP);
  float t0, t1;
  if (uCamAlt < uBase) { t0 = si.y; t1 = sg.x > 0.0 ? -1.0 : so.y; }
  else if (uCamAlt < uTop) { t0 = 0.0; t1 = si.x > 0.0 ? si.x : so.y; }
  // above the layer: only a forward hit counts. Looking up, both roots are behind the camera, and a negative t0 made the march run backwards through the clouds behind
  else { t0 = max(so.x, 0.0); t1 = so.x < 0.0 ? -1.0 : (si.x > 0.0 ? si.x : so.y); }
  t1 = min(t1, min(sceneT, t0 + ${cu}.0));
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float L = t1 - t0, j = h21(gl_FragCoord.xy * 1.37 + 17.0); // white-noise jitter: IGN's diagonal pattern shows as stripes once upsampled
  float cosT = dot(dir, uAtmSun), ph = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
  vec3 sunC = uAtmSunCol * 2.0, ambC = uAtmAmb * 3.14159 * 0.9;
  float T = 1.0, tw = 0.0, ts = 0.0, lastOd = 0.0; vec3 S = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    if (float(i) >= uStepN) break; // fewer steps when the camera is far above or below the layer (marchSteps)
    // samples bunch up near the entry point, where detail is visible
    float u = (float(i) + j) / uStepN, t = t0 + L * u * u, dt = L * (2.0 * u + 1.0 / uStepN) / uStepN;
    vec3 p = dir * t; float h = length(O + p) - ATM_RP;
    float wv = weather(p.xz + uOff);
    float d = density(p, h, 1.0 - smoothstep(120.0, 420.0, dt), wv);
    if (uCarveN > 0 && d > 0.0) { float k = 1.0; for (int c = 0; c < 12; c++) { if (c >= uCarveN) break; vec4 cv = uCarve[c]; k = min(k, smoothstep(cv.w * 0.35, cv.w, length(p - cv.xyz))); } d *= k; }
    if (d > 0.003) {
      float sig = 0.075 * d, od = lastOd, ls = 60.0; vec3 q = p;
      if (T > 0.3) { od = 0.0; for (int k = 0; k < LSTEPS; k++) { q += uAtmSun * ls; od += density(q, length(O + q) - ATM_RP, 0.0, wv) * ls; ls *= 1.9; } lastOd = od; }
      float Tl = exp(-0.05 * od), hn = clamp((h - uBase) / (uTop - uBase), 0.0, 1.0);
      // single scattering + a cheap multiple-scattering floor (keeps cloud interiors from going black)
      float powder = 1.0 - 0.6 * exp(-od * 0.08); // dark creases where little light has scattered in yet
      // inside and under a thick deck the light is sunlight scattered many times: grey, not the blue of the clear sky (the ambient term alone
      // made Overcast and Rain a blue ceiling). Desaturate the sky light with depth and add a neutral multiple-scattering floor.
      float deep = 1.0 - Tl; vec3 ambG = mix(ambC, vec3(dot(ambC, vec3(0.2126, 0.7152, 0.0722))) * 1.15, 0.35 + 0.6 * deep);
      vec3 Lsc = sunC * (ph * Tl * powder * 1.2 + 0.05 * pow(Tl, 0.25) + 0.045 * (0.35 + 0.65 * hn)) + ambG * (0.42 + 0.58 * hn) + uAtmNight * 0.5;
      float ext = exp(-sig * dt), a = T * (1.0 - ext);
      S += Lsc * a; ts += a * t; tw += a;
      T *= ext;
      if (T < 0.02) break;
    }
  }
  if (tw < 1e-4) return vec4(0.0, 0.0, 0.0, 1.0);
  float tm = ts / tw, a = (1.0 - T) * (1.0 - smoothstep(${cu * 0.55}.0, ${cu}.0, tm - t0));
  vec3 col = atmAerial(atmTone(S / tw), dir * tm);
  return vec4(col * a, 1.0 - a);
}
vec4 cirrus(vec3 dir, float sceneT, vec3 O) {
  float R = ATM_RP + 9500.0;
  vec2 hit = atmRaySphere(O, dir, R);
  float t = length(O) < R ? hit.y : hit.x;
  if (t <= 0.0 || t > 420000.0 || t > sceneT) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 xr = (dir * t).xz, xz = xr + uOff;
  float streakMask = smoothstep(0.40, 0.60, weather(xz * 1.6 + 5.0));
  float st = texture(tShape, vec3(xr.x / 26000.0 + uT2.x + uEvo * 0.3, 0.37, xr.y / 7000.0 + uT2.y)).r * 0.6 + texture(tShape, vec3(xr.x / 9500.0 + uT2.z + 0.2, 0.61, xr.y / 3000.0 + uT2.w + 0.3)).r * 0.4;
  float a = clamp((st - 0.5) * 3.0, 0.0, 1.0) * streakMask * 0.3 * (1.0 - 0.7 * uCover) * (1.0 - smoothstep(200000.0, 420000.0, t));
  if (a < 0.002) return vec4(0.0, 0.0, 0.0, 1.0);
  float cosT = dot(dir, uAtmSun), ph = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
  vec3 S = uAtmSunCol * 2.0 * (ph * 0.8 + 0.12) + uAtmAmb * 3.14159 * 0.8 + uAtmNight * 0.5;
  vec3 col = atmAerial(atmTone(S), dir * t);
  return vec4(col * a, 1.0 - a);
}
void main() {
  vec3 dir = normalize(mat3(uCamRot) * vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  float dz = texture2D(tDepth, vUv).r;
  float sceneT = depthSky(dz) ? 1e12 : depthW(dz) / max(dot(dir, uCamFwd), 1e-4);
  vec3 O = vec3(0.0, ATM_RP + uCamAlt, 0.0);
  vec4 c = cumulus(), ci = cirrus(dir, sceneT, O);
  gl_FragColor = vec4(c.rgb + c.a * ci.rgb, c.a * ci.a);
}`,
  V2 = `
uniform sampler2D tLow; uniform highp sampler2D tDepth; uniform vec2 uLowRes;
${DEPTH_GLSL}
// half-rate march (off by default): on the frames without a march, where this pixel's view ray was on the last march's screen (rotation only;
// the layer is far enough that the camera's own travel in one frame does not show)
uniform float uReproj; uniform mat4 uCamRot, uPrevRotInv; uniform vec2 uTan, uPrevTan;
varying vec2 vUv;
vec2 prevUv(vec2 uv) { vec3 d = mat3(uPrevRotInv) * (mat3(uCamRot) * vec3((uv * 2.0 - 1.0) * uTan, -1.0)); return d.z < -1e-4 ? (d.xy / -d.z) / uPrevTan * 0.5 + 0.5 : uv; }
float lz(vec2 uv) { return log2(1.0 + depthW(textureLod(tDepth, uv, 0.0).r)); } // log2(1 + w): depth comparisons in log space
void main() {
  float zc = lz(vUv);
  vec2 st = (uReproj > 0.5 ? prevUv(vUv) : vUv) * uLowRes - 0.5, i0 = floor(st + 0.5);
  vec4 acc = vec4(0.0); float ws = 0.0;
  // 3x3 tent around the nearest low-res texel: upsamples and smooths the march jitter in one pass
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = i0 + vec2(float(i), float(j)), cuv = (c + 0.5) / uLowRes, dd = abs(c - st);
    float wb = max(0.0, 1.5 - dd.x) * max(0.0, 1.5 - dd.y);
    float w = wb / (0.02 + abs(lz(cuv) - zc)) + 1e-5;
    acc += textureLod(tLow, cuv, 0.0) * w; ws += w;
  }
  gl_FragColor = acc / ws;
}`;
// seconds for the cloud noise field to drift once through its own height (one period); larger = calmer clouds
const EVO_SECONDS = 300;
// march steps for a camera this far outside the layer: the full count inside it or within 2 km, half at 15 km and beyond (from the
// top of the climb the layer is a thin band far below, its detail already faded out by the step length, and the jitter + upsample hide the coarser march)
const marchSteps = (steps, camAlt, base, top) => { const d = Math.max(base - camAlt, camAlt - top, 0), k = Math.min(1, Math.max(0, (d - 2000) / 13000)); return Math.max(12, Math.round(steps * (1 - 0.5 * k * k * (3 - 2 * k)))); };
class VolumetricClouds {
  constructor(t) {
    this.anchor = new THREE.Vector2(); this.evo0 = 0;
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
          uDepthK: { value: new THREE.Vector2(1, 0) },
          uReproj: { value: 0 },
          uCamRot: { value: new THREE.Matrix4() },
          uPrevRotInv: { value: new THREE.Matrix4() },
          uTan: { value: new THREE.Vector2(1, 1) },
          uPrevTan: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: Mm,
        fragmentShader: V2,
        depthTest: !1,
        depthWrite: !1,
      })),
      (this._fwd = new THREE.Vector3()),
      (this.halfRate = !1), // march every other frame, the frames between reproject the last march (settings.cloudHalfRate; off by default)
      (this.frame = 0),
      (this.marches = 0),
      (this._marchedAt = null));
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
            uOff: { value: new THREE.Vector2() }, uT0: { value: new THREE.Vector4() }, uT1: { value: new THREE.Vector4() }, uT2: { value: new THREE.Vector4() },
            uTan: { value: new THREE.Vector2(1, 1) },
            uDepthK: { value: new THREE.Vector2(1, 0) },
            uCamAlt: { value: 0 },
            uBase: { value: 2e3 },
            uTop: { value: 3500 },
            uCover: { value: 0.3 },
            uEvo: { value: 0 },
            uCarve: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
            uCarveN: { value: 0 },
            uStepN: { value: e },
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
  // a: { x, y } cloudAnchor() of the world origin (see cloudlayer.js); evo0: per-day phase of the clouds' growth
  setAnchor(a, evo0 = 0) { this.anchor.set(a.x, a.y); this.evo0 = evo0; }
  render(t, { camera: e, depthTexture: n, camAlt: i, camXZ: r, coverage: a, base: l, time: h, wind: u }) {
    if ((this.march || this.setQuality({}), !this.tex)) { this._noise(); return null; }
    const f = t.getRenderTarget(),
      d = this.march.uniforms,
      p = depthK(e, isReversed(t), this._dk || (this._dk = new THREE.Vector2())),
      lw = this.lowRT.width, lh = this.lowRT.height, m = this._marchedAt,
      skip = this.halfRate && m && (this.frame++ & 1) === 1 && m.w === lw && m.h === lh && m.mat === this.march;
    skip || (this.marches++, (this._marchedAt = { w: lw, h: lh, mat: this.march }), (d.tDepth.value = n),
      (d.tShape.value = this.tex.shape),
      (d.tDetail.value = this.tex.detail),
      d.uProjInv.value.copy(e.projectionMatrixInverse),
      d.uTan.value.set(1 / e.projectionMatrix.elements[0], 1 / e.projectionMatrix.elements[5]),
      d.uCamRot.value.extractRotation(e.matrixWorld),
      d.uCamFwd.value.copy(this._fwd.set(0, 0, -1).applyQuaternion(e.quaternion)),
      d.uOff.value.set(r.x - u.x * h + this.anchor.x, r.y - u.y * h + this.anchor.y),
      setTexOffsets(d, d.uOff.value.x, d.uOff.value.y),
      d.uDepthK.value.copy(p),
      (d.uCamAlt.value = i),
      (d.uCover.value = a),
      (d.uEvo.value = h / EVO_SECONDS + this.evo0),
      (d.uCarveN.value = this.carveN || 0),
      this.carveN && this.carvePts.forEach((q, i) => i < 12 && d.uCarve.value[i].set(q.x, q.y, q.z, q.r)),
      (d.uBase.value = l),
      (d.uTop.value = cloudTop(l, a)),
      (d.uStepN.value = marchSteps(this.steps, i, l, d.uTop.value)),
      (this.quad.material = this.march),
      t.setRenderTarget(this.lowRT),
      t.render(this.quad, this.cam));
    const v = this.up.uniforms;
    // current view for the reprojection; on a march frame the last march's view is this one (the mapping is the identity)
    v.uCamRot.value.extractRotation(e.matrixWorld); v.uTan.value.set(1 / e.projectionMatrix.elements[0], 1 / e.projectionMatrix.elements[5]);
    if (!skip) { v.uPrevRotInv.value.copy(v.uCamRot.value).transpose(); v.uPrevTan.value.copy(v.uTan.value); }
    v.uReproj.value = this.halfRate ? 1 : 0;
    return (
      (v.tLow.value = this.lowRT.texture),
      (v.tDepth.value = n),
      v.uLowRes.value.set(this.lowRT.width, this.lowRT.height),
      v.uDepthK.value.copy(p),
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
    const top = cloudTop(base, cover), hn = (y - base) / (top - base);
    if (hn <= 0 || hn >= 1) return 0;
    const u = this.march.uniforms.uOff.value, wx = u.x, wz = u.y, fr = (v) => v - Math.floor(v);
    const h21 = (a, b) => { a = fr(a * 0.1031); b = fr(b * 0.103); const d = a * (b + 33.33) + b * (a + 33.33); a += d; b += d; return fr((a + b) * a); };
    const vn = (a, b) => { const ia = Math.floor(a), ib = Math.floor(b); let fa = a - ia, fb = b - ib; fa = fa * fa * (3 - 2 * fa); fb = fb * fb * (3 - 2 * fb);
      return (h21(ia, ib) * (1 - fa) + h21(ia + 1, ib) * fa) * (1 - fb) + (h21(ia, ib + 1) * (1 - fa) + h21(ia + 1, ib + 1) * fa) * fb; };
    const px = wx / 26000, pz = wz / 26000;
    const wv = 0.3 * vn(wx / 110000 + 19, wz / 110000 + 19) + 0.3 * vn(px, pz) + 0.25 * vn(px * 2.7 + 7.1, pz * 2.7 + 7.1) + 0.15 * vn(px * 6.3 + 3.3, pz * 6.3 + 3.3);
    const closed = Math.min(1, Math.max(0, (cover - 0.8) / 0.2)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (cover - 0.8) / 0.2)));
    const cov = Math.min(1, Math.max(0, cover * (0.45 + 1.1 * wv))) * (1 - closed) + closed, clearLo = clearSkyEdge(cover);
    const ux = wx + wv * 5100, uz = wz + wv * 3700; // the shader's domain shift
    const topf = 0.4 + 0.6 * cov, sm = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const prof = sm(0, 0.05, hn) * (1 - 0.45 * sm(0, topf, hn)) * (1 - sm(topf * 0.6, topf, hn)), D = this.tex.shape.image.data, N = 64;
    const tri = (a, b, c) => { const fx = (((a * N - 0.5) % N) + N) % N, fy = (((b * N - 0.5) % N) + N) % N, fz = (((c * N - 0.5) % N) + N) % N, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const g = (i, j, k) => D[((k % N) * N + (j % N)) * N + (i % N)] / 255, l = (p, q, t) => p + (q - p) * t;
      return l(l(l(g(x0, y0, z0), g(x0 + 1, y0, z0), tx), l(g(x0, y0 + 1, z0), g(x0 + 1, y0 + 1, z0), tx), ty), l(l(g(x0, y0, z0 + 1), g(x0 + 1, y0, z0 + 1), tx), l(g(x0, y0 + 1, z0 + 1), g(x0 + 1, y0 + 1, z0 + 1), tx), ty), tz); };
    const wrx = 0.8 * ux - 0.6 * uz, wrz = 0.6 * ux + 0.8 * uz;
    const evo = time / EVO_SECONDS + this.evo0, w3x = 0.28 * ux + 0.96 * uz, w3z = -0.96 * ux + 0.28 * uz;
    const sh0 = tri(ux / 3400, y / 2600 + evo, uz / 3400) * 0.5 + tri(wrx / 8800 + 0.37, y / 4400 + 0.37 + evo * 0.7, wrz / 8800 + 0.37) * 0.32 + tri(w3x / 26000 + 0.71, y / 7000 + 0.13 + evo * 0.5, w3z / 26000 + 0.29) * 0.18, sh = sm(0.38, 0.64, sh0) + (0.5 + 0.5 * sm(0.3, 0.64, sh0) - sm(0.38, 0.64, sh0)) * sm(0.75, 1, cover);
    const gap = Math.min(1, Math.max(0, (wv - clearLo) / CLEAR_SKY_WIDTH));
    return Math.min(1, Math.max(0, (sh * prof - (1 - cov)) / Math.max(cov * 0.55, 0.06))) * (gap * gap * (3 - 2 * gap) * (1 - closed) + closed);
  }
  dispose() {
    (this.lowRT.dispose(),
      this.outRT.dispose(),
      this.up.dispose(),
      this.march && this.march.dispose(),
      this.tex && (this.tex.shape.dispose(), this.tex.detail.dispose()));
  }
}

export { VolumetricClouds, EVO_SECONDS, marchSteps };
