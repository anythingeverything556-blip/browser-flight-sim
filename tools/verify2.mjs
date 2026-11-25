// 1) cockpit on the ground (depth sanity after the terrain depth change) 2) plume at the horizon with clouds 3) in-cloud rain reaches the glass (numbers)
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5188/', prefix = 'v2'] = process.argv.slice(2);
const W = 1000, H = 560;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
const frames = (n) => p.evaluate((n) => new Promise((r) => { let k = 0; const t = () => (++k >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.settings.assist = false; S.applyGfx('high'); S.openSheet(null); S.hud.visible = false; S.settings.runClock = false;
  document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none')); });
// 1. cockpit on the ground
await p.evaluate(() => { const S = window.__sim; S.setView('cockpit'); S.rig.look.pitch = -0.12; S.rig.look.yaw = 0; });
await frames(5); await p.screenshot({ path: `.scratch/${prefix}-cockpit-ground.png` }); console.log('1 cockpit ground', errs.slice(0, 3));
// 2. plume + clouds, behind and level
await p.evaluate(() => { const S = window.__sim; S.settings.clouds = 0.5; const sp = S.state.lastSpawn.s; S.spawn({ ...sp, alt: 1500, speed: 250, ground: false, gamma: 0 }, null);
  S.fdm.setEngines(1, true); S.fdm.unlimitedFuel = true; S.controls.throttle = 1; S.state.paused = false; S.setView('orbit'); Object.assign(S.rig.orbit, { az: -(sp.hdg * Math.PI) / 180, el: 0.03, dist: 26 }); });
await new Promise((r) => setTimeout(r, 8000)); await p.evaluate(() => { window.__sim.controls.throttle = 1; }); await frames(4);
await p.screenshot({ path: `.scratch/${prefix}-plume-clouds.png` }); console.log('2 plume', await p.evaluate(() => `ab ${window.__sim.fdm.engines[0].ab.toFixed(2)}`));
// 3. in-cloud droplets: force the in-cloud detector, then watch what reaches the glass
const r3 = await p.evaluate(async () => {
  const S = window.__sim; S.vclouds.densityAt = () => 0.8; S.settings.clouds = 0.6; S.setView('cockpit'); S.visual.glassWater.wet = 0;
  const out = []; for (let i = 0; i < 6; i++) { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); out.push([+S.state.cloudIn.toFixed(2), +S.visual.rainEff.toFixed(2), +S.visual.glassWater.wet.toFixed(3), S.visual.glassWater.active]); }
  return out; });
console.log('3 [cloudIn, glass rainEff, glass wet, glass active] per frame:', JSON.stringify(r3));
await p.screenshot({ path: `.scratch/${prefix}-incloud-cockpit.png` });
console.log('errors', errs.slice(0, 5)); await b.close();
