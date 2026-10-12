// Deterministic flicker test. The aircraft is frozen in the air and the camera creeps along a rail by a sub-texel, sub-pixel step per
// frame (clock, physics, clouds off), so any frame-to-frame luminance change is flicker, not motion. Each variant switches one
// component and reports the share of pixels that flipped by more than THR levels between consecutive frames.
// usage: node tools/flicker.mjs [url] [frames] [variant,variant,...]     (software GL works; it is slow)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5173/';
const N = +(process.argv.find((a) => /^\d+$/.test(a)) || 14);
const only = (process.argv.find((a) => a.includes(',') || /^[a-z]/.test(a) && !a.startsWith('http')) || '').split(',').filter(Boolean);
const W = 480, H = 270;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
await new Promise((r) => setTimeout(r, 8000));
await p.evaluate(() => {
  const S = window.__sim;
  S.settings.runClock = false; S.settings.clouds = 0; S.settings.shake = false;
  S.state.paused = true; S.setView('cockpit');
  S.fdm.pos.y += 25; S.fdm.vel.set(0, 0, 0); S.settings.rscale = 1;
  S.hud.visible = false;
  window.__frames = (n, step, mutate) => new Promise((res) => {
    const out = [], c = document.createElement('canvas'); c.width = S.renderer.domElement.width; c.height = S.renderer.domElement.height;
    const x = c.getContext('2d', { willReadFrequently: true }); const dir = new S.THREE.Vector3(1, 0, 0).applyQuaternion(S.fdm.quat);
    let k = 0; const tick = () => {
      x.drawImage(S.renderer.domElement, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, l = new Uint8Array(c.width * c.height);
      for (let i = 0; i < l.length; i++) l[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
      out.push(l); if (++k > n) return res({ out, w: c.width, h: c.height });
      if (mutate) mutate(k); S.fdm.pos.addScaledVector(dir, step); requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
});
const variants = {
  baseline: (S) => { S.shadows.forceAll = false; },
  refreshAll: (S) => { S.shadows.forceAll = true; S.shadows.every = 0; },
  noShadows: (S) => S.shadows.configure(0, 1024, []),
  noAO: (S) => { const q = { ...S.GFX.high.post, ao: 0 }; S.post.configure(q); },
  noSMAA: (S) => { const q = { ...S.GFX.high.post, smaa: false }; S.post.configure(q); },
  noMSAA: (S) => { const q = { ...S.GFX.high.post, msaa: 0 }; S.post.configure(q); },
  noBloom: (S) => { const q = { ...S.GFX.high.post, bloom: 0 }; S.post.configure(q); },
  noTrees: (S) => { S.trees.enabled = false; },
  noBuildings: (S) => { S.buildings.enabled = false; },
  noPost: (S) => { S.post.configure({ enabled: false }); },
  shadowsEvery2: (S) => { S.shadows.every = 2; },
};
const names = only.length ? only : Object.keys(variants);
const res = {};
// light, GPU-independent scene setup: highest preset so shadows, AO, SMAA and trees are all active
await p.evaluate(() => { window.__sim.applyGfx('high'); });
const settle = async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = await p.evaluate(() => { const t = window.__sim.terrain.stats; return t.imgActive + t.demActive + t.imgWait; }); if (s === 0) break; } };
await settle();
for (const name of names) {
  const src = variants[name].toString();
  await p.evaluate((src) => { window.__sim.applyGfx('high'); (0, eval)('(' + src + ')')(window.__sim); }, src);
  await new Promise((r) => setTimeout(r, 3000));
  const r = await p.evaluate(async (n) => {
    const { out, w, h } = await window.__frames(n, 0.5);
    // a blip is a pixel that jumps by more than THR and comes back the next frame: that is flicker, while motion changes a pixel once and
    // leaves it changed. (A line thinner than a pixel crossing the pixel also blips; the variants are compared with each other.)
    const THR = 12, cnt = new Uint16Array(w * h); const per = [];
    for (let f = 1; f + 1 < out.length; f++) { let blips = 0; const a = out[f - 1], m = out[f], z = out[f + 1];
      for (let i = 0; i < w * h; i++) if (Math.abs(m[i] - a[i]) > THR && Math.abs(z[i] - m[i]) > THR && Math.abs(z[i] - a[i]) < THR / 2) { blips++; cnt[i]++; } per.push(blips / (w * h)); }
    let first = 0; for (let i = 0; i < w * h; i++) first += Math.abs(out[out.length - 1][i] - out[0][i]) > THR ? 1 : 0;
    const heat = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) heat[i] = Math.min(255, (cnt[i] * 255) / (out.length - 1));
    return { per, drift: first / (w * h), w, h, heat: Array.from(heat), frame: Array.from(out[out.length - 1]) };
  }, N);
  const mean = r.per.reduce((s, v) => s + v, 0) / r.per.length;
  res[name] = { meanBlipPct: +(mean * 100).toFixed(4), maxBlipPct: +(Math.max(...r.per) * 100).toFixed(4), changedOverRun: +(r.drift * 100).toFixed(3) };
  console.log(name.padEnd(14), JSON.stringify(res[name]));
  if (name === 'baseline' || name === only[0]) { fs.writeFileSync('.scratch/flick-heat.json', JSON.stringify({ w: r.w, h: r.h, heat: r.heat, frame: r.frame })); }
}
fs.writeFileSync('.scratch/flicker-result.json', JSON.stringify(res, null, 1));
await b.close();
