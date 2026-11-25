// Network audit of the first N seconds of a page load (default 120): requests per host, duplicate URLs, bytes on the wire, cache hits.
// usage: node tools/netaudit.mjs [url] [seconds] [--start]      needs puppeteer-core and Chrome (CHROME=/path/to/chrome); software GL is fine
import puppeteer from 'puppeteer-core';
const url = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5173/';
const secs = +(process.argv.find((a) => /^\d+$/.test(a)) || 120), start = process.argv.includes('--start');
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
const c = await p.createCDPSession(); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: false });
const reqs = new Map();
c.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, range: e.request.headers.Range || e.request.headers.range || '', t: e.timestamp, type: e.type, bytes: 0, cache: false, status: 0, worker: false }));
c.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.cache = !!e.response.fromDiskCache || !!e.response.fromPrefetchCache; r.worker = !!e.response.fromServiceWorker; } });
c.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
const t0 = Date.now();
await p.goto(url, { waitUntil: 'domcontentloaded' });
if (start) { for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; } await p.click('#start-btn').catch(() => {}); }
while ((Date.now() - t0) / 1000 < secs) await new Promise((r) => setTimeout(r, 1000));
const rt = await p.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ n: e.name, ts: e.transferSize, ds: e.decodedBodySize }))).catch(() => []);
const all = [...reqs.values()].filter((r) => !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
const host = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const byHost = {}; for (const r of all) { const h = (byHost[host(r.url)] ??= { n: 0, bytes: 0, cacheHits: 0 }); h.n++; h.bytes += r.bytes; if (r.cache) h.cacheHits++; }
const key = (r) => r.url + '|' + r.range, seen = new Map(); for (const r of all) seen.set(key(r), (seen.get(key(r)) || 0) + 1);
const dups = [...seen].filter(([, n]) => n > 1);
const dupReq = dups.reduce((s, [, n]) => s + n - 1, 0);
const dupBytes = all.filter((r) => seen.get(key(r)) > 1 && !r.cache).reduce((s, r) => s + r.bytes, 0);
const zeroTransfer = rt.filter((e) => e.ts === 0 && e.ds > 0).length;
console.log(JSON.stringify({ seconds: secs, requests: all.length, totalMB: +(all.reduce((s, r) => s + r.bytes, 0) / 1e6).toFixed(2), duplicateRequests: dupReq,
  duplicateShare: +(dupReq / Math.max(1, all.length)).toFixed(3), duplicateUncachedMB: +(dupBytes / 1e6).toFixed(2), diskCacheHits: all.filter((r) => r.cache).length,
  resourceTimingZeroTransferWithBody: zeroTransfer, byHost: Object.fromEntries(Object.entries(byHost).sort((a, b) => b[1].n - a[1].n).slice(0, 12)),
  topDuplicates: dups.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}x ${k.slice(0, 140)}`) }, null, 1));
await b.close();
