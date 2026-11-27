// Cross-layer airspeed regression: cockpit approximation, physics, limits, reset,
// and actual airport-spawn wiring. No fit to ADS-B groundspeed or unknown power.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { airData, controlAirspeed, trueAirspeedFromCas } from '../src/airdata.js';
import { isa } from '../src/atmosphere.js';
import { meanWindVector } from '../src/turbulence.js';
import { resolveRunwaySelection } from '../src/home-runway.js';
import { FlightModel } from '../src/flight.js';
import { C172Model, C172 } from '../src/c172.js';
import { DA40Model } from '../src/da40.js';
import { SF50Model, SF50 } from '../src/sf50.js';
import { F27Model, F27, stallSpeed as f27StallSpeed } from '../src/f27.js';
import { IL76Model, IL76 } from '../src/il76.js';
const KT = 1.943844, FT = 3.28084, wind = new THREE.Vector3();
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const sample = (speed, altitude) => { const atm = isa(altitude); return airData({ V: speed, M: speed / atm.a, ...atm }); };
for (const [alt, cas] of [[0,65], [2440,125], [8534,205], [10000,255]]) {
  const tas = trueAirspeedFromCas(cas / KT, isa(alt));
  near(sample(tas,alt).cas * KT,cas);
}
assert.equal(trueAirspeedFromCas(0, isa(3000)),0);
console.log('PASS CAS→TAS→CAS across airport, GA and jet altitudes');
for (const [type, Model, alt, mach] of [
  ['c172',C172Model,2400,.20], ['da40',DA40Model,4000,.24],
  ['f27',F27Model,4000,.382], ['sf50',SF50Model,8534,.532],
  ['il76',IL76Model,10000,.719], ['sr71',FlightModel,24384,3.2],
]) {
  const f = new Model(), atm = isa(alt), speed = mach * atm.a;
  if (type === 'il76') f.setMode('realistic');
  f.reset(new THREE.Vector3(0,alt,0),90,speed,false);
  near(f.out.cas,sample(speed,alt).cas);
  near(f.out.ias,type === 'sr71' ? f.out.eas : f.out.cas);
  f.step(1/120, () => -100000,wind);
  assert.equal(f.crashed,null,`${type}: ${f.crashed}`);
  const o = f.out, data = airData(o);
  near(o.qbar, .5 * 1.225 * o.eas ** 2,1e-5);
  near(o.cas,data.cas); near(o.eas,data.eas);
  near(o.ias,controlAirspeed(type,o));
  assert.equal(o.iasReference,type === 'sr71' ? 'EAS' : 'CAS');
  console.log(`PASS ${type}: TAS ${(o.V*KT).toFixed(1)}, EAS ${(o.eas*KT).toFixed(1)}, CAS ${(o.cas*KT).toFixed(1)} kt; aero q unchanged`);
}
for (const [Model, spec, alt] of [[SF50Model,SF50,8534],[IL76Model,IL76,10000]]) {
  const f = new Model(); if (f.setMode) f.setMode('realistic');
  const speed = trueAirspeedFromCas((spec.VLE+1)/KT,isa(alt));
  assert.ok(sample(speed,alt).eas*KT < spec.VLE,'threshold case must distinguish EAS from CAS');
  f.reset(new THREE.Vector3(0,alt,0),90,speed,false);
  f.gearDown=true; f.gearPos=1;
  f.step(1/120,() => -100000,wind);
  assert.equal(f.out.gearOverspeed,true,'gear limit must agree with cockpit CAS, not EAS');
}
console.log('PASS SF50/Il-76 gear overspeed at CAS>EAS threshold');
{
  const f=new C172Model();
  for (let i=0;i<2;i++) {
    f.reset(new THREE.Vector3(0,1.15,0),90,0,true);
    assert.equal(f.fictionalTailwheel,false); assert.equal(f.tailGearPos,0);
    assert.equal(f.tailGearCmd,false); assert.equal(f.setTailGear(true),false);
    assert.equal(f.gearDown,true); assert.equal(f.gearPos,1);
  }
  const toy=new C172Model({fictionalTailwheel:true});
  toy.reset(new THREE.Vector3(0,1.15,0),90,0,true);
  assert.equal(toy.tailGearPos,1);
}
console.log('PASS production C172 fixed tricycle survives reset; legacy wheel requires explicit constructor opt-in');

// Exercise main.js's real function using only the dependencies it consumes.
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const spawnAt=main.slice(main.indexOf('function spawnAt('),main.indexOf('\nfunction restart()'));
const models = {c172:C172Model,da40:DA40Model,sf50:SF50Model,f27:F27Model,il76:IL76Model,sr71:FlightModel};
const phasedFlaps = {c172:[0,2,3,0],da40:[1,1,2,0],sf50:[0,1,2,0]};
for (const [type,Model] of Object.entries(models)) {
  for (const [i, mode] of ['runway','approach','final','cruise'].entries()) {
    const ground=mode==='runway', cruise=mode==='cruise';
    let actual;
    const baseAlt=cruise?24384:3500;
    const r={spawn:()=>({ground,alt:baseAlt,speed:ground?0:92,gamma:ground||cruise?0:-3}),ends:[{ident:'09'}]};
    const scope={IS_C172:type==='c172',IS_DA40:type==='da40',IS_F27:type==='f27',IS_SF50:type==='sf50',IS_HEAVY:type==='il76',IS_IL76:type==='il76',IS_A380X:false,IS_PROP:['c172','da40'].includes(type),
      AIRCRAFT:type,KT,FT,C172,SF50,F27,f27StallSpeed,isa,airData,trueAirspeedFromCas,resolveRunwaySelection,
      fdm:{payload:3000},settings:{fullTanks:false,weather:'clear'},state:{started:false},missionKind:'free',env:{hour:15},weatherSnapshot:()=>({}),spawn:s=>{actual=s;},toast:()=>{}};
    vm.runInNewContext(`${spawnAt}\nspawnAt(apt,0,0,mode);`,{...scope,apt:{ident:'TEST',runways:[r]},mode});
    const expected = {c172:[65,65,105],da40:[75,75,125],sf50:[110,100,180],il76:[148,148]};
    if(ground) near(actual.speed,0);
    else if(type==='sr71') {
      if (cruise) near(actual.speed/isa(actual.alt).a,3.2);
      else near(sample(actual.speed,actual.alt).eas*KT,200);
    } else if(type==='f27') {
      if (cruise) near(actual.speed*KT,240);
      else {
        const mass=F27.EMPTY+3000+F27.FUEL_START, target=1.3*f27StallSpeed(mass,26.5)/Math.sqrt(isa(baseAlt).rho/1.225);
        near(sample(actual.speed,actual.alt).cas,sample(target,baseAlt).cas+15/KT);
      }
    } else if(type==='il76' && cruise) near(actual.speed/isa(actual.alt).a,.72);
    else near(sample(actual.speed,actual.alt).cas*KT,expected[type][i-1]);
    const f=new Model();
    if(type==='sf50') { assert.equal(!!actual.landingPreset,!ground&&!cruise); if(actual.landingPreset) f.fuel=SF50.MLW-SF50.EMPTY; }
    f.reset(new THREE.Vector3(0,actual.alt,0),90,actual.speed,ground,actual.gamma || 0,type==='f27'?actual.f27Approach===true:actual.config);
    assert.equal(f.gearDown,ground||!cruise||scope.IS_PROP,`${type}/${mode} gear`);
    if(phasedFlaps[type]) assert.equal(f.flapCmd,phasedFlaps[type][i],`${type}/${mode} flap notch at trim`);
    if(!ground&&!cruise&&['c172','da40','sf50','sr71'].includes(type)) {
      near(Math.asin(f.vel.y/f.vel.length())*180/Math.PI,-3,1e-6);
      for(let k=0;k<1200;k++) f.step(1/120,()=>-1000,wind);
      assert.equal(f.crashed,null,`${type}/${mode} remains flyable`);
      assert.ok(f.vel.y < -0.75 && (f.out.stall||0)<0.05 && !f.out.shaker,`${type}/${mode} descends without stall`);
      near(f.out.ias*KT,expected[type]?.[i-1] ?? 200,7);
    }
  }
}
assert.match(main,/function ias\(\) \{ return controlAirspeed\(AIRCRAFT, fdm.out\); \}/);
assert.match(main,/const apIas = \(\) => \(IS_A380X \? casMs\(\) : ias\(\)\)/);
assert.match(main,/kias: apIas\(\) \* KT, dt, cfg:/);
assert.match(main,/The Cessna 172S has fixed tricycle landing gear/);
console.log('PASS 24 airport presets, including gear/flap selection at trim and non-stalled high-field approaches on the remaining four models');
for (const [Model, target] of [[C172Model,105],[DA40Model,125]]) {
  const f = new Model(), alt=8000/FT, tas=trueAirspeedFromCas(target/KT,isa(alt));
  f.reset(new THREE.Vector3(0,alt,0),90,tas,false,0,{flapNotch:0});
  for (let k=0;k<1200;k++) f.step(1/120,()=>0,wind);
  near(f.out.cas*KT,target,0.5); near(f.pos.y,alt,1);
}
console.log('PASS piston cruise trim: both trainers stay within 0.5 kt and 1 m after ten hands-off seconds');
assert.match(main,/s.landingPreset \? Math.min\(SF50.FUEL_MAX, SF50.MLW - SF50.EMPTY\)/);
assert.match(main,/if \(meta && IS_PROP\) fdm.magnetos = true/);


// Map teleport speeds are entered as KIAS (CAS proxy) or KEAS, not directly in Mach or TAS.
const presetSource=main.slice(main.indexOf('const tpSpeedAtMach ='),main.indexOf('const tp ='));
const autopilotUnits=main.slice(main.indexOf('if (AIRCRAFT !== \'sr71\') {\n  $(\'ap-spd-u\')'),main.indexOf('// targets the pilot has set since the last engage'));
for (const [type, target, reference] of [['f27',240,'tas'],['il76',0.72,'cas'],['sr71',3.2,'eas']]) {
  const elements = {'ap-spd-u':{textContent:'KEAS'},'ap-spd-label':{title:'EAS'}};
  const scope={IS_F27:type==='f27',IS_DA40:false,IS_C172:false,IS_SF50:false,IS_A380X:false,IS_IL76:type==='il76',
    AIRCRAFT:type,isa,airData,FT,KT, $: id => elements[id],apInputs:{spd:{setAttribute(k,v){this[k]=v;}}}};
  const [label, altitudeFt, kt] = vm.runInNewContext(`${presetSource}\nTP_PRESETS[0]`,scope);
  const atm=isa(altitudeFt/FT);
  const tas = reference==='eas' ? kt / KT / Math.sqrt(atm.rho/1.225) : trueAirspeedFromCas(kt/KT,atm);
  if (reference==='tas') near(tas*KT,target,0.25); else { assert.ok(label.includes(String(target))); near(tas/atm.a,target,0.005); }
  vm.runInNewContext(autopilotUnits,scope);
  assert.equal(elements['ap-spd-u'].textContent,type==='sr71'?'KEAS':'KIAS');
}
console.log('PASS F27, Il-76 and SR-71 teleport cruise presets match their advertised TAS/Mach; speed selector units match the controller');

// Exercise the real post-loading handoff, including its first physics step.
const finish=main.slice(main.indexOf('function finishPending()'),main.indexOf('function spawnAt('));
const finishSpawn=(fdm,pending,settings,CG_H=2)=>{
  const state={pending};
  const scope=vm.createContext({state,fdm,settings,CG_H,meanWindVector,IMAGERY_DEADLINE_MS:12000,
    terrain:{heightAt:()=>0,heightReady:()=>true,levelAt:()=>15},warm:{done:true,final:true},groundStatus:()=>({ok:true}),
    performance:{now:()=>500},syncImageryNotice(){},pause(){},$:()=>({})});
  vm.runInContext(`${finish}\nfinishPending();`,scope);
  assert.equal(state.pending,null);
};
const windCases=[['C172',C172Model,2438,65],['DA40',DA40Model,2438,80],['F27',F27Model,4572,240/KT],
 ['SF50',SF50Model,8534,145],['Il-76',IL76Model,10000,isa(10000).a*.72],['SR-71',FlightModel,24384,isa(24384).a*3.2]];
// Wind direction is 'from'; heading 90° flies east. Test both along-track signs and a crosswind.
for(const [name,Model,altitude,speed] of windCases) for(const windDir of [90,270,180]) {
  const f=new Model(), settings={windSpd:8/KT,windDir};
  f.reset(new THREE.Vector3(0,altitude,0),90,speed,false);
  const airRelative=f.vel.clone(), local=meanWindVector(settings.windSpd,windDir,altitude,altitude);
  assert.ok(local.length()>0);
  finishSpawn(f,{lat:0,lon:0,t0:0,ground:false},settings);
  near(f.vel.clone().sub(local).distanceTo(airRelative),0);
  f.step(1/240,()=>0,local);
  assert.equal(f.crashed,null,name);
  near(f.out.V,speed,1e-6);
}
for (const ground of [false,true]) {
  const fdm={pos:new THREE.Vector3(0,1000,0),vel:new THREE.Vector3(80,0,0)};
  finishSpawn(fdm,{lat:0,lon:0,t0:0,ground,speedRef:ground?'air':'ground'},{windSpd:5,windDir:90});
  near(fdm.vel.x,80); near(fdm.pos.y,ground?2:1000);
}
assert.match(main,/speed, speedRef: 'ground', ground: false/);
console.log('PASS all six: the first actual physics step keeps selected TAS in headwind, tailwind and crosswind; runway and alongside world speeds unchanged');
