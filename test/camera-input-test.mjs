import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { CameraRig, VIEWS } from '../src/camera.js';
import { CAMERA_ACTIONS, bindCameraControls } from '../src/camera-input.js';

class Hub {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  emit(type, props = {}) { for (const fn of this.listeners.get(type) || []) fn({ target: {}, preventDefault() {}, ...props }); }
}
globalThis.window = new Hub();
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
const { Controls, KEY_ACTIONS, assignKey, resolveKeys, keyOverrides } = await import('../src/controls.js');
const document = new Hub();
const classes = new Set();
let modals = [], active = true;
document.body = { classList: { contains: id => classes.has(id) } };
document.activeElement = null;
document.querySelectorAll = () => modals;
const canvas = new Hub();
canvas.ownerDocument = document;
const captures = new Set();
canvas.setPointerCapture = id => captures.add(id);
canvas.hasPointerCapture = id => captures.has(id);
canvas.releasePointerCapture = id => { captures.delete(id); canvas.emit('lostpointercapture', { pointerId: id }); };
const camera = new THREE.PerspectiveCamera();
const rig = new CameraRig(camera, canvas), controls = new Controls();
const input = bindCameraControls({ rig, controls, document, active: () => active });
const key = (code, down = true, props = {}) => window.emit(down ? 'keydown' : 'keyup', { code, key: code, ...props });
const tick = (seconds = 1) => { for (let t = 0; t < seconds - 1e-8; t += 0.02) { controls.update(0.02); input.update(0.02); } };
const state = { quat: new THREE.Quaternion(), pos: new THREE.Vector3(0, 200, 0), vel: new THREE.Vector3(20, 0, 0) };
const draw = () => rig.update(0.02, state, () => 0, new THREE.Vector3(0, 0, 150));
const pointer = (type, props = {}) => (type === 'pointerdown' || type === 'lostpointercapture' ? canvas : window).emit(type,
  { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...props });

// Registered defaults are configurable and disjoint from every existing flight/system key.
const cameraIds = new Set(CAMERA_ACTIONS.map(a => a.id));
const otherKeys = new Set(KEY_ACTIONS.filter(a => !cameraIds.has(a.id)).flatMap(a => a.keys));
for (const action of CAMERA_ACTIONS) {
  assert.ok(KEY_ACTIONS.some(a => a.id === action.id));
  for (const code of action.keys) assert.ok(!otherKeys.has(code), `${code} must not steal a flight key`);
}
const table = resolveKeys(null);
assignKey(table, 'cameraLeft', 'KeyA');
assert.ok(!table.rollSteerLeft.includes('KeyA'));
assert.deepEqual(resolveKeys(keyOverrides(table)), table);
controls.setBindings(keyOverrides(table));
rig.set('cockpit'); key('KeyA'); tick(); key('KeyA', false);
assert.ok(rig.look.yaw > 0.9, 'rebound camera key moves the actual rig');
assert.equal(controls.axes.roll, 0, 'rebound key is removed from the flight action');
controls.setBindings(null);

// Every camera view changes its real orientation (not just a dormant parameter), including chase/tower/fly-by.
for (const view of [...VIEWS, 'cabin']) {
  rig.set(view); rig.recenter(); draw(); const before = camera.quaternion.clone();
  key('Delete'); tick(0.3); key('Delete', false); draw();
  assert.ok(before.angleTo(camera.quaternion) > 0.1, `${view}: keyboard pan rotates rendered camera`);
  const beforeZoom = view === 'cockpit' || view === 'cabin' || view === 'wing' ? rig.fov.cockpit
    : view === 'tower' || view === 'flyby' ? rig.fov.other : rig.orbit.dist;
  key('Digit8'); tick(0.3); key('Digit8', false);
  const afterZoom = view === 'cockpit' || view === 'cabin' || view === 'wing' ? rig.fov.cockpit
    : view === 'tower' || view === 'flyby' ? rig.fov.other : rig.orbit.dist;
  assert.ok(afterZoom < beforeZoom, `${view}: zoom in works`);
  key('Digit1'); key('Digit1', false);
  assert.equal(rig.look.yaw, view === 'cabin' ? Math.PI : 0);
}
// Cockpit instrument look offsets must not tilt the tracked external views on a view change.
rig.set('chase'); rig.recenter(); draw(); const chaseHome = camera.quaternion.clone();
rig.set('cockpit'); rig.pan(0.8, -0.6); rig.set('chase'); draw();
assert.ok(chaseHome.angleTo(camera.quaternion) < 1e-7, 'cockpit pan does not leak into chase');
rig.set('orbit'); rig.recenter(); const initialEl = rig.orbit.el;
key('Home'); tick(0.2); key('Home', false); assert.ok(rig.orbit.el > initialEl, 'orbit up raises the camera');
rig.set('cockpit'); rig.recenter(); key('Home'); tick(10); key('Home', false);
assert.equal(rig.look.pitch, 1.4, 'pitch clamps');
key('End'); tick(10); key('End', false); assert.equal(rig.look.pitch, -1.4);
rig.zoom(1e-20); assert.equal(rig.fov.cockpit, 20); rig.zoom(1e20); assert.equal(rig.fov.cockpit, 100);
rig.cockpitHome = { pitch: -0.5, yaw: 0.1, fov: 62 }; key('Digit1'); key('Digit1', false);
assert.equal(rig.look.pitch, -0.5); assert.equal(rig.look.yaw, 0.1); assert.equal(rig.fov.cockpit, 62);
controls.setLocked(true); key('Delete'); tick(0.2); key('Delete', false); assert.ok(rig.look.yaw > 0.2, 'camera works while paused');
key('Digit1'); key('Digit1', false); assert.equal(rig.look.yaw, 0.1, 'recenter works while paused'); controls.setLocked(false);

// Keyboard, wheel, double-click and drag all obey editing/menu/modal gates.
for (const gate of [
  () => { document.activeElement = { closest: () => ({}) }; },
  () => classes.add('sheet-open'), () => classes.add('intro'), () => { document.hidden = true; },
  () => { controls.enabled = false; }, () => { active = false; },
  () => { modals = [{ hidden: false, getClientRects: () => [1] }]; },
]) {
  rig.set('cockpit'); rig.look.yaw = 0.7; const fov = rig.fov.cockpit; gate();
  key('Delete'); key('Digit8'); key('Digit1'); tick(0.2);
  canvas.emit('wheel', { deltaY: 100 }); canvas.emit('dblclick');
  pointer('pointerdown'); pointer('pointermove', { clientX: 200 });
  assert.equal(rig.look.yaw, 0.7, 'UI gates all camera input'); assert.equal(rig.fov.cockpit, fov);
  for (const code of ['Delete', 'Digit8', 'Digit1']) key(code, false);
  classes.clear(); document.activeElement = null; document.hidden = false; controls.enabled = true; active = true; modals = [];
}
modals = [{ hidden: false, getClientRects: () => [] }];
assert.equal(rig.inputEnabled(), true, 'CSS-hidden modal does not block the camera'); modals = [];

// Real pointer identity/capture/button cancellation: after each cancellation a pressed-button move cannot resume it.
rig.set('orbit');
for (const cancel of [
  () => window.emit('blur'),
  () => pointer('pointercancel'),
  () => pointer('pointerup', { buttons: 0 }),
  () => pointer('lostpointercapture'),
  () => { document.hidden = true; document.emit('visibilitychange'); document.hidden = false; },
  () => pointer('pointermove', { buttons: 0 }),
  () => pointer('pointermove', { buttons: 2 }), // left released, right held is NOT the initiating button
  () => { classes.add('sheet-open'); input.update(0.02); classes.clear(); },
]) {
  pointer('pointerdown'); assert.ok(captures.has(1));
  pointer('pointermove', { clientX: 130 }); const az = rig.orbit.az;
  rig.blockDrag = true; cancel();
  assert.equal(rig.blockDrag, false); assert.equal(captures.size, 0);
  pointer('pointermove', { clientX: 200 }); assert.equal(rig.orbit.az, az, 'stale drag cannot resume');
}
pointer('pointerdown', { button: 2, buttons: 2 }); const az = rig.orbit.az;
pointer('pointermove', { pointerId: 2, buttons: 2, clientX: 200 });
pointer('pointerup', { pointerId: 2 }); assert.equal(rig.orbit.az, az, 'unrelated pointer cannot move/end the drag');
pointer('pointermove', { buttons: 2, clientX: 120 }); assert.notEqual(rig.orbit.az, az, 'right drag still works');
pointer('pointermove', { buttons: 1, clientX: 140 }); const stopped = rig.orbit.az;
pointer('pointermove', { buttons: 2, clientX: 200 }); assert.equal(rig.orbit.az, stopped, 'right drag requires right button');
pointer('pointerdown'); rig.blockDrag = true; pointer('pointermove', { clientX: 220 }); assert.equal(rig.orbit.az, stopped, 'cockpit lever drag never rotates camera'); pointer('pointerup');

// The production frame loop polls camera holds, and Settings/Help render from the shared action registry.
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(main.includes('const cameraInput = bindCameraControls('));
assert.ok(main.includes('cameraInput.update(dt);'));
console.log('PASS configurable camera input, all-view pan/zoom/recenter, UI gates, and pointer capture cancellation');
