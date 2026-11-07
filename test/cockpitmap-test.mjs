// Cockpit moving map (src/cockpitmap.js): projection, airport selection, header text, and the class against a stub DOM / canvas.
import assert from 'node:assert/strict';
import { register } from 'node:module';

// the module imports its stylesheet (Vite bundles it): an empty module stands in under node
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s.endsWith('.css')) return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return n(s, c); }`));

const calls = { n: 0, arc: 0, stroke: 0, fill: 0, text: [] };
const ctx = new Proxy({}, { get: (t, k) => {
  if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
  if (k in t) return t[k];
  return (...a) => { calls.n++; if (k === 'arc') calls.arc++; if (k === 'stroke') calls.stroke++; if (k === 'fill') calls.fill++; if (k === 'fillText') calls.text.push(a[0]); };
}, set: (t, k, v) => { t[k] = v; return true; } });
class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.attrs = {}; this.textContent = ''; this.hidden = false; this.disabled = false; this.className = ''; this.classes = new Set(); this.classList = { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)) }; }
  append(...c) { this.children.push(...c); } appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(t, f) { this.listeners[t] = f; }
  getContext() { return ctx; } getBoundingClientRect() { return { left: 0, top: 0 }; } remove() { this.removed = true; }
}
globalThis.document = { createElement: (t) => new FakeEl(t) };
const { project, offset, clipSeg, pickVisibleAirports, headerInfo, fmtDist, distNm, CockpitMap, RANGES, NM_PER_DEG } = await import('../src/cockpitmap.js');

let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const c0 = { lat: 45, lon: 10 };

check('project: a point 10 NM due north is straight up with north-up, 10 NM due east is right', () => {
  const n = project(45 + 10 / NM_PER_DEG, 10, c0, 0, 2); near(n.x, 0); near(n.y, -20);
  const e = project(45, 10 + 10 / NM_PER_DEG / Math.cos(45 * Math.PI / 180), c0, 0, 2); near(e.x, 20); near(e.y, 0);
});
check('project: heading-up rotates the picture (heading 90: north to the left, east ahead; heading 180: north behind)', () => {
  const north = { lat: 45 + 5 / NM_PER_DEG, lon: 10 }, east = { lat: 45, lon: 10 + 5 / NM_PER_DEG / Math.cos(45 * Math.PI / 180) };
  let p = project(north.lat, north.lon, c0, 90, 1); near(p.x, -5); near(p.y, 0);
  p = project(east.lat, east.lon, c0, 90, 1); near(p.x, 0); near(p.y, -5);
  p = project(north.lat, north.lon, c0, 180, 1); near(p.x, 0); near(p.y, 5);
  p = project(north.lat, north.lon, c0, 360, 1); near(p.x, 0); near(p.y, -5);
});
check('project: the point straight ahead of the heading is always straight up', () => {
  for (const h of [0, 37, 90, 211, 300]) { const f = offset(c0.lat, c0.lon, h, 12), p = project(f.lat, f.lon, c0, h, 3); assert.ok(Math.abs(p.x) < 0.05, `h${h} x=${p.x}`); near(p.y, -36, 0.05); }
});
check('project: antimeridian (179.9E to 179.9W is 0.2 deg east, not 359.8 west)', () => {
  const a = { lat: 0, lon: 179.9 }, p = project(0, -179.9, a, 0, 1); near(p.x, 0.2 * NM_PER_DEG, 1e-6);
  const q = project(0, 179.9, { lat: 0, lon: -179.9 }, 0, 1); near(q.x, -0.2 * NM_PER_DEG, 1e-6);
  const o = offset(0, 179.95, 90, 10); assert.ok(o.lon < 0 && o.lon > -180, String(o.lon));
});
check('offset and distNm agree (10 NM along 270 from a threshold)', () => { const o = offset(45, 10, 270, 10); near(distNm(c0, o), 10, 0.05); assert.ok(o.lon < 10); near(o.lat, 45, 1e-9); });
check('clipSeg: inside kept, crossing trimmed to the rect, outside dropped', () => {
  assert.deepEqual(clipSeg(1, 1, 5, 5, 0, 0, 10, 10), [1, 1, 5, 5]);
  assert.deepEqual(clipSeg(-5, 5, 15, 5, 0, 0, 10, 10), [0, 5, 10, 5]);
  assert.equal(clipSeg(-5, -5, -1, 20, 0, 0, 10, 10), null);
  assert.equal(clipSeg(20, 0, 30, 5, 0, 0, 10, 10), null);
});

const apt = (ident, dN, type = 2, extra = {}) => ({ ident, lat: 45 + dN / NM_PER_DEG, lon: 10, type, ...extra });
check('pickVisibleAirports: range filter, nearest first, accepts db.near items, drops small fields at long range', () => {
  const list = [apt('FAR', 30, 0), apt('MID', 8, 1), apt('SML', 3, 2), apt('LRG', 15, 0), apt('NEAR', 1, 2), apt('L2', 40, 0), apt('M2', 5, 1)].map((a) => ({ a, d: 0 }));
  assert.deepEqual(pickVisibleAirports(list, c0, 10).map((r) => r.apt.ident), ['NEAR', 'SML', 'M2', 'MID']);
  assert.deepEqual(pickVisibleAirports(list, c0, 20).map((r) => r.apt.ident), ['M2', 'MID', 'LRG']);
  const r160 = pickVisibleAirports(list, c0, 160).map((r) => r.apt.ident); assert.deepEqual(r160, ['LRG', 'FAR', 'L2']);
  near(pickVisibleAirports(list, c0, 10)[0].dNm, 1, 1e-6);
});
check('pickVisibleAirports: capped at max, the arrival airport is kept even when far down the list', () => {
  const list = Array.from({ length: 100 }, (_, i) => apt('A' + i, 1 + i * 0.05));
  const keep = list[99], out = pickVisibleAirports(list, c0, 10, { max: 40, keep });
  assert.equal(out.length, 41); assert.ok(out.some((r) => r.apt === keep)); assert.equal(pickVisibleAirports(list, c0, 10, { max: 40 }).length, 40);
  assert.deepEqual(pickVisibleAirports([], c0, 10), []); assert.deepEqual(pickVisibleAirports(null, c0, 10), []);
});
check('pickVisibleAirports: wraps across the antimeridian', () => {
  const out = pickVisibleAirports([{ ident: 'PFJ', lat: 0, lon: -179.95, type: 0 }], { lat: 0, lon: 179.95 }, 20); assert.equal(out.length, 1); near(out[0].dNm, 6, 0.1);
});

check('headerInfo: active waypoint name and distance, GS, track', () => {
  const h = headerInfo({ lat: 45, lon: 10, hdg: 90, trackDeg: 95, gsKt: 450, route: [{ lat: 45, lon: 10, name: 'ALPHA' }, { lat: 45 + 25 / NM_PER_DEG, lon: 10, name: 'BRAVO' }], activeIdx: 1, ils: null });
  assert.equal(h.gs, 'GS 450 KT'); assert.equal(h.trk, 'TRK 095°'); assert.equal(h.kind, 'wpt'); assert.equal(h.tgt, 'BRAVO 25 NM'); near(h.distNm, 25, 0.05);
});
check('headerInfo: a valid ILS wins over the waypoint; an invalid one does not; metric units', () => {
  const base = { lat: 45, lon: 10, hdg: 10, trackDeg: 12, gsKt: 100, route: [{ lat: 45.1, lon: 10, name: 'W1' }], activeIdx: 0 };
  assert.equal(headerInfo({ ...base, ils: { valid: true, ident: 'IKLO', distNm: 8.26 } }).tgt, 'ILS IKLO 8.3 NM');
  assert.equal(headerInfo({ ...base, ils: { valid: false, ident: 'IKLO', distNm: 8 } }).kind, 'wpt');
  const m = headerInfo({ ...base, metric: true, ils: { valid: true, ident: 'IKLO', distNm: 10 } }); assert.equal(m.gs, 'GS 185 KM/H'); assert.equal(m.tgt, 'ILS IKLO 19 KM');
  assert.equal(fmtDist(100, true), '185 KM'); assert.equal(fmtDist(5, false), '5.0 NM');
});
check('headerInfo: no route and no ILS shows a dash; slow ground speed uses the heading; arrival falls back to the runway', () => {
  const h = headerInfo({ lat: 45, lon: 10, hdg: 270, trackDeg: 123, gsKt: 5, route: [], activeIdx: 0 });
  assert.equal(h.tgt, '—'); assert.equal(h.kind, 'none'); assert.equal(h.trk, 'TRK 270°');
  const rwy = { ap: { ident: 'LOWI' }, ends: [{ ident: '26', start: { lat: 45.1, lon: 10 }, hdg: 260 }] };
  const a = headerInfo({ lat: 45, lon: 10, hdg: 0, gsKt: 100, route: [], activeIdx: 0, arrival: { rwy, end: 0 } }); assert.equal(a.kind, 'arr'); assert.match(a.tgt, /^LOWI 26 6\.0 NM$/);
});

// class against the stub DOM
const rw = (a, b, w = 45) => ({ a, b, width: w, len: Math.hypot((b.lat - a.lat) * 111195, (b.lon - a.lon) * 78000) });
const mkApt = (ident, lat, lon, type) => { const r = rw({ lat, lon: lon - 0.02 }, { lat, lon: lon + 0.02 }); const ap = { ident, lat, lon, type, mil: false, runways: [r], longest: r }; r.ap = ap; r.ends = [{ ident: '27', start: r.b, hdg: 270, rwy: r }, { ident: '09', start: r.a, hdg: 90, rwy: r }]; return ap; };
const A = mkApt('LOWI', 47.26, 11.34, 0), B = mkApt('EDDM', 48.35, 11.78, 0);
let nearCalls = 0; const db = { near: () => { nearCalls++; return [{ a: A, d: 1000 }, { a: B, d: 120000 }]; } };
const parent = new FakeEl('div'); const picked = [];
const cm = new CockpitMap(parent, db, { onPickAirport: (a) => picked.push(a.ident) });
const state = (o = {}) => ({ lat: 47.2, lon: 11.3, hdg: 90, trackDeg: 90, gsKt: 120, altFt: 5000, route: [{ lat: 47.3, lon: 11.5, name: 'GAPLI' }], activeIdx: 0, arrival: { rwy: A.runways[0], end: 0 }, ils: { valid: true, ident: 'IIN', distNm: 4.2 }, metric: false, traffic: [{ lat: 47.22, lon: 11.31, alt: 6200 }], ...o });

check('CockpitMap: mounts hidden, toggles, update does no drawing while hidden', () => {
  assert.equal(parent.children.length, 1); assert.equal(cm.visible, false);
  const before = calls.n; cm.update(state(), 0); assert.equal(calls.n, before);
  assert.equal(cm.toggle(), true); assert.equal(cm.visible, true); assert.equal(cm.el.hidden, false); assert.ok(calls.n > before, 'draws at once when shown');
  assert.equal(cm.toggle(false), false); assert.equal(cm.el.hidden, true); assert.equal(cm.toggle(true), true);
});
check('CockpitMap: redraws at most 10 Hz', () => {
  cm.update(state(), 1000); const n1 = calls.n; cm.update(state(), 1030); cm.update(state(), 1090); assert.equal(calls.n, n1);
  cm.update(state(), 1100); assert.ok(calls.n > n1);
});
check('CockpitMap: draws rings, airports, route, approach and the header text', () => {
  cm.update(state(), 5000);
  assert.ok(calls.arc >= 2 && calls.stroke > 10 && calls.fill > 0);
  assert.ok(calls.text.includes('LOWI') && calls.text.includes('GAPLI'), calls.text.slice(-12).join());
  assert.equal(cm.hGs.textContent, 'GS 120 KT'); assert.equal(cm.hTrk.textContent, 'TRK 090°'); assert.equal(cm.hTgt.textContent, 'ILS IIN 4.2 NM'); assert.equal(cm.hTgt.dataset.kind, 'ils');
});
check('CockpitMap: zoom steps through the ranges, clamps at both ends, setRange snaps', () => {
  cm.setRange(40); assert.equal(cm.range, 40); cm.zoom(1); assert.equal(cm.range, 80); cm.zoom(-1); cm.zoom(-1); assert.equal(cm.range, 20);
  for (let i = 0; i < 20; i++) cm.zoom(1); assert.equal(cm.range, 320); assert.equal(cm.bOut.disabled, true);
  for (let i = 0; i < 20; i++) cm.zoom(-1); assert.equal(cm.range, 5); assert.equal(cm.bIn.disabled, true);
  cm.setRange(45); assert.equal(cm.range, 40); cm.setRange(1000); assert.equal(cm.range, 320); assert.deepEqual(RANGES, [5, 10, 20, 40, 80, 160, 320]);
  cm.setRange(20); assert.equal(cm.hRange.textContent, '20 NM'); cm.update(state({ metric: true }), 9000); cm._syncUi(); assert.equal(cm.hRange.textContent, '37 KM');
});
check('CockpitMap: track-up / north-up toggle and size toggle', () => {
  assert.equal(cm.headingUp, true); cm.bMode.listeners.click({}); assert.equal(cm.headingUp, false); assert.equal(cm.bMode.textContent, 'N');
  cm.bMode.listeners.click({}); assert.equal(cm.headingUp, true); assert.equal(cm.bMode.textContent, 'HDG');
  cm.bSize.listeners.click({}); assert.equal(cm.large, true); assert.ok(cm.el.classes.has('cm-large')); cm.bSize.listeners.click({}); assert.equal(cm.large, false);
});
check('CockpitMap: clicking an airport symbol calls onPickAirport; empty space does not', () => {
  cm.setRange(40); cm.update(state(), 20000);
  const h = cm.hits.find((x) => x.apt === A); assert.ok(h, 'LOWI drawn');
  cm.canvas.listeners.click({ clientX: h.x + 3, clientY: h.y - 2 }); assert.deepEqual(picked, ['LOWI']);
  cm.canvas.listeners.click({ clientX: 2, clientY: 2 }); assert.deepEqual(picked, ['LOWI']);
});
check('CockpitMap: airport query is cached while the aircraft barely moves, and redone after a range change', () => {
  cm.setRange(40); cm.update(state(), 30000); const n = nearCalls;
  cm.update(state({ lat: 47.2001 }), 30200); cm.update(state({ lat: 47.2002 }), 30400); assert.equal(nearCalls, n);
  cm.setRange(80); assert.ok(nearCalls > n);
});
check('CockpitMap: survives odd state (no route, no arrival, NaN heading, empty db, route on the other side of the date line)', () => {
  const lone = new CockpitMap(new FakeEl('div'), { near: () => [] }); lone.toggle(true);
  lone.update(state({ route: [], arrival: null, ils: null, traffic: undefined, hdg: NaN, trackDeg: undefined }), 0);
  lone.update(state({ lat: 0, lon: 179.9, route: [{ lat: 0, lon: -179.9, name: 'DATE' }, { lat: 5, lon: -170, name: 'FAR' }], arrival: null, ils: null }), 500);
  assert.equal(lone.hTgt.textContent.startsWith('DATE 12'), true, lone.hTgt.textContent); lone.destroy();
});

process.exit(fails ? 1 : 0);
