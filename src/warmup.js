import * as THREE from 'three';

// Shader warm-up. three.js links a program the first time something is drawn and then waits for it (a synchronous getProgramParameter), so
// every new view, effect or post pass froze the game while its shaders compiled; in a profile of the first minute that wait was about 40 % of
// all main-thread time. This module hands all of them to the driver at once, in parallel (KHR_parallel_shader_compile) and without blocking,
// while the loading screen is up: the real scene, the shadow-caster variants, the materials that only exist once tiles arrive, every post
// pass and the crash scene.
const scanMats = (o, out, depth = 0) => {
  if (!o || depth > 1) return;
  for (const v of Object.values(o)) {
    if (v && v.isMaterial) out.add(v);
    else if (Array.isArray(v)) { for (const m of v) if (m && m.isMaterial) out.add(m); }
    else if (v && typeof v === 'object' && !v.isTexture && !v.isWebGLRenderTarget && v.constructor && /Pass$|Clouds$/.test(v.constructor.name)) scanMats(v, out, depth + 1);
  }
};

// renderer.compileAsync, minus its one failure: a material disposed before its program reports ready (a preset switch replacing the AO or cloud
// material, a second switch during the first one's compile) has no currentProgram, three's poll threw on it and the promise never settled
export function compileSafe(r, scene, camera, target = null) {
  const mats = r.compile(scene, camera, target);
  return new Promise((resolve) => {
    const check = () => { for (const m of mats) { const p = r.properties.get(m).currentProgram; if (!p || p.isReady()) mats.delete(m); } if (!mats.size) resolve(scene); else setTimeout(check, 10); };
    if (r.extensions && r.extensions.has && r.extensions.has('KHR_parallel_shader_compile')) check(); else setTimeout(check, 10);
  });
}

// c: { renderer, scene, camera, post, shadows, buildings, trees, vclouds, glass, extra: [materials drawn into the scene target], extraPost: [...], crash }
export function warmShaders(c) {
  const r = c.renderer, ready = [], before = r.info.programs ? r.info.programs.length : 0, t0 = performance.now();
  const geo = new THREE.PlaneGeometry(1, 1), prevRT = r.getRenderTarget();
  const dummy = (mats) => { const s = new THREE.Scene(); for (const m of mats) { if (!m) continue; const o = new THREE.Mesh(geo, m); o.frustumCulled = false; s.add(o); } return s; };
  const go = (scene, rt, target) => { try { r.setRenderTarget(rt); ready.push(compileSafe(r, scene, c.camera, target)); } catch (e) { console.warn('shader warm-up step failed', e); } };
  const sceneRT = c.post.enabled && c.post.sceneRT ? c.post.sceneRT : null, shadowRT = (c.shadows && c.shadows.rts && c.shadows.rts[0]) || c.post.compRT;

  // the crash scene (wreck, fire, extra light) is in the scene only for the synchronous part of each compile call below
  go(c.scene, sceneRT, null);                                     // everything in the scene as it is now: aircraft, cockpit, sky, terrain, rain, effects
  if (c.post.enabled) go(c.post.overlay, c.post.compRT, null);    // fire, smoke and rain composited after the clouds
  // the same again with the crash scene present: its extra light changes the lit materials' programs, so a crash would otherwise compile them
  const undoCrash = c.crash ? c.crash() : null;
  try {
    go(c.scene, sceneRT, null);
    if (c.post.enabled) go(c.post.overlay, c.post.compRT, null);
  } finally { if (undoCrash) undoCrash(); }

  // materials that are created later (one per terrain, building and tree tile) share one program each: compile that program now
  const lit = dummy(c.extra || []); go(lit, sceneRT, c.scene);
  // shadow-caster variants of the aircraft, buildings and trees (drawn into the cascade maps)
  const swaps = [];
  c.scene.traverse((o) => { if (o.userData && o.userData.casterMat && o.material) { swaps.push([o, o.material]); o.material = o.userData.casterMat; } });
  try { go(c.scene, shadowRT, null); } finally { for (const [o, m] of swaps) o.material = m; }
  go(dummy(c.casters || []), shadowRT, c.scene);
  // post passes: AO, composite, bloom, SMAA, cloud march and upsample, cloud shadow map, canopy water
  const pm = new Set(); scanMats(c.post, pm); scanMats(c.vclouds, pm); for (const m of c.extraPost || []) if (m) pm.add(m);
  go(dummy([...pm]), c.post.compRT || null, c.scene);

  r.setRenderTarget(prevRT);
  return Promise.all(ready).then(() => ({ programs: (r.info.programs ? r.info.programs.length : 0) - before, ms: performance.now() - t0 }));
}

// Without KHR_parallel_shader_compile (SwiftShader, Safari) compileSafe resolves before the driver has linked anything, so the first draw of each
// program still links it: the crash-light variants of the terrain, building, tree and aircraft programs are first drawn by the wreck, one took
// 5.1 s in the crash frame in a SwiftShader profile. Finish them after the warm-up instead (main.js, not awaited: the spawn and the first draw
// wait for the warm-up and must not wait for this too), in ~8 ms idle slices (three.js links and checks a program
// the first time its uniforms are read; for a program already drawn that is a cached lookup). Every program, not only this call's: the crash
// frame's last one (a MeshBasicMaterial, 3.9 s) was created by an earlier compile and never drawn. With the extension compileSafe already waited.
export function finishPrograms(r, from = 0) {
  if (r.extensions && r.extensions.has && r.extensions.has('KHR_parallel_shader_compile')) return Promise.resolve(0);
  const progs = (r.info.programs || []).slice(from);
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      // already drawn programs cost nothing here; one that still has to link blocks, then the slice ends
      const t0 = performance.now();
      while (i < progs.length && performance.now() - t0 < 8) {
        const p = progs[i++];
        try { if (p && p.program && p.getUniforms) p.getUniforms(); } catch (e) { console.warn('program finish failed', e); }
      }
      if (i >= progs.length) { resolve(progs.length); return; }
      whenIdle(step, 1000);
    };
    whenIdle(step, 1000);
  });
}

// run fn when the browser is idle (or after a short delay where idle callbacks do not exist)
export const whenIdle = (fn, timeout = 4000) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 600));

// Meshes that only appear after the loading screen has started (the cockpit's chine zone and canopy strips, the skin stencils) are built in idle time; if that is later
// than the warm-up above, their shaders compile on the first frame that draws them. Hand them over once they exist: warmLate({ renderer, scene, camera, post }, meshes).
export function warmLate(c, meshes) {
  const r = c.renderer, prevRT = r.getRenderTarget(), rt = c.post && c.post.enabled && c.post.sceneRT ? c.post.sceneRT : null, ready = [];
  try { r.setRenderTarget(rt); for (const m of meshes) ready.push(compileSafe(r, m, c.camera, c.scene)); } catch (e) { console.warn('late shader warm-up failed', e); } finally { r.setRenderTarget(prevRT); }
  return Promise.all(ready);
}

// First use of a texture allocates and uploads it on the spot (a 2048x1152 panel canvas, a 4096x2304 panel background and dozens of 1024 cockpit canvases are 40+ MB
// together): do it a few at a time while the browser is idle, so switching to the cockpit does not pay for all of it in one frame.
export function warmTextures(renderer, textures, budgetMs = 4) {
  const queue = [...textures];
  return new Promise((done) => {
    const slice = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < budgetMs) { const t = queue.shift(); try { renderer.initTexture(t); } catch (e) { console.warn('texture warm-up failed', e); } }
      if (queue.length) whenIdle(slice, 1000); else done();
    };
    whenIdle(slice, 1000);
  });
}
