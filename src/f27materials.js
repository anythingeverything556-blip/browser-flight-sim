import { ShaderChunk } from 'three';

// The fixed light pool prevents view/toggle shader recompiles, but a zero RGB
// light still ran distance/cone tests and the PBR BRDF for every panel fragment.
// Skip exactly zero-energy pooled lights. Enabled lights use Three's unchanged
// code, including its shadow/map handling. No light counts or intensities change.
export function gateF27DormantLights(root, enabled) {
  let chunk = ShaderChunk.lights_fragment_begin;
  for (const type of ['point', 'spot']) {
    const assignment = `${type}Light = ${type}Lights[ i ];`;
    const start = chunk.indexOf(assignment), end = chunk.indexOf('\n\t}', start);
    if (start < 0 || end < 0) throw Error('Three punctual-light shader contract changed');
    chunk = chunk.slice(0, end) + '\n\t\t}' + chunk.slice(end);
    chunk = chunk.replace(assignment, assignment + `\n\t\tif ( !uF27GateDarkLights || any( notEqual( ${type}Light.color, vec3( 0.0 ) ) ) ) {`);
  }
  const seen = new Set();
  root.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
    if (!m?.isMeshStandardMaterial || seen.has(m) || m.userData.f27DarkLightGate) continue;
    seen.add(m); m.userData.f27DarkLightGate = true;
    const previous = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = function(shader, renderer) {
      previous.call(this, shader, renderer);
      shader.uniforms.uF27GateDarkLights = enabled;
      shader.fragmentShader = 'uniform bool uF27GateDarkLights;\n' + shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
    };
    const baseKey = key(); m.customProgramCacheKey = () => baseKey + '|f27-dark-lights-v1'; m.needsUpdate = true;
  } });
  return seen.size;
}
