// Cockpit (Mach dial, canopy), afterburner plume from behind, and the cloud tunnel, in one session. usage: node tools/finalshots.mjs [url] [prefix]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5186/', prefix = 'final'] = process.argv.slice(2);
const W = 1000, H = 560;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
const frames = (n) => p.evaluate((n) => new Promise((r) => { let k = 0; const t = () => (++k >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('high'); S.openSheet(null); S.hud.visible = false; document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none')); });
// 1. cockpit, Mach 1.6 so the needle is visibly off zero
await p.evaluate(() => { const S = window.__sim; S.setView('cockpit'); S.rig.look.pitch = 0.1; S.rig.look.yaw = 0; const sp = S.state.lastSpawn.s; S.spawn({ ...sp, alt: 9000, speed: 480, ground: false, gamma: 0 }, null); S.fdm.setEngines(0.9, true); S.state.paused = false; });
await new Promise((r) => setTimeout(r, 4000));
await frames(6); await p.screenshot({ path: `.scratch/${prefix}-cockpit.png` }); console.log('cockpit', await p.evaluate(() => window.__sim.fdm.out.M.toFixed(2)));
// 2. afterburner plume from behind and the side
await p.evaluate(() => { const S = window.__sim; S.fdm.setEngines(1, true); S.setView('orbit'); Object.assign(S.rig.orbit, { az: Math.PI * 0.9, el: 0.1, dist: 22 }); });
await frames(8); await p.screenshot({ path: `.scratch/${prefix}-plume.png` }); console.log('plume');
console.log('errors', errs.slice(0, 5)); await b.close();
