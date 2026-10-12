// Why does the ground near the jet stop at zoom 15? Dumps quadtree state around the aircraft for two airports. usage: node tools/lodprobe.mjs url [ICAO,ICAO]
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5191/', icaos = 'LSGG,KBAB'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn');
for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => !window.__sim.state.pending && window.__sim.warm.done)) break; }
await p.evaluate(() => { const S = window.__sim; S.settings.rscale = 1; S.applyGfx('normal'); S.openSheet(null); });
for (const icao of icaos.split(',')) {
  await p.evaluate((icao) => { const S = window.__sim, a = S.db.get(icao), r = a.runways[0]; S.state.paused = false; S.spawn(r.spawn(0, 'runway'), { rwy: r, end: 0 }); }, icao);
  const t0 = Date.now(); let st;
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 4000)); st = await p.evaluate(() => { const t = window.__sim.terrain.stats; return { pending: !!window.__sim.state.pending, busy: t.imgActive + t.demActive + t.imgWait }; }); if (!st.pending && st.busy === 0 && Date.now() - t0 > 40000) break; if (Date.now() - t0 > 260000) break; }
  const r = await p.evaluate(() => {
    const S = window.__sim, T = S.terrain, ll = S.geo.toLatLon(S.fdm.pos.x, S.fdm.pos.z);
    const hist = {}; for (const t of T.drawn) hist[t.z] = (hist[t.z] || 0) + 1;
    const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z, lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
    const chain = []; for (let z = 13; z <= 19; z++) { const x = Math.floor(lon2tx(ll.lon, z)), y = Math.floor(lat2ty(ll.lat, z)); const t = [...T.tiles.values()].find((q) => q.z === z && q.x === x && q.y === y);
      chain.push(t ? { z, img: t.img, hi: t.hi, drawn: T.drawn.includes(t), d: Math.round(t.d), size: Math.round(t.size), noSplitSelf: T.noSplit.has(t.key), src: t.src ? t.src.id : 'esri', splitFrame: t.splitFrame === T.frame ? 'now' : T.frame - t.splitFrame } : { z, tile: 'none' }); }
    return { hist, chain, detail: T.detail, pxScale: T.pxScale, budget: +T.budget.toFixed(2), leafCap: T.leafCap, maxZ: T.maxZ, hiZ: T.hiZ, noSplitCount: T.noSplit.size, agl: Math.round(T.cam.agl), view: S.rig.view, paused: S.state.paused, frame: T.frame, drawn: T.drawn.length };
  });
  console.log(icao, 'waited s', ((Date.now() - t0) / 1000) | 0, JSON.stringify(r, null, 1));
}
await b.close();
