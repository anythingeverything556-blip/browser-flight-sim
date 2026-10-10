# SR-71 Blackbird Flight Simulator

A browser flight simulator in the style of GeoFS, built around the SR-71A model from Blender.
Everything is at 1:1 scale in metres: the aircraft is exported straight from Blender
(32.77 m long including the nose probe, 16.83 m span, 5.64 m tall), and the world uses
real satellite imagery, real terrain elevation and real runway coordinates from OpenStreetMap.

## Run it

Requires [Node.js](https://nodejs.org) 20.19 or newer (Vite 7).

```bash
npm install
npm run dev      # opens on http://localhost:5173
```

On Windows you can double-click `start.bat` instead.
For a static build: `npm run build`, then serve the `dist/` folder with any web server
(it must be served over http, not opened as a file).

## Features

- **Real world:** Esri World Imagery (up to zoom 20 where available) draped over AWS terrain tiles in a
  crack-free, balanced quadtree with cleaned elevation data (no spikes, sea held at sea level), sun-lit
  relief shading, Earth curvature, haze, and a sky that darkens towards space at altitude. Tiles are
  fetched and decoded in a Web Worker, nearest and coarsest first. Network slots are refilled the moment a request
  finishes (not once per frame), build and upload budgets follow the frame time, the level of detail scales with the
  render resolution and loads ahead of a fast aircraft, and a spawn waits for the imagery around it to sharpen.
- **Trees:** placed from OpenStreetMap land cover plus the photo itself, where the photo must show textured canopy
  (smooth dark green is crops, lawn or water, so fields stay clear); known treeless cover (farmland, meadow, sand,
  rock, ice, open marsh) gets none; each tile's trees dissolve in.
- **Weather:** Clear, Fair, Scattered, Overcast, Rain, Storm, Fog and Gusty presets set cloud cover, wind,
  turbulence and visibility, and add rain streaks that sweep past at flight speed, a grey gloom, a fog veil,
  lightning and delayed thunder.
- **Sound:** all synthesised (no samples): per-engine rumble, roar, hiss and compressor whine with the slow wobble of
  real jet noise, a rolling afterburner growl, wind, tyre rumble over runway joints, a hydraulic pump with door and
  lock clunks, rain, thunder, and modal crash sounds (struck metal, tearing, a sub-bass explosion that arrives late).
- **Crashes:** fireball with flash and shock ring, boiling soot, burning fuel along the slide, a tall smoke column,
  plate-shaped debris, a flickering fire light; slow motion for the first moments and a camera that backs off to frame it.
- **3D buildings:** Overture Maps buildings worldwide (keyless PMTiles: OpenStreetMap merged with Google and Microsoft
  AI-detected footprints — e.g. ~7,400 buildings in one 2.4 km map tile in Johor where OSM alone has 13), with real heights, floors,
  building parts, roof shapes (gabled, hipped, pyramidal, skillion, dome), facade/roof colours and materials; plausible heights
  and pitched roofs are inferred where the data has none. Roofs textured with the real satellite photo, procedural PBR facades
  with windows that light up at night; sat on the terrain and kept off runways. Falls back to OpenFreeMap (OSM) if offline.
- **3D trees:** instanced trees where OpenStreetMap land cover says woods/parks and where the satellite photo shows
  canopy, coloured from the photo, species by climate (palms in the tropics, conifers up north), swaying in the wind.
- **Water and sky:** OpenStreetMap water polygons rendered as physically based water (Fresnel sky reflection, waves,
  sun glint); single-scattering Rayleigh/Mie/ozone sky with matching aerial perspective; lit volumetric-looking cumulus.
- **8,200+ airports and 10,600+ runways worldwide**, 700+ of them military (incl. KXTA Homey/Area 51,
  Tonopah, Groom Lake lakebed runways, Fallon, China Lake, Nellis, Edwards, Beale, Kadena, Mildenhall).
  Runways come from OurAirports (public domain); where it has no coordinates the geometry comes from
  OpenStreetMap (ODbL, `tools_osm_runways.json`). Real coordinates, lengths, widths and end elevations. Airports near you get levelled runways, edge/centreline/threshold/
  touchdown-zone and approach lights, and working **PAPI** lights that show red/white by your angle.
- **Home base:** pick any airport as home base (saved in the browser); the start screen and the
  Return button take you there. Default: Beale AFB, runway 33.
- **Flight setup screen:** search any airport, choose the runway end, start on the runway, on a
  10 NM final or in Mach 3.2 cruise, set the time of day and weather.
- **Map & route:** dark navigation map, satellite, topographic, streets and FAA VFR sectional / IFR
  low / IFR high charts (US). All airports and runways, click to add waypoints, direct-to,
  teleport, drag waypoints, range rings, predicted track, distance and ETE.
- **Autopilot:** HDG, NAV (follows the route with turn anticipation sized for a Mach 3 turn radius),
  APPR (captures localizer and glideslope of the arrival runway, disconnects at 150 ft — no autoland,
  like the real jet), ALT, V/S, SPD and MACH.
- **Flight model (6-DOF, 240 Hz):** forces and moments from aerodynamic coefficients — lift with chine
  vortex lift and stall, friction/wave/induced drag vs Mach, ground effect, side force; pitch stiffness
  from the CG–aerodynamic-centre margin (AC moves aft supersonically, automatic fuel-transfer CG schedule;
  mass, CG and inertia follow fuel burn); damping derivatives (Clp, Cmq, Cnr…); pitch/roll/yaw SAS that
  moves the control surfaces like the real dampers; rate-limited elevons and all-moving fins; pitch ratio
  changer (stick gearing); over-g damage. Two J58s with thrust/TSFC vs Mach and altitude, spool lag,
  afterburner light-off; inlet unstarts from AoA/sideslip/spike-schedule margins with automatic restart.
  Inverse-square gravity with centrifugal relief and Coriolis; Dryden (MIL-F-8785C) turbulence and
  log-law wind shear; friction-circle tyre model with anti-skid brakes, rolling resistance, castoring
  nose wheel at speed; gear struts at the real wheel positions, drag chute and fuel burn.
- **Engine effects:** nozzle glow, afterburner plume with shock diamonds visible from every angle,
  green TEB flash at light-off, smoke puff on unstart; inlet spikes slide 26 in aft from Mach 1.6.
- **Animations:** elevons, all-moving fins, gear folding into the wells with doors, drag chute,
  beacon and nav lights.
- **Cockpit:** closed canopy with the real frame layout, grey lining, and a live SR-71A front panel:
  ADI with flight director and glideslope, HSI with bearing/DME to the active waypoint and the
  localizer, KEAS/Mach, triple display, altimeter, VSI, g, AoA, clock, fuel, gear lights, both
  engines' RPM, EGT, nozzle and fuel flow, spike and bypass positions, CIT and warning lights.
- **Cameras:** cockpit (mouse look, buffet shake), chase, free orbit, tower, wing and fly-by.
- **Environment:** time of day, stars, clouds, wind, turbulence and visibility.
- **Crash physics:** a hard impact breaks the airframe up (wings and fuselage become separate tumbling, sliding rigid
  bodies) with a fuel fireball, burning wreckage and a smoke column; a gear-up or collapsed-gear arrival slides to a stop
  in one piece; an in-flight overstress breaks it up in the air. The crash report appears once the wreck has come to rest.
- **Imagery:** Esri World Imagery plus sharper official orthophotos where they exist (France, Bavaria,
  Rhineland-Palatinate, Flanders, Czechia, South Tyrol, NSW), colour-matched to Esri. Tiles load nearest first and are
  then sharpened to double resolution (512 px) when the connection is free. Graphics presets Low / Normal / High / Ultra,
  adaptive resolution and optional camera shake in Settings.
- **Sound:** synthesised J58 roar and whine per engine, afterburner rumble and crackle, light-off,
  unstart bang, wind, tyre rumble, gear motor, warning tones, doppler, Mach-cone silence and boom.

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| ↑ / ↓ | Pitch down / up | PgUp / PgDn, + / − | Throttle (top 25 % = afterburner) |
| ← / → | Roll | 0 / 9 | Idle / full afterburner |
| Z / X (or , / .) | Rudder and nose-wheel steering | G | Landing gear |
| Home / End | Pitch trim | B or Space | Wheel brakes |
| Shift+B | Parking brake | C | Drag chute |
| A | Autopilot | V / Shift+V | Next / previous camera |
| M | Map | P | Pause |
| R | Reset | Y | Slew mode |
| H / I | HUD overlay / instrument strip | O | Sound |

**Typical takeoff:** press 9 for full afterburner, pull back gently (↓) at about 210 kt,
raise the gear (G) once you're climbing, then use the Autopilot panel to set Mach 3.2 and 80,000 ft.
**Landing:** approach at about 175 kt, touch down below 160 kt, deploy the chute (C) and brake.

## Tests

```bash
npm test
node test/dem-test.mjs   # corrupt elevation rows/columns are repaired; clean terrain and real ridges are left alone
node test/fdm-test.mjs   # take-off roll, rotation, climb, zero timestep: finite state, no crash
```

The original archive referred to further flight-model test scripts (`test/trim-test.mjs`, `test/handling-test.mjs`, ...) and a
`tools_build_airports.py` airport-database builder; they were not part of the archive and have not been recreated.

## Diagnostics

Press **F3** for the performance overlay: frame-time percentiles, CPU time per phase of a frame (sim, terrain, scenery, shadows, render,
HUD), GPU time of the scene render when the browser exposes timer queries, draw calls and triangles, terrain/building loading, and a log
of recent hitches (frames over 40 ms) with the phase that took the time. A long CPU phase is main-thread work; time that no phase
explains is the GPU or the driver.

`window.__sim` exposes the simulator objects (flight model, terrain, camera rig, `spawn()`, `advance()`, ...) for scripted tests.

## Source notes

The archive this project started from was missing about twenty modules from `src/` (geo, nav, hud, camera, controls, the terrain
shader and DEM code, buildings, trees, sky, clouds, post-processing, ...). They were reconstructed from the production bundle and its
worker chunks, and the rebuilt bundle was checked statement by statement against the original. Identifiers inside those reconstructed
modules are still the minified ones; files rewritten since (for example `clouds.js`, `perf.js`) are ordinary readable source.

Elevation: some AWS Terrarium tiles (mountain terrain outside the US and Europe) contain corrupt rows or columns that used to mesh into
long trenches and walls. `terrain-dem.js` detects and repairs them (`repairLines`; `demStats.lines` counts repairs). Resampling can split
one bad source line over two or three adjacent lines, so bands of up to three lines are rebuilt as the straight bridge between the
smooth lines on either side; on 1,032 real mountain tiles this removed every residual line artifact without touching real ridges.

## Files

- `public/models/SR71_sim.glb` — the Blender SR-71 (Draco compressed), including cockpit interior,
  landing gear and closed gear-door covers.
- `src/flight.js` flight dynamics (with `atmosphere.js`, `handling.js`, `turbulence.js`) · `src/terrain.js` real-world scenery (`terrain-worker.js`, `terrain-dem.js`) · `src/buildings.js` 3D buildings (`buildings-worker.js`, `facades.js`) · `src/trees.js` vegetation (`trees-worker.js`) · `src/atmos.js` atmosphere, `src/terrain-shader.js` ground/water shading
  · `src/airportdb.js` airports, runways and lighting · `src/nav.js` route and ILS guidance
  · `src/sky.js` sky and time of day · `src/clouds.js` · `src/aircraft.js` model, afterburner, chute and lights
  · `src/panel.js` cockpit instruments · `src/camera.js`, `src/controls.js`, `src/hud.js`, `src/autopilot.js`,
  `src/map.js`, `src/audio.js`, `src/geo.js`, `src/main.js` · `src/boot.js` checks for WebGL 2 and starts the app.

Scenery © Esri, Maxar, Earthstar Geographics · Terrain © Mapzen / AWS Terrain Tiles · Airports © OurAirports (public domain) · Runway geometry © OpenStreetMap contributors (ODbL) · Buildings © Overture Maps Foundation (ODbL; includes OpenStreetMap, Google Open Buildings CC BY 4.0, Microsoft Building Footprints ODbL), fallback OpenMapTiles via OpenFreeMap · Charts © FAA.

## License

Personal-use only, source-available. No profit, no publishing, no credit-taking, revocable at any time.
See `LICENSE` and `NOTICE.md`. This is not an open-source licence.
