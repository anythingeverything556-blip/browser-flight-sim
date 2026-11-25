import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { partitionGltf, selectA380Views, assetCost } from '../tools/a380-partition.mjs';
import { A380XVisual } from '../src/a380xvisual.js';

// Independent externally referenced material + sparse/morph/skin/animation closure.
const fixture = { asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0,2]}],
  nodes:[{name:'cockpit',children:[1],translation:[1,2,3]}, {name:'seat',mesh:0,skin:0}, {name:'A380_CABIN',children:[3]}, {name:'YC_SEAT',mesh:1}],
  meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0,targets:[{POSITION:3}]}]}, {primitives:[{attributes:{POSITION:2},material:1}]}],
  skins:[{joints:[0],inverseBindMatrices:4}], accessors:[{bufferView:0},{bufferView:1},{bufferView:2},{sparse:{count:1,indices:{bufferView:3,componentType:5123},values:{bufferView:4}}},{bufferView:5},{bufferView:6},{bufferView:7}],
  bufferViews:Array.from({length:8},(_,i)=>({buffer:i%2,byteOffset:i*4,byteLength:4})), buffers:[{uri:'cockpit.bin',byteLength:32},{uri:'cabin.bin',byteLength:32}],
  materials:[{name:'A380_COCKPIT_SEATS',normalTexture:{index:0}},{name:'A380X_MAIN_DECK_YC_SEAT',pbrMetallicRoughness:{baseColorTexture:{index:1}},extras:{sourceMSFSMaterial:{detailNormalTexture:{index:0}}}}],
  textures:[{source:0,sampler:0},{source:1,sampler:0}],samplers:[{wrapS:10497}],images:[{uri:'../dds/seats.dds'},{uri:'../dds/cabin.dds'}],
  animations:[{name:'motion',channels:[{sampler:0,target:{node:0,path:'translation'}},{sampler:1,target:{node:3,path:'translation'}}],samplers:[{input:5,output:6},{input:5,output:6}]}] };
const original = structuredClone(fixture), part=partitionGltf(fixture,new Set([3]),{uriPrefix:'../'});
assert.deepEqual(fixture, original, 'source object is never modified');
assert.equal(part.json.nodes[1].mesh,undefined);assert.equal(part.json.nodes[3].mesh,0);
assert.equal(part.json.materials[0].name,'A380X_MAIN_DECK_YC_SEAT');assert.equal(part.json.images[1].uri,'../../dds/cabin.dds');assert.equal(part.json.materials[0].extras.sourceMSFSMaterial.detailNormalTexture.index,0);
assert.equal(part.json.animations[0].channels.length,1);assert.equal(part.json.animations[0].channels[0].target.node,3);
const captain=partitionGltf(fixture,new Set([1]));assert.equal(captain.json.skins.length,1);assert.equal(captain.json.accessors.length,6);assert.equal(captain.json.accessors[2].sparse.count,1);
assert.equal(selectA380Views(fixture).cockpit.has(1),true);assert.equal(selectA380Views(fixture).cabin.has(3),true);
assert.throws(()=>partitionGltf({...fixture,extensionsUsed:['unknown']},new Set([1])),/audited extension-free/);

// Actual visual loader: independently load full-detail view plus shared source
// shell once; switching views never hides another view's required shared shell.
const nativeFetch=globalThis.fetch, requests=[];
const empty={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'SOURCE_NODE'}]};
const base='https://fixture.invalid/models/a380x/';
globalThis.fetch=async url=>{requests.push(String(url));return new Response(JSON.stringify(String(url).endsWith('scene.json')?{exterior:'exterior.gltf',interior:'shared.gltf',cockpit:'captain.gltf',cabin:'passenger.gltf'}:empty),{status:200});};
try {
  const visual=new A380XVisual(new THREE.Scene());await visual.load(base+'scene.json');assert.equal(requests.length,2);
  await visual.ensureView('cockpit');assert.equal(requests.length,4);assert.equal(requests.filter(s=>s.endsWith('passenger.gltf')).length,0);
  const f={pos:new THREE.Vector3(),quat:new THREE.Quaternion()};
  visual.update(0,f,new THREE.Vector3(),'cockpit');assert.ok(visual.partGroups.interior.visible);assert.ok(visual.partGroups.cockpit.visible);
  await visual.ensureView('cabin');assert.equal(requests.length,5);assert.equal(requests.filter(s=>s.endsWith('shared.gltf')).length,1);
  visual.update(0,f,new THREE.Vector3(),'cabin');assert.ok(visual.partGroups.interior.visible);assert.ok(visual.partGroups.cabin.visible);assert.equal(visual.partGroups.cockpit.visible,false);
  visual.update(0,f,new THREE.Vector3(),'chase');assert.equal(visual.partGroups.interior.visible,false);assert.equal(visual.partGroups.cabin.visible,false);
} finally {globalThis.fetch=nativeFetch;}

// Nested lazy manifest + separately hosted compressed payload root: source
// assets still map against the ORIGINAL exterior directory, not /lazy/.
requests.length=0;
const originalJSON=Buffer.from(JSON.stringify(empty)), zipped=gzipSync(originalJSON);
const packed={version:1,codec:'gzip',entries:{'exterior.gltf':{url:'exterior.gltf.gz',encoding:'gzip',byteLength:originalJSON.length,sha256:createHash('sha256').update(originalJSON).digest('hex')}}};
globalThis.fetch=async url=>{const u=String(url);requests.push(u);if(u.endsWith('/lazy/scene.json'))return new Response(JSON.stringify({exterior:'../exterior.gltf',transport:'https://fixture.invalid/packs/transport.json'}));if(u.endsWith('/packs/transport.json'))return new Response(JSON.stringify(packed));if(u.endsWith('/packs/exterior.gltf.gz'))return new Response(zipped);return new Response('unexpected original request',{status:404});};
try {const visual=new A380XVisual(new THREE.Scene());await visual.load(base+'lazy/scene.json');assert.ok(visual.model.getObjectByName('SOURCE_NODE'));assert.equal(visual.transport.enabled,true);assert.deepEqual(requests,[base+'lazy/scene.json','https://fixture.invalid/packs/transport.json','https://fixture.invalid/packs/exterior.gltf.gz']);}
finally{globalThis.fetch=nativeFetch;}

// Full source-model proof when the original asset pack is present. This test
// compares original dependency structures/ranges, not regenerated approximations.
const directory=path.resolve('public/models/a380x'), sourceFile=path.join(directory,'a380_cockpit.native.gltf');
if(fs.existsSync(sourceFile)){
  const source=JSON.parse(fs.readFileSync(sourceFile)), selection=selectA380Views(source);
  const sets={interior:selection.shared,cockpit:new Set([...selection.cockpit].filter(i=>!selection.shared.has(i))),cabin:new Set([...selection.cabin].filter(i=>!selection.shared.has(i)))};
  const sourceMeshes=source.nodes.flatMap((n,i)=>n.mesh===undefined?[]:[i]),union=[...sets.interior,...sets.cockpit,...sets.cabin].sort((a,b)=>a-b);
  assert.deepEqual(union,sourceMeshes,'every original mesh attachment belongs to exactly one source partition');
  for(const [name,selected]of Object.entries(sets)){
    const {json:g,sourceIds:m}=partitionGltf(source,selected);
    const restore=(obj,key,type)=>{if(obj[key]!==undefined)obj[key]=m[type][obj[key]];};
    const refs=(v)=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(k.endsWith('Texture')&&x&&Number.isInteger(x.index))restore(x,'index','textures');else refs(x);}};
    for(const type of Object.keys(m))for(let i=0;i<g[type].length;i++){
      const value=structuredClone(g[type][i]);
      if(type==='meshes')for(const p of value.primitives){for(const k of Object.keys(p.attributes))restore(p.attributes,k,'accessors');restore(p,'indices','accessors');restore(p,'material','materials');for(const t of p.targets||[])for(const k of Object.keys(t))restore(t,k,'accessors');}
      if(type==='skins')restore(value,'inverseBindMatrices','accessors');
      if(type==='materials')refs(value);
      if(type==='textures'){restore(value,'source','images');restore(value,'sampler','samplers');}
      if(type==='images')restore(value,'bufferView','bufferViews');
      if(type==='accessors'){restore(value,'bufferView','bufferViews');if(value.sparse){restore(value.sparse.indices,'bufferView','bufferViews');restore(value.sparse.values,'bufferView','bufferViews');}}
      if(type==='bufferViews')restore(value,'buffer','buffers');
      assert.deepEqual(value,source[type][m[type][i]],`${name}: exact source ${type}/${m[type][i]}`);
    }
    g.nodes.forEach((n,i)=>{const restored=structuredClone(n),expected=structuredClone(source.nodes[i]);restore(restored,'mesh','meshes');restore(restored,'skin','skins');if(!selected.has(i)){delete expected.mesh;delete expected.skin;}assert.deepEqual(restored,expected);});
    for(const a of g.animations){const old=source.animations.find(x=>x.name===a.name);assert.ok(old);for(const c of a.channels){const s=structuredClone(a.samplers[c.sampler]);restore(s,'input','accessors');restore(s,'output','accessors');assert.ok(old.channels.some(x=>JSON.stringify(x.target)===JSON.stringify(c.target)&&JSON.stringify(old.samplers[x.sampler])===JSON.stringify(s)));}}
    const generated=JSON.parse(fs.readFileSync(path.join(directory,'lazy',`${name}.native.gltf`)));const rebased=partitionGltf(source,selected,{uriPrefix:'../'}).json;assert.equal(JSON.stringify(generated) === JSON.stringify(rebased),true,`${name}: generated manifest is reproducible (standard JSON signed-zero semantics)`);
    const cost=assetCost(g,directory);assert.ok(cost.uniqueResourceBytes>0);
    console.log(`${name}: ${selected.size} source mesh attachments, ${g.images.length} source images, ${cost.uniqueResourceBytes} uncompressed resource bytes; exact dependency proof PASS`);
  }
}
console.log('A380 view partitions: exact source union/dependencies, external-material indices, sparse/morph/skin/animation closure and independent lazy view loading PASS');
