// Builds public/models/SR71_lod.glb: decimated copies of the heavy exterior meshes (fuselage, wings, nacelles, fins, ejectors) for the distance and cockpit LOD.
// usage: npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer draco3dgltf && node tools/make-lod.mjs [ratio]
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { simplify, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const ratio = Number(process.argv[2] || 0.12);
const KEEP = /^SR71_(Fuselage|Wing_[LR]|Nacelle_[LR]|Fin_[LR]|Ejector_[LR])$/;
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression, KHRMaterialsEmissiveStrength, KHRMaterialsSpecular])
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const doc = await io.read('public/models/SR71_sim.glb');
for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !KEEP.test(n.getName())) n.setMesh(null);
await doc.transform(prune(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }), dedup(), prune());
for (const mat of doc.getRoot().listMaterials()) mat.dispose();
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setMaterial(null);
await doc.transform(prune());
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, quantizePosition: 16, quantizeNormal: 10 });
await io.write('public/models/SR71_lod.glb', doc);
let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.log('SR71_lod.glb triangles', tris);
