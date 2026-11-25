// Real decoded GLB geometry + real AnimationMixer; no source-regex stand-in for contact/motion.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadModel} from './_glb-node.mjs';
import {F27Model,F27_CG,F27_GEAR,F27_FLAP_DEG} from '../src/f27.js';
import {createFokkerAdapter} from '../src/f27adapter.js';
import { prepareF27ViewCasters } from '../src/f27view.js';
import { batchF27Cockpit } from '../src/f27batch.js';
import { gateF27DormantLights } from '../src/f27materials.js';
import { GlassWater } from '../src/glasswater.js';
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source = read('src/f27visual.js').replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.env.BASE_URL','"/"');
const lighting = JSON.parse(read('src/f27lighting.json'));
const models = new Map();
for (const kind of ['ext','vc']) {
  const version=kind==='ext'?'v3':'v2';
  models.set(kind,await loadModel(`f27/f27-white-${kind}-${version}`));
}
class Loader { setDRACOLoader(){return this;} setMeshoptDecoder(){return this;} async loadAsync(url){const g=models.get(url.includes('-vc-')?'vc':'ext');return {scene:g.scene.clone(true),animations:g.animations};} }
class Draco {setDecoderPath(){return this;} dispose(){}}
const {F27Visual,propellerMode,propellerDisplayRps,propellerBlend,F27_EYE,F27_COCKPIT_MODEL,F27_EXTERIOR_MODEL} = new Function('gateF27DormantLights','prepareF27ViewCasters','batchF27Cockpit','GlassWater','THREE','F27_CG','F27_GEAR','F27_FLAP_DEG','createFokkerAdapter','lighting','GLTFLoader','DRACOLoader','MeshoptDecoder',source+'\nreturn {F27Visual,propellerMode,propellerDisplayRps,propellerBlend,F27_EYE,F27_COCKPIT_MODEL,F27_EXTERIOR_MODEL};')(gateF27DormantLights,prepareF27ViewCasters,batchF27Cockpit,GlassWater,THREE,F27_CG,F27_GEAR,F27_FLAP_DEG,createFokkerAdapter,lighting,Loader,Draco,{});
assert.match(F27_COCKPIT_MODEL,/-vc-v2.glb$/); assert.match(F27_EXTERIOR_MODEL,/-ext-v3.glb$/);
const scene=new THREE.Scene(),visual=new F27Visual(scene),fdm=new F27Model(),zero=new THREE.Vector3();
await visual.load('/'+F27_EXTERIOR_MODEL);
const initialY=-F27_GEAR[1].p.y;
fdm.reset(new THREE.Vector3(0,initialY,0),90,0,true);fdm.setEngineRunning(false);fdm.parkingBrake=true;
const tires=part=>['Center','Left','Right'].map(label=>part.root.getObjectByName(`GEAR_${label}_Tire_Still`)||part.root.getObjectByName(`GEAR_${label}_Tire_Base`));
const bottoms=part=>{visual.root.updateMatrixWorld(true);return tires(part).map(o=>new THREE.Box3().setFromObject(o,true).min.y);};
visual.update(0,fdm,zero,'orbit');
const spawn=bottoms(visual.exterior);spawn.forEach((height,i)=>assert.ok(Math.abs(height)<0.001,`spawn ${i}: ${height}m`));
// Settle the real 6DOF suspension; visually compensate penetration, not aircraft altitude.
for(let i=0;i<1200;i++)fdm.step(1/240,()=>0,zero);
visual.update(1/60,fdm,zero,'orbit');
const settled=bottoms(visual.exterior); settled.forEach((height,i)=>assert.ok(Math.abs(height)<0.008,`settled ${i}: ${height}m`));
assert.ok(fdm.compress.every(x=>x>0.005),'all three springs carry the aircraft');assert.ok(!fdm.crashed);
// No accumulating translation from per-frame suspension correction.
for(let i=0;i<100;i++)visual.update(0,fdm,zero,'orbit');
bottoms(visual.exterior).forEach((h,i)=>assert.ok(Math.abs(h-settled[i])<1e-7));
// A gently sloping runway, tested at the actual tire vertices (not AABB corners).
const slope = (x,z) => .01*x+.015*z, slopeFdm=new F27Model();
slopeFdm.reset(new THREE.Vector3(0,initialY,0),90,0,true);slopeFdm.setEngineRunning(false);slopeFdm.parkingBrake=true;
for(let i=0;i<1800;i++)slopeFdm.step(1/240,slope,zero);
visual.update(0,slopeFdm,zero,'orbit');visual.root.updateMatrixWorld(true);
const slopeGap=tires(visual.exterior).map(tire=>{let gap=Infinity;const p=new THREE.Vector3();tire.traverse(mesh=>{const attr=mesh.geometry?.attributes.position;if(!attr)return;for(let k=0;k<attr.count;k++){p.fromBufferAttribute(attr,k).applyMatrix4(mesh.matrixWorld);gap=Math.min(gap,p.y-slope(p.x,p.z));}});return gap;});
slopeGap.forEach((gap,i)=>assert.ok(Math.abs(gap)<.012,`sloped footprint ${i}: ${gap}m`));
visual.update(0,fdm,zero,'orbit');
const moving=[];
for(const hz of [24,30,60,120])for(const rpm of [143,287.5,651,1395]) {
  const delta=propellerDisplayRps(rpm)/hz, fourBladeAngle=delta*2*Math.PI*4;
  assert.ok(Math.abs(Math.sin(fourBladeAngle/2))>0.05,`non-static sampled four-blade motion ${rpm}RPM @${hz}Hz`);
}
for(const [left,right] of [[0,0],[651,0],[0,1395],[651,1395]]) {
  fdm.engines[0].propRpm=left;fdm.engines[1].propRpm=right;
  const before=visual.exterior.props.map(p=>p.hub.quaternion.clone());visual.update(1/30,fdm,zero,'orbit');
  visual.exterior.props.forEach((p,i)=>{
    const rpm=[left,right][i]; assert.equal(p.still.visible,true,'real blades and spinner retained');
    assert.equal(p.blur.visible,propellerBlend(rpm).disc>0.001);assert.equal(p.cone.visible,p.blur.visible,'hidden parent cannot suppress the blur');
    assert.equal(p.blades.length,4,'all four actual textured blade meshes retained');
    assert.equal(before[i].angleTo(p.hub.quaternion)>0.01,rpm>0,'engine-independent visible motion');
    p.blades.forEach(b=>assert.ok(b.material.opacity>0.3));
  });moving.push({rpms:[left,right],phases:visual.propDisplayPhase.slice()});
}
for(let rpm=1;rpm<=1395;rpm++){const a=propellerBlend(rpm-1),z=propellerBlend(rpm);assert.ok(z.disc>=a.disc&&z.disc-a.disc<0.002&&z.blades<=a.blades&&a.blades-z.blades<0.002);}
assert.deepEqual([0,143,287.5,1395].map(propellerMode),['Still','Slow','Blurred','Blurred']);
// Staged cockpit: deduplicated, never changes view and not visible before commit.
let release;const gate=new Promise(resolve=>release=resolve);visual.preparePart=async part=>{if(part.kind==='cockpit')await gate;};
const a=visual.preloadCockpit(),b=visual.ensureView('cockpit');assert.equal(a,b);visual.ensureView('orbit');
await new Promise(r=>setTimeout(r,0));assert.equal(visual.view,'orbit');assert.equal(visual.interior,undefined);assert.equal(visual.exterior.root.visible,true);
release();await a;assert.equal(visual.interior.root.visible,false);assert.equal(visual.view,'orbit');assert.equal(visual.exterior.root.visible,true);
visual.update(0,fdm,zero,'cockpit');assert.equal(visual.exterior.root.visible,false);assert.equal(visual.interior.root.visible,true);
const interiorBottom=bottoms(visual.interior);interiorBottom.forEach((height,i)=>assert.ok(Math.abs(height)<0.008,`cockpit geometry ${i}: ${height}m`));
assert.ok(F27_EYE.y<0.4&&F27_EYE.y>0.2,'modestly lower source eye in calibrated frame');
console.log(JSON.stringify({pass:true,spawnBottomM:spawn,settledBottomM:settled,interiorBottomM:interiorBottom,slopeGapM:slopeGap,compressionM:fdm.compress,settledPitchDeg:new THREE.Euler().setFromQuaternion(fdm.quat,'YXZ').z*180/Math.PI,eyeBody:F27_EYE.toArray(),moving},null,2));

// Both original yokes move together. Four rudder pedals use opposed source
// clips; pitch/roll stay independent and hiding the pilot column is untouched.
const vr=visual.interior.root;
const nodes=['x0_Yoke_Base','x0_Yoke01_Upper','x0_Yoke02_Upper','x0_Rudder_Ped01','x0_Rudder_Ped02','x0_Rudder_Ped03','x0_Rudder_Ped04'].map(n=>vr.getObjectByName(n));
assert.ok(nodes.every(Boolean),'all original controls exist in the decoded cockpit');
const pose=axes=>{visual.update(0,fdm,zero,'cockpit',null,null,null,axes);return nodes.map(n=>n.quaternion.clone());};
const neutral=pose({pitch:0,roll:0,yaw:0}), pulled=pose({pitch:1,roll:1,yaw:1}), pushed=pose({pitch:-1,roll:-1,yaw:-1});
assert.ok(pulled[0].x<0&&pushed[0].x>0,'full aft/forward yoke column');
assert.ok(pulled[1].z>0&&pulled[2].z>0&&pushed[1].z<0&&pushed[2].z<0,'captain and FO roll physically together');
for(const j of [3,5])assert.ok(pulled[j].x>0&&pushed[j].x<0);
for(const j of [4,6])assert.ok(pulled[j].x<0&&pushed[j].x>0);
assert.ok(pulled.every((q,i)=>q.angleTo(neutral[i])>.10));
const released=pose({pitch:0,roll:0,yaw:0});
assert.ok(released.every((q,i)=>q.angleTo(neutral[i])<1e-6));
assert.ok(!visual.interior.adapter.activeClips.some(n=>/^x0_Yoke0[12]_Column$/.test(n)),'no accidental hide/stow sampling');
console.log('PASS original F27 pitch/roll yoke and four opposed rudder pedal clips from pilot commands');
