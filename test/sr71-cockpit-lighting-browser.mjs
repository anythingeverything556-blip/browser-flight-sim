// Real SR-71 GLTF, loopback only, fresh isolated Chromium per baseline/fix.
// Default baseline restores the pre-fix visibility policy and unpatched materials.
// SR71_LIGHTING_BASELINE may point to a locally preserved exact pre-fix module.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.SR71_LIGHTING_OUT||'/home/captures/sr71-cockpit-light-hitch';await fs.mkdir(out,{recursive:true});
const fixedSource=await fs.readFile(path.join(root,'src/sr71cockpit.js'),'utf8');
let baselineSource;
if(process.env.SR71_LIGHTING_BASELINE)baselineSource=await fs.readFile(process.env.SR71_LIGHTING_BASELINE,'utf8');
else{
 baselineSource=fixedSource.replace("import {gateInactiveCockpitSpots} from './sr71cockpitlighting.js';\n",'');
 const start=baselineSource.indexOf('    // Scope the uniform zero-light branch');
 const end=baselineSource.indexOf('    this.applyLights();',start);
 assert(start>0&&end>start,'baseline reconstruction landmarks');
 baselineSource=baselineSource.slice(0,start)+baselineSource.slice(end);
 baselineSource=baselineSource.replace("light.name='SR71 '+def.id+' '+helper.name;light.castShadow=false;", "light.name='SR71 '+def.id+' '+helper.name;light.visible=false;light.castShadow=false;");
 baselineSource=baselineSource.replace('lamp.light.intensity=lamp.def.intensity', 'lamp.light.visible=v>0;lamp.light.intensity=lamp.def.intensity');
}
const sourceHash=createHash('sha256').update(baselineSource).digest('hex');
const server=await createServer({root,cacheDir:path.join(out,'vite-cache'),configFile:false,appType:'custom',server:{host:'127.0.0.1',port:Number(process.env.SR71_LIGHTING_PORT||5297),strictPort:true,hmr:false,watch:{ignored:['**/*']}},optimizeDeps:{noDiscovery:true,include:['three']}});
server.middlewares.use('/__sr71cockpit-before.js',async(req,res,next)=>{try{
 await server.transformRequest('/src/sr71cockpit.js');
 const transformed=await server.pluginContainer.transform(baselineSource.replaceAll("from './","from '/src/"),path.join(root,'src/sr71cockpit.js'));
 res.setHeader('Content-Type','text/javascript');res.end(transformed.code);
}catch(e){next(e);}});
server.middlewares.use('/__sr71_lighting',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local SR-71 light regression</title><link rel="icon" href="data:,"><style>body{margin:0;background:#0c1420;color:#fff;font:15px system-ui}h1{font-size:19px;margin:12px}#status{margin:12px}canvas{display:block}</style><h1>Local SR-71 cockpit fixture</h1><div id="status">Preparing local assets…</div><canvas></canvas><script type="module" src="/test/sr71-cockpit-lighting-fixture.js"></script>');});
const report={method:'Program creation instrumentation plus renderer.info.programs; no hardware timing/FPS claims. Images are isolated headless Chromium WebGL captures, not the shared visible desktop.',baselineMethod:process.env.SR71_LIGHTING_BASELINE?'exact locally preserved pre-fix source':'current source with pre-fix visibility switching and ungated material path restored',baselineSHA256:sourceHash,results:[]};
let browser;
try{
 await server.listen();
 for(const baseline of [true,false]){
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,protocolTimeout:240000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--disable-gpu-watchdog','--no-first-run']});
  const page=await browser.newPage();await page.setViewport({width:960,height:735});
  const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith('http://127.0.0.1:'+server.config.server.port+'/')||r.url().startsWith('blob:')||r.url().startsWith('data:'))r.continue();else{blocked.push(r.url());r.abort();}});
  await page.goto('http://127.0.0.1:'+server.config.server.port+'/__sr71_lighting'+(baseline?'?baseline':''),{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.qa?.ready||window.failure,{timeout:240000,polling:300});
  const failure=await page.evaluate(()=>window.failure);if(failure)throw Error(failure);
  assert.deepEqual(await page.evaluate(()=>qa.report.missing),[]);
  const prefix=baseline?'before':'after';
  await page.screenshot({path:path.join(out,prefix+'-off.png')});
  await page.evaluate(()=>{qa.cockpit.event('sr71Flood');const s=qa.draw('first flood on');qa.caption('First flood toggle',s);});
  await page.screenshot({path:path.join(out,prefix+'-first-flood-on.png')});
  await page.evaluate(()=>{qa.cockpit.event('sr71Flood');qa.draw('flood off again');qa.report.offRestored=qa.difference(qa.offPixels,qa.pixels());});
  for(const id of await page.evaluate(()=>qa.SR71_COCKPIT_LIGHTS.map(d=>d.id))){
   await page.evaluate(id=>{qa.cockpit.setLight(id,.35);qa.draw(id+' dim only');qa.cockpit.setLight(id,1);qa.draw(id+' full only');qa.cockpit.setLight(id,0);qa.draw(id+' off');},id);
  }
  await page.evaluate(()=>{for(const d of qa.SR71_COCKPIT_LIGHTS){qa.cockpit.setLight(d.id,1);qa.draw(d.id+' cumulative on');}qa.report.allOn=qa.cockpit.snapshot();qa.caption('All controls on',qa.report.samples.at(-1));});
  await page.evaluate(async()=>{const hash=await crypto.subtle.digest('SHA-256',qa.pixels());qa.report.allOnPixelSHA256=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');});
  await page.screenshot({path:path.join(out,prefix+'-all-on.png')});
  // Off path must match an actual scene with the source lights removed.
  await page.evaluate(()=>{for(const d of qa.SR71_COCKPIT_LIGHTS)qa.cockpit.setLight(d.id,0);qa.draw('all off restored');const zero=qa.pixels();for(const l of qa.cockpit.lamps)l.light.visible=false;qa.draw('diagnostic: all lights removed');qa.report.zeroContribution=qa.difference(zero,qa.pixels());});
  const result=await page.evaluate(()=>qa.report);result.errors=errors;result.blockedExternalRequests=blocked;report.results.push(result);
  assert.deepEqual(errors,[],'no shader compile errors or browser exceptions');assert.deepEqual(blocked,[]);
  assert.equal(result.offRestored.changedPixels,0,'switch off restores the original image exactly');assert.equal(result.zeroContribution.changedPixels,0,'zero-intensity lights contribute exactly zero pixels');
  if(!baseline)assert(result.samples.filter(s=>s.label!=='initial all off'&&!s.label.startsWith('diagnostic:')).every(s=>s.newPrograms===0),'every toggle/dim combination reuses cached programs');
  console.log(prefix,JSON.stringify({renderer:result.renderer,initial:result.samples[0],firstToggle:result.samples[1],toggleNewPrograms:result.samples.filter(s=>s.label!=='initial all off'&&!s.label.startsWith('diagnostic:')).reduce((n,s)=>n+s.newPrograms,0),offRestored:result.offRestored,zeroContribution:result.zeroContribution}));
  await browser.close();browser=null;
 }
 assert.equal(report.results[0].allOnPixelSHA256,report.results[1].allOnPixelSHA256,'all-on optics and intensity are pixel-identical in this fixture');
 assert(report.results[0].samples[1].newPrograms>0,'pre-fix first toggle reproduces new program creation');
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}finally{await browser?.close();await server.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
