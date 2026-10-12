import assert from 'node:assert/strict';
import { classifyAircraftType, trafficBackoffSeconds, trafficCacheSeconds } from '../src/traffic.js';
import { onRequestGet } from '../functions/api/traffic.js';

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
assert.equal(trafficBackoffSeconds(1, 403), 30);
assert.equal(trafficBackoffSeconds(2, 429), 60);
assert.equal(trafficBackoffSeconds(3, 500), 120);
assert.equal(trafficBackoffSeconds(4, 522), 120);
assert.equal(trafficBackoffSeconds(4, 404), 15);

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
  assert.equal(requestSeen.url.pathname, '/v2/point/90.00/-180.00/100');
  assert.match(requestSeen.options.headers['user-agent'], /blackbird-sr71-sim/);
  assert.equal(requestSeen.options.cf.cacheTtl, 15);
  assert.match(response.headers.get('cache-control'), /max-age=15/);

  response = await onRequestGet({
    request: new Request('https://sim.test/api/traffic?lat=0&lon=1&dist=30'),
    env: { TRAFFIC_PROXY_URL: 'https://relay.example', TRAFFIC_ALLOWED_HOSTS: 'relay.example', TRAFFIC_API_KEY: 'test-key', TRAFFIC_CACHE_SECONDS: '90' },
  });
  assert.equal(response.status, 200);
  assert.equal(requestSeen.url.hostname, 'relay.example');
  assert.equal(requestSeen.url.pathname, '/v2/point/0.00/1.00/30');
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
