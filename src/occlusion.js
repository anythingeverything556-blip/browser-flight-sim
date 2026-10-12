import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Hidden-surface culling for the cockpit view: a software early-Z.
//
// The renderer uses a logarithmic depth buffer, so every material writes gl_FragDepth and the GPU cannot reject a fragment before running its
// shader. In the cockpit that meant the exterior skin shader (physical + clearcoat + procedural paint) ran for the inside of the fuselage, the
// ground and the sky behind the instrument panel, glare shield and consoles, about 40 % of the screen, only to lose the depth test afterwards.
//
// Each cockpit frame first draws the opaque cockpit parts into a depth mask at the size of the screen (the same log depth the scene writes),
// shrinks the covered area by one pixel so only pixels that are certainly covered stay marked, and the expensive materials skip a fragment that
// lies behind the mask before shading it. A skipped fragment would have lost the depth test anyway, so the picture is unchanged. The mask is
// full size on purpose: at half size a one-pixel gap between two cockpit parts fell between the samples and was drawn over.
export const OCC_LAYER = 6;
const EPS = 2e-4; // log-depth units: about 6 mm at 1 m, so only fragments clearly behind a cockpit surface are dropped

// shared by every patched material, so one assignment feeds them all
export const OCC_UNIFORMS = { uOccOn: { value: 0 }, tOcc: { value: null }, uOccInv: { value: new THREE.Vector2(1, 1) } };

export const OCC_DECL = 'uniform float uOccOn; uniform highp sampler2D tOcc; uniform vec2 uOccInv;';
// Log depth of this fragment (what gl_FragDepth gets) against the mask depth under it; the mask holds 1.0 wherever the cockpit does not cover.
// A fragment behind the mask still writes its depth, so the depth buffer comes out exactly as before for the passes that read it, and a dark
// neutral colour: it loses the depth test, and where it can still show (a hairline crack between two cockpit parts) that is closer to the
// dark lining behind than a hole through to the sky would be.
export const OCC_TEST = `#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  if (uOccOn > 0.5) {
    float occD = log2(vFragDepth) * logDepthBufFC * 0.5;
    if (occD > texture2D(tOcc, gl_FragCoord.xy * uOccInv).r + ${EPS.toFixed(5)}) { gl_FragColor = vec4(0.13, 0.16, 0.2, 1.0); gl_FragDepth = occD; return; }
  }
#endif`;

// Adds the test to the fragment source of a built-in three.js material. Returns null when the template has no place for it (a three.js
// upgrade changed it), in which case the material is simply left as it was.
export function occlusionSource(src) {
  if (src.includes('tOcc')) return src;
  const decl = '#include <common>', test = '#include <clipping_planes_fragment>';
  if (!src.includes(decl) || !src.includes(test)) return null;
  return src.replace(decl, `${decl}\n${OCC_DECL}`).replace(test, `${test}\n${OCC_TEST}`);
}

// Chains the test onto a material's own onBeforeCompile, after whatever it already patches.
export function cullHidden(material) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (!m || m.userData.occCull || m.isShaderMaterial) continue;
    m.userData.occCull = true;
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
    m.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      const out = occlusionSource(shader.fragmentShader);
      if (out) { shader.fragmentShader = out; Object.assign(shader.uniforms, OCC_UNIFORMS); }
    };
    m.customProgramCacheKey = () => `${key}|occ`;
    m.needsUpdate = true;
  }
  return material;
}

const _main = new THREE.Layers(); // layer 0, the one the main camera draws

// A mesh can stand in the mask only if the main pass certainly draws a fragment wherever the mask says it does: opaque, drawn on both sides
// like the mask, and big enough on screen to be worth a draw call. Any subset of the real occluders is correct; this just picks the useful ones.
export function isOccluder(o, minRadius = 0.04) {
  if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.layers.test(_main) || Array.isArray(o.material)) return false;
  const m = o.material;
  if (!m || m.isShaderMaterial || m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.alphaMap || !m.depthWrite || !m.depthTest || m.side !== THREE.DoubleSide) return false;
  if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
  const s = o.geometry.boundingSphere;
  return !!s && s.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) >= minRadius;
}
const FULLSCREEN_V = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ERODE_F = `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) m = max(m, texture2D(tSrc, vUv + vec2(float(i), float(j)) * uTexel).r);
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

export class CockpitOcclusion {
  constructor(scale = 1) {
    this.enabled = true;
    this.scale = scale;
    this.count = 0;
    this.stats = { calls: 0, tris: 0, w: 0, h: 0 };
    this.rt = null; this.rt2 = null; this._ok = null;
    this._size = new THREE.Vector2(); this._color = new THREE.Color();
    // nearest depth wins: MIN blending on a one-channel half-float target, so the mask needs no depth buffer of its own
    this.mat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide, toneMapped: false, fog: false, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        gl_FragColor = vec4(log2(vFragDepth) * logDepthBufFC * 0.5, 0.0, 0.0, 1.0);
#else
        gl_FragColor = vec4(1.0);
#endif`);
    };
    this.mat.customProgramCacheKey = () => 'cockpit-occlusion-mask';
    // 3x3 maximum: a texel stays marked only if it and its eight neighbours are covered, and keeps the farthest of their depths
    this.erode = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FULLSCREEN_V, fragmentShader: ERODE_F, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.erode);
  }

  // mark a mesh as something the pilot cannot see through
  add(mesh) { if (isOccluder(mesh)) { mesh.layers.enable(OCC_LAYER); this.count++; return true; } return false; }
  addAll(root) { let n = 0; root.traverse((o) => { if (this.add(o)) n++; }); return n; }

  supported(renderer) {
    if (this._ok === null) this._ok = !!renderer.capabilities.isWebGL2 && !!renderer.capabilities.logarithmicDepthBuffer && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    return this._ok;
  }

  _target(w, h) {
    const t = new THREE.WebGLRenderTarget(w, h, { format: THREE.RedFormat, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    t.texture.colorSpace = THREE.NoColorSpace;
    return t;
  }

  _resize(w, h) {
    this.rt && this.rt.dispose(); this.rt2 && this.rt2.dispose();
    this.rt = this._target(w, h); this.rt2 = this._target(w, h);
    this.stats.w = w; this.stats.h = h;
  }

  // Draws the mask for this frame's camera and publishes it to the shared uniforms. Returns false (and leaves the uniforms alone) when there
  // is nothing to do. The caller switches uOccOn on around the scene pass only, so no other pass ever reads a mask of a different size.
  render(renderer, scene, camera) {
    if (!this.enabled || !this.count || !this.supported(renderer)) return false;
    renderer.getDrawingBufferSize(this._size);
    const W = this._size.x, H = this._size.y, w = Math.max(2, Math.ceil(W * this.scale)), h = Math.max(2, Math.ceil(H * this.scale));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) this._resize(w, h);
    const info = renderer.info.render, c0 = info.calls, t0 = info.triangles;
    const prevRT = renderer.getRenderTarget(), ac = renderer.autoClear, bg = scene.background, ov = scene.overrideMaterial, mask = camera.layers.mask;
    const alpha = renderer.getClearAlpha(), sn = renderer.shadowMap.needsUpdate; renderer.getClearColor(this._color);
    const prevColor = this._color.getHex();
    try {
      camera.layers.set(OCC_LAYER); scene.background = null; scene.overrideMaterial = this.mat; renderer.autoClear = false;
      renderer.setRenderTarget(this.rt); renderer.setClearColor(0xffffff, 1); renderer.clear(true, false, false);
      renderer.render(scene, camera);
      this.erode.uniforms.tSrc.value = this.rt.texture; this.erode.uniforms.uTexel.value.set(1 / w, 1 / h);
      renderer.setRenderTarget(this.rt2); this.quad.render(renderer);
    } finally {
      scene.overrideMaterial = ov; scene.background = bg; camera.layers.mask = mask;
      renderer.setRenderTarget(prevRT); renderer.setClearColor(prevColor, alpha); renderer.autoClear = ac; renderer.shadowMap.needsUpdate = sn;
    }
    this.stats.calls = info.calls - c0; this.stats.tris = info.triangles - t0;
    OCC_UNIFORMS.tOcc.value = this.rt2.texture; OCC_UNIFORMS.uOccInv.value.set(1 / W, 1 / H);
    return true;
  }

  // compile the mask and erode programs while the loading screen is up, so the first cockpit frame does not stall on them
  warm(renderer, camera) {
    if (!this.supported(renderer)) return;
    const prev = renderer.getRenderTarget(), sc = new THREE.Scene(), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1, 1, 0, -1, 0, 1, -1], 3));
    sc.add(new THREE.Mesh(g, this.mat));
    if (!this.rt) this._resize(8, 8);
    renderer.setRenderTarget(this.rt); renderer.render(sc, camera);
    this.erode.uniforms.tSrc.value = this.rt.texture; renderer.setRenderTarget(this.rt2); this.quad.render(renderer);
    renderer.setRenderTarget(prev); g.dispose();
  }
}
