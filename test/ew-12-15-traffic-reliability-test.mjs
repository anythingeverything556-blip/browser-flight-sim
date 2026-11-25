// Deterministic EW-12–15 regressions. Every external provider is mocked; never
// contacts the deployed game or providers. Only the optional relay uses loopback.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { once } from 'node:events';
import { register } from 'node:module';
import { onRequestGet } from '../functions/api/traffic.js';
import { Traffic } from '../src/traffic.js';
import { acquiredAt, PAGES_BUDGET_MS, RELAY_BUDGET_MS, CLIENT_BUDGET_MS } from '../shared/traffic-contract.js';
const hooks = `export async function resolve(s,c,n) { if(s==='leaflet') return {url:'data:text/javascript,export default {}',shortCircuit:true}; return n(s,c); }`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const { LiveAdsb } = await import('../src/adsbmap.js');
const originalFetch = globalThis.fetch, originalWarn = console.warn, originalNow = Date.now;
const epoch = 1800000000000;
const ac = { hex: 'abc123', lat: 1, lon: 2, alt_baro: 10000, gs: 200, seen_pos: 2 };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const request = (q = 'lat=1&lon=2&dist=54', env = {}) => onRequestGet({ request: new Request(`https://fixture.invalid/api/traffic?${q}`), env, waitUntil() {} });
const fail = async () => json({ error: 'fixture outage' }, 503);
const flight = () => new Traffic({ add() {} }, { toXZ: () => ({ x: 0, z: 0 }) });
function mapClient(mode = 'mil') {
  const l = Object.create(LiveAdsb.prototype);
  Object.assign(l, { list: new Map(), trails: new Map(), status: { at: 0, err: '' }, mode, fails: 0, busy: false,
    active: false, o: {}, coverage: null, layer: { draw() {} }, renderUi() {} });
  return l;
}
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
let checks = 0;
async function test(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
console.warn = () => {};
try {
  await test('EW-12: failures are no-store 502, not empty 200; successful empty data stays valid', async () => {
    globalThis.fetch = fail;
    for (const kind of ['mil', 'emergency', 'ladd', 'pia']) {
      const r = await request(`list=${kind}`); assert.equal(r.status, 502); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.ok((await r.json()).error);
    }
    globalThis.fetch = async () => json({ ac: [] });
    const r = await request('list=mil'); assert.equal(r.status, 200); const b = await r.json(); assert.deepEqual(b.aircraft, []); assert.equal(b.partial, false);
    globalThis.fetch = async () => json({ bad: [] }); assert.equal((await request('list=mil')).status, 502);
  });
  await test('EW-12: missing emergency categories are explicitly partial and not cached', async () => {
    globalThis.fetch = async (u) => String(u).endsWith('7700') ? json({ ac: [ac] }) : fail();
    const r = await request('list=emergency'), b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.partial, true); assert.equal(b.aircraft.length, 1);
    assert.deepEqual(b.missing, ['/v2/sqk/7600', '/v2/sqk/7500']); assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  await test('EW-13: merged emergency caches retain each component observation age', async () => {
    const now = Date.now();
    globalThis.fetch = async (u) => String(u).endsWith('7700')
      ? json({ ac: [{ ...ac, hex: 'old' }], acquiredAt: now - 70000 })
      : json({ ac: [{ ...ac, hex: 'new' }], acquiredAt: now });
    const b = await (await request('list=emergency')).json();
    assert.equal(b.acquiredAt, now);
    assert.equal(b.aircraft.find((a) => a.hex === 'old').seen_pos, 72);
    assert.equal(b.aircraft.find((a) => a.hex === 'new').seen_pos, 2);
  });
  await test('EW-12: map retains previous worldwide picture on failure and partial responses', async () => {
    const l = mapClient(); globalThis.fetch = async () => json({ aircraft: [ac] }); await l.poll();
    globalThis.fetch = fail; await l.poll(); assert.equal(l.list.size, 1); assert.match(l.status.err, /error 503/);
    globalThis.fetch = async () => json({ aircraft: [], partial: true }); await l.poll(); assert.equal(l.list.size, 1); assert.equal(l.status.partial, true);
    // Exercise the real status renderer, including the no-emergencies wording.
    l.mode = 'emergency'; l.list.clear(); l.on = true;
    const toggle = { toggle() {} }; l.onBtn = { classList: toggle, setAttribute() {} };
    l.box = { classList: toggle, querySelectorAll: () => [] }; l.legend = {}; l.stat = {}; l.hits = {}; l.query = '';
    LiveAdsb.prototype.renderUi.call(l); assert.match(l.stat.textContent, /partial/); assert.doesNotMatch(l.stat.textContent, /No emergency/);
  });
  await test('EW-13: acquisition contract rejects unknown stale age and malformed/future clocks', async () => {
    assert.equal(acquiredAt({ stale: true }, epoch), null);
    assert.equal(acquiredAt({ acquiredAt: 'bad' }, epoch), null);
    assert.equal(acquiredAt({ acquiredAt: epoch + 60000 }, epoch), null);
    assert.equal(acquiredAt({ now: epoch / 1000 - 70 }, epoch), epoch - 70000);
  });
  await test('EW-13: edge propagates relay stale/acquiredAt without refreshing cache', async () => {
    const puts = []; globalThis.caches = { default: { match: async () => null, put: async (k) => puts.push(k.url) } };
    const stamp = Date.now() - 60000;
    globalThis.fetch = async () => json({ ac: [ac], stale: true, acquiredAt: stamp });
    const r = await request('lat=1&lon=2', { TRAFFIC_PROXY_URL: 'https://relay.fixture', TRAFFIC_ALLOWED_HOSTS: 'relay.fixture' });
    const b = await r.json(); assert.equal(b.stale, true); assert.equal(b.acquiredAt, stamp); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.deepEqual(puts, []);
    delete globalThis.caches;
  });
  await test('EW-13: edge stale fallback preserves original snapshot age', async () => {
    const store = new Map(); globalThis.caches = { default: { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, r.clone()); } } };
    globalThis.fetch = async () => json({ ac: [ac], acquiredAt: Date.now() - 60000 });
    const first = await (await request()).json(); await flush();
    for (const k of store.keys()) if (!k.endsWith('/stale')) store.delete(k);
    globalThis.fetch = fail;
    for (let i = 0; i < 2; i++) { const b = await (await request()).json(); assert.equal(b.stale, true); assert.equal(b.acquiredAt, first.acquiredAt); }
    delete globalThis.caches;
  });
  await test('EW-13: repeated stale deliveries cannot refresh 3-D recovery or map observation age', async () => {
    const stamp = Date.now() - 60000, t = flight(), l = mapClient();
    globalThis.fetch = async () => json({ aircraft: [ac], acquiredAt: stamp }); await t.poll(1, 2); await l.poll();
    const lastOk = t.lastOk, mapAt = l.list.get(ac.hex).at;
    t.fails = 1;
    globalThis.fetch = async () => json({ aircraft: [ac], acquiredAt: stamp, stale: true });
    await t.poll(1, 2); await l.poll(); assert.equal(t.lastOk, lastOk); assert.equal(t.fails, 2);
    assert.ok(Math.abs(l.list.get(ac.hex).at - mapAt) < 0.02); assert.equal(l.status.at, stamp);
    globalThis.fetch = async () => json({ aircraft: [ac], acquiredAt: Date.now() - 91000, stale: true });
    await t.poll(1, 2); await l.poll(); assert.equal(t.list.size, 0); assert.match(l.status.err, /expired/);
    const e = l.list.get(ac.hex); e.at = performance.now() / 1000 - 91; l.prune(); assert.equal(l.list.size, 0);
    // Old per-aircraft positions cannot be made fresh by a current envelope.
    globalThis.fetch = async () => json({ aircraft: [{ ...ac, seen_pos: 200 }], acquiredAt: Date.now() });
    await t.poll(1, 2); await l.poll(); assert.equal(t.list.size, 0); assert.equal(l.list.size, 0);
  });
  await test('EW-14: late area fallback completes inside both client deadlines (virtual time)', async () => {
    assert.ok(RELAY_BUDGET_MS < PAGES_BUDGET_MS && PAGES_BUDGET_MS < CLIENT_BUDGET_MS);
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
    try {
      const t = flight(), l = mapClient('area'), calls = [];
      l.url = () => ({ url: '/api/traffic?lat=1&lon=2&dist=54' });
      globalThis.fetch = (u) => {
        if (String(u).startsWith('/api/traffic')) return onRequestGet({ request: new Request('https://fixture.invalid' + u) });
        calls.push(String(u));
        return String(u).includes('opensky') ? Promise.resolve(json({ states: [], time: Date.now() / 1000 })) : new Promise(() => {});
      };
      const job = t.poll(1, 2); await flush(); mock.timers.tick(2167); await flush(); mock.timers.tick(2167); await flush(); await job;
      assert.equal(calls.length, 3); assert.equal(t.fails, 0); assert.ok(Date.now() - epoch < CLIENT_BUDGET_MS);
      const started = Date.now(), mapJob = l.poll(); await flush(); mock.timers.tick(2167); await flush(); mock.timers.tick(2167); await flush(); await mapJob;
      assert.equal(calls.length, 6); assert.equal(l.fails, 0); assert.ok(Date.now() - started < CLIENT_BUDGET_MS);
    } finally { mock.timers.reset(); }
  });
  await test('EW-14: hung emergency categories share one total server budget (virtual time)', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
    try {
      let calls = 0; globalThis.fetch = () => { calls++; return new Promise(() => {}); };
      const job = request('list=emergency'); await flush(); mock.timers.tick(3250); await flush(); mock.timers.tick(3250); await flush();
      const r = await job; assert.equal(r.status, 502); assert.equal(calls, 6); assert.equal(Date.now() - epoch, PAGES_BUDGET_MS);
    } finally { mock.timers.reset(); }
  });
  await test('EW-15: relay forwards 250 NM and every authenticated worldwide route; cached age survives outage', async () => {
    process.env.RELAY_TOKEN = 'ew-fixture-token';
    const { server } = await import('../tools/traffic-relay.mjs');
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port, upstreamCalls = [];
    let now = epoch, outage = false; Date.now = () => now;
    globalThis.fetch = (input, init) => {
      const u = new URL(String(input));
      if (u.hostname === 'relay.fixture') return originalFetch(`http://127.0.0.1:${port}${u.pathname}`, init);
      assert.ok(['api.adsb.lol', 'opendata.adsb.fi'].includes(u.hostname), 'no real external fetch');
      upstreamCalls.push(u.href); return outage ? fail() : Promise.resolve(json({ ac: [ac], now: now / 1000 }));
    };
    const env = { TRAFFIC_PROXY_URL: 'https://relay.fixture', TRAFFIC_ALLOWED_HOSTS: 'relay.fixture', TRAFFIC_API_KEY: 'ew-fixture-token' };
    try {
      const a = await (await request('lat=1&lon=2&dist=250', env)).json();
      assert.equal(a.aircraft.length, 1); assert.match(upstreamCalls[0], /\/250$/); assert.equal(a.acquiredAt, epoch);
      for (const list of ['mil', 'emergency', 'ladd', 'pia']) {
        const r = await request(`list=${list}`, env); assert.equal(r.status, 200, list); assert.equal((await r.json()).partial, false);
      }
      for (const path of ['/v2/mil', '/v2/ladd', '/v2/pia', '/v2/sqk/7700', '/v2/sqk/7600', '/v2/sqk/7500']) {
        assert.ok(upstreamCalls.some((u) => u.endsWith(path)), path);
        assert.equal((await originalFetch(`http://127.0.0.1:${port}${path}`)).status, 401);
      }
      now += 20000; outage = true;
      const stale = await (await request('lat=1&lon=2&dist=250', env)).json(); assert.equal(stale.stale, true); assert.equal(stale.acquiredAt, epoch);
      now += 20000;
      const again = await (await request('lat=1&lon=2&dist=250', env)).json(); assert.equal(again.acquiredAt, epoch);
    } finally { Date.now = originalNow; server.closeAllConnections(); await new Promise((r) => server.close(r)); }
  });
  await test('EW-14/15: relay fallback and all-hung paths respect one 3-second budget (virtual time)', async () => {
    const { fetchUpstream } = await import('../tools/traffic-relay.mjs');
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
    try {
      const calls = [];
      globalThis.fetch = (u) => {
        calls.push(String(u));
        return String(u).includes('opendata.adsb.fi') ? Promise.resolve(json({ ac: [], now: Date.now() / 1000 })) : new Promise(() => {});
      };
      const job = fetchUpstream('/v2/point/4/5/250'); await flush(); mock.timers.tick(1500); await flush();
      const b = await job; assert.equal(b.source, 'adsb.fi'); assert.match(calls[1], /api\/v2\/lat\/4\/lon\/5\/dist\/250$/);
      globalThis.fetch = () => new Promise(() => {});
      const started = Date.now(), rejected = assert.rejects(fetchUpstream('/v2/mil'));
      await flush(); mock.timers.tick(1500); await flush(); mock.timers.tick(1500); await flush(); await rejected;
      assert.equal(Date.now() - started, RELAY_BUDGET_MS);
    } finally { mock.timers.reset(); }
  });

} finally { globalThis.fetch = originalFetch; console.warn = originalWarn; Date.now = originalNow; delete globalThis.caches; mock.timers.reset(); }
console.log(`${checks} EW-12–15 reliability regressions passed`);
