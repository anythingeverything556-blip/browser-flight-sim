import { puppeteer, chromeExecutable, createPage, fixtureURL, evidenceDirectory } from '../tools/qa-browser-support.mjs';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const out=await evidenceDirectory('proof-perf');await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await createPage(browser,{viewport:{width:1200,height:800}});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('console',e=>{if(e.type()==='warning'&&/PropertyBinding|No target/.test(e.text()))errors.push(e.text());});
const results=[];function pass(name,data){results.push({name,data});console.log('PASS',name,JSON.stringify(data||''));}
try{
 await page.goto(fixtureURL('/test/sr71-integration.html'));
 await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors.length,{timeout:180000});
 assert.deepEqual(await page.evaluate(()=>qa.errors),[]);
 const initial=await page.evaluate(()=>({parts:qa.visual.parts.length,clips:qa.visual.parts.reduce((n,p)=>n+p.clips.size,0),triangles:qa.renderer.info.render.triangles,drawCalls:qa.renderer.info.render.calls,audio:qa.audio.status}));
 assert.equal(initial.parts,6);assert(initial.triangles>100000&&initial.triangles<400000);assert(initial.drawCalls<300);assert(!requests.some(u=>/\.flac/.test(u)));pass('real original exterior drawn; six original parts (including structural cabin); no audio fetched before gesture',initial);
 const contacts=await page.evaluate(()=>qa.visual.parts.filter(p=>/gear/.test(p.path)).map(p=>{const node=p.root.getObjectByName(p.path.includes('nose')?'FRONT_WHEELS':p.path.includes('left')?'L_TIRE002':'TIRE_R002');const box=new (qa.camera.position.constructor)();let min=Infinity;node?.traverse(o=>{const a=o.geometry?.attributes.position;if(a)for(let i=0;i<a.count;i++)min=Math.min(min,box.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).y);});return {path:p.path,minY:min};}));for(const c of contacts)assert(Math.abs(c.minY+2.42)<.001,JSON.stringify(c));pass('rendered tire contact plane matches unchanged solver (-2.42m)',contacts);
 pass('original compression travel measured from real keyframes',await page.evaluate(()=>qa.visual.parts.filter(p=>p.gear).map(p=>({index:p.gear.index,name:p.gear.name,offset:p.gear.offset,travel:p.gear.travel,down:p.gear.down,compressed:p.gear.compressed}))));
 await changeCompression();
 async function changeCompression(){const before=await page.evaluate(()=>qa.pose('GEAR_Left'));await page.evaluate(()=>{qa.fdm.compress=[.1,.1,.1];qa.draw();});const after=await page.evaluate(()=>qa.pose('GEAR_Left'));assert(after.some((a,i)=>a.matrix.some((v,j)=>Math.abs(v-before[i].matrix[j])>1e-7)));await page.evaluate(()=>{qa.fdm.compress=[0,0,0];qa.draw();});pass('real solver compression drives original second-half tracks');}
 // Actual source tire clips should move independently using signed solver wheel
 // angular speeds, and stay frozen at dt=0 (paused/pending).
 const tireResults=await page.evaluate(()=>{
   const parts=qa.visual.parts.filter(p=>p.gear), cw=new qa.camera.position.constructor();
   qa.fdm.wheel=[Math.PI,0,-Math.PI]; qa.visual.update(.5,qa.fdm,cw,'chase',null,0,null,qa.axes);
   const first=parts.map(p=>{const c=p.clips.get(p.gear.tireClip);c.tracks[0].binding.bind();return {name:p.gear.tireClip,phase:p.gear.phase,q:c.tracks[0].binding.node.quaternion.toArray()};});
   qa.visual.update(0,qa.fdm,cw,'chase',null,0,null,qa.axes);
   return first.map((v,i)=>({...v,frozenPhase:parts[i].gear.phase}));
 });
 for(const t of tireResults)assert.equal(t.phase,t.frozenPhase);
 for(const [name,want] of [['GEAR_Center_Tire',.25],['GEAR_Left_Tire',0],['GEAR_Right_Tire',.75]]){const item=tireResults.find(x=>x.name===name);assert(item, name);assert(Math.abs(item.phase-want)<1e-9,JSON.stringify(item));}
 pass('independent original tire clips follow solver wheel speed, reverse and pause',tireResults);
 await page.evaluate(()=>{qa.fdm.wheel=[0,0,0];qa.draw();});
 await page.screenshot({path:out+'/exterior-gear-down.png'});
 async function change(name,fn){
   const before=await page.evaluate(n=>qa.pose(n),name);
   await page.evaluate(fn);await page.evaluate(()=>qa.draw());
   const after=await page.evaluate(n=>qa.pose(n),name);
   assert(before?.length&&after?.length,name+' exists');
   const changed=after.filter((a,i)=>a.matrix.some((v,j)=>Math.abs(v-before[i].matrix[j])>1e-7));
   assert(changed.some(a=>a.meshes>0),name+' changes real geometry');
   pass(name+' drives real geometry',{changedNodes:changed.length,meshDescendants:changed.reduce((n,a)=>n+a.meshes,0)});
 }
 await change('GEAR_Left',()=>{qa.fdm.gearPos=0;qa.fdm.gearDown=false;});
 await page.screenshot({path:out+'/exterior-gear-up.png'});
 await change('HANDLING_L_Rudder',()=>{qa.fdm.surf.dr=1;});
 await change('HANDLING_Inboard_R_Elevon',()=>{qa.fdm.surf.de=.8;qa.fdm.surf.da=.5;});
 await page.screenshot({path:out+'/exterior-surfaces-deflected.png'});
 const locked=await page.evaluate(()=>qa.visual.setDoors(true));assert.equal(locked,false);
 assert.equal(await page.evaluate(()=>qa.visual.toggleSeal()),true);
 await change('CANOPY',()=>{qa.visual.setDoors(true);qa.visual.update(4,qa.fdm,{x:0,y:0,z:0},'chase',null,0,null,qa.axes);});
 await page.screenshot({path:out+'/exterior-canopy-open.png'});
 await page.evaluate(async()=>{await qa.visual.preloadCockpit();qa.visual.view='cockpit';qa.draw();});
 assert.equal(await page.evaluate(()=>qa.visual.status.cockpit),'ready');
 assert.equal(await page.evaluate(()=>qa.visual.interior.root.parent===qa.visual.model),true);
 await page.evaluate(()=>{qa.camera.position.copy(qa.visual.eye);qa.camera.lookAt(qa.visual.eye.x+2,qa.visual.eye.y-.47,0);qa.camera.fov=80;qa.camera.updateProjectionMatrix();qa.draw();});
 await page.screenshot({path:out+'/cockpit-original.png'});pass('cockpit is lazy loaded and original cockpit renders',{clips:await page.evaluate(()=>qa.visual.interior.clips.size)});
 await change('ENGINE_LEVER_THROTTLE_1',()=>{qa.fdm.throttle=.5;qa.fdm.leverTrim=[-.4,.4];});
 await change('HANDLING_YOKE_Lever_StickForeAft',()=>{qa.axes.pitch=1;});
 await change('GEAR_HANDLE',()=>{qa.fdm.gearDown=true;});
 await page.evaluate(async()=>{await qa.visual.toggleEquipment('walt');qa.draw();});
 assert.equal(await page.evaluate(()=>qa.visual.status.walt),'ready');pass('optional original WALT loads only on control use');
 await page.evaluate(()=>{qa.visual.controls.walt=0;qa.visual.controls.clipboard=1;qa.draw();});
 await change('WALT_Open_Close',()=>{qa.visual.controls.walt=1;});
 await page.evaluate(()=>{qa.visual.controls.clipboard=0;qa.draw();});
 await change('Clipboard_Use_Stow',()=>{qa.visual.controls.clipboard=1;});
 await page.evaluate(()=>{qa.camera.position.set(17,1.2,1.6);qa.camera.lookAt(12,.8,0);qa.draw();});
 await page.screenshot({path:out+'/cockpit-equipment.png'});
 await page.mouse.click(1100,740);await page.evaluate(()=>qa.audio.init());
 const sound=()=>requests.filter(u=>/\.flac$/.test(u));
 const update=(engines,extra={})=>page.evaluate(({engines,extra})=>qa.audio.update({engines,started:true,...extra}),{engines,extra});
 await update([{dry:1,abLit:true,ab:.5}],{started:false});
 await update([{dry:0}]);assert.deepEqual(sound(),[]);assert.equal(await page.evaluate(()=>qa.audio.buffers.size),0);
 await update([{dry:.35}]);await page.evaluate(()=>qa.audio.buffers.get('engine'));
 assert.equal(sound().length,1);assert.match(sound()[0],/engine-aft-low-n2-component/);
 await update([{dry:1,ab:.3,abLit:false}]);assert.equal(await page.evaluate(()=>qa.audio.buffers.has('afterburner')),false);
 await update([{dry:1,abTimer:.2,abLit:false}]);await page.evaluate(()=>qa.audio.buffers.get('afterburner'));
 assert.equal(sound().length,2);assert.match(sound()[1],/afterburner-aft-component/);
 assert.equal(await page.evaluate(()=>!!qa.audio.loops.afterburner.source),false);
 await update([{dry:1,ab:.2,abLit:true}]);assert.equal(await page.evaluate(()=>!!qa.audio.loops.afterburner.source),true);
 assert.equal(await page.evaluate(()=>qa.audio.status),'original-components');pass('gesture unlocks only; dry spool and burner light-off lazily fetch distinct original components; no burner playback before lit');
 await page.evaluate(()=>{qa.visual.view='chase';qa.draw();});
 assert.equal(await page.evaluate(()=>qa.visual.interior.root.parent),null);
 const beforeRepeat=requests.length;
 await page.evaluate(async()=>{await qa.visual.ensureView('cockpit');qa.draw();});
 assert.equal(requests.length,beforeRepeat);
 pass('inactive cockpit/WALT detached; returning to cockpit reuses original controls and resources');
 assert(!requests.some(u=>/SR71_(sim|lod)\.glb/.test(u)));assert.deepEqual(errors,[]);pass('no legacy model requests or binding/browser exceptions');
 await writeFile(out+'/browser-results.json',JSON.stringify({results,errors,requests},null,2));
}catch(e){console.error(e.stack);await page.screenshot({path:out+'/failure.png'});await writeFile(out+'/browser-results.json',JSON.stringify({results,errors,exception:e.stack},null,2));process.exitCode=1;}finally{await browser.close();}
