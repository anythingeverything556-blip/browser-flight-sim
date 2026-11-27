import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromeExecutable, createPage, fixtureURL, waitForEvidence, isSR71ModelRequest, listenLoopback, writeCheckpointAround } from '../tools/qa-browser-support.mjs';

test('portable Chrome discovery honors an explicit executable and fails clearly', () => {
  assert.equal(chromeExecutable({ env: { CHROME_PATH: '/custom/chrome' }, exists: p => p === '/custom/chrome' }), '/custom/chrome');
  assert.equal(chromeExecutable({ env: {}, exists: p => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
  assert.throws(() => chromeExecutable({ env: { CHROME_PATH: '/missing' }, exists: () => false }), /CHROME_PATH/);
});
test('legacy fixture URLs stay on loopback and allow ephemeral ports', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]'])
    assert.equal(new URL(fixtureURL('/test/fixture.html', `http://${host}:5987`)).port, '5987');
  assert.throws(() => fixtureURL('https://example.com/', 'http://localhost:5987'), /loopback/);
  for (const base of ['https://example.com', 'http://example.com', 'http://127.0.0.1.example.com', 'http://me:secret@localhost'])
    assert.throws(() => fixtureURL('/', base), /loopback/);
});
test('newPage preserves requested viewport through native Puppeteer', async () => {
  let actual;
  const page = { setViewport: async value => { actual = value; } };
  assert.equal(await createPage({ newPage: async () => page }, { viewport: { width: 1200, height: 800 } }), page);
  assert.deepEqual(actual, { width: 1200, height: 800 });
});
test('current SR-71 delivery routes include manifests and exclude obsolete GLB', () => {
  for (const route of ['exterior/manifest.json', 'cockpit/manifest.json', 'exterior/geometry.bin', 'cockpit/textures/panel.webp'])
    assert.equal(isSR71ModelRequest('http://127.0.0.1/models/sr71/' + route), true);
  assert.equal(isSR71ModelRequest('http://127.0.0.1/models/SR71_lod.glb'), false);
});
test('bounded evidence waits observe delayed work; timeout and real failures remain failures', async () => {
  let observed = false;
  setTimeout(() => { observed = true; }, 10);
  await waitForEvidence(() => observed, { timeout: 1000, interval: 5 });
  await assert.rejects(waitForEvidence(() => false, { timeout: 15, interval: 5, label: 'missing cockpit' }), /missing cockpit not observed/);
  await assert.rejects(waitForEvidence(() => { throw new Error('real assertion'); }), /real assertion/);
});
test('loopback fixtures bind ephemeral ports and bind failures reject cleanly', async () => {
  const server = createServer((req, res) => res.end('local fixture'));
  try {
    const origin = await listenLoopback(server);
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal(await (await fetch(origin)).text(), 'local fixture');
  } finally { await new Promise(resolve => server.close(resolve)); }
  const rejected = new EventEmitter();
  rejected.listen = (port, host) => { assert.equal(port, 0); assert.equal(host, '127.0.0.1'); queueMicrotask(() => rejected.emit('error', new Error('bind denied'))); };
  await assert.rejects(listenLoopback(rejected), /bind denied/);
  assert.equal(rejected.listenerCount('listening'), 0);
});
test('completed assertions survive a failed evidence capture; capture failure still rejects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qa-evidence-'));
  const file = path.join(directory, 'checkpoint.json');
  const state = { checks: [{ name: 'legitimate failure', passed: false }], capture: 'pending' };
  try {
    await assert.rejects(writeCheckpointAround(file, () => state, async () => {
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
      state.capture = 'failed';
      throw new Error('screenshot timeout');
    }), /screenshot timeout/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
