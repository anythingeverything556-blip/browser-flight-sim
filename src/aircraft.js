import * as THREE from 'three';
import { applyWear } from './cockpitwear.js';
import { buildChineZone } from './cockpitkit.js';
import { buildRealCockpit } from './cockpitreal.js';
import { GlassWater } from './glasswater.js';
import { whenIdle } from './warmup.js';
import { TERRAIN_UNIFORMS } from './terrain-shader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CG_MODEL, CHUTE_POINT } from './flight.js';
import { CockpitPanel } from './panel.js';
import { ChangeGate } from './workstats.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHADOW_LAYER, AC_SHADOW_LAYER } from './shadows.js';
import { FX_LAYER } from './layers.js';
import { createGearRig } from './gear.js';
import { cullHidden } from './occlusion.js';

// Model frame (three.js): x nose, y up, z right wing. Nozzle exits at x -12.78, nacelle axis 2.47 m up, 4.30 m out.
const NOZZLE_X = -12.78, NAC_Y = 2.47, NAC_Z = 4.30;
const D2R = Math.PI / 180;
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Elevons are part of the wing/body skin, so they are hinged in the vertex shader:
// inboard pair on the body (|z| 1.1-3.3, hinge x -11.0), outboard pair on the wings (|z| 5.3-8.0, hinge x -10.9).
function addElevons(mat, uElev) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uElev = uElev;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec4 uElev;
float elevonAngle(vec3 p, out float hx){
  float az = abs(p.z);
  float inner = smoothstep(1.08, 1.20, az) * (1.0 - smoothstep(3.18, 3.30, az));
  float outer = smoothstep(5.32, 5.44, az) * (1.0 - smoothstep(7.95, 8.10, az));
  hx = inner > outer ? -11.0 : -10.9;
  float aft = (1.0 - smoothstep(hx - 0.03, hx + 0.03, p.x)) * step(-13.0, p.x) * step(abs(p.y), 0.6);
  vec2 a = p.z < 0.0 ? uElev.xy : uElev.zw;
  return aft * (inner * a.x + outer * a.y);
}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float eHx; float eAng = elevonAngle(position, eHx);
if (eAng != 0.0) { float ec = cos(-eAng), es = sin(-eAng); objectNormal = vec3(ec*objectNormal.x - es*objectNormal.y, es*objectNormal.x + ec*objectNormal.y, objectNormal.z); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (eAng != 0.0) { vec3 ed = transformed - vec3(eHx, 0.0, 0.0); float ec = cos(-eAng), es = sin(-eAng);
  transformed = vec3(eHx, 0.0, 0.0) + vec3(ec*ed.x - es*ed.y, es*ed.x + ec*ed.y, ed.z); }`);
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    // inside of the skin (cockpit walls, wheel wells, inlet duct) reads as painted grey lining, not black
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.085, 0.09, 0.098);');
  };
  mat.customProgramCacheKey = () => 'elevons';
}

// Procedural skin detail in model space (x nose, y up, z right; wing plane at y = 0):
// frame and panel lines, chordwise wing corrugations, nacelle rings and per-panel tone/gloss variation.
// shared water-on-skin state: wetness 0..1 and how hard the airflow drags it aft 0..1
export const SKIN_WET = { value: 0 }, SKIN_FLOW = { value: 0 };
// 1 when the camera is far from the jet: the sub-pixel skin detail (seam lines, rivets, corrugation, bump and bead normals, all with derivatives) is skipped
export const SKIN_LOD = { value: 0 };
function addSkinDetail(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uSkinWet = SKIN_WET; sh.uniforms.uSkinFlow = SKIN_FLOW; sh.uniforms.uSkinLod = SKIN_LOD;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMP; varying vec3 vMN; varying vec3 vZv; varying vec3 vXv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMP = transformed; vMN = objectNormal; vZv = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz); vXv = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);');
    const common = `
varying vec3 vMP; varying vec3 vMN; varying vec3 vZv; varying vec3 vXv;
uniform float uSkinWet, uSkinFlow, uSkinLod;
float skHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skLine(float v, float s, float w){ float d = abs(fract(v / s + 0.5) - 0.5) * s; float aa = fwidth(v); return (1.0 - smoothstep(w, w + aa * 1.2, d)) * (1.0 - smoothstep(0.01, 0.06, aa)); }
float skNacelle(vec3 p){ return 1.0 - smoothstep(1.02, 1.1, length(vec2(p.y - 0.22, abs(p.z) - 4.3))); }
float skWing(vec3 p){ return step(1.95, abs(p.z)) * (1.0 - skNacelle(p)) * step(abs(p.y), 0.4); }
float skSeams(vec3 p){
  float nac = skNacelle(p), wing = skWing(p), body = (1.0 - nac) * (1.0 - wing);
  return max(body * max(skLine(p.x, 1.0, 0.004), skLine(p.z, 0.9, 0.004) * step(0.3, vMN.y)),
             max(wing * max(skLine(p.x, 1.6, 0.005), skLine(p.z, 1.1, 0.005)), nac * skLine(p.x, 1.5, 0.006)));
}
float skH3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float skN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH3(i), skH3(i + vec3(1,0,0)), f.x), mix(skH3(i + vec3(0,1,0)), skH3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(skH3(i + vec3(0,0,1)), skH3(i + vec3(1,0,1)), f.x), mix(skH3(i + vec3(0,1,1)), skH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
// rivet rows 3 cm either side of the frame lines, 6 cm pitch around the section; fades out before it can alias
float skRivets(vec3 p){
  float pitch = 0.06, u = (abs(p.z) < 1.95 ? atan(p.y - 2.2, abs(p.z)) * 1.4 : p.z) / pitch;
  float fs = skNacelle(p) > 0.5 ? 1.5 : skWing(p) > 0.5 ? 1.6 : 1.0;
  float dx = abs(abs(fract(p.x / fs + 0.5) - 0.5) * fs - 0.03), du = abs(fract(u + 0.5) - 0.5) * pitch;
  float d = length(vec2(dx, du)), aa = fwidth(p.x);
  return (1.0 - smoothstep(0.004, 0.004 + max(aa * 1.5, 1e-4), d)) * (1.0 - smoothstep(0.004, 0.012, aa));
}
// beaded water on the skin: drops pinned to the paint, stretched aft at speed; metres of dome height, fades out before it aliases
float skBeads(vec3 p, vec3 n){
  vec2 q = abs(n.y) > 0.6 ? p.xz : p.xy;
  float cs = 0.016, aa = fwidth(q.x) / cs;
  vec2 g = q / cs; g.x /= (1.0 + 2.5 * uSkinFlow);
  vec2 id = floor(g), f = fract(g) - 0.5;
  float a = skHash(id), b = skHash(id + 3.7), c = skHash(id + 9.1);
  if (c > uSkinWet * 0.8) return 0.0;
  vec2 d = f - (vec2(a, b) - 0.5) * 0.4; float rr = 0.12 + 0.2 * b * b, u = length(d) / rr;
  return sqrt(max(0.0, 1.0 - u * u)) * rr * (1.0 - smoothstep(0.06, 0.2, aa));
}
// derivative bump mapping (as three's perturbNormalArb) so seams read as recessed grooves, not just painted lines
vec3 skBump(vec3 pos, vec3 n, vec2 dH){
  vec3 sx = normalize(dFdx(pos)), sy = normalize(dFdy(pos)), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
}
`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + common)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vMP; float nac = skNacelle(p), wing = skWing(p), body = (1.0 - nac) * (1.0 - wing);
          vec2 cell = wing > 0.5 ? floor(vec2(p.x / 1.6, p.z / 1.1)) : (nac > 0.5 ? floor(vec2(p.x / 1.5, sign(p.z))) : floor(vec2(p.x / 1.0, p.z / 0.9)));
          float tone = 0.9 + 0.2 * skHash(cell);
          float lines = uSkinLod < 0.5 ? skSeams(p) : 0.0;
          if (gl_FrontFacing) diffuseColor.rgb *= tone * (1.0 - 0.45 * lines) * (1.0 - 0.28 * uSkinWet);
        }
        // weathering: repaint mottling, grime streaks swept aft by the airflow, the famous fuel leaks on the
        // undersides, heat-tinted paint around the aft nacelles, and rivet heads catching the light
        float skGrime = smoothstep(0.45, 0.9, skN(vec3(vMP.x * 0.22, vMP.y * 5.0, vMP.z * 5.0)) * 0.7 + skN(vMP * 0.9) * 0.3);
        float skLeak = (1.0 - smoothstep(-0.6, -0.25, vMN.y)) * smoothstep(0.55, 0.8, skN(vec3(vMP.x * 0.15, vMP.y * 2.5, vMP.z * 3.0 + 11.0)));
        float skHeat = skNacelle(vMP) * (1.0 - smoothstep(-9.0, -3.0, vMP.x));
        float skRiv = uSkinLod < 0.5 ? skRivets(vMP) : 0.0;
        if (gl_FrontFacing) {
          diffuseColor.rgb *= (0.9 + 0.2 * skN(vMP * vec3(0.35, 0.6, 0.6))) * (1.0 + 0.25 * skGrime) * (1.0 - 0.25 * skLeak);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.5, 1.2, 0.95), skHeat * 0.6);
          diffuseColor.rgb *= 1.0 + 0.6 * skRiv;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.12 * (skHash(floor(vMP.xz / vec2(1.3, 1.0)) + 7.0) - 0.5)
          + 0.14 * skGrime - 0.22 * skLeak + 0.08 * skHeat, 0.18, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.1, uSkinWet * 0.85);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uSkinLod < 0.5) {
          // corrugations run fore-and-aft on the wing panels (ridges every 16 cm across the span)
          float s = 0.16, aa = fwidth(vMP.z) / s;
          float m = skWing(vMP) * step(0.5, abs(vMN.y)) * (1.0 - smoothstep(0.15, 0.5, aa)) * step(-10.6, vMP.x);
          if (m > 0.0) { normal = normalize(normal + vZv * 0.22 * m * sin(6.2831853 * vMP.z / s)); }
          float sh = -0.2 * skSeams(vMP) + 0.06 * skRivets(vMP) + 90.0 * uSkinWet * skBeads(vMP, vMN); vec2 dH = vec2(dFdx(sh), dFdy(sh));
          if (gl_FrontFacing && dot(dH, dH) > 0.0) normal = skBump(-vViewPosition, normal, dH);
        }`);
  };
  mat.customProgramCacheKey = () => 'elevons-skin';
}


// three's log depth makes every fragment write its own depth, which switches polygonOffset off, so markings lying on the skin z-fought (flickering red and
// yellow placards). Lift them in depth instead: the bias is in log-depth units, so it is a roughly constant ~0.1 % of the distance at any range.
// Under reversed depth nothing writes gl_FragDepth (early-Z stays on): the clip z is scaled up by the same share of the distance instead (d ~ 1/w).
export function depthBias(mat, bias = 2.5e-5) {
  const prev = mat.onBeforeCompile, key = 'depthbias' + bias;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n#ifdef USE_REVERSED_DEPTH_BUFFER\n  gl_Position.z *= ${(1 + bias * Math.LN2 * Math.log2(1.2e7 + 1)).toFixed(7)};\n#endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>\n#ifdef USE_LOGDEPTHBUF\n  gl_FragDepth = max(0.0, gl_FragDepth - ${bias.toFixed(8)});\n#endif`);
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + key;
  mat.needsUpdate = true; return mat;
}

// Stencils and warning placards, projected onto the curved skin with DecalGeometry.
function placard(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const PLACARDS = {
  warning: () => placard(256, 140, (x, w, h) => {
    x.fillStyle = '#c4271f'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.fillText('WARNING', w / 2, 52);
    x.font = '15px Arial'; ['EJECTION SEAT AND CANOPY', 'CONTAIN EXPLOSIVE CHARGES', 'SEE T.O. FOR SAFE PROCEDURES'].forEach((t, i) => x.fillText(t, w / 2, 82 + i * 19));
  }),
  rescue: () => placard(256, 96, (x, w, h) => {
    x.fillStyle = '#e6b51e'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#111'; x.lineWidth = 4; x.strokeRect(3, 3, w - 6, h - 6);
    x.fillStyle = '#111'; x.font = 'bold 34px Arial'; x.textAlign = 'center'; x.fillText('RESCUE', w / 2, 42);
    x.font = '14px Arial'; x.fillText('PULL HANDLE TO OPEN CANOPY', w / 2, 66); x.fillText('AND RELEASE SEAT', w / 2, 84);
  }),
  stencil: () => placard(256, 128, (x, w, h) => {
    x.fillStyle = '#d9b54a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#222'; x.font = 'bold 18px Arial'; x.textAlign = 'left';
    ['CANOPY JETTISON', 'T-HANDLE INSIDE', 'ACCESS DOOR', 'STAND CLEAR'].forEach((t, i) => x.fillText(t, 14, 30 + i * 26));
  }),
  arrow: () => placard(256, 64, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = '#d82a20';
    x.beginPath(); x.moveTo(8, 22); x.lineTo(190, 22); x.lineTo(190, 8); x.lineTo(248, 32); x.lineTo(190, 56); x.lineTo(190, 42); x.lineTo(8, 42); x.fill();
  }),
  usaf: () => placard(512, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.fillStyle = '#d82a20'; x.font = 'bold 48px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('U.S. AIR FORCE', w / 2, h / 2 + 2); }),
};

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// includes must sit on their own lines or the GLSL preprocessor rejects the shader
const LOGDEPTH_V = ['\n#include <common>\n#include <logdepthbuf_pars_vertex>\n', '\n#include <logdepthbuf_vertex>\n'];
const LOGDEPTH_F = ['\n#include <common>\n#include <logdepthbuf_pars_fragment>\n', '\n#include <logdepthbuf_fragment>\n'];

// Additive plume cone: brightness depends on distance along the plume, not on view angle,
// so it is visible from the side, the rear quarter and straight behind.
function plumeMaterial(colA, colB, falloff) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uI: { value: 0 }, uDia: { value: 0 }, uCount: { value: 6 }, uSeed: { value: Math.random() * 10 },
      uColA: { value: new THREE.Color(colA) }, uColB: { value: new THREE.Color(colB) }, uFall: { value: falloff } },
    vertexShader: `${LOGDEPTH_V[0]}
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; ${LOGDEPTH_V[1]} }`,
    fragmentShader: `${LOGDEPTH_F[0]}
      uniform float uTime, uI, uDia, uCount, uSeed, uFall; uniform vec3 uColA, uColB;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ ${LOGDEPTH_F[1]}
        float along = clamp(-vP.x, 0.0, 1.0);
        float soft = mix(0.45, 1.0, smoothstep(0.0, 0.55, abs(dot(normalize(vN), normalize(vV)))));
        float fall = pow(1.0 - along, uFall) * smoothstep(0.0, 0.04, along + 0.02);
        float flick = 0.82 + 0.18 * sin(uTime * 63.0 + along * 37.0 + uSeed) * sin(uTime * 23.0 + uSeed * 3.0);
        float dia = 1.0 + uDia * 1.4 * pow(0.5 + 0.5 * cos(along * 6.2831 * uCount), 10.0) * (1.0 - along);
        vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.85, along));
        float a = uI * fall * soft * flick * dia;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function discMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uHot: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `${LOGDEPTH_V[0]} varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${LOGDEPTH_V[1]} }`,
    fragmentShader: `${LOGDEPTH_F[0]} uniform float uI, uHot, uTime; varying vec2 vUv;
      void main(){ ${LOGDEPTH_F[1]}
        float r = length(vUv - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, r);
        vec3 dry = mix(vec3(0.9, 0.18, 0.04), vec3(1.0, 0.45, 0.12), core);
        vec3 hot = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.95, 0.85), pow(core, 2.0));
        vec3 c = mix(dry, hot, uHot) * (0.9 + 0.1 * sin(uTime * 41.0 + r * 9.0));
        float a = uI * core;
        gl_FragColor = vec4(c * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

const MATS = {
  // titanium-black iron-ball paint: satin base plus a thin, soft clearcoat so the chines and blended body catch the sky;
  // double-sided so the inside of the skin closes the cockpit and wheel wells
  skin: () => new THREE.MeshPhysicalMaterial({ color: 0x1a2730, roughness: 0.35, metalness: 0.27, clearcoat: 0.58, clearcoatRoughness: 0.26, envMapIntensity: 0.82, side: THREE.DoubleSide }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x1a303a, roughness: 0.06, metalness: 0.02, clearcoat: 0.65, clearcoatRoughness: 0.08, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.2, side: THREE.DoubleSide }),
  burnt: () => new THREE.MeshPhysicalMaterial({ color: 0x5b4a3b, roughness: 0.32, metalness: 0.9, iridescence: 0.35, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 600] }),
  intake: () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, metalness: 0.2 }),
  nozzle: () => new THREE.MeshStandardMaterial({ color: 0x3b3631, roughness: 0.45, metalness: 0.85 }),
};

const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const mergeKey = (o) => { const g = o.geometry, a = Object.keys(g.attributes).sort().map((n) => `${n}:${g.attributes[n].itemSize}${g.attributes[n].normalized ? 'n' : ''}${g.attributes[n].array.constructor.name}`).join(','); return `${o.material.uuid}|${o.layers.mask}|${o.renderOrder}|${+o.castShadow}${+o.receiveShadow}${+o.frustumCulled}${+!!o.userData.thr}|${g.index ? 'i' : 'n'}|${a}`; };
const mergeable = (o, group, skip) => {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.material || o.material.transparent || o.customDepthMaterial || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  const g = o.geometry; if (!g || !g.attributes.position || g.morphAttributes.position || g.drawRange.start !== 0 || g.drawRange.count !== Infinity || skip(o)) return false;
  for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === group) return true; }
  return false;
};
// Folds the static meshes under `group` that share a material into one draw each (transforms baked relative to `group`). Moving parts, instanced, transparent and
// skipped meshes stay as they are. The source meshes leave the scene but are kept on `merged.userData.mergedParts` ({ geometry, material, matrix, name }) so that
// the crash breakup can still split the original parts.
export function mergeStatic(group, { skip = () => false, minGroup = 2 } = {}) {
  group.updateMatrixWorld(true);
  const inv = _mA.copy(group.matrixWorld).invert().clone(), buckets = new Map();
  group.traverse((o) => { if (mergeable(o, group, skip)) { const k = mergeKey(o); (buckets.get(k) || buckets.set(k, []).get(k)).push(o); } });
  const out = { before: 0, after: 0, merged: [] };
  for (const list of buckets.values()) {
    out.before += list.length;
    if (list.length < minGroup) { out.after += list.length; continue; }
    const geos = [], parts = [];
    for (const o of list) {
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), g = o.geometry.clone();
      if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
      g.applyMatrix4(rel);
      if (rel.determinant() < 0) { const ix = g.index.array; for (let i = 0; i + 2 < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
      geos.push(g); parts.push({ geometry: o.geometry, material: o.material, matrix: rel, name: o.name });
    }
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) { out.after += list.length; continue; }
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const ref = list[0], m = new THREE.Mesh(geo, ref.material);
    m.name = 'merged_' + (ref.material.name || ref.material.type); m.castShadow = ref.castShadow; m.receiveShadow = ref.receiveShadow; m.frustumCulled = ref.frustumCulled; m.renderOrder = ref.renderOrder; m.layers.mask = ref.layers.mask;
    m.userData.mergedParts = parts; if (ref.userData.thr) m.userData.thr = true;
    for (const o of list) if (o.parent) o.parent.remove(o);
    group.add(m); out.after++; out.merged.push(m);
  }
  group.updateMatrixWorld(true);
  return out;
}

// the transform nodes the cockpit's own animation moves (throttles, hands, stick): drive them to both ends, note what changed, put everything back
const movingNodes = (root, drive) => {
  const nodes = []; root.traverse((o) => nodes.push(o));
  const snap = nodes.map((o) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()]), moved = new Set();
  const diff = () => nodes.forEach((o, i) => { const s = snap[i]; if (!o.position.equals(s[0]) || !o.quaternion.equals(s[1]) || !o.scale.equals(s[2])) moved.add(o); });
  drive({ throttle: 1, stick: { p: 1, r: -1 } }); diff();
  drive({ throttle: 0, stick: { p: -1, r: 1 } }); diff();
  drive({ throttle: 0, stick: { p: 0, r: 0 } });
  nodes.forEach((o, i) => { o.position.copy(snap[i][0]); o.quaternion.copy(snap[i][1]); o.scale.copy(snap[i][2]); });
  return moved;
};

export class AircraftVisual {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); // at the CG, oriented like the flight model
    scene.add(this.root);
    this.time = 0; this.flash = [0, 0]; this.smoke = [0, 0];
    this.uElev = { value: new THREE.Vector4() };
  }

  async load(url, onProgress) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    let gltf, lodGltf = null;
    try {
      [gltf, lodGltf] = await Promise.all([
        loader.loadAsync(url, (e) => e.total && onProgress && onProgress(e.loaded / e.total)),
        loader.loadAsync(url.replace('SR71_sim', 'SR71_lod')).catch(() => null),
      ]);
    } finally { draco.dispose(); }
    const model = gltf.scene;
    model.position.copy(CG_MODEL).negate();
    const cache = {};
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.origMat = o.material.name || '';
      o.castShadow = true; o.receiveShadow = true;
      const n = o.material.name || '';
      let kind = null;
      if (n.startsWith('SR71_Skin')) kind = 'skin';
      else if (n === 'SR71_Glass') kind = 'glass';
      else if (n === 'SR71_BurntTi') kind = 'burnt';
      else if (n === 'SR71_Intake' || n === 'SR71_SpikeBleed' || n === 'SR71_Seam') kind = 'intake';
      else if (n === 'SR71_Nozzle') kind = 'nozzle';
      if (!kind) {
        // the canopy hides most of the sky from the cockpit, which the unoccluded env map can't know
        const cab = /^SR71_(Cpt|Pnl)/.test(n); o.material.envMapIntensity = cab ? 0.12 : 0.5;
        if (cab) (this.cabinMats || (this.cabinMats = new Set())).add(o.material);
        // SR-71 cockpit: medium-dark grey sidewalls and consoles, black panels
        const worn = (hex, o2) => { if (!o.material.userData.worn) { o.material.userData.worn = true; o.material.color.setHex(hex); o.material.metalness = 0.12; applyWear(o.material, o2); } };
        if (n === 'SR71_Cpt_Paint') worn(0x424d59, { rust: 0.5 });
        if (n === 'SR71_Pnl_Console') worn(0x272c33, { rust: 0.2 });
        if (n === 'SR71_Pnl_Black') worn(0x202328, { rust: 0.15, wear: 0.8 });
        if (n === 'SR71_Pnl_SeatFrame') worn(0x40454c, { rust: 0.3 });
        if (n === 'SR71_Pnl_Leather') { o.material.color.setHex(0x5e5140); o.material.roughness = 0.92; }
        if (n === 'SR71_Pnl_Strap') o.material.color.setHex(0x646a5c);
        if (n === 'SR71_Cpt_Floor') worn(0x30353b, { rust: 0.25 });
        return;
      }
      if (!cache[kind]) { cache[kind] = MATS[kind](); if (kind === 'skin') { addElevons(cache[kind], this.uElev); addSkinDetail(cache[kind]); } }
      o.material = cache[kind];
      if (kind === 'glass') o.renderOrder = 3;
      if (kind === 'skin') model.userData.skin = cache.skin;
    });
    this.model = model;
    this.root.add(model);
    this.root.updateMatrixWorld(true);
    this.covers = model.getObjectByName('SR71_WellCovers');
    this.cockpit = [];
    model.traverse((o) => { if (/^SR71_Cpt/.test(o.name)) this.cockpit.push(o); });
    // the opaque exterior casts world sun shadows (onto the runway, buildings); the cockpit interior can't be seen by the sun
    const caster = this.casterMat = new THREE.MeshBasicMaterial({ colorWrite: false }), inside = new Set();
    for (const c of this.cockpit) c.traverse((o) => { inside.add(o); o.castShadow = false; });
    this.casters = [];
    model.traverse((o) => { if (o.isMesh && !inside.has(o) && !o.material.transparent) { o.userData.casterMat = caster; o.layers.enable(AC_SHADOW_LAYER); this.casters.push(o); } });
    this.castsWorldShadow = true; this.altCull = false;
    const box = new THREE.Box3().setFromObject(model);
    this.dims = { length: box.max.x - box.min.x, span: box.max.z - box.min.z, height: box.max.y - box.min.y };
    this.setupMoving(model);
    this.setupGear(model.getObjectByName('SR71_Gear'));
    this.setupPanel(model);
    // the lit opaque materials skip fragments that lie behind the cockpit, which would only lose the depth test (see occlusion.js)
    model.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !m.transparent) cullHidden(m); });
    this.buildEffects();
    this.attachLod(model, lodGltf && lodGltf.scene);
    // two jobs that take the main thread most of a second each and are only seen later (the cockpit's smoothed fuselage edge, the stencils on
    // the skin) run when the browser is idle instead of delaying the menu
    // painted markings on the outside of the skin (rescue arrows, placards) are seen from inside as stray shapes on the lining: hide them from the seat
    this.decalOrig = []; model.traverse((o) => { if (/^SR71_Decal_/.test(o.name)) this.decalOrig.push(o); });
    // the model's own painted markings sit on the skin too: own (cloned) materials, lifted a little less than the placards above them
    for (const o of this.decalOrig) { if (o.material && !Array.isArray(o.material)) { o.material = o.material.clone(); depthBias(o.material, 3e-5); } }
    const idle = (fn, timeout) => new Promise((done) => whenIdle(() => { try { fn(); } catch (e) { console.warn('aircraft idle job', e); } done(); }, timeout));
    this.buildCrew(model);
    const meshesBefore = new Set(); this.root.traverse((o) => { if (o.isMesh) meshesBefore.add(o); });
    this.chine = null;
    this.lateReady = Promise.all([idle(() => { this.chine = buildChineZone(model); }), idle(() => this.addDecals(model), 6000)]).then(() => {
      const made = []; this.root.traverse((o) => { if (o.isMesh && !meshesBefore.has(o)) made.push(o); });
      return made;
    });
  }

  cockpitTextures() {
    const out = new Set(), add = (t) => { if (t && t.isTexture) out.add(t); };
    const scan = (root) => root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (m) for (const k of ['map', 'emissiveMap', 'roughnessMap', 'normalMap', 'bumpMap', 'alphaMap']) add(m[k]); });
    if (this.real) scan(this.real.group);
    if (this.panel) { add(this.panel.texture); add(this.panel.dynamicTexture); add(this.panel.fastTexture); }
    return [...out];
  }

  addDecals(model) {
    const body = [];
    model.traverse((o) => { if (o.isMesh && /SR71_(Fuselage|Nacelle)/.test(o.parent && o.parent.name) && o.material === model.userData.skin) body.push(o); });
    if (!body.length) return;
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(); const tex = {};
    // [placard, x, y, z (side), w, h] in model metres; the ray is cast from outside towards the centreline
    const D = [['warning', 13.05, 3.05, 1, 0.34, 0.19], ['stencil', 12.55, 3.0, 1, 0.3, 0.15], ['rescue', 11.65, 3.25, 1, 0.42, 0.16], ['arrow', 11.25, 3.25, 1, 0.42, 0.1],
      ['usaf', 2.6, 2.95, 1, 1.9, 0.24]];
    for (const [name, x, y, sideSign] of D) for (const sg of [1, -1]) {
      const spec = D.find((d) => d[0] === name && d[1] === x);
      const w = spec[4], h = spec[5], zs = sg * sideSign;
      const from = new THREE.Vector3(x, y + 1.2, zs * 3.5).sub(CG_MODEL), to = new THREE.Vector3(x, y, 0).sub(CG_MODEL);
      if (name === 'usaf') { from.set(x, 2.47 + 0.4, zs * 7).sub(CG_MODEL); to.set(x, 2.47 + 0.35, zs * 4.3).sub(CG_MODEL); }
      ray.set(from, to.clone().sub(from).normalize());
      const hit = ray.intersectObjects(body, false)[0]; if (!hit) continue;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.dot(ray.ray.direction) > 0) n.negate();
      const fwd = new THREE.Vector3(zs > 0 ? 1 : -1, 0, 0); const xa = fwd.sub(n.clone().multiplyScalar(fwd.dot(n))).normalize(); const ya = n.clone().cross(xa);
      const rot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa, ya, n));
      const geo = new DecalGeometry(hit.object, hit.point, rot, new THREE.Vector3(w, h, 0.25));
      const m = new THREE.Mesh(geo, depthBias(new THREE.MeshStandardMaterial({ map: tex[name] || (tex[name] = PLACARDS[name]()), transparent: true, roughness: 0.6, metalness: 0.05, depthWrite: false }), 6e-5));
      m.renderOrder = 2; this.root.attach(m); (this.decals || (this.decals = [])).push(m);
    }
  }

  // ---------- all-moving fins and translating inlet spikes ----------
  setupMoving(model) {
    this.fins = ['SR71_Fin_L', 'SR71_Fin_R'].map((n) => model.getObjectByName(n)).filter(Boolean).map((o) => ({
      o, pos: o.position.clone(), quat: o.quaternion.clone(), pivot: new THREE.Vector3(-10.3, 0, 0),
      q: new THREE.Quaternion(), offset: new THREE.Vector3(),
    }));
    this.spikes = ['SR71_Spike_L', 'SR71_Spike_R'].map((n) => model.getObjectByName(n)).filter(Boolean).map((o) => ({ o, x: o.position.x }));
  }

  // ---------- procedural landing gear ----------
  setupGear(gear) {
    this.gearRig = createGearRig(gear);
    this.gearGroup = gear || null;
    if (this.gearGroup) this.gearGroup.visible = false;
  }

  // Two crew in white full-pressure suits, so the cockpit is not empty when seen through the canopy. Positions are in model space
  // (x nose, y up, z right); hidden from the cockpit view, where the camera sits inside the pilot's helmet.
  buildCrew(model) {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.62, metalness: 0.02 });
    const shell = new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.3, metalness: 0.05 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x1b1608, roughness: 0.08, metalness: 0.9 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x2b2d2f, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.35, metalness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.7, metalness: 0.02 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6, metalness: 0.05 });
    const hose = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.55, metalness: 0.2 });
    const up = new THREE.Vector3(0, 1, 0);
    const limb = (g, a, b, r, mat) => {
      const d = new THREE.Vector3().subVectors(b, a), len = d.length(), m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 10), mat);
      m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(up, d.normalize()); g.add(m); return m;
    };
    const ball = (g, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const make = (x, y, pilot) => {
      const g = new THREE.Group(); g.position.set(x, y, 0);
      ball(g, 0.165, shell, 0.02, 0, 0, 1.12, 1, 0.95);
      ball(g, 0.12, shell, -0.1, -0.03, 0, 1, 1, 0.95);
      const vz = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.3, Math.PI * 0.32), visor);
      vz.scale.set(1.02, 1, 1.02); vz.position.set(0.03, 0.0, 0); g.add(vz);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.011, 8, 32, Math.PI * 0.86), metal); frame.rotation.set(0, Math.PI / 2, 0); frame.position.set(0.045, 0.012, 0); frame.rotation.y = Math.PI / 2; frame.rotation.z = -Math.PI * 0.43; g.add(frame);
      for (const z of [-1, 1]) ball(g, 0.05, metal, -0.01, -0.03, z * 0.165, 0.8, 1, 0.7);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 10, 24), metal); ring.rotation.x = Math.PI / 2; ring.position.set(0, -0.115, 0); g.add(ring);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.12, 14), suit); neck.position.set(0, -0.17, 0); g.add(neck);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 6, 14), suit); torso.scale.set(0.8, 1, 1.2); torso.position.set(-0.1, -0.46, 0); torso.rotation.z = 0.28; g.add(torso);
      const conn = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), metal); conn.rotation.z = Math.PI / 2; conn.position.set(0.1, -0.4, 0.09); g.add(conn);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.1, -0.4, 0.09), V3(0.18, -0.52, 0.2), V3(0.1, -0.78, 0.34), V3(-0.05, -1.0, 0.42)]), 24, 0.016, 8, false), hose));
      for (const z of [-1, 1]) {
        ball(g, 0.088, suit, 0.0, -0.31, z * 0.26);
        const elbow = V3(0.2, -0.62, z * 0.34), wrist = pilot ? (z > 0 ? V3(0.47, -0.62, 0.06) : V3(0.3, -0.78, -0.55)) : V3(0.34, -0.8, z * 0.28);
        limb(g, V3(0.0, -0.31, z * 0.26), elbow, 0.062, suit); limb(g, elbow, wrist, 0.052, suit);
        ball(g, 0.06, glove, wrist.x + 0.02, wrist.y - 0.01, wrist.z, 1.25, 0.85, 0.95);
        const hip = V3(-0.14, -0.8, z * 0.13), knee = V3(0.36, -0.86, z * 0.14), ankle = V3(0.48, -1.2, z * 0.13);
        limb(g, hip, knee, 0.095, suit); limb(g, knee, ankle, 0.075, suit);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.11), boot); b.position.set(ankle.x + 0.07, ankle.y - 0.03, ankle.z); b.rotation.z = -0.15; g.add(b);
        const sh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.04), strap); sh.position.set(0.1, -0.4, z * 0.1); sh.rotation.z = 0.28; g.add(sh);
      }
      return g;
    };
    this.crew = new THREE.Group();
    const people = [make(11.02, 3.2, true), make(8.96, 3.18, false)];
    this.crew.add(...people);
    this.mergeStats = { ...this.mergeStats, crew: people.map((g) => mergeStatic(g)) };
    model.add(this.crew);
  }
  // ---------- pilot's cockpit: original panel, console and canopy meshes hidden, rebuilt from the photographs (cockpitreal.js) ----------
  setupPanel(model) {
    const keep = /^SR71_Cpt_Pilot(_1|_Tub_\d+)$/;
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (/^SR71_Cpt_Pilot/.test(o.name) && !keep.test(o.name)) { o.visible = false; o.userData.hidden = true; }
    });
    this.panel = new CockpitPanel();
    this.real = buildRealCockpit(model, this.panel, model.userData.skin);
    const moved = movingNodes(this.real.interior, (st) => this.real.controls.set(st)), picks = new Set(this.real.pick.panels);
    const rigid = (root) => mergeStatic(root, { skip: (o) => { if (picks.has(o)) return true; for (let p = o; p && p !== root; p = p.parent) if (moved.has(p)) return true; return false; } });
    this.mergeStats = { ...this.mergeStats, cockpit: [this.real.interior, ...moved].map(rigid) };
    this.extCanopy = ['SR71_Canopy_Pilot_mesh', 'SR71_Canopy_Pilot_mesh_1'].map((n) => model.getObjectByName(n)).filter(Boolean);
    this.glassWater = new GlassWater();
    this.glassWater.attach(this.real.group.userData.glass, model);
    this.glassWater.attach(this.extCanopy[1], model);
    this.cabinMats = this.cabinMats || new Set();
    for (const m of this.real.stdMats) { m.envMapIntensity = 0.12; this.cabinMats.add(m); cullHidden(m); }
  }

  // the cockpit parts the pilot cannot see through, for the occlusion mask
  registerOccluders(occ) {
    occ.addAll(this.real.interior); occ.addAll(this.real.canopy);
    for (const o of this.cockpit) occ.addAll(o);
  }

  attachLod(model, lodScene) {
    this.lodPairs = []; this.lodOn = false;
    if (!lodScene) return;
    const wanted = /^SR71_(Fuselage|Wing_[LR]|Nacelle_[LR]|Fin_[LR]|Ejector_[LR])$/, meshesOf = (n) => { const a = []; n.traverse((o) => { if (o.isMesh) a.push(o); }); return a; };
    const origs = new Map(); model.traverse((o) => { if (wanted.test(o.name) && !origs.has(o.name)) origs.set(o.name, o); });
    const lods = []; lodScene.traverse((o) => { if (wanted.test(o.name)) lods.push(o); });
    for (const l of lods) {
      const orig = origs.get(l.name); if (!orig) continue;
      const om = meshesOf(orig), lm = meshesOf(l);
      if (om.length !== lm.length) continue;
      om.forEach((o, i) => {
        const m = lm[i]; m.material = o.material; m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow; m.layers.mask = o.layers.mask;
        m.userData.casterMat = o.userData.casterMat; m.visible = false; m.frustumCulled = o.frustumCulled;
        m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
        o.parent.add(m); this.lodPairs.push([o, m]);
        if (this.casters && o.userData.casterMat) this.casters.push(m);
      });
    }
    this.buildShadowProxy(model);
  }

  buildShadowProxy(model) {
    this.proxy = { sun: [], cascade: [], handled: [], active: false };
    if (!this.lodPairs.length) return;
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), sunGeos = [], cascadeGeos = [];
    const positionsOf = (g) => { const p = new THREE.BufferGeometry(); p.setAttribute('position', g.attributes.position); if (g.index) p.setIndex(g.index); return p; };
    const sunMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }); sunMat.visible = false;
    const stamp = (mesh, name) => { mesh.name = name; mesh.userData.shadowProxy = true; mesh.castShadow = false; mesh.receiveShadow = false; return mesh; };
    for (const [o, m] of this.lodPairs) {
      this.proxy.handled.push(o, m);
      const g = positionsOf(m.geometry).clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
      sunGeos.push(g); if (o.userData.casterMat) cascadeGeos.push(g);
    }
    model.traverse((o) => { if (o.isMesh && /^SR71_(Antenna_\d|NoStep|Decal_|TailNo_)/.test(o.name) && !this.proxy.handled.includes(o)) this.proxy.handled.push(o); });
    const mk = (geos, mat, name) => { if (!geos.length) return null; const geo = mergeGeometries(geos, false); geo.computeBoundingBox(); geo.computeBoundingSphere(); return stamp(new THREE.Mesh(geo, mat), name); };
    const sun = mk(sunGeos, sunMat, 'SR71_ShadowProxy'), cas = mk(cascadeGeos, this.casterMat, 'SR71_CascadeProxy');
    if (sun) { model.add(sun); this.proxy.sun.push(sun); }
    if (cas) { cas.userData.casterMat = this.casterMat; cas.layers.mask = 0; model.add(cas); this.proxy.cascade.push(cas); }
    this.proxy.sunMat = sunMat;
    this.proxy.tris = [...this.proxy.sun, ...this.proxy.cascade].reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
  }

  // Self-shadow (the sun light's shadow map, used on the wings, nacelles and cockpit) and the finest world cascade draw the ~37k triangle LOD shapes through shadow-only
  // proxies instead of the ~300k triangle airframe. The proxies are never drawn in the colour pass: the sun map only sees them while the light's shadow matrices are set
  // up, which is after the colour pass has collected what to draw, and are hidden again when that render call ends. Needs the sun light once (attachSelfShadow); until then nothing changes.
  setShadowProxy(on, light) {
    const P = this.proxy; if (!P || !P.sun.length && !P.cascade.length) return false;
    if (light && !P.hooked) {
      const sh = light.shadow, orig = sh.updateMatrices; P.hooked = true;
      sh.updateMatrices = function (l, vp) { if (P.active) P.sunMat.visible = true; return orig.call(this, l, vp); };
      const sc = this.scene, after = sc.onAfterRender; sc.onAfterRender = function (...a) { P.sunMat.visible = false; return after.apply(this, a); };
    }
    on = !!on && !!P.hooked; P.active = on; P.sunMat.visible = false;
    if (!this.allCasters) this.allCasters = this.casters.slice();
    const wasCaster = new Set(this.allCasters);
    for (const o of P.handled) { o.castShadow = !on; if (wasCaster.has(o)) { if (!on && this.castsWorldShadow) o.layers.enable(AC_SHADOW_LAYER); else o.layers.disable(AC_SHADOW_LAYER); } }
    for (const o of P.sun) o.castShadow = on;
    this.casters = on ? this.allCasters.filter((o) => !P.handled.includes(o)).concat(P.cascade) : this.allCasters;
    for (const o of P.cascade) o.layers.mask = on && this.castsWorldShadow ? 1 << AC_SHADOW_LAYER : 0;
    this.gearCastOff(false);
    return on;
  }

  gearCastOff(off) {
    if (!this.gearGroup) return;
    if (!this.gearCasters) { this.gearCasters = []; this.gearGroup.traverse((o) => { if (o.isMesh && o.castShadow) this.gearCasters.push(o); }); }
    const cast = !off; for (const o of this.gearCasters) o.castShadow = cast;
    this.gearCastIsOff = off;
  }

  attachSelfShadow(light) { return this.setShadowProxy(true, light); }

  buildEffects() {
    const glow = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,220,150,0.9)'], [0.5, 'rgba(255,120,40,0.35)'], [1, 'rgba(0,0,0,0)']]);
    const diamondTex = radialTexture([[0, 'rgba(255,255,240,1)'], [0.25, 'rgba(255,215,140,0.85)'], [0.6, 'rgba(255,120,50,0.25)'], [1, 'rgba(0,0,0,0)']]);
    const tebTex = radialTexture([[0, 'rgba(220,255,220,1)'], [0.3, 'rgba(60,255,110,0.85)'], [1, 'rgba(0,0,0,0)']]);
    const smokeTex = radialTexture([[0, 'rgba(70,70,70,0.7)'], [1, 'rgba(70,70,70,0)']]);
    const cone = (r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 40, 24, true); g.translate(0, 0.5, 0); g.rotateZ(Math.PI / 2); return g; };
    this.engines = [];
    for (const z of [-NAC_Z, NAC_Z]) {
      const grp = new THREE.Group();
      grp.position.set(NOZZLE_X - CG_MODEL.x, NAC_Y - CG_MODEL.y, z);
      this.root.add(grp);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 48), discMaterial());
      disc.rotation.y = -Math.PI / 2; disc.position.x = 0.12; disc.renderOrder = 6;
      const outer = new THREE.Mesh(cone(0.86, 0.55), plumeMaterial(0xff9a4a, 0x7a3cff, 1.6));
      const mid = new THREE.Mesh(cone(0.7, 0.32), plumeMaterial(0xffc27a, 0xff6a30, 1.3));
      const core = new THREE.Mesh(cone(0.5, 0.12), plumeMaterial(0xfff2d8, 0xffa040, 1.0));
      for (const m of [outer, mid, core]) { m.renderOrder = 7; m.frustumCulled = false; grp.add(m); }
      const diamonds = [];
      for (let i = 0; i < 8; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd8a0 }));
        s.renderOrder = 8; grp.add(s); diamonds.push(s);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xff8a40 }));
      halo.renderOrder = 8; halo.position.x = -0.6; grp.add(halo);
      const teb = new THREE.Sprite(new THREE.SpriteMaterial({ map: tebTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      teb.renderOrder = 9; teb.position.x = -1.5; teb.scale.setScalar(6); grp.add(teb);
      const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true }));
      smoke.renderOrder = 4; smoke.position.x = -4; grp.add(smoke);
      const light = new THREE.PointLight(0xff8040, 0, 40, 2); light.position.x = -2.5; grp.add(light);
      grp.add(disc);
      // the plume is drawn on its own layer into a separate target and added after the clouds (post.js); the smoke stays in the scene
      for (const o of [disc, outer, mid, core, halo, teb, ...diamonds]) o.layers.set(FX_LAYER);
      this.engines.push({ grp, disc, outer, mid, core, diamonds, halo, teb, smoke, light });
    }
    // drag chute: canopy + risers, streamed behind the tail cone
    this.chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(4.2, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe8692a, roughness: 0.8, side: THREE.DoubleSide }));
    canopy.rotation.z = Math.PI / 2; canopy.scale.set(0.55, 1, 1); canopy.position.x = -24;
    const lines = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; lines.push(0, 0, 0, -24, Math.cos(a) * 4.2, Math.sin(a) * 4.2); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.chute.add(canopy, new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
    this.chute.position.copy(CHUTE_POINT); this.chute.visible = false;
    this.root.add(this.chute);
    // anti-collision beacon and nav lights
    const dot = (color, size) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, color], [1, 'rgba(0,0,0,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(size); return s;
    };
    this.beacon = dot('rgba(255,40,30,0.9)', 2.2); this.beacon.position.set(1 - CG_MODEL.x, 3.45 - CG_MODEL.y, 0);
    this.navL = dot('rgba(255,40,30,0.9)', 1.4); this.navL.position.set(-11.4 - CG_MODEL.x, 2.05 - CG_MODEL.y, -8.45);
    this.navR = dot('rgba(40,255,80,0.9)', 1.4); this.navR.position.set(-11.4 - CG_MODEL.x, 2.05 - CG_MODEL.y, 8.45);
    this.root.add(this.beacon, this.navL, this.navR);
    // solid lenses under the glow sprites, so the lights have a body and are not flat blobs
    const lens = (color, pos, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false })); m.position.copy(pos); this.root.add(m); return m; };
    this.lensL = lens(0xff3a2a, this.navL.position, 0.07); this.lensR = lens(0x3aff60, this.navR.position, 0.07); this.lensB = lens(0xff2a20, this.beacon.position, 0.1);
    // landing light: a real spot light for the aircraft and buildings (the ground cone is in the terrain shader)
    this.landLight = new THREE.SpotLight(0xfff0d0, 0, 500, 0.4, 0.55, 1.4);
    this.landLight.position.set(6.6 - CG_MODEL.x, 0.5 - CG_MODEL.y, 0); this.landLight.target.position.set(60, -8, 0);
    this.root.add(this.landLight, this.landLight.target);
    this._lp = new THREE.Vector3(); this._ld = new THREE.Vector3();
    // cockpit lighting: daylight fill through the canopy, warm flood at night
    this._np = new THREE.Vector3(); this._pd = new THREE.Vector3();
    this.cockpitLight = new THREE.PointLight(0xe8eef8, 0, 4.5, 1.1);
    this.cockpitLight.position.set(10.9 - CG_MODEL.x, 3.55 - CG_MODEL.y, 0);
    this.root.add(this.cockpitLight);
    // planform-shaped contact shadow on the ground
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.filter = 'blur(6px)'; x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.moveTo(250, 64); x.lineTo(150, 50); x.lineTo(100, 14); x.lineTo(60, 6); x.lineTo(28, 30); x.lineTo(10, 58);
    x.lineTo(10, 70); x.lineTo(28, 98); x.lineTo(60, 122); x.lineTo(100, 114); x.lineTo(150, 78); x.closePath(); x.fill();
    const sg = new THREE.PlaneGeometry(33, 17); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false }));
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);
  }

  event(e) {
    if (e.type === 'ab-light') this.flash[e.engine] = 1;
    if (e.type === 'unstart') this.smoke[e.engine] = 1;
  }

  update(dt, fdm, camWorld, view, env, groundY, panelState) {
    // three.js only honours envMapIntensity when material.envMap is set; with just scene.environment
    // every material reflects the sky at full strength (blue-grey skin, glowing glare shield)
    const envTex = this.scene.environment;
    if (envTex !== this.envTex) {
      this.envTex = envTex;
      this.root.traverse((o) => {
        const m = o.material;
        if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
        if (!m.envMap) m.needsUpdate = true;
        m.envMap = envTex;
      });
    }
    this.time += dt;
    this.root.position.copy(fdm.pos).sub(camWorld);
    this.root.quaternion.copy(fdm.quat);
    const M = fdm.out.M || 0, rhoRatio = (fdm.out.rho || 1.225) / 1.225;

    // elevons: pitch + roll mix, TE up positive; vec4 = (left inner, left outer, right inner, right outer)
    const de = Math.max(-1, Math.min(1, fdm.surf.de + fdm.trim)) * 18 * D2R, da = fdm.surf.da * 12 * D2R;
    this.uElev.value.set(de - da, de - da * 1.3, de + da, de + da * 1.3);
    // all-moving fins: positive rudder swings the trailing edges right
    // on the ground the pedals steer the nose wheel; the fins only visibly swing once there is airflow over them
    const fade = fdm.onGround ? Math.min(1, Math.max(0, ((fdm.out.V || 0) - 30) / 60)) : 1;
    const rud = fdm.surf.dr * 20 * D2R * fade;
    for (const f of this.fins || []) {
      f.q.setFromAxisAngle(AXIS_Y, rud);
      f.o.quaternion.copy(f.quat).multiply(f.q);
      f.offset.copy(f.pivot).applyQuaternion(f.q).negate().add(f.pivot).applyQuaternion(f.quat);
      f.o.position.copy(f.pos).add(f.offset);
    }
    // spikes start translating aft at Mach 1.6 and are fully aft (26 in) at Mach 3.2
    const spikeAft = Math.max(0, Math.min(1, (M - 1.6) / 1.6)) * 0.66;
    for (const s of this.spikes || []) s.o.position.x = s.x - spikeAft;
    this.spikeIn = spikeAft / 0.0254;

    const g = fdm.gearPos;
    if (this.gearRig) this.gearRig.update(dt, fdm);
    if (this.covers) this.covers.visible = g <= 0.02;

    // ---------- engines ----------
    fdm.engines.forEach((e, i) => {
      const fx = this.engines[i];
      const run = fdm.crashed ? 0 : e.dry, ab = fdm.crashed ? 0 : e.ab, lit = ab > 0.01;
      const t = this.time;
      fx.disc.material.uniforms.uTime.value = t;
      fx.disc.material.uniforms.uI.value = 0.12 + 0.45 * run + 1.6 * ab;
      fx.disc.material.uniforms.uHot.value = Math.min(1, ab * 1.5);
      // plume length grows with A/B and stretches in thin air
      const thin = 1 + 0.8 * (1 - rhoRatio);
      // a plume pointing down at the runway (rotation, climb-out) stops at the surface instead of burning through it
      fx.outer.getWorldPosition(this._np); this._pd.set(-1, 0, 0).applyQuaternion(fdm.quat);
      const clear = this._np.y - (groundY - camWorld.y) - 0.25, maxLen = this._pd.y < -0.02 ? Math.max(0.6, clear / -this._pd.y) : 1e9;
      const L = Math.min((lit ? 6 + 10 * ab : 1.5 + 2.5 * run) * thin, maxLen);
      const wid = 1 + 0.5 * (1 - rhoRatio);
      const vis = lit ? (0.55 + 0.45 * rhoRatio) : 0.12 * run;
      const set = (m, len, inten, rad, dia) => {
        m.scale.set(len, rad, rad);
        const u = m.material.uniforms; u.uTime.value = t; u.uI.value = inten; u.uDia.value = dia; u.uCount.value = 5;
        m.visible = inten > 0.002;
      };
      set(fx.outer, L, vis * (lit ? 0.75 : 0.2), wid, 0.5 * ab);
      set(fx.mid, L * 0.72, vis * (lit ? 1.1 : 0.25), wid, 0.9 * ab);
      set(fx.core, L * 0.48, vis * (lit ? 1.7 : 0.3), 1, ab);
      // shock diamonds: evenly spaced bright knots, spacing grows with altitude
      const spacing = (1.25 + 0.5 * ab) * thin;
      fx.diamonds.forEach((s, k) => {
        const fade = Math.max(0, 1 - k / (3 + 5 * ab)) * (0.9 + k * spacing < maxLen ? 1 : 0);
        s.position.set(-(0.9 + k * spacing), 0, 0);
        s.scale.setScalar((1.7 - k * 0.12) * (1 + 0.3 * ab) * wid);
        s.material.opacity = lit ? Math.min(1, 1.25 * ab) * fade * (0.5 + 0.5 * rhoRatio) * (0.85 + 0.15 * Math.sin(t * 50 + k)) : 0;
        s.visible = s.material.opacity > 0.01;
      });
      fx.halo.scale.setScalar(2.6 + 3 * ab);
      fx.halo.material.opacity = 0.08 * run + 0.75 * ab;
      fx.light.intensity = (lit ? 120 * ab : 6 * run) * (0.9 + 0.1 * Math.sin(t * 37));
      // TEB light-off: brief green flash
      this.flash[i] = Math.max(0, this.flash[i] - dt * 3);
      fx.teb.visible = this.flash[i] > 0.01; fx.teb.material.opacity = this.flash[i];
      fx.teb.scale.setScalar(4 + 4 * (1 - this.flash[i]));
      // unstart: flame collapses and a puff of smoke
      this.smoke[i] = Math.max(0, this.smoke[i] - dt * 0.5);
      fx.smoke.visible = this.smoke[i] > 0.01; fx.smoke.material.opacity = this.smoke[i] * 0.8;
      fx.smoke.scale.setScalar(4 + 14 * (1 - this.smoke[i])); fx.smoke.position.x = -4 - 20 * (1 - this.smoke[i]);
    });

    this.chute.visible = fdm.chute === 'deployed';
    if (this.chute.visible) {
      const k = fdm.chuteOpen;
      this.chute.scale.set(0.3 + 0.7 * k, k, k);
      this.chute.rotation.x = Math.sin(this.time * 3) * 0.05;
    }
    const n = env.night;
    this.beacon.visible = !fdm.crashed && n > 0.05 && (this.time % (1 / 1.2)) < 0.12;
    this.beacon.material.opacity = 0.9 * n;
    this.navL.material.opacity = this.navR.material.opacity = 0.9 * n;
    this.navL.visible = this.navR.visible = n > 0.05;
    this.lensL.visible = this.lensR.visible = !fdm.crashed; this.lensB.visible = this.beacon.visible;
    { const on = !fdm.crashed && fdm.gearDown && n > 0.15 ? Math.min(1, (n - 0.15) * 3) : 0;
      this.landLight.intensity = 600 * on;
      this.root.updateMatrixWorld(true);
      this._lp.copy(this.landLight.position).applyMatrix4(this.root.matrixWorld);
      this._ld.set(1, -0.14, 0).applyQuaternion(this.root.quaternion).normalize();
      TERRAIN_UNIFORMS.uLand.value.set(this._lp.x, this._lp.y, this._lp.z, on); TERRAIN_UNIFORMS.uLandDir.value.copy(this._ld); }
    if (this.gearRig) this.gearRig.setLamp(!fdm.crashed && fdm.gearPos > 0.65 && (fdm.out.V || 0) < 180, n);
    const inside = view === 'cockpit';
    if (this.proxy && this.proxy.sunMat) this.proxy.sunMat.visible = false;
    if (this.proxy && this.proxy.active && inside !== !!this.gearCastIsOff) this.gearCastOff(inside);
    if (this.crew) this.crew.visible = !inside;
    if (this.chine) { const c = this.chine; if (c.zoneMesh.visible !== inside) { c.zoneMesh.visible = inside; c.fus.geometry.setIndex(inside ? c.cut : c.full); } }
    // The cockpit was nearly black: a candela-rated point light of ~1 does almost nothing at panel distance, and the exterior sky map is
    // heavily damped inside. Light it like a cabin full of daylight through the canopy, and a warm red-white flood at night.
    this.cockpitLight.intensity = inside ? 6 * env.daylight + 3.5 * n : 0;
    if (this.cabinMats) { const ei = inside ? 0.14 + 0.34 * env.daylight : 0.12; for (const m of this.cabinMats) if (m.envMapIntensity !== ei) m.envMapIntensity = ei; }
    // the interior is ~250k triangles: only draw it when the camera is close enough to see it
    const near = view === 'cockpit' || camWorld.distanceTo(fdm.pos) < 70;
    this.cockpit.forEach((o) => { o.visible = near && !o.userData.hidden && !(inside && o.name.startsWith('SR71_Cpt_RSO')); });
    if (this.lodPairs && this.lodPairs.length) {
      const dd = camWorld.distanceTo(fdm.pos), lodFar = this.lodGeoForce != null ? this.lodGeoForce : view !== 'cockpit' && (this.lodOn ? dd > 110 : dd > 140);
      if (lodFar !== this.lodOn) { this.lodOn = lodFar; for (const [o, l] of this.lodPairs) { o.visible = !lodFar; l.visible = lodFar; } }
    }
    { const d = camWorld.distanceTo(fdm.pos), far = this.lodForce != null ? this.lodForce : SKIN_LOD.value > 0.5 ? d > 50 : d > 60; SKIN_LOD.value = far && view !== 'cockpit' ? 1 : 0; }
    SKIN_WET.value = Math.max(this.glassWater ? this.glassWater.wet : 0, fdm.onGround ? (env.wet || 0) * 0.85 : 0);
    SKIN_FLOW.value = this.glassWater ? this.glassWater.uniforms.uSpeed.value : 0;
    if (this.decals) for (const d of this.decals) d.visible = !inside;
    if (this.decalOrig) for (const d of this.decalOrig) d.visible = !inside;
    if (this.glassWater) {
      const sun = this._sunM || (this._sunM = new THREE.Vector3());
      sun.copy(env.sunDir).applyQuaternion(this.root.quaternion.clone().invert());
      this.glassWater.update(dt, { rain: this.rainEff || 0, ground: this.rainGround || 0, V: fdm.out.V || 0, sun, daylight: env.daylight, near });
    }
    if (this.real) {
      this.real.interior.visible = near;
      // the modelled canopy is the correct outside shape; the rebuilt one is only for the view from the seat
      this.real.canopy.visible = inside;
      for (const o of this.extCanopy) o.visible = !inside;
      const lvl = Math.min(1, 0.35 + 0.55 * env.daylight + 0.25 * n);
      for (const m of this.real.panelMats) m.color.setScalar(lvl);
      this._pAcc = (this._pAcc || 0) + dt;
      if (inside && panelState) { this.real.cheek.update({ ...panelState, spikeIn: this.spikeIn || 0 }, dt); this.real.controls.set(panelState); }
      if (inside && panelState && this._pAcc >= 1 / 24) {
        const ps = { ...panelState, spikeIn: this.spikeIn || 0 };
        // the panel is a 2048x1152 canvas that is re-uploaded as a texture on every draw: skip it while no gauge is changing (parked, paused)
        this._pGate ??= new ChangeGate('panel');
        if (this._pGate.should(ps, Math.floor(performance.now() / 400) % 2)) { this.panel.draw(ps, this._pAcc + (this._pLost || 0)); this._pLost = 0; } else this._pLost = (this._pLost || 0) + this._pAcc;
        this._pAcc = 0;
      }
    }
    // ground shadow, offset along the sun direction
    const agl = fdm.pos.y - groundY;
    // The jet is drawn into the finest sun-shadow cascade every frame (~330k triangles). Above ~130 m its shadow falls outside that cascade (and the coarser ones no
    // longer draw it), so it is not drawn there at all: the contact shadow below takes over. Back on below 130 m, off above 160 m, so no flicker.
    {
        const want = this.shadowCastForce != null ? this.shadowCastForce : this.castsWorldShadow ? agl < 160 : agl < 130;
      if (want !== this.castsWorldShadow) { this.castsWorldShadow = want; for (const o of this.casters) { if (want) o.layers.enable(AC_SHADOW_LAYER); else o.layers.disable(AC_SHADOW_LAYER); } }
    }
    this.shadow.visible = agl < 1400 && env.elev > 0.03;
    if (this.shadow.visible) {
      const sd = env.sunDir, k = agl / Math.max(0.25, sd.y);
      // lifted clear of the coarser drawn terrain mesh (log depth rules out polygonOffset)
      this.shadow.position.set(fdm.pos.x - sd.x * k - camWorld.x, groundY + 0.3 - camWorld.y, fdm.pos.z - sd.z * k - camWorld.z);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(fdm.quat);
      this.shadow.rotation.y = Math.atan2(-fwd.z, fwd.x);
      const nearGround = Math.min(1, Math.max(0, (agl - 8) / 20)); // the real cascade shadow takes over on the ground
      this.shadow.material.opacity = Math.max(0, 1 - agl / 1400) * Math.min(1, env.daylight * 1.5) * nearGround;
    }
  }
}
