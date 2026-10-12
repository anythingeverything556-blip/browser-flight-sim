import * as THREE from 'three';
import {
  ATMOS_UNIFORMS,
  ATM_FRAG,
  ATM_LUT_SIZE,
  LUT_FRAG,
  MIE_BOOST,
  SKY_K,
  horizonAngle,
  horizonDisplay,
  skyAmbient,
  sunColor,
} from './atmos.js';
import { D2R } from './geo.js';

const _T =
    // pinned to the far plane: the unit sphere sits at distance 1 from the eye, inside the near plane of the telephoto views (near = 1), which clipped the whole sky away
    'varying vec3 vDir; void main() { vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }',
  yT = `
#include <common>
#include <dithering_pars_fragment>
${ATM_FRAG}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 L = atmSky(d);
  #ifndef ATM_HDR
  float c = dot(d, uAtmSun);
  L += uAtmSunCol * (400.0 * smoothstep(0.999928, 0.999959, c) + 2.0 * exp(-(1.0 - c) * 3000.0));
  // the moon: a lit disc (phase from the sun's direction), maria and craters from noise, and a soft halo
  {
    vec3 md = uMoon.xyz; float mc = dot(d, md);
    const float MR = 0.0125;
    float ang = acos(clamp(mc, -1.0, 1.0));
    float halo = 0.35 * exp(-ang * 60.0) + 0.05 * exp(-ang * 14.0);
    vec3 e1 = normalize(cross(md, vec3(0.0, 1.0, 0.0))), e2 = cross(e1, md);
    vec2 q = vec2(dot(d, e1), dot(d, e2)) / MR;
    float rr = length(q);
    vec3 mn = vec3(q, sqrt(max(0.0, 1.0 - rr * rr)));
    vec3 nw = e1 * mn.x + e2 * mn.y + md * mn.z;
    float lit = smoothstep(-0.03, 0.12, dot(nw, uAtmSun));
    float n1 = mn.x * 3.1 + mn.y * 1.7, mar = smoothstep(0.35, 0.7, 0.5 + 0.5 * sin(n1 * 2.1 + sin(mn.y * 5.0) * 1.3) * cos(mn.x * 4.2 - mn.y * 2.3));
    float cr = 0.5 + 0.5 * sin(mn.x * 31.0 + sin(mn.y * 27.0) * 2.0) * sin(mn.y * 23.0 + mn.x * 9.0);
    vec3 alb = mix(vec3(0.95, 0.93, 0.88), vec3(0.42, 0.43, 0.46), mar * 0.8) * (0.85 + 0.15 * cr);
    float disc = 1.0 - smoothstep(0.96, 1.0, rr);
    float vis = mix(0.25, 1.0, 1.0 - smoothstep(-0.12, 0.2, uAtmSun.y));
    L += (vec3(alb) * lit * 9.0 * disc * (0.35 + 0.65 * pow(max(mn.z, 0.0), 0.35)) + vec3(0.55, 0.65, 0.9) * halo * (0.4 + 0.6 * lit)) * vis * step(0.0, mc);
  }
  gl_FragColor = vec4(atmTone(L), 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
  #else
  gl_FragColor = vec4(L * ${SKY_K.toFixed(1)}, 1.0);
  #endif
}`;
function hm(s) {
  const t = new THREE.ShaderMaterial({
    uniforms: ATMOS_UNIFORMS,
    vertexShader: _T,
    fragmentShader: yT,
    depthTest: !1,
    depthWrite: !1,
    side: 1,
    toneMapped: !1,
    dithering: !s,
  });
  return (s && (t.defines = { ATM_HDR: 1 }), t);
}
class Environment {
  constructor(t, e) {
    ((this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), hm(!1))),
      (this.sky.frustumCulled = !1),
      (this.sky.renderOrder = -10),
      t.add(this.sky),
      (this.sun = new THREE.DirectionalLight(16777215, 3)),
      t.add(this.sun),
      t.add(this.sun.target),
      (this.moonLight = new THREE.DirectionalLight(0x9db6ff, 0)),
      t.add(this.moonLight),
      t.add(this.moonLight.target),
      (this.moonDir = new THREE.Vector3(0, 1, 0)));
    const n = this.sun.shadow;
    (n.mapSize.set(2048, 2048),
      (n.bias = -4e-4),
      (n.normalBias = 0.04),
      Object.assign(n.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 200 }),
      n.camera.updateProjectionMatrix(),
      (this.hemi = new THREE.HemisphereLight(13622511, 5722179, 0.8)),
      t.add(this.hemi),
      (t.fog = new THREE.FogExp2(11059416, 12e-6)),
      (this.scene = t),
      (this.renderer = e),
      (t.environmentIntensity = 2.6),
      (this.hour = 15),
      (this.day = 172),
      (this.sunDir = new THREE.Vector3()),
      (this.daylight = 1),
      (this.night = 0),
      (this.lutRT = new THREE.WebGLRenderTarget(ATM_LUT_SIZE[0], ATM_LUT_SIZE[1], {
        type: 1016,
        magFilter: 1006,
        minFilter: 1006,
        depthBuffer: !1,
      })),
      (this.lutRT.texture.generateMipmaps = !1),
      (ATMOS_UNIFORMS.uAtmLut.value = this.lutRT.texture),
      (this.lutMat = new THREE.ShaderMaterial({
        uniforms: { uP: { value: new THREE.Vector4() } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: LUT_FRAG,
        depthTest: !1,
        depthWrite: !1,
      })),
      (this.lutScene = new THREE.Scene()),
      this.lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat)),
      (this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)),
      (this.lutKey = ''),
      (this.lutAt = -1e9),
      (this.envAt = -1e9),
      (this.sunCol = [1, 1, 1]),
      (this.amb = [0, 0, 0]),
      (this.ref = null),
      (this.pmrem = new THREE.PMREMGenerator(e)),
      (this.envScene = new THREE.Scene()),
      (this.envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), hm(!0))),
      (this.envSky.frustumCulled = !1),
      this.envScene.add(this.envSky),
      (this.groundDome = new THREE.Mesh(
        new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 2762272, side: 1 }),
      )),
      this.envScene.add(this.groundDome),
      (this.envKey = ''),
      (this.envRT = null),
      (this.envSize = 256));
    const i = 2500,
      r = new Float32Array(i * 3);
    for (let l = 0; l < i; l++) {
      const h = Math.random() * 2 - 1,
        u = Math.random() * Math.PI * 2,
        f = Math.sqrt(1 - h * h);
      ((r[l * 3] = f * Math.cos(u) * 3e6), (r[l * 3 + 1] = Math.abs(h) * 3e6), (r[l * 3 + 2] = f * Math.sin(u) * 3e6));
    }
    const a = new THREE.BufferGeometry();
    (a.setAttribute('position', new THREE.BufferAttribute(r, 3)),
      (this.starMat = new THREE.PointsMaterial({
        color: 16777215,
        map: (() => { // a soft round dot: a hard 1-2 pixel square pops on and off as the camera turns (twinkling and flicker)
          const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
          g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); return t;
        })(),
        size: 3,
        sizeAttenuation: !1,
        transparent: !0,
        opacity: 0,
        depthWrite: !1,
        fog: !1,
      })),
      (this.stars = new THREE.Points(a, this.starMat)),
      (this.stars.frustumCulled = !1),
      (this.stars.renderOrder = -9),
      t.add(this.stars),
      (this.fogDay = new THREE.Color()));
  }
  renderLut(t, e, n) {
    const i = this.renderer,
      r = i.getRenderTarget();
    (this.lutMat.uniforms.uP.value.set(t, e, n, horizonAngle(t)),
      i.setRenderTarget(this.lutRT),
      i.render(this.lutScene, this.lutCam),
      i.setRenderTarget(r),
      (ATMOS_UNIFORMS.uAtm.value.y = horizonAngle(t)));
  }
  update(t, e, n, i) {
    i && (this.hour = (this.hour + n / 3600) % 24);
    const r = 23.44 * D2R * Math.sin((2 * Math.PI * (284 + this.day)) / 365),
      a = (this.hour - 12) * 15 * D2R,
      l = t * D2R,
      h = Math.asin(Math.sin(l) * Math.sin(r) + Math.cos(l) * Math.cos(r) * Math.cos(a)),
      u = Math.atan2(-Math.sin(a), Math.tan(r) * Math.cos(l) - Math.sin(l) * Math.cos(a));
    ((this.elev = h),
      (this.az = u),
      this.sunDir.set(Math.cos(h) * Math.sin(u), Math.sin(h), -Math.cos(h) * Math.cos(u)));
    const f = Math.min(1, Math.max(0, (e - 9e3) / 16e3)),
      d = Math.max(0, Math.sin(h)),
      p = h / D2R;
    ((this.daylight = Math.min(1, Math.max(0.05, d * 3.2 + 0.05))),
      (this.night = 1 - Math.min(1, Math.max(0, (p + 6) / 10))));
    const v = 0.55 + 0.25 * this.daylight;
    this.renderer.toneMappingExposure = v;
    const y = Math.max(e, 2),
      x = MIE_BOOST / (this.visibility || 1),
      g = ATMOS_UNIFORMS;
    (g.uAtm.value.set(y, g.uAtm.value.y, (SKY_K * v) / 0.6, x),
      // moon: roughly opposite the sun but offset sideways, so it is a gibbous moon that is up most of the night
      (this._side || (this._side = new THREE.Vector3())).set(-this.sunDir.z, 0, this.sunDir.x).normalize(),
      this.moonDir.copy(this.sunDir).negate().addScaledVector(this._side, 0.62).normalize(),
      (this.moonI = Math.pow(Math.max(0, this.moonDir.y), 0.55) * 0.9 * (1 - Math.min(1, Math.max(0, this.sunDir.y * 6)))),
      g.uMoon.value.set(this.moonDir.x, this.moonDir.y, this.moonDir.z, this.moonI),
      (this.moonLight.intensity = 0.55 * this.moonI * (1 - f)),
      this.moonLight.position.copy(this.sun.target.position).addScaledVector(this.moonDir, 60),
      this.moonLight.target.position.copy(this.sun.target.position),
      g.uAtmSun.value.copy(this.sunDir),
      sunColor(y, h, x, this.sunCol),
      g.uAtmSunCol.value.set(this.sunCol[0], this.sunCol[1], this.sunCol[2]),
      g.uAtmNight.value.set(6e-4, 9e-4, 0.0016).multiplyScalar(this.night * (1 - f) * (1 + 5 * this.moonI)));
    const _ = performance.now(),
      w = `${Math.round(Math.log(1 + y / 60) * 14)}|${Math.round(p * 10)}|${x.toFixed(2)}`;
    if (w !== this.lutKey && _ - this.lutAt > 250) {
      if (((this.lutKey = w), (this.lutAt = _), this.renderLut(y, h, x), skyAmbient(y, h, x, this.amb), !this.ref)) {
        const N = sunColor(0, 50 * D2R, MIE_BOOST),
          R = skyAmbient(0, 50 * D2R, MIE_BOOST),
          C = Math.sin(50 * D2R);
        ((this.ref = N.map((F, k) => F * C + Math.PI * R[k])),
          g.uAtmRef.value.set(this.ref[0], this.ref[1], this.ref[2]));
      }
      g.uAtmAmb.value.set(this.amb[0], this.amb[1], this.amb[2]);
      const D = horizonDisplay(y, h, x, (SKY_K * v) / 0.6);
      this.fogDay.setRGB(D[0], D[1], D[2]);
    }
    // the reflection environment (a PMREM cube render + prefilter and new render targets) changes slowly: refresh it on a coarse
    // key and at most every 15 s, not whenever the fine sky-LUT key ticks over (that hitched every few seconds in a climb)
    const envKey = `${Math.round(Math.log(1 + y / 60) * 5)}|${Math.round(p / 4)}|${x.toFixed(1)}`;
    (this.envKey !== envKey || !this.envRT) &&
      (_ - this.envAt > 15e3 || !this.envRT || this.envKey === '') &&
      this.refreshEnv(envKey);
    const b = 3.4,
      S = this.night * 0.5;
    ((this.sun.intensity = b), this.sun.color.setRGB(this.sunCol[0], this.sunCol[1], this.sunCol[2]));
    const E = this.amb.map((D, N) => Math.PI * D * b * 1.8 + [0.05, 0.065, 0.1][N] * S);
    this.hemi.color.setRGB(E[0], E[1], E[2]);
    const A = Math.max(0, Math.sin(h)) * b;
    (this.hemi.groundColor.setRGB(
      0.3 * (this.sunCol[0] * A + E[0]) * 0.55,
      0.26 * (this.sunCol[1] * A + E[1]) * 0.55,
      0.19 * (this.sunCol[2] * A + E[2]) * 0.55,
    ),
      (this.hemi.intensity = 1),
      (this.starMat.size = 3.4 * Math.max(1, this.renderer.getPixelRatio() / 1.5)),
      (this.starMat.opacity = Math.max(this.night * 0.9, f * f * 0.25 * (1 - this.daylight * 0.5))),
      this.scene.fog.color.copy(this.fogDay),
      (this.scene.fog.density = (115e-7 * Math.exp(-Math.max(0, e) / 7e3) + 2e-7) / (this.visibility || 1)));
  }
  refreshEnv(t) {
    ((this.envAt = performance.now()),
      (this.envKey = t),
      this.groundDome.material.color.setRGB(0.16, 0.15, 0.12).multiplyScalar(this.daylight));
    const e = this.pmrem.fromScene(this.envScene, 0, 0.1, 2e3, { size: this.envSize });
    (this.envRT && this.envRT.dispose(), (this.envRT = e), (this.scene.environment = e.texture));
  }
}

export { Environment };
