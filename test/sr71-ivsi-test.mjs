import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {decompress} from '../src/vendor/fzstd.mjs';
import {SR71Cockpit,cockpitPose} from '../src/sr71cockpit.js';
import {ivsiPose,SR71_IVSI_ANCHORS} from '../src/sr71ivsi.js';
const base=new URL('../public/models/sr71/cockpit/',import.meta.url),d=JSON.parse(fs.readFileSync(new URL('cockpit-flight.gltf',base))),raw=decompress(fs.readFileSync(new URL('cockpit-flight.bin.zst.part00',base))),loader=new GLTFLoader();
loader.register(parser=>{parser.loadBuffer=async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);parser.loadTextureImage=async()=>new THREE.Texture();return {name:'LOCAL_IVSI_EXACT_BUFFERS'};});
const {scene:root,animations}=await loader.parseAsync(JSON.stringify(d),''),cockpit=new SR71Cockpit({root,animations}),geometry=JSON.parse(fs.readFileSync(new URL('../tools/sr71/ivsi-dial-calibration.json',import.meta.url))),up=new THREE.Vector3(...geometry.up),x=new THREE.Vector3(...geometry.normal).cross(up),tip=new THREE.Vector3(...geometry.tip),needle=root.getObjectByName('MAIN_INST_PANEL_IVSI_NEEDLE');
// Expected labeled source tick positions are independent of the generated calibration module.
const points=geometry.ticks;
for(const {fpm,phase:want}of points){cockpit.update({vel:{y:fpm*.3048/60}});const v=tip.clone().applyQuaternion(needle.quaternion),phase=Math.atan2(v.dot(up),v.dot(x))/(2*Math.PI);assert(Math.abs(phase-want)<.00001,`${fpm}: actual source pointer ${phase} vs tick ${want}`);}
console.log('PASS 9 labeled climb/zero/descent points align actual authored needle to independently measured source-art ticks (<0.0036 degrees)');
for(const n of [NaN,Infinity,-Infinity,undefined,null,'10']){assert.equal(ivsiPose(n),undefined);assert.equal(cockpitPose({vel:{y:n}}).MAIN_INST_PANEL_IVSI_NEEDLE,undefined);}
assert.equal(ivsiPose(10000),ivsiPose(6000*.3048/60));assert.equal(ivsiPose(-10000),ivsiPose(-6000*.3048/60));
let prior=-Infinity;for(let fpm=-6500;fpm<=6500;fpm+=1){let u=ivsiPose(fpm*.3048/60);if(fpm<0&&u>.5)u-=1;assert(u>=prior-1e-12);prior=u;}
const left=ivsiPose(-1e-9),right=ivsiPose(1e-9);assert(Math.abs(left-right)<1e-7,'continuous through zero without sweeping the full dial');assert.equal(SR71_IVSI_ANCHORS.length,9);
console.log('PASS 13,001-point monotonic sweep, ±6000 FPM clipping, zero continuity, invalid telemetry omission and m/s→FPM conversion');
cockpit.dispose();
