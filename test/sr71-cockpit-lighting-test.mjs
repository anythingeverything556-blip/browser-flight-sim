import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SR71Cockpit,SR71_COCKPIT_LIGHTS} from '../src/sr71cockpit.js';
import {gateInactiveCockpitSpots} from '../src/sr71cockpitlighting.js';

const originalChunk=THREE.ShaderChunk.lights_fragment_begin;
const root=new THREE.Group(),source=new THREE.MeshStandardMaterial({color:0x777777});
let callbackCount=0;
source.onBeforeCompile=function(shader){callbackCount++;shader.fragmentShader+='\n// original callback';};
source.customProgramCacheKey=()=> 'existing-callback-key';
for(const def of SR71_COCKPIT_LIGHTS)for(const name of def.fixtures){
  const helper=new THREE.Group();helper.name=def.helper||name.replace(/_BULB$/,'')+'_HELPER';root.add(helper);
  const bulb=new THREE.Mesh(new THREE.BoxGeometry(.01,.01,.01),source);bulb.name=name;root.add(bulb);
}
const receiver=new THREE.Mesh(new THREE.PlaneGeometry(),source);root.add(receiver);
const cockpit=new SR71Cockpit({root,clips:new Map()});
assert.equal(cockpit.lamps.length,16);
const originalPlacement=cockpit.lamps.map(l=>({matrix:l.helper.matrix.toArray(),distance:l.light.distance,angle:l.light.angle,penumbra:l.light.penumbra,color:l.light.color.toArray(),target:l.target.position.toArray()}));
const count=()=>{let n=0;root.traverseVisible(o=>{if(o.isSpotLight)n++;});return n;};
assert.equal(count(),16);
for(const def of SR71_COCKPIT_LIGHTS){
  for(const v of [1,.35,0,1,0]){
    cockpit.setLight(def.id,v);
    assert.equal(count(),16);
    for(const lamp of cockpit.lamps){
      assert.equal(lamp.light.intensity,lamp.def.intensity*.002*(lamp.id===def.id?v:0));
      assert.equal(lamp.light.castShadow,false);
    }
    for(const m of cockpit.backlights)assert.equal(m.emissiveIntensity,def.id==='sr71Instruments'?v:0);
  }
}
assert.deepEqual(cockpit.lamps.map(l=>({matrix:l.helper.matrix.toArray(),distance:l.light.distance,angle:l.light.angle,penumbra:l.light.penumbra,color:l.light.color.toArray(),target:l.target.position.toArray()})),originalPlacement);
assert.notEqual(receiver.material,source);
assert.equal(receiver.material.customProgramCacheKey(),'existing-callback-key|sr71-zero-spot-v1');
const shader={fragmentShader:'#include <lights_fragment_begin>'};receiver.material.onBeforeCompile(shader);
assert.equal(callbackCount,1);assert(shader.fragmentShader.endsWith('// original callback'));
const branch=shader.fragmentShader.indexOf('if ( any( notEqual( spotLight.color, vec3( 0.0 ) ) ) )');
assert(branch>0);assert(branch<shader.fragmentShader.indexOf('getSpotLightInfo'));
assert.equal(THREE.ShaderChunk.lights_fragment_begin,originalChunk);
const version=receiver.material.version;gateInactiveCockpitSpots(receiver.material);assert.equal(receiver.material.version,version);
const clone=receiver.material;let disposed=0;clone.addEventListener('dispose',()=>disposed++);
cockpit.dispose();assert.equal(receiver.material,source);assert.equal(disposed,1);assert.equal(count(),0);
assert.equal(source.customProgramCacheKey(),'existing-callback-key');
console.log('PASS fixed 16-emitter count, 9 independent dimmers, exact optics/intensity, owned uniform shader gate, existing callback/key, idempotence, disposal');
