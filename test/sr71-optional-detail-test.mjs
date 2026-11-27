import { puppeteer, chromeExecutable, createPage, fixtureURL } from '../tools/qa-browser-support.mjs';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try {
  const page = await createPage(browser);const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(fixtureURL('/test/sr71-integration.html'));
  await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors.length,{timeout:120000});
  assert.equal(requests.some(x=>x.endsWith('/exterior/exterior.gltf')),false);
  const high=await page.evaluate(async()=>{
    qa.fdm.pos.set(700,-540,6);qa.fdm.quat.setFromAxisAngle(qa.camera.position.clone().set(0,0,1),.6);qa.draw();
    await qa.visual.setDetail('high');
    qa.fdm.pos.set(0,0,0);qa.fdm.quat.identity();qa.draw();
    return {high:qa.visual.highParts.length,connected:qa.visual.model.children.length,triangles:qa.renderer.info.render.triangles,contactDeltas:qa.visual.highParts.filter(p=>p.gear).map(p=>p.gear.offset+p.gear.down+2.42)};
  });
  assert.equal(high.high,5);assert.equal(high.connected,6);assert(high.triangles>400000,JSON.stringify(high));
  assert(high.contactDeltas.every(x=>Math.abs(x)<1e-8));
  await page.evaluate(async()=>{await qa.visual.setDetail('flight');qa.draw();});
  assert((await page.evaluate(()=>qa.renderer.info.render.triangles))<400000);
  await page.evaluate(async()=>{await qa.visual.preloadCockpit();await qa.visual.setCockpitTextureDetail('full');});
  await page.evaluate(async()=>{await qa.visual.setCockpitTextureDetail('flight');});
  assert(requests.some(x=>x.endsWith('/cockpit/textures/sr-71_b01_8k_albd.webp')));
  assert.deepEqual(errors,[]);
  console.log('Verified original optional LOD0 switch and full cockpit texture opt-in',high);
} finally {await browser.close();}
