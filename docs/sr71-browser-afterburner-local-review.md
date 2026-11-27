# Private local SR-71 browser afterburner fix

**Status: implemented and locally verified; not deployed.** This is a new owned
Three.js procedural approximation. It is not a port or parity claim for the
compiled MSFS effect graph. No proprietary textures/audio/effect data were added,
and no downloaded native package code was executed.

## Exact change scope

- `src/sr71visual.js`: five integration lines: import, construction, default
  exterior-anchor discovery/bind, and per-frame update.
- `src/sr71-afterburner-fx.js` (new): two independent J58 plume groups, two
  additive depth-tested meshes each, warm cores and fading violet shock bands.
- `test/sr71-afterburner-fx-test.mjs` (new): focused Node regressions plus optional
  isolated headless WebGL/real-model comparisons.
- This new private review note. No other existing files were edited by this task.

The included `FX_afterburner_left` / `FX_afterburner_right` node transforms are
used directly, including the existing airframe datum offset. Plumes extend down
local -Z (aft in the authored marker frame), not guessed global coordinates.
The marker begins inside the shroud; ordinary scene depth hides the internal
section. No native source effect definition is consumed.

`abLit` must be true, actual `ab` must exceed .01, and actual positive per-engine
thrust must establish combustion in the current solver. Explicit false
combustion/producing/lit flags and engine/global shutdown take precedence. A
positive explicit combustion flag is supported when a future solver has no
numeric thrust field. Residual spool/ab and throttle never establish ignition.
Crash, unstart and fuel cutoff go dark; relight waits for actual ignition.
There is no flight-model, force, fuel, throttle, event or audio mutation.

Each plume mesh exclusively uses existing `FX_LAYER` 7 with depth testing and no
depth writes. Existing low-quality direct rendering and cloud-aware compositing
already consume that layer; this task did not change the post pipeline. FX live
under the aircraft root, outside swappable exterior/cockpit parts. Source
flight/high-detail anchors agree. Downward plumes are clipped at the supplied
ground plane, with camera-relative rebasing preserved. Animation freezes for
nonpositive/invalid dt.

## Reproduce

From the owner-copy root:

```sh
node test/sr71-afterburner-fx-test.mjs
node test/sr71-afterburner-fx-test.mjs --browser
node test/sr71-bindings-test.mjs
node test/sr71-cockpit-test.mjs
```

Browser mode starts and then closes its own loopback-only Vite server and
headless Chromium SwiftShader instance. It does not touch the shared visible
browser. It aborts non-loopback requests; none were attempted in this run.
`CHROME_PATH` and `SR71_FX_PROOF_DIR` optionally override the browser executable
and private output directory. The existing integration HTML is reused unchanged.

## Observed results

- Six focused Node checks passed, including real `FlightModel.step` fuel cutoff
  with nonzero residual spool and `ab`, followed by ignition-delayed relight.
- Ten existing SR-71 binding checks and twelve cockpit functional checks passed.
- Real included exterior rendered with both plumes: 18,713 changed canvas pixels
  versus the same camera/aircraft with the effect disabled.
- Left-only: 8,645 changed pixels; right-only: 10,068 changed pixels.
- Shutdown despite residual ab: zero changed pixels versus effect-disabled.
- FX layer disabled: zero changed pixels versus effect-disabled.
- Cockpit-view flag and high/flight-detail switching retained independent plume
  visibility and exactly two engine groups, without duplicate effects.
- No page/shader exceptions and no external requests.

Private PNGs and machine-readable results are in
`/home/captures/sr71-afterburner-local/` and a readable duplicate outside the
repository, `../../sr71-afterburner-local-proof/`:

- `before-effect-disabled.png`
- `after-both-lit.png`
- `left-only.png`
- `after-side-quarter.png`
- `results.json`

All four PNGs were visually inspected. They show correctly aligned nozzle/aft
plumes and one-engine separation. They are isolated headless local captures with
**injected engine states**, not a full-game flight recording, an MSFS comparison,
or proof of native visual parity. Cloud compositing itself and actual player
keyboard input were not exercised by the fixture. No public/Library publication,
credentials, deployment, shared test manifest, audio/gauge worker or main entry
point changes were made.
