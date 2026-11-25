import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
const site=process.env.F27_PREVIEW_URL||'https://f27-preview.earthwing.pages.dev/';
const host=new URL(site); if (!/^https:\/\/f27-preview\.(earthwing|sr71-blackbird)\.pages\.dev\/$/.test(host.href)) throw Error('Expected public F27 preview only.');
const out=process.env.F27_VISUAL_OUT||'../../research/preview-visual-check'; await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,protocolTimeout:90000,args:['--no-sandbox','--disable-gpu-watchdog','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const evidence={softwareRenderer:'Chrome ANGLE SwiftShader',site,goodImageryResponses:[],browserErrors:[],warnings:[],assetRequests:[]};
let page;
try{
 page=await browser.newPage(); await page.setViewport({width:1100,height:720});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('sr71sim.settings',JSON.stringify({aircraft:'f27',gfx:'low',gfxV3:true,rscale:0.72,metarAuto:false,buildings:false,trees:false,clouds:0,traffic:false,cmap:false,voice:false,dynres:false})));
 page.on('pageerror',e=>evidence.browserErrors.push(e.message));
 page.on('console',m=>{if(m.type()==='warn'&&/F27|shader|asset|audio|texture/i.test(m.text()))evidence.warnings.push(m.text());});
 page.on('request',r=>{const u=new URL(r.url());if(u.origin===host.origin&&u.pathname.startsWith('/models/f27/'))evidence.assetRequests.push(u.pathname);});
 page.on('response',r=>{const u=new URL(r.url());if(r.status()===200&&/arcgisonline|maptiles|openfreemap/.test(u.hostname)&&/tile\//.test(u.pathname)&&evidence.goodImageryResponses.length<8)evidence.goodImageryResponses.push(u.hostname+u.pathname);});
 await page.goto(site+'?aircraft=f27',{waitUntil:'domcontentloaded',timeout:35000});
 await page.waitForFunction(()=>window.__simReady,{timeout:40000});
 await page.click('#start-btn');
 await page.waitForFunction(()=>__sim.state.started&&!__sim.state.pending,{timeout:50000});
 await page.evaluate(()=>{const s=__sim;s.setView('orbit');const f=new s.THREE.Vector3(1,0,0).applyQuaternion(s.fdm.quat);Object.assign(s.rig.orbit,{az:Math.atan2(f.x,f.z)+0.65,el:0.19,dist:35});s.openSheet(null);});
 await page.waitForFunction(()=>__sim.audio.f27?.status==='ready',{timeout:55000});
 await page.evaluate(()=>{ void __sim.setView('cockpit'); });
 await page.waitForFunction(()=>__sim.f27CameraReady?.(),{timeout:100000});
 await page.evaluate(()=>__sim.setView('orbit'));
 await page.waitForFunction(()=>__sim.rig.view==='orbit');
 const runwayZoom=()=>{const s=__sim,ll=s.geo.toLatLon(s.fdm.pos.x,s.fdm.pos.z);return s.terrain.levelAt(ll.lat,ll.lon,true);};
 const startZoom=await page.evaluate(runwayZoom);
 if(startZoom<14)await page.waitForFunction(()=>{const s=__sim,ll=s.geo.toLatLon(s.fdm.pos.x,s.fdm.pos.z);return s.terrain.levelAt(ll.lat,ll.lon,true)>=14;},{timeout:8000,polling:500}).catch(()=>{});
 evidence.runwayTexturedZoom={started:startZoom,checked:await page.evaluate(runwayZoom)};
 evidence.audio=await page.evaluate(async()=>{const audio=__sim.audio, f=audio.f27,a=audio.ctx.createAnalyser();a.fftSize=1024;audio.master.connect(a);await new Promise(r=>setTimeout(r,450));const wave=new Float32Array(a.fftSize);a.getFloatTimeDomainData(wave);audio.master.disconnect(a);return {status:f.status,decoded:f.buffers.size,expected:f.manifest.samples.length,peak:Math.max(...wave.map(Math.abs)),engineLayers:f.voices.filter(v=>v.group.view==='outside').map(v=>[...v.clips.values()].some(c=>c.gain.gain.value>1e-5))};});
 evidence.paint=await page.evaluate(()=>({id:__sim.f27Livery.current,bindings:__sim.f27Livery.bindings,selected:document.querySelector('#f27-livery-setup-choice').value}));
 await page.screenshot({path:out+'/f27-runway.png'});
 evidence.runway=await page.evaluate(()=>{const sim=__sim;sim.visual.root.updateMatrixWorld(true);const part=sim.visual.exterior,names=['Center','Left','Right'];
   const tireGroundClearanceM=names.map(label=>{const mesh=part.root.getObjectByName(`GEAR_${label}_Tire_Still`)||part.root.getObjectByName(`GEAR_${label}_Tire_Base`);return new sim.THREE.Box3().setFromObject(mesh,true).min.y+sim.rig.world.y-sim.state.lastGround;});
   const patch=sim.f27RunwayMesh(), p=sim.fdm.pos, ll=sim.geo.toLatLon(p.x,p.z);
   let rendered=sim.terrain.drawnHeightAt(ll.lat,ll.lon,sim.rig.world);
   if(patch?.visible){patch.updateWorldMatrix(true,false);const ray=new sim.THREE.Raycaster(new sim.THREE.Vector3(p.x-sim.rig.world.x,p.y+20-sim.rig.world.y,p.z-sim.rig.world.z),new sim.THREE.Vector3(0,-1,0)); const hit=ray.intersectObject(patch)[0];if(hit)rendered=hit.point.y+sim.rig.world.y;}
   return {aircraft:sim.aircraft,onGround:sim.fdm.onGround,compression:sim.fdm.compress,tireGroundClearanceM,scenery:sim.terrain.sceneryProgress(2500),imageryFallback:sim.terrain.imageryFallback,runwayFallbackBlend:sim.terrain.material.uniforms.uF27RunwayStyle.value.z,renderedSurfaceOffsetM:rendered==null?null:rendered-sim.state.lastGround,propPhases:sim.visual.propDisplayPhase.slice(),view:sim.rig.view,frameError:window.__frameErr||null,agl:document.querySelector('#d-alt2')?.textContent};});
 evidence.propPhasesAfter=await page.evaluate(()=>__sim.visual.propDisplayPhase.slice());
 evidence.cockpitBeforeSwitch=await page.evaluate(()=>__sim.visual.viewStatus.cockpit);
 await page.evaluate(()=>{__sim.setView('cockpit');});
 await page.waitForFunction(()=>__sim.rig.view==='cockpit'&&!!__sim.visual.interior,{timeout:45000});
 await page.screenshot({path:out+'/f27-cockpit.png'});
 evidence.instrumentView=await page.evaluate(async()=>{
   const s=__sim, p=s.visual.interior, f=s.fdm, a=p.adapter.instruments;
   const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const originalRpm=f.engines[0].rpm;
   document.querySelector('#f27-panel-view').click();await wait(); while(s.f27View.pending)await wait();
   const vals=a.values, captured={tracks:Object.keys(vals).length,radioAltTrack:vals.x0_RALT_01_Aig,flapTrack:vals.x0_Flaps_Aig,headingTrack:vals.x0_HSI_01_ROSE,yokeVisible:p.root.getObjectByName('x0_Yoke01_Column').visible,pitch:s.rig.look.pitch, rpm:originalRpm};
   return captured;
 });
 await page.screenshot({path:out+'/f27-instruments.png'});
 if(await page.$('#f27-panel-light')){
   await page.click('#f27-rail');
   await page.screenshot({path:out+'/f27-systems.png'});
 }
 evidence.night=await page.evaluate(async()=>{
   const s=__sim, t=document.querySelector('#tod'), button=k=>document.querySelector(`[data-f27-light="${k}"]`);
   const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   s.openSheet(null); t.value=23;t.dispatchEvent(new Event('input',{bubbles:true}));
   button('cockpitDomeRed').click();const g=document.querySelector('#f27-panel-light');g.value=65;g.dispatchEvent(new Event('input',{bubbles:true}));
   await wait(); return {hour:s.env.hour,dim:s.visual.lights.instruments,red:s.visual.lights.cockpitDomeRed,lights:[s.f27LightRig.spots.length,s.f27LightRig.points.length]};
 });
 await page.screenshot({path:out+'/f27-night-panel.png'});
 evidence.transition=await page.evaluate(async()=>{
   const s=__sim, a=await s.setView('orbit'), b=await s.setView('cockpit');return {orbit:a?.status,cockpit:b?.status,view:s.rig.view,noPending:s.f27View.pending===null};
 });
 evidence.calloutSetup=await page.evaluate(()=>{
   const audio=__sim.audio;return {clips:Object.keys(audio.calloutClips).filter(x=>/^h\d+$/.test(x)).sort()};
 });
 evidence.shutdown=await page.evaluate(async()=>{
   const s=__sim, f=s.fdm, before=f.engines.map(e=>e.propRpm);document.querySelector('#f27-engines').click();
   const cutoff=f.engines.map(e=>e.propRpm);s.advance(1.2);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return {before,cutoff,coasting:f.engines.map(e=>e.propRpm),lit:f.engines.map(e=>e.lit)};
 });
 if(evidence.paint.id!=='air-inter-1980'||evidence.paint.selected!==evidence.paint.id||evidence.transition.orbit!=='shown'||evidence.transition.cockpit!=='shown'||!evidence.transition.noPending||evidence.calloutSetup.clips.join(',')!=='h10,h100,h20,h30,h40,h50')throw Error('V4 live livery, views, or audio routing verification failed.');
 if(!evidence.assetRequests.includes('/models/f27/f27-white-ext-v3.glb')||evidence.instrumentView.tracks<90||evidence.instrumentView.yokeVisible||Math.abs(evidence.instrumentView.pitch+0.5)>0.001||!evidence.night.red||!evidence.shutdown.cutoff.every((v,i)=>v===evidence.shutdown.before[i])||!evidence.shutdown.coasting.every((v,i)=>v>0&&v<evidence.shutdown.cutoff[i])||evidence.shutdown.lit.some(Boolean)||await page.evaluate(()=>!!window.__frameErr))throw Error('V3 cockpit, lighting or rundown check failed.');
 if(evidence.runway.frameError||!evidence.runway.onGround||evidence.runway.renderedSurfaceOffsetM===null||Math.abs(evidence.runway.renderedSurfaceOffsetM)>0.16||evidence.runway.tireGroundClearanceM.some(v=>Math.abs(v)>0.065)||evidence.audio.decoded!==evidence.audio.expected||evidence.audio.peak<1e-4||!evidence.audio.engineLayers.every(Boolean)||evidence.cockpitBeforeSwitch!=='ready'||evidence.browserErrors.length)throw Error('Preview gameplay checks did not all pass; inspect collected results.');
}catch(e){evidence.failure=e.message; if(page)evidence.partial=await page.evaluate(()=>{const {state,visual,audio,f27CameraReady,renderer}=__sim??{};return {started:state?.started,pending:!!state?.pending,frame:renderer?.info?.render?.frame,ready:f27CameraReady?.(),cockpitStatus:visual?.viewStatus?.cockpit,audio:audio?.f27?.status,errors:audio?.f27?.errors,frameError:window.__frameErr||null};}).catch(()=>null);}
finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));}
if(evidence.failure)process.exitCode=1;
