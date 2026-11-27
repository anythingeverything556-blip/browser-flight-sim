# SR-71 line-artifact investigation — local only

## Outcome

The broad report “random lines popping up on stuff” did not identify a reproducible defect in the included SR-71 model in this fixture. **No production rendering change was made.** In particular, no global depth, near/far plane, antialiasing, shadow, polygon-offset, or transparency defaults were changed. Source assets, physics, `main.js`, cockpit/gauge/audio workers and shared test manifest were not edited by this investigation.

## Independent reproduction

Added files:

- `test/sr71-line-artifacts.html`: imports the actual `SR71Visual`, actual included exterior/cabin/cockpit glTF files and textures. It does not start the game, load terrain imagery, request sound, or invoke the native addon. It uses a plain local ground plane, fixed lights/camera and zero simulation timestep.
- `tools/sr71/line-artifact-probe.mjs`: uses the already-installed Puppeteer and local Chrome, blocks all non-loopback application requests, saves labeled screenshots, records camera transforms/material settings, and asserts byte-identical repeated draws at each fixed camera.

Start the existing minimal Vite configuration on a free loopback port, from the repository root:

```sh
node node_modules/vite/bin/vite.js --config tools/sr71/cockpit-test.vite.config.mjs --port 5194
```

In another terminal:

```sh
node tools/sr71/line-artifact-probe.mjs http://127.0.0.1:5194 .scratch/sr71-lines log
node tools/sr71/line-artifact-probe.mjs http://127.0.0.1:5194 .scratch/sr71-lines reverse
SR71_LINE_VIEWS=canopy,cockpit,cockpit-left,cockpit-right SR71_LINE_RAIL=1 node tools/sr71/line-artifact-probe.mjs http://127.0.0.1:5194 .scratch/sr71-lines/micro-rail log
```

## Observed receipts

- Both logarithmic and **confirmed active** reversed depth rendered all ten views: exterior, port, top, canopy, nose gear, rear tires, rear, cockpit forward, cockpit left and cockpit right.
- Every view had **zero changed pixels over three additional identical draws**, with zero browser exceptions and zero attempted external application requests.
- Actual camera range: `near=0.05`, `far=12000000`, matching the game's scene-depth span, not the much shorter range of the older integration fixture.
- Exterior view rendered 276,506 triangles; forward cockpit rendered 792,102. The cockpit was actually loaded and attached, not substituted with procedural geometry.
- GPU: Chrome WebGL2 / ANGLE SwiftShader, not a hardware-driver or deployed-game claim.
- Moving-camera micro-rails are also recorded (nine poses, 0.5 mm spacing). High-frequency edge/label aliasing can produce short-lived changed pixels; this metric alone is explicitly **not** proof of the user's reported lines or of a coplanar defect. No patch was inferred from that count.
- `node test/terrain-fade-coverage-test.mjs`: PASS, 2,700 frames, 1,570 crossfading frames, zero uncovered samples. This checks synthetic offline tile coverage, **not** live terrain imagery or the user's unknown location.
- `node test/sr71-cockpit-integrity-test.mjs`: PASS, 8,637 byte-exact source-accessor comparisons, all 41 retained source clip definitions/samples, 517 unused clips excluded.
- `node --check tools/sr71/line-artifact-probe.mjs`: PASS.
- The older `test/sr71-optional-detail-test.mjs` cannot start here because it imports Playwright from an absent absolute path. No dependency was downloaded or test rewritten to conceal that limitation; the new probe uses the installed local Puppeteer.

Artifacts are local only, in `.scratch/sr71-lines/`: `log-results.json`, `reverse-results.json`, and the corresponding `<depth>-<view>.png`; fine-motion receipts are under `micro-rail/`. PNG headers label actual model, view, depth mode and unchanged baseline. They are diagnostic views, **not before/after fix proof**.

The screen-capture skill was read. The managed visible-browser task returned `browser_unavailable`; inspection confirmed only a blank task tab/new tab. Consequently no visible-desktop capture is claimed. The labeled headless WebGL captures above are retained instead; no unrelated desktop content was captured.

## Scoped code inspection

`src/sr71visual.js` hides zero-opacity normal-only decal meshes and the exact cockpit occluder helper; transparent materials use `depthWrite=false`. Authored decal `extras.decal` / `drawOrder` metadata is retained by GLTFLoader but not converted to explicit Three.js decal ordering/bias. That is a candidate to isolate, **not a demonstrated root cause**, so it was left alone. Glass and decals were not globally made opaque or forced in front of other geometry.

Terrain already has neighbour edge stitching and lowered boundary skirts in `src/terrain.js`; its renderer supports both log and reversed depth. Live terrain/imagery seams, world shadows, postprocessing, actual graphics preset and a hardware-specific driver issue remain outside this model-only reproduction. Changing the model adapter cannot defensibly fix an unlocated world/terrain symptom.

`src/sr71visual.js` remained byte-identical to its start-of-investigation backup:

```
4f4cf3fb37bd3fbc0ef8887d3603b0a44d40ddfc6b02280aad89e0c1d2af2ed2
```

## Single clarification that isolates the report

**Can you send a short clip of the lines with the camera view and location visible, so I can tell whether they are on the cockpit, aircraft skin, or ground?**

No external network, credentials, publication, deployment or native-package code execution was used.
