// Replace the Interior node of public/models/SF50.glb with a Blender interior export (vj3_26_game_interior_export.py in VisionJet_SF50_G3_v4.blend:
// one node per part, already in the game frame), joined per material. Every other node is kept; the GTC screen quads move with the v4 GTC row.
// usage (gltf-transform is not a project dependency): npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 draco3dgltf
//        node tools/sf50-merge-interior.mjs public/models/SF50.glb SF50_Interior_v4_parts.glb public/models/SF50.glb
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { mergeDocuments, joinPrimitives, prune, dedup, transformPrimitive, unpartition } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const [oldPath, partsPath, outPath] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const doc = await io.read(oldPath), parts = await io.read(partsPath);
const root = doc.getRoot(), scene = root.listScenes()[0];
const byName = (n) => root.listNodes().find((x) => x.getName() === n);
const sf50 = byName('SF50'), oldInterior = byName('Interior');
const tris = (m) => m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
console.log('old Interior tris', tris(oldInterior.getMesh()), 'prims', oldInterior.getMesh().listPrimitives().length);

// bring the parts in, then bake each part node's world transform into its primitives and group them by material
const map = mergeDocuments(doc, parts);
const partScene = map.get(parts.getRoot().listScenes()[0]);
const partNodes = []; partScene.traverse((n) => { if (n.getMesh()) partNodes.push(n); });
const groups = new Map();
for (const n of partNodes) {
  const M = n.getWorldMatrix();
  for (const p of n.getMesh().listPrimitives()) {
    const q = p.clone(); transformPrimitive(q, M);
    const mat = q.getMaterial(); if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(q);
  }
}
// joinPrimitives needs one vertex layout per group: add zero-filled attributes where a part lacks one (a part without UVs)
const joined = [];
for (const [mat, prims] of groups) {
  const sems = new Set(); for (const p of prims) for (const s of p.listSemantics()) sems.add(s);
  for (const p of prims) {
    const n = p.getAttribute('POSITION').getCount();
    for (const s of sems) {
      if (p.getAttribute(s)) continue;
      const ref = prims.find((x) => x.getAttribute(s)).getAttribute(s);
      const acc = doc.createAccessor().setType(ref.getType()).setArray(new ref.getArray().constructor(n * ref.getElementSize())).setNormalized(ref.getNormalized());
      if (s === 'COLOR_0') acc.getArray().fill(ref.getComponentType() === 5126 ? 1 : 255);
      p.setAttribute(s, acc);
    }
    if (!p.getIndices()) p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({ length: n }, (_, i) => i)));
  }
  joined.push(joinPrimitives(prims));
  for (const p of prims) p.dispose();
}
const mesh = doc.createMesh('Interior'); for (const p of joined) mesh.addPrimitive(p);
const interior = doc.createNode('Interior').setMesh(mesh);
sf50.addChild(interior);
// out with the old Interior and the merged parts scene
oldInterior.getMesh().dispose(); oldInterior.dispose();
partScene.traverse((n) => { if (n.getMesh()) n.getMesh().dispose(); }); for (const n of partScene.listChildren()) n.dispose(); partScene.dispose();
// GTC screen quads: moved with the v4 GTC row (Blender (-0.062, 0, +0.062) -> glTF (+0.062, +0.062, 0))
// only from the v3 position (GTC1 at x 0.237), so a second run on a merged file does not move them again
if (Math.abs(byName('Display_GTC1').getTranslation()[0] - 0.237) < 0.01) {
  for (const k of [1, 2, 3]) { const n = byName('Display_GTC' + k); const t = n.getTranslation(); n.setTranslation([t[0] + 0.062, t[1] + 0.062, t[2]]); }
}
scene.listChildren().length || scene.addChild(sf50);
await doc.transform(dedup({ propertyTypes: [PropertyType.MATERIAL, PropertyType.TEXTURE, PropertyType.ACCESSOR] }), prune(), unpartition());
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 } });
await io.write(outPath, doc);
const out = await io.read(outPath), r = out.getRoot(), it = r.listNodes().find((x) => x.getName() === 'Interior');
console.log('new Interior tris', tris(it.getMesh()), 'prims', it.getMesh().listPrimitives().length, 'nodes', r.listNodes().length,
  'materials', r.listMaterials().length, 'textures', r.listTextures().length);
console.log('names', r.listNodes().map((n) => n.getName()).sort().join(','));
