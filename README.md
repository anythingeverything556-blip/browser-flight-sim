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

## Tutorial, landing school and missions

Pick one under **Mission** on the start sheet.

- **Tutorial**: you fly, it coaches. Eleven steps (camera, afterburner, take-off roll, rotate, gear up, climb, throttle, autopilot, altitude, heading, take control). Each step waits for you to do it and gives live hints, such as "too steep" or "right of the centre line". **Skip step** and **Hide coach** are on the card.
- **Landing 1**: starts on a 10 NM final. The autopilot flies the ILS down to 150 ft, then you flare and land. Landing 2 starts on a 5 NM final and you hand-fly the ILS. Both show live glideslope, centre line, speed and sink rate, coach the flare and rollout, and score the landing out of 100 (sink rate 40, touchdown speed 20, centre line 20, touchdown point 20), with tips on what to fix.
- **High & Fast**: climb above 70,000 ft and hold Mach 3.0 or more for 20 s.
- **Recon run**: fly over five orange beacons in order. Closer passes score up to 100 each. The targets are also loaded as autopilot waypoints, so NAV can fly the route.
- **Watch demo**: the jet flies a take-off, climb and autopilot sequence by itself, then hands over.

The default camera is free orbit: it starts behind the jet, drag to swing round, scroll to zoom. V cycles the other views.

## Features

- **Flying modes:** Easy, Medium and Realistic, on the start sheet and in Settings. Easy turns every assist on and adds stall, g, pitch and bank protection, forgiving landings, unlimited fuel and no inlet unstarts. Medium is the standard sim. Realistic turns the assists off and uses the real gear's touchdown limits: you trim, use the rudder and flare yourself, and fuel runs out. Picking a mode sets the assist options, which you can still change one by one.
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
- **Sound:** synthesised (the voice warnings are the only recorded clips): per-engine rumble, roar, hiss and compressor whine with the slow wobble of
  real jet noise, a rolling afterburner growl, wind, tyre rumble over runway joints, a hydraulic pump with door and
  lock clunks, rain, thunder, and modal crash sounds (struck metal, tearing, a sub-bass explosion that arrives late).
- **Voice warnings:** spoken "PULL UP", stall, over-G, overspeed, gear and low-fuel call-outs in a US fighter, US airliner
  or Russian fighter (Su-27 style) AI voice, chosen under Settings → Warning voice; Settings → Voice warnings turns them off.
- **Crashes:** fireball with flash and shock ring, boiling soot, burning fuel along the slide, a tall smoke column,
  plate-shaped debris, a flickering fire light; slow motion for the first moments and a camera that backs off to frame it.
- **3D buildings:** Overture Maps buildings worldwide (keyless PMTiles: OpenStreetMap merged with Google and Microsoft
  AI-detected footprints — e.g. ~7,400 buildings in one 2.4 km map tile in Johor where OSM alone has 13), with real heights, floors,
  building parts, roof shapes (gabled, hipped, pyramidal, skillion, dome), facade/roof colours and materials; plausible heights
  and pitched roofs are inferred where the data has none. Roofs textured with the real satellite photo, procedural PBR facades
  with windows that light up at night; sat on the terrain and kept off runways. Falls back to OpenFreeMap (OSM) if offline.
- **3D trees:** instanced trees where OpenStreetMap land cover says woods/parks and where the satellite photo shows
  canopy, coloured from the photo, species by climate (palms in the tropics, conifers up north), swaying in the wind.
- **Tree variants:** regional colour, crown shape and scale follow latitude, elevation, season and available OpenStreetMap species tags.
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
  teleport, drag waypoints, range rings, predicted track, distance and ETE. Live ADS-B: real aircraft wherever
  the map looks, anywhere in the world (up to 250 NM around the view), or the worldwide military and emergency-squawk lists;
  coloured by altitude, find by callsign/registration/type/squawk, details card with track history, follow, fly alongside.
  Scale bar and a cursor readout with distance and bearing from your aircraft.
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
- **Imagery:** Esri World Imagery plus sharper official orthophotos where they exist (51 national, state and city
  services in Europe, North America, Colombia, Uruguay and Australia, 5-25 cm, up to zoom 21; see *Imagery sources*), and
  Esri World Imagery Wayback releases at airports where an archived capture is finer than today's layer, colour-matched to Esri. Tiles load nearest first and are
  then sharpened to double resolution (512 px) when the connection is free. Graphics presets Low / Normal / High / Ultra,
  adaptive resolution and optional camera shake in Settings.
- **Sound:** synthesised J58 roar and whine per engine, afterburner rumble and crackle, light-off,
  unstart bang, wind, tyre rumble, gear motor, warning tones, doppler, Mach-cone silence and boom.

## Imagery sources

`src/imagery-sources.js` picks the first source whose area and zoom range contain a terrain tile; city sources come before
the state or national layer they sit in. A tile a source fails on (HTTP error, CORS), has no data for (404) or leaves blank
(transparent, white, black or one flat colour) is taken from the next source covering it, then from Esri. Elsewhere the
imagery is Esri World Imagery (© Esri, Maxar, Earthstar Geographics and the GIS User Community); at zoom 15-20, inside the
areas listed in `public/data/wayback.json`, an Esri World Imagery Wayback release is used instead (Esri World Imagery
Wayback, same credit). Tiles are 256 px; the finest zoom is reached by the 512 px upgrade of zoom-20 tiles (graphics
Normal and up).

| Source | Area | Zoom | Attribution |
|---|---|---|---|
| `lu` | Luxembourg | 13-21 | © Administration du cadastre et de la topographie (ACT), geoportail.lu |
| `thr` | Paris, Marseille, Le Havre | 13-21 | © IGN |
| `lyon23` | Lyon | 15-21 | Métropole de Lyon |
| `rennes21` | Rennes | 15-20 | Rennes Métropole |
| `ge24` | Geneva canton | 15-21 | Données SITG |
| `bs23` | Basel-Stadt | 15-20 | Quelle: Geodaten Kanton Basel-Stadt |
| `ign` | France | 13-19 | IGN France (Licence Ouverte) |
| `koeln` | Cologne | 15-21 | Stadt Köln |
| `rvr` | Ruhr | 15-21 | Regionalverband Ruhr |
| `nrw_dop` | North Rhine-Westphalia | 13-21 | © Geobasis NRW |
| `berlin` | Berlin | 13-20 | Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin / TrueDOP 2024 |
| `hh` | Hamburg | 13-20 | Freie und Hansestadt Hamburg, LGV |
| `sh` | Schleswig-Holstein | 13-20 | © GeoBasis-DE/LVermGeo SH/CC BY 4.0 |
| `bw` | Baden-Württemberg | 13-20 | LGL-BW (2026) Datenlizenz Deutschland – Namensnennung – Version 2.0, www.lgl-bw.de |
| `hessen` | Hesse | 13-20 | Geobasisdaten © HVBG |
| `sl` | Saarland | 13-20 | © LVGL Saarland, dl-de/by-2-0 |
| `wien_lb` | Vienna | 13-21 | Datenquelle: Stadt Wien – data.wien.gv.at |
| `vogis10` | Vorarlberg | 13-21 | Datenquelle: Land Vorarlberg – data.vorarlberg.gv.at |
| `by` | Bavaria | 13-20 | Bayerische Vermessungsverwaltung (CC BY 4.0) |
| `rlp` | Rhineland-Palatinate | 13-20 | GeoBasis-DE / LVermGeoRP (dl-de/by-2.0) |
| `be_bxl` | Brussels | 13-21 | UrbIS © CIRB |
| `vl_omw` | Flanders | 13-20 | © Digitaal Vlaanderen |
| `be_wal` | Wallonia | 13-20 | Source : Service public de Wallonie (SPW) |
| `cz` | Czechia | 13-20 | ČÚZK Czechia (CC BY 4.0) |
| `bz` | South Tyrol | 13-20 | Provincia autonoma di Bolzano |
| `act3857` | Australian Capital Territory | 13-21 | CCBY – Australian Capital Territory and Aerometrex |
| `nsw` | New South Wales | 13-21 | NSW Spatial Services (CC BY 4.0) |
| `ch` | Switzerland | 13-20 | swisstopo (SWISSIMAGE, open government data) |
| `nl` | Netherlands | 13-21 | PDOK Netherlands (CC BY 4.0) |
| `at` | Austria | 13-19 | basemap.at Austria (CC BY 4.0) |
| `jp` | Japan | 13-18 | Geospatial Information Authority of Japan |
| `madrid_ayto` | Madrid city | 15-20 | Origen de los datos: Ayuntamiento de Madrid |
| `icgc_orto` | Catalonia | 13-20 | Institut Cartogràfic i Geològic de Catalunya (ICGC) |
| `es` | Spain | 13-20 | PNOA cedido por © Instituto Geográfico Nacional |
| `pt_2025` | mainland Portugal | 13-20 | Direção-Geral do Território |
| `plwHighResolution` | Poland (z20-21) | 20-21 | Źródło: GUGiK (geoportal.gov.pl) |
| `pl` | Poland | 13-19 | Źródło: GUGiK (geoportal.gov.pl) |
| `ee` | Estonia | 13-18 | Maa- ja Ruumiamet |
| `gbg21` | Gothenburg | 15-20 | Göteborgs Stad |
| `bologna26` | Bologna | 15-21 | Comune di Bologna |
| `ky3` | Kentucky | 13-20 | KyFromAbove |
| `ky2` | Kentucky (Phase 3 gaps) | 13-20 | KyFromAbove |
| `dc25` | Washington DC | 13-21 | Government of the District of Columbia, OCTO |
| `pa2123` | Pennsylvania | 13-20 | PEMA, via PASDA |
| `ct23` | Connecticut | 13-20 | CT ECO |
| `bog25` | Bogotá | 14-21 | SDP / SIGLA S.A.S. / IDECA – UAECD |
| `ont2327` | southern Ontario (not Toronto, Ottawa) | 13-20 | © King's Printer for Ontario, 2024 |
| `qcwmts` | southern Québec | 13-21 | © Gouvernement du Québec – MRNF |
| `uyurb` | Uruguay towns | 15-21 | IDEuy – AGESIC, Licencia de Datos Abiertos – Uruguay |
| `tas_AerialPhoto2024` | Tasmania (2024 captures) | 15-20 | CC BY 3.0 AU © State of Tasmania |
| `qld21` | Queensland urban footprints | 17-20 | © State of Queensland (CC BY 4.0); © Planet Labs Netherlands B.V. reproduced under licence from Planet and Geoplex, all rights reserved |

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| ↑ / ↓ | Pitch down / up | E / Q, + / −, PgUp / PgDn, [ / ] | Throttle (top 25 % = afterburner) |
| ← / → or A / D | Roll (A / D steer the nose wheel on the ground) | 0 / 9 | Idle / full afterburner |
| Z / X (or , / .) | Rudder and nose-wheel steering | G | Landing gear |
| Home / End | Pitch trim | B or Space | Wheel brakes |
| Shift+B | Parking brake | C | Drag chute |
| K | Autopilot | V / Shift+V | Next / previous camera |
| M | Map | P | Pause |
| R | Reset | Y | Slew mode |
| H / I | HUD overlay / instrument strip | O | Sound |
| U | Recover: the autopilot unloads, levels the wings, adds power and levels off (stall, spin, unusual attitude) | F3 / Shift+F3 / F4 | Performance overlay / copy diagnostics / 1:1 pixel test |
| \\ | Tune the nearest ILS ahead (autopilot stays off) | L | Refuel (fuel truck on the ground; tanker in the air, SR-71) |
| \` | Time warp 1x / 2x / 4x / 8x / 16x (above 1,000 ft) | N | Cockpit moving map (heading-up / north-up, 5-320 NM) |

**Typical takeoff:** press 9 for full afterburner, pull back gently (↓) at about 210 kt,
raise the gear (G) once you're climbing, then use the Autopilot panel to set Mach 3.2 and 80,000 ft.
**Landing:** approach at about 175 kt, touch down below 160 kt, deploy the chute (C) and brake.
Press `\` on the way in to tune the runway's ILS without engaging the autopilot; the radio-altitude call-outs
("One hundred" ... "Ten", "Retard") count you down to the runway.

## What's new

- **Easier landings in every aircraft.** The gear now takes a firm arrival: the hard-landing limit is 7 m/s sink (about
  1,380 ft/min) on the Blackbird (was 5.5), 5.5 m/s on the Skyhawk (was 4) and 6 m/s on the Vision Jet (was 4.5).
  The touchdown jolt no longer counts as "airframe overstressed" (only flight loads do), and a tail, nozzle or wingtip
  touching while the wheels are on the runway scrapes (with a warning) instead of crashing.
- **Altitude call-outs** 100 to 10 ft and "Retard", generated by `tools/make-callouts.py`.
- **ILS without the autopilot** (`\` or Autopilot → Tune ILS ahead).
- **Refuelling** (`L`): fuel truck on the ground, tanker for the SR-71 below 30,000 ft and Mach 0.9.
- **Time warp** (`` ` ``) up to 16x, back to 1x near the ground.
- **Cockpit moving map** (`N`) and a fixed map sheet: runway lines readable, airport names no longer squashed,
  the live-traffic options fold away on small screens.
- **Teleport dialog:** altitude, heading, speed, climb angle, gear and an autopilot hold.
- **Skyhawk auto-trim**, and a drag chute opened above its limit visibly opens before it tears away.

See `CHANGELOG.md` for details.

## Tests

```bash
npm test
node test/dem-test.mjs   # corrupt elevation rows/columns are repaired; clean terrain and real ridges are left alone
node test/fdm-test.mjs   # take-off roll, rotation, climb, zero timestep: finite state, no crash
node test/autopilot-test.mjs  # closed loop on the real flight model: speed changes, stall / min-speed / overspeed protection, recovery
node test/workstats-test.mjs  # dirty-flag logic: HUD redraw rate, panel change gate
node test/landing-forgiveness-test.mjs  # firm touchdowns land in all three aircraft; a real slam still crashes
node test/difficulty-test.mjs  # flying modes: presets, touchdown limits per mode, Easy envelope protection in all three aircraft
```

The original archive referred to further flight-model test scripts (`test/trim-test.mjs`, `test/handling-test.mjs`, ...) and a
`tools_build_airports.py` airport-database builder; they were not part of the archive and have not been recreated.

## Diagnostics

Press **F3** for the performance overlay: frame-time percentiles, CPU time per phase of a frame (sim, terrain, scenery, shadows, render,
HUD), GPU time of the scene render when the browser exposes timer queries, draw calls and triangles, terrain/building loading, and a log
of recent hitches (frames over 40 ms) with the phase that took the time. A long CPU phase is main-thread work; time that no phase
explains is the GPU or the driver.

F3 also shows canvas and render-target sizes against the window and `devicePixelRatio`, and a *work per s (done/skipped)* line that counts how
often the HUD, the 2D rain canvas and the cockpit panel really redrew versus skipped because nothing changed. **Shift+F3** copies a
diagnostics report (GPU string, screen, the F3 numbers) to the clipboard for sending; nothing is uploaded. **F4** draws a 1-device-pixel
checkerboard: a clean fine grid means the page maps 1:1 to the screen, wide bands or moire mean the browser is scaling.

F3 also splits GPU time by pass (shadow maps, scene, AO, glass, clouds, composite, bloom, SMAA) where the browser exposes timer queries, and shows
done/skipped counts for each shadow cascade. **F5-F9** switch world shadows, AO, volumetric clouds, SMAA and bloom off one at a time: if a flicker or
a slowdown goes away when one is switched off, that is the pass to look at. The render-resolution slider defaults to 200 % (75-250 %).

**Cockpit frame cost.** The renderer uses a logarithmic depth buffer, so every material writes its own depth and the GPU cannot skip a hidden fragment
before running its shader. In the cockpit that meant the heavy exterior-skin shader ran for the inside of the fuselage, and the terrain and sky shaders for
the ground and sky behind the instrument panel, glare shield and consoles. Each cockpit frame now first draws the opaque cockpit parts into a full-size
depth mask (`src/occlusion.js`) and the skin, the cockpit's lit materials, the terrain and the trees skip any fragment that lies behind it; a skipped
fragment would have lost the depth test anyway, so the picture is the same. F3 shows the mask size and draw count and a *cockpit mask* GPU pass, and
**F10** cycles through test views, one of which switches the mask off, so the difference can be read on a real GPU. `tools/cockpitcost.mjs` prints the
per-draw GPU time with the mask off and on and compares the two pictures pixel by pixel (software renderer: relative cost and correctness only).

`tools/` also holds the measurement scripts used on the software renderer (`flicker.mjs`, `overdraw.mjs`, `cpuprof.mjs`, `cockpitprof2.mjs`, `cockpitcost.mjs`, `shadowstats.mjs`,
`programs.mjs`, `cloudshadow-step.mjs`, `gearshots.mjs`); they need `puppeteer-core` and Chrome. A software GPU cannot tell real frame rate.

`tools/netaudit.mjs` logs the first minutes of network traffic (requests and bytes per host, duplicate URLs, cache hits); it needs
`puppeteer-core` and Chrome (`CHROME=/path/to/chrome`).

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
  · `src/panel.js` cockpit instruments · `src/occlusion.js` hidden-surface mask for the cockpit view · `src/camera.js`, `src/controls.js`, `src/hud.js`, `src/autopilot.js`,
  `src/map.js`, `src/audio.js`, `src/geo.js`, `src/main.js` · `src/boot.js` checks for WebGL 2 and starts the app.

Scenery © Esri, Maxar, Earthstar Geographics (and Esri World Imagery Wayback), plus the official orthophoto services listed under *Imagery sources* · Terrain © Mapzen / AWS Terrain Tiles · Airports © OurAirports (public domain) · Runway geometry © OpenStreetMap contributors (ODbL) · Buildings © Overture Maps Foundation (ODbL; includes OpenStreetMap, Google Open Buildings CC BY 4.0, Microsoft Building Footprints ODbL), fallback OpenMapTiles via OpenFreeMap · Charts © FAA.

## License

Personal-use only, source-available. No profit, no publishing, no credit-taking, revocable at any time.
See `LICENSE` and `NOTICE.md`. This is not an open-source licence.
