import { puppeteer, chromeExecutable, createPage, fixtureURL, evidenceDirectory } from '../tools/qa-browser-support.mjs';
import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const OUT=await evidenceDirectory('audio-proof');
const browser=await puppeteer.launch({headless:true,executablePath:chromeExecutable(),args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=user-gesture-required']});
const page=await createPage(browser);page.on('pageerror',e=>console.error('PAGEERROR',e.stack));
try{
 await page.goto(fixtureURL('/test/sr71-audio-offline.html'));
 await page.waitForFunction(()=>window.sr71AudioOfflineReport,{timeout:180000});
 const report=await page.evaluate(()=>sr71AudioOfflineReport);await writeFile(OUT+'/offline-metrics.json',JSON.stringify(report,null,2));
 const audio=await page.evaluate(()=>sr71AudioRender);await writeFile(OUT+'/chromium-transitions.wav',Buffer.from(audio));
 console.log(JSON.stringify({pass:report.pass,decoded:report.decoded,checks:report.checks,levels:report.levels.map(({cockpit,ab,rms,peak,relativeToMilitaryDb})=>({cockpit,ab,rms,peak,relativeToMilitaryDb})),beforeExterior:report.beforeExterior},null,2));
 assert.equal(report.pass,true,report.errors.join('\n'));
}finally{await browser.close();}
