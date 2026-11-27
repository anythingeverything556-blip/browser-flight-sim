// Node checks always run; --browser also uses isolated headless Chromium and a
// loopback-only real-model fixture. It never touches the shared visible browser.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {SR71AfterburnerFX, sr71BurnerIntensity} from '../src/sr71-afterburner-fx.js';
import {FlightModel} from '../src/flight.js';
import {FX_LAYER} from '../src/layers.js';
let checks = 0;
function check(name, fn) {fn(); checks++; console.log('PASS', name);}
const hot = () => ({abLit:true, ab:1, thrust:145000, dry:1, unstart:0});
check('actual ignition AND combustion required, never throttle or residual spool', () => {
  assert.equal(sr71BurnerIntensity(hot()), 1);
  for (const state of [{abLit:false}, {thrust:0}, {thrust:-1}, {unstart:1}, {fail:true},
    {lit:false}, {producing:false}, {combustion:false}, {ab:0}, {ab:NaN}]) {
    assert.equal(sr71BurnerIntensity({...hot(), ...state}, {throttle:1}), 0, JSON.stringify(state));
  }
  for (const state of [{crashed:'impact'}, {engineRunning:false}]) assert.equal(sr71BurnerIntensity(hot(), state), 0);
  assert.equal(sr71BurnerIntensity({abLit:true,ab:1,dry:1}, {throttle:1}), 0);
  assert.equal(sr71BurnerIntensity({abLit:true,ab:.35,combustion:true}), .35);
  assert.equal(sr71BurnerIntensity({abLit:true,ab:1,combustion:true,thrust:NaN}), 1);
  assert.equal(sr71BurnerIntensity({...hot(),ab:20}), 1);
  assert.equal(sr71BurnerIntensity(undefined), 0);
});
async function sourceAnchors(file) {
  const data=JSON.parse(await readFile(new URL('../public/models/sr71/exterior/'+file, import.meta.url)));
  const nodes=data.nodes.map(n=>{const o=new THREE.Group();o.name=n.name||'';
    if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);
    if(n.scale)o.scale.fromArray(n.scale);if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}return o;});
  data.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
  const root=new THREE.Group();root.rotation.y=Math.PI/2;
  data.scenes[data.scene||0].nodes.forEach(i=>root.add(nodes[i]));return root;
}
const source=await sourceAnchors('exterior-flight.gltf'), detailed=await sourceAnchors('exterior.gltf');
const parent=new THREE.Group(), fx=new SR71AfterburnerFX(parent), offset=new THREE.Vector3(.6,-.2,0);
fx.bind(source,offset);
check('authored left/right anchors, original forward axis and both LODs agree',()=>{
  const highFX=new SR71AfterburnerFX(new THREE.Group());highFX.bind(detailed,offset);
  for(let i=0;i<2;i++) {
    assert(fx.engines[i].bound);assert(highFX.engines[i].bound);
    assert(fx.engines[i].group.position.distanceTo(highFX.engines[i].group.position)<1e-8);
    const d=new THREE.Vector3(0,0,-1).applyQuaternion(fx.engines[i].group.quaternion);
    assert(d.x<-.99999);assert(Math.abs(d.y)<1e-5);
    assert.equal(fx.engines[i].meshes.length,2);
    for(const mesh of fx.engines[i].meshes){assert.equal(mesh.layers.mask,1<<FX_LAYER);assert(mesh.material.depthTest);assert(!mesh.material.depthWrite);}
  }
  assert(fx.engines[0].group.position.z<0);assert(fx.engines[1].group.position.z>0);
});
const state={engines:[hot(),{...hot(),abLit:false}],pos:new THREE.Vector3(),quat:new THREE.Quaternion(),out:{rho:1.225}};
const cw=new THREE.Vector3();
check('independent engine groups, immutable flight state, shutdown clears shader energy',()=>{
  const snapshot=JSON.stringify(state);fx.update(.1,state,cw,-100);
  assert.equal(JSON.stringify(state),snapshot);assert(fx.engines[0].group.visible);assert(!fx.engines[1].group.visible);
  state.engines.reverse();fx.update(0,state,cw,-100);
  assert(!fx.engines[0].group.visible);assert(fx.engines[1].group.visible);
  state.engines[1].thrust=0;fx.update(0,state,cw,-100);
  for(const e of fx.engines){assert(!e.group.visible);for(const m of e.meshes)assert.equal(m.material.uniforms.uIntensity.value,0);}
  assert.equal(fx.time,.1);fx.update(-1,state,cw,-100);fx.update(NaN,state,cw,-100);assert.equal(fx.time,.1);
});
check('missing authored anchors fail closed, not at a guessed position',()=>{
  const missing=new SR71AfterburnerFX(new THREE.Group());missing.bind(new THREE.Group(),offset);
  missing.update(.1,{engines:[hot(),hot()]},cw,-100);assert(missing.engines.every(e=>!e.group.visible));
});
check('ground clipping follows aircraft attitude and camera-relative rebasing',()=>{
  state.engines=[hot(),hot()];state.quat.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/4);
  parent.quaternion.copy(state.quat);parent.position.set(1000,1,0);fx.update(0,state,cw,0);
  assert(fx.engines.every(e=>!e.group.visible));
  parent.position.y=100;fx.update(0,state,cw,0);assert(fx.engines.every(e=>e.group.visible));
  const lengths=fx.engines.map(e=>e.meshes[0].scale.z);parent.position.y-=300;cw.y=300;
  fx.update(0,state,cw,0);assert.deepEqual(fx.engines.map(e=>e.meshes[0].scale.z),lengths);
});
check('real J58 fuel cutoff is immediately dark with residual ab; relight waits for ignition',()=>{
  const fdm=new FlightModel();fdm.reset(new THREE.Vector3(0,5000,0),90,300,false);fdm.realism.unstarts=false;
  fdm.setEngines(1,true);const step=()=>fdm.step(1/120,()=>-10000,new THREE.Vector3());step();
  assert(fdm.engines.every(e=>sr71BurnerIntensity(e,fdm)>0));
  fdm.fuel=0;step();assert(fdm.engines.every(e=>e.dry>0&&e.ab>0&&e.thrust===0));
  assert(fdm.engines.every(e=>sr71BurnerIntensity(e,fdm)===0));
  fdm.fuel=10000;step();assert(fdm.engines.every(e=>!e.abLit&&sr71BurnerIntensity(e,fdm)===0));
  for(let i=0;i<150;i++)step();assert(fdm.engines.every(e=>e.abLit&&sr71BurnerIntensity(e,fdm)>0));
});
check('volume eye uniform respects moving camera, aircraft rotation and nonuniform length',()=>{
  const camera=new THREE.PerspectiveCamera();camera.position.set(-41,13,27);
  parent.updateWorldMatrix(true,true);camera.updateWorldMatrix(true,false);
  for(const e of fx.engines)for(const mesh of e.meshes){
    mesh.onBeforeRender(null,null,camera);
    const recovered=mesh.material.uniforms.uEye.value.clone().applyMatrix4(mesh.matrixWorld);
    assert(recovered.distanceTo(camera.position)<1e-8);
    assert.equal(mesh.material.side,THREE.FrontSide);
    assert(!mesh.geometry.parameters.openEnded);
    assert.equal(mesh.material.blending,THREE.AdditiveBlending);
  }
});
console.log(`${checks} focused SR-71 afterburner checks passed`);

if(process.argv.includes('--browser')) {
  const {createServer}=await import('vite');const {default:puppeteer}=await import('puppeteer-core');
  const out=process.env.SR71_FX_PROOF_DIR||'/home/captures/sr71-afterburner-local';await mkdir(out,{recursive:true});
  const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/*']}}});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  let browser;const errors=[],external=[],report={renderer:'isolated headless Chromium SwiftShader, real included SR-71 geometry; injected engine states for controlled visual comparisons',checks:[]};
  try {
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
    const page=await browser.newPage();await page.setViewport({width:1200,height:800});
    await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin)||r.url().startsWith('data:')||r.url().startsWith('blob:'))r.continue();else{external.push(r.url());r.abort();}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|Shader|WebGL/.test(m.text()))errors.push(m.text());});
    await page.goto(origin+'/test/sr71-integration.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.qa?.ready||window.qa?.errors?.length,{timeout:180000});
    assert.deepEqual(await page.evaluate(()=>qa.errors),[]);
    await page.evaluate(()=>{
      const q=qa;q.camera.position.set(-34,9,22);q.camera.lookAt(-5,0,0);q.camera.layers.enable(7);
      q.fdm.engines.forEach(e=>Object.assign(e,{abLit:true,ab:1,dry:1,thrust:145000}));q.fdm.gearPos=0;q.visual.view='chase';
      window.fxPixels=()=>{q.draw();const gl=q.renderer.getContext(),p=new Uint8Array(1200*800*4);gl.readPixels(0,0,1200,800,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
      window.fxChanged=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)n++;return n;};
      q.visual.afterburnerFX.root.visible=false;window.beforeFX=fxPixels();document.querySelector('header').textContent='Local browser approximation regression · same real aircraft + camera · effect disabled (before)';
    });
    await page.screenshot({path:out+'/before-effect-disabled.png'});
    const enabled=await page.evaluate(()=>{qa.visual.afterburnerFX.root.visible=true;window.bothFX=fxPixels();document.querySelector('header').textContent='Local browser approximation regression · injected ignited/combusting engines · both afterburners ON';return {changed:fxChanged(beforeFX,bothFX),engines:qa.visual.afterburnerFX.engines.map(e=>({visible:e.group.visible,bound:e.bound,intensity:e.intensity,position:e.group.position.toArray()}))};});
    assert(enabled.changed>200,JSON.stringify(enabled));report.checks.push({name:'real-model before/after both visible',...enabled});
    await page.screenshot({path:out+'/after-both-lit.png'});
    const independent=await page.evaluate(()=>{
      qa.fdm.engines[1].abLit=false;const left=fxPixels();qa.fdm.engines[0].abLit=false;qa.fdm.engines[1].abLit=true;const right=fxPixels();
      qa.fdm.engines[1].thrust=0;const off=fxPixels();
      return {leftPixels:fxChanged(beforeFX,left),rightPixels:fxChanged(beforeFX,right),shutdownPixels:fxChanged(beforeFX,off)};
    });
    assert(independent.leftPixels>80&&independent.rightPixels>80);assert.equal(independent.shutdownPixels,0);report.checks.push({name:'each engine independently changes pixels; fuel-cutoff matches off exactly',...independent});
    await page.evaluate(()=>{qa.fdm.engines.forEach(e=>Object.assign(e,{abLit:true,ab:1,thrust:145000}));qa.fdm.engines[1].abLit=false;qa.draw();document.querySelector('header').textContent='Local browser approximation · injected LEFT-only ignition · right burner OFF';});
    await page.screenshot({path:out+'/left-only.png'});
    const views=await page.evaluate(async()=>{
      const fx=qa.visual.afterburnerFX;const chase=fx.root.parent===qa.visual.root;
      qa.visual.view='cockpit';qa.draw();const cockpit=fx.engines.map(e=>e.group.visible);
      qa.visual.view='chase';await qa.visual.setDetail('high');qa.draw();const high=fx.engines.map(e=>e.group.visible);const groups=fx.root.children.length;
      await qa.visual.setDetail('flight');qa.draw();qa.camera.layers.disable(7);const layerOff=fxPixels();qa.camera.layers.enable(7);fxPixels();
      return {chase,cockpit,high,groups,layerOffPixels:fxChanged(beforeFX,layerOff)};
    });
    assert(views.chase);assert.deepEqual(views.cockpit,[true,false]);assert.deepEqual(views.high,[true,false]);assert.equal(views.groups,2);assert.equal(views.layerOffPixels,0);report.checks.push({name:'cockpit/detail separation, no duplicate FX, exclusive FX layer',...views});
    await page.evaluate(()=>{qa.visual.view='chase';qa.camera.position.set(-14,5,38);qa.camera.lookAt(-7,0,0);qa.fdm.engines[1].abLit=true;qa.draw();document.querySelector('header').textContent='Local browser approximation · injected both-engine ignition · side/rear-quarter view';});
    await page.screenshot({path:out+'/after-side-quarter.png'});
    const appearance=await page.evaluate(()=>{
      const fx=qa.visual.afterburnerFX;qa.camera.layers.set(7);qa.draw();
      const drawCalls=qa.renderer.info.render.calls, triangles=qa.renderer.info.render.triangles;
      fx.time=0;const still=fxPixels();fx.time=.113;const moving=fxPixels();const repeat=fxPixels();
      const animatedPixels=fxChanged(still,moving),repeatPixels=fxChanged(moving,repeat);
      const gl=qa.renderer.getContext(),precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      qa.camera.layers.enable(0);fx.time=0;
      qa.camera.position.set(-44,1.3,.1);qa.camera.lookAt(-8,.6,0);
      const rear=fxPixels();fx.root.visible=false;const rearOff=fxPixels();fx.root.visible=true;fxPixels();
      document.querySelector('header').textContent='Local approximation · both engines · nearly axial rear view (ray singularity regression)';
      return {drawCalls,triangles,animatedPixels,repeatPixels,rearPixels:fxChanged(rear,rearOff),
        highFloat:{precision:precision.precision,rangeMin:precision.rangeMin,rangeMax:precision.rangeMax},
        webgl:gl.getParameter(gl.VERSION),samplesPerFragment:10};
    });
    assert.equal(appearance.drawCalls,4,'two volume draws per engine, no double-sided extra passes');
    assert(appearance.animatedPixels>200,'advected detail must actually change rendered pixels');
    assert.equal(appearance.repeatPixels,0,'fixed time must produce identical pixels');
    assert(appearance.rearPixels>200,'end-on volume cannot disappear behind its proxy cap');
    report.checks.push({name:'bounded two-pass volumes, animation, repeatability and axial view',...appearance});
    await page.screenshot({path:out+'/after-axial-rear.png'});
    await page.evaluate(()=>{
      qa.camera.position.set(-15,3.0,20);qa.camera.lookAt(-14,.6,1);qa.draw();
      document.querySelector('header').textContent='Local approximation · owned procedural turbulence · close side/rear-quarter view';
    });
    await page.screenshot({path:out+'/after-close-quarter.png'});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.pass=true;
    console.log('PASS isolated real-model WebGL browser pixel comparisons',JSON.stringify(report.checks));
  } catch(e) {report.pass=false;report.error=e.stack;throw e;}
  finally {report.errors=errors;report.blockedExternalRequests=external;await writeFile(out+'/results.json',JSON.stringify(report,null,2));if(browser)await browser.close();await server.close();}
}
