import * as THREE from 'three';
import { FX_LAYER } from './layers.js';
import { DEPTH_GLSL, depthK, isReversed } from './depth.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const lu = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  k2 = `
uniform highp sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uFull; uniform float uProjY, uIntensity, uMaxDist;
${DEPTH_GLSL}
varying vec2 vUv;
float linZ(vec2 uv) { return depthW(textureLod(tDepth, uv, 0.0).r); }
vec3 viewPos(vec2 uv, float z) { vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0); p.xyz /= p.w; return p.xyz * (z / -p.z); }
void main() {
  float d = texture2D(tDepth, vUv).r;
  float z = depthW(d), zo = min(z, 6e4); // g carries the view distance itself (half float, capped) for the depth-aware blur in the composite
  if (depthSky(d) || z > uMaxDist) { gl_FragColor = vec4(1.0, zo, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv, z);
  // normal from the neighbour on each side that is closer in depth, so silhouettes do not smear
  vec2 px = 1.0 / uFull;
  vec3 Pr = viewPos(vUv + vec2(px.x, 0.0), linZ(vUv + vec2(px.x, 0.0))), Pl = viewPos(vUv - vec2(px.x, 0.0), linZ(vUv - vec2(px.x, 0.0)));
  vec3 Pu = viewPos(vUv + vec2(0.0, px.y), linZ(vUv + vec2(0.0, px.y))), Pd = viewPos(vUv - vec2(0.0, px.y), linZ(vUv - vec2(0.0, px.y)));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  // world radius grows with distance (a roughly constant screen radius), clamped for cockpit and far terrain
  float rW = clamp(z * 0.035, 0.25, 35.0);
  float rUv = min(rW * uProjY * 0.5 / z, 0.12);
  if (rUv * uFull.y < 1.5) { gl_FragColor = vec4(1.0, zo, 0.0, 1.0); return; }
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float t = (float(i) + 0.6) / float(AO_SAMPLES), a = ang + float(i) * 2.3999632;
    vec2 suv = vUv + vec2(cos(a) * uFull.y / uFull.x, sin(a)) * rUv * t;
    vec3 v = viewPos(suv, linZ(suv)) - P;
    float vv = dot(v, v);
    occ += max(0.0, dot(v, N) * inversesqrt(vv + 1e-6) - 0.12) * max(0.0, 1.0 - vv / (rW * rW));
  }
  float ao = clamp(1.0 - uIntensity * occ / float(AO_SAMPLES), 0.0, 1.0);
  ao = mix(ao, 1.0, smoothstep(uMaxDist * 0.5, uMaxDist, z));
  gl_FragColor = vec4(ao, zo, 0.0, 1.0);
}`,
  z2 = `
uniform sampler2D tScene, tAO, tClouds, tDrops, tFx; uniform highp sampler2D tDepth;
uniform float uAO, uClouds, uDrops, uFxOn;
${DEPTH_GLSL} uniform vec2 uAOTexel; uniform vec3 uDropLight;
varying vec2 vUv;
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  // water on the canopy glass: the picture behind it is bent (offset.xy), darkened at the rim (a) and lit by a highlight (b)
  vec2 uv = vUv; float dDark = 0.0, dSpec = 0.0;
  if (uDrops > 0.5) { vec4 dr = textureLod(tDrops, vUv, 0.0); uv = clamp(vUv + dr.rg, vec2(0.002), vec2(0.998)); dSpec = dr.b; dDark = dr.a; }
  vec4 scn = texture2D(tScene, uv); vec3 col = scn.rgb;
  // additive effects (afterburner plume, fire) write no depth, so the cloud march cannot know they are in front of the cloud layer. Additive blending also
  // adds to the target's alpha (opaque surfaces leave it at exactly 1), so alpha above 1 marks them and the cloud layer is not composited over them.
  float fx = smoothstep(0.02, 0.25, scn.a - 1.0);
  if (uAO > 0.0) {
    float zc = min(depthW(textureLod(tDepth, uv, 0.0).r), 6e4), sum = 0.0, ws = 0.0;
    // depth-aware 3x3 blur of the half-res AO (bilinear taps 1.5 texels apart)
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 a = textureLod(tAO, uv + vec2(float(i), float(j)) * uAOTexel * 1.5, 0.0).rg;
      float z = a.g;
      float w = (i == 0 && j == 0 ? 2.0 : 1.0) * max(0.0, 1.0 - abs(z - zc) / (0.05 * zc + 0.05)) + 1e-4;
      sum += a.r * w; ws += w;
    }
    col *= mix(1.0, sum / ws, uAO * (1.0 - fx)); // not over additive effects (plume, vapour): they have no depth, so AO would use the ground or sky behind them
  }
  // Over an additive effect the cloud layer used to be dropped altogether, so every cloud behind the afterburner plume vanished. The plume is nearer than any
  // cloud: keep its light whole (the cloud no longer dims it) and add the cloud's own light as a veil, half strength at the plume core, so clouds read through it.
  if (uClouds > 0.5) { vec4 c = textureLod(tClouds, uv, 0.0); vec3 lin = s2l(col); col = l2s(lin * mix(c.a, 1.0, fx) + c.rgb * (1.0 - 0.5 * fx)); }
  // engine plume and airframe vapour: drawn on their own (depth-tested against the scene) and added here, after the clouds. In the scene target they were
  // dimmed by the cloud layer behind them, so they either vanished over cloud or, with the old alpha mask, erased the clouds around them.
  if (uFxOn > 0.5) col = min(col + textureLod(tFx, uv, 0.0).rgb, vec3(1.0));
  col = col * (1.0 - dDark) + dSpec * uDropLight;
  gl_FragColor = vec4(col, 1.0);
}`;
class PostFX {
  constructor(t) {
    ((this.renderer = t),
      (this.enabled = !1),
      (this.overlay = new THREE.Scene()),
      (this.msaa = 0),
      (this.dbg = {}), // F5-F9 debug switches (perf.js): ao, clouds, smaa, bloom
      (this.aoStrength = 0),
      (this.aoSamples = 0),
      (this.bloomStrength = 0),
      (this.smaa = !1),
      (this.w = 1),
      (this.h = 1),
      (this.sceneRT = null),
      (this.aoRT = new THREE.WebGLRenderTarget(1, 1, { type: 1016, depthBuffer: !1 })),
      (this.compRT = new THREE.WebGLRenderTarget(1, 1, { type: 1016, depthBuffer: !1 })),
      (this.outRT = new THREE.WebGLRenderTarget(1, 1, { type: 1016, depthBuffer: !1 })),
      (this.aoMat = null),
      (this.compMat = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: null },
          tAO: { value: null },
          tClouds: { value: null },
          tFx: { value: null },
          uFxOn: { value: 0 },
          tDepth: { value: null },
          tDrops: { value: null },
          uDrops: { value: 0 },
          uDropLight: { value: new THREE.Vector3(1, 1, 1) },
          uDepthK: { value: new THREE.Vector2(1, 0) },
          uAO: { value: 0 },
          uClouds: { value: 0 },
          uAOTexel: { value: new THREE.Vector2() },
        },
        vertexShader: lu,
        fragmentShader: z2,
        depthTest: !1,
        depthWrite: !1,
      })),
      (this.copyMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: null } },
        vertexShader: lu,
        fragmentShader:
          'uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }',
        depthTest: !1,
        depthWrite: !1,
      })),
      (this.quad = new FullScreenQuad(this.compMat)),
      (this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 0.93)),
      (this.smaaPass = new SMAAPass()),
      (this.smaaPass.renderToScreen = !0),
      (this.clouds = null),
      (this.cloudParams = null),
      (this.glassWater = null));
  }
  configure({ enabled: t, msaa: e = 0, ao: n = 0, aoSamples: i = 12, bloom: r = 0, smaa: a = !1 }) {
    ((this.enabled = t),
      (this.aoStrength = n),
      (this.bloomStrength = r),
      (this.smaa = a),
      i !== this.aoSamples &&
        ((this.aoSamples = i),
        this.aoMat && this.aoMat.dispose(),
        (this.aoMat = new THREE.ShaderMaterial({
          defines: { AO_SAMPLES: i },
          uniforms: {
            tDepth: { value: null },
            uProjInv: { value: new THREE.Matrix4() },
            uFull: { value: new THREE.Vector2() },
            uDepthK: { value: new THREE.Vector2(1, 0) },
            uProjY: { value: 1 },
            uIntensity: { value: 1.6 },
            uMaxDist: { value: 6e3 },
          },
          vertexShader: lu,
          fragmentShader: k2,
          depthTest: !1,
          depthWrite: !1,
        }))),
      (this.msaaWanted = e),
      this._applyMsaa(),
      (this.bloom.strength = r));
  }
  _applyMsaa() {
    const e = Math.min(this.msaaWanted ?? 0, this.msaaMax ?? 4);
    if (e !== this.msaa || !this.sceneRT) { this.msaa = e; this._makeSceneRT(); }
  }
  set msaaMax(v) { this._msaaMax = v; if (this.msaaWanted !== undefined) this._applyMsaa(); }
  get msaaMax() { return this._msaaMax; }
  // sizes of every full-frame target, for the F3 resolution check: anything much smaller than the canvas is an intended down-scale
  sizes() {
    const f = (r) => (r ? `${r.width}x${r.height}` : '-');
    const g = this.glassWater;
    return `scene ${f(this.sceneRT)} (msaa ${this.msaa ?? 0}) · ao ${f(this.aoRT)} (half-res by design) · comp ${f(this.compRT)} · out ${f(this.outRT)} · clouds ${f(this.clouds && this.clouds.lowRT)} · glass ${f(g && g.rt)}`;
  }
  _makeSceneRT() {
    this.fxRT && this.fxRT.dispose();
    this.sceneRT && (this.sceneRT.depthTexture.dispose(), this.sceneRT.dispose());
    const t = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: 1016,
      samples: this.msaa,
      depthTexture: new THREE.DepthTexture(this.w, this.h, 1015),
    });
    ((t.isXRRenderTarget = !0), (t.texture.colorSpace = THREE.SRGBColorSpace), (this.sceneRT = t));
    // plume target: same size, same depth texture (so the jet and the ground hide it correctly), its own colour
    const f = new THREE.WebGLRenderTarget(this.w, this.h, { type: 1016, depthTexture: t.depthTexture });
    f.texture.colorSpace = THREE.SRGBColorSpace; this.fxRT = f;
  }
  // fire and smoke: composited after the clouds so the cloud pass cannot paint over them where the depth buffer says "sky"
  _renderOverlay(n, camera, depth, dk) {
    if (!this.overlay.children.length) return;
    for (const c of this.overlay.children) {
      const u = c.material && c.material.uniforms;
      if (u && u.tDepth) { u.tDepth.value = depth; u.uDepthK.value.copy(dk); u.uRes.value.set(this.w, this.h); }
    }
    const ac = n.autoClear; n.autoClear = false; n.setRenderTarget(this.compRT); n.render(this.overlay, camera); n.autoClear = ac;
  }
  // nw x nh: the screen's own pixels. At a supersampled render scale the soft passes (AO, bloom, the cloud upsample) run at those, not at the
  // buffer's 2-4x; they are sampled by uv in the composite. SMAA is skipped once the buffer is 1.4x the screen or more: supersampling is the AA.
  setSize(t, e, nw = t, nh = e) {
    const sw = Math.max(1, Math.min(t, Math.round(nw))), sh = Math.max(1, Math.min(e, Math.round(nh)));
    ((this.w = t),
      (this.h = e),
      (this.ss = t / sw),
      this.sceneRT && this.sceneRT.setSize(t, e),
      this.fxRT && this.fxRT.setSize(t, e),
      this.aoRT.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1)),
      this.compRT.setSize(t, e),
      this.outRT.setSize(t, e),
      this.glassWater && this.glassWater.setSize(t, e),
      this.bloom.setSize(sw, sh),
      this.smaaPass.setSize(t, e),
      this.clouds && this.clouds.setSize(sw, sh));
  }
  render(t, e) {
    const n = this.renderer;
    if (!this.enabled) {
      e.layers.enable(FX_LAYER); // no post pipeline (Low): the plume is drawn with the scene
      (n.setRenderTarget(null), n.render(t, e));
      return;
    }
    e.layers.disable(FX_LAYER);
    const P = this.prof || (() => {});
    const i = depthK(e, isReversed(n), this._dk || (this._dk = new THREE.Vector2())),
      r = this.sceneRT.depthTexture;
    P('scene');
    (n.setRenderTarget(this.sceneRT), n.render(t, e));
    let fxTex = null;
    if (this.fxOn && this.fxRT) {
      P('plume');
      const ac = n.autoClear, bg = t.background, mask = e.layers.mask, cc = n.getClearColor(this._cc || (this._cc = new THREE.Color())), ca = n.getClearAlpha();
      n.autoClear = false; t.background = null; e.layers.set(FX_LAYER);
      n.setRenderTarget(this.fxRT); n.setClearColor(0x000000, 0); n.clear(true, false, false); // colour only: the depth is the scene's
      n.render(t, e);
      e.layers.mask = mask; t.background = bg; n.autoClear = ac; n.setClearColor(cc, ca);
      fxTex = this.fxRT.texture;
    }
    const a = this.aoStrength > 0 && !this.dbg.ao;
    if (a) {
      P('ao');
      const u = this.aoMat.uniforms;
      ((u.tDepth.value = r),
        u.uProjInv.value.copy(e.projectionMatrixInverse),
        u.uFull.value.set(this.w, this.h),
        u.uDepthK.value.copy(i),
        (u.uProjY.value = e.projectionMatrix.elements[5]),
        (this.quad.material = this.aoMat),
        n.setRenderTarget(this.aoRT),
        this.quad.render(n));
    }
    P('glass');
    const gw = this.glassWater, dropRT = gw ? gw.render(n, t, e, r, i, this.w, this.h) : null;
    let l = null;
    P('clouds');
    this.clouds && !this.dbg.clouds &&
      this.cloudParams &&
      this.cloudParams.coverage > 0.01 &&
      (l = this.clouds.render(n, { ...this.cloudParams, camera: e, depthTexture: r }));
    P('composite');
    const h = this.compMat.uniforms;
    h.tDrops.value = dropRT ? dropRT.texture : null; h.uDrops.value = dropRT ? 1 : 0;
    if (gw) h.uDropLight.value.copy(gw.light);
    ((h.tScene.value = this.sceneRT.texture),
      (h.tAO.value = this.aoRT.texture),
      (h.tDepth.value = r),
      h.uDepthK.value.copy(i),
      (h.uAO.value = a ? this.aoStrength : 0),
      h.uAOTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height),
      (h.tFx.value = fxTex),
      (h.uFxOn.value = fxTex ? 1 : 0),
      (h.tClouds.value = l),
      (h.uClouds.value = l ? 1 : 0),
      (this.quad.material = this.compMat),
      n.setRenderTarget(this.compRT),
      this.quad.render(n),
      this._renderOverlay(n, e, r, i),
      P('bloom'),
      this.bloomStrength > 0 && !this.dbg.bloom && this.bloom.render(n, null, this.compRT, 0, !1),
      P('smaa'),
      this.smaa && !this.dbg.smaa && !(this.ss >= 1.4)
        ? this.smaaPass.render(n, this.outRT, this.compRT, 0, !1)
        : ((this.copyMat.uniforms.t.value = this.compRT.texture),
          (this.quad.material = this.copyMat),
          n.setRenderTarget(null),
          this.quad.render(n)));
  }
}

export { PostFX };
