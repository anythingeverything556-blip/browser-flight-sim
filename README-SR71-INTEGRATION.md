# Original SR-71 replacement (local prototype)

Run `npm run dev` and open `http://127.0.0.1:5173/?aircraft=sr71`.
The source ZIP's other aircraft and original SR-71 flight model are retained.
Neither legacy `SR71_sim.glb` nor `SR71_lod.glb` is in this game copy or used as a fallback.

## Controls

Existing preferences work through Settings → Keyboard controls, including conflict handling.
- E / Q: throttle. Shift+1 or Shift+2: select one engine; Shift+0: synchronize.
- G: gear (original wheel deployment clips and cockpit handle use separate signals).
- Shift+S: canopy seal. Unseal before Shift+N opens canopy, stopped on ground.
- Shift+W: original WALT open/stow; Shift+C: original clipboard use/stow.
- V: view. Cockpit is fetched only when first entering it.
- C: existing game drag-chute simulation; no invented original chute cloth/effect.
Original cockpit gear handle, seal, canopy handle, equipment and individual throttle
meshes also have pointer targets. Dragging a throttle changes only its own lever offset.
Equipment geometry is not a live tablet/map display. The original windshield
glazing remains visible; its nonvisual environment occluder is excluded from the game render.

The source package is the extracted original under
`/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71`.
See `../SOURCE-REFERENCE.md` for exact original XML paths and line references;
`../IMPLEMENTATION.md` records checks and limitations.
Original debranded conversion buffers and textures are staged unmodified under
`public/models/sr71/{exterior,cockpit}`. Zstd is decoded client side with vendored
MIT fzstd (`src/vendor/fzstd-LICENSE`).

## What is deliberately not implemented

This is a native-game adapter, not the MSFS/WASM runtime. Most analog gauges,
original electrical/fuel/simulator systems, crew idles, puddle/heat tracks,
compiled SPB afterburner flames, original Wwise routing and full engine audio
coverage are not ported. Exact original component samples are played with a
minimal approximate gain mix; missing components stay silent. A user gesture only
unlocks audio; dry engine audio is fetched when a running simulation first has
meaningful dry spool. A/B audio may decode during the solver’s ignition delay,
but does not start playback until the burner is actually lit and producing power.
Cockpit/gear one-shots fetch on their own events. Audio never blocks startup.
Gear strut compression uses actual solver contact compression, normalized by measured original tire travel. Original tire clips follow each solver wheel’s signed angular velocity and pause with the simulation.
Original full-detail geometry remains expensive; no new LOD was substituted.

## Checks

`npm run build`
`node test/sr71-bindings-test.mjs`
`node test/controls-test.mjs`
`node test/controls-input-test.mjs`
`node test/aircraft-engine-controls-test.mjs`
`node test/flight-reference-test.mjs`

With the local dev server running, the two browser proof scripts in `test/sr71-*proof.mjs`
and `test/sr71-game-smoke.mjs` use the existing machine's Playwright installation.
The supplied ZIP omits the generic test-runner/browser-smoke scripts named in
package.json, so those missing scripts were not represented as passing.
