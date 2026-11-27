import assert from 'node:assert/strict';
import { Controls, DEFAULT_KEYS, assignKey, resolveKeys } from '../src/controls.js';
import { mountKeymap } from '../src/keymap-ui.js';
import { returnFocusAfterPointer } from '../src/cockpit-focus.js';
import { effectiveRenderRatio, syncRendererSize } from '../src/renderer-size.js';

let listeners = {};
globalThis.window = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
globalThis.addEventListener = window.addEventListener;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
globalThis.innerWidth = 960;
globalThis.innerHeight = 640;
const event = (type, code, options = {}) => {
  const value = { code, key: code, target: {}, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopImmediatePropagation() {}, ...options };
  for (const fn of listeners[type] || []) fn(value);
};
const controller = () => { listeners = {}; return new Controls(); };
const run = (controls, seconds, slew = false) => { for (let frame = 0; frame < Math.round(seconds * 60); frame++) controls.update(1 / 60, slew); };

{
  let focused = true;
  const button = { blur() { focused = false; } };
  returnFocusAfterPointer({ detail: 0 }, button);
  assert.equal(focused, true, 'keyboard activation retains toolbar focus');
  returnFocusAfterPointer({ detail: 1 }, button);
  assert.equal(focused, false, 'pointer activation releases toolbar focus');
  const controls = controller();
  let pause = 0, view = 0;
  controls.on('pause', () => pause++);
  controls.on('nextView', () => view++);
  const nativeButton = { tagName: 'BUTTON' };
  event('keydown', 'KeyP', { target: nativeButton });
  event('keydown', 'KeyV', { target: nativeButton });
  assert.deepEqual([pause, view], [0, 0], 'focused toolbar keeps native keyboard behavior');
  event('keydown', 'KeyP'); event('keyup', 'KeyP');
  event('keydown', 'KeyV'); event('keyup', 'KeyV');
  assert.deepEqual([pause, view], [1, 1], 'flight keys work when focus returns to the flight surface');
}

{
  const controls = controller();
  controls.throttle = 0.4;
  event('keydown', 'PageUp'); run(controls, 1, true);
  assert.equal(controls.slew.up, 1);
  assert.equal(controls.throttle, 0.4);
  run(controls, 1, false);
  assert.equal(controls.throttle, 0.4, 'a movement key held over exit cannot queue throttle');
  event('keyup', 'PageUp'); event('keydown', 'PageDown'); run(controls, 1, true);
  assert.equal(controls.slew.up, -1);
  assert.equal(controls.throttle, 0.4);
  event('keyup', 'PageDown'); run(controls, 0.1, false);
  assert.equal(controls.throttle, 0.4);
  event('keydown', 'PageUp'); run(controls, 1, false); event('keyup', 'PageUp');
  assert.ok(controls.throttle > 0.7, 'normal throttle resumes after key release');
  controls.throttle = 0.4; controls.engSel = 1;
  event('keydown', 'PageUp'); run(controls, 1, true); event('keyup', 'PageUp'); run(controls, 0.1, false);
  assert.equal(controls.engTrim[0], 0, 'slew does not queue selected-engine trim');
  const bindings = resolveKeys(null);
  assignKey(bindings, 'slewUp', 'KeyE'); controls.setBindings(bindings);
  event('keydown', 'KeyE'); run(controls, 1, true); event('keyup', 'KeyE'); run(controls, 0.1, false);
  assert.equal(controls.throttle, 0.4, 'remapped slew movement also owns its shared throttle key');
}

{
  const controls = controller();
  const root = { innerHTML: '', addEventListener(type, fn) { this[type] = fn; }, contains: () => true };
  const settings = {};
  let saves = 0;
  mountKeymap({ root, help: { innerHTML: '' }, leverHint: null, controls, settings, save: () => saves++, toast() {} });
  const add = { dataset: { id: 'throttleUp' }, classList: { contains: (name) => name === 'km-add' } };
  root.click({ target: { closest: () => add } });
  event('keydown', 'ShiftLeft', { shiftKey: true });
  event('keyup', 'ShiftLeft');
  assert.equal(saves, 1);
  assert.ok(settings.keys.throttleUp.includes('Shift'));
  assert.ok(controls.bind.throttleUp.includes('Shift'));
  assert.ok(!DEFAULT_KEYS.throttleUp.includes('Shift'), 'legacy defaults remain unchanged');
  const restored = JSON.parse(JSON.stringify(settings));
  const reloaded = controller(); reloaded.setBindings(restored.keys);
  assert.ok(reloaded.bind.throttleUp.includes('Shift'));
  event('keydown', 'ShiftLeft', { shiftKey: true }); run(reloaded, 1);
  assert.ok(reloaded.throttle > 0.3, 'saved Shift binding works after reload');
  event('keyup', 'ShiftLeft');
  const chord = controller(); chord.setBindings(restored.keys);
  let brake = 0; chord.on('parkingBrake', () => brake++);
  event('keydown', 'ShiftLeft', { shiftKey: true }); event('keydown', 'KeyB', { shiftKey: true }); run(chord, 1);
  assert.equal(brake, 1);
  assert.equal(chord.throttle, 0, 'quick Shift chord does not apply throttle');
}

{
  const renderer = {
    ratio: 0.5, width: 960, height: 640, calls: [],
    getPixelRatio() { return this.ratio; },
    getSize(target) { return target.set(this.width, this.height); },
    setPixelRatio(ratio) { this.ratio = ratio; this.setSize(this.width, this.height, false); },
    setSize(width, height) { this.width = width; this.height = height; this.calls.push([width, height, this.ratio]); },
  };
  syncRendererSize(renderer, 0.5, 960, 640);
  assert.deepEqual(renderer.calls, [], 'matching cockpit transition never resets canvas');
  syncRendererSize(renderer, 1, 960, 640);
  assert.deepEqual(renderer.calls, [[960, 640, 1]], 'a changed cockpit ratio resizes once');
  syncRendererSize(renderer, 1, 1280, 800);
  assert.deepEqual(renderer.calls.at(-1), [1280, 800, 1], 'window changes resize');
  assert.equal(renderer.calls.length, 2);
  syncRendererSize(renderer, 0.75, 1200, 700);
  assert.deepEqual([renderer.ratio, renderer.width, renderer.height], [0.75, 1200, 700]);
  const exterior = effectiveRenderRatio(1.5, 0.6, true, 1, false, false);
  const cockpit = effectiveRenderRatio(1.5, 0.6, true, 1, true, false);
  assert.equal(cockpit, 1, 'cockpit retains its native-resolution floor');
  syncRendererSize(renderer, exterior, 1200, 700);
  const before = renderer.calls.length;
  syncRendererSize(renderer, cockpit, 1200, 700);
  assert.equal(renderer.calls.length, before + 1, 'a preset with a higher cockpit floor resizes once');
  assert.equal(effectiveRenderRatio(1.5, 0.6, true, 1, true, true), exterior, 'F27 has no cockpit floor');
  assert.equal(effectiveRenderRatio(0.5, 0.6, false, 1, true, false), 0.5, 'manual resolution ceiling is preserved');
}

console.log('EW-AUDIT-01..04 targeted regressions passed');
