// Overdraw census of the cockpit view: every drawn mesh is replaced by a faint additive constant colour with depth test off, so the
// brightness of a pixel is the number of surfaces drawn over it (what a shader-heavy fragment cost multiplies by). Software GL is fine.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const W = 960, H = 540;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn'); await new Promise((r) => setTimeout(r, 10000));
const res = await p.evaluate(async () => {
  const S = window.__sim, T = S.THREE; S.state.paused = true; S.setView('cockpit'); S.applyGfx('low');
  await new Promise((r) => setTimeout(r, 6000));
  const render0 = S.renderer.render.bind(S.renderer); const cv = S.renderer.domElement;
  const mat = new T.MeshBasicMaterial({ color: 0x050505, blending: T.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: T.DoubleSide, fog: false });
  const measure = (label) => {
    const bg = S.scene.background, ov = S.scene.overrideMaterial; S.scene.background = null; S.scene.overrideMaterial = mat;
    const hid = [S.terrain.group, S.buildings.group, S.trees.group].filter(Boolean); const was = hid.map((g) => g.visible); hid.forEach((g) => (g.visible = false));
    S.renderer.setRenderTarget(null); S.renderer.setClearColor(0x000000, 1); render0(S.scene, S.camera);
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(cv, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0, cov = 0, mx = 0; const n = c.width * c.height, hist = new Array(8).fill(0);
    for (let i = 0; i < n; i++) { const v = d[i * 4] / 5; if (v > 0.5) { cov++; sum += v; mx = Math.max(mx, v); hist[Math.min(7, Math.floor(v / 4))]++; } }
    S.scene.background = bg; S.scene.overrideMaterial = ov; hid.forEach((g, i) => (g.visible = was[i]));
    return { label, coveredPct: +(100 * cov / n).toFixed(1), meanLayersWhereCovered: +(sum / Math.max(1, cov)).toFixed(1), meanLayersPerPixel: +(sum / n).toFixed(1), max: Math.round(mx), hist4: hist, png: c.toDataURL('image/png') };
  };
  const out = [];
  S.renderer.render = () => {}; // stop the game's own rendering while measuring
  const v = S.visual; const grp = { 'rebuilt interior': v.real.interior, 'rebuilt canopy': v.real.canopy };
  out.push(measure('everything'));
  for (const [n, o] of Object.entries(grp)) { const w = o.visible; o.visible = false; out.push(measure('without ' + n)); o.visible = w; }
  const was = v.cockpit.map((o) => o.visible); v.cockpit.forEach((o) => (o.visible = false)); out.push(measure('without model cockpit meshes')); v.cockpit.forEach((o, i) => (o.visible = was[i]));
  const per = {}; for (const o of v.cockpit) { if (!o.visible) continue; let t = 0; o.traverse((m) => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); per[o.name || o.type] = Math.round(t); }
  out.push({ label: 'visible model cockpit parts (tris)', per });
  return out;
});
for (const r of res) { if (r.png) { fs.writeFileSync(`.scratch/overdraw-${r.label.replace(/\W+/g, '-')}.png`, Buffer.from(r.png.split(',')[1], 'base64')); delete r.png; } console.log(JSON.stringify(r)); }
await b.close();
