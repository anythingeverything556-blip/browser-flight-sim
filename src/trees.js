import * as THREE from 'three';
import { D2R, R_EARTH, lat2ty, lon2tx, tx2lon, ty2lat } from './geo.js';
import { esriUrl } from './imagery-sources.js';
import { SHADOW_LAYER, SHADOW_UNIFORMS, sd } from './shadows.js';
import { OCC_UNIFORMS, OCC_DECL, OCC_TEST } from './occlusion.js';

const jS = 'https://tiles.openfreemap.org/planet',
  ZS = (s, t) => esriUrl(17, s, t),
  Un = 15,
  KS = 14,
  YS = 5, // concurrent satellite-tile fetches for tree colour (a chunk needs 16; 2 made far chunks take many seconds)
  JS = 2,
  Kh = [900, 1500],
  QS = 5e3,
  sm = 24,
  Mn = 25,
  $S = 3,
  rm = (0.5 / R_EARTH).toExponential(8);
class dd {
  constructor() {
    ((this.p = []), (this.n = []), (this.c = []));
  }
  tri(t, e, n) {
    const i = e.p[0] - t.p[0],
      r = e.p[1] - t.p[1],
      a = e.p[2] - t.p[2],
      l = n.p[0] - t.p[0],
      h = n.p[1] - t.p[1],
      u = n.p[2] - t.p[2],
      f = r * u - a * h,
      d = a * l - i * u,
      p = i * h - r * l;
    if (f * f + d * d + p * p < 1e-14) return;
    const v = t.n[0] + e.n[0] + n.n[0],
      y = t.n[1] + e.n[1] + n.n[1],
      x = t.n[2] + e.n[2] + n.n[2];
    f * v + d * y + p * x < 0 && !this.double && ([e, n] = [n, e]);
    for (const g of [t, e, n]) (this.p.push(...g.p), this.n.push(...g.n), this.c.push(...g.c));
  }
  geometry() {
    const t = new THREE.BufferGeometry();
    return (
      t.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)),
      t.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)),
      t.setAttribute('aVC', new THREE.Float32BufferAttribute(this.c, 4)),
      t
    );
  }
}
const ya = (s) => {
    const t = Math.hypot(s[0], s[1], s[2]) || 1;
    return [s[0] / t, s[1] / t, s[2] / t];
  },
  po = (s, t, e) => {
    let n =
      (Math.imul(Math.round(s * 997), 374761393) +
        Math.imul(Math.round(t * 997), 668265263) +
        Math.imul(Math.round(e * 997), 2147483647)) |
      0;
    return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
  },
  O0 = (s, t, e) => {
    const n = Math.min(1, Math.max(0, (e - s) / (t - s)));
    return n * n * (3 - 2 * n);
  };
function om(s, t, e, n, i, r, a, l = 0.5) {
  const h = new THREE.IcosahedronGeometry(1, n).attributes.position,
    u = (f) => {
      const d = [h.getX(f), h.getY(f), h.getZ(f)],
        p = 1 + 0.2 * (po(d[0], d[1], d[2]) - 0.5),
        v = [t[0] + d[0] * e[0] * p, t[1] + d[1] * e[1] * p, t[2] + d[2] * e[2] * p],
        y = ya([(v[0] - i[0]) / 1, (v[1] - i[1]) * 1.6, (v[2] - i[2]) / 1]),
        x = ya([d[0] * 0.45 + y[0] * 0.55, d[1] * 0.45 + y[1] * 0.55 + 0.1, d[2] * 0.45 + y[2] * 0.55]),
        g = (l + (1 - l) * O0(r, a, v[1])) * (0.88 + 0.24 * po(d[2], d[0], d[1]));
      return { p: v, n: x, c: [g, g, g, 0] };
    };
  for (let f = 0; f < h.count; f += 3) s.tri(u(f), u(f + 1), u(f + 2));
}
function fd(s, t, e, n, i = 0) {
  const r = (l) => {
    const { p: h, r: u } = t[l],
      f = [];
    for (let d = 0; d < e; d++) {
      const p = (d / e) * Math.PI * 2,
        v = u * (1 + (l === 0 ? i : 0));
      f.push({
        p: [h[0] + Math.cos(p) * v, h[1], h[2] + Math.sin(p) * v],
        n: [Math.cos(p), 0.15, Math.sin(p)],
        c: [n[0], n[1], n[2], 1],
      });
    }
    return f;
  };
  let a = r(0);
  for (let l = 1; l < t.length; l++) {
    const h = r(l);
    for (let u = 0; u < e; u++) {
      const f = (u + 1) % e;
      (s.tri(a[u], a[f], h[u]), s.tri(a[f], h[f], h[u]));
    }
    a = h;
  }
}
function tT() {
  const s = new dd(),
    t = [0, 0.62, 0];
  (fd(
    s,
    [
      { p: [0, -0.02, 0], r: 0.085 },
      { p: [0, 0.3, 0], r: 0.05 },
      { p: [0.01, 0.58, 0], r: 0.035 },
    ],
    6,
    [0.2, 0.15, 0.1],
    0.35,
  ),
    om(s, [0, 0.64, 0], [0.92, 0.36, 0.92], 1, t, 0.28, 1, 0.42));
  for (let e = 0; e < 3; e++) {
    const n = e * 2.094 + 0.6;
    om(s, [Math.cos(n) * 0.55, 0.5 + e * 0.03, Math.sin(n) * 0.55], [0.58, 0.26, 0.58], 0, t, 0.22, 0.85, 0.38);
  }
  return s.geometry();
}
function eT() {
  const s = new dd();
  fd(
    s,
    [
      { p: [0, -0.02, 0], r: 0.06 },
      { p: [0, 0.3, 0], r: 0.03 },
    ],
    5,
    [0.18, 0.13, 0.1],
    0.3,
  );
  const t = 4,
    e = 8;
  for (let n = 0; n < t; n++) {
    const i = 0.1 + n * 0.185,
      r = i + 0.42 - n * 0.04,
      a = 1 - n * 0.2,
      l = [];
    for (let h = 0; h < e; h++) {
      const u = ((h + n * 0.5) / e) * Math.PI * 2,
        f = a * (0.85 + 0.25 * po(n, h, 3));
      l.push({
        p: [Math.cos(u) * f, i - 0.025 * po(h, n, 1), Math.sin(u) * f],
        n: ya([Math.cos(u), 0.7, Math.sin(u)]),
        c: [0.42, 0.42, 0.42, 0],
      });
    }
    for (let h = 0; h < e; h++) {
      const u = (h + 1) % e,
        f = ((h + 0.5 + n * 0.5) / e) * Math.PI * 2;
      s.tri(l[h], l[u], { p: [0, r, 0], n: ya([Math.cos(f) * 0.4, 1, Math.sin(f) * 0.4]), c: [1, 1, 1, 0] });
    }
  }
  return s.geometry();
}
function nT() {
  const s = new dd();
  s.double = !0;
  const t = [];
  for (let i = 0; i <= 4; i++) {
    const r = i / 4;
    t.push({ p: [0.16 * r * r, r * 0.78 - 0.02, 0], r: 0.075 - 0.025 * r });
  }
  fd(s, t, 5, [0.36, 0.3, 0.24], 0.5);
  const e = [0.16, 0.78, 0],
    n = 10;
  for (let i = 0; i < n; i++) {
    const r = (i / n) * Math.PI * 2 + 0.3,
      a = [Math.cos(r), Math.sin(r)],
      l = 0.05 + 0.07 * po(i, 1, 1),
      h = 0.85 + 0.25 * po(i, 2, 2),
      f = [
        [0, 0, 0.1],
        [0.35, l + 0.04, 0.26],
        [0.7, l - 0.01, 0.22],
        [1, l - 0.13, 0.05],
      ].map((d, p) => {
        const v = e[0] + a[0] * d[0] * h,
          y = e[2] + a[1] * d[0] * h,
          x = e[1] + d[1],
          g = d[2] * 0.9,
          _ = [0.55 + (0.4 * p) / 3, 0, 0, 0].fill(0.55 + (0.4 * p) / 3, 0, 3);
        _[3] = 0;
        const w = (b) => ({
          p: [v - a[1] * g * b, x - 0.012 * Math.abs(b), y + a[0] * g * b],
          n: ya([a[0] * 0.3, 1, a[1] * 0.3]),
          c: _,
        });
        return [w(-1), w(1)];
      });
    for (let d = 0; d < 3; d++) (s.tri(f[d][0], f[d][1], f[d + 1][0]), s.tri(f[d][1], f[d + 1][1], f[d + 1][0]));
  }
  return s.geometry();
}
const Gn = 128,
  Yn = 160;
function iT() {
  const s = document.createElement('canvas');
  ((s.width = Gn * 3), (s.height = Yn * 2));
  const t = s.getContext('2d');
  let e = 12345;
  const n = () => ((e = (e * 1664525 + 1013904223) >>> 0), e / 4294967296),
    i = (l, h = 1) => {
      const u = Math.round(Math.min(1, Math.max(0, l)) * 255);
      return `rgba(${u},${u},${u},${h})`;
    },
    r = (l, h, u, f) => {
      ((t.fillStyle = f), t.beginPath(), t.arc(l, h, u, 0, 6.2832), t.fill());
    };
  for (let l = 0; l < 2; l++)
    for (let h = 0; h < 3; h++) {
      if ((t.save(), t.translate(h * Gn, l * Yn), t.beginPath(), t.rect(0, 0, Gn, Yn), t.clip(), h === 0)) {
        ((t.fillStyle = i(0.25)), t.fillRect(Gn / 2 - 3, Yn * 0.5, 6, Yn * 0.5));
        const u = Gn / 2,
          f = Yn * (0.36 + 0.02 * l),
          d = Gn * 0.47,
          p = Yn * 0.36,
          v = [];
        for (let y = 0; y < 150; y++) {
          const x = n() * 6.2832,
            g = Math.sqrt(n());
          let _ = u + Math.cos(x) * d * g * 0.92,
            w = f + Math.sin(x) * p * g * 0.95 - (l ? 0 : 3);
          (l && Math.abs(_ - u) < d * 0.25 && w > f + p * 0.2 && (w -= p * 0.4), v.push([_, w, 6 + n() * 9]));
        }
        (r(u, f, d * 0.7, i(0.34)), v.sort((y, x) => x[1] - y[1]));
        for (const [y, x, g] of v) {
          const w = 0.95 - 0.55 * Math.min(1, Math.max(0, (x - (f - p)) / (2 * p))) + (n() - 0.5) * 0.18;
          (r(y, x, g, i(w - 0.1)),
            r(y - g * 0.18, x - g * 0.24, g * 0.7, i(w)),
            r(y - g * 0.3, x - g * 0.4, g * 0.3, i(w + 0.12)));
        }
      } else if (h === 1) {
        ((t.fillStyle = i(0.22)), t.fillRect(Gn / 2 - 2, Yn * 0.88, 4, Yn * 0.12));
        const u = 6;
        for (let f = u - 1; f >= 0; f--) {
          const d = Yn * (0.02 + f * 0.13),
            p = Yn * (0.2 + f * 0.145),
            v = Gn * (0.1 + f * 0.075) * (1 + 0.05 * l);
          for (let y = 0; y < 2; y++) {
            ((t.fillStyle = i(y ? 0.8 - f * 0.04 : 0.4)), t.beginPath(), t.moveTo(Gn / 2, d));
            const x = y ? 0.55 : 1;
            for (let g = 1; g <= 8; g++) {
              const _ = g / 8;
              t.lineTo(Gn / 2 + v * x * _ + (n() - 0.5) * 5, d + (p - d) * _ + (g % 2 ? 4 : -2));
            }
            for (let g = 8; g >= 0; g--) {
              const _ = g / 8;
              t.lineTo(Gn / 2 - v * x * _ + (n() - 0.5) * 5, d + (p - d) * _ + (g % 2 ? 4 : -2));
            }
            (t.closePath(), t.fill());
          }
        }
      } else {
        ((t.strokeStyle = i(0.32)),
          (t.lineWidth = 5),
          (t.lineCap = 'round'),
          t.beginPath(),
          t.moveTo(Gn * 0.46, Yn),
          t.quadraticCurveTo(Gn * 0.46, Yn * 0.6, Gn * (0.56 + 0.03 * l), Yn * 0.33),
          t.stroke());
        const u = Gn * (0.56 + 0.03 * l),
          f = Yn * 0.33;
        for (let d = 0; d < 11; d++) {
          const p = (d / 11) * 6.2832 + l * 0.4,
            v = Gn * (0.38 + 0.1 * n()),
            y = u + Math.cos(p) * v,
            x = f + Math.sin(p) * v * 0.4 + v * 0.28 * Math.abs(Math.cos(p)),
            g = u + Math.cos(p) * v * 0.55,
            _ = f - v * 0.2 + Math.sin(p) * v * 0.15,
            w = 0.5 + 0.45 * n();
          for (let b = 0; b <= 14; b++) {
            const S = b / 14,
              E = 1 - S,
              A = E * E * u + 2 * E * S * g + S * S * y,
              D = E * E * f + 2 * E * S * _ + S * S * x,
              N = 2 * E * (g - u) + 2 * S * (y - g),
              R = 2 * E * (_ - f) + 2 * S * (x - _),
              C = Math.hypot(N, R) || 1;
            ((t.strokeStyle = i(w * (0.7 + 0.3 * S))), (t.lineWidth = 2.4 * (1 - S * 0.6) + 0.6));
            const F = 9 * Math.sin(Math.PI * Math.min(1, S * 1.15)) + 1;
            (t.beginPath(),
              t.moveTo(A, D),
              t.lineTo(A - (R / C) * F * 0.5 + (N / C) * 3, D + (N / C) * F * 0.5 + (R / C) * 3 + F * 0.3),
              t.stroke(),
              t.beginPath(),
              t.moveTo(A, D),
              t.lineTo(A + (R / C) * F * 0.5 + (N / C) * 3, D - (N / C) * F * 0.5 + (R / C) * 3 + F * 0.3),
              t.stroke());
          }
        }
      }
      t.restore();
    }
  const a = new THREE.CanvasTexture(s);
  return ((a.colorSpace = ''), (a.anisotropy = 4), (a.generateMipmaps = !0), (a.minFilter = 1008), a);
}
const sT = `
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }`,
  am = `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 iPos; attribute vec4 iA; attribute vec4 iCol;
uniform float uTime, uWind; uniform vec4 uLod; uniform vec3 uBiome;
varying vec3 vNW, vTint, vMV, vVC, vPL, vR, vUp, vTC; varying vec2 vQ, vUv; varying float vFade, vTrunk;
#ifndef IMPOSTOR
attribute vec4 aVC;
#endif
void main() {
  float h = iA.x, rad = iA.y, yaw = iA.z, ph = iPos.x * 0.21 + iPos.z * 0.17;
  vTint = pow(iCol.rgb, vec3(2.2)) * uBiome;
  vec4 wpos, mvPosition;
#ifdef IMPOSTOR
  vec3 cen = iPos + vec3(0.0, h * 0.5, 0.0);
  wpos = modelMatrix * vec4(cen, 1.0);
  wpos.y -= dot(wpos.xz, wpos.xz) * ${rm};
  mvPosition = viewMatrix * wpos;
  float d = length(mvPosition.xyz);
  vec3 tc = -mvPosition.xyz / d;
  vec3 U = viewMatrix[1].xyz;
  vec3 R = cross(U, tc); float rl = length(R);
  R = rl > 0.08 ? R / rl : vec3(1.0, 0.0, 0.0);
  vec3 Up = cross(tc, R);
  float sway = sin(uTime * 1.5 + ph) * uWind * h * 0.018 * (position.y * 0.5 + 0.5);
  mvPosition.xyz += R * (position.x * rad * 1.12 + sway) + Up * (position.y * h * 0.5);
  vR = R; vUp = Up; vTC = tc; vQ = position.xy; vUv = uv;
#ifdef SHADOW_CASTER
  d = length(wpos.xyz); // LOD fades follow the main camera (at the origin), not the shadow camera
#endif
  float fade = smoothstep(uLod.x, uLod.y, d) * (1.0 - smoothstep(uLod.z, uLod.w, d));
#else
  vec3 p = position; p.xz *= rad; p.y *= h;
  float c = cos(yaw), s = sin(yaw);
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
  vec3 n = normal; n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
  float sw = position.y * position.y;
  p.xz += vec2(sin(uTime * 1.7 + ph) + 0.5 * sin(uTime * 3.1 + ph * 2.3), cos(uTime * 1.3 + ph * 1.4)) * uWind * sw * h * 0.03;
  vNW = n; vVC = aVC.rgb; vTrunk = aVC.a; vPL = vec3(p.x, p.y, p.z) * 0.9 + vec3(iPos.x * 0.13, 0.0, iPos.z * 0.13);
  wpos = modelMatrix * vec4(iPos + p, 1.0);
  wpos.y -= dot(wpos.xz, wpos.xz) * ${rm};
  mvPosition = viewMatrix * wpos;
  float d = length(mvPosition.xyz);
#ifdef SHADOW_CASTER
  d = length(wpos.xyz);
#endif
  float fade = 1.0 - smoothstep(uLod.x, uLod.y, d);
#endif
  vFade = fade; vMV = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
  if (fade < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
  lm = `
uniform vec3 uSun; uniform float uDay, uFade, uBorn; uniform sampler2D uAtlas;
varying vec3 vNW, vTint, vMV, vVC, vPL, vR, vUp, vTC; varying vec2 vQ, vUv; varying float vFade, vTrunk;
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
${sT}
${sd}
${OCC_DECL}
float dith(vec2 fc) { return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); }
vec3 shade(vec3 Nv, vec3 V, vec3 tint, float ao) {
  mat3 iv = transpose(mat3(viewMatrix));
  float sh = worldShadow(iv * vMV, normalize(iv * Nv));
  vec3 S = normalize((viewMatrix * vec4(uSun, 0.0)).xyz), U = viewMatrix[1].xyz;
  float sunVis = smoothstep(0.0, 0.14, uSun.y), ndl = dot(Nv, S), up = dot(Nv, U);
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  float amb = 0.52 + 0.16 * up, sk = 0.62 * sunVis;
  float ref = 0.5 + sk * clamp((uSun.y + 0.5) / 1.5, 0.12, 1.0);
  float lit = clamp((amb + sk * wrap * wrap * (1.4 - 0.4 * wrap) * sh) / ref, 0.42, 1.7);
  float back = pow(clamp(-dot(V, S), 0.0, 1.0), 3.0) * (1.0 - wrap) * sunVis * sh;
  vec3 col = tint * lit * ao + tint * vec3(0.8, 1.0, 0.25) * back * 0.55;
  return col * uDay * 1.22;
}
void main() {
#ifndef SHADOW_CASTER
  ${OCC_TEST}
#endif
#ifdef SHADOW_CASTER
  // shadow maps get a hard cut-off, not the dither the picture uses: a dither pattern that changes with every metre the camera moves is
  // exactly what shadow shimmer looks like
  if (vFade * uFade * uBorn < 0.5) discard;
#else
  float hs = dith(gl_FragCoord.xy);
  if (hs >= vFade * uFade * uBorn) discard;
#endif
  #include <logdepthbuf_fragment>
  vec3 V = normalize(-vMV), col;
#ifdef IMPOSTOR
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec2 q = vec2(vQ.x * 0.95, (vQ.y - 0.3) * 1.15);
  vec3 nl = normalize(vec3(q, 0.55 + 0.45 * sqrt(max(0.0, 1.0 - dot(q, q)))));
  vec3 Nv = nl.x * vR + nl.y * vUp + nl.z * vTC;
  col = shade(Nv, V, vTint * t.rgb * 1.12, 0.92 + 0.12 * vQ.y);
#else
  vec3 N = normalize(mat3(viewMatrix) * vNW);
  if (!gl_FrontFacing) N = -N;
  float m = vn(vPL * 2.2) * 0.6 + vn(vPL * 5.7) * 0.4;
  vec3 base = vTrunk > 0.5 ? vVC : vTint * vVC * (0.72 + 0.56 * m);
  col = shade(N, V, base, 1.0);
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
class Trees {
  constructor(t, e, n, i) {
    ((this.scene = t),
      (this.biome = new THREE.Vector3(1, 1, 1)),
      (this.geo = e),
      (this.terrain = n),
      (this.db = i),
      (this.enabled = !0),
      (this.maxImg = YS),
      (this.radiusScale = 1),
      (this.sitMs = $S),
      (this.wind = 1),
      (this.group = new THREE.Group()),
      t.add(this.group),
      (this.chunks = new Map()),
      (this.imgActive = 0),
      (this.vtActive = 0),
      (this.vtCache = new Map()),
      (this.template = null),
      (this.schedT = 0),
      (this.frame = 0),
      (this.radius = 2500),
      (this.jobId = 0),
      (this.jobs = []),
      (this.stats = {
        chunks: 0,
        ready: 0,
        instances: 0,
        drawCalls: 0,
        imgActive: 0,
        imgQueued: 0,
        decoding: 0,
        lastWorkerMs: 0,
        near: 0,
        far: 0,
      }),
      (this.uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWind: { value: 1 },
          uLod: { value: new THREE.Vector4(800, 1e3, 2e3, 2500) },
          uSun: { value: new THREE.Vector3(0, 1, 0) },
          uDay: { value: 1 },
          uBiome: { value: new THREE.Vector3(1, 1, 1) },
          uFade: { value: 1 },
          uBorn: { value: 1 },
          uAtlas: { value: null },
        },
      ])),
      (this.uniforms.uAtlas.value = iT()),
      Object.assign(this.uniforms, SHADOW_UNIFORMS, OCC_UNIFORMS));
    const r = (u, f) => {
        const d = new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: am,
          fragmentShader: lm,
          fog: !0,
          side: f,
          defines: { ...u, WORLD_SHADOWS: '' },
        });
        return ((d.name = 'trees'), d);
      },
      a = (u) =>
        new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: am,
          fragmentShader: lm,
          side: u.side,
          defines: { ...u.defines, WORLD_SHADOWS: !1, SHADOW_CASTER: '' },
          colorWrite: !1,
        });
    ((this.nearMat = [r({}, 0), r({}, 0), r({}, 2)]),
      (this.impMat = r({ IMPOSTOR: 1 }, 2)),
      (this.casterOf = new Map([...this.nearMat, this.impMat].map((u) => [u, a(u)]))),
      (this.nearGeo = [tT(), eT(), nT()]),
      (this.tris = this.nearGeo.map((u) => u.attributes.position.count / 3)));
    const l = new THREE.BufferGeometry();
    (l.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)),
      l.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)),
      l.setIndex([0, 1, 2, 0, 2, 3]),
      (this.quad = l));
    const h = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    this.workers = Array.from({ length: h }, () => {
      const u = new Worker(new URL('./trees-worker.js', import.meta.url), { type: 'module' }),
        f = { w: u, busy: null };
      return (
        (u.onmessage = (d) => this._decoded(f, d.data)),
        (u.onerror = (d) => {
          (console.warn('trees worker', d.message),
            f.busy && ((f.busy.state = 'failed'), (f.busy.retryAt = performance.now() + 2e4), (f.busy = null)));
        }),
        f
      );
    });
  }
  async _template() {
    return this.template
      ? this.template
      : (this.tplPromise ||
          (this.tplPromise = fetch(jS)
            .then((t) => t.json())
            .then((t) => (this.template = t.tiles[0]))
            .catch(() => ((this.tplPromise = null), null))),
        this.tplPromise);
  }
  _chunk(t, e, n, i) {
    const r = `${t}/${e}`;
    let a = this.chunks.get(r);
    if (!a) {
      const l = ty2lat(e, Un),
        h = ty2lat(e + 1, Un),
        u = tx2lon(t, Un),
        f = tx2lon(t + 1, Un);
      ((a = {
        key: r,
        x: t,
        y: e,
        lat0: h,
        lat1: l,
        lon0: u,
        lon1: f,
        clat: ty2lat(e + 0.5, Un),
        clon: tx2lon(t + 0.5, Un),
        state: 'new',
        meshes: [],
        dist: 0,
        retryAt: 0,
        wver: -1,
        wx: 0,
        wz: 0,
        count: 0,
      }),
        (a.cosT = Math.cos(a.clat * D2R)),
        (a.W = (f - u) * D2R * R_EARTH * a.cosT),
        (a.H = (l - h) * D2R * R_EARTH),
        (a.dist = this._dist(a, n, i)),
        this.chunks.set(r, a));
    }
    return a;
  }
  _dist(t, e, n) {
    const i = Math.min(t.lat1, Math.max(t.lat0, e)),
      r = Math.min(t.lon1, Math.max(t.lon0, n));
    return Math.hypot((i - e) * D2R * R_EARTH, (r - n) * D2R * R_EARTH * Math.cos(e * D2R));
  }
  _drop(t) {
    if (
      (t.abort && (t.abort.abort(), (t.abort = null)),
      t.imgBusy && (this.imgActive -= t.imgBusy),
      (t.imgBusy = 0),
      t.imgs)
    )
      for (const e of t.imgs) e && e.close && e.close();
    (this._free(t), (t.state = 'disposed'), (t.imgs = null), (t.vt = null), this.chunks.delete(t.key));
  }
  _free(t) {
    for (const e of t.meshes) (this.group.remove(e), e.geometry.dispose());
    ((t.meshes = []), (t.count = 0), (t.treeData = null));
  }
  clear() {
    for (const t of [...this.chunks.values()]) t.state !== 'decoding' && this._drop(t);
  }
  _vector(t, e) {
    const n = `${t}/${e}`;
    let i = this.vtCache.get(n);
    if (
      !i &&
      ((i = { key: n, buf: void 0, p: null, used: performance.now() }),
      this.vtCache.set(n, i),
      this.vtActive++,
      (i.p = this._template()
        .then(async (r) => {
          if (!r) throw new Error('no tilejson');
          const a = await fetch(r.replace('{z}', KS).replace('{x}', t).replace('{y}', e));
          if (a.status === 404 || a.status === 204) return null;
          if (!a.ok) throw new Error(`HTTP ${a.status}`);
          return a.arrayBuffer();
        })
        .then(
          (r) => {
            ((i.buf = r), this.vtActive--);
          },
          () => {
            (this.vtActive--, this.vtCache.delete(n), (i.failed = !0));
          },
        )),
      this.vtCache.size > 12)
    ) {
      for (const [r, a] of this.vtCache)
        if (a.buf !== void 0 && performance.now() - a.used > 2e4 && (this.vtCache.delete(r), this.vtCache.size <= 8))
          break;
    }
    return ((i.used = performance.now()), i);
  }
  _pumpImages() {
    const t = [...this.chunks.values()]
        .filter((n) => n.state === 'loading' && n.todo.length)
        .sort((n, i) => n.dist - i.dist),
      e = this.terrain.stats.imgWait > 30 ? 3 : this.maxImg; // terrain imagery has priority, but trees must not starve behind it
    for (const n of t) {
      for (; this.imgActive < e && n.todo.length;) {
        const i = n.todo.shift(),
          r = n.x * 4 + (i & 3),
          a = n.y * 4 + (i >> 2);
        (this.imgActive++,
          (n.imgBusy = (n.imgBusy || 0) + 1),
          fetch(ZS(r, a), { signal: n.abort.signal })
            .then((l) => (l.ok ? l.blob() : null))
            .then((l) => (l && l.size !== 2521 ? createImageBitmap(l) : null))
            .catch(() => null)
            .then((l) => {
              if (n.state !== 'loading') {
                l && l.close();
                return;
              }
              (this.imgActive--, n.imgBusy--, (n.imgs[i] = l), n.pending--);
            }));
      }
      if (this.imgActive >= e) break;
    }
    for (const n of this.chunks.values()) {
      if (n.state !== 'loading' || n.pending > 0) continue;
      const i = n.vtEntry;
      if (i.failed) {
        ((n.state = 'failed'), (n.retryAt = performance.now() + 15e3), (n.imgs = null));
        continue;
      }
      i.buf !== void 0 && ((n.state = 'queued'), (n.abort = null), this.jobs.push(n));
    }
  }
  _pump() {
    for (const t of [...this.chunks.values()].sort((e, n) => e.dist - n.dist))
      (t.state === 'failed' && performance.now() > t.retryAt && (t.state = 'new'),
        !(t.state !== 'new' || t.dist > this.radius) &&
          ((this.vtActive >= JS && !this.vtCache.has(`${t.x >> 1}/${t.y >> 1}`)) ||
            ((t.state = 'loading'),
            (t.abort = new AbortController()),
            (t.imgs = new Array(16).fill(null)),
            (t.pending = 16),
            (t.todo = [...Array(16).keys()]),
            (t.vtEntry = this._vector(t.x >> 1, t.y >> 1)))));
    if ((this._pumpImages(), !(!this.jobs.length || !this.db.ready)))
      for (const t of this.workers) {
        if (t.busy) continue;
        if (((this.jobs = this.jobs.filter((l) => l.state === 'queued')), !this.jobs.length)) break;
        this.jobs.sort((l, h) => l.dist - h.dist);
        const e = this.jobs.shift();
        ((e.state = 'decoding'), (t.busy = e));
        const n = e.imgs;
        e.imgs = null;
        const i = e.vtEntry.buf ? e.vtEntry.buf.slice(0) : null,
          r = [];
        for (const { a: l } of this.db.near(e.clat, e.clon, 6))
          for (const h of l.runways)
            r.push([
              (h.lon - e.clon) * D2R * R_EARTH * e.cosT,
              (h.lat - e.clat) * D2R * R_EARTH,
              h.sinH,
              h.cosH,
              h.len / 2 + 60,
              h.width / 2 + 40,
            ]);
        const a = n.filter(Boolean);
        (i && a.push(i),
          t.w.postMessage(
            {
              id: ++this.jobId,
              x15: e.x,
              y15: e.y,
              sx: e.x & 1,
              sy: e.y & 1,
              W: e.W,
              H: e.H,
              lat: e.clat,
              lon: e.clon,
              date: new Date(),
              elev: this.terrain.heightAt(e.clat, e.clon) ?? 0,
              vt: i,
              imgs: a.length - (i ? 1 : 0) ? n : null,
              runways: r,
              cap: QS,
            },
            a,
          ));
      }
  }
  _decoded(t, e) {
    const n = t.busy;
    if (((t.busy = null), (this.stats.lastWorkerMs = e.ms || 0), !n || n.state !== 'decoding')) return;
    if (e.error) {
      (console.warn('trees decode', e.error), (n.state = 'failed'), (n.retryAt = performance.now() + 3e4));
      return;
    }
    if (
      ((n.state = 'ready'),
      (n.sited = !1),
      (n.fine = !1),
      (n.gridI = -1),
      (n.photo = e.photo),
      (n.ms = e.ms),
      (n.prof = e.prof),
      !e.count)
    )
      return;
    const i = e.count;
    ((n.count = i), (n.pos = e.pos), (n.iPos = new Float32Array(i * 3)));
    for (let l = 0; l < i; l++) ((n.iPos[l * 3] = e.pos[l * 2]), (n.iPos[l * 3 + 2] = -e.pos[l * 2 + 1]));
    ((n.iA = e.A), (n.iC = e.C));
    const r = (l, h, u, f, d) => {
      const p = new THREE.InstancedBufferGeometry();
      if (d)
        ((p.index = this.quad.index),
          p.setAttribute('position', this.quad.attributes.position),
          p.setAttribute('uv', this.quad.attributes.uv));
      else for (const y in l.attributes) p.setAttribute(y, l.attributes[y]);
      (p.setAttribute('iPos', new THREE.InstancedBufferAttribute(n.iPos.subarray(u * 3, f * 3), 3)),
        p.setAttribute('iA', new THREE.InstancedBufferAttribute(n.iA.subarray(u * 4, f * 4), 4)),
        p.setAttribute('iCol', new THREE.InstancedBufferAttribute(n.iC.subarray(u * 4, f * 4), 4, !0)),
        (p.instanceCount = f - u));
      const v = new THREE.Mesh(p, h);
      return (
        (v.visible = !1),
        (v.frustumCulled = !0),
        (v.castShadow = !1),
        (v.receiveShadow = !1),
        (v.userData.imp = !!d),
        (v.userData.born = performance.now()),
        // a tile's trees dissolve in over ~1 s (the dither in the fragment shader) instead of appearing all at once
        (v.onBeforeRender = function (r, sc, cam, g, mat) {
          const u = mat.uniforms && mat.uniforms.uBorn;
          if (!u) return;
          const t = Math.min(1, (performance.now() - this.userData.born) / 1100);
          u.value = t * t * (3 - 2 * t); mat.uniformsNeedUpdate = true;
        }),
        (v.userData.casterMat = this.casterOf.get(h)),
        v.layers.enable(SHADOW_LAYER),
        this.group.add(v),
        n.meshes.push(v),
        v
      );
    };
    r(null, this.impMat, 0, i, !0);
    let a = 0;
    for (let l = 0; l < 3; l++) {
      const h = e.counts[l];
      (h && (r(this.nearGeo[l], this.nearMat[l], a, a + h, !1).userData.tris = h * this.tris[l]), (a += h));
    }
  }
  _sample(t, e) {
    const n = this.terrain;
    if (t.gridI < 0) {
      if (n.heightAt(t.clat, t.clon) === null) return !1;
      ((t.grid = new Float32Array(Mn * Mn).fill(NaN)),
        (t.gridI = 0),
        (t.fineAtStart = n.heightReady(t.clat, t.clon)),
        (t.gLat = Array.from({ length: Mn }, (i, r) => ty2lat(t.y + r / (Mn - 1), Un))),
        (t.gLon = Array.from({ length: Mn }, (i, r) => tx2lon(t.x + r / (Mn - 1), Un))));
    }
    for (; t.gridI < Mn * Mn;) {
      const i = (t.gridI / Mn) | 0,
        r = t.gridI % Mn,
        a = n.heightAt(t.gLat[i], t.gLon[r]);
      if (((t.grid[t.gridI++] = a === null ? NaN : a), (t.gridI & 7) === 0 && performance.now() > e))
        return t.gridI >= Mn * Mn;
    }
    return !0;
  }
  _applyHeights(t) {
    const e = t.grid,
      n = e.find((f) => !Number.isNaN(f)) ?? 0;
    for (let f = 0; f < e.length; f++) Number.isNaN(e[f]) && (e[f] = n);
    let i = 1e9,
      r = -1e9;
    for (const f of e) (f < i && (i = f), f > r && (r = f));
    const a = t.iPos,
      l = t.W,
      h = t.H;
    for (let f = 0; f < t.count; f++) {
      const d = Math.min(1, Math.max(0, a[f * 3] / l + 0.5)) * (Mn - 1),
        p = Math.min(1, Math.max(0, 0.5 + a[f * 3 + 2] / h)) * (Mn - 1),
        v = Math.min(Mn - 2, d | 0),
        y = Math.min(Mn - 2, p | 0),
        x = d - v,
        g = p - y,
        _ = y * Mn + v;
      a[f * 3 + 1] = (e[_] * (1 - x) + e[_ + 1] * x) * (1 - g) + (e[_ + Mn] * (1 - x) + e[_ + Mn + 1] * x) * g - 0.3;
    }
    const u = new THREE.Sphere(new THREE.Vector3(0, (i + r) / 2 + 12, 0), Math.hypot(l, h) / 2 + (r - i) / 2 + 40);
    for (const f of t.meshes) ((f.geometry.attributes.iPos.needsUpdate = !0), (f.geometry.boundingSphere = u));
    ((t.sited = !0), (t.fine = t.fineAtStart), (t.gridI = -1));
  }
  update(t, e, n, i, r) {
    if (!this.enabled) {
      (this.chunks.size && this.clear(), (this.group.visible = !1));
      return;
    }
    this.frame++;
    const a = performance.now(),
      l = this.geo,
      h = this.uniforms,
      u = i > Kh[1];
    this.group.visible = !u;
    const f = (this.radius = Math.min(4200, 2200 + Math.max(0, i) * 1.8) * this.radiusScale),
      d = 320 + Math.max(0, i) * 0.35;
    if (
      ((h.uTime.value = a / 1e3),
      (h.uWind.value = this.wind),
      h.uBiome.value.copy(this.biome || h.uBiome.value),
      h.uLod.value.set(d, d * 1.25, f * 0.78, f),
      (h.uFade.value = 1 - O0(Kh[0], Kh[1], i)),
      r && (h.uSun.value.copy(r.sunDir), (h.uDay.value = r.daylight)),
      !u && a - this.schedT > 250)
    ) {
      this.schedT = a;
      const A = f / R_EARTH / D2R,
        D = A / Math.max(0.05, Math.cos(e * D2R)),
        N = 1 << Un,
        R = Math.floor(lon2tx(n - D, Un)),
        C = Math.floor(lon2tx(n + D, Un)),
        F = Math.max(0, Math.floor(lat2ty(Math.min(85, e + A), Un))),
        k = Math.min(N - 1, Math.floor(lat2ty(Math.max(-85, e - A), Un)));
      for (let q = F; q <= k; q++)
        for (let tt = R; tt <= C; tt++) {
          const K = `${((tt % N) + N) % N}/${q}`;
          !this.chunks.has(K) &&
            this._dist(
              { lat0: ty2lat(q + 1, Un), lat1: ty2lat(q, Un), lon0: tx2lon(tt, Un), lon1: tx2lon(tt + 1, Un) },
              e,
              n,
            ) < f &&
            this.chunks.size < sm + 8 &&
            this._chunk(((tt % N) + N) % N, q, e, n);
        }
      const J = [...this.chunks.values()];
      for (const q of J) q.dist = this._dist(q, e, n);
      (J.sort((q, tt) => q.dist - tt.dist),
        J.forEach((q, tt) => {
          q.state !== 'decoding' && (tt >= sm + 4 || q.dist > f * 1.4) && this._drop(q);
        }),
        this._pump());
    }
    if (u) return;
    const p = performance.now() + this.sitMs,
      v = [...this.chunks.values()].filter(
        (A) =>
          A.meshes.length &&
          (!A.sited ||
            (!A.fine && a - (A.refitT || 0) > 1500 && this.terrain.heightReady(A.clat, A.clon)) ||
            A.gridI >= 0),
      );
    v.sort((A, D) => A.sited - D.sited || A.dist - D.dist);
    for (const A of v) {
      if (performance.now() > p) break;
      (A.sited && A.gridI < 0 && (A.refitT = a), this._sample(A, p) && this._applyHeights(A));
    }
    const y = this.stats,
      x = d,
      g = Math.max(0, i - 30);
    let _ = 0,
      w = 0,
      b = 0,
      S = 0,
      E = 0;
    for (const A of this.chunks.values()) {
      if (!A.meshes.length) continue;
      if (A.wver !== l.version) {
        const K = l.toXZ(A.clat, A.clon);
        ((A.wx = K.x), (A.wz = K.z), (A.wver = l.version));
      }
      const D = l.cos0 / A.cosT,
        N = A.wx - t.x,
        R = A.wz - t.z,
        C = (A.W / 2) * D,
        F = A.H / 2,
        k = Math.max(0, Math.abs(N) - C),
        J = Math.max(0, Math.abs(R) - F),
        q = Math.hypot(k, J, g),
        tt = Math.hypot(Math.abs(N) + C, Math.abs(R) + F, g);
      ((_ += A.count), w++);
      for (const K of A.meshes) {
        (K.position.set(N, -t.y, R), K.scale.set(D, 1, 1));
        const ct = A.sited && q < f && (K.userData.imp ? tt > x : q < x * 1.25);
        ((K.visible = ct), ct && (b++, K.userData.imp ? (E += A.count) : (S += K.userData.tris || 0)));
      }
    }
    ((y.chunks = this.chunks.size),
      (y.ready = w),
      (y.instances = _),
      (y.drawCalls = b),
      (y.near = S),
      (y.far = E),
      (y.imgActive = this.imgActive),
      (y.imgQueued = [...this.chunks.values()].reduce((A, D) => A + (D.state === 'loading' ? D.todo.length : 0), 0)),
      (y.decoding = this.workers.filter((A) => A.busy).length));
  }
}

export { Trees };
