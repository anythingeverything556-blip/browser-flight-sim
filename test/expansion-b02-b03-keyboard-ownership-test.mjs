import assert from 'node:assert/strict';
import test from 'node:test';
import { Controls, assignKey, resolveKeys } from '../src/controls.js';

let listeners;
globalThis.window = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
const event = (type, code, shiftKey = false) => {
  for (const fn of listeners[type] || []) fn({ code, key: code, shiftKey, target: {}, preventDefault() {} });
};
const fresh = (overrides, options) => {
  listeners = {};
  const controls = new Controls(options);
  if (overrides) controls.setBindings(overrides);
  return controls;
};
const run = (c, slew = false) => { for (let i = 0; i < 30; i++) c.update(1 / 60, slew); };
const shiftDown = () => event('keydown', 'ShiftLeft', true);

test('B02: SR-71 seal and WALT chords consume the default pitch keys', () => {
  for (const [code, action] of [['KeyS', 'sr71Seal'], ['KeyW', 'sr71Walt']]) {
    const c = fresh(); let fired = 0; c.on(action, () => fired++);
    shiftDown(); event('keydown', code, true); event('keydown', code, true); run(c);
    assert.equal(fired, 1, action + ' fires once, without repeat');
    assert.equal(c.axes.pitch, 0); assert.equal(c.manual, false);
    event('keyup', 'ShiftLeft'); run(c);
    assert.equal(c.axes.pitch, 0, 'consumed chord stays consumed until its base key is released');
    event('keyup', code); event('keydown', code); run(c);
    assert.ok(Math.abs(c.axes.pitch) > 0.9, 'plain pitch works after release');
  }
});

test('B02: custom held Shift+G owns both press and held resolution', () => {
  const bindings = resolveKeys(null); assignKey(bindings, 'throttleUp', 'Shift+KeyG');
  const c = fresh(bindings); let gear = 0; c.on('gear', () => gear++);
  shiftDown(); event('keydown', 'KeyG', true); run(c);
  assert.equal(gear, 0); assert.ok(Math.abs(c.throttle - 0.175) < 1e-12);
  event('keyup', 'KeyG'); event('keyup', 'ShiftLeft'); event('keydown', 'KeyG');
  assert.equal(gear, 1, 'unmodified G remains gear');
});

test('B02: custom held Shift+W rolls without pitching or firing the old WALT chord', () => {
  const bindings = resolveKeys(null); assignKey(bindings, 'rollLeft', 'Shift+KeyW');
  const c = fresh(bindings); let walt = 0; c.on('sr71Walt', () => walt++);
  shiftDown(); event('keydown', 'KeyW', true); run(c);
  assert.equal(walt, 0); assert.equal(c.axes.pitch, 0); assert.ok(c.axes.roll < -0.9);
});

test('B02: unbound Shift combinations retain their ordinary key fallback', () => {
  const c = fresh(); let gear = 0; c.on('gear', () => gear++);
  shiftDown(); event('keydown', 'KeyG', true); event('keydown', 'ArrowUp', true); run(c);
  assert.equal(gear, 1); assert.ok(c.axes.pitch < -0.9);
});

test('B02: held chords also consume a saved Shift-alone throttle modifier', () => {
  const bindings = resolveKeys(null);
  assignKey(bindings, 'throttleUp', 'Shift'); assignKey(bindings, 'rollLeft', 'Shift+KeyG');
  const c = fresh(bindings);
  event('keydown', 'KeyG'); shiftDown(); run(c);
  assert.ok(c.axes.roll < -0.9, 'held chord works when Shift is pressed last');
  assert.equal(c.throttle, 0, 'Shift is already serving the held chord');
});

test('B02: preserve quick parking-brake chord and deliberate held-Shift throttle/brake gesture', () => {
  const bindings = resolveKeys(null); assignKey(bindings, 'throttleUp', 'Shift');
  for (const longHold of [false, true]) {
    const c = fresh(bindings); let parking = 0; c.on('parkingBrake', () => parking++);
    shiftDown(); if (longHold) run(c);
    event('keydown', 'KeyB', true); run(c);
    assert.equal(c.brake, 1); assert.equal(parking, longHold ? 0 : 1);
    if (longHold) assert.ok(c.throttle > 0.34); else assert.equal(c.throttle, 0);
  }
  assignKey(bindings, 'gear', 'Shift+KeyB');
  const c = fresh(bindings); shiftDown(); event('keydown', 'KeyB', true); run(c);
  assert.equal(c.brake, 0, 'only the actual parking-brake chord shares the wheel brake');
});

test('B03: active slew gets R before Restart, including toggles between animation frames', () => {
  let slew = false;
  const bindings = resolveKeys(null); assignKey(bindings, 'slewUp', 'KeyR');
  const c = fresh(bindings, { slewMode: () => slew }); let resets = 0, pauses = 0;
  c.on('reset', () => resets++); c.on('pause', () => pauses++);
  c.update(1 / 60, false); slew = true; // no update before the next keydown
  event('keydown', 'KeyR'); run(c, true);
  assert.equal(resets, 0); assert.equal(c.slew.up, 1);
  event('keydown', 'KeyP'); assert.equal(pauses, 1, 'unclaimed UI keys remain available');
  event('keyup', 'KeyR'); slew = false; // cached last frame still said slew
  event('keydown', 'KeyR'); run(c);
  assert.equal(resets, 1); assert.equal(c.slew.up, 0, 'inactive slew cannot claim flight keys');
});

test('B03: active slew plain key wins even over a more specific main-context chord', () => {
  const bindings = resolveKeys(null);
  assignKey(bindings, 'slewUp', 'KeyR'); assignKey(bindings, 'rollLeft', 'Shift+KeyR');
  const c = fresh(bindings); c.update(1 / 60, true);
  shiftDown(); event('keydown', 'KeyR', true); run(c, true);
  assert.equal(c.slew.up, 1); assert.equal(c.axes.roll, 0);
});

test('B03: active custom slew chord cannot dispatch gear; inactive context does not shadow it', () => {
  let slew = true;
  const bindings = resolveKeys(null); assignKey(bindings, 'slewUp', 'Shift+KeyG');
  const c = fresh(bindings, { slewMode: () => slew }); let gear = 0; c.on('gear', () => gear++);
  shiftDown(); event('keydown', 'KeyG', true); run(c, true);
  assert.equal(gear, 0); assert.equal(c.slew.up, 1); assert.equal(c.throttle, 0);
  event('keyup', 'KeyG'); event('keyup', 'ShiftLeft'); slew = false;
  shiftDown(); event('keydown', 'KeyG', true); run(c);
  assert.equal(gear, 1); assert.equal(c.slew.up, 0);
});

test('B03: active slew held binding exclusively owns an overlapping flight-axis key', () => {
  const bindings = resolveKeys(null); assignKey(bindings, 'slewUp', 'KeyW');
  const c = fresh(bindings); c.update(1 / 60, true);
  event('keydown', 'KeyW'); run(c, true);
  assert.equal(c.slew.up, 1); assert.equal(c.slew.fwd, 0); assert.equal(c.axes.pitch, 0);
});

test('B02/B03: an inactive slew chord does not consume the main throttle key', () => {
  const bindings = resolveKeys(null);
  assignKey(bindings, 'slewUp', 'Shift+KeyE');
  const c = fresh(bindings); c.update(1 / 60, true);
  event('keydown', 'KeyE'); run(c, true);
  assert.equal(c.slew.up, 0); assert.ok(Math.abs(c.throttle - 0.175) < 1e-12);
});

test('B03: Shift-alone holds obey context ownership too', () => {
  let slew = true;
  const bindings = resolveKeys(null);
  assignKey(bindings, 'throttleUp', 'Shift'); assignKey(bindings, 'slewUp', 'Shift');
  const c = fresh(bindings, { slewMode: () => slew });
  shiftDown(); run(c, true);
  assert.equal(c.slew.up, 1); assert.equal(c.held('throttleUp'), false); assert.equal(c.throttle, 0);
  event('keyup', 'ShiftLeft'); slew = false; shiftDown(); run(c);
  assert.equal(c.slew.up, 0); assert.ok(c.throttle > 0.17);
});
