// E16/E17: synthetic event and Gamepad snapshots; no hardware or services needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountTouchControls } from '../src/touchcontrols.js';
import { Controls } from '../src/controls.js';

class Target {
  listeners = {};
  dataset = {};
  value = '0';
  style = { setProperty() {} };
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, props = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, ...props }); }
  setPointerCapture(id) { this.capture = id; }
  setAttribute() {}
}
let pads = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 5, getGamepads: () => pads } });
globalThis.matchMedia = query => ({ matches: !query.includes('any-pointer') });
globalThis.MutationObserver = class { observe() {} };
function fresh() { globalThis.window = new Target(); pads = []; return new Controls(); }
function touchFixture(c) {
  const root = new Target(), pitch = new Target(), roll = new Target();
  pitch.dataset.axis = 'pitch'; roll.dataset.axis = 'roll';
  const selectors = Object.fromEntries(['.touch-stick', '.touch-throttle', '.touch-rudder', '.touch-brake'].map(s => [s, new Target()]));
  root.querySelector = s => selectors[s];
  root.querySelectorAll = s => s === '[data-axis]' ? [pitch, roll] : [];
  const body = { append() {}, classList: { add() {}, contains: () => false } };
  globalThis.document = Object.assign(new Target(), { body, createElement: () => root });
  return { ...mountTouchControls(c), pitch, roll };
}
const pad = (id, axes, mapping = '', pressed = []) => ({ id, index: 0, connected: true, mapping, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

test('E16: lost capture releases only its pitch/roll range owner without blur/up/cancel', () => {
  const c = fresh(), { pitch, roll } = touchFixture(c);
  pitch.emit('pointerdown', { pointerId: 1 }); pitch.value = '80'; pitch.emit('input');
  roll.emit('pointerdown', { pointerId: 2 }); roll.value = '-75'; roll.emit('input');
  c.update(.1); assert.equal(c.axes.pitch, .8); assert.equal(c.axes.roll, -.75);
  pitch.emit('lostpointercapture', { pointerId: 99 });
  assert.equal(c.touch.pitch, .8, 'another pointer cannot release pitch');
  pitch.emit('lostpointercapture', { pointerId: 1 });
  assert.equal(c.touch.pitch, null); assert.equal(pitch.value, '0');
  assert.equal(c.touch.roll, -.75, 'pitch release cannot steal roll ownership');
  roll.emit('lostpointercapture', { pointerId: 2 });
  assert.equal(c.touch.roll, null); assert.equal(roll.value, '0');
  c.update(2); assert.equal(c.axes.pitch, 0); assert.equal(c.axes.roll, 0);
  pitch.emit('pointerdown', { pointerId: 3 }); pitch.value = '60'; pitch.emit('input');
  pitch.emit('lostpointercapture', { pointerId: 1 }); assert.equal(c.touch.pitch, .6, 'stale release cannot reset a newer drag');
  pitch.emit('pointerup', { pointerId: 3 }); assert.equal(c.touch.pitch, null);
});

test('E16: cancel, blur, global reset and keyboard range input remain usable', () => {
  const c = fresh(), { pitch, reset } = touchFixture(c);
  for (const type of ['pointercancel', 'blur', 'reset']) {
    pitch.emit('pointerdown', { pointerId: 1 }); pitch.value = '50'; pitch.emit('input');
    if (type === 'reset') reset(); else pitch.emit(type, { pointerId: 1 });
    assert.equal(c.touch.pitch, null); assert.equal(pitch.value, '0');
    pitch.emit('pointerdown', { pointerId: 2 }); pitch.value = '40'; pitch.emit('input');
    pitch.emit('lostpointercapture', { pointerId: 2 });
    assert.equal(c.touch.pitch, null, `${type} permits a new drag and its release`);
  }
  pitch.value = '25'; pitch.emit('input'); assert.equal(c.touch.pitch, .25, 'keyboard range input needs no pointer');
  pitch.emit('blur'); assert.equal(c.touch.pitch, null);
});

test('E17: a new identity at the same index does not inherit initialized ambiguous axes', () => {
  const c = fresh(); pads = [pad('old stick', [0, 0])]; c.update(.1);
  pads = [pad('replacement trigger device', [-1, -1])]; c.update(.1);
  assert.equal(c.axes.roll, 0); assert.equal(c.axes.pitch, 0); assert.equal(c.manual, false);
  const other = new Controls(); other.update(.1);
  assert.deepEqual(c.axes, other.axes, 'replacement emits the same command as a fresh controller');
  pads = [pad('replacement trigger device', [.5, 0])]; c.update(.1); assert.ok(c.axes.roll > .4);
  pads = [pad('replacement trigger device', [-1, 0])]; c.update(.1); assert.equal(c.axes.roll, -1, 'new snapshot of the same device retains initialization');
});

test('E17: mapping and connection lifecycle changes reset reused slots', () => {
  for (const event of ['gamepaddisconnected', 'gamepadconnected']) {
    const c = fresh(); pads = [pad('same model', [0, 0])]; c.update(.1);
    window.emit(event, { gamepad: { index: 4 } });
    pads = [pad('same model', [-1, 0])]; c.update(.1); assert.equal(c.axes.roll, -1, 'unrelated slot cannot invalidate selected axes');
    pads = [pad('same model', [0, 0])]; c.update(2);
    window.emit(event, { gamepad: { index: 0 } });
    pads = [pad('same model', [-1, -1])]; c.update(.1); assert.equal(c.axes.roll, 0); assert.equal(c.axes.pitch, 0);
  }
  const c = fresh(); pads = [pad('mapping changes', [0, 0], 'standard')]; c.update(.1);
  pads = [pad('mapping changes', [-1, -1])]; c.update(.1); assert.equal(c.axes.roll, 0); assert.equal(c.axes.pitch, 0);
  pads = []; c.update(.1); assert.equal(c.padIndex, null); assert.deepEqual(c.padLive, {});
});

test('E17: replacement clears old button edges and keeps pause/resume edges current', () => {
  const c = fresh(); let gear = 0; c.on('gear', () => gear++);
  pads = [pad('first', [0, 0], 'standard', [0])]; c.update(.1); assert.equal(gear, 1);
  pads = [pad('second', [0, 0], 'standard', [0])]; c.update(.1); assert.equal(gear, 2, 'old pressed state does not mask the new device');
  c.setEnabled(false); pads = [pad('third', [0, 0], 'standard', [0])]; c.update(.1);
  c.setEnabled(true); c.update(.1); assert.equal(gear, 2, 'button held across resume does not fire');
});
