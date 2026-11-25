import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Static opaque structure only. Keep every source object for native bindings and
// diagnostics; never combine transparent sort order, needles, lamps or controls.
export function batchF27Cockpit(root, animations = []) {
  const animated = new Set(animations.flatMap(c => c.tracks.map(t => THREE.PropertyBinding.parseTrackName(t.name).nodeName)));
  const groups = new Map(), inverse = root.matrixWorld.clone().invert();
  root.updateMatrixWorld(true); inverse.copy(root.matrixWorld).invert();
  root.traverse(o => {
    const m = o.material, g = o.geometry;
    if (!o.isMesh || o.isSkinnedMesh || o.children.length || !g || !m || Array.isArray(m) || m.transparent || m.visible === false || g.morphAttributes.position?.length) return;
    for (let p = o; p && p !== root; p = p.parent) {
      if (!p.visible || animated.has(p.name) || animated.has(p.uuid) || /Warn|GearInd|LIGHT_|Yoke|Propeller|PROPELLER/i.test(p.name)) return;
    }
    // Baking a reflection would reverse front-face winding; leave it live.
    if (o.matrixWorld.determinant() <= 0) return;
    if (g.groups.length || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return;
    const key = [m.uuid, o.castShadow, o.receiveShadow, o.renderOrder, Object.keys(g.attributes).sort().map(k => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized}`).join(',')].join('|');
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
  });
  const batches = [], sources = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const copies = list.map(o => o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
    const geometry = mergeGeometries(copies, false); copies.forEach(g => g.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const first = list[0], mesh = new THREE.Mesh(geometry, first.material);
    mesh.name = `F27 static batch:${first.material.name}`;
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
    mesh.userData.f27StaticBatch = true; mesh.matrixAutoUpdate = false;
    root.add(mesh); batches.push(mesh);
    for (const o of list) { o.visible = false; sources.push(o); }
  }
  return { batches, sources, savedSubmissions: sources.length - batches.length };
}
