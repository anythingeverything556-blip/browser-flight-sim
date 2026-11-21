// Layout fixture on the real HUD DOM/CSS; not a claim of a flown aircraft.
// npm run build first for the separate actual-WebGL smoke. This fixture uses dedicated Vite port 5186 (strict; never takes another server).
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const before=process.argv.includes('--before'), production=process.argv.find(a=>a.startsWith('--url='))?.slice(6);
const out=process.env.HUD_OUTPUT_DIR||'/home/earthwing-evidence/flight-hud-followup';
await fs.mkdir(out,{recursive:true});
const server=production?null:await createServer({server:{host:'127.0.0.1',port:5186,strictPort:true}});
await server?.listen();const origin=production||server.resolvedUrls.local[0];
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];const failures=[];
try{
 for(const [width,height,touch] of [[1535,683,false],[1280,720,false],[1920,1080,false],[1440,640,false],[1439,640,false],[1024,600,false],[844,390,false],[390,844,true],[320,568,true],[844,390,true]]){
 const page=await browser.newPage();await page.setViewport({width,height,isMobile:touch,hasTouch:touch,deviceScaleFactor:1});
 await page.setRequestInterception(true);
 const intercept=r=>r.resourceType()==='script'&&!r.url().includes('/@vite/client')?r.respond({contentType:'text/javascript',body:''}):r.continue();page.on('request',intercept);
 await page.goto(origin,{waitUntil:'networkidle2'});page.off('request',intercept);await page.setRequestInterception(false);
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.body.className='ready';document.querySelectorAll('.sheet').forEach(e=>e.classList.remove('open'));document.querySelectorAll('link[data-flight-preload]').forEach(l=>l.media='all');});
 if(!production)await page.evaluate(async({touch,before})=>{
   const {CockpitMap}=await import('/src/cockpitmap.js');window.fixtureMap=new CockpitMap(document.body,{});
   if(touch){const {mountTouchControls}=await import('/src/touchcontrols.js');mountTouchControls({touch:{},handlers:{},enabled:false});}
   if(!before){const {mountFlightHud}=await import('/src/flight-hud.js');window.fixtureHud=mountFlightHud();}
   const sync=()=>document.documentElement.style.setProperty('--strip-h',Math.round(document.querySelector('#strip').getBoundingClientRect().height)+'px');new ResizeObserver(sync).observe(document.querySelector('#strip'));sync();
 },{touch,before});
 for(const context of (production?['normal']:touch?['normal','sheet','wide-sheet']:['normal','map','large-map','coach','coach-map','coach-large-map','guide','guide-map','guide-large-map','sheet','wide-sheet','strip-hidden','wrapped-strip'])){
 await page.evaluate(({context,production})=>{
   document.body.className='ready'+(document.querySelector('#touch-controls')?' touch-mode':'');
   for(const id of ['coach','guide'])document.getElementById(id).hidden=true;
   document.querySelectorAll('.sheet').forEach(e=>e.classList.remove('open'));
   document.getElementById('strip').style.display=context==='strip-hidden'?'none':'';
   document.getElementById('strip').style.height=context==='wrapped-strip'?'144px':'';
   if(!production){fixtureMap.toggle(context==='map'||context==='large-map'||context.endsWith('-map'));fixtureMap.setLarge(context.includes('large-map'));}
   if(context==='sheet'||context==='wide-sheet'){document.body.classList.add('sheet-open');if(context==='wide-sheet')document.body.classList.add('sheet-wide');document.getElementById(context==='sheet'?'sheet-settings':'sheet-map').classList.add('open');}
   if(context.startsWith('coach')){const e=document.getElementById('coach');e.hidden=false;e.querySelector('h3').textContent='C172 training coach';e.querySelector('p').textContent='Hold the centreline and add power smoothly.';}
   if(context.startsWith('guide'))document.getElementById('guide').hidden=false;
   document.querySelector('#throttle-lever').hidden=false;document.querySelector('#throttle-lever').classList.add('untouched');
   document.querySelector('#st-state').textContent='Flying';document.querySelector('#st-near').textContent='KABQ 0.9 NM';document.querySelector('#st-time').textContent='15:00 local';document.querySelector('#st-fps').textContent='88 fps';
   document.querySelector('#d-fuel').textContent='142,152';document.querySelector('#d-spd').textContent='101';document.querySelector('#d-alt').textContent='118';
   const radio=document.querySelector('#radio');radio.replaceChildren();
   for(const [from,text]of [['Air Force Base ATIS','Information A. Runway 15 in use. Wind 080 degrees at 5 knots. Visibility 10 kilometres or greater, no significant cloud. Temperature 14, dewpoint 3. QNH 1020.'],['Tower','Ilyushin 76, wind 080 at 5, runway 33 cleared for takeoff.'],['Ilyushin 76','Cleared for takeoff runway 33, Ilyushin 76.']]){const e=document.createElement('div');e.className='rmsg';const b=document.createElement('b');b.textContent=from;const s=document.createElement('span');s.textContent=text;e.append(b,s);radio.append(e);}
 },{context,production:!!production});
 await new Promise(r=>setTimeout(r,300));
 const row=await page.evaluate(()=>{
  const selectors=['#rail','#status','#strip','#radio','#throttle-lever','.tl-hint','.cockpitmap','#coach','#guide','#touch-controls','.sheet.open'];
  const boxes={};for(const s of selectors){const e=document.querySelector(s);if(!e||!e.checkVisibility()||!e.getBoundingClientRect().width)continue;const r=e.getBoundingClientRect();boxes[s]={left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};}
  const collisions=[];for(const [s,a]of Object.entries(boxes))for(const [t,b]of Object.entries(boxes)){if(s>=t||s==='#touch-controls'&&t==='.tl-hint')continue;if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)collisions.push([s,t]);}
  const outside=Object.entries(boxes).filter(([s,r])=>r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5).map(([s])=>s);
  const strip=document.querySelector('#strip');return {boxes,collisions,outside,stripOverflow:strip.checkVisibility()&&strip.scrollWidth>strip.clientWidth+1,radioLive:document.querySelector('#radio').getAttribute('aria-live')};
 });
 row.viewport={width,height,touch};row.context=context;results.push(row);
 if(row.collisions.length||row.outside.length||row.stripOverflow)failures.push({viewport:row.viewport,context,collisions:row.collisions,outside:row.outside,stripOverflow:row.stripOverflow});
 if(['normal','map','guide','sheet'].includes(context))await page.screenshot({path:`${out}/${production?'production-before':before?'before':'after'}-${width}x${height}${touch?'-touch':''}-${context}.png`});
 }
 await page.close();
 }
}finally{await browser.close();await server?.close();}
const report={fixture:'Actual HUD DOM/CSS with injected safe ATIS text; no flight simulation',origin,before,production:!!production,cases:results.length,failures,results};
await fs.writeFile(`${out}/${production?'production-before':before?'before':'after'}-layout.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:results.length,failures},null,2));
if(!before&&!production)assert.equal(failures.length,0,'HUD intersections, bounds and strip overflow');
