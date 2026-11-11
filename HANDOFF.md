# Handoff — what is left

> **⚠️ Two copies, two live sites.** The owner zip is the source of truth; the public GitHub repo is a hand-updated
> mirror that can lag behind. Every deploy must update **both** https://earthwing.pages.dev and
> https://sr71-blackbird.pages.dev (`npm run deploy` does both). Read `AGENTS.md` before changing anything.

State on 10 November 2026. This release contains the fixes listed under the top
`Unreleased` entry of `CHANGELOG.md`. The items below are **not** finished.
Work in this order.

## 000. Ilyushin Il-76MD-90A (added 10 November 2026)

A fourth aircraft, `?aircraft=il76`. See the top `Unreleased` entry of `CHANGELOG.md` for what it contains.

**Files.** `src/il76.js` (flight model; every constant has a confidence letter A-D), `src/il76visual.js` (data-driven: reads
`hinge_axis` / `max_deg` / `slide_axis` / `max_m` / `seq_start` / `seq_end` from the GLB, no hard-coded pivots),
`src/il76ctl.js`, `src/il76ap.js`, `src/il76feed.js`, `src/il76displays.js`, `public/models/IL76_v6.glb`, and the tests
`test/il76-{fdm,glb,visual,wiring}-test.mjs` plus `test/existing-aircraft-test.mjs`.

**Verified on 10 November 2026.** `npm test`: 86 scripts, 0 failures. `npm run build`: passes. Headless Chrome (software
rendering) on the production build: the aircraft loads with 108 movers and 4 engines, sits on its wheels, shows the
cockpit, flies, and retracts its gear over the full transit time.

**Second pass, 10 November 2026** (see the top CHANGELOG entry): new controls for all aircraft, corrected warnings, live screens
and 17 live dial needles, new model `IL76_v6.glb`. `npm test`: 87 scripts, 887 passes. Checked in headless Chrome: Shift does not
move the lever, E does, numpad rudder steps, engine select moves one engine, the autobrake pill, the screens showing flight data.
**Not checked in a browser:** an autobrake landing, the SR-71's per-engine levers, the needle positions against their scales.
**Not done:** the shading and shadow work the owner asked for (the airframe still casts no shadow on itself), a hold camera view,
needles on the engineer's and navigator's dials beyond the 17 listed.

**Not finished, in order.**
1. **Performance.** The model is now 369k triangles and 148 draw calls (simplified from the 611k Blender export with `gltf-transform`; it was 478k). The Vision Jet at 403k already stutters on a mid-range
   GPU (section 1), and the Il-76 has not been tried on a real GPU: the browser check ran on software rendering at 10-14 fps.
   The Blender master script has a `CURVE_Q` setting for a lighter build; it is untested below 1.0.
2. **Sound is synthesised.** No open-licence recording of a PS-90A-76 was found. `notes/FLIGHT-DATA.md` section 11 lists
   CC BY / CC BY-SA recordings of D-30KP-powered Il-76s (a different, louder engine); the code has no sample-loop loader.
3. **Estimated numbers.** Stall and V-speeds at 210 t, landing and zero-fuel mass, flap / slat / gear / hatch times, the
   aerodynamic coefficients and inertia are estimates (letter D). Medium and Easy mode factors are guesses by design.
4. **Autoland and Safe Return** are not fitted to the Il-76; the autopilot is.
5. **Model details still off against photos** (from the Blender session): vestibule nose-gear housing, hoist-rail colour,
   sparse navigator station, missing engineer circuit-breaker wall, ramp-bay ceiling. Nose-gear retraction geometry is
   marked provisional in the GLB.
6. **Existing bug found, not fixed:** `src/cloudshadow.js` line 10 has an inline `//` comment in front of
   `uniform float uSize, uCover, uBase, uTop, uGround, uEvo;`, so that shader fails to compile ("'uBase' : undeclared
   identifier") in every aircraft. It is in the GitHub copy too. Cloud shadows on the ground are therefore off.

**Blender source.** (kept on the owner's PC, not in this repository): `Il-76MD-90A_interior_v3.blend`,
`IL76_MASTER.py`, and the export `Il-76MD-90A_game_v6.glb` (611k triangles), simplified to `public/models/IL76_v6.glb` with the dial list added to its root extras. Models are cached for 7 days by `public/_headers`: a changed GLB under the same name is stale for
returning players, so rename it (and `model:` in `src/aircrafts.js`) when the model changes.

## 00. Sharper imagery (shipped 8 November 2026)

37 official city/state aerial sources, 9 deeper zoom caps, a source -> next source -> Esri fallback chain on errors and
blank tiles, and Esri Wayback releases at 11 airports (`public/data/wayback.json`, rerun with `tools/wayback-scan.py`).
In production as `abd4e712`. The first deploy, `01d07795`, went out with **no CSP** (the CSP line was 2,208 characters
and Cloudflare drops `_headers` lines over 2,000); fixed in `abd4e712` with bare hosts, and `imagery-sources-test` now
fails on any line over 2,000. Roll back to `b366fb73` (before this work).
Checked: every endpoint by curl with the site Origin; one max-zoom tile per source through the terrain worker in headless
Chrome; on the live site, 12 sources and a Wayback tile fetched under the enforced CSP with no violations.
Still to do, on a real GPU: fly low over a few new areas (Paris Orly, Vienna, Louisville, Bogota, Canberra, Johannesburg)
and look for colour seams against Esri (new sources have no colour curves) and the extra tile load at z21. Licences:
only sources rated OK in the licence review ship; the UNCLEAR/NO ones (Philadelphia, Maricopa, King County, Medellin,
Curitiba, Manaus, Tel Aviv, Georgia, Cyprus, Singapore, Hong Kong and others) are left out on purpose. A known console
error from the cloud shader (`uBase`) was seen in the browser log; no cloud file changed in this work, not investigated.

## 0. Flying modes (shipped 7 November 2026)

Easy / Medium / Realistic, on the start sheet and in Settings; see the top
`CHANGELOG.md` entry and `src/difficulty.js`. First deployed as `c4a850eb`
(commit `7604cbc`). The hands-off fix (with the option off, the Skyhawk and
Vision Jet stick was reset every frame) is in production as `b366fb73`
(commit `79e5ef8`); roll back to `c4a850eb`, or `d8a727aa` from before modes.
Tested in Node (`test/difficulty-test.mjs`) and the mode switching in a browser.
Still to do: on a real GPU, fly Easy and hold full back stick, full forward
stick and full roll in each aircraft; the protection should hold short of the
stall, about 30° nose up / 25° nose down and about 67° of bank.

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
npm test            # full suite (86 scripts), about 2–3 minutes
npm run build
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run deploy   # both Pages projects: earthwing and sr71-blackbird
```
