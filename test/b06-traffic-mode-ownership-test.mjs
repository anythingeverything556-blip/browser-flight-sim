// B06: local deterministic fixtures only; deferred fetches deliberately ignore aborts.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'leaflet') return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  return next(s, c);
}`));
const { LiveAdsb } = await import('../src/adsbmap.js');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const body = (hex) => ({ aircraft: [{ hex, lat: 1, lon: 2 }], source: 'fixture', acquiredAt: Date.now() });
const response = (hex) => ({ ok: true, json: async () => body(hex) });

function live() {
  return Object.assign(Object.create(LiveAdsb.prototype), {
    mode: 'area', pollGeneration: 0, pollRequest: null, on: true, active: false,
    busy: false, next: 0, fails: 0, coverage: null, list: new Map(), trails: new Map(),
    status: { n: 0, src: '', at: 0, err: '' },
    layer: { draw() {} }, renderUi() {}, renderCard() {}, persist() {},
    url() { return { url: `/api/traffic?list=${this.mode}` }; },
  });
}

await test('B06 traffic mode ownership: stale requests cannot own a new tab or its poll schedule', async (t) => {
  const originalFetch = globalThis.fetch, originalPerformance = globalThis.performance;
  let nowMs = 100_000;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => nowMs } });
  let requests;
  const resetFetch = () => {
    requests = [];
    globalThis.fetch = (url, options) => { const d = deferred(); requests.push({ ...d, url, signal: options.signal }); return d.promise; };
  };
  try {
    await t.test('area response after Emergency switch is discarded without a 30-second delay', async () => {
      resetFetch(); const l = live(); l.active = true; l.viewOk = true;
      const pending = l.poll();
      l.setMode('emergency');
      assert.equal(requests[0].signal.aborted, true);
      requests[0].resolve(response('oldarea')); await pending;
      assert.equal(l.list.size, 0); assert.equal(l.trails.size, 0);
      assert.equal(l.coverage, null); assert.deepEqual(l.status, { n: 0, src: '', at: 0, err: '' });
      assert.equal(l.next, 0); assert.equal(l.busy, false); assert.equal(l.lastPoll, null);
      const current = l.poll(); assert.match(requests[1].url, /list=emergency$/);
      requests[1].resolve(response('emergency')); await current;
      assert.deepEqual([...l.list.keys()], ['emergency']); assert.equal(l.next, 130);
    });

    await t.test('a pending JSON body cannot overwrite the new request or clear its busy lock', async () => {
      resetFetch(); const l = live(), json = deferred(), entered = deferred(), pending = l.poll();
      requests[0].resolve({ ok: true, json() { entered.resolve(); return json.promise; } });
      await entered.promise;
      l.setMode('emergency'); const current = l.poll(), owner = l.pollRequest;
      json.resolve(body('oldarea')); await pending;
      assert.equal(l.pollRequest, owner); assert.equal(l.busy, true); assert.equal(l.next, 0);
      assert.equal(l.list.size, 0); assert.equal(l.status.at, 0);
      await l.poll(); assert.equal(requests.length, 2, 'old finally unlocked a duplicate poll');
      requests[1].resolve(response('current')); await current;
      assert.deepEqual([...l.list.keys()], ['current']); assert.equal(l.busy, false);
    });

    await t.test('old rejection cannot replace a successful current tab with an error/backoff', async () => {
      resetFetch(); const l = live(), pending = l.poll();
      l.setMode('mil'); const current = l.poll();
      requests[1].resolve(response('military')); await current;
      const status = l.status, next = l.next;
      requests[0].reject(Object.assign(new Error('cancelled old area'), { name: 'AbortError' })); await pending;
      assert.equal(l.status, status); assert.equal(l.fails, 0); assert.equal(l.next, next);
      assert.deepEqual([...l.list.keys()], ['military']);
    });

    await t.test('area to Military to area still rejects the original area generation', async () => {
      resetFetch(); const l = live(), original = l.poll();
      l.setMode('mil'); const military = l.poll();
      l.setMode('area'); const current = l.poll();
      requests[2].resolve(response('newarea')); await current;
      const status = l.status;
      requests[0].resolve(response('oldarea')); await original;
      requests[1].resolve(response('oldmil')); await military;
      assert.deepEqual([...l.list.keys()], ['newarea']); assert.equal(l.status, status);
      assert.equal(l.next, 112); assert.equal(l.busy, false);
    });

    await t.test('closed-map mode switch resets the background throttle and failure state', async () => {
      resetFetch(); const l = live(), polls = [], poll = l.poll.bind(l); l.mode = 'mil'; l.fails = 3;
      l.poll = (...args) => { const pending = poll(...args); polls.push(pending); return pending; };
      l.background(); assert.equal(l.bgNext, 130);
      l.setMode('emergency');
      assert.equal(l.bgNext, 0); assert.equal(l.fails, 0);
      l.background(); assert.equal(requests.length, 2); assert.match(requests[1].url, /emergency$/);
      requests[1].resolve(response('current')); await polls[1];
      requests[0].resolve(response('oldmil')); await polls[0];
      assert.equal(l.busy, false);
      assert.deepEqual([...l.list.keys()], ['current']); assert.equal(l.next, 130);
    });

    await t.test('same/unknown mode is a no-op and current failure still retries in three seconds', async () => {
      resetFetch(); const l = live(), pending = l.poll(), owner = l.pollRequest;
      l.setMode('area'); l.setMode('invalid');
      assert.equal(l.pollRequest, owner); assert.equal(requests[0].signal.aborted, false);
      nowMs = 101_000;
      requests[0].reject(new Error('current failure')); await pending;
      assert.equal(l.status.err, 'current failure'); assert.equal(l.fails, 1); assert.equal(l.next, 104);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance });
  }
});
