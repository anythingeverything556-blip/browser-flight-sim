import {ShaderChunk} from 'three';

// Three r180 still evaluates RE_Direct for zero-intensity spots. Keeping a
// fixed 16-emitter rig without a uniform branch would run that BRDF even off.
// Patch only owned cockpit materials, not the shared Three shader registry.
const start='\t\tspotLight = spotLights[ i ];';
const end='\n\t}\n\t#pragma unroll_loop_end';
const chunk=ShaderChunk.lights_fragment_begin;
const spotStart=chunk.indexOf(start);
const spotEnd=chunk.indexOf(end,spotStart);
if(spotStart<0||spotEnd<0)throw new Error('SR-71 cockpit light gate needs the supported Three spotlight chunk');
const gated=chunk.slice(0,spotStart)+chunk.slice(spotStart,spotEnd).replace(start,start+'\n\t\tif ( any( notEqual( spotLight.color, vec3( 0.0 ) ) ) ) {')+'\n\t\t}'+chunk.slice(spotEnd);
const installed=new WeakSet();
export function gateInactiveCockpitSpots(material){
  if(installed.has(material))return;
  installed.add(material);
  const previousCompile=material.onBeforeCompile;
  const previousKey=material.customProgramCacheKey;
  // Evaluate the old key while the old callback is still installed (Three's
  // default key calls this.onBeforeCompile.toString()). Switch state is never
  // part of the key: the enabled mask comes from light color uniforms only.
  const key=previousKey.call(material);
  material.onBeforeCompile=function(shader,renderer){
    previousCompile.call(this,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',gated);
  };
  material.customProgramCacheKey=()=>key+'|sr71-zero-spot-v1';
  material.needsUpdate=true;
}
