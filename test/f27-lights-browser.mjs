// Real Chrome/SwiftShader GLB render; separate port, no dist edits.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.F27_LIGHTS_OUT||'/home/captures/f27-lights';await fs.mkdir(out,{recursive:true});
const server=await createServer({root,configFile:false,appType:'custom',server:{host:'127.0.0.1',port:Number(process.env.F27_LIGHTS_PORT||5188),strictPort:true,hmr:false,watch:{ignored:['**/*']}},optimizeDeps:{noDiscovery:true,include:['three','earcut']}});
const visualSnapshot=(await fs.readFile(path.join(root,'src/f27visual.js'),'utf8')).replaceAll("from './", "from '/src/");
server.middlewares.use('/__f27visual_snapshot.js',async(req,res)=>{await server.transformRequest('/src/f27visual.js');const transformed=await server.pluginContainer.transform(visualSnapshot,path.join(root,'src/f27visual.js'));res.setHeader('Content-Type','text/javascript');res.end(transformed.code);});
const code=`
import * as THREE from 'three';
import { F27Visual } from '/__f27visual_snapshot.js';
import { createF27LightRig, prepareF27Part } from '/src/f27lights.js';
try {
const fixed=new URLSearchParams(location.search).has('fixed');
const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{antialias:false});
let creates=0; const create=gl.createProgram.bind(gl);gl.createProgram=()=>{creates++;return create();};
const renderer=new THREE.WebGLRenderer({canvas,context:gl,antialias:false});renderer.setSize(640,400);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
const debug=gl.getExtension('WEBGL_debug_renderer_info');
const scene=new THREE.Scene();scene.background=new THREE.Color('#8ab8d8');
const ambient=new THREE.HemisphereLight(0xc5e1ff,0x554b40,1.8),sun=new THREE.DirectionalLight(0xffe8c5,3);sun.position.set(30,60,30);scene.add(ambient,sun);
const envTexture=()=>{const t=new THREE.DataTexture(new Uint8Array(Array.from({length:8*4},()=>[145,165,190,255]).flat()),8,4);t.mapping=THREE.EquirectangularReflectionMapping;t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;};
scene.environment=envTexture();
const camera=new THREE.PerspectiveCamera(58,640/400,0.05,250);camera.position.set(34,13,28);camera.lookAt(0,1,0);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(240,240),new THREE.MeshStandardMaterial({color:0x55575a,roughness:0.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.5;scene.add(floor);
const visual=new F27Visual(scene),rig=fixed?createF27LightRig(scene):null;
if(fixed)visual.preparePart=async part=>{rig.attach(part);await prepareF27Part(renderer,part,scene,camera);};
await visual.load('/models/f27/f27-white-ext-v3.glb');await visual.preloadCockpit();
const parts=visual.parts;
let nodes=0,materials=new Set();visual.interior.root.traverse(o=>{nodes++;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m.uuid);});
let active=visual.exterior;
function view(kind){active=kind==='cockpit'?visual.interior:visual.exterior;for(const p of parts)p.root.visible=p===active;
 if(kind==='cockpit'){camera.position.copy(visual.eye);camera.lookAt(camera.position.clone().add(new THREE.Vector3(10,-0.45,0)));}else{camera.position.set(34,13,28);camera.lookAt(0,1,0);} }
function env(mode){const f=mode==='day'?1:mode==='dusk'?0.18:0.012;ambient.intensity=1.8*f;sun.intensity=3*f;scene.background.set(mode==='day'?'#8ab8d8':mode==='dusk'?'#453b57':'#02040b');}
function render(label,options={}){if(options.view)view(options.view);if(options.env)env(options.env);if(options.lights)visual.setLights(options.lights);
 for(const p of parts)p.adapter.update(options.time??0.05);rig?.update(active);
 const before=creates,start=performance.now();renderer.render(scene,camera);gl.finish();
 const ms=performance.now()-start;const sample={label,ms,programDelta:creates-before,programs:renderer.info.programs.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};console.log('F27_FRAME',JSON.stringify(sample));return sample;}
view('orbit');const initial=render('initial');
const samples=[];for(const [label,options] of [
 ['landing on',{lights:{landing:true}}],['taxi on',{lights:{taxi:true}}],['wing on',{lights:{wingInspection:true}}],
 ['cockpit first',{view:'cockpit'}],['white dome on',{lights:{cockpitDome:true}}],['red dome on',{lights:{cockpitDomeRed:true}}],
 ['instruments 0.6',{lights:{instruments:0.6}}],['all lights off',{lights:{landing:false,taxi:false,wingInspection:false,cockpitDome:false,cockpitDomeRed:false,instruments:0}}],
 ['cockpit night',{env:'night',lights:{cockpitDomeRed:0.65,instruments:0.6}}],['orbit night',{view:'orbit',lights:{landing:true,taxi:true,wingInspection:true}}],
 ['orbit dusk',{env:'dusk'}],['cockpit dusk',{view:'cockpit'}],['cockpit day',{env:'day'}],['orbit day',{view:'orbit'}],
 ['beacon off frame',{time:0.3}],['beacon on frame',{time:1.21}],
 ]) samples.push(render(label,options));
scene.environment=envTexture();visual.setEnv(scene.environment);samples.push(render('same-kind environment replacement'));
const checks={};view('cockpit');visual.setLights({cockpitDomeRed:0.7,instruments:0.6});rig?.update(active);
checks.sourceBeams=active.adapter.lights.filter(l=>l.isSpotLight).map(l=>({name:l.name,intensity:l.intensity,visible:l.visible}));
checks.pool=fixed?{spots:rig.spots.length,points:rig.points.length,sourcesMasked:parts.every(p=>p.adapter.lights.every(l=>l.layers.mask===0))}:null;
window.qa={fixed,initial,samples,nodes,materials:materials.size,checks,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),programsCreated:creates};
window.captureMode=mode=>{env(mode);render(mode);document.querySelector('#label').textContent='F27 '+(fixed?'fixed light budget':'baseline')+' · '+mode+' · real SwiftShader render';};captureMode('night');
window.ready=true;
}catch(e){window.failure=e.stack;}
`;
server.middlewares.use('/__f27_lights',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0;background:#111;color:white;font:16px system-ui}canvas{display:block}#label{padding:12px}</style><canvas></canvas><div id="label">Preparing real F27 GLBs…</div><script type="module">'+browserCode+'</script>');});
await server.listen();
const transformedLights=await server.transformRequest('/src/f27lights.js');
const threeURL=transformedLights.code.match(/from ["']([^"']+)/)[1];
const browserCode=code.replace("from 'three'", "from '"+threeURL+"'");
let browser;
const report={method:'performance.now around renderer.render + gl.finish; actual software GPU; one deterministic pass, not FPS or hardware claim',results:[]};
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:process.env.F27_LIGHTS_VISIBLE!=='1',env:{...process.env,DISPLAY:':97'},protocolTimeout:240000,args:['--no-sandbox','--disable-gpu-watchdog','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 for(const fixed of [false,true]){
  const page=await browser.newPage();await page.setViewport({width:800,height:520});
  page.on('pageerror',e=>console.error('PAGE',e.message));page.on('console',m=>{if(m.text().startsWith('F27_FRAME'))console.log(fixed?'FIXED':'BASELINE',m.text());});
  await page.goto('http://127.0.0.1:'+server.config.server.port+'/__f27_lights'+(fixed?'?fixed':''),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.ready||window.failure,{timeout:240000,polling:250});
  const fail=await page.evaluate(()=>window.failure);if(fail)throw new Error(fail);
  const result=await page.evaluate(()=>window.qa);report.results.push(result);console.log(JSON.stringify(result));
  for(const mode of ['day','dusk','night']){await page.evaluate(mode=>window.captureMode(mode),mode);await page.screenshot({path:path.join(out,(fixed?'fixed':'baseline')+'-'+mode+'.png')});}
  await page.close();
 }
 const fixed=report.results[1];assert.equal(fixed.checks.pool.sourcesMasked,true);assert.ok(fixed.samples.every(s=>s.programDelta===0),'no shader program creation on switch/view/environment after preparation');
} catch(e){report.failure=e.stack;console.error(e);}finally{await browser?.close();await server.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.failure)process.exitCode=1;
