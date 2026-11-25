# F27 v6 cockpit render work and windshield rain correction

Scope: F27 only, based on the supplied v5 owner tree. No aircraft GLBs,
flight dynamics, camera settings, gear tracks, light budgets/intensities or
weather presets were changed. There is no resolution reduction.

## Corrections

- The F27 had **no GlassWater binding or update**, while global weather disables
  old 2D cockpit beads. Bind the actual VC `WINDSHIELD` surfaces:
  `x0_Windows_Main_Side` (175 triangles) and `x0_WindshieldWipersWet`
  (38 triangles). Wing landing-light lenses and gauge lenses are excluded.
- Reuse the existing aircraft-space bead/runner shader with a F27 opt-in
  overlay-only mode. Rain comes from the normal main-loop effective weather
  feed, accumulates, animates with time/airspeed, then dries. Two small pane draws
  when wet in cockpit, zero rain draws when dry/outside; no rain render target or
  extra full-scene refraction pass, including when postprocessing is enabled.
- Combine static **opaque** cockpit geometry by identical material, vertex layout,
  shadow behavior and render order. Retain original named objects/bindings.
  Exclude transparent meshes, hidden/default-hidden objects, reflected transforms,
  all animated ancestry, yokes, props, lamps and annunciators. This removes actual
  main-pass submissions rather than merely reducing local matrix bookkeeping.
- Keep the seven-light pool, but gate exactly zero-RGB point/spot BRDF work on
  F27 materials. Enabled lights still execute Three's original shading code;
  no global shader chunks are changed. The verification tool can switch the
  gate off to compare the same shader and scene.

## Verification commands

```sh
npm ci
npm ci --prefix tools/da40-tooling --ignore-scripts
npm test
npm run build
SMOKE_AIRCRAFT=f27 SMOKE_OUTPUT_DIR=/tmp/f27-smoke npm run test:smoke
F27_VIEWS_OUT=/tmp/f27-views node test/f27-view-v4-browser.mjs
SMOKE_OUTPUT_DIR=/tmp/f27-v6 node tools/f27-cockpit-v6-browser.mjs
```

Chrome must be available as `/usr/bin/google-chrome` (production harness also
accepts `CHROME_PATH`). Browser checks use a separate headless SwiftShader
process, **not** the shared visible Chrome. Terrain imagery/DEM are deterministic
synthetic fixtures; these are not screenshots of a real airport/deployment.
Generated evidence belongs outside this source tree.

The v6 production harness tests weather-preset-to-windshield wiring, dry/start/
soaked/time-advanced/airspeed/dried states, static-batch on/off image comparisons,
pooled-light shading on/off with lights disabled/partial/full, and post-enabled
rain's single main-scene draw. It records CPU submission timing separately from
GPU-completed readback timing; `gl.finish()` alone is not a reliable browser GPU
completion measurement. The first readback sample can include queued work.

## Performance interpretation

The initial frozen production A/B at 960x600, render scale 0.6 (576x360), Low,
log depth, synthetic terrain, same camera, measured 839 to 664 main-scene draws
(175 fewer, 20.9%). Submission medians were 10.0/11.7 ms unbatched versus
6.8/6.1 ms batched in alternating-order runs. Source merge inventory was 291
objects into 43 batches (248 total saved submissions before view culling).
Triangles were 353,002 versus 356,644: merged bounds submit some geometry that
individual frustum bounds rejected; no geometry is simplified or removed.

Software rasterization remained the dominant end-to-end bottleneck: readback
medians were approximately 1,036/1,049 ms unbatched versus 1,025/1,015 ms batched.
Dormant-light gating showed small gains in one run and mixed timing in the
final run; its end-to-end timing benefit is inconclusive in this software setup. **Do not claim a hardware FPS gain or that this fixes every
GPU-bound cockpit.** The repeatable evidence is reduced real draw submission
work, with visual and functional checks; physical-GPU profiling remains needed.

At that A/B, batch image difference was 13 pixels above 2 levels out of 207,360,
mean 0.00095/255; light gate on/off was pixel-identical. Water affected 3,188
pixels, its next time state changed 4,192 pixels and its speed state 5,153.
The dry/wet/dried counts were 664/666/664 with no shader or context errors.
Use the fresh generated `report.json` for exact latest values and timings.

## Final verification recorded for this candidate

- Release suite: **142/142 passed**; production build succeeded.
- Full F27 production smoke: passed, zero browser errors and zero missing local
  assets; 111 native instrument tracks, pilot controls, seat views, lighting,
  livery switching, audio rundown and gear/reversal behavior checked.
- V4 view regression: day/dusk/night cockpit/exterior first target frames exactly
  match fresh reference images (max pixel difference 0), with one main draw,
  current shadows and cloud march, no shader programs created on view switches.
- Final v6 production fixture: actual Rain preset reached effective rain 0.2897,
  wetness 0.1687 through the main weather/visual loop; postprocessing correctly
  binds the same pane effect. Dry/wet/dried draws: **666/668/666** (two rain
  geometry draws only while wet), with **one** main scene draw when post is on.
- Final frozen rainy-world A/B: **841 → 666** main submissions, and forced
  self-shadow-refresh frame **983 → 760** total submissions. Shadow behavior is
  preserved, not disabled. Batch image differences above two levels: forward 13,
  left 14, right 13, overhead 8, panel 104, rear 2 pixels of 207,360; means below
  0.006/255. These are tiny raster precision/edge differences, not exact equality.
- Pooled-light gate off/on: pixel-identical with lights at 0, 0.6 and 1.0.
- Rain static-to-wet affected 3,074 pixels; advancing time changed 4,150 and the
  next airspeed state changed 5,530. No shader errors, context-loss events or
  frame exceptions. Inspect final JSON for the complete samples, not only medians.

Evidence is staged outside the owner tree in `f27-release/qa-v6/`; no site was
published or deployed by this change. Packaging and both production deployments
remain the release owner's responsibility.

The raw profiler's `casters` field counts `castShadow` properties including the
retained, invisible source meshes; it is not an active draw count. Use the forced
shadow-refresh A/B (142 versus 94 actual self-shadow submissions) to assess work.

## Separate unmodified-v5 versus v6 production builds

Sequential, isolated runs of `qa-v6/production-profile.mjs`: viewport 640x400,
fixed Low/0.6 output 384x240, adaptive resolution disabled, paused ground cockpit,
synthetic terrain, same SwiftShader. These runs include the whole production
loop and 25 real main submissions, not a stubbed renderer.

- v5: median visual update 1.00 ms; median post submission 7.20 ms; mean main draw calls 863.88; mean triangles 400195; median real frame interval 1149.9 ms.
- v6: median visual update 1.10 ms; median post submission 6.60 ms; mean main draw calls 683.24; mean triangles 395249; median real frame interval 1149.9 ms.

Scene-wide terrain streaming/driver timing adds variation across builds; use the
frozen same-scene A/B above to isolate the rendering changes. No hardware FPS
claim is justified by these software measurements.
