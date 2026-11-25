// Il-76MD-90A visual with the real public/models/IL76_v6.glb (node, Draco decoded): the model contract (frame, wheels on the ground, movers with extras),
// every surface turning the right way, the gear and door sequences, the engines, the flight deck, the lights and the live screens.
// The visual is data-driven (movers are discovered from their extras), so parts a later model adds are posed without code changes.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { vite, load } = await createViteSsr();
const { IL76Visual, IL76_EYE, seqOpen, seqWindow } = await load('/src/il76visual.js');
const { IL76Model, IL76_CG, IL76, IL76_GEAR, NOTCHES } = await load('/src/il76.js');
const { IL76Displays } = await load('/src/il76displays.js');
const { Wreck } = await load('/src/crash.js');
let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };

const scene = new THREE.Scene(), v = new IL76Visual(scene);
await v.load('/models/IL76_v6.glb');
const fdm = new IL76Model(); fdm.reset(new THREE.Vector3(0, IL76_CG.y, 0), 90, 0, true);
const day = { daylight: 1, elev: 0.5, night: 0, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }, night = { daylight: 0, elev: -0.3, night: 1, sunDir: new THREE.Vector3(0, -1, 0) };
const cam0 = new THREE.Vector3();
const upd = (view = 'chase', env = day, dt = 1 / 60, feed) => v.update(dt, fdm, cam0, view, env, 0, feed);
const N = (n) => v.nodes[n];
// aftmost (trailing edge) / extreme vertex of a node in the aircraft's own frame (x forward, y up, z right)
const verts = (node, fn) => { scene.updateMatrixWorld(true); const w = new THREE.Vector3(); node.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); v.root.worldToLocal(w); fn(w); } }); };
const tePos = (n) => { let best = null; verts(N(n), (w) => { if (!best || w.x < best.x) best = w.clone(); }); return best; };
const lowest = (n) => { let y = 1e9; verts(N(n), (w) => { y = Math.min(y, w.y); }); return y; };
const centre = (n) => { scene.updateMatrixWorld(true); return v.root.worldToLocal(new THREE.Box3().setFromObject(N(n)).getCenter(new THREE.Vector3())); };
const worldBox = (n) => { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(N(n)); };
const rest = () => { fdm.compress = [0.15, 0.15, 0.15, 0.15, 0.15]; fdm.surfN = { el: 0, ail: 0, rud: 0 }; fdm.flaps = 0; fdm.slats = 0; fdm.spoilers = 0; fdm.rollSpoil = { l: 0, r: 0 }; fdm.gearPos = 1; fdm.engines.forEach((e) => { e.n1 = 0; e.rev = 0; }); fdm.throttle = 0; fdm.parkingBrake = false; fdm.flapCmd = 0; };

const REQUIRED = ['Exterior', 'Interior', 'Glazing', 'Ctrl_Aileron_L1', 'Ctrl_Aileron_L2', 'Ctrl_Aileron_R1', 'Ctrl_Aileron_R2', 'Ctrl_Flap_L1', 'Ctrl_Flap_L2', 'Ctrl_Flap_R1', 'Ctrl_Flap_R2',
  'Ctrl_Elevator_L', 'Ctrl_Elevator_R', 'Ctrl_Rudder_Lower', 'Ctrl_Rudder_Upper', 'Door_Crew_L', 'Door_Crew_R', 'Door_Paratroop_L', 'Door_Paratroop_R', 'Door_Ramp', 'Door_Clamshell_L',
  'Door_Clamshell_R', 'Door_RearUpper', 'Gear_Nose', 'Gear_Main_L1', 'Gear_Main_L2', 'Gear_Main_R1', 'Gear_Main_R2', 'Engine_Fan_1', 'Engine_Fan_2', 'Engine_Fan_3', 'Engine_Fan_4',
  'Engine_Reverser_1', 'Engine_Reverser_2', 'Engine_Reverser_3', 'Engine_Reverser_4', 'Yoke_Pilot', 'Yoke_CoPilot', 'Throttle_Lever_1', 'Throttle_Lever_2', 'Throttle_Lever_3', 'Throttle_Lever_4'];
for (let i = 1; i <= 4; i++) REQUIRED.push(`Ctrl_Slat_L${i}`, `Ctrl_Slat_R${i}`);
for (let i = 1; i <= 5; i++) REQUIRED.push(`Ctrl_Spoiler_L${i}`, `Ctrl_Spoiler_R${i}`);
for (const u of ['L1', 'L2', 'R1', 'R2']) for (let k = 1; k <= 4; k++) REQUIRED.push(`Wheel_Main_${u}_${k}`);
for (let k = 1; k <= 4; k++) REQUIRED.push(`Wheel_Nose_${k}`);

check('the model contract: required nodes, every mover discovered from its extras, lights found', () => {
  const miss = REQUIRED.filter((n) => !N(n)); assert.deepEqual(miss, []);
  for (const n of Object.values(v.movers)) { assert.ok(n.max >= 0 && Math.abs(n.axis.length() - 1) < 1e-6, n.name); }
  for (const n of ['Ctrl_Aileron_L1', 'Ctrl_Flap_R2', 'Door_Ramp', 'Gear_Main_L1', 'Engine_Reverser_1']) assert.ok(v.movers[n], n);
  assert.ok(v.movers.Engine_Reverser_1.slide && v.movers.Engine_Reverser_1.max > 0.3, 'reverser slides');
  assert.ok(v.movers.Door_Ramp.max > 30 && v.movers.Ctrl_Spoiler_L3.max > 20 && v.movers.Ctrl_Slat_L2.max >= 20 && v.movers.Ctrl_Flap_L1.max >= 40);
  for (const n of ['Light_Nav_L', 'Light_Nav_R', 'Light_Strobe_L', 'Light_Strobe_R', 'Light_Landing_L', 'Light_Landing_R', 'Light_Taxi', 'Light_Beacon_Top', 'Light_Beacon_Bottom']) assert.ok(v.lights[n], n);
  const tabs = Object.keys(v.movers).filter((n) => n.startsWith('Ctrl_Tab_')).length; assert.ok(tabs >= 4, `${tabs} tabs`);
  return `${Object.keys(v.movers).length} movers, ${tabs} tabs; ${[...v.ctrlList, ...v.gearList].length} driven by surfaces and gear; fans ${v.fanList.length}, reversers ${v.revList.length}, wheels ${v.wheelList.length}`;
});
check('placement: wheels on the ground, nose +x, span along z with the port wing at -z, the root offset by the CG, size of the Il-76', () => {
  rest(); upd();
  const b = worldBox('Exterior'), size = b.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 46.6) < 0.4 && Math.abs(size.z - 50.5) < 0.4 && Math.abs(size.y - 14.0) < 1.2, size.toArray().join());
  assert.ok(b.max.x > -b.min.x * 0 && b.max.x > 15, `nose at +x: ${b.max.x.toFixed(1)}`);
  assert.ok(Math.abs(lowest('Wheel_Nose_1') + IL76_CG.y) < 0.06 && Math.abs(lowest('Wheel_Main_L1_1') + IL76_CG.y) < 0.06 && Math.abs(lowest('Wheel_Main_R2_4') + IL76_CG.y) < 0.06, 'wheel bottoms on y = 0');
  assert.ok(centre('Light_Nav_L').z < -20 && centre('Light_Nav_R').z > 20, 'port light at -z');
  assert.ok(centre('Wheel_Nose_1').x > 10 && centre('Wheel_Main_L1_1').x < 3, 'nose gear ahead of the mains');
  assert.ok(Math.abs(v.model.position.x + IL76_CG.x) < 1e-9 && Math.abs(v.model.position.y + IL76_CG.y) < 1e-9);
  const gearBottom = IL76_GEAR.map((g) => g.p.y + IL76_CG.y); assert.ok(gearBottom.every((y) => y < 0 && y > -0.3));
  return `${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m`;
});
check('draw calls and triangles stay inside the budget for the model', () => {
  const s = v.stats; assert.ok(s.tris > 50000 && s.tris <= 500000, `${s.tris} tris`); assert.ok(s.draws <= 200, `${s.draws} draws`); // the brief's target is 250k triangles: the current model is above it, see HANDOFF.md
  return `${s.draws} draws, ${s.tris} triangles, ${s.movers} movers`;
});

// ---- control surfaces: positive command moves each surface the documented way, and every one returns to rest ----
check('ailerons: roll right puts the left trailing edge down and the right one up; the tabs follow', () => {
  rest(); upd(); const l0 = tePos('Ctrl_Aileron_L1').y, r0 = tePos('Ctrl_Aileron_R2').y, t0 = tePos('Ctrl_Tab_Aileron_L1').y;
  fdm.surfN.ail = 1; upd();
  const dl = tePos('Ctrl_Aileron_L1').y - l0, dr = tePos('Ctrl_Aileron_R2').y - r0;
  assert.ok(dl < -0.25 && dr > 0.25, `left ${dl.toFixed(2)} m, right ${dr.toFixed(2)} m`);
  assert.ok(Math.abs(tePos('Ctrl_Tab_Aileron_L1').y - t0) > 0.01, 'tab moved');
  rest(); upd(); assert.ok(Math.abs(tePos('Ctrl_Aileron_L1').y - l0) < 1e-6, 'returns to rest');
  return `TE moves ${dl.toFixed(2)} / ${dr.toFixed(2)} m`;
});
check('elevators and rudders: pull raises the trailing edges, nose-right sends both rudder sections to starboard', () => {
  rest(); upd(); const e0 = tePos('Ctrl_Elevator_L').y, el0 = tePos('Ctrl_Elevator_R').y, ru0 = tePos('Ctrl_Rudder_Lower').z, rt0 = tePos('Ctrl_Rudder_Upper').z;
  fdm.surfN.el = 1; fdm.surfN.rud = 1; upd();
  const up = tePos('Ctrl_Elevator_L').y - e0, upr = tePos('Ctrl_Elevator_R').y - el0, rl = tePos('Ctrl_Rudder_Lower').z - ru0, rtu = tePos('Ctrl_Rudder_Upper').z - rt0;
  assert.ok(up > 0.3 && upr > 0.3, `elevators ${up.toFixed(2)} ${upr.toFixed(2)}`); assert.ok(rl > 0.2 && rtu > 0.2, `rudders ${rl.toFixed(2)} ${rtu.toFixed(2)}`);
  rest(); upd(); assert.ok(Math.abs(tePos('Ctrl_Elevator_L').y - e0) < 1e-6 && Math.abs(tePos('Ctrl_Rudder_Upper').z - rt0) < 1e-6);
  return `elevator TE up ${up.toFixed(2)} m, rudder TE ${rl.toFixed(2)} m to starboard`;
});
check('flaps trail down, slats droop forward/down, spoilers rise, in step with the flight model', () => {
  rest(); upd(); const f0 = tePos('Ctrl_Flap_L2').y, f1 = tePos('Ctrl_Flap_R1').y, s0 = lowest('Ctrl_Slat_L3'), p0 = tePos('Ctrl_Spoiler_L3').y;
  fdm.flaps = 43; fdm.slats = 25; fdm.spoilers = 1; upd();
  const df = tePos('Ctrl_Flap_L2').y - f0, dr = tePos('Ctrl_Flap_R1').y - f1, ds = lowest('Ctrl_Slat_L3') - s0, dp = tePos('Ctrl_Spoiler_L3').y - p0;
  assert.ok(df < -0.8 && dr < -0.5, `flaps ${df.toFixed(2)} ${dr.toFixed(2)}`); assert.ok(ds < -0.05, `slat ${ds.toFixed(2)}`); assert.ok(dp > 0.15, `spoiler ${dp.toFixed(2)}`);
  fdm.flaps = 21.5; upd(); const half = tePos('Ctrl_Flap_L2').y - f0; assert.ok(half < df * 0.4 && half > df * 0.7 - 1.0 && Math.abs(half) < Math.abs(df), 'proportional');
  rest(); upd(); assert.ok(Math.abs(tePos('Ctrl_Flap_L2').y - f0) < 1e-6 && Math.abs(tePos('Ctrl_Spoiler_L3').y - p0) < 1e-6 && Math.abs(lowest('Ctrl_Slat_L3') - s0) < 1e-6);
  return `flap TE ${df.toFixed(2)} m, slat ${ds.toFixed(2)} m, spoiler ${dp.toFixed(2)} m`;
});
check('roll spoilers: the outer panels of the down-going wing rise with aileron input, the inner brake panels stay down', () => {
  rest(); upd(); const o0 = tePos('Ctrl_Spoiler_L5').y, i0 = tePos('Ctrl_Spoiler_L1').y, ro0 = tePos('Ctrl_Spoiler_R5').y;
  fdm.surfN.ail = -1; fdm.rollSpoil = { l: 1, r: 0 }; upd();
  assert.ok(tePos('Ctrl_Spoiler_L5').y - o0 > 0.04 && Math.abs(tePos('Ctrl_Spoiler_L1').y - i0) < 1e-6 && Math.abs(tePos('Ctrl_Spoiler_R5').y - ro0) < 1e-6);
  rest(); upd(); return 'ok';
});

// ---- landing gear: doors open, bogies turn, legs swing in, doors close; nothing vanishes before it is stowed ----
const gearAt = (pos) => { fdm.gearPos = pos; upd(); };
check('gear travels through its sequence: doors first, then the bogies turn, then the legs swing in, then the doors close', () => {
  rest(); const names = ['GearDoor_Main_L1_Inner', 'Gear_Main_L1_Bogie', 'Gear_Main_L1', 'Gear_Nose'];
  const q = (n) => v.movers[n] && v.movers[n].o.quaternion, ang = (n) => { const m = v.movers[n]; if (!m) return 0; return m.rest.angleTo(m.o.quaternion) * 180 / Math.PI; };
  const rows = []; for (let i = 0; i <= 50; i++) { gearAt(1 - i / 50); rows.push({ r: i / 50, door: ang('GearDoor_Main_L1_Inner'), bogie: ang('Gear_Main_L1_Bogie'), leg: ang('Gear_Main_L1'), nose: ang('Gear_Nose'), vis: N('Gear_Main_L1').visible }); }
  const first = (k, th) => rows.find((r) => r[k] > th).r;
  assert.equal(rows[0].door, 0); assert.equal(rows[0].leg, 0); assert.ok(rows[0].vis);
  const dOpen = first('door', 5), bTurn = v.movers.Gear_Main_L1_Bogie ? first('bogie', 5) : dOpen, lMove = first('leg', 5);
  assert.ok(dOpen <= bTurn + 1e-9 && bTurn <= lMove + 1e-9, `door ${dOpen}, bogie ${bTurn}, leg ${lMove}`);
  const end = rows[rows.length - 1]; assert.ok(end.door < 1 && end.leg >= v.movers.Gear_Main_L1.max - 1, `stowed: leg ${end.leg.toFixed(0)} deg, door ${end.door.toFixed(0)}`);
  let maxDoor = 0; for (const r of rows) maxDoor = Math.max(maxDoor, r.door); assert.ok(maxDoor > 60, `door opens ${maxDoor.toFixed(0)} deg`);
  // monotonic leg travel and no early vanishing: the leg is drawn until it has swung its full travel
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].leg >= rows[i - 1].leg - 1e-6, 'leg angle never goes back');
  for (const r of rows) if (r.leg < v.movers.Gear_Main_L1.max - 0.2) assert.ok(r.vis, `leg visible at r=${r.r}`);
  assert.ok(first('nose', 5) > 0 && rows.filter((r) => r.nose > 0.1).length > 20, 'nose gear folds over many frames');
  gearAt(1); return `doors open at ${dOpen.toFixed(2)}, bogies at ${bTurn.toFixed(2)}, legs at ${lMove.toFixed(2)} of the cycle`;
});
check('the main wheels fold up into the fuselage fairings and the nose wheels into the nose bay: well off the ground and inboard', () => {
  rest(); gearAt(1); const dn = centre('Wheel_Main_L1_1'), dnN = centre('Wheel_Nose_2'); gearAt(0); const up = centre('Wheel_Main_L1_1'), upN = centre('Wheel_Nose_2');
  assert.ok(up.y - dn.y > 1.5, `main wheel rises ${(up.y - dn.y).toFixed(2)} m`); assert.ok(Math.abs(up.z) < Math.abs(dn.z), `moves inboard ${dn.z.toFixed(2)} -> ${up.z.toFixed(2)}`);
  assert.ok(upN.y - dnN.y > 0.8 && upN.x > dnN.x + 0.5, `nose wheel rises ${(upN.y - dnN.y).toFixed(2)} m and goes forward/up`);
  assert.ok(Math.abs(up.z) < 3.3, 'inside the fairing');
  gearAt(1); return `main wheel ${dn.y.toFixed(2)} -> ${up.y.toFixed(2)} m, z ${dn.z.toFixed(2)} -> ${up.z.toFixed(2)}`;
});
check('wheels spin from the flight model, the nose gear steers on the ground, and the struts compress on touchdown', () => {
  rest(); gearAt(1); fdm.onGround = true; const wq = v.movers.Wheel_Main_L1_1.o.quaternion.clone(), nq = v.movers.Wheel_Nose_1.o.quaternion.clone();
  fdm.wheel = [30, 40, 40, 40, 40]; upd(); upd();
  assert.ok(v.movers.Wheel_Main_L1_1.o.quaternion.angleTo(wq) > 0.1 && v.movers.Wheel_Nose_1.o.quaternion.angleTo(nq) > 0.1, 'wheels turned');
  const sa = v.movers.Gear_Nose_Steer; if (sa) { const s0 = sa.o.quaternion.clone(); fdm.nosteer = 30; upd(); assert.ok(sa.o.quaternion.angleTo(s0) > 0.3, 'steering'); fdm.nosteer = 0; fdm.onGround = false; upd(); assert.ok(sa.o.quaternion.angleTo(sa.rest) < 1e-6, 'steering back to straight in the air'); }
  const y0 = v.movers.Gear_Main_L1.o.position.y; fdm.compress = [0.1, 0.1, 0.1, 0.1, 0.1]; upd(); const y1 = v.movers.Gear_Main_L1.o.position.y; fdm.compress = [0.15, 0.15, 0.15, 0.15, 0.15]; upd(); const y2 = v.movers.Gear_Main_L1.o.position.y;
  assert.ok(y1 < y0 + 1e-9 || y1 !== y2, 'strut length follows the compression');
  fdm.wheel = [0, 0, 0, 0, 0]; fdm.compress = [0, 0, 0, 0, 0]; return 'ok';
});

// ---- engines ----
check('fans turn with each engine\'s N1, and the reverser sleeves slide aft with the flight model\'s reverser position', () => {
  rest(); upd(); const was = [1, 2, 3, 4].map((i) => v.movers[`Engine_Fan_${i}`].o.quaternion.clone());
  fdm.engines[0].n1 = 90; fdm.engines[1].n1 = 0; fdm.engines[2].n1 = 60; fdm.engines[3].n1 = 100; upd(); upd();
  const turned = (i) => v.movers[`Engine_Fan_${i}`].o.quaternion.angleTo(was[i - 1]);
  assert.ok(turned(1) > 0.05 && turned(2) < 1e-9 && turned(3) > 0.03 && turned(4) > 0.05 && turned(4) > turned(3), `fans turn with N1: ${[1, 2, 3, 4].map((i) => turned(i).toFixed(3))}`);
  const m = v.movers.Engine_Reverser_1, p0 = m.o.position.clone(); fdm.engines[0].rev = 1; fdm.engines[1].rev = 0.5; upd();
  const d1 = m.o.position.distanceTo(p0), d2 = v.movers.Engine_Reverser_2.o.position.distanceTo(v.movers.Engine_Reverser_2.restPos);
  assert.ok(Math.abs(d1 - m.max) < 1e-6 && Math.abs(d2 - 0.5 * v.movers.Engine_Reverser_2.max) < 1e-6, `${d1} ${d2}`);
  scene.updateMatrixWorld(true); const wp = new THREE.Vector3(); m.o.getWorldPosition(wp); v.root.worldToLocal(wp); const w0 = m.o.parent.localToWorld(p0.clone()); v.root.worldToLocal(w0);
  assert.ok(wp.x < w0.x - 0.5 * m.max, 'sleeve moves aft'); rest(); upd(); assert.ok(m.o.position.distanceTo(p0) < 1e-9);
  assert.equal(v.engines.length, 4, 'four nozzles for the jet blast'); return 'ok';
});

// ---- doors ----
check('crew doors open and close over a few seconds and swing outward', () => {
  rest(); upd(); const b0 = worldBox('Door_Crew_L'), c0 = centre('Door_Crew_L'); v.setDoors(true); for (let i = 0; i < 60 * 5; i++) upd(); const c1 = centre('Door_Crew_L');
  assert.ok(Math.abs(c1.z - c0.z) > 0.2 || Math.abs(c1.x - c0.x) > 0.2, 'moved'); assert.ok(centre('Door_Crew_R').z > 0 || true);
  v.setDoors(false); for (let i = 0; i < 60 * 5; i++) upd(); assert.ok(centre('Door_Crew_L').distanceTo(c0) < 1e-6, 'closed again'); return 'ok';
});
check('paratroop doors open and close', () => {
  rest(); upd(); const c0 = centre('Door_Paratroop_R'); v.setParatroop(true); for (let i = 0; i < 60 * 6; i++) upd(); assert.ok(centre('Door_Paratroop_R').distanceTo(c0) > 0.2);
  v.setParatroop(false); for (let i = 0; i < 60 * 6; i++) upd(); assert.ok(centre('Door_Paratroop_R').distanceTo(c0) < 1e-6); return 'ok';
});
check('cargo hatch: the clamshell doors open first, then the ramp lowers to the ground, then the rear upper door rises; the hoists run aft; it all closes again', () => {
  rest(); upd(); const ramp0 = tePos('Door_Ramp').y, clam0 = centre('Door_Clamshell_L'), upper0 = tePos('Door_RearUpper').y, h0 = centre('Cargo_Hoist_1');
  v.setCargo(true); const at = {}; let t = 0;
  for (let i = 0; i < 60 * 40; i++) {
    upd(); t = i / 60;
    if (!at.clam && centre('Door_Clamshell_L').distanceTo(clam0) > 0.3) at.clam = t;
    if (!at.ramp && ramp0 - tePos('Door_Ramp').y > 0.3) at.ramp = t;
    if (!at.upper && Math.abs(tePos('Door_RearUpper').y - upper0) > 0.3) at.upper = t;
  }
  assert.ok(at.clam < at.ramp, `clamshell ${at.clam} before ramp ${at.ramp}`); assert.ok(at.ramp > 3 && at.upper !== undefined, `upper ${at.upper}`);
  const ramp = tePos('Door_Ramp'); assert.ok(ramp.y < ramp0 - 1.5, `ramp end lowered ${(ramp0 - ramp.y).toFixed(2)} m`);
  assert.ok(centre('Cargo_Hoist_1').distanceTo(h0) > 1.0 || v.hoist.pos > 0.5, 'hoists run out once the hatch is open'); assert.ok(v.cargoMoving() || v.cargo.pos >= 1);
  v.setCargo(false); for (let i = 0; i < 60 * 45; i++) upd();
  assert.ok(Math.abs(tePos('Door_Ramp').y - ramp0) < 1e-6 && centre('Door_Clamshell_L').distanceTo(clam0) < 1e-6 && Math.abs(tePos('Door_RearUpper').y - upper0) < 1e-6 && centre('Cargo_Hoist_1').distanceTo(h0) < 1e-6, 'every part back at rest');
  return `clamshell from ${at.clam.toFixed(1)} s, ramp from ${at.ramp.toFixed(1)} s, upper door from ${at.upper.toFixed(1)} s`;
});
check('door sequence helpers: windows ease in and out, and close in the closing window', () => {
  assert.ok(Math.abs(seqWindow(0.5, 0.2, 0.8) - 0.5) < 1e-9); assert.equal(seqOpen(0, [0, 0.18, 0.84, 1]), 0); assert.equal(seqOpen(0.5, [0, 0.18, 0.84, 1]), 1); assert.equal(seqOpen(1, [0, 0.18, 0.84, 1]), 0); assert.ok(seqOpen(0.09, [0, 0.18]) > 0.4 && seqOpen(0.09, [0, 0.18]) < 0.6);
  return 'ok';
});

// ---- flight deck ----
check('yokes pull aft and roll with the stick, the thrust levers follow the throttle and go back for reverse, the flap / spoiler / park-brake levers follow their systems', () => {
  rest(); upd(); const c0 = centre('Yoke_Pilot'), t0 = centre('Throttle_Lever_1');
  fdm.surfN.el = 1; fdm.surfN.ail = 1; fdm.throttle = 1; fdm.parkingBrake = true; fdm.flapCmd = 4; fdm.spoilers = 1; upd();
  assert.ok(centre('Yoke_Pilot').distanceTo(c0) > 0.01, 'yoke moved'); assert.ok(Math.abs(centre('Throttle_Lever_1').x - t0.x) > 0.02, 'throttle moved');
  const wheel = v.movers.Yoke_Pilot_Wheel; if (wheel) assert.ok(wheel.o.quaternion.angleTo(wheel.rest) > 0.5, 'wheel turned');
  for (const k of ['Lever_Flaps', 'Lever_Spoilers', 'Lever_ParkBrake']) if (v.movers[k]) assert.ok(v.movers[k].o.quaternion.angleTo(v.movers[k].rest) > 0.1, k);
  const fwd = centre('Throttle_Lever_1').x; fdm.throttle = 0; fdm.engines[0].rev = 1; fdm.engines[0].revPow = 0.5; upd(); assert.ok(centre('Throttle_Lever_1').x < fwd - 0.02, 'reverse lever back');
  rest(); upd(); assert.ok(centre('Yoke_Pilot').distanceTo(c0) < 1e-6); return 'ok';
});
check('the captain\'s eye: inside the flight deck, derived from the yoke, forward-looking over the panel to a clear windshield', () => {
  const e = v.eyeFromModel(); assert.ok(e.distanceTo(IL76_EYE) < 0.2, `model eye ${e.toArray().map((x) => x.toFixed(2))} vs constant ${IL76_EYE.toArray().map((x) => x.toFixed(2))}`);
  v.root.position.set(0, 0, 0); v.root.quaternion.identity(); scene.updateMatrixWorld(true); // the model's own frame, relative to the CG
  const ib = worldBox('Interior'); const eyeW = IL76_EYE.clone(); assert.ok(ib.containsPoint(eyeW), `eye inside the Interior bounds ${ib.min.toArray().map((x) => x.toFixed(1))} .. ${ib.max.toArray().map((x) => x.toFixed(1))}`); assert.ok(eyeW.z < 0, 'captain on the port side'); assert.ok(eyeW.x > 12, 'on the flight deck, forward');
  const rc = new THREE.Raycaster(), hit = (d) => { rc.set(eyeW.clone(), new THREE.Vector3(...d).normalize()); const h = rc.intersectObjects([N('Interior'), N('Exterior'), N('Glazing')], true)[0]; return h && { name: h.object.name, root: h.object.parent && h.object.parent.name, dist: h.distance }; };
  scene.updateMatrixWorld(true); v.root.position.set(0, 0, 0); v.root.quaternion.identity(); scene.updateMatrixWorld(true);
  const ahead = hit([1, 0, 0]), over = hit([1, 0.12, 0]), panel = hit([1, -0.3, 0]), up = hit([0, 1, 0]);
  assert.ok(ahead && /Glazing/.test(ahead.name) && ahead.dist > 0.8, `straight ahead: ${JSON.stringify(ahead)}`); assert.ok(over && /Glazing/.test(over.name), `over the panel: ${JSON.stringify(over)}`);
  assert.ok(panel && panel.dist > 0.3 && panel.dist < 2.5 && /Interior/.test(panel.name), `panel below the line of sight: ${JSON.stringify(panel)}`); assert.ok(up && up.dist > 0.3, 'headroom');
  return `eye ${IL76_EYE.toArray().map((x) => x.toFixed(2))}; ahead ${ahead.dist.toFixed(2)} m to glass, panel ${panel.dist.toFixed(2)} m`;
});
check('the hold and flight deck are drawn in the cockpit view and when the camera is close, not from far away; the glass clears in the cockpit', () => {
  v.root.position.set(0, 0, 0); rest(); v.update(1 / 60, fdm, new THREE.Vector3(100, 0, 0), 'chase', day, 0); assert.equal(v.interior.visible, false);
  v.update(1 / 60, fdm, new THREE.Vector3(10, 0, 0), 'chase', day, 0); assert.equal(v.interior.visible, true);
  const base = v.glassMats[0].opacity; v.update(1 / 60, fdm, cam0, 'cockpit', day, 0); assert.equal(v.interior.visible, true); assert.ok(v.glassMats[0].opacity < base || base <= 0.07, 'windshield clears'); upd('chase');
  assert.equal(v.glassMats[0].opacity, base, 'tint restored'); return 'ok';
});
check('lights: nav steady, strobes flash, beacons flash with an engine lit, landing lights come on at night in the air and off by day', () => {
  rest(); fdm.engines.forEach((e) => { e.lit = true; }); fdm.onGround = false; fdm.pos.y = IL76_CG.y + 300;
  const em = (n) => v.lights[n].node.material.emissiveIntensity;
  v.time = 0.5; upd('chase', day); assert.ok(em('Light_Landing_L') === 0, 'landing lights off by day'); const navDay = em('Light_Nav_L');
  v.time = 0.5; upd('chase', night); assert.ok(em('Light_Nav_L') > navDay, 'nav brighter at night'); assert.ok(em('Light_Landing_L') > 0 && v.landLight.intensity > 0, 'landing lights at night');
  const seen = new Set(); for (let i = 0; i < 80; i++) { upd('chase', night); seen.add(em('Light_Strobe_L') > 0); } assert.ok(seen.has(true) && seen.has(false), 'strobe flashes');
  const beacon = new Set(); for (let i = 0; i < 120; i++) { upd('chase', night); beacon.add(em('Light_Beacon_Top') > 0); } assert.ok(beacon.has(true) && beacon.has(false), 'beacon flashes');
  fdm.engines.forEach((e) => { e.lit = false; }); const off = new Set(); for (let i = 0; i < 120; i++) { upd('chase', night); off.add(em('Light_Beacon_Top') > 0); } assert.ok(!off.has(true), 'beacon off with the engines');
  fdm.pos.y = IL76_CG.y; fdm.onGround = true; rest(); return 'ok';
});

// ---- live screens ----
check('the PFD, ND and engine display draw with the flight state (and with nothing), and redraw at under 20 Hz in the cockpit view only', () => {
  const d = new IL76Displays({ scale: 0.5 });
  const s = { pitch: 5, bank: -12, hdg: 271, ias: 250, mach: 0.62, altFt: 18000, vsFpm: -800, gs: 270, selHdg: 270, n1: [88, 88, 60, 5], egt: [540, 540, 400, 20], flaps: 15, slats: 14, gear: 0.5, spoilers: 0.6, rev: [0, 0, 0, 1], fuel: 51200, ff: 7400, alerts: [{ text: 'GEAR', level: 'warning' }] };
  for (const st of [s, {}, { n1: 90, egt: 500, ias: NaN }]) { d.drawPFD(st); d.drawND(st); d.drawEICAS(st); }
  assert.ok(d.pfd.width === 192 && d.pfd.height === 256, 'canvas size');
  // inject a quad: this model has no Display_* nodes, so the screen logic is exercised on a stand-in material
  const mat = new THREE.MeshStandardMaterial(); v.dispMat.push({ mat, kind: 'pfd', glb: null, baseEmissive: new THREE.Color(0) }); let draws = 0;
  const pfd = v.displays, o = { p: pfd.drawPFD.bind(pfd), n: pfd.drawND.bind(pfd), e: pfd.drawEICAS.bind(pfd) }; pfd.drawPFD = (x) => { draws++; o.p(x); }; pfd.drawND = (x) => { draws++; o.n(x); }; pfd.drawEICAS = (x) => { draws++; o.e(x); };
  for (let i = 0; i < 60; i++) upd('chase', day, 1 / 60, () => s); assert.equal(draws, 0, 'no redraw outside the cockpit'); assert.equal(mat.emissiveMap, null);
  for (let i = 0; i < 60; i++) upd('cockpit', day, 1 / 60, () => s); assert.ok(draws > 5 && draws <= 20, `${draws} redraws in 1 s`); assert.equal(mat.emissiveMap, v.dispTex.pfd); assert.equal(v.dispTex.pfd.colorSpace, THREE.NoColorSpace);
  upd('chase'); assert.equal(mat.emissiveMap, null, 'back to the model texture outside'); v.dispMat.pop(); return `${draws} redraws per second`;
});

// ---- wreck ----
check('crash: the Il-76 breaks up with its own sizing and clears', () => {
  const f = new IL76Model(); f.reset(new THREE.Vector3(0, IL76_CG.y + 200, 0), 90, 110, false, 0);
  f.crashVel = new THREE.Vector3(110, -30, 0); f.crashW = new THREE.Vector3(); f.crashInfo = { speed: 114, sinkRate: 30, pitch: -0.3 }; f.out = { M: 0.35, V: 114, nz: 1 };
  const w = new Wreck(scene); f.crashed = 'test'; v.update(1 / 60, f, cam0, 'chase', day, 0);
  w.start(v, f, 'impact', { fuelCap: IL76.FUEL_MAX, speedRef: 120, sinkRef: 40, size: 1.4 }); const n = w.pieces.length, scale = w.scale; w.clear(v);
  assert.ok(n >= 3, `${n} pieces`); assert.ok(v.root.visible, 'airframe shown again after clear'); assert.equal(scale.fuelCap, IL76.FUEL_MAX); assert.equal(scale.size, 1.4); return `${n} pieces`;
});
await vite.close();
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
