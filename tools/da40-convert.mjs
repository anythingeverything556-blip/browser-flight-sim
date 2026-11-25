import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { airframeSurfaces, restoreAirframeNormals } from './da40-normals.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] || join(project, '.scratch/da40/source'));
const scratch = resolve(project, '.scratch/da40');
const output = resolve(project, 'public/models/da40');
const dependencies = resolve(project, 'tools/da40-tooling/package.json');
const requireTools = createRequire(dependencies);
const assimp = requireTools('assimpjs');
const sharp = requireTools('sharp');
const { NodeIO, Document } = requireTools('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTTextureWebP } = requireTools('@gltf-transform/extensions');
const { mergeDocuments, draco, prune } = requireTools('@gltf-transform/functions');
const draco3d = requireTools('draco3dgltf');

await mkdir(scratch, { recursive: true });
await mkdir(output, { recursive: true });
execFileSync('python3', [join(project, 'tools/da40-scene.py'), source, join(scratch, 'scene.json')], { stdio: 'inherit' });
const data = JSON.parse(await readFile(join(scratch, 'scene.json'), 'utf8'));
const ass = await assimp();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const document = new Document();
document.createExtension(EXTTextureWebP).setRequired(true);
const scene = document.createScene('Diamond DA40 NG G1000');
document.getRoot().setDefaultScene(scene);
const orientation = document.createNode('DA40-axis-conversion').setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]);
scene.addChild(orientation);
const templates = new Map();
const textureCache = new Map();
const materialCache = new Map();
const wrappers = new Map();
const transforms = new Map();
const failures = [];
const textureBindings = [];
const instanceNodeNames = new Map();
const losslessTextures = new Set([
  'Models/DA40NG.png',
  'Models/Interior/interior-placards.png',
  'Models/Interior/Panel/panel_placards.png',
  'Models/Interior/Panel/Instruments/FG1000/Textures/GDU-1044B.png',
  'Aircraft/Instruments-3d/FG1000/GDU104X/Textures/GDU-104X.png',
]);

function vectorToGltf(vector) {
  return new THREE.Vector3(vector[0], vector[2], -vector[1]);
}

function pose(offsets) {
  const radians = Math.PI / 180;
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (offsets['heading-deg'] || 0) * radians);
  const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), (offsets['pitch-deg'] || 0) * radians);
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (offsets['roll-deg'] || 0) * radians);
  return { translation: vectorToGltf([offsets['x-m'] || 0, offsets['y-m'] || 0, offsets['z-m'] || 0]),
    rotation: heading.multiply(pitch).multiply(roll) };
}

function textureNames(ac) {
  const found = new Map();
  for (const chunk of ac.split(/^OBJECT /m).slice(1)) {
    const name = /^name "([^"]+)"/m.exec(chunk)?.[1];
    const texture = /^texture "([^"]+)"/m.exec(chunk)?.[1];
    if (name && texture) {
      if (found.has(name) && found.get(name) !== texture) throw new Error(`Ambiguous AC texture for ${name}`);
      found.set(name, texture);
    }
  }
  return found;
}

async function getTexture(path) {
  if (textureCache.has(path)) return textureCache.get(path);
  const relative = path.slice(source.length + 1).replaceAll('\\', '/');
  const image = await sharp(path).webp(losslessTextures.has(relative) ? { lossless: true, effort: 4 } : { quality: 86, effort: 4 }).toBuffer();
  const metadata = await sharp(path).metadata();
  const statistics = metadata.hasAlpha ? await sharp(path).stats() : null;
  const texture = document.createTexture(relative).setImage(image).setMimeType('image/webp');
  const result = { texture, alpha: !!statistics && statistics.channels.at(-1).min < 255 };
  textureCache.set(path, result);
  return result;
}

async function loadGeometry(instance) {
  const path = join(source, instance.geometry);
  let temporary;
  let names = new Map();
  let surfaces;
  const isGltf = instance.geometry.endsWith('.gltf');
  if (isGltf) {
    temporary = await io.read(path);
  } else {
    const ac = await readFile(path, 'latin1');
    names = textureNames(ac);
    if (instance.geometry === 'Models/da40.ac') surfaces = airframeSurfaces(ac);
    const assets = new ass.FileList();
    assets.AddFile(basename(path), Buffer.from(ac, 'latin1'));
    for (const texture of new Set(names.values())) {
      assets.AddFile(texture, await readFile(resolve(dirname(path), texture)));
    }
    const converted = ass.ConvertFileList(assets, 'glb2');
    if (!converted.IsSuccess() || converted.FileCount() !== 1) throw new Error(`${instance.geometry}: ${converted.GetErrorCode()}`);
    try {
      const glb = new Uint8Array(converted.GetFile(0).GetContent());
      const jsonDocument = io._binaryToJSON(glb);
      for (const image of jsonDocument.json.images || []) {
        if (image.uri) jsonDocument.resources[image.uri] = await readFile(resolve(dirname(path), image.uri));
      }
      temporary = await io.readJSON(jsonDocument);
    } finally {
      converted.delete();
      assets.delete();
    }
  }
  const merged = mergeDocuments(document, temporary);
  const roots = [];
  for (const originalScene of temporary.getRoot().listScenes()) {
    const mergedScene = merged.get(originalScene);
    roots.push(...mergedScene.listChildren());
    mergedScene.dispose();
  }
  const nodes = [];
  function collect(node) {
    nodes.push(node);
    for (const child of node.listChildren()) collect(child);
  }
  for (const node of roots) collect(node);
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (surfaces) restoreAirframeNormals(document, node, surfaces);
    if (!mesh) continue;
    const override = instance.textureOverrides[node.getName()];
    const relative = override || names.get(node.getName());
    if (!relative) continue;
    const imagePath = override ? join(source, override) : resolve(dirname(path), relative);
    let image;
    try { image = await getTexture(imagePath); }
    catch (error) { failures.push({ geometry: instance.geometry, node: node.getName(), texture: relative, error: String(error) }); continue; }
    for (const primitive of mesh.listPrimitives()) {
      const old = primitive.getMaterial();
      if (!old || !primitive.getAttribute('TEXCOORD_0')) {
        failures.push({ geometry: instance.geometry, node: node.getName(), texture: relative, error: 'Missing material or UVs' });
        continue;
      }
      const key = `${old.getName()}\0${imagePath}\0${old.getAlphaMode()}\0${old.getBaseColorFactor().join(',')}`;
      let material = materialCache.get(key);
      if (!material) {
        material = old.clone().setBaseColorTexture(image.texture);
        if (image.alpha && material.getAlphaMode() === 'OPAQUE') material.setAlphaMode('BLEND');
        materialCache.set(key, material);
      }
      primitive.setMaterial(material);
      textureBindings.push({ geometry: instance.geometry, node: node.getName(), texture: imagePath.slice(source.length + 1) });
    }
  }
  if (isGltf) {
    const conversion = document.createNode('fgdata-gltf-to-ac-basis').setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    for (const node of roots) conversion.addChild(node);
    return [conversion];
  }
  return roots;
}

function cloneNode(node) {
  const copy = document.createNode(node.getName()).setTranslation(node.getTranslation())
    .setRotation(node.getRotation()).setScale(node.getScale());
  if (node.getMesh()) copy.setMesh(node.getMesh());
  for (const child of node.listChildren()) copy.addChild(cloneNode(child));
  return copy;
}

const worldRotation = new THREE.Quaternion(0, -Math.SQRT1_2, 0, Math.SQRT1_2);
for (const instance of data.instances) {
  const local = pose(instance.offsets);
  const wrapper = document.createNode(instance.id).setTranslation(local.translation.toArray()).setRotation(local.rotation.toArray());
  (wrappers.get(instance.parent) || orientation).addChild(wrapper);
  wrappers.set(instance.id, wrapper);
  const parentMatrix = transforms.get(instance.parent) || new THREE.Matrix4().makeRotationFromQuaternion(worldRotation);
  transforms.set(instance.id, parentMatrix.clone().multiply(new THREE.Matrix4().compose(local.translation, local.rotation, new THREE.Vector3(1, 1, 1))));
  if (!instance.geometry) continue;
  const cacheKey = `${instance.geometry}\0${JSON.stringify(instance.textureOverrides)}`;
  let template = templates.get(cacheKey);
  if (!template) {
    template = await loadGeometry(instance);
    templates.set(cacheKey, template);
    for (const node of template) wrapper.addChild(node);
  } else {
    for (const node of template) wrapper.addChild(cloneNode(node));
  }
  const names = [];
  const visit = node => { names.push(node.getName()); for (const child of node.listChildren()) visit(child); };
  for (const node of wrapper.listChildren()) visit(node);
  instanceNodeNames.set(instance.id, names);
}

function numeric(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function point(data, suffix = '-m') { return ['x', 'y', 'z'].map(axis => numeric(data?.[axis + suffix])); }
function rounded(vector) { return vector.toArray().map(number => Math.round(number * 1e7) / 1e7); }
const rigRules = data.rules.map(rule => {
  const axisData = rule.details.axis || {};
  const first = point(axisData, '1-m');
  const second = point(axisData, '2-m');
  const endpointAxis = ['x1-m', 'y1-m', 'z1-m', 'x2-m', 'y2-m', 'z2-m'].some(key => key in axisData);
  const sourceAxis = endpointAxis ? second.map((number, index) => number - first[index]) : point(axisData, '');
  const center = endpointAxis ? first : point(rule.details.center);
  const matrix = transforms.get(rule.instance);
  const pivot = vectorToGltf(center).applyMatrix4(matrix);
  const axis = vectorToGltf(sourceAxis).transformDirection(matrix);
  const available = [];
  const collectNames = node => { available.push(node.getName()); for (const child of node.listChildren()) collectNames(child); };
  collectNames(wrappers.get(rule.instance));
  return { ...rule, matchingTargets: rule.targets.filter(target => available.includes(target)),
    pivot: rounded(pivot), axis: rounded(axis), unit: rule.type === 'rotate' ? 'degrees' : rule.type === 'spin' ? 'rpm' : 'meters' };
});

const root = document.getRoot();
for (const texture of root.listTextures()) {
  if (texture.getMimeType() === 'image/png' && texture.getImage()) {
    texture.setImage(await sharp(texture.getImage()).webp({ quality: 86, effort: 4 }).toBuffer()).setMimeType('image/webp');
  }
}
const buffer = root.listBuffers()[0];
for (const accessor of root.listAccessors()) accessor.setBuffer(buffer);
for (const extra of root.listBuffers().slice(1)) extra.dispose();
await document.transform(prune(), draco({ method: 'edgebreaker', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14 }));
const binary = await io.writeBinary(document);
await writeFile(join(output, 'da40-ng.glb'), binary);
const rig = { schema: 1, source: 'FlightGear DA40 revision 0d50a457edb203b9ac6058b41cac1b33922acf28',
  coordinates: 'meters; X right, Y up, -Z forward; source (x,y,z) -> (y,z,x)',
  instances: data.instances.map(({ id, parent, xml, geometry, offsets, overlay }) => ({ id, parent, xml, geometry, offsets, overlay })),
  rules: rigRules, unsupported: data.skipped, missing: data.missing };
await writeFile(join(output, 'rig.json'), JSON.stringify(rig));
await copyFile(join(source, 'COPYING'), join(output, 'COPYING'));
await writeFile(join(scratch, 'conversion-report.json'), JSON.stringify({ failures, textureBindings, instances: data.instances,
  missing: data.missing, rules: rigRules, bytes: binary.length }, null, 2));
console.log(`GLB: ${binary.length} bytes, ${root.listMeshes().length} meshes, ${root.listTextures().length} textures, ${textureBindings.length} texture bindings, ${failures.length} binding failures`);
