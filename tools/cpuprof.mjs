// Main-thread CPU profile of N seconds of flight in a chosen view with renderer.render stubbed (JS cost only). Prints top self-time functions.
// usage: node tools/cpuprof.mjs [url] [view] [seconds] [warmup seconds]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5180/', view = 'cockpit', secs = '12', warm = '30'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
await p.evaluate((v) => { const S = window.__sim; S.setView(v); S.renderer.render = () => {}; }, view);
await new Promise((r) => setTimeout(r, +warm * 1000));
const c = await p.createCDPSession(); await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 500 }); await c.send('Profiler.start');
await p.evaluate(() => { window.__sim.perf.avg = {}; });
await new Promise((r) => setTimeout(r, +secs * 1000));
const phases = await p.evaluate(() => Object.fromEntries(Object.entries(window.__sim.perf.avg).map(([k, v]) => [k, +v.toFixed(2)])));
const { profile } = await c.send('Profiler.stop');
const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])); const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].split('?')[0]}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + dt[i]); total += dt[i]; });
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`view ${view}: ${(total / 1e6).toFixed(1)} s sampled; phases (ms/frame):`, JSON.stringify(phases)); console.log(top.join('\n'));
await b.close();
