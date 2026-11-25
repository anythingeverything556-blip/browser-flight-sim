import * as THREE from 'three';

// Ground shadow of a light aircraft (as the Skyhawk has it in c172visual.js): the airframe's own silhouette seen from the sun, drawn white into a
// small target only when its shape changes, projected onto the ground along the sun direction with a penumbra that widens with height. The world
// cascades' 0.25-0.5 m texels smear a 1.5 m wing chord into a dark smudge.
const LAYER = 4;
export class SilShadow {
  // casters: the opaque meshes of the airframe; r: half-size of the silhouette view (m); d: its distance from the aircraft
  constructor(scene, casters, { size = 512, r = 7, d = 30, fadeEnd = 1500 } = {}) {
    this.scene = scene; this.size = size; this.r = r; this.d = d; this.fadeEnd = fadeEnd;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cam = new THREE.OrthographicCamera(-r, r, r, -r, 1, 2 * d);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.sig = new Float64Array(12); this.have = false; this.frames = 0; this.sd = new THREE.Vector3(0, 1, 0); this.vp = new THREE.Matrix4();
    this.cam.layers.set(LAYER);
    for (const o of casters) o.layers.enable(LAYER);
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { tSil: { value: this.rt.texture }, uVP: { value: this.vp }, uBlur: { value: 0.01 }, uLod: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tSil; uniform mat4 uVP; uniform float uBlur, uLod, uOpacity; varying vec3 vW;
float tap(vec2 uv) { return textureLod(tSil, uv, uLod).r; }
void main() {
#include <logdepthbuf_fragment>
  vec4 c = uVP * vec4(vW, 1.0); vec2 uv = c.xy * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  float b = uBlur;
  float s = 0.36 * tap(uv) + 0.16 * (tap(uv + vec2(b, 0.3 * b)) + tap(uv - vec2(b, 0.3 * b)) + tap(uv + vec2(-0.3 * b, b)) + tap(uv - vec2(-0.3 * b, b)));
  float a = s * uOpacity; if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`,
      transparent: true, depthWrite: false, toneMapped: false, fog: false,
    }));
    this.mesh.renderOrder = 1; this.mesh.visible = false; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.last = null;
  }

  // places the quad on the ground under the sun-shifted aircraft; agl: height of the aircraft's wheels above the ground
  place(fdm, camWorld, env, groundY, agl) {
    const m = this.mesh; m.visible = !!(env && env.elev > 0.03 && env.sunDir.y > 0.05 && agl < this.fadeEnd);
    if (!m.visible) return;
    const sd = env.sunDir, sy = Math.max(0.12, sd.y), dist = Math.max(0, agl) / sd.y;
    this.last = { fdm, sd };
    m.position.set(fdm.pos.x - sd.x * dist - camWorld.x, groundY + 0.1 - camWorld.y, fdm.pos.z - sd.z * dist - camWorld.z);
    m.rotation.y = Math.atan2(-sd.z, sd.x);
    m.scale.set(2.2 * this.r / sy, 1, 2.2 * this.r);
    // penumbra: the sun's 0.53 deg disc over the distance from the airframe to the ground, plus a few centimetres of softness
    const blurUv = (0.05 + 0.0093 * dist) / (2 * this.r), u = m.material.uniforms;
    u.uBlur.value = blurUv; u.uLod.value = Math.max(0, Math.log2(blurUv * this.size / 2));
    u.uOpacity.value = 0.62 * Math.min(1, env.daylight * 1.5) * (1 - 0.85 * (env.overcast || 0)) * Math.max(0, Math.min(1, (this.fadeEnd - agl) / (this.fadeEnd - 400))); // overcast: no direct sun
  }

  // redraws the silhouette when the airframe's shape as seen from the sun changes; extra: other values that change the shape (flaps, gear...)
  render(renderer, root, extra) {
    if (!this.mesh.visible || !this.last) return;
    const { fdm: f, sd } = this.last, q = f.quat, s = f.surf || {}, g = this.sig;
    const cur = [q.x, q.y, q.z, q.w, sd.x, sd.y, sd.z, extra[0] || 0, s.da || 0, s.de || 0, s.dr || 0, extra[1] || 0];
    let dirty = !this.have || ++this.frames % 60 === 0;
    // 2.5e-3 in the quaternion is ~0.3 deg: about one silhouette texel at the wing tips
    for (let i = 0; i < cur.length && !dirty; i++) if (Math.abs(cur[i] - g[i]) > (i < 4 ? 2.5e-3 : 1e-3)) dirty = true;
    const cam = this.cam;
    if (dirty) { this.sd.copy(sd); g.set(cur); }
    cam.position.copy(root.position).addScaledVector(this.sd, this.d);
    cam.up.set(0, 1, 0); if (Math.abs(this.sd.y) > 0.98) cam.up.set(1, 0, 0);
    cam.lookAt(root.position); cam.updateMatrixWorld(true);
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (!dirty) return;
    this.have = true;
    const scene = this.scene, prevRT = renderer.getRenderTarget(), ac = renderer.autoClear, bg = scene.background, ov = scene.overrideMaterial;
    const au = renderer.shadowMap.autoUpdate, nu = renderer.shadowMap.needsUpdate, alpha = renderer.getClearAlpha(), col = renderer.getClearColor(new THREE.Color()).getHex();
    try {
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      scene.background = null; scene.overrideMaterial = this.mat; renderer.autoClear = false;
      renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.render(scene, cam);
    } finally {
      scene.background = bg; scene.overrideMaterial = ov; renderer.autoClear = ac;
      renderer.setRenderTarget(prevRT); renderer.setClearColor(col, alpha);
      renderer.shadowMap.autoUpdate = au; renderer.shadowMap.needsUpdate = nu;
    }
  }
}
