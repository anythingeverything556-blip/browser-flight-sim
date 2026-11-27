// Local toy-simulator regression: deterministic clock, actual radio/DOM/speech,
// real navigation geometry and the production atcCtx/crash call sites. No services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Atc, buildPhaseMessage, buildTrafficAdvisory } from '../src/atc.js';
import { Navigation } from '../src/nav.js';
import { bearing, destination, haversine, D2R } from '../src/geo.js';

let now = 0, timerId = 0, cancels = 0;
const timers = new Map(), spoken = [], active = [];
globalThis.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; };
globalThis.clearTimeout = id => timers.delete(id);
function tick(ms) {
  const end = now + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  now = end;
}
globalThis.window = { speechSynthesis: {} };
globalThis.speechSynthesis = { speak(u) { spoken.push(u.text); active.push(u); }, cancel() { cancels++; active.length = 0; } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.document = { createElement: () => ({ classList: { add() {} }, firstChild: {}, lastChild: {}, remove() {} }) };
function make() {
  timers.clear(); spoken.length = 0; active.length = 0;
  const children = [], lines = [], audio = { enabled: true, volume: 0.7 };
  const box = { children, appendChild(m) { children.push(m); lines.push({ from: m.firstChild.textContent, text: m.lastChild.textContent, pilot: m.className.includes('you') }); },
    get firstChild() { return { remove() { children.shift(); } }; } };
  return { atc: new Atc(box, audio), lines, audio };
}
const base = { started: true, crashed: false, onGround: false, gearDown: true, fixedGear: false, aircraft: 'f27', gsKt: 150,
  apt: { ident: 'DEPA', name: 'Departure Airport' }, rwy: '15', arrApt: { ident: 'ALFA', name: 'Alpha Airport' }, arrRwy: '22L', wind: { dir: 270, kt: 5 } };
function sample(atc, distance, agl, extra = {}) {
  atc.update(0.1, { ...base, agl, nav: { ilsValid: true, thrDist: distance }, ...extra });
}
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ctxCode = main.slice(main.indexOf('function atcCtx() {'), main.indexOf('const airflow ='));
function world(aircraft = 'f27') {
  const runway = { ap: base.arrApt, len: 3000, ends: [{ ident: '36', start: { lat: 0, lon: 0 }, hdg: 0, elev: 0 }] };
  const nav = new Navigation(); nav.arrival = { rwy: runway, end: 0 };
  const c = { state: { started: true, navOut: {}, lastGround: 0, lastSpawn: { meta: { rwy: runway, end: 0 } } },
    fdm: { onGround: false, crashed: false, gearDown: true, vel: { length: () => 80 }, pos: { y: 1000 }, quat: {} },
    nav, settings: { windDir: 270, windSpd: 3 }, traffic: { list: [] }, ap: { ga: false },
    IS_PROP: ['c172', 'da40'].includes(aircraft), AIRCRAFT: aircraft, FT: 3.28084, KT: 1.94384, D2R, haversine, bearing,
    point: { lat: 0, lon: 0 }, heading: 180 };
  c.aircraftLatLon = () => c.point; c.attitude = () => ({ heading: c.heading });
  vm.runInNewContext(ctxCode, c);
  c.sample = (distance, agl) => {
    c.point = destination(0, 0, distance >= 0 ? 180 : 0, Math.abs(distance)); c.fdm.pos.y = agl / c.FT;
    c.state.navOut = nav.update(c.point, c.fdm.pos.y, 80);
    return c.atcCtx();
  };
  return c;
}

// E05: decreasing signed distance, then no ILS at all; no explicit GA event needed.
{
  const { atc, lines } = make(), c = world();
  for (const [d, h] of [[20000, 3000], [8200, 1100], [100, 80], [-150, 120]]) atc.update(0.1, c.sample(d, h));
  assert.equal(atc.s.land, true); assert.equal(atc.s.goAround, false);
  const missed = c.sample(-4000, 300);
  assert.equal(missed.nav.ilsValid, false, 'fixture actually leaves ILS coverage');
  assert.ok(missed.arrivalDistance < -3999, 'independent geometry retains signed distance');
  atc.update(0.1, missed);
  assert.equal(atc.s.land, false); assert.equal(atc.s.goAround, true);
  for (const [d, h] of [[-6000, 600], [-12000, 2000], [-16000, 3000]]) atc.update(0.1, c.sample(d, h));
  tick(4400);
  assert.equal(lines.filter(x => /go around\./i.test(x.text)).length, 1);
  assert.ok(!spoken.some(x => /cleared (to land|ILS)/i.test(x)), 'obsolete controller speech and pilot clearances are cancelled');
  assert.ok(spoken.some(x => /Going around/.test(x)));
  atc.update(0.1, c.sample(15000, 2800));
  assert.equal(atc.s.goAround, false, 'distinct inbound descending leg can be cleared anew');
  assert.equal(lines.filter(x => /cleared ILS/i.test(x.text)).length, 2);
  console.log('PASS E05 signed-threshold missed approach beyond ILS, speech cancellation, distinct re-entry');
}
// E05: explicit go-around is consumed even without a valid/localizer sample.
{
  const { atc, lines } = make(), c = world();
  atc.update(0.1, c.sample(9000, 1000)); c.ap.ga = true;
  c.state.navOut = {}; atc.update(0.1, c.atcCtx());
  for (let i = 0; i < 4; i++) atc.update(0.1, c.atcCtx());
  assert.equal(atc.s.land, false); assert.equal(atc.s.goAround, true);
  assert.equal(lines.filter(x => /go around\./i.test(x.text)).length, 1, 'held GA state must not repeat');
  tick(4400); assert.ok(spoken.some(x => /Going around/.test(x))); assert.ok(!spoken.some(x => /Cleared to land/.test(x)));
  console.log('PASS E05 production go-around context clears radio once outside ILS');
}
// E06: different airport AND same airport / different runway invalidate all arrival latches.
for (const change of [{ arrApt: { ident: 'BRAV', name: 'Bravo Airport' }, arrRwy: '09' }, { arrRwy: '22R' }]) {
  const { atc, lines } = make();
  sample(atc, 20000, 3000); sample(atc, 8200, 1100); tick(140);
  atc.s.clr = true; atc.s.dep = true; atc.s.down = true;
  sample(atc, 20000, 3000, change);
  assert.equal(active.length, 0, 'arrival change cancels already-submitted browser speech');
  assert.equal(atc.s.clr, true); assert.equal(atc.s.dep, true, 'departure history is preserved');
  assert.equal(atc.s.land, false); assert.equal(atc.s.down, false);
  const airport = (change.arrApt || base.arrApt).name.split(' ')[0];
  assert.equal(lines.at(-1).from, `${airport} Approach`);
  assert.match(lines.at(-1).text, new RegExp(`runway ${change.arrRwy}`));
  tick(4400);
  const pilots = lines.filter(x => x.pilot);
  assert.equal(pilots.length, 1); assert.match(pilots[0].text, new RegExp(`runway ${change.arrRwy}`));
  sample(atc, 9000, 1500, change);
  assert.equal(lines.at(-1).from, `${airport} Tower`);
  console.log(`PASS E06 arrival identity ${airport}/${change.arrRwy}: new clearance, old speech/readback cancellation`);
}
// E07: crash before squelch expiry OR after controller speech; also exercise the real crash call ordering.
for (const delay of [0, 140]) {
  const { atc, lines, audio } = make();
  sample(atc, 20000, 3000); sample(atc, 8200, 1100); tick(delay);
  const spokenBefore = spoken.length;
  atc.update(0, { ...base, started: false, crashed: true });
  assert.equal(atc.timers.size, 0); assert.equal(active.length, 0); assert.equal(audio.enabled, true);
  tick(5000); assert.equal(spoken.length, spokenBefore); assert.equal(lines.filter(x => x.pilot).length, 0);
  atc.say('ATIS', 'stale weather', 'stale weather'); assert.equal(spoken.length, spokenBefore);
  atc.reset(); sample(atc, 9000, 1000); tick(140); assert.ok(spoken.length > spokenBefore, 'respawn restores radio');
}
{
  const { atc, audio } = make(); sample(atc, 20000, 3000); tick(140);
  const crashStart = main.indexOf("else if (e === 'crash') {");
  const crashCode = main.slice(crashStart + "else if (e === 'crash') {".length, main.indexOf('state.crashShown =', crashStart));
  let impacts = 0;
  vm.runInNewContext(crashCode, { atc, ap: { disengage() {} }, syncAp() {}, takeoff: { stop() {} }, wreck: { start() {} }, visual: {}, fdm: {},
    IS_PROP: true, IS_SF50: false, IS_HEAVY: false, FUEL_MAX: 100, crashAudio() { impacts++; assert.equal(atc.timers.size, 0); } });
  assert.equal(impacts, 1); assert.equal(audio.enabled, true); assert.equal(active.length, 0);
}
console.log('PASS E07 crash drops queued/active speech and readbacks, preserves impact audio, respawn restores radio');

// E08: heading-relative front/back, left/right and 0/360 wrap, using real call path too.
{
  const traffic = [{ lat: 0.05, lon: 0, alt: 1000 }];
  for (const [heading, clock] of [[0, 12], [180, 6], [90, 9], [270, 3], [359, 12], [-1, 12], [720, 12]]) {
    assert.match(buildTrafficAdvisory(traffic, { lat: 0, lon: 0, alt: 1000, heading }), new RegExp(`${clock} o'clock`));
  }
  const { atc } = make(), c = world(); c.point = { lat: 0, lon: 0 }; c.traffic.list = traffic;
  assert.equal(c.atcCtx().ownship.heading, 180);
  atc.update(30, c.atcCtx()); tick(140); assert.ok(spoken.some(x => /Traffic 6 o'clock/.test(x)));
}
console.log('PASS E08 heading-relative sectors and production ownship heading/speech');

// E11 + E12: actual world context supplies fixed/retractable gear and type, not callsign heuristics.
for (const [aircraft, target] of Object.entries({ c172: '5,000 feet', da40: '5,000 feet', f27: 'flight level 180', sf50: 'flight level 280', il76: 'flight level 330', a380x: 'flight level 350', sr71: 'flight level 600' })) {
  const { atc, lines } = make(), c = world(aircraft);
  c.fdm.onGround = true; c.fdm.vel.length = () => 0; atc.update(4, c.atcCtx());
  assert.equal(atc.s.clr, true);
  c.fdm.onGround = false; c.fdm.pos.y = 2000 / c.FT;
  atc.update(0.1, c.atcCtx());
  if (!c.IS_PROP) { assert.equal(atc.s.dep, false, 'retractable type retains gear-up requirement'); c.fdm.gearDown = false; atc.update(0.1, c.atcCtx()); }
  assert.equal(atc.s.dep, true); assert.equal(c.atcCtx().fixedGear, c.IS_PROP);
  assert.match(lines.at(-1).text, new RegExp(target));
  tick(4400); assert.ok(spoken.some(x => x.includes(`Climb and maintain ${target}`)));
  atc.update(1, c.atcCtx()); assert.equal(lines.filter(x => /radar contact/.test(x.text)).length, 1);
  console.log(`PASS E11/E12 ${aircraft}: gear-appropriate departure, ${target}, matching spoken readback, no duplicate`);
}
assert.match(buildPhaseMessage('climb', { aircraft: 'f27', altitude: '9,000 feet' }).text, /9,000 feet/);
assert.doesNotMatch(buildPhaseMessage('climb').text, /600/);
assert.ok(cancels > 0);
console.log('All expansion radio regression fixtures passed.');
