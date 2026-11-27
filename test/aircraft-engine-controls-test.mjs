// Executes the real main.js handler and complete spawn() against real FDMs.
// Browser/terrain side effects are inert; no copied engine/reset logic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { C172Model, C172, C172_CG } from '../src/c172.js';
import { DA40Model, DA40, DA40_CG, DA40_FLAP_DEG } from '../src/da40.js';
import { SF50Model, SF50, SF50_CG, FLAP_DEG as SF50_FLAP_DEG } from '../src/sf50.js';
import { F27Model, F27, F27_GEAR, F27_FLAP_DEG } from '../src/f27.js';
import { F27RadioAltimeter } from '../src/f27callouts.js';
import { Autopilot, attitude } from '../src/autopilot.js';
import { SF50Autoland, SF50_AP } from '../src/sf50ap.js';
import { isa } from '../src/atmosphere.js';
import { makeSF50Feed } from '../src/sf50feed.js';
import { airData } from '../src/airdata.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const handler=main.slice(main.indexOf("controls.on('engineStart',"),main.indexOf("controls.on('fullAB',"));
const spawn=main.slice(main.indexOf('function spawn(s, meta) {'),main.indexOf('// How ready is the ground'));
assert.ok(handler.startsWith("controls.on('engineStart',"));assert.ok(spawn.startsWith('function spawn'));
const noop=()=>{},ground=()=>0,wind=new THREE.Vector3(),dt=1/120;
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
function harness(id) {
 const Model={c172:C172Model,da40:DA40Model,sf50:SF50Model,f27:F27Model}[id],fdm=new Model(),messages=[];
 const controls={throttle:0,engTrim:[0,0],handlers:{},on(name,fn){this.handlers[name]=fn;}};
 const autoland=new SF50Autoland(),ap=new Autopilot(SF50_AP);
 const el={style:{},checked:false},state={},visual={setDoors:noop},audio={play:noop,resetForSpawn:noop};
 const c=vm.createContext({THREE,C172,DA40,DA40_FLAP_DEG,SF50,SF50_FLAP_DEG,F27,F27_FLAP_DEG,isa,airData,fdm,state,controls,visual,audio,
  IS_C172:id==='c172',IS_DA40:id==='da40',IS_PROP:['c172','da40'].includes(id),IS_SF50:id==='sf50',IS_F27:id==='f27',IS_HEAVY:false,IS_IL76:false,IS_A380X:false,
  autoland,ap,sf50Feed:id==='sf50'?makeSF50Feed():null,
  CG_H:id==='f27'?-Math.min(...F27_GEAR.map(g=>g.p.y)):({c172:C172_CG,da40:DA40_CG,sf50:SF50_CG}[id]).y,
  f27RadioAltimeter:new F27RadioAltimeter(),f27RadioAltOn:false,f27RadioAltValid:false,syncF27Feather:noop,
  toast:msg=>messages.push(msg),invalidateWeatherRequest:noop,logbook:{cancel:noop},warp:{i:0},buildingHit:{reset:noop},wreck:{active:false},
  moveOrigin:noop,turb:{reset:noop},resetGaControls:noop,terrain:{refreshNear:noop,requestHeight:noop},settings:{mode:'medium'},
  autobrake:{reset:noop},takeoff:{stop:noop},landAid:{on:false},resetApState:noop,nav:{wps:[]},touchdown:{reset:noop},atc:{reset:noop},aircraftSystems:{reset:noop},
  sr71ExteriorLights:null, // This harness only instantiates the other aircraft.
  mapPanel:null,rig:{},performance,$:()=>el,document:{getElementById:()=>el},
 });
 vm.runInContext(handler+'\n'+spawn,c);
 return {fdm,controls,messages,c,autoland,ap,toggle:controls.handlers.engineStart,spawn:s=>c.spawn(s,null),preset:s=>c.spawn(s,{})};
}
const location=(ground=false,speed=ground?0:65)=>({lat:0,lon:0,alt:ground?0:1200,hdg:90,speed,ground});
for(const id of ['c172','da40','sf50']) {
 test(id+': own modeled switch, cutoff, restart, no fuel and unlimited fuel',()=>{
  const h=harness(id),f=h.fdm;h.preset(location(true));f.throttle=.8;f.setEngines(.8);
  h.toggle();assert.equal(id==='sf50'?f.engineOn:f.magnetos,false);
  if(id==='sf50') {assert.equal(f.updateEngines(dt,isa(0),0,0),0);assert.equal(f.engines[0].ff,0);}
  else assert.equal(f.enginePower(2200,.8,1.225),0);
  // C172 fully stopped case, not just an airborne windmilling relight.
  f.omega=0;f.rpm=0;h.toggle();assert.equal(id==='sf50'?f.engineOn:f.magnetos,true);
  if(id==='sf50')assert.ok(f.updateEngines(dt,isa(0),0,0)>0);
  else {if(id==='c172')assert.ok(f.rpm>650,'automatic restart seeds piston RPM');assert.ok(f.enginePower(2200,.8,1.225)>0);}
  f.fuel=0;h.toggle();h.toggle();
  if(id==='sf50'){assert.equal(f.updateEngines(dt,isa(0),0,0),0);assert.equal(f.engines[0].ff,0);}
  else assert.equal(f.enginePower(2200,.8,1.225),0);
  assert.match(h.messages.at(-1),/no fuel/);
  f.unlimitedFuel=true;h.toggle();h.toggle();
  if(id==='sf50')assert.ok(f.updateEngines(dt,isa(0),0,0)>0);
  else assert.ok(f.enginePower(2200,.8,1.225)>0);
  assert.doesNotMatch(h.messages.at(-1),/no fuel/);
  if(id==='da40')assert.match(h.messages[0],/diesel engine master/);
  if(id==='c172')assert.match(h.messages[0],/ignition: OFF/);
 });
 test(id+': free ground/air teleports preserve cutoff and fuel; airport presets intentionally hot-start',()=>{
  const h=harness(id),f=h.fdm;h.preset(location(true));f.fuel=42;h.toggle();
  for(const s of [location(false,65),location(true),location(false,45)]) {
   h.spawn(s);assert.equal(id==='sf50'?f.engineOn:f.magnetos,false);assert.equal(f.fuel,42);
   const fuel=f.fuel;f.step(dt,ground,wind);
   assert.equal(f.fuel,fuel,'no first-step fuel burn');
   if(id==='sf50'){assert.equal(f.engines[0].lit,false);assert.equal(f.engines[0].thrust,0);assert.equal(f.engines[0].ff,0);assert.equal(f.engines[0].dry,0);}
   else assert.equal(f.enginePower(2200,.8,1.225),0);
  }
  // Ground preset is a deliberate hot start at idle, never old full thrust.
  h.preset(location(true));assert.equal(id==='sf50'?f.engineOn:f.magnetos,true);assert.equal(f.throttle,0);assert.equal(h.controls.throttle,0);
  if(id==='sf50'){f.step(dt,ground,wind);assert.ok(f.engines[0].thrust<1000);}
  h.preset(location(false,65));assert.equal(id==='sf50'?f.engineOn:f.magnetos,true);assert.ok(f.fuel>42);
  assert.ok(f.throttle>0&&f.throttle<=1,'airborne preset intentionally trims for flight');
 });
}
test('F27 engine handler retains existing engine-running/doors path',()=>{
 const h=harness('f27');h.fdm.setEngineRunning(false,{immediate:true});let closed=false;h.c.visual.setDoors=()=>{closed=true;};h.toggle();assert.equal(h.fdm.engineRunning,true);assert.equal(closed,true);h.toggle();assert.equal(h.fdm.engineRunning,false);
});
test('F27 preset resets radio switch; free teleport preserves choice until normal AGL evaluation',()=>{
 const h=harness('f27');h.preset(location(true));
 h.c.f27RadioAltOn=true;h.c.f27RadioAltValid=true;h.c.f27RadioAltimeter.step({aglFt:100,radioAltOn:true});
 h.spawn(location(false));assert.equal(h.c.f27RadioAltOn,true);assert.equal(h.c.f27RadioAltimeter.on,true);
 h.preset(location(true));assert.equal(h.c.f27RadioAltOn,false);assert.equal(h.c.f27RadioAltValid,false);assert.equal(h.c.f27RadioAltimeter.on,false);
});

// E01: exercise the complete production spawn with AP preferences deliberately
// kept (resetApState is a no-op in this harness). Sequence ownership must reset
// independently, synchronously, before the model is teleported.
for (const safe of [false,true]) for (const phase of ['flare','goaround','hold','rollout']) {
 test(`SF50 ${safe?'Safe Return':'autoland'} ${phase}: teleport drops sequence even with AP settings kept`,()=>{
  const h=harness('sf50'),f=h.fdm,a=h.autoland,ap=h.ap;h.preset(location());
  f.reset(new THREE.Vector3(0,SF50_CG.y+8,0),90,50,false);
  f.onGround=false;f.gearDown=true;f.flapCmd=2;f.throttle=.6;
  ap.engage({ctrl:f.ctrl,throttle:f.throttle});ap.status.loc=ap.status.gs=true;ap.modes.appr=true;
  a.arm(safe,1);
  const frame={fdm:f,ap,nav:{ilsValid:true,agl:8,locDev:0,gsDev:0,thrDist:200},att:attitude(f.quat),ias:50,agl:8,rwyHdg:90,rwyLen:1800,setFlaps:noop,setGear:noop};
  a.update(1/60,frame);a.update(1/60,frame);
  assert.equal(a.phase,'flare');assert.notEqual(a.de0,null);assert.ok(a.flareT>0);
  if(phase==='goaround'||phase==='hold')a.startGoAround('fixture',frame,{events:[]});
  a.phase=phase;ap.vsOverride=3;ap.tauV=1.6;ap.kiDiv=8;
  h.c.state.alBrakes=.9;h.c.state.srAvoid=['KTST09'];
  ap.target.hdg=123;const modes={...ap.modes},targets={...ap.target};
  const reset=f.reset.bind(f);f.reset=(...args)=>{
   assert.equal(a.armed,false,'disarm before changing aircraft position');
   assert.equal(h.c.state.alBrakes,0);assert.equal(ap.vsOverride,null);
   return reset(...args);
  };
  h.spawn({...location(),alt:3000});
  assert.equal(a.phase,'off');assert.equal(a.safeReturn,false);assert.equal(a.attempt,0);
  assert.equal(a.ap,null);assert.equal(a.de0,null);assert.equal(a.fI,0);assert.equal(a.flareT,0);
  assert.equal(a.th0,null);assert.equal(a.missedAlt,null);
  assert.equal(ap.vsOverride,null);assert.equal(ap.tauV,null);assert.equal(ap.kiDiv,null);
  assert.deepEqual(Array.from(h.c.state.srAvoid),[]);
  assert.deepEqual(ap.modes,modes);assert.deepEqual(ap.target,targets);
  // Production's delayed hold-AP engagement cannot revive the prior sequence.
  ap.engage({ctrl:f.ctrl,throttle:f.throttle});
  assert.equal(a.update(1/60,{...frame,agl:3000}),null);
 });
}
// E04: run the actual frame wrapper through a real stopped-rollout event; the
// disarm resets safeReturn, so its value must be captured before cleanup.
for (const safe of [false,true]) test(`SF50 ${safe?'Safe Return':'autoland'} completion names the correct mode and disarms`,()=>{
 const h=harness('sf50'),f=h.fdm,ap=h.ap,a=h.autoland;h.preset(location(true));
 ap.engage({ctrl:f.ctrl,throttle:f.throttle});a.arm(safe);a.phase='rollout';
 h.c.nav={arrival:null};h.c.state.lastGround=0;h.c.state.navOut={};
 h.c.casMs=()=>0;h.c.syncAp=noop;h.c.apTrimServo=()=>assert.fail('no trim after stop');
 const start=main.indexOf('function sf50ApFrame('),end=main.indexOf('function armAutoland(',start);
 vm.runInContext(main.slice(start,end),h.c);h.c.sf50ApFrame(1/60,attitude(f.quat));
 assert.equal(f.parkingBrake,true);assert.equal(f.throttle,0);assert.equal(h.controls.throttle,0);
 assert.equal(h.c.state.alBrakes,0);assert.equal(ap.on,false);assert.equal(a.armed,false);assert.equal(a.safeReturn,false);
 assert.match(h.messages.at(-1),safe?/^Safe Return complete:/:/^Autoland complete:/);
});
console.log(`aircraft-engine-controls-test: ${passed} passed`);
