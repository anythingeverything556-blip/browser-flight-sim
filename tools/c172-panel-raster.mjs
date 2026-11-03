// Software raster of the instrument panel seen from the pilot (model frame: looking +x; z right, y up), written to /tmp/panel.ppm (convert with any image tool). Used to measure the gauge centres in src/c172gauges.js.
import * as THREE from 'three';
import fs from 'node:fs';
import { createViteSsr } from '../test/_ac-node.mjs';
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { vite, load } = await createViteSsr();
const { GLTFLoader } = await load('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await load('/node_modules/three/examples/jsm/loaders/DRACOLoader.js');
const g = await new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/')).loadAsync('/models/C172.glb');
const root = new THREE.Group(); g.scene.rotation.y = Math.PI / 2; root.add(g.scene); root.updateMatrixWorld(true);
const Z0 = -0.52, Z1 = 0.08, Y0 = 1.08, Y1 = 1.46, PX = 2000; // 2000 px per metre
const W = Math.round((Z1 - Z0) * PX), H = Math.round((Y1 - Y0) * PX), img = new Uint8Array(W * H * 3).fill(40), depth = new Float32Array(W * H).fill(1e9);
const tris = [];
root.traverse((o) => {
  if (!o.isMesh || !/Panel_Details|Gauge|InstrumentPanel/.test(o.name) || /Glass/.test(o.material.name)) return;
  const p = o.geometry.attributes.position, idx = o.geometry.index, c = o.material.color, col = [c.r, c.g, c.b].map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
  const v = (i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
  const n = idx ? idx.count : p.count;
  for (let k = 0; k < n; k += 3) { const a = v(idx ? idx.getX(k) : k), b = v(idx ? idx.getX(k + 1) : k + 1), d = v(idx ? idx.getX(k + 2) : k + 2); tris.push([a, b, d, col]); }
});
const toPx = (q) => [(q.z - Z0) * PX, (Y1 - q.y) * PX];
for (const [a, b, d, col] of tris) {
  const A = toPx(a), B = toPx(b), D = toPx(d);
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], D[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], D[0])));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], D[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], D[1])));
  const area = (B[0] - A[0]) * (D[1] - A[1]) - (D[0] - A[0]) * (B[1] - A[1]); if (Math.abs(area) < 1e-9) continue;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((B[0] - px) * (D[1] - py) - (D[0] - px) * (B[1] - py)) / area, w1 = ((D[0] - px) * (A[1] - py) - (A[0] - px) * (D[1] - py)) / area, w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * a.x + w1 * b.x + w2 * d.x, i = y * W + x; // smaller x = nearer the pilot
    if (z < depth[i]) { depth[i] = z; img[i * 3] = col[0]; img[i * 3 + 1] = col[1]; img[i * 3 + 2] = col[2]; }
  }
}
fs.writeFileSync('/tmp/panel.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), Buffer.from(img)]));
console.log('panel raster', W, H, 'tris', tris.length, 'px/m', PX, 'origin z', Z0, 'y top', Y1);
await vite.close(); process.exit(0);
