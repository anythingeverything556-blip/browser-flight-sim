import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Geo, haversine, bearing, D2R } from './geo.js';
import { stickGearing, rollGearing } from './handling.js';
import { Tour } from './tour.js';
import { Tutorial } from './tutorial.js';
import { RainField } from './rain3d.js';
import { MISSIONS, createMission } from './missions.js';
import { Terrain, TERRAIN_UNIFORMS } from './terrain.js';
import { terrainMaterial } from './terrain-shader.js';
import { Buildings } from './buildings.js';
import { Trees } from './trees.js';
import { Turbulence, windSpeedAt } from './turbulence.js';
import { AirportDB } from './airportdb.js';
import { Navigation } from './nav.js';
import { Environment } from './sky.js';
import { Clouds } from './clouds.js';
import { FlightModel, SPEC } from './flight.js';
import { AircraftSystems } from './systems.js';
import { AircraftVisual } from './aircraft.js';
import { CameraRig, VIEWS, VIEW_NAMES } from './camera.js';
import { Controls } from './controls.js';
import { Autopilot, attitude, flareSink, AID_AGL } from './autopilot.js';
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
import { Airflow } from './airflow.js';
import { CloudShadow } from './cloudshadow.js';
import { warmShaders } from './warmup.js';
import { CockpitOcclusion, OCC_UNIFORMS } from './occlusion.js';

const $ = (id) => document.getElementById(id);
const FT = 3.28084, KT = 1.943844, NM = 1852;
const START_FUEL = 25000; // kg
const BASE = import.meta.env.BASE_URL;
const LS = { get: (k, d) => { try { const v = localStorage.getItem('sr71sim.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('sr71sim.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

// ---------- renderer & scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight, false);
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
const trees = new Trees(scene, geo, terrain, db);
const env = new Environment(scene, renderer);
const clouds = new Clouds(scene);
const fdm = new FlightModel();
const aircraftSystems = new AircraftSystems();
let systemsState;
const visual = new AircraftVisual(scene);
const wreck = new Wreck(scene);
const post = new PostFX(renderer);
const vclouds = new VolumetricClouds(renderer);
const shadows = new WorldShadows([buildings.group, trees.group, visual.root, wreck.group], renderer);
const perf = new PerfMonitor(renderer, () => `terrain ${terrain.stats.visible} tiles ${terrain.stats.tris} tris, ${terrain.stats.imgActive + terrain.stats.demActive} loading, ${terrain.stats.imgWait} queued · buildings ${buildings.stats.tiles} tiles ${(buildings.stats.tris / 1e3).toFixed(0)}k tris · render ${renderer.domElement.width}x${renderer.domElement.height} px for a ${innerWidth}x${innerHeight} window (pixel ratio ${renderer.getPixelRatio().toFixed(2)}, dynres ${dynres.scale.toFixed(2)}) · clouds ${post.clouds ? 'on' : 'off'}\nscreen: devicePixelRatio ${(devicePixelRatio || 1).toFixed(2)}, page zoom/pinch ${(visualViewport ? visualViewport.scale : 1).toFixed(2)}, ${screen.width}x${screen.height} CSS px\ntargets: ${post.sizes()} · cockpit mask ${occlusion.enabled ? (occlusion.stats.w ? `${occlusion.stats.w}x${occlusion.stats.h}, ${occlusion.stats.calls} draws` : 'not used yet') : 'off'}`);
const bisect = perf.bindBisect(['normal', 'terrain hidden', 'trees + buildings hidden', 'aircraft + cockpit hidden', 'terrain + trees + buildings hidden', 'cockpit hidden-surface mask off']);
const occlusion = new CockpitOcclusion(); // cockpit view only: the heavy materials skip what lies behind the panel and consoles
const dbgOff = perf.bindSwitches(); post.dbg = dbgOff; // F5-F9 in the overlay: switch passes off one at a time to find which one flickers or costs frame time
const sizePost = () => { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); post.setSize(v.x, v.y); };
addEventListener('resize', sizePost);
const rig = new CameraRig(camera, canvas);
const controls = new Controls();
controls.enabled = false; // until a flight is started from the setup screen
const ap = new Autopilot();
const nav = new Navigation();
const hud = new HUD($('hud'));
const audio = new Audio();
hud.visible = false; // the real SR-71 has no HUD

const settings = Object.assign({ unstarts: true, metric: false, crash: true, clouds: 0.3, cloudBase: 6000 / FT, windDir: 320, windSpd: 8 / KT, turb: 0.1, runClock: false, vis: 1, volume: 0.7, gfx: 'high', shake: false, dynres: false, relief: 0.75, strip: true, buildings: true, trees: true, rscale: 2, assist: false, landAid: true, metarAuto: true, traffic: true }, LS.get('settings', {}));
// earlier builds forced Normal and switched on adaptive resolution (which renders at as little as 55 %): undo both once
if (!settings.gfxV3) { settings.gfxV3 = true; settings.dynres = false; if (settings.gfx === 'normal' || settings.gfx === 'low') settings.gfx = 'high'; LS.set('settings', settings); }
// render resolution now defaults to 200 % (the old default of 100 % was the "144p" complaint): move existing saved settings over once
if (!settings.gfxV4) { settings.gfxV4 = true; settings.rscale = 2; LS.set('settings', settings); }
// the F3 of one player showed adaptive resolution still ON from an older save and sitting at its 55 % floor (the soft "144p" picture): off again, once
// flight assist is opt-in (the guide explains it); the landing aid is on; terrain relief shading is always 100 %
if (!settings.gfxV6) { settings.gfxV6 = true; settings.assist = false; settings.landAid = true; LS.set('settings', settings); }
settings.relief = 1;
if (!settings.gfxV5) { settings.gfxV5 = true; settings.dynres = false; LS.set('settings', settings); }
const saveSettings = () => LS.set('settings', settings);
const state = { paused: false, slew: false, pending: null, lastSpawn: null, lastGround: 34, bump: 0, overG: 0, coneSilent: false, navOut: {}, started: false };
const turb = new Turbulence();
let home = LS.get('home', { ident: 'KBAB', rwy: 0, end: 1 });
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
  state.ditch = false;
  if (wreck.active) { wreck.clear(visual); if (state.viewBeforeCrash) { setView(state.viewBeforeCrash); state.viewBeforeCrash = null; } }
  if (meta) fdm.fuel = START_FUEL; // airport starts and restarts refuel; teleports keep the current load
  state.lastSpawn = { s, meta, fuel: fdm.fuel };
  moveOrigin(s.lat, s.lon);
  turb.reset(); fdm.latDeg = s.lat;
  terrain.refreshNear(s.lat, s.lon, 50);
  fdm.reset(new THREE.Vector3(0, s.alt + (s.ground ? 2.42 : 0), 0), s.hdg, s.speed, s.ground, s.gamma || 0);
  fdm.onGround = !!s.ground; // reset() leaves the old flag until the next physics step, which would block an autopilot engage at spawn
  fdm.realism.unstarts = settings.unstarts;
  controls.throttle = fdm.throttle;
  ap.disengage(); syncAp();
  if (meta && meta.rwy) nav.setArrival(meta.rwy, meta.end);
  nav.legStart = null; // the active leg restarts from the new position
  state.pending = { ...s, t0: performance.now() };
  atc.reset();
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
  if (!terrain.heightReady(s.lat, s.lon) && waited < 15000) { $('st-state').textContent = '◌ LOADING TERRAIN'; return; }
  if (h === null) {
    if (waited < 45000) { $('st-state').textContent = '◌ LOADING TERRAIN'; return; }
    h = s.ground ? s.alt : Math.max(0, s.alt - 300); // airport elevation from the database
  }
  // then let the imagery around the aircraft sharpen (up to 12 s), so the first look at a place is not a blurry level
  // shaders compile in parallel while the menu is up; wait for them so the first seconds of flight do not hitch on a compile
  if (!warm.done && waited < 40000) { $('st-state').textContent = '◌ COMPILING GRAPHICS'; return; }
  // one more pass now that the lights, environment and fog are in their flight state: it only compiles what the menu-time pass could not know
  if (!warm.final) { warm.final = true; startWarm(true); return; }
  // the picture the player first sees must be the sharp one: wait for the ring of ground around the jet to show its imagery at a fine level (or for the
  // loader to run dry, which is as sharp as the provider gets there), up to 45 s
  const gs = groundStatus(s);
  if (!gs.ok && waited < 45000 && !state.fastSpawn) { $('st-state').textContent = `◌ LOADING IMAGERY ${Math.round(gs.p * 100)}%`; return; }
  // never start on a coarse tile: it is drawn above the runway, which puts the jet and the camera under the ground
  if (terrain.levelAt(s.lat, s.lon) < 11 && waited < 45000 && !state.fastSpawn) { $('st-state').textContent = '◌ SHARPENING GROUND'; return; }
  state.lastGround = h;
  if (s.ground) fdm.pos.y = h + 2.42; else fdm.pos.y = Math.max(fdm.pos.y, h + 300);
  state.pending = null;
  state.settleUntil = performance.now() + 12000; state.settleAir = !s.ground;
  pause(state.paused);
  $('loadmsg').textContent = 'Ready';
}
function spawnAt(apt, rwyIdx, end, mode) {
  const r = apt.runways[rwyIdx]; if (!r) return;
  spawn(r.spawn(end, mode), { rwy: r, end });
  toast(`${apt.ident} runway ${r.ends[end].ident} — ${mode === 'runway' ? 'ready for take-off' : mode === 'approach' ? '10 NM final' : mode === 'final' ? '5 NM final' : 'Mach 3.2 cruise'}`);
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
  setView('orbit'); Object.assign(rig.orbit, { az: -((s ? s.hdg : 0) * Math.PI) / 180, el: 0.2, dist: 60 });
}
function beginFlight() {
  document.body.classList.remove('intro'); state.started = true; controls.enabled = true; openSheet(null);
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
setInterval(() => document.querySelectorAll('input[type=range]').forEach(fillRange), 500);
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
function airportHeader(a) {
  const n = state.started ? nearDist(a) : '';
  return `<div class="dhead"><div><div class="id">${a.ident}${a.iata ? ' · ' + a.iata : ''}</div><h3>${a.name}</h3>
    <div class="sub">${[a.city, a.country].filter(Boolean).join(', ')} · elev ${fmtAlt(a.elev)}${n}</div></div>
    <span class="tag ${a.mil ? 'mil' : ''}">${a.typeName}</span></div>`;
}
function nearDist(a) { const ll = aircraftLatLon(); return ` · ${Math.round(haversine(ll.lat, ll.lon, a.lat, a.lon) / NM)} NM away`; }
function bindActions(root, a) {
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const [act, ri, ei] = b.dataset.act.split(':'); const r = a.runways[+ri];
    if (act === 'to') { spawnAt(a, +ri, +ei, 'runway'); openSheet(null); }
    else if (act === 'app') { spawnAt(a, +ri, +ei, 'approach'); openSheet(null); }
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
  $('home-sub').textContent = `Runway ${e.ident} · ${fmtLen(r.len)} · ${a.city || a.country}`;
}
$('home-go').addEventListener('click', () => {
  const a = db.ready && homeAirport(); if (!a) return;
  startWarm(); spawnAt(a, home.rwy, home.end, 'runway'); beginFlight();
  if (settings.metarAuto) loadMetar(a, true);
});

// ---------- flight setup ----------
function searchBox(input, results, onPick) {
  let items = [], sel = -1;
  const render = () => {
    results.innerHTML = items.map((a, i) => `<div class="res ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${a.ident}</b><div class="nm">${a.name}<small>${[a.city, a.country].filter(Boolean).join(', ')}</small></div><div class="rw ${a.mil ? 'mil' : ''}">${fmtLen(a.longest.len)}</div></div>`).join('');
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
  $('dep-card').querySelectorAll('.endbtn').forEach((b) => b.addEventListener('click', () => { dep.rwy = +b.dataset.r; dep.end = +b.dataset.e; renderDep(); prefetchPlace(); }));
}
// scenery for the chosen runway starts loading as soon as it is picked, not when Start is pressed
function prefetchPlace() {
  if (state.started || !dep.apt) return; const r = dep.apt.runways[dep.rwy]; if (!r) return;
  spawn(r.spawn(dep.end, 'runway'), { rwy: r, end: dep.end });
}
searchBox($('dep-q'), $('dep-results'), (a) => { dep.apt = a; dep.rwy = 0; dep.end = 0; renderDep(); prefetchPlace(); });
seg('start-mode', (v) => { dep.mode = v; });
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
weather.set(WEATHER[settings.weather] || WEATHER.few); setIntroWx(settings.weather || 'few'); setWxPreset(settings.weather || 'few');
$('start-btn').addEventListener('click', () => {
  const a = dep.apt || (db.ready && homeAirport()); if (!a) return;
  if ($('make-home').checked) setHome(a, dep.rwy, dep.end);
  const mode = missionKind === 'tutorial' || missionKind === 'tour' ? 'runway' : missionKind === 'landassist' ? 'approach' : missionKind === 'landhand' ? 'final' : dep.mode;
  startWarm(); spawnAt(a, dep.rwy, dep.end, mode);
  if (mode !== 'runway') { fdm.gearDown = mode === 'approach' || mode === 'final'; fdm.gearPos = fdm.gearDown ? 1 : 0; }
  beginFlight();
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
  return { iasKt: ias() * KT, agl: n.ilsValid ? n.agl : fdm.pos.y - state.lastGround, altFt: fdm.pos.y * FT, pitchDeg: att.pitch * 180 / Math.PI, hdg: att.heading,
    onGround: fdm.onGround, gearDown: fdm.gearDown, throttle: fdm.throttle, apOn: ap.on, apAltFt: ap.target.alt * FT, apHdg: ap.target.hdg,
    view: rig.view, orbitAz: rig.orbit.az, xtk: n.ilsValid ? n.locXtk : null };
}
// ---------- live weather (METAR) ----------
function applyMetarWx(w) {
  settings.weather = 'metar'; settings.clouds = w.coverage; settings.cloudBase = w.baseM; settings.windDir = w.windDir; settings.windSpd = w.windKt / KT; settings.turb = w.turb; settings.vis = w.vis;
  weather.set({ rain: w.rainIntensity ?? w.rain, gloom: w.gloom, fog: w.fog, bolts: w.thunder ? 1 : 0 });
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
      const atis = buildAtis({ metar: w.raw, information: String.fromCharCode(65 + atisIndex), runways: a.runways || [] });
      atc.say(`${a.name} ATIS`, atis, atis);
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
function updateLever() {
  const on = state.started && !state.pending; lever.el.hidden = !on; if (!on) return;
  const t = Math.max(0, Math.min(1, fdm.throttle));
  lever.knob.style.bottom = (t * 100) + '%'; lever.fill.style.height = `calc(${t * 100}% - ${t * 8}px)`;
  lever.track.setAttribute('aria-valuenow', Math.round(t * 100));
  lever.val.textContent = t < 0.02 ? 'IDLE' : t > 0.75 ? `A/B ${Math.round((t - 0.75) / 0.25 * 100)}%` : `${Math.round(t / 0.75 * 100)}% MIL`;
  const blink = !controls.touched && !ap.on;
  lever.el.classList.toggle('untouched', blink); document.querySelector('#strip .seg-d.thr').classList.toggle('untouched', blink);
}
const lsEl = $('loadscreen'), LS_TIPS = ['Shift and Ctrl move the throttle. 9 lights both afterburners.', 'Above Mach 2.3 keep the sideslip small or an inlet can unstart.', 'The J58 engines need about six seconds to spool up.', 'V cycles the cameras, M opens the map, ? shows every control.', 'Pull the drag chute with C after touchdown, below 200 knots.', 'The throttle lever on the right edge works with the mouse.'];
const loadUi = { shown: false, since: 0, done: false, tip: 0, fade: 0 };
const lsStep = (n, st) => { const li = lsEl.querySelector(`[data-step="${n}"]`); if (li) li.className = st; };
function updateLoadUi(now) {
  const pend = state.pending && state.started ? state.pending : null;
  if (pend) {
    loadUi.done = false;
    if (!loadUi.since) loadUi.since = now;
    if (!loadUi.shown && now - loadUi.since > 300) { loadUi.shown = true; lsEl.hidden = false; lsEl.classList.remove('out'); const a = state.lastSpawn && state.lastSpawn.meta && state.lastSpawn.meta.rwy && state.lastSpawn.meta.rwy.ap; $('ls-sub').textContent = a ? `${a.ident} — ${a.name}` : 'Getting the world ready…'; }
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
  if (Guide.seen() || guide.active || tutorial.active || tour.active || (missionKind && missionKind !== 'free' && missionKind !== 'none') || !fdm.onGround) return;
  guide.start();
}
$('guide-replay').addEventListener('click', () => { openSheet(null); guide.start(); });
const atc = new Atc($('radio'), audio);
function atcCtx() {
  const m = state.lastSpawn && state.lastSpawn.meta, rw = m && m.rwy, a = rw && rw.ap, n = state.navOut || {};
  const ll = aircraftLatLon();
  return { started: state.started && !state.pending && !state.paused, crashed: fdm.crashed, onGround: fdm.onGround, gsKt: fdm.vel.length() * KT, agl: (fdm.pos.y - state.lastGround) * FT, gearDown: fdm.gearDown,
    apt: a, rwy: rw ? rw.ends[m.end].ident : '', wind: { dir: settings.windDir, kt: settings.windSpd * KT }, nav: n, qnhHpa: state.metar && state.metar.qnhHpa,
    traffic: traffic.list, ownship: { lat: ll.lat, lon: ll.lon, alt: fdm.pos.y } };
}
const airflow = new Airflow(scene), cloudShadow = new CloudShadow();
TERRAIN_UNIFORMS.uCsTex.value = cloudShadow.rt.texture; TERRAIN_UNIFORMS.uCsTex2.value = cloudShadow.rtOld.texture;
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
  if (h.kind === 'throttle') { pickDrag.on = true; pickDrag.y0 = ev.clientY; pickDrag.t0 = controls.throttle; cvs.setPointerCapture(ev.pointerId); controls.touched = true; ev.preventDefault(); return; }
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
function startMission() {
  tour.stop(); tutorial.stop(); coachHidden = false; renderCoach(null); mission = null; clearBeacons(); $('mission').hidden = true;
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
    crashed: fdm.crashed, gearDown: fdm.gearDown, chute: fdm.chuteOpen || 0, pitchDeg: att.pitch * 180 / Math.PI, ilsValid: !!n.ilsValid, gsDev: n.gsDev || 0, locXtk: n.locXtk || 0, thrDist: n.thrDist || 0, apOn: ap.on });
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
  $('apt-list').innerHTML = items.map((a, i) => `<div class="res" role="button" tabindex="0" data-i="${i}"><b>${a.ident}</b><div class="nm">${a.name}<small>${[a.city, a.country].filter(Boolean).join(', ')}</small></div><div class="rw ${a.mil ? 'mil' : ''}">${fmtLen(a.longest.len)}</div></div>`).join('') || '<div class="sub" style="padding:12px">No airports found</div>';
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
  teleport: (lat, lon) => {
    const alt = Math.max(fdm.pos.y, 3000), spd = Math.max(fdm.vel.length(), 230);
    spawn({ lat, lon, alt, hdg: attitude(fdm.quat).heading, speed: spd, ground: false });
    fdm.gearDown = false; fdm.gearPos = 0; toast('Teleported');
  },
});
function renderRoute() {
  const ll = state.started ? aircraftLatLon() : null;
  let prev = ll;
  $('route-list').innerHTML = nav.wps.map((w, i) => {
    const d = prev ? haversine(prev.lat, prev.lon, w.lat, w.lon) / NM : 0; prev = w;
    return `<li class="${i === nav.active ? 'active' : ''}"><div class="nm">${w.name}<small>${d.toFixed(0)} NM</small></div><div class="ops"><button data-op="go:${i}" title="Fly direct">→</button><button data-op="up:${i}">↑</button><button data-op="dn:${i}">↓</button><button data-op="rm:${i}">✕</button></div></li>`;
  }).join('') || '<div class="sub">Click the map or use "Add to route" on an airport.</div>';
  $('route-list').querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => {
    const [op, i] = b.dataset.op.split(':');
    if (op === 'go') nav.activate(+i, aircraftLatLon()); else if (op === 'up') nav.move(+i, -1); else if (op === 'dn') nav.move(+i, 1); else nav.remove(+i);
  }));
  const tot = ll && nav.wps.length ? nav.totalNm(ll) : 0, gs = Math.hypot(fdm.vel.x, fdm.vel.z);
  $('route-sum').textContent = nav.wps.length ? `${tot.toFixed(0)} NM to go${gs > 30 ? ` · ETE ${Math.floor(tot * NM / gs / 60)} min at ${Math.round(gs * KT)} kt GS` : ''}` : '';
  const arr = nav.arrival;
  $('arr-box').textContent = arr ? `${arr.rwy.ap.ident} runway ${arr.rwy.ends[arr.end].ident} — ${arr.rwy.ils(arr.end) || 'visual'} · ${fmtLen(arr.rwy.len)}` : 'None — choose one from an airport';
}
nav.onChange(renderRoute);
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
function readAp() {
  ap.target.hdg = ((+apInputs.hdg.value % 360) + 360) % 360;
  ap.target.alt = (+apInputs.alt.value) / (settings.metric ? 1 : FT);
  ap.target.vs = (+apInputs.vs.value) / 196.85;
  ap.target.spd = (+apInputs.spd.value) / KT;
  ap.target.mach = +apInputs.mach.value;
  ap.target.vsLimit = Math.max(500, +apInputs.vsl.value) / 196.85;
}
Object.entries(apInputs).forEach(([k, el]) => {
  el.addEventListener('change', () => { apEdited.add(k); readAp(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.blur(); else e.stopPropagation(); });
});
document.querySelectorAll('.dial').forEach((d) => d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  // altitude steps are in feet; in metric 500 ft / 5000 ft become 100 m / 1000 m
  const step = (+b.dataset.d) * (d.dataset.k === 'alt' && settings.metric ? 0.2 : 1);
  const inp = d.querySelector('input'); let v = (+inp.value) + step;
  if (d.dataset.k === 'hdg') v = ((v % 360) + 360) % 360;
  if (d.dataset.k === 'mach') v = Math.max(0.3, Math.round(v * 100) / 100);
  inp.value = v; apEdited.add(d.dataset.k); readAp();
})));
const MODE_GROUPS = { hdg: ['hdg', 'nav'], nav: ['hdg', 'nav'], alt: ['alt', 'vs'], vs: ['alt', 'vs'], spd: ['spd', 'mach'], mach: ['spd', 'mach'] };
document.querySelectorAll('#ap-modes button').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.m, on = !ap.modes[m];
  if (on && MODE_GROUPS[m]) MODE_GROUPS[m].forEach((x) => { ap.modes[x] = false; });
  ap.modes[m] = on;
  if (m === 'nav' && on && !nav.wps.length) { ap.modes.nav = false; ap.modes.hdg = true; toast('No flight plan — add waypoints on the Map', true); }
  if (m === 'appr' && on && !nav.arrival) { ap.modes.appr = false; toast('Choose an arrival runway first (Airports → ILS)', true); }
  if (m === 'vs' && on) apInputs.vs.value = Math.round(fdm.vel.y * 196.85 / 100) * 100;
  readAp(); approachSpeedFloor(); syncAp();
}));
function syncApTargets(keys) {
  const att = attitude(fdm.quat);
  const val = { hdg: Math.round(att.heading) % 360, alt: Math.round(fdm.pos.y * (settings.metric ? 1 : FT) / 100) * 100,
    spd: Math.round(ias() * KT), mach: (fdm.out.M || 0).toFixed(2), vs: Math.round(fdm.vel.y * 196.85 / 100) * 100 };
  for (const k of keys) apInputs[k].value = val[k];
  readAp();
}
const APPROACH_KT = 180; // below this the jet is behind the power curve and cannot hold the glideslope
function approachSpeedFloor() {
  if (!ap.modes.appr) return;
  if (+apInputs.spd.value < APPROACH_KT) { apInputs.spd.value = APPROACH_KT; readAp(); }
  if (!ap.modes.spd && !ap.modes.mach) ap.modes.spd = true;
}
function engageAp() {
  if (fdm.onGround) { toast('Autopilot needs to be airborne', true); return; }
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
  const a = landAid, agl = fdm.pos.y - state.lastGround - 2.42;
  const on = settings.landAid && !fdm.onGround && !fdm.crashed && !state.slew && !state.paused && fdm.gearPos > 0.9 && agl > 0 && agl < AID_AGL && fdm.vel.y < -0.2
    && ias() * KT < 260 && Math.abs(controls.axes.pitch) < 0.25;
  if (!on) { if (a.on) a.disengage(); return; }
  if (!a.on) { a.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle }); Object.keys(a.modes).forEach((k) => { a.modes[k] = false; }); a.modes.vs = true; a.target.vsLimit = 20; a.tauV = 1.6; a.kiDiv = 8; }
  a.target.vs = flareSink(agl);
  fdm.ctrl.de = a.update(dt, { fdm, out: fdm.out, att: attitude(fdm.quat), vs: fdm.vel.y, alt: fdm.pos.y, ias: ias(), nav: {} }).de;
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
}

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
// seg: terrain mesh cells per tile side (the original 32 up to 64 on Ultra).
const GFX = {
  low: { detail: 2.0, leaves: 300, seg: 32, dpr: [1, 2], shadow: 1024, env: 128, scenery: 0.8, ground: 0.85, hiZ: 99, texMB: 300,
    post: { enabled: false }, world: [0, 1024, []], vclouds: null },
  normal: { detail: 2.2, leaves: 420, seg: 32, dpr: [1, 2], shadow: 2048, env: 256, scenery: 1, ground: 1, hiZ: 17, texMB: 450,
    post: { enabled: true, msaa: 0, ao: 0.8, aoSamples: 8, bloom: 0.2, smaa: true }, world: [2, 1024, [120, 1200]], vclouds: { scale: 0.6, steps: 32, lightSteps: 4 } },
  high: { detail: 2.6, leaves: 560, seg: 48, dpr: [1, 2], shadow: 4096, env: 256, scenery: 1.3, ground: 1, hiZ: 15, texMB: 700,
    post: { enabled: true, msaa: 2, ao: 0.9, aoSamples: 12, bloom: 0.22, smaa: true }, world: [3, 2048, [60, 400, 2500]], vclouds: { scale: 0.75, steps: 40, lightSteps: 5 } },
  ultra: { detail: 3.2, leaves: 760, seg: 64, dpr: [1.5, 2], shadow: 4096, env: 512, scenery: 1.7, ground: 1, hiZ: 13, texMB: 1000,
    post: { enabled: true, msaa: 4, ao: 1, aoSamples: 16, bloom: 0.22, smaa: true }, world: [3, 4096, [60, 450, 3000]], vclouds: { scale: 1, steps: 64, lightSteps: 6 } },
};
// Adaptive resolution: when frames run long the render scale steps down (to 60 % of the preset's), and back up when there
// is headroom. Checked every 1.5 s on the median frame time, so a single loading hitch does not trigger it.
const dynres = { base: 1, scale: 1, times: [], at: 0 };
// Render ratio = the preset's range around the screen's own ratio, times the render-resolution slider, capped at 3 so a 2x laptop screen at 200 %
// does not ask for 16x the pixels. The other costs are tied to the screen's own pixels, not to this ratio (see setRenderScale).
const MAX_RATIO = 3;
const baseRatio = (q) => Math.min(MAX_RATIO, Math.min(q.dpr[1], Math.max(q.dpr[0], devicePixelRatio)) * (settings.rscale || 1));
function setRenderScale() {
  const ratio = dynres.base * (settings.dynres ? dynres.scale : 1), native = Math.max(1, devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  // Supersampling already gives 4+ samples per screen pixel at 2x: hardware MSAA on top of it only costs bandwidth (4 samples of a half-float
  // target at 4x the pixels). Keep it where the buffer is near native size, where it is the anti-aliasing.
  const ss = ratio / native;
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
function adaptResolution(dt, now) {
  if (!settings.dynres || state.paused || state.pending) { dynres.times.length = 0; return; }
  dynres.times.push(dt);
  if (now - dynres.at < 1500 || dynres.times.length < 30) return;
  const t = dynres.times.sort((a, b) => a - b), med = t[t.length >> 1], p90 = t[(t.length * 0.9) | 0];
  dynres.times.length = 0; dynres.at = now;
  const old = dynres.scale;
  // every change reallocates the render and post targets, so move in small steps, never go below 75 % and wait before stepping back up
  if (med > 0.021 || p90 > 0.034) dynres.scale = Math.max(0.75, dynres.scale - (med > 0.03 ? 0.1 : 0.05));
  else if (med < 0.0135 && p90 < 0.02 && now - (dynres.changed || 0) > 6000) dynres.scale = Math.min(1, dynres.scale + 0.05);
  if (dynres.scale !== old) { dynres.changed = now; setRenderScale(); }
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
  post.configure(q.post); aoBase = q.post.ao || 0; aoNow = aoBase;
  wreck.setOverlay(q.post.enabled ? post.overlay : null);
  if (visual.glassWater) { post.glassWater = visual.glassWater; visual.glassWater.setMode(q.post.enabled ? 0 : 1); }
  rainField.attach(q.post.enabled ? post.overlay : scene, q.post.enabled);
  post.clouds = q.post.enabled && q.vclouds ? vclouds : null;
  if (post.clouds) vclouds.setQuality(q.vclouds);
  cloudAdapt.max = cloudAdapt.scale = q.vclouds ? q.vclouds.scale : 0.5;
  setRenderScale();
  shadows.configure(...q.world);
}
function rebase() { dynres.base = baseRatio(GFX[settings.gfx] || GFX.high); setRenderScale(); }
const setDetail = seg('detail', (v) => { settings.gfx = v; applyGfx(v); saveSettings(); });
const bindCheck = (id, key, fn) => { const el = $(id); el.checked = !!settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); fn && fn(el.checked); }); };
bindCheck('opt-strip', 'strip');
bindCheck('opt-buildings', 'buildings', (v) => { buildings.enabled = v; });
bindCheck('opt-trees', 'trees', (v) => { trees.enabled = v; });
bindCheck('opt-crash', 'crash');
bindCheck('opt-shake', 'shake');
bindCheck('opt-assist', 'assist', () => assist.release());
bindCheck('opt-landaid', 'landAid', () => landAid.on && landAid.disengage());
$('rscale').value = settings.rscale || 1; $('rscale-l').textContent = Math.round((settings.rscale || 1) * 100) + '%';
$('rscale').addEventListener('input', () => { settings.rscale = +$('rscale').value; $('rscale-l').textContent = Math.round(settings.rscale * 100) + '%'; saveSettings(); rebase(); });
// browser zoom or moving the window to another screen changes devicePixelRatio: re-derive the render scale so the picture stays native
let lastDpr = devicePixelRatio; addEventListener('resize', () => { if (devicePixelRatio !== lastDpr) { lastDpr = devicePixelRatio; rebase(); } });
bindCheck('opt-traffic', 'traffic', (v) => { traffic.enabled = v; });
bindCheck('opt-dynres', 'dynres', () => { dynres.scale = 1; setRenderScale(); });
bindCheck('opt-unstart', 'unstarts', (v) => { fdm.realism.unstarts = v; });
bindCheck('opt-fuel', 'fuel', (v) => { fdm.unlimitedFuel = v; });
bindCheck('opt-mouse', 'mouse', (v) => { controls.mouseStick = v; });
bindCheck('opt-hud', 'hud', (v) => { hud.visible = v; });
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
  $('b-pause').classList.toggle('on', state.paused);
  $('st-state').textContent = state.paused ? '❚❚ PAUSED' : fdm.crashed ? '✕ CRASHED' : '● FLYING'; $('st-state').className = 'chip ' + (state.paused || fdm.crashed ? 'paused' : 'live');
}
$('b-pause').addEventListener('click', () => pause());
$('b-sound').addEventListener('click', () => { audio.enabled = !audio.enabled; $('b-sound').classList.toggle('off', !audio.enabled); });
$('crash-reset').addEventListener('click', restart);
$('crash-apt').addEventListener('click', () => openSheet('airports', true));

// ---------- keyboard ----------
controls.on('gear', () => {
  if (fdm.onGround && fdm.gearDown) { toast('Weight on wheels — gear locked down', true); return; }
  fdm.gearDown = !fdm.gearDown; toast(fdm.gearDown ? 'Gear down' : 'Gear up');
});
controls.on('chute', () => {
  if (fdm.chute === 'stowed') { fdm.chute = 'deployed'; fdm.chuteOpen = 0; audio.play('chute'); toast('Drag chute deployed'); }
  else if (fdm.chute === 'deployed') { fdm.chute = 'jettisoned'; toast('Drag chute jettisoned'); }
  else toast('Drag chute already used — restart to repack', true);
});
controls.on('autopilot', toggleAp);
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
controls.on('slew', () => { state.slew = !state.slew; toast(state.slew ? 'Slew mode: arrows move, PgUp/PgDn climb' : 'Slew mode off'); if (!state.slew) fdm.vel.set(0, 0, 0); });
controls.on('idle', () => { controls.throttle = 0; controls.touched = true; });
controls.on('fullAB', () => { controls.throttle = 1; controls.touched = true; });
controls.on('parkingBrake', () => { fdm.parkingBrake = !fdm.parkingBrake; toast(fdm.parkingBrake ? 'Parking brake set' : 'Parking brake released'); });
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
  // the camera stays with the main wreckage and backs off as the debris and fire spread, circling slowly
  if (rig.view === 'orbit') {
    const want = THREE.MathUtils.clamp(55 + wreck.spread() * 1.1 + (wreck.fireRadius || 0) * 0.9, 80, 420);
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
  if (state.slew) {
    const s = controls.slew, att = attitude(fdm.quat);
    const agl = fdm.pos.y - groundAt(fdm.pos.x, fdm.pos.z);
    const speed = Math.max(40, agl * 0.6), h = att.heading * Math.PI / 180;
    fdm.pos.x += Math.sin(h) * s.fwd * speed * dt; fdm.pos.z -= Math.cos(h) * s.fwd * speed * dt;
    fdm.pos.y = Math.max(groundAt(fdm.pos.x, fdm.pos.z) + 2.42, fdm.pos.y + s.up * speed * 0.6 * dt);
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
  if (ap.on) {
    if (controls.manual) { ap.disengage(); syncAp(); toast('Autopilot disconnected by stick input', true); }
    else {
      const c = ap.update(dt, { fdm, out: fdm.out, att, vs: fdm.vel.y, alt: fdm.pos.y, ias: ias(), nav: state.navOut });
      fdm.ctrl.de = c.de; fdm.ctrl.da = c.da; fdm.ctrl.dr = c.dr;
      if (ap.modes.spd || ap.modes.mach || c.thrOverride) { fdm.throttle = c.th; controls.throttle = c.th; }
      if (ap.status.prot !== lastApProt) { if (ap.status.prot && !ap.status.recover) toast(`Autopilot ${ap.status.prot.toLowerCase()}`, true); lastApProt = ap.status.prot; }
      if (ap.status.gs && state.navOut.agl < 46) { ap.disengage(); syncAp(); toast('Minimums — autopilot disconnected. Flare and land.', true); }
    }
  }
  if (!ap.on && !tourFlying) {
    const shape = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4);
    const q = fdm.out.qbar || 0, M = fdm.out.M || 0;
    fdm.ctrl.de = stickGearing(shape(controls.axes.pitch), q, M); fdm.ctrl.da = rollGearing(shape(controls.axes.roll), q, M); fdm.ctrl.dr = controls.axes.yaw;
    flightAssist(dt); landingAid(dt);
  } else { assist.release(); landAid.on && landAid.disengage(); }
  if (!ap.on || !(ap.modes.spd || ap.modes.mach)) fdm.throttle = controls.throttle;
  if (controls.trimUp) fdm.trim = Math.min(0.6, fdm.trim + 0.12 * dt);
  if (controls.trimDown) fdm.trim = Math.max(-0.6, fdm.trim - 0.12 * dt);
  fdm.brakes = controls.brake;
  const ground = groundAt(fdm.pos.x, fdm.pos.z);
  state.lastGround = ground;
  const wind = windVector(fdm.pos.y - ground, fdm.pos.y, dt);
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) fdm.step(h, groundAt, wind);
  // finer elevation keeps arriving for a few seconds after a spawn (hundreds of metres in mountains): stay clear of it
  if (state.settleAir && performance.now() < state.settleUntil && !fdm.onGround) {
    const g2 = groundAt(fdm.pos.x, fdm.pos.z);
    if (fdm.pos.y < g2 + 150) { fdm.pos.y = g2 + 150; if (fdm.vel.y < 0) fdm.vel.y = 0; }
  }
  if (!settings.crash && fdm.crashed) { fdm.crashed = null; fdm.pos.y = Math.max(fdm.pos.y, ground + 6); fdm.events = fdm.events.filter((e) => e !== 'crash'); }
  // Water: a jet that touches it does not roll on. Wheels or belly in the water end the flight: fast, the jet breaks up on the surface; slow, it floods
  // and sinks. Checked a few times a second from the water mask the terrain draws (OpenStreetMap polygons); never on a runway; not in the first 5 s.
  if (!fdm.crashed && settings.crash && !state.pending && performance.now() - (state.waterAt || 0) > 120) {
    state.waterAt = performance.now();
    if (fdm.pos.y - ground < 3.2 && performance.now() > (state.settleUntil || 0) - 7000) {
      const ll = aircraftLatLon();
      if (terrain.waterAt(ll.lat, ll.lon) === true) {
        const onRunway = db.near(ll.lat, ll.lon, 1.5).some(({ a }) => a.runways.some((r) => { const l = r.local(ll.lat, ll.lon); return Math.abs(l.s) < r.len / 2 + 40 && Math.abs(l.t) < r.width / 2 + 30; }));
        if (!onRunway) {
          const sp = fdm.vel.length() * KT; state.ditch = true;
          fdm.crash(sp > 90 ? `ditched at ${Math.round(sp)} kt: the jet broke up on the water` : 'ran into the water: the jet flooded and sank', 'impact');
        }
      }
    }
  }
  state.overG = (fdm.out.nz > 6 || fdm.out.nz < -3) ? state.overG + dt : 0; // the airframe is far weaker under negative g
  if (settings.crash && state.overG > 0.25 && !fdm.crashed) fdm.crash(`airframe overstressed (${fdm.out.nz.toFixed(1)} g)`, 'overstress');
  for (const e of fdm.events) {
    if (e === 'gear-lock') { audio.play('gear-lock'); state.bump += 0.15; }
    else if (e === 'crash') {
      // the wreck plays out first; the crash report follows once it has come to rest
      ap.disengage(); syncAp();
      wreck.start(visual, fdm, fdm.crashKind);
      crashAudio();
      state.crashShown = false; $('crash-why').textContent = fdm.crashed; pause(state.paused); // refreshes the status chip
      if (rig.view !== 'orbit' && rig.view !== 'tower' && rig.view !== 'flyby') {
        state.viewBeforeCrash = rig.view; setView('orbit'); Object.assign(rig.orbit, { az: rig.orbit.az, el: 0.25, dist: 110 });
      }
    }
    else if (e === 'chute-fail') toast('Drag chute torn off — deploy below 210 kt', true);
    else if (e.type === 'touch') { if (e.vs > 0.5) audio.play('touch', Math.min(1.5, e.vs / 2)); state.bump += Math.min(1.5, e.vs * 0.4); if (e.wheel > 0 && e.vs > 0.3) toast(`Touchdown ${Math.round(e.vs * 196.85)} fpm`); }
    else if (e.type === 'ab-light') { audio.play('ab-light', rig.view === 'cockpit' ? 0.5 : 1); visual.event(e); state.bump += 0.25; }
    else if (e.type === 'unstart') { audio.play('unstart'); visual.event(e); state.bump += 2.2; toast(`${e.engine ? 'RIGHT' : 'LEFT'} INLET UNSTART — restarting`, true); }
    else if (e.type === 'restart') toast(`${e.engine ? 'Right' : 'Left'} inlet restarted`);
  }
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
    kias: ias() * KT, mach: M, altFt: fdm.pos.y * FT, vsFpm: vs * 196.85, g: out.nz || 1, aoaDeg: (out.alpha || 0) / D2R,
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
    throttle: fdm.throttle, stick: { p: fdm.ctrl.de || 0, r: fdm.ctrl.da || 0 }, gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999, flightTime: (performance.now() - (state.t0 ??= performance.now())) / 1000,
    cit, hour: env.hour, brakes: fdm.brakes > 0, park: fdm.parkingBrake, chute: fdm.chute,
    nav: { valid: false, ident: '', brgDeg: 0, distNm: 0, course: 0, xtkNm: 0, ilsValid: false, locDev: 0, gsDev: 0, ...state.navOut }, warn,
  };
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
// cloud cover and base ease toward the chosen weather over ~25 s instead of re-rolling the whole sky the moment a preset or METAR loads
const cloudEff = { cover: settings.clouds, base: settings.cloudBase };
const cloudXZ = new THREE.Vector2(), cloudWind = new THREE.Vector2();
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
  perf.begin(now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  { const ft = (now - last0) / 1000; adaptResolution(ft, now); adaptClouds(ft, now); last0 = now; }
  controls.onGround = fdm.onGround;
  controls.update(dt);
  const ll = aircraftLatLon();
  state.navOut = nav.update(ll, fdm.pos.y, fdm.vel.length());
  if (nav.sequenced) { toast(`Waypoint ${nav.sequenced}`); nav.sequenced = null; }
  if (state.pending) finishPending();
  else if (!state.paused && !fdm.crashed) simulate(dt);
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
  env.update(cll.lat, cw.y, state.paused ? 0 : dt, settings.runClock);
  systemsState = aircraftSystems.step(state.paused ? 0 : dt, {
    altitudeFt: fdm.pos.y * FT, engineRpm: fdm.engines.map((e) => (fdm.crashed ? 0 : 55 + 45 * e.dry - (e.unstart > 0 ? 9 : 0))),
    afterburner: fdm.engines.map((e) => e.ab > 0.01), gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999,
    fuelKg: fdm.fuel, fuelAftKg: fdm.fuelAft, lightsOn: env.daylight < 0.25,
  });
  updateMission(state.paused ? 0 : dt);
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
  terrain.pxScale = THREE.MathUtils.clamp(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)) / 691, 0.75, 1.9);
  terrain.update(cw, cll.lat, cll.lon);
  perf.mark('terrain');
  const camAgl = cw.y - (terrain.heightAt(cll.lat, cll.lon) ?? 0);
  buildings.update(cw, cll.lat, cll.lon, camAgl, env);
  trees.update(cw, cll.lat, cll.lon, camAgl, env);
  db.positionLights(cw, env.night);
  perf.mark('scenery');
  const windTo = (settings.windDir + 180) * Math.PI / 180, windAloft = Math.max(9, settings.windSpd * 2.5); // wind aloft is stronger than the 10 m wind; never calmer than ~9 m/s so the drift is visible
  cloudWind.set(Math.sin(windTo) * windAloft, -Math.cos(windTo) * windAloft);
  cloudEff.cover += (settings.clouds - cloudEff.cover) * (1 - Math.exp(-dt / 25)); cloudEff.base += (settings.cloudBase - cloudEff.base) * (1 - Math.exp(-dt / 25));
  clouds.update(cw, env, cloudEff.cover, cloudEff.base, cloudWind, now / 1000);

  const groundY = groundAt(fdm.pos.x, fdm.pos.z);
  const att = attitude(fdm.quat), out = fdm.out;
  const iasMs = ias(), agl = fdm.pos.y - groundY - 2.42;
  const warn = {
    stall: !fdm.onGround && (out.alpha || 0) > 0.26 && iasMs > 20,
    pullUp: !fdm.onGround && agl < 600 && fdm.vel.y < -8 && agl / -fdm.vel.y < 9,
    gearUnsafe: !fdm.gearDown && agl < 300 && fdm.vel.y < 0 && iasMs * KT < 230,
    overspeed: iasMs * KT > 450 || (out.M || 0) > 3.3,
    overG: (out.nz || 1) > 3.5,
    lowFuel: !fdm.unlimitedFuel && fdm.fuel < 2500,
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
  if (!wreck.active) visual.update(dt, fdm, cw, rig.view, env, groundY, rig.view === 'cockpit' ? panelState(att, warn) : null);
  else visual.shadow.visible = false;
  if (state.started && !state.pending) traffic.update(state.paused ? 0 : dt, { camWorld: cw, lat: ll.lat, lon: ll.lon, night: env.night, own: fdm.pos });
  { // tree colour follows the climate band under the aircraft: lush and warm in the tropics, dark blue-green conifers toward the poles
    const L = Math.abs(ll.lat), b = trees.biome; if (b) { const trop = 1 - Math.min(1, Math.max(0, (L - 15) / 15)), bor = Math.min(1, Math.max(0, (L - 48) / 14)), sub = Math.min(1, Math.max(0, (L - 28) / 8)) * (1 - Math.min(1, Math.max(0, (L - 42) / 6)));
      b.set(1 + 0.1 * trop - 0.12 * bor + 0.1 * sub, 1.04 * trop + 1 * (1 - trop) - 0.02 * bor + 0.02 * sub, 1 - 0.1 * trop + 0.05 * bor - 0.14 * sub); } }
  updateLever(); updateLoadUi(now); guide.update(dt); atc.update(dt, atcCtx());
  { // jet blast on the ground, and the clouds' shadows on it
    const nz = visual.engines ? visual.engines.map((e) => e.grp.getWorldPosition(new THREE.Vector3()).add(cw)) : [];
    if (nz.length) { _aft.set(-1, 0, 0).applyQuaternion(fdm.quat); _aft.y = 0; if (_aft.lengthSq() < 1e-4) _aft.set(1, 0, 0); _aft.normalize();
      blast.update(state.paused ? 0 : dt, { fdm, camWorld: cw, groundY, nozzles: nz, aft: _aft, daylight: env.daylight, height: terrain.cam.agl, px: renderer.domElement.height * 0.5 }); }
    airflow.update(state.paused || state.pending ? 0 : dt, { fdm, model: visual.model, camWorld: cw, daylight: env.daylight, px: renderer.domElement.height * 0.5, geoVersion: geo.version,
      humidity: 0.12 + 0.7 * cloudEff.cover + 0.8 * (weather.rain || 0) + 0.3 * (env.wet || 0) + 0.5 * (state.cloudIn || 0), wind: { x: Math.sin((settings.windDir + 180) * Math.PI / 180) * settings.windSpd, z: -Math.cos((settings.windDir + 180) * Math.PI / 180) * settings.windSpd } });
    const U = TERRAIN_UNIFORMS;
    if (post.clouds && vclouds.tex && vclouds.march && cloudEff.cover > 0.02) {
      cloudShadow.update(renderer, { shape: vclouds.tex.shape, cover: cloudEff.cover, base: cloudEff.base, top: cloudEff.base + 900 + 1700 * cloudEff.cover, wind: cloudWind, now: now / 1000, cam: cw, groundY, sunDir: env.sunDir });
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
  // stays on at night (intensity is 0 then): toggling castShadow recompiles every lit material
  env.sun.castShadow = true;
  if (!shadows.forceAll) shadows.every = dynres.scale < 0.95 ? 2 : 1;
  perf.gpuSection('shadow maps');
  if (dbgOff.shadows) SHADOW_UNIFORMS.uShP.value.x = 0; else shadows.update(renderer, scene, camera, cw, terrain.cam.agl, env.sunDir);
  if (shadows.active && !dbgOff.shadows) visual.shadow.visible = false; // the real cast shadow replaces the contact blob
  // the aircraft's own shadow map (self-shadowing) only changes when the aircraft turns, the sun moves, the gear or the elevons move, or the aircraft
  // moves relative to the camera; in a steady cockpit view none of that happens for seconds at a time, so it is redrawn on change only
  { const q = fdm.quat, sd = env.sunDir, rp = visual.root.position, g = shAt;
    const cur = [q.x, q.y, q.z, q.w, sd.x, sd.y, sd.z, fdm.gearPos, fdm.surf.de, fdm.surf.da, fdm.surf.dr, rp.x, rp.y, rp.z];
    let dirty = ++shAt.n % 24 === 0 || !g.v;
    if (!dirty) for (let i = 0; i < cur.length; i++) if (Math.abs(cur[i] - g.v[i]) > (i < 11 ? 2e-4 : 0.02)) { dirty = true; break; }
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = dirty; // set after the cascade renders, which would otherwise consume it
    if (dirty) { g.v = cur; stat.did('sunShadow'); } else stat.skip('sunShadow'); }
  if (post.clouds) {
    clouds.mesh.visible = false; // volumetric clouds replace the billboard ones
    post.cloudParams = { camAlt: cw.y, camXZ: cloudXZ.set(cw.x, cw.z), coverage: cloudEff.cover, base: cloudEff.base,
      time: now / 1000, wind: cloudWind };
    // the jet cuts a tunnel through the cloud it flies in: its recent path is carved out of the density, wider and longer-lived with the afterburners lit
    { const top = cloudEff.base + 900 + 1700 * cloudEff.cover, inLayer = !wreck.active && cw.y > cloudEff.base - 400 && cw.y < top + 400 && fdm.pos.y > cloudEff.base - 300 && fdm.pos.y < top + 300;
      const tr = state.cloudTrail || (state.cloudTrail = []), last = tr[tr.length - 1], ab = Math.max(fdm.engines[0].ab, fdm.engines[1].ab);
      if (!state.paused && inLayer && (!last || Math.hypot(fdm.pos.x - last.x, fdm.pos.y - last.y, fdm.pos.z - last.z) > 70)) { tr.push({ x: fdm.pos.x, y: fdm.pos.y, z: fdm.pos.z, t: now / 1000, r0: 32 + 22 * ab }); if (tr.length > 12) tr.shift(); }
      const pts = [];
      if (inLayer || tr.length) for (let i = tr.length - 1; i >= 0; i--) { const q = tr[i], age = now / 1000 - q.t, life = 14 + 10 * (q.r0 > 40 ? 1 : 0), r = q.r0 * (1 + 0.5 * age / life) * Math.max(0, 1 - age / life); if (r > 4) pts.push({ x: q.x - cw.x, y: q.y - cw.y, z: q.z - cw.z, r }); }
      if (inLayer) pts.unshift({ x: fdm.pos.x - cw.x, y: fdm.pos.y - cw.y, z: fdm.pos.z - cw.z, r: 34 + 22 * ab });
      vclouds.setCarve(pts.slice(0, 12)); }
  } else post.cloudParams = null;
  perf.mark('visuals+shadows');
  // Screen-space AO is tuned for the outside world; in the tiny enclosed cockpit it crushed every surface to black. Fade it out there.
  aoNow += ((rig.view === 'cockpit' ? 0 : aoBase) - aoNow) * Math.min(1, dt * 6);
  if (post.enabled) post.aoStrength = aoNow < 0.03 ? 0 : aoNow; // below this the pass is skipped entirely
  if (bisect.mode) { const m = bisect.mode, was = [terrain.group.visible, trees.group.visible, buildings.group.visible, visual.root.visible];
    terrain.group.visible = m === 1 || m === 4 ? false : was[0]; trees.group.visible = m === 2 || m === 4 ? false : was[1]; buildings.group.visible = m === 2 || m === 4 ? false : was[2]; visual.root.visible = m === 3 ? false : was[3];
    bisect.restore = () => { terrain.group.visible = was[0]; trees.group.visible = was[1]; buildings.group.visible = was[2]; visual.root.visible = was[3]; }; }
  let masked = false;
  if (rig.view === 'cockpit' && bisect.mode !== 5) { perf.gpuSection('cockpit mask'); masked = occlusion.render(renderer, scene, camera); stat[masked ? 'did' : 'skip']('cockpitMask'); }
  OCC_UNIFORMS.uOccOn.value = masked ? 1 : 0; // on for the scene pass only: the mask belongs to this camera and this size
  post.prof = (l) => perf.gpuSection(l); if (!post.enabled) perf.gpuSection('scene (no post)');
  post.render(scene, camera); perf.gpuEnd(); OCC_UNIFORMS.uOccOn.value = 0; if (bisect.mode) bisect.restore();
  perf.mark('render');

  const spdU = settings.metric ? 3.6 : KT, altU = settings.metric ? 1 : FT;
  hud.draw({
    pitch: att.pitch, bank: att.bank, heading: att.heading, alpha: out.alpha || 0, beta: out.beta || 0,
    ias: iasMs * spdU, alt: fdm.pos.y * altU, vs: fdm.vel.y * (settings.metric ? 1 : 196.85), agl: Math.max(0, agl) * altU,
    mach: out.M || 0, g: out.nz || 1, thr: fdm.spool, speed: fdm.vel.length(), metric: settings.metric,
    cockpit: rig.view === 'cockpit', fov: camera.fov, night: env.night, ...warn, gearWarn: warn.gearUnsafe,
    ap: ap.on ? `AP ${ap.status.lat} ${ap.status.vert} ${ap.modes.mach ? 'MACH' : ap.modes.spd ? 'SPD' : ''}${ap.status.prot ? ' · ' + ap.status.prot : ap.status.warn ? ' · ' + ap.status.warn : ''}` : (state.slew ? 'SLEW' : ''),
    navCue: cueFor(state.navOut),
    apHdg: ap.on && ap.cmdHdg != null ? ap.cmdHdg : null, apAlt: ap.on && ap.modes.alt ? ap.target.alt * altU : null, apSpd: ap.on && ap.modes.spd ? ap.target.spd * spdU : null,
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
      inMachConeAhead: coneSilent, doppler: a / Math.max(a * 0.3, a - vRad), mach: M, engines: fdm.engines,
      crashed: !!fdm.crashed, rho: out.rho || 1.2, ias: iasMs * KT, onGround: fdm.onGround, gs: fdm.vel.length(), rain: weather.rain,
      gearMoving: fdm.gearPos > 0.001 && fdm.gearPos < 0.999, warnTone: warn.pullUp ? 2 : (warn.stall ? 1 : 0),
    });
  } catch (e) { console.warn('audio', e); }

  perf.mark('hud+audio');
  // overlays
  const inside = rig.view === 'cockpit';
  $('strip').style.display = settings.strip && !inside && state.started ? 'flex' : 'none';
  uiT += dt; mapT += dt;
  if (uiT > 0.1) {
    uiT = 0;
    const txt = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };
    const gs = Math.hypot(fdm.vel.x, fdm.vel.z);
    txt('d-spd', Math.round(iasMs * spdU)); txt('d-spd2', `M ${(out.M || 0).toFixed(2)} · ${settings.metric ? 'km/h' : 'kt'}`);
    txt('d-alt', Math.round(fdm.pos.y * altU).toLocaleString()); txt('d-alt2', `VS ${Math.round(fdm.vel.y * (settings.metric ? 1 : 196.85))} · AGL ${Math.round(Math.max(0, agl) * altU).toLocaleString()}`);
    txt('d-hdg', String(Math.round(att.heading) % 360).padStart(3, '0') + '°'); txt('d-hdg2', `GS ${Math.round(gs * spdU)} · ${(out.nz || 1).toFixed(1)} g`);
    const lb = fdm.fuel * 2.20462;
    txt('d-fuel', settings.metric ? Math.round(fdm.fuel).toLocaleString() : Math.round(lb).toLocaleString()); txt('d-fuel2', `${settings.metric ? 'kg' : 'lb'} · ${Math.round(fdm.fuel / SPEC.FUEL_MAX * 100)}%`);
    fdm.engines.forEach((e, i) => { const el = $(i ? 'd-tr' : 'd-tl'); el.style.height = Math.min(100, (e.dry * 75 + e.ab * 25)) + '%'; el.style.background = e.ab > 0.01 ? '#ff7b2e' : e.unstart > 0 ? '#e5342a' : '#5ee1ff'; });
    txt('d-thr', fdm.throttle < 0.02 ? 'IDLE' : fdm.throttle > 0.75 ? `A/B ${Math.round((fdm.throttle - 0.75) / 0.25 * 100)}%` : `${Math.round(fdm.throttle / 0.75 * 100)}% MIL`);
    const pill = (id, cls) => { $(id).className = 'pill' + (cls ? ' ' + cls : ''); };
    pill('p-gear', fdm.gearPos > 0.02 && fdm.gearPos < 0.98 ? 'a' : fdm.gearDown ? 'g' : '');
    // the gear takes 7 s: show which way it is going and how far, so retraction reads as clearly as extension
    const moving = fdm.gearPos > 0.02 && fdm.gearPos < 0.98;
    txt('p-gear', moving ? (fdm.gearDown ? 'GEAR ▼' : 'GEAR ▲') : 'GEAR'); $('p-gear').style.setProperty('--p', `${Math.round(fdm.gearPos * 100)}%`);
    pill('p-brk', fdm.parkingBrake ? 'a' : fdm.brakes > 0 ? 'g' : '');
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
  const f = new FlightModel(); f.reset(new THREE.Vector3(0, 40, 0), 0, 150, false, 0); f.crash('warm-up');
  wreck.start(visual, f, 'impact');
  wreck.light.intensity = 1; wreck.ground.ring.visible = true;
  return () => { wreck.clear(visual); wreck.ground.ring.visible = false; wreck.light.intensity = 0; };
}
const warm = { started: false, done: false, ms: 0, programs: 0, promise: null, final: false };
function startWarm(again) {
  if (warm.started && !again) return warm.promise; warm.started = true; warm.done = false;
  try { occlusion.warm(renderer, camera); } catch (e) { console.warn('cockpit mask warm-up failed', e); }
  const mats = [terrainMaterial(), buildings._material(), ...trees.nearMat, trees.impMat];
  const casters = [buildings.casterMat, ...trees.casterOf.values()];
  const extraPost = [cloudShadow.mat, ...(visual.glassWater ? visual.glassWater.meshes.flatMap((m) => m.userData.mats || []) : [])];
  warm.promise = Promise.resolve().then(() => warmShaders({ renderer, scene, camera, post, shadows, vclouds, extra: mats, casters, extraPost, crash: crashWarmSetup }))
    .then((r) => { warm.programs = r.programs; warm.ms = r.ms; }).catch((e) => console.warn('shader warm-up failed', e)).finally(() => { warm.done = true; });
  return warm.promise;
}
function prewarmCrash() { startWarm(); }

// ---------- boot ----------
(async () => {
  const bar = (p, msg) => { $('loadbar').style.width = (p * 100) + '%'; if (msg) $('loadmsg').textContent = msg; };
  try {
    await Promise.all([
      visual.load(`${BASE}models/SR71_sim.glb`, (p) => bar(p * 0.6, 'Loading aircraft…')),
      db.load(`${BASE}data/airports.json`),
    ]);
  } catch (e) { $('loadmsg').textContent = 'Loading failed: ' + e.message; console.error(e); return; }
  bar(0.8, 'Loading scenery…');
  visual.registerOccluders(occlusion);
  if (visual.gearRig) visual.gearRig.onDoor = (d) => audio.play('gear-door', d === 'open' ? -1 : 1);
  const a = homeAirport();
  dep.apt = a; dep.rwy = Math.min(home.rwy, a.runways.length - 1); dep.end = home.end;
  $('dep-q').value = `${a.ident} — ${a.name}`;
  renderHome(); renderDep(); syncEnvUi(); renderRoute();
  spawn(a.runways[dep.rwy].spawn(dep.end, 'runway'), { rwy: a.runways[dep.rwy], end: dep.end });
  $('start-btn').disabled = false; $('home-go').disabled = false;
  setView('orbit'); rig.orbit.az = 0.9; rig.orbit.el = 0.14; rig.orbit.dist = 46;
  bar(1, 'Choose where to fly, then Start flight');
  setTimeout(startWarm, 700); // once the first frames have set the lights and environment the shaders depend on
  // test hook: advance the simulation without waiting for animation frames
  const advance = (sec) => { for (let t = 0; t < sec; t += 1 / 60) { controls.update(1 / 60); state.navOut = nav.update(aircraftLatLon(), fdm.pos.y, fdm.vel.length(), (fdm.out.M || 0) > 1 ? 35 : 30); if (!state.paused && !fdm.crashed && !state.pending) simulate(1 / 60); } return { alt: fdm.pos.y, M: fdm.out.M, crashed: fdm.crashed }; };
  const advanceWreck = (sec) => { for (let t = 0; t < sec; t += 1 / 30) if (wreck.active) stepWreck(1 / 30, rig.world); return { t: wreck.t, settled: wreck.settled() }; };
  // advance until the wreck's own clock (which runs slow at first) reaches t
  const advanceWreckTo = (t) => { for (let n = 0; wreck.active && wreck.t < t && n < 5000; n++) stepWreck(1 / 30, rig.world); return { t: wreck.t, settled: wreck.settled() }; };
  window.__sim = { occlusion, occUniforms: OCC_UNIFORMS, GFX, applyGfx, stat, ChangeGate, cloudAdapt, warm, cloudShadow, airflow, traffic, perf, hud, post, vclouds, THREE, prewarmCrash, applyWeather, weather, simulate, advanceWreck, advanceWreckTo, fdm, wreck, terrain, buildings, trees, post, shadows, geo, db, nav, visual, rig, ap, spawn, spawnAt, setView, state, env, settings, controls, toggleAp, readAp, advance, attitude, audio, renderer, scene, camera, openSheet };
  requestAnimationFrame(frame);
})();
