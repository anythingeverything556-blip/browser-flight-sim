import * as T from 'three';
import {loadModel} from './_glb-node.mjs';
const g=await loadModel('f27/f27-white-vc-v2'),v=new T.Vector3(),models=[];
g.scene.updateMatrixWorld(true);g.scene.traverse(o=>{
 if(!o.isMesh||!o.material||o.material.transparent)return;
 o.geometry.computeBoundingBox();o.geometry.boundingBox.getSize(v).multiply(o.getWorldScale(new T.Vector3()).abs?.()||o.getWorldScale(new T.Vector3()));
 const [a,b,c]=[...v].map(Math.abs).sort((x,y)=>y-x);models.push({name:o.name,area:a*b,span:a});
});
for(const m of [.02,.035,.05,.08,.10,.13,.17,.22,.30])console.log(m,models.filter(o=>o.area>=m&&o.span>.25).length);
console.log(models.sort((a,b)=>b.area-a.area).slice(0,105).map(x=>x.name+':'+x.area.toFixed(2)).join('\n'));
