import * as THREE from 'three';
import { R_EARTH } from './geo.js';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';
import { SHADOW_UNIFORMS, sd } from './shadows.js';
import { OCC_UNIFORMS, OCC_DECL, OCC_TEST } from './occlusion.js';

const TERRAIN_UNIFORMS = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uRelief: { value: 0.75 },
    uTime: { value: 0 },
    uWaterOff: { value: new THREE.Vector2() },
    uSea: { value: 1 },
    uDetail: { value: 1 },
    uLand: { value: new THREE.Vector4(0, 0, 0, 0) }, // aircraft landing light: position relative to the camera (xyz) and strength (w)
    uLandDir: { value: new THREE.Vector3(1, 0, 0) },
    uBlastA: { value: new THREE.Vector4(0, 0, 0, 0) }, // jet blast: exhaust point relative to the camera (xyz) and strength (w)
    uBlastB: { value: new THREE.Vector4(1, 0, 100, 1e4) }, // unit direction aft in xz, blast length (m), camera height above ground (m)
    uCsTex: { value: null }, uCsMap: { value: new THREE.Vector4(0, 0, 1 / 20000, 0) }, // cloud shadow map (cloudshadow.js)
    uCsTex2: { value: null }, uCsMap2: { value: new THREE.Vector4(0, 0, 1 / 20000, 0) }, uCsMix: { value: 1 }, // the previous map, cross-faded out
    uWet: { value: 0 }, // ground wetness 0..1: darker surface, wet sheen, puddles
    uRip: { value: 0 }, // rain falling on the ground now 0..1: ripples in the puddles
  },
  Qs = [
    [18, 8, 0.012],
    [-12, 22, 0.012],
    [34, -18, 0.018],
    [-46, -28, 0.02],
    [74, 42, 0.026],
    [-102, 66, 0.03],
    [166, -94, 0.034],
    [-242, -190, 0.04],
    [600, -420, 0.05],
    [-1280, 840, 0.055],
    [2200, 1800, 0.06],
    [-4600, 3e3, 0.06],
    [6200, -5600, 0.065],
  ],
  Xp = 16384,
  Ob = (s) => `vec2(${s[0]}.0, ${s[1]}.0)`,
  Bb = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vRel;
void main() {
  vUv = uv; vN = normal;
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  wpos.y -= dot(wpos.xz, wpos.xz) * ${(0.5 / R_EARTH).toExponential(8)};
  vRel = wpos.xyz;
  gl_Position = projectionMatrix * (viewMatrix * wpos);
  #include <logdepthbuf_vertex>
}`,
  kb = `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATM_FRAG}
${sd}
${OCC_DECL}
uniform sampler2D uMap, uMask;
uniform vec3 uTint, uSun; uniform vec4 uTile; uniform float uWater, uRelief, uTime, uSea, uDetail, uWet, uRip; uniform vec2 uWaterOff; uniform vec4 uLand; uniform vec3 uLandDir; uniform vec4 uBlastA, uBlastB, uCsMap, uCsMap2; uniform sampler2D uCsTex, uCsTex2; uniform float uCsMix; uniform float uFade, uFadeDir;
varying vec2 vUv; varying vec3 vN; varying vec3 vRel;

float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, per), b = mod(i + 1.0, per);
  return mix(mix(h21(a), h21(vec2(b.x, a.y)), f.x), mix(h21(vec2(a.x, b.y)), h21(b), f.x), f.y);
}
const vec2 WV[${Qs.length}] = vec2[${Qs.length}](${Qs.map(Ob).join(', ')});
const float WS[${Qs.length}] = float[${Qs.length}](${Qs.map((s) => s[2].toFixed(3)).join(', ')});

// slope-based sea normal from fixed-lattice waves, so it tiles across tiles; waves finer than a pixel are dropped and
// their variance is returned as extra roughness for the sun glint
vec3 seaNormal(vec2 P, float fp, out float lost) {
  vec2 slope = vec2(0.0); lost = 0.0;
  for (int i = 0; i < ${Qs.length}; i++) {
    vec2 k = WV[i] * ${((2 * Math.PI) / Xp).toExponential(6)};
    float kl = length(k), lam = 6.2831853 / kl, w = 1.0 - smoothstep(0.1, 0.4, fp / lam), s = WS[i] * uSea;
    lost += (1.0 - w) * s * s * 0.5;
    if (w > 0.0) slope += w * s * cos(dot(k, P) - sqrt(9.81 * kl) * uTime) * (k / kl);
  }
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

// shadows of the volumetric clouds, read from a small map that cloudshadow.js keeps up to date (one lookup per pixel)
float cloudShade(vec3 rel) {
  if (uCsMap.w < 0.5) return 1.0;
  vec2 q = (rel.xz + uCsMap.xy) * uCsMap.z + 0.5;
  float e = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  float a = mix(1.0, texture2D(uCsTex, q).r, smoothstep(0.0, 0.05, e));
  if (uCsMap2.w > 0.5 && uCsMix < 0.999) {
    vec2 q2 = (rel.xz + uCsMap2.xy) * uCsMap2.z + 0.5;
    float e2 = min(min(q2.x, 1.0 - q2.x), min(q2.y, 1.0 - q2.y));
    a = mix(mix(1.0, texture2D(uCsTex2, q2).r, smoothstep(0.0, 0.05, e2)), a, uCsMix);
  }
  return a;
}
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// expanding rings from random impact points: x,y = surface slope they add
vec2 rippleLayer(vec2 P, float scale, float t, float seed) {
  vec2 g = P * scale, id = floor(g), f = fract(g) - 0.5;
  float a = wHash(id + seed), b = wHash(id * 1.7 + seed + 4.1), c = wHash(id * 0.6 + seed + 9.3);
  float ph = fract(t * (0.7 + 0.6 * c) + a);
  vec2 d = f - (vec2(a, b) - 0.5) * 0.5;
  float dl = length(d) + 1e-4, rad = ph * 0.5, x = dl - rad;
  float amp = exp(-x * x * 150.0) * (1.0 - ph) * (1.0 - ph) * step(c, 0.7);
  return d / dl * sin(x * 60.0) * amp;
}

void main() {
  ${OCC_TEST}
  #include <logdepthbuf_fragment>
  // level-of-detail crossfade: the incoming tile keeps the pixels where the noise is below the fade, the outgoing one the rest (uFade 0 = all outgoing, 1 = all incoming), so the
  // two never both draw the same pixel and the picture dissolves instead of snapping
  if (uFade < 0.999) { float nz = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (uFadeDir > 0.5 ? nz >= uFade : nz < uFade) discard; }
  float dist = length(vRel), fp = max(length(dFdx(vRel.xz)), length(dFdy(vRel.xz)));
  float mk = texture2D(uMask, vUv).r;
  vec3 V = vRel / max(dist, 1e-3), N = normalize(vN);
  vec3 base = texture2D(uMap, vUv).rgb;
  vec3 col = base * uTint;

  // sharpen (unsharp mask on the four neighbours) and add fine grain close up, where the imagery itself runs out of detail
  vec2 px = 1.0 / vec2(textureSize(uMap, 0)); // tiles are 256 or 512 px
  vec3 blur = (texture2D(uMap, vUv + vec2(px.x, 0.0)).rgb + texture2D(uMap, vUv - vec2(px.x, 0.0)).rgb + texture2D(uMap, vUv + vec2(0.0, px.y)).rgb + texture2D(uMap, vUv - vec2(0.0, px.y)).rgb) * 0.25;
  float near = 1.0 - smoothstep(300.0, 6000.0, dist);
  // only where the imagery is shown at about its own resolution or finer: on magnified (blurry, upsampled) imagery
  // sharpening just amplifies JPEG blocks and ringing
  float tpp = max(length(dFdx(vUv)), length(dFdy(vUv))) * float(textureSize(uMap, 0).x); // texels per screen pixel
  col = max(col + (col - blur * uTint) * mix(0.3, 0.6, near) * smoothstep(0.35, 0.9, tpp), 0.0);
  vec2 P = vec2(uTile.x + vUv.x * uTile.z, uTile.y + vUv.y * uTile.z);
  // close-up ground detail, chosen from the photo's colour: grass clumps, soil/rock, fine asphalt grain. Brightness and hue
  // only (no displacement). Each octave fades out once it is smaller than about a pixel, so it never shimmers.
  // jet blast: strength of the exhaust at this ground point (a cone behind the nozzles that widens and fades with distance)
  float bz = 0.0; vec2 bdir = uBlastB.xy;
  if (uBlastA.w > 0.001) {
    vec2 bd = vRel.xz - uBlastA.xz; float al = dot(bd, bdir), ac = abs(bd.x * bdir.y - bd.y * bdir.x), bw = 3.0 + 0.22 * max(al, 0.0);
    bz = uBlastA.w * smoothstep(-3.0, 6.0, al) * (1.0 - smoothstep(0.3 * uBlastB.z, uBlastB.z, al)) * exp(-(ac * ac) / (bw * bw));
  }
  float gd = (1.0 - smoothstep(60.0, 1800.0, dist)) * uDetail;
  if (gd > 0.0 && uTile.z < 5000.0) {
    float sum = base.r + base.g + base.b + 1e-3;
    float veg = smoothstep(0.02, 0.12, (2.0 * base.g - base.r - base.b) / sum);
    float grey = (1.0 - veg) * (1.0 - smoothstep(0.03, 0.11, max(abs(base.r - base.g), abs(base.g - base.b)) * 3.0 / sum));
    float soil = (1.0 - veg) * (1.0 - grey);
    float w0 = 1.0 - smoothstep(0.35, 1.0, fp * 8.0), w1 = 1.0 - smoothstep(0.35, 1.0, fp * 2.0), w2 = 1.0 - smoothstep(0.35, 1.0, fp * 0.5);
    float n0 = w0 > 0.0 ? vnoise(P * 8.0, 32768.0) - 0.5 : 0.0;
    float n1 = w1 > 0.0 ? vnoise(P * 2.0, 8192.0) - 0.5 : 0.0;
    float n2 = vnoise(P * 0.5, 2048.0) - 0.5, n3 = vnoise(P * 0.125, 512.0) - 0.5;
    float grass = (n0 * 0.5 * w0 + n1 * 0.45 * w1 + n2 * 0.35 * w2 + n3 * 0.25) * (1.0 - 0.6 * bz);
    float rock = (0.25 - abs(n1)) * 0.6 * w1 + n0 * 0.3 * w0 + n2 * 0.35 * w2 + n3 * 0.3;
    float asph = n0 * 0.16 * w0 + n1 * 0.08 * w1 + n3 * 0.1;
    col *= 1.0 + (veg * grass * 0.6 + soil * rock * 0.5 + grey * asph) * gd;
    // individual blades of grass: leaning with the wind, laid flat and streaked aft in the jet blast. Drawn only close to the camera,
    // and only below about 500 ft above the ground, so they cost nothing in the cruise.
    // blades are several pixels wide where they are drawn and fade out as they shrink towards a pixel: sub-pixel blades only shimmer
    float gAgl = 1.0 - smoothstep(110.0, 152.0, uBlastB.w), bl = veg * gAgl * (1.0 - smoothstep(12.0, 38.0, dist)) * (1.0 - smoothstep(0.014, 0.04, fp));
    if (bl > 0.01) {
      float bt = 0.0, bs = 0.0;
      for (int ly = 0; ly < 2; ly++) {
        float sc = 1.4 + 0.6 * float(ly); vec2 qq = P * sc + float(ly) * 17.0, ci = floor(qq), cf = fract(qq) - 0.5;
        float h1 = wHash(ci + float(ly)), h2 = wHash(ci + 7.7), h3 = wHash(ci + 3.1);
        vec2 d0 = vec2(cos(h2 * 6.2832), sin(h2 * 6.2832));
        vec2 db = normalize(mix(d0, bdir, clamp(0.12 + bz * 1.5, 0.0, 1.0)));
        float len = mix(0.26, 0.42, h3) * (1.0 + 0.9 * bz);
        vec2 r = cf - (vec2(h1, h3) - 0.5) * 0.3 + db * 0.0; float tt = clamp(dot(r, db), 0.0, len);
        float aa = max(0.015, fp * sc * 0.8), dd = length(r - db * tt), bld = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, dd);
        bt = max(bt, bld * (0.55 + 0.9 * tt / len)); bs = max(bs, bld);
      }
      col = mix(col, col * clamp(bt, 0.5, 1.5), bs * bl * 0.7);
    }
    col = mix(col, col * vec3(1.08, 1.02, 0.82), clamp(veg * (n2 + n3) * 1.2, -0.5, 0.5) * gd); // dry / lush grass patches
  }
  // grade: a touch of saturation and an S-curve in gamma space against the hazy look of the imagery
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.14);
  vec3 g = pow(max(col, 0.0), vec3(1.0 / 2.2)); g = mix(g, g * g * (3.0 - 2.0 * g), 0.22); col = pow(g, vec3(2.2));

  // wet ground: darker and a little richer in colour; puddles collect on flat, paved ground
  float pud = 0.0, grey2 = 0.0;
  if (uWet > 0.01) {
    float s2 = base.r + base.g + base.b + 1e-3;
    grey2 = 1.0 - smoothstep(0.03, 0.11, max(abs(base.r - base.g), abs(base.g - base.b)) * 3.0 / s2);
    col *= mix(1.0, 0.62 + 0.12 * grey2, uWet);
    float pn = vnoise(P * 0.05, 2048.0) * 0.55 + vnoise(P * 0.21, 8192.0) * 0.3 + vnoise(P * 1.1, 32768.0) * 0.15;
    float pm = smoothstep(0.58 - 0.2 * uWet, 0.64 - 0.14 * uWet, pn) * smoothstep(0.97, 0.997, N.y) * (0.35 + 0.65 * grey2) * (1.0 - smoothstep(1500.0, 5000.0, dist));
    pud = pm * smoothstep(0.3, 0.85, uWet);
  }
  // dust kicked up by the exhaust
  col = mix(col, col * 0.7 + vec3(0.13, 0.11, 0.08), bz * 0.45 * (1.0 - smoothstep(60.0, 140.0, dist) * 0.0));
  // relight: the photo carries its own sun, so only scale by how today's light differs from it, and keep relief gentle
  vec3 amb = 3.14159 * uAtmAmb, sunC = uAtmSunCol;
  vec3 eUp = sunC * max(uAtmSun.y, 0.0) + amb, eN = sunC * max(dot(N, uAtmSun), 0.0) + amb * (0.65 + 0.35 * N.y);
  vec3 tod = clamp(pow(eUp / uAtmRef, vec3(0.6)), 0.0, 1.3);
  float rel = clamp(dot(eN, vec3(0.33)) / max(dot(eUp, vec3(0.33)), 1e-4), 0.55, 1.4);
  rel = mix(1.0, rel, uRelief * 0.7 * smoothstep(0.0, 0.15, uSun.y));
  vec3 moonL = vec3(0.075, 0.09, 0.14) * uMoon.w * (0.55 + 0.45 * max(dot(N, uMoon.xyz), 0.0));
  vec3 light = max(tod, vec3(0.035, 0.045, 0.075) + moonL) * rel;
  vec3 land = col * light;
  // cast shadows from buildings, trees and the aircraft: shadowed ground keeps only its share of sky light
  float shd = min(worldShadow(vRel, N), cloudShade(vRel));
  if (shd < 1.0) {
    float af = clamp(dot(amb * (0.65 + 0.35 * N.y), vec3(1.0)) / max(dot(eN, vec3(1.0)), 1e-4), 0.22, 1.0);
    land *= mix(af, 1.0, shd);
  }

  if (uWet > 0.01) {
    vec3 Vi0 = -V, Nw = N;
    if (pud > 0.0 && uRip > 0.01) {
      float rf = 1.0 - smoothstep(0.004, 0.02, fp);
      vec2 rp = (rippleLayer(P, 2.3, uTime, 1.0) + rippleLayer(P, 3.9, uTime * 1.3, 7.0) * 0.7) * rf * uRip * 0.5;
      Nw = normalize(vec3(rp.x, 1.0, rp.y));
    }
    float cvw = clamp(dot(Nw, Vi0), 0.0, 1.0), Fw = 0.02 + 0.98 * pow(1.0 - cvw, 5.0);
    vec3 Rw = reflect(V, Nw); Rw.y = abs(Rw.y);
    // a film of water mirrors the sky at grazing angles; a standing puddle mirrors it everywhere
    float film = uWet * (0.25 + 0.75 * grey2) * (1.0 - pud);
    vec3 skyW = atmTone(atmSky(Rw)) * Fw;
    vec3 Hw = normalize(uAtmSun + Vi0);
    float rough = mix(0.07, 0.0025, pud) + 0.0008;
    float NHw = max(dot(Nw, Hw), 1e-3), t2w = (1.0 - NHw * NHw) / (NHw * NHw);
    float Dw = exp(-t2w / rough) / (3.14159 * rough * NHw * NHw * NHw * NHw);
    float FHw = 0.02 + 0.98 * pow(1.0 - max(dot(Hw, Vi0), 0.0), 5.0);
    vec3 glintW = uAtmSunCol * (FHw * Dw / (4.0 * max(cvw, 0.08))) * step(0.0, dot(Nw, uAtmSun)) * shd;
    land = mix(land, land * 0.5 * (1.0 - Fw), pud) + (skyW + glintW * 0.5) * (film * 0.55 + pud);
    // drops striking dry-looking wet ground close to the camera: short bright crowns
    if (uRip > 0.01 && dist < 120.0) {
      vec2 gs = P * 6.0, ids = floor(gs), fs = fract(gs) - 0.5;
      float ha = wHash(ids + 3.3), hb = wHash(ids + 8.8), hc = wHash(ids * 1.3 + 1.1);
      float php = fract(uTime * 1.6 + ha), ds = length(fs - (vec2(ha, hb) - 0.5) * 0.5);
      float crown = smoothstep(0.0, 0.12, php) * (1.0 - smoothstep(0.12, 0.4, php)) * exp(-pow((ds - php * 0.35) * 22.0, 2.0)) * step(hc, 0.35 * uRip);
      land += vec3(0.5, 0.55, 0.6) * crown * (1.0 - smoothstep(0.004, 0.02, fp)) * (1.0 - pud) * 0.6;
    }
  }
  // the aircraft's landing light: a lit cone on the ground ahead, falling off with distance
  if (uLand.w > 0.001) {
    vec3 Lv = vRel - uLand.xyz; float dl = length(Lv); vec3 ld = Lv / max(dl, 1e-3);
    float cone = smoothstep(0.9, 0.985, dot(ld, uLandDir));
    float att = min(6.0 / (1.0 + dl * dl * 0.00012), 2.2);
    land += col * vec3(1.0, 0.93, 0.78) * uLand.w * cone * att * (0.3 + 0.7 * max(dot(N, -ld), 0.0));
  }
  float wm = uWater > 1.5 ? 1.0 : uWater > 0.5 ? smoothstep(0.3, 0.7, mk) : 0.0;
  vec3 outc = land;
  if (wm > 0.0) {
    float lost;
    vec3 Wn = seaNormal(mod(vRel.xz + uWaterOff, ${Xp}.0), fp, lost);
    vec3 Vi = -V;
    float cv = clamp(dot(Wn, Vi), 0.0, 1.0), F = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
    vec3 Rf = reflect(V, Wn); Rf.y = abs(Rf.y);
    vec3 refl = atmSky(Rf) * F;
    // sun glint: Beckmann lobe on the half vector, widened by the waves too fine to resolve
    float s2 = 0.0025 + lost * 0.9;
    vec3 Hh = normalize(uAtmSun + Vi);
    float NH = max(dot(Wn, Hh), 1e-3), t2 = (1.0 - NH * NH) / (NH * NH);
    float D = exp(-t2 / s2) / (3.14159 * s2 * NH * NH * NH * NH);
    float FH = 0.02 + 0.98 * pow(1.0 - max(dot(Hh, Vi), 0.0), 5.0);
    refl += uAtmSunCol * (FH * D / (4.0 * max(cv, 0.08))) * step(0.0, dot(Wn, uAtmSun)) * shd;
    // body colour: deep water, pulled towards the imagery where it is bright (shallows, sediment)
    float il = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 deep = vec3(0.005, 0.028, 0.055);
    vec3 body = mix(deep, col * vec3(0.85, 0.95, 1.0), clamp(0.4 + 3.0 * max(il - 0.035, 0.0), 0.0, 1.0)) * light;
    vec3 wc = atmTone(refl) + (1.0 - F) * body;
    outc = mix(land, wc, wm);
  }
  gl_FragColor = vec4(atmAerial(outc, vRel), 1.0);
  #include <colorspace_fragment>
}`;
let Ko = null;
function terrainMaterial() {
  return (
    Ko || ((Ko = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)), (Ko.needsUpdate = !0)),
    new THREE.ShaderMaterial({
      uniforms: {
        ...TERRAIN_UNIFORMS,
        ...ATMOS_UNIFORMS,
        ...SHADOW_UNIFORMS,
        ...OCC_UNIFORMS,
        uMap: { value: Ko },
        uMask: { value: Ko },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uTile: { value: new THREE.Vector4() },
        uWater: { value: 0 },
        uFade: { value: 1 },
        uFadeDir: { value: 0 },
      },
      defines: { WORLD_SHADOWS: '' },
      vertexShader: Bb,
      fragmentShader: kb,
      toneMapped: !1,
    })
  );
}

export { TERRAIN_UNIFORMS, terrainMaterial };
