import assert from 'node:assert/strict';
import { onRequestGet as metar } from '../functions/api/metar.js';
import { onRequestGet as trafficProxy } from '../functions/api/traffic.js';
import { nearestMetar } from '../src/metar.js';
import { Traffic, TRAFFIC_STALE_SECONDS } from '../src/traffic.js';

const realFetch = globalThis.fetch;
const asking = (qs) => ({ request: new Request(`https://sim.test/api/metar?${qs}`) });
const box = (lat) => { const d = Math.min(3.95, 1.4 / Math.max(0.35, Math.cos(lat * Math.PI / 180))); return `bbox=${(lat - 1.4).toFixed(2)},${(10 - d).toFixed(2)},${(lat + 1.4).toFixed(2)},${(10 + d).toFixed(2)}`; };
try {
  // METAR proxy: 204 from upstream becomes a valid empty list
  globalThis.fetch = async () => new Response(null, { status: 204 });
  let r = await metar(asking('ids=KSFO'));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), []); assert.match(r.headers.get('cache-control'), /max-age=120/);
  console.log('PASS metar proxy: upstream 204 -> 200 []');

  // bbox: high latitudes (the client box is 2 x 3.95 deg plus rounding) accepted, oversize and junk refused
  let seenUrl = ''; globalThis.fetch = async (u) => { seenUrl = String(u); return new Response('[]', { status: 200 }); };
  for (const lat of [0, 40, 60, 69.6, 72, 78, 83, -75]) { r = await metar(asking(box(lat))); assert.equal(r.status, 200, `bbox at ${lat}`); }
  r = await metar(asking('bbox=70.00,-3.95,72.80,4.05')); assert.equal(r.status, 200, 'width 8.00 as the 69.5+ deg client used to build it');
  r = await metar(asking('bbox=70.00,-3.95,72.80,4.0500000001')); assert.equal(r.status, 200);
  for (const bad of ['bbox=0,0,0,9', 'bbox=0,0,7,1', 'bbox=,,,', 'bbox=a,b,c,d', 'bbox=1,2,3', '']) { r = await metar(asking(bad)); assert.equal(r.status, 400, bad); assert.equal(r.headers.get('cache-control'), 'no-store'); }
  assert.match(seenUrl, /bbox=[-\d.,]+&format=json/);
  console.log('PASS metar proxy: high-latitude bbox accepted, oversize/junk refused with no-store');

  // the real client against the real proxy, polar to equatorial
  let stationLat = 0;
  globalThis.fetch = async (u) => (String(u).startsWith('/api/metar') ? metar({ request: new Request('https://sim.test' + u) }) : new Response(JSON.stringify([{ lat: stationLat, lon: 10, icaoId: 'XXXX' }]), { status: 200 }));
  for (const lat of [0, 52.37, 69.6, 70.1, 75, 78.2, 82, -77.8]) { stationLat = lat; const best = await nearestMetar(lat, 10, '/', 150); assert.equal(best.m.icaoId, 'XXXX', `nearestMetar at ${lat}`); }
  console.log('PASS metar client + proxy: nearestMetar works from -78 to 82 deg latitude');

  // errors are never cached for everyone; 2xx is
  globalThis.fetch = async () => new Response('upstream broke', { status: 503 });
  r = await metar(asking('ids=KSFO')); assert.equal(r.status, 503); assert.equal(r.headers.get('cache-control'), 'no-store');
  globalThis.fetch = async (u, o) => { assert.deepEqual(o.cf.cacheTtlByStatus, { '200-299': 120, '300-599': 0 }); return new Response('[{"icaoId":"KSFO"}]', { status: 200 }); };
  r = await metar(asking('ids=KSFO')); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /public, max-age=120/);
  globalThis.fetch = async () => { throw new TypeError('network'); };
  r = await metar(asking('ids=KSFO')); assert.equal(r.status, 502); assert.equal(r.headers.get('cache-control'), 'no-store');
  console.log('PASS metar proxy: only 2xx cached, errors no-store');

  // timeout -> 504
  globalThis.fetch = (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t0 = Date.now(); r = await metar({ ...asking('ids=KSFO'), env: { METAR_TIMEOUT_MS: '60' } });
  assert.equal(r.status, 504); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.ok(Date.now() - t0 < 2000);
  console.log('PASS metar proxy: hung upstream aborted -> 504 no-store');

  // traffic proxy: the key goes only to the configured primary, never to the fallback providers
  const hosts = [];
  globalThis.fetch = async (u, o) => { hosts.push([new URL(u).hostname, o.headers.authorization, o.headers['x-api-key']]); return hosts.length < 3 ? new Response('no', { status: 429 }) : new Response(JSON.stringify({ states: [] }), { status: 200 }); };
  const res = await trafficProxy({ request: new Request('https://sim.test/api/traffic?lat=10&lon=10'), env: { TRAFFIC_API_KEY: 'sekret' } });
  assert.equal(res.status, 200);
  assert.deepEqual(hosts.map((h) => h[0]), ['api.adsb.lol', 'opendata.adsb.fi', 'opensky-network.org']);
  assert.equal(hosts[0][1], 'Bearer sekret'); assert.equal(hosts[0][2], 'sekret');
  for (const h of hosts.slice(1)) { assert.equal(h[1], undefined); assert.equal(h[2], undefined); }
  hosts.length = 0;
  await trafficProxy({ request: new Request('https://sim.test/api/traffic?lat=11&lon=11'), env: { TRAFFIC_API_KEY: '' } });
  assert.ok(hosts.every((h) => h[1] === undefined), 'no key configured: nothing sent');
  console.log('PASS traffic proxy: TRAFFIC_API_KEY only reaches the primary host');
} finally { globalThis.fetch = realFetch; }

// traffic client: backoff for every failure type, ghosts cleared, one warning per streak
const fakeScene = { add() {} }, geo = { toXZ: (la, lo) => ({ x: lo * 1e5, z: -la * 1e5 }) };
const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
try {
  const t = new Traffic(fakeScene, geo, '/'); t.group = { visible: true, remove() {}, add() {} }; let fails = 0; t.onFail = () => fails++;
  const answers = [() => new Response(JSON.stringify({ ac: [{ hex: 'a1', flight: 'TST1', lat: 1, lon: 1, alt_baro: 10000, gs: 300, track: 90, t: 'A320' }] }), { status: 200, headers: { 'cache-control': 'max-age=20' } })];
  globalThis.fetch = async () => answers[answers.length - 1]();
  await t.poll(1, 1); assert.equal(t.list.size, 1); assert.equal(t.nextPollSeconds, 20); assert.equal(t.fails, 0);
  for (const [i, make] of [() => new Response('<html>nope</html>', { status: 404 }), () => new Response('<html>ok?</html>', { status: 200 }), () => new Response('x', { status: 502 }), () => new Response('x', { status: 429 })].entries()) {
    answers.push(make); await t.poll(1, 1);
    assert.equal(t.fails, i + 1); assert.equal(t.nextPollSeconds, [30, 60, 120, 240][i], `backoff after failure ${i + 1}`);
    assert.equal(t.list.size, i + 1 >= 3 ? 0 : 1, i + 1 >= 3 ? 'ghost aircraft cleared after a failure streak' : 'kept through a short outage');
  }
  assert.equal(fails, 1, 'one onFail per streak'); assert.equal(warns.length, 1, 'one console warning per streak');
  answers.push(answers[0]); await t.poll(1, 1); assert.equal(t.fails, 0); assert.equal(t.list.size, 1); assert.equal(t.nextPollSeconds, 20);
  answers.push(() => new Response('x', { status: 500 })); await t.poll(1, 1); assert.equal(t.warned, true);
  answers.push(answers[0]); await t.poll(1, 1); assert.equal(t.warned, false, 'a good poll ends the streak');
  // stale age: no good answer for 90 s empties the list even while the next retry is still minutes away
  t.lastOk = performance.now() / 1000 - TRAFFIC_STALE_SECONDS - 1; t.t = 0; t.nextPollSeconds = 300; t.busy = true;
  t.update(0.1, { camWorld: { x: 0, y: 0, z: 0 }, lat: 1, lon: 1, night: 0, own: { x: 0, y: 0, z: 0 } });
  assert.equal(t.list.size, 0); assert.equal(t.count, 0);
  console.log('PASS traffic client: exponential backoff 30/60/120/240/300 s for 404, HTML, 5xx and 429; ghosts cleared after 3 failures or 90 s; one warning per streak');
} finally { globalThis.fetch = realFetch; console.warn = realWarn; }
