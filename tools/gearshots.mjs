// Gear close-ups from several angles on the ground (orbit camera). usage: node tools/gearshots.mjs [url] [prefix]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5184/', prefix = 'gearA'] = process.argv.slice(2);
const W = 800, H = 450;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('normal'); S.state.paused = true; S.setView('orbit'); S.openSheet(null); document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock').forEach((e) => (e.style.display = 'none')); S.hud.visible = false; });
const shots = [['front34', 2.6, 0.12, 9], ['side', 1.571, 0.05, 8], ['rear34', 0.6, 0.15, 9], ['under', 1.2, -0.45, 7], ['mainclose', 1.9, 0.08, 4.2]];
for (const [name, az, el, dist] of shots) {
  await p.evaluate((az, el, dist) => { const S = window.__sim; Object.assign(S.rig.orbit, { az, el, dist }); }, az, el, dist);
  await p.evaluate(() => new Promise((r) => { let k = 0; const t = () => (++k >= 3 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  await p.screenshot({ path: `.scratch/${prefix}-${name}.png` }); console.log('shot', name);
}
await b.close();
