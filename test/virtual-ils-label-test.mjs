// Presentation-only regression: production airport data and UI functions, no live services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { AirportDB } from '../src/airportdb.js';
import { Navigation } from '../src/nav.js';
import { haversine, bearing } from '../src/geo.js';
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const raw = JSON.parse(fs.readFileSync(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const previousFetch = globalThis.fetch;
let db;
try {
  globalThis.fetch = async () => ({ json: async () => structuredClone(raw) });
  db = await new AirportDB().load('local-fixture');
} finally { globalThis.fetch = previousFetch; }
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start); return source.slice(a, b);
};
const arrivalLine = source.split('\n').find(line => line.includes("$('arr-box').textContent ="));
assert.ok(arrivalLine);
const arrival = new vm.Script(arrivalLine), box = {};
const context = vm.createContext({ arr: null, $: id => { assert.equal(id, 'arr-box'); return box; }, fmtLen: len => `${Math.round(len)} m` });
const render = (rwy, end) => { context.arr = rwy ? { rwy, end } : null; arrival.runInContext(context); return box.textContent; };
assert.match(render(null), /None/);
let generated = 0, visual = 0;
for (const ap of db.list) for (const rwy of ap.runways) for (const end of [0, 1]) {
  const original = rwy.ils(end), label = render(rwy, end);
  assert.ok(label.includes(`${ap.ident} runway ${rwy.ends[end].ident}`));
  assert.ok(label.endsWith(`${Math.round(rwy.len)} m`));
  if (original) {
    generated++; assert.match(label, /Virtual ILS \(generated guidance\)/);
    assert.ok(!label.includes(original), 'synthetic ident/frequency must not be displayed');
    assert.doesNotMatch(label, /\b1[01]\d\.\d{2}\b|MHz/i);
  } else { visual++; assert.match(label, /Visual approach/); }
  assert.equal(rwy.ils(end), original, 'legacy simulated ILS API remains intact');
}
assert.equal(generated, 14406, 'all archived generated labels exercised');
assert.ok(visual > 0);
// Regression examples include both unallocated and allocated-looking fake channels.
assert.equal(db.get('EGLL').runways[0].ils(0), 'I-GLL 108.20');
assert.match(html, /Virtual ILS is generated in-game guidance, not published radio or procedure data/);
assert.match(html, /id="ap-tuneils"[^>]*>Select virtual ILS ahead/);
assert.match(source, /data-act="ils:\$\{ri\}:\$\{k\}"[^>]*>Virtual ILS/);
assert.match(source, /data-act="ils:\$\{i\}:\$\{k\}">Virtual ILS/);

// Real nearest-ahead selection still passes the same runway/end to Navigation and
// yields valid simulated localizer/glideslope needles, with frequency-free feedback.
const ap = db.get('EGLL'), rwy = ap.runways[0], start = rwy.spawn(0, 'approach');
const ll = { lat: start.lat, lon: start.lon }, nav = new Navigation(), messages = [];
let rendered = 0;
const tuning = vm.createContext({ aircraftLatLon: () => ll, attitude: () => ({ heading: start.hdg }),
  fdm: { quat: {} }, db: { near: () => [{ a: ap }] }, haversine, bearing, nav,
  renderRoute: () => { rendered++; }, toast: (text, error) => messages.push({ text, error }) });
vm.runInContext(section('function tuneIlsAhead() {', "controls.on('tuneIls'"), tuning);
vm.runInContext('tuneIlsAhead()', tuning);
assert.equal(nav.arrival.rwy, rwy); assert.equal(nav.arrival.end, 0); assert.equal(rendered, 1);
assert.match(messages[0].text, /Virtual ILS selected: EGLL runway .*generated guidance/);
assert.doesNotMatch(messages[0].text, /I-GLL|108\.20|MHz/);
assert.equal(nav.update(ll, start.alt, start.hdg).ilsValid, true);
const selected = nav.arrival;
tuning.db.near = () => [];
vm.runInContext('tuneIlsAhead()', tuning);
assert.equal(nav.arrival, selected); assert.equal(rendered, 1);
assert.equal(messages.at(-1).error, true); assert.match(messages.at(-1).text, /No virtual ILS/);
console.log(`PASS virtual ILS: ${generated} generated and ${visual} visual arrival labels; frequency-free selection feedback, same runway and live simulated needles`);
