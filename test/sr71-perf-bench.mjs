import { puppeteer, chromeExecutable, createPage, fixtureURL, evidenceDirectory } from '../tools/qa-browser-support.mjs';
import { writeFile } from 'node:fs/promises';
const label=process.argv[2]||'after';
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await createPage(browser,{viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(fixtureURL('/test/sr71-integration.html'));
 await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors.length,{timeout:180000});
 const result=await page.evaluate(async()=>{
  const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
  function sample(){const update=[],render=[];for(let i=0;i<15;i++){let t=performance.now();qa.visual.update(0,qa.fdm,{x:0,y:0,z:0},qa.visual.view,null,0,null,qa.axes);update.push(performance.now()-t);t=performance.now();qa.renderer.render(qa.scene,qa.camera);qa.renderer.getContext().finish();render.push(performance.now()-t);}return {triangles:qa.renderer.info.render.triangles,calls:qa.renderer.info.render.calls,updateMedianMs:median(update),renderFinishMedianMs:median(render),textures:qa.renderer.info.memory.textures,geometries:qa.renderer.info.memory.geometries};}
  const exterior=sample(); const t=performance.now();await qa.visual.ensureView('cockpit');const cockpitLoadMs=performance.now()-t;
  qa.visual.view='cockpit';qa.camera.position.copy(qa.visual.eye);qa.camera.lookAt(qa.visual.eye.x+2,qa.visual.eye.y-.47,0);qa.camera.fov=80;qa.camera.updateProjectionMatrix();qa.draw();const cockpit=sample();
  qa.visual.view='chase';const t2=performance.now();await qa.visual.ensureView('cockpit');const repeatCockpitMs=performance.now()-t2;
  const assets=performance.getEntriesByType('resource').filter(x=>x.name.includes('/models/sr71/')).map(x=>({url:x.name.split('/models/sr71/')[1],duration:x.duration,transferSize:x.transferSize,encodedBodySize:x.encodedBodySize}));
  return {exterior,cockpit,cockpitLoadMs,repeatCockpitMs,assetTimings:qa.visual.timings,assets,errors:qa.errors};
 });result.browserErrors=errors;result.condition='Headless Chrome SwiftShader CPU, localhost warm OS files/cold browser cache, 1200x800, 15 synchronous gl.finish samples, same harness camera/light, no world shadows';
 await writeFile((await evidenceDirectory())+'/perf-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,assets:result.assets.length}));
}finally{await browser.close();}
