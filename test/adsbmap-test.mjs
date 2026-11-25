// Live ADS-B on the flight map (src/adsbmap.js) and the proxy's map features (functions/api/traffic.js).
import assert from 'node:assert/strict';
import { register } from 'node:module';

// adsbmap imports Leaflet, which needs a browser: a stub is enough for the pure helpers
const stub = `const L = { latLng: (a, b) => ({ lat: a, lng: b }) }; export default L;`;
const hooks = `export async function resolve(s, c, n) { if (s === 'leaflet') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const { normalize, altColor, project, matches, viewRadiusNm, emergencyOf, bearing, LiveAdsb } = await import('../src/adsbmap.js');
const { onRequestGet, slim, snapStep } = await import('../functions/api/traffic.js');

let fails = 0;
const check = async (name, fn) => { try { const info = await fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

await check('normalize: provider record to map entry (feet, knots, track); ground aircraft keep no altitude; hex lower case', () => {
  const e = normalize({ hex: 'ABC123', flight: 'BAW172  ', r: 'G-VIIJ', t: 'B772', alt_baro: 15975, gs: 295, track: 90.8, baro_rate: -640, squawk: '6332', type: 'adsb_icao', lat: 51.3, lon: -1.06, seen_pos: 2 }, 100);
  assert.equal(e.hex, 'abc123'); assert.equal(e.call, 'BAW172'); assert.equal(e.alt, 15975); assert.equal(e.cls, 'widebody'); assert.equal(e.src, 'ADS-B'); assert.equal(e.at, 98);
  const g = normalize({ hex: 'a1', alt_baro: 'ground', lat: 1, lon: 1 }, 0); assert.equal(g.alt, null); assert.equal(g.ground, true);
  assert.equal(normalize({ hex: 'a2', lat: null, lon: 1 }, 0), null);
});
await check('emergency squawks are named; the emergency field counts too', () => {
  assert.equal(emergencyOf('7700'), 'Emergency'); assert.equal(emergencyOf('7600'), 'Radio failure'); assert.equal(emergencyOf('7500'), 'Hijack');
  assert.equal(emergencyOf('1200', 'none'), null); assert.equal(emergencyOf('1200', 'minfuel'), 'Minfuel');
});
await check('altitude colours: warm low, cool high, grey on the ground', () => {
  assert.equal(altColor(null), 'rgb(150,156,166)'); assert.equal(altColor(0), 'rgb(255,112,64)'); assert.equal(altColor(45000), 'rgb(176,124,255)');
  assert.match(altColor(15000), /^rgb\(\d+,\d+,\d+\)$/);
});
await check('dead reckoning: 360 kt east for 10 s moves about 1.85 km east, never more than 60 s ahead', () => {
  const e = { lat: 0, lon: 0, gs: 360, trk: 90, at: 0 };
  const [la, lo] = project(e, 10); assert.ok(Math.abs(la) < 1e-9); assert.ok(Math.abs(lo * 111320 - 1852) < 5, String(lo * 111320));
  assert.deepEqual(project(e, 600), project(e, 60));
});
await check('find matches callsign, registration, type, ICAO address and squawk, case-insensitive', () => {
  const e = { call: 'EIN680', reg: 'EI-EDP', type: 'A320', hex: '4ca76f', squawk: '2055' };
  for (const q of ['ein', 'edp', 'a32', '4CA7', '2055', '']) assert.ok(matches(e, q), q);
  assert.ok(!matches(e, 'ryr'));
});
await check('view radius: half the visible diagonal, at least 20 NM, at most the providers\' 250 NM', () => {
  const ll = (lat, lng) => ({ lat, lng, distanceTo: (o) => Math.hypot((o.lat - lat) * 111320, (o.lng - lng) * 111320) });
  const map = (d) => ({ getCenter: () => ll(0, 0), getBounds: () => ({ getNorthEast: () => ll(d, d), getSouthWest: () => ll(-d, -d) }) });
  assert.equal(viewRadiusNm(map(0.01)), 20); assert.equal(viewRadiusNm(map(1)), 86); assert.equal(viewRadiusNm(map(20)), 250);
});
await check('bearing: north 0, east 90', () => { assert.ok(Math.abs(bearing(0, 0, 1, 0)) < 1e-6); assert.ok(Math.abs(bearing(0, 0, 0, 1) - 90) < 1e-6); });

globalThis.requestAnimationFrame ||= (f) => setTimeout(f, 0);
// a LiveAdsb without Leaflet: a fake map at a chosen centre and radius, the drawing and interface stubbed
function fakeLive(center, halfDeg = 0.5) {
  const ll = (lat, lng) => ({ lat, lng, distanceTo: (o) => Math.hypot((o.lat ?? o[0]) - lat, (o.lng ?? o[1]) - lng) * 111320 });
  const map = { c: center, getCenter: () => ll(map.c[0], map.c[1]), getBounds: () => ({ getNorthEast: () => ll(map.c[0] + halfDeg, map.c[1] + halfDeg), getSouthWest: () => ll(map.c[0] - halfDeg, map.c[1] - halfDeg) }), removeLayer() {}, hasLayer: () => false, panTo() {} };
  const l = Object.create(LiveAdsb.prototype);
  Object.assign(l, { map, o: { base: '/' }, list: new Map(), trails: new Map(), on: true, mode: 'area', active: false, viewOk: false, next: 0, busy: false, fails: 0, status: { n: 0, at: 0, err: '' }, coverage: null,
    layer: { addTo() {}, draw() {} }, renderUi() {}, renderCard() {} });
  return l;
}
const okFetch = (asked) => async (url) => { asked.push(new URL(url, 'http://sim.test').searchParams); return new Response(JSON.stringify({ aircraft: [{ hex: 'a1', lat: 51.5, lon: -0.4, alt_baro: 9000, gs: 300, track: 90 }], source: 'api.adsb.lol' }), { status: 200 }); };
{
  const realFetch = globalThis.fetch;
  try {
    await check('map traffic: the first fetch waits until the map sits on the aircraft (it used to fetch where the map was last open)', async () => {
      const asked = []; globalThis.fetch = okFetch(asked);
      const l = fakeLive([39.13, -121.44]); // the map's starting view
      l.setActive(true); await new Promise((r) => setTimeout(r, 20));
      assert.equal(asked.length, 0, 'fetched before the view was ready');
      l.map.c = [51.47, -0.45]; l.viewReady(); l._tick = true; l.loop(); await new Promise((r) => setTimeout(r, 20));
      assert.equal(asked.length, 1); assert.equal(+asked[0].get('lat'), 51.47); assert.equal(+asked[0].get('lon'), -0.45);
      l.active = false;
      return `first request at ${asked[0].get('lat')}, ${asked[0].get('lon')}`;
    });
    await check('map traffic: a pan during a request fetches the new area as soon as that request ends, not 12 s later', async () => {
      let release; const asked = []; globalThis.fetch = (url) => { asked.push(new URL(url, 'http://sim.test').searchParams); return new Promise((r) => { release = () => r(new Response(JSON.stringify({ aircraft: [] }), { status: 200 })); }); };
      const l = fakeLive([51.47, -0.45]); l.active = true; l.viewOk = true;
      const first = l.poll(); l.map.c = [48.35, 11.78]; l.moved(); release(); await first;
      assert.ok(l.next <= performance.now() / 1000, `next poll in ${(l.next - performance.now() / 1000).toFixed(1)} s`);
    });
    await check('map traffic: while the map is shut the area round the aircraft keeps loading (every 30 s), so it opens with traffic', async () => {
      const asked = []; globalThis.fetch = okFetch(asked);
      const l = fakeLive([0, 0]); l.background({ lat: 51.47, lon: -0.45 }); await new Promise((r) => setTimeout(r, 20));
      assert.equal(asked.length, 1); assert.equal(+asked[0].get('lat'), 51.47); assert.ok(+asked[0].get('dist') >= 150);
      assert.equal(l.list.size, 1, 'nothing kept for the map');
      l.background({ lat: 51.47, lon: -0.45 }); await new Promise((r) => setTimeout(r, 20));
      assert.equal(asked.length, 1, 'polled again before 30 s');
      l.active = true; l.bgNext = 0; l.background({ lat: 51.47, lon: -0.45 }); assert.equal(asked.length, 1, 'background poll while the map is open');
    });
    await check('map traffic: a failed request retries in 3 s, not 15', async () => {
      globalThis.fetch = async () => new Response('busy', { status: 502 });
      const l = fakeLive([0, 0]); await l.poll();
      const wait = l.next - performance.now() / 1000; assert.ok(wait > 2 && wait <= 3.05, `retry in ${wait.toFixed(2)} s`);
    });
  } finally { globalThis.fetch = realFetch; }
}

const oldFetch = globalThis.fetch;
try {
  await check('proxy: a map-sized area (200 NM) uses 1 degree cells and covers the asked circle', async () => {
    let seen; globalThis.fetch = async (url) => { seen = new URL(url); return new Response(JSON.stringify({ ac: [] }), { status: 200 }); };
    const r = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=51.47&lon=-0.45&dist=200') });
    assert.equal(r.status, 200); assert.equal(snapStep(200), 1); assert.equal(seen.pathname, '/v2/point/51.00/0.00/243');
  });
  await check('proxy: answers are slimmed to the fields the simulator reads', async () => {
    const big = { hex: 'a1', flight: 'X1', lat: 1, lon: 2, alt_baro: 3000, gs: 200, track: 10, rssi: -7, messages: 5, nic: 8, squawk: '1200', r: 'N1', t: 'C172' };
    globalThis.fetch = async () => new Response(JSON.stringify({ ac: [big] }), { status: 200 });
    const j = await (await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=10&lon=10&dist=30') })).json();
    assert.deepEqual(Object.keys(j.aircraft[0]).sort(), ['alt_baro', 'flight', 'gs', 'hex', 'lat', 'lon', 'r', 'squawk', 't', 'track']);
    assert.deepEqual(slim([{ hex: 'b', desc: '' }]), [{ hex: 'b' }]);
  });
  await check('proxy: worldwide lists (military from adsb.lol, emergencies merged from three squawks without duplicates), unknown list refused', async () => {
    const asked = []; globalThis.fetch = async (url) => { const u = new URL(url); asked.push(u.hostname + u.pathname);
      const ac = u.pathname.endsWith('/mil') ? [{ hex: 'm1', lat: 1, lon: 1 }] : u.pathname.endsWith('7700') ? [{ hex: 'e1', squawk: '7700', lat: 1, lon: 1 }, { hex: 'e2', lat: 2, lon: 2 }] : u.pathname.endsWith('7600') ? [{ hex: 'e2', lat: 2, lon: 2 }] : [];
      return new Response(JSON.stringify({ ac }), { status: 200 }); };
    let j = await (await onRequestGet({ request: new Request('https://sim.test/api/traffic?list=mil') })).json();
    assert.deepEqual(j.aircraft.map((a) => a.hex), ['m1']); assert.equal(j.list, 'mil'); assert.deepEqual(asked, ['api.adsb.lol/v2/mil']);
    j = await (await onRequestGet({ request: new Request('https://sim.test/api/traffic?list=emergency') })).json();
    assert.deepEqual(j.aircraft.map((a) => a.hex), ['e1', 'e2']);
    assert.equal((await onRequestGet({ request: new Request('https://sim.test/api/traffic?list=all') })).status, 400);
  });
  await check('proxy: a worldwide list falls back to adsb.fi when adsb.lol fails', async () => {
    const asked = []; globalThis.fetch = async (url) => { const u = new URL(url); asked.push(u.hostname); if (u.hostname === 'api.adsb.lol') return new Response('busy', { status: 429 });
      return new Response(JSON.stringify({ ac: [{ hex: 'm9', lat: 1, lon: 1 }] }), { status: 200 }); };
    const j = await (await onRequestGet({ request: new Request('https://sim.test/api/traffic?list=mil') })).json();
    assert.deepEqual(j.aircraft.map((a) => a.hex), ['m9']); assert.equal(j.source, 'adsb.fi'); assert.deepEqual(asked, ['api.adsb.lol', 'opendata.adsb.fi']);
  });
} finally { globalThis.fetch = oldFetch; }

if (fails) { console.log(`adsbmap-test: ${fails} failed`); process.exit(1); }
console.log('adsbmap-test ok');
