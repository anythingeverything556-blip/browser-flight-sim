// How big is the step in the cloud-shadow map each time it is re-rendered? Renders the map twice (0.4 s apart, the aircraft flying at 250 m/s,
// 6 m/s cloud drift) and compares what the ground would be shaded with just before and just after the switch, at the same world points.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=320,180'] });
const p = await b.newPage(); await p.setViewport({ width: 320, height: 180 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !!(window.__sim.vclouds.tex && window.__sim.vclouds.march))) break; }
const r = await p.evaluate(() => {
  const S = window.__sim, T = S.THREE, cs = S.cloudShadow, rend = S.renderer;
  const px = new Uint8Array(160 * 160 * 4);
  const read = (rt) => { rend.readRenderTargetPixels(rt, 0, 0, 160, 160, px); return Uint8Array.from(px).filter((_, i) => i % 4 === 0); };
  const sample = (arr, mapv, x, z) => { // x,z relative to camera
    const qx = (x + mapv.x) * mapv.z + 0.5, qy = (z + mapv.y) * mapv.z + 0.5; if (qx < 0.05 || qx > 0.95 || qy < 0.05 || qy > 0.95) return null;
    const fx = qx * 160 - 0.5, fy = qy * 160 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, g = (i, j) => arr[j * 160 + i] / 255;
    return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  };
  const wind = new T.Vector2(6, 2), sun = new T.Vector3(0.5, 0.6, 0.3).normalize();
  const cam = { x: 120000, z: 80000 }, args = (t, cx) => ({ shape: S.vclouds.tex.shape, cover: 0.7, base: 3000, top: 5500, wind, now: t, cam: { x: cx, z: cam.z }, groundY: 100, sunDir: sun });
  cs.update(rend, args(100, cam.x));                              // first render: the map at t = 100 s
  const cx2 = cam.x + 250 * 0.36;                                  // 0.36 s later and 90 m further on the map is re-rendered
  cs.update(rend, args(100.36, cx2));
  const A = read(cs.rtOld), B = read(cs.rt), mapOld = cs.map2.clone(), mapNew = cs.map.clone(), mixNow = cs.mix;
  let sum = 0, n = 0, mx = 0;
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) {
    const a = sample(A, mapOld, i * 100, j * 100), b2 = sample(B, mapNew, i * 100, j * 100); if (a == null || b2 == null) continue;
    const d = Math.abs(a - b2); sum += d; n++; mx = Math.max(mx, d);
  }
  return { points: n, meanStepOfGroundShade: +(sum / n).toFixed(4), maxStep: +mx.toFixed(3), mixRightAfterSwitch: +mixNow.toFixed(3), meanShadeOfMap: +(A.reduce((s, v) => s + v, 0) / A.length / 255).toFixed(3) };
});
console.log(JSON.stringify(r));
await b.close();
