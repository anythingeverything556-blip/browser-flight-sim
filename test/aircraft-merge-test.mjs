// Legacy AircraftVisual merging and LOD shadow proxies, using explicit synthetic rigs.
// The current SR-71 uses SR71Visual rather than this retired visual pipeline.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual, mergeStatic } = await load('/src/aircraft.js');

{
  const mat = new THREE.MeshStandardMaterial(), other = new THREE.MeshStandardMaterial(), root = new THREE.Group(), arm = new THREE.Group();
  const box = (x, material, parent) => { const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material); object.position.set(x, 0, 0); parent.add(object); return object; };
  const first = box(0, mat, root), second = box(5, mat, root), third = box(9, other, root), fourth = box(1, mat, arm), fifth = box(2, mat, arm), skipped = box(7, mat, root);
  root.add(arm); root.rotation.y = 0.3; root.position.set(3, 0, 0); arm.rotation.z = 0.5; first.userData.thr = true;
  root.updateMatrixWorld(true);
  const want = new THREE.Box3(); for (const object of [second, fourth, fifth]) want.union(new THREE.Box3().setFromObject(object));
  const result = mergeStatic(root, { skip: (object) => object === skipped });
  assert.equal(result.merged.length, 1); assert.equal(result.merged[0].userData.mergedParts.length, 3);
  const meshes = []; root.traverse((object) => { if (object.isMesh) meshes.push(object); });
  assert.deepEqual([first, third, skipped].map((object) => meshes.includes(object)), [true, true, true]);
  assert.ok(!meshes.includes(second) && !meshes.includes(fourth) && !meshes.includes(fifth));
  const merged = result.merged[0], got = new THREE.Box3().setFromObject(merged);
  assert.ok(merged.parent === root && merged.matrix.equals(new THREE.Matrix4()));
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(got.min[axis] - want.min[axis]) < 1e-5 && Math.abs(got.max[axis] - want.max[axis]) < 1e-5, `baked extent ${axis}`);
  assert.equal(merged.geometry.attributes.position.count, 3 * 24);
  assert.deepEqual(merged.userData.mergedParts.map((part) => part.geometry), [second.geometry, fourth.geometry, fifth.geometry]);
  console.log('PASS synthetic merge, baked transforms, exclusions and retained breakup parts:', result.before, '->', result.after, 'draws');
}

{
  const scene = new THREE.Scene(), visual = new AircraftVisual(scene), model = new THREE.Group(), lod = new THREE.Group();
  visual.root.add(model); visual.model = model; visual.casters = []; visual.casterMat = new THREE.MeshBasicMaterial({ colorWrite:false }); visual.castsWorldShadow = true;
  for (const [name, position, size] of [
    ['SR71_Fuselage', [2, 0, 0], [30, 3, 4]],
    ['SR71_Wing_L', [-2, 0, -5], [12, 1, 7]],
    ['SR71_Wing_R', [-2, 0, 5], [12, 1, 7]],
  ]) {
    const highGroup = new THREE.Group(), lowGroup = new THREE.Group(); highGroup.name = lowGroup.name = name;
    highGroup.position.set(...position); lowGroup.position.set(...position); model.add(highGroup); lod.add(lowGroup);
    const high = new THREE.Mesh(new THREE.BoxGeometry(...size, 20, 20, 4), new THREE.MeshStandardMaterial());
    const low = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
    high.castShadow = true; high.userData.casterMat = visual.casterMat; high.layers.enable(3); highGroup.add(high); lowGroup.add(low); visual.casters.push(high);
  }
  visual.root.updateMatrixWorld(true); lod.updateMatrixWorld(true); visual.attachLod(model, lod);
  const proxy = visual.proxy, sun = new THREE.DirectionalLight(); scene.add(sun);
  assert.equal(visual.lodPairs.length, 3); assert.equal(proxy.sun.length, 1); assert.equal(proxy.cascade.length, 1);
  assert.ok(proxy.sun.every((object) => !object.castShadow && !object.material.visible));
  assert.equal(proxy.cascade[0].layers.mask, 0);
  const highTris = visual.lodPairs.reduce((count, [high]) => count + high.geometry.index.count / 3, 0);
  const proxyTris = proxy.sun[0].geometry.index.count / 3;
  assert.ok(proxyTris < highTris * 0.25, `synthetic LOD reduces shadow triangles ${highTris} -> ${proxyTris}`);
  const bounds = proxy.sun[0].geometry.boundingBox;
  assert.ok(bounds.min.x < -10 && bounds.max.x > 15 && bounds.min.z < -6 && bounds.max.z > 6, 'proxy spans the airframe');
  assert.equal(visual.attachSelfShadow(sun), true);
  assert.ok(proxy.sun[0].castShadow && visual.lodPairs.every(([high]) => !high.castShadow));
  assert.ok((proxy.cascade[0].layers.mask & (1 << 3)) !== 0);
  assert.equal(proxy.sunMat.visible, false); sun.shadow.updateMatrices(sun); assert.equal(proxy.sunMat.visible, true);
  scene.onAfterRender({}, scene, null); assert.equal(proxy.sunMat.visible, false);
  visual.setShadowProxy(false);
  assert.ok(!proxy.sun[0].castShadow && visual.lodPairs.every(([high]) => high.castShadow));
  assert.equal(proxy.cascade[0].layers.mask, 0);
  assert.equal(visual.setShadowProxy(true, sun), true);
  console.log(`PASS synthetic shadow proxy: ${highTris} -> ${proxyTris} triangles; hooks, bounds and switch`);
}

console.log('aircraft-merge-test ok (legacy synthetic fixtures)');
await vite.close(); process.exit(0);
