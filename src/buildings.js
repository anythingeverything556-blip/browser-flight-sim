import * as THREE from 'three';
import { PMTiles } from 'pmtiles';
import { D2R, R_EARTH, lat2ty, lon2tx, tx2lon, ty2lat } from './geo.js';
import { SHADOW_LAYER, SHADOW_UNIFORMS, sd } from './shadows.js';
import { applyCurvature } from './terrain.js';

const to = 256,
  Qp = 18,
  Yb = 4,
  rd = 3.2,
  Jb = to / Yb,
  Qb = to / rd,
  Ca = (s) => (s < 0 ? 0 : s > 1 ? 1 : s),
  y0 = (s, t, e) => {
    let n = (Math.imul(s | 0, 374761393) + Math.imul(t | 0, 668265263) + Math.imul(e | 0, 1442695041)) | 0;
    return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
  },
  ac = (s, t) => ((s % t) + t) % t;
function od(s, t, e, n, i) {
  const r = Math.floor(s),
    a = Math.floor(t),
    l = s - r,
    h = t - a,
    u = l * l * (3 - 2 * l),
    f = h * h * (3 - 2 * h),
    d = (p, v) => y0(ac(r + p, e), ac(a + v, n), i);
  return (d(0, 0) * (1 - u) + d(1, 0) * u) * (1 - f) + (d(0, 1) * (1 - u) + d(1, 1) * u) * f;
}
const Zt = (s, t, e, n, i, r) => Ca(Math.min(Math.min(s - e, i - s) * Jb, Math.min(t - n, r - t) * Qb) + 0.5),
  $b = [
    [58, 92, 124],
    [46, 98, 96],
    [60, 56, 54],
    [112, 142, 168],
  ];
function Ul(s) {
  const t = $b[s];
  return (e, n, i, r, a) => {
    a(156, 160, 166, 0.35, 0.85, 0, 0);
    const l = Math.max(Zt(e, n, 0.07, 0.05, 1.96, 2.98), Zt(e, n, 2.04, 0.05, 3.93, 2.98));
    r(l, t[0] * 0.55, t[1] * 0.55, t[2] * 0.55, 0.22, 0.55, 0, 0);
    const h = Math.max(Zt(e, n, 0.07, 0.95, 1.96, 2.98), Zt(e, n, 2.04, 0.95, 3.93, 2.98)),
      u = 0.7 + 0.5 * (n / rd) + 0.12 * od(e * 3, n * 3, 12, 10, 3);
    r(h, t[0] * u, t[1] * u, t[2] * u, 0.06, 0.9, 1, 0);
  };
}
function $p(s) {
  return (t, e, n, i, r) => {
    if (!s)
      (r(204, 200, 190, 0.85, 0, 0, 1),
        i(Zt(t, e, 0.18, 0.9, 3.82, 2.55), 38, 60, 82, 0.08, 0.85, 1, 0),
        i(Zt(t, e, 1.97, 0.9, 2.03, 2.55), 92, 96, 100, 0.4, 0.8, 0, 0),
        i(Zt(t, e, 0.18, 0.84, 3.82, 0.9), 120, 118, 112, 0.7, 0.2, 0, 0.5));
    else {
      r(214, 205, 188, 0.88, 0, 0, 1);
      for (const a of [0.35, 2.25]) {
        const l = a + 1.4;
        (i(Zt(t, e, a - 0.1, 0.7, l + 0.1, 0.8), 230, 226, 216, 0.8, 0, 0, 0.6),
          i(Zt(t, e, a - 0.07, 0.8, l + 0.07, 2.57), 232, 230, 224, 0.55, 0, 0, 0.3),
          i(Zt(t, e, a, 0.87, l, 2.5), 40, 62, 84, 0.08, 0.85, 1, 0),
          i(Zt(t, e, a + 0.68, 0.87, a + 0.72, 2.5), 232, 230, 224, 0.55, 0, 0, 0.3),
          i(Zt(t, e, a, 1.86, l, 1.9), 232, 230, 224, 0.55, 0, 0, 0.3));
      }
    }
  };
}
function tS(s, t, e, n, i) {
  (i(224, 218, 206, 0.9, 0, 0, 1),
    n(Zt(s, t, 0.68, 0.28, 3.32, 2.55), 236, 236, 232, 0.5, 0.1, 0, 0.2),
    n(Zt(s, t, 0.74, 0.3, 3.26, 2.5), 34, 52, 68, 0.07, 0.85, 1, 0),
    n(Zt(s, t, 1.96, 0.3, 2.04, 2.5), 236, 236, 232, 0.5, 0.1, 0, 0.2),
    n(Zt(s, t, 0.1, 0.28, 3.9, 1.1), 120, 140, 148, 0.1, 0.5, 0, 0.1),
    n(Zt(s, t, 0.1, 1.06, 3.9, 1.1), 200, 204, 206, 0.4, 0.8, 0, 0),
    n(Zt(s, t, 0, 0, 4, 0.28), 196, 192, 184, 0.9, 0, 0, 0.8),
    n(Ca((t - 2.85) * 6) * 0.35, 40, 38, 34, 0.9, 0, 0, 0.5));
}
function eS(s, t, e, n, i) {
  i(228, 220, 204, 0.92, 0, 0, 1);
  for (const r of [0.55, 2.45])
    (n(Zt(s, t, r - 0.3, 0.85, r - 0.04, 2.35), 84, 106, 90, 0.6, 0, 0, 0),
      n(Zt(s, t, r + 1.04, 0.85, r + 1.3, 2.35), 84, 106, 90, 0.6, 0, 0, 0),
      n(Zt(s, t, r - 0.12, 0.7, r + 1.12, 0.8), 214, 208, 196, 0.8, 0, 0, 0.5),
      n(Zt(s, t, r - 0.04, 0.85, r + 1.04, 2.35), 240, 240, 236, 0.5, 0, 0, 0.2),
      n(Zt(s, t, r, 0.9, r + 1, 2.3), 38, 54, 70, 0.07, 0.85, 1, 0),
      n(Zt(s, t, r + 0.48, 0.9, r + 0.52, 2.3), 240, 240, 236, 0.5, 0, 0, 0.2));
}
function nS(s, t, e, n, i) {
  (i(236, 232, 222, 0.93, 0, 0, 1),
    n(Zt(s, t, 1, 0.78, 3, 0.88), 220, 216, 208, 0.8, 0, 0, 0.5),
    n(Zt(s, t, 1.1, 0.88, 2.9, 2.42), 244, 244, 240, 0.5, 0, 0, 0.15),
    n(Zt(s, t, 1.18, 0.96, 2.82, 2.34), 38, 54, 70, 0.07, 0.85, 1, 0),
    n(Zt(s, t, 1.97, 0.96, 2.03, 2.34), 244, 244, 240, 0.5, 0, 0, 0.15),
    n(Zt(s, t, 1.18, 1.62, 2.82, 1.66), 244, 244, 240, 0.5, 0, 0, 0.15));
  const r = od(s * 14, 0.5, 56, 1, 9) * Ca((0.9 - t) * 3 + 0.6) * Zt(s, t, 1.1, 0, 2.9, 0.9) * 0.5;
  n(r, 120, 114, 104, 0.95, 0, 0, 0.6);
}
function tm(s) {
  const t = s ? [176, 140, 108] : [150, 72, 56],
    e = rd / 42;
  return (n, i, r, a, l) => {
    const h = Math.floor(i / e),
      u = n + (h & 1 ? 0.125 : 0),
      f = Math.floor(u / 0.25),
      d = u / 0.25 - f,
      p = Math.min(d, 1 - d) * 0.25,
      v = i / e - h,
      y = Math.min(v, 1 - v) * e,
      x = Ca(1 - (Math.min(p, y) - 0.004) * 90),
      g = 0.82 + 0.34 * y0(ac(f, 16), ac(h, 42), 5);
    (l(t[0] * g, t[1] * g, t[2] * g, 0.88, 0, 0, 0.25),
      a(x, 176, 170, 158, 0.95, 0, 0, 0.1),
      a(Zt(n, i, 1, 2.35, 3, 2.5), 196, 190, 178, 0.8, 0, 0, 0.3),
      a(Zt(n, i, 1, 0.7, 3, 0.8), 120, 116, 110, 0.8, 0, 0, 0.1),
      a(Zt(n, i, 1.1, 0.8, 2.9, 2.35), 232, 230, 224, 0.5, 0, 0, 0.1),
      a(Zt(n, i, 1.17, 0.87, 2.83, 2.28), 36, 52, 66, 0.07, 0.85, 1, 0),
      a(Zt(n, i, 1.97, 0.87, 2.03, 2.28), 232, 230, 224, 0.5, 0, 0, 0.1));
  };
}
function em(s) {
  return (t, e, n, i, r) => {
    const a = 0.86 + 0.14 * Math.cos((t * Math.PI * 2) / 0.25);
    (r(182 * a, 186 * a, 184 * a, 0.45, 0.35, 0, 0.9),
      i(Zt(t, e, 0, 1.6, 4, 1.63), 120, 122, 120, 0.5, 0.4, 0, 0.5),
      i(Zt(t, e, 0, 0, 4, 0.8), 150, 148, 142, 0.9, 0, 0, 0.3),
      s &&
        (i(Zt(t, e, 0.25, 1.95, 3.75, 2.85), 120, 124, 126, 0.5, 0.5, 0, 0),
        i(Zt(t, e, 0.3, 2, 3.7, 2.8), 44, 60, 74, 0.1, 0.8, 0.8, 0),
        i(Zt(t, e, 1.17, 2, 1.2, 2.8), 120, 124, 126, 0.5, 0.5, 0, 0),
        i(Zt(t, e, 2.37, 2, 2.4, 2.8), 120, 124, 126, 0.5, 0.5, 0, 0)));
  };
}
function iS(s, t, e, n, i) {
  (i(176, 174, 168, 0.9, 0, 0, 0.7),
    n(Zt(s, t, 0.45, 0.95, 3.55, 2.15), 70, 70, 70, 0.6, 0.2, 0, 0),
    n(Zt(s, t, 0.5, 1, 3.5, 2.1), 36, 52, 68, 0.08, 0.85, 1, 0),
    n(Zt(s, t, 1.97, 1, 2.03, 2.1), 70, 70, 70, 0.6, 0.2, 0, 0),
    n(Zt(s, t, 1.97, 0, 2.03, 3.2), 120, 118, 114, 0.9, 0, 0, 0.4),
    n(Zt(s, t, 0, 0, 4, 0.03), 120, 118, 114, 0.9, 0, 0, 0.4));
  const r =
    od(s * 12, 0.3, 48, 1, 4) * Ca((t - 0.9) * 1.2) * (Zt(s, t, 0.4, 0, 0.6, 1) + Zt(s, t, 3.4, 0, 3.6, 1)) * 0.5;
  n(r, 90, 88, 84, 0.95, 0, 0, 0.7);
}
function nm(s) {
  const t = s ? [232, 228, 218] : [40, 42, 48];
  return (e, n, i, r, a) => {
    (a(200, 196, 188, 0.9, 0, 0, 1),
      r(Zt(e, n, 0, 2.5, 4, 3.15), t[0], t[1], t[2], 0.6, 0.1, 0, s ? 0.8 : 0),
      r(Zt(e, n, 0.05, 0.08, 3.95, 2.45), 120, 124, 128, 0.4, 0.8, 0, 0),
      r(Zt(e, n, 0.1, 0.14, 3.9, 2.4), 30, 46, 56, 0.05, 0.85, 1, 0));
    for (const l of [1.3, 2.7]) r(Zt(e, n, l - 0.03, 0.14, l + 0.03, 2.4), 120, 124, 128, 0.4, 0.8, 0, 0);
    (r(Zt(e, n, 1.7, 0.1, 2.3, 2.2), 120, 124, 128, 0.4, 0.8, 0, 0),
      r(Zt(e, n, 1.75, 0.14, 2.25, 2.15), 26, 40, 50, 0.05, 0.85, 1, 0));
  };
}
function sS(s, t, e, n, i) {
  (i(218, 212, 200, 0.92, 0, 0, 1),
    n(Zt(s, t, 0, 0, 4, 0.45), 150, 146, 138, 0.95, 0, 0, 0.5),
    n(Zt(s, t, 1.4, 0, 2.6, 2.3), 226, 224, 218, 0.6, 0, 0, 0.2),
    n(Zt(s, t, 1.5, 0, 2.5, 2.2), 84, 58, 42, 0.55, 0, 0, 0),
    n(Zt(s, t, 1.62, 1.2, 2.38, 2.05), 40, 56, 70, 0.07, 0.8, 0.6, 0));
}
function rS(s, t, e, n, i) {
  (i(214, 208, 196, 0.92, 0, 0, 1), n(Zt(s, t, 0.3, 0, 3.7, 2.4), 226, 224, 218, 0.6, 0, 0, 0.2));
  const r = 0.9 + 0.1 * Math.cos((t * Math.PI * 2) / 0.4);
  n(Zt(s, t, 0.38, 0, 3.62, 2.32), 196 * r, 198 * r, 196 * r, 0.5, 0.3, 0, 0.3);
}
(Ul(0), Ul(1), Ul(2), Ul(3), $p(!1), $p(!0), tm(!1), tm(!0), em(!1), em(!0), nm(!1), nm(!0));
const BS = 'https://tiles.openfreemap.org/planet',
  kS = 'https://stac.overturemaps.org/catalog.json',
  zS = (s) => `https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${s}/buildings.pmtiles`,
  HS = '2026-09-23.0',
  Kn = 14,
  im = 4,
  Ol = [3500, 5e3],
  GS = 15e5,
  VS = 26e4,
  xn = 33,
  WS = 3,
  jh = 250 * 2 ** 20,
  Zh = (s) => {
    const t = 256 << (s - 14);
    return t * t * 4 * 1.34;
  },
  qS = (s) => (s < 700 ? 17 : s < 2500 ? 16 : 15);
class Buildings {
  constructor(t, e, n, i) {
    ((this.scene = t),
      (this.geo = e),
      (this.terrain = n),
      (this.db = i),
      (this.enabled = !0),
      (this.triBudget = GS),
      (this.sitMs = WS),
      (this.radiusScale = 1),
      (this.group = new THREE.Group()),
      t.add(this.group),
      (this.tiles = new Map()),
      (this.frame = 0),
      (this.schedT = 0),
      (this.sitCheckT = 0),
      (this.lastKey = ''),
      (this.radius = 5e3),
      (this.fetching = 0),
      (this.template = null),
      (this.templateAt = 0),
      (this.stats = {
        tiles: 0,
        ready: 0,
        tris: 0,
        fetching: 0,
        decoding: 0,
        buildings: 0,
        lastWorkerMs: 0,
        drawCalls: 0,
      }),
      (this.env = null),
      (this.anisotropy = 8),
      (this.roofGain = 1),
      (this.casterMat = applyCurvature(new THREE.MeshBasicMaterial({ colorWrite: !1 }))),
      (this.uni = {
        uB: { value: new THREE.Vector3(1, 1e8, 2e8) },
        uNight: { value: 0 },
        uGain: { value: this.roofGain },
        uFA: { value: null },
        uFD: { value: null },
      }),
      (this.blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)),
      (this.blank.colorSpace = THREE.SRGBColorSpace),
      (this.blank.needsUpdate = !0),
      (this.facReady = !1),
      (this.atlases = new Map()),
      (this.imgJob = null),
      (this.imgId = 0),
      (this.texBytes = 0));
    const r = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    ((this.workers = Array.from({ length: r }, () => {
      const a = new Worker(new URL('./buildings-worker.js', import.meta.url), { type: 'module' }),
        l = { w: a, busy: null };
      return (
        (a.onmessage = (h) => this._decoded(l, h.data)),
        (a.onerror = (h) => {
          (console.warn('buildings worker', h.message),
            l.busy && ((l.busy.state = 'failed'), (l.busy.retryAt = performance.now() + 15e3), (l.busy = null)));
        }),
        l
      );
    })),
      (this.jobs = []),
      (this.jobId = 0),
      (this.imgWorker = new Worker(new URL('./buildings-worker.js', import.meta.url), { type: 'module' })),
      (this.imgWorker.onmessage = (a) => (a.data.type === 'facades' ? this._facades(a.data) : this._atlas(a.data))),
      (this.imgWorker.onerror = (a) => {
        (console.warn('buildings imagery worker', a.message),
          this.imgJob && ((this.imgJob.t.imgRetry = performance.now() + 2e4), (this.imgJob = null)));
      }),
      this.imgWorker.postMessage({ type: 'facades' }));
  }
  _facades(t) {
    const e = (n, i) => {
      const r = new THREE.DataArrayTexture(n, to, to, Qp);
      return (
        (r.colorSpace = i ? THREE.SRGBColorSpace : ''),
        (r.generateMipmaps = !0),
        (r.minFilter = 1008),
        (r.magFilter = 1006),
        (r.wrapS = r.wrapT = 1e3),
        (r.anisotropy = this.anisotropy),
        (r.needsUpdate = !0),
        r
      );
    };
    ((this.uni.uFA.value = e(t.alb, !0)), (this.uni.uFD.value = e(t.dat, !1)), (this.facReady = !0));
  }
  _material() {
    const t = new THREE.MeshStandardMaterial({ vertexColors: !0, roughness: 0.9, metalness: 0 });
    ((t.defines = { WORLD_SHADOWS: '' }), applyCurvature(t));
    const e = t.onBeforeCompile,
      n = this.uni,
      i = { uRoof: { value: this.blank }, uImg: { value: 0 } };
    return (
      (t.userData.own = i),
      (t.onBeforeCompile = (r, a) => {
        (e(r, a),
          Object.assign(r.uniforms, n, i, SHADOW_UNIFORMS),
          (r.vertexShader = r.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
          attribute vec2 aUv; attribute vec4 aFac; attribute vec2 aCen;
          varying vec2 vBu; varying vec4 vBf; varying vec2 vBc;`,
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
vBu = aUv; vBf = aFac; vBc = aCen;`,
            )),
          (r.fragmentShader = r.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
          uniform vec3 uB; uniform float uNight, uGain, uImg;
          uniform sampler2D uRoof; uniform highp sampler2DArray uFA, uFD;
          varying vec2 vBu; varying vec4 vBf; varying vec2 vBc;
          ${sd}
          float bh(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }`,
            )
            .replace(
              '#include <clipping_planes_fragment>',
              `#include <clipping_planes_fragment>
          { float f = uB.x * (1.0 - smoothstep(uB.y, uB.z, length(vViewPosition)));
            if (f < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= f) discard; }`,
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
          vec4 fD = vec4(0.0, 0.9, 0.0, 0.0); vec3 fE = vec3(0.0); bool isRoof = vBf.x < -0.5;
          if (isRoof) {
            if (uImg > 0.5) diffuseColor.rgb = texture2D(uRoof, vBu).rgb * uGain;
          } else {
            vec2 tc = vec2(vBu.x, -vBu.y);
            float lay = floor((vBu.y < 1.0 ? vBf.y : vBf.x) + 0.5);
            vec3 fl = vec3(tc, lay);
            vec3 fa = texture(uFA, fl).rgb; fD = texture(uFD, fl);
            vec3 tint = diffuseColor.rgb;
            if (uImg > 0.5) { // hue of the roof imagery under this building nudges the wall colour
              vec3 s = textureLod(uRoof, vBc, 4.0).rgb; float l = dot(s, vec3(0.3, 0.59, 0.11)) + 1e-3;
              tint *= mix(vec3(1.0), clamp(s / l, 0.6, 1.6), 0.3);
            }
            vec2 id = floor(vBu);
            fa *= mix(1.0, 0.8 + 0.4 * bh(vec3(id, vBf.z * 41.0)), fD.r);
            diffuseColor.rgb = fa * mix(vec3(1.0), tint, fD.a) * mix(0.5, 1.0, smoothstep(0.0, 6.0, vBf.w));
            if (uNight > 0.01 && fD.r > 0.02) {
              float pOn = uNight * (0.2 + 0.55 * (0.3 + 0.7 * bh(vec3(vBf.z * 91.0, 3.0, 5.0))));
              if (lay > 13.5 && lay < 15.5) pOn = uNight * 0.85;
              float lit = step(bh(vec3(id, vBf.z * 77.0 + 1.0)), pOn);
              vec3 ec = mix(vec3(1.0, 0.62, 0.32), vec3(0.72, 0.84, 1.0), step(0.72, bh(vec3(id, vBf.z * 13.0 + 7.0))));
              fE = ec * lit * fD.r * (0.7 + 0.8 * bh(vec3(id, vBf.z * 5.0 + 2.0))) * 1.8;
            }
          }`,
            )
            .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = isRoof ? 0.9 : max(fD.g, 0.04);')
            .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = isRoof ? 0.0 : fD.b * 0.45;')
            .replace(
              '#include <lights_fragment_end>',
              `#include <lights_fragment_end>
          { mat3 iv = transpose(mat3(viewMatrix)); float ws = worldShadow(iv * -vViewPosition, normalize(iv * normal));
            reflectedLight.directDiffuse *= ws; reflectedLight.directSpecular *= ws; }`,
            )
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
totalEmissiveRadiance += fE + diffuseColor.rgb * 0.16 * (1.0 - uNight);`,
            )));
      }),
      (t.customProgramCacheKey = () => 'buildings'),
      t
    );
  }
  async _template() {
    return this.template
      ? this.template
      : (this.templatePromise ||
          (this.templatePromise = fetch(BS)
            .then((t) => t.json())
            .then((t) => ((this.template = t.tiles[0]), this.template))
            .catch(() => ((this.templatePromise = null), null))),
        this.templatePromise);
  }
  _tile(t, e, n, i) {
    const r = `${t}/${e}`;
    let a = this.tiles.get(r);
    if (!a) {
      const l = ty2lat(e, Kn),
        h = ty2lat(e + 1, Kn),
        u = tx2lon(t, Kn),
        f = tx2lon(t + 1, Kn);
      ((a = {
        key: r,
        x: t,
        y: e,
        lat0: h,
        lat1: l,
        lon0: u,
        lon1: f,
        clat: ty2lat(e + 0.5, Kn),
        clon: tx2lon(t + 0.5, Kn),
        state: 'new',
        mesh: null,
        dist: 0,
        tris: 0,
        retryAt: 0,
        abort: null,
        wver: -1,
        wx: 0,
        wz: 0,
      }),
        (a.cosT = Math.cos(a.clat * D2R)),
        (a.W = (f - u) * D2R * R_EARTH * a.cosT),
        (a.H = (l - h) * D2R * R_EARTH),
        (a.dist = this._dist(a, n, i)),
        a.dist < this.radius && this.tiles.set(r, a));
    }
    return a;
  }
  _dist(t, e, n) {
    const i = Math.min(t.lat1, Math.max(t.lat0, e)),
      r = Math.min(t.lon1, Math.max(t.lon0, n));
    return Math.hypot((i - e) * D2R * R_EARTH, (r - n) * D2R * R_EARTH * Math.cos(e * D2R));
  }
  _drop(t) {
    (t.abort && (t.abort.abort(), (t.abort = null)),
      t.state === 'fetching' && this.fetching--,
      this.imgJob && this.imgJob.t === t && this._abortImg(),
      t.mesh && (this.group.remove(t.mesh), t.mesh.geometry.dispose(), t.mesh.material.dispose(), (t.mesh = null)),
      t.atlas && ((t.atlas.owner = null), (t.atlas.last = performance.now()), (t.atlas = null)),
      (t.state = 'disposed'),
      (t.buf = null),
      this.tiles.delete(t.key));
  }
  clear() {
    for (const t of [...this.tiles.values()]) this._drop(t);
    this.jobs.length = 0;
    for (const t of this.atlases.values()) t.tex.dispose();
    (this.atlases.clear(), (this.texBytes = 0));
  }
  _runways(t) {
    const e = [];
    if (!this.db.ready) return e;
    for (const { a: n } of this.db.near(t.clat, t.clon, 7))
      for (const i of n.runways) {
        const r = (i.lon - t.clon) * D2R * R_EARTH * t.cosT,
          a = (i.lat - t.clat) * D2R * R_EARTH;
        e.push([r, a, i.sinH, i.cosH, i.len / 2 + 30, i.width / 2 + 30]);
      }
    return e;
  }
  async _overture() {
    return this.ovPromise
      ? this.ovPromise
      : ((this.ovPromise = (async () => {
          let t = [];
          try {
            t = (await (await fetch(kS)).json()).links
              .filter((n) => n.rel === 'child')
              .map((n) => (n.href.match(/(\d{4}-\d{2}-\d{2}\.\d+)/) || [])[1])
              .filter(Boolean)
              .sort()
              .reverse();
          } catch {}
          for (const e of [...t.slice(0, 3), HS])
            try {
              const n = new PMTiles(zS(e));
              return (await n.getHeader(), (this.release = e), n);
            } catch {}
          return null;
        })()),
        this.ovPromise);
  }
  async _fetch(t) {
    const e = this.source !== 'ofm' ? await this._overture() : null;
    if (t.state === 'disposed') return;
    if (e) {
      t.abort = new AbortController();
      try {
        const i = await e.getZxy(Kn, t.x, t.y, t.abort.signal);
        if (t.state === 'disposed') return;
        if (((t.abort = null), this.fetching--, !i || !i.data || !i.data.byteLength)) {
          t.state = 'ready';
          return;
        }
        ((t.state = 'queued'), (t.buf = i.data), (t.src = 'overture'), this.jobs.push(t));
        return;
      } catch {
        if (t.state === 'disposed') return;
        if (((t.abort = null), (t.ovFails = (t.ovFails || 0) + 1), t.ovFails < 2)) {
          (this.fetching--, (t.state = 'failed'), (t.retryAt = performance.now() + 5e3));
          return;
        }
      }
    }
    const n = await this._template();
    if (t.state !== 'disposed') {
      if (!n) {
        ((t.state = 'failed'), (t.retryAt = performance.now() + 8e3), this.fetching--);
        return;
      }
      t.abort = new AbortController();
      try {
        const i = await fetch(n.replace('{z}', Kn).replace('{x}', t.x).replace('{y}', t.y), { signal: t.abort.signal });
        if (t.state === 'disposed') return;
        if (i.status === 404 || i.status === 204) {
          ((t.abort = null), this.fetching--, (t.state = 'ready'));
          return;
        }
        if (!i.ok) throw new Error(`HTTP ${i.status}`);
        const r = await i.arrayBuffer();
        if (t.state === 'disposed') return;
        ((t.abort = null), this.fetching--, (t.state = 'queued'), (t.buf = r), (t.src = 'ofm'), this.jobs.push(t));
      } catch {
        if (t.state === 'disposed') return;
        ((t.abort = null), this.fetching--, (t.state = 'failed'), (t.retryAt = performance.now() + 1e4));
      }
    }
  }
  _pump() {
    if (this.fetching < im) {
      const t = [...this.tiles.values()]
        .filter((e) => e.state === 'new' || (e.state === 'failed' && performance.now() > e.retryAt))
        .sort((e, n) => e.dist - n.dist);
      for (const e of t) {
        if (this.fetching >= im) break;
        e.dist > this.radius || ((e.state = 'fetching'), this.fetching++, this._fetch(e));
      }
    }
    if (!(!this.db.ready || !this.jobs.length))
      for (const t of this.workers) {
        if (t.busy) continue;
        if (((this.jobs = this.jobs.filter((i) => i.state === 'queued')), !this.jobs.length)) break;
        this.jobs.sort((i, r) => i.dist - r.dist);
        const e = this.jobs.shift();
        ((e.state = 'decoding'), (t.busy = e));
        const n = e.buf;
        ((e.buf = null),
          t.w.postMessage(
            { id: ++this.jobId, buf: n, src: e.src, W: e.W, H: e.H, runways: this._runways(e), maxTris: VS },
            [n],
          ));
      }
  }
  _decoded(t, e) {
    const n = t.busy;
    if (((t.busy = null), (this.stats.lastWorkerMs = e.ms || 0), !n || n.state !== 'decoding')) return;
    if (e.error) {
      (console.warn('buildings decode', e.error), (n.state = 'failed'), (n.retryAt = performance.now() + 3e4));
      return;
    }
    if (e.empty || !e.count) {
      n.state = 'ready';
      return;
    }
    const i = new THREE.BufferGeometry();
    (i.setAttribute('position', new THREE.BufferAttribute(e.pos, 3)),
      i.setAttribute('normal', new THREE.BufferAttribute(e.nor, 3, !0)),
      i.setAttribute('color', new THREE.BufferAttribute(e.col, 3, !0)),
      i.setAttribute('aUv', new THREE.BufferAttribute(e.uv, 2)),
      i.setAttribute('aFac', new THREE.BufferAttribute(e.fac, 4)),
      i.setAttribute('aCen', new THREE.BufferAttribute(e.cen, 2, !0)));
    const r = new THREE.Mesh(i, this._material());
    ((r.userData.casterMat = this.casterMat),
      r.layers.enable(SHADOW_LAYER),
      (r.visible = !1),
      (r.castShadow = !1),
      (r.receiveShadow = !1),
      this.group.add(r),
      (n.mesh = r),
      (n.tris = e.verts / 3),
      (n.count = e.count),
      (n.ms = e.ms),
      (n.bStart = e.bStart),
      (n.bCount = e.bCount),
      (n.bInfo = e.bInfo),
      (n.base = new Float32Array(e.count)),
      (n.state = 'ready'),
      (n.sited = !1),
      (n.fine = !1),
      (n.gridI = -1),
      (n.atlas = null),
      (n.want = 15),
      (n.imgRetry = 0));
    const a = this.atlases.get(n.key);
    a && this._attach(n, a);
  }
  _attach(t, e) {
    ((e.owner = t), (e.last = performance.now()), (t.atlas = e));
    const n = t.mesh.material.userData.own;
    ((n.uRoof.value = e.tex), (n.uImg.value = 1), (t.mesh.material.uniformsNeedUpdate = !0));
  }
  _abortImg() {
    this.imgJob && this.imgWorker.postMessage({ type: 'abort', id: this.imgJob.id });
  }
  _imgPump() {
    const t = performance.now();
    if (!this.imgJob && this.terrain.stats.imgWait > 30 && (this.deferAt || (this.deferAt = t), t - this.deferAt < 6e3))
      return;
    if (((this.deferAt = 0), this.imgJob)) {
      const r = this.imgJob;
      r.t.state === 'disposed' && !r.aborting && ((r.aborting = !0), this._abortImg());
      return;
    }
    const e = [...this.tiles.values()].filter((r) => r.mesh).sort((r, a) => r.dist - a.dist);
    let n = 0;
    for (const r of e) {
      let a = qS(r.dist);
      for (; a > 15 && n + Zh(a) > jh * 0.8;) a--;
      ((n += Zh(a)), (r.want = a));
    }
    const i = e.filter((r) => t > r.imgRetry && (!r.atlas || r.atlas.z < r.want));
    i.sort((r, a) => !!r.atlas - !!a.atlas || r.dist - a.dist);
    for (const r of i) {
      const a = this.atlases.get(r.key);
      if (a && a.z >= r.want) {
        r.atlas !== a && this._attach(r, a);
        continue;
      }
      ((this.imgJob = { id: ++this.imgId, t: r, z: r.want }),
        this.imgWorker.postMessage({ type: 'atlas', id: this.imgJob.id, x14: r.x, y14: r.y, z: r.want }));
      return;
    }
  }
  _atlas(t) {
    const e = this.imgJob;
    if (!e || e.id !== t.id) {
      t.bitmap && t.bitmap.close();
      return;
    }
    this.imgJob = null;
    const n = e.t;
    if (t.aborted) return;
    if (t.none) {
      n.imgRetry = performance.now() + 3e4;
      return;
    }
    if (n.state === 'disposed') {
      t.bitmap.close();
      return;
    }
    const i = new THREE.Texture(t.bitmap);
    ((i.colorSpace = THREE.SRGBColorSpace),
      (i.flipY = !1),
      (i.generateMipmaps = !0),
      (i.minFilter = 1008),
      (i.magFilter = 1006),
      (i.anisotropy = this.anisotropy),
      (i.onUpdate = () => {
        ((i.onUpdate = null), t.bitmap.close());
      }),
      (i.needsUpdate = !0));
    const r = this.atlases.get(n.key);
    r && r.tex.dispose();
    const a = { tex: i, z: t.z, bytes: Zh(t.z), last: performance.now(), owner: null };
    (this.atlases.set(n.key, a), n.mesh && this._attach(n, a), this._trim());
  }
  _trim() {
    let t = 0;
    for (const e of this.atlases.values()) t += e.bytes;
    if (t > jh) {
      const e = [...this.atlases.entries()].sort(
        ([, n], [, i]) => !!n.owner - !!i.owner || (n.owner ? i.owner.dist - n.owner.dist : n.last - i.last),
      );
      for (const [n, i] of e) {
        if (t <= jh) break;
        if (i.owner) {
          i.owner.atlas = null;
          const r = i.owner.mesh.material.userData.own;
          ((r.uImg.value = 0), (r.uRoof.value = this.blank), (i.owner.mesh.material.uniformsNeedUpdate = !0));
        }
        (i.tex.dispose(), this.atlases.delete(n), (t -= i.bytes));
      }
    }
    this.texBytes = t;
  }
  _sample(t, e) {
    const n = this.terrain;
    if (t.gridI < 0) {
      if (n.heightAt(t.clat, t.clon) === null) return !1;
      ((t.grid = new Float32Array(xn * xn).fill(NaN)),
        (t.gridI = 0),
        (t.fineAtStart = n.heightReady(t.clat, t.clon)),
        (t.gLat = Array.from({ length: xn }, (i, r) => ty2lat(t.y + r / (xn - 1), Kn))),
        (t.gLon = Array.from({ length: xn }, (i, r) => tx2lon(t.x + r / (xn - 1), Kn))));
    }
    for (; t.gridI < xn * xn;) {
      const i = (t.gridI / xn) | 0,
        r = t.gridI % xn,
        a = n.heightAt(t.gLat[i], t.gLon[r]);
      if (((t.grid[t.gridI++] = a === null ? NaN : a), (t.gridI & 7) === 0 && performance.now() > e))
        return t.gridI >= xn * xn;
    }
    return !0;
  }
  _applyHeights(t) {
    const e = t.grid,
      n = e.find((d) => !Number.isNaN(d)) ?? 0;
    for (let d = 0; d < e.length; d++) Number.isNaN(e[d]) && (e[d] = n);
    const i = (d, p) => {
        const v = Math.min(1, Math.max(0, d / t.W + 0.5)) * (xn - 1),
          y = Math.min(1, Math.max(0, 0.5 - p / t.H)) * (xn - 1),
          x = Math.min(xn - 2, v | 0),
          g = Math.min(xn - 2, y | 0),
          _ = v - x,
          w = y - g,
          b = g * xn + x;
        return (e[b] * (1 - _) + e[b + 1] * _) * (1 - w) + (e[b + xn] * (1 - _) + e[b + xn + 1] * _) * w;
      },
      r = t.mesh.geometry.attributes.position,
      a = r.array,
      l = t.bInfo;
    let h = 1e9,
      u = -1e9;
    for (let d = 0; d < t.count; d++) {
      const p = d * 6,
        v = l[p],
        y = l[p + 1],
        x = l[p + 2],
        g = l[p + 3],
        _ = l[p + 4],
        w = l[p + 5];
      let b = i(v, y);
      Math.hypot(_ - x, w - g) > 8 &&
        (b = Math.min(b, i(x, y), i(_, y), i(v, g), i(v, w), i(x, g), i(_, g), i(x, w), i(_, w)));
      const S = b - t.base[d];
      if (((t.base[d] = b), b < h && (h = b), b > u && (u = b), !(Math.abs(S) < 0.01)))
        for (let E = t.bStart[d], A = E + t.bCount[d]; E < A; E++) a[E * 3 + 1] += S;
    }
    r.needsUpdate = !0;
    const f = (h + u) / 2;
    ((t.mesh.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, f + 150, 0),
      Math.hypot(t.W, t.H) / 2 + (u - h) / 2 + 700,
    )),
      (t.sited = !0),
      (t.fine = t.fineAtStart),
      (t.gridI = -1),
      (t.mesh.visible = !0));
  }
  _evict() {
    let t = 0;
    const e = [];
    for (const n of this.tiles.values()) {
      if (n.dist > this.radius * (n.mesh || n.state === 'ready' ? 1.35 : 1.1) && n.state !== 'decoding') {
        this._drop(n);
        continue;
      }
      n.mesh && ((t += n.tris), e.push(n));
    }
    if (t > this.triBudget) {
      e.sort((n, i) => i.dist - n.dist);
      for (const n of e) {
        if (t <= this.triBudget) break;
        ((t -= n.tris), this._drop(n));
      }
    }
  }
  update(t, e, n, i, r) {
    if (!this.enabled) {
      (this.tiles.size && this.clear(), (this.group.visible = !1));
      return;
    }
    this.frame++;
    const a = performance.now(),
      l = this.geo,
      h = 1 - Math.min(1, Math.max(0, (i - Ol[0]) / (Ol[1] - Ol[0]))),
      u = i > Ol[1];
    if (
      ((r = r || this.env),
      (this.uni.uNight.value = r ? r.night : 0),
      (this.uni.uGain.value = this.roofGain),
      (this.group.visible = !u && this.facReady),
      (this.radius = (4500 + Math.min(Math.max(i, 0), 5e3) * 0.9) * this.radiusScale),
      this.uni.uB.value.set(h * h * (3 - 2 * h), this.radius * 0.6, this.radius * 1),
      !u && a - this.schedT > 250)
    ) {
      this.schedT = a;
      const g = this.radius / R_EARTH / D2R,
        _ = g / Math.max(0.05, Math.cos(e * D2R)),
        w = 1 << Kn,
        b = Math.floor(lon2tx(n - _, Kn)),
        S = Math.floor(lon2tx(n + _, Kn)),
        E = Math.max(0, Math.floor(lat2ty(Math.min(85, e + g), Kn))),
        A = Math.min(w - 1, Math.floor(lat2ty(Math.max(-85, e - g), Kn)));
      for (let D = E; D <= A; D++)
        for (let N = b; N <= S; N++) {
          const R = ((N % w) + w) % w;
          this._tile(R, D, e, n);
        }
      for (const D of this.tiles.values()) D.dist = this._dist(D, e, n);
      (this._evict(), this._pump(), this._imgPump());
    }
    if (u) return;
    const f = performance.now() + this.sitMs,
      d = [...this.tiles.values()].filter(
        (g) =>
          g.mesh &&
          (!g.sited ||
            (!g.fine && a - (g.refitT || 0) > 1500 && this.terrain.heightReady(g.clat, g.clon)) ||
            g.gridI >= 0),
      );
    d.sort((g, _) => g.sited - _.sited || g.dist - _.dist);
    for (const g of d) {
      if (performance.now() > f) break;
      (g.sited && g.gridI < 0 && ((g.refitT = a), (g.gridI = -1)), this._sample(g, f) && this._applyHeights(g));
    }
    let p = 0,
      v = 0,
      y = 0;
    for (const g of this.tiles.values())
      if (g.mesh) {
        if (g.wver !== l.version) {
          const _ = l.toXZ(g.clat, g.clon);
          ((g.wx = _.x), (g.wz = _.z), (g.wver = l.version), g.mesh.scale.set(l.cos0 / g.cosT, 1, 1));
        }
        (g.mesh.position.set(g.wx - t.x, -t.y, g.wz - t.z), (p += g.tris), v++, g.sited && y++);
      }
    const x = this.stats;
    ((x.texMB = (this.texBytes + (this.facReady ? 2 * Qp * to * to * 5.33 : 0)) / 2 ** 20),
      (x.atlases = this.atlases.size),
      (x.tiles = this.tiles.size),
      (x.ready = v),
      (x.tris = p),
      (x.fetching = this.fetching),
      (x.drawCalls = y),
      (x.decoding = this.workers.filter((g) => g.busy).length),
      (x.buildings = [...this.tiles.values()].reduce((g, _) => g + (_.count || 0), 0)));
  }
}

export { Buildings };
