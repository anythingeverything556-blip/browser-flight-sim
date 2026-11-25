import assert from 'node:assert/strict';
import * as THREE from 'three';
import { joinBufferParts, prepareGltf } from '../src/a380xassets.js';
import { animationRole, animationFraction, A380XVisual } from '../src/a380xvisual.js';
import { CameraRig, configureCameraAircraft, VIEWS } from '../src/camera.js';
import { decodeA380DXT } from '../tools/a380-native-textures.mjs';
// GPU S3TC is optional; the CPU path decodes original texels and every mip.
const decodedBC1=decodeA380DXT({data:Uint8Array.of(0,0,255,255,0xe4,0,0,0),width:4,height:1},false);
assert.deepEqual([...decodedBC1.data],[0,0,0,255,255,255,255,255,127,127,127,255,0,0,0,0]);
const decodedBC3=decodeA380DXT({data:Uint8Array.of(200,50,0x58,0,0,0,0,0,0,0xf8,0xe0,0x07,0xe4,0,0,0),width:4,height:1},true);
assert.deepEqual([...decodedBC3.data],[255,0,0,200,0,255,0,157,170,85,0,50,85,170,0,200]);

const base='https://fixture.invalid/models/a380x/';
const data=new Map([[base+'part0.bin',new Uint8Array([1,2])],[base+'part1.bin',new Uint8Array([3,4,5])]]),calls=[];
const fetcher=async url=>{calls.push(url);const value=data.get(url);return {ok:!!value,status:value?200:404,arrayBuffer:async()=>value.buffer,json:async()=>structuredClone(value)};};
assert.deepEqual([...new Uint8Array(await joinBufferParts({parts:['part0.bin','part1.bin'],byteLength:5},base,{fetcher}))],[1,2,3,4,5]);
await assert.rejects(joinBufferParts({parts:['part0.bin'],byteLength:9},base,{fetcher}),/length mismatch/);
await assert.rejects(joinBufferParts({parts:['missing.bin']},base,{fetcher}),/unavailable \(404\)/);
data.set(base+'exterior.gltf',{asset:{version:'2.0'},buffers:[{uri:'big.bin',byteLength:5}],scenes:[{nodes:[]}],nodes:[]});
const prepared=await prepareGltf(base+'exterior.gltf',{buffers:{'big.bin':{parts:['part0.bin','part1.bin']}}},{fetcher});assert.match(prepared.json.buffers[0].uri,/^blob:/);assert.equal(prepared.base,base);prepared.dispose();
const f={gearPos:1,flaps:33,slats:23,spoilers:.6,surfN:{el:.8,ail:1,rud:-1},engines:[{n1:60},{rev:1}]};
for(const name of ['c_gear','l_b_gear','r_b_gear','l_w_gear','r_w_gear'])assert.equal(animationRole(name).role,'gear');
assert.equal(animationRole('N1_3_anim').engine,2);assert.equal(animationRole('c_gear_comp').role,'compression');assert.equal(animationRole('thrust_rev_2').engine,2);
assert.equal(animationRole('l_flap_percent_key').role,'flaps');assert.equal(animationRole('lower_rudder_percent_key').role,'rudder');
assert.equal(animationFraction({role:'gear'},f),1);assert.equal(animationFraction({role:'gear',invert:true},f),0);assert.equal(animationFraction({role:'aileron',side:'left'},f),0);assert.equal(animationFraction({role:'aileron',side:'right'},f),1);assert.equal(animationFraction({role:'elevator'},f),.9);assert.equal(animationFraction({role:'reverse'},f),1);
// A tiny test-only standard glTF ensures the actual loader handles external scene parsing;
// it is never written into public/models or substituted for the FlyByWire exterior.
const nativeFetch=globalThis.fetch;const requests=[];
const fixture={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'SOURCE_NODE'}]};
globalThis.fetch=async url=>{const u=String(url);requests.push(u);return new Response(JSON.stringify(u.endsWith('manifest.json')?{exterior:'exterior.gltf',cockpit:'interior.gltf',cabin:'interior.gltf',rotation:[0,0,0]}:fixture),{status:200,headers:{'Content-Type':'application/json'}});};
try { const v=new A380XVisual(new THREE.Scene());await v.load(base+'manifest.json');assert.equal(requests.length,2,'boot fetches only manifest and exterior');assert.equal(v.viewStatus.cockpit,'idle');await v.ensureView('cockpit');assert.equal(requests.length,3);await v.ensureView('cabin');assert.equal(requests.length,3,'shared original cockpit+passenger cabin fetched once');const state={pos:new THREE.Vector3(),quat:new THREE.Quaternion(),...f};v.update(1/60,state,new THREE.Vector3(),'cockpit');assert.ok(v.partGroups.cockpit.visible);v.update(1/60,state,new THREE.Vector3(),'cabin');assert.ok(v.partGroups.cabin.visible);assert.ok(v.model.getObjectByName('SOURCE_NODE')); }
finally { globalThis.fetch=nativeFetch; }
assert.ok(!VIEWS.includes('cabin'));configureCameraAircraft({cabin:new THREE.Vector3(2,3,4)});assert.ok(VIEWS.includes('cabin'));
globalThis.window={addEventListener(){}};const rig=new CameraRig(new THREE.PerspectiveCamera(),{addEventListener(){}});rig.set('cabin');rig.update(0,{pos:new THREE.Vector3(10,20,30),quat:new THREE.Quaternion(),vel:new THREE.Vector3()},()=>1000,new THREE.Vector3());assert.deepEqual(rig.world.toArray(),[12,23,34]);
console.log('A380X: segmented binaries, missing/truncated assets, original clip binding, exterior-only boot, lazy shared interiors and passenger camera pass');
