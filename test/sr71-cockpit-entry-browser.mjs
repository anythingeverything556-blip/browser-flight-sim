import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../../'+(process.argv[2]||'baseline')+'.json',import.meta.url));
const server=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../../.probe-cache',import.meta.url)),root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/*']}}});await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port;
let browser;const report={errors:[],blockedExternal:[],scope:'Real full app, real local SR71 assets; 640x420, low preset/rscale .5/dynres false. Software SwiftShader, no hardware FPS claim.'};
try{
 browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/google-chrome',protocolTimeout:180000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--disable-gpu-watchdog','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 const page=await browser.newPage();await page.setViewport({width:640,height:420});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin)||/^(data:|blob:)/.test(r.url()))r.continue();else{report.blockedExternal.push(r.url());r.abort();}});
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',gfxV3:true,rscale:.5,dynres:false,cmap:false,metarAuto:false,trees:false,buildings:false,traffic:false,clouds:0}));
  window.__probe={createProgram:0,links:0,long:[],compiles:[]};const p=__probe;
  for(const [fn,key]of [['createProgram','createProgram'],['linkProgram','links']]){const orig=WebGL2RenderingContext.prototype[fn];WebGL2RenderingContext.prototype[fn]=function(...args){p[key]++;return orig.apply(this,args);};}
  new PerformanceObserver(list=>{for(const e of list.getEntries())p.long.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
 });
 await page.goto(origin+'/?aircraft=sr71',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__simReady,{timeout:90000});console.log('menu ready');
 await page.evaluate(()=>{
  const s=__sim,orig=s.renderer.compile;s.renderer.compile=function(scene,camera,target){const t=performance.now(),result=orig.call(this,scene,camera,target);__probe.compiles.push({ms:performance.now()-t,scene:scene.name||scene.type,mats:result.size,spots:[...result].filter(m=>m.isMeshStandardMaterial).length,programs:this.info.programs.length});return result;};
 });
 await page.evaluate(()=>{__sim.terrain.heightAt=()=>0;__sim.terrain.heightReady=()=>true;__sim.terrain.levelAt=()=>15;__sim.terrain.coverage=()=>1;__sim.state.fastSpawn=true;});
 await page.click('#just-fly');console.log('start clicked');
 await page.waitForFunction(()=>window.__flightAssetsReady&&__sim.warm.done&&__sim.state.started&&!__sim.state.pending,{timeout:240000});console.log('flight ready');
 await page.evaluate(()=>{__sim.openSheet(null);__sim.state.paused=true;__sim.setView('orbit');__sim.controls.enabled=true;document.activeElement?.blur();});
 const snapshot=()=>page.evaluate(()=>({view:__sim.rig.view,programs:__sim.renderer.info.programs.length,created:__probe.createProgram,links:__probe.links,frame:__sim.renderer.info.render.frame,draw:__sim.renderer.info.render.calls,triangles:__sim.renderer.info.render.triangles,pixelRatio:__sim.renderer.getPixelRatio(),cockpit:__sim.visual.interior?.root.parent?.name,lights:__sim.visual.cockpitController?.lamps.length,frameError:window.__frameErr||null}));
 const frames=()=>page.evaluate(async()=>{const samples=[],times=[];let prev=performance.now();for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-prev);times.push(now);prev=now;}return {ms:samples,times,...{programs:__sim.renderer.info.programs.length,draw:__sim.renderer.info.render.calls,triangles:__sim.renderer.info.render.triangles}};});
 report.exterior=await frames();report.before=await snapshot();console.log('exterior',JSON.stringify(report.before));
 for(const [name,action]of [['first','key'],['second','button']]){
  if(action==='key')await page.evaluate(()=>{__sim.setView('flyby');__sim.controls.enabled=true;document.activeElement?.blur();});
  const t=Date.now();await page.evaluate(()=>{__probe.at=performance.now();__probe.longAt=__probe.long.length;});
  if(action==='key')await page.keyboard.press('KeyV');else await page.evaluate(()=>document.querySelector('#sr71-cockpit-entry').click());
  await page.waitForFunction(()=>__sim.rig.view==='cockpit',{timeout:90000});
  report[name]={wallMs:Date.now()-t,snapshot:await snapshot(),frames:await frames(),long:await page.evaluate(()=>__probe.long.slice(__probe.longAt))};
  console.log(name,JSON.stringify(report[name]));
  await page.evaluate(()=>__sim.setView('orbit'));report[name].exitFrames=await frames();report[name].exit=await snapshot();
 }
 report.compiles=await page.evaluate(()=>__probe.compiles);report.pass=!report.before.frameError&&!report.first.snapshot.frameError&&!report.second.snapshot.frameError;
}catch(e){report.error=e.stack;throw e;}finally{await writeFile(out,JSON.stringify(report,null,2));if(browser)await browser.close();await server.close();}
