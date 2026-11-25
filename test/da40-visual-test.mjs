import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DA40Visual, DA40_EYE } from '../src/da40visual.js';
import { DA40_CG } from '../src/da40.js';
import { loadModel } from './_glb-node.mjs';

const rule = (instance, target, property, pivot, axis, factor = 1, type = 'rotate') => ({ instance, type, targets: [target], matchingTargets: [target], pivot, axis, details: { property, factor } });
const scene = new THREE.Group();
const first = new THREE.Group(); first.name = 'da40-instance-000'; scene.add(first);
const second = new THREE.Group(); second.name = 'da40-instance-001'; scene.add(second);
const object = (parent, name, position = [0, 0, 0]) => { const node = new THREE.Group(); node.name = name; node.userData.name = name; node.position.fromArray(position); parent.add(node); return node; };
const elevator = object(first, 'elevator', [0, 0, 2]);
const duplicate = object(second, 'elevator', [0, 0, 2]);
const flap = object(first, 'flap.L', [0, 0, 3]);
const wheel = object(first, 'wheelF', [0, 0, 1]);
const canopy = object(first, 'canopy.F', [0, 0, 2]);
const innerCanopy = object(second, 'window.F.int', [0, 0, 2]);
const rig = { schema: 1, rules: [
  rule(first.name, 'elevator', 'surface-positions/elevator-pos-norm', [0, 0, 0], [1, 0, 0], 21),
  rule(first.name, 'flap.L', 'surface-positions/flap-pos-norm', [0, 0, 0], [1, 0, 0], 42),
  rule(first.name, 'wheelF', 'gear/gear[0]/steering-norm', [0, 0, 0], [0, -1, 0], 360),
  rule(first.name, 'wheelF', 'gear/gear[0]/rollspeed-ms', [0, 0, 0], [-1, 0, 0], 30, 'spin'),
  rule(first.name, 'canopy.F', 'da40/canopy-norm', [0, 0, 0], [1, 0, 0], -50),
  rule(second.name, 'window.F.int', 'da40/canopy-norm', [0, 0, 0], [1, 0, 0], -50),
] };
const visual = new DA40Visual(new THREE.Scene());
visual.attachModel(scene, rig);
assert.equal(visual.bindings.length, 6);
assert.equal(duplicate.parent, second, 'matching must not cross model instances');
assert.equal(wheel.parent.parent.parent.userData.name, undefined);
assert.equal(visual.cockpitTextures().length, 0);
const fdm = { pos: new THREE.Vector3(20, 100, 30), quat: new THREE.Quaternion(), surf: { de: 0.5, da: 0, dr: 0.5 }, trim: 0, flaps: 42, onGround: true, compress: [0.1, 0.1, 0.1], wheel: [2, 0, 0], rpm: 0 };
let feedCalls = 0; const feed = () => { feedCalls++; return { ias: 90, alt: 5000, hdg: 150, pitch: 5, bank: 10, rpm: 1800, fuel: 80, throttle: 0.5, flaps: 20, nav: { valid: true, ident: 'TEST', brgDeg: 125, distNm: 12, xtkNm: 0.2 }, warn: { overspeed: true } }; };
visual.setDoors(true);
visual.update(1, fdm, new THREE.Vector3(2, 3, 4), 'external', {}, 0, feed);
assert.equal(feedCalls, 0, 'external views must not request cockpit data');
assert.deepEqual(visual.root.position.toArray(), [18, 97, 26]);
const get = (name) => visual.bindings.find((binding) => binding.object === name);
assert.ok(Math.abs(get(elevator).group.quaternion.angleTo(new THREE.Quaternion()) / D2R() - 10.5) < 1e-6);
assert.ok(Math.abs(get(flap).group.quaternion.angleTo(new THREE.Quaternion()) / D2R() - 42) < 1e-6, 'full flap follows the source XML normalisation and animation');
assert.ok(Math.abs(get(canopy).group.quaternion.angleTo(new THREE.Quaternion()) / D2R() - 25) < 1e-6);
assert.ok(Math.abs(get(innerCanopy).group.quaternion.angleTo(get(canopy).group.quaternion)) < 1e-6);
const wheelBindings = visual.bindings.filter((binding) => binding.object === wheel);
assert.equal(wheelBindings.length, 2); assert.ok(Math.abs(wheelBindings[1].angle - 2) < 1e-9);
visual.update(0.2, fdm, new THREE.Vector3(), 'cockpit', {}, 0, feed);
assert.equal(feedCalls, 1); visual.update(0.02, fdm, new THREE.Vector3(), 'cockpit', {}, 0, feed); assert.equal(feedCalls, 1);
assert.equal(visual.cabinDoor, visual.door);
fdm.onGround = false; visual.setDoors(false); visual.update(1, fdm, new THREE.Vector3(), 'external', {}, 0, null);
assert.equal(visual.setDoors(true), false, 'cannot open a canopy in flight');
fdm.onGround = true;
assert.ok(DA40_EYE.distanceTo(new THREE.Vector3(-1.628, 1.594, -0.32).sub(DA40_CG)) < 1e-9);
function D2R() { return Math.PI / 180; }

if (existsSync(new URL('../public/models/da40/da40-ng.glb', import.meta.url)) && existsSync(new URL('../public/models/da40/rig.json', import.meta.url))) {
const gltf = await loadModel('da40/da40-ng');
const actualRig = JSON.parse(readFileSync(new URL('../public/models/da40/rig.json', import.meta.url)));
const drawnText = [];
const canvasContext = new Proxy({}, { get(target, property) { return target[property] || ((...args) => { if (property === 'fillText') drawnText.push(args[0]); }); }, set(target, property, value) { target[property] = value; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => canvasContext }) };
const actual = new DA40Visual(new THREE.Scene());
actual.attachModel(gltf.scene, actualRig);
assert.equal(actual.cockpitTextures().length, 2, 'both cockpit displays are live textures');
assert.equal(actual.displays.pfd.canvas.width, 1024); assert.equal(actual.displays.pfd.canvas.height, 768);
assert.equal(actual.displays.mfd.canvas.width, 1024); assert.equal(actual.displays.mfd.canvas.height, 768);
assert.ok(actual.cockpitTextures().every((texture) => texture.anisotropy === 8));
const paint = []; actual.source.traverse((node) => { if (node.isMesh && node.material?.name === 'DA40NG') paint.push(node.material); });
assert.ok(paint.length && paint.every((material) => material.roughness === 0.48 && material.map?.anisotropy === 8));
const pfdId = actualRig.instances.find((entry) => /GDU-1040\.1\.xml$/.test(entry.xml))?.id;
const pfd = pfdId ? actual.instanceNodes.get(pfdId) : actual.source.getObjectByName('DA40 approximate PFD');
const mfd = actual.instanceNodes.get(actualRig.instances.find((entry) => /GDU-1044\.2\.xml$/.test(entry.xml)).id);
actual.root.updateMatrixWorld(true);
assert.ok(Math.abs(pfd.getWorldPosition(new THREE.Vector3()).distanceTo(mfd.getWorldPosition(new THREE.Vector3())) - 0.34) < 1e-6, 'PFD is at the missing instrument XML offset');
const names = new Set(actual.bindings.map((binding) => binding.object.userData.name));
for (const name of ['elevator', 'elevator.trim.tab', 'aileron.L', 'aileron.R', 'flap.L', 'flap.R', 'wheelF', 'wheelL', 'wheelR', 'canopy.F', 'window.F.int', 'door.R', 'window.L.int', 'throttle_lever', 'rudder_pedal_LL', 'g1000_sw.flaps']) assert.ok(names.has(name), `missing ${name}`);
assert.equal(actual.bindings.filter((binding) => binding.object.userData.name === 'elevator.trim.tab').length, 2, 'trim tab keeps both nested XML rotations');
const nose = actual.bindings.find((binding) => binding.object.userData.name === 'wheelF').object;
const rest = new THREE.Box3().setFromObject(nose), bottomInDatum = rest.min.y + DA40_CG.y;
assert.ok(Math.abs(bottomInDatum) < 0.01, `wheel rests near the physics ground plane: ${bottomInDatum}`);
const frontInDatum = (rest.min.x + rest.max.x) / 2 + DA40_CG.x;
assert.ok(Math.abs(frontInDatum - 0.034) < 0.05, `nose wheel aligns with flight model: ${frontInDatum}`);
actual.update(0.1, fdm, new THREE.Vector3(), 'cockpit', {}, 0, feed);
assert.ok(drawnText.includes('PFD • SIMPLIFIED')); assert.ok(drawnText.includes('NAV / CAS • SIMPLIFIED'));
assert.ok(drawnText.includes('5000'), 'cockpit feed reaches the PFD');
assert.ok(drawnText.includes('TO TEST') && drawnText.includes('OVERSPEED'), 'navigation and warning feeds reach the MFD');
actual.displays.mfd.draw(actual.displays.mfd.canvas, { warn: { overspeed: true, stall: true, engineFailure: true } });
assert.ok(drawnText.includes('STALL') && drawnText.includes('ENGINE FAILURE'), 'multiple warnings are drawn on separate readable rows');
assert.equal(actual.prop.visible, true); assert.equal(actual.propDisc.visible, false);
fdm.rpm = 1800; actual.update(0.1, fdm, new THREE.Vector3(), 'external', {}, 0, feed);
assert.equal(actual.prop.visible, false); assert.equal(actual.propDisc.visible, true);
assert.ok(actual.lights.some((light) => light.kind === 'redlight' && light.object.visible));
assert.ok(actual.lights.some((light) => light.kind === 'greenlight' && light.object.visible));
fdm.rpm = 0; actual.update(0.1, fdm, new THREE.Vector3(), 'external', {}, 0, feed);
assert.ok(actual.lights.every((light) => !light.object.visible));
assert.ok(actual.bindings.filter((binding) => binding.rule?.details?.property === 'da40/canopy-norm').length >= 3);
delete globalThis.document;
console.log(`DA40 visual: synthetic hierarchy and ${actual.bindings.length} real source bindings, pivots, doors, gear, controls and cockpit feed pass`);
} else console.log('DA40 visual: synthetic hierarchy, pivots, doors, gear, controls and cockpit feed pass; GLB not yet available');
