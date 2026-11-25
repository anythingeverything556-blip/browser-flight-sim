import * as THREE from 'three';
import { R_EARTH } from './geo.js';

// Single-scattering Rayleigh + Mie + ozone atmosphere (Bruneton/Hillaire coefficients) on a spherical Earth.
// The JS functions here are the CPU twin of the GLSL below: they give the sun colour, ambient light and fog colour
// for lighting, while the GPU ray-marches a small sky LUT (see sky.js) that the sky dome, terrain, water and clouds sample.
export const RP = R_EARTH, RT = R_EARTH + 1e5;
export const MIE_BOOST = 2.4; // hazier than the clean-air Earth value: a more Google-Earth-like aerial perspective
export const SKY_K = 9; // scene radiance (sun irradiance = 1) -> display exposure
const BR = [5.802e-6, 13.558e-6, 33.1e-6], HR = 8000, BMS = 3.996e-6, BME = 4.44e-6, HM = 1200, BO = [0.65e-6, 1.881e-6, 0.085e-6], GM = 0.8;

const rsph = (oy, dx, dy, dz, r, ox = 0, oz = 0) => {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r, D = b * b - c;
  if (D < 0) return null;
  const s = Math.sqrt(D);
  return [-b - s, -b + s];
};
const edges = (n) => { const e = new Float64Array(n + 1); for (let i = 0; i <= n; i++) e[i] = (i / n) ** 2; return e; };
const E_SUN = edges(10), E_VIEW = edges(32);

// transmittance of sunlight from point p along unit vector s (zero when the planet is in the way)
export function sunTrans(px, py, pz, sx, sy, sz, mie, out) {
  const g = rsph(py, sx, sy, sz, RP, px, pz);
  if (g && g[0] > 0) { out[0] = out[1] = out[2] = 0; return out; }
  const t1 = rsph(py, sx, sy, sz, RT, px, pz)[1];
  let oR = 0, oM = 0, oO = 0;
  for (let i = 0; i < 10; i++) {
    const t = (E_SUN[i] + E_SUN[i + 1]) * 0.5 * t1, dt = (E_SUN[i + 1] - E_SUN[i]) * t1;
    const h = Math.hypot(px + sx * t, py + sy * t, pz + sz * t) - RP;
    oR += Math.exp(-h / HR) * dt; oM += Math.exp(-h / HM) * dt; oO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt;
  }
  for (let k = 0; k < 3; k++) out[k] = Math.exp(-(BR[k] * oR + BME * mie * oM + BO[k] * oO));
  return out;
}
export const sunColor = (alt, sunEl, mie, out = [0, 0, 0]) => sunTrans(0, RP + Math.max(alt, 2), 0, Math.cos(sunEl), Math.sin(sunEl), 0, mie, out);

// scene-referred sky radiance at altitude h for elevation el and azimuth phi measured from the sun
const tv = [0, 0, 0];
export function skyRadiance(h, el, phi, sunEl, mie, out = [0, 0, 0]) {
  const oy = RP + h, ce = Math.cos(el), dx = ce * Math.cos(phi), dy = Math.sin(el), dz = ce * Math.sin(phi);
  const sx = Math.cos(sunEl), sy = Math.sin(sunEl), cosT = dx * sx + dy * sy;
  const g = rsph(oy, dx, dy, dz, RP), rt = rsph(oy, dx, dy, dz, RT);
  const tmax = g && g[0] > 0 ? g[0] : rt ? rt[1] : 0;
  const pR = 3 / (16 * Math.PI) * (1 + cosT * cosT);
  const pM = 3 / (8 * Math.PI) * ((1 - GM * GM) / (2 + GM * GM)) * (1 + cosT * cosT) / Math.pow(1 + GM * GM - 2 * GM * cosT, 1.5);
  let oR = 0, oM = 0, oO = 0;
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < 32; i++) {
    const t = (E_VIEW[i] + E_VIEW[i + 1]) * 0.5 * tmax, dt = (E_VIEW[i + 1] - E_VIEW[i]) * tmax;
    const px = dx * t, py = oy + dy * t, pz = dz * t, hh = Math.hypot(px, py, pz) - RP;
    const dR = Math.exp(-hh / HR) * dt, dM = Math.exp(-hh / HM) * dt, dO = Math.max(0, 1 - Math.abs(hh - 25000) / 15000) * dt;
    oR += dR; oM += dM; oO += dO;
    sunTrans(px, py, pz, sx, sy, 0, mie, tv);
    for (let k = 0; k < 3; k++) {
      const tr = Math.exp(-(BR[k] * oR + BME * mie * oM + BO[k] * oO));
      out[k] += tr * tv[k] * (BR[k] * dR * pR + BMS * mie * dM * pM);
    }
  }
  return out;
}

// cosine-weighted mean sky radiance over the upper hemisphere (what an up-facing surface receives, per steradian)
export function skyAmbient(h, sunEl, mie, out = [0, 0, 0]) {
  const els = [80, 55, 35, 20, 8], w = [0.147, 0.353, 0.287, 0.157, 0.056], tmp = [0, 0, 0];
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < els.length; i++) for (const ph of [30, 90, 150]) {
    skyRadiance(h, els[i] * Math.PI / 180, ph * Math.PI / 180, sunEl, mie, tmp);
    for (let k = 0; k < 3; k++) out[k] += tmp[k] * w[i] / 3;
  }
  return out;
}

export function aces(c, scale) {
  const r = c[0] * scale, g = c[1] * scale, b = c[2] * scale;
  const m = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.0760 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const a = m.map(f);
  return [1.60475 * a[0] - 0.53108 * a[1] - 0.07367 * a[2], -0.10208 * a[0] + 1.10813 * a[1] - 0.00605 * a[2], -0.00327 * a[0] - 0.07276 * a[1] + 1.07602 * a[2]].map((v) => Math.min(1, Math.max(0, v)));
}

const n = (v) => v.toExponential(5);
// ---------- GLSL ----------
export const ATM_COMMON = `
#define ATM_PI 3.14159265359
const float ATM_RP = ${n(RP)}, ATM_RT = ${n(RT)};
const vec3 ATM_BR = vec3(${BR.map(n).join(',')}), ATM_BO = vec3(${BO.map(n).join(',')});
const float ATM_HR = ${HR}.0, ATM_HM = ${HM}.0, ATM_BMS = ${n(BMS)}, ATM_BME = ${n(BME)}, ATM_G = ${GM};
float atmPhaseR(float c) { return 3.0 / (16.0 * ATM_PI) * (1.0 + c * c); }
float atmPhaseM(float c) { return 3.0 / (8.0 * ATM_PI) * ((1.0 - ATM_G * ATM_G) / (2.0 + ATM_G * ATM_G)) * (1.0 + c * c) / pow(1.0 + ATM_G * ATM_G - 2.0 * ATM_G * c, 1.5); }
vec2 atmRaySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d), D = b * b - (dot(o, o) - r * r);
  if (D < 0.0) return vec2(-1.0);
  float s = sqrt(D); return vec2(-b - s, -b + s);
}
// LUT parametrisation: x = azimuth from the sun / pi, y = elevation with the (altitude dependent) horizon at 0.5, sqrt-compressed
const vec2 ATM_LUT = vec2(${'LUT_W'}.0, ${'LUT_H'}.0);
vec2 atmLutUV(vec3 d, float hd, vec3 sunD) {
  vec2 sh = normalize(sunD.xz + vec2(1e-6, 0.0)), dh = normalize(d.xz + vec2(1e-7, 0.0));
  float u = acos(clamp(dot(sh, dh), -1.0, 1.0)) / ATM_PI;
  float e = asin(clamp(d.y, -1.0, 1.0)), v;
  if (e > hd) v = 0.5 + 0.5 * sqrt((e - hd) / (1.57079633 - hd)); else v = 0.5 - 0.5 * sqrt((hd - e) / (1.57079633 + hd));
  return (vec2(u, v) * (ATM_LUT - 1.0) + 0.5) / ATM_LUT;
}`.replace(/LUT_W/g, '128').replace(/LUT_H/g, '96');

// full-screen pass that fills the sky LUT
export const LUT_FRAG = `
uniform vec4 uP; // altitude, sun elevation, Mie scale, horizon angle
varying vec2 vUv;
${ATM_COMMON}
vec3 sunTr(vec3 p, vec3 s, float mie) {
  vec2 g = atmRaySphere(p, s, ATM_RP);
  if (g.x > 0.0) return vec3(0.0);
  float t1 = atmRaySphere(p, s, ATM_RT).y, oR = 0.0, oM = 0.0, oO = 0.0;
  for (int i = 0; i < 10; i++) {
    float a = float(i) / 10.0, b = float(i + 1) / 10.0, t = 0.5 * (a * a + b * b) * t1, dt = (b * b - a * a) * t1;
    float h = length(p + s * t) - ATM_RP;
    oR += exp(-h / ATM_HR) * dt; oM += exp(-h / ATM_HM) * dt; oO += max(0.0, 1.0 - abs(h - 25000.0) / 15000.0) * dt;
  }
  return exp(-(ATM_BR * oR + vec3(ATM_BME * mie * oM) + ATM_BO * oO));
}
void main() {
  float alt = uP.x, mie = uP.z, hd = uP.w, se = uP.y;
  vec2 q = (vUv * ATM_LUT - 0.5) / (ATM_LUT - 1.0);
  q = clamp(q, 0.0, 1.0);
  float phi = q.x * ATM_PI, e;
  if (q.y > 0.5) { float t = (q.y - 0.5) * 2.0; e = hd + t * t * (1.57079633 - hd); } else { float t = (0.5 - q.y) * 2.0; e = hd - t * t * (1.57079633 + hd); }
  vec3 o = vec3(0.0, ATM_RP + alt, 0.0), d = vec3(cos(e) * cos(phi), sin(e), cos(e) * sin(phi)), s = vec3(cos(se), sin(se), 0.0);
  vec2 g = atmRaySphere(o, d, ATM_RP), tp = atmRaySphere(o, d, ATM_RT);
  float tmax = g.x > 0.0 ? g.x : max(tp.y, 0.0);
  float c = dot(d, s), pR = atmPhaseR(c), pM = atmPhaseM(c);
  vec3 od = vec3(0.0), sum = vec3(0.0);
  float oR = 0.0, oM = 0.0, oO = 0.0;
  for (int i = 0; i < 32; i++) {
    float a = float(i) / 32.0, b = float(i + 1) / 32.0, t = 0.5 * (a * a + b * b) * tmax, dt = (b * b - a * a) * tmax;
    vec3 p = o + d * t; float h = length(p) - ATM_RP;
    float dR = exp(-h / ATM_HR) * dt, dM = exp(-h / ATM_HM) * dt, dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0) * dt;
    oR += dR; oM += dM; oO += dO;
    vec3 tr = exp(-(ATM_BR * oR + vec3(ATM_BME * mie * oM) + ATM_BO * oO));
    sum += tr * sunTr(p, s, mie) * (ATM_BR * dR * pR + vec3(ATM_BMS * mie * dM * pM));
  }
  gl_FragColor = vec4(sum, 1.0);
}`;

// uniforms shared by every shader that uses the atmosphere (updated by Environment each frame)
export const ATMOS_UNIFORMS = {
  uAtmLut: { value: null },
  uAtm: { value: new THREE.Vector4(0, 0, 1, MIE_BOOST) }, // camera altitude (m), horizon angle (rad), tone scale, Mie scale
  uAtmSun: { value: new THREE.Vector3(0, 1, 0) },        // unit vector to the sun (world)
  uAtmSunCol: { value: new THREE.Vector3(1, 1, 1) },     // sunlight colour after atmospheric transmittance (0..1)
  uAtmAmb: { value: new THREE.Vector3(0.03, 0.05, 0.1) }, // mean sky radiance seen by an up-facing surface (sun irradiance = 1)
  uAtmRef: { value: new THREE.Vector3(1, 1, 1) },        // lighting of the imagery's baked sun (a clear mid-morning) in the same terms
  uAtmNight: { value: new THREE.Vector3(0, 0, 0) },      // moon/airglow floor added to the sky radiance
  uMoon: { value: new THREE.Vector4(0, 1, 0, 0) },        // unit vector to the moon (xyz) and how brightly it lights the ground (w, 0..1)
};

// sky radiance towards d (scene-referred) and display mapping, plus aerial perspective for a point `rel`
// (camera-relative world offset, curvature drop already applied) whose colour `col` is already display-referred
export const ATM_FRAG = `
uniform sampler2D uAtmLut; uniform vec4 uAtm; uniform vec3 uAtmSun, uAtmSunCol, uAtmAmb, uAtmRef, uAtmNight; uniform vec4 uMoon;
${ATM_COMMON}
vec3 atmSky(vec3 d) { return texture2D(uAtmLut, atmLutUV(d, uAtm.y, uAtmSun)).rgb + uAtmNight; }
vec3 atmTone(vec3 c) {
  c *= uAtm.z;
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.432951) + 0.238081);
  return clamp(mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c, 0.0, 1.0);
}
float atmSlab(float u) { u = clamp(u, -30.0, 30.0); return abs(u) < 1e-3 ? 1.0 : (1.0 - exp(-u)) / u; }
vec3 atmAerial(vec3 col, vec3 rel) {
  float d = max(length(rel), 1.0), h0 = uAtm.x, mie = uAtm.w;
  vec3 V = rel / d;
  float oy = ATM_RP + h0, b = oy * V.y, D = b * b - (oy * oy - ATM_RP * ATM_RP), dF, hE;
  if (D >= 0.0 && -b - sqrt(D) > 0.0) { dF = -b - sqrt(D); hE = 0.0; }
  else { dF = -b + sqrt(max(b * b - (oy * oy - ATM_RT * ATM_RT), 0.0)); hE = ATM_RT - ATM_RP; }
  float rho_r = exp(-h0 / ATM_HR), rho_m = exp(-h0 / ATM_HM);
  vec3 T = exp(-(ATM_BR * rho_r * d * atmSlab(rel.y / ATM_HR) + vec3(ATM_BME * mie * rho_m * d * atmSlab(rel.y / ATM_HM))));
  vec3 Tf = exp(-(ATM_BR * rho_r * dF * atmSlab((hE - h0) / ATM_HR) + vec3(ATM_BME * mie * rho_m * dF * atmSlab((hE - h0) / ATM_HM))));
  vec3 ratio = clamp((1.0 - T) / max(1.0 - Tf, 0.002), 0.0, 1.0);
  return col * T + atmTone(atmSky(V) * ratio);
}`;

// vertex position of `mvPosition` back in camera-relative world axes
export const ATM_REL = 'transpose(mat3(viewMatrix)) * mvPosition.xyz';

// Adds aerial perspective to any three.js material (chains with applyCurvature / other onBeforeCompile hooks).
export function applyAtmosphere(material) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.fog = false;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, ATMOS_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmRel;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAtmRel = ' + ATM_REL + ';');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmRel;\n' + ATM_FRAG)
      .replace('#include <colorspace_fragment>', 'gl_FragColor.rgb = atmAerial(gl_FragColor.rgb, vAtmRel);\n#include <colorspace_fragment>');
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|atm';
  return material;
}

export const ATM_LUT_SIZE = [128, 96];
export const horizonAngle = (alt) => -Math.acos(RP / (RP + Math.max(0, alt)));
// display colour (linear) of the horizon haze: what the old scene fog should look like
export function horizonDisplay(alt, sunEl, mie, scale, away = true) {
  const hd = horizonAngle(alt), c = skyRadiance(alt, hd + 0.01, away ? Math.PI * 0.75 : 0, sunEl, mie);
  return aces(c, scale);
}
