import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { SECURITY_HEADERS } from '../functions/_lib/embed-policy.js';

const outDir=process.env.SMOKE_OUTPUT_DIR || '/tmp/earthwing-smoke';
await fs.mkdir(outDir,{recursive:true});
const injected=process.argv.includes('--inject-failure');
const root=path.resolve('dist');const missingLocal=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.glb':'model/gltf-binary','.xml':'application/xml','.txt':'text/plain'};
// Local static Pages-convention fixture, not a claim of a live Cloudflare deployment.
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://fixture');const requested=decodeURIComponent(url.pathname);
    if(url.pathname==='/api/traffic'||url.pathname==='/api/metar'){res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':'application/json'});res.end(url.pathname==='/api/traffic'?JSON.stringify({ac:[]}):'[]');return;}
    let file=path.resolve(root,'.'+requested);if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
    try{if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');}catch{}
    let status=200,body;try{body=await fs.readFile(file);}catch{status=404;missingLocal.push(requested);file=path.join(root,'404.html');body=await fs.readFile(file);}
    res.writeHead(status,{...SECURITY_HEADERS,'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);
  }catch{res.writeHead(500);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
function png(){
 const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(256);head.writeUInt32BE(256,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(256*(1+256*3));for(let y=0;y<256;y++)for(let x=0;x<256;x++)raw[y*769+1+x*3]=128; // zero-metre Terrarium, synthetic red imagery
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
let browser, page;const errors=[],requests=[];let report;
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,protocolTimeout:180000,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 page=await browser.newPage();await page.setViewport({width:960,height:640});
 page.on('pageerror',e=>errors.push({kind:'page',detail:e.message}));
 page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',detail:m.text(),url:m.location().url});});
 page.on('requestfailed',r=>errors.push({kind:'request',detail:r.url(),reason:r.failure()?.errorText}));
 await page.setRequestInterception(true);
 page.on('request',async r=>{try{if(new URL(r.url()).origin===origin||/^(data:|blob:)/.test(r.url()))await r.continue();else{requests.push(r.resourceType());await r.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'image/png',body:Buffer.from(png(),'base64')});}}catch(e){errors.push({kind:'harness',detail:e.message});if(page){report=await page.evaluate(()=>({load:document.querySelector('#loadmsg')?.textContent,events:window.__earthwingDebug?.events()})).catch(()=>null);await page.screenshot({path:path.join(outDir,'smoke-failed.png')}).catch(()=>{});}}});
 await page.evaluateOnNewDocument(({origin,png})=>{
   localStorage.setItem('sr71sim.settings',JSON.stringify({gfx:'low',gfxV3:true,rscale:.5,metarAuto:false,buildings:false,trees:false,clouds:0,traffic:false}));
   const fixture=`const nativeFetch=self.fetch;self.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,${JSON.stringify(origin)});if(url.origin===${JSON.stringify(origin)})return nativeFetch(input,options);if(url.href.endsWith('/planet'))return Promise.resolve(new Response(JSON.stringify({tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf']}),{headers:{'Content-Type':'application/json'}}));if(url.pathname.endsWith('.pbf'))return Promise.resolve(new Response(new Uint8Array()));return Promise.resolve(new Response(Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}));};`;
   const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(url,options){if(!String(url).includes('terrain-worker')){super(url,options);return;}const resolved=new URL(url,location.href).href;const blob=URL.createObjectURL(new Blob([fixture+`await import(${JSON.stringify(resolved)});`],{type:'text/javascript'}));super(blob,{...options,type:'module'});}};
 },{origin,png:png()});
 await page.goto(origin+'/?aircraft=c172',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__sim,{timeout:120000});
 await page.click('#just-fly');await page.waitForFunction(()=>__sim.state.started&&!__sim.state.pending,{timeout:90000});
 await page.evaluate(()=>__sim.setView('cockpit'));await page.waitForFunction(()=>window.__earthwingDebug.events().some(e=>e.name==='cockpit_reached'),{timeout:15000});
 await new Promise(r=>setTimeout(r,600));
 if(injected){
   await page.evaluate(()=>{
     console.error('Controlled smoke console failure');
     setTimeout(()=>{throw new Error('Controlled smoke page failure')},0);
     const {THREE,renderer}=__sim;const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,10);camera.position.z=2;
     const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.ShaderMaterial({vertexShader:'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',fragmentShader:'void main(){ gl_FragColor = definitely_missing; }'}));mesh.frustumCulled=false;scene.add(mesh);renderer.setRenderTarget(null);renderer.render(scene,camera);
   });await new Promise(r=>setTimeout(r,250));
 }
 report=await page.evaluate(()=>{const gl=__sim.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:gl instanceof WebGL2RenderingContext,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),started:__sim.state.started,pending:!!__sim.state.pending,aircraft:__sim.aircraft,view:__sim.rig.view,frameError:window.__frameErr||null,drawCalls:__sim.renderer.info.render.calls,programs:__sim.renderer.info.programs.length,failedPrograms:__sim.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length,events:window.__earthwingDebug.events()};});
 await page.screenshot({path:path.join(outDir,injected?'smoke-injected.png':'smoke-positive.png')});
 if(report.frameError)errors.push({kind:'frame',detail:report.frameError});
 if(report.failedPrograms||report.events.some(e=>e.name==='graphics_error'))errors.push({kind:'shader',detail:'Shader/program diagnostics failed'});
 if(!report.webgl2||!report.drawCalls||!report.programs||!report.renderer.includes('SwiftShader'))errors.push({kind:'verification',detail:'Expected actual Chrome WebGL2 SwiftShader draw/program evidence'});
}catch(e){errors.push({kind:'harness',detail:e.message});if(page){report=await page.evaluate(()=>({load:document.querySelector('#loadmsg')?.textContent,events:window.__earthwingDebug?.events()})).catch(()=>null);await page.screenshot({path:path.join(outDir,'smoke-failed.png')}).catch(()=>{});}}
finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
const result={softwareRendering:'Chrome / ANGLE SwiftShader (not real GPU/phone)',syntheticWorld:true,injected,report,errors,missingLocal,mockedExternalPageRequests:requests.length};
await fs.writeFile(path.join(outDir,injected?'smoke-injected.json':'smoke-positive.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));process.exitCode=errors.length?1:0;
