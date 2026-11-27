# SR-71 exterior lights — private local browser pass

## What was missing

The converted source contains the fixtures but `SR71Visual` never connected them to browser lights. `src/aircraft.js` is the legacy procedural aircraft, not this converted SR-71. Runway/airport approach-light infrastructure is a separate system; this change is the aircraft's landing/taxi and exterior lamps, not new airport runway lights.

Source reference: local original `common/config/systems.cfg`, `[LIGHTS]`, lightdef.0–9. No native code or downloaded package code was executed, and no proprietary light textures/media were copied.

## Controls and placement

Open **Controls / ? → SR-71 exterior lights** for actual toggle buttons. The actions also appear in **Settings → Keyboard controls**, with these defaults:

- **Shift+7**: landing, original `LANDING_LIGHT_HELPER` / `LANDING_LIGHT_BULB` on the nose-gear strut.
- **Shift+8**: taxi, original `TAXI_LIGHT_HELPER` / `TAXI_LIGHT_BULB` on that strut.
- **Shift+9**: white tail/position, `TAIL_LT_T_HELPER` and `TAIL_LT_B_HELPER`.
- **Shift+5**: red anticollision, both forward-facing/rear-facing helpers above and below the forward fuselage.
- **Shift+6**: white anticollision strobes above and below the forward fuselage.

Buttons indicate the commanded state; landing/taxi emit only at `gearPos >= .98`, independently. They go dark during gear travel/retraction, and all exterior output is disabled on a wreck. Nose lamps follow the original animated strut and contact registration; source wheel steering does not swivel these fixed strut fixtures. No invented wingtip red/green fixtures were added.

New flights reset to landing, tail and red beacon ON; taxi and white strobe OFF. Keyboard actions obey existing flight-input/pause handling. Help buttons work as normal UI controls. Rebinding does not change the explicitly labelled default-key hints.

## Implementation and rendering

- New `src/sr71-exterior-lights.js` controller consumes already-completed `visual.update()` poses from `visual.parts`. Does not change the visual class, cockpit, afterburner, flight physics or audio.
- Two scene-owned, unshadowed spotlights are allocated once, outside the attached/detached detail trees. Toggle intensity only; light visibility/count/layers stay fixed. No point lights are added for beacons.
- Individual lamp-only cloned materials get emission; shared source materials remain unmodified. Small original-position coronas use an owned procedural radial DataTexture, depth tested, with no external image. Two source `_1` beacon bulb nodes have no mesh; their actual helper coronas work without inventing replacement airframe geometry.
- Animated helper local +Z gives beam direction. Measured fully-down landing direction in the aircraft frame is approximately `[.984808, -.173649, 0]` (10° down); taxi is `[1, .000002, 0]` (level). Its broad cone includes downward rays, rather than an invented downward tilt.
- Existing `TERRAIN_UNIFORMS.uF27Beam` / `uF27Aim` cone slots are reused only for selected SR-71. All three slots reset each update. No terrain shader modification, new shader branch, or F27 light-path change. Positions use the existing camera-relative frame. Terrain wash and lamp outputs clear together on retraction/off/crash.

## Approximation / limits

This is browser-native lighting, not MSFS effect/electrical-system parity. Brightness/range/cones and blink timing are chosen browser approximations, not calibrated native photometry. There are no volumetric shafts or lamp shadows. The unshadowed spotlights can illuminate other aircraft surfaces. Source tail/white navigation and red/white anticollision fixtures only are represented; refuel-bay, all native electrical buses and lamp failures are not connected. Engine shutdown alone is not an electrical-bus simulation and does not automatically turn navigation lights off.

Ground-wash verification uses the actual authored source poses, existing terrain uniform contract and a controlled flat MeshStandard ground plane rendered by the fixed spotlights. It does **not** establish live streamed-terrain/runway imagery brightness in a real night flight. No hardware frame-rate claim is made.

## Independently repeatable checks

From this project directory:

```sh
node test/sr71-exterior-lights-test.mjs
node test/sr71-exterior-lights-test.mjs --browser
node test/controls-test.mjs
node test/controls-input-test.mjs
```

The focused test is intentionally not added to shared `test/scripts.json`. Browser mode starts an ephemeral loopback-only Vite server without the normal upstream proxy config, isolates headless Chromium with software WebGL, and aborts external browser requests. It exercises real source geometry at both detail levels, independent commands, gear travel/crash-disable, camera/aircraft transforms, fixed source steering behavior, shader-program reuse, and actual game Help buttons/keyboard handlers.

Browser proof output defaults to `/home/captures/sr71-exterior-lights/`; set `SR71_LIGHT_PROOF_DIR` to change it. A retained local-only copy is in `local-proof/sr71-exterior-lights/`: same-camera `before-all-off.png`, `after-landing-on.png`, `after-taxi-on.png`, `tail-beacons-strobes.png`, actual-game controls screenshot and `results.json`. These are local review files, not published deliverables. No deployment, upload, credentials, external network access or publication was used.
