// Built-app saved-state regression; all requests remain local, no live services.
// Run after npm run build. SwiftShader is only a correctness fixture, not an FPS benchmark.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://fixture').pathname));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(await fs.readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',protocolTimeout:180000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--disable-gpu-watchdog','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const page=await browser.newPage();await page.setViewport({width:640,height:420});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  await page.setRequestInterception(true);page.on('request',req=>{if(req.url().startsWith(origin)||/^(data:|blob:)/.test(req.url()))req.continue().catch(()=>{});else req.abort().catch(()=>{});});
  await page.evaluateOnNewDocument(()=>{
    if(!localStorage.getItem('sr71sim.settings'))localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',gfxV3:true,gfxV4:true,gfxV5:true,gfxV6:true,gfxV7:true,gfxV8:true,trafficV1:true,rscale:'auto',dynres:false,metarAuto:false,buildings:false,trees:false,traffic:false,clouds:0,volume:.3}));
  });
  const ready=async()=>{
    await page.waitForFunction(()=>(window.__simReady&&window.__sim)||document.body.classList.contains('startup-failed'),{timeout:30000});
    const failure=await page.evaluate(()=>document.body.classList.contains('startup-failed')?document.querySelector('#loadmsg')?.textContent:null);
    assert.equal(failure,null,'Built-app regression requires WebGL 2: '+failure);
  };
  const snapshot=()=>page.evaluate(()=>({scale:__sim.settings.rscale,saved:JSON.parse(localStorage.getItem('sr71sim.settings')).rscale,slider:+document.querySelector('#rscale').value,label:document.querySelector('#rscale-l').textContent,width:__sim.renderer.domElement.width,height:__sim.renderer.domElement.height,ratio:__sim.renderer.getPixelRatio(),adaptive:__sim.settings.dynres,startDisabled:document.querySelector('#start-btn').disabled,volume:__sim.settings.volume}));
  const expected=scale=>({scale,saved:scale,slider:scale,label:Math.round(scale*100)+'%',width:Math.floor(640*scale),height:Math.floor(420*scale),ratio:scale,adaptive:false,startDisabled:false,volume:.3});
  await page.goto(origin+'/?aircraft=c172',{waitUntil:'domcontentloaded'});await ready();
  assert.deepEqual(await snapshot(),expected(1));console.log('PASS E22 actual saved rscale:auto => 640x420, 100%, renderer/UI/save all 1');
  await page.reload({waitUntil:'domcontentloaded'});await ready();assert.deepEqual(await snapshot(),expected(1));
  for(const scale of [.75,1.65,2.5]){
    await page.evaluate(scale=>{const slider=document.querySelector('#rscale');slider.value=String(scale);slider.dispatchEvent(new Event('input'));},scale);
    assert.deepEqual(await snapshot(),expected(scale));
    await page.reload({waitUntil:'domcontentloaded'});await ready();assert.deepEqual(await snapshot(),expected(scale));
    console.log('PASS E22 actual slider + reload preserves manual '+scale);
  }
  // A valid saved supersample must not be reset by this repair (all old migrations already complete).
  await page.evaluate(()=>{const settings=JSON.parse(localStorage.getItem('sr71sim.settings'));settings.rscale=2;localStorage.setItem('sr71sim.settings',JSON.stringify(settings));});
  await page.reload({waitUntil:'domcontentloaded'});await ready();assert.deepEqual(await snapshot(),expected(2));
  assert.deepEqual(errors,[]);console.log('PASS E22 saved valid 200% survives; no page errors; external requests blocked');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
