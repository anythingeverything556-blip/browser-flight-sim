import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { SECURITY_HEADERS } from '../functions/_lib/embed-policy.js';

const root = path.resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'video/webm' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/api/traffic' || url.pathname === '/api/metar') {
      response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
      response.end(url.pathname === '/api/traffic' ? '{"ac":[]}' : '[]'); return;
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403).end(); return; }
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
function terrainPng() {
  const crc = data => { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const tag = Buffer.from(name), length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(256); head.writeUInt32BE(256, 4); head[8] = 8; head[9] = 2;
  const raw = Buffer.alloc(256 * 769); for (let row = 0; row < 256; row++) for (let column = 0; column < 256; column++) raw[row * 769 + 1 + column * 3] = 128;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = terrainPng();
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu-watchdog', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  for (const aircraft of ['sr71', 'c172']) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 960, height: 640 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith(origin) || /^(data:|blob:)/.test(request.url())) request.continue().catch(() => {});
      else request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'image/png', body: png }).catch(() => {});
    });
    await page.evaluateOnNewDocument(({ origin, png }) => {
      if (!localStorage.getItem('sr71sim.settings')) localStorage.setItem('sr71sim.settings', JSON.stringify({ gfx: 'low', gfxV3: true, rscale: 0.5, dynres: false, metarAuto: false, buildings: false, trees: false, clouds: 0, traffic: false }));
      const fixture = `const nativeFetch=self.fetch;self.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,${JSON.stringify(origin)});if(url.origin===${JSON.stringify(origin)})return nativeFetch(input,options);if(url.href.endsWith('/planet'))return Promise.resolve(new Response(JSON.stringify({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf']}),{headers:{'Content-Type':'application/json'}}));if(url.pathname.endsWith('.pbf'))return Promise.resolve(new Response(new Uint8Array()));return Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}));};`;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { constructor(url, options) { if (!String(url).includes('terrain-worker')) { super(url, options); return; } const resolved = new URL(url, location.href).href; const blob = URL.createObjectURL(new Blob([fixture + `await import(${JSON.stringify(resolved)});`], { type: 'text/javascript' })); super(blob, { ...options, type: 'module' }); } };
    }, { origin, png: png.toString('base64') });
    await page.goto(`${origin}/?aircraft=${aircraft}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__simReady, { timeout: 180000 });
    await page.click('#just-fly');
    await page.waitForFunction(() => __sim.state.started && !__sim.state.pending, { timeout: 90000 });
    assert.equal(await page.evaluate(() => __sim.aircraft), aircraft);
    if (aircraft === 'sr71') {
      await page.evaluate(async () => { __sim.openSheet(null, true); await __sim.setView('orbit'); document.activeElement.blur(); const renderer = __sim.renderer, original = renderer.setSize.bind(renderer); window.resizeCalls = []; renderer.setSize = (width, height, style) => { window.resizeCalls.push([width, height, renderer.getPixelRatio()]); original(width, height, style); }; });
      await page.click('#sr71-cockpit-entry');
      await page.waitForFunction(() => __sim.rig.view === 'cockpit', { timeout: 90000 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'sr71-cockpit-entry');
      assert.deepEqual(await page.evaluate(() => window.resizeCalls), [], 'same-ratio cockpit transition does not resize');
      const changedScale = await page.evaluate(() => { const slider = document.querySelector('#rscale'); window.resizeCalls = []; slider.value = '1'; slider.dispatchEvent(new Event('input')); return { calls: window.resizeCalls, ratio: __sim.renderer.getPixelRatio(), width: __sim.renderer.domElement.width, height: __sim.renderer.domElement.height }; });
      assert.deepEqual(changedScale, { calls: [[960, 640, 1]], ratio: 1, width: 960, height: 640 }, 'graphics resolution changes resize the canvas once');
      await page.keyboard.press('KeyP');
      assert.equal(await page.evaluate(() => __sim.state.paused), true);
      await page.keyboard.press('KeyP');
      await page.keyboard.press('KeyV');
      await page.waitForFunction(() => __sim.rig.view !== 'cockpit', { timeout: 30000 });
      await page.focus('#sr71-cockpit-entry');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => __sim.rig.view === 'cockpit', { timeout: 90000 });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sr71-cockpit-entry');
      await page.keyboard.press('KeyP'); await page.keyboard.press('KeyV');
      assert.deepEqual(await page.evaluate(() => [__sim.state.paused, __sim.rig.view]), [false, 'cockpit']);
      await page.evaluate(() => document.activeElement.blur());
      await page.evaluate(() => { __sim.controls.throttle = 0.1; });
      await page.focus('#tl-track'); await page.keyboard.press('ArrowUp');
      assert.ok(await page.evaluate(() => __sim.controls.throttle > 0.1), 'focused throttle slider retains native keyboard behavior');
      await page.evaluate(() => document.activeElement.blur());
    }
    for (const key of ['PageUp', 'PageDown']) {
      const before = await page.evaluate(() => { const sim = __sim; sim.controls.throttle = 0; sim.fdm.throttle = 0; sim.fdm.parkingBrake = true; sim.state.autoPark = true; sim.state.paused = true; sim.controls.setLocked(false); sim.state.slew = true; return sim.fdm.pos.y; });
      await page.keyboard.down(key);
      const during = await page.evaluate(() => { for (let frame = 0; frame < 60; frame++) { __sim.controls.update(1 / 60, true); __sim.simulate(1 / 60); } return { alt: __sim.fdm.pos.y, throttle: __sim.controls.throttle, brake: __sim.fdm.parkingBrake }; });
      await page.keyboard.up(key);
      const after = await page.evaluate(() => { __sim.state.slew = false; __sim.controls.update(1 / 60, false); __sim.simulate(1 / 60); return { throttle: __sim.controls.throttle, power: __sim.fdm.throttle, brake: __sim.fdm.parkingBrake, autoPark: __sim.state.autoPark }; });
      if (key === 'PageUp') assert.ok(during.alt > before + 20);
      assert.equal(during.throttle, 0); assert.equal(during.brake, true);
      assert.deepEqual(after, { throttle: 0, power: 0, brake: true, autoPark: true });
    }
    if (aircraft === 'c172') {
      await page.evaluate(() => { __sim.openSheet('settings', true); document.querySelector('#keymap-box').open = true; document.querySelector('#keymap .km-add[data-id="throttleUp"]').click(); });
      await page.keyboard.down('Shift'); await page.keyboard.up('Shift');
      assert.ok(await page.evaluate(() => __sim.settings.keys.throttleUp.includes('Shift') && __sim.controls.bind.throttleUp.includes('Shift')));
      await page.evaluate(() => { __sim.openSheet(null, true); document.activeElement.blur(); __sim.controls.throttle = 0; __sim.controls.setLocked(false); });
      await page.keyboard.down('Shift');
      const immediate = await page.evaluate(() => { for (let frame = 0; frame < 60; frame++) __sim.controls.update(1 / 60, false); return __sim.controls.throttle; });
      await page.keyboard.up('Shift');
      assert.ok(immediate > 0.3, 'Shift remap works immediately');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__simReady, { timeout: 180000 });
      assert.ok(await page.evaluate(() => __sim.controls.bind.throttleUp.includes('Shift')), 'Shift remap persists after reload');
      await page.click('#just-fly');
      await page.waitForFunction(() => __sim.state.started && !__sim.state.pending, { timeout: 90000 });
      await page.evaluate(() => { document.activeElement.blur(); __sim.controls.throttle = 0; });
      await page.keyboard.down('Shift');
      const restored = await page.evaluate(() => { for (let frame = 0; frame < 60; frame++) __sim.controls.update(1 / 60, false); return __sim.controls.throttle; });
      await page.keyboard.up('Shift');
      assert.ok(restored > 0.3, 'persisted Shift remap works after reload');
    }
    assert.deepEqual(errors, []);
    console.log(`${aircraft}: browser control regressions passed`);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
