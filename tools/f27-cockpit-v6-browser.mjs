import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { SECURITY_HEADERS } from '../functions/_lib/embed-policy.js';

const outDir=process.env.SMOKE_OUTPUT_DIR || '/tmp/earthwing-smoke';
await fs.mkdir(outDir,{recursive:true});
const injected=process.argv.includes('--inject-failure');
const aircraft='f27';
if(!['c172','sf50','sr71','il76','a380x','da40','f27'].includes(aircraft))throw new Error('Unknown SMOKE_AIRCRAFT');
const a380ExteriorOnly=aircraft==='a380x'&&process.env.SMOKE_A380X_EXTERIOR_ONLY==='1';
const modelRequests=new Set();
const root=path.resolve(process.env.SMOKE_DIST_DIR||'dist');const missingLocal=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.m4a':'audio/mp4','.webm':'audio/webm','.ogg':'audio/ogg','.bin':'application/octet-stream','.dds':'application/octet-stream','.xml':'application/xml','.txt':'text/plain'};
// Local static Pages-convention fixture, not a claim of a live Cloudflare deployment.
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://fixture');const requested=decodeURIComponent(url.pathname);
    if(requested.startsWith(aircraft==='f27'?'/models/f27/':aircraft==='da40'?'/models/da40/':'/models/a380x/'))modelRequests.add(requested);
    if(url.pathname==='/api/traffic'||url.pathname==='/api/metar'){res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':'application/json'});res.end(url.pathname==='/api/traffic'?JSON.stringify({ac:[]}):'[]');return;}
    let file=path.resolve(root,'.'+requested);if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
    try{if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');}catch{}
    let status=200,body;try{body=await fs.readFile(file);}catch{status=404;missingLocal.push(requested);file=path.join(root,'404.html');body=await fs.readFile(file);}
    res.writeHead(status,{...SECURITY_HEADERS,'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);
  }catch{res.writeHead(500);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
function png(){
 const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(256);head.writeUInt32BE(256,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(256*(1+256*3));for(let y=0;y<256;y++)for(let x=0;x<256;x++)raw[y*769+1+x*3]=128; // zero-metre Terrarium, synthetic red imagery
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
let browser, page;let panelResults=[],gameplayChecks=[],da40Motion;const errors=[],requests=[],expectedCancellations=[];let report, f27ExteriorRequests, f27Checks={};
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,dumpio:process.env.SMOKE_GPU_LOG==='1',protocolTimeout:180000,args:['--no-sandbox','--disable-gpu-watchdog','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 page=await browser.newPage();await page.setViewport(['da40','f27'].includes(aircraft)?{width:960,height:600}:{width:960,height:640});
 if(aircraft==='a380x')await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 page.on('pageerror',e=>errors.push({kind:'page',detail:e.message}));
 page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',detail:m.text(),url:m.location().url});});
 await page.evaluateOnNewDocument(()=>{window.__smokeShaderErrors=[];window.__smokeContextEvents=[];document.addEventListener('webglcontextlost',()=>window.__smokeContextEvents.push('lost'),true);document.addEventListener('webglcontextrestored',()=>window.__smokeContextEvents.push('restored'),true);});
 page.on('requestfailed',r=>{const entry={kind:'request',detail:r.url(),reason:r.failure()?.errorText};if(new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/api/traffic'&&entry.reason==='net::ERR_ABORTED')expectedCancellations.push(entry);else errors.push(entry);});
 await page.setRequestInterception(true);
 page.on('request',async r=>{try{if(new URL(r.url()).origin===origin||/^(data:|blob:)/.test(r.url()))await r.continue();else{requests.push(r.resourceType());await r.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'image/png',body:Buffer.from(png(),'base64')});}}catch(e){errors.push({kind:'harness',detail:e.message});if(page){report=await page.evaluate(()=>({load:document.querySelector('#loadmsg')?.textContent,events:window.__earthwingDebug?.events(),shaderErrors:window.__smokeShaderErrors,contextEvents:window.__smokeContextEvents,frameError:window.__frameErr||null,partial:window.__sim?{started:__sim.state.started,pending:!!__sim.state.pending,view:__sim.rig.view,viewStatus:__sim.visual.viewStatus,modelTriangles:__sim.visual.stats?.tris,frame:__sim.renderer.info.render.frame,drawCalls:__sim.renderer.info.render.calls}:null})).catch(()=>null);await page.screenshot({path:path.join(outDir,'smoke-failed.png')}).catch(()=>{});}}});
 await page.evaluateOnNewDocument(({origin,png,aircraft})=>{
   localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',gfxV3:true,gfxV7:true,rscale:['da40','f27'].includes(aircraft)?0.6:0.5,...(['da40','f27'].includes(aircraft)?{cmap:false}:{}),metarAuto:false,buildings:false,trees:false,clouds:0,traffic:false,...(aircraft==='f27'?{dynres:false}:{})}));
   const fixture=`const nativeFetch=self.fetch;self.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,${JSON.stringify(origin)});if(url.origin===${JSON.stringify(origin)})return nativeFetch(input,options);if(url.href.endsWith('/planet'))return Promise.resolve(new Response(JSON.stringify({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf']}),{headers:{'Content-Type':'application/json'}}));if(url.pathname.endsWith('.pbf'))return Promise.resolve(new Response(new Uint8Array()));return Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}));};`;
   const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(url,options){if(!String(url).includes('terrain-worker')){super(url,options);return;}const resolved=new URL(url,location.href).href;const blob=URL.createObjectURL(new Blob([fixture+`await import(${JSON.stringify(resolved)});`],{type:'text/javascript'}));super(blob,{...options,type:'module'});}};
 },{origin,png:png(),aircraft});
 await page.goto(origin+'/?aircraft='+aircraft,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__sim,{timeout:120000});
 await page.evaluate(()=>{const previous=__sim.renderer.debug.onShaderError;__sim.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{window.__smokeShaderErrors.push({contextLost:gl.isContextLost(),program:gl.getProgramInfoLog(program),linked:gl.getProgramParameter(program,gl.LINK_STATUS),error:gl.getError(),shaders:[vertex,fragment].map(shader=>({type:gl.getShaderParameter(shader,gl.SHADER_TYPE),compiled:gl.getShaderParameter(shader,gl.COMPILE_STATUS),log:gl.getShaderInfoLog(shader),source:gl.getShaderSource(shader)}))});previous?.(gl,program,vertex,fragment);};});
 await page.waitForFunction(()=>window.__simReady,{timeout:180000});
 if(aircraft==='a380x')console.log('A380X exterior assets ready');
 // Quick-flight intentionally chooses only the trainer/Blackbird; Start flight preserves other selected airframes.
 await page.click(['c172','sr71'].includes(aircraft)?'#just-fly':'#start-btn');await page.waitForFunction(()=>window.__sim?.state.started&&!window.__sim.state.pending,{timeout:90000});
 const selected=await page.evaluate(()=>window.__sim.aircraft);if(selected!==aircraft)throw new Error('Smoke selected '+selected+' instead of '+aircraft);

 await page.waitForFunction(()=>__sim.f27CameraReady(),{timeout:100000});
 await page.evaluate(()=>__sim.setView('cockpit'));
 await page.waitForFunction(()=>__sim.rig.view==='cockpit'&&__sim.visual.interior.root.visible,{timeout:90000});
 await page.evaluate(()=>{__sim.openSheet(null);__sim.applyWeather('rain',false);});
 await page.waitForFunction(()=>__sim.visual.glassWater.active&&__sim.visual.glassWater.wet>.15,{timeout:45000});
 const weatherIntegration=await page.evaluate(()=>({preset:__sim.settings.weather,effectiveRain:__sim.visual.rainEff,wet:__sim.visual.glassWater.wet,mode:__sim.visual.glassWater.mode,postBound:__sim.post.glassWater===__sim.visual.glassWater}));
 await page.screenshot({path:path.join(outDir,'actual-weather-rain.png')});
 await page.evaluate(()=>{__sim.applyWeather('clear',false);__sim.state.paused=true;});
 report=await page.evaluate(async()=>{
  const s=__sim,r=s.renderer,gl=r.getContext(),part=s.visual.interior,b=part.staticBatch;
  if(!b?.batches.length)throw Error('No cockpit batch');
  const post=s.post.render.bind(s.post);s.post.render=()=>{};
  const frame=()=>{r.info.reset();post(s.scene,s.camera);};
  const pixels=()=>{const a=new Uint8Array(r.domElement.width*r.domElement.height*4);gl.readPixels(0,0,r.domElement.width,r.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
  const png=()=>r.domElement.toDataURL('image/png');
  const diff=(a,b)=>{let n=0,max=0,sum=0;for(let i=0;i<a.length;i+=4){let d=0;for(let k=0;k<3;k++)d=Math.max(d,Math.abs(a[i+k]-b[i+k]));if(d>2)n++;max=Math.max(max,d);sum+=d;}return{pixelsAbove2:n,max,mean:sum/(a.length/4)};};
  const toggle=on=>{b.batches.forEach(o=>o.visible=on);b.sources.forEach(o=>o.visible=!on);};
  const median=a=>a.slice().sort((a,b)=>a-b)[a.length>>1];
  const measure=on=>{toggle(on);frame();gl.finish();const times=[],cpu=[],calls=[],tris=[],pixel=new Uint8Array(4);for(let i=0;i<5;i++){const t=performance.now();frame();cpu.push(performance.now()-t);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);times.push(performance.now()-t);calls.push(r.info.render.calls);tris.push(r.info.render.triangles);}return{medianGpuSynchronizedMs:median(times),medianSubmitMs:median(cpu),samplesMs:times,calls:median(calls),triangles:median(tris)};};
  // Same frozen production scene, same resolution. Alternate order for drift.
  s.visual.glassWater.wet=0;s.visual.glassWater.update(0,{rain:0,V:0,sun:s.env.sunDir,daylight:1,near:true});
  s.visual.dormantLightGate.value=false;
  const rounds=[];for(let n=0;n<2;n++){const a=measure(n===1),b=measure(n===0);rounds.push(n===0?{original:a,batched:b}:{original:b,batched:a});}
  const shadowFrames=[];for(const batched of [false,true]){toggle(batched);r.shadowMap.needsUpdate=true;frame();const a=pixels();shadowFrames.push({batched,calls:r.info.render.calls,triangles:r.info.render.triangles,pixels:Array.from(a)});}const shadowDiff=diff(shadowFrames[0].pixels,shadowFrames[1].pixels);for(const v of shadowFrames)delete v.pixels;
  const lightGate=[];toggle(true);for(const on of [false,true,false,true]){s.visual.dormantLightGate.value=on;lightGate.push({on,...measure(true)});}
  s.visual.dormantLightGate.value=false;frame();const ungated=pixels();s.visual.dormantLightGate.value=true;frame();const gated=pixels();const lightGateDiff=diff(ungated,gated);
  toggle(false);frame();const before=pixels(),beforePng=png();toggle(true);frame();const after=pixels(),afterPng=png();
  const comparison=diff(before,after);
  const cameraPose=s.camera.quaternion.clone(),angleDiffs=[];
  for(const [name,yaw,pitch] of [['left',.9,0],['right',-.9,0],['overhead',0,.7],['panel',0,-.55],['rear',3,0]]){s.camera.quaternion.copy(cameraPose).multiply(new s.THREE.Quaternion().setFromEuler(new s.THREE.Euler(pitch,yaw,0,'YXZ')));s.camera.updateMatrixWorld(true);toggle(false);frame();const a=pixels();toggle(true);frame();angleDiffs.push({name,...diff(a,pixels())});}
  s.camera.quaternion.copy(cameraPose);s.camera.updateMatrixWorld(true);frame();
  const water=s.visual.glassWater;
  const dryCalls=r.info.render.calls;
  const wetStep=(rain,V,dt)=>{water.update(dt,{rain,V,sun:s.env.sunDir,daylight:1,near:true});frame();return{wet:water.wet,time:water.time,active:water.active,draws:r.info.render.calls,mode:water.mode,rt:water.rt,png:png(),pixels:pixels()};};
  const rainStart=wetStep(1,0,0.5),rainSoaked=wetStep(1,0,5),flow=wetStep(1,0,1.7),speed=wetStep(1,70,1.7),dryOut=wetStep(0,70,30);
  const wetDiff=diff(after,rainSoaked.pixels),motion=diff(rainSoaked.pixels,flow.pixels),flowDiff=diff(flow.pixels,speed.pixels);
  // First target after all preset mode changes must remain the overlay path.
  water.setMode(0);const overlayAtHigh=water.mode;
  const panes=water.meshes.map(m=>({name:m.parent.name,triangles:m.geometry.index.count/3}));
  const images={original:beforePng,batched:afterPng,'rain-start':rainStart.png,'rain-soaked':rainSoaked.png,'rain-flow':flow.png,'rain-speed':speed.png,'rain-dried':dryOut.png};
  const states=Object.fromEntries(Object.entries({rainStart,rainSoaked,flow,speed,dryOut}).map(([k,v])=>[k,{wet:v.wet,time:v.time,active:v.active,draws:v.draws}]));
  s.post.configure({enabled:true,msaa:0,ao:0,bloom:0,smaa:false});water.setMode(0);water.update(5,{rain:1,V:0,sun:s.env.sunDir,daylight:1,near:true});let mainDraws=0;const renderOriginal=r.render;r.render=function(sc,cam){if(sc===s.scene&&cam===s.camera)mainDraws++;return renderOriginal.call(this,sc,cam);};frame();const postRainPng=png();r.render=renderOriginal;const postRain={mainDraws,mode:water.mode,noRainTarget:water.rt===null};s.post.configure({enabled:false});
  const litStates=[];for(const level of [0,.6,1]){s.visual.setLights({landing:level,taxi:level,wingInspection:level,cockpitDome:level,cockpitDomeRed:level,instruments:level});s.f27LightRig.update(part);s.visual.dormantLightGate.value=false;frame();const a=pixels();s.visual.dormantLightGate.value=true;frame();litStates.push({level,diff:diff(a,pixels())});}
  images['post-enabled-rain']=postRainPng;
  const stat={shadowFrames,shadowDiff,angleDiffs,postRain,litStates,rounds,lightGate,lightGateDiff,comparison,wetDiff,motion,flowDiff,dryCalls,overlayAtHigh,panes,states,batches:b.batches.length,sources:b.sources.length,savedSubmissions:b.savedSubmissions,renderSize:[r.domElement.width,r.domElement.height],images,frameError:window.__frameErr||null,shaderErrors:window.__smokeShaderErrors,contextEvents:window.__smokeContextEvents};
  toggle(true);return stat;
 });
 for(const [name,png] of Object.entries(report.images))await fs.writeFile(path.join(outDir,name+'.png'),Buffer.from(png.split(',')[1],'base64'));
 delete report.images;report.weatherIntegration=weatherIntegration;
 if(report.shadowDiff.mean>.2||report.shadowDiff.pixelsAbove2>1000||report.angleDiffs.some(d=>d.mean>.2||d.pixelsAbove2>1000)||report.postRain.mainDraws!==1||!report.postRain.noRainTarget||report.postRain.mode!==1||report.litStates.some(s=>s.diff.max!==0)||report.lightGateDiff.max!==0||!report.weatherIntegration.postBound||report.comparison.mean>0.2||report.comparison.pixelsAbove2>1000||report.wetDiff.pixelsAbove2<30||report.motion.pixelsAbove2<30||report.flowDiff.pixelsAbove2<30||report.states.dryOut.active||report.overlayAtHigh!==1||report.shaderErrors.length||report.contextEvents.length||report.frameError)throw Error('Cockpit batching/rain visual assertions failed');
 console.log(JSON.stringify(report,null,2));
} catch(e){report={...report,failure:e.stack,errors};console.error(e);process.exitCode=1;}
finally {await browser?.close();await new Promise(r=>server.close(r));await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');}
