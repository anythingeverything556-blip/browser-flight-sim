// Mach dial image, deterministic ditching, Geneva imagery with a long wait, clouds from above. usage: node tools/verify4.mjs url prefix
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://127.0.0.1:5191/', prefix = 'v4'] = process.argv.slice(2);
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
// 1. dial
const dials = await p.evaluate(() => { const S = window.__sim, c = S.visual.real.machDial, out = {}; for (const m of [0, 0.9, 1.55, 3.28]) { S.visual.real.controls.set({ mach: m }); out[m] = c.toDataURL('image/png'); } return out; });
for (const [m, d] of Object.entries(dials)) fs.writeFileSync(`.scratch/${prefix}-mach-${m}.png`, Buffer.from(d.split(',')[1], 'base64'));
console.log('1 dials ok');
// 2. deterministic ditching over the bay (KSFO)
await p.evaluate(() => { const S = window.__sim, a = S.db.get('KSFO'), r = a.runways[0]; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 }); });
for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 2500)); if (await p.evaluate(() => !window.__sim.state.pending)) break; }
await new Promise((r) => setTimeout(r, 12000));
const d = await p.evaluate(async () => {
  const S = window.__sim, p2 = S.geo.toXZ(37.66, -122.33), g = S.terrain.heightAt(37.66, -122.33) ?? 0;
  S.state.paused = false; S.state.settleUntil = 0; S.state.pending = null; S.fdm.crashed = null; S.fdm.onGround = false;
  S.fdm.pos.set(p2.x, g + 2.8, p2.z); S.fdm.vel.set(80, -1, 0);
  const res = []; for (let i = 0; i < 6 && !S.fdm.crashed; i++) { S.state.waterAt = 0; S.simulate(0.02); res.push(+S.fdm.pos.y.toFixed(2)); }
  return { crashed: S.fdm.crashed, ditch: S.state.ditch, ground: g, ys: res }; });
console.log('2 ditch fast', JSON.stringify(d));
const d2 = await p.evaluate(async () => {
  const S = window.__sim, a = S.db.get('KSFO'), r = a.runways[0]; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 });
  return 'respawned'; });
for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 2500)); if (await p.evaluate(() => !window.__sim.state.pending)) break; }
await new Promise((r) => setTimeout(r, 8000));
const d3 = await p.evaluate(async () => {   // on the runway: must NOT count as water
  const S = window.__sim; S.state.paused = false; S.state.settleUntil = 0; const res = []; for (let i = 0; i < 8 && !S.fdm.crashed; i++) { S.state.waterAt = 0; S.simulate(0.02); } return { crashedOnRunway: S.fdm.crashed, ditch: S.state.ditch }; });
console.log('2 runway control', JSON.stringify(d3));
// 3. Geneva with a long wait
await p.evaluate(() => { const S = window.__sim, a = S.db.get('LSGG'), r = a.runways[0]; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 }); });
let gs = null; const t0 = Date.now();
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 4000)); gs = await p.evaluate(() => { const S = window.__sim, t = S.terrain, srcs = {}; let maxz = 0; for (const x of t.drawn) { const k = x.imgSrc ? x.imgSrc.id : 'esri'; srcs[k] = (srcs[k] || 0) + 1; maxz = Math.max(maxz, x.z); } const ll = S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z); return { pending: !!S.state.pending, level: t.levelAt(ll.lat, ll.lon), maxz, srcs, queued: t.stats.imgWait, loading: t.stats.imgActive, status: document.getElementById('st-state').textContent }; }); if (Date.now() - t0 > 300000 || (!gs.pending && gs.level >= 15)) break; }
console.log('3 geneva', JSON.stringify(gs), 'waited s', ((Date.now() - t0) / 1000) | 0);
await p.evaluate(() => { window.__sim.setView('orbit'); Object.assign(window.__sim.rig.orbit, { el: 0.3, dist: 60 }); window.__sim.state.paused = true; }); await frames(3); await p.screenshot({ path: `.scratch/${prefix}-geneva.png` });
console.log('errors', errs.slice(0, 6)); await b.close();
