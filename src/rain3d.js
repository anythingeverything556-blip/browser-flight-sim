import * as THREE from 'three';

// Rain as real 3D geometry: thousands of streaks living in a box around the camera, each with a true depth. They fall at terminal
// velocity relative to the moving camera, are projected with perspective (near drops are long, fast and bright, far ones short and
// faint), are hidden by the aircraft, buildings and terrain through the depth test, and give parallax when the camera moves.
// The streak geometry is built on the GPU from one random seed per drop, so the CPU only advances a single offset per frame.
const VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iSeed;
uniform vec3 uOff, uVel; uniform vec2 uRes;
uniform float uBox, uLen, uMaxLen, uNearCut, uInten, uFar, uDropW;
varying float vA; varying float vW; varying float vX;
void main() {
  if (iSeed.w > uInten) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = fract(iSeed.xyz + uOff / uBox) * uBox - 0.5 * uBox;
  float speed = length(uVel);
  vec3 vdir = uVel / max(speed, 0.001);
  float vary = fract(iSeed.x * 91.7 + iSeed.z * 13.1);
  float len = clamp(speed * uLen, 0.2, uMaxLen) * (0.75 + 0.5 * vary);
  vec3 w0 = p + cameraPosition, w1 = w0 - vdir * len;
  vec4 m0 = viewMatrix * vec4(w0, 1.0), m1 = viewMatrix * vec4(w1, 1.0);
  float dist = length(m0.xyz);
  if (dist < uNearCut || (m0.z > -0.05 && m1.z > -0.05)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  m0.z = min(m0.z, -0.05); m1.z = min(m1.z, -0.05);
  vec4 c0 = projectionMatrix * m0, c1 = projectionMatrix * m1;
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes * 0.5;
  float dl = length(d);
  vec2 dn = dl > 0.001 ? d / dl : vec2(0.0, -1.0);
  vec2 perp = vec2(-dn.y, dn.x);
  float phys = uDropW * uRes.y * 0.5 * projectionMatrix[1][1] / dist;
  float pxW = max(1.1, phys);
  float t = position.y;
  vec4 c = mix(c0, c1, t);
  vec2 off = perp * position.x * pxW + dn * (t > 0.5 ? 0.6 : -0.6);
  gl_Position = c;
  gl_Position.xy += off / uRes * 2.0 * c.w;
  #include <logdepthbuf_vertex>
  float haze = exp(-dist / uFar);
  vA = (1.0 - 0.7 * t) * clamp(phys / pxW, 0.35, 1.0) * haze * (0.6 + 0.4 * vary) * 1.9;
  vW = -m0.z; vX = position.x;
}`;
const FRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uTint; uniform float uSoft, uLogF; uniform vec2 uRes; uniform highp sampler2D tDepth;
varying float vA; varying float vW; varying float vX;
void main() {
  #include <logdepthbuf_fragment>
  float e = 1.0 - abs(vX) * 2.0;
  float a = min(1.0, vA * e * e * (3.0 - 2.0 * e));
  if (a < 0.004) discard;
  if (uSoft > 0.5) {
    float sceneW = exp2(texture2D(tDepth, gl_FragCoord.xy / uRes).r * uLogF) - 1.0;
    a *= clamp((sceneW - vW) / 0.4, 0.0, 1.0);
    if (a < 0.004) discard;
  }
  gl_FragColor = vec4(uTint, a);
}`;

export class RainField {
  constructor(count = 12000) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = count;
    this.box = 80; this.off = new THREE.Vector3();
    this.uniforms = {
      uOff: { value: this.off }, uVel: { value: new THREE.Vector3(0, -8.5, 0) }, uRes: { value: new THREE.Vector2(1, 1) },
      uBox: { value: this.box }, uLen: { value: 0.06 }, uMaxLen: { value: 5 }, uNearCut: { value: 1.2 }, uInten: { value: 0 },
      uFar: { value: 60 }, uDropW: { value: 0.012 }, uTint: { value: new THREE.Color(0.8, 0.86, 0.94) },
      uSoft: { value: 0 }, uLogF: { value: 1 }, tDepth: { value: null },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9; this.mesh.visible = false;
  }
  // soft: drawn by the post pass after the clouds, depth-tested against the scene inside the shader
  attach(parent, soft) {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    parent.add(this.mesh); this.uniforms.uSoft.value = soft ? 1 : 0;
  }
  // camVel / wind: m/s world vectors { x, y, z }; intensity 0..1; daylight 0..1
  update(dt, camVel, wind, intensity, cockpit, daylight) {
    const on = intensity > 0.02;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.uniforms, k = 0.55, v = u.uVel.value;
    // the camera's own speed counts for 55 %: at full relative speed every drop becomes a streak racing past, which hides the rain
    v.set(wind.x - camVel.x * k, -8.5 - camVel.y * k + wind.y, wind.z - camVel.z * k);
    this.off.addScaledVector(v, dt);
    const b = this.box;
    this.off.set(((this.off.x % b) + b) % b, ((this.off.y % b) + b) % b, ((this.off.z % b) + b) % b);
    u.uInten.value = Math.min(1, intensity);
    u.uNearCut.value = cockpit ? 2.2 : 1.2;
    u.uMaxLen.value = 5;
    const l = 0.25 + 0.75 * daylight; u.uTint.value.setRGB(0.8 * l, 0.86 * l, 0.94 * l);
  }
}
