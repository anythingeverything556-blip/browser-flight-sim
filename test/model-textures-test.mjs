import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const dims=b=>{for(let p=12;p+8<=b.length;){const type=b.toString('ascii',p,p+4),len=b.readUInt32LE(p+4),o=p+8;if(type==='VP8 ')return[b.readUInt16LE(o+6)&0x3fff,b.readUInt16LE(o+8)&0x3fff];if(type==='VP8X')return[1+b.readUIntLE(o+4,3),1+b.readUIntLE(o+7,3)];if(type==='VP8L'){const x=b.readUInt32LE(o+1);return[1+(x&0x3fff),1+((x>>>14)&0x3fff)];}p=o+len+(len%2);}throw Error('No WebP dimensions');};
for(const [name,m] of Object.entries(JSON.parse(fs.readFileSync('test/fixtures/model-texture-budget.json')))){
 const raw=fs.readFileSync(m.model),jl=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+jl)),bin=raw.subarray(28+jl);
 assert.equal(hash(raw),m.resultSha256,`${name} reviewed asset hash`);
 for(const g of m.geometry){const v=j.bufferViews[g.view],b=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);assert.equal(hash(b),g.sha256,`${name} geometry ${g.view} unchanged`);}
 const triangles=j.meshes.reduce((s,x)=>s+x.primitives.reduce((n,p)=>n+(p.indices==null?0:j.accessors[p.indices].count/3),0),0);assert.equal(triangles,m.triangles);
 for(let i=0;i<j.images.length;i++){const im=j.images[i],v=j.bufferViews[im.bufferView],t=m.textures[i];assert.deepEqual(dims(bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)),t.after);}
 const semantics={...j};delete semantics.buffers;delete semantics.bufferViews;assert.equal(hash(JSON.stringify(stable(semantics))),m.jsSemanticSha256,`${name} names, pivots, parents, extras, materials, accessors and scenes unchanged`);
 console.log(`${name}: ${triangles} tris unchanged; ${m.identicalNonImageBufferViews} geometry views preserved; estimated RGBA+mips ${(m.estimatedTextureRGBAWithMipsBefore/2**20).toFixed(1)} → ${(m.estimatedTextureRGBAWithMipsAfter/2**20).toFixed(1)} MiB (not measured VRAM)`);
}
