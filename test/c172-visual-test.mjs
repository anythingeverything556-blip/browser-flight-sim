// Cessna 172 visual with the real public/models/C172.glb (node, Draco decoded): moving parts found, static meshes merged, surfaces follow the
// flight model in the right sense, and a crash of the C172 breaks it into pieces without throwing.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

// the model's cockpit textures (PNG in the GLB): node has no image decoder, a 1x1 stand-in is enough here
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { vite, load } = await createViteSsr();
const { C172Visual } = await load('/src/c172visual.js');
const { C172Model, C172_CG } = await load('/src/c172.js');
const { Wreck } = await load('/src/crash.js');
let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

const scene = new THREE.Scene(), v = new C172Visual(scene);
await v.load('/models/C172.glb');
const fdm = new C172Model(); fdm.reset(new THREE.Vector3(0, C172_CG.y, 0), 90, 0, true);
const env = { daylight: 1, elev: 0.5, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize() };
check('moving parts and merged airframe', () => {
  for (const n of ['Elevator_L', 'Elevator_R', 'Rudder', 'Prop', 'Aileron_L', 'Aileron_R', 'Flap_L', 'Flap_R', 'Tire_Main_L', 'Tire_Main_R', 'Tire_Nose', 'NavLight_L', 'NavLight_R']) assert.ok(v.nodes[n], n);
  assert.ok(v.stats.draws < 150, `${v.stats.draws} draws`); // 116 before round 3 added the tail wheel, pedals, levers, console, tracks (+22); 190 before plain colours were merged per finish and the moving groups per material assert.ok(v.stats.tris > 2e5, `${v.stats.tris} tris`);
  return `${v.stats.draws} draw calls (from 327 meshes), ${v.stats.tris} triangles`;
});
check('model sits on its wheels: lowest point at the ground, nose toward +x, span along z', () => {
  v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(v.model);
  assert.ok(Math.abs(box.min.y) < 0.08, `min y ${box.min.y.toFixed(3)}`);
  const sz = box.getSize(new THREE.Vector3()); assert.ok(sz.z > 10.5 && sz.z < 12 && sz.x > 7.5 && sz.x < 9, `size ${sz.x.toFixed(2)} x ${sz.z.toFixed(2)}`);
  const spinner = new THREE.Vector3(); v.nodes.Prop.getWorldPosition(spinner); assert.ok(spinner.x > box.max.x - 0.6, `prop at x ${spinner.x.toFixed(2)}`);
  return `box y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}, ${sz.x.toFixed(1)} m long, ${sz.z.toFixed(1)} m span`;
});
// height of the trailing edge: the surface's aftmost vertex (most negative model x) in world space
const tePos = (n) => { scene.updateMatrixWorld(true); let best = null; v.nodes[n].traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position, w = new THREE.Vector3(); for (let i = 0; i < p.count; i += 7) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (!best || w.x < best.x) best = w.clone(); } }); return best.y; };
check('up elevator raises the elevator trailing edge; right aileron: left down, right up; flaps go down', () => {
  const e0 = tePos('Elevator_L'), aL0 = tePos('Aileron_L'), aR0 = tePos('Aileron_R'), f0 = tePos('Flap_L');
  fdm.surf.de = 1; fdm.surf.da = 1; fdm.flaps = 30; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0);
  const e1 = tePos('Elevator_L'), aL1 = tePos('Aileron_L'), aR1 = tePos('Aileron_R'), f1 = tePos('Flap_L');
  fdm.surf.de = 0; fdm.surf.da = 0; fdm.flaps = 0;
  assert.ok(aL1 < aL0 - 0.03, `left aileron TE ${aL0.toFixed(3)} -> ${aL1.toFixed(3)}`); assert.ok(aR1 > aR0 + 0.03, `right aileron TE ${aR0.toFixed(3)} -> ${aR1.toFixed(3)}`);
  assert.ok(f1 < f0 - 0.15, `flap TE ${f0.toFixed(3)} -> ${f1.toFixed(3)}`); assert.ok(e1 > e0 + 0.1, `elevator TE ${e0.toFixed(3)} -> ${e1.toFixed(3)}`);
  return `TE heights: elevator ${e0.toFixed(2)} -> ${e1.toFixed(2)}, ailerons L ${aL0.toFixed(2)} -> ${aL1.toFixed(2)} R ${aR0.toFixed(2)} -> ${aR1.toFixed(2)}, flap ${f0.toFixed(2)} -> ${f1.toFixed(2)} m`;
});
check('propeller spins and blurs at running rpm; strobes flash', () => {
  fdm.rpm = 2300; let seen = 0;
  for (let i = 0; i < 90; i++) { v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0); if (v.strL.sp.visible) seen++; }
  assert.ok(v.disc.visible && v.disc.material.opacity > 0.5); assert.ok(seen > 0 && seen < 30, `strobe on ${seen}/90 frames`);
});
check('live gauges: 7 round quads on the panel faces, facing the seat, shown and redrawn in the cockpit view only', () => {
  const g = v.gauges, pos = g.mesh.geometry.attributes.position, n = g.mesh.geometry.attributes.normal;
  assert.equal(pos.count, 28); assert.ok(n.getX(0) < -0.99, `normal x ${n.getX(0)}`);
  for (let i = 0; i < pos.count; i++) { assert.ok(Math.abs(pos.getX(i) + 0.2915) < 1e-4); assert.ok(pos.getY(i) > 1.1 && pos.getY(i) < 1.42 && pos.getZ(i) > -0.39 && pos.getZ(i) < -0.06, `vertex ${i}`); }
  const d0 = g.draws; v.update(0.1, fdm, new THREE.Vector3(), 'chase', env, 0); assert.equal(g.mesh.visible, false); assert.equal(g.draws, d0);
  fdm.rpm = 2400; v.update(0.1, fdm, new THREE.Vector3(), 'cockpit', env, 0); assert.equal(g.mesh.visible, true); assert.equal(g.draws, d0 + 1); assert.ok(g.v.rpm > 300, `rpm ${g.v.rpm}`);
  return `${g.draws} redraws, needle rpm ${g.v.rpm.toFixed(0)}`;
});
check('model corrections: stray windscreen ring removed, decals lifted, trim tabs and wicks on their surfaces, one tail material', () => {
  const f = v.fixes;
  assert.deepEqual(f.dropped, ['Window_Frames_1 x1', 'Window_Frames_2 x1', 'throttle knob', 'mixture knob', 'Overhead_Console_1', 'Overhead_Console_2', 'Overhead_Console_3', 'Overhead_Console_4']);
  assert.deepEqual(f.moved, ['Gauge_ADF']);
  assert.equal(f.lifted.length, 12); assert.equal(f.tail, 4);
  for (const a of ['ElevTrimTab>Elevator_R', 'Rudder_TrimTab>Rudder', 'Wick_L_0>Aileron_L', 'Wick_R_2>Aileron_R']) assert.ok(f.attached.includes(a), a);
  // nothing of the cabin is left between the pilot and the windscreen (the dropped ring crossed x -0.86..-0.65 over the whole width)
  scene.updateMatrixWorld(true); let inView = 0; const b = new THREE.Box3();
  v.model.traverse((o) => { if (!o.isMesh || !/Window_Frames/.test(o.name)) return; b.setFromObject(o); if (b.min.x > -0.95 - C172_CG.x - 0.1 && b.max.x < -0.6 - C172_CG.x) inView++; });
  assert.equal(inView, 0);
  return `${f.attached.length} parts re-attached, ${f.lifted.length} decals lifted`;
});
check('the elevator trim tab moves with the elevator (it stayed in the air before)', () => {
  const tab = []; v.nodes.Elevator_R.traverse((o) => { if (o.isMesh && o.userData.mergedParts) tab.push(o); });
  const at = () => { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(v.nodes.Elevator_R).min.y; };
  const y0 = at(); fdm.surf.de = -1; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); const y1 = at(); fdm.surf.de = 0; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0);
  assert.ok(y1 < y0 - 0.05, `elevator group low point ${y0.toFixed(3)} -> ${y1.toFixed(3)}`);
  let hasTab = false; v.nodes.Elevator_R.traverse((o) => { if (o.userData.mergedParts && o.userData.mergedParts.length > 1) hasTab = true; }); assert.ok(hasTab, 'tab merged into the elevator group');
});
check('cockpit lights: off by day; at night the glareshield flood, instrument lamps and gauges glow', () => {
  v.update(0.016, fdm, new THREE.Vector3(), 'cockpit', env, 0);
  assert.equal(v.panelLight.intensity, 0); assert.equal(v.gauges.mesh.material.emissiveIntensity, 0);
  v.update(0.016, fdm, new THREE.Vector3(), 'cockpit', { ...env, daylight: 0 }, 0);
  assert.ok(v.panelLight.intensity > 0.5 && v.gsStrip.material.emissiveIntensity > 1 && v.gauges.mesh.material.emissiveIntensity > 0.4 && [...v.dialMats].every((m) => m.emissiveIntensity > 0.3), 'lit at night');
  assert.ok(v.dialMats.size >= 5, `${v.dialMats.size} engine/ADF dials`); const night = v.panelLight.intensity;
  v.update(0.016, fdm, new THREE.Vector3(), 'cockpit', env, 0);
  return `panel flood ${night} cd at night, ${v.dialMats.size} dial faces`;
});
check('flaps 30: turn about the nose, which runs 6 cm aft and 4 cm down its track, staying under the shroud', () => {
  const f = v.nodes.Flap_L, nose = v.flapNose.Flap_L.clone(), w0 = f.localToWorld(nose.clone());
  const q0 = f.quaternion.clone(); fdm.flaps = 30; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); f.updateWorldMatrix(true, false);
  const w1 = f.localToWorld(nose.clone()), turned = f.quaternion.angleTo(q0) / Math.PI * 180;
  fdm.flaps = 10; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); f.updateWorldMatrix(true, false); const w10 = f.localToWorld(nose.clone());
  fdm.flaps = 0; v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); f.updateWorldMatrix(true, false);
  const back = f.localToWorld(nose.clone()).distanceTo(w0), d = w1.clone().sub(w0), d10 = w10.clone().sub(w0);
  // model frame: nose toward +x; aft is -x
  assert.ok(Math.abs(d.x + 0.06) < 0.005 && Math.abs(d.y + 0.04) < 0.005 && Math.abs(d.z) < 0.005, `nose moved ${d.toArray().map((x) => x.toFixed(3))}`);
  assert.ok(Math.abs(turned - 30) < 0.5, `turned ${turned.toFixed(1)} deg`);
  // most of the travel in the first notch, on the same straight line
  assert.ok(d10.x < -0.03 && d10.x > -0.04 && Math.abs(d10.y / d10.x - d.y / d.x) < 0.01, `10 deg: ${d10.toArray().map((x) => x.toFixed(3))}`);
  assert.ok(back < 1e-6, 'returns to the stowed pose');
  return `nose ${d.toArray().map((x) => x.toFixed(3))}, 10 deg ${d10.toArray().map((x) => x.toFixed(3))}`;
});
check('stowed flaps: the part under the shroud is inset (no z-fighting), the rest keeps its shape', () => {
  const g = v.nodes.Flap_R.geometry, p = g.attributes.position, nose = v.flapNose.Flap_R;
  let moved = 0, kept = 0;
  const src = v.flapSource && v.flapSource.Flap_R; assert.ok(src, 'original flap positions kept for the check');
  for (let i = 0; i < p.count; i++) {
    const dz = nose.z - src.getZ(i), dist = Math.hypot(p.getX(i) - src.getX(i), p.getY(i) - src.getY(i), p.getZ(i) - src.getZ(i));
    if (dz < 0.08) { assert.ok(dist > 0.003 && dist < 0.006, `vertex under the shroud moved ${dist.toFixed(4)}`); moved++; }
    // the inset follows the nose span by span (it is 3.5 cm further aft at the root end than at the tip end)
    if (dz > 0.17) { assert.ok(dist < 1e-6, `aft vertex moved ${dist.toFixed(4)}`); kept++; }
  }
  assert.ok(moved > 10 && kept > 10, `moved ${moved}, kept ${kept}`);
  return `${moved} vertices under the shroud inset, ${kept} aft vertices unchanged`;
});
check('wells: the wing no longer runs on over the flaps and ailerons; each well is closed by a cove wall, the flaps\' by a shroud', () => {
  assert.deepEqual({ wells: v.wellStats.wells, covers: v.wellStats.covers }, { wells: 4, covers: 4 });
  assert.ok(v.wellStats.removed > 1000, `${v.wellStats.removed} triangle pieces removed`);
  // straight down through the middle of each stowed surface: the only skins hit are the surface's own (two: top and bottom)
  const model = v.model; model.updateMatrixWorld(true);
  const moving = new Set(); for (const o of Object.values(v.nodes)) o.traverse((c) => moving.add(c));
  const fixed = []; model.traverse((o) => { if (o.isMesh && !moving.has(o)) fixed.push(o); });
  const ray = new THREE.Raycaster();
  for (const n of ['Flap_L', 'Flap_R', 'Aileron_L', 'Aileron_R']) {
    const box = new THREE.Box3().setFromObject(v.nodes[n]), c = box.getCenter(new THREE.Vector3());
    // 60 % of the way back from the nose (behind the flap shroud)
    c.x = box.max.x - 0.6 * (box.max.x - box.min.x);
    ray.set(new THREE.Vector3(c.x, 5, c.z), new THREE.Vector3(0, -1, 0)); ray.far = 4;
    const hits = ray.intersectObjects(fixed, false).filter((h) => h.point.y > box.min.y - 0.05 && h.point.y < box.max.y + 0.05);
    assert.equal(hits.length, 0, `${n}: fixed airframe over the surface (${hits.map((h) => h.object.name).join(', ')})`);
  }
  return `${v.wellStats.removed} triangle pieces cut from ${v.wellStats.shells} shells`;
});
check('ailerons, elevators and rudder turn about their leading edges (the exported hinges were 12-50 cm off them)', () => {
  const out = [];
  for (const [n, set] of [['Aileron_L', { da: 1 }], ['Elevator_L', { de: 1 }], ['Elevator_R', { de: -1 }], ['Rudder', { dr: 1 }]]) {
    const h = v.hinges[n], o = v.nodes[n]; assert.ok(h, `${n} hinge`);
    const end = (k) => h.point.clone().addScaledVector(h.axis, k);
    const w0 = [-0.4, 0, 0.4].map((k) => o.localToWorld(end(k)));
    Object.assign(fdm.surf, set); v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0); o.updateWorldMatrix(true, false);
    const w1 = [-0.4, 0, 0.4].map((k) => o.localToWorld(end(k)));
    Object.assign(fdm.surf, { da: 0, de: 0, dr: 0 }); v.update(0.016, fdm, new THREE.Vector3(), 'chase', env, 0);
    const moved = Math.max(...w0.map((p, i) => p.distanceTo(w1[i]))); assert.ok(moved < 1e-4, `${n} hinge line moved ${moved}`);
    out.push(n);
  }
  // the elevator's hinge is at its main leading edge, half a metre behind the tip horn (which the exported pivot sat on)
  const e = v.hinges.Elevator_L; assert.ok(Math.abs(e.point.z + 0.49) < 0.02, `elevator hinge ${e.point.z.toFixed(3)} m from the exported pivot`);
  return out.join(', ');
});
check('propeller: modelled blades while it barely turns; above that the disc draws both blades smeared over the frame\'s sweep', () => {
  fdm.rpm = 30; v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0);
  assert.ok(v.blades.length && v.blades.every((b) => b.visible) && !v.disc.visible, 'slow: solid blades');
  fdm.rpm = 700; v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0);
  const u = v.disc.material.uniforms, idle = u.uSmear.value;
  assert.ok(v.disc.visible && v.blades.every((b) => !b.visible), 'idle: disc');
  assert.ok(Math.abs(idle - 700 / 60 * 2 * Math.PI / 60) < 1e-6, `idle sweep ${idle}`);
  fdm.rpm = 2400; v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0);
  assert.ok(Math.abs(u.uSmear.value - Math.PI) < 1e-6, 'cruise: a full half turn per frame is a uniform disc');
  // the blade shape is measured from the mesh: a two-blade prop, narrow at the root, widest outboard, nothing at the hub
  const hw = u.uHw.value; assert.ok(hw[0] === 0 && Math.max(...hw) > 0.04 && Math.max(...hw) < 0.4, `half widths ${hw.map((x) => x.toFixed(2))}`);
  assert.ok(Math.abs(u.uR.value - 0.96) < 0.05, `radius ${u.uR.value.toFixed(3)}`);
  const ang = u.uAng.value; v.update(0, fdm, new THREE.Vector3(), 'chase', env, 0);
  assert.ok(u.uAng.value === ang && u.uSmear.value === Math.PI, 'paused: picture unchanged');
  fdm.rpm = 0; v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0);
  return `idle sweep ${(idle * 180 / Math.PI).toFixed(0)} deg/frame at 60 fps, radius ${u.uR.value.toFixed(2)} m`;
});
check('ground shadow: the silhouette projected along the sun, under the aircraft on the ground, offset and softer with height', () => {
  assert.ok(!v.casters.some((o) => o.layers.isEnabled(3)), 'no world-cascade casting (that was the smeared shadow)');
  assert.ok(v.casters.length > 20 && v.casters.every((o) => o.layers.isEnabled(4)), 'casters drawn into the silhouette');
  const at = (alt) => { fdm.pos.y = C172_CG.y + alt; v.update(1 / 60, fdm, new THREE.Vector3(), 'chase', env, 0); return { vis: v.shadow.visible, p: v.shadow.position.clone(), u: { ...Object.fromEntries(Object.entries(v.shadow.material.uniforms).map(([k, x]) => [k, x.value])) } }; };
  const g = at(0), h = at(100), hi = at(1600); at(0);
  assert.ok(g.vis && g.u.uOpacity > 0.5, `on the ground: shown, opacity ${g.u.uOpacity}`);
  assert.ok(Math.hypot(g.p.x - fdm.pos.x, g.p.z - fdm.pos.z) < 0.01 && Math.abs(g.p.y - 0.1) < 1e-6, 'under the aircraft, just above the ground');
  const k = 100 / env.sunDir.y; assert.ok(Math.hypot(h.p.x - (fdm.pos.x - env.sunDir.x * k), h.p.z - (fdm.pos.z - env.sunDir.z * k)) < 0.01, 'offset away from the sun at height');
  assert.ok(h.u.uBlur > g.u.uBlur * 5 && h.u.uLod > g.u.uLod, 'softer at height'); assert.ok(!hi.vis, 'gone above 1500 m');
  return `blur ${(g.u.uBlur * 14).toFixed(3)} m on the ground, ${(h.u.uBlur * 14).toFixed(2)} m at 100 m`;
});
check('crash: the Skyhawk breaks up (the crash code splits by position along the airframe) and clears', () => {
  const w = new Wreck(scene); fdm.crashVel = new THREE.Vector3(55, -35, 0); fdm.crashW = new THREE.Vector3(); fdm.crashInfo = { speed: 65, sinkRate: 35, pitch: -0.7 }; fdm.out = { M: 0.19, V: 65, nz: 1 };
  w.start(v, fdm, 'impact'); const n = w.pieces.length, o = w.info.outcome; w.clear(v);
  assert.ok(n >= 2, `${n} pieces`); assert.ok(v.root.visible, 'airframe shown again after clear'); return `${n} pieces (${o}, ${w.severity})`;
});
await vite.close();
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('c172-visual-test ok');
