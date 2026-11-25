# F27 V4: target-frame lighting/shadow freshness

## Ownership and delivery boundary

Adds only `src/f27view.js`, `test/f27-view-v4-test.mjs`, `test/f27-view-v4.html`, `test/f27-view-v4-browser.mjs`, this note and evidence under `notes/f27-v4-views-evidence/`. No edits by this helper to main.js, f27visual.js, shared shadow/warmup code, test/scripts.json, dist, package/deploy files. Main integration belongs to the parent.

**Final integration observation:** the parent's concurrently edited main.js now contains beginFrame / beforeEnvironment(env) / prepareFrame / beforeRender / afterRender, with beforeEnvironment immediately before ordinary env.update. This helper did not edit main.js; full main integration execution is the parent's verification boundary. Keep the environment hook: without it, old PMREM/sky LUT may survive their throttles.

## Diagnosis before changes

- main's sun self-map uses a 12-component pose/sun/gear/flap signature and every-24-frame fallback. It does NOT include view/model visibility. Changing representations can sample the old exterior map until another dirty event.
- F27 loadPart explicitly sets cockpit meshes castShadow=false. Hiding the exterior leaves no current cockpit caster; forcing a redraw alone would just clear its self-map. `prepareF27ViewCasters(part)` enables opaque, material-visible cockpit mesh casters, leaving glass, transparent prop disc/blades, authored node visibility and exterior unchanged. The two representations are never simultaneously shown.
- WorldShadows cascade 0 draws every drawable frame; cascades 1/2 have 24/90-frame maximum ages (times pressure's every multiplier), plus camera motion/head-turn/FOV, sun and caster-signature triggers. Signature only counts shallow children, not F27 representation swaps. Reset all freshness flags at the boundary; do not permanently set every=0.
- Scene coordinates are camera-relative: visual.root is aircraft-world minus camera-world; building meshes and tree chunks reposition and distance-cull each ordinary update. Run target rig/camera, terrain, buildings, trees, model pose/visibility and pooled-light updates BEFORE shadow preparation. A second hidden camera draw before those updates would use inconsistent culling and placements.
- Environment sets toneMappingExposure immediately (0.55 + 0.25*daylight), not an auto-exposure history. BUT sky LUT refresh is throttled 250ms and reflection PMREM is throttled 15s. Bypass only those refresh timestamps for the transition's target frame. Keep the current hour, atmosphere, sun and light intensities; never warm under invented noon.
- AO has current-depth rendering but its strength eases across frames. Snap aoNow to the actual target once, before the ordinary AO easing assignment.
- VolumetricClouds half-rate can reproject a prior march. Clear _marchedAt once before target post; leave halfRate configured. CloudShadow uses a 0.35-second update cadence and cross-fades old/current maps over 0.33 seconds. Invalidate both map-valid flags and old.valid so current sun/weather is generated without blending in the source view map.
- Five spot + two point pooled proxies stay in scene. The controller never changes their count, intensity, castShadow settings or environment material intensity. No resize/setSize/pixel-ratio calls in the implementation. Material preparation remains the existing texture slices + warmLate/compile route, using actual environment and post target variant.
- Existing F27 parts are not tagged onto world cascade layer 3 by f27visual.js. This patch does not invent that tagging, add a second exterior caster representation or alter global cascade policies. The self-map correction is distinct from streamed-world shadow coverage.

## Exact main hooks

Import:

```js
import {createF27ViewTransition, createF27ViewCover, prepareF27ViewCasters} from './f27view.js';
```

Create one controller only for IS_F27, after rig exists. No non-F27 behavior changes:

```js
const f27Cover = IS_F27 ? createF27ViewCover(canvas) : null;
const f27View = IS_F27 ? createF27ViewTransition({
  getView: () => rig.view,
  prepare: view => view === 'cockpit' ? f27CockpitPreload() : undefined,
  apply: applyView,
  cover: active => f27Cover.set(active),
  timeoutMs: 30000, // parent's asset deadline; module default is 15000
}) : null;
```

In the shared cockpit preload promise, call `prepareF27ViewCasters(part)` before texture/shader preparation. It does not reveal the part. Keep the v3.1 active texture slices; keep the existing bounded warmLate wait. Route F27 setView through `f27View.request(v)`, while preserving f27RequestedView + request serial for UI/latest-intent handling. Results resolve to status shown / superseded / failed (error included on failure); they do not reject on a failed asset request.

Per-frame ordering (all are synchronous hooks):

1. After graphicsHold early-return, and only if this frame can actually draw, call `f27View?.beginFrame()` BEFORE the rig update and all camera-dependent work. This activates a prepared target only; while assets load, the old rig remains active. Parent's current canDraw gate is appropriate.
2. Immediately BEFORE `env.update(...)`, call `f27View?.beforeEnvironment(env)`. It clears only LUT/PMREM refresh throttles. The normal env update does the real current-time lighting and atmosphere work.
3. Keep ordinary target camera, scenery, visual and pooled-light updates in their usual order.
4. After visual and pooled-light updates, BEFORE cloudShadow.update and shadows.update:

```js
const aoTarget = rig.view === 'cockpit' || pressure.level >= 1 ||
  fdm.pos.y - state.lastGround > 4000 ? 0 : aoBase;
if (canDraw && f27View?.prepareFrame({
  renderer, scene, shadows, cloudShadow, vclouds, post, shAt, aoTarget,
})) aoNow = aoTarget;
```

This updates scene matrices, invalidates all cascade fresh flags and self signature, drops old cloud map/history, and snaps the post strength. Use the same aoTarget for ordinary easing later; do not redeclare a conflicting highUp target.
5. Keep the ordinary cloud-shadow/cascade/self-dirty and cockpit mask passes. The dirty block may overwrite renderer.shadowMap.needsUpdate, so call beforeRender after it AND after any mask prepass.
6. At the existing visible draw, exactly:

```js
if (draw) {
  f27View?.beforeRender(renderer);
  post.render(scene, camera); // existing ONE main scene pass
  f27View?.afterRender(renderer);
}
```

Do not call afterRender on draw=false, in finally, on errors or before the composite is done. It also checks context loss. Renderer canvas/post targets are never resized. No hidden full-scene warmup draw is added.

## Timing and fallback semantics

- Preparation is not a view switch. The source stays active while loading/texture slices/compile run.
- Once prepared, beginFrame covers and activates the target. A normal same-task render with current lighting/maps removes the neutral opaque cover before browser paint. It is normally not visible; skipped/failed/context-lost frames remain covered.
- No idle callback is needed to progress the gate; request preparation starts on a microtask, activation is on a normal drawable frame. Existing active texture slices keep their RAF/70ms fallback.
- The asset deadline fails back to the last displayed view; it never exposes an unrendered target. A late older load completion is ignored. Rapid requests settle older ones as superseded.
- If a covered active target is superseded then the new load fails, rollback to the last DISPLAYED view is queued and revealed only after its own fresh normal frame. An already-loaded source does not need another download.
- There is intentionally no timeout that drops the cover over an unrendered target. Rendering errors/context loss must use graphics recovery or a fresh source-view request. This fails closed, rather than showing stale maps.
- Steady state adds only cheap null/phase checks. The one-time mandatory refresh uses the existing shadow/effect passes; it does not double permanent scene rendering or force every shadow map every frame.

## Verification

Commands (independent strict port; no changes to test registry or app server):

```sh
node test/f27-view-v4-test.mjs
node test/f27-view-v4-browser.mjs
# F27_VIEWS_PORT=5194 by default; F27_VIEWS_OUT can change the evidence directory
# F27_VIEWS_SERVE=1 node test/f27-view-v4-browser.mjs to expose the fixture only
```

Pure tests cover first entry, loading leaves source intact, same-frame freshness token, draw=false, context loss, rapid intents, timeout/rejection, covered rollback, caster eligibility, no intensity/cadence mutation and zero steady-state preparation.

Real renderer: actual F27 exterior/VC GLBs, actual Environment, WorldShadows, PostFX/AO, VolumetricClouds with 160x100 march at 640x400 presentation and half-rate ON, CloudShadow, pooled lights and camera-relative scenery fixtures. Day/dusk/night cockpit/exterior cases compare first target pixels against an explicit force-fresh reference. Instrument/dome/landing/taxi circuits stay enabled at fixed authored levels for night proof. onBeforeShadow counts actual caster draws; no inference from dirty flag alone.

Managed Linux Chrome was checked with browser-use and cannot initialize WebGL2 on this runtime. The screen-capture skill capture records that exact blocker. Puppeteer Chrome using SwiftShader executes real software WebGL instead; its six screenshots are NOT managed desktop captures, and timings are NOT hardware FPS. The scene uses synthetic local ground/blocker fixtures, not a streamed terrain/network/production end-to-end run. Full main integration and visual framing remain the parent's checks.

Final measurements and source fingerprints live in evidence/report.json, run.log, pure.log and test-inputs.sha256. The ungated regression fixture deliberately retains old AO, self-map, reflection throttle and half-rate history before applying the correction; it asserts a nonzero image difference plus zero old-path sun caster submissions versus positive corrected submissions. Every prepared first target matches a force-fresh reference exactly (max pixel-channel delta 0), and submits exactly ONE main scene draw.

Cold first cockpit submission can still synchronously link shaders on SwiftShader even when programDelta=0. This is reported explicitly in report.json; the gate prevents stale presentation but is not a zero-hitch guarantee or a target FPS claim.


## Integrated caster budget refinement

The first integration enabled every opaque primitive (1,095 cockpit shadow casters). The live game also renders terrain and post effects and struggled to retire input frames in the software-rendered Chrome run. The released `prepareF27ViewCasters` keeps only sizeable opaque geometry (largest dimension at least 0.25 m; product of the two largest dimensions at least 0.08 m²). Small gauges, switches and hardware still render and receive daylight/shadows; they no longer each submit a separate sun-depth draw. See the revised independent benchmark in the release evidence.
