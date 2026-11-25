// Afterburner plume at the horizon, from behind and slightly above, with the volumetric clouds on and off (F7 switch), same frame otherwise.
// usage: node tools/plumeshots.mjs [url] [prefix]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5187/', prefix = 'plume'] = process.argv.slice(2);
const W = 1000, H = 560;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
const frames = (n) => p.evaluate((n) => new Promise((r) => { let k = 0; const t = () => (++k >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => {
  const S = window.__sim; S.settings.rscale = 1; S.settings.assist = false; S.applyGfx('high'); S.openSheet(null); S.hud.visible = false;
  document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none'));
  S.settings.runClock = false; S.settings.clouds = 0.5;
  const sp = S.state.lastSpawn.s; S.spawn({ ...sp, alt: 1500, speed: 250, ground: false, gamma: 0 }, null);
  S.fdm.setEngines(1, true); S.fdm.unlimitedFuel = true; S.state.paused = false;
  S.setView('orbit'); Object.assign(S.rig.orbit, { az: -(sp.hdg * Math.PI) / 180, el: 0.03, dist: 26 });
});
await p.evaluate(() => { window.__sim.controls.throttle = 1; });
await new Promise((r) => setTimeout(r, 8000)); await frames(4);
for (const el of [0.03, -0.025]) {
  await p.evaluate((el) => { const S = window.__sim; S.controls.throttle = 1; S.post.dbg.clouds = false; S.rig.orbit.el = el; }, el); await frames(3);
  console.log(await p.evaluate(() => { const S = window.__sim, e = S.fdm.engines[0]; return `ab ${e.ab.toFixed(2)} thr ${S.fdm.throttle.toFixed(2)} M ${S.fdm.out.M.toFixed(2)} clouds ${!!S.post.clouds}`; }));
  await p.screenshot({ path: `.scratch/${prefix}-el${el}-on.png` });
  await p.evaluate(() => { window.__sim.post.dbg.clouds = true; window.__sim.controls.throttle = 1; }); await frames(3);
  await p.screenshot({ path: `.scratch/${prefix}-el${el}-off.png` });
}
console.log('done', errs.slice(0, 3));
await b.close();
