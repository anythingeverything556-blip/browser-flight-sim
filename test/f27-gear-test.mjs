// Real decoded assets and AnimationMixer: deployment, steering, reversals and CPU work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadModel} from './_glb-node.mjs';
import {F27Model,F27,F27_CG,F27_GEAR,F27_FLAP_DEG} from '../src/f27.js';
import {createFokkerAdapter} from '../src/f27adapter.js';
import { prepareF27ViewCasters } from '../src/f27view.js';
import { batchF27Cockpit } from '../src/f27batch.js';
import { gateF27DormantLights } from '../src/f27materials.js';
import { GlassWater } from '../src/glasswater.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const source=read('src/f27visual.js').replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.env.BASE_URL','"/"');
const models=new Map();
for(const [kind,v] of [['ext','v3'],['vc','v2']])models.set(kind,await loadModel(`f27/f27-white-${kind}-${v}`));
class Loader{setDRACOLoader(){return this;}setMeshoptDecoder(){return this;}async loadAsync(url){const g=models.get(url.includes('-vc-')?'vc':'ext');return{scene:g.scene.clone(true),animations:g.animations};}}
class Draco{setDecoderPath(){return this;}dispose(){}}
const {F27Visual,F27_GEAR_DEPLOY_END}=new Function('gateF27DormantLights','prepareF27ViewCasters','batchF27Cockpit','GlassWater','THREE','F27_CG','F27_GEAR','F27_FLAP_DEG','createFokkerAdapter','lighting','GLTFLoader','DRACOLoader','MeshoptDecoder',source+'\nreturn {F27Visual,F27_GEAR_DEPLOY_END};')(gateF27DormantLights,prepareF27ViewCasters,batchF27Cockpit,GlassWater,THREE,F27_CG,F27_GEAR,F27_FLAP_DEG,createFokkerAdapter,JSON.parse(read('src/f27lighting.json')),Loader,Draco,{});
const scene=new THREE.Scene(),visual=new F27Visual(scene),f=new F27Model(),zero=new THREE.Vector3();
await visual.load('/f27-white-ext-v3.glb');await visual.preloadCockpit();
const reset=(ground=false,approach=false)=>{f.reset(new THREE.Vector3(0,ground?-F27_GEAR[1].p.y:5000,0),90,ground?0:90,ground,0,approach);f.crashOff=true;};
const pose=(pos,view='orbit')=>{f.gearPos=pos;f.compress.fill(0);visual.update(0,f,zero,view);};
const measurements={};
for(const [part,kind,view] of [[visual.exterior,'ext','orbit'],[visual.interior,'vc','cockpit']]){
 reset();
 const support=part.root.getObjectByName('x0_GEAR_CentralSupportV1');
 const clip=models.get(kind).animations.find(c=>c.name==='x0_GEAR_CentralSupportV1');
 const shortClip=models.get(kind).animations.find(c=>c.name==='x0_GEAR_CentralAttLeft02');
 // Every deployment link uses the shared authoring clock, even shorter clips.
 for(const pos of [0,.01,.25,.49,.5,.501,.75,.99,1]){
  pose(pos,view);
  for(const name of part.clips.gear){
   const c=models.get(kind).animations.find(c=>c.name===name);
   for(const t of c.tracks){
    const binding=THREE.PropertyBinding.parseTrackName(t.name),node=part.root.getObjectByName(binding.nodeName);
    const expected=Array.from(t.createInterpolant().evaluate(F27_GEAR_DEPLOY_END*pos));
    if(binding.propertyName==='quaternion')assert.ok(node.quaternion.angleTo(new THREE.Quaternion().fromArray(expected))<.001,`${kind} ${name} synchronized @${pos}`);
    // Suspension/contact translation is applied after source deployment.
    else if(!part.gear.some(g=>g.rig===node))assert.ok(node.position.distanceTo(new THREE.Vector3().fromArray(expected))<1e-6);
   }
  }
 }
 pose(.5,view);assert.ok(support.quaternion.angleTo(new THREE.Quaternion())>.5,'not fully down after half the cycle');
 if(shortClip){const t=shortClip.tracks[0],expected=new THREE.Quaternion().fromArray(t.createInterpolant().evaluate(F27_GEAR_DEPLOY_END*.5));assert.ok(part.root.getObjectByName(shortClip.name).quaternion.angleTo(expected)<.001,'short clip not normalized separately');}
 // Nose fork retains its authored rest angle, never jumps at source frame 101.
 assert.ok(!part.adapter.activeClips.some(n=>/^x0_GEAR_Central(?:Dump[12]|SupportV3)$/.test(n)));
 assert.ok(!part.adapter.activeClips.includes('GEAR_Steering'),'360-degree lookup is not a steering axis');
 const fork=part.root.getObjectByName('x0_GEAR_CentralSupportV3'),forkRest=models.get(kind).scene.getObjectByName(fork.name).quaternion;
 for(const pos of [.49,.5,.51,1]){pose(pos,view);assert.ok(fork.quaternion.angleTo(forkRest)<1e-6,'no nose-fork snap');}
 f.quat.identity();
 // Tire axis follows physical yaw, including correct neutral, direction and speed reduction.
 for(const speed of [0,9,30])for(const dr of [-1,-.5,0,.5,1]){
  f.vel.set(speed,0,0);f.ctrl.dr=dr;pose(1,view);
  const actual=part.steering.getWorldDirection(new THREE.Vector3());
  const expected=new THREE.Vector3(1,0,0).applyQuaternion(f.quat).applyAxisAngle(new THREE.Vector3(0,1,0),f.noseSteeringAngle());
  assert.ok(actual.angleTo(expected)<1e-5,`${kind} steering matches solver ${speed}m/s, ${dr}: actual ${actual.toArray()} expected ${expected.toArray()} bind ${part.steeringBind.toArray()}`);
 }
 f.ctrl.dr=0;pose(0,view);const up=support.quaternion.clone();pose(1,view);const down=support.quaternion.clone();
 assert.ok(up.angleTo(down)>2);for(let i=0;i<25;i++){pose(0,view);assert.deepEqual(support.quaternion.toArray(),up.toArray());pose(1,view);assert.deepEqual(support.quaternion.toArray(),down.toArray());}
 measurements[kind]={gearClips:part.clips.gear.length,steeringCases:15,repeatCycles:25};
}
// Frame-rate-independent full-cycle times and a mid-travel direction reversal.
for(const hz of [30,60,120]){
 reset();assert.equal(f.gearPos,0);assert.equal(f.gearDown,false);assert.equal(f.setGear(true),true);
 const step=seconds=>{for(let i=0;i<Math.round(seconds*hz);i++)f.step(1/hz,()=>-10000,zero);};
 step(3.5);assert.ok(Math.abs(f.gearPos-.5)<1e-9);assert.equal(f.gearStatus().moving,true);
 step(3.5);assert.equal(f.gearPos,1);assert.equal(f.gearStatus().moving,false);assert.equal(f.events.filter(e=>e==='gear-lock').length,1);
 assert.equal(f.setGear(false),true);step(8.5);assert.ok(Math.abs(f.gearPos-.5)<1e-9);
 const before=f.gearPos;assert.equal(f.setGear(true),true);assert.equal(f.gearPos,before,'toggle never teleports');step(3.5);assert.equal(f.gearPos,1);
 assert.equal(f.setGear(false),true);step(17);assert.equal(f.gearPos,0);assert.equal(f.gearStatus().moving,false);
 const pressure=f.pneumatic;assert.equal(f.setGear(false),true);assert.equal(f.pneumatic,pressure,'held command does not drain air');
 reset(true);assert.equal(f.gearDown,true);assert.equal(f.gearPos,1);assert.equal(f.setGear(false),false,'ground lock');
 reset(false,true);assert.equal(f.gearDown,true);assert.equal(f.gearPos,1,'approach starts fully down');
 f.pneumatic=500;assert.equal(f.setGear(false),false);assert.equal(f.gearPos,1);
}
// Static leaf matrices remove local recomposition, not geometry or live animations.
reset(true);pose(1,'cockpit');const part=visual.interior,staticNodes=[];part.root.traverse(o=>{if(!o.matrixAutoUpdate)staticNodes.push(o);});
assert.ok(part.staticMatrices>500,'meaningful cockpit static-matrix coverage');
let composes=0;const original=THREE.Object3D.prototype.updateMatrix;
THREE.Object3D.prototype.updateMatrix=function(){composes++;return original.call(this);};
let optimized,baseline;
try{
 visual.update(1/60,f,zero,'cockpit');scene.updateMatrixWorld(true);optimized=composes;
 const matrices=staticNodes.map(o=>o.matrixWorld.clone());
 staticNodes.forEach(o=>o.matrixAutoUpdate=true);composes=0;visual.update(0,f,zero,'cockpit');scene.updateMatrixWorld(true);baseline=composes;
 staticNodes.forEach((o,i)=>{assert.deepEqual(o.matrixWorld.elements,matrices[i].elements,'identical static world transform');o.matrixAutoUpdate=false;});
}finally{THREE.Object3D.prototype.updateMatrix=original;}
assert.ok(baseline-optimized>=part.staticMatrices,'fewer actual matrix compositions');
measurements.cockpit={staticLeafMeshes:part.staticMatrices,optimizedComposes:optimized,baselineComposes:baseline,savedComposes:baseline-optimized};
console.log('PASS F27 full 7s/17s gear cycle at 30/60/120 Hz, reversal, ground/pressure lock, both decoded GLBs, neutral/directional steering, no half-cycle snap and identical static world transforms');
console.log(JSON.stringify(measurements,null,2));

// Use the decoded asset pivots, signed physics wheel speed, and simulation clock.
reset(true); f.setEngineRunning(false); f.parkingBrake=false; f.vel.set(15,0,0); f.wheel=[30,25,25];
const initial=f.wheelAngle.slice(); f.step(1/120,()=>0,zero);
for(let i=0;i<3;i++)assert.ok(Math.abs(f.wheelAngle[i]-initial[i]-f.wheel[i]/120)<1e-9,'solver wheel phase');
pose(1); const wheels=visual.exterior.wheels;
assert.equal(wheels.length,3);
// Check rolling direction in the evaluated straight-ahead pose, not the raw
// export's 180-degree steering bind pose (which reverses the nose axle).
visual.root.updateMatrixWorld(true);
const forward=new THREE.Vector3(0,0,1).applyQuaternion(visual.exterior.root.getWorldQuaternion(new THREE.Quaternion()));
const downAxis=new THREE.Vector3(0,-1,0).applyQuaternion(visual.exterior.root.getWorldQuaternion(new THREE.Quaternion()));
for(const w of wheels){
 const axis=new THREE.Vector3(w.sign,0,0).applyQuaternion(w.tire.getWorldQuaternion(new THREE.Quaternion()));
 assert.ok(axis.cross(downAxis).dot(forward)<-.99,'bottom tread moves rearward for positive solver speed');
}
for(const wheel of wheels){
 const spin=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),wheel.sign*f.wheelAngle[wheel.index]);
 assert.ok(wheel.tire.quaternion.angleTo(wheel.bind.clone().multiply(spin))<1e-6,'real tire pivots turn');
 assert.ok(wheel.tire.children.some(c=>c.name.endsWith('_Tire_Still')),'textured tire follows pivot');
}
const paused=wheels.map(w=>w.tire.quaternion.clone());
for(let i=0;i<10;i++)visual.update(1/30,f,zero,'orbit');
wheels.forEach((w,i)=>assert.ok(w.tire.quaternion.angleTo(paused[i])<1e-6,'paused physics cannot spin on render dt'));
f.gearPos=0; f.gearDown=false; const stowed=f.wheelAngle.slice(); f.step(1/120,()=>-10000,zero);
assert.deepEqual(f.wheelAngle,stowed,'retracted wheels do not animate');
reset(); assert.deepEqual(f.wheelAngle,[0,0,0],'reset clears phase');
console.log('PASS decoded nose/main tire spin, mirrored axes, pause, retraction and reset');

reset(); f.gearDown=true; f.gearPos=1; f.wheel=[-2,-3,-4];
f.step(1/120,()=>-10000,zero);
assert.ok(f.wheelAngle.every(a=>a<0),'signed reverse/airborne wheel speed is retained');
pose(1); const movingWheels=visual.exterior.wheels;
const assembly=movingWheels.map(w=>w.tire.parent.quaternion.clone());
f.wheelAngle=f.wheelAngle.map(a=>a+.4); visual.update(0,f,zero,'orbit');
movingWheels.forEach((w,i)=>assert.ok(w.tire.parent.quaternion.angleTo(assembly[i])<1e-6,'fixed strut/axle assembly does not spin'));
console.log('PASS signed reverse spin without rotating fixed gear members');
