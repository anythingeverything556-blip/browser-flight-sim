import assert from 'node:assert/strict';
import { Traffic, classifyAircraftType, trafficBackoffSeconds, trafficCacheSeconds } from '../src/traffic.js';
import { onRequestGet, fromOpenSky, snapTo, providers } from '../functions/api/traffic.js';

assert.deepEqual(classifyAircraftType('A320'), { class: 'narrowbody', size: 1.15 });
assert.equal(classifyAircraftType('B77W').class, 'widebody');
assert.equal(classifyAircraftType('E75L').class, 'regional');
assert.equal(classifyAircraftType('CRJ7').class, 'regional');
assert.equal(classifyAircraftType('AT76').class, 'turboprop');
assert.equal(classifyAircraftType('DH8D').class, 'turboprop');
assert.equal(classifyAircraftType('R44').class, 'helicopter');
assert.equal(classifyAircraftType('C172').class, 'ga');
assert.equal(classifyAircraftType('ZZZZ').class, 'unknown');
assert.equal(trafficCacheSeconds('public, max-age=4'), 15);
assert.equal(trafficCacheSeconds('max-age=80'), 80);
assert.equal(trafficCacheSeconds('max-age=240'), 120);
assert.equal(trafficBackoffSeconds(1), 30);
assert.equal(trafficBackoffSeconds(2), 60);
assert.equal(trafficBackoffSeconds(3), 120);
assert.equal(trafficBackoffSeconds(4), 240);
assert.equal(trafficBackoffSeconds(5), 300);
assert.equal(trafficBackoffSeconds(50), 300, 'every failure type backs off, capped at five minutes (a 404 or an HTML page used to retry every 15 s)');

const oldFetch = globalThis.fetch;
let requestSeen;
try {
  globalThis.fetch = async (url, options) => {
    requestSeen = { url: new URL(url), options };
    return new Response(JSON.stringify({ aircraft: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let response = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=91&lon=-200&dist=500') });
  assert.equal(response.status, 200);
  assert.equal(requestSeen.url.hostname, 'api.adsb.lol');
  assert.equal(requestSeen.url.pathname, '/v2/point/90.00/-180.00/250'); // the map asks for areas up to 250 NM
  assert.match(requestSeen.options.headers['user-agent'], /blackbird-sr71-sim/);
  assert.equal(requestSeen.options.cf.cacheTtl, 15);
  assert.match(response.headers.get('cache-control'), /max-age=15/);

  response = await onRequestGet({
    request: new Request('https://sim.test/api/traffic?lat=0&lon=1&dist=30'),
    env: { TRAFFIC_PROXY_URL: 'https://relay.example', TRAFFIC_ALLOWED_HOSTS: 'relay.example', TRAFFIC_API_KEY: 'test-key', TRAFFIC_CACHE_SECONDS: '90' },
  });
  assert.equal(response.status, 200);
  assert.equal(requestSeen.url.hostname, 'relay.example');
  assert.equal(requestSeen.url.pathname, '/v2/point/0.00/1.00/38', 'cell radius = requested + 8 nm');
  assert.equal(requestSeen.options.headers.authorization, 'Bearer test-key');
  assert.equal(requestSeen.options.cf.cacheTtl, 90);

  response = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=no&lon=1') });
  assert.equal(response.status, 400);
  const before = requestSeen.url.href;
  response = await onRequestGet({
    request: new Request('https://sim.test/api/traffic?lat=0&lon=0'),
    env: { TRAFFIC_PROXY_URL: 'https://attacker.example' },
  });
  assert.equal(response.status, 502);
  assert.equal(requestSeen.url.href, before);
} finally { globalThis.fetch = oldFetch; }

console.log('traffic-test ok');

// providers: a rate-limited first upstream falls through to the next, and OpenSky states become adsb.lol-shaped aircraft
assert.equal(snapTo(37.62, 90), 37.5); assert.equal(snapTo(-122.38, 180), -122.5); assert.equal(snapTo(95, 90), 90);
const opensky = fromOpenSky({ states: [['abc123', 'UAL12  ', 'United States', 1700000000, 1700000000, -122.4, 37.6, 3000, false, 120, 270, 5, null, 3100, '1200', false, 0, 3], ['dead', '', '', null, null, null, null, 0, true, 0, 0, 0, null, 0, null, false, 0, 0], ['gnd001', 'TAXI', '', 1, 1, -122.3, 37.6, 0, true, 5, 90, 0, null, 0, null, false, 0, 2]] });
assert.equal(opensky.length, 2, 'a state without a position is dropped');
assert.equal(opensky[0].hex, 'abc123'); assert.equal(opensky[0].flight, 'UAL12'); assert.ok(Math.abs(opensky[0].alt_baro - 3100 / 0.3048) < 1); assert.ok(Math.abs(opensky[0].gs - 120 / 0.514444) < 0.01); assert.equal(opensky[0].t, 'A320');
assert.equal(opensky[1].alt_baro, 'ground');
const chain = providers(37.5, -122.5, 62, 'https://api.adsb.lol');
assert.deepEqual(chain.map((p) => p.name), ['api.adsb.lol', 'adsb.fi', 'opensky']);
assert.equal(providers(37.5, -122.5, 62, 'https://relay.example').length, 1, 'a configured relay is used alone');
{
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).hostname);
    if (calls.length === 1) return new Response('<html>429</html>', { status: 429 });
    return new Response(JSON.stringify({ ac: [{ hex: 'x1', lat: 1, lon: 2, alt_baro: 5000 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=37.62&lon=-122.38&dist=54') });
  const j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(calls, ['api.adsb.lol', 'opendata.adsb.fi']); assert.equal(j.aircraft.length, 1); assert.equal(j.source, 'adsb.fi'); assert.equal(r.headers.get('x-traffic-source'), 'adsb.fi');
  globalThis.fetch = async () => new Response('nope', { status: 429 });
  const bad = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=37.62&lon=-122.38') });
  assert.equal(bad.status, 502); assert.match((await bad.json()).error, /adsb\.fi 429/);
}
globalThis.fetch = oldFetch;
console.log('traffic providers ok');

// B07: expired primary observations must not stop the provider chain or enter
// either edge cache as fresh. All HTTP and cache operations are local fixtures.
{
  const originalNow = Date.now, originalCaches = globalThis.caches;
  const now = 1800000000000, aircraft = { hex: 'fresh1', lat: 1, lon: 2, alt_baro: 10000, seen_pos: 2 };
  const response = (body) => new Response(JSON.stringify(body));
  Date.now = () => now;
  try {
    for (const query of ['lat=1&lon=2&dist=54', 'list=mil']) {
      for (const expired of [
        { ac: [aircraft], acquiredAt: now - 91000 },
        { ac: [aircraft], acquiredAt: now - 91000, stale: true },
        { ac: [aircraft], now: (now - 91000) / 1000 },
        { ac: [{ ...aircraft, seen_pos: 31 }], acquiredAt: now - 60000 },
        { ac: [], acquiredAt: now - 91000 },
      ]) {
        const calls = [], puts = [], pending = [];
        globalThis.caches = { default: { match: async () => null, put: async (key, res) => { puts.push({ url: key.url, body: await res.json() }); } } };
        globalThis.fetch = async (url) => {
          const host = new URL(url).hostname; calls.push(host);
          assert.ok(['api.adsb.lol', 'opendata.adsb.fi'].includes(host), 'no live HTTP');
          return response(host === 'api.adsb.lol' ? expired : { ac: [aircraft], acquiredAt: now });
        };
        const r = await onRequestGet({ request: new Request(`https://sim.test/api/traffic?${query}`), waitUntil: (p) => pending.push(p) });
        const body = await r.clone().json(); await Promise.all(pending);
        assert.deepEqual(calls, ['api.adsb.lol', 'opendata.adsb.fi'], `${query}: expired primary must fall through`);
        assert.equal(r.status, 200); assert.equal(body.source, 'adsb.fi'); assert.equal(body.acquiredAt, now);
        assert.equal(body.stale, false); assert.equal(body.partial, false);
        assert.ok(puts.length > 0); assert.ok(puts.every((p) => p.body.source === 'adsb.fi' && p.body.acquiredAt === now));
        assert.match(r.headers.get('cache-control'), /public/);
        // The 3-D client must accept the recovered response, not reject it as expired.
        if (!query.startsWith('list=')) {
          globalThis.fetch = async () => r.clone();
          const client = new Traffic({ add() {} }, {}); await client.poll(1, 2);
          assert.equal(client.fails, 0); assert.equal(client.err, null); assert.equal(client.list.size, 1);
        }
      }
    }
    // Entries cached before this fix can also outlive the clients' 90-second
    // lifetime (the configurable area cache TTL is up to 120 seconds).
    for (const query of ['lat=1&lon=2', 'list=mil']) {
      let calls = 0;
      globalThis.caches = { default: {
        match: async () => response({ aircraft: [aircraft], acquiredAt: now - 91000, source: 'old cache' }),
        put: async () => {},
      } };
      globalThis.fetch = async () => { calls++; return response({ ac: [aircraft], acquiredAt: now }); };
      const r = await onRequestGet({ request: new Request(`https://sim.test/api/traffic?${query}`) });
      assert.equal(calls, 1, 'expired cache hit must not bypass provider validation');
      assert.equal((await r.json()).acquiredAt, now);
    }
    // Neither an expired provider nor an expired retained cache is a usable
    // fallback when every source has aged out. No cache lifetime is renewed.
    for (const query of ['lat=1&lon=2', 'list=mil']) {
      const calls = [], puts = [];
      globalThis.caches = { default: {
        match: async () => response({ aircraft: [aircraft], acquiredAt: now - 91000, source: 'old cache' }),
        put: async (key) => puts.push(key.url),
      } };
      globalThis.fetch = async (url) => {
        calls.push(new URL(url).hostname);
        return response({ ac: [aircraft], states: [], time: (now - 91000) / 1000 });
      };
      const r = await onRequestGet({ request: new Request(`https://sim.test/api/traffic?${query}`) });
      assert.equal(r.status, 502); assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(calls, query.startsWith('list=')
        ? ['api.adsb.lol', 'opendata.adsb.fi'] : ['api.adsb.lol', 'opendata.adsb.fi', 'opensky-network.org']);
      assert.deepEqual(puts, []);
    }
    // A current empty snapshot still means no traffic, not provider failure.
    let calls = 0; globalThis.caches = undefined;
    globalThis.fetch = async () => { calls++; return response({ ac: [], acquiredAt: now }); };
    const empty = await onRequestGet({ request: new Request('https://sim.test/api/traffic?lat=1&lon=2') });
    assert.equal(empty.status, 200); assert.deepEqual((await empty.json()).aircraft, []); assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; Date.now = originalNow; globalThis.caches = originalCaches; }
}
console.log('B07 expired primary / fresh fallback regressions ok');
