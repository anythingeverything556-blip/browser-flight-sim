import * as THREE from 'three';
import { terrainMaterial, TERRAIN_UNIFORMS as U } from './terrain-shader.js';

// A single camera-relative terrain inset for the active F27 runway. Use the
// same shader as the scenery, so aircraft light beams, ground shadows, haze
// and depth all follow the existing terrain path.
export class F27RunwayInset {
  constructor(scene, terrain, geo) {
    this.terrain=terrain; this.geo=geo;
    const material=terrainMaterial();
    material.defines.F27_RUNWAY_PATCH='';
    material.uniforms.uTint.value.copy(terrain.fallbackColor);
    this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);
    this.mesh.name='F27 collision-aligned runway'; this.mesh.visible=false; this.mesh.frustumCulled=false;
    scene.add(this.mesh);
  }
  fit(runway, center) {
    const length=runway.len/2, width=runway.width/2;
    const rows=[-width-190,-width-120,-width-65,-width-30,-width,0,width,width+30,width+65,width+120,width+190];
    const n=Math.max(2,Math.ceil(runway.len/35)), cols=[-length-240,-length-150,-length-80];
    for(let i=0;i<=n;i++)cols.push(-length+runway.len*i/n);
    cols.push(length+80,length+150,length+240);
    const positions=[],uv=[],indices=[];
    for(let j=0;j<rows.length;j++)for(let i=0;i<cols.length;i++){
      const {lat,lon}=runway.pointAlong(cols[i],rows[j]), p=this.geo.toXZ(lat,lon);
      // AirportDB collision height and published longitudinal slope are shared.
      const height=this.terrain.heightAt(lat,lon)??runway.surfaceAt(cols[i]);
      positions.push(p.x-center.x,height,p.z-center.z); uv.push(i/(cols.length-1),j/(rows.length-1));
      if(i+1<cols.length&&j+1<rows.length){const k=j*cols.length+i;indices.push(k,k+cols.length,k+1,k+1,k+cols.length,k+cols.length+1);}
    }
    const geom=new THREE.BufferGeometry();
    geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geom.setIndex(indices);geom.computeVertexNormals();
    if(geom.attributes.normal.getY(0)<0){
      for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
      geom.setIndex(indices);geom.computeVertexNormals();
    }
    this.mesh.geometry.dispose();this.mesh.geometry=geom;
    this.mesh.material.uniforms.uTile.value.set(0,0,Math.max(runway.len,400),0);
    this.runway=runway;this.geoVersion=this.geo.version;this.demEpoch=this.terrain.demEpoch;this.fitAt=performance.now();
    U.uF27PatchArea.value.set(length+65,width+25,length+239,width+189);
  }
  update(runway,cameraWorld,blend) {
    const show=!!runway&&blend>0.001;
    this.mesh.visible=show;
    if(!show)return;
    const c=this.geo.toXZ(runway.lat,runway.lon);
    if(this.runway!==runway||this.geoVersion!==this.geo.version||(this.demEpoch!==this.terrain.demEpoch&&performance.now()-this.fitAt>1000))this.fit(runway,c);
    this.mesh.position.set(c.x-cameraWorld.x,-cameraWorld.y,c.z-cameraWorld.z);
  }
}
