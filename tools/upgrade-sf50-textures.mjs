// Lossless owner-asset graft. Never imports the handoff's simplified geometry.
// Run from the project root: node tools/upgrade-sf50-textures.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
export const STOCK = 'public/models/SF50.glb';
export const SOURCE = 'handoff/sf50-model-wip/SF50_exterior_fix1.glb';
export const OUTPUT = 'public/models/SF50_fullres_v1.glb';
export function readGLB(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB: ' + file);
  const len = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + len).toString()), bin: bytes.subarray(28 + len), bytes };
}
export function viewBytes(glb, index) {
  const v = glb.json.bufferViews[index]; return glb.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
}
export const sha256 = b => createHash('sha256').update(b).digest('hex');
export function upgrade() {
  const stock = readGLB(STOCK), source = readGLB(SOURCE), json = structuredClone(stock.json);
  const originalImages = new Map(stock.json.images.map(i => [i.bufferView, i]));
  const replacements = new Map(source.json.images.map(i => [i.name, { image: i, bytes: viewBytes(source, i.bufferView) }]));
  const chunks = []; let offset = 0, restored = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const image = originalImages.get(i), original = viewBytes(stock, i);
    const candidate = image && replacements.get(image.name);
    if (image && (!candidate || image.mimeType !== candidate.image.mimeType)) throw Error('Missing compatible image: ' + image.name);
    const data = candidate ? candidate.bytes : original;
    if (!data.equals(original)) restored++;
    const padding = (4 - offset % 4) % 4; if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    json.bufferViews[i].byteOffset = offset; json.bufferViews[i].byteLength = data.length;
    chunks.push(data); offset += data.length;
  }
  json.buffers[0].byteLength = offset;
  const pad = (4 - offset % 4) % 4; if (pad) chunks.push(Buffer.alloc(pad));
  const bin = Buffer.concat(chunks);
  const text = Buffer.from(JSON.stringify(json)), jpad = (4 - text.length % 4) % 4;
  const js = Buffer.concat([text, Buffer.alloc(jpad, 32)]), header = Buffer.alloc(20), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + js.length + bin.length, 8);
  header.writeUInt32LE(js.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(OUTPUT, Buffer.concat([header, js, bh, bin]));
  console.log(JSON.stringify({ output: OUTPUT, restoredImages: restored, bytes: fs.statSync(OUTPUT).size, sha256: sha256(fs.readFileSync(OUTPUT)) }, null, 2));
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://' + process.cwd() + '/').href) upgrade();
