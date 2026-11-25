import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createF27ViewTransition, prepareF27ViewFrame, prepareF27ViewCasters } from '../src/f27view.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let view='orbit', lost=false, prepared=deferred();const covers=[],applied=[];
const renderer={shadowMap:{needsUpdate:false},getContext:()=>({isContextLost:()=>lost})};
const controller=createF27ViewTransition({getView:()=>view,prepare:()=>prepared.promise,apply:v=>{view=v;applied.push(v);},cover:x=>covers.push(x),timeoutMs:50});
const scene=new THREE.Scene(),lamp=new THREE.PointLight(0xff0000,2.75);scene.add(lamp);
const context={renderer,scene,shadows:{fresh:[true,true,true],every:2},cloudShadow:{map:{w:1},map2:{w:1},old:{valid:true},mix:0.4},vclouds:{_marchedAt:{},halfRate:true,frame:1},post:{enabled:true,aoStrength:0.7},shAt:{v:[1]},aoTarget:0};
let first=controller.request('cockpit');await tick();
assert.equal(view,'orbit');assert.equal(controller.beginFrame(),false);assert.deepEqual(covers,[]);
prepared.resolve();await tick();assert.equal(controller.beginFrame(),true);assert.equal(view,'cockpit');
assert.equal(controller.afterRender(renderer),false,'activation alone cannot reveal');
const env={lutAt:123,envAt:456,hour:0};assert.equal(controller.beforeEnvironment(env),true);assert.equal(env.envAt,-Infinity);assert.equal(env.lutAt,-Infinity);assert.equal(env.hour,0);
assert.equal(controller.prepareFrame(context),true);assert.deepEqual(context.shadows.fresh,[false,false,false]);
assert.equal(context.shAt.v,null);assert.equal(context.cloudShadow.map.w,0);assert.equal(context.cloudShadow.old.valid,false);
assert.equal(context.vclouds._marchedAt,null);assert.equal(context.vclouds.halfRate,true);assert.equal(lamp.intensity,2.75);
assert.equal(context.post.aoStrength,0);assert.equal(context.shadows.every,2);
controller.beginFrame();assert.equal(controller.afterRender(renderer),false,'skipped draw cannot reuse previous frame preparation');
controller.prepareFrame(context);renderer.shadowMap.needsUpdate=false;controller.beforeRender(renderer);assert.equal(renderer.shadowMap.needsUpdate,true);
lost=true;assert.equal(controller.afterRender(renderer),false);lost=false;assert.equal(controller.afterRender(renderer),true);
assert.equal((await first).status,'shown');assert.deepEqual(covers,[true,false]);
assert.equal(controller.prepareFrame(context),false,'zero steady-state prep work');
// Last intent wins during load, including cancellation back to the source.
prepared=deferred();const abandoned=controller.request('orbit');await tick();
const latest=controller.request('cockpit');await tick();assert.equal((await abandoned).status,'superseded');
prepared.resolve();await tick();controller.beginFrame();controller.prepareFrame(context);controller.afterRender(renderer);assert.equal((await latest).status,'shown');assert.equal(view,'cockpit');
// Failed entry retains the source without a blackout.
prepared=deferred();const failure=controller.request('orbit');await tick();prepared.reject(new Error('download'));
assert.equal((await failure).status,'failed');assert.equal(view,'cockpit');assert.equal(controller.active,false);
// No RAF/idle callback needed for timeout; no unsafe reveal fallback.
prepared=deferred();assert.equal((await controller.request('orbit')).status,'failed');assert.equal(view,'cockpit');
// Superseded active target followed by failure rolls back to last DISPLAYED view.
prepared=deferred();const intermediate=controller.request('orbit');await tick();prepared.resolve();await tick();controller.beginFrame();
prepared=deferred();const bad=controller.request('cockpit');await tick();prepared.reject(new Error('download'));
assert.equal((await intermediate).status,'superseded');assert.equal((await bad).status,'failed');assert.equal(controller.pending,'cockpit');
controller.beginFrame();controller.prepareFrame(context);controller.afterRender(renderer);assert.equal(view,'cockpit');
const root=new THREE.Group();const opaque=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
const glass=new THREE.Mesh(opaque.geometry,new THREE.MeshStandardMaterial({transparent:true}));
const disabled=new THREE.Mesh(opaque.geometry,new THREE.MeshBasicMaterial({visible:false}));
const rivet=new THREE.Mesh(new THREE.BoxGeometry(.015,.013,.005),opaque.material);
root.add(opaque,glass,disabled,rivet);root.visible=false;
assert.equal(prepareF27ViewCasters({kind:'cockpit',root}),1);assert.equal(opaque.castShadow,true);assert.equal(glass.castShadow,false);assert.equal(disabled.castShadow,false);assert.equal(root.visible,false);assert.equal(rivet.castShadow,false);
assert.equal(prepareF27ViewCasters({kind:'exterior',root}),0);
context.aoTarget=0.6;assert.equal(prepareF27ViewFrame(context),0.6);assert.equal(context.post.aoStrength,0.6);
console.log('PASS F27 V4: first entry, same-frame gate, skipped draw, context loss, rapid intents, timeout/rejection, covered rollback, shadows/cloud/AO and unchanged light intensities');
