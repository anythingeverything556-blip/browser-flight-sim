import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { SECURITY_HEADERS } from '../functions/_lib/embed-policy.js';

const outDir=process.env.SMOKE_OUTPUT_DIR || '/tmp/earthwing-smoke';
await fs.mkdir(outDir,{recursive:true});
const injected=process.argv.includes('--inject-failure');
const aircraft=process.env.SMOKE_AIRCRAFT || 'c172';
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
 page=await browser.newPage();await page.setViewport(['da40','f27'].includes(aircraft)?{width:1280,height:800}:{width:960,height:640});
 if(aircraft==='a380x')await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 page.on('pageerror',e=>errors.push({kind:'page',detail:e.message}));
 page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',detail:m.text(),url:m.location().url});});
 await page.evaluateOnNewDocument(()=>{window.__smokeShaderErrors=[];window.__smokeContextEvents=[];document.addEventListener('webglcontextlost',()=>window.__smokeContextEvents.push('lost'),true);document.addEventListener('webglcontextrestored',()=>window.__smokeContextEvents.push('restored'),true);});
 page.on('requestfailed',r=>{const entry={kind:'request',detail:r.url(),reason:r.failure()?.errorText};if(new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/api/traffic'&&entry.reason==='net::ERR_ABORTED')expectedCancellations.push(entry);else errors.push(entry);});
 await page.setRequestInterception(true);
 page.on('request',async r=>{try{if(new URL(r.url()).origin===origin||/^(data:|blob:)/.test(r.url()))await r.continue();else{requests.push(r.resourceType());await r.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'image/png',body:Buffer.from(png(),'base64')});}}catch(e){errors.push({kind:'harness',detail:e.message});if(page){report=await page.evaluate(()=>({load:document.querySelector('#loadmsg')?.textContent,events:window.__earthwingDebug?.events(),shaderErrors:window.__smokeShaderErrors,contextEvents:window.__smokeContextEvents,frameError:window.__frameErr||null,partial:window.__sim?{started:__sim.state.started,pending:!!__sim.state.pending,view:__sim.rig.view,viewStatus:__sim.visual.viewStatus,modelTriangles:__sim.visual.stats?.tris,frame:__sim.renderer.info.render.frame,drawCalls:__sim.renderer.info.render.calls}:null})).catch(()=>null);await page.screenshot({path:path.join(outDir,'smoke-failed.png')}).catch(()=>{});}}});
 await page.evaluateOnNewDocument(({origin,png,aircraft})=>{
   localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',gfxV3:true,rscale:['da40','f27'].includes(aircraft)?0.85:0.5,...(['da40','f27'].includes(aircraft)?{cmap:false}:{}),metarAuto:false,buildings:false,trees:false,clouds:0,traffic:false,...(aircraft==='f27'?{dynres:false}:{})}));
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
 if(aircraft==='a380x'||aircraft==='da40'){await page.evaluate(()=>__sim.setView('chase'));await page.waitForFunction(()=>__sim.rig.view==='chase');await page.screenshot({path:path.join(outDir,aircraft+'-exterior.png')});console.log(aircraft+' flight started');}
 const verifyGameplay=async(view)=>{const before=await page.evaluate(()=>({frame:__sim.renderer.info.render.frame,fuel:__sim.fdm.fuel}));await page.evaluate(()=>__sim.advance(1));await page.waitForFunction(frame=>__sim.renderer.info.render.frame>frame&&!window.__frameErr,{timeout:30000},before.frame);const after=await page.evaluate(()=>({frame:__sim.renderer.info.render.frame,fuel:__sim.fdm.fuel,view:__sim.rig.view,frameError:window.__frameErr||null,calls:__sim.renderer.info.render.calls}));const check={view,before,after,passed:after.frame>before.frame&&after.fuel<before.fuel&&after.calls>0&&!after.frameError};gameplayChecks.push(check);if(!check.passed)errors.push({kind:'verification',detail:aircraft+' gameplay did not advance in '+view});};
 if(aircraft==='da40'){
   await verifyGameplay('chase');
   await page.evaluate(()=>{const s=__sim;s.setView('orbit');const forward=new s.THREE.Vector3(1,0,0).applyQuaternion(s.fdm.quat);Object.assign(s.rig.orbit,{az:Math.atan2(forward.x,forward.z)+0.85,el:0.23,dist:13});});
   await page.waitForFunction(()=>__sim.rig.view==='orbit');
   await page.screenshot({path:path.join(outDir,'da40-exterior.png')});
 }

 if(aircraft==='f27'){
   await page.evaluate(()=>{const s=__sim;s.setView('orbit');const forward=new s.THREE.Vector3(1,0,0).applyQuaternion(s.fdm.quat);Object.assign(s.rig.orbit,{az:Math.atan2(forward.x,forward.z)+0.75,el:0.18,dist:45});});
   await page.waitForFunction(()=>__sim.rig.view==='orbit');
   await verifyGameplay('orbit');
   await page.waitForFunction(()=>['ready','partial','failed'].includes(__sim.audio.f27?.status),{timeout:30000});
   const originalAudio=f27Checks.audio=await page.evaluate(async()=>{
     const audio=__sim.audio,f=audio.f27, a=audio.ctx.createAnalyser(); a.fftSize=1024;
     audio.master.connect(a); await new Promise(r=>setTimeout(r,500));
     const wave=new Float32Array(a.fftSize); a.getFloatTimeDomainData(wave); audio.master.disconnect(a);
     return {status:f.status,decoded:f.buffers.size,expected:f.manifest?.samples.length,decodeErrors:[...f.errors],peak:Math.max(...wave.map(Math.abs)),voices:f.voices.map(v=>({engine:v.group.engine,view:v.group.view,layers:v.clips.size,active:[...v.clips.values()].some(c=>c.gain.gain.value>1e-5)}))};
   });
   if(originalAudio.status!=='ready'||originalAudio.decoded!==originalAudio.expected||originalAudio.decoded<18||originalAudio.peak<1e-4||originalAudio.voices.length!==4||!originalAudio.voices.every(v=>v.layers>=4&&(v.view!=='outside'||v.active)))errors.push({kind:'verification',detail:'Original F27 audio check '+JSON.stringify(originalAudio)});
   f27ExteriorRequests=[...modelRequests];
   if(!f27ExteriorRequests.includes('/models/f27/f27-white-ext-v3.glb'))errors.push({kind:'verification',detail:'F27 exterior model was not requested'});
   if(!f27ExteriorRequests.includes('/models/f27/f27-white-vc-v2.glb'))errors.push({kind:'verification',detail:'F27 cockpit transfer did not start in the background'});
   const lighting=f27Checks.lighting=await page.evaluate(async()=>{
     const sim=__sim, button=key=>document.querySelector(`[data-f27-light="${key}"]`), put=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     document.querySelector('#f27-rail').click();
     const opened=document.querySelector('#sheet-f27').classList.contains('open');
     const baseline=new Set(sim.renderer.info.programs.map(p=>p.id));
     button('landing').click(); button('taxi').click(); await put();
     const beams=sim.terrain.material.uniforms.uF27Beam.value.map(v=>v.w);
     const pressed=button('landing').getAttribute('aria-pressed')==='true';
     const input=document.querySelector('#f27-panel-light'); input.value='60'; input.dispatchEvent(new Event('input',{bubbles:true}));
     const instrument=Math.abs(sim.visual.lights.instruments-0.60)<1e-8;
     document.querySelector('#f27-day-lights').click(); await put();
     const off=sim.terrain.material.uniforms.uF27Beam.value.every(v=>v.w===0);
     const control=sim.terrain.material.uniforms.uF27Contact.value.w;
     return {opened,beams,pressed,instrument,off,control,newPrograms:sim.renderer.info.programs.filter(p=>!baseline.has(p.id)).length,pool:[sim.f27LightRig.spots.length,sim.f27LightRig.points.length]};
   });
   if(!lighting.opened||!lighting.beams.every(v=>v>0)||!lighting.pressed||!lighting.instrument||!lighting.off||lighting.control<=0)errors.push({kind:'verification',detail:'F27 systems/terrain lighting test '+JSON.stringify(lighting)});
   await page.screenshot({path:path.join(outDir,'f27-systems.png')});
   await page.evaluate(()=>{__sim.openSheet(null); window.__realLevelAt=__sim.terrain.levelAt; __sim.terrain.levelAt=()=>13;});
   await page.waitForFunction(()=>__sim.terrain.material.uniforms.uF27RunwayStyle.value.z>0.30,{timeout:10000});
   const current=await page.evaluate(()=>({active:__sim.f27Livery?.current,bindings:__sim.f27Livery?.bindings,select:document.querySelector('#f27-livery-systems-choice')?.value}));
   if(current.active!=='air-inter-1980'||current.bindings<6||current.select!==current.active)errors.push({kind:'verification',detail:'F27 default colored livery '+JSON.stringify(current)});
   await page.screenshot({path:path.join(outDir,'f27-exterior.png')});
   f27Checks.runwayContact=await page.evaluate(()=>{
     const s=__sim, m=s.f27RunwayMesh(), p=s.fdm.pos;
     m.updateWorldMatrix(true,false);
     const ray=new s.THREE.Raycaster(new s.THREE.Vector3(p.x-s.rig.world.x,p.y+20-s.rig.world.y,p.z-s.rig.world.z),new s.THREE.Vector3(0,-1,0));
     const hit=ray.intersectObject(m)[0];
     const label=['Center','Left','Right'];
     s.visual.root.updateMatrixWorld(true);
     return {visible:m.visible,collisionToInfillM:hit?hit.point.y+s.rig.world.y-s.state.lastGround:null,grounded:s.fdm.onGround,tireToInfillM:hit?label.map(n=>{const t=s.visual.exterior.root.getObjectByName(`GEAR_${n}_Tire_Still`)||s.visual.exterior.root.getObjectByName(`GEAR_${n}_Tire_Base`);return new s.THREE.Box3().setFromObject(t,true).min.y-hit.point.y;}):null};
   });
   const contact=f27Checks.runwayContact;
   if(!contact.visible||contact.collisionToInfillM===null||Math.abs(contact.collisionToInfillM)>0.03||!contact.grounded||contact.tireToInfillM.some(x=>Math.abs(x)>0.065))errors.push({kind:'verification',detail:'F27 rendered runway depth '+JSON.stringify(contact)});
   await page.evaluate(()=>{__sim.terrain.levelAt=()=>16;window.__heightBefore=__sim.terrain.drawnHeightAt;__sim.terrain.drawnHeightAt=(lat,lon)=>__sim.terrain.heightAt(lat,lon);});
   await page.waitForFunction(()=>__sim.terrain.material.uniforms.uF27RunwayStyle.value.z<0.10,{timeout:10000});
   f27Checks.runwayBlendBothWays=true;
   await page.evaluate(()=>{__sim.terrain.levelAt=window.__realLevelAt; __sim.terrain.drawnHeightAt=window.__heightBefore; delete window.__realLevelAt; delete window.__heightBefore;});
 }
 if(!a380ExteriorOnly){
 if(aircraft==='f27') await page.waitForFunction(()=>__sim.f27CameraReady(),{timeout:75000});
 await page.evaluate(()=>__sim.setView('cockpit'));await page.waitForFunction(()=>window.__earthwingDebug.events().some(e=>e.name==='cockpit_reached'),{timeout:15000});
 if(aircraft==='a380x'){await page.waitForFunction(()=>__sim.visual.viewStatus.cockpit==='ready',{timeout:300000});console.log('A380X cockpit and cabin assets ready');}
 await new Promise(r=>setTimeout(r,600));

 if(aircraft==='f27'){
   await page.waitForFunction(()=>__sim.rig.view==='cockpit' && !!__sim.visual.interior,{timeout:45000});
   if(!modelRequests.has('/models/f27/f27-white-vc-v2.glb'))errors.push({kind:'verification',detail:'F27 cockpit view did not request the cockpit asset'});
   f27Checks.cockpit=await page.evaluate(async()=>{
     const s=__sim, seat=document.querySelector('#f27-seat-height'), yoke=s.visual.interior.root.getObjectByName('x0_Yoke01_Column');
     const delta=()=>s.camera.position.clone().add(s.rig.world).sub(s.fdm.pos).applyQuaternion(s.fdm.quat.clone().invert()).y;
     const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const change=value=>{seat.value=value;seat.dispatchEvent(new Event('input',{bubbles:true}));};
     await frame(); const before=delta(), pilotPitch=s.rig.look.pitch, target=s.renderer.getPixelRatio(), pilotYoke=yoke?.visible;
     change(-12); seat.dispatchEvent(new Event('change',{bubbles:true})); await frame(); const after=delta(), stored=JSON.parse(localStorage.getItem('sr71sim.f27-seat-cm'));
     document.querySelector('#f27-seat-reset').click(); await frame();
     document.querySelector('#f27-panel-view').click(); await frame();
     return {seatChange:after-before,defaultOffsetY:before-s.visual.eye.y,stored,range:[+seat.min,+seat.max],pilotPitch,panelPitch:s.rig.look.pitch,panelRatio:s.renderer.getPixelRatio(),pilotYoke,panelYoke:yoke?.visible,target,
       loaded:s.visual.viewStatus.cockpit==='ready'&&s.f27CameraReady(),visible:s.visual.interior.root.visible};
   });
   if(!f27Checks.cockpit.loaded||!f27Checks.cockpit.visible||Math.abs(f27Checks.cockpit.seatChange+0.12)>0.02||Math.abs(f27Checks.cockpit.defaultOffsetY+0.16)>0.02||f27Checks.cockpit.stored!==-12||f27Checks.cockpit.panelPitch>f27Checks.cockpit.pilotPitch-0.20||f27Checks.cockpit.panelRatio!==f27Checks.cockpit.target||!f27Checks.cockpit.pilotYoke||f27Checks.cockpit.panelYoke!==false)errors.push({kind:'verification',detail:'F27 seat/cockpit check '+JSON.stringify(f27Checks.cockpit)});
   f27Checks.gauges=await page.evaluate(async()=>{
     const s=__sim, part=s.visual.interior, gauges=part.adapter.instruments;
     const node=part.root.getObjectByName('x0_RPM_01_Aig');
     const settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     await settle(); const before=node.quaternion.clone(), values=gauges.values;
     const engine=s.fdm.engines[0], save=engine.rpm;
     engine.rpm=11000; part.adapter.updateInstruments(s.fdm,{iasKt:135,pitchDeg:8,bankDeg:-12,headingDeg:213,radioAltFt:420,localTimeSeconds:55212},0);part.adapter.evaluatePose();
     const rmsNeedleTravel=before.angleTo(node.quaternion), changed=gauges.values; engine.rpm=save;
     return {animatedClipCount:Object.keys(values).length,checkedAirData:Number.isFinite(values.x0_IAS_01_Aig1)&&Number.isFinite(values.x0_RALT_01_Aig),rpmTravel:rmsNeedleTravel,independentRpm:changed.x0_RPM_01_Aig!==changed.x0_RPM_02_Aig,heading:changed.x0_HSI_01_ROSE,gear:!!gauges.annunciators.x0_GearInd_w_gr_p_on};
   });
   const gi=f27Checks.gauges;
   if(gi.animatedClipCount<90||!gi.checkedAirData||gi.rpmTravel<0.1||!gi.independentRpm||Math.abs(gi.heading-213/360)>1e-9||!gi.gear)errors.push({kind:'verification',detail:'F27 instrument integration '+JSON.stringify(gi)});
   await page.screenshot({path:path.join(outDir,'f27-instruments.png')});
   await page.evaluate(()=>document.querySelector('#f27-cockpit-view').click());
   await page.waitForFunction(()=>__sim.rig.look.pitch===-0.25&&__sim.rig.view==='cockpit');
   await page.screenshot({path:path.join(outDir,'f27-cockpit.png')});
   const captureControls=()=>page.evaluate(()=>{
     const root=__sim.visual.interior.root;
     const names=['x0_Yoke_Base','x0_Yoke01_Upper','x0_Yoke02_Upper','x0_Rudder_Ped01','x0_Rudder_Ped02','x0_Rudder_Ped03','x0_Rudder_Ped04'];
     return {pose:names.map(n=>root.getObjectByName(n).quaternion.toArray()),axes:{...__sim.controls.axes}};
   });
   const initial=await captureControls();
   for(const key of ['ArrowDown','ArrowRight','Period']) await page.keyboard.down(key);
   try {
     await page.waitForFunction(()=>{const a=__sim.controls.axes;return a.pitch>.7&&a.roll>.7&&a.yaw>.5;},{timeout:16000});
     f27Checks.pilotControls={initial,held:await captureControls()};
     await page.screenshot({path:path.join(outDir,'f27-yoke-and-pedals.png')});

   } finally {for(const key of ['ArrowDown','ArrowRight','Period']) await page.keyboard.up(key);}
   await page.waitForFunction(()=>{const a=__sim.controls.axes;return Math.abs(a.pitch)+Math.abs(a.roll)+Math.abs(a.yaw)<.07;},{timeout:26000});
   f27Checks.paint=await page.evaluate(async()=>{
     const s=__sim, node=document.querySelector('#f27-livery-systems-choice'), picks=['ext_T5_Fuselage','ext_T5_Fuselage_int'];
     const material=(part,name)=>{let m;part.root.traverse(o=>{for(const mat of (Array.isArray(o.material)?o.material:[o.material])) if(mat?.name===name)m=mat;});return m;};
     const mats=picks.map((n,i)=>material(i===0?s.visual.exterior:s.visual.interior,n));
     const read=()=>mats.map(m=>[m.map.name,m.version]);
     const change=async name=>{node.value=name;node.dispatchEvent(new Event('change',{bubbles:true}));for(let i=0;i<20&&s.f27Livery.current!==name;i++)await new Promise(r=>requestAnimationFrame(r));};
     const colored=read();await change('white');const white=read();await change('air-inter-1980');
     return {visitedWhite:white.every(m=>!m[0].startsWith('Air Inter')),restored:JSON.stringify(colored)===JSON.stringify(read()),sameVersion:colored.every((m,i)=>m[1]===white[i][1]),saved:JSON.parse(localStorage.getItem('sr71sim.f27-livery')),bindings:s.f27Livery.bindings};
   });
   if(!f27Checks.paint.visitedWhite||!f27Checks.paint.restored||!f27Checks.paint.sameVersion||f27Checks.paint.saved!=='air-inter-1980'||f27Checks.paint.bindings<12)errors.push({kind:'verification',detail:'F27 matched live livery switching '+JSON.stringify(f27Checks.paint)});
   const held=f27Checks.pilotControls.held.pose, base=initial.pose;
   if(!(held[0][0]<base[0][0]-.035&&held[1][2]>base[1][2]+.15&&held[2][2]>base[2][2]+.15&&held[3][0]*held[4][0]<-.012&&held[5][0]*held[6][0]<-.012))errors.push({kind:'verification',detail:'F27 physical cockpit control direction '+JSON.stringify(f27Checks.pilotControls)});

 }
 if(['a380x','da40','f27'].includes(aircraft))await verifyGameplay('cockpit');
 if(aircraft==='f27') {
   f27Checks.viewSwitch=await page.evaluate(async()=>{
     const s=__sim, r=s.renderer, resize=r.setSize, adapt=s.settings.dynres;
     const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     let resizes=0; s.settings.dynres=false;
     r.setSize=function(...args){resizes++;return resize.apply(this,args);};
     try {
       const before=r.info.render.frame, removeCover=()=>!s.f27View.active;
       const external=await s.setView('orbit'); await wait(); const outside=s.rig.view;
       const internal=await s.setView('cockpit'); await wait();
       return {resizes,outside,inside:s.rig.view,frames:r.info.render.frame-before,states:[external?.status,internal?.status],ready:removeCover()};
     } finally {r.setSize=resize;s.settings.dynres=adapt;}
   });
   if(f27Checks.viewSwitch.resizes||f27Checks.viewSwitch.outside!=='orbit'||f27Checks.viewSwitch.inside!=='cockpit'||f27Checks.viewSwitch.frames<2||!f27Checks.viewSwitch.states.every(x=>x==='shown')||!f27Checks.viewSwitch.ready)errors.push({kind:'verification',detail:'F27 view-switch target reset '+JSON.stringify(f27Checks.viewSwitch)});
   f27Checks.rundown=await page.evaluate(async()=>{
     const s=__sim, f=s.fdm, a=s.audio.f27;
     const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const snapshot=()=>({rpm:f.engines.map(e=>e.propRpm),lit:f.engines.map(e=>e.lit),phase:s.visual.propDisplayPhase.slice(),
       cabin:a.voices.filter(v=>v.group.view==='inside').map(v=>Math.max(0,...[...v.clips.values()].map(c=>c.gain.gain.value)))});
     await wait(); const before=snapshot(); document.querySelector('#f27-engines').click();
     const immediate=snapshot(); await wait(); const tail=snapshot();
     s.advance(1.2);await wait();const winding=snapshot();
     s.advance(8.8);await wait();const late=snapshot();
     return {before,immediate,tail,winding,late};
   });
   const t=f27Checks.rundown;
   if(t.immediate.lit.some(Boolean)||!t.immediate.rpm.every((rpm,i)=>rpm>t.before.rpm[i]*0.92)||!t.tail.cabin.every(x=>x>1e-4)||!t.winding.rpm.every((rpm,i)=>rpm>20&&rpm<t.before.rpm[i]*0.8)||!t.late.rpm.every((rpm,i)=>rpm<t.winding.rpm[i]*0.20)||!t.tail.phase.every((phi,i)=>Math.abs(phi-t.before.phase[i])>0.005))errors.push({kind:'verification',detail:'F27 audible moving shutdown '+JSON.stringify(t)});
   f27Checks.gear = await page.evaluate(async()=>{
     const s=__sim,f=s.fdm,paused=s.state.paused;
     const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     const read=()=>({position:f.gearPos,command:f.gearDown,status:document.querySelector('#f27-gear-status').textContent,pill:document.querySelector('#p-gear').textContent,lever:s.visual.interior.adapter.instruments.values.LANDING_GEAR_Lever_Gear});
     const button=()=>document.querySelector('#f27-gear').click();
     const step=seconds=>{for(let i=0;i<Math.round(seconds*120);i++)f.step(1/120,()=>-10000,new s.THREE.Vector3());};
     try{
       s.state.paused=true;f.reset(new s.THREE.Vector3(0,3,0),90,0,true);button();await wait();const ground=read();
       f.reset(new s.THREE.Vector3(0,5000,0),90,90,false);button();step(3.5);await wait();const extending=read();
       button();const before=f.gearPos;step(8.5);await wait();const reversed=read();
       button();step(7);await wait();const down=read();
       button();step(17);await wait();const up=read();
       return {ground,extending,reversed,down,up,reversalStart:before,staticLeafMeshes:s.visual.interior.staticMatrices};
     }finally{s.state.paused=paused;}
   });
   const g=f27Checks.gear;
   if(g.ground.position!==1||!g.ground.command||Math.abs(g.extending.position-.5)>1e-8||!g.extending.status.includes('extending')||g.extending.lever!==1||g.reversalStart!==g.extending.position||g.reversed.position!==0||!g.reversed.status.includes('stowed')||g.down.position!==1||!g.down.status.includes('locked')||g.up.position!==0||g.up.pill!=='GEAR UP'||g.staticLeafMeshes<500)errors.push({kind:'verification',detail:'F27 live gear controls/status '+JSON.stringify(g)});

 }

 }else await verifyGameplay('chase');
 const panels=await page.evaluate(async()=>{const results=[];for(const id of ['flight','airports','map','ap','env','settings','help']){__sim.openSheet(id,true);await new Promise(resolve=>setTimeout(resolve,80));results.push({id,open:document.getElementById('sheet-'+id).classList.contains('open'),active:!!document.querySelector('#rail [data-sheet="'+id+'"].on')});}__sim.openSheet(null);return results;});
 panelResults=panels;
 if(panels.some(panel=>!panel.open||!panel.active))errors.push({kind:'verification',detail:'Panel controller failed open/active state'});
 if(injected){
   await page.evaluate(()=>{
     console.error('Controlled smoke console failure');
     setTimeout(()=>{throw new Error('Controlled smoke page failure')},0);
     const {THREE,renderer}=__sim;const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,10);camera.position.z=2;
     const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.ShaderMaterial({vertexShader:'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',fragmentShader:'void main(){ gl_FragColor = definitely_missing; }'}));mesh.frustumCulled=false;scene.add(mesh);renderer.setRenderTarget(null);renderer.render(scene,camera);
   });await new Promise(r=>setTimeout(r,250));
 }
 report=await page.evaluate(()=>{const gl=__sim.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:gl instanceof WebGL2RenderingContext,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),started:__sim.state.started,pending:!!__sim.state.pending,aircraft:__sim.aircraft,modelTriangles:__sim.visual.stats?.tris||null,pilotDisplay:__sim.visual.displays?{width:__sim.visual.displays.w,height:__sim.visual.displays.h,frames:__sim.visual.displays.frames}:null,view:__sim.rig.view,renderFrame:__sim.renderer.info.render.frame,contextEvents:window.__smokeContextEvents,shaderErrors:window.__smokeShaderErrors,frameError:window.__frameErr||null,drawCalls:__sim.renderer.info.render.calls,programs:__sim.renderer.info.programs.length,failedPrograms:__sim.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length,events:window.__earthwingDebug.events()};});
 await page.screenshot({path:path.join(outDir,injected?'smoke-injected.png':'smoke-positive.png')});
 if(aircraft==='f27') {
   f27Checks.approach=await page.evaluate(()=>{
     const s=__sim, meta=s.state.lastSpawn.meta;const i=meta.rwy.ap.runways.indexOf(meta.rwy);
     s.spawnAt(meta.rwy.ap,i,meta.end,'approach'); const f=s.fdm, d=s.state.pending, chosen=f.flaps;
     const speed=f.vel.length()*1.943844492*Math.sqrt((1-2.25577e-5*d.alt)**4.25588);
     return {gear:f.gearDown,flaps:chosen,modeledVref:f.vref(),approxIas:speed,gamma:d.gamma};
   });
   if(!f27Checks.approach.gear||f27Checks.approach.flaps!==26.5||Math.abs(f27Checks.approach.approxIas-f27Checks.approach.modeledVref-15)>0.6)errors.push({kind:'verification',detail:'F27 manual-based approach placement '+JSON.stringify(f27Checks.approach)});
 }

 if(aircraft==='da40'){
   report.da40Displays=await page.evaluate(async()=>{
     const v=__sim.visual, before=Object.fromEntries(Object.entries(v.displays||{}).map(([id,d])=>[id,d.texture.version]));
     const end=performance.now()+16000;
     while(performance.now()<end && Object.entries(v.displays||{}).some(([id,d])=>d.texture.version<=before[id])) await new Promise(r=>requestAnimationFrame(r));
     return Object.fromEntries(Object.entries(v.displays||{}).map(([id,d])=>[id,{width:d.canvas.width,height:d.canvas.height,active:d.texture.version>before[id],state:!!v.lastDisplayState}]));
   });
   if(!report.da40Displays.pfd?.active||!report.da40Displays.mfd?.active||!report.da40Displays.pfd?.state)errors.push({kind:'verification',detail:'The two DA40 live display textures did not update'});
   const {verifyDA40Motion}=await import('./da40-qa-motion.mjs');
   da40Motion=await verifyDA40Motion(page);
   for(const check of da40Motion.checks)if(!check.passed)errors.push({kind:'verification',detail:check.name});
 }

 if(aircraft==='a380x'&&!a380ExteriorOnly){await page.evaluate(()=>__sim.setView('cabin'));await page.waitForFunction(()=>__sim.visual.viewStatus.cabin==='ready'&&__sim.rig.view==='cabin',{timeout:15000});await verifyGameplay('cabin');await page.screenshot({path:path.join(outDir,'a380x-cabin.png')});report.cabin=await page.evaluate(()=>({frameError:window.__frameErr||null,frame:__sim.renderer.info.render.frame,view:__sim.rig.view,drawCalls:__sim.renderer.info.render.calls,shaderErrors:window.__smokeShaderErrors}));}
 if(report.frameError)errors.push({kind:'frame',detail:report.frameError});
 if(report.failedPrograms||report.events.some(e=>e.name==='graphics_error'))errors.push({kind:'shader',detail:'Shader/program diagnostics failed'});
 if(!report.webgl2||!report.drawCalls||!report.programs||!report.renderer.includes('SwiftShader'))errors.push({kind:'verification',detail:'Expected actual Chrome WebGL2 SwiftShader draw/program evidence'});
}catch(e){errors.push({kind:'harness',detail:e.message});if(page){report=await page.evaluate(()=>({load:document.querySelector('#loadmsg')?.textContent,events:window.__earthwingDebug?.events(),shaderErrors:window.__smokeShaderErrors,contextEvents:window.__smokeContextEvents,frameError:window.__frameErr||null,partial:window.__sim?{started:__sim.state.started,pending:!!__sim.state.pending,view:__sim.rig.view,viewStatus:__sim.visual.viewStatus,modelTriangles:__sim.visual.stats?.tris,frame:__sim.renderer.info.render.frame,drawCalls:__sim.renderer.info.render.calls}:null})).catch(()=>null);await page.screenshot({path:path.join(outDir,'smoke-failed.png')}).catch(()=>{});}}
finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
if(report?.contextEvents?.includes('lost'))errors.push({kind:'graphics',detail:'WebGL context lost during original-resolution model rendering'});
const transfer=['a380x','da40','f27'].includes(aircraft)?{exteriorOnly:a380ExteriorOnly,requests:[...modelRequests],bytes:(await Promise.all([...modelRequests].map(p=>fs.stat(path.resolve(root,'.'+p)).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0)}:undefined;
if(process.env.SMOKE_A380X_EXPECT_GZIP==='1'&&(!transfer?.requests.some(p=>p.endsWith('/transport.json'))||!transfer.requests.some(p=>p.endsWith('.bin.gz'))||transfer.requests.some(p=>/\.(?:bin|dds|gltf)$/i.test(p))))errors.push({kind:'verification',detail:'Expected only lossless gzip model resource transfers'});
if(aircraft==='da40'&&(!transfer?.requests.includes('/models/da40/da40-ng.glb')||!transfer.bytes))errors.push({kind:'verification',detail:'Missing request for the actual served DA40 model'});
if(aircraft==='f27'&&f27ExteriorRequests){
 transfer.exteriorViewRequests=f27ExteriorRequests;
 transfer.exteriorModelBytes=(await Promise.all(f27ExteriorRequests.filter(p=>p.endsWith('ext-v3.glb')).map(p=>fs.stat(path.resolve(root,'.'+p)).then(s=>s.size).catch(()=>0)))).reduce((a,b)=>a+b,0);
 if(transfer.exteriorModelBytes<=0||transfer.exteriorModelBytes>3_000_000)errors.push({kind:'verification',detail:`F27 first-view asset budget failed: ${transfer.exteriorModelBytes} bytes`});
}
const result={transfer,da40Motion,softwareRendering:'Chrome / ANGLE SwiftShader (not real GPU/phone)',syntheticWorld:true,f27Checks:aircraft==='f27'?f27Checks:undefined,injected,report,panels:panelResults,gameplayChecks,errors,expectedCancellations,missingLocal,mockedExternalPageRequests:requests.length};
await fs.writeFile(path.join(outDir,injected?'smoke-injected.json':'smoke-positive.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));process.exitCode=errors.length?1:0;
