import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireTools = createRequire(resolve(project, 'tools/da40-tooling/package.json'));
const { NodeIO } = requireTools('@gltf-transform/core');
const { ALL_EXTENSIONS } = requireTools('@gltf-transform/extensions');
const draco = requireTools('draco3dgltf');
const directory = resolve(project, 'public/models/da40');
const glb = await readFile(resolve(directory, 'da40-ng.glb'));
const rig = JSON.parse(await readFile(resolve(directory, 'rig.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule() });
const document = await io.readBinary(new Uint8Array(glb));
const root = document.getRoot();
const primitives = root.listMeshes().flatMap(mesh => mesh.listPrimitives());
const triangles = primitives.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() || 0) / 3, 0);
const names = new Set(root.listNodes().map(node => node.getName()));
const extensions = new Set(root.listExtensionsUsed().map(extension => extension.extensionName));

assert(extensions.has('KHR_draco_mesh_compression'));
assert(extensions.has('EXT_texture_webp'));
assert(root.listMeshes().length >= 300 && triangles === 153921, 'the original converted triangle count must not change');
assert(root.listTextures().length >= 15 && root.listTextures().every(texture => texture.getMimeType() === 'image/webp'));
for (const name of ['Models/DA40NG.png', 'Models/Interior/interior-placards.png', 'Models/Interior/Panel/panel_placards.png',
  'Models/Interior/Panel/Instruments/FG1000/Textures/GDU-1044B.png', 'Aircraft/Instruments-3d/FG1000/GDU104X/Textures/GDU-104X.png']) {
  const image = root.listTextures().find(texture => texture.getName() === name)?.getImage();
  assert(image && Buffer.from(image).includes(Buffer.from('VP8L')), `${name} should use lossless WebP`);
}
assert(primitives.filter(primitive => primitive.getMaterial()?.getBaseColorTexture() && primitive.getAttribute('TEXCOORD_0')).length >= 300);
for (const name of ['fuselage', 'aileron.L', 'aileron.R', 'flap.L', 'flap.R', 'elevator', 'rudder', 'prop',
  'wheelF', 'canopy.F', 'door.R', 'floor', 'panel.g1000', 'Screen1', 'Screen2', 'body.mixer']) {
  assert(names.has(name), `Missing authored node ${name}`);
}
for (const name of ['aileron.L', 'aileron.R', 'flap.L', 'flap.R', 'elevator', 'rudder', 'prop', 'wheelF', 'canopy.F', 'door.R']) {
  assert(rig.rules.some(rule => rule.matchingTargets.includes(name) && rule.axis.some(value => value !== 0)), `Missing motion for ${name}`);
}
for (const name of ['fuselage', 'wings', 'spinner', 'canopy.F', 'wheelfairingF', 'aileron.L', 'elevator']) {
  const node = root.listNodes().find(entry => entry.getName() === name);
  assert(node.getMesh().listPrimitives().every(primitive => primitive.getAttribute('NORMAL')), `${name} must retain smooth shading normals`);
}
assert(rig.instances.some(instance => instance.geometry?.includes('GDU-104X.1.gltf')));
assert(rig.instances.some(instance => instance.geometry?.includes('GMA1347.ac')));
assert(!rig.missing.some(item => item.reference.includes('FG1000')));
const screen1 = root.listNodes().find(node => node.getName() === 'Screen1').getWorldMatrix();
const screen2 = root.listNodes().find(node => node.getName() === 'Screen2').getWorldMatrix();
for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
  assert(Math.abs(screen1[index] - screen2[index]) < 0.0001, 'PFD and MFD should face the same direction');
}
assert(Math.abs((screen2[12] - screen1[12]) - 0.34) < 0.002, 'PFD/MFD separation must reflect the XML placements');
assert(Math.abs(screen2[13] - screen1[13]) < 0.002, 'PFD and MFD must have approximately matching heights');
const bytes = glb.length + (await stat(resolve(directory, 'rig.json'))).size;
assert(bytes < 2007968, `Model and rig exceed requested approximate budget: ${bytes}`);
console.log(`DA40 GLB decoded: ${root.listMeshes().length} meshes, ${triangles} triangles, ${root.listTextures().length} textures; GLB + rig ${bytes} bytes.`);
