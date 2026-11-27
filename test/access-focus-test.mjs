import assert from 'node:assert/strict';
import { createTeleportDialog } from '../src/teleport-dialog.js';

const listeners = {}, sequence = [];
const opener = { isConnected: true, getClientRects: () => [{}], focus: () => sequence.push('opener') };
const document = { body: {}, activeElement: opener };
const dialog = {
  ownerDocument: document, hidden: true, open: false,
  addEventListener: (name, fn) => { listeners[name] = fn; },
  showModal() { assert.equal(controls.enabled, false, 'flight disabled before native modal opens'); this.open = true; sequence.push('showModal'); },
  close() { this.open = false; sequence.push('close'); },
};
const controls = { enabled: true }; let started = true;
const modal = createTeleportDialog({ dialog, controls, isStarted: () => started, initialFocus: { focus: () => sequence.push('input') }, returnFocus: () => sequence.push('flight') });
modal.open(); modal.open();
assert.deepEqual(sequence, ['showModal', 'input'], 'repeated open does not overwrite opener/input state');
assert.equal(dialog.hidden, false); assert.equal(controls.enabled, false);
let prevented = 0, stopped = 0;
listeners.keydown({ stopPropagation: () => stopped++ }); assert.equal(stopped, 1, 'editing keys never reach flight');
listeners.pointerdown({ target: {}, preventDefault: () => prevented++ }); assert.equal(dialog.open, true, 'card interaction never dismisses');
listeners.cancel({ preventDefault: () => prevented++ });
assert.equal(prevented, 1); assert.equal(dialog.open, false); assert.equal(dialog.hidden, true); assert.equal(controls.enabled, true); assert.equal(sequence.at(-1), 'opener');
const count = sequence.length; modal.close(); assert.equal(sequence.length, count, 'close is idempotent');
controls.enabled = false; modal.open(); modal.close(); assert.equal(controls.enabled, false, 'never enable controls that were disabled before opening');
controls.enabled = true; modal.open(); started = false; modal.close(); assert.equal(controls.enabled, false, 'flight must still be started before enabling controls');
started = true; controls.enabled = true; opener.isConnected = false;
modal.open(); listeners.pointerdown({ target: dialog, preventDefault: () => prevented++ });
assert.equal(sequence.at(-1), 'flight', 'detached opener falls back to the flight surface');
assert.equal(prevented, 2, 'backdrop pointer default cannot steal restored focus');
assert.equal(controls.enabled, true);
console.log('PASS B16 modal input isolation, idempotent lifecycle, opener/fallback return and prior-control-state safety');
