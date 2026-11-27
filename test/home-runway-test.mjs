import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Runway } from '../src/airportdb.js';
import { resolveHomeRunway, resolveRunwaySelection } from '../src/home-runway.js';
const main = fs.readFileSync('src/main.js', 'utf8');
const section = (a, b) => { const start = main.indexOf(a), end = main.indexOf(b, start); assert.ok(start >= 0 && end > start, a); return main.slice(start, end); };
function airport(ident) {
  const apt = { ident, name: `${ident} airport`, city: '', country: '', runways: [] };
  apt.runways = [0, 1, 2].map(i => new Runway(apt, [`${9 + i}`, `${27 + i}`, 39, -121 + i / 100, 39.03 - i / 100, -121 + i / 100, 30, 32, 30, 1, 1]));
  apt.longest = apt.runways[0]; return apt;
}
const invalid = [undefined, null, -1, -50, 3, 999, .5, '1', 'garbage', '', true, {}, [], NaN, Infinity];
const apt = airport('TEST'), fallback = airport('KBAB');
const db = { ready: true, get: ident => ({ TEST: apt, KBAB: fallback })[ident] };
for (const rwy of invalid) for (const end of invalid) {
  const selection = resolveHomeRunway(db, { ident: 'TEST', rwy, end });
  assert.equal(selection.apt, apt); assert.equal(selection.rwy, 0); assert.equal(selection.end, 0);
  assert.equal(selection.runwayEnd, apt.runways[0].ends[0]);
}
for (const rwy of [0, 1, 2]) for (const end of [0, 1]) {
  const selection = resolveHomeRunway(db, { ident: 'TEST', rwy, end });
  assert.equal(selection.rwy, rwy); assert.equal(selection.end, end);
  for (const bad of invalid) {
    assert.equal(resolveRunwaySelection(apt, rwy, bad).rwy, rwy);
    assert.equal(resolveRunwaySelection(apt, bad, end).end, end);
  }
}
assert.equal(resolveHomeRunway(db, { ident: 'REMOVED', rwy: -1, end: -1 }).apt, fallback);
for (const saved of [null, false, 7, 'oops', {}, { ident: 4 }]) {
  const selection = resolveHomeRunway(db, saved);
  assert.equal(selection.apt, fallback); assert.equal(selection.rwy, 0); assert.equal(selection.end, 1);
}
assert.equal(resolveRunwaySelection(null, 0, 0), null);
assert.equal(resolveRunwaySelection({ runways: [] }, 0, 0), null);
assert.equal(resolveRunwaySelection({ runways: [{}] }, 0, 0), null);
assert.equal(resolveHomeRunway({ get() {} }, { ident: 'TEST' }), null);
assert.equal(resolveHomeRunway({ get: id => id === 'TEST' ? { runways: [] } : fallback }, { ident: 'TEST' }).apt, fallback);

// Execute real main.js rendering/start/spawn functions with only graphics/physics effects stubbed.
function harness(saved, { failSpawn = false, empty = false, mode = 'runway' } = {}) {
  const homeApt = airport('TEST'), base = airport('KBAB'), calls = [], events = [], nodes = new Map();
  for (const a of [homeApt, base]) for (const [rwy, runway] of a.runways.entries()) {
    const original = runway.spawn.bind(runway);
    runway.spawn = (end, spawnMode) => { calls.push({ apt: a.ident, rwy, end, mode: spawnMode }); return failSpawn ? null : original(end, spawnMode); };
  }
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', checked: id === 'make-home', addEventListener(event, fn) { this[event] = fn; }, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  const state = { started: false, pending: null }, settings = { weather: 'clear', metarAuto: true };
  const context = vm.createContext({
    resolveHomeRunway, resolveRunwaySelection, LS: { get: () => saved, set() { events.push('saveHome'); } },
    db: { ready: true, get: ident => empty ? undefined : ({ TEST: homeApt, KBAB: base })[ident] },
    $, state, settings, calls, events, flightAssetsReady: true, showStartupError() {}, window: { __simReady: true }, document: { querySelector: () => ({ textContent: 'Runway' }) },
    AIRCRAFT: 'c172', AIRCRAFT_TYPES: { c172: { short: 'C172' } }, IS_C172: true,
    IS_F27: false, IS_DA40: false, IS_SF50: false, IS_HEAVY: false, IS_A380X: false, IS_IL76: false, IS_PROP: true,
    fdm: {}, env: { hour: 15 }, FT: 3.28084, KT: 1.943844, missionKind: 'free', missionKindSet() {}, missionSpawnMode: (_, mode) => mode,
    fmtLen: n => String(n), aptPlace: () => '', airportHeader: () => '', weatherSnapshot: () => ({}),
    startWarm() {}, spawn(s, meta) { state.lastSpawn = { s, meta }; state.pending = {}; state.setup = null; events.push('spawn'); },
    beginFlight() { events.push('activate'); state.started = true; }, startMission() { events.push('mission'); },
    showLoadUi() { events.push('loading'); }, loadMetar() { events.push('metar'); }, freeOrbitBehind() {}, setView() {},
    renderLogbook() {}, logbook: { begin() {} }, toast() {}, weatherPreferences: { begin() {} }, applyWeather() {}, syncEnvUi() {},
  });
  vm.runInContext(section("let home = LS.get('home'", '// ---------- helpers'), context);
  vm.runInContext(section('function spawnAt(', 'function restart()'), context);
  vm.runInContext(section('function setHome(', '// ---------- flight setup'), context);
  vm.runInContext(section('function departureSelection()', '// scenery for the chosen'), context);
  vm.runInContext(section('function prefetchPlace()', "searchBox($('dep-q')"), context);
  vm.runInContext(section('function renderSum()', "['click', 'input']"), context);
  vm.runInContext(section("$('start-btn').addEventListener('click'", '// Explicit quick-start'), context);
  vm.runInContext(section('const quickAircraft =', 'const missionKindSet ='), context);
  vm.runInContext(`(function bootSelection() { ${section("  const a = homeAirport();\n  if (!a) { showStartupError", "  $('dep-q').value")} })(); dep.mode = '${mode}';`, context);
  return { context, homeApt, $, state, calls, events };
}
const badSaves = invalid.map(rwy => ({ ident: 'TEST', rwy, end: -1 }));
badSaves.push(...invalid.map(end => ({ ident: 'TEST', rwy: 2, end })), null, { ident: 'REMOVED', rwy: 500, end: 500 });
const controls = [0, 1, 2].flatMap(rwy => [0, 1].map(end => ({ ident: 'TEST', rwy, end })));
let starts = 0;
for (const saved of [...badSaves, ...controls]) for (const button of ['home-go', 'start-btn', 'just-fly']) {
  const h = harness(saved);
  vm.runInContext('renderHome(); renderDep(); renderSum();', h.context);
  const expected = resolveHomeRunway({ get: ident => ({ TEST: h.homeApt, KBAB: airport('KBAB') })[ident] }, saved);
  assert.ok(h.$('home-sub').textContent.startsWith(`Runway ${expected.runwayEnd.ident} ·`));
  assert.ok(h.$('flight-sum').textContent.includes(`${expected.apt.ident} ${expected.runwayEnd.ident}`));
  h.$(button).click();
  assert.equal(h.state.started, true);
  assert.deepEqual(h.calls, [{ apt: expected.apt.ident, rwy: expected.rwy, end: expected.end, mode: 'runway' }]);
  assert.equal(h.state.setup.rwy, expected.rwy); assert.equal(h.state.setup.end, expected.end);
  assert.equal(h.state.lastSpawn.meta.rwy.ends[h.state.lastSpawn.meta.end].ident, expected.runwayEnd.ident);
  assert.equal(h.events.filter(e => e === 'activate').length, 1); starts++;
}
for (const button of ['home-go', 'start-btn', 'just-fly']) for (const options of [{ failSpawn: true }, { empty: true }]) {
  const h = harness({ ident: 'TEST', rwy: 1, end: 1 }, options);
  h.$(button).click();
  assert.equal(h.state.started, false); assert.equal(h.state.lastSpawn, undefined);
  assert.deepEqual(h.events, [], `${button}: no activation, mission, loading UI, weather request or home confirmation without a spawn`);
}
// Selection can also become stale after boot. Scenery, labels and the start must
// recover the same departure without relying solely on boot normalization.
for (const bad of invalid) {
  const h = harness({ ident: 'TEST', rwy: 1, end: 1 });
  h.context.bad = bad;
  vm.runInContext('dep.rwy = bad; dep.end = bad; renderDep(); prefetchPlace();', h.context);
  assert.ok(h.$('flight-sum').textContent.includes('TEST 9'));
  h.$('start-btn').click();
  assert.deepEqual(h.calls, [{ apt: 'TEST', rwy: 0, end: 0, mode: 'runway' }, { apt: 'TEST', rwy: 0, end: 0, mode: 'runway' }]);
}
for (const mode of ['approach', 'final', 'cruise']) {
  const h = harness({ ident: 'TEST', rwy: -1, end: -1 }, { failSpawn: true, mode });
  h.$('start-btn').click(); assert.equal(h.state.started, false); assert.equal(h.context.fdm.gearDown, undefined);
}
console.log(`PASS B13: malformed/negative/out-of-range saves, ${starts} rendered/start/spawn agreement cases, valid controls and no-spawn activation guards`);
