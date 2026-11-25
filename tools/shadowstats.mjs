// How often each shadow cascade is really redrawn in flight (renderer.render stubbed so only the decision logic and JS run).
import puppeteer from 'puppeteer-core';
const [url = 'http://127.0.0.1:5180/', view = 'cockpit'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-zygote', '--ignore-gpu-blocklist', '--window-size=640,360'] });
const p = await b.newPage(); await p.setViewport({ width: 640, height: 360 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if (await p.evaluate(() => { const x = document.getElementById('start-btn'); return x && !x.disabled; }).catch(() => false)) break; }
await p.click('#start-btn'); await new Promise((r) => setTimeout(r, 12000));
console.log(await p.evaluate(() => { const S = window.__sim; return `pixel ratio ${S.renderer.getPixelRatio()}, msaa ${S.post.msaa} (wanted ${S.post.msaaWanted}, max ${S.post.msaaMax}), cloud target ${S.vclouds.lowRT.width}x${S.vclouds.lowRT.height} of ${S.renderer.domElement.width}x${S.renderer.domElement.height}, rscale ${S.settings.rscale}`; }));
await p.evaluate((v) => { const S = window.__sim; S.setView(v); S.renderer.render = () => {}; S.fdm.pos.y += 600; S.fdm.vel.set(250, 0, 0); S.fdm.setEngines(1, true); S.settings.runClock = false; }, view);
await new Promise((r) => setTimeout(r, 6000));
await p.evaluate(() => window.__sim.stat.reset());
const t0 = Date.now(); await new Promise((r) => setTimeout(r, 20000));
const r = await p.evaluate(() => ({ shadow: window.__sim.stat.snapshot().filter(([n]) => n.startsWith('shadow')), speed: Math.round(window.__sim.fdm.vel.length()), agl: Math.round(window.__sim.terrain.cam.agl) }));
console.log(view, JSON.stringify(r), 'seconds', (Date.now() - t0) / 1000);
await b.close();
