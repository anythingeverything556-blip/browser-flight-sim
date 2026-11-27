// Offline local-only investigation. Does not load the game, change render defaults, or fetch terrain.
// node tools/sr71/line-artifact-probe.mjs [loopback base] [output directory] [log|reverse|standard]
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base='http://127.0.0.1:5187',out='.scratch/sr71-lines',depth='log']=process.argv.slice(2);
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Loopback only');
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:true,protocolTimeout:240000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--disable-background-networking']});
const page=await browser.newPage();await page.setViewport({width:1000,height:700});
const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.origin===new URL(base).origin||['data:','blob:'].includes(u.protocol))r.continue();else{blocked.push(r.url());r.abort();}});
const result={depth,errors,blocked,views:[]};
try{
 await page.goto(base+'/test/sr71-line-artifacts.html?depth='+depth,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors.length,{timeout:240000});
 assert.deepEqual(await page.evaluate(()=>qa.errors),[]);
 for(const name of (process.env.SR71_LINE_VIEWS?.split(',')||['exterior','port','top','canopy','nose','tires','rear','cockpit','cockpit-left','cockpit-right'])){
  await page.evaluate(n=>qa.view(n),name);await page.screenshot({path:`${out}/${depth}-${name}.png`});
  // Exact repeated rendering must be byte-identical for a frozen camera and state.
  const measurement=await page.evaluate(()=>{
   const {renderer,camera}=qa,gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
   const read=()=>{qa.draw();const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
   const a=read();let changed=0,maxDelta=0;for(let f=0;f<3;f++){const b=read();for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(d>0)changed++;maxDelta=Math.max(maxDelta,d);}}
   const transparent=[];qa.visual.root.traverseVisible(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.transparent)transparent.push({mesh:o.name,material:m.name,opacity:m.opacity,decal:m.userData.decal||false,drawOrder:m.userData.drawOrder,depthWrite:m.depthWrite,polygonOffset:m.polygonOffset});});
   return {camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far,changedPixelsAcrossThreeRepeatedRenders:changed,maxChannelDelta:maxDelta,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,transparent};
   });
  if(process.env.SR71_LINE_RAIL==='1')measurement.microRail=await page.evaluate(()=>{
   const {renderer,camera}=qa,gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,origin=camera.position.clone(),frames=[];
   // 0.5 mm steps expose coplanar crawling without moving aircraft, lights, controls or clock.
   for(let f=0;f<9;f++){camera.position.copy(origin).add(new qa.THREE.Vector3(0,0,f*.0005));qa.draw();const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);frames.push(a);}
   camera.position.copy(origin);qa.draw();const blips=[];let worstPixelJump=0;
   for(let f=1;f+1<frames.length;f++){let count=0;for(let i=0;i<w*h*4;i+=4){const lum=a=>(77*a[i]+150*a[i+1]+29*a[i+2])/256,A=lum(frames[f-1]),B=lum(frames[f]),C=lum(frames[f+1]);worstPixelJump=Math.max(worstPixelJump,Math.abs(B-A));if(Math.abs(B-A)>12&&Math.abs(C-B)>12&&Math.abs(C-A)<6)count++;}blips.push(count);}
   return {frames:9,stepMetres:.0005,blipThreshold:12,blipsPerMiddleFrame:blips,worstPixelJump,interpretation:'Includes ordinary subpixel edge aliasing; not a stand-alone defect verdict.'};
  });
  assert.equal(measurement.changedPixelsAcrossThreeRepeatedRenders,0,name+' frozen-camera raster is deterministic');
  result.views.push({name,...measurement});console.log('PASS frozen-view',name,measurement.changedPixelsAcrossThreeRepeatedRenders,measurement.triangles,measurement.microRail?JSON.stringify(measurement.microRail):'');
 }
 result.gpu=await page.evaluate(()=>{const gl=qa.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {version:gl.getParameter(gl.VERSION),renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null,reversed:qa.renderer.state.buffers.depth.getReversed(),log:qa.renderer.capabilities.logarithmicDepthBuffer};});
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
} catch(e){result.error=e.stack;process.exitCode=1;console.error(e.stack);}finally{await writeFile(`${out}/${depth}-results.json`,JSON.stringify(result,null,2));await browser.close();}
