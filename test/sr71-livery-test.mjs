import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = new URL('../public/models/sr71/exterior/',import.meta.url);
const json = async u=>JSON.parse(await readFile(u,'utf8'));
const proof = await json(new URL('../asset-build/usaf-livery-source-proof.json',import.meta.url)).catch(error=>{ if (error.code!=='ENOENT') throw error; return json(new URL('../../livery-proof/usaf-livery-source-proof.json',import.meta.url)); });
const atlas = 'textures/sr-71_ext_decals_albd.webp';
assert.equal(createHash('sha256').update(await readFile(new URL(atlas,dir))).digest('hex'),proof.outputSha256);
assert.equal(proof.livery,'61-7950 (2001)');
assert.match(proof.source,/liveries\/milviz\/61-7950_2001\//);
assert.deepEqual(proof.deliveredSize,[4096,4096]);
let references=0;
for (const name of ['exterior-flight','exterior','nose-asars-flight','nose-asars','nose-gear-flight','nose-gear','gear-left-flight','gear-left','gear-right-flight','gear-right']) {
 const d=await json(new URL(name+'.gltf',dir));
 const materials=d.materials.map((m,i)=>[m,i]).filter(([m])=>m.name==='SR-71_ext_decals');
 if(name==='nose-gear-flight') { assert.equal(materials.length,0); continue; }
 assert(materials.length>0,name+' must retain native decal material');
 for (const [m,i] of materials) {
  const tex=d.textures[m.pbrMetallicRoughness.baseColorTexture.index];
  const im=d.images[tex.extensions?.EXT_texture_webp?.source ?? tex.source];
  assert.equal(im.uri,atlas,name+' must share the restored USAF atlas');
  assert.equal(m.alphaMode,'BLEND');
  assert.equal(m.pbrMetallicRoughness.baseColorFactor[3],1);
  assert(d.meshes.some(mesh=>mesh.primitives.some(p=>p.material===i)),name+' decal material must be assigned to native geometry');
  references++;
 }
 if(name==='exterior-flight') {
  assert.equal(d.materials[13].name,'SR-71_ext_decals');
  assert.deepEqual(d.meshes.filter(m=>m.primitives.some(p=>p.material===13)).map(m=>m.name),['Object7415','Object7416','Object7427']);
 }
}
console.log(`Verified original USAF atlas SHA-256 and ${references} native LOD0/flight/attachment decal references; no synthetic meshes/materials.`);
