// Real Chromium OfflineAudioContext regression; loopback only, no speakers.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const files=new Map([
 ['/src/sr71audio.js',['../src/sr71audio.js','text/javascript']],
 ['/models/sr71/exterior/sounds/gear-travel-state-1551306158.flac',
  ['../public/models/sr71/exterior/sounds/gear-travel-state-1551306158.flac','audio/flac']]
]);
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>SR-71 event lifecycle test</title>');return;}
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=files.get(req.url);if(!file){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file[1]);res.end(await readFile(new URL(file[0],import.meta.url)));
 }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']});
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',request=>void(request.url().startsWith(origin+'/')?request.continue():request.abort()));
 await page.goto(origin);
 const report=await page.evaluate(async()=>{
  const {SR71Audio}=await import('/src/sr71audio.js');
  const bytes=await(await fetch('/models/sr71/exterior/sounds/gear-travel-state-1551306158.flac')).arrayBuffer();
  const sample=await new OfflineAudioContext(1,1,48000).decodeAudioData(bytes);
  const rms=(buffer,from,to)=>{
   const d=buffer.getChannelData(0);let sum=0,n=0;
   for(let i=Math.ceil(from*buffer.sampleRate);i<Math.floor(to*buffer.sampleRate);i++){sum+=d[i]**2;n++;}
   return Math.sqrt(sum/n);
  };
  async function render(reset){
   const ctx=new OfflineAudioContext(1,2*48000,48000),audio=new SR71Audio();
   audio.ctx=ctx;audio.mix=ctx.createGain();audio.mix.connect(ctx.destination);
   audio.flightActive=true;audio.buffers.set('gearTravelA',Promise.resolve(sample));
   await audio.playOriginal('gearTravelA');
   const suspended=ctx.suspend(.75),rendered=ctx.startRendering();await suspended;
   if(reset)audio.resetForSpawn();
   // A new active flight can open the same master bus immediately. No new
   // event or engine is requested, so any later PCM is leaked from the old one.
   audio.flightActive=true;await ctx.resume();const b=await rendered;
   return {beforeRms:rms(b,.25,.65),afterRms:rms(b,.85,1.5)};
  }
  return {sampleDuration:sample.duration,control:await render(false),reset:await render(true)};
 });
 console.log(JSON.stringify(report,null,2));
 assert(report.control.beforeRms>1e-4,'actual original gear sample is audible before reset');
 assert(report.control.afterRms>1e-4,'control proves sample would continue into the next flight');
 assert(Math.abs(report.reset.beforeRms-report.control.beforeRms)<1e-9,'reset does not change original PCM before transition');
 assert(report.reset.afterRms<1e-9,'old gear PCM must be silent after reset/new flight');
 console.log('PASS Chromium original-sample event reset: old-flight tail stops, original pre-reset PCM unchanged');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
