# Handoff — what is left

State on 2 November 2026. This release contains the fixes listed under the top
`Unreleased` entry of `CHANGELOG.md`. The items below are **not** finished.
Work in this order.

## 1. Vision Jet model: performance and accuracy (not shipped)

`public/models/SF50.glb` is unchanged in this release. It is the main open problem.

**Why it matters.** The owner's real-GPU check (see CHANGELOG) measured heavy
stutter in the cockpit view only: 132 of 395 frames over 50 ms on an RTX 3050,
160 on the Radeon iGPU; outside views held 72 fps. The model is the likely cause
(not yet proven):

| Measure | Current |
|---|---|
| Triangles | 403,431 (Interior node about 205k) |
| Meshes / materials / draw calls | 143 / 75 / about 143 |
| Textures | 13 WebP: livery base + ORM 4096², V-tail base + ORM 2048², MFD/PFD 2560×1600, GTC1–3 1600×1000, small carbon/key maps |
| GPU texture memory | about 200 MB estimated with mipmaps |

Work in progress, in `handoff/sf50-model-wip/` (unverified, not wired in):

- `sf50-optimize.mjs` — gltf-transform pipeline: downsizes textures, simplifies
  meshes, re-encodes Draco + WebP. Its output `SF50_optimized_opt4.glb` is about
  1.0 MB. Its triangle count, visuals and animated parts were **not** checked.
- `sf50-fix-exterior.mjs` — rebuilds the V-tail, engine nacelle and nose cone and
  merges them back. Output `SF50_exterior_fix1.glb`. Not reviewed visually.
- `sf50-inspect.mjs`, `sf50-shots.sh` — stats and screenshot helpers.
- `before-info.txt` — baseline inspection of the shipped model.
- Model frame: glTF +Z forward (nose), +Y up, +X = left wing, wheels at y = 0.
  The game maps `(x, y, z) = (gl.z, gl.y, -gl.x)`.

What to do:

1. Measure first: `tools/viewer/sf50-viewer.html` exposes `__view.stats()`;
   record draw calls, triangles and texture bytes in the cockpit view.
2. Textures: the MFD/PFD/GTC images in the GLB are only shown until the live
   canvases in `src/sf50displays.js` draw — confirm, then shrink them to a tiny
   placeholder. Livery and V-tail ORM maps compress to 25–40 KB, so they are
   nearly flat: 512–1024 px is enough. Livery base colour 2048 px.
3. Geometry: decimate the heaviest Interior meshes that are small on screen;
   target ≤ 200k triangles total. Merge static meshes that share a material.
4. Never rename, re-parent or move the pivot of the animated nodes listed in
   `src/sf50visual.js` (Ctrl_*, Display_*, Door_*, Engine_Fan, Gear_*,
   GearDoor_*, Wheel_*, Light_*, Stick_*, Throttle_Lever) and keep their
   `extras` (hinge_axis, max_deg). Keep the bounding box 11.80 × 3.32 × 9.36 m.
5. Visual fixes, compared against official photos (research archive, see 4):
   - V-tail surfaces too tall and nearly upright; real ones are lower-aspect,
     more splayed, with swept leading edges.
   - Engine pod looks like a separate capsule on a pylon; the real nacelle is
     faired into the aft fuselage with a deep circular inlet.
   - Nose cone more bulbous than the G3.
   - Glazing nearly opaque from outside; real windows are dark-tinted.
   - Cockpit displays smaller and lower than the real two large side-by-side
     displays; plain white seats.
   - Gear and wheels look chrome; tyres should be rubber, struts painted metal.
6. Verify: `node test/sf50-visual-test.mjs`, `node test/sf50-wiring-test.mjs`,
   full `npm test`, then a real-GPU cockpit frame-time check like the one in the
   CHANGELOG.

## 2. Interface redesign: finish verification

The restyle of `index.html` and `src/style.css` (unslop method) is shipped. Only
the start-up screens were checked after the change: intro, flight setup (top,
scrolled, bottom, Vision Jet picked), terms and the loading screen.

Still to check visually against the "before" shots, and fix if broken:

- In flight: rail and tooltips, status chips, flight-data strip, throttle lever,
  warning and normal toasts.
- Every sheet: flight, map, airports, autopilot, views, weather, settings
  (including voice warnings and keyboard controls), help.
- First-flight guide, coach and mission cards, crash report.
- 1280 × 720 and a 390 px mobile viewport.

The design direction and the full audit (which sign, where) are in
`handoff/unslop-audit.md`. Keep to it: flat night-blue panels and hairlines,
sentence case, one cyan accent, glass-cockpit colour meanings (green engaged,
amber caution, red warning), one easing `cubic-bezier(0.22, 1, 0.36, 1)`.
Do not touch the 3D scene, the HUD canvas or the panel/display canvases.

## 3. Autoland and Safe Return: smaller follow-ups

Shipped and tested in Node; never flown in the browser. Check the new toasts
in-app. Known limits:

- The Safe Return fuel estimate is an assumption (170 kt, 230 kg/h, 30 min
  reserve, 24 NM extra), not AFM data. Replace with AFM fuel-flow tables if
  available.
- Terrain along the approach counts as clear where tiles are not loaded yet
  (`terrain.heightAt` returns null).
- The hold after the last abandoned approach is a 30°-ahead heading chase, not a
  published holding pattern.

## 4. Vision Jet research archive

Reference photos, certification data and notes for the model work:
https://gofile.io/d/0dC27238 (`VisionJet-SF50-research-collages.zip`; Gofile's
free tier deletes files after about 10 days without downloads). Two corrections
to that archive's prompt and notes:

- `media/cirrus-site/jet-side.png` is a front-left three-quarter render, not a
  side elevation.
- `media/cirrus-site/2026-vision-jet-lifestyle-20*.jpg` is taken from above and
  behind the tail, not head-on. It is the best V-tail and exhaust reference.
- The G3 has one upward-opening main cabin door (left), an emergency exit
  (right) and a baggage door — not two gull-wing doors.

## Build, test, deploy

```
npm ci
npm test            # full suite, about 2–3 minutes
npm run build
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run deploy   # Pages project sr71-blackbird
```
