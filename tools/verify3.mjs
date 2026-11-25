// Combined check: Mach dial, Geneva source + ground readiness, water detection and ditching, plume over the horizon, clouds. usage: node tools/verify3.mjs url prefix
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://127.0.0.1:5190/', prefix = 'v3'] = process.argv.slice(2);
const W = 1000, H = 560;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
const frames = (n) => p.evaluate((n) => new Promise((r) => { let k = 0; const t = () => (++k >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('normal'); S.openSheet(null); S.hud.visible = false; S.settings.runClock = false; document.querySelectorAll('#rail, #strip, #toasts, #radio, #guide, #loadscreen, #dock, #throttle-lever').forEach((e) => (e.style.display = 'none')); });
// 1. Mach dial at three Machs (read straight from the dial canvas)
const dials = await p.evaluate(() => { const S = window.__sim, c = S.visual.real.machDial, out = {}; for (const m of [0, 1.55, 3.28]) { S.visual.real.controls.set({ mach: m }); out[m] = c.toDataURL('image/png'); } return out; });
for (const [m, d] of Object.entries(dials)) fs.writeFileSync(`.scratch/${prefix}-mach-${m}.png`, Buffer.from(d.split(',')[1], 'base64'));
console.log('1 mach dials written', Object.keys(dials), 'distinct:', new Set(Object.values(dials)).size);
// 2. Geneva: which imagery source is used near the airport, ground readiness
await p.evaluate(() => { const S = window.__sim, a = S.db.get('LSGG'); S.state.started = true; const r = a.runways[0]; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 }); });
let gs = null; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 2500)); gs = await p.evaluate(() => { const S = window.__sim, t = S.terrain, srcs = {}; for (const x of t.drawn) { const k = x.imgSrc ? x.imgSrc.id : 'esri'; srcs[k] = (srcs[k] || 0) + 1; } const ll = S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z); return { pending: !!S.state.pending, level: t.levelAt(ll.lat, ll.lon), srcs, queued: t.stats.imgWait, loading: t.stats.imgActive, status: document.getElementById('st-state').textContent }; }); if (!gs.pending) break; }
console.log('2 geneva', JSON.stringify(gs));
await p.evaluate(() => { window.__sim.setView('orbit'); window.__sim.state.paused = true; }); await frames(3); await p.screenshot({ path: `.scratch/${prefix}-geneva.png` });
// 3. Water: San Francisco bay next to KSFO
await p.evaluate(() => { const S = window.__sim, a = S.db.get('KSFO'); S.state.paused = false; const r = a.runways[0]; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 }); });
for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 2500)); if (await p.evaluate(() => !window.__sim.state.pending)) break; }
await new Promise((r) => setTimeout(r, 15000));
const w = await p.evaluate(() => { const T = window.__sim.terrain; return { bay: T.waterAt(37.66, -122.33), bayFar: T.waterAt(37.55, -122.2), runway: T.waterAt(37.6213, -122.379), city: T.waterAt(37.78, -122.42), ocean: T.waterAt(37.6, -122.75) }; });
console.log('3 waterAt', JSON.stringify(w));
const d = await p.evaluate(async () => { // fly a slow, low jet into the bay
  const S = window.__sim, ll0 = S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z), p2 = S.geo.toXZ(37.66, -122.33);
  S.fdm.pos.set(p2.x, 8, p2.z); S.fdm.vel.set(60, -3, 0); S.state.settleUntil = 0; S.state.pending = null; S.state.paused = false; S.fdm.onGround = false;
  for (let i = 0; i < 40 && !S.fdm.crashed; i++) await new Promise((r) => setTimeout(r, 400));
  return { crashed: S.fdm.crashed, ditch: S.state.ditch }; });
console.log('3 ditch', JSON.stringify(d));
// 4. plume at the horizon with AO on/off (numbers: mean brightness of the plume area over ground vs over sky)
await p.evaluate(() => { const S = window.__sim; S.state.paused = false; const sp = S.state.lastSpawn.s; S.spawn({ ...sp, alt: 1500, speed: 250, ground: false, gamma: 0 }, null); S.fdm.setEngines(1, true); S.fdm.unlimitedFuel = true; S.controls.throttle = 1; S.settings.clouds = 0.5; S.setView('orbit'); Object.assign(S.rig.orbit, { az: -(sp.hdg * Math.PI) / 180, el: 0.03, dist: 26 }); });
await new Promise((r) => setTimeout(r, 9000)); await p.evaluate(() => { window.__sim.controls.throttle = 1; }); await frames(4);
await p.screenshot({ path: `.scratch/${prefix}-plume.png` });
console.log('4 plume ab', await p.evaluate(() => window.__sim.fdm.engines[0].ab.toFixed(2)));
console.log('errors', errs.slice(0, 6)); await b.close();
