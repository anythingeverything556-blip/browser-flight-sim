// JS-only cost per view (renderer.render stubbed so software GL does not dominate) plus a census of what the camera would draw.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://127.0.0.1:5180/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn'); await new Promise((r) => setTimeout(r, 20000));
await p.evaluate(() => { const S = window.__sim; S.renderer.render = () => {}; S.perf.avg = {}; });
const out = {};
for (const view of ['orbit', 'cockpit']) {
  await p.evaluate((v) => { window.__sim.setView(v); window.__sim.perf.avg = {}; window.__sim.stat.reset(); }, view);
  await new Promise((r) => setTimeout(r, 10000));
  await p.evaluate(() => { window.__sim.perf.avg = {}; window.__sim.stat.reset(); }); await new Promise((r) => setTimeout(r, 10000));
  out[view] = await p.evaluate(() => {
    const S = window.__sim, cam = S.camera, f = new S.THREE.Frustum(), m = new S.THREE.Matrix4();
    cam.updateMatrixWorld(); m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); f.setFromProjectionMatrix(m);
    const by = {}; let calls = 0, tris = 0;
    S.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) || !o.layers.test(cam.layers)) return;
      if (o.frustumCulled && o.geometry) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const bs = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (!f.intersectsSphere(bs)) return; }
      const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      let top = o; while (top.parent && top.parent !== S.scene) top = top.parent;
      const k = top.name || top.type + ':' + top.children.length; by[k] = by[k] || { meshes: 0, tris: 0 }; by[k].meshes++; by[k].tris += Math.round(n); calls++; tris += n;
    });
    const top = Object.entries(by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 8);
    return { frames: Math.round(1), calls, trisK: Math.round(tris / 1e3), top, phasesMs: Object.fromEntries(Object.entries(S.perf.avg).map(([k, v]) => [k, +v.toFixed(2)])), work: S.stat.snapshot() };
  });
}
import('node:fs').then((fs) => fs.writeFileSync('.scratch/cockpitprof2.json', JSON.stringify(out, null, 1)));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { calls: v.calls, trisK: v.trisK, phasesMs: v.phasesMs, work: v.work }]))));
await b.close();
