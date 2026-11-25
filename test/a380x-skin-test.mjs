import assert from 'node:assert/strict';
import * as T from 'three';
import { decodeA380SkinPalettes } from '../src/a380xskin.js';
function mesh(ids) {
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0],3));
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0],4));g.setIndex([0,1,0]);
 const m=new T.SkinnedMesh(g,new T.MeshBasicMaterial()),a=new T.Bone(),b=new T.Bone();m.add(a,b);m.bind(new T.Skeleton([a,b]));return m;
}
const original=mesh([1,0,0,0,2,0,0,0]),source=original.geometry,sourceIds=Array.from(source.attributes.skinIndex.array);
assert.throws(()=>original.computeBoundingSphere(),/matrixWorld/);
assert.equal(decodeA380SkinPalettes(original),1);assert.deepEqual(Array.from(source.attributes.skinIndex.array),sourceIds,'source bytes unchanged');
original.skeleton.bones[1].position.x=3;original.updateMatrixWorld(true);original.computeBoundingSphere();assert.ok(original.boundingSphere.containsPoint(new T.Vector3(4,0,0)),'actual second bone deforms originally drawn vertex');
assert.deepEqual(Array.from(original.geometry.index.array),Array.from(source.index.array));assert.deepEqual(Array.from(original.geometry.attributes.position.array),Array.from(source.attributes.position.array));
const standard=mesh([0,0,0,0,1,0,0,0]),same=standard.geometry;assert.equal(decodeA380SkinPalettes(standard),0);assert.equal(standard.geometry,same);
assert.throws(()=>decodeA380SkinPalettes(mesh([0,0,0,0,2,0,0,0])),/Unsupported/,'ambiguous invalid skin must not be hidden or silently clamped');
console.log('A380 source one-based palette decode: original crash reproduced, animated bounds repaired, source bytes preserved, zero-based untouched, invalid mixed palettes rejected');
