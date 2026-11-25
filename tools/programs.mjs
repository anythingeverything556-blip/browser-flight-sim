// Which shader programs are created AFTER the loading-screen warm-up? Lists renderer.info.programs before and after driving the game through
// the views and conditions a flight meets (cockpit, chase, night, storm, high altitude, gear, crash). Each new entry is a first-use hitch.
// usage: node tools/programs.mjs [url]     (software GL; use a small window, frames are slow)
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=320,180'] });
const p = await b.newPage(); await p.setViewport({ width: 320, height: 180 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
const names = () => p.evaluate(() => window.__sim.renderer.info.programs.map((q) => `${q.name} ${String(q.cacheKey).slice(0, 90)}`));
const frames = (n) => p.evaluate((n) => new Promise((res) => { let k = 0; const t = () => (++k >= n ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
// wait until the game itself is flying (physics running)
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
await frames(3);
const base = new Set(await names()); console.log('programs after warm-up and 3 flight frames:', base.size);
const steps = [
  ['cockpit view', (S) => S.setView('cockpit')], ['chase view', (S) => S.setView('chase')], ['orbit view', (S) => S.setView('orbit')],
  ['night', (S) => { S.settings.runClock = false; S.env.hour = 1; S.env.update(S.geo.toLatLon(0, 0).lat, 3000, 0, false); }],
  ['storm weather', (S) => S.applyWeather('storm')], ['rain weather', (S) => S.applyWeather('rain')], ['fog weather', (S) => S.applyWeather('fog')],
  ['high altitude 24 km', (S) => { S.fdm.pos.y = 24000; }], ['gear down', (S) => { S.fdm.gearDown = true; }], ['back to day', (S) => { S.env.hour = 14; S.applyWeather('clear'); S.fdm.pos.y = 1500; S.setView('cockpit'); }],
  ['crash', (S) => { S.fdm.crash('test', 'impact'); }],
];
let seen = new Set(base);
for (const [label, fn] of steps) {
  await p.evaluate(fn.toString().replace(/^/, 'window.__step = ') && `(${fn.toString()})(window.__sim)`).catch((e) => console.log('step error', label, String(e).slice(0, 100)));
  await frames(3);
  const now = await names(), add = now.filter((n) => !seen.has(n)); now.forEach((n) => seen.add(n));
  console.log(`${label.padEnd(20)} +${add.length}`, add.map((n) => '\n     ' + n).join(''));
}
await b.close();
