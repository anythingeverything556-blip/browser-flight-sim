// B01/B11: execute the real layer constructors, queues and handlers with a controllable worker/clock.
import assert from 'node:assert/strict';
import * as THREE from 'three';

const context = new Proxy({}, { get: () => () => ({}) });
globalThis.OffscreenCanvas = class { getContext() { return context; } };
globalThis.document = { createElement: () => ({ getContext: () => context }) };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 2 }, configurable: true });
let now = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
class FakeWorker {
  static made = [];
  static attempts = 0;
  static constructorError = false;
  static postError = false;
  constructor(url) {
    FakeWorker.attempts++;
    if (FakeWorker.constructorError) throw new Error('Worker denied');
    this.url = url;
    this.posts = [];
    FakeWorker.made.push(this);
  }
  postMessage(message, transfer) {
    assert.ok(!this.terminated, 'a dead worker is never reused');
    if (FakeWorker.postError) throw new Error('structured clone failed');
    this.posts.push({ message, transfer });
  }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage({ data }); }
  fail(kind = 'onerror') { this[kind]({ message: 'terminal failure', preventDefault() {} }); }
}
globalThis.Worker = FakeWorker;
const { Buildings } = await import('../src/buildings.js');
const { Trees } = await import('../src/trees.js');
const warnings = [];
const warn = console.warn;
console.warn = (...args) => warnings.push(args);
let cases = 0;
function test(name, run) {
  now = 1000;
  FakeWorker.made = [];
  FakeWorker.attempts = 0;
  FakeWorker.constructorError = FakeWorker.postError = false;
  run();
  cases++;
  console.log('PASS', name);
}
function layerOf(Type) {
  const terrain = { stats: { imgWait: 0 }, heightAt: () => 0 };
  const layer = new Type(new THREE.Scene(), {}, terrain, { ready: true, near: () => [] });
  return layer;
}
function enqueue(layer, key = 'a') {
  const job = {
    key, state: 'queued', dist: 0, retryAt: 0, W: 100, H: 100, clat: 0, clon: 0,
    buf: new ArrayBuffer(8), imgs: new Array(16).fill(null), vtEntry: { buf: null }, meshes: [],
  };
  (layer.tiles || layer.chunks).set(key, job);
  layer.jobs.push(job);
  return job;
}
for (const Type of [Buildings, Trees]) {
  const name = Type.name;
  test(`${name}: startup, disabled and high-altitude updates construct no workers`, () => {
    FakeWorker.constructorError = true;
    const layer = layerOf(Type);
    layer.enabled = false;
    layer.update(new THREE.Vector3(), 0, 0, 0);
    layer.enabled = true;
    layer.update(new THREE.Vector3(), 0, 0, 1e4);
    assert.equal(FakeWorker.attempts, 0);
  });
  test(`${name}: constructor failure is caught, backed off and bounded`, () => {
    const layer = layerOf(Type);
    FakeWorker.constructorError = true;
    layer._pump();
    assert.equal(FakeWorker.attempts, 1);
    for (let i = 0; i < 10; i++) layer._pump();
    assert.equal(FakeWorker.attempts, 1, 'no per-frame respawn');
    for (let i = 0; i < 10; i++) { now += 1e5; layer._pump(); }
    assert.equal(FakeWorker.attempts, 3);
    assert.equal(layer.workers[0].retryAt, Infinity);
  });
  test(`${name}: a temporary construction failure recovers on a new worker`, () => {
    const layer = layerOf(Type);
    FakeWorker.constructorError = true;
    layer._pump();
    FakeWorker.constructorError = false;
    now += 1e5;
    const job = enqueue(layer);
    layer._pump();
    const slot = layer.workers[0];
    slot.w.reply({ id: slot.id, count: 0 });
    assert.equal(job.state, 'ready');
    assert.equal(slot.failures, 0);
  });
  for (const kind of ['onerror', 'onmessageerror']) {
    test(`${name}: ${kind} retires the worker; replacement ignores stale output`, () => {
      const layer = layerOf(Type), job = enqueue(layer);
      layer._pump();
      const slot = layer.workers[0], dead = slot.w, oldReply = dead.onmessage, oldId = slot.id;
      dead.fail(kind);
      assert.ok(dead.terminated);
      assert.equal(slot.w, null);
      assert.equal(slot.busy, null);
      assert.equal(job.state, 'failed');
      assert.ok(Number.isFinite(job.retryAt));
      now += 1e5;
      const next = enqueue(layer, 'b');
      // Keep the failed fixture out of the network retry path; a real retry re-fetches its transferred inputs.
      job.retryAt = Infinity;
      layer._pump();
      assert.notEqual(slot.w, dead);
      assert.equal(slot.busy, next);
      oldReply({ data: { id: oldId, count: 0 } });
      slot.w.reply({ id: oldId, count: 0 });
      assert.equal(slot.busy, next, 'old/wrong job ids cannot release new ownership');
      slot.w.reply({ id: slot.id, count: 0 });
      assert.equal(next.state, 'ready');
      assert.equal(slot.busy, null);
    });
  }
  test(`${name}: synchronous post failure does not leave decoding ownership`, () => {
    const layer = layerOf(Type), job = enqueue(layer);
    FakeWorker.postError = true;
    layer._pump();
    assert.equal(job.state, 'failed');
    assert.equal(layer.workers[0].busy, null);
    assert.ok(FakeWorker.made[0].terminated);
  });
  test(`${name}: hung work times out even above the scenery ceiling`, () => {
    const layer = layerOf(Type), job = enqueue(layer);
    layer._pump();
    const worker = layer.workers[0].w;
    now += 31e3;
    layer.update(new THREE.Vector3(), 0, 0, 1e4);
    assert.ok(worker.terminated);
    assert.equal(job.state, 'failed');
    assert.equal(layer.workers[0].busy, null);
  });
  test(`${name}: clear cancels in-flight and queued work and ignores late replies`, () => {
    const layer = layerOf(Type), job = enqueue(layer);
    layer._pump();
    const worker = layer.workers[0].w, late = worker.onmessage, id = layer.workers[0].id;
    enqueue(layer, 'b');
    layer.clear();
    late({ data: { id, count: 0 } });
    assert.equal(job.state, 'disposed');
    assert.equal((layer.tiles || layer.chunks).size, 0);
    assert.equal(layer.jobs.length, 0);
    assert.equal(layer.workers[0].busy, null);
    assert.ok(worker.terminated);
  });
  test(`${name}: a crashed job retries through the real queue with fresh inputs`, () => {
    const layer = layerOf(Type), job = enqueue(layer);
    layer._pump();
    const dead = layer.workers[0].w;
    dead.fail();
    layer._pump();
    assert.equal(FakeWorker.attempts, 1, 'retry waits for backoff');
    now += 21e3;
    if (Type === Buildings) {
      layer._fetch = (tile) => {
        layer.fetching--;
        tile.buf = new ArrayBuffer(8);
        tile.state = 'queued';
        layer.jobs.push(tile);
      };
    } else {
      // Keep external imagery/network deterministic, but use the real loading-to-queued path.
      layer.maxImg = 0;
      layer._vector = () => ({ buf: null });
    }
    layer._pump();
    if (Type === Trees) {
      assert.equal(job.state, 'loading');
      job.todo = [];
      job.pending = 0;
      layer._pump();
    }
    const slot = layer.workers[0];
    assert.equal(slot.busy, job);
    assert.notEqual(slot.w, dead);
    slot.w.reply({ id: slot.id, count: 0 });
    assert.equal(job.state, 'ready');
    assert.equal(slot.busy, null);
  });
  test(`${name}: repeated decode errors exhaust the per-job retry budget`, () => {
    const layer = layerOf(Type), job = enqueue(layer);
    for (let i = 0; i < 3; i++) {
      job.state = 'queued';
      job.buf = new ArrayBuffer(8);
      job.imgs = new Array(16).fill(null);
      if (i) layer.jobs.push(job);
      layer._pump();
      const slot = layer.workers[0];
      slot.w.reply({ id: slot.id, error: 'bad tile' });
      assert.equal(slot.busy, null);
    }
    assert.equal(job.decodeFailures, 3);
    assert.equal(job.retryAt, Infinity);
  });
  test(`${name}: repeated terminal replacement failures exhaust the pool budget`, () => {
    const layer = layerOf(Type);
    for (let i = 0; i < 3; i++) {
      layer._ensureWorkers();
      layer.workers[0].w.fail();
      now += 1e5;
    }
    for (let i = 0; i < 5; i++) { layer._ensureWorkers(); now += 1e5; }
    assert.equal(FakeWorker.attempts, 3);
    assert.equal(layer.workers[0].w, null);
  });
}
test('building imagery: facade construction failures are optional and bounded', () => {
  const layer = layerOf(Buildings);
  FakeWorker.constructorError = true;
  for (let i = 0; i < 10; i++) { layer._imgPump(); now += 1e5; }
  assert.equal(FakeWorker.attempts, 3);
  assert.equal(layer.facReady, false);
});
function facades(worker) {
  worker.reply({ type: 'facades', alb: new Uint8Array(4), dat: new Uint8Array(4) });
}
test('building imagery: facade startup timeout and stale generation are isolated', () => {
  const layer = layerOf(Buildings);
  layer._imgPump();
  const dead = layer.imgWorker, late = dead.onmessage;
  now += 31e3;
  layer._checkWorkers();
  assert.ok(dead.terminated);
  now += 21e3;
  layer._imgPump();
  const current = layer.imgWorker;
  late({ data: { type: 'facades', alb: new Uint8Array(4), dat: new Uint8Array(4) } });
  assert.equal(layer.facReady, false);
  facades(current);
  assert.equal(layer.facReady, true);
  assert.equal(layer.imgDeadline, 0);
});
test('building imagery: atlas crash, stale bitmap, replacement, abort and timeout', () => {
  const layer = layerOf(Buildings);
  layer._imgPump(); facades(layer.imgWorker);
  const tile = { key: 'roof', state: 'ready', mesh: {}, dist: 0, imgRetry: 0, x: 0, y: 0 };
  layer.tiles.set(tile.key, tile);
  layer._imgPump();
  const dead = layer.imgWorker, late = dead.onmessage;
  assert.equal(dead.posts.at(-1).message.type, 'atlas');
  dead.fail();
  assert.equal(layer.imgJob, null);
  assert.ok(tile.imgRetry > now);
  now += 21e3; layer._imgPump();
  const current = layer.imgWorker;
  assert.notEqual(current, dead);
  assert.equal(current.posts[0].message.type, 'atlas', 'valid facades are reused');
  let closed = false;
  late({ data: { type: 'atlas', bitmap: { close() { closed = true; } } } });
  assert.ok(closed);
  assert.ok(layer.imgJob);
  const id = layer.imgJob.id;
  layer._abortImg();
  assert.deepEqual(current.posts.at(-1).message, { type: 'abort', id });
  current.reply({ type: 'atlas', id, aborted: true });
  assert.equal(layer.imgJob, null);
  layer._imgPump();
  now += 46e3; layer._checkWorkers();
  assert.ok(current.terminated);
  assert.equal(layer.imgJob, null);
});
test('building imagery: synchronous facade/atlas sends fail safely', () => {
  const layer = layerOf(Buildings);
  FakeWorker.postError = true;
  layer._imgPump();
  assert.equal(layer.imgWorker, null);
  FakeWorker.postError = false;
  now += 21e3; layer._imgPump(); facades(layer.imgWorker);
  layer.tiles.set('roof', { key: 'roof', state: 'ready', mesh: {}, dist: 0, imgRetry: 0 });
  FakeWorker.postError = true;
  layer._imgPump();
  assert.equal(layer.imgJob, null);
  assert.equal(layer.imgWorker, null);
});
console.warn = warn;
console.log(`${cases} focused scenery-worker regressions passed (${warnings.length} injected errors handled)`);
