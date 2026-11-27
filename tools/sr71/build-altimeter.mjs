// Offline exact-sample extraction. Run after other cockpit asset builders.
import * as THREE from 'three';
import fs from 'node:fs';import {zstdCompressSync,zstdDecompressSync,constants} from 'node:zlib';import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),base=new URL('public/models/sr71/cockpit/',root),read=p=>JSON.parse(fs.readFileSync(new URL(p,base)));
const src=read('cockpit.gltf'),out=read('cockpit-flight.gltf'),names=['MAIN_INSTR_PANEL_ALT_10','MAIN_INSTR_PANEL_ALT_11','MAIN_INSTR_PANEL_ALT_232'];
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=src.buffers.map(b=>zstdDecompressSync(fs.readFileSync(new URL(b.uri+'.zst.part00',base))));
function bytes(ai,g=src,buffers=sources){const a=g.accessors[ai],v=g.bufferViews[a.bufferView],size=({SCALAR:1,VEC4:4}[a.type])*4;if(a.componentType!==5126||!size)throw Error('Unexpected altimeter accessor');const b=buffers[v.buffer],start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||size;return Buffer.concat(Array.from({length:a.count},(_,i)=>b.subarray(start+i*stride,start+i*stride+size)));}
let raw=zstdDecompressSync(fs.readFileSync(new URL('cockpit-flight.bin.zst.part00',base))),changed=false;
for(const name of names){const original=src.animations.find(a=>a.name===name);if(!original)throw Error('Missing archival '+name);if(out.animations.some(a=>a.name===name))continue;
 const anim=structuredClone(original),cache=new Map();
 for(const c of anim.channels){const nodeName=src.nodes[c.target.node].name;c.target.node=out.nodes.findIndex(n=>n.name===nodeName);if(c.target.node<0)throw Error('Missing target '+nodeName);}
 for(const s of anim.samplers)for(const key of ['input','output']){const ai=s[key];if(!cache.has(ai)){const a=structuredClone(src.accessors[ai]),b=bytes(ai),pad=(4-raw.length%4)%4;raw=Buffer.concat([raw,Buffer.alloc(pad),b]);a.bufferView=out.bufferViews.length;delete a.byteOffset;out.bufferViews.push({buffer:0,byteOffset:raw.length-b.length,byteLength:b.length});cache.set(ai,out.accessors.length);out.accessors.push(a);}s[key]=cache.get(ai);}
 out.animations.push(anim);changed=true;
}
if(changed){out.buffers[0].byteLength=raw.length;fs.writeFileSync(new URL('cockpit-flight.bin.zst.part00',base),zstdCompressSync(raw,{params:{[constants.ZSTD_c_compressionLevel]:19}}));fs.writeFileSync(new URL('cockpit-flight.gltf',base),JSON.stringify(out));}
const proof=names.map(name=>{const a=src.animations.find(a=>a.name===name),b=out.animations.find(a=>a.name===name);return {name,targets:b.channels.map(c=>out.nodes[c.target.node].name),accessors:a.samplers.flatMap((s,i)=>['input','output'].map(key=>{const original=bytes(s[key]),output=bytes(b.samplers[i][key],out,[raw]);if(!original.equals(output))throw Error('Source sample changed '+name);return {kind:key,sourceAccessor:s[key],outputAccessor:b.samplers[i][key],bytes:original.length,sha256:sha(original),sourceBytesExact:true};}))};});
const clipFile=new URL('cockpit-active-clips.json',import.meta.url),clips=JSON.parse(fs.readFileSync(clipFile));for(const name of names)if(!clips.includes(name))clips.push(name);fs.writeFileSync(clipFile,JSON.stringify(clips,null,2)+'\n');
// Reconstruct physical clockwise turn from each original quaternion. Art has a
// 0..9 clockwise dial labeled "100 FEET", long 100s, short 1000s, triangle 10000s.
// Original Lvars sheet gives 1000 modulo / 10000 modulo / 0..99999 respectively.
// XML ALTIMETER divides H/10, base/100, T/1000 over ANIM_LENGTH100.
// Original authored clip includes ~361 degrees, not exactly360: invert its
// measured sweep so one displayed turn is360 degrees; never invent keyframes.
const calibrations=Object.fromEntries(names.map(name=>{
 const a=src.animations.find(a=>a.name===name),s=a.samplers[0],qb=bytes(s.output),tb=bytes(s.input);
 const q=Array.from({length:qb.length/16},(_,i)=>new THREE.Quaternion(...Array.from({length:4},(_,k)=>qb.readFloatLE(i*16+k*4))));
 const times=Array.from({length:tb.length/4},(_,i)=>tb.readFloatLE(i*4)),start=times[0],span=times.at(-1)-start;
 const up=new THREE.Vector3(0,0,-1).applyQuaternion(q[0]),right=new THREE.Vector3(1,0,0).applyQuaternion(q[0]);
 let prior=0;const knots=q.map((rot,i)=>{const v=new THREE.Vector3(0,0,-1).applyQuaternion(rot);let phase=Math.atan2(v.dot(right),v.dot(up))/(2*Math.PI);while(phase<prior-.5)phase++;if(phase<prior-1e-6)throw Error('Nonmonotonic source sweep '+name);prior=phase;return [phase,(times[i]-start)/span];});
 if(knots.at(-1)[0]<1||knots.at(-1)[0]>1.01)throw Error('Source does not cover one clockwise revolution '+name);
 return [name,knots];
}));
const module=`// Generated offline by tools/sr71/build-altimeter.mjs; exact original clip is retained.
// MSL display only, not native SRFT143 barometric/electrical/lag behavior.
// The source quaternions sweep ~361deg. Invert measured angle/time to hit dial marks.
export const SR71_ALTIMETER_CLIPS=Object.freeze(${JSON.stringify(names)});
const sweeps=${JSON.stringify(calibrations)};
function clipTime(name,turn){const a=sweeps[name];let i=1;while(i<a.length-1&&turn>a[i][0])i++;const [lo,hi]=[a[i-1],a[i]];return lo[1]+(hi[1]-lo[1])*(turn-lo[0])/(hi[0]-lo[0]);}
export function altimeterPose(altitudeMetres){
 if(!Number.isFinite(altitudeMetres))return {};
 const feet=Math.min(99999,Math.max(0,altitudeMetres/.3048));
 return Object.fromEntries(SR71_ALTIMETER_CLIPS.map((name,i)=>{const revolutionFeet=[10000,1000,100000][i];return [name,clipTime(name,(feet%revolutionFeet)/revolutionFeet)];}));
}
`;
fs.writeFileSync(new URL('src/sr71altimeter.js',root),module);
const manifest=read('manifest.json');manifest.models.interior[0].animationSummary.clips=out.animations.length;
const f=manifest.cockpitFunctionality;for(const name of names)if(!f.clips.includes(name))f.clips.push(name);
f.traditionalAltimeter={implementation:'Browser MSL indication on original three-pointer altimeter, not native MSFS/WASM SRFT143/H/T',input:'Earthwing fdm.pos.y metres MSL',rangeFeet:[0,99999],pointers:{MAIN_INSTR_PANEL_ALT_11:'100 feet per dial digit; 1000 feet/revolution',MAIN_INSTR_PANEL_ALT_10:'1000 feet per dial digit; 10000 feet/revolution',MAIN_INSTR_PANEL_ALT_232:'10000 feet per dial digit; 100000 feet/revolution'},calibration:'Inverse of original measured quaternion phase, clockwise 0..9 art. Native XML length100 H/10, base/100 and T/1000; native Lvars sheet modulo1000/modulo10000/0..99999. Original samples unchanged.',unsupported:'Kollsman barometric ring ALT_234/knob unchanged; native pressure/electrical/lag/failure law unrecovered. ALT_07 retains native fixed-zero pose. No altitude drum exists in this three-pointer instrument.'};
f.unsupported=f.unsupported.map(s=>s.includes('traditional barometric altimeter')?'Analog IAS/Mach compiled transfer functions; native IVSI dynamics; traditional altimeter pressure/baro/lag/electrical behavior not emulated':s);
if(!f.telemetry.includes('Traditional altimeter three pointers driven by Earthwing MSL'))f.telemetry.push('Traditional altimeter three pointers driven by Earthwing MSL');
fs.writeFileSync(new URL('manifest.json',base),JSON.stringify(manifest));
fs.mkdirSync(new URL('asset-build/',root),{recursive:true});fs.writeFileSync(new URL('asset-build/altimeter-extraction-local.json',root),JSON.stringify({sourceGltfSha256:sha(fs.readFileSync(new URL('cockpit.gltf',base))),proof,sourceSweeps:calibrations,implementation:f.traditionalAltimeter},null,2));
console.log('PASS exact original altimeter tracks appended and verified',proof.map(p=>p.name));
