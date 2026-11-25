import assert from 'node:assert/strict';
import { once } from 'node:events';
process.env.RELAY_TOKEN = 'test-token';
const { server } = await import('../tools/traffic-relay.mjs');
const upstreamCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(String(input));
  if (u.hostname === 'api.adsb.lol') {
    upstreamCalls.push(u.pathname);
    return new Response(JSON.stringify({ ac: [{ hex: 'abc123', lat: 51.5, lon: -0.1, alt_baro: 30000, gs: 450, track: 90, t: 'A320' }] }), { status: 200 });
  }
  if (u.hostname === 'relay.test') return realFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
  throw new Error('unexpected fetch ' + u.href);
};
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port;
const t = async (n, f) => { await f(); console.log('PASS ', n); };

await t('relay rejects a request without the token', async () => {
  const r = await realFetch(`http://127.0.0.1:${port}/v2/point/51.5/-0.1/50`); assert.equal(r.status, 401);
});
await t('relay answers /health without a token', async () => {
  const r = await realFetch(`http://127.0.0.1:${port}/health`); assert.equal((await r.json()).ok, true);
});
await t('relay caches: two identical requests hit the upstream once', async () => {
  const before = upstreamCalls.length, h = { authorization: 'Bearer test-token' };
  const a = await (await realFetch(`http://127.0.0.1:${port}/v2/point/10.00/20.00/50`, { headers: h })).json();
  const b = await (await realFetch(`http://127.0.0.1:${port}/v2/point/10.00/20.00/50`, { headers: h })).json();
  assert.equal(a.ac.length, 1); assert.equal(b.ac.length, 1); assert.equal(upstreamCalls.length - before, 1);
});
await t('the Pages function, pointed at the relay with the key, returns aircraft', async () => {
  const mod = await import('../functions/api/traffic.js');
  const handler = mod.onRequestGet || mod.onRequest;
  const env = { TRAFFIC_PROXY_URL: 'https://relay.test', TRAFFIC_ALLOWED_HOSTS: 'relay.test', TRAFFIC_API_KEY: 'test-token' };
  const res = await handler({ request: new Request('https://sim.test/api/traffic?lat=48.86&lon=2.35&dist=54'), env, waitUntil() {} });
  const body = await res.json();
  assert.equal(res.status, 200); assert.ok(Array.isArray(body.aircraft) && body.aircraft.length === 1, JSON.stringify(body)); assert.equal(body.source, 'relay.test');
  const wrong = await handler({ request: new Request('https://sim.test/api/traffic?lat=40.7&lon=-74&dist=54'), env: { ...env, TRAFFIC_API_KEY: 'wrong' }, waitUntil() {} });
  assert.ok((await wrong.json()).error, 'a wrong key should surface as an error');
});
server.close();
console.log('all relay tests passed');
