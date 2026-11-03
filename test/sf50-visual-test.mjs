// Vision Jet visual with the real public/models/SF50.glb (node, Draco decoded): every mover found, surfaces turn the right way for the flight
// model's surface positions, the gear folds in sequence with its doors, the cabin is drawn only when it can be seen, the live displays
// redraw in the cockpit view only, and the display feed maps the flight state to the displays' units.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { vite, load } = await createViteSsr();
const { SF50Visual, SF50_POSE } = await load('/src/sf50visual.js');
const { SF50Model, SF50_CG, SF50 } = await load('/src/sf50.js');
const { makeSF50Feed, cabinAt, flapFraction, alertsOf } = await load('/src/sf50feed.js');
const { Wreck } = await load('/src/crash.js');
const { TERRAIN_UNIFORMS } = await load('/src/terrain-shader.js');
let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

const scene = new THREE.Scene(), v = new SF50Visual(scene);
await v.load('/models/SF50.glb');
const fdm = new SF50Model(); fdm.reset(new THREE.Vector3(0, SF50_CG.y, 0), 90, 0, true);
const day = { daylight: 1, elev: 0.5, night: 0, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }, night = { daylight: 0, elev: -0.3, night: 1, sunDir: new THREE.Vector3(0, -1, 0) };
const cam0 = new THREE.Vector3();
const upd = (view = 'chase', env = day, dt = 1 / 60, feed) => v.update(dt, fdm, cam0, view, env, 0, feed);
// height / position of a node's aftmost vertex (the trailing edge) in world space; every vertex is checked (a stride depends on the encoder's vertex order)
// (in the aircraft's own frame: x forward, y up, z right)
const tePos = (n) => { scene.updateMatrixWorld(true); let best = null; v.nodes[n].traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position, w = new THREE.Vector3(); for (let i = 0; i < p.count; i += 1) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); v.root.worldToLocal(w); if (!best || w.x < best.x) best = w.clone(); } }); return best; };
const worldBox = (n) => { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(v.nodes[n]); };

check('every mover and light of the model is found; the cabin, glazing and exterior are merged by material', () => {
  for (const n of ['Ctrl_Aileron_L', 'Ctrl_Aileron_R', 'Ctrl_Flap_L', 'Ctrl_Flap_R', 'Ctrl_Ruddervator_L', 'Ctrl_Ruddervator_R', 'Door_Main', 'Door_Exit', 'Door_Baggage', 'Gear_Nose', 'Gear_Main_L', 'Gear_Main_R',
    'GearDoor_Nose_L', 'GearDoor_Nose_R', 'Wheel_Nose', 'Wheel_Main_L', 'Wheel_Main_R', 'Engine_Fan', 'Stick_Pilot', 'Stick_CoPilot', 'Throttle_Lever']) assert.ok(v.movers[n], n);
  for (const n of ['Light_Nav_L', 'Light_Nav_R', 'Light_Strobe_L', 'Light_Strobe_R', 'Light_Landing_L', 'Light_Landing_R', 'Light_Halo_L', 'Light_Halo_R', 'Light_Taxi', 'Light_Courtesy']) assert.ok(v.lights[n], n);
  for (const n of ['Exterior', 'Interior', 'Glazing', 'Display_PFD', 'Display_MFD', 'Display_GTC1', 'Display_GTC2', 'Display_GTC3']) assert.ok(v.nodes[n], n);
  assert.equal(v.movers.Ctrl_Flap_L.max, 35); assert.equal(v.movers.Gear_Nose.max, 110); assert.equal(v.movers.Gear_Main_L.max, 88);
  assert.ok(v.stats.tris > 3.5e5 && v.stats.draws < 200, `${v.stats.draws} draws, ${v.stats.tris} tris`);
  return `${v.stats.movers} movers, ${v.stats.draws} draw calls, ${v.stats.tris} triangles`;
});
check('model sits on its wheels: lowest point at the ground, nose toward +x, span along z, centre of gravity at the root', () => {
  upd(); scene.updateMatrixWorld(true);
  const box = new THREE.Box3(); v.model.traverse((o) => { if (o.isMesh) box.expandByObject(o); }); const sz = box.getSize(new THREE.Vector3()); // meshes only: not the light sprites
  assert.ok(Math.abs(box.min.y) < 0.12, `min y ${box.min.y.toFixed(3)}`);
  assert.ok(sz.z > 11.5 && sz.z < 12.1 && sz.x > 9 && sz.x < 9.8, `size ${sz.x.toFixed(2)} x ${sz.z.toFixed(2)}`);
  const nose = worldBox('Gear_Nose').getCenter(new THREE.Vector3()); assert.ok(nose.x > 1.8, `nose gear at x ${nose.x.toFixed(2)}`);
  const c = new THREE.Vector3(); v.model.getWorldPosition(c); assert.ok(c.distanceTo(v.root.position.clone().sub(SF50_CG)) < 1e-6, 'model offset by the CG');
  // the left wing is -z
  assert.ok(worldBox('Ctrl_Aileron_L').getCenter(c).z < -3 && worldBox('Ctrl_Aileron_R').getCenter(c).z > 3, 'left wing at -z');
  return `box y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}, ${sz.x.toFixed(1)} m long, ${sz.z.toFixed(1)} m span`;
});
check('flaps: the flight model\'s degrees go straight to the flap, trailing edge down; ailerons: right roll = left down, right up', () => {
  const f0 = tePos('Ctrl_Flap_L').y, aL0 = tePos('Ctrl_Aileron_L').y, aR0 = tePos('Ctrl_Aileron_R').y;
  fdm.flaps = 39; fdm.surf.da = 1; upd();
  const f1 = tePos('Ctrl_Flap_L').y, fR = tePos('Ctrl_Flap_R').y, aL1 = tePos('Ctrl_Aileron_L').y, aR1 = tePos('Ctrl_Aileron_R').y;
  assert.ok(f1 < f0 - 0.2 && fR < f0 - 0.2, `flap TE ${f0.toFixed(3)} -> ${f1.toFixed(3)} / ${fR.toFixed(3)}`);
  assert.ok(aL1 < aL0 - 0.05, `left aileron TE ${aL0.toFixed(3)} -> ${aL1.toFixed(3)}`); assert.ok(aR1 > aR0 + 0.05, `right aileron TE ${aR0.toFixed(3)} -> ${aR1.toFixed(3)}`);
  const turn = v.movers.Ctrl_Flap_L.o.quaternion.angleTo(v.movers.Ctrl_Flap_L.rest) * 180 / Math.PI; assert.ok(Math.abs(turn - 39) < 0.1, `flap turned ${turn}`);
  fdm.flaps = 0; fdm.surf.da = 0; upd();
  assert.ok(Math.abs(tePos('Ctrl_Flap_L').y - f0) < 1e-6, 'flaps return to the stowed pose');
  return `flap TE ${f0.toFixed(2)} -> ${f1.toFixed(2)}, ailerons L ${aL0.toFixed(2)} -> ${aL1.toFixed(2)} R ${aR0.toFixed(2)} -> ${aR1.toFixed(2)} m`;
});
check('ruddervators: pitch up raises both trailing edges, yaw right raises the left one and lowers the right one (V-tail mixing)', () => {
  const l0 = tePos('Ctrl_Ruddervator_L').y, r0 = tePos('Ctrl_Ruddervator_R').y;
  fdm.vtail.l = 1; fdm.vtail.r = 1; upd(); const lu = tePos('Ctrl_Ruddervator_L').y, ru = tePos('Ctrl_Ruddervator_R').y;
  assert.ok(lu > l0 + 0.03 && ru > r0 + 0.03, `pitch up: L ${l0.toFixed(3)} -> ${lu.toFixed(3)}, R ${r0.toFixed(3)} -> ${ru.toFixed(3)}`);
  fdm.vtail.l = 1; fdm.vtail.r = -1; upd(); const ly = tePos('Ctrl_Ruddervator_L').y, ry = tePos('Ctrl_Ruddervator_R').y;
  assert.ok(ly > l0 + 0.03 && ry < r0 - 0.03, `yaw right: L ${ly.toFixed(3)}, R ${ry.toFixed(3)}`);
  fdm.vtail.l = fdm.vtail.r = 0; upd();
  return `pitch up L ${l0.toFixed(2)} -> ${lu.toFixed(2)}, R ${r0.toFixed(2)} -> ${ru.toFixed(2)}; yaw right L ${ly.toFixed(2)}, R ${ry.toFixed(2)} m`;
});
check('the surfaces follow a real flight: pitch up with the elevator command and a right roll with aileron to the right', () => {
  const f = new SF50Model(); f.reset(new THREE.Vector3(0, 3000, 0), 90, 100, false, 0);
  const ground = () => -1e9, wind = new THREE.Vector3();
  for (let i = 0; i < 120; i++) { f.ctrl.de = 0.5; f.ctrl.da = 0.6; f.step(1 / 120, ground, wind); }
  assert.ok(f.vtail.l > 0.1 && f.vtail.r > 0.1, `vtail ${f.vtail.l.toFixed(2)} ${f.vtail.r.toFixed(2)}`); assert.ok(f.surf.da > 0.3);
  const l0 = tePos('Ctrl_Ruddervator_L').y, aL0 = tePos('Ctrl_Aileron_L').y;
  v.update(1 / 60, f, cam0, 'chase', day, -1e5);
  assert.ok(tePos('Ctrl_Ruddervator_L').y > l0 + 0.005, 'ruddervator trailing edge up with up elevator'); assert.ok(tePos('Ctrl_Aileron_L').y < aL0 - 0.03, 'left aileron down for a right roll');
  v.update(1 / 60, fdm, cam0, 'chase', day, 0);
  return `vtail L ${f.vtail.l.toFixed(2)} R ${f.vtail.r.toFixed(2)}, da ${f.surf.da.toFixed(2)}`;
});
check('gear: legs fold between 10 % and 85 % of the transit with the doors open, then the doors close; nothing shows when up', () => {
  const S = SF50Visual.gearSequence;
  assert.deepEqual(S(1), { r: 0, strut: 0, door: 1 }); const up = S(0); assert.equal(up.strut, 1); assert.equal(up.door, 0);
  let prevStrut = 0, doorOpenWhileFolding = true;
  for (let g = 1; g >= 0; g -= 0.02) { const s = S(g); assert.ok(s.strut >= prevStrut - 1e-9, 'monotonic'); prevStrut = s.strut; if (s.strut > 0 && s.strut < 1 && s.door < 1 - 1e-9) doorOpenWhileFolding = false; }
  assert.ok(doorOpenWhileFolding, 'doors fully open while a leg moves');
  const wheel = (n) => worldBox(n).getCenter(new THREE.Vector3());
  fdm.onGround = false; fdm.compress = [0, 0, 0];
  fdm.gearPos = 1; upd(); const n0 = wheel('Wheel_Nose'), m0 = wheel('Wheel_Main_L');
  fdm.gearPos = 0.5; upd(); const nm = wheel('Wheel_Nose'), mm = wheel('Wheel_Main_L');
  assert.ok(nm.y > n0.y + 0.1 && nm.x > n0.x + 0.05, `nose wheel ${n0.toArray().map((x) => x.toFixed(2))} -> ${nm.toArray().map((x) => x.toFixed(2))}: up and forward`);
  assert.ok(mm.y > m0.y + 0.1 && Math.abs(mm.z) < Math.abs(m0.z) - 0.05, `main wheel ${m0.toArray().map((x) => x.toFixed(2))} -> ${mm.toArray().map((x) => x.toFixed(2))}: up and inboard`);
  assert.ok(Math.abs(v.movers.GearDoor_Nose_L.o.quaternion.angleTo(v.movers.GearDoor_Nose_L.rest) * 180 / Math.PI - 88) < 0.1, 'nose doors open mid-transit');
  fdm.gearPos = 0; upd();
  assert.equal(v.movers.Gear_Main_L.o.visible, false); assert.equal(v.movers.Gear_Main_R.o.visible, false); assert.equal(v.movers.Gear_Nose.o.visible, false);
  assert.ok(v.movers.GearDoor_Nose_L.o.quaternion.angleTo(v.movers.GearDoor_Nose_L.rest) < 1e-6, 'nose doors closed when up');
  fdm.gearPos = 1; upd(); assert.ok(v.movers.Gear_Nose.o.visible && v.movers.Gear_Main_R.o.visible);
  return `nose wheel y ${n0.y.toFixed(2)} -> ${nm.y.toFixed(2)} (half way), main wheel z ${m0.z.toFixed(2)} -> ${mm.z.toFixed(2)}`;
});
check('wheels roll forward with the flight model\'s wheel rates; struts hang longer in the air than compressed on the ground', () => {
  // the vertex that is the tyre's top at rest, followed through the spin (in the aircraft's frame)
  let pick = null; const at = () => { scene.updateMatrixWorld(true); if (!pick) { let best = null; v.nodes.Wheel_Main_L.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position, w = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (!best || w.y > best.w.y) best = { o, i, w: w.clone() }; } }); pick = best; }
    return v.root.worldToLocal(new THREE.Vector3().fromBufferAttribute(pick.o.geometry.attributes.position, pick.i).applyMatrix4(pick.o.matrixWorld)); };
  const top = () => at();
  fdm.wheel = [0, 0, 0]; fdm.compress = [0.08, 0.08, 0.08]; upd(); const t0 = top(), y0 = worldBox('Wheel_Main_L').min.y;
  fdm.wheel = [0, 20, 0]; upd('chase', day, 0.01); const t1 = top();
  assert.ok(t1.x > t0.x + 0.01 && Math.abs(t1.z - t0.z) < 1e-3, `top of the tyre moves forward: ${(t1.x - t0.x).toFixed(3)}`);
  fdm.wheel = [0, 0, 0]; fdm.compress = [0, 0, 0]; upd(); const y1 = worldBox('Wheel_Main_L').min.y;
  assert.ok(y1 < y0 - 0.05 && y1 > y0 - 0.15, `wheel bottom ${y0.toFixed(3)} -> ${y1.toFixed(3)}`);
  fdm.compress = [0.08, 0.08, 0.08];
  return `tyre top +${(t1.x - t0.x).toFixed(3)} m forward in 10 ms at 20 rad/s, struts ${(y0 - y1).toFixed(2)} m longer unloaded`;
});
check('sticks follow the controls (aft with up elevator, right with right aileron), the throttle lever goes forward with the thrust lever, the fan turns with N1', () => {
  const stick = () => worldBox('Stick_Pilot').getCenter(new THREE.Vector3());
  upd(); const s0 = stick(); fdm.surf.de = 1; upd(); const s1 = stick(); fdm.surf.de = 0; fdm.surf.da = 1; upd(); const s2 = stick(); fdm.surf.da = 0;
  assert.ok(s1.x < s0.x - 0.005, `stick aft: ${s0.x.toFixed(3)} -> ${s1.x.toFixed(3)}`); assert.ok(s2.z > s0.z + 0.005, `stick right: ${s0.z.toFixed(3)} -> ${s2.z.toFixed(3)}`);
  const th = () => worldBox('Throttle_Lever').getCenter(new THREE.Vector3());
  fdm.throttle = 0; upd(); const t0 = th(); fdm.throttle = 1; upd(); const t1 = th(); fdm.throttle = 0;
  assert.ok(t1.x > t0.x + 0.01, `throttle forward: ${t0.x.toFixed(3)} -> ${t1.x.toFixed(3)}`);
  const a0 = v.fanAng; fdm.engines[0].n1 = 80; upd('chase', day, 0.01); assert.ok(v.fanAng > a0, 'fan turns'); fdm.engines[0].n1 = 0;
  return `stick x ${s0.x.toFixed(2)} -> ${s1.x.toFixed(2)}, throttle x ${t0.x.toFixed(2)} -> ${t1.x.toFixed(2)}`;
});
check('interior: drawn in the cockpit view and when the camera is close, hidden for a distant outside view', () => {
  v.update(1 / 60, fdm, new THREE.Vector3(60, 5, 0), 'chase', day, 0); assert.equal(v.interior.visible, false);
  v.update(1 / 60, fdm, new THREE.Vector3(5, 2, 0), 'orbit', day, 0); assert.equal(v.interior.visible, true);
  v.update(1 / 60, fdm, new THREE.Vector3(60, 5, 0), 'cockpit', day, 0); assert.equal(v.interior.visible, true);
  upd(); return 'cabin only when it can be seen';
});
check('shadows: the exterior casts, the cabin and glazing do not; the ground shadow is a silhouette of the airframe, not a world-cascade caster', () => {
  let ext = 0, inter = 0, glass = 0;
  v.nodes.Exterior.traverse((o) => { if (o.isMesh && o.castShadow) ext++; });
  v.nodes.Interior.traverse((o) => { if (o.isMesh && o.castShadow) inter++; });
  let panes = 0; v.nodes.Glazing.traverse((o) => { if (o.isMesh && o.material.transparent) { panes++; if (o.castShadow || o.material.transmission > 0 || o.material.depthWrite) glass++; } });
  assert.ok(ext > 5 && inter === 0 && panes >= 1 && glass === 0, `exterior ${ext}, interior ${inter}, panes ${panes}, glazing problems ${glass}`);
  assert.ok(!v.casters.some((o) => o.layers.isEnabled(3)) && v.casters.length > 20 && v.casters.every((o) => o.layers.isEnabled(4)), 'casters in the silhouette layer only');
  const at = (alt) => { fdm.pos.y = SF50_CG.y + alt; upd(); return { vis: v.shadow.visible, p: v.shadow.position.clone(), op: v.shadow.material.uniforms.uOpacity.value, blur: v.shadow.material.uniforms.uBlur.value }; };
  const g = at(0), h = at(100), hi = at(1600); at(0);
  assert.ok(g.vis && g.op > 0.5, `on the ground: shown, opacity ${g.op}`); assert.ok(h.blur > g.blur * 5, 'softer with height'); assert.ok(!hi.vis, 'gone above 1500 m');
  assert.ok(Math.abs(g.p.y - 0.1) < 1e-6, 'just above the ground');
  return `${ext} casting exterior meshes, shadow blur ${(g.blur * 14).toFixed(3)} m on the ground`;
});
check('lights: nav steady, strobes flash twice per 1.2 s, landing light and ground cone at night only, taxi light on the ground', () => {
  let seen = 0; for (let i = 0; i < 120; i++) { upd(); if (v.lights.Light_Strobe_L.sp.visible) seen++; }
  assert.ok(seen > 4 && seen < 30, `strobe on ${seen}/120 frames`);
  fdm.pos.y = SF50_CG.y; fdm.onGround = true; fdm.gearPos = 1; upd('chase', day);
  assert.equal(v.landLight.intensity, 0); assert.equal(TERRAIN_UNIFORMS.uLand.value.w, 0); assert.ok(v.lights.Light_Nav_L.node.material.emissiveIntensity > 0, 'nav on');
  upd('chase', night); assert.ok(v.lights.Light_Taxi.node.material.emissiveIntensity > 0 && v.landLight.intensity > 10 && v.landLight.intensity < 80, `taxi spot ${v.landLight.intensity}`);
  assert.ok(TERRAIN_UNIFORMS.uLand.value.w > 0, 'ground cone');
  fdm.onGround = false; fdm.pos.y = SF50_CG.y + 120; upd('chase', night); const land = v.landLight.intensity;
  assert.ok(land > 80 && v.lights.Light_Landing_L.node.material.emissiveIntensity > 0, `landing light ${land}`);
  fdm.pos.y = SF50_CG.y + 3000; upd('chase', night); assert.equal(v.landLight.intensity, 0, 'off above 600 m');
  fdm.crashed = 'test'; upd('chase', night); assert.equal(v.lights.Light_Nav_L.node.material.emissiveIntensity, 0, 'dark after a crash'); fdm.crashed = false;
  fdm.pos.y = SF50_CG.y; fdm.onGround = true; upd();
  return `strobe ${seen}/120 frames, taxi spot ${v.landLight.intensity.toFixed(0)} -> landing ${land.toFixed(0)} cd`;
});
check('displays: the PFD/MFD redraw only in the cockpit view, alternately, never while paused; the GLB map is the fallback outside', () => {
  const D = v.displays, pfd = v.dispMat.pfd, glb = pfd.glb;
  const calls = { pfd: 0, mfd: 0 }; const dp = D.drawPFD.bind(D), dm = D.drawMFD.bind(D); D.drawPFD = (s) => { calls.pfd++; return dp(s); }; D.drawMFD = (s) => { calls.mfd++; return dm(s); };
  let fed = 0; const feed = () => { fed++; return { ias: 100 }; };
  for (let i = 0; i < 30; i++) upd('chase', day, 1 / 60, feed); assert.deepEqual([calls.pfd, calls.mfd, fed], [0, 0, 0], 'nothing drawn outside'); assert.equal(pfd.mat.emissiveMap, glb);
  upd('cockpit', day, 0, feed); assert.equal(calls.pfd + calls.mfd, 0, 'paused: no redraw'); assert.equal(pfd.mat.emissiveMap, v.dispTex.pfd, 'live canvas in the screen');
  for (let i = 0; i < 60; i++) upd('cockpit', day, 1 / 60, feed);
  const total = calls.pfd + calls.mfd; assert.ok(total >= 9 && total <= 12, `${total} redraws in 1 s`); assert.ok(calls.pfd > calls.mfd && calls.mfd >= 2, `PFD ${calls.pfd} : MFD ${calls.mfd}`); assert.equal(total, fed + 1, 'one feed per redraw (the first draws both screens)');
  // raw upload (an sRGB canvas upload is a slow path on Direct3D 11), decoded from sRGB in the screen's shader while the live canvas is shown
  assert.ok(v.dispTex.pfd.flipY === false && v.dispTex.pfd.colorSpace === THREE.NoColorSpace && v.dispTex.pfd.premultiplyAlpha && pfd.mat.userData.rawEmissive === true, 'raw canvas, shader decode on');
  assert.equal(v.cockpitTextures().length, 2);
  upd('chase', day, 1 / 60, feed); assert.equal(pfd.mat.emissiveMap, glb, 'GLB texture back outside'); assert.equal(pfd.mat.userData.rawEmissive, false, 'no decode on the GLB texture');
  D.drawPFD = dp; D.drawMFD = dm;
  return `${calls.pfd} PFD + ${calls.mfd} MFD redraws per second`;
});
check('display feed: air data, engine, configuration, pressurisation, navigation and alerts in the displays\' units', () => {
  const f = new SF50Model(); f.reset(new THREE.Vector3(0, 7620, 0), 90, 100, false, 0);
  f.step(1 / 60, () => -1e9, new THREE.Vector3());
  const feed = makeSF50Feed(), att = { pitch: 0.05, bank: 0.1, heading: 123 };
  const c = { att, casMs: 100, gsMs: 130, trkDeg: 125, flightT: 3725, hour: 14.5, settings: { windDir: 270, windSpd: 10 }, nav: { valid: true, ident: 'KSAC', course: 90, xtkNm: 0.4, distNm: 26, brgDeg: 90 },
    warn: { stall: true, lowFuel: true }, airports: [{ id: 'KSMF', brgDeg: 123, distNm: 10 }, { id: 'KSAC', brgDeg: 213, distNm: 5 }], com1Name: 'SAC TWR', ap: null };
  const s = feed(f, c, 0.1);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);
  near(s.ias, 100 * 1.944, 0.1, 'ias'); near(s.gs, 130 * 1.944, 0.1, 'gs'); near(s.alt, 25000, 3, 'alt'); near(s.pitch, 0.05 * 57.2958, 0.01, 'pitch');
  near(s.bank, 0.1 * 57.2958, 0.01, 'bank'); assert.equal(s.hdg, 123); assert.equal(s.trk, 125); assert.equal(s.crs, 90); assert.equal(s.wpt, 'KSAC'); near(s.dis, 26, 1e-9, 'dis');
  assert.equal(s.flt, '1:02:05'); assert.equal(s.utc, '14:30:00'); assert.equal(s.ete, '00:06'); near(s.windKt, 19.4, 0.1, 'wind'); assert.equal(s.windFrom, 270);
  assert.ok(s.n1 > 30 && s.n1 <= 100 && s.n2 > 60 && s.itt > 300 && s.thrust > 0 && s.ff > 10 && s.ff < 120, `engine n1 ${s.n1} itt ${s.itt} ff ${s.ff} gph`);
  near(s.fuelL + s.fuelR, 907 / 3.043, 1, 'fuel gal'); near(s.fobLb, 2000, 1, 'fob'); assert.ok(/^\d\+\d\d$/.test(s.endurance), s.endurance);
  assert.equal(s.gear, f.gearPos); assert.equal(s.flaps, flapFraction(f.flaps)); assert.ok(s.aoa >= 0 && s.aoa <= 1); assert.ok(s.oat < -25 && s.oat > -45, `oat ${s.oat}`);
  assert.equal(s.ap.ap, false); assert.equal(s.ap.fd, false); assert.equal(s.ap.yd, true, 'yaw damper on in flight');
  assert.deepEqual(s.alerts.map((a) => a.text), ['STALL', 'LOW FUEL']);
  // map: a bearing equal to the heading is straight ahead (up); 90 deg to the right of the nose is to the right
  assert.ok(Math.abs(s.airports[0].x) < 1e-9 && s.airports[0].y < -9.9, 'ahead is up'); near(s.airports[1].x, 5, 1e-6, 'right of the nose is +x');
  // pressurisation: sea level cabin on the ground, 8,000 ft at FL310, never more than 6.5 psi differential
  const lo = cabinAt(0), hi = cabinAt(31000), mid = cabinAt(20000);
  assert.ok(lo.cabAlt < 1 && lo.cabDiff < 0.01); assert.ok(hi.cabAlt > 7000 && hi.cabAlt < 9500 && Math.abs(hi.cabDiff - 6.5) < 0.01, `FL310: cabin ${hi.cabAlt}, diff ${hi.cabDiff}`); assert.ok(mid.cabAlt < hi.cabAlt);
  assert.deepEqual([flapFraction(0), flapFraction(15), flapFraction(39)], [0, 0.5, 1]);
  // autopilot state (when one is flying): annunciations and the selected values follow it
  const ap = { on: true, modes: { spd: true, mach: false, appr: false }, status: { lat: 'HDG', vert: 'ALT' }, target: { spd: 100, alt: 7620, hdg: 130 }, cmdHdg: 131 };
  const s2 = feed(f, { ...c, ap }, 0.1); assert.deepEqual([s2.ap.ap, s2.ap.at, s2.ap.lat, s2.ap.vert, s2.ap.fd], [true, 'SPD', 'HDG', 'ALT', true]); near(s2.selAlt, 25000, 3, 'selAlt'); assert.equal(s2.selHdg, 131);
  assert.deepEqual(alertsOf({ out: { gearOverspeed: true, flapOverspeed: true }, engineOn: true }, { warn: { gearUnsafe: true, overspeed: true } }).map((a) => a.level), ['warning', 'warning', 'caution', 'caution']);
  return `ias ${s.ias.toFixed(0)}, alt ${s.alt.toFixed(0)}, n1 ${s.n1.toFixed(0)}, ff ${s.ff.toFixed(0)} gph, cabin FL310 ${hi.cabAlt.toFixed(0)} ft`;
});
check('crash: the Vision Jet breaks up with its own sizing and clears', () => {
  const f = new SF50Model(); f.reset(new THREE.Vector3(0, SF50_CG.y + 60, 0), 90, 60, false, 0);
  f.crashVel = new THREE.Vector3(60, -30, 0); f.crashW = new THREE.Vector3(); f.crashInfo = { speed: 67, sinkRate: 30, pitch: -0.6 }; f.out = { M: 0.2, V: 67, nz: 1 };
  const w = new Wreck(scene); f.crashed = 'test';
  w.start(v, f, 'impact', { fuelCap: SF50.FUEL_MAX, speedRef: 110, sinkRef: 35, size: 0.45 }); const n = w.pieces.length, o = w.info.outcome, scale = w.scale; w.clear(v);
  assert.ok(n >= 3, `${n} pieces`); assert.ok(v.root.visible, 'airframe shown again after clear'); assert.equal(scale.fuelCap, 907); assert.equal(scale.size, 0.45);
  return `${n} pieces (${o}, ${w.severity})`;
});
check('cabin door: opens over ~3 s on command (main door first, baggage door after), the emergency exit stays shut, and it closes again', () => {
  const tip = (n) => worldBox(n).max.y;
  const m0 = tip('Door_Main'), b0 = tip('Door_Baggage'), e0 = tip('Door_Exit');
  v.setDoors(true); for (let i = 0; i < 60; i++) upd(); const mHalf = tip('Door_Main'), bHalf = tip('Door_Baggage');
  for (let i = 0; i < 180; i++) upd(); const m1 = tip('Door_Main'), b1 = tip('Door_Baggage'), e1 = tip('Door_Exit');
  assert.ok(m1 > m0 + 0.3 && b1 > b0 + 0.2, `door tops ${m0.toFixed(2)} -> ${m1.toFixed(2)}, baggage ${b0.toFixed(2)} -> ${b1.toFixed(2)} m`);
  assert.ok(mHalf - m0 > bHalf - b0, 'main door leads the baggage door'); assert.ok(Math.abs(e1 - e0) < 1e-6, 'emergency exit unmoved');
  v.setDoors(false); for (let i = 0; i < 240; i++) upd(); assert.ok(Math.abs(tip('Door_Main') - m0) < 1e-3, 'closed again');
  return `main door top ${m0.toFixed(2)} -> ${m1.toFixed(2)} m, baggage ${b0.toFixed(2)} -> ${b1.toFixed(2)} m`;
});
await vite.close();
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('sf50-visual-test ok');
