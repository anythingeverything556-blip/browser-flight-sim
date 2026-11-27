import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Weather, WEATHER, surfaceFogFactor } from '../src/weather.js';
import { formatReportedVisibility, startupWeather, weatherSnapshot, restoreWeather, makeWeatherPreferences } from '../src/flight-weather.js';
import { FlightLogbook } from '../src/logbook.js';
import { buildAtis } from '../src/atc.js';
import { interpretMetar, liveWeather as actualLiveWeather } from '../src/metar.js';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// No renderer/browser/network is needed: execute the production handlers against
// deterministic DOM/storage/service boundaries, not duplicate implementations.
const section = (start, end) => {
  const a = main.indexOf(start), b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production section ${start}`);
  return main.slice(a, b);
};
const listeners = new Map(), elements = new Map(), segmentCallbacks = new Map();
const timeShortcut = { dataset: { hour: '12' }, getAttribute(k) { return this[k]; }, setAttribute(k, v) { this[k] = v; },
  addEventListener(kind, fn) { listeners.set(`noon:${kind}`, fn); } };
const $ = id => {
  if (!elements.has(id)) elements.set(id, { value: '', textContent: '', checked: false,
    setAttribute(k, v) { this[k] = v; }, addEventListener(kind, fn) { listeners.set(`${id}:${kind}`, fn); },
    dispatchEvent(event) { listeners.get(`${id}:${event.type}`)?.(event); }, querySelectorAll() { return id === 'weather-times' ? [timeShortcut] : []; } });
  return elements.get(id);
};
let savedText = null, storageWrites = 0;
const storage = { getItem: () => savedText, setItem: (_, value) => { savedText = value; storageWrites++; } };
const logbook = new FlightLogbook(() => storage);
const settings = { ...startupWeather({}), metric: true };
const setup = { aircraft: 'c172', airport: 'ESSA', rwy: 0, end: 0, mode: 'runway', mission: 'free', weather: 'clear', hour: 15 };
logbook.begin(setup);
const state = { setup: { ...setup } }, env = { hour: 15 }, calls = [], announcements = [], pending = [];
const screen = new Weather({ getContext: () => ({}) }, { style: {} }, { style: {} }, { style: {} });
const context = vm.createContext({ $, settings, state, env, logbook, WEATHER, weather: screen,
  weatherPreferences: makeWeatherPreferences(settings), weatherSnapshot, formatReportedVisibility,
  FT: 3.28084, KT: 1.94384, document: { activeElement: null }, fmtAlt: m => `${Math.round(m)} m`,
  seg: (id, cb) => { segmentCallbacks.set(id, cb); return () => {}; },
  setIntroWx() {}, setWxPreset() {}, saveSettings() {}, toast() {}, console, Event,
  dep: {}, BASE: '/', liveWeather: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  buildAtis: args => { calls.push(args); return buildAtis(args); },
  atc: { say: (...args) => announcements.push(args) },
});
vm.runInContext([
  section('function syncWeatherStatus()', "$('metar-btn').addEventListener"),
  section('function applyWeather(', '// live weather survives'),
  section('function syncEnvUi()', 'function setApAltUnits()'),
  section('function bindMetarAuto()', '// ---------- throttle lever'),
].join('\n'), context);
const apt = { ident: 'ESSA', name: 'Stockholm', elev: 36, runways: [{ ident: '01' }] };
const reported = interpretMetar({ rawOb: 'ESSA 261200Z 00000KT 0300 FG VV002 01/01 Q1015',
  wdir: 0, wspd: 0, visibilityMeters: 300, clouds: [{ cover: 'OVX', base: 200 }],
  temp: 1, dewp: 1, altim: 1015 }, 36);

// ENV-02: zero/missing/bounds and imperial/metric units never derive from vis.
assert.equal(formatReportedVisibility({ visibilityMeters: 300 }), '300 m');
assert.equal(formatReportedVisibility({ visibilityMeters: 402.336 }, false), '0.25 mi');
assert.equal(formatReportedVisibility({ visibilityMeters: 10000, visibilityQualifier: 'at-least' }), '≥ 10 km');
assert.equal(formatReportedVisibility({ visibilityMeters: 402.336, visibilityQualifier: 'less-than' }, false), '< 0.25 mi');
assert.equal(formatReportedVisibility({ visibilityMeters: 0 }), '0 m');
assert.equal(formatReportedVisibility({ visibilityMeters: null }), 'unavailable');
assert.equal(formatReportedVisibility({ visibilityMeters: NaN }), 'unavailable');
assert.equal(formatReportedVisibility({ visibilityMeters: -1 }), 'unavailable');
assert.equal((html.match(/id="reported-vis-l"/g) || []).length, 1);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate DOM IDs');
assert.match(html, /Manual rendering factor, not reported visibility or a measured scene sight distance/);
const panel = html.slice(html.indexOf('<section class="sheet" id="sheet-env"'), html.indexOf('<section class="sheet" id="sheet-settings"'));
assert.ok(panel.indexOf('id="weather-current"') < panel.indexOf('id="wx-presets"'));
assert.ok(panel.indexOf('id="wx-presets"') < panel.indexOf('id="tod"'));
assert.ok(panel.indexOf('id="tod"') < panel.indexOf('id="metar-btn"'));
assert.match(panel, /<details class="weather-report"><summary>Weather report details<\/summary>[\s\S]*id="metar-raw"/);
assert.match(panel, /<details class="advanced weather-advanced"><summary>Fine-tune weather<\/summary>/);
assert.match(panel, /id="weather-current"[^>]*role="status"/);

// ENV-04: low heights, below-sea-level MSL, and upper/lower validation boundaries.
const wx = { ...settings, cloudBase: reported.baseM };
assert.equal(reported.obscured, true);
assert.equal(reported.verticalVisibilityFt, 200);
assert.ok(Math.abs(reported.baseM - 96.96) < .001);
for (const cloudBase of [96.96, -600, -430, 0, 20000]) {
  const snapshot = weatherSnapshot({ ...wx, cloudBase });
  assert.equal(snapshot.cloudBase, cloudBase);
  const restored = {};
  assert.equal(restoreWeather(restored, snapshot), true);
  assert.equal(restored.cloudBase, cloudBase);
  assert.equal(startupWeather({ ...wx, weather: 'metar', weatherPolicyV1: true, metarWx: WEATHER.fog, cloudBase }).cloudBase, cloudBase);
}
assert.equal(weatherSnapshot({ ...wx, cloudBase: -600.01 }), null);
assert.equal(weatherSnapshot({ ...wx, cloudBase: 20000.01 }), null);
assert.match(html, /id="cloud-base" min="-1900" max="65000" step="100"/);
assert.match(html, /100 ft step.*MSL/);

// ENV-06: same surface veil at sea level/mountain ground; absent aloft and
// while paused at an elevated camera. Gloom/haze and temporal fading remain independent.
assert.equal(surfaceFogFactor(0), 1);
assert.equal(surfaceFogFactor(150), 1);
assert.equal(surfaceFogFactor(475), .5);
assert.equal(surfaceFogFactor(800), 0);
screen.set(WEATHER.fog, true);
screen.update(0, 0, false, { alt: 3000, agl: 0 });
assert.equal(+screen.fog.style.opacity, .85);
screen.update(0, 0, false, { alt: 3475, agl: 475 });
assert.equal(+screen.fog.style.opacity, .425);
screen.update(0, 0, false, { alt: 11003, agl: 8003 });
assert.equal(+screen.fog.style.opacity, 0);
assert.equal(screen.gloomV, WEATHER.fog.gloom);
screen.set(WEATHER.clear);
screen.update(1, 0, false, { alt: 3000, agl: 0 });
assert.ok(screen.fogV > 0 && screen.fogV < .85, 'non-immediate transition still fades');
assert.ok(screen.gloomV > 0, 'unrelated atmospheric gloom still fades');
screen.set(WEATHER.clear, true);
assert.deepEqual([+screen.fog.style.opacity, screen.fogV, +screen.gloom.style.opacity, +screen.bolt.style.opacity], [0, 0, 0, 0]);
assert.match(main, /agl: Math\.max\(0, cw\.y - groundAt\(cw\.x, cw\.z\)\)/);

// ENV-07: execute the actual in-flight slider handler, reload storage, resume
// setup time, then run clock-only UI updates: those must not produce writes.
listeners.get('noon:click')();
assert.equal(env.hour, 12);
assert.equal(new FlightLogbook(() => storage).read().last.hour, 12);
assert.equal(timeShortcut.getAttribute('aria-pressed'), 'true');
$('tod').value = 0;
listeners.get('tod:input')();
assert.equal(env.hour, 0);
assert.equal(timeShortcut.getAttribute('aria-pressed'), 'false');
assert.equal(new FlightLogbook(() => storage).read().last.hour, 0);
const writesAfterEdit = storageWrites;
for (let i = 0; i < 30; i++) { env.hour += .01; context.syncEnvUi(); }
assert.equal(storageWrites, writesAfterEdit);

// ENV-02/03/04: actual METAR integration refreshes the read-only observation
// before sync, keeps the low obscuration value, and passes structured ATIS.
const request = context.loadMetar(apt);
assert.equal($('metar-raw').textContent, 'Fetching live weather for ESSA…');
assert.equal($('weather-current').textContent, 'Loading weather for ESSA…');
context.syncEnvUi();
assert.equal($('metar-raw').textContent, 'Fetching live weather for ESSA…');
assert.equal($('weather-current').textContent, 'Loading weather for ESSA…');
pending.shift().resolve({ w: reported, source: 'METAR ESSA', km: 0 });
await request;
assert.equal($('weather-current').textContent, 'METAR ESSA');
assert.equal($('weather-wind').textContent, $('wind-l').textContent);
assert.equal($('reported-vis-l').textContent, 'Reported: 300 m');
assert.equal($('vis-l').textContent, '0.30×');
assert.match($('cb-l').textContent, /^97 m MSL · VV 200 ft AGL$/);
assert.equal(state.setup.weatherSnapshot.cloudBase, reported.baseM);
assert.equal(calls.at(-1).metar, reported.atisObservation);
assert.equal(calls.at(-1).runways, apt.runways, 'retain exact-station runway context');
assert.match(announcements.at(-1)[0], /ATIS$/);

const model = { ...reported, raw: 'Open-Meteo prose 139/2 1015', modeled: true, obscured: false,
  windDir: 139, windKt: 2, visibilityMeters: 40000,
  atisObservation: { modeled: true, wdir: 139, wspd: 2, visibilityMeters: 40000, clouds: [{ cover: 'SCT', base: 2000 }], temp: 22.8, dewp: 18, altim: 1015 } };
const modelRequest = context.loadMetar(apt, true);
pending.shift().resolve({ w: model, source: 'weather model (no fresh METAR near here)', km: 0 });
await modelRequest;
assert.equal($('weather-current').textContent, 'weather model (no fresh METAR near here)');
assert.equal(calls.at(-1).metar, model.atisObservation);
assert.equal(calls.at(-1).runways.length, 0);
assert.match(announcements.at(-1)[1], /^Modeled weather\./);
assert.match(announcements.at(-1)[1], /wind 139 degrees at 2/);
assert.match(announcements.at(-1)[1], /temperature 22.8/);
assert.match(announcements.at(-1)[1], /1015/);
assert.match(announcements.at(-1)[1], /runway in use not available/);
assert.equal($('reported-vis-l').textContent, 'Modeled: 40 km');
const nearbyRequest = context.loadMetar(apt);
pending.shift().resolve({ w: reported, source: 'nearest METAR ESSB', km: 30 });
await nearbyRequest;
assert.equal($('weather-current').textContent, 'nearest METAR ESSB (30 km away)');
assert.equal(calls.at(-1).runways.length, 0, 'nearby observations cannot assign departure runway');

const unavailable = context.loadMetar(apt);
pending.shift().reject(new Error('offline'));
await unavailable;
context.syncEnvUi();
assert.equal($('weather-current').textContent, 'Live weather unavailable · settings unchanged');
assert.match($('metar-raw').textContent, /offline/);

// ENV-09: preset/reset/manual cancellation clears pending labels immediately;
// late successes/failures and superseded requests cannot replace active status.
const canceled = context.loadMetar(apt, true);
context.applyWeather('clear');
assert.match($('metar-raw').textContent, /Clear preset active/);
assert.equal($('weather-current').textContent, 'Clear preset');
assert.equal($('reported-vis-l').textContent, 'No active observation');
pending.shift().resolve({ w: reported, source: 'METAR ESSA', km: 0 });
await canceled;
assert.equal(settings.weather, 'clear');
assert.doesNotMatch($('metar-raw').textContent, /Fetching|METAR ESSA/);
const oldRequest = context.loadMetar(apt), newRequest = context.loadMetar({ ...apt, ident: 'ESSB' }, true);
pending.shift().reject(new Error('superseded timeout'));
await oldRequest;
assert.equal($('metar-raw').textContent, 'Fetching live weather for ESSB…');
$('wind-spd').value = 12;
listeners.get('wind-spd:input')();
assert.equal(settings.windSpd, 12 / 1.94384, 'manual input is not overwritten before capture');
assert.match($('metar-raw').textContent, /Manual weather adjustments active/);
assert.equal($('weather-current').textContent, 'Manual weather');
pending.shift().reject(new Error('canceled timeout'));
await newRequest;
assert.doesNotMatch($('metar-raw').textContent, /Fetching|timeout|METAR ESSA/);
// Auto-on is an opt-in, not a weather change: it should retain an active report.
state.metar = reported; state.wxReportStatus = 'METAR ESSA: active';
context.bindMetarAuto(); $('metar-auto').checked = true; listeners.get('metar-auto:change')();
assert.equal(state.metar, reported);
assert.equal(settings.metarAuto, true);
segmentCallbacks.get('clouds')('0.6');
assert.equal(state.metar, null);
assert.equal($('reported-vis-l').textContent, 'No active observation');
assert.match($('metar-raw').textContent, /Manual weather adjustments active/);
console.log('PASS ENV-02/03/04/06/07/09: observation display, structured ATIS, low MSL/obscuration snapshots, AGL fog, deliberate saved time, and cancel-safe weather status');


// B10: connect the actual source-selection/model parser to the production UI
// handler. Every request is a local fixture; invalid fallback must not commit
// weather settings, an observation, ATIS, or storage over a preset/prior report.
const oldFetch = globalThis.fetch;
try {
  for (const previous of ['preset', 'observation']) {
    context.applyWeather('storm');
    if (previous === 'observation') {
      const request = context.loadMetar(apt);
      pending.shift().resolve({ w: reported, source: 'METAR ESSA', km: 0 });
      await request;
    }
    const before = JSON.stringify(settings), priorReport = state.metar;
    const priorStatus = state.wxReportStatus, priorAtis = announcements.length, priorWrites = storageWrites;
    const requests = [];
    globalThis.fetch = async url => {
      requests.push(String(url));
      return { ok: true, json: async () => String(url).includes('open-meteo') ? { current: {} } : [] };
    };
    context.liveWeather = actualLiveWeather;
    await context.loadMetar({ ...apt, lat: 59.65, lon: 17.9 }, true);
    context.liveWeather = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    assert.equal(JSON.stringify(settings), before, previous);
    assert.equal(state.metar, priorReport, previous);
    assert.equal(state.wxReportStatus, priorStatus, previous);
    assert.equal(announcements.length, priorAtis, 'no ATIS for rejected model');
    assert.equal(storageWrites, priorWrites, 'failed model must not persist weather');
    assert.equal(requests.length, 3, 'exact -> nearest -> model');
    assert.equal($('weather-current').textContent, 'Live weather unavailable · settings unchanged');
    assert.match($('metar-raw').textContent, /core measurements.*weather settings are unchanged/);
  }
} finally { globalThis.fetch = oldFetch; }
console.log('PASS B10: invalid modeled fallback preserves selected preset/prior observation, settings, saved setup and ATIS');
