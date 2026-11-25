import assert from 'node:assert/strict';
import { warmTextures } from '../src/warmup.js';
const raf=new Map(); let requests=0;
globalThis.requestAnimationFrame=fn=>{raf.set(++requests,fn);return requests;};
globalThis.cancelAnimationFrame=id=>raf.delete(id);
const uploads=[];
const r={initTexture:texture=>uploads.push(texture)};
await warmTextures(r,[1,2,3],5,true); // deliberately no frame callbacks: timer must complete the upload
assert.deepEqual(uploads,[1,2,3]); assert.equal(raf.size,0);
const p=warmTextures(r,[4,5],5,true);
for (const fn of [...raf.values()]) fn();
await p;
await new Promise(resolve=>setTimeout(resolve,100)); // raced timer must not duplicate any upload
assert.deepEqual(uploads,[1,2,3,4,5]); assert.equal(raf.size,0);
console.log('PASS F27 texture staging makes progress when RAF is blocked and uploads each texture once');
