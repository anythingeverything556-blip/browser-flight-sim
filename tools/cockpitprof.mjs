// What does the cockpit view cost? Per view: draw calls, triangles, main-thread phases, and timed pieces of the cockpit update (panel.draw etc).
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn'); await new Promise((r) => setTimeout(r, 15000));
const out = {};
for (const view of ['orbit', 'cockpit']) {
  await p.evaluate((v) => window.__sim.setView(v), view);
  await new Promise((r) => setTimeout(r, 12000));
  out[view] = await p.evaluate(() => { const S = window.__sim, i = S.renderer.info; return { calls: S.perf.drawn.calls, tris: S.perf.drawn.tris, phases: Object.fromEntries(Object.entries(S.perf.avg).map(([k, v]) => [k, +v.toFixed(0)])), geometries: i.memory.geometries, textures: i.memory.textures }; });
}
// time the cockpit pieces directly
out.timing = await p.evaluate(() => {
  const S = window.__sim, v = S.visual, t = (f, n = 10) => { const a = performance.now(); for (let i = 0; i < n; i++) f(); return +((performance.now() - a) / n).toFixed(2); };
  const st = { warn: {}, unstart: [0, 0], rpm: [90, 90], egt: [700, 700], noz: [50, 50], ff: [9000, 9000], ab: [false, false], bypass: [0, 0], nav: {}, kias: 300, mach: 0.9, altFt: 20000, vsFpm: 0, g: 1, aoaDeg: 5, pitch: 0, bank: 0, hdg: 90, slip: 0, fdPitch: 0, fdRoll: 0, gearPos: 0, fuelLb: 50000, cit: 100, hour: 12, stick: { p: 0, r: 0 }, throttle: 0.7, spikeIn: 0, flightTime: 10 };
  const r = {}; let k = 0;
  r.panelDrawMs = t(() => { st.kias = 300 + (k++ % 7); v.panel.draw({ ...st }, 0.04); });
  r.panelCanvas = `${v.panel.canvas?.width ?? v.panel.ctx.canvas.width}x${v.panel.ctx.canvas.height}`;
  r.panelTexMips = v.panel.texture.generateMipmaps; r.panelMinFilter = v.panel.texture.minFilter; r.panelAniso = v.panel.texture.anisotropy;
  try { r.cheekUpdateMs = t(() => v.real.cheek.update({ ...st }, 0.04)); } catch (e) { r.cheekErr = String(e); }
  return r;
});
// how much does each cockpit piece add to draw calls / triangles: hide them one at a time
out.hide = await p.evaluate(async () => {
  const S = window.__sim, v = S.visual, res = {};
  const frameInfo = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ calls: S.renderer.info.render.calls, tris: S.renderer.info.render.triangles }))));
  S.perf.drawn; S.renderer.info.autoReset = true;
  res.all = await frameInfo();
  const names = {}; v.real.interior.children.forEach((c, i) => { names[c.name || 'child' + i] = c; });
  const groups = { interior: v.real.interior, canopy: v.real.canopy, model: v.model };
  for (const [n, o] of Object.entries(groups)) { const was = o.visible; o.visible = false; res['hide ' + n] = await frameInfo(); o.visible = was; }
  const cp = v.cockpit || []; let tri = 0; for (const o of cp) o.traverse((m) => { if (m.isMesh) tri += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  res.cockpitModelTris = Math.round(tri); res.cockpitModelMeshes = cp.length;
  let it = 0, im = 0; v.real.interior.traverse((m) => { if (m.isMesh) { im++; it += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; } }); res.rebuiltInteriorTris = Math.round(it); res.rebuiltInteriorMeshes = im;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
