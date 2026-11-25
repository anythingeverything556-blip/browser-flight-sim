# SF50 native-detail upgrade — 21 November 2026 (local, not deployed)

## What actually changed

The playable SF50 now loads `SF50_fullres_v1.glb`. It is **not a newly downloaded aircraft or a higher-polygon replacement**: it preserves the complete shipped SF50 mesh and restores nine native-resolution images from the owner's supplied `handoff/sf50-model-wip/SF50_exterior_fix1.glb`. This is an actual visual asset upgrade without importing that WIP's changed/lower-detail geometry. The original `SF50.glb` remains intact for comparisons and rollback. The new filename bypasses the seven-day model cache.

- All **403,431 triangles**, **143 primitives**, **40 glTF nodes**, hierarchy, node transforms, hinge axes and other extras, materials, UV accessors and compressed geometry are unchanged.
- All **141 non-image buffer views are byte-identical**. The nine replaced image buffers match the owner-supplied full-resolution source byte-for-byte; the other four images are unchanged. No resampling, recompression, decimation, mesh merging or new third-party content.
- PFD/MFD live canvases also now use the native **2560 × 1600** design resolution (previously 1920 × 1200), preserving the existing raw-sRGB upload path, mipmaps, anisotropy and display update cadence. This matters because the live canvases replace the embedded fallback in pilot view.
- No flight, input, camera, aerodynamic, audio or aircraft-system logic changes.

## Image comparison

| Image | Shipped asset | Upgrade / native source |
| --- | --- | --- |
| V-tail base colour | 1024 × 1024 | 2048 × 2048 |
| V-tail ORM | 512 × 512 | 2048 × 2048 |
| GTC 1–3 (each) | 1024 × 640 | 1600 × 1000 |
| MFD/PFD fallback (each) | 1024 × 640 | 2560 × 1600 |
| Livery base colour | 2048 × 1024 | 4096 × 2048 |
| Livery ORM | 512 × 256 | 4096 × 2048 |

The full-resolution asset is 1,771,184 bytes versus 1,481,076 bytes shipped. Original fine detail is preserved rather than upscaled. Higher source resolution does not guarantee a visible difference in a distant view.

## Why not substitute the researched aircraft?

The installed Skyhawk is already a detailed **172SP** with 312,513 triangles, 327 nodes, named instruments, cabin, doors and custom animation/panel code. The researched [c172p-team aircraft](https://github.com/c172p-team/c172p) explicitly identifies itself as a **172P for FlightGear**, not a 172SP or a ready-to-use web GLB. Its source contains AC3D geometry (`Models/c172-common.ac`), a 307 KB XML model/animation configuration and separate interior/instrument models, FlightGear shaders and textures. A conversion requires porting its moving-part and instrument hierarchy and matching the 172P variant's flight model, not silently putting the P exterior on this SP's FDM.

Upstream [README](https://github.com/c172p-team/c172p/blob/10a26158b6456244d84cbac27e6882bdc807f98c/README.md) and [GPLv2 LICENSE](https://github.com/c172p-team/c172p/blob/10a26158b6456244d84cbac27e6882bdc807f98c/LICENSE) were checked. GPL permits redistribution under its conditions, but this project's existing personal-use/no-redistribution terms cannot simply be applied to those assets. A compliant source/license packaging plan and variant-specific integration would be separate work. No external source files were imported; this is not a claim that GPL content is categorically incompatible with a proprietary game.

The owner's exterior-fix WIP has **390,997 triangles / 142 primitives** versus **403,431 / 143** shipped. Its nodes, transforms and material definitions match, but its exterior shapes and ruddervators change and some geometry is removed. The complete WIP therefore does **not** meet the requested no-geometry-loss condition and was not selected. Only its untouched native source images are used. The optimized WIP was also not used.

This upgrade adds no third-party redistribution obligations and no paid model. Owner-provided project assets remain under the owner's existing terms; they are not relabelled as freely redistributable assets. Nothing here establishes a global “finest free aircraft” ranking.

## Reproduce and verify

```
node tools/upgrade-sf50-textures.mjs
node test/sf50-quality-test.mjs
node test/sf50-visual-test.mjs
node test/sf50-wiring-test.mjs
npm test
npm run build
SMOKE_AIRCRAFT=sf50 npm run test:smoke
```

`notes/MODEL-QUALITY-MANIFEST.json` records exact asset hashes and metadata. The quality test proves buffer preservation and native-image equality. The SF50 visual test now decodes the actual selected upgraded asset, checking the existing surfaces, wheels, gear sequence, cockpit, doors, displays and crash behavior rather than merely testing the legacy filename. Browser smoke now accepts `SMOKE_AIRCRAFT` (default remains c172).

## Local verification result

- Full suite: **116/116 scripts passed**, including the new quality guard and the selected upgraded SF50's complete visual/wiring tests.
- Production build passed (Vite 7.3.7).
- Standalone before/after exterior and cockpit renders completed with no page/console errors. The complete rejected handoff exterior visibly has an unfinished open-sided nacelle, reinforcing the metadata reason not to adopt it. Matching before/after rendered draw calls/triangles confirm no scene simplification; renderer triangle totals include shadows and are not the asset's unique 403,431-triangle count.
- Actual built-game SF50 smoke passed in Chrome WebGL2/ANGLE SwiftShader: selected SF50, flight started, no pending spawn, pilot cockpit reached, all seven panels opened/activated, no page/console/request/shader errors, no missing local assets. Synthetic terrain/imagery; not a flown real-world sortie or a hardware benchmark.
- A separate 1440×960, high-preset/native-render-scale gameplay run also passed with live 2560×1600 PFD/MFD canvases redrawing. Reduced-motion preference disables the unrelated decorative hero movie; an initial native run caught its expected flight-entry request abort and is retained in `gameplay-native-decorative-abort.json`, not counted as a clean pass. Native pilot evidence: `gameplay-native/smoke-positive.{json,png}` and `gameplay-native.log`.
- Evidence in `.scratch/model-refresh/`: `full-tests.log`, `build.log`, `model-browser-report.json`, `before-{cockpit,exterior}.png`, `after-{cockpit,exterior}.png`, `rejected-handoff-{cockpit,exterior}.png`, `gameplay/smoke-positive.json`, `gameplay/smoke-positive.png`. The first smoke attempt correctly caught the harness using the trainer/Blackbird-only quick-start button for SF50; the harness now uses Start flight for other selected aircraft and asserts the selection, and the rerun passed. No simulation bug was hidden or changed.

## Limits and tradeoffs

Full-resolution textures increase GPU memory consumption, and native-resolution live displays increase canvas upload/rasterization cost. This deliberately reverses the P1 texture-memory compromise to honour the owner's no-quality-loss request; it is **not** a performance optimization. Rendering checks use Chrome/ANGLE SwiftShader, not a real GPU. Historical cockpit stutter on mid-range GPUs is not disproven by passing software-rendered smoke tests; real-device frame-time verification remains necessary. No geometry problem listed in HANDOFF is claimed fixed. Do not describe this as a new airframe, an externally imported model, a highest-quality global winner, or proof of real-GPU performance.
