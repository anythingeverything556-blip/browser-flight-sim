# SR-71: what is left

## Local Earthwing implementation (not an MSFS match or a deployment)

- Browser afterburner plumes attach to the original engine markers and appear independently only when the corresponding simulated engine is actually lit. They use a tapered, procedurally turbulent emissive volume, not the native compiled graph. See `docs/sr71-browser-lighting-and-plume.md`.
- Cockpit light toggles retain a fixed light count and change intensity/emission; inactive lights do not shade cockpit materials. The player-facing **Controls / ? → SR-71 exterior lights** section toggles landing, taxi, white tail, red beacon and white strobe lights at their authored fixtures. These are separate from airport runway lights.
- The original vertical-speed needle now follows Earthwing vertical velocity, calibrated to the dial artwork up to ±6,000 ft/min. This does not recreate the native pressure, acceleration, electrical or failure response. The portable asset builder is `node tools/sr71/build-ivsi.mjs` (Node 22+ with zstd support).
- The original three-pointer altimeter follows Earthwing altitude above mean sea level in feet. It is not a pressure-altitude instrument in this build: the barometer ring and knob remain static. `node tools/sr71/build-altimeter.mjs` retains and calibrates the original three pointer tracks.
- The initial scene warm-up includes the shader variants used when entering the SR-71 cockpit. This avoids doing the same shader work on the first view switch; the cockpit still has more geometry to draw than the exterior view.
- The original gear/canopy/seal one-shots now stop on flight reset. Sound files and engine curves are unchanged. See `notes/SR71-AUDIO-EVENT-RESET.md`.

## Still open

1. **Exact visual afterburner and other MSFS-only effects.** The original plume is a compiled MSFS visual-effects graph. The Earthwing plume is separate from the exhaust-door/ejector animation and sound. Exact plume behavior, heat tracks, fuel puddle/leak helpers and other MSFS effects are unverified.
2. **Exact analog gauges and complete systems.** Analog airspeed, Mach and barometric-altimeter behavior, native vertical-speed response, the full native systems, crew, and live WALT behavior are not implemented. Existing drums, attitude, heading, lights and moving WALT/clipboard geometry are retained.
3. **Complete original audio.** Existing lossless source samples, separate cockpit/aft mixes and ignition-aware playback do not recreate the complete MSFS Wwise routing, effects or every event.
4. **Exact-native verification.** A controlled comparison against a licensed native MSFS 2024 reference or suitable reference recordings is still absent. `docs/sr71-native-parity-preflight.md` documents the offline evidence-input checks. The checker does not prove runtime parity or clear a release.

Do not infer public redistribution permission for converted third-party assets from this private handoff, an existing live site, or access to a hosting account. A production release is separate from this local implementation.
