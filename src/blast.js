import * as THREE from 'three';
import { TERRAIN_UNIFORMS } from './terrain-shader.js';

// Jet blast on the ground: the engines at power blow the grass back along the exhaust line (done in the terrain shader, where the
// grass blades are drawn and only exist near the camera and below about 500 ft) and kick up a cloud of dust that rolls aft.
export class JetBlast {
  constructor(scene) {
    this.N = 220; this.i = 0;
    this.pos = new Float32Array(this.N * 3); this.rel = new Float32Array(this.N * 3); this.vel = new Float32Array(this.N * 3); this.age = new Float32Array(this.N).fill(9); this.life = new Float32Array(this.N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rel, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uCol: { value: new THREE.Color(0.55, 0.5, 0.42) }, uPx: { value: 600 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aA, aS; uniform float uPx; varying float vA;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aS * uPx * projectionMatrix[1][1] / max(-mv.z, 0.5), 0.0, 220.0); vA = aA;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uCol; varying float vA;
        void main() {
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; float n = 0.75 + 0.25 * sin(q.x * 9.0 + q.y * 7.0); gl_FragColor = vec4(uCol, vA * (1.0 - r) * (1.0 - r) * n); }`,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 8;
    scene.add(this.pts); this.g = g; this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this.acc = 0;
  }

  // nozzles: world positions of the two exhausts (the frame fdm.pos lives in); aft: unit vector pointing back along the exhaust
  update(dt, { fdm, camWorld, groundY, nozzles, aft, daylight, height, px }) {
    const agl = Math.max(0, fdm.pos.y - groundY - 2.42), thr = fdm.crashed ? 0 : Math.max(0, fdm.throttle - 0.12) / 0.88;
    const ab = Math.max(fdm.engines[0].ab, fdm.engines[1].ab);
    const s = Math.min(1, thr * (1 - Math.min(1, agl / 30)) * (fdm.onGround || agl < 30 ? 1 : 0));
    const U = TERRAIN_UNIFORMS, mid = this._v.set(0, 0, 0);
    for (const n of nozzles) mid.add(n); mid.multiplyScalar(1 / nozzles.length);
    U.uBlastA.value.set(mid.x - camWorld.x, mid.y - camWorld.y, mid.z - camWorld.z, s * (0.7 + 0.3 * ab));
    U.uBlastB.value.set(aft.x, aft.z, 90 + 170 * ab + 60 * thr, height);
    this.mat.uniforms.uPx.value = px;
    this.mat.uniforms.uCol.value.setRGB(0.5, 0.46, 0.38).multiplyScalar(0.35 + 0.65 * daylight);
    const A = this.g.attributes.aA.array, S = this.g.attributes.aS.array;
    // spawn along the blast line, just above the ground, drifting aft and up
    this.acc += dt * s * (30 + 60 * ab);
    while (this.acc >= 1) {
      this.acc -= 1; const k = this.i++ % this.N, d = 6 + Math.random() * (30 + 90 * s), ox = (Math.random() - 0.5) * (2 + d * 0.16), j = k * 3;
      const n = nozzles[(Math.random() * nozzles.length) | 0];
      this.pos[j] = n.x + aft.x * d - aft.z * ox; this.pos[j + 1] = groundY + 0.2 + Math.random() * 0.6; this.pos[j + 2] = n.z + aft.z * d + aft.x * ox;
      const sp = 7 + 16 * s * Math.random(); this.vel[j] = aft.x * sp + (Math.random() - 0.5) * 3; this.vel[j + 1] = 1 + Math.random() * 2.4; this.vel[j + 2] = aft.z * sp + (Math.random() - 0.5) * 3;
      this.age[k] = 0; this.life[k] = 2.6 + Math.random() * 2.6;
    }
    for (let k = 0; k < this.N; k++) {
      const j = k * 3;
      if (this.age[k] >= this.life[k]) { A[k] = 0; continue; }
      this.age[k] += dt; const f = this.age[k] / this.life[k], drag = Math.exp(-dt * 0.5);
      this.vel[j] *= drag; this.vel[j + 2] *= drag; this.vel[j + 1] -= dt * 0.4;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      A[k] = 0.3 * Math.sin(Math.PI * Math.min(1, f * 1.2)) * (1 - f) ; S[k] = 1.2 + 6 * f;
    }
    for (let k = 0; k < this.N; k++) { const j = k * 3; this.rel[j] = this.pos[j] - camWorld.x; this.rel[j + 1] = this.pos[j + 1] - camWorld.y; this.rel[j + 2] = this.pos[j + 2] - camWorld.z; }
    this.g.attributes.position.needsUpdate = this.g.attributes.aA.needsUpdate = this.g.attributes.aS.needsUpdate = true;
  }
}
