import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.F27_VIEWS_OUT||'/home/captures/f27-v4-views';
await fs.mkdir(out,{recursive:true});
const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:Number(process.env.F27_VIEWS_PORT||5194),strictPort:true,hmr:false,watch:{ignored:['**/*']}},optimizeDeps:{noDiscovery:true,include:['three','earcut']}});
await server.listen();
if(process.env.F27_VIEWS_SERVE==='1'){console.log('F27 V4 fixture http://127.0.0.1:'+server.config.server.port+'/test/f27-view-v4.html');}
else {
let browser;const report={errors:[]};
try{
 browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,protocolTimeout:240000,args:['--no-sandbox','--disable-gpu-watchdog','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage();await page.setViewport({width:900,height:720});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.config.server.port+'/test/f27-view-v4.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ready||window.failure,{timeout:240000,polling:250});
 const failure=await page.evaluate(()=>window.failure);if(failure)throw Error(failure);
 Object.assign(report,await page.evaluate(()=>window.qa));
 for(const mode of ['day','dusk','night'])for(const target of ['cockpit','orbit']){
  await page.evaluate((mode,target)=>window.capture(mode,target),mode,target);
  await page.screenshot({path:path.join(out,mode+'-'+target+'.png')});
 }
 assert.equal(report.samples.length,6);
 for(const s of report.samples){
  assert.equal(s.pixelsDiff.max,0,'first target pixels must equal explicit fresh reference: '+s.mode+' '+s.view);
  assert.equal(s.mainSceneDraws,1,'one normal main scene draw, not permanent warmup redraw');
  assert.equal(s.cloudMarches,1,'target must march even with half-rate enabled');
  assert.equal(s.selfRefreshed,true);assert.ok(s.selfCasters>0,'active representation casts self shadows');
  assert.equal(s.ao,s.view==='cockpit'?0:0.6);assert.equal(s.visibleParts.length,1);
 }
 assert.ok(report.staticMatrixProof.leafMeshes>500);
 assert.equal(report.staticMatrixProof.selfDiff.max,0,'comparison fixture must be stable');
 assert.deepEqual(report.staticMatrixProof.changedMatrices,[],'local/world matrices must stay identical');
 assert.equal(report.staticMatrixProof.pixelsDiff.max,0,'static cockpit local-matrix optimization must preserve pixels');
 assert.ok(report.regression.pixelsDiff.changed>0,'old ungated path must differ visibly from corrected frame');
 assert.equal(report.regression.stale.selfShadowDraws,0);assert.ok(report.regression.fixed.selfShadowDraws>0);
 assert.equal(report.regression.stale.ao,0.6);assert.equal(report.regression.fixed.ao,0);
 assert.equal(report.errors.length,0);
 console.log('PASS F27 V4 real render',JSON.stringify(report.samples.map(s=>({mode:s.mode,view:s.view,diff:s.pixelsDiff,world:s.worldRedraws,clouds:s.cloudMarches,casters:s.selfCasters,programDelta:s.programDelta,ms:s.renderMs}))));
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{await browser?.close();await server.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
