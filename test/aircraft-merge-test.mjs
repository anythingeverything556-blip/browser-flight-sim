// Aircraft draw cost: static meshes merged by material, shadow-only LOD proxy for the self-shadow and the world cascade. Loads the real GLBs in node (no GPU).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';
import { FlightModel } from '../src/flight.js';

const { vite, load } = await createViteSsr();
const { AircraftVisual, mergeStatic } = await load('/src/aircraft.js');

// ---- mergeStatic on a synthetic rig: transforms are baked, flagged / skipped / single-material meshes stay, source parts are kept ----
{
  const mat = new THREE.MeshStandardMaterial(), other = new THREE.MeshStandardMaterial(), root = new THREE.Group(), arm = new THREE.Group();
  const box = (x, m, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); o.position.set(x, 0, 0); parent.add(o); return o; };
  const a = box(0, mat, root), b = box(5, mat, root), c = box(9, other, root), d = box(1, mat, arm), e = box(2, mat, arm), skipped = box(7, mat, root);
  root.add(arm); root.rotation.y = 0.3; root.position.set(3, 0, 0); arm.rotation.z = 0.5; a.userData.thr = true;
  root.updateMatrixWorld(true);
  const want = new THREE.Box3(); for (const o of [b, d, e]) want.union(new THREE.Box3().setFromObject(o));
  const r = mergeStatic(root, { skip: (o) => o === skipped });
  assert.equal(r.merged.length, 1); assert.equal(r.merged[0].userData.mergedParts.length, 3);
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.deepEqual([a, c, skipped].map((o) => meshes.includes(o)), [true, true, true], 'flagged, single-material and skipped meshes stay');
  assert.ok(!meshes.includes(b) && !meshes.includes(d) && !meshes.includes(e), 'merged sources leave the scene');
  const m = r.merged[0], got = new THREE.Box3().setFromObject(m);
  assert.ok(m.parent === root && m.matrix.equals(new THREE.Matrix4()), 'merged mesh sits in the group at identity');
  for (const ax of ['x', 'y', 'z']) { assert.ok(Math.abs(got.min[ax] - want.min[ax]) < 1e-5 && Math.abs(got.max[ax] - want.max[ax]) < 1e-5, `baked extent ${ax}`); }
  assert.equal(m.geometry.attributes.position.count, 3 * 24, 'vertices are the sum of the parts');
  console.log('PASS mergeStatic synthetic:', r.before, '->', r.after, 'draws');
}

// ---- the real aircraft ----
const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
await visual.lateReady;
visual.panel.draw = () => {}; visual.real.cheek.update = () => {}; visual.real.controls.set = () => {};
const f = new FlightModel(); f.reset(new THREE.Vector3(0, 2.42, 0), 0, 0, true);
const env = { night: 0, daylight: 1, elev: 0.8, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize(), wet: 0 };

const stats = (view, dist) => {
  visual.update(0.016, f, new THREE.Vector3(dist, 2, 0), view, env, 0, view === 'cockpit' ? {} : null);
  scene.updateMatrixWorld(true);
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  let calls = 0, tris = 0, casters = 0, casterTris = 0, unmerged = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !vis(o)) return;
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3, draws = Array.isArray(o.material) ? g.groups.length : (o.material.visible ? 1 : 0);
    if (draws && (o.layers.mask & 1)) { calls += draws; tris += n; unmerged += o.userData.mergedParts ? o.userData.mergedParts.length : draws; }
    if ((draws || o.userData.shadowProxy) && o.castShadow && (o.layers.mask & 1)) { casters += draws || 1; casterTris += n; }
  });
  return { calls, tris: Math.round(tris), casters, casterTris: Math.round(casterTris), unmerged };
};

const before = { chase: stats('chase', 40), cockpit: stats('cockpit', 0) };
assert.ok(before.chase.casters >= 75 && before.chase.casterTris > 300000, `sun-map casters before the proxy: ${before.chase.casters} / ${before.chase.casterTris} triangles`);
assert.ok(before.chase.unmerged - before.chase.calls >= 60, `merging removed ${before.chase.unmerged - before.chase.calls} draws in the chase view`);
assert.ok(before.cockpit.unmerged - before.cockpit.calls >= 15, `merging removed ${before.cockpit.unmerged - before.cockpit.calls} draws in the cockpit view`);
console.log(`PASS merge: chase ${before.chase.unmerged} -> ${before.chase.calls} draws, cockpit ${before.cockpit.unmerged} -> ${before.cockpit.calls} draws (same ${before.chase.tris} triangles)`);

const P = visual.proxy;
assert.ok(P && P.sun.length >= 1 && P.cascade.length >= 1, 'shadow proxies built from the LOD ' + (P && P.sun.length) + '/' + (P && P.cascade.length) + ' lodPairs ' + visual.lodPairs.length);
assert.ok(P.sun.every((o) => !o.castShadow && o.material.visible === false) && P.cascade.every((o) => (o.layers.mask & 1) === 0 && !(o.layers.mask >> 3 & 1)), 'proxies are inert until the sun light is attached');
assert.equal(stats('chase', 40).casters, before.chase.casters, 'nothing changes before attachSelfShadow');

const sun = new THREE.DirectionalLight(); scene.add(sun);
assert.equal(visual.attachSelfShadow(sun), true);
const after = { chase: stats('chase', 40), cockpit: stats('cockpit', 0) };
assert.ok(after.chase.casters <= 56 && after.chase.casterTris < before.chase.casterTris * 0.25, `chase sun-map casters ${before.chase.casters} -> ${after.chase.casters}, ${before.chase.casterTris} -> ${after.chase.casterTris} triangles`);
assert.ok(after.cockpit.casters <= 14 && after.cockpit.casterTris < before.cockpit.casterTris * 0.2, `cockpit sun-map casters ${before.cockpit.casters} -> ${after.cockpit.casters}, ${before.cockpit.casterTris} -> ${after.cockpit.casterTris} triangles`);
assert.equal(after.chase.calls, before.chase.calls, 'the proxies add no colour-pass draws'); assert.equal(after.cockpit.calls, before.cockpit.calls);
console.log(`PASS proxy: sun-map casters chase ${before.chase.casters}/${before.chase.casterTris} -> ${after.chase.casters}/${after.chase.casterTris}, cockpit ${before.cockpit.casters}/${before.cockpit.casterTris} -> ${after.cockpit.casters}/${after.cockpit.casterTris} (draws/triangles)`);

const cascade = () => visual.casters.filter((o) => o.parent && (o.layers.mask >> 3) & 1);
const cascadeTris = cascade().reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
stats('chase', 40);
assert.ok(cascade().length <= 40 && cascadeTris < 80000, `world cascade casters ${cascade().length} / ${cascadeTris} triangles`);
f.pos.y = 400; stats('chase', 40); assert.equal(cascade().length, 0, 'high above the ground nothing is drawn into the cascade'); f.pos.y = 2.42; stats('chase', 40);
assert.ok(cascade().length > 0, 'and it is back on the ground');

assert.equal(P.sunMat.visible, false, 'proxy material is hidden while the colour pass collects its draws');
sun.shadow.updateMatrices(sun);
assert.equal(P.sunMat.visible, true, 'and visible while the sun shadow map renders');
scene.onAfterRender({}, scene, null); assert.equal(P.sunMat.visible, false, 'hidden again when the render call ends');

const lo = P.sun.find((o) => o.name === 'SR71_ShadowProxy').geometry.boundingBox, hi = new THREE.Box3().copy(visual.model.getObjectByName('SR71_Fuselage').children[0].geometry.boundingBox);
assert.ok(lo.min.x < -10 && lo.max.x > 15 && lo.max.z > 6 && lo.min.z < -6 && Math.abs(lo.max.x - hi.max.x) < 0.5, `proxy covers the whole airframe (nose, tail, both wing tips): ${lo.min.toArray().map((v) => v.toFixed(1))} .. ${lo.max.toArray().map((v) => v.toFixed(1))}`);

visual.setShadowProxy(false);
const off = stats('chase', 40); assert.equal(off.casters, before.chase.casters, 'switching the proxy off restores every caster'); assert.equal(off.casterTris, before.chase.casterTris);
visual.setShadowProxy(true, sun);
console.log(`PASS proxy switch + hook; proxy ${P.tris | 0} triangles in ${P.sun.length + P.cascade.length} meshes`);
console.log('aircraft-merge-test ok');
await vite.close(); process.exit(0);
