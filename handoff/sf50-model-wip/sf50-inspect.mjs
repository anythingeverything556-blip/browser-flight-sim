// Compact dump of an SF50 GLB: node tree (with extras and per-mesh tris/material), materials, textures, totals.
// usage: node tools/sf50-inspect.mjs [file.glb]   (needs the gltf-transform packages, see sf50-merge-interior.mjs)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
const f = process.argv[2] || 'public/models/SF50.glb';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(f), root = doc.getRoot();
const tris = (m) => m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
const r3 = (a) => a.map((x) => +x.toFixed(3)).join(',');
let T = 0, draws = 0;
const walk = (n, d) => {
  const m = n.getMesh(); let s = `${'  '.repeat(d)}${n.getName()} t[${r3(n.getTranslation())}]`;
  const q = n.getRotation(); if (Math.abs(q[3]) < 0.9999) s += ` q[${r3(q)}]`;
  const ex = n.getExtras(); if (ex && Object.keys(ex).length) s += ` ex${JSON.stringify(ex)}`;
  if (m) { const t = tris(m); T += t; draws += m.listPrimitives().length; s += ` mesh tris=${t} prims=${m.listPrimitives().length} mats=${m.listPrimitives().map((p) => p.getMaterial()?.getName()).join('|')}`; }
  console.log(s); n.listChildren().forEach((c) => walk(c, d + 1));
};
root.listScenes().forEach((sc) => sc.listChildren().forEach((n) => walk(n, 0)));
console.log('TOTAL tris', T, 'draws', draws, 'materials', root.listMaterials().length, 'textures', root.listTextures().length);
for (const t of root.listTextures()) { const sz = t.getSize(); console.log('TEX', t.getName(), t.getMimeType(), sz?.join('x'), (t.getImage()?.byteLength / 1024) | 0, 'KB'); }
for (const m of root.listMaterials()) {
  const tx = ['BaseColor', 'MetallicRoughness', 'Normal', 'Emissive', 'Occlusion'].map((k) => { const t = m['get' + k + 'Texture'](); return t ? k[0] + ':' + t.getName() : ''; }).filter(Boolean).join(' ');
  console.log('MAT', m.getName(), 'bc', r3(m.getBaseColorFactor()), 'm', m.getMetallicFactor(), 'r', m.getRoughnessFactor(), 'em', r3(m.getEmissiveFactor()), m.getAlphaMode(), tx, m.listExtensions?.() ? '' : '', m.getExtension && Object.keys({}).length ? '' : '', root.listExtensionsUsed().filter((e) => m.getExtension(e.extensionName)).map((e) => e.extensionName.replace('KHR_materials_', '')).join('+'));
}
