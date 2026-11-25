import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createA380Transport,configureA380TransportLoader,loadA380Transport} from '../src/a380xtransport.js';
import {configureA380TextureManager,parseA380DDS} from '../tools/a380-native-textures.mjs';
import {readAsset,prepareGltf,joinBufferParts} from '../src/a380xassets.js';
import {buildA380LosslessPack} from '../tools/a380-lossless-pack.mjs';
globalThis.self = globalThis;
const base='https://fixture.invalid/models/a380x/',payload='https://fixture.invalid/packs/a380/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const binary=Buffer.alloc(80);new Float32Array(binary.buffer,binary.byteOffset,9).set([0,0,0,1,0,0,0,1,0]);
new Float32Array(binary.buffer,binary.byteOffset+36,2).set([0,1]);new Float32Array(binary.buffer,binary.byteOffset+44,6).set([0,0,0,1,2,3]);
// Two original BC1 mip levels, arbitrary original blocks and header flags retained.
const dds=Buffer.alloc(144);dds.write('DDS ');dds.writeUInt32LE(124,4);dds.writeUInt32LE(4,12);dds.writeUInt32LE(4,16);dds.writeUInt32LE(2,28);dds.write('DXT1',84);for(let i=128;i<144;i++)dds[i]=i;
const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{uri:'geometry.bin',byteLength:80}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:8},{buffer:0,byteOffset:44,byteLength:24}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,type:'SCALAR',count:2,min:[0],max:[1]},{bufferView:2,componentType:5126,type:'VEC3',count:2}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{uri:'dds/original.DDS'}],animations:[{name:'original',samplers:[{input:1,output:2}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}]};
const originals=new Map([['geometry.bin',binary],['scene.native.gltf',Buffer.from(JSON.stringify(gltf))],['dds/original.DDS',dds],['dds/SPACE NAME.DDS',dds]]);
const pack={version:1,codec:'gzip',entries:Object.fromEntries([...originals].map(([name,b])=>[name,{url:name+'.gz',encoding:'gzip',byteLength:b.length,sha256:hash(b)}]))};
const calls=[];
let active=0,peak=0;
const fetcher=async url=>{
  calls.push(String(url));active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  if(String(url)===payload+'transport.json')return new Response(JSON.stringify(pack));
  const zipped=String(url).startsWith(payload),name=decodeURIComponent(String(url).slice((zipped?payload:base).length)).replace(/\.gz$/,'');
  const value=originals.get(name);return value?new Response(zipped?gzipSync(value):value):new Response('missing',{status:404});
};
const transport=await loadA380Transport(payload+'transport.json',base,{fetcher});
assert.equal(transport.enabled,true);calls.length=0;
assert.deepEqual(Buffer.from(await readAsset(base+'geometry.bin','buffer',transport.fetch)),binary);
assert.deepEqual(await readAsset(base+'scene.native.gltf','json',transport.fetch),gltf);
const decodedDDS=await readAsset(base+'dds/original.DDS','buffer',transport.fetch);assert.deepEqual(Buffer.from(decodedDDS),dds);
const parsed=parseA380DDS(decodedDDS);assert.deepEqual(parsed.mipmaps.map(m=>[m.width,m.height,m.data.length]),[[4,4,8],[2,2,8]]);
assert.ok(calls.every(u=>u.startsWith(payload)&&u.endsWith('.gz')),'only compressed payloads requested');
// Real glTF parser: geometry, animation, DDS texture loader all use transport.
const manager=configureA380TextureManager(undefined,undefined,{transport});
const loader=configureA380TransportLoader(new GLTFLoader(manager));
const prepared=await prepareGltf(base+'scene.native.gltf',{}, {fetcher:transport.fetch});
const result=await loader.parseAsync(JSON.stringify(prepared.json),prepared.base);prepared.dispose();
let mesh;result.scene.traverse(o=>{if(o.isMesh)mesh=o;});
assert.deepEqual(Buffer.from(mesh.geometry.attributes.position.array.buffer),binary.subarray(0,36));
assert.deepEqual([...result.animations[0].tracks[0].times],[0,1]);assert.deepEqual([...result.animations[0].tracks[0].values],[0,0,0,1,2,3]);
assert.equal(mesh.material.map.mipmaps.length,2);assert.deepEqual(Buffer.from(mesh.material.map.mipmaps[1].data),dds.subarray(136));
assert.ok(calls.every(u=>u.startsWith(payload)),'glTF and DDS do not also request originals');
// Bounded decompression and no persistent decoded-byte cache.
calls.length=0;await Promise.all(Array.from({length:7},()=>readAsset(base+'geometry.bin','buffer',transport.fetch)));assert.ok(peak<=2);assert.equal(calls.length,7);
// Unsupported native gzip takes raw path BEFORE any compressed request.
calls.length=0;
// undefined picks the normal default, an explicit unsupported constructor simulates older browser.
const legacy=createA380Transport(pack,base,{fetcher,payloadBase:payload,Decompressor:class{constructor(){throw Error('unsupported');}}});
assert.equal(legacy.enabled,false);assert.deepEqual(Buffer.from(await readAsset(base+'geometry.bin','buffer',legacy.fetch)),binary);assert.deepEqual(calls,[base+'geometry.bin']);
// Unmapped/identity files remain backwards compatible, originals fetched once.
calls.length=0;const identity=createA380Transport({...pack,entries:{'geometry.bin':{...pack.entries['geometry.bin'],encoding:'identity'}}},base,{fetcher,payloadBase:payload});await readAsset(base+'geometry.bin','buffer',identity.fetch);assert.deepEqual(calls,[base+'geometry.bin']);
const broken=async response=>{let n=0;const t=createA380Transport(pack,base,{payloadBase:payload,fetcher:async()=>{n++;return response();}});return {t,get n(){return n;}};};
let b=await broken(()=>new Response('missing',{status:404}));await assert.rejects(readAsset(base+'geometry.bin','buffer',b.t.fetch),/404/);assert.equal(b.n,1);
b=await broken(()=>new Response(gzipSync(Buffer.alloc(80,1))));await assert.rejects(readAsset(base+'geometry.bin','buffer',b.t.fetch),/SHA-256 mismatch/);assert.equal(b.n,1);
b=await broken(()=>new Response(gzipSync(binary).subarray(0,15)));await assert.rejects(readAsset(base+'geometry.bin','buffer',b.t.fetch));assert.equal(b.n,1);
b=await broken(()=>new Response(gzipSync(Buffer.alloc(81))));await assert.rejects(readAsset(base+'geometry.bin','buffer',b.t.fetch),/length mismatch/);
b=await broken(()=>new Response(binary));await assert.rejects(readAsset(base+'geometry.bin','buffer',b.t.fetch),/missing gzip header/);
// Hosting Content-Encoding auto-decoded by fetch is verified, not decompressed twice.
b=await broken(()=>new Response(binary,{headers:{'content-encoding':'gzip'}}));assert.deepEqual(Buffer.from(await readAsset(base+'geometry.bin','buffer',b.t.fetch)),binary);
// A gzip header split across network chunks still decodes without a second request.
const zipped=gzipSync(binary);b=await broken(()=>new Response(new ReadableStream({start(c){c.enqueue(zipped.subarray(0,1));c.enqueue(zipped.subarray(1));c.close();}})));assert.deepEqual(Buffer.from(await readAsset(base+'geometry.bin','buffer',b.t.fetch)),binary);
// Segmented originals remain byte exact, including preallocated length checks.
const partFetcher=async url=>new Response(String(url).endsWith('part0')?binary.subarray(0,30):binary.subarray(30));
assert.deepEqual(Buffer.from(await joinBufferParts({parts:['part0','part1'],byteLength:80},base,{fetcher:partFetcher})),binary);
await assert.rejects(joinBufferParts({parts:['part0','part1'],byteLength:79},base,{fetcher:partFetcher}),/length mismatch/);
// Actual streaming builder: SHA proof, JSON/bin/DDS, mip traits and round trip.
const temp=await mkdtemp(path.join(os.tmpdir(),'a380-transport-'));
try {
  const source=path.join(temp,'source'),output=path.join(temp,'output');await mkdir(path.join(source,'dds'),{recursive:true});
  for(const [name,value]of originals)await writeFile(path.join(source,name),value);
  const built=await buildA380LosslessPack(source,output,{log(){}});
  assert.equal(built.totals.files,4);assert.equal(built.totals.ddsFiles,2);assert.equal(built.totals.verifiedBytes,[...originals.values()].reduce((n,b)=>n+b.length,0));
  assert.equal(built.entries['dds/original.DDS'].dds.mips.length,2);
  assert.ok(built.totals.transferBytes<built.totals.originalBytes);
  for(const [name,value]of originals)assert.equal(built.entries[name].sha256,hash(value));
  const local=createA380Transport(built,base,{payloadBase:payload,fetcher:async url=>{const p=String(url).startsWith(payload)?path.join(output,decodeURIComponent(String(url).slice(payload.length))):path.join(source,decodeURIComponent(String(url).slice(base.length)));return new Response(await readFile(p));}});
  for(const [name,value]of originals)assert.deepEqual(Buffer.from(await readAsset(base+name,'buffer',local.fetch)),value);
  await assert.rejects(buildA380LosslessPack(source,path.join(source,'nested')),/outside public\/source/);
}finally{await rm(temp,{recursive:true,force:true});}
console.log('A380 lossless transport: real glTF/FileLoader/DDS, every fixture byte/mip/animation, streaming gzip SHA/length failures, old-browser fallback, HTTP auto-decode, concurrency, segmentation and builder pass');
