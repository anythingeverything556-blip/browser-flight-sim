import * as THREE from 'three';
import { R_EARTH } from './geo.js';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';
import { SHADOW_UNIFORMS, sd } from './shadows.js';

const TERRAIN_UNIFORMS = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uRelief: { value: 0.75 },
    uTime: { value: 0 },
    uWaterOff: { value: new THREE.Vector2() },
    uSea: { value: 1 },
    uDetail: { value: 1 },
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
uniform sampler2D uMap, uMask;
uniform vec3 uTint, uSun; uniform vec4 uTile; uniform float uWater, uRelief, uTime, uSea, uDetail; uniform vec2 uWaterOff;
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

void main() {
  #include <logdepthbuf_fragment>
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
    float grass = n0 * 0.5 * w0 + n1 * 0.45 * w1 + n2 * 0.35 * w2 + n3 * 0.25;
    float rock = (0.25 - abs(n1)) * 0.6 * w1 + n0 * 0.3 * w0 + n2 * 0.35 * w2 + n3 * 0.3;
    float asph = n0 * 0.16 * w0 + n1 * 0.08 * w1 + n3 * 0.1;
    col *= 1.0 + (veg * grass * 0.6 + soil * rock * 0.5 + grey * asph) * gd;
    col = mix(col, col * vec3(1.08, 1.02, 0.82), clamp(veg * (n2 + n3) * 1.2, -0.5, 0.5) * gd); // dry / lush grass patches
  }
  // grade: a touch of saturation and an S-curve in gamma space against the hazy look of the imagery
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.14);
  vec3 g = pow(max(col, 0.0), vec3(1.0 / 2.2)); g = mix(g, g * g * (3.0 - 2.0 * g), 0.22); col = pow(g, vec3(2.2));

  // relight: the photo carries its own sun, so only scale by how today's light differs from it, and keep relief gentle
  vec3 amb = 3.14159 * uAtmAmb, sunC = uAtmSunCol;
  vec3 eUp = sunC * max(uAtmSun.y, 0.0) + amb, eN = sunC * max(dot(N, uAtmSun), 0.0) + amb * (0.65 + 0.35 * N.y);
  vec3 tod = clamp(pow(eUp / uAtmRef, vec3(0.6)), 0.0, 1.3);
  float rel = clamp(dot(eN, vec3(0.33)) / max(dot(eUp, vec3(0.33)), 1e-4), 0.55, 1.4);
  rel = mix(1.0, rel, uRelief * 0.7 * smoothstep(0.0, 0.15, uSun.y));
  vec3 light = max(tod, vec3(0.035, 0.045, 0.075)) * rel;
  vec3 land = col * light;
  // cast shadows from buildings, trees and the aircraft: shadowed ground keeps only its share of sky light
  float shd = worldShadow(vRel, N);
  if (shd < 1.0) {
    float af = clamp(dot(amb * (0.65 + 0.35 * N.y), vec3(1.0)) / max(dot(eN, vec3(1.0)), 1e-4), 0.22, 1.0);
    land *= mix(af, 1.0, shd);
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
        uMap: { value: Ko },
        uMask: { value: Ko },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uTile: { value: new THREE.Vector4() },
        uWater: { value: 0 },
      },
      defines: { WORLD_SHADOWS: '' },
      vertexShader: Bb,
      fragmentShader: kb,
      toneMapped: !1,
    })
  );
}

export { TERRAIN_UNIFORMS, terrainMaterial };
