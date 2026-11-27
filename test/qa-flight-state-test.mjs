// Deterministic regressions for EW-04,07–11,30–34,38,45. Run from checkout root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { makeWeatherPreferences, weatherSnapshot, restoreWeather, cleanWeatherSnapshot } from '../src/flight-weather.js';
import { FlightLogbook, cleanSetup } from '../src/logbook.js';
import { parseMetar, interpretMetar } from '../src/metar.js';
import { slewExit, slewExitSpeed } from '../src/slew.js';
import { C172Model } from '../src/c172.js';
import { AircraftSystems } from '../src/systems.js';
import { mountGraphicsRecovery } from '../src/graphics-recovery.js';
import { imageryNotice } from '../src/imagery-notice.js';
import { effectiveRenderRatio, syncRendererSize } from '../src/renderer-size.js';
const main = fs.readFileSync('src/main.js', 'utf8');
const section = (a,b) => main.slice(main.indexOf(a),main.indexOf(b,main.indexOf(a)));
const setup = { aircraft:'c172', airport:'KBAB', rwy:0, end:1, mode:'approach', mission:'free', weather:'metar', hour:15 };
const initialWx = { weather:'metar', clouds:1, cloudBase:700, windDir:240, windSpd:12, turb:.3, vis:.4, metarAuto:true, runClock:false, metarWx:{rain:.5,gloom:.6,fog:.7,bolts:0} };
const store = () => { let value; return {getItem:()=>value,setItem:(k,v)=>value=v}; };
const book = () => { const memory = store(); return new FlightLogbook(() => memory); };
{
  const settings = structuredClone(initialWx), prefs = makeWeatherPreferences(settings);
  prefs.begin(); Object.assign(settings,{weather:'clear',clouds:0,metarAuto:false,metarWx:undefined}); settings.voiceWarn=false;
  assert.deepEqual(prefs.serialized(), {...initialWx,voiceWarn:false});
  prefs.begin(); settings.volume=.3; assert.equal(prefs.serialized().metarAuto,true);
  prefs.commit(); assert.equal(prefs.serialized().weather,'clear');
  assert.match(main,/LS.set\('settings', weatherPreferences.serialized\(\)\)/);
  const quickSettings = structuredClone(initialWx), quickPrefs = makeWeatherPreferences(quickSettings), events = [];
  const context = vm.createContext({ AIRCRAFT:'c172', quickAircraft:'c172', window:{__simReady:true}, state:{started:false,pending:false},
    homeAirport:()=>({runways:[{}]}), home:{rwy:0,end:0}, missionKind:'', missionKindSet:()=>{}, dep:{}, weatherPreferences:quickPrefs,
    applyWeather:(kind,save)=>{ events.push([kind,save,quickPrefs.serialized().weather]); Object.assign(quickSettings,{weather:kind,clouds:0}); },
    env:{},settings:quickSettings,$:()=>({}),syncEnvUi(){},startWarm(){},spawnAt(){},beginFlight(){},showLoadUi(){},freeOrbitBehind(){},setView(){},startMission(){} });
  vm.runInContext(section('function startQuickFlight(', "$('just-fly').addEventListener"),context);
  vm.runInContext('startQuickFlight()',context);
  assert.deepEqual(events,[['clear',false,'metar']]);
  assert.equal(quickSettings.weather,'clear'); assert.equal(quickSettings.metarAuto,false);
  assert.deepEqual(quickPrefs.serialized(),initialWx);
  console.log('EW-04: temporary flight weather cannot leak through voice/volume saves');
}
{
  const logbook = book(); let state={started:true,setup:{...setup,weather:'clear'},lastSpawn:{s:{speed:33},meta:{rwy:{}},fuel:90}};
  let missions=0;
  const context=vm.createContext({state,logbook,settings:initialWx,weatherSnapshot,env:{hour:16},fdm:{},spawn(s,meta){logbook.cancel();state.setup=null;state.lastSpawn={s,meta};},renderLogbook(){},startMission(){missions++;}});
  logbook.begin(state.setup); logbook.tick(100); const before=logbook.active.id;
  vm.runInContext(section('function restart()', '// free orbit'),context); vm.runInContext('restart()',context);
  assert.ok(logbook.active); assert.equal(logbook.active.duration,0); assert.equal(state.setup.mode,'approach');
  logbook.tick(3); assert.equal(logbook.land('KBAB',1),true); assert.equal(missions,1);
  state.setup=null;state.lastSpawn.meta=null;vm.runInContext('restart()',context);assert.equal(logbook.active,null);
  console.log('EW-07: restart begins a tracked attempt, can land, and teleport stays untracked');
}
{
  let resolve, applied=0, saved=0;
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const context=vm.createContext({state:{},dep:{apt:{ident:'KBAB'}},BASE:'/', $,weatherPreferences:{commit(){}},liveWeather:()=>new Promise(r=>resolve=r),applyMetarWx(){applied++;saved++;},syncWeatherStatus(){},toast(){},buildAtis(){},atc:{},console});
  vm.runInContext(section('async function loadMetar(',"$('metar-btn')")+section('function invalidateWeatherRequest()', 'function updateFlightWeather()'),context);
  for(const intent of ['reset','slider','departure','newer request']) {
    const request=vm.runInContext('loadMetar()',context);
    vm.runInContext('invalidateWeatherRequest()',context);resolve({w:{raw:''},source:'fixture'});await request;
    assert.equal(applied,0);assert.equal(context.state.wxBusy,false);
  }
  const first=vm.runInContext('loadMetar()',context), oldResolve=resolve;
  const second=vm.runInContext('loadMetar()',context);oldResolve({w:{raw:''},source:'old'});await first;assert.equal(context.state.wxBusy,true);
  resolve({w:{raw:'',windKt:0,coverage:0},source:'new'});await second;assert.equal(applied,1);assert.equal(saved,1);
  assert.match(section('function applyWeather(', '// live weather survives'),/invalidateWeatherRequest\(\)/);
  assert.match(section('function manualWeather()', 'function applyMetarWx'),/invalidateWeatherRequest\(\)/);
  assert.match(main,/\(a\) => \{ invalidateWeatherRequest\(\); dep.apt = a/);
  console.log('EW-08: stale weather requests cannot apply/save or clear a newer busy state');
}
{
  const logbook=book(), initial={...setup,weatherSnapshot:weatherSnapshot(initialWx)};logbook.begin(initial);logbook.tick(4);const id=logbook.active.id;
  const changed={...initialWx,windDir:42,metarWx:{rain:1,gloom:.8,fog:.9,bolts:1}};
  logbook.updateSetup({...initial,weatherSnapshot:weatherSnapshot(changed)});
  assert.equal(logbook.active.id,id);assert.equal(logbook.active.duration,4);
  const last=logbook.read().last;assert.equal(last.weather,'metar');const target={};assert.ok(restoreWeather(target,last.weatherSnapshot));assert.deepEqual(target,weatherSnapshot(changed));
  assert.equal(cleanWeatherSnapshot({...changed,clouds:NaN}),null);
  assert.equal(cleanSetup({...setup,weatherSnapshot:{bad:true}}).weather,'few');
  assert.ok(JSON.stringify(last).length<1000);assert.match(section('function applyMetarWx(', 'async function loadMetar('),/updateFlightWeather\(\)/);
  console.log('EW-09: bounded live weather survives resume and late METAR updates retain the attempt');
}
{
  const zero=interpretMetar(parseMetar('KBAB 211200Z 00000KT 0000 FG VV001 10/10 Q1013'));
  assert.equal(zero.visibilityMeters,50);assert.equal(zero.visibilityQualifier,'less-than');assert.equal(zero.sm,50/1609.344);assert.equal(zero.vis,.3);assert.ok(zero.fog>0);
  for(const visib of [undefined,null,'garbage',NaN,-1])assert.equal(interpretMetar({visib}).sm,10);
  for(const [visib,want] of [[0,0],['0',0],['.25',.25],['0.25',.25],['10+',10]])assert.equal(interpretMetar({visib}).sm,want);
  console.log('EW-10: zero, missing and malformed visibility remain distinct');
}
{
  const events={},buttonEvents={},status={},text={},state={flightT:4},controls={enabled:true,setLocked(v){this.locked=v;}};let held=0;
  mountGraphicsRecovery({canvas:{addEventListener:(e,fn)=>events[e]=fn},state,controls,notice:{hidden:true,querySelector:q=>q==='button'?{addEventListener:(e,fn)=>buttonEvents[e]=fn}:text},status,holdAudio(){held++;}});
  let prevented=false;events.webglcontextlost({preventDefault(){prevented=true;}});assert.ok(prevented&&state.graphicsHold&&controls.locked&&!controls.enabled);assert.equal(held,1);
  events.webglcontextrestored();assert.ok(state.graphicsHold);assert.match(text.textContent,/reload/i);
  const c=vm.createContext({state,last:0,last0:0});vm.runInContext(section('function frameBody(now)',"  if ((rig.view")+'}',c);vm.runInContext('frameBody(5000)',c);
  assert.equal(state.flightT,4);assert.equal(c.last,5000);
  console.log('EW-11: context loss blocks all simulation/input; restoration requires safe full resource reload');
}
{
  const aircraft=fs.readFileSync('src/aircraft.js','utf8');
  const a=aircraft.indexOf('  async loadOptionalLod('), b=aircraft.indexOf('  attachLod(',a);
  let timer;const load=aircraft.slice(a,b).replace('async loadOptionalLod(', 'async function loadOptionalLod(').replace('`${import.meta.env.BASE_URL}draco/`', "'/draco/'");
  let aborted=false,disposed=false;
  const context=vm.createContext({AbortController,DRACOLoader:class{setDecoderPath(){return this;}dispose(){disposed=true;}},GLTFLoader:class{},fetch:async(u,{signal})=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});},setTimeout(fn,ms){assert.equal(ms,1500);timer=fn;return 1;},clearTimeout(){}});
  vm.runInContext(load,context);const optional=vm.runInContext("loadOptionalLod('/models/SR71_sim.glb')",context);
  timer();assert.equal(await optional,null);assert.ok(aborted&&disposed);
  console.log('EW-30: stalled optional LOD completes as null at its independent 1.5s deadline and aborts');
}
{
  let toggle;const pressure={};const dynres={times:[]};let resized=0;
  const c=vm.createContext({pressure,dynres,bindCheck:(id,key,fn)=>toggle=fn,setRenderScale(){resized++;}});
  vm.runInContext(section("bindCheck('opt-dynres'", "bindCheck('opt-unstart'"),c);
  for(const level of [0,1,2,3]){Object.assign(pressure,{level,slowN:4,fastN:2,drop:true});Object.assign(dynres,{scale:.3,down:{},ceil:.5,cpuUntil:99});dynres.times.push(.1);toggle(false);assert.equal(pressure.level,0);assert.equal(pressure.slowN,0);assert.equal(dynres.scale,1);assert.equal(dynres.down,null);assert.equal(dynres.times.length,0);}
  assert.equal(resized,4);console.log('EW-31: disabling adaptive resolution resets every pressure level and stale probe');
}
{
  const vclouds={}, post={setSize(){},msaaMax:0}, renderer={width:800,height:600,ratio:1,getSize(target){return target.set(this.width,this.height);},getPixelRatio(){return this.ratio;},setPixelRatio(ratio){this.ratio=ratio;},setSize(width,height){this.width=width;this.height=height;}};
  const c=vm.createContext({IS_F27:false,innerWidth:800,innerHeight:600,devicePixelRatio:1,dynres:{base:1,scale:1},settings:{dynres:false},rig:{view:'orbit'},renderer,post,vclouds,effectiveRenderRatio,syncRendererSize,sizePost(){}});
  vm.runInContext(section('function viewRenderRatio()', '// Adaptive cloud resolution'),c);vm.runInContext('setRenderScale()',c);assert.equal(vclouds.nativeW,800);
  c.innerWidth=1600;c.innerHeight=1200;vm.runInContext('setRenderScale()',c);assert.equal(vclouds.nativeW,1600);assert.equal(vclouds.nativeH,1200);
  assert.match(main,/addEventListener\('resize', rebase\)/);console.log('EW-32: size-only resize refreshes cloud native pixel limits');
}
{
  for(const alt of [100,1000,2500]){const fdm=new C172Model();fdm.reset(new THREE.Vector3(0,alt,0),90,33,false);slewExit(fdm,33,alt-2,'c172');assert.ok(fdm.vel.length()<50);fdm.step(1/240,()=>0,new THREE.Vector3());assert.ok(!fdm.crashed);}
  for(const ac of ['c172','sf50','il76','sr71']){assert.ok(Number.isFinite(slewExitSpeed(0,3000,ac)));}
  const c172=new C172Model();c172.reset(new THREE.Vector3(0,2,0),0,33,true);slewExit(c172,33,1,'c172');assert.equal(c172.vel.length(),0);
  const spawnPrefix=section('function spawn(s, meta)', '  state.refuel = null;');const state={slew:true,slewSpeed:33,setup:{}};
  vm.runInNewContext(spawnPrefix+'}',{state,logbook:{cancel(){}},invalidateWeatherRequest(){}});const c=vm.createContext({state,logbook:{cancel(){}},invalidateWeatherRequest(){}});vm.runInContext(spawnPrefix+'}\nspawn({}, {})',c);
  assert.equal(state.slew,false);assert.equal(state.slewSpeed,0);
  console.log('EW-33/34: C172 slew exit survives physics at approach speed; all spawns clear slew');
}
{
  function run(warp,frames,paused=false){const aircraftSystems=new AircraftSystems();const state={started:true,paused,pending:null};const c=vm.createContext({IS_F27:false,state,aircraftSystems,systemsState:null,touchControls:null,fdm:{pos:{y:60000/3.28084},engines:[{dry:1,ab:0},{dry:1,ab:0}],gearPos:1,fuel:20000,fuelAft:2000},FT:3.28084,env:{daylight:1}});
    vm.runInContext(section('function updateAircraftSystems(dt)', 'function frameBody(now)'),c);
    const loop=section('  if (state.pending) finishPending();', "  perf.mark('sim');");Object.assign(c,{warp:{i:0},warpX:()=>warp,dt:.04,simulate(){},refuelStep(){},warpBlock(){return null;}});
    for(let i=0;i<frames;i++)vm.runInContext(loop,c);return aircraftSystems.oxygenQuantityPct;}
  assert.ok(Math.abs(run(1,256)-run(16,16))<1e-10);assert.equal(run(16,16,true),100);console.log('EW-38: equal simulated time consumes equal oxygen at 1x and 16x; pause consumes none');
}
{
  const stats={imgActive:3,imgWait:20,imgFail:100,imgNodata:20};
  for (const pending of [true,false]) assert.equal(imageryNotice({fallback:true,pending,stats}), '', 'streaming and cumulative totals are quiet');
  assert.match(imageryNotice({failed:true,pending:true}),/failed/);
  let now=12001;const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};const state={pending:{t0:0,lat:0,lon:0}};
  const terrain={stats,imageryFallback:false,heightAt:()=>null,heightReady:()=>false,imageryHealth:()=>({failed:false,covered:false}),levelAt:()=>15};
  const c=vm.createContext({state,terrain,$,performance:{now:()=>now},aircraftLatLon:()=>({lat:0,lon:0}),imageryNotice,IMAGERY_DEADLINE_MS:12000,imageryRetryAt:0,groundStatus:()=>({ok:false})});
  vm.runInContext(section('function syncImageryNotice()', 'function retryImagery()')+section('function finishPending()', 'function spawnAt('),c);
  vm.runInContext('finishPending()',c);assert.ok(state.pending);assert.match($('st-state').textContent,/Loading terrain/);assert.equal($('imagery-notice').hidden,true);
  terrain.imageryHealth=()=>({failed:false,covered:true});vm.runInContext('syncImageryNotice()',c);assert.equal(terrain.imageryFallback,false);
  console.log('EW-45 hotfix: real pending terrain deadline permits shaded fallback without a streaming banner');
}
