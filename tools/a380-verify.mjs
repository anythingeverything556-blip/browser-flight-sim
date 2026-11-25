import {readFile,writeFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
globalThis.self=globalThis;
globalThis.ProgressEvent=class ProgressEvent {constructor(type,options){Object.assign(this,options);this.type=type;}};
const base=process.argv[2]||'http://127.0.0.1:5180/models/a380x/';
const dir=path.resolve('public/models/a380x');
const manager=new THREE.LoadingManager();
manager.addHandler(/\.(png|dds)$/i,{load(url,onLoad){const t=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);t.needsUpdate=true;queueMicrotask(()=>onLoad(t));return t;}});
const results=[];
for(const name of ['a380_exterior','a380_cockpit']){
 const gltf=await new GLTFLoader(manager).loadAsync(base+name+'.native.gltf');
 gltf.scene.updateMatrixWorld(true);
 let mesh=0,triangles=0,skinned=0,bad=0;const box=new THREE.Box3();const point=new THREE.Vector3();
 const landmarks=[];
 gltf.scene.traverse(o=>{
  if(o.isMesh){mesh++;if(o.isSkinnedMesh)skinned++;const g=o.geometry;triangles+=(g.index?.count||g.attributes.position.count)/3;
   g.computeBoundingBox();box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
   for(const [key,a] of Object.entries(g.attributes)){if(key==='normal'&&a.itemSize!==3||key==='skinWeight'&&a.itemSize!==4)bad++;
    if(!Number.isFinite(a.getX(0)))bad++;}
  }
  if(/SEAT_CPT_MOVE_FWD_AFT$|LEVER_LANDINGGEAR$|PUSH_FCU_SPDMACH$|PFD|MFD|SUITE|YC_|BC_/.test(o.userData?.name||o.name)&&landmarks.length<35){o.getWorldPosition(point);landmarks.push({name:o.name,position:point.toArray()});}
 });
 results.push({name,mesh,triangles,skinned,bad,animations:gltf.animations.length,bounds:{min:box.min.toArray(),max:box.max.toArray()},landmarks,textureVerification:'placeholder textures for geometry parse only; browser separately'});
 gltf.scene.traverse(o=>o.geometry?.dispose());
 if(bad)throw new Error(name+' invalid geometry');
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(path.join(dir,'geometry-verification.json'),JSON.stringify({status:'pass',loader:'three GLTFLoader r180',models:results},null,2));
