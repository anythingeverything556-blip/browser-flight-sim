import * as THREE from 'three';
import { R_EARTH } from './geo.js';
import { ATMOS_UNIFORMS, ATM_FRAG } from './atmos.js';

// Billboard cumulus used when the volumetric march is off (Low). Each puff is a camera-facing sprite from a baked atlas
// (xy = surface normal, z = thickness, alpha = coverage). What makes a flat deck of sprites read as cloud rather than
// cardboard: puffs are drawn far-to-near (re-sorted as the camera moves), fade out in proportion to their own size so the
// jet can fly through them, have no baked-in flat bottom (the base comes from where the puffs sit), vary in shape and
// mirror, and drift with the wind. The field wraps every SPAN metres around the camera.
const CELL = 3000, GRID = 14, PER_CELL = 14, COUNT = GRID * GRID * PER_CELL, SPAN = CELL * GRID;
const TILE = 192, VARIANTS = 4, SORT_EVERY_MS = 450, SORT_MOVE = 250;

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function valueNoise(seed) {
  const r = rng(seed), g = new Float32Array(4096).map(() => r());
  const at = (i, j) => g[((j & 63) << 6) | (i & 63)];
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), u = smooth(0, 1, x - i), v = smooth(0, 1, y - j);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

function buildAtlas() {
  const size = TILE * 2, data = new Uint8Array(size * size * 4);
  for (let n = 0; n < VARIANTS; n++) {
    const rand = rng(1234 + n * 77), noise = valueNoise(99 + n * 13), blobs = [];
    // a cauliflower of overlapping lobes: big ones low and central, small ones crowning the top
    for (let k = 0; k < 22; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.55, rad = 0.17 + 0.2 * rand() * (1.25 - d);
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.8 + 0.1, rad]);
    }
    const dens = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const px = ((x + 0.5) / TILE) * 2 - 1, py = ((y + 0.5) / TILE) * 2 - 1;
      let v = 0;
      for (const b of blobs) { const w = ((px - b[0]) ** 2 + (py - b[1]) ** 2) / (b[2] * b[2]); if (w < 1) v += (1 - w) ** 2; }
      const fbm = 0.55 * noise(px * 7 + 11, py * 7) + 0.3 * noise(px * 15 + 5, py * 15 + 9) + 0.15 * noise(px * 31, py * 31 + 3);
      v *= (0.55 + 0.9 * fbm) * (0.7 + 0.3 * smooth(-0.75, -0.3, py)); // slightly flatter underneath, not a cut-off
      dens[y * TILE + x] = v * Math.min(1, Math.max(0, (1 - Math.hypot(px, py)) * 4));
    }
    const h = (x, y) => Math.sqrt(Math.max(0, dens[Math.min(TILE - 1, Math.max(0, y)) * TILE + Math.min(TILE - 1, Math.max(0, x))]));
    const ox = (n & 1) * TILE, oy = (n >> 1) * TILE;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const v = dens[y * TILE + x], gx = (h(x + 1, y) - h(x - 1, y)) * 2.5, gy = (h(x, y + 1) - h(x, y - 1)) * 2.5, gl = Math.hypot(gx, gy, 1);
      const a = smooth(0, 1, Math.min(1, Math.max(0, (v - 0.05) / 0.4))), o = ((oy + y) * size + ox + x) * 4;
      data[o] = ((-gx / gl) * 0.5 + 0.5) * 255; data[o + 1] = ((-gy / gl) * 0.5 + 0.5) * 255;
      data[o + 2] = Math.min(1, v / 1.2) * 255; data[o + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

const VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aOff; attribute float aSeed, aCell;
uniform vec3 uCam, uAtmSun; uniform vec2 uDrift; uniform float uBase, uCover;
varying vec2 vUv; varying float vA, vFlip; varying vec3 vRel, vSunV, vUpV;
void main() {
  float span = ${SPAN.toFixed(1)};
  vec2 rel = mod(aOff.xz + uDrift - uCam.xz + span * 0.5, span) - span * 0.5;
  vec3 c = vec3(rel.x, uBase + aOff.y - uCam.y, rel.y);
  c.y -= dot(c.xz, c.xz) * ${(0.5 / R_EARTH).toExponential(8)};
  float d = length(c), hs = aOff.w * 2.3;
  // fade with the puff's own size, so flying into one thins it out instead of slicing through a giant card
  float fadeNear = smoothstep(0.2 * hs, 1.1 * hs, d);
  vA = smoothstep(aSeed, aSeed + 0.06, uCover) * (1.0 - smoothstep(span * 0.3, span * 0.5, length(rel))) * fadeNear;
  float flip = step(4.0, aCell), variant = aCell - 4.0 * flip;
  vFlip = 1.0 - 2.0 * flip;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * hs * vec2(1.25, 1.0);
  vUv = (vec2(mod(variant, 2.0), floor(variant * 0.5)) + vec2(flip > 0.5 ? 1.0 - uv.x : uv.x, uv.y)) * 0.5;
  vRel = c; vSunV = mat3(viewMatrix) * uAtmSun; vUpV = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG = `#include <common>
#include <logdepthbuf_pars_fragment>
${ATM_FRAG}
uniform sampler2D map;
varying vec2 vUv; varying float vA, vFlip; varying vec3 vRel, vSunV, vUpV;
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(map, vUv);
  float a = t.a * vA;
  if (a < 0.01) discard;
  vec3 n = vec3((t.rg * 2.0 - 1.0) * vec2(vFlip, 1.0), 0.0); n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
  vec3 sun = normalize(vSunV), up = normalize(vUpV);
  float lit = smoothstep(-0.35, 0.9, dot(n, sun)), upn = dot(n, up) * 0.5 + 0.5;
  vec3 V = normalize(vRel);
  float fw = pow(max(dot(V, uAtmSun), 0.0), 5.0) * (1.0 - t.b) * (0.4 + 0.6 * lit); // silver lining on thin edges
  vec3 L = uAtmSunCol * (0.03 + 0.115 * lit + 0.18 * fw) + uAtmAmb * 3.14159 * 0.9 * mix(0.5, 1.0, upn) + uAtmNight * 0.5;
  L *= mix(1.0, 0.8, t.b * (1.0 - lit)); // dense cores in shade are darker than their edges
  vec3 col = atmAerial(atmTone(L), vRel);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Clouds {
  constructor(scene) {
    const rand = rng(20240607);
    this.src = { off: new Float32Array(COUNT * 4), seed: new Float32Array(COUNT), cell: new Float32Array(COUNT) };
    let n = 0;
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const cx = (i + rand()) * CELL, cz = (j + rand()) * CELL, seed = rand(), kind = rand();
      // mostly cumulus; some low spread-out sheets and a few towering heaps
      let radius = 420 + rand() * 600, height = radius * (0.7 + rand() * 0.9), puff = 1;
      if (kind < 0.2) { radius *= 1.7; height *= 0.35; puff = 1.15; } else if (kind > 0.86) { radius *= 0.8; height *= 1.8; }
      for (let k = 0; k < PER_CELL; k++, n++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius, edge = 1 - d / radius;
        const size = radius * (0.3 + 0.45 * edge) * (0.8 + 0.4 * rand()) * puff;
        this.src.off.set([cx + Math.cos(a) * d, size * 0.45 + Math.pow(edge, 0.8) * height * (0.3 + 0.7 * rand()), cz + Math.sin(a) * d, size], n * 4);
        this.src.seed[n] = seed;
        this.src.cell[n] = Math.floor(rand() * VARIANTS) + (rand() < 0.5 ? 4 : 0);
      }
    }
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(this.src.off), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(this.src.seed), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(this.src.cell), 1).setUsage(THREE.DynamicDrawUsage);
    const quad = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position')); geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('aOff', this.aOff); geo.setAttribute('aSeed', this.aSeed); geo.setAttribute('aCell', this.aCell);
    geo.instanceCount = COUNT;
    this.uniforms = {
      ...ATMOS_UNIFORMS,
      map: { value: buildAtlas() }, uCam: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector2() },
      uBase: { value: 1800 }, uCover: { value: 0.3 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, toneMapped: false, vertexShader: VERT, fragmentShader: FRAG });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this._keys = new Float64Array(COUNT); this._sortAt = -1e9; this._sortPos = new THREE.Vector3(1e9, 0, 0);
  }

  // camWorld: camera position (m); cover 0..1; base: cloud base altitude (m); wind: Vector2 (x, z m/s) the layer drifts with; now: seconds
  update(camWorld, env, cover, base, wind, now = 0) {
    const u = this.uniforms;
    u.uCam.value.copy(camWorld); u.uCover.value = cover; u.uBase.value = base;
    if (wind) u.uDrift.value.set((wind.x * now) % SPAN, (wind.y * now) % SPAN);
    this.mesh.visible = cover > 0.01;
    if (!this.mesh.visible) return;
    const t = performance.now();
    if (t - this._sortAt > SORT_EVERY_MS && (this._sortPos.distanceToSquared(camWorld) > SORT_MOVE * SORT_MOVE || t - this._sortAt > 4000)) this.sort(camWorld, base, t);
  }

  // draw order: far to near, using the same wrap-around the vertex shader applies
  sort(cam, base, t) {
    this._sortAt = t; this._sortPos.copy(cam);
    const { off } = this.src, keys = this._keys, d = this.uniforms.uDrift.value, half = SPAN * 0.5;
    for (let i = 0; i < COUNT; i++) {
      const rx = ((((off[i * 4] + d.x - cam.x + half) % SPAN) + SPAN) % SPAN) - half, rz = ((((off[i * 4 + 2] + d.y - cam.z + half) % SPAN) + SPAN) % SPAN) - half;
      const dy = base + off[i * 4 + 1] - cam.y, dist = Math.sqrt(rx * rx + dy * dy + rz * rz);
      keys[i] = Math.floor((90000 - dist) * 2) * 4096 + i;
    }
    keys.sort();
    const o = this.aOff.array, s = this.aSeed.array, c = this.aCell.array, { off: so, seed, cell } = this.src;
    for (let k = 0; k < COUNT; k++) {
      const i = keys[k] % 4096;
      o[k * 4] = so[i * 4]; o[k * 4 + 1] = so[i * 4 + 1]; o[k * 4 + 2] = so[i * 4 + 2]; o[k * 4 + 3] = so[i * 4 + 3];
      s[k] = seed[i]; c[k] = cell[i];
    }
    this.aOff.needsUpdate = this.aSeed.needsUpdate = this.aCell.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.uniforms.map.value.dispose(); this.mesh.parent && this.mesh.parent.remove(this.mesh);
  }
}
