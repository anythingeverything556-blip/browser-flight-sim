// Real Chromium DOM/native-key regressions, no network data or real aircraft operations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import puppeteer from 'puppeteer-core';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const origin=server.resolvedUrls.local[0];
let browser;
const source=await fs.readFile('src/main.js','utf8');
const searchSource=source.slice(source.indexOf('function searchBox('),source.indexOf('function renderDep('));
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-webgl','--disable-dev-shm-usage']});
 const page=await browser.newPage();await page.setViewport({width:320,height:568});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).origin===new URL(origin).origin||r.url().startsWith('data:')?r.continue():r.abort());
 await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForSelector('body.startup-failed');
 assert.equal(await page.$eval('#dep-q',e=>e.disabled),true);
 assert.equal(await page.$eval('#startup-retry',e=>!e.hidden&&!e.disabled),true);
 assert.equal(await page.$$eval('#ac-cards [aria-checked=true]',e=>e.length),1);
 assert.equal(await page.$$eval('#ac-cards button',e=>e.every(b=>b.disabled)),true);
 await page.click('.hero-terms');await page.waitForSelector('#terms[open]');
 for(let i=0;i<12;i++) {await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body||document.querySelector('#terms').contains(document.activeElement)),true);}
 // Explicit background focus cannot escape a native modal's inert subtree.
 assert.equal(await page.evaluate(()=>{document.querySelector('#dep-q').focus();return document.activeElement===document.querySelector('#dep-q');}),false);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#terms').open);
 assert.equal(await page.evaluate(()=>document.activeElement.matches('.hero-terms')),true);
 console.log('PASS EW-05 no-WebGL startup: disabled setup, selected aircraft, usable narrow credits; EW-20 native modal trap/return');
 // Renderer-free fixture uses the shipped DOM/CSS and the real source modules.
 await page.evaluate(()=>{document.body.classList.remove('intro','startup-failed');document.querySelectorAll('button,input').forEach(e=>e.disabled=false);document.querySelector('#sheet-flight').classList.add('open');});
 for(const [width,height] of [[568,320],[844,390]]) {
  await page.setViewport({width,height});
  await page.evaluate(()=>{const tp=document.querySelector('#tp');tp.hidden=false;document.querySelector('#tp-quick').innerHTML='<button type="button">Cruise preset</button><button type="button">Approach preset</button>';document.querySelector('#tp-where').textContent='Synthetic test location';});
  for(const selector of ['#tp-cancel','#tp-go']) {
   await page.focus(selector);
   assert.equal(await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,`${selector} keyboard reachable at ${width}x${height}`);
   await page.$eval('#tp-form',e=>{e.scrollTop=e.scrollHeight;});
   assert.equal(await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,`${selector} scroll reachable`);
  }
  await page.evaluate(()=>document.querySelector('#tp').hidden=true);
 }
 assert.equal(await page.evaluate(()=>{
  const inputs=['tp-alt','tp-hdg','tp-spd','tp-gam'];
  for (const [i,value] of [4572,90,192,-3].entries()) document.getElementById(inputs[i]).value=value;
  return document.getElementById('tp-form').checkValidity();
 }),true,'native form accepts a 192 kt / 4,572 m preset instead of step-mismatch blocking submission');
 console.log('PASS EW-06 Teleport Cancel/submit reachable at 568x320 and 844x390');
 await page.evaluate(async()=>{
  const {Controls}=await import('/src/controls.js');window.c=new Controls();
  const input=document.createElement('input');input.id='qa-range';input.type='range';input.min=0;input.max=100;input.value=70;
  const button=document.createElement('button');button.id='qa-button';button.textContent='Toggle';button.setAttribute('aria-pressed','false');button.onclick=()=>button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));
  const root=document.createElement('div');root.style='position:fixed;top:0;left:0;z-index:999;background:white';root.append(input,button);document.body.append(root);
 });
 await page.focus('#qa-range');await page.keyboard.press('ArrowLeft');
 assert.equal(await page.$eval('#qa-range',e=>e.value),'69');
 await page.focus('#qa-button');await page.keyboard.press('Space');
 assert.equal(await page.$eval('#qa-button',e=>e.getAttribute('aria-pressed')),'true');
 assert.deepEqual(await page.evaluate(()=>{c.update(.6);return [c.axes.roll,c.brake]}),[0,0]);
 // Isolated radio events test actual early setup handler without navigating the fixture.
 assert.equal(await page.evaluate(()=>{
  const cards=[...document.querySelectorAll('#ac-cards button')];const old=cards.find(c=>c.getAttribute('aria-checked')==='true');old.focus();old.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  return cards[(cards.indexOf(old)+1)%cards.length]===document.activeElement&&document.activeElement.getAttribute('aria-checked')==='true'&&cards.filter(c=>c.tabIndex===0).length===1;
 }),true);
 console.log('PASS EW-01 native range/Space keys, flight isolation and aircraft radio arrow selection/focus');
 await page.evaluate(async()=>{
  Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});window.matchMedia=()=>({matches:true});
  const {mountTouchControls}=await import('/src/touchcontrols.js');
  // Coarse-only pointer detection; any-pointer:fine must be false.
  window.matchMedia=q=>({matches:!q.includes('any-pointer')});
  c.throttle=.73;window.touchFixture=mountTouchControls(c);touchFixture.root.style='display:block;position:fixed;z-index:1000;top:70px;left:0;width:300px;height:220px';
 });
 assert.equal(await page.$eval('.touch-throttle',e=>e.value),'73');
 await page.evaluate(()=>touchFixture.syncThrottle(.42));assert.equal(await page.$eval('.touch-throttle',e=>e.value),'42');
 const rect=await page.$eval('.touch-throttle',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.5};});
 await page.mouse.move(rect.x,rect.y);await page.mouse.down();
 const during=await page.$eval('.touch-throttle',e=>e.value);await page.evaluate(()=>touchFixture.syncThrottle(.99));
 assert.equal(await page.$eval('.touch-throttle',e=>e.value),during,'sync does not fight drag');
 await page.mouse.up();await page.evaluate(()=>{c.throttle=.81;touchFixture.syncThrottle();});
 assert.equal(await page.$eval('.touch-throttle',e=>e.value),'81');
 await page.evaluate(()=>{const t=document.querySelector('.touch-throttle');t.value=1;t.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>c.throttle),.01);
 await page.evaluate(()=>touchFixture.root.remove());
 console.log('PASS EW-02 initial/model/reset throttle sync, percent scaling and active drag ownership');
 await page.evaluate(async()=>{
  const {mountKeymap}=await import('/src/keymap-ui.js');const root=document.createElement('div');root.id='qa-keymap';document.body.append(root);
  window.saved={};window.notices=[];
  mountKeymap({root,controls:c,settings:saved,save(){},toast:(...n)=>notices.push(n)});
  root.querySelector('.km-add[data-id=reset]').click();
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP',key:'p',bubbles:true}));
  root.querySelector('.km-reset[data-id=pause]').click();
 });
 assert.equal(await page.evaluate(async()=>{
  const {Controls,resolveKeys}=await import('/src/controls.js');const table=resolveKeys(JSON.parse(JSON.stringify(saved.keys || {})));const seen=new Set();
  for(const a of (await import('/src/controls.js')).KEY_ACTIONS)for(const key of table[a.id]){const id=(a.ctx||'main')+key;if(seen.has(id))return false;seen.add(id);}
  const reloaded=new Controls();reloaded.setBindings(saved.keys);return reloaded.press.get('KeyP')==='pause'&&!table.reset.includes('KeyP')&&notices.some(n=>n[0].includes('Restart')&&n[0].includes('taken from'));
 }),true);
 console.log('PASS EW-03 row restore resolves/reports conflicts and serialized reload preserves Pause');
 await page.evaluate(searchSource=>{
  const items=[{ident:'KLAX',name:'Los Angeles',longest:{len:3000}},{ident:'KLAS',name:'Las Vegas',longest:{len:2800}}];
  const searchBox=Function('db','aptPlace','fmtLen','return '+searchSource)({search:()=>items},()=>'',String);
  window.picked=null;searchBox(document.querySelector('#dep-q'),document.querySelector('#dep-results'),a=>window.picked=a.ident);
 },searchSource);
 await page.focus('#dep-q');await page.type('#dep-q','LA');await page.keyboard.press('ArrowDown');
 assert.deepEqual(await page.$eval('#dep-q',e=>[e.getAttribute('role'),e.getAttribute('aria-expanded'),document.getElementById(e.getAttribute('aria-activedescendant')).getAttribute('aria-selected')]),['combobox','true','true']);
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>picked),'KLAS');
 assert.equal(await page.$eval('#dep-q',e=>e.getAttribute('aria-expanded')),'false');
 console.log('PASS EW-20 airport combobox/listbox relationships, active option and Enter selection');
 await page.evaluate(async()=>{
  const {LiveAdsb,normalize}=await import('/src/adsbmap.js');const card=document.createElement('div');card.id='qa-adsb-card';card.style='position:fixed;left:320px;top:0;z-index:999';document.body.append(card);
  window.live=Object.create(LiveAdsb.prototype);const e=normalize({hex:'abc123',lat:1,lon:1,gs:200,track:40,flight:'TEST'},performance.now()/1000);
  Object.assign(live,{card,sel:e.hex,list:new Map([[e.hex,e]]),followSel:false,o:{canFlyTo:()=>true}});live.renderCard();
 });
 await page.focus('#qa-adsb-card [data-a=follow]');
 assert.equal(await page.evaluate(()=>{const before=document.activeElement;const e=live.list.get(live.sel);e.at-=3;e.gs=250;live.renderCard(true);return before===document.activeElement&&before.isConnected&&live.card.textContent.includes('250 kt');}),true);
 assert.equal(await page.evaluate(()=>{live.followSel=true;live.renderCard();const focused=document.activeElement;const hex=live.sel;live.sel=null;live.renderCard();live.sel=hex;live.renderCard();return !!live.card.querySelector('[data-a=follow]');}),true);
 console.log('PASS EW-18 focus retained across changing signal/data refresh and safe reselection');
 await page.evaluate(async()=>{
  const {MapPanel}=await import('/src/map.js');const el=document.createElement('div');el.id='qa-map';el.style='position:fixed;top:0;left:0;width:300px;height:250px;z-index:2000';document.body.append(el);
  window.mapFixture=new MapPanel('qa-map',{ready:false},{onChange(){}},{});
 });
 await page.focus('#qa-map');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>mapFixture.follow),false);
 assert.equal(await page.$eval('#qa-map .map-follow',e=>e.getAttribute('aria-pressed')),'false');
 console.log('PASS EW-19 native Leaflet keyboard pan disables Follow');
 assert.deepEqual(errors,[],'no uncaught fixture errors');
} finally {if(browser)await browser.close();await server.close();}
