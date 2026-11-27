import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decompress } from '../src/vendor/fzstd.mjs';
import { SR71_COCKPIT_CLIPS } from '../src/sr71cockpit.js';

const game = new URL('../', import.meta.url);
const assets = new URL('public/models/sr71/', game);
const evidence = await readFile(new URL('asset-build/flight-source-proof.json', game)).then(() => new URL('asset-build/', game), () => new URL('../asset-build/', game));
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const exterior = new URL('exterior/', assets), cockpit = new URL('cockpit/', assets);
const [flightProof, cockpitProof, mipProof, ext, vc] = await Promise.all([
  json(new URL('flight-source-proof.json', evidence)), json(new URL('cockpit-subset-proof.json', evidence)),
  json(new URL('cockpit-mip-proof.json', evidence)), json(new URL('manifest.json', exterior)), json(new URL('manifest.json', cockpit)),
]);
const leaf = (url, name) => new URL(name.replace(/^\/data\//, ''), url);
async function checkedEntry(parent, entry, checks) {
  const doc = await json(leaf(parent, entry.path));
  const buffers = await Promise.all(doc.buffers.map(async b=>{
    const def=entry.resources[b.uri];
    const packed=Buffer.concat(await Promise.all(def.parts.map(p=>readFile(leaf(parent,p)))));
    const raw=def.encoding==='zstd'?decompress(packed):packed;
    assert.equal(raw.length,b.byteLength);
    return raw;
  }));
  for(const check of checks){
    const acc=doc.accessors[check.outputAccessor],view=doc.bufferViews[acc.bufferView];
    assert.equal(view.byteLength,check.bytes);
    const offset=view.byteOffset||0;
    assert.equal(sha(buffers[view.buffer].subarray(offset,offset+view.byteLength)),check.sha256);
  }
  for (const im of doc.images || []) assert((await readFile(leaf(parent, im.uri))).length > 0);
  return doc;
}
assert.deepEqual(ext.models.exterior.map(x=>x.sourceLOD),[2,1,2,2,2]);
assert.equal(ext.models.highDetailExterior.length,5);
for(const proof of flightProof.models){
  const entry=ext.models.exterior.find(x=>x.path.endsWith(proof.label+'.gltf'));
  const doc=await checkedEntry(exterior,entry,proof.animationChecks);
  if(entry.path.includes('gear')) assert(doc.animations.some(a=>/GEAR_.+_Tire/.test(a.name)));
  assert(!doc.nodes.some(n=>n.name==='Ground_Equipment_Animation'));
}
for(const f of flightProof.files) assert.equal(sha(await readFile(leaf(exterior,f.path))),f.sha256);
const part=await checkedEntry(cockpit,vc.models.interior.find(x=>!x.optional),cockpitProof.accessorChecks);
assert.equal(part.animations.length,12+SR71_COCKPIT_CLIPS.size);
for (const name of SR71_COCKPIT_CLIPS) assert(part.animations.some(clip=>clip.name===name),name+' must retain its source animation');
assert(part.animations.some(a=>a.name==='ENGINE_LEVER_THROTTLE_2'));
assert(part.nodes.some(n=>n.name==='ENVIRONMENT_OCCLUDER'&&n.mesh===undefined));
assert.equal(sha(await readFile(new URL('cockpit.gltf',cockpit))),cockpitProof.sourceGltfSha256);
assert.equal(mipProof.textures.length,31);
for(const m of mipProof.textures){
  const image=part.images.find(i=>i.uri==='textures/flight-mips/'+m.source.split('/').at(-1).toLowerCase().replace(/\.png\.ktx2$/,'.webp'));
  assert(image,m.source);
  assert.equal(sha(await readFile(leaf(cockpit,image.uri))),m.sha256);
}
const walt=await json(new URL('walt.gltf',cockpit));
assert(!walt.images.some(i=>/placard/i.test(i.uri)));
console.log('Verified authored exterior LOD assets, compact LOD0 cockpit source bytes, authored mips and WALT debranding');
