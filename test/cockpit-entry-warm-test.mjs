import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=main.slice(main.indexOf('async function warmSR71CockpitScene()'),main.indexOf('function warmArgs()'));
const reveal=main.slice(main.indexOf('function revealCockpit('),main.indexOf('function prewarmCrash()'));
for(const attached of [false,true]){
 const scene=new THREE.Scene(),model=new THREE.Group(),root=new THREE.Group();scene.add(model);
 for(let i=0;i<2;i++)scene.add(new THREE.SpotLight());
 for(let i=0;i<16;i++)root.add(new THREE.SpotLight());
 root.visible=false;if(attached)model.add(root);
 const ext=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());model.add(ext);
 const visual={model,interior:{root},cockpit:[root]},renderer={info:{programs:Array.from({length:3},()=>({}))}};
 let release,submitted=false,finished=false;
 const context={AIRCRAFT:'sr71',visual,scene,renderer,camera:{},post:{},Promise,
 warmLate(args,objects){submitted=true;assert.equal(objects.length,1);assert.equal(objects[0],scene);assert.equal(root.parent,model);assert(root.visible);let spots=0;scene.traverseVisible(o=>{if(o.isSpotLight)spots++;});assert.equal(spots,18);let hasExterior=false;scene.traverse(o=>{if(o===ext)hasExterior=true;});assert(hasExterior);return new Promise(r=>{release=r;});},
 finishPrograms(r,from){assert.equal(r,renderer);assert.equal(from,3);finished=true;return Promise.resolve();}};
 vm.createContext(context);vm.runInContext(fn+reveal,context);
 const ready=context.warmSR71CockpitScene();assert(submitted);assert.equal(root.parent,attached?model:null,'parent restored before readiness resolves');assert.equal(root.visible,false);assert.equal(finished,false);
 release();await ready;assert(finished);assert.equal(root.visible,false);
 context.AIRCRAFT='c172';submitted=false;await context.warmSR71CockpitScene();assert.equal(submitted,false);
}
console.log('PASS full cockpit light-set scene compile, exterior included, no duplicate lights, synchronous restoration, detached/attached cases, readiness and link completion, other aircraft unchanged');
