// Where does a cockpit frame go, and does the hidden-surface mask change the picture? (software GL: correctness and relative cost only)
//   node tools/cockpitcost.mjs [url] [preset=low] [WxH=960x540]
// 1. per-draw GPU time (timer queries) with the mask off and on, by group, so the cost of each part of the view is visible
// 2. the same frame drawn back to back with the mask off and on at six look angles: the number of pixels that differ (should be a few hairline
//    pixels at most, see docs in the CHANGELOG); PNGs of the last pair go to .scratch/
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/', preset = process.argv[3] || 'low', [W, H] = (process.argv[4] || '960x540').split('x').map(Number);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 3000000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
const res = await p.evaluate(async (preset) => {
  const S = window.__sim, gl = S.renderer.getContext(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), T = S.THREE;
  for (let t = 0; !S.warm.done && t < 300; t++) await sleep(1000);
  await sleep(2000); S.settings.rscale = 1; S.applyGfx(preset);
  const m = S.state.lastSpawn.meta; S.spawn(m.rwy.spawn(m.end, 'final'), m); S.state.paused = true; S.setView('cockpit'); await sleep(6000);
  const U = S.occUniforms, orig = S.post.render.bind(S.post), cv = S.renderer.domElement, w = cv.width, h = cv.height, out = { canvas: `${w}x${h}`, occluders: S.occlusion.count };
  const draw = (mask) => { let on = false; if (mask) on = S.occlusion.render(S.renderer, S.scene, S.camera); U.uOccOn.value = on ? 1 : 0; orig(S.scene, S.camera); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(cv, 0, 0); U.uOccOn.value = 0; return { c, d: x.getImageData(0, 0, w, h).data }; };
  // 1. per-draw GPU time
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (ext) {
    S.perf.gpuSection = () => {}; S.perf.gpuEnd = () => {};
    const groups = { interior: S.visual.real.interior, canopy: S.visual.real.canopy, aircraft: S.visual.model, terrain: S.terrain.group, trees: S.trees.group, buildings: S.buildings.group };
    const catOf = (o) => { for (const [k, g] of Object.entries(groups)) if (g) for (let p = o; p; p = p.parent) if (p === g) return k; return 'other'; };
    const pend = []; let open = null, inMask = false, frame = 0;
    S.scene.traverse((o) => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; const ob = o.onBeforeRender, oa = o.onAfterRender;
      o.onBeforeRender = function (...a) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); open = q; return ob.apply(this, a); };
      o.onAfterRender = function (...a) { const r = oa.apply(this, a); if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push({ o: this, q: open, f: frame, mask: inMask }); open = null; } return r; }; });
    const occRender = S.occlusion.render.bind(S.occlusion), px = new Uint8Array(4); let counting = false;
    S.post.render = (s, c) => { if (!counting) return; frame++; let on = false; if (S.occlusion.enabled) { inMask = true; on = occRender(S.renderer, s, c); inMask = false; } U.uOccOn.value = on ? 1 : 0; orig(s, c); U.uOccOn.value = 0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    // per frame totals, then the median and the best frame: a software renderer shares the CPU with everything else, so single readings jump around
    const run = async (enabled, n = 5) => {
      S.occlusion.enabled = enabled; pend.length = 0; frame = 0; counting = true; while (frame < n + 1) await sleep(100); counting = false; await sleep(400);
      const frames = {};
      for (const q of pend) { if (q.f === 0) continue; const ms = gl.getQueryParameter(q.q, gl.QUERY_RESULT) / 1e6, f = frames[q.f] || (frames[q.f] = { total: 0, mask: 0, by: {}, top: {} });
        f.total += ms; if (q.mask) { f.mask += ms; continue; } const k = catOf(q.o); f.by[k] = (f.by[k] || 0) + ms; const nm = `${k}:${q.o.name || q.o.parent?.name || q.o.type}`; f.top[nm] = (f.top[nm] || 0) + ms; }
      const list = Object.values(frames).sort((a, c) => a.total - c.total), med = list[list.length >> 1], best = list[0], r = (v) => +v.toFixed(0);
      return { frames: list.length, medianMs: r(med.total), bestMs: r(best.total), maskMs: r(best.mask), bestFrameByGroupMs: Object.fromEntries(Object.entries(best.by).map(([k, v]) => [k, r(v)])),
        bestFrameTop: Object.entries(best.top).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, v]) => `${r(v)} ms ${k}`) };
    };
    out.gpuMaskOff = await run(false); out.gpuMaskOn = await run(true);
  }
  // 2. back-to-back pixel comparison
  S.post.render = () => {}; S.occlusion.enabled = true; out.pixels = {}; out.png = {};
  for (const [k, [yaw, pitch]] of Object.entries({ fwd: [0, -0.12], left: [0.9, -0.1], right: [-0.9, -0.1], up: [0, 0.7], down: [0, -0.75], back: [2.6, -0.1] })) {
    S.rig.look.yaw = yaw; S.rig.look.pitch = pitch; await sleep(700); S.camera.updateMatrixWorld(true);
    const A = draw(false), B = draw(true); let n = 0, mx = 0;
    for (let i = 0; i < A.d.length; i += 4) { const d = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2])); if (d > 0) n++; if (d > mx) mx = d; }
    out.pixels[k] = { maskRan: B.c !== null, differing: n, ofTotal: w * h, maxLevel: mx }; out.png[k] = [A.c.toDataURL('image/png'), B.c.toDataURL('image/png')];
  }
  return out;
}, preset);
fs.mkdirSync('.scratch', { recursive: true });
for (const [k, [a, bb]] of Object.entries(res.png)) { fs.writeFileSync(`.scratch/cockpit-${k}-maskoff.png`, Buffer.from(a.split(',')[1], 'base64')); fs.writeFileSync(`.scratch/cockpit-${k}-maskon.png`, Buffer.from(bb.split(',')[1], 'base64')); }
delete res.png; console.log(JSON.stringify(res, null, 1));
await b.close();
