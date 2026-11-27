import { puppeteer, chromeExecutable, createPage, fixtureURL, evidenceDirectory, delay } from '../tools/qa-browser-support.mjs';
import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const OUT=await evidenceDirectory('audio-proof');
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required']});
const page=await createPage(browser,{viewport:{width:960,height:600}}),requests=[],errors=[],report={checks:[],samples:[]};
const check=(pass,name)=>{report.checks.push({pass:!!pass,name});if(!pass)throw Error(name);};
page.on('request',r=>{if(/\/(sounds|audio)\//.test(r.url())&&/sr71/.test(r.url()))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['ws://*','wss://*']});
await page.evaluateOnNewDocument(()=>{const nativeFetch=window.fetch;window.soundFetches=[];
 window.fetch=function(url,...args){if(typeof url==='string'&&/sr71\/(?:exterior\/sounds|audio)\//.test(url))soundFetches.push({url,loading:document.querySelector('#loadscreen')?.hidden===false,started:!!window.__sim?.state.started,pending:!!window.__sim?.state.pending});return nativeFetch.call(this,url,...args);};
 localStorage.setItem('sr71sim.settings',JSON.stringify({aircraft:'sr71',gfx:'low',rscale:.5,trees:false,buildings:false,traffic:false,clouds:0,metarAuto:false,crash:false}));});
try{
 await page.goto(fixtureURL('/?aircraft=sr71'),{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__simReady,{timeout:180000});
 check(requests.length===0,'home has zero original sound/manifest fetches before gesture');
 await page.mouse.click(950,590);await delay(300);
 const unlocked=await page.evaluate(()=>({ctx:__sim.audio.ctx?.state,started:__sim.state.started}));
 check(!unlocked.started&&requests.length===0,'home gesture unlock does not fetch or play source audio');
 await page.click('#just-fly');
 await page.waitForFunction(()=>window.__sim?.state.started&&!__sim.state.pending&&document.querySelector('#loadscreen').hidden,{timeout:180000});
 await page.evaluate(()=>{const s=__sim;s.settings.crash=false;s.fdm.crashOff=true;s.setView('chase');s.state.paused=false;document.querySelector('#g-quit')?.click();document.querySelector('#coach-skip')?.click();
   // Keep actual main update arguments/AudioContext; isolate engines from motion
   // and expensive world rendering without editing application code.
   s.controls.throttle=.75;s.controls.engTrim=[0,0];s.fdm.throttle=.75;s.fdm.leverTrim=[0,0];s.fdm.setEngines(.75,true);
   const a=s.audio,ctx=a.ctx;window.audioAnalyser=ctx.createAnalyser();audioAnalyser.fftSize=4096;a.mix.connect(audioAnalyser);
   const capture=ctx.createMediaStreamDestination();a.mix.connect(capture);window.audioChunks=[];window.audioRecorder=new MediaRecorder(capture.stream,{mimeType:'audio/webm;codecs=opus'});audioRecorder.ondataavailable=e=>audioChunks.push(e.data);audioRecorder.start();
 });
 await page.waitForFunction(()=>__sim.audio.manifest&&Object.values(__sim.audio.loops).some(x=>x.source),{timeout:120000});
 const sample=async(name)=>{await delay(700);const data=await page.evaluate(async()=>{
   const frames=[];for(let j=0;j<6;j++){const a=new Float32Array(audioAnalyser.fftSize);audioAnalyser.getFloatTimeDomainData(a);let energy=0,peak=0;for(const x of a){energy+=x*x;peak=Math.max(peak,Math.abs(x));}frames.push({rms:Math.sqrt(energy/a.length),peak});await new Promise(r=>setTimeout(r,90));}
   return {context:__sim.audio.ctx.state,state:{started:__sim.state.started,paused:__sim.state.paused,pending:!!__sim.state.pending},engines:__sim.fdm.engines.map(e=>({...e})),telemetry:__sim.audio.telemetry,frames};
 });data.name=name;data.rms=Math.sqrt(data.frames.reduce((n,f)=>n+f.rms*f.rms,0)/data.frames.length);report.samples.push(data);console.log(name,JSON.stringify({rms:data.rms,engines:data.telemetry.engines,voices:data.telemetry.voices.length,state:data.state}));return data;};
 const dry=await sample('actual military');check(dry.context==='running'&&dry.rms>1e-4,'actual game gesture-unlocked AudioContext produces measured audio');
 await page.evaluate(()=>{__sim.controls.throttle=.76;__sim.fdm.throttle=.76;});
 await page.waitForFunction(()=>__sim.fdm.engines.every(e=>e.abLit&&e.ab>=.35),{timeout:20000});
 const min=await sample('actual minimum afterburner');check(min.telemetry.engines.every(e=>e.ab>=.35),'solver actual burner state reaches sound arguments');
 await page.evaluate(()=>{__sim.controls.throttle=1;__sim.fdm.throttle=1;});
 await page.waitForFunction(()=>__sim.fdm.engines.every(e=>e.ab>.98),{timeout:20000});
 await sample('actual maximum afterburner');
 await page.evaluate(()=>{__sim.fdm.fuel=0;__sim.fdm.unlimitedFuel=false;});
 await page.waitForFunction(()=>__sim.fdm.engines.every(e=>e.thrust===0),{timeout:10000});
 const cut=await sample('actual fuel cutoff with residual spool');check(cut.rms<1e-6&&cut.telemetry.voices.length===0,'actual solver fuel cutoff is silent despite residual spool');
 await page.evaluate(()=>{__sim.fdm.fuel=10000;__sim.controls.throttle=.76;__sim.fdm.throttle=.76;__sim.advance(7);});
 await page.waitForFunction(()=>__sim.fdm.engines.every(e=>e.abLit&&e.ab>.35),{timeout:20000});
 const relit=await sample('actual reignition');check(relit.rms>1e-4,'actual solver reignition resumes original playback');
 await page.evaluate(()=>__sim.setView('cockpit'));
 await page.waitForFunction(()=>__sim.audio.telemetry.view==='inside'&&__sim.audio.telemetry.voices.some(v=>__sim.audio.manifest.clips.some(c=>c.sound===v.sound&&c.view==='inside')) ,{timeout:120000});
 await delay(1500);const cockpit=await sample('actual cockpit afterburner');check(cockpit.rms>1e-4,'actual cockpit uses identified interior sources and plays');
 await page.evaluate(()=>{window.recordDone=new Promise(r=>{audioRecorder.onstop=async()=>r(Array.from(new Uint8Array(await new Blob(audioChunks).arrayBuffer())));});audioRecorder.stop();});
 const capture=await page.evaluate(()=>recordDone);await writeFile(OUT+'/real-game-playback.webm',Buffer.from(capture));
 report.minimumAfterburnerVsDryDb=20*Math.log10(min.rms/dry.rms);report.soundRequests=requests;report.soundFetches=await page.evaluate(()=>soundFetches);check(report.soundFetches.length>0&&report.soundFetches.every(r=>r.started&&!r.pending&&!r.loading),'all actual source network requests start in live flight after the loading overlay');report.pageErrors=errors;check(errors.length===0,'no unhandled page errors');report.pass=true;
}catch(e){report.pass=false;report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await writeFile(OUT+'/live-game-metrics.json',JSON.stringify(report,null,2));await browser.close();}
