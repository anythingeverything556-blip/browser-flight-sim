// Half-rate cloud march (round 6, off by default): with vclouds.halfRate the march runs every other frame and the frames between reproject the
// last march; off, every frame marches and the upsample samples where it always did. Stub renderer: counts the draws by material.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VolumetricClouds } from '../src/vclouds.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const draws = [];
const r = { rt: null, getRenderTarget() { return this.rt; }, setRenderTarget(t) { this.rt = t; }, render(q) { draws.push(q.material); }, state: { buffers: { depth: { getReversed: () => false } } } };
const vc = new VolumetricClouds(r);
vc.tex = { shape: new THREE.Texture(), detail: new THREE.Texture() };
vc.setQuality({ scale: 0.5, steps: 30, lightSteps: 4 }); vc.setSize(320, 180);
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 1.2e7); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const args = () => ({ camera: cam, depthTexture: new THREE.Texture(), camAlt: 500, camXZ: new THREE.Vector2(), coverage: 0.4, base: 1800, time: 1, wind: new THREE.Vector2() });
const frames = (n) => { draws.length = 0; for (let i = 0; i < n; i++) vc.render(r, args()); return { march: draws.filter((m) => m === vc.march).length, up: draws.filter((m) => m === vc.up).length }; };

check('off (default): a march and an upsample every frame, no reprojection', () => {
  assert.equal(vc.halfRate, false); const n = frames(6); assert.deepEqual(n, { march: 6, up: 6 }); assert.equal(vc.up.uniforms.uReproj.value, 0);
});
check('half rate: a march every other frame, an upsample every frame', () => {
  vc.halfRate = true; const n = frames(8); assert.equal(n.up, 8); assert.ok(n.march >= 4 && n.march <= 5, `${n.march} marches`); assert.equal(vc.up.uniforms.uReproj.value, 1);
});
check('half rate: the frame between marches maps to the last march view (camera turned 2 degrees)', () => {
  frames(1); const before = vc.marches;
  cam.rotation.y += 2 * Math.PI / 180; cam.updateMatrixWorld(); frames(1);
  const u = vc.up.uniforms, skipped = vc.marches === before;
  // the same reprojection the shader does, for the screen centre
  const d = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(u.uCamRot.value)).applyMatrix4(u.uPrevRotInv.value);
  const px = (d.x / -d.z) / u.uPrevTan.value.x * 0.5 + 0.5;
  if (skipped) assert.ok(Math.abs(px - 0.5) > 0.01, `centre maps to ${px}`); else assert.ok(Math.abs(px - 0.5) < 1e-6);
  console.log(`      ${skipped ? 'reprojected' : 'marched'} frame: screen centre samples the last march at u = ${px.toFixed(4)}`);
});
check('half rate: a resized march target marches at once', () => { frames(1); vc.setScale(0.3); const m = vc.marches; frames(1); assert.equal(vc.marches, m + 1); });
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('cloud half-rate OK');
