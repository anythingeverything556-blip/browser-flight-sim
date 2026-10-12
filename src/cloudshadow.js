import * as THREE from 'three';
import { EVO_SECONDS } from './vclouds.js';

// Shadows of the volumetric clouds on the ground, as a small map instead of per-pixel work in the terrain shader: a 160x160 texture
// covering 20 km around the aircraft is re-rendered about three times a second (the clouds drift slowly), each texel tracing the sun ray
// up through the cloud layer with the same density field the cloud renderer uses. The terrain then needs one 2D lookup per pixel.
const SIZE = 20000, N = 160, FADE = 0.33;
const FRAG = `
precision highp float; precision highp sampler3D;
uniform sampler3D tShape; uniform vec3 uSun; uniform vec2 uOff, uRelC; uniform float uSize, uCover, uBase, uTop, uGround, uEvo;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float weather(vec2 xz) { vec2 p = xz / 26000.0; return 0.3 * vn2(xz / 110000.0 + 19.0) + 0.3 * vn2(p) + 0.25 * vn2(p * 2.7 + 7.1) + 0.15 * vn2(p * 6.3 + 3.3); }
float dens(vec2 wxz, float h) {
  float hn = (h - uBase) / (uTop - uBase);
  if (hn <= 0.0 || hn >= 1.0) return 0.0;
  vec3 wp = vec3(wxz.x, h, wxz.y);
  float cov = clamp(uCover * (0.45 + 1.1 * weather(wp.xz)), 0.0, 1.0), top = mix(0.4, 1.0, cov);
  float prof = smoothstep(0.0, 0.08, hn) * (1.0 - smoothstep(top * 0.45, top, hn));
  vec3 wr = vec3(0.8 * wp.x - 0.6 * wp.z, wp.y, 0.6 * wp.x + 0.8 * wp.z);
  vec3 w3 = vec3(0.28 * wp.x + 0.96 * wp.z, wp.y, -0.96 * wp.x + 0.28 * wp.z); // a third scale at another angle, so the 64-cell noise tile never reads as a repeat
  float s = texture(tShape, wp * vec3(1.0 / 5600.0, 1.0 / 3800.0, 1.0 / 5600.0) + vec3(0.0, uEvo, 0.0)).r * 0.45
          + texture(tShape, wr * vec3(1.0 / 14300.0, 1.0 / 5100.0, 1.0 / 14300.0) + vec3(0.37, 0.37 + uEvo * 0.7, 0.37)).r * 0.3
          + texture(tShape, w3 * vec3(1.0 / 41000.0, 1.0 / 6700.0, 1.0 / 41000.0) + vec3(0.71, 0.13 + uEvo * 0.5, 0.29)).r * 0.25;
  return clamp((s * prof - (1.0 - cov)) / max(cov, 0.1), 0.0, 1.0);
}
void main() {
  vec2 g = (vUv - 0.5) * uSize + uRelC;
  float dm = 0.0;
  for (int i = 0; i < 4; i++) {
    float h = mix(uBase, uTop, 0.12 + 0.25 * float(i));
    if (h <= uGround) continue;
    float t = (h - uGround) / max(uSun.y, 0.05);
    dm = max(dm, dens(g + uSun.xz * t + uOff, h));
  }
  float sh = 1.0 - 0.85 * smoothstep(0.03, 0.4, dm) * smoothstep(0.04, 0.2, uSun.y);
  gl_FragColor = vec4(sh, sh, sh, 1.0);
}`;

export class CloudShadow {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tShape: { value: null }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uOff: { value: new THREE.Vector2() }, uRelC: { value: new THREE.Vector2() }, uSize: { value: SIZE }, uEvo: { value: 0 }, uCover: { value: 0 }, uBase: { value: 3000 }, uTop: { value: 5000 }, uGround: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.center = new THREE.Vector2(1e12, 1e12); this.at = -1e9; this.windAt = new THREE.Vector2(); this.sun = new THREE.Vector3();
    this.map = new THREE.Vector4(0, 0, 1 / SIZE, 0); // camera offset from the map centre (xz), 1/size, on
    // The map is re-rendered a few times a second. Switching to the new one in a single frame made the ground shading step at that rate (it reads
    // as flicker on a fast monitor), so the previous map stays and the two are cross-faded over FADE seconds.
    this.rtOld = this.rt.clone(); this.map2 = new THREE.Vector4(0, 0, 1 / SIZE, 0); this.mix = 1;
    this.old = { center: new THREE.Vector2(), wind: new THREE.Vector2(), at: 0, valid: false }; this.fadeAt = -1e9; this.g = null;
  }

  // cam: absolute world xz of the camera; wind: m/s drift of the cloud field; now: seconds
  update(renderer, { shape, cover, base, top, wind, now, cam, groundY, sunDir }) {
    if (!shape || cover < 0.02 || sunDir.y < 0.04) { this.map.w = 0; this.map2.w = 0; this.old.valid = false; return; }
    const texel = SIZE / N, cx = Math.round(cam.x / texel) * texel, cz = Math.round(cam.z / texel) * texel;
    const moved = Math.hypot(cx - this.center.x, cz - this.center.y) > SIZE * 0.18, stale = now - this.at > 0.35, sunMoved = this.sun.distanceToSquared(sunDir) > 4e-6;
    if (moved || stale || sunMoved || this.map.w < 0.5) {
      const first = this.map.w < 0.5;
      if (!first) { // keep the map that is showing now as the one to fade out of
        [this.rt, this.rtOld] = [this.rtOld, this.rt];
        this.old.center.copy(this.center); this.old.wind.copy(this.windAt); this.old.at = this.at; this.old.valid = true; this.fadeAt = now;
      } else this.old.valid = false;
      // a smoothed ground height: the shadow's offset depends on it, and a step in it would shift the whole pattern
      this.g = this.g === null || first ? groundY : this.g + (groundY - this.g) * 0.35; groundY = this.g;
      const u = this.mat.uniforms; u.tShape.value = shape; u.uSun.value.copy(sunDir); u.uCover.value = cover; u.uEvo.value = now / EVO_SECONDS; u.uBase.value = base; u.uTop.value = top; u.uGround.value = groundY;
      // the clouds are drawn at (position relative to the camera) + (camera - wind * time): the same arithmetic here
      u.uOff.value.set(cam.x - wind.x * now, cam.z - wind.y * now); u.uRelC.value.set(cx - cam.x, cz - cam.z);
      const prev = renderer.getRenderTarget(), ac = renderer.autoClear; renderer.autoClear = true; renderer.setRenderTarget(this.rt); renderer.render(this.quad, this.cam); renderer.setRenderTarget(prev); renderer.autoClear = ac;
      this.center.set(cx, cz); this.at = now; this.windAt.copy(wind); this.sun.copy(sunDir);
    }
    // between renders the map is read where the drifting clouds have got to
    const dt = now - this.at; this.map.set(cam.x - this.center.x - this.windAt.x * dt, cam.z - this.center.y - this.windAt.y * dt, 1 / SIZE, 1);
    const k = Math.min(1, Math.max(0, (now - this.fadeAt) / FADE)); this.mix = k * k * (3 - 2 * k);
    if (this.old.valid && k < 1) { const d2 = now - this.old.at; this.map2.set(cam.x - this.old.center.x - this.old.wind.x * d2, cam.z - this.old.center.y - this.old.wind.y * d2, 1 / SIZE, 1); }
    else { this.map2.w = 0; this.mix = 1; }
  }
}
