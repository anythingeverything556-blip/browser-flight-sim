import { puppeteer, chromeExecutable, createPage, fixtureURL, evidenceDirectory } from '../tools/qa-browser-support.mjs';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const out=await evidenceDirectory('proof');
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await createPage(browser,{viewport:{width:1024,height:768}});
const errors=[],requests=[],results=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});page.on('request',r=>requests.push(r.url()));
await page.evaluateOnNewDocument(()=>localStorage.setItem('sr71sim.settings',JSON.stringify({aircraft:'sr71',gfx:'low',rscale:.7,trees:false,buildings:false,traffic:false,clouds:0,metarAuto:false})));
function pass(name,data){results.push({name,data});console.log('PASS',name,JSON.stringify(data||''));}
try{
 await page.goto(fixtureURL('/?aircraft=sr71'),{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__simReady||document.querySelector('#startup-error:not([hidden])'),{timeout:180000});
 assert.equal(await page.evaluate(()=>window.__simReady),true,await page.$eval('body', element=>element.innerText));
 assert.equal(requests.some(url=>new URL(url).pathname.startsWith('/models/sr71/')),false,'home does not demand-load SR-71 model assets');
 pass('complete game boots without transferring SR-71 models');
 assert(!requests.some(u=>/\.flac/.test(u)));
 await page.click('#just-fly');
 // Terrain may be offline: only a local game change is under test, not network imagery.
 await page.waitForFunction(()=>__sim.state.started,{timeout:30000});
 await page.waitForFunction(()=>!__sim.state.pending && document.getElementById('loadscreen').hidden,{timeout:120000});
 await page.waitForFunction(()=>window.__sim?.visual.status.exterior==='ready',{timeout:30000});
 pass('Start demand-loads original SR-71',{parts:await page.evaluate(()=>__sim.visual.parts.length)});
 await page.evaluate(()=>{__sim.setView('chase');__sim.settings.crash=false;__sim.fdm.crashOff=true;document.querySelector('#g-quit')?.click();document.querySelector('#coach-skip')?.click();if(__sim.cmap.visible)__sim.cmap.toggle?.();});
 await page.waitForFunction(()=>!window.__frameErr,{timeout:15000});
 pass('Just fly starts and game loop has no errors',{});
 await page.screenshot({path:out+'/game-original-sr71-chase.png',timeout:60000});
 await page.evaluate(()=>__sim.setView('cockpit'));
 await page.waitForFunction(()=>__sim.visual.status.cockpit==='ready',{timeout:180000});
 await page.mouse.move(510,450);
 const cockpit=await page.evaluate(()=>({parts:__sim.visual.parts.length,view:__sim.rig.view,frameError:window.__frameErr||null}));
 assert.equal(cockpit.view,'cockpit');assert.equal(cockpit.frameError,null);pass('real cockpit view and pointer interactions do not throw',cockpit);
 const windshield=await page.evaluate(()=>{
   const {THREE,visual,camera}=__sim;const helper=visual.interior.root.getObjectByName('ENVIRONMENT_OCCLUDER');
   const meshes=[];visual.root.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
   const ray=new THREE.Raycaster();return {helper:helper?.name,visible:helper?.visible,windows:[-.3,.3].map(x=>{
     ray.setFromCamera(new THREE.Vector2(x,.12),camera);
     return ray.intersectObjects(meshes,false).slice(0,2).map(h=>({node:h.object.name,opacity:h.object.material.opacity,depthWrite:h.object.material.depthWrite}));
   })};
 });
 assert.equal(windshield.helper,'ENVIRONMENT_OCCLUDER');assert.equal(windshield.visible,false);
 for(const hits of windshield.windows){assert(hits.some(h=>/glass/i.test(h.node)),JSON.stringify(windshield));assert(hits.every(h=>h.opacity<.1&&h.depthWrite===false),JSON.stringify(windshield));}
 pass('actual cockpit windshield retains source glazing; opaque helper is not rendered',windshield);
 await page.screenshot({path:out+'/game-original-sr71-cockpit.png',timeout:60000});
 // Exercise real existing input handlers with their actual geometry pose update.
 await page.evaluate(()=>{__sim.state.paused=false;__sim.state.pending=null;__sim.fdm.onGround=true;__sim.fdm.vel.set(0,0,0);__sim.visual.controls.open=0;__sim.visual.controls.goal=0;__sim.visual.controls.sealed=true;});
 await page.keyboard.press('Shift+KeyS');await page.keyboard.press('Shift+KeyN');
 assert.equal(await page.evaluate(()=>__sim.visual.controls.goal),1);pass('rebindable seal and existing canopy key operate source interlock');
 await page.keyboard.press('Shift+KeyW');
 await page.waitForFunction(()=>__sim.visual.status.walt==='ready',{timeout:90000});
 pass('real WALT key loads original optional model');
 await page.evaluate(()=>{__sim.controls.throttle=.4;__sim.controls.engTrim[0]=-.2;__sim.controls.engTrim[1]=.3;__sim.advance(.05);});
 await page.waitForFunction(()=>__sim.visual.lastPose.ENGINE_LEVER_THROTTLE_1!==__sim.visual.lastPose.ENGINE_LEVER_THROTTLE_2,{timeout:15000});const levers=await page.evaluate(()=>__sim.visual.lastPose);assert.notEqual(levers.ENGINE_LEVER_THROTTLE_1,levers.ENGINE_LEVER_THROTTLE_2);pass('complete game independent engine controls reach original cockpit levers');
 assert(!requests.some(u=>/SR71_(sim|lod)\.glb/.test(u)));assert.equal(errors.length,0,errors.join('\n'));
}catch(e){console.error(e.stack);process.exitCode=1;await page.screenshot({path:out+'/game-failure.png',timeout:60000}).catch(()=>{});}
finally{await writeFile(out+'/game-results.json',JSON.stringify({results,errors,requests},null,2));await browser.close();}
