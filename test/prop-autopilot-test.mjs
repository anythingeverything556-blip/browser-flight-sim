// Closed-loop tests against the actual three production FDMs; no synthetic aircraft response.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Autopilot, attitude } from '../src/autopilot.js';
import { C172Model, FLAP_DEG as C172_FLAPS } from '../src/c172.js';
import { DA40Model, DA40_FLAP_DEG as DA40_FLAPS } from '../src/da40.js';
import { F27Model, F27_FLAP_DEG as F27_FLAPS } from '../src/f27.js';
import { C172_AP, DA40_AP, F27_AP, supportsApMode } from '../src/propap.js';
import { apTrimServo } from '../src/sf50ap.js';
import { isa } from '../src/atmosphere.js';
import { Navigation } from '../src/nav.js';
import { Runway } from '../src/airportdb.js';
import { Geo, destination } from '../src/geo.js';
import { airData, trueAirspeedFromCas } from '../src/airdata.js';
const KT=1.943844, FT=3.28084, dt=1/120, wind=new THREE.Vector3(), flat=()=>0;
const wrap = a => ((a+540)%360)-180;
export function rig(Model,cfg,kias,{altFt=5000,x=0,z=0,hdg=90,notch=0,gear=Model!==F27Model,gamma=0}={}) {
 const fdm=new Model(), alt=altFt/FT;
 fdm.unlimitedFuel=true; fdm.reset(new THREE.Vector3(x,alt,z),hdg,trueAirspeedFromCas(kias/KT,isa(alt)),false);
 fdm.gearDown=gear; fdm.gearPos=gear?1:0; fdm.setFlaps(notch); fdm.flaps=(Model===C172Model?C172_FLAPS:Model===DA40Model?DA40_FLAPS:F27_FLAPS)[notch];
 fdm.quat.setFromAxisAngle(new THREE.Vector3(0,1,0),-(hdg-90)*Math.PI/180); fdm.trimLevel(gamma);
 const ap=new Autopilot(cfg); Object.assign(ap.target,{alt,hdg});
 // Populate the first real air-data sample, exactly as the game does before engaging.
 fdm.step(dt,flat,wind); ap.engage({ctrl:fdm.ctrl,throttle:fdm.throttle});
 const r={fdm,ap,maxBank:0,maxAlt:0,steps:0};
 r.run=(secs,each=()=>{})=>{for(let t=0;t<secs;t+=dt){
  const att=attitude(fdm.quat),out=fdm.out;
  if(r.navProvider) r.nav=r.navProvider();
  if(ap.on){const c=ap.update(dt,{fdm,out,att,vs:fdm.vel.y,alt:fdm.pos.y,ias:airData(out).cas,nav:r.nav||{}});
   assert.equal(c.thrOverride,false); assert.equal(c.th,fdm.throttle);
   Object.assign(fdm.ctrl,{de:c.de,da:c.da,dr:c.dr}); apTrimServo(ap,fdm,dt,0.6);
  }
  fdm.step(dt,flat,wind); assert.ok(!fdm.crashed,`${cfg.label}: ${fdm.crashed}`);
  assert.ok(Number.isFinite(fdm.pos.y)); r.maxBank=Math.max(r.maxBank,Math.abs(att.bank*180/Math.PI)); each(r); r.steps++;
 }};
 return r;
}
for(const [Model,cfg,kias] of [[C172Model,C172_AP,105],[DA40Model,DA40_AP,125],[F27Model,F27_AP,180]]){
 const r=rig(Model,cfg,kias),{fdm,ap}=r; const throttle=fdm.throttle;
 r.run(30); let altErr=0,hdgErr=0;
 r.run(90,()=>{altErr=Math.max(altErr,Math.abs(fdm.pos.y-ap.target.alt)*FT);hdgErr=Math.max(hdgErr,Math.abs(wrap(attitude(fdm.quat).heading-90)));});
 console.log(cfg.label,'hold', {altErr,hdgErr,throttle,finalThrottle:fdm.throttle,trim:fdm.trim,deI:ap.deI});
 assert.ok(altErr<60);assert.ok(hdgErr<2);assert.equal(fdm.throttle,throttle);assert.ok(Math.abs(ap.deI)<0.03);
 ap.target.hdg=180;r.run(140);
 console.log(cfg.label,'turn',{hdg:attitude(fdm.quat).heading,alt:fdm.pos.y*FT,maxBank:r.maxBank});
 assert.ok(Math.abs(wrap(attitude(fdm.quat).heading-180))<2);assert.ok(r.maxBank<23);assert.ok(Math.abs(fdm.pos.y-ap.target.alt)*FT<80);
 // Selected ALT capture at pilot-set climb power; climb is deliberately small and within available power.
 fdm.throttle=Model===F27Model?0.76:1; const before=fdm.pos.y; ap.target.alt=before+300/FT; ap.target.vs=300/196.85; ap.modes.vs=true;ap.modes.alt=false;
 r.run(200);console.log(cfg.label,'climb',{gain:(fdm.pos.y-before)*FT,error:(fdm.pos.y-ap.target.alt)*FT,mode:ap.status.vert,kias:airData(fdm.out).cas*KT});
 assert.equal(ap.status.vert,'ALT');assert.ok(Math.abs(fdm.pos.y-ap.target.alt)*FT<60);
 // An intentional manual power change remains authoritative with the AP engaged.
 fdm.throttle=0.45;r.run(1);assert.equal(fdm.throttle,0.45);
 // No speed/throttle mode, including stale programmatic requests, may survive the controller gate.
 Object.assign(ap.modes,{spd:true,mach:true,flch:true});r.run(0.1);
 for(const m of ['spd','mach','flch']) {assert.equal(supportsApMode(cfg,m),false);assert.equal(ap.modes[m],false);}
 assert.equal(ap.startRecovery({ctrl:fdm.ctrl,throttle:fdm.throttle}),false);
 assert.equal(ap.startGoAround({}, {}, 0, 0),false);
 ap.disengage();fdm.ctrl.de=0;const trim=fdm.trim;r.run(3);assert.equal(ap.on,false);assert.equal(fdm.trim,trim);assert.ok(Math.abs(fdm.w.z)<0.06);
 console.log('PASS',cfg.label);
}
