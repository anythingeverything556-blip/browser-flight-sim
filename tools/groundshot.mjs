// Cockpit view on the runway after the game has started: is the ground in front of the nose drawn? usage: node tools/groundshot.mjs url out.png [waitSeconds]
import puppeteer from 'puppeteer-core';
const [url, out, wait = '20'] = process.argv.slice(2);
const W = 1000, H = 560;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('high'); S.openSheet(null); S.hud.visible = false; S.setView('cockpit'); S.rig.look.pitch = -0.12; document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none')); });
await new Promise((r) => setTimeout(r, +wait * 1000));
console.log(await p.evaluate(() => { const S = window.__sim, t = S.terrain.stats; return `tiles visible ${t.visible}, loading ${t.imgActive + t.demActive}, queued ${t.imgWait}, level at jet ${S.terrain.levelAt(S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z).lat, S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z).lon)}, onGround ${S.fdm.onGround}`; }));
await p.screenshot({ path: out }); await b.close();
