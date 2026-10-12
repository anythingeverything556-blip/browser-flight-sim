// One cockpit-view screenshot on the ground. usage: node tools/cockpitshot.mjs [url] [out.png]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5184/', out = '.scratch/cockpit.png'] = process.argv.slice(2);
const W = 1280, H = 720;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('normal'); S.openSheet(null); S.setView('cockpit'); S.hud.visible = false; S.fdm.setEngines(0.6, true); document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none')); S.rig.look.pitch = -0.45; S.rig.look.yaw = 0; });
await p.evaluate(() => new Promise((r) => { let k = 0; const t = () => (++k >= 4 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
await p.screenshot({ path: out }); console.log('shot', out, 'errors:', errs.slice(0, 5));
await b.close();
