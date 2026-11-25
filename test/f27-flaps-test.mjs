// Real decoded exterior/interior clips, production visual, actuator and drag.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadModel} from './_glb-node.mjs';
import {F27Model,F27,F27_CG,F27_GEAR,F27_FLAP_DEG} from '../src/f27.js';
import {createFokkerAdapter} from '../src/f27adapter.js';
import {prepareF27ViewCasters} from '../src/f27view.js';
import {batchF27Cockpit} from '../src/f27batch.js';
import {gateF27DormantLights} from '../src/f27materials.js';
import {GlassWater} from '../src/glasswater.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const source=read('src/f27visual.js').replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.env.BASE_URL','"/"');
const models=new Map();
for(const [kind,v] of [['ext','v3'],['vc','v2']])models.set(kind,await loadModel('f27/f27-white-'+kind+'-'+v));
class Loader{setDRACOLoader(){return this;}setMeshoptDecoder(){return this;}async loadAsync(url){const g=models.get(url.includes('-vc-')?'vc':'ext');return{scene:g.scene.clone(true),animations:g.animations};}}
class Draco{setDecoderPath(){return this;}dispose(){}}
const {F27Visual}=new Function('gateF27DormantLights','prepareF27ViewCasters','batchF27Cockpit','GlassWater','THREE','F27_CG','F27_GEAR','F27_FLAP_DEG','createFokkerAdapter','lighting','GLTFLoader','DRACOLoader','MeshoptDecoder',source+'\nreturn {F27Visual};')(gateF27DormantLights,prepareF27ViewCasters,batchF27Cockpit,GlassWater,THREE,F27_CG,F27_GEAR,F27_FLAP_DEG,createFokkerAdapter,JSON.parse(read('src/f27lighting.json')),Loader,Draco,{});
const visual=new F27Visual(new THREE.Scene()),zero=new THREE.Vector3(),f=new F27Model();
f.reset(new THREE.Vector3(0,1000,0),90,70,false);
await visual.load('/f27-white-ext-v3.glb');await visual.preloadCockpit();
const measurements={};
for(const [part,kind,view] of [[visual.exterior,'ext','orbit'],[visual.interior,'vc','cockpit']]){
  const g=models.get(kind),wingNames=part.clips.flaps;
  assert.equal(wingNames.length,4,kind+' has four independent wing surfaces');
  assert.ok(!wingNames.includes('HANDLING_Lever_Flaps'));
  for(let cmd=0;cmd<5;cmd++)for(const actual of [0,5,11.5,16.5,20,26.5,30,40]){
    f.flapCmd=cmd;f.flaps=actual;visual.update(0,f,zero,view);
    for(const name of [...wingNames,...part.clips.flapLever]){
      const c=g.animations.find(c=>c.name===name),fraction=name==='HANDLING_Lever_Flaps'?cmd/4:actual/40;
      for(const track of c.tracks){
        const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=part.root.getObjectByName(parsed.nodeName);
        const expected=new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(c.duration*fraction));
        assert.ok(node.quaternion.angleTo(expected)<.001,kind+' '+name+' command '+cmd+' actual '+actual);
      }
    }
  }
  const angles={};
  for(const name of wingNames){
    const node=part.root.getObjectByName(name);f.flaps=0;f.flapCmd=0;visual.update(0,f,zero,view);const up=node.quaternion.clone();
    f.flaps=40;f.flapCmd=4;visual.update(0,f,zero,view);angles[name]=node.quaternion.angleTo(up)*180/Math.PI;
    assert.ok(angles[name]>(name.includes('Out')?38:26));
    f.flaps=0;f.flapCmd=0;visual.update(0,f,zero,view);assert.ok(node.quaternion.angleTo(up)<.001,kind+' fully UP returns to source frame zero');
  }
  measurements[kind]={cases:40,angles};
}
for(const hz of [30,60,120]){
  const m=new F27Model();m.reset(new THREE.Vector3(0,-F27_GEAR[1].p.y,0),90,0,true);m.crashOff=true;m.setEngines(0);m.parkingBrake=true;
  const step=seconds=>{for(let i=0;i<Math.round(seconds*hz);i++)m.step(1/hz,()=>0,zero);};
  m.setFlaps(4);step(7.5);assert.ok(Math.abs(m.flaps-20)<1e-8);
  m.setFlaps(0);step(7.5);assert.ok(Math.abs(m.flaps)<1e-8,'mid-travel retraction reaches zero');
  for(let n=1;n<5;n++){m.setFlaps(n);step(16);assert.equal(m.flaps,F27_FLAP_DEG[n]);}
  m.setFlaps(0);step(7.5);assert.ok(Math.abs(m.flaps-20)<1e-8);step(7.5);assert.ok(Math.abs(m.flaps)<1e-8,'full retraction 15 s');
  step(5);assert.equal(m.flapCmd,0);assert.equal(m.flaps,0,'UP remains UP; no automatic redeployment');
}
const cd=[];
for(let n=0;n<5;n++){
  const m=new F27Model();m.reset(new THREE.Vector3(0,1000,0),90,70,false);m.setFlaps(n);m.flaps=F27_FLAP_DEG[n];m.gearPos=0;m.gearDown=false;m.crashOff=true;
  m.step(1/120,()=>-10000,zero);cd.push(m.out.CD);if(n)assert.ok(cd[n]>cd[n-1],'each deployed notch adds drag');
}
assert.equal(F27.VFE,145,'preserved implemented VFE');
for(const kias of [144,146]){
  const m=new F27Model();m.reset(new THREE.Vector3(0,0,0),90,kias/1.943844,false);m.setFlaps(1);m.flaps=11.5;m.crashOff=true;m.step(1/120,()=>-10000,zero);
  assert.equal(m.out.flapOverspeed,kias>F27.VFE);
}
measurements.motion={fullTravelSeconds:15,hz:[30,60,120],detents:F27_FLAP_DEG,cd,VFE:F27.VFE};
console.log('PASS decoded F27 wing surfaces return fully UP; all five independent lever detents, command versus actual, 15s actuator/reversal and increasing flap drag');
console.log(JSON.stringify(measurements,null,2));
