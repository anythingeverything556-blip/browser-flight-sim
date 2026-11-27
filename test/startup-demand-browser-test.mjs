import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {writeFile} from 'node:fs/promises';
import {preview} from 'vite';
const server=process.env.EARTHWING_TEST_URL?null:await preview({preview:{host:'127.0.0.1',port:4174,strictPort:true}});
const origin=(process.env.EARTHWING_TEST_URL||server.resolvedUrls.local[0]).replace(/\/$/,'');
const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const results=[];
async function pageFor(aircraft='sr71') {
 const page=await browser.newPage();await page.setViewport({width:1200,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(aircraft=>{localStorage.setItem('sr71sim.settings',JSON.stringify({aircraft,gfx:'low',rscale:.5,clouds:0,trees:false,buildings:false,traffic:false,metarAuto:false}));},aircraft);
 return {page,errors};
}
try {
 const {page,errors}=await pageFor();const models=[];
 await page.setRequestInterception(true);
 page.on('request',request=>{if(request.url().includes('/models/')){models.push(request.url());setTimeout(()=>request.abort().catch(()=>{}),1000);}else request.continue();});
 await page.goto(origin+'/?aircraft=sr71',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__simReady,{timeout:60000});
 assert.equal(models.length,0,'no model transfer on usable home');
 assert.equal(await page.$eval('.hero-loader',e=>getComputedStyle(e).display),'none');
 assert.equal(await page.$eval('#start-btn',e=>e.disabled),false);
 const home=await page.evaluate(()=>({readyMs:performance.now(),status:__sim.visual.status.exterior}));assert.equal(home.status,'idle');
 const feedback=await page.evaluate(()=>{const start=performance.now();document.getElementById('just-fly').click();return {elapsedMs:performance.now()-start,visible:!document.getElementById('loadscreen').hidden};});assert(feedback.visible);
 await page.waitForFunction(()=>!document.getElementById('flight-load-retry').hidden,{timeout:30000});
 assert.equal(await page.evaluate(()=>__sim.state.started),false,'failed aircraft cannot start physics');
 await page.click('#flight-load-back');assert.equal(await page.$eval('#loadscreen',e=>e.hidden),true);
 await page.$eval('#intro-tod',e=>{e.value='12';e.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.evaluate(()=>__sim.env.hour),12);
 assert.deepEqual(errors,[]);results.push({name:'blocked-model-home-and-recovery',home,feedback,modelRequests:models.length,errors});console.log('PASS',JSON.stringify(results.at(-1)));await page.close();
 const live=await pageFor();const p=live.page;const timings={};const requests=[];
 p.on('request',r=>{if(r.url().includes('/models/'))requests.push({url:r.url(),at:Date.now()});});
 const t0=Date.now();await p.goto(origin+'/?aircraft=sr71',{waitUntil:'domcontentloaded'});
 // Click before __simReady: exercise the real boot queue, not a test replay.
 await p.waitForFunction(()=>!document.getElementById('just-fly').disabled,{timeout:60000});
 timings.clickMs=Date.now()-t0;
 timings.feedback=await p.evaluate(()=>{const t=performance.now();document.getElementById('just-fly').click();return {wasEarly:!window.__simReady,ms:performance.now()-t,visible:!document.getElementById('loadscreen').hidden};});assert(timings.feedback.visible);
 await p.waitForFunction(()=>window.__flightAssetsReady,{timeout:180000});timings.exteriorMs=Date.now()-t0;console.log('STAGE exterior',JSON.stringify(timings));
 assert(requests.some(r=>r.url.includes('/cockpit/')),'cockpit began while the flight overlay was active');
 assert.equal(await p.evaluate(()=>__sim.visual.status.cockpit),'ready','cockpit loaded before flight can launch');
 await p.waitForFunction(()=>window.__sim?.state.started&&!__sim.state.pending&&document.getElementById('loadscreen').hidden,{timeout:180000});timings.flightMs=Date.now()-t0;console.log('STAGE flight',JSON.stringify(timings));
 await p.evaluate(()=>{__sim.settings.crash=false;__sim.fdm.crashOff=true;document.querySelector('#g-quit')?.click();document.querySelector('#coach-skip')?.click();});
 const cockpitReads=requests.filter(r=>r.url.includes('/cockpit/')).length;
 await p.click('#sr71-cockpit-entry');
 const during=await p.evaluate(()=>({view:__sim.rig.view,loadingVisible:!document.getElementById('sr71-view-feedback').hidden}));
 assert.equal(during.view,'cockpit','preloaded cockpit should open without its own loading step');
 assert.equal(during.loadingVisible,false,'fully prepared cockpit does not flash a second loading message');
 await p.waitForFunction(()=>__sim.rig.view==='cockpit',{timeout:65000});timings.cockpitMs=Date.now()-t0;console.log('STAGE cockpit',JSON.stringify(timings));
 // Flight shortcuts intentionally yield to focused buttons and form fields.
 await p.evaluate(()=>{document.activeElement.blur();__sim.setView('flyby');});await p.keyboard.press('v');
 await p.waitForFunction(()=>__sim.rig.view==='cockpit',{timeout:10000});
 assert.equal(requests.filter(r=>r.url.includes('/cockpit/')).length,cockpitReads,'first cockpit switch does not request assets');
 assert.deepEqual(live.errors,[]);assert.equal(await p.evaluate(()=>window.__frameErr||null),null);
 results.push({name:'actual-fast-click-flight-and-cockpit',timings,during,errors:live.errors,requests});console.log('PASS',JSON.stringify({...results.at(-1),requests:requests.length}));await p.close();
 const alternate=await pageFor('da40'); const q=alternate.page; const alternateModels=[];
 q.on('request',r=>{if(r.url().includes('/models/'))alternateModels.push(new URL(r.url()).pathname);});
 await q.evaluateOnNewDocument(()=>localStorage.setItem('earthwing.logbook.v1', JSON.stringify({last:{aircraft:'c172',airport:'KBAB',rwy:0,end:0,mode:'runway',mission:'free',weather:'clear',hour:12}})));
 await q.goto(origin+'/?aircraft=da40',{waitUntil:'domcontentloaded'});
 await q.waitForFunction(()=>window.__simReady,{timeout:30000});
 assert.equal(alternateModels.length,0,'DA40 home needs no aircraft transfer');
 assert.equal(await q.$eval('.hero-loader',e=>getComputedStyle(e).display),'none');
 await q.click('#resume-flight');
 await q.waitForFunction(()=>window.__flightAssetsReady&&window.__sim?.state.started,{timeout:30000});
 const resumed=await q.evaluate(()=>({aircraft:__sim.aircraft,setup:__sim.state.setup}));
 assert.equal(resumed.aircraft,'c172');assert.equal(resumed.setup.aircraft,'c172');assert.equal(resumed.setup.hour,12);
 assert(alternateModels.some(path=>path.includes('/C172.glb')));assert(!alternateModels.some(path=>path.includes('/da40/')));
 assert.deepEqual(alternate.errors,[]);
 results.push({name:'alternate-aircraft-cross-aircraft-resume',resumed,alternateModels,errors:alternate.errors});
 console.log('PASS',JSON.stringify(results.at(-1)));await q.close();
} finally {
 if(process.env.EARTHWING_TEST_RESULTS) await writeFile(process.env.EARTHWING_TEST_RESULTS,JSON.stringify(results,null,2));
 await browser.close();if(server) await new Promise(resolve=>server.httpServer.close(resolve));
}
