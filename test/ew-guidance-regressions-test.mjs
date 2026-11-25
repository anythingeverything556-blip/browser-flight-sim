// Toy-simulator regression fixtures; no network, real aircraft, or live operational inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { Navigation } from '../src/nav.js';
import { destination, bearing } from '../src/geo.js';
import { createMission, scoreLanding } from '../src/missions.js';
import { Guide } from '../src/guide.js';
import { C172Gauges } from '../src/c172gauges.js';
import { CameraRig } from '../src/camera.js';
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const section = (start, end) => { const a = main.indexOf(start), b = main.indexOf(end, a); assert.ok(a >= 0 && b > a); return main.slice(a, b); };
const run = (code, context) => vm.runInNewContext(code, context);
const FT = 3.28084, KT = 1.94384;
{
  const n = new Navigation(), here = {lat:0,lon:0};
  const points = [{lat:0,lon:1,name:'FIRST'},{lat:1,lon:1,name:'DIRECT'},{lat:2,lon:1,name:'NEXT'}];
  points.forEach(p=>n.add(p)); n.activate(1,here);
  const out = n.update(here,1000,100);
  assert.ok(Math.abs(out.lnavHdg-bearing(0,0,1,1)) < .001);
  assert.ok(Math.abs(out.xtkNm) < .001); assert.deepEqual(n.wps,points);
  n.update(points[1],1000,100); assert.equal(n.active,2);
  const next = n.update(points[1],1000,100); assert.ok(Math.abs(next.course) < .001);
  console.log('PASS EW-21: direct-to later fix uses ownship origin, retains and sequences subsequent fixes');
}
{
  const n = new Navigation(); n.add({lat:0,lon:.1,name:'FINAL'});
  n.update({lat:0,lon:0},1000,100); const end = n.update({lat:0,lon:.1},1000,100);
  assert.ok(end.routeComplete && !end.valid && !end.routeActive); const seq = n.sequenced;
  for (const lon of [.12,.2,.08,.3]) {
    const out = n.update({lat:0,lon},1000,100);
    assert.equal(n.totalNm({lat:0,lon}),0); assert.equal(out.distNm,0);
    assert.ok(out.routeComplete && !out.routeActive && !out.valid);
    assert.ok(Math.abs(out.lnavHdg-90)<.001); assert.equal(n.sequenced,seq);
  }
  const elements={}; const c={state:{started:true},aircraftLatLon:()=>({lat:0,lon:.3}),nav:n,fdm:{vel:{x:100,z:0}},NM:1852,KT,esc:s=>s,haversine:()=>0,$:id=>elements[id]||=({})};
  run(section('function renderRoute() {','nav.onChange(renderRoute)'),c); c.renderRoute();
  assert.equal(elements['route-sum'].textContent,'Route complete · 0 NM to go');
  n.activate(0,{lat:0,lon:0}); assert.ok(!n.done); assert.ok(n.totalNm({lat:0,lon:0})>0);
  n.clear(); assert.ok(!n.done && n.sequenced===null);
  console.log('PASS EW-24: completion latches beyond final fix, zero progress distance, explicit reactivation resets');
}
{
  const toasts=[], callbacks={}, ap={on:false,modes:{nav:false,hdg:true},target:{alt:1000},engage(){this.on=true;}};
  const c={ap, fdm:{onGround:true,crashed:false,pos:{y:1000},vel:{x:70,z:0},out:{}},state:{lastGround:0},CG_H:0,
    nav:{wps:[]}, aircraftLatLon:()=>({lat:0,lon:0}), syncAp(){}, takeoff:{stop(){}}, apIas:()=>75,
    syncApTargets(){}, apEdited:new Set(), approachSpeedFloor(){}, supportsApMode:(_,m)=>m!=='flch',
    toast:s=>toasts.push(s),$:(id)=>({addEventListener:(name,cb)=>callbacks[id]=cb})};
  run(section('function engageAp() {','let lastApProt'),c);
  run(section('function goAround() {','function climbToCruise()'),c);
  run(section('function climbToCruise() {',"$('ap-cruise').addEventListener"),c);
  run(section("$('route-nav').addEventListener",'// ---------- autopilot sheet'),c);
  const mode={dataset:{m:'flch'},disabled:true,addEventListener:(_,cb)=>callbacks.mode=cb};
  c.document={querySelectorAll:()=>[mode]};
  run(section("document.querySelectorAll('#ap-modes button')",'function syncApTargets'),c);
  for (const aircraft of ['C172SP','F27']) {
    ap.cfg={manualThrottle:true,minApAgl:61,vmin:()=>30,speedLimit:()=>110};
    Object.assign(ap,{on:false,modes:{nav:false,hdg:true}}); c.fdm.onGround=true; c.nav.wps=[];
    callbacks['route-nav'](); assert.match(toasts.at(-1),/Add waypoints/);
    c.nav.wps=[{lat:0,lon:1}]; callbacks['route-nav']();
    assert.ok(!ap.on && !ap.modes.nav && ap.modes.hdg, aircraft); assert.match(toasts.at(-1),/airborne/);
    c.fdm.onGround=false; callbacks.mode(); assert.ok(!ap.on && !ap.modes.flch);
    c.goAround(); assert.match(toasts.at(-1),/manual go-around/i);
    c.climbToCruise(); assert.match(toasts.at(-1),/FLCH is not fitted/);
    assert.ok(!ap.on && !ap.modes.nav && !ap.modes.flch);
    callbacks['route-nav'](); assert.ok(ap.on && ap.modes.nav && !ap.modes.hdg, aircraft); assert.match(toasts.at(-1),/following the route/);
  }
  assert.equal(toasts.filter(s=>/following the route/.test(s)).length,2);
  console.log('PASS EW-22: C172/F27 route requires airborne and valid plan, works once engaged; no false NAV success, FLCH or auto go-around');
}
{
  const inputs=Object.fromEntries(Object.entries({hdg:'90',alt:'50000',vs:'0',spd:'180',mach:'.5',vsl:'3000'}).map(([k,value])=>[k,{value}]));
  const notices=[], ap={target:{},cfg:{}};
  const c={apInputs:inputs,ap,IS_SF50:true,IS_IL76:false,IS_A380X:false,IS_HEAVY:false,FT,KT,settings:{metric:false},state:{lastGround:0},toast:s=>notices.push(s),IL76:{CEILING:12000}};
  run(section('function readAp(floor)', '// Whenever code sets ap.target'),c);
  run(section('const AP_KEYS =','const AP0 ='),c);
  c.readAp(true); assert.equal(inputs.alt.value,31000); assert.equal(ap.target.alt,31000/FT); assert.match(notices[0],/limited.*31,000 ft/);
  c.settings.metric=true; inputs.alt.value='20000'; c.readAp(true);
  assert.ok(Math.abs(inputs.alt.value-ap.target.alt)<.51); assert.match(notices.at(-1),/limited.*m/);
  inputs.alt.value=''; c.readAp(true); assert.ok(Number.isFinite(ap.target.alt));
  console.log('PASS EW-23: capped SF50 targets reflected in input with explanation, including metric and invalid input');
}
{
  const arrival={rwy:{len:3000,width:45,ends:[{start:{lat:0,lon:0},hdg:0}]},end:0};
  const state={agl:20,vy:-1,onGround:false,iasKt:180,vrefKt:175,gs:90,gearDown:true,ilsValid:false};
  function landing(position) {
    const m=createMission('landhand',{arrival}); m.update(.2,{...state,...position});
    m.update(.2,{...state,...position,onGround:true,agl:0}); m.update(.2,{...state,...position,onGround:true,gs:0}); return m;
  }
  const on=destination(0,0,0,400), off=destination(on.lat,on.lon,90,5000);
  const good=landing(on); assert.equal(good.score.grade,'A'); assert.equal(good.score.total,100);
  assert.ok(good.td.onRunway); assert.ok(Math.abs(good.td.dist-400)<.01);
  const bad=landing(off); assert.equal(bad.score.total,0); assert.equal(bad.score.grade,'F'); assert.match(bad.coach().text,/outside the assigned runway/);
  for(const pos of [destination(0,0,180,50),destination(0,0,0,3100),{}]) assert.equal(landing(pos).score.total,0);
  for(const td of [{off:null,dist:null},{off:0,dist:null},{off:NaN,dist:400}]) {
    const s=scoreLanding({sink:1,kt:180,...td}); assert.equal(s.total,0); assert.match(s.tips.join(' '),/cannot be scored/);
  }
  // Capture assigned runway in the real mission-start callback, rather than trusting whichever ILS is tuned later.
  const c={missionKind:'landhand',clearMission(){},beginMissionSession:o=>o.createMission(o.kind,{lat:0,lon:0,hdg:0}),state:{lastSpawn:{s:{}}},tour:{},tutorial:{},tutorialCtx(){},createMission,nav:{arrival},toast(){},MISSIONS:{landhand:{name:'Landing 2',blurb:''}}};
  run(section('function startMission() {','function updateMission(dt)'),c); c.startMission(); assert.equal(c.mission.arrival,arrival);
  console.log('PASS EW-26: runway geometry scores normal touchdown without ILS; 5km sideways, short, long and missing positions fail');
}
{
  const source=section("if (IS_C172) $('guide-replay')",'const atc =');
  for(const type of ['sf50','il76','c172','sr71']) {
    const elements={}, calls=[];
    const c={IS_C172:type==='c172',IS_GA:['c172','sf50'].includes(type),IS_IL76:type==='il76',IS_HEAVY:['il76','a380x'].includes(type),guide:{start:()=>calls.push('guide')},dep:{},missionKindSet:()=>{},openSheet:()=>{},$:(id)=>elements[id]||=( {addEventListener:(_,cb)=>elements[id].click=cb,click:()=>calls.push('start')})};
    run(source,c); elements['guide-replay'].click();
    if(['sf50','il76'].includes(type)) { assert.ok(elements['guide-replay'].hidden); assert.equal(calls.length,0); }
    else assert.deepEqual(calls,[type==='c172'?'start':'guide']);
  }
  console.log('PASS EW-27: unsupported replay is hidden and guarded; Skyhawk lesson and Blackbird guide retained');
}
{
  const els={},ctx={started:true,throttle:1,view:'chase'},el={hidden:true,querySelector:id=>els[id]||=({addEventListener(){}}),querySelectorAll:()=>[]};
  const guide=new Guide({el,controls:{keys:new Set()},ctx:()=>ctx}); guide.start(); guide.update(.5);
  for(const flag of ['paused','pending','crashed']) {
    ctx[flag]=true; guide.update(2); assert.equal(guide.i,0); assert.equal(guide.done,0);
    ctx[flag]=false; guide.update(.5); assert.equal(guide.i,0);
  }
  ctx.started=false; guide.update(2); assert.equal(guide.i,0); ctx.started=true;
  guide.update(.5); assert.equal(guide.i,0); guide.update(.4); assert.equal(guide.i,1);
  const c={attitude:()=>({pitch:0,heading:0}),fdm:{quat:{},pos:{y:0},onGround:true,gearDown:true,throttle:1,crashed:'wreck'},state:{navOut:{},lastGround:0,started:true,paused:true,pending:{}},casMs:()=>0,FT,KT,ap:{on:false,target:{alt:0}},rig:{view:'chase',orbit:{}}};
  run(section('function tutorialCtx() {','// ---------- live weather'),c);const live=c.tutorialCtx(); assert.ok(live.paused&&live.pending&&live.crashed);
  console.log('PASS EW-28: actual context forwards inactive state, guide resets dwell for pause/loading/wreck/not-started');
}
{
  const m=createMission('highfast',{}),ok={M:3.2,alt:22000}; m.update(19,ok); m.update(1,{...ok,M:2.9});m.update(3.1,ok);
  assert.equal(m.hold,3.1); assert.ok(!m.done);m.update(16.9,ok);assert.ok(m.done);
  const low=createMission('highfast',{});low.update(19,ok);low.update(.1,{...ok,alt:20000});assert.equal(low.hold,0);
  console.log('PASS EW-29: continuous 20-second hold required; speed or altitude interruption resets');
}
{
  for (const alt of [0,1000,10000]) {
    const rotations=[], x=new Proxy({rotate:a=>rotations.push(a)},{get:(o,k)=>o[k]||(()=>{})});
    const instrument=Object.create(C172Gauges.prototype); instrument.v={alt}; instrument.ticks=instrument.label=instrument.caption=()=>{};
    instrument.alt(x); assert.ok(Math.abs(rotations[0]-alt/100000*Math.PI*2)<1e-10);
    assert.ok(Math.abs(rotations[1]-(alt/1000%10)/10*Math.PI*2)<1e-10);
    assert.ok(Math.abs(rotations[2]-(alt/100%10)/10*Math.PI*2)<1e-10);
  }
  console.log('PASS EW-39: actual canvas needle rotations at 0/1,000/10,000 ft preserve all three pointer periods');
}
{
  globalThis.window={addEventListener(){}};
  const events={}, camera=new THREE.PerspectiveCamera(),rig=new CameraRig(camera,{addEventListener:(k,fn)=>events[k]=fn});rig.set('flyby');
  const aircraft={pos:new THREE.Vector3(0,1000,0),vel:new THREE.Vector3(100,0,0),quat:new THREE.Quaternion()};
  const frame=()=>rig.update(.1,aircraft,()=>0,new THREE.Vector3());frame();const before=camera.fov;
  events.wheel({deltaY:-400});frame();assert.ok(camera.fov<before*.8);const after=camera.fov;
  events.wheel({deltaY:800});frame();assert.ok(camera.fov>after*1.5); assert.ok(camera.fov<=70);
  console.log('PASS EW-40: real wheel handler changes actual Fly-by camera FOV at fixed aircraft pose in both directions');
}
