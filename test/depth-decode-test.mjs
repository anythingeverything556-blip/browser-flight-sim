// Scene depth -> view distance (src/depth.js) for both depth modes: w -> d the way the GPU writes it (float32 depth texture), d -> w with the shared decode.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { depthK, decodeDepth, depthIsSky, DEPTH_GLSL } from '../src/depth.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const near = 0.05, far = 1.2e7; // main.js camera
const cam = new THREE.PerspectiveCamera(55, 16 / 9, near, far);
const f32 = Math.fround;

// reversed: three r180's own projection (camera.reversedDepth, EXT_clip_control 0..1), NDC z is the stored depth
const revD = (w) => { cam._reversedDepth = true; cam.updateProjectionMatrix(); const p = new THREE.Vector4(0, 0, -w, 1).applyMatrix4(cam.projectionMatrix); return f32(p.z / p.w); };
// log: three's logdepthbuf_fragment, gl_FragDepth = log2(1 + w_clip) * logDepthBufFC * 0.5 with logDepthBufFC = 2 / log2(far + 1)
const logD = (w) => f32(Math.log2(1 + w) / Math.log2(far + 1));
const K = (rev) => depthK(cam, rev, new THREE.Vector2());

for (const [mode, rev, enc, tol] of [['reversed', true, revD, 1e-5], ['log', false, logD, 1e-5]]) {
  check(`${mode}: w -> d -> w round trip at 1 m, 1 km and 25 km`, () => {
    const k = K(rev);
    for (const w of [1, 1000, 25000]) {
      const d = enc(w), back = decodeDepth(d, f32(k.x), f32(k.y));
      assert.ok(d > 0 && d < 1, `${w} m: d ${d}`);
      assert.ok(Math.abs(back - w) / w < tol, `${w} m: decoded ${back}`);
      assert.ok(!depthIsSky(d, k.y), `${w} m read as sky`);
    }
  });
  check(`${mode}: nearer is ${rev ? 'larger' : 'smaller'} depth`, () => {
    const a = enc(10), b = enc(10000); assert.ok(rev ? a > b : a < b);
  });
}
check('reversed: cleared depth (0) is sky; terrain 300 km away is not', () => {
  const k = K(true); assert.ok(depthIsSky(0, k.y)); assert.ok(!depthIsSky(revD(3e5), k.y)); assert.ok(revD(3e5) > 0);
  assert.ok(Math.abs(decodeDepth(revD(3e5), f32(k.x), f32(k.y)) - 3e5) / 3e5 < 1e-4);
});
check('log: cleared depth (1) is sky', () => { const k = K(false); assert.ok(depthIsSky(1, k.y)); assert.equal(k.y, 0); });
check('reversed keeps more precision than log at 25 km (one float32 step of d)', () => {
  const step = (enc, rev, w) => { const k = K(rev), d = enc(w), d2 = d + (Math.abs(d) * 2 ** -23 || 2 ** -149); return Math.abs(decodeDepth(d2, k.x, k.y) - decodeDepth(d, k.x, k.y)); };
  const r = step(revD, true, 25000), l = step(logD, false, 25000);
  console.log(`   one float32 step at 25 km: reversed ${r.toExponential(2)} m, log ${l.toExponential(2)} m`);
  assert.ok(r < l);
});
check('GLSL decode matches the JS mirror (same formulas)', () => {
  assert.match(DEPTH_GLSL, /uDepthK\.x \/ \(d \+ uDepthK\.y\)/); assert.match(DEPTH_GLSL, /exp2\(d \* uDepthK\.x\) - 1\.0/); assert.match(DEPTH_GLSL, /d <= 0\.0/);
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('depth decode OK');
