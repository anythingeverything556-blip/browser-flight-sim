// The Il-76 model contract (public/models/IL76_v6.glb, Draco-decoded in node): frame and size, static groups, every mover with well-formed extras, the optional
// sequencing extras, wheels on the ground with their centres and radii, glazing as plain alpha, and every mover posed to its limit and back to rest.
// The final model may add nodes (bogies, steering, levers); nodes the visual does not know are checked for the same extras, never required.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadModel } from './_glb-node.mjs';

let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const gltf = await loadModel('IL76_v6'), S = gltf.scene; S.updateMatrixWorld(true);
const N = {}; S.traverse((o) => { if (o.name && !N[o.name]) N[o.name] = o; });
const root = N.IL76, U = (n) => (N[n] ? N[n].userData : {});
const movers = Object.values(N).filter((o) => o.userData && (o.userData.hinge_axis || o.userData.slide_axis));
const box = (o) => new THREE.Box3().setFromObject(o);

check('root node: frame text, mapping to the simulator frame, MAC, nose offset and the wheel unit centres', () => {
  const u = root.userData; assert.ok(root && /\+Z nose/.test(u.frame) && /\+X left wing|port/.test(u.frame) && /ground y = 0/.test(u.frame), u.frame);
  assert.ok(/gl\.z, gl\.y, -gl\.x/.test(u.model_frame_mapping)); assert.ok(Math.abs(u.mac_m - 6.562) < 0.3 && u.mac_le_station_m > 18 && u.mac_le_station_m < 20 && Math.abs(u.nose_tip_ahead_of_origin_m - 20.98) < 0.1);
  for (const k of ['L1', 'L2', 'R1', 'R2']) { assert.equal(u[`wheel_main_${k}_centre_m`].length, 3); assert.equal(u[`wheel_main_${k}_count`], 4); } assert.equal(u.wheel_nose_count, 4); assert.ok(u.wheel_main_radius_m === 0.65 && u.wheel_nose_radius_m === 0.55);
  return `MAC ${u.mac_m} m, nose tip ${u.nose_tip_ahead_of_origin_m} m ahead of the origin`;
});
check('static groups Exterior, Interior and Glazing exist; glazing is plain alpha with no transmission', () => {
  for (const n of ['Exterior', 'Interior', 'Glazing']) assert.ok(N[n], n);
  const mats = []; N.Glazing.traverse((o) => { if (o.isMesh) mats.push(o.material); }); if (N.Glazing.isMesh) mats.push(N.Glazing.material);
  assert.ok(mats.length >= 1 && mats.every((m) => m.transparent && m.opacity <= 0.35 && !(m.transmission > 0)), mats.map((m) => `${m.opacity}`).join());
});
check('size and frame: 46.6 m long, 50.5 m span, wheels on y = 0, nose toward +z, port wing at +x, origin under 25 % MAC', () => {
  const b = box(N.Exterior), s = b.getSize(new THREE.Vector3());
  assert.ok(Math.abs(s.z - 46.6) < 0.3 && Math.abs(s.x - 50.5) < 0.3 && s.y > 13.5 && s.y < 14.5, s.toArray().join()); assert.ok(b.max.z > 20.5 && b.max.z < 21.5, `nose at ${b.max.z.toFixed(2)}`);
  assert.ok(box(N.Light_Nav_L).getCenter(new THREE.Vector3()).x > 20 && box(N.Light_Nav_R).getCenter(new THREE.Vector3()).x < -20, 'port light at +x');
  let lo = 1e9; for (const o of Object.values(N)) if (/^Wheel_/.test(o.name)) lo = Math.min(lo, box(o).min.y); assert.ok(Math.abs(lo) < 0.02, `tyre bottoms at y = ${lo.toFixed(3)}`);
  const mid = (b.min.z + b.max.z) / 2; assert.ok(mid < 0, 'the origin sits well forward of the fuselage middle');
});
check('20 wheels, each under a gear leg (or bogie / steering), with wheel_centre_m equal to its position and the tyre bottom on the ground', () => {
  const ws = Object.values(N).filter((o) => /^Wheel_/.test(o.name)); assert.equal(ws.length, 20);
  for (const w of ws) {
    const c = w.userData.wheel_centre_m, r = w.userData.wheel_radius_m; assert.ok(Array.isArray(c) && c.length === 3 && r > 0.5 && r < 0.7, w.name);
    const p = w.getWorldPosition(new THREE.Vector3()); assert.ok(Math.abs(p.x - c[0]) < 0.02 && Math.abs(p.y - c[1]) < 0.02 && Math.abs(p.z - c[2]) < 0.02, `${w.name} at ${p.toArray().map((x) => x.toFixed(2))} vs ${c}`);
    assert.ok(Math.abs(c[1] - r) < 0.01, `${w.name}: centre height equals the radius`);
    let leg = false; for (let q = w.parent; q; q = q.parent) if (/^Gear_(Nose|Main_[LR][12])$/.test(q.name)) leg = true; assert.ok(leg, `${w.name} hangs on a gear leg`);
  }
  return 'ok';
});
check('every mover has a unit hinge_axis with a numeric max_deg, or a slide_axis with max_m, and a sense text', () => {
  assert.ok(movers.length > 90, `${movers.length} movers`);
  for (const o of movers) { const u = o.userData; if (u.slide_axis) { assert.equal(u.slide_axis.length, 3); assert.ok(u.max_m > 0 && Math.abs(Math.hypot(...u.slide_axis) - 1) < 1e-3, o.name); } else { assert.ok(Math.abs(Math.hypot(...u.hinge_axis) - 1) < 1e-3 && typeof u.max_deg === 'number', o.name); } if (!/^Display_/.test(o.name)) assert.ok(typeof u.sense === 'string' && u.sense.length > 3, `${o.name} sense`); }
  const slides = movers.filter((o) => o.userData.slide_axis).map((o) => o.name); assert.ok(slides.filter((n) => /Engine_Reverser_/.test(n)).length === 4 && slides.some((n) => /Cargo_Hoist_/.test(n)), slides.join());
  return `${movers.length} movers, ${slides.length} sliding`;
});
check('required nodes: surfaces, doors, gear, engines, cockpit controls and lights', () => {
  const need = ['Ctrl_Aileron_L1', 'Ctrl_Aileron_L2', 'Ctrl_Aileron_R1', 'Ctrl_Aileron_R2', 'Ctrl_Flap_L1', 'Ctrl_Flap_L2', 'Ctrl_Flap_R1', 'Ctrl_Flap_R2', 'Ctrl_Elevator_L', 'Ctrl_Elevator_R', 'Ctrl_Rudder_Lower', 'Ctrl_Rudder_Upper',
    'Door_Crew_L', 'Door_Crew_R', 'Door_Paratroop_L', 'Door_Paratroop_R', 'Door_Ramp', 'Door_Clamshell_L', 'Door_Clamshell_R', 'Door_RearUpper', 'Gear_Nose', 'Gear_Main_L1', 'Gear_Main_L2', 'Gear_Main_R1', 'Gear_Main_R2',
    'Engine_Fan_1', 'Engine_Fan_2', 'Engine_Fan_3', 'Engine_Fan_4', 'Engine_Reverser_1', 'Engine_Reverser_2', 'Engine_Reverser_3', 'Engine_Reverser_4', 'Yoke_Pilot', 'Yoke_CoPilot', 'Throttle_Lever_1', 'Throttle_Lever_2', 'Throttle_Lever_3', 'Throttle_Lever_4',
    'Light_Nav_L', 'Light_Nav_R', 'Light_Strobe_L', 'Light_Strobe_R', 'Light_Landing_L', 'Light_Landing_R', 'Light_Taxi', 'Light_Beacon_Top', 'Light_Beacon_Bottom'];
  for (let i = 1; i <= 4; i++) need.push(`Ctrl_Slat_L${i}`, `Ctrl_Slat_R${i}`); for (let i = 1; i <= 5; i++) need.push(`Ctrl_Spoiler_L${i}`, `Ctrl_Spoiler_R${i}`);
  assert.deepEqual(need.filter((n) => !N[n]), []); assert.ok(Object.keys(N).filter((n) => /^GearDoor_/.test(n)).length === 10 && Object.keys(N).filter((n) => /^Ctrl_Tab_/.test(n)).length >= 4); return `${need.length} required nodes`;
});
check('optional sequencing extras are well formed: seq windows inside 0..1, opening before closing, bogies turning before the legs stow', () => {
  let n = 0;
  for (const o of movers) {
    const u = o.userData; if (u.seq_start === undefined) continue; n++;
    assert.ok(u.seq_start >= 0 && u.seq_end <= 1 && u.seq_start < u.seq_end, `${o.name} window ${u.seq_start}-${u.seq_end}`);
    if (u.seq_close_start !== undefined) assert.ok(u.seq_close_start >= u.seq_end - 1e-9 && u.seq_close_end <= 1 && u.seq_close_start < u.seq_close_end, `${o.name} closing window`);
  }
  for (const k of ['L1', 'L2', 'R1', 'R2']) { const leg = U(`Gear_Main_${k}`), bog = U(`Gear_Main_${k}_Bogie`); if (bog.seq_start !== undefined && leg.seq_start !== undefined) assert.ok(bog.seq_start <= leg.seq_start && bog.seq_end <= leg.seq_end + 1e-9, `${k}: the bogie turns first`); }
  if (U('Door_Ramp').seq_start !== undefined) assert.ok(U('Door_Clamshell_L').seq_start <= U('Door_Ramp').seq_start, 'cargo hatch: clamshell doors, then the ramp');
  return `${n} nodes carry seq extras`;
});
check('every mover can be posed to its limit and put back exactly at rest', () => {
  const _q = new THREE.Quaternion();
  for (const o of movers) {
    const u = o.userData, q0 = o.quaternion.clone(), p0 = o.position.clone();
    if (u.slide_axis) { o.position.copy(p0).addScaledVector(new THREE.Vector3(...u.slide_axis).normalize(), u.max_m); assert.ok(o.position.distanceTo(p0) > 0.3 * u.max_m, o.name); o.position.copy(p0); }
    else if (u.max_deg > 0) { o.quaternion.copy(q0).multiply(_q.setFromAxisAngle(new THREE.Vector3(...u.hinge_axis).normalize(), u.max_deg * Math.PI / 180)); assert.ok(o.quaternion.angleTo(q0) > 0.2 * u.max_deg * Math.PI / 180 * 0.5, o.name); o.quaternion.copy(q0); }
    assert.ok(o.quaternion.angleTo(q0) < 1e-12 && o.position.distanceTo(p0) < 1e-12, `${o.name} back at rest`);
  } return `${movers.length} movers`;
});
check('trailing edges move the documented way at the limit: surfaces down, spoilers up, slats down, ramp down, doors out, gear up, reversers aft', () => {
  const te = (n, f) => { const o = N[n]; o.updateMatrixWorld(true); const b0 = box(o); const m = o.userData; const q0 = o.quaternion.clone(), p0 = o.position.clone();
    if (m.slide_axis) o.position.addScaledVector(new THREE.Vector3(...m.slide_axis).normalize(), m.max_m); else o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.hinge_axis).normalize(), (f || 1) * m.max_deg * Math.PI / 180));
    o.updateMatrixWorld(true); const b1 = box(o); const d = b1.getCenter(new THREE.Vector3()).sub(b0.getCenter(new THREE.Vector3())); o.quaternion.copy(q0); o.position.copy(p0); o.updateMatrixWorld(true); return d; };
  // the surfaces' rounded noses rise as the trailing edge falls, so the box centre moves less than the edge itself
  assert.ok(te('Ctrl_Flap_L2').y < -0.5 && te('Ctrl_Flap_L1_Vane').z < -0.2 && te('Ctrl_Aileron_L1').y < -0.08 && te('Ctrl_Aileron_R2').y < -0.08 && te('Ctrl_Elevator_L').y < -0.08, 'flaps, ailerons, elevators trail down');
  assert.ok(te('Ctrl_Spoiler_L3').y > 0.05 && te('Ctrl_Slat_R2').y < -0.02, 'spoilers up, slats down'); assert.ok(te('Door_Ramp').y < -0.5, 'ramp lowers'); assert.ok(Math.abs(te('Door_Clamshell_L').x) > 0.3, 'clamshell door swings out');
  assert.ok(te('Gear_Main_L1').y > 0.5 && te('Gear_Nose').y > 0.2, 'gear swings up'); assert.ok(te('Engine_Reverser_1').z < -0.2, 'reverser sleeve slides aft');
  assert.ok(te('Ctrl_Rudder_Lower').x > 0.05, 'rudder trailing edge to port (+x)'); return 'ok';
});
check('live dials: the root lists each with a kind, a centre on the flight deck, unit facing and up vectors at right angles, and a radius', () => {
  const root = S.getObjectByName('IL76'), list = JSON.parse(root.userData.gauges); assert.ok(list.length >= 10, `${list.length} dials`);
  for (const g of list) { const n = new THREE.Vector3(...g.n), u = new THREE.Vector3(...g.u); assert.ok(/^[a-z]+$/.test(g.kind) && Math.abs(n.length() - 1) < 0.01 && Math.abs(u.length() - 1) < 0.01 && Math.abs(n.dot(u)) < 0.01 && g.r > 0.015 && g.r < 0.08, JSON.stringify(g)); assert.ok(g.c[1] > 2.5 && g.c[1] < 6.5 && g.c[2] < 0, `on the flight deck: ${g.c}`); }
  return `${list.length} dials: ${[...new Set(list.map((g) => g.kind))].join(', ')}`;
});
check('triangle and draw-call budget of the model (informational ceiling: 500k triangles, 200 draws)', () => {
  let tris = 0, draws = 0; S.traverse((o) => { if (o.isMesh) { draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  assert.ok(tris <= 500000 && draws <= 200, `${tris} triangles, ${draws} draws`); return `${Math.round(tris / 1000)}k triangles, ${draws} draws`;
});
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
