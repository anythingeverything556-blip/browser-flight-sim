#!/usr/bin/env node
/** Exact source-graph partitioning. No geometry/texture rewriting and no binary copies.
 * Usage: node tools/a380-partition.mjs [public/models/a380x] [output-directory]
 * Output is opt-in: original entrypoints remain unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const copy = value => structuredClone(value);
const ids = set => [...set].sort((a, b) => a - b);
function textureRefs(value, visit, includeExtras = true) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith('Texture') && item && Number.isInteger(item.index)) visit(item);
    else if (includeExtras || key !== 'extras') textureRefs(item, visit, includeExtras);
  }
}

// Select complete source meshes, not reduced substitutes. Cabin membership comes
// from the original A380_CABIN subtree and the original cabin material names.
// Source flight-deck bulkhead/door and shared front galley remain in BOTH views.
export function selectA380Views(g) {
  const cabinRoot = g.nodes.findIndex(n => n.name === 'A380_CABIN');
  if (cabinRoot < 0) throw new Error('Original A380_CABIN source root not found');
  const cabinBranch = new Set();
  const descend = i => { if (cabinBranch.has(i)) return; cabinBranch.add(i); for (const j of g.nodes[i].children || []) descend(j); };
  descend(cabinRoot);
  const cockpit = new Set(), cabin = new Set(), shared = new Set();
  const isCabinMaterial = name => /^A380X_/.test(name) && !/COCKPIT|REGISTRATION/.test(name);
  g.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const names = g.meshes[n.mesh].primitives.map(p => g.materials[p.material]?.name || '');
    const sharedMaterial = names.some(s => /^A380X_MAIN_DECK_(ASSETS|PEC_SIDEWALLS)$/.test(s));
    const bulkhead = names.some(s => /^A380_COCKPIT_(BACKWALL|AFT_MISC)/.test(s));
    if (sharedMaterial || bulkhead) { cockpit.add(i); cabin.add(i); shared.add(i); }
    else if (cabinBranch.has(i) || names.every(isCabinMaterial) || /^(?:CARPET_|PEC\.CARPET|NTF_M|BAR\.)/.test(n.name || '')) cabin.add(i);
    else cockpit.add(i);
  });
  return { cockpit, cabin, shared, cabinRoot };
}

export function partitionGltf(source, selected, { uriPrefix = '' } = {}) {
  if (source.extensionsUsed?.length || source.extensionsRequired?.length) throw new Error('Partitioner requires the audited extension-free converted glTF');
  const g = copy(source), keep = Object.fromEntries(['meshes', 'skins', 'accessors', 'bufferViews', 'materials', 'textures', 'images', 'samplers', 'buffers'].map(k => [k, new Set()]));
  const parents = new Map();
  g.nodes.forEach((n, i) => { for (const j of n.children || []) parents.set(j, i); });
  const activeNodes = new Set(selected);
  const addAncestors = i => { while (parents.has(i)) { i = parents.get(i); activeNodes.add(i); } };
  for (const i of selected) {
    const n = g.nodes[i]; if (!n || n.mesh === undefined) throw new Error(`Not a source mesh node: ${i}`);
    keep.meshes.add(n.mesh); addAncestors(i);
    if (n.skin !== undefined) keep.skins.add(n.skin);
  }
  for (const i of keep.skins) {
    const s = g.skins[i];
    for (const j of s.joints) { activeNodes.add(j); addAncestors(j); }
    if (s.skeleton >= 0) { activeNodes.add(s.skeleton); addAncestors(s.skeleton); }
    if (s.inverseBindMatrices !== undefined) keep.accessors.add(s.inverseBindMatrices);
  }
  // Preserve every node and transform (including non-rendered skeleton parents).
  // Only mesh attachments are partitioned. This keeps original node IDs stable,
  // animation targets exact and cross-subtree skin ancestry intact.
  g.nodes.forEach((n, i) => { if (!selected.has(i)) { delete n.mesh; delete n.skin; } });
  for (const i of keep.meshes) for (const p of g.meshes[i].primitives) {
    for (const a of Object.values(p.attributes || {})) keep.accessors.add(a);
    if (p.indices !== undefined) keep.accessors.add(p.indices);
    if (p.material !== undefined) keep.materials.add(p.material);
    for (const t of p.targets || []) for (const a of Object.values(t)) keep.accessors.add(a);
  }
  g.animations = (g.animations || []).flatMap(a => {
    a.channels = a.channels.filter(c => activeNodes.has(c.target.node));
    if (!a.channels.length) return [];
    const used = ids(new Set(a.channels.map(c => c.sampler))), remap = new Map(used.map((id, i) => [id, i]));
    a.samplers = used.map(i => a.samplers[i]);
    for (const c of a.channels) c.sampler = remap.get(c.sampler);
    for (const s of a.samplers) { keep.accessors.add(s.input); keep.accessors.add(s.output); }
    return [a];
  });
  for (const i of keep.materials) textureRefs(g.materials[i], t => keep.textures.add(t.index));
  for (const i of keep.textures) {
    const t = g.textures[i]; if (t.source !== undefined) keep.images.add(t.source); if (t.sampler !== undefined) keep.samplers.add(t.sampler);
  }
  for (const i of keep.images) if (g.images[i].bufferView !== undefined) keep.bufferViews.add(g.images[i].bufferView);
  for (const i of keep.accessors) {
    const a = g.accessors[i]; if (a.bufferView !== undefined) keep.bufferViews.add(a.bufferView);
    if (a.sparse) { keep.bufferViews.add(a.sparse.indices.bufferView); keep.bufferViews.add(a.sparse.values.bufferView); }
  }
  for (const i of keep.bufferViews) keep.buffers.add(g.bufferViews[i].buffer);
  const map = Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, new Map(ids(v).map((old, i) => [old, i]))]));
  const remap = (o, key, type) => { if (o[key] !== undefined) { const v = map[type].get(o[key]); if (v === undefined) throw new Error(`Missing ${type} dependency ${o[key]}`); o[key] = v; } };
  for (const n of g.nodes) { remap(n, 'mesh', 'meshes'); remap(n, 'skin', 'skins'); }
  for (const i of keep.meshes) for (const p of g.meshes[i].primitives) {
    for (const key of Object.keys(p.attributes)) remap(p.attributes, key, 'accessors');
    remap(p, 'indices', 'accessors'); remap(p, 'material', 'materials');
    for (const t of p.targets || []) for (const key of Object.keys(t)) remap(t, key, 'accessors');
  }
  for (const i of keep.skins) remap(g.skins[i], 'inverseBindMatrices', 'accessors');
  for (const a of g.animations) for (const s of a.samplers) { remap(s, 'input', 'accessors'); remap(s, 'output', 'accessors'); }
  for (const i of keep.materials) textureRefs(g.materials[i], t => remap(t, 'index', 'textures'));
  for (const i of keep.textures) { remap(g.textures[i], 'source', 'images'); remap(g.textures[i], 'sampler', 'samplers'); }
  for (const i of keep.images) remap(g.images[i], 'bufferView', 'bufferViews');
  for (const i of keep.accessors) {
    const a = g.accessors[i]; remap(a, 'bufferView', 'bufferViews');
    if (a.sparse) { remap(a.sparse.indices, 'bufferView', 'bufferViews'); remap(a.sparse.values, 'bufferView', 'bufferViews'); }
  }
  for (const i of keep.bufferViews) remap(g.bufferViews[i], 'buffer', 'buffers');
  for (const [k, list] of Object.entries(keep)) g[k] = ids(list).map(i => g[k][i]);
  for (const x of [...g.buffers, ...g.images]) if (x.uri && !/^(?:data:|https?:)/.test(x.uri)) x.uri = uriPrefix + x.uri;
  return { json: g, sourceIds: Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, ids(v)])), meshNodes: ids(selected) };
}

export function assetCost(g, directory) {
  // GLTFLoader loads standard material slots, not simulator-only source metadata.
  // Preserve/remap metadata textures in the descriptors, but do not incorrectly
  // count their DDS as network requests made by the current renderer.
  const textureIds = new Set(), imageIds = new Set();
  for (const material of g.materials || []) textureRefs(material, t => textureIds.add(t.index), false);
  for (const i of textureIds) if (g.textures[i]?.source !== undefined) imageIds.add(g.textures[i].source);
  const runtimeImages = ids(imageIds).map(i => g.images[i]), files = new Map();
  for (const x of [...g.buffers || [], ...runtimeImages]) if (x.uri && !x.uri.startsWith('data:')) {
    const file = path.resolve(directory, x.uri); files.set(file, fs.statSync(file).size);
  }
  return { geometryBytes: (g.buffers || []).reduce((n, b) => n + b.byteLength, 0), runtimeImages: runtimeImages.length, textureBytes: runtimeImages.reduce((n, x) => n + (x.uri ? fs.statSync(path.resolve(directory, x.uri)).size : 0), 0), uniqueResourceBytes: [...files.values()].reduce((a, b) => a + b, 0), files };
}

export function generate(directory, output) {
  directory = path.resolve(directory); output = path.resolve(output);
  if (directory === output) throw new Error('Use a separate opt-in output directory; never overwrite original assets');
  fs.mkdirSync(output, { recursive: true });
  const prefix = path.relative(output, directory).split(path.sep).join('/') + '/';
  const interiorFile = path.join(directory, 'a380_cockpit.native.gltf');
  const interior = JSON.parse(fs.readFileSync(interiorFile)), exterior = JSON.parse(fs.readFileSync(path.join(directory, 'a380_exterior.native.gltf')));
  const selection = selectA380Views(interior);
  selection.interior = selection.shared;
  selection.cockpit = new Set([...selection.cockpit].filter(i => !selection.shared.has(i)));
  selection.cabin = new Set([...selection.cabin].filter(i => !selection.shared.has(i)));
  const report = { version: 1, policy: 'No bytes removed from source pack. All original mesh attachments retained by partition union; full source texture/geometry bytes and transforms unchanged. Opt-in pending visibility review.', originalInteriorJSONBytes: fs.statSync(interiorFile).size, partitions: {} };
  const before = assetCost(interior, directory), exteriorCost = assetCost(exterior, directory);
  const originalExteriorJSONBytes = fs.statSync(path.join(directory, 'a380_exterior.native.gltf')).size;
  report.before = { boot: exteriorCost.uniqueResourceBytes + originalExteriorJSONBytes, interiorStandalone: before.uniqueResourceBytes + report.originalInteriorJSONBytes, interiorAdditional: [...before.files].filter(([k]) => !exteriorCost.files.has(k)).reduce((n, [,v]) => n+v, 0) + report.originalInteriorJSONBytes, cockpitOrCabinTotal: new Map([...exteriorCost.files, ...before.files]) };
  report.before.cockpitOrCabinTotal = [...report.before.cockpitOrCabinTotal.values()].reduce((a,b) => a+b, 0) + originalExteriorJSONBytes + report.originalInteriorJSONBytes;
  const sharedPart = partitionGltf(interior, selection.interior, { uriPrefix: prefix });
  const sharedCost = assetCost(sharedPart.json, output), sharedJSONBytes = Buffer.byteLength(JSON.stringify(sharedPart.json));
  for (const name of ['interior', 'cockpit', 'cabin']) {
    const part = partitionGltf(interior, selection[name], { uriPrefix: prefix });
    const text = JSON.stringify(part.json), jsonBytes = Buffer.byteLength(text);
    fs.writeFileSync(path.join(output, `${name}.native.gltf`), text);
    const cost = assetCost(part.json, output), required = name === 'interior' ? cost.files : new Map([...sharedCost.files, ...cost.files]), total = new Map([...exteriorCost.files, ...required]);
    const requiredJSONBytes = jsonBytes + (name === 'interior' ? 0 : sharedJSONBytes);
    report.partitions[name] = { meshNodes: part.meshNodes.length, meshes: part.json.meshes.length, images: part.json.images.length, runtimeImages: cost.runtimeImages, buffers: part.json.buffers.length, geometryBytes: cost.geometryBytes, textureBytes: cost.textureBytes, jsonBytes, resourceBytes: cost.uniqueResourceBytes, additionalAfterExteriorBytes: [...required].filter(([k]) => !exteriorCost.files.has(k)).reduce((n, [,v]) => n+v, 0) + requiredJSONBytes, totalWithExteriorBytes: [...total.values()].reduce((a,b) => a+b,0) + originalExteriorJSONBytes + requiredJSONBytes, sourceIds: part.sourceIds, sourceMeshNodes: part.meshNodes };
  }
  report.sharedMeshNodes = selection.shared.size;
  report.afterBootBytes = report.before.boot; // Exterior retains EVERY source mesh and texture.
  fs.writeFileSync(path.join(output, 'scene.json'), JSON.stringify({ version: 1, exterior: prefix + 'a380_exterior.native.gltf', interior: 'interior.native.gltf', cockpit: 'cockpit.native.gltf', cabin: 'cabin.native.gltf', rotation: [0, Math.PI/2, 0], position: [0, 3.24, 0] }, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'partition-proof.json'), JSON.stringify(report) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2] || 'public/models/a380x', output = process.argv[3] || path.join(directory, 'lazy');
  const report = generate(directory, output);
  console.log(JSON.stringify({ before: report.before, afterBootBytes: report.afterBootBytes, sharedMeshNodes: report.sharedMeshNodes, partitions: Object.fromEntries(Object.entries(report.partitions).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([key]) => !/^source/.test(key)))])) }, null, 2));
}
