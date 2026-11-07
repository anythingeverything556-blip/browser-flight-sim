// Runtime-cost pass for public/models/SF50.glb: shrink textures, simplify heavy/hidden meshes, re-encode (Draco + WebP kept).
// Node names, pivots, extras and materials are untouched.
// usage (gltf-transform, meshoptimizer and sharp are not project dependencies):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 draco3dgltf meshoptimizer sharp
//   node tools/sf50-optimize.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { simplifyPrimitive, weld, prune, dedup, unpartition, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const [inPath, outPath] = process.argv.slice(2);
// texture name -> [width, height, webp quality]; baked display/GTC textures are only the fallback before the live canvases draw
const TEX = {
  G3_Livery_BaseColor_4k: [2048, 1024, 88], G3_Livery_ORM_4k: [512, 256, 90],
  G3_VTail_X_BaseColor_2k: [1024, 1024, 90], G3_VTail_X_ORM_2k: [256, 256, 90],
  G3_Display_MFD_Tex: [512, 320, 82], G3_Display_PFD_Tex: [512, 320, 82],
  G3_Display_GTC1_Tex: [640, 400, 85], G3_Display_GTC2_Tex: [640, 400, 85], G3_Display_GTC3_Tex: [640, 400, 85],
};
// [node regex, material regex, triangle ratio, max error (fraction of mesh extent)] - first match wins; seats and hidden shells take the deepest cuts
const RULES = [
  [/./, /LED_|Rubber_Boot|Seam_Dark|Decal|Lens|Pinstripe|Webbing|Buckle/, 1, 0],
  [/^Interior$/, /Leather_Ivory|Alcantara|Piping/, 0.30, 0.002],
  [/^Interior$/, /Liner_WarmWhite|Trim_Charcoal|Metal_Brushed|Carbon_Fibre|Plastic_Satin|Seat_/, 0.45, 0.0015],
  [/^Interior$/, /./, 0.7, 0.001],
  [/^Wheel_/, /Rubber_Tyre|Metal_Wheel/, 0.5, 0.005],
  [/^Exterior$/, /Composite_Inner|Duct_Dark|Wheelwell/, 0.35, 0.002],
];
const MIN_TRIS = 600;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const doc = await io.read(inPath); const root = doc.getRoot();
await MeshoptSimplifier.ready;
const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0), 0);

for (const t of root.listTextures()) {
  const c = TEX[t.getName()]; if (!c) continue;
  const buf = await sharp(Buffer.from(t.getImage())).resize(c[0], c[1], { kernel: 'lanczos3' }).webp({ quality: c[2], effort: 5 }).toBuffer();
  t.setImage(new Uint8Array(buf)).setMimeType('image/webp');
}

await doc.transform(weld({ tolerance: 0.0001 }));
const before = tris();
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const n = prim.getIndices().getCount() / 3; if (n < MIN_TRIS) continue;
    const rule = RULES.find(([nr, mr]) => nr.test(node.getName()) && mr.test(prim.getMaterial()?.getName() || ''));
    if (!rule || rule[2] >= 1) continue;
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: rule[2], error: rule[3], lockBorder: true });
  }
}
await doc.transform(prune(), dedup(), unpartition());
console.log('triangles', before, '->', tris());
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 } });
await io.write(outPath, doc);
