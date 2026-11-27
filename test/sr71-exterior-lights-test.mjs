// Run directly; deliberately not registered in the shared test manifest.
// --browser: real local glTF + loopback Chromium, all external requests blocked.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {SR71ExteriorLights,SR71_EXTERIOR_ACTIONS,SR71_EXTERIOR_FIXTURES,SR71_EXTERIOR_DEFAULTS,sr71ExteriorLevel} from '../src/sr71-exterior-lights.js';
import {KEY_ACTIONS} from '../src/controls.js';
let checks=0;function check(name,fn){fn();checks++;console.log('PASS',name);}
const textFiles=new Map(await Promise.all(['exterior','nose-gear'].flatMap(f=>['','-flight'].map(d=>`../public/models/sr71/exterior/${f}${d}.gltf`)).map(async p=>[p,await readFile(new URL(p,import.meta.url),'utf8')])));
check('source fixtures present at both real glTF detail levels',()=>{
  for(const detail of ['', '-flight'])for(const file of ['exterior','nose-gear']){
    const data=JSON.parse(requireText(`../public/models/sr71/exterior/${file}${detail}.gltf`));
    const names=new Set(data.nodes.map(n=>n.name));
    for(const def of SR71_EXTERIOR_FIXTURES.filter(d=>file==='nose-gear'?d.beam!==undefined:d.beam===undefined))assert(names.has(def.helper),def.helper);
  }
});
function requireText(path){return textFiles.get(path);}
check('exterior keys are distinct, discoverable and preserve existing controls',()=>{
  for(const a of SR71_EXTERIOR_ACTIONS){assert(KEY_ACTIONS.some(x=>x.id===a.id));for(const key of a.keys)assert.equal(KEY_ACTIONS.filter(x=>x.keys.includes(key)).length,1,key);}
});
check('independent commands, nose gear interlock, flashing and crash gate',()=>{
  const state={landing:true,taxi:false,navigation:true,beacon:true,strobe:true};
  assert.equal(sr71ExteriorLevel('landing',state,1,0),1);assert.equal(sr71ExteriorLevel('taxi',state,1,0),0);
  for(const g of [0,.5,.97])assert.equal(sr71ExteriorLevel('landing',state,g,0),0);
  assert.equal(sr71ExteriorLevel('beacon',state,0,.5),0);assert.equal(sr71ExteriorLevel('beacon',state,0,.1),1);
  for(const t of [.02,.18])assert.equal(sr71ExteriorLevel('strobe',state,0,t),1);
  assert.equal(sr71ExteriorLevel('strobe',state,0,.1),0);
  for(const key of Object.keys(state))assert.equal(sr71ExteriorLevel(key,state,1,0,false),0);
});
const scene=new THREE.Scene(),model=new THREE.Group();scene.add(model);
const sourceMaterial=new THREE.MeshStandardMaterial();sourceMaterial.name='LIGHTS';
const helper=new THREE.Group();helper.name='LANDING_LIGHT_HELPER';helper.rotation.y=Math.PI/2;model.add(helper);
const bulb=new THREE.Mesh(new THREE.SphereGeometry(.1),sourceMaterial);bulb.name='LANDING_LIGHT_BULB';model.add(bulb);
const part={kind:'exterior',path:'test',root:model},visual={parts:[part]},fdm={gearPos:1};const lights=new SR71ExteriorLights(scene);
check('only authored fixtures light, source materials not mutated, fixed two spots',()=>{
  lights.update(0,visual,fdm);assert.equal(lights.parts.size,1);assert.equal(lights.parts.get(part).fixtures.length,1);
  assert.notEqual(bulb.material,sourceMaterial);assert.equal(sourceMaterial.emissiveIntensity,1);assert.equal(bulb.material.emissiveIntensity,4);
  assert.equal(lights.spots.length,2);assert(lights.beams[0].direction.x>.9999);assert.equal(lights.spots[0].intensity,24000);
  const material=bulb.material;lights.toggle('landing');lights.update(0,visual,fdm);
  assert.equal(bulb.material,material);assert.equal(bulb.material.emissiveIntensity,0);assert(lights.spots.every(l=>l.visible&&l.intensity===0));
  lights.toggle('landing');fdm.gearPos=.5;lights.update(0,visual,fdm);assert.equal(lights.spots[0].intensity,0);
  fdm.gearPos=1;lights.update(0,visual,fdm,false);assert.equal(lights.spots[0].intensity,0);
});
check('pause freezes flashes, hidden detail is dark, reset and disposal are complete',()=>{
  lights.update(.5,visual,fdm);lights.update(0,visual,fdm);assert.equal(lights.time,.5);
  model.visible=false;lights.update(0,visual,fdm);assert.equal(lights.beams[0].strength,0);
  lights.toggle('taxi');lights.reset();assert.deepEqual(lights.state,SR71_EXTERIOR_DEFAULTS);assert.equal(lights.time,0);
  lights.dispose();assert.equal(bulb.material,sourceMaterial);assert.equal(helper.children.length,0);assert.equal(lights.root.parent,null);
});
console.log(`${checks} exterior light checks passed`);
if(process.argv.includes('--browser')){
 const {createServer}=await import('vite'),{default:puppeteer}=await import('puppeteer-core');
 const out=process.env.SR71_LIGHT_PROOF_DIR||'/home/captures/sr71-exterior-lights';await mkdir(out,{recursive:true});
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/*']}}});await server.listen();
 const origin='http://127.0.0.1:'+server.httpServer.address().port;let browser;const errors=[],external=[],report={renderer:'isolated headless Chromium SwiftShader, real source geometry and controlled static night scene; no hardware FPS claim',checks:[]};
 try{
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  const page=await browser.newPage();await page.setViewport({width:1200,height:800});await page.setRequestInterception(true);
  page.on('request',r=>{if(r.url().startsWith(origin)||/^(data:|blob:)/.test(r.url()))r.continue();else{external.push(r.url());r.abort();}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|Shader|WebGL/.test(m.text()))errors.push(m.text());});
  await page.goto(origin+'/test/sr71-integration.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors?.length,{timeout:180000});assert.deepEqual(await page.evaluate(()=>qa.errors),[]);
  const pose=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js');const {SR71ExteriorLights}=await import('/src/sr71-exterior-lights.js');
    const {TERRAIN_UNIFORMS}=await import('/src/terrain-shader.js');const q=qa;window.T=T;window.terrainUniforms=TERRAIN_UNIFORMS;
    q.lights=new SR71ExteriorLights(q.scene);q.scene.background.set('#050b15');q.scene.environmentIntensity=.08;q.scene.children.filter(o=>o.isLight).forEach(l=>l.intensity=.08);
    q.renderer.toneMappingExposure=1.3;q.fdm.gearPos=1;q.fdm.onGround=true;
    const floor=new T.Mesh(new T.PlaneGeometry(600,180),new T.MeshStandardMaterial({color:0x343941,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(70,-2.44,0);q.scene.add(floor);
    q.camera.position.set(30,7,22);q.camera.lookAt(14,-1,0);
    window.lightDraw=(enabled=true,dt=0)=>{q.visual.update(0,q.fdm,new T.Vector3(),q.visual.view,null,-2.44,null,q.axes);q.lights.update(dt,q.visual,q.fdm,enabled);q.lights.updateTerrain(TERRAIN_UNIFORMS,0);q.renderer.render(q.scene,q.camera);};
    window.lightPixels=()=>{lightDraw();const gl=q.renderer.getContext(),p=new Uint8Array(1200*800*4);gl.readPixels(0,0,1200,800,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    window.changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)n++;return n;};
    Object.assign(q.lights.state,{landing:false,taxi:false,navigation:false,beacon:false,strobe:false});window.beforeLights=lightPixels();
    document.querySelector('header').textContent='SR-71 real fixture regression · fixed night / camera / gear · exterior lights OFF';
    q.lights.state.landing=true;lightDraw();const s=q.lights.snapshot();q.lights.state.landing=false;lightDraw();return s;
  });
  assert(pose.beams[0].direction[0]>.98,JSON.stringify(pose.beams));assert(pose.beams[0].direction[1]<=.03,JSON.stringify(pose.beams));report.checks.push({name:'authored landing helper points forward with nose gear fully down',data:pose});
  await page.screenshot({path:out+'/before-all-off.png'});
  const landing=await page.evaluate(()=>{qa.lights.state.landing=true;const p=lightPixels();document.querySelector('header').textContent='SR-71 real fixture regression · same scene · landing light ON (nose gear down)';return {changed:changed(beforeLights,p),beam:qa.lights.snapshot().beams[0],uniform:terrainUniforms.uF27Beam.value[0].toArray(),aim:terrainUniforms.uF27Aim.value[0].toArray()};});
  assert(landing.changed>100,JSON.stringify(landing));assert.equal(landing.uniform[3],2.65);assert(landing.aim[0]>.98);report.checks.push({name:'landing changes visible pixels and drives existing terrain cone uniforms',data:landing});await page.screenshot({path:out+'/after-landing-on.png'});
  const taxi=await page.evaluate(()=>{qa.lights.state.landing=false;qa.lights.state.taxi=true;const p=lightPixels();document.querySelector('header').textContent='SR-71 real fixture regression · same scene · taxi light ON independently';return {changed:changed(beforeLights,p),beams:qa.lights.snapshot().beams};});assert(taxi.changed>100);assert.equal(taxi.beams[0].strength,0);assert.equal(taxi.beams[1].strength,1);assert(taxi.beams[1].direction[0]>.999&&Math.abs(taxi.beams[1].direction[1])<.001);report.checks.push({name:'authored taxi beam forward/level with downward cone coverage, independent',data:taxi});await page.screenshot({path:out+'/after-taxi-on.png'});
  const interlock=await page.evaluate(()=>{const poses=[];for(const gear of [1,.97,.5,0,1]){qa.fdm.gearPos=gear;lightDraw();poses.push({gear,strength:qa.lights.beams.map(b=>b.strength),intensity:qa.lights.spots.map(l=>l.intensity)});}lightDraw(false);return {poses,disabled:qa.lights.spots.map(l=>l.intensity),uniforms:terrainUniforms.uF27Beam.value.map(v=>v.w)};});assert.deepEqual(interlock.poses.map(p=>p.strength[1]),[1,0,0,0,1]);assert(interlock.disabled.every(x=>x===0)&&interlock.uniforms.every(x=>x===0));report.checks.push({name:'gear transition interlock and crash-disable clear lamp and wash',data:interlock});
  const churn=await page.evaluate(()=>{const counts=[];for(const mode of ['off','on','off','on']){Object.keys(qa.lights.state).forEach(k=>qa.lights.state[k]=mode==='on');lightDraw();counts.push(qa.renderer.info.programs.length);}return {counts,spots:qa.lights.snapshot().spots};});assert.equal(churn.counts[1],churn.counts[2]);assert.equal(churn.counts[2],churn.counts[3]);assert(churn.spots.every(l=>l.visible));report.checks.push({name:'warmed ON/OFF toggles reuse shader programs and fixed light count',data:churn});
  const views=await page.evaluate(async()=>{const modes=[];for(const detail of ['high','flight']){await qa.visual.setDetail(detail);for(const view of ['cockpit','chase']){qa.visual.view=view;lightDraw();modes.push({detail,view,active:qa.lights.snapshot().fixtures.filter(f=>f.level).map(f=>f.helper),spots:qa.lights.spots.length,parts:qa.lights.parts.size});}}return modes;});assert(views.every(v=>v.spots===2&&v.active.filter(x=>x==='LANDING_LIGHT_HELPER').length===1));report.checks.push({name:'flight/high detail and view changes retain one active fixture set, two scene lights',data:views});
  await page.evaluate(()=>{qa.camera.position.set(-24,5,12);qa.camera.lookAt(-4,0,0);qa.lights.time=0;lightDraw();document.querySelector('header').textContent='SR-71 actual tail/position fixtures and forward red/white anticollision lamps · all commands ON · flash sampled at t=0';});await page.screenshot({path:out+'/tail-beacons-strobes.png'});
  const transforms=await page.evaluate(()=>{
    qa.fdm.ctrl.dr=.5;lightDraw();const steering=qa.lights.beams.map(b=>b.direction.toArray());
    qa.fdm.ctrl.dr=0;qa.fdm.quat.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2);qa.fdm.pos.set(100,20,30);lightDraw();const transformed=qa.lights.snapshot().beams;
    return {steering,transformed};
  });assert(Math.abs(transforms.steering[1][2])<.001);assert(transforms.transformed[0].direction[2]<-.98);report.checks.push({name:'source lamps stay on authored fixed strut when wheel steering changes; aircraft transform moves beams',data:transforms});
  const ui=await browser.newPage();await ui.setViewport({width:1200,height:800});await ui.setRequestInterception(true);
  ui.on('request',r=>{if(r.url().startsWith(origin)||/^(data:|blob:)/.test(r.url()))r.continue();else r.abort();});
  ui.on('pageerror',e=>errors.push(e.message));
  await ui.evaluateOnNewDocument(()=>localStorage.setItem('sr71sim.settings',JSON.stringify({aircraft:'sr71',gfx:'low',rscale:.7,trees:false,buildings:false,traffic:false,clouds:0,metarAuto:false})));
  await ui.goto(origin+'/?aircraft=sr71',{waitUntil:'domcontentloaded'});await ui.waitForFunction(()=>window.__simReady||document.querySelector('#startup-error:not([hidden])'),{timeout:90000});
  assert(await ui.evaluate(()=>!!window.__simReady));
  await ui.evaluate(()=>__sim.openSheet('help'));await ui.$eval('#sr71-exterior-controls',e=>e.scrollIntoView());
  const initial=await ui.evaluate(()=>({state:{...__sim.sr71ExteriorLights.state},visible:!document.querySelector('#sr71-exterior-controls').hidden}));assert(initial.visible);
  await ui.click('[data-sr71-exterior-light=taxi]');assert.equal(await ui.evaluate(()=>__sim.sr71ExteriorLights.state.taxi),true);
  await ui.evaluate(()=>{__sim.controls.enabled=true;document.activeElement?.blur();});
  await ui.keyboard.down('Shift');await ui.keyboard.press('Digit7');await ui.keyboard.up('Shift');
  assert.equal(await ui.evaluate(()=>__sim.sr71ExteriorLights.state.landing),false);
  await ui.screenshot({path:out+'/actual-game-controls.png'});
  report.checks.push({name:'actual game boots, Help contains live light buttons and real Shift+7 handler toggles landing',data:{initial,after:await ui.evaluate(()=>({state:{...__sim.sr71ExteriorLights.state},pressed:[...document.querySelectorAll('[data-sr71-exterior-light]')].map(b=>[b.dataset.sr71ExteriorLight,b.getAttribute('aria-pressed')])}))}});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.pass=true;console.log('PASS real-model WebGL exterior light checks',JSON.stringify(report.checks));
 }catch(e){report.pass=false;report.error=e.stack;throw e;}
 finally{report.errors=errors;report.blockedExternalRequests=external;await writeFile(out+'/results.json',JSON.stringify(report,null,2));if(browser)await browser.close();await server.close();}
}
