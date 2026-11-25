import * as THREE from 'three';

// NUM_SPOT_LIGHTS/NUM_POINT_LIGHTS are shader defines. Keep seven proxies
// outside the two mutually hidden models; switch intensity, never light count.
export const F27_LIGHT_BUDGET = Object.freeze({ spots: 5, points: 2 });
export function createF27LightRig(scene) {
  const root = new THREE.Group(); root.name = 'F27 fixed light budget'; scene.add(root);
  const spots = Array.from({ length: F27_LIGHT_BUDGET.spots }, (_, i) => {
    const light = new THREE.SpotLight(0xffffff, 0);
    light.name = `F27 pooled spot ${i}`; light.castShadow = false;
    root.add(light, light.target); return light;
  });
  const points = Array.from({ length: F27_LIGHT_BUDGET.points }, (_, i) => {
    const light = new THREE.PointLight(0xffffff, 0);
    light.name = `F27 pooled point ${i}`; light.castShadow = false;
    root.add(light); return light;
  });
  const attached = new Map();
  function attach(part) {
    if (attached.has(part)) return;
    const sources = part.adapter.lights;
    if (sources.filter(l => l.isSpotLight).length > spots.length || sources.filter(l => l.isPointLight).length > points.length) throw new RangeError('F27 light budget exceeded.');
    attached.set(part, sources.map(light => [light, light.layers.mask]));
    // Keep the adapter's authored/animated anchors for terrain beams/emissives.
    // Its visible/intensity writes still work, but source lights never render.
    sources.forEach(light => { light.layers.mask = 0; });
  }
  function update(part, enabled = true) {
    if (part) attach(part);
    spots.forEach(l => { l.intensity = 0; }); points.forEach(l => { l.intensity = 0; });
    if (!part || !enabled) return;
    let si = 0, pi = 0;
    for (const source of part.adapter.lights) {
      const light = source.isSpotLight ? spots[si++] : source.isPointLight ? points[pi++] : null;
      if (!light) continue;
      source.getWorldPosition(light.position);
      light.color.copy(source.color); light.distance = source.distance; light.decay = source.decay;
      light.intensity = source.visible ? source.intensity : 0;
      if (source.isSpotLight) {
        source.target.getWorldPosition(light.target.position);
        light.angle = source.angle; light.penumbra = source.penumbra;
      }
    }
    // This identity root lives in scene coordinates, outside model visibility.
    root.updateMatrixWorld(true);
  }
  return { root, spots, points, attach, update,
    dispose() {
      attached.forEach(sources => sources.forEach(([light, mask]) => { light.layers.mask = mask; }));
      attached.clear(); [...spots, ...points].forEach(l => l.dispose()); root.removeFromParent();
    },
  };
}

/** Prepare before publishing a part as ready, after attaching its fixed rig.
 * Uses actual scene environment/fog/lights; does not expose the hidden cockpit.
 */
export async function prepareF27Part(renderer, part, scene, camera, { envMap = scene.environment, textureBatch = 4 } = {}) {
  const textures = new Set();
  part.root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      if (material.isMeshStandardMaterial) {
        if (material.envMap !== envMap) { material.envMap = envMap; material.needsUpdate = true; }
        material.envMapIntensity = 0.65;
      }
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  const yieldFrame = () => new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(resolve) : setTimeout(resolve, 0));
  let n = 0;
  for (const texture of textures) {
    renderer.initTexture(texture);
    if (++n % Math.max(1, textureBatch) === 0) await yieldFrame();
  }
  // Three compile traverses all meshes even with root.visible=false.
  await renderer.compileAsync(part.root, camera, scene);
  return part;
}
