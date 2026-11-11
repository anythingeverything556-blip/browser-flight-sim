import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Geo, haversine, bearing, D2R, destination } from './geo.js';
import { stickGearing, rollGearing } from './handling.js';
import { Tour } from './tour.js';
import { Tutorial } from './tutorial.js';
import { RainField } from './rain3d.js';
import { MISSIONS, createMission, missionSpawnMode, missionFits, missionSurvivesTeleport } from './missions.js';
import { Terrain, TERRAIN_UNIFORMS } from './terrain.js';
import { loadWayback } from './imagery-sources.js';
import { Buildings } from './buildings.js';
import { Trees } from './trees.js';
import { Turbulence, windSpeedAt } from './turbulence.js';
import { AirportDB } from './airportdb.js';
import { Navigation } from './nav.js';
import { Environment } from './sky.js';
import { Clouds } from './clouds.js';
import { FlightModel, SPEC } from './flight.js';
import { C172Model, C172, C172_CG, FLAP_DEG, stallAlpha as c172StallAlpha } from './c172.js';
import { C172Visual } from './c172visual.js';
import { SF50Model, SF50, SF50_CG, FLAP_DEG as SF50_FLAP_DEG, TRIM_AUTH as SF50_TRIM_AUTH, stallAlpha as sf50StallAlpha } from './sf50.js';
import { SF50Visual, SF50_EYE } from './sf50visual.js';
import { makeSF50Feed, sf50Warn } from './sf50feed.js';
import { SF50_AP, SF50Autoland, planSafeReturn, apTrimServo } from './sf50ap.js';
import { gaControlFrame, resetHandsOff as clearHandsOff } from './handsoff.js';
import { c172PitchAuthority, C172_STICK, SF50_STICK, IL76_STICK } from './c172stick.js';
import { IL76Model, IL76, IL76_CG, NOTCHES as IL76_NOTCHES, NOTCH_TAKEOFF as IL76_NOTCH_TO, TRIM_AUTH as IL76_TRIM_AUTH, stallAlpha as il76StallAlpha } from './il76.js';
import { IL76Visual, IL76_EYE } from './il76visual.js';
import { il76Warn, il76Feed, il76WarnReset } from './il76feed.js';
import { Autobrake, AUTOBRAKE } from './autobrake.js';
import { IL76_AP } from './il76ap.js';
import { makeIl76Controls } from './il76ctl.js';
import { AIRCRAFT_TYPES, aircraftChoice } from './aircrafts.js';
import { setCallsign } from './atc.js';
import { airData } from './airdata.js';
import { isa } from './atmosphere.js';
import { cloudTop, cloudAnchor } from './cloudlayer.js';
import { AircraftSystems } from './systems.js';
import { AircraftVisual } from './aircraft.js';
import { configureCameraAircraft, CameraRig, VIEWS, VIEW_NAMES } from './camera.js';
import { Controls } from './controls.js';
import { Autopilot, attitude, flareSink, landingAidOn, vrefEas } from './autopilot.js';
import { MODE_INFO, PRESETS, modeOf, presetChanged, landingLimits, envelopeProtect, resetProtect, PROT_A_ON, PROT_A_MAX } from './difficulty.js';
import { stat, ChangeGate } from './workstats.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { MapPanel } from './map.js';
import { PostFX } from './post.js';
import { WorldShadows, SHADOW_UNIFORMS } from './shadows.js';
import { VolumetricClouds } from './vclouds.js';
import { Wreck } from './crash.js';
import { PerfMonitor } from './perf.js';
import { Weather, WEATHER } from './weather.js';
import { Guide } from './guide.js';
import { Atc, buildAtis } from './atc.js';
import { JetBlast } from './blast.js';
import { liveWeather } from './metar.js';
import { Traffic } from './traffic.js';
import { TouchdownReporter } from './touchdown.js';
import { Airflow } from './airflow.js';
import { CloudShadow } from './cloudshadow.js';
import { warmShaders, warmLate, warmTextures, whenIdle, finishPrograms } from './warmup.js';
import { CockpitOcclusion, OCC_UNIFORMS } from './occlusion.js';
import { nextScale, nextPressure, floorFor, dynReady, lowerPreset, DYN } from './dynres.js';
import { TakeoffAid, RotationAssist } from './autotakeoff.js';
import { mountKeymap } from './keymap-ui.js';
import { BuildingCollider, C172_COLLIDE_POINTS, C172_PAD, SF50_COLLIDE_POINTS, SF50_PAD, IL76_COLLIDE_POINTS, IL76_PAD } from './buildcollide.js';
import { makeAutoTrim, autoTrimStep, AT as AUTO_TRIM, AT_C172 } from './autotrim.js';
import { slewExit } from './slew.js';
import { esc } from './esc.js';
import { firstRunGfx } from './gpuclass.js';
import { CockpitMap } from './cockpitmap.js';
import { isReversed } from './depth.js';
import { setPanelHardware } from './panel.js';
import { DEFAULT_VOICE_STYLE, voiceStyle } from './voicewarn.js';

const $ = (id) => document.getElementById(id);
const FT = 3.28084, KT = 1.943844, NM = 1852;
const START_FUEL = 25000; // kg
const BASE = import.meta.env.BASE_URL;
const LS = { get: (k, d) => { try { const v = localStorage.getItem('sr71sim.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('sr71sim.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

// ---------- renderer & scene ----------
const canvas = $('view');
// canvas MSAA only for Low, which renders straight to the screen; every other preset anti-aliases in the post chain (SMAA / MSAA targets), and the
// canvas samples on top of that were pure cost (16 samples per pixel at 200 %). Switching to Low later keeps the canvas without them until a reload.
// Reversed depth (audit #5): a float depth target with 1 = near holds 5 cm to 12,000 km without log depth, whose gl_FragDepth writes turn early-Z off for
// every material. Needs EXT_clip_control. Low draws straight to the canvas's 24-bit depth, so it keeps log depth (decided at load, like the canvas MSAA;
// settings.revDepth = false forces log depth). The boot check already opened this canvas's context, so getContext hands that one back.
const wantRevDepth = (() => {
  const s = LS.get('settings', {}) || {};
  if (s.revDepth === false) return false;
  try {
    const gl = canvas.getContext('webgl2'), ri = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gfx = s.gfx || firstRunGfx(ri ? String(gl.getParameter(ri.UNMASKED_RENDERER_WEBGL)) : '');
    return gfx !== 'low' && !!(gl && gl.getExtension('EXT_clip_control'));
  } catch { return false; }
})();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: (LS.get('settings', {}) || {}).gfx === 'low', logarithmicDepthBuffer: !wantRevDepth, reversedDepthBuffer: wantRevDepth, powerPreference: 'high-performance' });
const REV_DEPTH = isReversed(renderer);
renderer.setSize(innerWidth, innerHeight, false);
setPanelHardware({ maxTextureSize: renderer.capabilities.maxTextureSize, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1.2e7);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; // replaced by the sky
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const db = new AirportDB();
const geo = new Geo(39.1361, -121.4365);
const terrain = new Terrain(scene, geo, db);
terrain.renderer = renderer;
terrain.anisotropy = renderer.capabilities.getMaxAnisotropy();
const buildings = new Buildings(scene, geo, terrain, db);
buildings.renderer = renderer; // roof atlases upload under the per-frame budget instead of lazily mid-render
const trees = new Trees(scene, geo, terrain, db);
const env = new Environment(scene, renderer);
const clouds = new Clouds(scene);
// Aircraft (Settings / setup sheet): chosen at load, like the depth mode; switching saves the choice and reloads. ?aircraft=c172 overrides it.
const AIRCRAFT = aircraftChoice(LS.get('settings', {}), location.search), IS_C172 = AIRCRAFT === 'c172', IS_SF50 = AIRCRAFT === 'sf50', IS_IL76 = AIRCRAFT === 'il76', IS_GA = IS_C172 || IS_SF50, AC = AIRCRAFT_TYPES[AIRCRAFT]; // IS_GA: the light aircraft with one lever and hands-off flying; the Il-76 is neither the Blackbird nor a light aircraft
const CG_H = IS_C172 ? C172_CG.y : IS_SF50 ? SF50_CG.y : IS_IL76 ? IL76_CG.y : 2.42; // CG height above the wheels' contact points (spawn height, AGL)
const FUEL_MAX = IS_C172 ? C172.FUEL_MAX : IS_SF50 ? SF50.FUEL_MAX : IS_IL76 ? IL76.FUEL_MAX : SPEC.FUEL_MAX;
const fdm = IS_C172 ? new C172Model() : IS_SF50 ? new SF50Model() : IS_IL76 ? new IL76Model() : new FlightModel();
if (IS_C172) setCallsign('Skyhawk 172SP', 'Skyhawk one seven two sierra papa');
if (IS_SF50) setCallsign('Vision Jet', 'Vision five zero');
if (IS_IL76) setCallsign('Ilyushin 76', 'Ilyushin seven six');
const TRIM_LIM = IS_SF50 || IS_IL76 ? 1 : 0.6, TRIM_RATE = IS_SF50 ? 0.2 : IS_IL76 ? 0.1 : 0.12;
// Vision Jet auto-trim: the whole wheel, and its stall guard set below the straight wing's ~12.5 deg stall angle
const SF50_AUTO_TRIM = { ...AUTO_TRIM, limit: 1, alphaSoft: 0.15, alphaHard: 0.19 };
// Il-76: the whole trim wheel, a slow follow-up, and a guard set below the clean wing's 13.5° stall angle
const IL76_AUTO_TRIM = { ...AUTO_TRIM, limit: 1, alphaSoft: 0.17, alphaHard: 0.215, rate: 0.15, maxStep: 0.05 };
const STICK_GA = IS_GA || IS_IL76; // the stick path of the Skyhawk and Vision Jet (shaped, slewed stick plus the hands-off assist) is the Il-76's too
const aircraftSystems = new AircraftSystems();
let systemsState;
const visual = IS_C172 ? new C172Visual(scene) : IS_SF50 ? new SF50Visual(scene) : IS_IL76 ? new IL76Visual(scene) : new AircraftVisual(scene);
const wreck = new Wreck(scene);
const post = new PostFX(renderer);
const vclouds = new VolumetricClouds(renderer);
const shadows = new WorldShadows([buildings.group, trees.group, visual.root, wreck.group], renderer);
const perf = new PerfMonitor(renderer, () => `terrain ${terrain.stats.visible} tiles ${terrain.stats.tris} tris, ${terrain.stats.imgActive + terrain.stats.demActive} loading, ${terrain.stats.imgWait} queued · buildings ${buildings.stats.tiles} tiles ${(buildings.stats.tris / 1e3).toFixed(0)}k tris · render ${renderer.domElement.width}x${renderer.domElement.height} px for a ${innerWidth}x${innerHeight} window (pixel ratio ${renderer.getPixelRatio().toFixed(2)}, dynres ${dynres.scale.toFixed(2)}) · clouds ${post.clouds ? 'on' : 'off'}\nscreen: devicePixelRatio ${(devicePixelRatio || 1).toFixed(2)}, page zoom/pinch ${(visualViewport ? visualViewport.scale : 1).toFixed(2)}, ${screen.width}x${screen.height} CSS px\ntargets: ${post.sizes()} · cockpit mask ${occlusion.enabled ? (occlusion.stats.w ? `${occlusion.stats.w}x${occlusion.stats.h}, ${occlusion.stats.calls} draws` : 'not used yet') : 'off'}`);
const bisect = perf.bindBisect(['normal', 'terrain hidden', 'trees + buildings hidden', 'aircraft + cockpit hidden', 'terrain + trees + buildings hidden', 'cockpit hidden-surface mask off']);
const occlusion = new CockpitOcclusion(); // cockpit view only: the heavy materials skip what lies behind the panel and consoles
const dbgOff = perf.bindSwitches(); post.dbg = dbgOff; // F5-F9 in the overlay: switch passes off one at a time to find which one flickers or costs frame time
const sizePost = () => { const v = renderer.getDrawingBufferSize(new THREE.Vector2()), n = Math.max(1, devicePixelRatio || 1); post.setSize(v.x, v.y, innerWidth * n, innerHeight * n); };
addEventListener('resize', sizePost);
const rig = new CameraRig(camera, canvas);
// Skyhawk: pilot's eye in the left seat (low enough to see the top-row gauges under the glareshield lip: 0 of 24 ray samples hidden, 9 at
// y 1.64), a wing camera under the left wing, chase and orbit at a light aircraft's distance
if (IS_C172) { configureCameraAircraft({ eye: new THREE.Vector3(-1.15, 1.58, -0.29).sub(C172_CG), wing: new THREE.Vector3(-2.2, 1.45, -3.2).sub(C172_CG), look: 4, minDist: 7, chase: 13 }); rig.orbit.dist = 13; }
// Vision Jet: the left-seat eye point (looking down at the PFD), a wing camera behind the left wing's trailing edge, chase and orbit at a light jet's distance
if (IS_SF50) { configureCameraAircraft({ eye: SF50_EYE, wing: new THREE.Vector3(-0.6, 1.5, -3.6).sub(SF50_CG), look: 4, minDist: 8, chase: 15 }); rig.orbit.dist = 15; }
// Il-76: the captain's eye (left seat, over the yoke), a wing camera behind the left wing's inboard trailing edge, chase and orbit for a 50 m aircraft
if (IS_IL76) { configureCameraAircraft({ eye: IL76_EYE, wing: new THREE.Vector3(-10, 5.6, -12).sub(IL76_CG), look: 14, minDist: 30, chase: 62 }); rig.orbit.dist = 70; }
const controls = new Controls();
controls.enabled = false; // until a flight is started from the setup screen
const ap = new Autopilot(IS_SF50 ? SF50_AP : IS_IL76 ? IL76_AP : undefined), autoland = new SF50Autoland();
// the autopilot's airspeed: equivalent for the Blackbird (its limits are KEAS), calibrated for the Vision Jet (VMO and the PFD are KCAS)
const apIas = () => (IS_SF50 || IS_IL76 ? casMs() : ias());
const buildingHit = IS_C172 ? new BuildingCollider(C172_COLLIDE_POINTS, C172_PAD) : IS_SF50 ? new BuildingCollider(SF50_COLLIDE_POINTS, SF50_PAD) : IS_IL76 ? new BuildingCollider(IL76_COLLIDE_POINTS, IL76_PAD) : new BuildingCollider();
const takeoff = new TakeoffAid(), rotAssist = new RotationAssist(), autoTrim = makeAutoTrim();
const nav = new Navigation();
const hud = new HUD($('hud'));
const syncStripH = () => { const e = $('strip'); if (e) document.documentElement.style.setProperty('--strip-h', Math.round(e.getBoundingClientRect().height) + 'px'); }; // the guide sits above the strip (style.css)
if (window.ResizeObserver && $('strip')) new ResizeObserver(syncStripH).observe($('strip'));
const audio = new Audio();
if (IS_IL76) audio.configure({ engines: 4 }); // four engine voices, panned by their position, and the Il-76's systems layers
hud.visible = false; // the real SR-71 has no HUD

const firstRun = !(LS.get('settings', null) || {}).gfx; // before the migrations below save anything
const settings = Object.assign({ unstarts: true, metric: false, crash: true, clouds: 0.3, cloudBase: 6000 / FT, windDir: 320, windSpd: 8 / KT, turb: 0.1, runClock: false, vis: 1, volume: 0.7, gfx: 'high', shake: false, dynres: true, relief: 0.75, strip: true, buildings: true, trees: true, rscale: 1, assist: false, handsOff: true, landAid: true, metarAuto: true, traffic: false, voiceWarn: true, voiceStyle: DEFAULT_VOICE_STYLE }, LS.get('settings', {}) || {});
// earlier builds forced Normal and switched on adaptive resolution (which renders at as little as 55 %): undo both once
if (!settings.gfxV3) { settings.gfxV3 = true; settings.dynres = false; if (settings.gfx === 'normal' || settings.gfx === 'low') settings.gfx = 'high'; LS.set('settings', settings); }
// render resolution defaults to 100 % of the screen's own pixels again: the 200 % default (and the gfxV4 step that forced it onto every save) ran the
// whole post chain at 4x the pixels. Saves that gfxV4 moved to 200 % come back once; the slider still goes up for anyone who wants it.
if (!settings.gfxV8) { settings.gfxV8 = true; if (settings.gfxV4 && settings.rscale === 2) settings.rscale = 1; LS.set('settings', settings); }
// Live Traffic's relay was never set up (/api/traffic answers 502): off until it exists, also for saves that had it on by default
if (!settings.trafficV1) { settings.trafficV1 = true; settings.traffic = false; LS.set('settings', settings); }
// first run only (no saved preset): Normal on an integrated GPU (High measured 13 fps in the cockpit on a laptop RTX 3050), Low on a software rasteriser
if (firstRun) { settings.gfx = firstRunGfx(gpuName()); LS.set('settings', settings); }
function gpuName() { try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { return ''; } }
// the F3 of one player showed adaptive resolution still ON from an older save and sitting at its 55 % floor (the soft "144p" picture): off again, once
// flight assist is opt-in (the guide explains it); the landing aid is on; terrain relief shading is always 100 %
if (!settings.gfxV6) { settings.gfxV6 = true; settings.assist = false; settings.landAid = true; LS.set('settings', settings); }
settings.relief = 1;
// adaptive resolution is back on by default: it now steps straight to the resolution that holds 60 fps and never goes below the screen's own pixels
if (settings.rotAssist === undefined) settings.rotAssist = true;
if (settings.autoTrim === undefined) settings.autoTrim = true;
if (!settings.gfxV7) { settings.gfxV7 = true; settings.dynres = true; LS.set('settings', settings); }
if (!settings.gfxV5) { settings.gfxV5 = true; LS.set('settings', settings); }
const saveSettings = () => LS.set('settings', settings);
// flying mode (difficulty.js): saves from before modes existed are Medium and keep their own assist choices
settings.mode = modeOf(settings.mode);
fdm.land = landingLimits(AIRCRAFT, settings.mode); if (IS_IL76) fdm.setMode(settings.mode); // the Il-76's flying mode also sets its handling, engines and brakes (IL76_MODES)
audio.setVoice(settings.voiceWarn !== false, settings.voiceStyle, BASE);
if (settings.callouts === undefined) settings.callouts = true;
audio.setCallouts(settings.callouts);
// player's key bindings (Settings → Keyboard controls)
const keymap = mountKeymap({ root: $('keymap'), help: $('help-keys'), leverHint: $('tl-hint'), controls, settings, save: saveSettings, toast: (m, w) => toast(m, w) });
const state = { paused: false, slew: false, pending: null, lastSpawn: null, lastGround: 34, bump: 0, overG: 0, coneSilent: false, navOut: {}, started: false };
const WARPS = [1, 2, 4, 8, 16], warp = { i: 0 }; // time warp (see setWarp)
const warpX = () => WARPS[warp.i];
const turb = new Turbulence();
// Skyhawk hands-off assist state (src/handsoff.js); dropped at every spawn so a held heading never carries into the next flight
const gaCtl = { stick: { de: 0, da: 0 }, h: {} }; const resetHandsOff = () => clearHandsOff(gaCtl.h);
const resetGaControls = () => { resetHandsOff(); gaCtl.stick.de = gaCtl.stick.da = 0; }; // at spawn only: the stick keeps its position while flying
let home = LS.get('home', null); if (!home || typeof home.ident !== 'string') home = { ident: 'KBAB', rwy: 0, end: 1 }; // a saved JSON null crashed boot
const dep = { apt: null, rwy: 0, end: 0, mode: 'runway' };

// ---------- helpers ----------
function toast(msg, warn) {
  const t = document.createElement('div'); t.className = 'toast' + (warn ? ' warn' : ''); t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), warn ? 4500 : 2800);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
function groundAt(x, z) {
  const ll = geo.toLatLon(x, z);
  const h = terrain.heightAt(ll.lat, ll.lon);
  return h === null ? state.lastGround : h;
}
function aircraftLatLon() { return geo.toLatLon(fdm.pos.x, fdm.pos.z); }
const casMs = () => airData(fdm.out).cas;
// the Il-76's gear lever, flaps and slats, spoilers, thrust reverse, doors and the cargo-hatch interlock (src/il76ctl.js)
const il76c = IS_IL76 ? makeIl76Controls({ fdm, visual, audio, toast, casKt: () => casMs() * KT }) : null;
function ias() { return (fdm.out.V || 0) * Math.sqrt((fdm.out.rho || 1.225) / 1.225); }
const fmtAlt = (m) => settings.metric ? `${Math.round(m).toLocaleString()} m` : `${Math.round(m * FT).toLocaleString()} ft`;
const fmtLen = (m) => settings.metric ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m * FT).toLocaleString()} ft`;

function moveOrigin(lat, lon) {
  const conv = (v) => (v ? { ll: geo.toLatLon(v.x, v.z), y: v.y } : null);
  const chase = conv(rig.chasePos), fly = conv(rig.flyPos);
  geo.setOrigin(lat, lon);
  const back = (c, v) => { if (!c) return; const p = geo.toXZ(c.ll.lat, c.ll.lon); v.set(p.x, c.y, p.z); };
  back(chase, rig.chasePos); back(fly, rig.flyPos);
  db.updateActive(lat, lon, scene, geo, true);
}

function spawn(s, meta) {
  state.refuel = null; if (warp.i) { warp.i = 0; $('st-warp').hidden = true; } // a new position starts at 1x with no tanker
  buildingHit.reset(); buildingHit.hasPrev = false;
  state.ditch = false;
  if (wreck.active) {
    wreck.clear(visual); if (state.viewBeforeCrash) { setView(state.viewBeforeCrash); state.viewBeforeCrash = null; }
    // the wreck camera backs off to 420 m in orbit view: the next flight starts where the player had the orbit before the crash
    if (state.orbitBeforeCrash) { if (rig.view === 'orbit') Object.assign(rig.orbit, state.orbitBeforeCrash); state.orbitBeforeCrash = null; }
  }
  if (meta) fdm.fuel = IS_C172 ? C172.FUEL_MAX : IS_SF50 ? SF50.FUEL_MAX : IS_IL76 ? (settings.fullTanks ? IL76.FUEL_MAX : !s.ground && s.speed < 90 ? IL76.MLW - IL76.EMPTY - IL76.PAYLOAD : IL76.FUEL_START) : settings.fullTanks ? SPEC.FUEL_MAX : START_FUEL; // airport starts and restarts refuel; teleports keep the current load
  state.lastSpawn = { s, meta, fuel: fdm.fuel };
  moveOrigin(s.lat, s.lon);
  turb.reset(); resetGaControls(); fdm.latDeg = s.lat;
  terrain.refreshNear(s.lat, s.lon, 50);
  fdm.reset(new THREE.Vector3(0, s.alt + (s.ground ? CG_H : 0), 0), s.hdg, s.speed, s.ground, s.gamma || 0);
  fdm.onGround = !!s.ground; // reset() leaves the old flag until the next physics step, which would block an autopilot engage at spawn
  fdm.realism.unstarts = settings.unstarts;
  if (IS_SF50 && s.ground) { fdm.setFlaps(1); fdm.flaps = SF50_FLAP_DEG[1]; fdm.setTakeoffTrim(); } // runway starts: 50 % flaps, trim in the take-off band
  if (IS_IL76) { fdm.setMode(settings.mode); if (s.ground) { fdm.setFlaps(IL76_NOTCH_TO); fdm.flaps = IL76_NOTCHES[IL76_NOTCH_TO].flap; fdm.slats = IL76_NOTCHES[IL76_NOTCH_TO].slat; fdm.setTakeoffTrim(); } } // runway starts: take-off slats and flaps, trim in the take-off band
  controls.throttle = fdm.throttle;
  controls.rudderSet = 0; controls.engSel = 0; controls.engTrim.fill(0); autobrake.reset(); state.abGs = undefined; if (IS_IL76) il76WarnReset(fdm); // a new flight starts with the rudder centred, the levers together and no stale warning
  // a ground spawn holds the parking brake (the jet crept forward at idle); the first push of the throttle releases it
  fdm.parkingBrake = !!s.ground; state.autoPark = fdm.parkingBrake; state.flightT = 0; aircraftSystems.reset();
  // nothing from the last flight flies the new one: auto take-off, landing aid and the autopilot's modes, targets and pilot-set boxes all start fresh
  takeoff.stop(); landAid.on && landAid.disengage(); resetApState();
  if (meta && meta.rwy) nav.setArrival(meta.rwy, meta.end);
  nav.legStart = null; // the active leg restarts from the new position
  state.pending = { ...s, t0: performance.now() };
  touchdown.reset();
  atc.reset(); audio.resetForSpawn(); // the crash and fire sounds of the last flight carried into this one
  terrain.requestHeight(s.lat, s.lon);
  $('crash').style.display = 'none';
  mapPanel && mapPanel.clearTrail();
  rig.chasePos = null; rig.flyPos = null;
}
// How ready is the ground around a spawn? ok: the surrounding ring shows its imagery and the tile under the jet is at a fine level, or nothing more is
// being fetched (the provider has nothing finer there). p: 0..1 for the loading bar.
const GROUND_LEVEL = 15;
function groundStatus(s) {
  const st = terrain.stats, busy = st.imgActive + st.demActive + st.imgWait, now = performance.now();
  const sp = terrain.sceneryProgress(3000), lvl = terrain.levelAt(s.lat, s.lon);
  if (busy === 0) s.quiet = s.quiet ?? now; else s.quiet = null;
  const settled = s.quiet !== null && now - s.quiet > 1500 && lvl >= 11;
  const ok = (sp >= 0.9 && lvl >= GROUND_LEVEL) || settled;
  const p = ok ? 1 : Math.min(0.99, 0.6 * Math.min(1, sp / 0.9) + 0.4 * Math.min(1, Math.max(0, (lvl - 9) / (GROUND_LEVEL - 9))));
  return { ok, p, sp, lvl };
}
// physics waits until the elevation under the aircraft is known so it never spawns underground
function finishPending() {
  const s = state.pending, waited = performance.now() - s.t0;
  // wait for the fine elevation tile; after 15 s settle for any loaded level. Never reuse the previous place's ground
  // height: that put the jet under the dirt at a higher airport or inside mountains after a teleport.
  let h = terrain.heightAt(s.lat, s.lon);
  if (!terrain.heightReady(s.lat, s.lon) && waited < 15000) { $('st-state').textContent = 'Loading terrain'; return; }
  if (h === null) {
    if (waited < 45000) { $('st-state').textContent = 'Loading terrain'; return; }
    h = s.ground ? s.alt : Math.max(0, s.alt - 300); // airport elevation from the database
  }
  // then let the imagery around the aircraft sharpen (up to 12 s), so the first look at a place is not a blurry level
  // shaders compile in parallel while the menu is up; wait for them so the first seconds of flight do not hitch on a compile
  if (!warm.done && waited < 40000) { $('st-state').textContent = 'Compiling graphics'; return; }
  // one more pass now that the lights, environment and fog are in their flight state: it only compiles what the menu-time pass could not know
  if (!warm.final) { warm.final = true; startWarm(true); return; }
  // the picture the player first sees must be the sharp one: wait for the ring of ground around the jet to show its imagery at a fine level (or for the
  // loader to run dry, which is as sharp as the provider gets there), up to 45 s
  const gs = groundStatus(s);
  if (!gs.ok && waited < 45000 && !state.fastSpawn) { $('st-state').textContent = `Loading imagery ${Math.round(gs.p * 100)}%`; return; }
  // never start on a coarse tile: it is drawn above the runway, which puts the jet and the camera under the ground
  if (terrain.levelAt(s.lat, s.lon) < 11 && waited < 45000 && !state.fastSpawn) { $('st-state').textContent = 'Sharpening ground'; return; }
  state.lastGround = h;
  if (s.ground) fdm.pos.y = h + CG_H; else fdm.pos.y = Math.max(fdm.pos.y, h + 300);
  state.pending = null;
  state.settleUntil = performance.now() + 12000; state.settleAir = !s.ground;
  pause(state.paused);
  $('loadmsg').textContent = 'Ready';
}
function spawnAt(apt, rwyIdx, end, mode) {
  const r = apt.runways[rwyIdx]; if (!r) return;
  const sp = r.spawn(end, mode); state.startApt = apt;
  // the Skyhawk: 65 KIAS on final (the runway's glide path), 105 KIAS at 8,000 ft for the cruise start
  if (IS_C172 && !sp.ground) { if (mode === 'cruise') { sp.speed = 105 / KT; sp.alt = 8000 / FT; sp.gamma = 0; } else sp.speed = 65 / KT; }
  // the Vision Jet: 110 KIAS on final (flaps 15 and gear down follow from the speed in SF50Model.reset), 180 KIAS at FL250 for the cruise start
  // (reset() takes the true airspeed)
  if (IS_SF50 && !sp.ground) { if (mode === 'cruise') { sp.alt = 25000 / FT; sp.speed = 180 / KT / Math.sqrt(isa(sp.alt).rho / 1.225); sp.gamma = 0; } else sp.speed = 110 / KT; }
  // the Il-76: 160 KIAS on final (slats, flaps and gear follow from the speed in IL76Model.reset), M 0.72 at 10,000 m (FL330) for the cruise start
  if (IS_IL76 && !sp.ground) { if (mode === 'cruise') { sp.alt = 10000; sp.speed = 0.72 * isa(sp.alt).a; sp.gamma = 0; } else sp.speed = 148 / KT; }
  spawn(sp, { rwy: r, end });
  toast(`${apt.ident} runway ${r.ends[end].ident} — ${mode === 'runway' ? 'ready for take-off' : mode === 'approach' ? '10 NM final' : mode === 'final' ? '5 NM final' : IS_C172 ? '8,000 ft cruise' : IS_SF50 ? 'FL250 cruise' : IS_IL76 ? 'FL330 cruise' : 'Mach 3.2 cruise'}`);
}
function restart() {
  if (!state.lastSpawn) return;
  const { s, meta, fuel } = state.lastSpawn;
  spawn(s, meta); fdm.fuel = fuel; state.lastSpawn.fuel = fuel;
  if (state.started) startMission();
}
// free orbit is the default view: it starts behind the jet, and dragging swings it round
function freeOrbitBehind() {
  const s = state.lastSpawn && state.lastSpawn.s;
  setView('orbit'); Object.assign(rig.orbit, { az: -((s ? s.hdg : 0) * Math.PI) / 180, el: 0.2, dist: IS_C172 ? 16 : IS_SF50 ? 19 : IS_IL76 ? 70 : 60 });
}
function beginFlight() {
  if (settings.cmap !== false && !cmap.visible) cmap.toggle(true); // on by default once flying; N hides it
  document.body.classList.remove('intro'); state.started = true; controls.enabled = true; openSheet(null); placeAircraftPicker();
  syncStripH();
  toast('W/S pitch · A/D roll (steer the nose wheel on the ground) · ? all keys');
}

// ---------- sheets ----------
const railBtns = [...document.querySelectorAll('#rail button[data-sheet]')];
railBtns.forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => openSheet(null)));
function openSheet(id, force) {
  const el = id && $('sheet-' + id);
  const open = el ? (force ?? !el.classList.contains('open')) : false;
  document.querySelectorAll('.sheet').forEach((p) => p.classList.remove('open'));
  railBtns.forEach((b) => b.classList.remove('on'));
  document.body.classList.toggle('sheet-open', !!open);
  document.body.classList.toggle('sheet-wide', !!open && el.classList.contains('wide'));
  if (!open) return;
  el.classList.add('open');
  railBtns.find((b) => b.dataset.sheet === id).classList.add('on');
  if (id === 'map') mapPanel.shown();
  if (id === 'airports') renderAptList();
  if (id === 'flight') renderHome();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.body.classList.contains('intro')) openSheet(null); });
// dock labels are tooltips; range tracks fill to their value; the dock fades while the pointer is idle
document.querySelectorAll('#rail button[title]').forEach((b) => { b.dataset.tip = b.title; b.removeAttribute('title'); });
const fillRange = (el) => { const min = +el.min || 0, max = +el.max || 100; el.style.setProperty('--fill', `${Math.max(0, Math.min(100, ((el.value - min) / (max - min)) * 100))}%`); };
document.querySelectorAll('input[type=range]').forEach((el) => { fillRange(el); el.addEventListener('input', () => fillRange(el)); });
// code moves sliders too (clock, METAR weather): refresh their fill twice a second, but only while a sheet is open and the tab is visible
setInterval(() => { if (!document.hidden && document.body.classList.contains('sheet-open')) document.querySelectorAll('input[type=range]').forEach(fillRange); }, 500);
let idleTimer = 0;
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 4500); };
['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => addEventListener(ev, wake, { passive: true }));
wake();
// data credits live in this dialog rather than as labels over the map and scenery
const termsEl = $('terms');
let termsReturn = null;
function setTerms(open) {
  if (open) { termsReturn = document.activeElement; termsEl.hidden = false; $('terms-close').focus(); }
  else { termsEl.hidden = true; if (termsReturn && termsReturn.focus) termsReturn.focus(); termsReturn = null; }
}
document.querySelectorAll('.js-terms').forEach((b) => b.addEventListener('click', () => setTerms(true)));
$('terms-close').addEventListener('click', () => setTerms(false));
termsEl.addEventListener('mousedown', (e) => { if (e.target === termsEl) setTerms(false); });
addEventListener('keydown', (e) => { if (termsEl.hidden) return; if (e.key === 'Escape') setTerms(false); if (e.key !== 'Tab') e.stopPropagation(); }, true);
const seg = (id, fn) => {
  const box = $(id);
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); }));
  return (v) => box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
};

// ---------- airport cards ----------
function runwayHtml(apt, r, i, actions) {
  const surf = r.paved ? 'paved' : 'unpaved';
  const width = settings.metric ? `${Math.round(r.width)} m` : `${Math.round(r.width * FT)} ft`;
  return `<div class="rwy"><div class="t"><b>${r.leIdent} / ${r.heIdent}</b><span>${fmtLen(r.len)} × ${width} · ${surf}${r.lighted ? ' · lit' : ''}</span></div>
    <div class="ends">${r.ends.map((e, k) => actions(apt, i, k, e)).join('')}</div></div>`;
}
// the database repeats the airport name as the city for many military fields ("Beale Air Force Base, US"), so the name is not said twice;
// a city that is only part of the name (Lincoln, for Lincoln Regional) stays
const aptPlace = (a) => [a.city && a.city.toLowerCase() !== String(a.name).toLowerCase() ? a.city : '', a.country].filter(Boolean).join(', ');
function airportHeader(a) {
  const n = state.started ? nearDist(a) : '';
  return `<div class="dhead"><div><div class="id">${a.ident}${a.iata ? ' · ' + a.iata : ''}</div><h3>${a.name}</h3>
    <div class="sub">${aptPlace(a)} · elev ${fmtAlt(a.elev)}${n}</div></div>
    <span class="tag ${a.mil ? 'mil' : ''}">${a.typeName}</span></div>`;
}
function nearDist(a) { const ll = aircraftLatLon(); return ` · ${Math.round(haversine(ll.lat, ll.lon, a.lat, a.lon) / NM)} NM away`; }
function bindActions(root, a) {
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const [act, ri, ei] = b.dataset.act.split(':'); const r = a.runways[+ri];
    if (act === 'to' || act === 'app') { const m = act === 'to' ? 'runway' : 'approach'; spawnAt(a, +ri, +ei, missionFits(missionKind, m) ? m : missionSpawnMode(missionKind, m)); openSheet(null); if (state.started) startMission(); } // the selected mission restarts where it expects to start
    else if (act === 'ils') { nav.setArrival(r, +ei); toast(`Arrival: ${a.ident} runway ${r.ends[+ei].ident} ILS`); renderRoute(); }
    else if (act === 'home') { setHome(a, +ri || 0, +ei || 0); }
    else if (act === 'direct') { nav.directTo({ lat: a.lat, lon: a.lon, name: a.ident, apt: a.ident }, aircraftLatLon()); toast(`Direct to ${a.ident}`); }
    else if (act === 'add') { nav.add({ lat: a.lat, lon: a.lon, name: a.ident, apt: a.ident }); toast(`${a.ident} added to the route`); }
    else if (act === 'map') { openSheet('map', true); mapPanel.focus(a.lat, a.lon, 13); }
  }));
}
function airportDetail(a, compact) {
  return `${airportHeader(a)}
    <div class="rwys">${a.runways.map((r, i) => runwayHtml(a, r, i, (apt, ri, k, e) =>
      `<button class="endbtn" data-act="to:${ri}:${k}" title="Line up on runway ${e.ident}">↑ ${e.ident}</button><button class="endbtn" data-act="app:${ri}:${k}" title="10 NM final to ${e.ident}">↘ ${e.ident}</button>${compact ? '' : `<button class="endbtn" data-act="ils:${ri}:${k}" title="Use ${e.ident} as arrival runway">ILS ${e.ident}</button>`}`)).join('')}</div>
    <div class="chips"><button class="ghost" data-act="direct">Direct to</button><button class="ghost" data-act="add">Add to route</button>
      <button class="ghost" data-act="home:0:0">Set home base</button>${compact ? '' : '<button class="ghost" data-act="map">Show on map</button>'}</div>
    <p class="note">↑ take off · ↘ start on a 10 NM final</p>`;
}

// ---------- home base ----------
function setHome(a, rwy, end) {
  home = { ident: a.ident, rwy, end }; LS.set('home', home); renderHome();
  toast(`Home base set to ${a.ident} — ${a.name}`);
}
function homeAirport() { return db.get(home.ident) || db.get('KBAB'); }
function renderHome() {
  const a = homeAirport(); if (!a) return;
  const r = a.runways[home.rwy] || a.longest, e = r.ends[home.end] || r.ends[0];
  $('home-name').textContent = `${a.ident} — ${a.name}`;
  $('home-sub').textContent = [`Runway ${e.ident}`, fmtLen(r.len), aptPlace(a)].filter(Boolean).join(' · ');
  $('home-go').textContent = state.started ? 'Return' : 'Start here';
}
$('home-go').addEventListener('click', () => {
  const a = db.ready && homeAirport(); if (!a) return;
  startWarm(); spawnAt(a, home.rwy, home.end, missionSpawnMode(missionKind, 'runway')); beginFlight(); if (state.pending) showLoadUi(); startMission();
  if (settings.metarAuto) loadMetar(a, true);
});

// ---------- flight setup ----------
function searchBox(input, results, onPick) {
  let items = [], sel = -1;
  const render = () => {
    results.innerHTML = items.map((a, i) => `<div class="res ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${a.ident}</b><div class="nm">${a.name}<small>${aptPlace(a)}</small></div><div class="rw ${a.mil ? 'mil' : ''}">${fmtLen(a.longest.len)}</div></div>`).join('');
    results.classList.toggle('open', items.length > 0);
    results.querySelectorAll('.res').forEach((el) => el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(+el.dataset.i); }));
  };
  const pick = (i) => { const a = items[i]; if (!a) return; input.value = `${a.ident} — ${a.name}`; items = []; render(); onPick(a); };
  input.addEventListener('input', () => { items = input.value.trim().length >= 2 ? db.search(input.value, 'all', 12) : []; sel = items.length ? 0 : -1; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(sel);
    if (e.key === 'Escape') input.blur(); else e.stopPropagation();
  });
  input.addEventListener('blur', () => setTimeout(() => { items = []; render(); }, 150));
}
function renderDep() {
  const a = dep.apt; if (!a) return;
  $('dep-card').innerHTML = `${airportHeader(a)}<div class="lbl">Runway</div><div class="chips">${a.runways.flatMap((r, i) => r.ends.map((e, k) =>
    `<button class="endbtn ${dep.rwy === i && dep.end === k ? 'on' : ''}" data-r="${i}" data-e="${k}">${e.ident} <small>${fmtLen(r.len)}</small></button>`)).join('')}</div>`;
  renderSum();
  $('dep-card').querySelectorAll('.endbtn').forEach((b) => b.addEventListener('click', () => { dep.rwy = +b.dataset.r; dep.end = +b.dataset.e; renderDep(); prefetchPlace(); }));
}
// scenery for the chosen runway starts loading as soon as it is picked, not when Start is pressed
function prefetchPlace() {
  if (state.started || !dep.apt) return; const r = dep.apt.runways[dep.rwy]; if (!r) return;
  spawn(r.spawn(dep.end, 'runway'), { rwy: r, end: dep.end });
}
searchBox($('dep-q'), $('dep-results'), (a) => { dep.apt = a; dep.rwy = 0; dep.end = 0; renderDep(); prefetchPlace(); });
seg('start-mode', (v) => { dep.mode = v; });
// one line above Start flight says what it will do: aircraft, runway, start (or mission), time and weather
function renderSum() {
  const on = (id) => { const b = document.querySelector(`#${id} button.on`); return b && !b.hidden ? b.textContent : ''; };
  const a = dep.apt, r = a && a.runways[dep.rwy], e = r && r.ends[dep.end];
  const start = missionKind && missionKind !== 'free' ? on('mission-mode') : on('start-mode');
  $('flight-sum').textContent = [AIRCRAFT_TYPES[AIRCRAFT].short, a ? `${a.ident}${e ? ` ${e.ident}` : ''}` : '', start, $('intro-tod-l').textContent, on('intro-wx')].filter(Boolean).join(' · ');
}
['click', 'input'].forEach((ev) => $('sheet-flight').addEventListener(ev, () => queueMicrotask(renderSum)));
// the aircraft picker sits over the scene on the start screen of a wide window, and inside Flight setup otherwise (phones, in flight)
const acPick = $('ac-pick'), acWide = matchMedia('(min-width: 1180px) and (min-height: 640px)');
function placeAircraftPicker() {
  const to = document.body.classList.contains('intro') && acWide.matches ? $('hero-ac') : $('ac-slot');
  if (acPick.parentElement !== to) to.appendChild(acPick);
}
acWide.addEventListener('change', placeAircraftPicker); placeAircraftPicker();
// aircraft picker: the current one is marked; picking the other saves it and reloads into it
{
  const cards = [...document.querySelectorAll('#ac-cards .ac-card')];
  for (const c of cards) {
    const on = c.dataset.v === AIRCRAFT; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on));
    c.addEventListener('click', () => {
      if (c.dataset.v === AIRCRAFT) return;
      settings.aircraft = c.dataset.v; saveSettings();
      $('ac-note').textContent = `Loading the ${AIRCRAFT_TYPES[c.dataset.v].short}…`;
      const u = new URL(location.href); u.searchParams.delete('aircraft'); location.replace(u.toString());
    });
  }
  if (IS_C172) {
    // the Skyhawk flies free flights from the runway, a final or 8,000 ft; the missions and tutorial are written for the Blackbird
    const cruise = document.querySelector('#start-mode [data-v="cruise"]'); if (cruise) cruise.textContent = '8,000 ft cruise';
    document.querySelectorAll('#mission-mode button').forEach((b) => { if (b.dataset.v !== 'free') b.hidden = true; });
    const h = $('help-heading'); if (h) h.textContent = 'Flying the Skyhawk';
    // the sortie and cockpit text in index.html is the Blackbird's (J58s, afterburners, chute): the Skyhawk gets its own
    $('help-sortie').innerHTML = ['Full throttle (<b>E</b>; the first push releases the parking brake), keep the centreline with <b>A</b>/<b>D</b> (nose-wheel steering).',
      'Rotate at <b>55 KIAS</b> with a light pull and climb at <b>74 KIAS</b>.', 'No autopilot is fitted: trim with <b>;</b> and <b>\'</b> and fly by hand; <b>F</b> and <b>Shift+F</b> step the flaps.',
      'Plan the arrival on the <b>Map</b> (route, arrival runway, distance and ETE).', 'Fly final at about <b>65 KIAS</b> with flaps down, close the throttle (<b>Q</b>) over the threshold and flare.'].map((t) => `<li>${t}</li>`).join('');
    $('help-cockpit').textContent = 'The six-pack and tachometer are live: airspeed, attitude, altimeter, turn coordinator, heading and vertical speed, redrawn from the flight model.';
    document.title = 'Earthwing — Cessna 172SP Skyhawk';
  }
  if (IS_SF50) {
    // the Vision Jet flies free flights from the runway, a final or FL250; the missions and tutorial are written for the Blackbird
    const cruise = document.querySelector('#start-mode [data-v="cruise"]'); if (cruise) cruise.textContent = 'FL250 cruise';
    document.querySelectorAll('#mission-mode button').forEach((b) => { if (b.dataset.v !== 'free') b.hidden = true; });
    const h = $('help-heading'); if (h) h.textContent = 'Flying the Vision Jet';
    $('help-sortie').innerHTML = ['Runway starts set 50 % flaps and take-off trim. Take-off thrust with <b>E</b> (the first push releases the parking brake).',
      'Rotate at <b>90 KIAS</b> with a light pull, gear up (<b>G</b>) once climbing, climb at <b>120 KIAS</b>, then flaps up (<b>Shift+F</b>).',
      'Keep below 250 KIAS: 210 with the gear down, 190 with 50 % flaps, 150 with full flaps.', 'In <b>Autopilot</b> use <b>Climb to cruise</b> (FL280, FLCH); <b>J</b> is a go-around and <b>Shift+U</b> Safe Return lands at the nearest suitable airport.',
      'Plan the arrival on the <b>Map</b>, pick the arrival runway, then use <b>NAV</b> and <b>APPR</b> (or the autoland).', 'Fly final with full flaps at about <b>90 KIAS</b> (VREF 89), touch down and brake.'].map((t) => `<li>${t}</li>`).join('');
    $('help-cockpit').textContent = 'The two large Perspective Touch+ style displays are live: the PFD (attitude, speed and altitude tapes, HSI, flight director) and the MFD (engine N1, ITT, fuel flow, fuel, gear, flaps, pressurisation, navigation and alerts).';
    document.title = 'Earthwing — Cirrus Vision Jet SF50';
  }
  if (IS_IL76) {
    // the Il-76 flies free flights from the runway, a final or FL330; the missions and tutorial are written for the Blackbird
    const cruise = document.querySelector('#start-mode [data-v="cruise"]'); if (cruise) cruise.textContent = 'FL330 cruise';
    document.querySelectorAll('#mission-mode button').forEach((b) => { if (b.dataset.v !== 'free') b.hidden = true; });
    const h = $('help-heading'); if (h) h.textContent = 'Flying the Il-76';
    $('help-sortie').innerHTML = ['Runway starts set the take-off slats and flaps (S14 F30) and trim. Take-off thrust with <b>E</b> (the first push releases the parking brake); the engines need about 8 s to spool up.',
      'Rotate at <b>171 KIAS</b> (317 km/h at 210 t, less when lighter) to 8°, gear up (<b>G</b>) once climbing, climb at 450 km/h and take the slats and flaps up with <b>Shift+F</b> as you pass 215 KIAS (400 km/h).',
      'Gear and flaps limits: 370 km/h with the gear out or the slats at 25°, 280 km/h with full flaps; 600 km/h and Mach 0.80 at most.',
      'Cruise is Mach 0.72 (770 km/h) at 10,000 m. <b>K</b> engages the autopilot (basic modes: HDG, NAV, APPR, ALT, V/S, FLCH, speed); there is no autoland.',
      'Land at about <b>VREF</b> (300 km/h at 210 t, 266 at 165 t) with <b>F</b> to full flaps: <b>2</b> spoilers, <b>3</b> thrust reverse (on the ground only), <b>B</b> brakes. On the ground <b>Shift+N</b> crew doors, <b>4</b> cargo hatch, <b>5</b> paratroop doors.'].map((t) => `<li>${t}</li>`).join('');
    $('help-cockpit').textContent = 'The yokes, thrust levers, flap, spoiler and park-brake levers move with the controls; where the model has flight-deck screens they are live (attitude and speed, heading and navigation, engines and systems).';
    document.title = 'Earthwing — Ilyushin Il-76MD-90A';
  }
}
$('intro-tod').addEventListener('input', () => { env.hour = +$('intro-tod').value; syncEnvUi(); });
const weather = new Weather($('rain'), $('gloom'), $('fogveil'), $('bolt'));
const rainField = new RainField(); weather.field3d = true; rainField.attach(scene, false);
weather.noBeads = true; // canopy water is a real refraction pass on the glass now (glasswater.js)
weather.resize(innerWidth, innerHeight); addEventListener('resize', () => weather.resize(innerWidth, innerHeight));
const setIntroWx = seg('intro-wx', (v) => applyWeather(v));
const setWxPreset = seg('wx-presets', (v) => applyWeather(v));
// a preset sets cloud cover, wind, turbulence and visibility together, and starts its rain, gloom, fog and lightning
function applyWeather(id) {
  const p = WEATHER[id]; if (!p) return;
  settings.weather = id; settings.clouds = p.clouds; settings.windSpd = p.wind / KT; settings.turb = p.turb; settings.vis = p.vis;
  weather.set(p); setIntroWx(id); setWxPreset(id); syncEnvUi(); saveSettings();
}
// live weather survives a reload whole: it came back as Fair rain/fog under the saved METAR clouds and wind
const bootMetar = settings.weather === 'metar' && settings.metarWx;
weather.set(bootMetar ? settings.metarWx : WEATHER[settings.weather] || WEATHER.few); setIntroWx(bootMetar ? '' : settings.weather || 'few'); setWxPreset(bootMetar ? '' : settings.weather || 'few');
$('start-btn').addEventListener('click', () => {
  // rapid clicks after the start spawned and started the mission again while the world loaded. Before the start, a pending spawn is only the
  // menu's background scenery (boot, runway pick): the click must go ahead, or Start flight seemed to need several clicks.
  if (state.pending && state.started) return;
  const a = dep.apt || (db.ready && homeAirport()); if (!a) return;
  if ($('make-home').checked) setHome(a, dep.rwy, dep.end);
  const mode = missionKind === 'tutorial' || missionKind === 'tour' ? 'runway' : missionKind === 'landassist' ? 'approach' : missionKind === 'landhand' ? 'final' : dep.mode;
  startWarm(); spawnAt(a, dep.rwy, dep.end, mode);
  if (mode !== 'runway') { fdm.gearDown = mode === 'approach' || mode === 'final'; fdm.gearPos = fdm.gearDown ? 1 : 0; }
  beginFlight();
  if (state.pending) showLoadUi();
  if (settings.metarAuto) loadMetar(a, true);
  freeOrbitBehind();
  startMission();
});
const missionKindSet = seg('mission-mode', (v) => { missionKind = v; $('mission-blurb').textContent = MISSIONS[v].blurb; });

// ---------- guided flight and missions ----------
let missionKind = 'free', mission = null, missionAcc = 0, beacons = [];
const tour = new Tour(), tutorial = new Tutorial(), coachEl = $('coach');
let coachKey = '', coachHidden = false;
function renderCoach(v) {
  if (!v || coachHidden) { coachEl.hidden = true; coachKey = ''; return; }
  const key = JSON.stringify(v); if (key === coachKey) return; coachKey = key;
  coachEl.hidden = false; coachEl.classList.toggle('ok', !!v.ok);
  coachEl.querySelector('.coach-step').textContent = v.label || '';
  coachEl.querySelector('h3').textContent = v.title || ''; coachEl.querySelector('p').textContent = v.text || '';
  coachEl.querySelector('.coach-live').textContent = v.live || ''; coachEl.querySelector('.coach-hint').textContent = v.hint || '';
  $('coach-next').hidden = !v.next;
}
function setCaption(step, title, text) { renderCoach({ label: `Step ${step} of 8`, title, text }); }
function endTour(msg) { tour.stop(); renderCoach(null); if (msg) toast(msg); }
$('coach-skip').addEventListener('click', () => { if (tour.active) endTour('Your aircraft'); else { tutorial.stop(); coachHidden = true; renderCoach(null); } });
$('coach-next').addEventListener('click', () => tutorial.skip());
function tutorialCtx() {
  const att = attitude(fdm.quat), n = state.navOut || {};
  return { iasKt: casMs() * KT, agl: n.ilsValid ? n.agl : fdm.pos.y - state.lastGround, altFt: fdm.pos.y * FT, pitchDeg: att.pitch * 180 / Math.PI, hdg: att.heading,
    onGround: fdm.onGround, gearDown: fdm.gearDown, throttle: fdm.throttle, apOn: ap.on, apAltFt: ap.target.alt * FT, apHdg: ap.target.hdg,
    view: rig.view, orbitAz: rig.orbit.az, xtk: n.ilsValid ? n.locXtk : null };
}
// ---------- live weather (METAR) ----------
function applyMetarWx(w) {
  settings.weather = 'metar'; settings.clouds = w.coverage; settings.cloudBase = w.baseM; settings.windDir = w.windDir; settings.windSpd = w.windKt / KT; settings.turb = w.turb; settings.vis = w.vis;
  settings.metarWx = { rain: w.rainIntensity ?? w.rain, gloom: w.gloom, fog: w.fog, bolts: w.thunder ? 1 : 0 }; weather.set(settings.metarWx);
  setIntroWx(''); setWxPreset(''); syncEnvUi(); saveSettings();
}
async function loadMetar(apt, auto) {
  const a = apt || (state.lastSpawn && state.lastSpawn.meta && state.lastSpawn.meta.rwy && state.lastSpawn.meta.rwy.ap) || dep.apt;
  if (!a || !a.ident) return;
  state.wxBusy = true; $('metar-raw').textContent = `Fetching live weather for ${a.ident}…`;
  try {
    const { w, source, km } = await liveWeather(a, BASE); applyMetarWx(w); state.metar = w;
    if (w.raw) {
      const atisIndex = ((state.atisIndex ?? -1) + 1) % 26; state.atisIndex = atisIndex;
      // the weather is already applied here: an ATIS that cannot be built is skipped, it must not report "No live weather"
      try { const atis = buildAtis({ metar: w.raw, information: String.fromCharCode(65 + atisIndex), runways: a.runways || [] }); atc.say(`${a.name} ATIS`, atis, atis); } catch (e) { console.warn('ATIS skipped:', e.message); }
    }
    $('metar-raw').textContent = `${source}${km ? ` (${km} km away)` : ''}: ${w.raw}`;
    toast(`Live weather (${source}${km ? `, ${km} km away` : ''}): ${w.windKt ? `wind ${String(w.windDir).padStart(3, '0')}/${w.windKt} kt` : 'calm'}, ${w.coverage > 0.1 ? `cloud ${Math.max(0, Math.round((w.baseM - (a.elev || 0)) * FT / 100) * 100)} ft` : 'clear'}${w.rain ? ', precipitation' : ''}${w.thunder ? ', thunderstorms' : ''}`);
  } catch (e) { $('metar-raw').textContent = `No live weather for ${a.ident} (${e.message}). The weather settings are unchanged.`; if (!auto) toast('Live weather unavailable', true); }
  state.wxBusy = false;
}
$('metar-btn').addEventListener('click', () => loadMetar());
bindMetarAuto();
function bindMetarAuto() { const el = $('metar-auto'); el.checked = settings.metarAuto !== false; el.addEventListener('change', () => { settings.metarAuto = el.checked; saveSettings(); }); }

// ---------- throttle lever, loading screen, first-flight guide, radio ----------
const lever = { el: $('throttle-lever'), track: $('tl-track'), knob: $('tl-knob'), fill: $('tl-fill'), val: $('tl-val'), drag: false };
function leverSet(e) { const r = lever.track.getBoundingClientRect(); controls.throttle = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); controls.touched = true; }
lever.track.addEventListener('pointerdown', (e) => { lever.track.setPointerCapture(e.pointerId); lever.drag = true; leverSet(e); e.preventDefault(); });
lever.track.addEventListener('pointermove', (e) => { if (lever.drag) leverSet(e); });
lever.track.addEventListener('pointerup', () => { lever.drag = false; });
lever.track.addEventListener('pointercancel', () => { lever.drag = false; });
lever.track.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { controls.throttle = Math.max(0, Math.min(1, controls.throttle + (e.key === 'ArrowUp' ? 0.05 : -0.05))); controls.touched = true; e.preventDefault(); e.stopPropagation(); } });
// Skyhawk and Vision Jet: one engine, no afterburner, chute, unstart or autopilot, so their strip pills, the second throttle bar and the A/B lever zone go
if (IS_GA) {
  for (const el of [$('p-chute'), $('p-ab'), $('p-uns'), IS_C172 ? $('p-ap') : null, $('d-tr').parentElement, lever.track.querySelector('.tl-ab')]) if (el) el.style.display = 'none';
  const full = lever.track.querySelector('.tl-mil'); full.style.top = '0'; full.style.borderRadius = '15px'; full.querySelector('span').style.display = 'none';
}
// Il-76: four engines, no afterburner, chute or unstart: four N1 bars in the strip and no A/B zone on the lever
if (IS_IL76) {
  for (const el of [$('p-chute'), $('p-ab'), $('p-uns'), lever.track.querySelector('.tl-ab')]) if (el) el.style.display = 'none';
  const full = lever.track.querySelector('.tl-mil'); full.style.top = '0'; full.style.borderRadius = '15px'; full.querySelector('span').style.display = 'none';
  const bars = document.querySelector('#strip .thr .bars'); bars.classList.add('four');
  for (const id of ['d-t3', 'd-t4']) bars.insertAdjacentHTML('beforeend', `<i><em id="${id}"></em></i>`);
}
// DOM writes only when something shown changes (it restyled the lever every frame); the throttle is quantised to 0.2 %
const leverLast = { on: null, q: -1, blink: null }, thrSeg = document.querySelector('#strip .seg-d.thr');
function updateLever() {
  const on = state.started && !state.pending; if (on !== leverLast.on) { leverLast.on = on; lever.el.hidden = !on; } if (!on) return;
  const q = Math.round(Math.max(0, Math.min(1, fdm.throttle)) * 500);
  if (q !== leverLast.q) {
    leverLast.q = q; const t = q / 500;
    lever.knob.style.bottom = (t * 100) + '%'; lever.fill.style.height = `calc(${t * 100}% - ${t * 8}px)`;
    lever.track.setAttribute('aria-valuenow', Math.round(t * 100));
    lever.val.textContent = t < 0.02 ? 'IDLE' : IS_GA || IS_IL76 ? `${Math.round(t * 100)}%` : t > 0.75 ? `A/B ${Math.round((t - 0.75) / 0.25 * 100)}%` : `${Math.round(t / 0.75 * 100)}% MIL`;
  }
  const blink = !controls.touched && !ap.on;
  if (blink !== leverLast.blink) { leverLast.blink = blink; lever.el.classList.toggle('untouched', blink); thrSeg && thrSeg.classList.toggle('untouched', blink); }
}
// loading-screen tips per aircraft: the Blackbird's (afterburners, unstarts, the chute) do not apply to the light aircraft
const SF50_TIPS = ['Shift (or E) and Q move the thrust lever: take-off thrust on the runway, max continuous once flying.', 'Runway starts set take-off trim: a light pull at 90 KIAS rotates.',
  'G raises the gear (refused on the ground); F and Shift+F step the flaps through 50 % and 100 %.', 'Let go of the stick and auto-trim holds the attitude.',
  'Keep below 250 KIAS: 210 with the gear down, 190 with 50 % flaps, 150 with full flaps.', 'V cycles the cameras, M opens the map, ? shows every control.'];
const C172_TIPS = ['Shift (or E) and Q move the throttle.', 'F and Shift+F step the flaps.', 'V cycles the cameras, M opens the map, ? shows every control.',
  'The throttle lever on the right edge works with the mouse.'];
const IL76_TIPS = ['Shift (or E) and Q move the thrust lever for all four engines; they need about 8 s to spool up.', 'Runway starts set take-off slats and flaps and trim: rotate at about 171 KIAS at 210 t.',
  'G raises the gear (refused on the ground); F and Shift+F step the slats and flaps; 2 spoilers, 3 thrust reverse on the ground, 4 cargo hatch.', 'The take-off run is long: 1,500 m at full weight.',
  'V cycles the cameras, M opens the map, ? shows every control.'];
const lsEl = $('loadscreen'), LS_TIPS = IS_IL76 ? IL76_TIPS : IS_SF50 ? SF50_TIPS : IS_C172 ? C172_TIPS : ['Shift (or E) and Q move the throttle. 9 lights both afterburners.', 'Above Mach 2.3 keep the sideslip small or an inlet can unstart.', 'The J58 engines need about six seconds to spool up.', 'V cycles the cameras, M opens the map, ? shows every control.', 'Pull the drag chute with C after touchdown, below 200 knots.', 'The throttle lever on the right edge works with the mouse.'];
const loadUi = { shown: false, since: 0, done: false, tip: 0, fade: 0 };
const lsStep = (n, st) => { const li = lsEl.querySelector(`[data-step="${n}"]`); if (li) li.className = st; };
// Start flight shows the loading screen in the click itself: it used to wait 300 ms for the frame loop, which looked like the button had done
// nothing until the engine sound (let through only once the world is ready) started. Teleports keep the 300 ms grace in updateLoadUi.
function showLoadUi(now = performance.now()) {
  if (loadUi.shown) return;
  loadUi.shown = true; loadUi.done = false; loadUi.since = loadUi.since || now; loadUi.p = 0; lsEl.hidden = false; lsEl.classList.remove('out');
  ['aircraft', 'elevation', 'imagery', 'shaders', 'weather'].forEach((n) => lsStep(n, ''));
  $('ls-fill').style.width = '0%'; $('ls-pct').textContent = '0%';
  const a = state.lastSpawn && state.lastSpawn.meta && state.lastSpawn.meta.rwy && state.lastSpawn.meta.rwy.ap;
  $('ls-sub').textContent = a ? `${a.ident} — ${a.name}` : 'Loading terrain and imagery…';
}
function updateLoadUi(now) {
  const pend = state.pending && state.started ? state.pending : null;
  if (pend) {
    loadUi.done = false;
    if (!loadUi.since) loadUi.since = now;
    if (!loadUi.shown && now - loadUi.since > 300) showLoadUi(now);
    if (!loadUi.shown) return;
    const elevOk = terrain.heightReady(pend.lat, pend.lon) || terrain.heightAt(pend.lat, pend.lon) !== null, waited = performance.now() - pend.t0;
    const gs = elevOk ? groundStatus(pend) : { ok: false, p: 0 };
    const p = !warm.done ? Math.min(0.35, 0.05 + (performance.now() - pend.t0) / 40000) : elevOk ? 0.4 + 0.6 * gs.p : 0.08 + 0.3 * Math.min(1, waited / 9000);
    lsStep('shaders', warm.done ? 'done' : 'busy'); lsStep('aircraft', 'done'); lsStep('elevation', elevOk ? 'done' : 'busy'); lsStep('imagery', !elevOk ? '' : gs.ok ? 'done' : 'busy'); lsStep('weather', state.wxBusy ? 'busy' : 'done');
    loadUi.p = Math.max(loadUi.p || 0, p); $('ls-fill').style.width = (loadUi.p * 100) + '%'; $('ls-pct').textContent = Math.round(loadUi.p * 100) + '%';
    if (now - loadUi.tip > 4500) { loadUi.tip = now; $('ls-tip').textContent = LS_TIPS[(Math.random() * LS_TIPS.length) | 0]; }
  } else {
    loadUi.since = 0;
    if (loadUi.shown && !loadUi.done) { loadUi.done = true; loadUi.p = 0; ['aircraft', 'elevation', 'imagery', 'shaders', 'weather'].forEach((n) => lsStep(n, 'done')); $('ls-fill').style.width = '100%'; $('ls-pct').textContent = '100%'; setTimeout(() => lsEl.classList.add('out'), 250); setTimeout(() => { lsEl.hidden = true; loadUi.shown = false; maybeStartGuide(); }, 950); }
    else if (!loadUi.shown && state.started && !state.guideChecked) maybeStartGuide();
  }
}
const guide = new Guide({ el: $('guide'), controls, ctx: () => ({ ...tutorialCtx(), bankDeg: attitude(fdm.quat).bank * 180 / Math.PI }) });
function maybeStartGuide() {
  state.guideChecked = true;
  if (IS_GA || IS_IL76 || Guide.seen() || guide.active || tutorial.active || tour.active || (missionKind && missionKind !== 'free' && missionKind !== 'none') || !fdm.onGround) return;
  guide.start();
}
$('guide-replay').addEventListener('click', () => { openSheet(null); guide.start(); });
const atc = new Atc($('radio'), audio);
function atcCtx() {
  const m = state.lastSpawn && state.lastSpawn.meta, rw = m && m.rwy, a = rw && rw.ap, n = state.navOut || {};
  const ll = aircraftLatLon();
  return { started: state.started && !state.pending && !state.paused, crashed: fdm.crashed, onGround: fdm.onGround, gsKt: fdm.vel.length() * KT, agl: (fdm.pos.y - state.lastGround) * FT, gearDown: fdm.gearDown,
    apt: a, rwy: rw ? rw.ends[m.end].ident : '', arrApt: nav.arrival ? nav.arrival.rwy.ap : null, arrRwy: nav.arrival ? nav.arrival.rwy.ends[nav.arrival.end].ident : '', wind: { dir: settings.windDir, kt: settings.windSpd * KT }, nav: n, qnhHpa: state.metar && state.metar.qnhHpa,
    traffic: traffic.list, ownship: { lat: ll.lat, lon: ll.lon, alt: fdm.pos.y } };
}
const airflow = new Airflow(scene), cloudShadow = new CloudShadow();
TERRAIN_UNIFORMS.uCsTex.value = cloudShadow.rt.texture; TERRAIN_UNIFORMS.uCsTex2.value = cloudShadow.rtOld.texture;
const touchdown = new TouchdownReporter();
const traffic = new Traffic(scene, geo, BASE); traffic.enabled = settings.traffic !== false; traffic.onFail = (message) => toast(message || 'Live traffic unavailable', true);
// ---------- clickable cockpit: throttle levers (drag), gear lever, A/P ENGAGED lamp, chute and brake lamps on the panel ----------
const pickRay = new THREE.Raycaster(), pickNdc = new THREE.Vector2(), pickDrag = { on: false, y0: 0, t0: 0 };
const PANEL_HOT = [ // canvas rects on the 2048x1152 instrument texture: [x0, y0, x1, y1, action, label]
  [430, 1015, 560, 1115, 'gear', 'Landing gear'], [1588, 20, 1716, 96, 'ap', 'Autopilot'], [1289, 1045, 1381, 1100, 'chute', 'Drag chute'],
];
function cockpitPick(ev) {
  const real = visual.real; if (rig.view !== 'cockpit' || !real || !state.started || state.pending) return null;
  const r = renderer.domElement.getBoundingClientRect(); pickNdc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  pickRay.setFromCamera(pickNdc, camera);
  const targets = [...real.pick.panels]; for (const t of real.pick.throttles) t.traverse((o) => { if (o.isMesh) targets.push(o); });
  const hit = pickRay.intersectObjects(targets, false)[0]; if (!hit) return null;
  if (hit.object.userData.thr) return { kind: 'throttle' };
  if (hit.uv) { const cx = hit.uv.x * 2048, cy = (1 - hit.uv.y) * 1152; for (const h of PANEL_HOT) if (cx >= h[0] && cx <= h[2] && cy >= h[1] && cy <= h[3]) return { kind: h[4], label: h[5] }; }
  return null;
}
const cvs = renderer.domElement;
cvs.addEventListener('pointerdown', (ev) => {
  const h = cockpitPick(ev); if (!h) return;
  if (h.kind === 'throttle') { rig.blockDrag = true; pickDrag.on = true; pickDrag.y0 = ev.clientY; pickDrag.t0 = controls.throttle; cvs.setPointerCapture(ev.pointerId); controls.touched = true; ev.preventDefault(); return; }
  if (h.kind === 'gear') controls.handlers.gear && controls.handlers.gear(); else if (h.kind === 'ap') toggleAp(); else if (h.kind === 'chute') controls.handlers.chute && controls.handlers.chute();
  ev.preventDefault();
});
cvs.addEventListener('pointermove', (ev) => {
  if (pickDrag.on) { controls.throttle = Math.max(0, Math.min(1, pickDrag.t0 - (ev.clientY - pickDrag.y0) / (innerHeight * 0.3))); controls.touched = true; return; }
  const now = performance.now(); if (now - (state.hoverAt || 0) < 120) return; state.hoverAt = now;
  const h = cockpitPick(ev); cvs.style.cursor = h ? (h.kind === 'throttle' ? 'ns-resize' : 'pointer') : ''; if (h && h.label) cvs.title = h.label; else cvs.removeAttribute('title');
});
cvs.addEventListener('pointerup', () => { pickDrag.on = false; });
cvs.addEventListener('pointercancel', () => { pickDrag.on = false; });
const blast = new JetBlast(scene), _nz = new THREE.Vector3(), _aft = new THREE.Vector3();
function tourEngage(t) {
  const put = (k, v) => { apInputs[k].value = v; apEdited.add(k); };
  put('alt', Math.round(t.alt * (settings.metric ? 1 : FT))); put('hdg', t.hdg);
  if (t.mach) { put('mach', t.mach); ap.modes.spd = false; ap.modes.mach = true; } else { put('spd', t.spdKt); ap.modes.spd = true; ap.modes.mach = false; }
  ap.modes.alt = true; ap.modes.vs = false; ap.modes.hdg = true; ap.modes.nav = false;
  if (t.keepOn) { readAp(); syncAp(); } else { engageAp(); syncAp(); }
  ap.target.vsLimit = 55;
}
function clearBeacons() { beacons.forEach((b) => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }); beacons = []; }
function clearMission() { tour.stop(); tutorial.stop(); coachHidden = false; renderCoach(null); mission = null; clearBeacons(); $('mission').hidden = true; }
function startMission() {
  clearMission();
  const s = state.lastSpawn && state.lastSpawn.s;
  if (!s) return;
  if (missionKind === 'tour') { tour.start(s.hdg); return; }
  if (missionKind === 'tutorial') { tutorial.start(tutorialCtx()); return; }
  mission = createMission(missionKind, { lat: s.lat, lon: s.lon, hdg: s.hdg });
  if (!mission) return;
  toast(`${MISSIONS[missionKind].name}: ${MISSIONS[missionKind].blurb}`);
  if (missionKind === 'landassist') { // the autopilot takes the ILS down to minimums, the pilot lands it
    ap.modes.appr = true; ap.modes.spd = true; ap.modes.mach = false; apInputs.spd.value = 180; apEdited.add('spd'); engageAp(); syncAp();
  }
  if (missionKind === 'recon') {
    nav.clear && nav.clear();
    for (const t of mission.targets) {
      nav.add({ lat: t.lat, lon: t.lon, name: t.name });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(220, 220, 7000, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.28, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      mesh.frustumCulled = false; scene.add(mesh); beacons.push({ mesh, t });
    }
  }
}
function updateMission(dt) {
  for (const b of beacons) {
    const p = geo.toXZ(b.t.lat, b.t.lon);
    b.mesh.position.set(p.x, groundAt(p.x, p.z) + 3400, p.z);
    b.mesh.material.color.setHex(b.t.score == null ? 0xffa030 : b.t.score ? 0x6be3a0 : 0xff6b5c);
  }
  if (tutorial.active && !state.paused) renderCoach(tutorial.update(dt, tutorialCtx()));
  if (!mission || state.paused || state.pending) return;
  const ll = aircraftLatLon(), att = attitude(fdm.quat), n = state.navOut || {};
  const ev = mission.update(dt, { lat: ll.lat, lon: ll.lon, hdg: att.heading, M: fdm.out.M || 0, alt: fdm.pos.y,
    agl: n.ilsValid ? n.agl : fdm.pos.y - state.lastGround, vy: fdm.vel.y, onGround: fdm.onGround, iasKt: ias() * KT, gs: fdm.vel.length(), throttle: fdm.throttle,
    crashed: fdm.crashed, gearDown: fdm.gearDown, chute: fdm.chuteOpen || 0, pitchDeg: att.pitch * 180 / Math.PI, vrefKt: vrefEas(fdm.mass) * KT, ilsValid: !!n.ilsValid, gsDev: n.gsDev || 0, locXtk: n.locXtk || 0, thrDist: n.thrDist || 0, apOn: ap.on });
  if (ev) { toast(ev.text); if (ev.toast) toast(ev.toast); if (ev.event === 'done') audio.play('gear-lock'); }
  if (mission.coach) renderCoach(mission.coach());
  missionAcc += dt;
  if (missionAcc > 0.25) {
    missionAcc = 0; const hud = mission.hud();
    $('mission').hidden = false; $('mission').classList.toggle('done', !!hud.done);
    $('mission').querySelector('.m-title').textContent = hud.title; $('mission').querySelector('.m-body').innerHTML = hud.lines.join('');
  }
}

// ---------- airports sheet ----------
let aptFilter = 'near';
seg('apt-filter', (v) => { aptFilter = v; renderAptList(); });
$('apt-q').addEventListener('input', () => renderAptList());
$('apt-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur(); else e.stopPropagation(); });
function renderAptList() {
  if (!db.ready) return;
  const q = $('apt-q').value;
  let items;
  if (aptFilter === 'near' && !q.trim()) { const ll = aircraftLatLon(); items = db.near(ll.lat, ll.lon, 400).slice(0, 40).map((x) => x.a); }
  else items = db.search(q, aptFilter === 'near' ? 'all' : aptFilter, 80);
  $('apt-count').textContent = `${db.list.length.toLocaleString()} airports`;
  $('apt-list').innerHTML = items.map((a, i) => `<div class="res" role="button" tabindex="0" data-i="${i}"><b>${esc(a.ident)}</b><div class="nm">${esc(a.name)}<small>${esc(aptPlace(a))}</small></div><div class="rw ${a.mil ? 'mil' : ''}">${fmtLen(a.longest.len)}</div></div>`).join('') || '<div class="sub" style="padding:12px">No airports found</div>';
  $('apt-list').querySelectorAll('.res').forEach((el) => {
    el.addEventListener('click', () => showAirport(items[+el.dataset.i]));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAirport(items[+el.dataset.i]); } });
  });
}
function showAirport(a) {
  const box = $('apt-detail'); box.className = 'card'; box.innerHTML = airportDetail(a, false); bindActions(box, a);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- map & route ----------
const mapPanel = new MapPanel($('map'), db, nav, {
  onAirport: (a) => { const box = $('map-apt'); box.className = 'card'; box.innerHTML = airportDetail(a, true) + `<div class="lbl">Arrival</div><div class="chips">${a.runways.flatMap((r, i) => r.ends.map((e, k) => `<button class="endbtn" data-act="ils:${i}:${k}">ILS ${e.ident}</button>`)).join('')}</div>`; bindActions(box, a); },
  addWaypoint: (lat, lon) => nav.add({ lat, lon, name: `WP${nav.wps.length + 1}` }),
  directTo: (lat, lon) => { nav.directTo({ lat, lon, name: 'DCT' }, aircraftLatLon()); toast('Direct to waypoint'); },
  teleport: (lat, lon) => openTeleport(lat, lon),
});
// ---------- moving map (N): a compact navigation display that stays up while flying, in the cockpit or outside ----------
const cmap = new CockpitMap(document.body, db, { onPickAirport: (a) => { openSheet('airports'); showAirport(a); }, onClose: () => { settings.cmap = false; saveSettings(); } });
controls.on('cockpitMap', () => { settings.cmap = cmap.toggle(); saveSettings(); });
// ---------- teleport dialog: altitude, heading, speed, climb angle, gear and an autopilot hold, prefilled from the flight (or the type's cruise) ----------
const autobrake = new Autobrake();
const TP_KIAS = IS_C172 ? [50, 160] : IS_SF50 ? [80, 300] : IS_IL76 ? [110, 320] : [150, 450]; // what each type can fly at the far end
const TP_PRESETS = IS_C172 ? [['Cruise', 8000, 105, 0, false], ['Pattern', 1500, 80, 0, false], ['Final', 1000, 70, -3, true]]
  : IS_SF50 ? [['Cruise FL250', 25000, 180, 0, false], ['Approach', 3000, 140, 0, true], ['Final', 1500, 100, -3, true]]
    : IS_IL76 ? [['FL330 cruise', 33000, 245, 0, false], ['Approach', 4000, 180, 0, true], ['Final', 1500, 148, -3, true]]
      : [['Mach 3.2 cruise', 80000, 340, 0, false], ['Subsonic', 25000, 320, 0, false], ['Approach', 3000, 200, -3, true]];
const tp = { lat: 0, lon: 0 };
function openTeleport(lat, lon) {
  Object.assign(tp, { lat, lon });
  const flying = state.started && !fdm.onGround && !fdm.crashed, u = settings.metric ? 1 : FT;
  const def = TP_PRESETS[0], alt = flying ? fdm.pos.y * FT : def[1], kias = flying ? Math.round(ias() * KT) : def[2];
  $('tp-alt-u').textContent = settings.metric ? 'm MSL' : 'ft MSL'; $('tp-alt').step = settings.metric ? 100 : 500;
  $('tp-alt').value = Math.round((alt / FT) * u / 100) * 100; $('tp-hdg').value = Math.round(attitude(fdm.quat).heading) % 360;
  $('tp-spd').value = Math.min(TP_KIAS[1], Math.max(TP_KIAS[0], kias)); $('tp-gam').value = 0; $('tp-gear').checked = false; $('tp-ap').checked = !IS_C172 && flying && ap.on;
  $('tp-ap').parentElement.style.display = IS_C172 ? 'none' : '';
  $('tp-where').textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
  $('tp-quick').innerHTML = TP_PRESETS.map((p, i) => `<button type="button" class="ghost" data-i="${i}">${esc(p[0])}</button>`).join('');
  $('tp-quick').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const p = TP_PRESETS[+b.dataset.i];
    $('tp-alt').value = Math.round((p[1] / FT) * u / 100) * 100; $('tp-spd').value = p[2]; $('tp-gam').value = p[3]; $('tp-gear').checked = p[4]; }));
  $('tp').hidden = false; controls.enabled = false; setTimeout(() => $('tp-alt').focus(), 0);
}
function closeTeleport() { $('tp').hidden = true; controls.enabled = state.started; }
$('tp-cancel').addEventListener('click', closeTeleport);
$('tp').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeTeleport(); });
$('tp').addEventListener('pointerdown', (e) => { if (e.target === $('tp')) closeTeleport(); });
$('tp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
  const alt = Math.max(150, num('tp-alt', 10000) / (settings.metric ? 1 : FT)), hdg = ((num('tp-hdg', 0) % 360) + 360) % 360;
  const kias = Math.min(TP_KIAS[1], Math.max(TP_KIAS[0], num('tp-spd', TP_KIAS[0]))), gamma = Math.max(-20, Math.min(30, num('tp-gam', 0)));
  const speed = kias / KT / Math.sqrt(isa(alt).rho / 1.225); // KIAS (about EAS) to true airspeed at that height
  const gear = $('tp-gear').checked, hold = $('tp-ap').checked && !IS_C172;
  closeTeleport(); openSheet(null);
  spawn({ lat: tp.lat, lon: tp.lon, alt, hdg, speed, ground: false, gamma });
  fdm.gearDown = gear; fdm.gearPos = gear ? 1 : 0; state.apAfterSpawn = hold;
  toast(`Teleported: ${Math.round(settings.metric ? alt : alt * FT).toLocaleString()} ${settings.metric ? 'm' : 'ft'}, ${Math.round(hdg)}°, ${Math.round(kias)} KIAS`);
  if (state.started) { if (missionSurvivesTeleport(missionKind)) startMission(); else { clearMission(); toast(`${MISSIONS[missionKind] ? MISSIONS[missionKind].name : 'Mission'} ended by the teleport`); } }
});
// live ADS-B on the map: "Fly alongside" puts the jet 450 m behind and 120 m right of a real aircraft, at its altitude, track and speed
// (clamped to what this type can fly)
const ALONGSIDE_MS = IS_C172 ? [28, 64] : IS_SF50 ? [55, 160] : IS_IL76 ? [70, 240] : [130, 950];
function flyAlongside(e) {
  if (!state.started || state.pending || e.alt == null) return;
  const back = destination(e.lat, e.lon, (e.trk + 180) % 360, 450), at = destination(back.lat, back.lon, (e.trk + 90) % 360, 120);
  const speed = Math.min(ALONGSIDE_MS[1], Math.max(ALONGSIDE_MS[0], e.gs / KT));
  spawn({ lat: at.lat, lon: at.lon, alt: Math.max(150, e.alt / FT), hdg: e.trk, speed, ground: false });
  fdm.gearDown = false; fdm.gearPos = 0; openSheet(null);
  toast(`Alongside ${e.call || e.reg || e.hex.toUpperCase()}${e.type ? ' · ' + e.type : ''}`);
  if (missionSurvivesTeleport(missionKind)) startMission(); else { clearMission(); toast(`${MISSIONS[missionKind] ? MISSIONS[missionKind].name : 'Mission'} ended by the move`); }
}
mapPanel.attachLive({ base: BASE, settings, save: () => saveSettings(), ownship: () => (state.started ? aircraftLatLon() : null),
  canFlyTo: () => state.started && !state.pending && !fdm.crashed, onFlyAlongside: flyAlongside, onFollowStop: () => mapPanel.setFollow(false) });
function renderRoute() {
  const ll = state.started ? aircraftLatLon() : null;
  let prev = ll;
  const html = nav.wps.map((w, i) => {
    const d = prev ? haversine(prev.lat, prev.lon, w.lat, w.lon) / NM : 0; prev = w;
    return `<li class="${i === nav.active ? 'active' : ''}"><div class="nm">${esc(w.name)}<small>${d.toFixed(0)} NM</small></div><div class="ops"><button data-op="go:${i}" title="Fly direct">→</button><button data-op="up:${i}">↑</button><button data-op="dn:${i}">↓</button><button data-op="rm:${i}">✕</button></div></li>`;
  }).join('') || '<div class="sub">Click the map or use "Add to route" on an airport.</div>';
  // written only when it changed (it was rebuilt with fresh listeners every 0.5 s); the clicks go through one delegated listener below
  const list = $('route-list'); if (list._html !== html) list.innerHTML = list._html = html;
  const tot = ll && nav.wps.length ? nav.totalNm(ll) : 0, gs = Math.hypot(fdm.vel.x, fdm.vel.z);
  $('route-sum').textContent = nav.wps.length ? `${tot.toFixed(0)} NM to go${gs > 30 ? ` · ETE ${Math.floor(tot * NM / gs / 60)} min at ${Math.round(gs * KT)} kt GS` : ''}` : '';
  const arr = nav.arrival;
  $('arr-box').textContent = arr ? `${arr.rwy.ap.ident} runway ${arr.rwy.ends[arr.end].ident} — ${arr.rwy.ils(arr.end) || 'visual'} · ${fmtLen(arr.rwy.len)}` : 'None — choose one from an airport';
}
nav.onChange(renderRoute);
$('route-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-op]'); if (!b) return; const [op, i] = b.dataset.op.split(':');
  if (op === 'go') nav.activate(+i, aircraftLatLon()); else if (op === 'up') nav.move(+i, -1); else if (op === 'dn') nav.move(+i, 1); else nav.remove(+i);
});
$('route-clear').addEventListener('click', () => nav.clear());
$('route-nav').addEventListener('click', () => {
  if (!nav.wps.length) { toast('Add waypoints first', true); return; }
  ap.modes.nav = true; ap.modes.hdg = false;
  if (!ap.on && !fdm.onGround) engageAp(); syncAp(); toast('Autopilot NAV: following the route');
  // at Mach 3 the turn radius is over a hundred miles, which looks like the autopilot ignoring the waypoint
  const gs = Math.hypot(fdm.vel.x, fdm.vel.z), w = nav.wps[nav.active], here = aircraftLatLon();
  if (gs > 150 && w) {
    const r = gs * gs / (9.80665 * Math.tan(((fdm.out.M || 0) > 1 ? 35 : 25) * D2R)), d = Math.abs(((bearing(here.lat, here.lon, w.lat, w.lon) - attitude(fdm.quat).heading + 540) % 360) - 180);
    if (d > 20) toast(`Turn of ${Math.round(d)}° at ${Math.round(gs * KT)} kt: radius about ${Math.round(r / NM)} NM, roughly ${Math.max(1, Math.round(r * d * D2R / gs / 60))} min. A wide arc is normal at this speed.`);
  }
});

// ---------- autopilot sheet ----------
const apInputs = { hdg: $('ap-hdg'), alt: $('ap-alt'), vs: $('ap-vs'), spd: $('ap-spd'), mach: $('ap-mach'), vsl: $('ap-vsl') };
// targets the pilot has set since the last engage; the rest are synced to the current flight on engage
const apEdited = new Set();
// floor: the pilot typed or dialled a value, so keep an altitude target at least 150 m above the ground under the jet (there was no floor: 0 ft was accepted)
function readAp(floor) {
  // an empty, negative or non-numeric box keeps the target it had and shows it again (an empty ALT box used to mean a 0 ft target)
  const num = (k, lo) => { const v = apInputs[k].value === '' ? NaN : +apInputs[k].value; return Number.isFinite(v) && v >= lo ? v : null; };
  const v = { hdg: num('hdg', -1e6), alt: num('alt', 0), vs: num('vs', -1e6), spd: num('spd', 60), mach: num('mach', 0.3), vsl: num('vsl', 0) }, t = ap.target;
  if (v.hdg !== null) t.hdg = ((v.hdg % 360) + 360) % 360;
  if (v.alt !== null) t.alt = Math.min(IS_SF50 ? 31000 / FT : IS_IL76 ? IL76.CEILING : 30000, v.alt / (settings.metric ? 1 : FT));
  if (v.vs !== null) t.vs = v.vs / 196.85;
  if (v.spd !== null) t.spd = v.spd / KT;
  if (v.mach !== null) t.mach = v.mach;
  if (v.vsl !== null) t.vsLimit = Math.max(500, v.vsl) / 196.85;
  const bad = Object.keys(v).filter((k) => v[k] === null);
  if (floor && v.alt !== null && t.alt < state.lastGround + 150) { t.alt = state.lastGround + 150; bad.push('alt'); }
  if (bad.length) writeApInputs(bad);
}
// Whenever code sets ap.target directly (take-off hand-off, go-around, climb to cruise, spawn) the boxes must show it too: the next readAp() (any mode
// button or dial click) read the stale boxes back, and after an auto take-off one click reset the 30,000 ft target to 500 ft and flew the jet into terrain.
const AP_KEYS = Object.keys(apInputs);
function writeApInputs(keys = AP_KEYS) {
  const t = ap.target, v = { hdg: Math.round(t.hdg) % 360, alt: Math.round(t.alt * (settings.metric ? 1 : FT) / 100) * 100, vs: Math.round(t.vs * 196.85 / 100) * 100,
    spd: Math.round(t.spd * KT), mach: (+t.mach).toFixed(2), vsl: Math.round(t.vsLimit * 196.85 / 100) * 100 };
  for (const k of keys) apInputs[k].value = v[k];
}
const AP0 = new Autopilot(IS_SF50 ? SF50_AP : IS_IL76 ? IL76_AP : undefined); // factory modes and targets
function resetApState() { ap.disengage(); Object.assign(ap.modes, AP0.modes); Object.assign(ap.target, AP0.target); apEdited.clear(); writeApInputs(); syncAp(); }
Object.entries(apInputs).forEach(([k, el]) => {
  el.addEventListener('change', () => { apEdited.add(k); readAp(true); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.blur(); else e.stopPropagation(); });
});
document.querySelectorAll('.dial').forEach((d) => d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  // altitude steps are in feet; in metric 500 ft / 5000 ft become 100 m / 1000 m
  const step = (+b.dataset.d) * (d.dataset.k === 'alt' && settings.metric ? 0.2 : 1);
  const inp = d.querySelector('input'); let v = (+inp.value) + step;
  if (d.dataset.k === 'hdg') v = ((v % 360) + 360) % 360;
  if (d.dataset.k === 'mach') v = Math.max(0.3, Math.round(v * 100) / 100);
  inp.value = v; apEdited.add(d.dataset.k); readAp(true);
})));
const MODE_GROUPS = { hdg: ['hdg', 'nav'], nav: ['hdg', 'nav'], alt: ['alt', 'vs', 'flch'], vs: ['alt', 'vs', 'flch'], flch: ['alt', 'vs', 'flch'], spd: ['spd', 'mach'], mach: ['spd', 'mach'] };
document.querySelectorAll('#ap-modes button').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.m, on = !ap.modes[m];
  if (on && MODE_GROUPS[m]) MODE_GROUPS[m].forEach((x) => { ap.modes[x] = false; });
  ap.modes[m] = on;
  if (m === 'nav' && on && !nav.wps.length) { ap.modes.nav = false; ap.modes.hdg = true; toast('No flight plan — add waypoints on the Map', true); }
  if (m === 'appr' && on && !nav.arrival) { ap.modes.appr = false; toast('Tune an ILS first: \\ for the runway ahead, or Airports → ILS', true); }
  else if (m === 'appr' && on && !ap.on && !fdm.onGround) engageAp(); // armed APPR without the A/P flew nothing (FLCH already engaged it)
  if (m === 'flch' && on) { if (!ap.on) engageAp(); if (!ap.modes.spd && !ap.modes.mach) ap.modes.spd = true; }
  if (m === 'vs' && on) apInputs.vs.value = Math.round(fdm.vel.y * 196.85 / 100) * 100;
  readAp(); approachSpeedFloor(); syncAp();
}));
function syncApTargets(keys) {
  const att = attitude(fdm.quat);
  const val = { hdg: Math.round(att.heading) % 360, alt: Math.round(fdm.pos.y * (settings.metric ? 1 : FT) / 100) * 100,
    spd: Math.round(apIas() * KT), mach: (fdm.out.M || 0).toFixed(2), vs: Math.round(fdm.vel.y * 196.85 / 100) * 100 };
  for (const k of keys) apInputs[k].value = val[k];
  readAp();
}
const APPROACH_KT = IS_SF50 ? 100 : IS_IL76 ? 145 : 180; // below this the Blackbird is behind the power curve and cannot hold the glideslope (Vision Jet: about VREF + 10)
function approachSpeedFloor() {
  if (!ap.modes.appr) return;
  if (+apInputs.spd.value < APPROACH_KT) { apInputs.spd.value = APPROACH_KT; readAp(); }
  if (!ap.modes.spd && !ap.modes.mach) ap.modes.spd = true;
}
function engageAp() {
  if (IS_C172) { toast('This Skyhawk has no autopilot fitted: trim with ; and \' and fly by hand', true); return; }
  if (fdm.onGround) { toast('Autopilot needs to be airborne', true); return; }
  takeoff.stop(); // the take-off aid kept writing full power and its own elevator under the autopilot
  // like the real jet, engaging holds the current flight unless the pilot preset a target
  syncApTargets(['hdg', 'alt', 'spd', 'mach', 'vs'].filter((k) => !apEdited.has(k)));
  apEdited.clear();
  approachSpeedFloor();
  // hold the current speed too, or the jet bleeds off airspeed (and then altitude) as soon as the autopilot takes over
  if (!ap.modes.spd && !ap.modes.mach) { const fast = (fdm.out.M || 0) > 1; ap.modes[fast ? 'mach' : 'spd'] = true; }
  ap.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle }); toast('Autopilot engaged');
}
let lastApProt = '';
// Flight assist: while the stick is let go the jet is held by the autopilot's inner loops (wings level, vertical speed eased to zero over ~10 s, stall /
// overspeed protection on), and the pilot's input takes over the instant the stick moves. The plain flight model is a handful at altitude and Mach, where
// one tap on the stick starts a phugoid; this makes "let go" a safe thing to do. Off in the options for the raw aircraft.
const assist = Object.assign(new Autopilot(), { idleFor: 0, t: 0, vs0: 0 });
assist.release = function () { if (this.on) { this.disengage(); } this.idleFor = 0; };
// Landing aid: gear down and below 150 ft with a sink rate, the elevator follows a flare profile (see flareSink). The pilot's pitch input takes over at once.
const landAid = new Autopilot();
function landingAid(dt) {
  const a = landAid, agl = fdm.pos.y - state.lastGround - CG_H;
  const on = !state.slew && !state.paused && landingAidOn({ enabled: settings.landAid, onGround: fdm.onGround, crashed: fdm.crashed, gearPos: fdm.gearPos, agl, vs: fdm.vel.y,
    iasKt: ias() * KT, pitch: controls.axes.pitch, latched: a.on });
  if (!on) { if (a.on) a.disengage(); return; }
  if (!a.on) { a.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle }); Object.keys(a.modes).forEach((k) => { a.modes[k] = false; }); a.modes.vs = true; a.target.vsLimit = 20; a.tauV = 1.6; a.kiDiv = 8; }
  a.target.vs = flareSink(agl);
  const c = a.update(dt, { fdm, out: fdm.out, att: attitude(fdm.quat), vs: fdm.vel.y, alt: fdm.pos.y, ias: ias(), nav: {}, agl });
  fdm.ctrl.de = c.de;
  // below 12 m the aid levels the wings too (2-6° of bank at touchdown put a nozzle on the runway) unless the pilot is rolling, and flies the flare
  // power, easing to idle in the last 3 m, until the pilot moves the throttle (the latched aid held the jet off at 45 % power and it floated)
  if (agl < 12 && Math.abs(controls.axes.roll) < 0.5) { const w = Math.min(1, (12 - agl) / 8); fdm.ctrl.da = fdm.ctrl.da * (1 - w) + c.da * w; }
  if (c.thrOverride) { controls.throttle = c.th; fdm.throttle = c.th; }
}
// Skyhawk hands-off assist: with the roll keys let go the ailerons level the wings, with the rudder keys let go the rudder keeps the ball
// centred in the air and the nose wheel holds the heading on the ground. Without it the engine's torque and P-factor roll and yaw the
// aircraft left at climb power (as in a real one, which the pilot holds with right rudder and aileron) and it drifts off in a slow turn.
// Each axis eases in over half a second after it is let go, and is the pilot's again the moment a key moves it. See gaControlFrame.
// Easy mode envelope protection: stall, g, pitch and bank limits on the pilot's commands (difficulty.js)
const envProt = {};
function envelopeGuard(dt) {
  if (settings.mode !== 'easy' || fdm.crashed || state.slew || state.paused) { resetProtect(envProt); return; }
  const out = fdm.out, M = out.M || 0, flaps = fdm.flaps || 0;
  // C172 / SF50: the wing's stall angle for the flap setting; SR-71: the 15° stall-warning angle
  const aStall = IS_C172 ? c172StallAlpha(flaps) : IS_SF50 ? sf50StallAlpha(flaps, M) : IS_IL76 ? il76StallAlpha(flaps, fdm.slats || 0, M, fdm.mx.clmax) : 0.26;
  const nzMax = IS_C172 ? C172.NZ_LIMIT : IS_SF50 ? (flaps > 1 ? SF50.NZ_FLAP_LIMIT : SF50.NZ_LIMIT) : IS_IL76 ? (flaps > 1 ? IL76.NZ_FLAP_LIMIT : IL76.NZ_LIMIT) : 3.5;
  const nzMin = IS_C172 ? -1.52 : IS_SF50 ? (flaps > 1 ? 0 : SF50.NZ_NEG_LIMIT) : IS_IL76 ? (flaps > 1 ? IL76.NZ_FLAP_NEG : IL76.NZ_NEG_LIMIT) : -1.5;
  const att = attitude(fdm.quat), auth = STICK_GA ? c172PitchAuthority((IS_SF50 || IS_IL76 ? casMs() : ias()) * KT, IS_SF50 ? SF50_STICK : IS_IL76 ? IL76_STICK : C172_STICK) : stickGearing(1, out.qbar || 0, M, 0);
  envelopeProtect(fdm.ctrl, { alpha: out.alpha || 0, aOn: aStall - PROT_A_ON, aMax: aStall - PROT_A_MAX, nz: out.nz || 1, nzMax, nzMin,
    pitch: att.pitch, bank: att.bank, auth, onGround: fdm.onGround, dt }, envProt);
}
function flightAssist(dt) {
  const a = assist, ax = controls.axes;
  if (!settings.assist || fdm.onGround || fdm.crashed || state.slew || state.paused || (fdm.out.V || 0) < 60) { a.release(); return; }
  if (Math.abs(ax.pitch) > 0.02 || Math.abs(ax.roll) > 0.02 || controls.manual) { a.release(); return; }
  a.idleFor += dt;
  if (!a.on) {
    if (a.idleFor < 0.35) return;
    a.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle }); Object.keys(a.modes).forEach((k) => { a.modes[k] = false; }); a.modes.vs = true;
    a.t = 0; a.vs0 = Math.max(-40, Math.min(40, fdm.vel.y)); a.target.vsLimit = 60;
  }
  a.t += dt; a.target.vs = a.vs0 * Math.exp(-a.t / 10);
  const c = a.update(dt, { fdm, out: fdm.out, att: attitude(fdm.quat), vs: fdm.vel.y, alt: fdm.pos.y, ias: ias(), nav: {} });
  fdm.ctrl.de = c.de; fdm.ctrl.da = c.da; if (Math.abs(ax.yaw) < 0.02) fdm.ctrl.dr = c.dr;
}
const shAt = { v: null, n: 0 };
// an aborted take-off on the runway comes back to idle (it used to stay in full afterburner); cancelled in the air the pilot keeps the power
function stopTakeoff(msg) { if (!takeoff.on) return; takeoff.stop(); if (fdm.onGround) { controls.throttle = 0; fdm.throttle = 0; } if (msg) toast(msg); }
function startTakeoff() {
  if (IS_C172) { toast('Auto take-off is for the SR-71. Skyhawk: full throttle, rotate at 55 KIAS, climb at 74', true); return; }
  if (IS_SF50) { toast('Auto take-off is for the SR-71. Vision Jet: flaps 50 %, full thrust, rotate at 90 KIAS, gear up, climb at 120', true); return; }
  if (IS_IL76) { toast('Auto take-off is for the SR-71. Il-76: T/O slats and flaps, full thrust, rotate at 171 KIAS (210 t), gear up, climb at 450 km/h', true); return; }
  if (takeoff.on) { stopTakeoff('Auto take-off cancelled'); return; }
  // live values, not fdm.out: out.ias and onGround are only refreshed when the sim steps, so after a respawn or while paused they still hold the previous flight
  const agl0 = fdm.pos.y - state.lastGround - CG_H, rolling = fdm.vel.length() * KT;
  if (state.pending) { toast('Wait for the runway to finish loading', true); return; }
  if (agl0 > 3 || rolling > 40) { toast(rolling > 40 ? 'Auto take-off needs the jet stopped on the runway' : 'Auto take-off needs the jet on the runway', true); return; }
  if (state.paused) pause(false);
  if (!fdm.gearDown) fdm.gearDown = true;
  fdm.parkingBrake = false; if (ap.on) { ap.disengage(); syncAp(); }
  takeoff.start(attitude(fdm.quat).heading); takeoff.altTarget = Math.max(1000, (+apInputs.alt.value) / (settings.metric ? 1 : FT) || 3000); controls.throttle = 1;
  toast('Auto take-off: full power. Any stick or brake input cancels it.');
}
function takeoffFrame(dt) {
  if (!takeoff.on) return false;
  // throttle pulled back (keys, lever, idle) cancels it too: the aid sets the throttle to 1 every frame, so anything lower is the pilot's
  if (fdm.crashed || state.paused || controls.manual || controls.brake > 0.05 || Math.abs(controls.axes.pitch) > 0.15 || controls.throttle < 0.98) { stopTakeoff('Auto take-off off'); return false; }
  const c = takeoff.update(dt, { fdm, ias: ias(), agl: fdm.pos.y - state.lastGround - CG_H });
  fdm.ctrl.de = c.de; fdm.ctrl.dr = c.dr; fdm.ctrl.da = 0; fdm.throttle = 1; controls.throttle = 1; fdm.brakes = 0;
  if (c.gearUp && fdm.gearDown) { fdm.gearDown = false; toast('Gear up'); }
  if (c.done) { // hand over to the autopilot's flight-level-change climb
    engageAp(); Object.keys(ap.modes).forEach((k) => { ap.modes[k] = false; }); ap.modes.flch = true; ap.modes.spd = true; ap.modes.hdg = true;
    ap.target.alt = takeoff.altTarget; ap.target.hdg = Math.round(attitude(fdm.quat).heading); ap.target.spd = 196; ap.target.vsLimit = 30; writeApInputs(); syncAp();
    toast('Climbing to ' + Math.round(takeoff.altTarget * 3.28084) + ' ft (FLCH)');
  }
  return true;
}
function goAround() {
  const agl = fdm.pos.y - state.lastGround - CG_H;
  if (fdm.onGround || fdm.crashed || agl < 3) { toast('Go-around is for an approach in the air', true); return; }
  takeoff.stop(); landAid.on && landAid.disengage(); fdm.parkingBrake = false;
  if (IS_SF50) { autoland.disarm(); state.alBrakes = 0; ap.vsOverride = null; ap.tauV = null; ap.kiDiv = null; if (fdm.flapCmd > 1) fdm.setFlaps(1); }
  if (IS_IL76 && fdm.flapCmd > 3) fdm.setFlaps(3); // landing flaps to the approach notch for the missed approach
  ap.startGoAround({ ctrl: fdm.ctrl, throttle: fdm.throttle }, attitude(fdm.quat), fdm.pos.y, ias());
  apEdited.clear(); writeApInputs(); syncAp(); toast('Go-around: full power, climbing');
}
function climbToCruise() {
  if (fdm.onGround) { toast('Take off first (T), then climb to cruise', true); return; }
  if (!ap.on) engageAp();
  Object.keys(ap.modes).forEach((k) => { ap.modes[k] = false; }); Object.assign(ap.modes, { flch: true, hdg: true, mach: true });
  if (IS_SF50) { Object.assign(ap.target, { alt: 28000 / FT, mach: 0.48, vsLimit: 3000 / 196.85, hdg: Math.round(attitude(fdm.quat).heading) }); writeApInputs(); syncAp(); toast('Climbing to FL280 on the climb schedule (175 falling to 140 KIAS), then Mach 0.48'); return; }
  if (IS_IL76) { Object.assign(ap.target, { alt: 33000 / FT, mach: 0.72, vsLimit: 2000 / 196.85, hdg: Math.round(attitude(fdm.quat).heading) }); writeApInputs(); syncAp(); toast('Climbing to FL330 at 450 km/h, then Mach 0.72'); return; }
  Object.assign(ap.target, { alt: 25900, mach: 3.2, vsLimit: 30, hdg: Math.round(attitude(fdm.quat).heading) });
  writeApInputs(); syncAp(); toast('Climbing to 85,000 ft at Mach 3.2: full power, then the cruise climb holds the Mach number');
}
$('ap-cruise').addEventListener('click', climbToCruise);
controls.on('goAround', goAround); $('ap-goaround').addEventListener('click', goAround);
controls.on('takeoff', startTakeoff); $('ap-takeoff').addEventListener('click', startTakeoff);
function toggleAp() { if (ap.on) { ap.disengage(); toast('Autopilot off'); } else engageAp(); syncAp(); }
$('ap-master').addEventListener('click', toggleAp);
$('ap-sync').addEventListener('click', () => { syncApTargets(['hdg', 'alt', 'spd', 'mach']); apEdited.clear(); });
function syncAp() {
  $('ap-master').textContent = ap.on ? 'Disengage autopilot' : 'Engage autopilot';
  $('ap-master').classList.toggle('off', ap.on);
  document.querySelectorAll('#ap-modes button').forEach((b) => {
    const m = b.dataset.m;
    b.classList.toggle('on', !!ap.modes[m] && (m !== 'appr' || ap.status.loc));
    b.classList.toggle('armed', m === 'appr' && ap.modes.appr && !ap.status.loc);
  });
  const lb = $('ap-land'); if (lb) { lb.classList.toggle('on', autoland.armed && ap.status.gs); lb.classList.toggle('armed', autoland.armed && !ap.status.gs); }
}
// ---------- Vision Jet: autopilot panel, autoland, Safe Return ----------
function sf50ApFrame(dt, att) {
  const agl = fdm.pos.y - state.lastGround - CG_H, arr = nav.arrival;
  const l = autoland.update(dt, { fdm, ap, nav: state.navOut, att, ias: casMs(), agl, rwyHdg: arr ? arr.rwy.ends[arr.end].hdg : null, rwyLen: arr ? arr.rwy.len : undefined,
    setFlaps: (n) => { fdm.setFlaps(n); toast(`Autoland: flaps ${['UP', '50 %', '100 %'][fdm.flapCmd]}`); }, setGear: (d) => { if (fdm.setGear(d)) toast(d ? 'Autoland: gear down' : 'Gear up'); } });
  state.alBrakes = 0;
  if (l) {
    for (const k of ['de', 'da', 'dr']) if (l[k] != null) fdm.ctrl[k] = l[k];
    if (l.th != null) { fdm.throttle = l.th; controls.throttle = l.th; }
    if (l.brakes != null) state.alBrakes = l.brakes;
    if (autoland.phase === 'goaround' || autoland.phase === 'hold') { ap.status.vert = autoland.msg; ap.status.lat = autoland.phase === 'hold' ? 'ORBIT' : 'HDG'; }
    if (autoland.phase === 'flare' || autoland.phase === 'rollout') { ap.status.vert = autoland.msg; ap.status.lat = autoland.phase === 'rollout' ? 'ROLLOUT' : 'LOC'; }
    for (const e of l.events) {
      if (e === 'flare') toast('Autoland: flare');
      else if (e === 'retard') toast('Autoland: retard — thrust idle');
      else if (e === 'goaround') toast(`${autoland.safeReturn ? 'Safe Return' : 'Autoland'}: go-around (${autoland.gaReason}): full power, flaps 50 %, gear up in the climb`, true);
      else if (e === 'goaround_done') toast(autoland.safeReturn ? 'Missed approach complete: holding altitude' : 'Missed approach complete: altitude hold, autopilot still on', true);
      else if (e === 'replan') safeReturn(autoland.attempt + 1);
      else if (e === 'hold') toast(`Safe Return: ${autoland.attempt + 1} approaches abandoned. Holding altitude in an orbit near the field. Touch the stick to fly it yourself.`, true);
      else if (e === 'touchdown') toast('Autoland: touchdown — braking');
      else if (e === 'stopped') {
        fdm.parkingBrake = true; controls.throttle = 0; fdm.throttle = 0; state.alBrakes = 0;
        ap.disengage(); autoland.disarm(); syncAp(); toast(autoland.safeReturn ? 'Safe Return complete: stopped on the runway, parking brake set' : 'Autoland complete: stopped, parking brake set (Shift+B releases it)', true);
      }
    }
  }
  // the trim servo only flies with the wheels off the ground; the rollout holds the elevator itself
  if (ap.on && !fdm.onGround) apTrimServo(ap, fdm, dt, SF50_TRIM_AUTH);
  if (ap.on && ap.ga && fdm.flapCmd > 0 && casMs() * KT > 115 && agl > 120) { fdm.setFlaps(0); toast('Flaps up'); } // AFM go-around: flaps up at 115 KIAS
}
function armAutoland() {
  if (autoland.armed) { autoland.disarm(); ap.vsOverride = null; ap.tauV = null; ap.kiDiv = null; toast('Autoland off'); syncAp(); return; }
  if (!nav.arrival) { toast('Choose an arrival runway first (Map → an airport → ILS), or use Safe Return', true); return; }
  if (fdm.onGround) { toast('Autoland arms in the air', true); return; }
  if (!ap.on) engageAp(); if (!ap.on) return;
  ap.modes.appr = true; autoland.arm();
  const e = nav.arrival.rwy.ends[nav.arrival.end];
  toast(`Autoland armed: ${nav.arrival.rwy.ap.ident} runway ${e.ident}. It configures, lands and brakes to a stop. Touch the stick to take over.`);
  writeApInputs(); syncAp();
}
function safeReturn(attempt = 0) {
  if (typeof attempt !== 'number') attempt = 0; // used directly as a click handler
  if (fdm.onGround || fdm.crashed) { toast('Safe Return works in the air', true); return; }
  if (!db.ready) { toast('Airport data still loading', true); return; }
  if (attempt === 0) state.srAvoid = [];
  const ll = aircraftLatLon(), p = planSafeReturn({ lat: ll.lat, lon: ll.lon, db, windDir: settings.windDir, windSpd: settings.windSpd, alt: fdm.pos.y, avoid: state.srAvoid,
    fuelKg: fdm.unlimitedFuel ? null : fdm.fuel, groundAt: (la, lo) => terrain.heightAt(la, lo) });
  if (!p) { toast('Safe Return: no suitable runway (paved, 1,000 m, within 200 km, clear of terrain)', true); return; }
  state.srAvoid.push(p.apt.ident + p.rwy.ends[p.end].ident);
  nav.clear(); for (const w of p.waypoints) nav.add({ lat: w.lat, lon: w.lon, name: w.name }); nav.setArrival(p.rwy, p.end);
  if (!ap.on) engageAp(); if (!ap.on) return;
  Object.keys(ap.modes).forEach((k) => { ap.modes[k] = false; }); Object.assign(ap.modes, { nav: true, appr: true, flch: true, spd: true });
  Object.assign(ap.target, { alt: p.fafAlt, spd: 180 / KT, vsLimit: 3000 / 196.85 });
  autoland.arm(true, attempt);
  const e = p.rwy.ends[p.end]; renderRoute(); writeApInputs(); syncAp();
  toast(`SAFE RETURN: landing at ${p.apt.ident} runway ${e.ident}, ${(p.dist / 1852).toFixed(0)} NM. The jet flies there, lands and stops. Touch the stick to take over.${attempt ? ` Approach ${attempt + 1} of 3.` : ''}${p.warnings.length ? ` Limits exceeded: ${p.warnings.join(', ')}.` : ''}`, true);
}
if (IS_SF50) {
  $('ap-heading').textContent = 'Autopilot (GFC 700, autothrottle)';
  $('ap-takeoff').hidden = true;
  $('ap-cruise').textContent = 'Climb to cruise: FL280 at Mach 0.48 (FLCH)';
  $('ap-goaround').textContent = 'Go-around (J): TO/GA, flaps 50 %, climb 1,500 ft, gear up';
  const land = document.createElement('button'); land.type = 'button'; land.id = 'ap-land'; land.textContent = 'AUTOLAND';
  land.title = 'Flies the selected arrival to a full stop: gear, flaps, flare, touchdown, braking (Shift+K)';
  land.addEventListener('click', armAutoland); $('ap-modes').appendChild(land);
  const sr = document.createElement('button'); sr.type = 'button'; sr.id = 'ap-safereturn'; sr.className = 'ghost wide';
  sr.textContent = 'SAFE RETURN (Shift+U): emergency autoland at the nearest suitable airport'; sr.addEventListener('click', safeReturn);
  $('ap-master').before(sr);
  const sp = document.querySelector('.dial[data-k="spd"] span'); if (sp) sp.title = 'Target calibrated airspeed (KIAS)';
  writeApInputs();
}
// cabin door (Shift+N): opens only stopped on the ground, and closes by itself if the jet starts to roll
controls.on('doors', () => {
  if (IS_IL76) { il76c.doors(); return; }
  if (!IS_SF50) { toast('Doors: Vision Jet and Il-76 only', true); return; }
  const open = visual.cabinDoor.cmd > 0;
  if (!open && (!fdm.onGround || Math.hypot(fdm.vel.x, fdm.vel.z) > 1)) { toast('The cabin door opens only when stopped on the ground', true); return; }
  visual.setDoors(!open); audio.play('gear-door', open ? 1 : -1); toast(open ? 'Cabin door closed' : 'Cabin door open');
});
// Il-76 only: spoilers and brake panels (2), thrust reverse (3), cargo hatch (4), paratroop doors (5)
for (const [id, fn] of [['spoilers', 'spoilers'], ['reverse', 'reverse'], ['cargo', 'cargo'], ['paratroop', 'paratroop']]) controls.on(id, () => (IS_IL76 ? il76c[fn]() : toast('This is an Il-76 control', true)));
controls.on('autoland', () => { if (IS_SF50) armAutoland(); else toast('Autoland is fitted to the Vision Jet', true); });
controls.on('safeReturn', () => { if (IS_SF50) safeReturn(); else toast('Safe Return is fitted to the Vision Jet', true); });

// ---------- views ----------
const VIEW_DESC = { cockpit: 'Pilot seat, live panel', chase: 'Behind the jet', orbit: 'Drag to orbit', tower: 'Nearest control tower', wing: 'Over the left wing', flyby: 'Watch it pass' };
$('view-grid').innerHTML = VIEWS.map((v) => `<button class="vcard" data-v="${v}"><b>${VIEW_NAMES[v]}</b><small>${VIEW_DESC[v]}</small></button>`).join('');
$('view-grid').querySelectorAll('.vcard').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
function setView(v) { rig.set(v); $('view-grid').querySelectorAll('.vcard').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }

// ---------- weather & settings ----------
function syncEnvUi() {
  const h = Math.floor(env.hour), m = Math.floor((env.hour % 1) * 60);
  const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  // don't fight a slider the user is dragging (the real-time clock calls this every 0.1 s)
  for (const id of ['tod', 'intro-tod']) if (document.activeElement !== $(id)) $(id).value = env.hour;
  $('tod-l').textContent = t; $('intro-tod-l').textContent = t;
  setClouds(settings.clouds);
  $('cloud-base').value = settings.cloudBase * FT; $('cb-l').textContent = fmtAlt(settings.cloudBase);
  $('wind-dir').value = settings.windDir; $('wind-spd').value = settings.windSpd * KT;
  $('wind-l').textContent = `${String(settings.windDir).padStart(3, '0')}° / ${Math.round(settings.windSpd * KT)} kt`;
  $('turb').value = settings.turb; $('turb-l').textContent = settings.turb < 0.15 ? 'light' : settings.turb < 0.45 ? 'moderate' : 'severe';
  $('vis').value = settings.vis; $('vis-l').textContent = `${Math.round(60 * settings.vis)} km`;
}
const setClouds = seg('clouds', (v) => { settings.clouds = +v; saveSettings(); });
$('tod').addEventListener('input', () => { env.hour = +$('tod').value; syncEnvUi(); });
$('tod-run').checked = !!settings.runClock;
$('tod-run').addEventListener('change', () => { settings.runClock = $('tod-run').checked; saveSettings(); });
$('cloud-base').addEventListener('input', () => { settings.cloudBase = +$('cloud-base').value / FT; syncEnvUi(); saveSettings(); });
$('wind-dir').addEventListener('input', () => { settings.windDir = +$('wind-dir').value; syncEnvUi(); saveSettings(); });
$('wind-spd').addEventListener('input', () => { settings.windSpd = +$('wind-spd').value / KT; syncEnvUi(); saveSettings(); });
$('turb').addEventListener('input', () => { settings.turb = +$('turb').value; syncEnvUi(); saveSettings(); });
$('vis').addEventListener('input', () => { settings.vis = +$('vis').value; syncEnvUi(); saveSettings(); });
function setApAltUnits() {
  const el = apInputs.alt.parentElement.querySelector('i');
  const metric = el.textContent === 'm';
  if (metric === settings.metric) return;
  const q = settings.metric ? 10 : 100;
  apInputs.alt.value = Math.round((+apInputs.alt.value) * (settings.metric ? 1 / FT : FT) / q) * q;
  apInputs.alt.step = settings.metric ? 100 : 500;
  el.textContent = settings.metric ? 'm' : 'ft';
}
const setUnits = seg('units', (v) => { settings.metric = v === 'met'; saveSettings(); syncEnvUi(); renderHome(); setApAltUnits(); });
// Graphics presets. detail: terrain split distance (in tile sizes); leaves: on-screen terrain tiles; dpr: [min, max] render
// scale; shadow: aircraft shadow map; env: reflection cube size; scenery: building/tree radius and triangle budget scale;
// ground: close-up ground detail; hiZ: first terrain level with 512 px (double resolution) imagery; texMB: terrain imagery GPU budget; post: post-processing (Low renders straight to the screen as before);
// world: sun shadow cascades [count, map size, cascade end distances in m]; vclouds: volumetric cloud march (null = billboard clouds).
// seg: terrain mesh cells per tile side (32; 40 on Ultra). High was 520 tiles x 48 cells (about 430 tiles, 2.1M triangles, 770 draw calls parked on a
// runway, CPU-bound on a laptop RTX 3050), Ultra 680 x 56.
// Round 4: Normal had more terrain leaves than High (420 vs 340: 684 vs 555 tiles parked in terrain-bench) and a costlier cloud march, so it never ran
// faster; Normal 260 leaves (462 tiles) with High's cloud cost or less, Low 200 (384 tiles, was 495).
const GFX = {
  low: { detail: 2.0, leaves: 200, seg: 32, dpr: [1, 1.5], shadow: 1024, env: 128, scenery: 0.8, ground: 0.85, hiZ: 99, texMB: 300,
    post: { enabled: false }, world: [0, 1024, []], vclouds: null },
  normal: { detail: 2.2, leaves: 260, seg: 32, dpr: [1, 1.5], shadow: 2048, env: 256, scenery: 1, ground: 1, hiZ: 17, texMB: 450,
    post: { enabled: true, msaa: 0, ao: 0.8, aoSamples: 8, bloom: 0.2, smaa: true }, world: [2, 1024, [120, 1200]], vclouds: { scale: 0.5, steps: 26, lightSteps: 4 } },
  high: { detail: 2.5, leaves: 300, seg: 32, dpr: [1, 1.5], shadow: 2048, env: 256, scenery: 1.2, ground: 1, hiZ: 15, texMB: 650,
    post: { enabled: true, msaa: 2, ao: 0.9, aoSamples: 8, bloom: 0.22, smaa: true }, world: [3, 2048, [60, 400, 2500]], vclouds: { scale: 0.55, steps: 30, lightSteps: 4 } },
  ultra: { detail: 3.0, leaves: 460, seg: 40, dpr: [1.25, 1.75], shadow: 3072, env: 256, scenery: 1.5, ground: 1, hiZ: 13, texMB: 900,
    post: { enabled: true, msaa: 2, ao: 1, aoSamples: 10, bloom: 0.22, smaa: true }, world: [3, 3072, [60, 450, 3000]], vclouds: { scale: 0.75, steps: 44, lightSteps: 4 } },
};
const LOW_REV_POST = { enabled: true, msaa: 0, ao: 0, aoSamples: 8, bloom: 0, smaa: true };
// Adaptive resolution: when frames run long the render scale steps down (to 60 % of the preset's), and back up when there
// is headroom. Checked every 1.5 s on the median frame time, so a single loading hitch does not trigger it.
const dynres = { base: 1, scale: 1, times: [], at: 0 };
// Render ratio = the preset's range around the screen's own ratio, times the render-resolution slider, capped at 3 so a 2x laptop screen at 200 %
// does not ask for 16x the pixels. The other costs are tied to the screen's own pixels, not to this ratio (see setRenderScale).
const MAX_RATIO = 3;
const baseRatio = (q) => Math.min(MAX_RATIO, Math.min(q.dpr[1], Math.max(q.dpr[0], devicePixelRatio)) * (settings.rscale || 1));
function setRenderScale() {
  const native = Math.max(1, devicePixelRatio || 1);
  let ratio = dynres.base * (settings.dynres ? dynres.scale : 1);
  // in the cockpit the panels and displays fill the screen at arm's length: adaptive resolution never takes them below the screen's own pixels
  if (rig.view === 'cockpit') ratio = Math.max(ratio, Math.min(dynres.base, native));
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  // Supersampling already gives 4+ samples per screen pixel at 2x: hardware MSAA on top of it only costs bandwidth (4 samples of a half-float
  // target at 4x the pixels). Keep it where the buffer is near native size, where it is the anti-aliasing.
  // from the preset's base ratio, not the adaptive one: dropping the resolution used to switch hardware MSAA on, which costs more than it saved
  const ss = dynres.base / native;
  post.msaaMax = ss >= 1.75 ? 0 : ss >= 1.25 ? 2 : 4;
  // the cloud march is soft, low-frequency work: march it at the screen's own resolution however far the picture is supersampled
  vclouds.nativeW = innerWidth * native; vclouds.nativeH = innerHeight * native;
  sizePost();
}
// Adaptive cloud resolution: the volumetric clouds are the most expensive single pass and look fine marched at a lower resolution, so under load
// they give up resolution first (down to 30 %) and the imagery, shadows and the rest keep full quality. Always on, independent of "adaptive resolution".
const cloudAdapt = { max: 0.6, scale: 0.6, times: [], at: 0, changed: 0 };
function adaptClouds(dt, now) {
  if (!post.clouds || state.paused || state.pending) { cloudAdapt.times.length = 0; return; }
  const A = cloudAdapt; A.times.push(dt);
  if (now - A.at < 2000 || A.times.length < 40) return;
  const t = A.times.sort((a, b) => a - b), med = t[t.length >> 1], p90 = t[(t.length * 0.9) | 0]; A.times.length = 0; A.at = now;
  const old = A.scale;
  if (med > 0.024 || p90 > 0.045) A.scale = Math.max(0.3, A.scale - (med > 0.034 ? 0.1 : 0.05));
  else if (med < 0.0185 && p90 < 0.022 && now - A.changed > 8000) A.scale = Math.min(A.max, A.scale + 0.05);
  if (A.scale !== old) { A.changed = now; vclouds.setScale(A.scale); }
}
const pressure = { level: 0, slowN: 0, fastN: 0 };
function adaptResolution(dt, now) {
  if (!settings.dynres || state.paused || state.pending) { dynres.times.length = 0; return; }
  dynres.times.push(dt);
  if (!dynReady(dynres.times.length, now - dynres.at)) return;
  const t = dynres.times.sort((a, b) => a - b), med = t[t.length >> 1], p90 = t[(t.length * 0.9) | 0];
  dynres.times.length = 0; dynres.at = now;
  const native = Math.max(1, devicePixelRatio || 1), old = dynres.scale;
  // the last step down did not make frames faster: they are CPU-bound (terrain, scenery, JS), where fewer pixels only blur the picture. Put the
  // resolution back and do not step down for 30 s.
  if (dynres.down && now - dynres.down.at < 5000) { if (med > dynres.down.med * 0.92) { dynres.cpuUntil = now + 30000; dynres.scale = dynres.down.from; dynres.changed = now; setRenderScale(); } dynres.down = null; }
  // a probe up that is followed by a step down within 15 s was too much: stay under that scale for a minute
  dynres.scale = nextScale({ scale: dynres.scale, base: dynres.base, changed: dynres.changed, noDown: now < (dynres.cpuUntil || 0), ceil: dynres.ceil, ceilUntil: dynres.ceilUntil }, med, p90, now, native, { ...DYN, floorNative: floorFor(pressure.level) });
  if (dynres.scale !== old) {
    if (dynres.scale < old) { if (dynres.upAt && now - dynres.upAt < 15000) { dynres.ceil = old; dynres.ceilUntil = now + 60000; } dynres.down = { at: now, med, from: old }; } else dynres.upAt = now;
    dynres.changed = now; setRenderScale();
  }
  // already at the floor and still slow: give up ambient occlusion, then half the shadow updates, before touching the picture itself
  const atFloor = dynres.scale * dynres.base <= floorFor(pressure.level) * native + 1e-3;
  const np = nextPressure(pressure, atFloor, med); Object.assign(pressure, np);
  if (np.drop && settings.autoGfx !== false) {
    // for this session only: the next start is back on the player's own preset (the automatic drop used to be saved for good)
    const lower = lowerPreset(state.gfxActive || settings.gfx);
    if (lower) {
      state.gfxActive = lower; setDetail(lower); applyGfx(lower); holdForShaders(); Object.assign(pressure, { level: 0, slowN: 0, fastN: 0 }); dynres.changed = now;
      toast(`Still under 30 fps at the lowest resolution: graphics set to ${lower[0].toUpperCase() + lower.slice(1)}. Change it under Settings.`, true);
    }
  }
}
let aoBase = 0.8, aoNow = 0.8;
function applyGfx(name) {
  const q = GFX[name] || GFX.high;
  terrain.detail = q.detail; terrain.leafCap = q.leaves; terrain.hiZ = q.hiZ; terrain.texCap = q.texMB * 2 ** 20;
  terrain.setSeg(q.seg);
  dynres.base = baseRatio(q); dynres.scale = 1;
  const sh = env.sun.shadow;
  if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); if (sh.map) { sh.map.dispose(); sh.map = null; } }
  if (env.envSize !== q.env) { env.envSize = q.env; env.envKey = ''; } // forces a reflection refresh
  buildings.radiusScale = trees.radiusScale = q.scenery;
  buildings.triBudget = 1.5e6 * q.scenery;
  TERRAIN_UNIFORMS.uDetail.value = q.ground;
  // Low picked after a reversed-depth load: the canvas depth is 24-bit, so the scene still goes through the float depth target (plain copy + SMAA) until a reload
  const pq = REV_DEPTH && !q.post.enabled ? LOW_REV_POST : q.post;
  post.configure(pq); aoBase = pq.ao || 0; aoNow = aoBase;
  wreck.setOverlay(pq.enabled ? post.overlay : null);
  if (visual.glassWater) { post.glassWater = visual.glassWater; visual.glassWater.setMode(pq.enabled ? 0 : 1); }
  rainField.attach(pq.enabled ? post.overlay : scene, pq.enabled);
  post.clouds = pq.enabled && q.vclouds ? vclouds : null;
  if (post.clouds) vclouds.setQuality(q.vclouds);
  vclouds.halfRate = !!settings.cloudHalfRate; // experimental, off by default (owner GPU check compares it)
  cloudAdapt.max = cloudAdapt.scale = q.vclouds ? q.vclouds.scale : 0.5;
  setRenderScale();
  shadows.configure(...q.world);
}
function rebase() { dynres.base = baseRatio(GFX[state.gfxActive || settings.gfx] || GFX.high); setRenderScale(); }
const setDetail = seg('detail', (v) => { settings.gfx = v; state.gfxActive = null; applyGfx(v); holdForShaders(); saveSettings(); });
const bindCheck = (id, key, fn) => { const el = $(id); el.checked = !!settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); fn && fn(el.checked); }); };
bindCheck('opt-strip', 'strip');
bindCheck('opt-buildings', 'buildings', (v) => { buildings.enabled = v; });
bindCheck('opt-trees', 'trees', (v) => { trees.enabled = v; });
bindCheck('opt-crash', 'crash');
bindCheck('opt-shake', 'shake');
bindCheck('opt-assist', 'assist', () => assist.release());
bindCheck('opt-rotassist', 'rotAssist', () => rotAssist.reset());
bindCheck('opt-handsoff', 'handsOff', resetHandsOff);
bindCheck('opt-autotrim', 'autoTrim');
bindCheck('opt-landaid', 'landAid', () => landAid.on && landAid.disengage());
bindCheck('opt-callouts', 'callouts', (on) => audio.setCallouts(on));
bindCheck('opt-voice', 'voiceWarn', (on) => { audio.setVoice(on, settings.voiceStyle); $('voice-style').classList.toggle('off', !on); });
$('voice-style').classList.toggle('off', settings.voiceWarn === false);
const setVoiceStyle = seg('voice-style', (v) => { settings.voiceStyle = voiceStyle(v); saveSettings(); audio.init(); audio.setVoice(settings.voiceWarn !== false, settings.voiceStyle); audio.previewVoice(); });
setVoiceStyle(voiceStyle(settings.voiceStyle));
$('rscale').value = settings.rscale || 1; $('rscale-l').textContent = Math.round((settings.rscale || 1) * 100) + '%';
$('rscale').addEventListener('input', () => { settings.rscale = +$('rscale').value; $('rscale-l').textContent = Math.round(settings.rscale * 100) + '%'; saveSettings(); rebase(); });
// browser zoom or moving the window to another screen changes devicePixelRatio: re-derive the render scale so the picture stays native
let lastDpr = devicePixelRatio; addEventListener('resize', () => { if (devicePixelRatio !== lastDpr) { lastDpr = devicePixelRatio; rebase(); } });
bindCheck('opt-traffic', 'traffic', (v) => { traffic.enabled = v; });
bindCheck('opt-dynres', 'dynres', () => { dynres.scale = 1; setRenderScale(); });
bindCheck('opt-unstart', 'unstarts', (v) => { fdm.realism.unstarts = v; });
bindCheck('opt-fuel', 'fuel', (v) => { fdm.unlimitedFuel = v; });
bindCheck('opt-fulltanks', 'fullTanks');
bindCheck('opt-mouse', 'mouse', (v) => { controls.mouseStick = v; });
bindCheck('opt-hud', 'hud', (v) => { hud.visible = v; });
// Flying mode: picking one writes its preset to the Options checkboxes (their change handlers do the rest) and sets the touchdown limits
const PRESET_IDS = { assist: 'opt-assist', handsOff: 'opt-handsoff', rotAssist: 'opt-rotassist', autoTrim: 'opt-autotrim', landAid: 'opt-landaid', unstarts: 'opt-unstart', fuel: 'opt-fuel', crash: 'opt-crash' };
function showMode() {
  const m = settings.mode, info = MODE_INFO[m];
  modeSegs.forEach((f) => f(m));
  $('intro-mode-blurb').textContent = info.blurb;
  $('fly-mode-note').textContent = presetChanged(m, settings) ? `${info.blurb} Some options below were changed from the ${info.label} preset.` : info.blurb;
}
function setMode(v) {
  settings.mode = modeOf(v);
  for (const [k, on] of Object.entries(PRESETS[settings.mode])) {
    const el = $(PRESET_IDS[k]);
    if (el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change')); }
  }
  fdm.land = landingLimits(AIRCRAFT, settings.mode); if (IS_IL76) fdm.setMode(settings.mode); resetProtect(envProt);
  saveSettings(); showMode();
}
const modeSegs = [seg('intro-mode', setMode), seg('fly-mode', setMode)];
Object.values(PRESET_IDS).forEach((id) => $(id).addEventListener('change', showMode));
showMode();
$('vol').value = settings.volume; $('vol-l').textContent = Math.round(settings.volume * 100) + '%';
$('vol').addEventListener('input', () => { settings.volume = +$('vol').value; audio.volume = settings.volume; $('vol-l').textContent = Math.round(settings.volume * 100) + '%'; saveSettings(); });
$('relief').value = settings.relief; $('relief-l').textContent = Math.round(settings.relief * 100) + '%';
$('relief').addEventListener('input', () => { settings.relief = +$('relief').value; TERRAIN_UNIFORMS.uRelief.value = settings.relief; $('relief-l').textContent = Math.round(settings.relief * 100) + '%'; saveSettings(); });
if (!GFX[settings.gfx]) settings.gfx = 'normal';
setUnits(settings.metric ? 'met' : 'imp'); setDetail(settings.gfx); applyGfx(settings.gfx);
setApAltUnits();
TERRAIN_UNIFORMS.uRelief.value = settings.relief; audio.volume = settings.volume;
buildings.enabled = settings.buildings !== false; trees.enabled = settings.trees !== false; fdm.unlimitedFuel = !!settings.fuel; controls.mouseStick = !!settings.mouse; hud.visible = !!settings.hud;

function pause(v) {
  state.paused = v ?? !state.paused;
  controls.setLocked(state.paused); // keys and the gamepad stop flying the jet while paused; view, map and menu keys still work
  holdAudio();
  $('b-pause').classList.toggle('on', state.paused);
  $('st-state').textContent = state.paused ? 'Paused' : fdm.crashed ? 'Crashed' : 'Flying'; $('st-state').className = 'chip ' + (state.paused || fdm.crashed ? 'paused' : 'live');
}
$('b-pause').addEventListener('click', () => pause());
$('b-sound').addEventListener('click', () => { audio.enabled = !audio.enabled; $('b-sound').classList.toggle('off', !audio.enabled); });
$('crash-reset').addEventListener('click', restart);
$('crash-apt').addEventListener('click', () => openSheet('airports', true));

// ---------- keyboard ----------
controls.on('gear', () => {
  // Skyhawk: G raises and lowers the retractable tail wheel (the nose and main gear are fixed)
  if (IS_C172) {
    const down = !fdm.tailGearCmd;
    if (!fdm.setTailGear(down)) { toast('Tail wheel on the ground — cannot raise it', true); return; }
    toast(down ? 'Tail wheel down' : 'Tail wheel up'); return;
  }
  if (IS_SF50) { // the lever: up is refused with weight on the wheels, and the gear limits (VLE 210, VLO retract 150 KIAS) warn on the strip
    const down = !fdm.gearDown;
    if (!fdm.setGear(down)) { toast('Weight on wheels — gear locked down', true); return; }
    toast(down ? 'Gear down' : 'Gear up' + (casMs() * KT > SF50.VLO_RET ? ' — above 150 KIAS (VLO)' : '')); return;
  }
  if (IS_IL76) { il76c.gear(); return; }
  if (fdm.onGround && fdm.gearDown) { toast('Weight on wheels — gear locked down', true); return; }
  fdm.gearDown = !fdm.gearDown; toast(fdm.gearDown ? 'Gear down' : 'Gear up');
});
// ---------- time warp: the simulation runs 2-16 steps per frame. Air only, above 1,000 ft: near the ground a 16x frame is a quarter of a second of
// flying between two looks, so it drops back to 1x there (and on a crash, a warning, the take-off or landing aids) ----------
function warpBlock() {
  if (!state.started || state.pending) return 'start a flight first';
  if (fdm.crashed) return 'crashed';
  if (fdm.onGround) return 'on the ground';
  if ((fdm.pos.y - state.lastGround - CG_H) * FT < 1000) return 'below 1,000 ft';
  if (takeoff.on || landAid.on) return takeoff.on ? 'auto take-off' : 'landing aid';
  return null;
}
function setWarp(i, why) {
  i = Math.max(0, Math.min(WARPS.length - 1, i)); if (i === warp.i) return;
  warp.i = i; const b = $('st-warp'); b.hidden = !i; b.textContent = `${WARPS[i]}× TIME`;
  toast(i ? `Time warp ${WARPS[i]}×` : `Time warp off${why ? ': ' + why : ''}`, !!why);
}
controls.on('timeWarp', () => { const b = warpBlock(); if (b && !warp.i) { toast(`Time warp needs the air above 1,000 ft (${b})`, true); return; } setWarp(warp.i + 1 >= WARPS.length ? 0 : warp.i + 1); });
$('st-warp').addEventListener('click', () => setWarp(0));

// ---------- refuel: stopped on the ground (fuel truck, about 20 s), or the Blackbird from a KC-135 below 30,000 ft and Mach 0.9 (boom contact, about 60 s) ----------
const FUEL_CAP = FUEL_MAX;
function refuelBlock() {
  if (!state.started || state.pending || fdm.crashed) return 'Start a flight first';
  if (fdm.unlimitedFuel) return 'Unlimited fuel is on (Settings)';
  if (fdm.fuel >= FUEL_CAP - 1) return 'Tanks are full';
  if (fdm.onGround) return Math.hypot(fdm.vel.x, fdm.vel.z) > 1.5 ? 'Stop the aircraft to refuel' : null;
  if (IS_GA || IS_IL76) return 'Refuel on the ground: land and stop';
  if (fdm.pos.y * FT > 30000 || (fdm.out.M || 0) > 0.9) return 'Tanker refuelling: below 30,000 ft and Mach 0.9';
  return null;
}
controls.on('refuel', () => {
  if (state.refuel) { state.refuel = null; toast('Refuelling stopped'); return; }
  const b = refuelBlock(); if (b) { toast(b, true); return; }
  state.refuel = { air: !fdm.onGround, rate: FUEL_CAP / (fdm.onGround ? 20 : 60) };
  toast(fdm.onGround ? 'Fuel truck connected: refuelling (L to stop)' : 'Tanker contact: refuelling, hold steady (L to stop)');
});
function refuelStep(dt) {
  const r = state.refuel; if (!r) return;
  const b = refuelBlock();
  if (b && b !== 'Tanks are full') { state.refuel = null; toast(r.air ? `Disconnected from the tanker: ${b.toLowerCase()}` : `Refuelling stopped: ${b.toLowerCase()}`, true); return; }
  fdm.fuel = Math.min(FUEL_CAP, fdm.fuel + r.rate * dt);
  if (fdm.fuel >= FUEL_CAP - 1) { fdm.fuel = FUEL_CAP; state.refuel = null; toast('Tanks full'); }
}

// ---------- ILS: tune the nearest runway ahead without the autopilot; the needles, the HSI and the panel show it, APPR can follow it later ----------
function tuneIlsAhead() {
  const ll = aircraftLatLon(), hdg = attitude(fdm.quat).heading; let best = null;
  for (const { a } of db.near(ll.lat, ll.lon, 60)) for (const r of a.runways) r.ends.forEach((e, k) => {
    if (!r.ils || !r.ils(k)) return;
    const d = haversine(ll.lat, ll.lon, e.start.lat, e.start.lon), brg = bearing(ll.lat, ll.lon, e.start.lat, e.start.lon);
    const off = Math.abs(((brg - hdg + 540) % 360) - 180), align = Math.abs(((e.hdg - hdg + 540) % 360) - 180);
    const score = d / 1852 + off * 0.15 + align * 0.05; // ahead and lined up beats merely close
    if (off < 70 && (!best || score < best.score)) best = { a, r, k, score, d };
  });
  if (!best) { toast('No ILS runway ahead within 30 NM (Airports → ILS picks any runway)', true); return; }
  nav.setArrival(best.r, best.k); renderRoute();
  toast(`ILS tuned: ${best.a.ident} runway ${best.r.ends[best.k].ident} · ${best.r.ils(best.k)} · ${(best.d / 1852).toFixed(1)} NM`);
}
controls.on('tuneIls', tuneIlsAhead);
$('ap-tuneils').addEventListener('click', () => { if (state.started) tuneIlsAhead(); });
$('ap-refuel').addEventListener('click', () => controls.handlers.refuel && controls.handlers.refuel());

controls.on('chute', () => {
  if (IS_C172) { toast('No drag chute on the Skyhawk', true); return; }
  if (IS_SF50) { toast('No drag chute on the Vision Jet', true); return; }
  if (IS_IL76) { toast('No drag chute on the Il-76', true); return; }
  if (fdm.chute === 'stowed') { fdm.chute = 'deployed'; fdm.chuteOpen = 0; audio.play('chute'); toast('Drag chute deployed'); }
  else if (fdm.chute === 'deployed') { fdm.chute = 'jettisoned'; toast('Drag chute jettisoned'); }
  else toast('Drag chute already used — restart to repack', true);
});
controls.on('autopilot', toggleAp);
// flaps (Skyhawk): F one notch down, Shift+F one notch up; 0, 10, 20, 30 degrees, white-arc limit 85 KIAS
if (IS_C172) {
  const flapsTo = (n) => { fdm.setFlaps(n); toast(`Flaps ${FLAP_DEG[fdm.flapCmd]}°${FLAP_DEG[fdm.flapCmd] && ias() * KT > C172.VFE ? ' — above 85 KIAS (Vfe)' : ''}`); };
  // F steps down 10, 20, 30, then back to 0; Shift+F steps up
  controls.on('flapsDown', () => flapsTo(fdm.flapCmd >= 3 ? 0 : fdm.flapCmd + 1)); controls.on('flapsUp', () => flapsTo(fdm.flapCmd - 1));
}
// flaps (Vision Jet): F one notch down, Shift+F one notch up; UP, 50 % (15 degrees, take-off) and 100 % (39 degrees, landing)
if (IS_SF50) {
  const FLAP_NAME = ['UP', '50 % (15°)', '100 % (39°)'], VFE = [Infinity, SF50.VFE50, SF50.VFE100];
  const flapsTo = (n) => { fdm.setFlaps(n); toast(`Flaps ${FLAP_NAME[fdm.flapCmd]}${casMs() * KT > VFE[fdm.flapCmd] ? ` — above ${VFE[fdm.flapCmd]} KIAS (VFE)` : ''}`); };
  controls.on('flapsDown', () => flapsTo(fdm.flapCmd >= SF50.FLAP_NOTCHES ? 0 : fdm.flapCmd + 1)); controls.on('flapsUp', () => flapsTo(fdm.flapCmd - 1));
}
// flaps and slats (Il-76): F one notch down, Shift+F one notch up; UP, then four notches to T/O and landing (the limit speeds are in il76.js)
if (IS_IL76) { controls.on('flapsDown', () => il76c.flapsDown()); controls.on('flapsUp', () => il76c.flapsUp()); }
controls.on('recover', () => {
  if (fdm.onGround || fdm.crashed) { toast('Recovery works in the air only', true); return; }
  ap.startRecovery({ ctrl: fdm.ctrl, throttle: fdm.throttle }); syncAp();
  toast('Recovery: unloading, wings level, full power, then level off — touch the stick to take over', true);
});
controls.on('help', () => openSheet('help'));
controls.on('nextView', () => setView(rig.next(1)));
controls.on('prevView', () => setView(rig.next(-1)));
controls.on('pause', () => pause());
controls.on('reset', restart);
controls.on('map', () => openSheet('map'));
controls.on('hud', () => { hud.visible = !hud.visible; settings.hud = hud.visible; $('opt-hud').checked = hud.visible; saveSettings(); });
controls.on('instruments', () => { settings.strip = !settings.strip; $('opt-strip').checked = settings.strip; saveSettings(); });
controls.on('slew', () => {
  state.slew = !state.slew; toast(state.slew ? `Slew mode: pitch and roll keys move, ${keymap.keysOf('slewUp')} / ${keymap.keysOf('slewDown')} climb` : 'Slew mode off');
  if (state.slew) state.slewSpeed = fdm.onGround ? 0 : fdm.vel.length(); else slewExit(fdm, state.slewSpeed, fdm.pos.y - groundAt(fdm.pos.x, fdm.pos.z) - CG_H);
});
controls.on('idle', () => { controls.throttle = 0; controls.engSel = 0; controls.engTrim.fill(0); controls.touched = true; stopTakeoff('Auto take-off cancelled'); });
controls.on('fullAB', () => { controls.throttle = 1; controls.engSel = 0; controls.engTrim.fill(0); controls.touched = true; });
controls.on('parkingBrake', () => { fdm.parkingBrake = !fdm.parkingBrake; toast(fdm.parkingBrake ? 'Parking brake set' : 'Parking brake released'); });
controls.on('autobrake', () => { const l = autobrake.cycle(); toast(l === 'OFF' ? 'Autobrake off' : `Autobrake ${l}: brakes by itself after touchdown once the thrust lever is closed`); });
// Rudder setting (numpad 4 / 6 in 5 % steps, 5 centres): stays until changed and adds to the rudder keys. The autopilot and the
// take-off aids write the rudder themselves while they fly, so the setting only acts in manual flight and on the ground.
const rudderStep = (d) => { controls.rudderSet = d ? Math.max(-1, Math.min(1, Math.round((controls.rudderSet + d) * 20) / 20)) : 0; const p = Math.round(Math.abs(controls.rudderSet) * 100); toast(p ? `Rudder ${controls.rudderSet < 0 ? 'left' : 'right'} ${p} %` : 'Rudder centred'); };
controls.on('rudderLeftStep', () => rudderStep(-0.05)); controls.on('rudderRightStep', () => rudderStep(0.05)); controls.on('rudderCentre', () => rudderStep(0));
// Engine select: Shift+1..4 picks one engine, the throttle keys then move its lever alone (an offset from the master lever, which the
// flight models read as leverTrim); the same key again or Shift+0 goes back to all engines, Shift+0 also brings the levers together.
const N_LEVERS = IS_GA ? 1 : fdm.engines.length; fdm.leverTrim = controls.engTrim;
const engSelect = (n) => { if (N_LEVERS < 2) { toast('Single engine: one thrust lever'); return; } if (n > N_LEVERS) { toast(`This aircraft has ${N_LEVERS} engines`); return; }
  controls.engSel = controls.engSel === n ? 0 : n; toast(controls.engSel ? `Engine ${n} selected: the throttle keys move its lever alone` : 'All engines selected'); };
for (let i = 1; i <= 4; i++) controls.on('engine' + i, () => engSelect(i));
controls.on('engineAll', () => { controls.engSel = 0; controls.engTrim.fill(0); toast('All engines selected, levers together'); });
controls.on('sound', () => { audio.enabled = !audio.enabled; $('b-sound').classList.toggle('off', !audio.enabled); });
addEventListener('pointerdown', () => audio.init());
addEventListener('keydown', () => audio.init());

// ---------- simulation ----------
// mean wind (log-law shear, settings.windSpd is the 10 m wind) plus Dryden turbulence
function windVector(agl, alt, dt) {
  const to = (settings.windDir + 180) * Math.PI / 180;
  const v = windSpeedAt(settings.windSpd, Math.max(agl, 0), alt);
  const g = turb.update(dt, fdm.out.V || 100, Math.max(agl, 0), settings.turb, fdm.vel);
  return new THREE.Vector3(Math.sin(to) * v + g.x, g.y, -Math.cos(to) * v + g.z);
}

// layered crash sound and camera shake scaled by how bad the wreck is (wreck.start has just classified it)
function crashAudio() {
  const info = wreck.info || {}, sev = wreck.severity === 'catastrophic' ? 1.45 : wreck.severity === 'major' ? 1 : 0.55;
  state.bump += 1 + 2 * sev;
  state.flash = wreck.fireIntensity > 0.44 && info.outcome !== 'structural-failure' ? Math.min(0.8, 0.35 + 0.4 * wreck.fireIntensity) : 0;
  audio.play('crash', sev);
  if (info.outcome === 'belly-slide' || info.outcome === 'hard-landing') audio.play('scrape', Math.min(1.3, 0.3 + fdm.crashVel.length() / 90));
  if (wreck.fireIntensity > 0.4) audio.play('explosion', wreck.fireIntensity, rig.world.distanceTo(wreck.impactPos));
  else if (wreck.fireIntensity > 0.06) audio.play('fire', wreck.fireIntensity);
}

const wreckWind = { x: 0, z: 0 };
const flashEl = $('flash');
function stepWreck(dt, cw) {
  const to = (settings.windDir + 180) * Math.PI / 180, ws = settings.windSpd * 1.8;
  wreckWind.x = Math.sin(to) * ws; wreckWind.z = -Math.cos(to) * ws;
  // the break-up plays in slow motion for the first moments, easing back to real time
  const slow = wreck.t < 1.8 ? 0.3 + 0.7 * Math.pow(wreck.t / 1.8, 1.4) : 1;
  wreck.update(dt * slow, state.ditch ? (x, z) => groundAt(x, z) - 7 : groundAt, cw, wreckWind, env.daylight, 1.225 * Math.exp(-Math.max(0, fdm.pos.y) / 8500), env.sunDir);
  // secondary fireballs (tanks cooking off): each one booms, shakes the camera and flashes
  for (const k of wreck.events) {
    audio.play('explosion', k * (0.5 + 0.6 * wreck.fireIntensity), rig.world.distanceTo(wreck.impactPos)); state.bump += 1.2 * k;
    state.flash = Math.max(state.flash || 0, 0.35 * k);
  }
  wreck.events.length = 0;
  // the camera stays with the main wreckage and backs off as the debris and fire spread, circling slowly
  if (rig.view === 'orbit') {
    const want = IS_GA ? THREE.MathUtils.clamp(22 + wreck.spread() * 1.1 + (wreck.fireRadius || 0) * 0.9, 30, 200) : THREE.MathUtils.clamp(55 + wreck.spread() * 1.1 + (wreck.fireRadius || 0) * 0.9, 80, 420);
    rig.orbit.dist += (want - rig.orbit.dist) * (1 - Math.exp(-dt * 0.9));
    rig.orbit.az += dt * 0.045;
    rig.orbit.el += (0.26 - rig.orbit.el) * (1 - Math.exp(-dt * 0.5));
  }
  // camera, instruments and sound follow the main piece of wreckage
  if (wreck.main) { fdm.pos.copy(wreck.main.pos); fdm.vel.copy(wreck.main.vel); fdm.quat.copy(wreck.main.q); }
  if (!state.crashShown && wreck.settled()) {
    state.crashShown = true;
    const rep = wreck.summary();
    $('crash-why').textContent = `${fdm.crashed}. ${rep.description}`; $('crash').dataset.severity = rep.severity;
    $('crash').style.display = 'flex';
  }
}

function simulate(dt) {
  state.flightT = (state.flightT || 0) + dt;
  if (state.autoPark) { if (!fdm.parkingBrake) state.autoPark = false; else if (controls.throttle > 0.12) { fdm.parkingBrake = false; state.autoPark = false; toast('Parking brake released'); } }
  if (state.slew) {
    const s = controls.slew, att = attitude(fdm.quat);
    const agl = fdm.pos.y - groundAt(fdm.pos.x, fdm.pos.z);
    const speed = Math.max(40, agl * 0.6), h = att.heading * Math.PI / 180;
    fdm.pos.x += Math.sin(h) * s.fwd * speed * dt; fdm.pos.z -= Math.cos(h) * s.fwd * speed * dt;
    fdm.pos.y = Math.max(groundAt(fdm.pos.x, fdm.pos.z) + CG_H, fdm.pos.y + s.up * speed * 0.6 * dt);
    fdm.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.turn * 0.9 * dt));
    fdm.vel.set(0, 0, 0); fdm.w.set(0, 0, 0);
    return;
  }
  const att = attitude(fdm.quat);
  let tourFlying = false;
  if (tour.active) {
    const hands = controls.manual || (fdm.onGround && Math.abs(controls.axes.yaw) > 0.1);
    if (hands && tour.phase !== 'hand') endTour('You have control');
    else tourFlying = tour.update(dt, {
      fdm, att, iasKt: ias() * KT, agl: fdm.pos.y - groundAt(fdm.pos.x, fdm.pos.z), ap,
      setThrottle: (v) => { controls.throttle = v; }, setCaption, engage: tourEngage, done: endTour,
      gearUp: () => { fdm.gearDown = false; toast('Gear up'); },
    });
  }
  if (!ap.on && autoland.armed) { autoland.disarm(); state.alBrakes = 0; toast('Autoland off'); syncAp(); }
  if (ap.on) {
    if (controls.manual) { ap.disengage(); autoland.disarm(); state.alBrakes = 0; syncAp(); toast('Autopilot disconnected by stick input', true); }
    else {
      const c = ap.update(dt, { fdm, out: fdm.out, att, vs: fdm.vel.y, alt: fdm.pos.y, ias: apIas(), nav: state.navOut });
      fdm.ctrl.de = c.de; fdm.ctrl.da = c.da; fdm.ctrl.dr = c.dr;
      if (ap.modes.spd || ap.modes.mach || c.thrOverride) { fdm.throttle = c.th; controls.throttle = c.th; }
      if (IS_SF50) sf50ApFrame(dt, att);
      if (ap.ga && fdm.gearDown && fdm.pos.y - state.lastGround - CG_H > 25 && fdm.vel.y > 2) { fdm.gearDown = false; toast('Gear up'); }
      // in the autoland flare and rollout the autoland flies the elevator and thrust: the autopilot's protection status there is not the pilot's concern
      if (ap.status.prot !== lastApProt) { if (ap.status.prot && !ap.status.recover && !(autoland.armed && ['flare', 'rollout'].includes(autoland.phase))) toast(`Autopilot ${ap.status.prot.toLowerCase()}`, true); lastApProt = ap.status.prot; }
      if (ap.on && ap.status.gs && !autoland.armed && state.navOut.agl < (IS_SF50 || IS_IL76 ? 61 : 46)) { ap.disengage(); syncAp(); toast('Minimums — autopilot disconnected. Flare and land.', true); }
    }
  }
  // SR-71 elevon display: in the air the stick gearing leaves a full pull only ~2.5 deg of real elevon, so the elevons looked frozen.
  // While the pilot's geared command reaches the surfaces untouched, aircraft.js draws the un-geared stick on top (physics unchanged).
  let geared = null, visDe = 0;
  if (!ap.on && !tourFlying) {
    const shape = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4);
    const q = fdm.out.qbar || 0, M = fdm.out.M || 0;
    if (STICK_GA) gaControlFrame(fdm, controls.axes, gaCtl, { kias: (IS_SF50 || IS_IL76 ? casMs() : ias()) * KT, dt, cfg: IS_SF50 ? SF50_STICK : IS_IL76 ? IL76_STICK : undefined, assist: settings.handsOff !== false, frozen: !!fdm.crashed || state.slew || state.paused });
    else { geared = fdm.ctrl.de = stickGearing(shape(controls.axes.pitch), q, M, fdm.onGround ? 1 : Math.max(0, Math.min(1, (40 - (fdm.pos.y - state.lastGround - CG_H)) / 25))); fdm.ctrl.da = rollGearing(shape(controls.axes.roll), q, M); fdm.ctrl.dr = controls.axes.yaw; }
    if (!STICK_GA) {
      fdm.ctrl.de = rotAssist.apply({ fdm, axis: controls.axes.pitch, de: fdm.ctrl.de, ias: ias(), agl: fdm.pos.y - state.lastGround - CG_H, enabled: settings.rotAssist !== false && !takeoff.on, dt });
      flightAssist(dt); landingAid(dt);
      takeoffFrame(dt);
    }
    envelopeGuard(dt);
    if (geared !== null && fdm.ctrl.de === geared) visDe = shape(controls.axes.pitch) - geared;
  } else { assist.release(); landAid.on && landAid.disengage(); resetProtect(envProt); }
  fdm.visDeExtra = visDe;
  if (!ap.on || !(ap.modes.spd || ap.modes.mach)) fdm.throttle = controls.throttle;
  // auto-trim: with the stick idle (and no autopilot / assist flying it) the trim follows the pitch rate to zero
  if (!ap.on && !assist.on && !takeoff.on && !landAid.on) fdm.trim = autoTrimStep(autoTrim, { enabled: settings.autoTrim !== false && !controls.trimUp && !controls.trimDown, trim: fdm.trim, q: fdm.w.z, power: IS_SF50 ? fdm.out.pitchPower * SF50_TRIM_AUTH : IS_IL76 ? fdm.out.pitchPower * IL76_TRIM_AUTH : IS_C172 ? fdm.out.pitchPower * 0.6 : fdm.out.pitchPower, alpha: fdm.out.alpha || 0, stick: controls.axes.pitch, V: fdm.out.V || 0, onGround: fdm.onGround, dt }, IS_SF50 ? SF50_AUTO_TRIM : IS_IL76 ? IL76_AUTO_TRIM : IS_C172 ? AT_C172 : undefined);
  // the Vision Jet's trim wheel spans its whole range (take-off trim alone sits past 0.6); the Blackbird keeps its +-0.6 elevon trim
  if (controls.trimUp) fdm.trim = Math.min(TRIM_LIM, fdm.trim + TRIM_RATE * dt);
  if (controls.trimDown) fdm.trim = Math.max(-TRIM_LIM, fdm.trim - TRIM_RATE * dt);
  fdm.brakes = Math.max(controls.brake, state.alBrakes || 0);
  { const gs = Math.hypot(fdm.vel.x, fdm.vel.z), acc = dt > 0 && state.abGs !== undefined ? (gs - state.abGs) / dt : 0; state.abGs = gs; state.abAcc = (state.abAcc || 0) + (acc - (state.abAcc || 0)) * Math.min(1, dt * 4);
    const was = autobrake.level, b = autobrake.update({ onGround: fdm.onGround, gs, accel: state.abAcc, throttle: controls.throttle, pedal: controls.brake }, dt);
    if (was && !autobrake.level) toast('Autobrake off: manual braking'); if (b > fdm.brakes) fdm.brakes = b; }
  if (IS_SF50 && visual.cabinDoor && visual.cabinDoor.cmd > 0 && Math.hypot(fdm.vel.x, fdm.vel.z) > 3) { visual.setDoors(false); toast('Cabin door closed for taxi'); }
  if (IS_IL76) fdm.throttle = Math.min(fdm.throttle, il76c.frame()); // doors close when rolling; no take-off power with the cargo hatch open
  const ground = groundAt(fdm.pos.x, fdm.pos.z);
  state.lastGround = ground;
  const wind = windVector(fdm.pos.y - ground, fdm.pos.y, dt);
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  fdm.crashOff = !settings.crash;
  for (let i = 0; i < n; i++) fdm.step(h, groundAt, wind);
  // finer elevation keeps arriving for a few seconds after a spawn (hundreds of metres in mountains): stay clear of it
  if (state.settleAir && performance.now() < state.settleUntil && !fdm.onGround) {
    const g2 = groundAt(fdm.pos.x, fdm.pos.z);
    if (fdm.pos.y < g2 + 150) { fdm.pos.y = g2 + 150; if (fdm.vel.y < 0) fdm.vel.y = 0; }
  }
  // ground impacts with Crash off are absorbed inside the flight model; anything else that still crashed keeps its motion (no dead stop and 6 m drop)
  if (!settings.crash && fdm.crashed) { fdm.crashed = null; if (fdm.crashVel) fdm.vel.copy(fdm.crashVel).setY(Math.max(0, fdm.crashVel.y)); fdm.pos.y = Math.max(fdm.pos.y, ground + 3); fdm.events = fdm.events.filter((e) => e !== 'crash'); }
  // Buildings are solid: the airframe's hard points are swept against the building meshes (a taxiing jet below 15 m/s is left alone, OSM footprints overlap aprons)
  if (!fdm.crashed && settings.crash && !state.pending && buildings.enabled && fdm.pos.y - ground < 700 && !(fdm.onGround && fdm.vel.length() < 15)) {
    const hit = buildingHit.test(buildings.tiles, fdm);
    if (hit) { state.buildingCrash = true; fdm.crash('flew into a building', 'impact'); }
  } else buildingHit.hasPrev = false;
  // Water: a jet that touches it does not roll on. Wheels or belly in the water end the flight: fast, the jet breaks up on the surface; slow, it floods
  // and sinks. Checked a few times a second from the water mask the terrain draws (OpenStreetMap polygons); never on a runway; not in the first 5 s.
  if (!fdm.crashed && settings.crash && !state.pending && performance.now() - (state.waterAt || 0) > 120) {
    state.waterAt = performance.now();
    if (fdm.pos.y - ground < 3.2 && performance.now() > (state.settleUntil || 0) - 7000) {
      const ll = aircraftLatLon();
      if (terrain.waterAt(ll.lat, ll.lon) === true) {
        // 6 km, not 1.5: the far ends of 4-5 km runways (KJFK, VHHH, LFPG, KSFO) lie well outside 1.5 km of the airport point and ditched on the runway
        const onRunway = db.near(ll.lat, ll.lon, 6).some(({ a }) => a.runways.some((r) => { const l = r.local(ll.lat, ll.lon); return Math.abs(l.s) < r.len / 2 + 40 && Math.abs(l.t) < r.width / 2 + 30; }));
        if (!onRunway) {
          const sp = fdm.vel.length() * KT; state.ditch = true;
          fdm.crash(sp > 90 ? `ditched at ${Math.round(sp)} kt: the jet broke up on the water` : 'ran into the water: the jet flooded and sank', 'impact');
        }
      }
    }
  }
  const nzS = fdm.out.nzAero ?? fdm.out.nz; // flight loads only: gear reaction at touchdown is the gear's limit, not the airframe's
  state.overG = (nzS > 6 || nzS < -3) ? state.overG + dt : 0; // the airframe is far weaker under negative g
  if (settings.crash && state.overG > 0.25 && !fdm.crashed) fdm.crash(`airframe overstressed (${nzS.toFixed(1)} g)`, 'overstress');
  for (const e of fdm.events) {
    if (e === 'gear-lock') { audio.play('gear-lock'); state.bump += 0.15; }
    else if (e === 'crash-absorbed') { state.bump += 0.5; if (performance.now() - (state.absorbedAt || 0) > 3000) { state.absorbedAt = performance.now(); toast('Impact ignored (Crash is off)', true); } }
    else if (e === 'crash') {
      // the wreck plays out first; the crash report follows once it has come to rest
      ap.disengage(); syncAp(); takeoff.stop();
      wreck.start(visual, fdm, fdm.crashKind, IS_C172 ? { fuelCap: C172.FUEL_MAX, speedRef: 75, sinkRef: 28, size: 0.3 } : IS_SF50 ? { fuelCap: SF50.FUEL_MAX, speedRef: 110, sinkRef: 35, size: 0.45 } : IS_IL76 ? { fuelCap: IL76.FUEL_MAX, speedRef: 120, sinkRef: 40, size: 1.4 } : undefined);
      crashAudio();
      state.crashShown = false; $('crash-why').textContent = fdm.crashed; pause(state.paused); // refreshes the status chip
      state.orbitBeforeCrash = { az: rig.orbit.az, el: rig.orbit.el, dist: rig.orbit.dist };
      if (rig.view !== 'orbit' && rig.view !== 'tower' && rig.view !== 'flyby') {
        state.viewBeforeCrash = rig.view; setView('orbit'); Object.assign(rig.orbit, { az: rig.orbit.az, el: 0.25, dist: IS_GA ? 40 : IS_IL76 ? 160 : 110 });
      }
    }
    else if (e.type === 'gear-interlock') toast('Weight on wheels — gear lever back down', true);
    else if (e.type === 'gear-overspeed') toast(`Gear speed exceeded (VLE ${Math.round(IS_IL76 ? IL76.VLE : SF50.VLE)} KIAS)`, true);
    else if (e === 'chute-fail') toast('Drag chute torn off — deploy below 210 kt', true);
    else if (e.type === 'scrape') { audio.play('touch', 0.6); state.bump += 0.6; toast(e.part && e.part !== 'tail' ? `${e.part[0].toUpperCase() + e.part.slice(1)} scraped the runway — less nose-up or bank at touchdown` : 'Tail strike — ease the back pressure at rotation', true); }
    else if (e.type === 'touch') { if (e.vs > 0.5) { if (!IS_IL76) audio.play('touch', Math.min(1.5, e.vs / 2)); else if (performance.now() - (state.il76Touch || 0) > 2500) { state.il76Touch = performance.now(); audio.play('touch-bogies', Math.min(1.5, e.vs / 2)); } } state.bump += Math.min(1.5, e.vs * 0.4); }
    else if (e.type === 'spoilers-out' || e.type === 'spoilers-in') audio.play('spoiler', e.type === 'spoilers-out' ? -1 : 1);
    else if (e.type === 'ab-light') { audio.play('ab-light', rig.view === 'cockpit' ? 0.5 : 1); visual.event(e); state.bump += 0.25; }
    else if (e.type === 'unstart') { audio.play('unstart'); visual.event(e); state.bump += 2.2; toast(`${e.engine ? 'RIGHT' : 'LEFT'} INLET UNSTART — restarting`, true); }
    else if (e.type === 'restart') toast(`${e.engine ? 'Right' : 'Left'} inlet restarted`);
  }
  // one message per landing, not one per wheel contact (touchdown.js)
  { const sink = touchdown.frame(fdm.events, dt, fdm.onGround); if (sink !== null) toast(`Touchdown ${Math.round(sink * 196.85)} fpm`); }
  fdm.events.length = 0;
  if (Math.hypot(fdm.pos.x, fdm.pos.z) > 30000) {
    const ll = aircraftLatLon();
    moveOrigin(ll.lat, ll.lon); fdm.latDeg = ll.lat;
    fdm.pos.x = 0; fdm.pos.z = 0;
  }
}

function panelState(att, warn) {
  const out = fdm.out, M = out.M || 0, V = Math.max(60, out.V || 0), vs = fdm.vel.y;
  const sys = systemsState;
  let fdPitch = 0;
  if (ap.on) { const vsT = ap.modes.alt ? Math.max(-ap.target.vsLimit, Math.min(ap.target.vsLimit, (ap.target.alt - fdm.pos.y) * 0.06)) : vs; fdPitch = (Math.asin(Math.max(-1, Math.min(1, vsT / V))) - Math.asin(Math.max(-1, Math.min(1, vs / V)))) / D2R * 3; }
  const cmd = ap.cmdHdg ?? ap.target.hdg;
  const bankT = ap.on ? Math.max(-1, Math.min(1, (((cmd - att.heading + 540) % 360) - 180) * 0.03)) * (M > 1 ? 25 : 30) : 0;
  const T = out.T || 288, cit = T * (1 + 0.2 * M * M) - 273.15;
  return {
    kias: casMs() * KT, mach: M, altFt: fdm.pos.y * FT, vsFpm: vs * 196.85, g: out.nz || 1, aoaDeg: (out.alpha || 0) / D2R,
    pitch: att.pitch, bank: att.bank, hdg: att.heading, slip: out.beta || 0, // beta > 0: ball right, step on it
    apOn: ap.on, apAltOn: ap.modes.alt, apHdgOn: ap.modes.hdg || ap.modes.nav, apSpdOn: ap.modes.spd, apMachOn: ap.modes.mach,
    apAltFt: ap.target.alt * FT, apHdg: cmd, apSpd: ap.target.spd * KT, apMach: ap.target.mach,
    fdPitch, fdRoll: bankT - att.bank / D2R,
    gearPos: fdm.gearPos, gearDown: fdm.gearDown, fuelLb: fdm.fuel * 2.20462, fuelTanksLb: sys.fuelTanksLb, onGround: fdm.onGround,
    hydraulicPressureKpsi: sys.hydraulicPressureKpsi, oilPressurePsi: sys.oilPressurePsi, oilTemperatureC: sys.oilTemperatureC,
    busCurrentA: sys.busCurrentA, busVoltageV: sys.busVoltageV, oxygenQuantityPct: sys.oxygenQuantityPct,
    cabinAltitudeFt: sys.cabinAltitudeFt, differentialPressurePsi: sys.differentialPressurePsi, fuelTemperatureC: sys.fuelTemperatureC,
    rpm: fdm.engines.map((e) => (fdm.crashed ? 0 : 55 + 45 * e.dry - (e.unstart > 0 ? 9 : 0))),
    egt: fdm.engines.map((e) => (fdm.crashed ? 20 : 380 + 420 * e.dry + 75 * e.ab + (e.unstart > 0 ? 140 : 0))),
    noz: fdm.engines.map((e) => (e.ab > 0 ? 40 + 60 * e.ab : 12 + 12 * (1 - e.dry))),
    ff: fdm.engines.map((e) => e.ff * 3600 * 2.20462),
    ab: fdm.engines.map((e) => e.ab > 0.01), unstart: fdm.engines.map((e) => e.unstart > 0),
    bypass: fdm.engines.map((e) => (e.unstart > 0 ? 100 : Math.max(0, Math.min(1, (M - 1.4) / 1.8)) * 65)),
    throttle: fdm.throttle, stick: { p: fdm.ctrl.de || 0, r: fdm.ctrl.da || 0 }, gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999, flightTime: state.flightT || 0,
    cit, hour: env.hour, brakes: fdm.brakes > 0, park: fdm.parkingBrake, chute: fdm.chute,
    nav: { valid: false, ident: '', brgDeg: 0, distNm: 0, course: 0, xtkNm: 0, ilsValid: false, locDev: 0, gsDev: 0, ...state.navOut }, warn,
  };
}

// the Vision Jet's PFD / MFD feed (src/sf50feed.js): called by the visual only when a screen is due a redraw
const sf50Feed = IS_SF50 ? makeSF50Feed() : null;
// the MFD's "Dest Elev": the flight plan's last waypoint when it is an airport, else the airport this flight started at or was set up to land on
function destElevFt() {
  const w = nav.wps.length ? nav.wps[nav.wps.length - 1] : null, a = (w && db.ready && db.get(w.name)) || state.startApt;
  return a && Number.isFinite(a.elev) ? a.elev * FT : 0;
}
function sf50State(att, warn) {
  const ll = aircraftLatLon(), tw = db.ready ? state.tw : null, n = state.navOut || {};
  return sf50Feed(fdm, {
    att, casMs: casMs(), gsMs: Math.hypot(fdm.vel.x, fdm.vel.z), trkDeg: (Math.atan2(fdm.vel.x, -fdm.vel.z) * 180 / Math.PI + 360) % 360, flightT: state.flightT || 0, hour: env.hour,
    settings, nav: n, ap, warn, com1Name: tw ? `${tw.a.ident} TWR` : '', destElevFt: destElevFt(),
    airports: db.near(ll.lat, ll.lon, 70).slice(0, 8).map(({ a, d }) => ({ id: a.ident, brgDeg: bearing(ll.lat, ll.lon, a.lat, a.lon), distNm: d / 1852 })),
  }, 0.1);
}

// the Il-76's PFD, ND and engine display feed (src/il76feed.js): bank is + right wing down, pitch and bank in degrees
function il76State(att, warn) {
  return il76Feed(fdm, { att: { pitch: att.pitch / D2R, roll: att.bank / D2R, heading: att.heading }, casMs: casMs(), gsMs: Math.hypot(fdm.vel.x, fdm.vel.z), altM: fdm.pos.y, warn, selHdg: ap.on ? ap.target.hdg : undefined });
}

// ---------- frame ----------
let last = performance.now(), last0 = last, fps = 60, uiT = 0, mapT = 0, aptT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  try { frameBody(now); } catch (e) {
    if (!frame.err) { frame.err = e; console.error('frame error', e); }
    window.__frameErr = String((e && e.stack) || e);
  }
}
// animation frames stop in a hidden tab, so a world started loading there sat on "loading" forever: keep the loader turning on a timer meanwhile
const hiddenPump = { id: 0 };
function syncHiddenPump() {
  clearInterval(hiddenPump.id); hiddenPump.id = 0;
  if (document.hidden) hiddenPump.id = setInterval(() => { if (!state.pending) return; try { frameBody(performance.now()); } catch (e) { window.__frameErr = String((e && e.stack) || e); } }, 250);
}
document.addEventListener('visibilitychange', () => { syncHiddenPump(); holdAudio(); });
// paused or hidden: the AudioContext suspends and ATC speech stops (both kept running and talking in a background tab)
function holdAudio() { const hold = state.paused || document.hidden; if (hold) audio.suspend(); else audio.resume(); atc.setHidden(hold); }
// cloud cover and base ease toward the chosen weather over ~25 s instead of re-rolling the whole sky the moment a preset or METAR loads
const cloudEff = { cover: settings.clouds, base: settings.cloudBase };
const cloudXZ = new THREE.Vector2(), cloudWind = new THREE.Vector2();
const cloudAnchorAt = { v: -1, until: 0 };
const navCue = { mode: 'ILS', lateral: NaN, vertical: NaN };
const clampN = (v, lim) => Math.max(-1, Math.min(1, v / lim));
// ILS needles (positive = fly right / fly down), or the LNAV cross-track while NAV is engaged
function cueFor(n) {
  if (!n) return null;
  if (n.ilsValid) { navCue.mode = 'ILS'; navCue.lateral = clampN(n.locDev, 2.5); navCue.vertical = n.gsDev ? clampN(n.gsDev, 0.7) : NaN; return navCue; }
  if (ap.on && ap.modes.nav && n.valid) { navCue.mode = 'LNAV'; navCue.lateral = clampN(-n.xtkNm, 2); navCue.vertical = NaN; return navCue; }
  return null;
}
function frameBody(now) {
  if ((rig.view === 'cockpit') !== state.cabRes) { state.cabRes = rig.view === 'cockpit'; setRenderScale(); } // re-apply the cockpit's resolution floor
  perf.begin(now);
  // 0.1 s, not 0.05: below 20 fps the game ran in slow motion (a quarter of real time at 5 fps). Physics still steps at 240 Hz inside it.
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  { const ft = (now - last0) / 1000; adaptResolution(ft, now); adaptClouds(ft, now); last0 = now; }
  controls.onGround = fdm.onGround;
  controls.update(dt);
  const ll = aircraftLatLon();
  state.navOut = nav.update(ll, fdm.pos.y, fdm.vel.length());
  if (nav.sequenced) { toast(`Waypoint ${nav.sequenced}`); nav.sequenced = null; }
  if (state.pending) finishPending();
  else if (state.apAfterSpawn) { state.apAfterSpawn = false; engageAp(); syncAp(); } // teleport dialog: hold what was asked for
  else if (!state.paused && !fdm.crashed) {
    for (let k = warpX(); k > 0 && !fdm.crashed; k--) { simulate(dt); refuelStep(dt); }
    if (warp.i) { const b = warpBlock(); if (b) setWarp(0, b); }
  }
  perf.mark('sim');

  // nearest airport (tower camera): widening searches scan thousands of airports over the ocean, so refresh it only occasionally
  if (db.ready && (now - (state.twAt || -1e9) > 800 || Math.abs(ll.lat - state.twLat) > 0.02 || Math.abs(ll.lon - state.twLon) > 0.03)) {
    state.tw = db.nearest(ll.lat, ll.lon); state.twAt = now; state.twLat = ll.lat; state.twLon = ll.lon;
  }
  const tw = db.ready ? state.tw : null;
  const twl = tw ? tw.a.towerLatLon() : ll, twp = geo.toXZ(twl.lat, twl.lon);
  state.bump *= Math.exp(-dt * 2.5);
  if (state.flash > 0.01) { state.flash *= Math.exp(-dt * 3.4); flashEl.style.opacity = state.flash.toFixed(3); } else if (state.flash) { state.flash = 0; flashEl.style.opacity = '0'; }
  const shake = state.paused || !settings.shake ? 0 : Math.min(2.5, (fdm.out.buffet || 0) + state.bump);
  rig.update(dt, fdm, groundAt, new THREE.Vector3(twp.x, tw ? tw.a.elev : fdm.pos.y, twp.z), shake);
  const cw = rig.world, cll = geo.toLatLon(cw.x, cw.z);
  env.visibility = settings.vis;
  // how closed the cloud deck above the camera is: dims the sun and greys the sky light (sky.js); above the deck the sun is back
  { const c = cloudEff.cover, top = cloudTop(cloudEff.base, c), k = Math.min(1, Math.max(0, (c - 0.6) / 0.4)), above = Math.min(1, Math.max(0, (cw.y - cloudEff.base) / Math.max(1, top - cloudEff.base)));
    env.overcast = k * k * (3 - 2 * k) * (1 - above) * (post.clouds || clouds.mesh.visible ? 1 : 0.6); }
  env.update(cll.lat, cw.y, state.paused ? 0 : dt * warpX(), settings.runClock);
  // oxygen and the other consumables only run while a flight is flying (they ran on through pause, the menu and loading, and never refilled)
  systemsState = aircraftSystems.step(dt, { active: state.started && !state.paused && !state.pending,
    altitudeFt: fdm.pos.y * FT, engineRpm: fdm.engines.map((e) => (fdm.crashed ? 0 : 55 + 45 * e.dry - (e.unstart > 0 ? 9 : 0))),
    afterburner: fdm.engines.map((e) => e.ab > 0.01), gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999,
    fuelKg: fdm.fuel, fuelAftKg: fdm.fuelAft, lightsOn: env.daylight < 0.25,
  });
  updateMission(state.paused ? 0 : dt * warpX());
  const rainCam = { q: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w], fov: camera.fov, alt: rig.world.y,
    vel: rig.view === 'tower' || rig.view === 'flyby' ? [0, 0, 0] : [fdm.vel.x, fdm.vel.y, fdm.vel.z] };
  for (const ev of weather.update(state.paused ? 0 : dt, fdm.out.V || 0, rig.view === 'cockpit', rainCam)) audio.play('thunder', ev.level, ev.distance);
  {
    const to = (settings.windDir + 180) * Math.PI / 180, ws = settings.windSpd;
    rainField.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
    rainField.update(state.paused ? 0 : dt, { x: rainCam.vel[0], y: rainCam.vel[1], z: rainCam.vel[2] }, { x: Math.sin(to) * ws, y: 0, z: -Math.cos(to) * ws }, Math.max(weather.eff || 0, rig.view === 'cockpit' ? 0 : (state.cloudIn || 0) * (weather.bolts > 0 ? 0.5 : 0.15)), rig.view === 'cockpit', env.daylight);
  }
  TERRAIN_UNIFORMS.uSun.value.copy(env.sunDir);
  terrain.daylight.setScalar(env.daylight);
  aptT += dt;
  if (db.ready && aptT > 1) { aptT = 0; if (db.updateActive(cll.lat, cll.lon, scene, geo)) terrain.refreshNear(cll.lat, cll.lon, 45); }
  perf.mark('camera+sky');
  // tile density follows the screen's own pixels (capped), not the supersampled canvas: at 200 % it asked for twice the tiles for the same picture
  terrain.pxScale = THREE.MathUtils.clamp(innerHeight * Math.min(devicePixelRatio || 1, 2) / (2 * Math.tan(camera.fov * Math.PI / 360)) / 691, 0.75, 1.25);
  terrain.loadBoost = !!state.pending || !state.started;
  terrain.update(cw, cll.lat, cll.lon);
  perf.mark('terrain');
  const camAgl = cw.y - (terrain.heightAt(cll.lat, cll.lon) ?? 0);
  buildings.update(cw, cll.lat, cll.lon, camAgl, env);
  trees.update(cw, cll.lat, cll.lon, camAgl, env);
  db.positionLights(cw, env.night);
  perf.mark('scenery');
  const windTo = (settings.windDir + 180) * Math.PI / 180, windAloft = Math.max(9, settings.windSpd * 2.5); // wind aloft is stronger than the 10 m wind; never calmer than ~9 m/s so the drift is visible
  cloudWind.set(Math.sin(windTo) * windAloft, -Math.cos(windTo) * windAloft);
  // the cloud field is anchored to the Earth, not to the spawn point (cloudlayer.js): re-anchor whenever the world origin moves or the day changes
  if (geo.version !== cloudAnchorAt.v || Date.now() > cloudAnchorAt.until) {
    const A = cloudAnchor(geo.lat0, geo.lon0), v2 = new THREE.Vector2(A.x, A.z);
    vclouds.setAnchor(v2, A.evo0); cloudShadow.setAnchor(v2, A.evo0); clouds.setAnchor(v2);
    cloudAnchorAt.v = geo.version; cloudAnchorAt.until = (A.day + 1) * 86400000;
  }
  cloudEff.cover += (settings.clouds - cloudEff.cover) * (1 - Math.exp(-dt / 25)); cloudEff.base += (settings.cloudBase - cloudEff.base) * (1 - Math.exp(-dt / 25));
  clouds.update(cw, env, cloudEff.cover, cloudEff.base, cloudWind, now / 1000);

  const groundY = groundAt(fdm.pos.x, fdm.pos.z);
  const att = attitude(fdm.quat), out = fdm.out;
  const iasMs = ias(), agl = fdm.pos.y - groundY - CG_H;
  const warn = IS_SF50 ? sf50Warn(fdm, { casKt: casMs() * KT, iasMs, agl }) : IS_IL76 ? il76Warn(fdm, { casKt: casMs() * KT, iasMs, agl, dt }) : {
    stall: !fdm.onGround && (IS_C172 ? (out.stall || 0) > 0.05 || (out.buffet || 0) > 0.35 : (out.alpha || 0) > 0.26) && iasMs > (IS_C172 ? 8 : 20),
    pullUp: !fdm.onGround && agl < 600 && fdm.vel.y < -8 && agl / -fdm.vel.y < 9,
    gearUnsafe: !IS_C172 && !fdm.gearDown && agl < 300 && fdm.vel.y < 0 && iasMs * KT < 230,
    overspeed: IS_C172 ? iasMs * KT > C172.VNE : iasMs * KT > 450 || (out.M || 0) > 3.3,
    overG: (out.nz || 1) > (IS_C172 ? C172.NZ_LIMIT : 3.5),
    lowFuel: !fdm.unlimitedFuel && fdm.fuel < (IS_C172 ? 22 : 2500),
  };
  // the instruments follow the main wreckage, but a wreck has no stall, pull-up or gear alarms to raise
  if (fdm.crashed) for (const k in warn) warn[k] = false;
  // the wreck runs after the camera rig, so it is drawn relative to this frame's camera position
  if (wreck.active && !state.paused) stepWreck(dt, cw);
  // inside cloud the glass collects droplets (heavier in a thunderhead) before the aircraft is updated; this used to be applied after
  // visual.update(), then reset at the top of the next frame, so no droplet ever reached the canopy
  visual.rainEff = Math.max(weather.eff || 0, (state.cloudIn || 0) * (weather.bolts > 0 ? 1 : 0.7)); visual.rainGround = weather.rain || 0;
  // the ground soaks in about 15 s of steady rain and takes minutes to dry
  { const r = weather.rain || 0, d = state.paused ? 0 : dt;
    env.wet = Math.max(0, Math.min(1, (env.wet || 0) + d * (r > 0.05 ? 0.03 + 0.05 * r : -0.004)));
    buildings.uni.uWetB.value = env.wet * 0.9;
    TERRAIN_UNIFORMS.uWet.value = env.wet; TERRAIN_UNIFORMS.uRip.value = r > 0.05 ? r : 0; }
  if (visual.glassWater && post.glassWater !== visual.glassWater) { post.glassWater = visual.glassWater; visual.glassWater.setMode(post.enabled ? 0 : 1); }
  if (!wreck.active) visual.update(dt, fdm, cw, rig.view, env, groundY, IS_SF50 ? (rig.view === 'cockpit' ? () => sf50State(att, warn) : null) : IS_IL76 ? (rig.view === 'cockpit' ? () => il76State(att, warn) : null) : rig.view === 'cockpit' ? panelState(att, warn) : null);
  else visual.shadow.visible = false;
  if (state.started && !state.pending) traffic.update(state.paused ? 0 : dt, { camWorld: cw, lat: ll.lat, lon: ll.lon, night: env.night, own: fdm.pos });
  { // tree colour follows the climate band under the aircraft: lush and warm in the tropics, dark blue-green conifers toward the poles
    const L = Math.abs(ll.lat), b = trees.biome; if (b) { const trop = 1 - Math.min(1, Math.max(0, (L - 15) / 15)), bor = Math.min(1, Math.max(0, (L - 48) / 14)), sub = Math.min(1, Math.max(0, (L - 28) / 8)) * (1 - Math.min(1, Math.max(0, (L - 42) / 6)));
      b.set(1 + 0.1 * trop - 0.12 * bor + 0.1 * sub, 1.04 * trop + 1 * (1 - trop) - 0.02 * bor + 0.02 * sub, 1 - 0.1 * trop + 0.05 * bor - 0.14 * sub); } }
  updateLever(); updateLoadUi(now); guide.update(dt); atc.update(dt, atcCtx());
  { // jet blast on the ground, and the clouds' shadows on it
    const nz = visual.engines ? visual.engines.map((e) => e.grp.getWorldPosition(new THREE.Vector3()).add(cw)) : [];
    if (nz.length) { _aft.set(-1, 0, 0).applyQuaternion(fdm.quat); _aft.y = 0; if (_aft.lengthSq() < 1e-4) _aft.set(1, 0, 0); _aft.normalize();
      blast.update(state.paused ? 0 : dt, { fdm, camWorld: cw, groundY, nozzles: nz, aft: _aft, daylight: env.daylight, height: terrain.cam.agl, px: renderer.domElement.height * 0.5, scale: IS_SF50 ? 0.3 : 1 }); }
    // the vortex ropes, contrails and condensation are placed for the Blackbird's airframe (and tuned for the Skyhawk): the Vision Jet gets none
    airflow.update(state.paused || state.pending ? 0 : dt, { fdm, model: IS_SF50 || IS_IL76 ? null : visual.model, camWorld: cw, daylight: env.daylight, px: renderer.domElement.height * 0.5, geoVersion: geo.version,
      humidity: 0.12 + 0.7 * cloudEff.cover + 0.8 * (weather.rain || 0) + 0.3 * (env.wet || 0) + 0.5 * (state.cloudIn || 0), wind: { x: Math.sin((settings.windDir + 180) * Math.PI / 180) * settings.windSpd, z: -Math.cos((settings.windDir + 180) * Math.PI / 180) * settings.windSpd } });
    const U = TERRAIN_UNIFORMS;
    if (post.clouds && vclouds.tex && vclouds.march && cloudEff.cover > 0.02) {
      cloudShadow.update(renderer, { shape: vclouds.tex.shape, cover: cloudEff.cover, base: cloudEff.base, top: cloudTop(cloudEff.base, cloudEff.cover), wind: cloudWind, now: now / 1000, cam: cw, groundY, sunDir: env.sunDir });
      U.uCsMap.value.copy(cloudShadow.map); U.uCsMap2.value.copy(cloudShadow.map2); U.uCsMix.value = cloudShadow.mix;
      U.uCsTex.value = cloudShadow.rt.texture; U.uCsTex2.value = cloudShadow.rtOld.texture;
      if (now - (state.cdAt || 0) > 120) { state.cdAt = now; const d = vclouds.densityAt(cw.y, cloudEff.cover, cloudEff.base, now / 1000), k = Math.min(1, Math.max(0, (d - 0.05) / 0.3)); state.cloudIn = (state.cloudIn || 0) + (k - (state.cloudIn || 0)) * 0.4; }
    } else { U.uCsMap.value.w = 0; U.uCsMap2.value.w = 0; state.cloudIn = (state.cloudIn || 0) * 0.9; }
    weather.inCloud = state.cloudIn || 0;
    // flying through cloud: a film of tiny droplets on the glass, bigger and heavier in a thunderhead
  }
  // sun shadow map covers just the aircraft (self-shadowing of chines, nacelles, gear, cockpit)
  env.sun.target.position.copy(visual.root.position);
  env.sun.position.copy(visual.root.position).addScaledVector(env.sunDir, 80);
  // Skyhawk: a shadow camera sized for it (11 m span) rather than the SR-71 (33 m long), three times the detail on its own surfaces; the wide
  // one back for a wreck, whose pieces scatter
  // The depth bias is a fraction of the camera's depth range: it is scaled with the range so it stays ~8 cm (at 1.3 cm the thin flaps and
  // ailerons shadowed themselves and turned blue-grey)
  // from the Vision Jet's seat the sun map only needs the cabin: a tighter box gives its seats and panel crisp shadows
  // Il-76: a 50 m span needs a 32 m box, with the sun's depth range widened to match
  if (IS_GA || IS_IL76) { const sh = env.sun.shadow, c = sh.camera, r = wreck.active ? (IS_IL76 ? 60 : 22) : IS_IL76 ? 32 : IS_SF50 && rig.view === 'cockpit' ? 3.5 : 8, nr0 = IS_IL76 ? 40 : 64, fr0 = IS_IL76 ? 120 : 96;
    if (c.right !== r) { if (state.sunBias === undefined) state.sunBias = { bias: sh.bias, range: c.far - c.near };
      Object.assign(c, { left: -r, right: r, top: r, bottom: -r, near: wreck.active ? 1 : nr0, far: wreck.active ? 200 : fr0 }); c.updateProjectionMatrix();
      sh.bias = state.sunBias.bias * state.sunBias.range / (c.far - c.near); shAt.v = null; } }
  // The map is redrawn only when the aircraft's shape seen from the sun changes (below), but its matrix must follow the aircraft every frame:
  // with the matrix of the last redraw the aircraft looked its shadow up where it had been, so shadows slid over it as the camera moved and
  // snapped back at the next redraw (the flicker on top of the aircraft)
  env.sun.updateMatrixWorld(); env.sun.target.updateMatrixWorld(); env.sun.shadow.updateMatrices(env.sun);
  // stays on at night (intensity is 0 then): toggling castShadow recompiles every lit material
  env.sun.castShadow = true;
  if (!shadows.forceAll) shadows.every = dynres.scale < 0.95 || pressure.level >= 2 || fdm.pos.y - state.lastGround > 6000 ? 2 : 1;
  perf.gpuSection('shadow maps');
  // nothing is drawn until the menu-time shader warm-up has finished (or 45 s): the first draw linked every program synchronously and froze the
  // page for 30+ s on "Loading aircraft…" (driver compile waits, 37 s of a 33 s boot profile in SwiftShader). Frames still run, so lights and sky are set for the warm-up.
  const drawOk = state.drawOk || (state.drawOk = warm.done || now - (state.bootT || now) > 45000);
  if (drawOk && state.drawOk !== 'shown') { state.drawOk = 'shown'; document.body.classList.add('ready'); }
  const draw = drawOk && !(state.gfxHold && now - state.gfxHold < 4000); // holdForShaders: keep the last frame while a preset's programs compile
  if (dbgOff.shadows) SHADOW_UNIFORMS.uShP.value.x = 0; else if (draw) shadows.update(renderer, scene, camera, cw, terrain.cam.agl, env.sunDir);
  if (draw && !wreck.active && visual.renderShadowMap) visual.renderShadowMap(renderer); // the Skyhawk's ground-shadow silhouette
  // the aircraft's own shadow map (self-shadowing) only changes when the aircraft turns, the sun moves, the gear or the elevons move, or the aircraft
  // moves relative to the camera; in a steady cockpit view none of that happens for seconds at a time, so it is redrawn on change only
  // the sun light and its shadow camera follow the jet (env.sun below) and only the jet casts into this map, so where the jet is does not matter:
  // the root position terms that were here changed every frame in flight and made it redraw ~300k triangles every frame
  { const q = fdm.quat, sd = env.sunDir, g = shAt;
    const cur = g.cur || (g.cur = new Float64Array(12)); cur[0] = q.x; cur[1] = q.y; cur[2] = q.z; cur[3] = q.w; cur[4] = sd.x; cur[5] = sd.y; cur[6] = sd.z; cur[7] = fdm.gearPos; cur[8] = fdm.surf.de; cur[9] = fdm.surf.da; cur[10] = fdm.surf.dr; cur[11] = fdm.flaps || 0;
    let dirty = ++shAt.n % 24 === 0 || !g.v;
    if (!dirty) for (let i = 0; i < cur.length; i++) if (Math.abs(cur[i] - g.v[i]) > 2e-4) { dirty = true; break; }
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = dirty; // set after the cascade renders, which would otherwise consume it
    if (dirty) { (g.v || (g.v = new Float64Array(12))).set(cur); stat.did('sunShadow'); } else stat.skip('sunShadow'); }
  if (post.clouds) {
    clouds.mesh.visible = false; // volumetric clouds replace the billboard ones
    post.cloudParams = { camAlt: cw.y, camXZ: cloudXZ.set(cw.x, cw.z), coverage: cloudEff.cover, base: cloudEff.base,
      time: now / 1000, wind: cloudWind };
    // the jet cuts a tunnel through the cloud it flies in: its recent path is carved out of the density, wider and longer-lived with the afterburners lit
    { const top = cloudTop(cloudEff.base, cloudEff.cover), inLayer = !wreck.active && cw.y > cloudEff.base - 400 && cw.y < top + 400 && fdm.pos.y > cloudEff.base - 300 && fdm.pos.y < top + 300;
      const tr = state.cloudTrail || (state.cloudTrail = []), last = tr[tr.length - 1], ab = Math.max(fdm.engines[0].ab, fdm.engines[1].ab);
      if (!state.paused && inLayer && (!last || Math.hypot(fdm.pos.x - last.x, fdm.pos.y - last.y, fdm.pos.z - last.z) > 70)) { tr.push({ x: fdm.pos.x, y: fdm.pos.y, z: fdm.pos.z, t: now / 1000, r0: 32 + 22 * ab }); if (tr.length > 12) tr.shift(); }
      const pts = [];
      if (inLayer || tr.length) for (let i = tr.length - 1; i >= 0; i--) { const q = tr[i], age = now / 1000 - q.t, life = 14 + 10 * (q.r0 > 40 ? 1 : 0), r = q.r0 * (1 + 0.5 * age / life) * Math.max(0, 1 - age / life); if (r > 4) pts.push({ x: q.x - cw.x, y: q.y - cw.y, z: q.z - cw.z, r }); }
      if (inLayer) pts.unshift({ x: fdm.pos.x - cw.x, y: fdm.pos.y - cw.y, z: fdm.pos.z - cw.z, r: 34 + 22 * ab });
      vclouds.setCarve(pts.slice(0, 12)); }
  } else post.cloudParams = null;
  perf.mark('visuals+shadows');
  // Screen-space AO is tuned for the outside world; in the tiny enclosed cockpit it crushed every surface to black. Fade it out there.
  const highUp = fdm.pos.y - state.lastGround > 4000;
  aoNow += ((rig.view === 'cockpit' || pressure.level >= 1 || highUp ? 0 : aoBase) - aoNow) * Math.min(1, dt * 6);
  if (post.enabled) post.aoStrength = aoNow < 0.03 ? 0 : aoNow; // below this the pass is skipped entirely
  if (bisect.mode) { const m = bisect.mode, was = [terrain.group.visible, trees.group.visible, buildings.group.visible, visual.root.visible];
    terrain.group.visible = m === 1 || m === 4 ? false : was[0]; trees.group.visible = m === 2 || m === 4 ? false : was[1]; buildings.group.visible = m === 2 || m === 4 ? false : was[2]; visual.root.visible = m === 3 ? false : was[3];
    bisect.restore = () => { terrain.group.visible = was[0]; trees.group.visible = was[1]; buildings.group.visible = was[2]; visual.root.visible = was[3]; }; }
  let masked = false;
  if (draw && rig.view === 'cockpit' && bisect.mode !== 5) { perf.gpuSection('cockpit mask'); masked = occlusion.render(renderer, scene, camera); stat[masked ? 'did' : 'skip']('cockpitMask'); }
  OCC_UNIFORMS.uOccOn.value = masked ? 1 : 0; // on for the scene pass only: the mask belongs to this camera and this size
  post.fxOn = fdm.engines.some((e) => e.dry > 0.01) || airflow.state.mach > 0.02; // engine plume and airframe vapour pass
  post.prof = (l) => perf.gpuSection(l); if (!post.enabled) perf.gpuSection('scene (no post)');
  if (draw) post.render(scene, camera); perf.gpuEnd(); OCC_UNIFORMS.uOccOn.value = 0; if (bisect.mode) bisect.restore();
  perf.mark('render');

  const spdU = settings.metric ? 3.6 : KT, altU = settings.metric ? 1 : FT;
  hud.draw({
    pitch: att.pitch, bank: att.bank, heading: att.heading, alpha: out.alpha || 0, beta: out.beta || 0,
    ias: casMs() * spdU, tas: (out.V || 0) * spdU, alt: fdm.pos.y * altU, vs: fdm.vel.y * (settings.metric ? 1 : 196.85), agl: Math.max(0, agl) * altU,
    mach: out.M || 0, g: out.nz || 1, thr: fdm.spool, speed: fdm.vel.length(), metric: settings.metric,
    cockpit: rig.view === 'cockpit', fov: camera.fov, night: env.night, ...warn, gearWarn: warn.gearUnsafe,
    ap: ap.on ? `AP ${ap.status.lat} ${ap.status.vert} ${ap.modes.mach ? 'MACH' : ap.modes.spd ? 'SPD' : ''}${ap.status.prot ? ' · ' + ap.status.prot : ap.status.warn ? ' · ' + ap.status.warn : ''}` : (state.slew ? 'SLEW' : ''),
    navCue: cueFor(state.navOut),
    apHdg: ap.on && ap.cmdHdg != null ? ap.cmdHdg : null, apAlt: ap.on && ap.modes.alt ? ap.target.alt * altU : null, apSpd: ap.on && ap.modes.spd ? ap.target.spd * spdU * (casMs() / Math.max(1, iasMs)) : null,
  });

  // sound: distance, direction, doppler, silence ahead of the Mach cone and a boom when it sweeps past
  const rel = new THREE.Vector3().subVectors(cw, fdm.pos), camDist = rel.length();
  const dirToCam = camDist > 0.01 ? rel.clone().divideScalar(camDist) : new THREE.Vector3(1, 0, 0);
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(fdm.quat);
  const M = out.M || 0, a = out.a || 340, vRad = fdm.vel.dot(dirToCam);
  let coneSilent = false;
  if (M > 1 && rig.view !== 'cockpit' && fdm.vel.lengthSq() > 1) {
    const theta = Math.acos(Math.max(-1, Math.min(1, fdm.vel.clone().normalize().dot(dirToCam))));
    coneSilent = theta < Math.PI - Math.asin(1 / M);
  }
  if (state.coneSilent && !coneSilent && rig.view !== 'cockpit' && camDist < 25000) { audio.play('boom'); state.bump += 0.6; }
  state.coneSilent = coneSilent;
  try {
    audio.update({
      paused: state.paused || !!state.pending, cockpit: rig.view === 'cockpit', camDist, camFwdDot: fwd.dot(dirToCam),
      inMachConeAhead: coneSilent, doppler: a / Math.max(a * 0.3, a - vRad), mach: M, engines: IS_SF50 ? [fdm.engines[0]] : fdm.engines, fan: IS_SF50, profile: IS_IL76 ? 'turbofan4' : null, piston: IS_C172 ? { rpm: fdm.rpm || 0, thr: fdm.throttle } : null,
      crashed: !!fdm.crashed, rho: out.rho || 1.2, ias: iasMs * KT, onGround: fdm.onGround, gs: fdm.vel.length(), rain: weather.rain,
      gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999, warnTone: IS_IL76 ? il76c.warnTone(warn) : warn.pullUp ? 2 : (warn.stall ? 1 : 0), warn,
      ...(IS_IL76 ? { flapMoving: Math.abs(fdm.flaps - IL76_NOTCHES[fdm.flapCmd].flap) > 0.05 || Math.abs(fdm.slats - IL76_NOTCHES[fdm.flapCmd].slat) > 0.05, cargoMoving: visual.cargoMoving(),
        revMoving: fdm.engines.some((e) => e.rev > 0.02 && e.rev < 0.98), spoilers: fdm.spoilers, apu: fdm.onGround && fdm.vel.length() < 6 } : {}),
      callout: { aglFt: (fdm.pos.y - state.lastGround - CG_H) * FT, vsFpm: fdm.vel.y * FT * 60, onGround: fdm.onGround, throttle: fdm.throttle, crashed: fdm.crashed },
    });
  } catch (e) { console.warn('audio', e); }

  perf.mark('hud+audio');
  // overlays
  const inside = rig.view === 'cockpit';
  if (state.started && cmap.visible) { const cl = aircraftLatLon(), n = state.navOut || {};
    cmap.update({ lat: cl.lat, lon: cl.lon, hdg: attitude(fdm.quat).heading, trackDeg: (Math.atan2(fdm.vel.x, -fdm.vel.z) * 180 / Math.PI + 360) % 360, gsKt: Math.hypot(fdm.vel.x, fdm.vel.z) * KT,
      altFt: fdm.pos.y * FT, route: nav.wps, activeIdx: nav.active, arrival: nav.arrival, ils: { valid: !!n.ilsValid, ident: n.ilsIdent, distNm: n.distNm }, metric: settings.metric }, now); }
  $('strip').style.display = settings.strip && (!inside || IS_GA || IS_IL76) && state.started ? 'flex' : 'none';
  uiT += dt; mapT += dt;
  if (uiT > 0.1) {
    uiT = 0;
    const txt = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };
    const gs = Math.hypot(fdm.vel.x, fdm.vel.z);
    txt('d-spd', Math.round(casMs() * spdU)); txt('d-spd2', IS_C172 ? `TAS ${Math.round((out.V || 0) * spdU)} ${settings.metric ? 'km/h' : 'kt'} · ${Math.round(fdm.rpm || 0)} RPM` : `M ${(out.M || 0).toFixed(2)} · TAS ${Math.round((out.V || 0) * spdU)} ${settings.metric ? 'km/h' : 'kt'}`);
    txt('d-alt', Math.round(fdm.pos.y * altU).toLocaleString()); txt('d-alt2', `VS ${Math.round(fdm.vel.y * (settings.metric ? 1 : 196.85))} · AGL ${Math.round(Math.max(0, agl) * altU).toLocaleString()}`);
    txt('d-hdg', String(Math.round(att.heading) % 360).padStart(3, '0') + '°'); txt('d-hdg2', `GS ${Math.round(gs * spdU)} · ${(out.nz || 1).toFixed(1)} g`);
    const lb = fdm.fuel * 2.20462;
    if (IS_C172) txt('d-fuel', settings.metric ? Math.round(fdm.fuel / 0.72) : (fdm.fuel / 2.72).toFixed(1)); else
    txt('d-fuel', settings.metric ? Math.round(fdm.fuel).toLocaleString() : Math.round(lb).toLocaleString()); txt('d-fuel2', `${IS_C172 ? (settings.metric ? 'L' : 'gal') : settings.metric ? 'kg' : 'lb'} · ${Math.round(fdm.fuel / FUEL_MAX * 100)}%`);
    if (IS_IL76) fdm.engines.forEach((e, i) => { const el = $(['d-tl', 'd-tr', 'd-t3', 'd-t4'][i]); el.style.height = Math.min(100, e.n1) + '%'; el.style.background = e.rev > 0.5 ? '#f2b84b' : !e.lit ? '#e5342a' : '#5ee1ff'; }); // N1 bars
    else if (IS_GA) { const el = $('d-tl'); el.style.height = Math.min(100, fdm.engines[0].dry * 100) + '%'; el.style.background = '#5ee1ff'; } else
    fdm.engines.forEach((e, i) => { const el = $(i ? 'd-tr' : 'd-tl'); el.style.height = Math.min(100, (e.dry * 75 + e.ab * 25)) + '%'; el.style.background = e.ab > 0.01 ? '#ff7b2e' : e.unstart > 0 ? '#e5342a' : '#5ee1ff'; });
    if (IS_IL76) txt('d-thr', `${fdm.reverserCmd ? 'REV ' : ''}${fdm.throttle < 0.02 ? 'IDLE' : Math.round(fdm.throttle * 100) + '%'} · ${IL76_NOTCHES[fdm.flapCmd].name}${fdm.spoilers > 0.5 ? ' · SPLR' : ''}`); else
    if (IS_GA) txt('d-thr', `${fdm.throttle < 0.02 ? 'IDLE' : Math.round(fdm.throttle * 100) + '%'} · FLAPS ${Math.round(fdm.flaps || 0)}°`); else
    txt('d-thr', fdm.throttle < 0.02 ? 'IDLE' : fdm.throttle > 0.75 ? `A/B ${Math.round((fdm.throttle - 0.75) / 0.25 * 100)}%` : `${Math.round(fdm.throttle / 0.75 * 100)}% MIL`);
    const pill = (id, cls) => { $(id).className = 'pill' + (cls ? ' ' + cls : ''); };
    pill('p-gear', fdm.gearPos > 0.02 && fdm.gearPos < 0.98 ? 'a' : fdm.gearDown ? 'g' : '');
    // the gear takes 7 s: show which way it is going and how far, so retraction reads as clearly as extension
    const moving = fdm.gearPos > 0.02 && fdm.gearPos < 0.98;
    txt('p-gear', IS_C172 ? `FLAPS ${FLAP_DEG[fdm.flapCmd]}` : moving ? (fdm.gearDown ? 'GEAR ▼' : 'GEAR ▲') : 'GEAR'); $('p-gear').style.setProperty('--p', `${Math.round(fdm.gearPos * 100)}%`);
    pill('p-brk', fdm.parkingBrake ? 'a' : fdm.brakes > 0 ? 'g' : ''); { const t = autobrake.level ? 'BRK ' + AUTOBRAKE[autobrake.level] : 'BRK', el = $('p-brk'); if (el.textContent !== t) el.textContent = t; }
    ['d-tl', 'd-tr', 'd-t3', 'd-t4'].forEach((id, i) => { const el = $(id); if (el) el.parentElement.style.boxShadow = controls.engSel === i + 1 ? '0 0 0 2px #ffd166' : ''; }); // the selected engine's bar
    pill('p-chute', fdm.chute === 'deployed' ? 'g' : fdm.chute === 'failed' ? 'r' : '');
    pill('p-ap', ap.on ? 'g' : ''); $('p-ap').textContent = ap.on ? ap.status.lat : 'A/P';
    pill('p-ab', fdm.engines.some((e) => e.ab > 0.01) ? 'a' : '');
    pill('p-uns', fdm.engines.some((e) => e.unstart > 0) ? 'r' : '');
    const w = [];
    if (warn.pullUp) w.push('PULL UP'); if (warn.stall) w.push('STALL'); if (warn.overG) w.push('OVER G');
    if (warn.gearUnsafe) w.push('GEAR'); if (warn.overspeed) w.push('OVERSPEED'); if (warn.lowFuel) w.push('LOW FUEL');
    txt('warnline', inside ? '' : w.join('   '));
    txt('st-fps', `${Math.round(fps)} fps`);
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
    txt('st-time', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local`);
    if (tw) txt('st-near', `${tw.a.ident} ${(tw.d / NM).toFixed(tw.d < 20 * NM ? 1 : 0)} NM`);
    if (ap.on) {
      $('ap-ann').textContent = ap.status.prot || `${ap.status.lat} · ${ap.status.vert}${ap.modes.mach ? ' · MACH' : ap.modes.spd ? ' · SPD' : ''}${ap.status.warn ? ' · ' + ap.status.warn : ''}`;
      $('ap-ann').className = 'ann on' + (ap.status.prot || ap.status.warn ? ' warn' : '');
    }
    else { $('ap-ann').textContent = ap.modes.appr ? 'APPR ARMED' : 'OFF'; $('ap-ann').className = 'ann'; }
    if (settings.runClock) syncEnvUi();
  }
  if (mapT > 0.5) {
    mapT = 0;
    const open = $('sheet-map').classList.contains('open');
    mapPanel.update(ll.lat, ll.lon, att.heading, fdm.vel, open);
    mapPanel.live.setActive(open);
    if (!open && state.started && !state.pending) mapPanel.live.background(ll);
    if (open) renderRoute();
    syncAp();
  }
  perf.mark('ui');
}

// The first frame of a wreck draws materials and effects that were never rendered, and compiling those shaders mid-crash froze the
// page for seconds before jumping to the wreck. Build a throwaway wreck once, compile it into the same target the frame uses, then clear it.
let crashWarm = false;
// the crash scene (wreck, fire, extra light) set up for a shader compile and taken down again in the same tick, so no frame ever draws it
function crashWarmSetup() {
  if (wreck.active || !state.lastSpawn) return null;
  const f = IS_C172 ? new C172Model() : IS_SF50 ? new SF50Model() : IS_IL76 ? new IL76Model() : new FlightModel(); f.reset(new THREE.Vector3(0, 40, 0), 0, IS_C172 ? 50 : IS_SF50 ? 60 : IS_IL76 ? 110 : 150, false, 0); f.crash('warm-up');
  wreck.start(visual, f, 'impact');
  wreck.light.intensity = 1; wreck.ground.ring.visible = true;
  return () => { wreck.clear(visual); wreck.ground.ring.visible = false; wreck.light.intensity = 0; };
}
const warm = { started: false, done: false, ms: 0, programs: 0, promise: null, final: false };
function startWarm(again) {
  if (warm.started && !again) return warm.promise; warm.started = true; warm.done = false;
  try { occlusion.warm(renderer, camera); } catch (e) { console.warn('cockpit mask warm-up failed', e); }
  warm.promise = Promise.resolve().then(() => { const undo = revealCockpit(); try { return warmShaders(warmArgs()); } finally { undo(); } })
    .then((r) => { warm.programs = r.programs; warm.ms = r.ms; finishPrograms(renderer).then((n) => { warm.finished = n; }); }).catch((e) => console.warn('shader warm-up failed', e)).finally(() => { warm.done = true; });
  return warm.promise;
}
function warmArgs() {
  const extra = [terrain.material, buildings._material(), ...trees.nearMat, trees.impMat], casters = [buildings.casterMat, ...trees.casterOf.values()];
  const extraPost = [cloudShadow.mat, ...(visual.glassWater ? visual.glassWater.meshes.flatMap((m) => m.userData.mats || []) : [])];
  return { renderer, scene, camera, post, shadows, vclouds, extra, casters, extraPost, crash: crashWarmSetup };
}
// preset switch in flight: the new post, cloud and shadow programs (and, Low <-> the rest, every scene program, since drawing to the screen instead of a target
// changes them) compile in parallel while the last frame stays up (frameBody skips drawing, 4 s at most), instead of the next frame linking them one by one (~2 s freezes)
function holdForShaders() {
  if (!state.started) return;
  const t = state.gfxHold = performance.now(); let p;
  const undo = revealCockpit(); try { p = warmShaders(warmArgs()); } catch (e) { p = Promise.resolve(); } finally { undo(); }
  p.catch(() => {}).finally(() => { if (state.gfxHold === t) state.gfxHold = 0; finishPrograms(renderer); }); // a later switch starts its own hold
}
// the cockpit (and its parents) is only visible in the cockpit view, so the warm-up above skipped it and the first switch compiled its shaders (1.2-1.4 s frames)
function revealCockpit(extra = []) {
  const shown = [], show = (o) => { for (let p = o; p && p !== scene; p = p.parent) if (!p.visible) { p.visible = true; shown.push(p); } };
  (visual.cockpit || []).forEach(show); if (visual.real && visual.real.interior) show(visual.real.interior); extra.forEach(show);
  return () => { for (const o of shown) o.visible = false; };
}
function prewarmCrash() { startWarm(); }

// ---------- boot ----------
(async () => {
  const bar = (p, msg) => {
    $('loadbar').style.width = (p * 100) + '%'; if (msg) $('loadmsg').textContent = msg;
    if (window.__startQueued) { $('ls-fill').style.width = (p * 30) + '%'; $('ls-pct').textContent = Math.round(p * 30) + '%'; if (msg) $('ls-sub').textContent = msg; }
  };
  loadWayback(`${BASE}data/wayback.json`); // finer archived Esri releases at some airports; optional
  try {
    await Promise.all([
      visual.load(`${BASE}models/${AC.model}`, (p) => bar(p * 0.6, 'Loading aircraft…')),
      db.load(`${BASE}data/airports.json`),
    ]);
  } catch (e) { $('loadmsg').textContent = 'Loading failed: ' + e.message; lsEl.hidden = true; console.error(e); return; }
  bar(0.8, 'Loading scenery…');
  visual.registerOccluders(occlusion);
  visual.attachSelfShadow(env.sun); // self-shadow and the finest cascade draw the ~37k triangle LOD proxy, not the ~300k triangle airframe
  wreck.prepare(visual).catch((e) => console.warn('crash split precompute failed', e)); // idle-time slices: impact no longer splits ~250k triangles on the spot
  // then, once the shader warm-up has linked everything, the piece geometries get their first draw (VAOs, sorted index upload) before any impact
  wreck.piecesWarmed = wreck.prepared.then(() => new Promise((res) => { const w = () => (warm.finished !== undefined ? whenIdle(res, 4000) : setTimeout(w, 500)); w(); }))
    .then(() => wreck.warmPieces(visual, renderer, scene, camera, post.enabled ? post.sceneRT : null)).catch((e) => console.warn('crash piece warm-up failed', e));
  if (visual.gearRig) visual.gearRig.onDoor = (d) => audio.play('gear-door', d === 'open' ? -1 : 1);
  if (IS_IL76) visual.onDoorSound = (k) => audio.play('cargo-clunk', k === 'cargo-open' ? -1 : 1); // the cargo hatch reaching its stops
  const a = homeAirport();
  dep.apt = a; dep.rwy = Math.min(home.rwy, a.runways.length - 1); dep.end = home.end;
  $('dep-q').value = `${a.ident} — ${a.name}`;
  renderHome(); renderDep(); syncEnvUi(); renderSum(); renderRoute();
  spawn(a.runways[dep.rwy].spawn(dep.end, 'runway'), { rwy: a.runways[dep.rwy], end: dep.end });
  $('start-btn').disabled = false; $('home-go').disabled = false;
  window.__simReady = true;
  if (window.__startQueued) { const id = window.__startQueued; window.__startQueued = null; $(id).click(); } // clicked while loading: start now
  setView('orbit'); rig.orbit.az = 0.9; rig.orbit.el = 0.14; rig.orbit.dist = IS_C172 ? 16 : IS_SF50 ? 18 : IS_IL76 ? 66 : 46;
  bar(1, 'Preparing graphics…');
  setTimeout(() => startWarm().then(() => { // once the first frames have set the lights and environment the shaders depend on
    visual.lateReady.then((late) => { if (!late.length) return; const undo = revealCockpit(late); try { return warmLate({ renderer, scene, camera, post }, late); } finally { undo(); } }).catch((e) => console.warn('late warm-up failed', e));
    whenIdle(() => warmTextures(renderer, visual.cockpitTextures()));
    // the engine and wind sounds are ~40 s of synthesised noise buffers: build them now, while the menu is up, instead of in the first click
    // (the context starts suspended without a gesture; the click's audio.init() only resumes it)
    whenIdle(() => { try { audio.init(); } catch (e) { console.warn('audio prepare failed', e); } }, 6000);
  }), 700);
  // test hook: advance the simulation without waiting for animation frames
  const advance = (sec) => { for (let t = 0; t < sec; t += 1 / 60) { controls.update(1 / 60); state.navOut = nav.update(aircraftLatLon(), fdm.pos.y, fdm.vel.length(), (fdm.out.M || 0) > 1 ? 35 : 30); if (!state.paused && !fdm.crashed && !state.pending) simulate(1 / 60); } return { alt: fdm.pos.y, M: fdm.out.M, crashed: fdm.crashed }; };
  const advanceWreck = (sec) => { for (let t = 0; t < sec; t += 1 / 30) if (wreck.active) stepWreck(1 / 30, rig.world); return { t: wreck.t, settled: wreck.settled() }; };
  // advance until the wreck's own clock (which runs slow at first) reaches t
  const advanceWreckTo = (t) => { for (let n = 0; wreck.active && wreck.t < t && n < 5000; n++) stepWreck(1 / 30, rig.world); return { t: wreck.t, settled: wreck.settled() }; };
  window.__sim = { aircraft: AIRCRAFT, cmap, warp, autoland, configureCameraAircraft, depthMode: REV_DEPTH ? 'reversed' : 'log', cloudEff, shadows, takeoff, ap, rotAssist, controls, occlusion, occUniforms: OCC_UNIFORMS, GFX, applyGfx, stat, ChangeGate, cloudAdapt, warm, cloudShadow, airflow, traffic, perf, hud, post, vclouds, THREE, prewarmCrash, applyWeather, weather, simulate, advanceWreck, advanceWreckTo, fdm, wreck, terrain, buildings, trees, post, shadows, geo, db, nav, visual, rig, ap, spawn, spawnAt, setView, state, env, settings, controls, toggleAp, readAp, advance, attitude, audio, renderer, scene, camera, openSheet,
    // round 4 test hooks: which mission runs, the map's teleport, and the restart key's action
    missionInfo: () => ({ kind: missionKind, mission: mission ? mission.constructor.name : null, phase: mission ? mission.phase : null, tour: tour.active, tutorial: tutorial.active, toasts: [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent).slice(-3) }),
    mapTeleport: (lat, lon) => mapPanel.cb.teleport(lat, lon), mapPanel, restart, holdForShaders, showAirport, homeAirport };
  state.bootT = performance.now(); requestAnimationFrame(frame); syncHiddenPump(); // a tab opened in the background never fires visibilitychange
})();
