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

// c: { renderer, scene, camera, post, shadows, buildings, trees, vclouds, glass, extra: [materials drawn into the scene target], extraPost: [...], crash }
export function warmShaders(c) {
  const r = c.renderer, ready = [], before = r.info.programs ? r.info.programs.length : 0, t0 = performance.now();
  const geo = new THREE.PlaneGeometry(1, 1), prevRT = r.getRenderTarget();
  const dummy = (mats) => { const s = new THREE.Scene(); for (const m of mats) { if (!m) continue; const o = new THREE.Mesh(geo, m); o.frustumCulled = false; s.add(o); } return s; };
  const go = (scene, rt, target) => { try { r.setRenderTarget(rt); ready.push(r.compileAsync(scene, c.camera, target)); } catch (e) { console.warn('shader warm-up step failed', e); } };
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

// run fn when the browser is idle (or after a short delay where idle callbacks do not exist)
export const whenIdle = (fn, timeout = 4000) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 600));
