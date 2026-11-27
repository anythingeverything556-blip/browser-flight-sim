// Production-only loopback fixture: never starts the Vite provider proxies.
// Usage: LOADPERF_DIST_DIR=dist node test/aircraft-visual-load-browser-test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
const root = path.resolve(process.env.LOADPERF_DIST_DIR || 'dist');
const baseline = process.env.LOADPERF_BASELINE === '1';
const aircrafts = (process.env.LOADPERF_AIRCRAFTS || 'da40,c172,sr71,sf50,f27,il76').split(',');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.webp':'image/webp' };
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/')) { res.writeHead(200, {'Content-Type':'application/json'});res.end('[]');return; }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403);res.end();return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'});res.end(await readFile(file));
  } catch { res.writeHead(404);res.end(); }
});
await new Promise(r=>server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser; const results=[];
try {
  browser = await puppeteer.launch({headless:true,env:{...process.env,DISPLAY:''},executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  for (const aircraft of aircrafts) {
    const context=await browser.createBrowserContext(), page=await context.newPage(), requests=new Set(), errors=[];
    await page.setViewport({width:960,height:640});await page.setCacheEnabled(false);
    page.on('pageerror', e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r=>{const url=new URL(r.url());if(url.origin===origin || /^(data:|blob:)/.test(r.url())) {if(url.origin===origin) requests.add(url.pathname);r.continue();}else r.respond({status:200,contentType:'application/json',body:'[]'});});
    await page.evaluateOnNewDocument(()=>{localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',rscale:.5,clouds:0,trees:false,buildings:false,traffic:false,metarAuto:false}));});
    await page.goto(origin+'/?aircraft='+aircraft,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__simReady || document.body.classList.contains('startup-failed'),{timeout:90000});
    assert.equal(await page.evaluate(()=>!!window.__simReady),true,await page.$eval('#loadmsg',e=>e.textContent));
    const ready=await page.evaluate(()=>({readyMs:performance.now(),aircraft:__sim.aircraft,started:__sim.state.started}));
    assert.equal(ready.aircraft,aircraft);assert.equal(ready.started,false);
    assert(![...requests].some(p=>p.startsWith('/models/')), 'usable home must not fetch aircraft assets');
    assert.equal(await page.$eval('#start-btn',e=>e.disabled),false);
    // Credits remain renderer-independent and accessible after split bootstrap.
    await page.evaluate(()=>document.querySelector('.js-terms').click());
    assert.equal(await page.$eval('#terms',e=>e.open),true);
    await page.click('#terms-close');
    const scripts=[...requests].filter(p=>p.endsWith('.js')&&!p.includes('worker-')).sort();
    if(!baseline) {
      const visualScripts=scripts.filter(p=>/visual-[^/]+\.js$/.test(p));
      assert.equal(visualScripts.length,1,'only one aircraft visual chunk at boot');
      assert(visualScripts[0].includes('/'+aircraft+'visual-'),'selected visual chunk fetched');
      if(aircraft==='sr71') assert(!scripts.some(p=>p.includes('/DRACOLoader-')),'SR-71 must not fetch unused Draco decoder');
    }
    const sizes=await Promise.all(scripts.map(async url=>{const body=await readFile(path.resolve(root,'.'+url));return {url,bytes:body.length,gzipBytes:gzipSync(body).length};}));
    assert.deepEqual(errors,[]);
    results.push({...ready,jsBytes:sizes.reduce((n,s)=>n+s.bytes,0),jsGzipBytes:sizes.reduce((n,s)=>n+s.gzipBytes,0),scripts:sizes,errors});
    await context.close();
  }
  if(process.env.LOADPERF_RESULT) await writeFile(process.env.LOADPERF_RESULT,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally {if(browser) await browser.close();await new Promise(r=>server.close(r));}
