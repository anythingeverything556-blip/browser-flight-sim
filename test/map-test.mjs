import assert from 'node:assert/strict';
import { register } from 'node:module';

const stub = `
const count = globalThis.__L = { created: { circle: 0, marker: 0, polyline: 0, group: 0 }, trailSet: 0, markerSet: 0, tooltips: [], icons: [], closed: [] };
class Layer { constructor() { this.parent = null; } addTo(p) { p.addLayer(this); return this; } on() { return this; } bindTooltip(c) { count.tooltips.push(c); return this; } setLatLng() { return this; } getElement() { return null; } getLatLng() { return { lat: 0, lng: 0 }; } }
class Group extends Layer { constructor() { super(); this.items = new Set(); count.created.group++; } addLayer(l) { this.items.add(l); return this; } removeLayer(l) { this.items.delete(l); return this; } clearLayers() { this.items.clear(); return this; } hasLayer(l) { return this.items.has(l); } }
class Poly extends Layer { constructor(p) { super(); this.pts = p; count.created.polyline++; } setLatLngs(v) { this.pts = v; this.tag = 'poly'; if (this.isTrail) count.trailSet++; return this; } }
class Circle extends Layer { constructor() { super(); count.created.circle++; } }
class Marker extends Layer { constructor(ll, o) { super(); count.created.marker++; if (o && o.icon) count.icons.push(o.icon); this.isAc = o && o.zIndexOffset === 1000; } setLatLng() { if (this.isAc) count.markerSet++; return this; } }
const map = () => { const m = { z: 8, b: { w: 0, e: 1, s: 0, n: 1 }, layers: new Set(), setView() { return m; }, on() { return m; }, getZoom() { return m.z; }, getBounds() { const mk = (b) => ({ ...b, contains(o) { return o.w !== undefined ? o.w <= b.w && o.e >= b.e && o.s <= b.s && o.n >= b.n : o[0] >= b.s && o[0] <= b.n && o[1] >= b.w && o[1] <= b.e; }, pad(k) { const dw = (b.e - b.w) * k, dh = (b.n - b.s) * k; return mk({ w: b.w - dw, e: b.e + dw, s: b.s - dh, n: b.n + dh }); } }); return mk(m.b); }, addLayer(l) { m.layers.add(l); return m; }, removeLayer(l) { m.layers.delete(l); return m; }, hasLayer(l) { return m.layers.has(l); }, panTo() {}, getCenter() { return {}; }, latLngToLayerPoint() { return { distanceTo: () => 0 }; }, invalidateSize() {}, closePopup() {}, getContainer() { return {}; } }; return m; };
const L = { map, tileLayer: () => new Layer(), control: { zoom: () => new Layer(), layers: () => new Layer() }, canvas: () => ({}), layerGroup: () => new Group(), polyline: (p) => { const l = new Poly(p); return l; }, circle: () => new Circle(), circleMarker: () => new Circle(), marker: (ll, o) => new Marker(ll, o), divIcon: (o) => o, popup: () => ({ setLatLng() { return this; }, setContent() { return this; }, openOn() {} }), Control: { extend: () => class { addTo() { return this; } } }, DomUtil: { create: () => ({ setAttribute() {}, classList: { toggle() {} } }) }, DomEvent: { stop() {} }, latLng: (a) => ({ distanceTo: () => 0 }) };
export default L;
`;
const hooks = `export async function resolve(s, c, n) { if (s === 'leaflet') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true }; if (s.endsWith('.css')) return { url: 'data:text/javascript,export default 0', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const { MapPanel } = await import('../src/map.js');
const C = globalThis.__L;

const mk = (i, name = `Airport ${i}`) => ({ ident: `T${String(i).padStart(3, '0')}`, name, lat: 0.5 + (i % 10) * 0.01 + Math.floor(i / 10) * 0.2, lon: 0.5 + (i % 7) * 0.01, type: 1, mil: false, rawRunways: [['01', '19', 0.5, 0.5, 0.51, 0.5, 0, 0, 30, 1, 0]] });
const list = [mk(0, '<img src=x onerror=alert(1)>'), ...Array.from({ length: 29 }, (_, i) => mk(i + 1))];
const db = { ready: true, list }, nav = { wps: [{ lat: 0.5, lon: 0.5, name: '<b>x</b>' }], active: 0, onChange() {} };
const panel = new MapPanel({}, db, nav, { onAirport() {} });
panel.trail.isTrail = true;

panel.map.z = 9; panel.map.b = { w: 0, e: 1, s: 0, n: 1 };
panel.drawAirports(true);
const first = C.created.circle, shown = [...panel.aptMarks.keys()].length;
assert.ok(shown > 0 && first === shown, 'one circle marker per visible airport');
assert.ok(C.tooltips[0].includes('&lt;img') && !C.tooltips[0].includes('<img'), 'airport tooltip escaped');
assert.ok(C.icons.every((ic) => !/<img/.test(ic.html || '')), 'airport labels escaped');
panel.drawAirports(true);
assert.equal(C.created.circle, first, 'redraw at the same zoom and view recreates nothing');

panel.map.b = { w: 0, e: 1, s: 0.3, n: 1.3 };
panel.drawAirports();
const after = [...panel.aptMarks.keys()];
assert.ok(after.every((a) => a.lat >= 0.3 - 0.075 && a.lat <= 1.3 + 0.075), 'airports that scrolled out are removed');
assert.ok(C.created.circle - first < first, 'scrolling creates only the newly visible airports');
assert.equal(panel.aptLayer.items.size, after.length, 'aptLayer holds exactly the visible airports');
const kept = after.filter((a) => a.lat >= 0.3 + 0.1), made = C.created.circle;
panel.map.b = { w: 0, e: 1, s: 0.31, n: 1.31 }; panel.drawAirports(true);
assert.ok(kept.every((a) => panel.aptMarks.has(a)));
assert.ok(C.created.circle - made <= 3, 'a small scroll reuses the markers it already has');
panel.map.z = 10; panel.drawAirports();
assert.ok(panel.aptLayer.items.size > 0 && [...panel.aptMarks.values()].length === panel.aptLayer.items.size, 'zoom change rebuilds');
console.log('PASS map: airport markers diffed by airport (no clear-and-rebuild while scrolling), tooltips and labels escaped');

panel.drawRoute();
assert.ok(C.icons.some((ic) => (ic.html || '').includes('&lt;b&gt;x&lt;/b&gt;')) && C.icons.every((ic) => !(ic.html || '').includes('<b>x</b>')), 'waypoint names escaped');

C.trailSet = 0; C.markerSet = 0;
for (let i = 0; i < 10; i++) panel.update(10 + i * 0.01, 20, 90, { x: 0, z: 0 }, false);
assert.equal(C.trailSet, 0); assert.equal(C.markerSet, 0, 'map closed: no trail projection and no marker move');
panel.update(10.2, 20, 90, { x: 0, z: 0 }, true);
assert.equal(C.trailSet, 1); assert.equal(C.markerSet, 1);
assert.equal(panel.segs[0].length, 11, 'the trail kept recording while the map was closed');
panel.update(10.2, 20, 90, { x: 0, z: 0 }, true);
assert.equal(C.trailSet, 1, 'no change, no re-projection');
console.log('PASS map: trail and marker work skipped while the map is closed, flushed once when it opens');
process.exit(0);
