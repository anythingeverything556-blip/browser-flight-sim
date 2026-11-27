import * as THREE from 'three';

export function makeLegacyCrashFixture(scene, mergeStatic) {
  const root = new THREE.Group(), model = new THREE.Group();
  scene.add(root); root.add(model);
  const material = new THREE.MeshStandardMaterial();
  for (const [name, position, size] of [
    ['SR71_Fuselage', [0, 0, 0], [30, 3, 4]],
    ['SR71_Wing_L', [-2, 0, -5], [12, 1, 7]],
    ['SR71_Wing_R', [-2, 0, 5], [12, 1, 7]],
  ]) {
    const group = new THREE.Group(); group.name = name; group.position.set(...position); model.add(group);
    for (let index = 0; index < 2; index++) {
      const geometry = new THREE.BoxGeometry(...size, 120, 120, 1); geometry.clearGroups(); geometry.deleteAttribute('uv');
      const mesh = new THREE.Mesh(geometry, material); mesh.position.y = index * 0.05; group.add(mesh);
    }
  }
  for (let index = 0; index < 8; index++) {
    const group = new THREE.Group(), mergedMaterial = new THREE.MeshStandardMaterial();
    group.name = `fixture_detail_${index}`; group.position.set(index - 4, 0.5, 0); model.add(group);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mergedMaterial));
    const second = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mergedMaterial);
    second.position.x = 0.3; group.add(second); mergeStatic(group);
  }
  const interior = new THREE.Group(); interior.name = 'fixture_interior';
  interior.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2, 20, 20, 1), material));
  model.add(interior); root.updateMatrixWorld(true);
  return { root, model, real: { interior } };
}
