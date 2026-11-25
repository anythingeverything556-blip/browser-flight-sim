// Drives the real Controls class with synthetic key events (no browser needed).
const listeners = {};
globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
globalThis.innerWidth = 1000; globalThis.innerHeight = 800;
const { Controls } = await import('../src/controls.js');

const key = (type, code, key = code) => (listeners[type] || []).forEach((fn) => fn({ code, key, target: {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} }));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };
const run = (c, secs, ground) => { c.onGround = ground; for (let t = 0; t < secs; t += 1 / 60) c.update(1 / 60); };
const fresh = (ground) => { const c = new Controls(); c.enabled = true; run(c, 0.5, ground); return c; };

// listeners accumulate across instances, so isolate each case by clearing them
const isolate = (fn) => { for (const k of Object.keys(listeners)) listeners[k].length = 0; return fn(); };

isolate(() => { const c = fresh(true); key('keydown', 'KeyD'); run(c, 0.6, true);
  check('ground: D steers right (yaw > 0)', c.axes.yaw > 0.5, `yaw=${c.axes.yaw.toFixed(2)}`);
  check('ground: D does not roll', Math.abs(c.axes.roll) < 1e-6, `roll=${c.axes.roll.toFixed(2)}`);
  check('ground: D does not count as manual stick input', c.manual === false); });
isolate(() => { const c = fresh(true); key('keydown', 'KeyA'); run(c, 0.6, true);
  check('ground: A steers left (yaw < 0)', c.axes.yaw < -0.5, `yaw=${c.axes.yaw.toFixed(2)}`); });
isolate(() => { const c = fresh(false); key('keydown', 'KeyD'); run(c, 0.6, false);
  check('air: D rolls right (roll > 0)', c.axes.roll > 0.5, `roll=${c.axes.roll.toFixed(2)}`);
  check('air: D does not yaw', Math.abs(c.axes.yaw) < 1e-6);
  check('air: D is manual input', c.manual === true); });
isolate(() => { const c = fresh(false); key('keydown', 'KeyA'); run(c, 0.6, false);
  check('air: A rolls left (roll < 0)', c.axes.roll < -0.5, `roll=${c.axes.roll.toFixed(2)}`); });
// W/S pitch like the arrow keys, in both states (rotation happens while still on the ground)
for (const ground of [true, false]) isolate(() => {
  const w = fresh(ground); key('keydown', 'KeyW'); run(w, 0.6, ground);
  const s = (() => { key('keyup', 'KeyW'); run(w, 1, ground); key('keydown', 'KeyS'); run(w, 0.6, ground); return w.axes.pitch; })();
  check(`${ground ? 'ground' : 'air'}: W pitches like ArrowUp, S like ArrowDown`, s > 0.5, `after S pitch=${s.toFixed(2)}`); });
isolate(() => { const c = fresh(false); key('keydown', 'ArrowUp'); run(c, 0.6, false);
  check('arrows unchanged: ArrowUp pitches negative', c.axes.pitch < -0.5, `pitch=${c.axes.pitch.toFixed(2)}`); });
// throttle is not stolen by W/S
isolate(() => { const c = fresh(true); const before = c.throttle; key('keydown', 'KeyW'); run(c, 1, true);
  check('ground: W does not change throttle', c.throttle === before); });
// debounce: a 0.1 s bounce must not flip A/D into roll mode
isolate(() => { const c = fresh(true); key('keydown', 'KeyD'); run(c, 0.3, true); run(c, 0.1, false); run(c, 0.1, true);
  check('bounce < 0.25 s keeps ground steering', c.ground === true && c.axes.roll === 0); });
// handlers: autopilot moved to K, A no longer fires it, help on ? and F1
isolate(() => { const c = new Controls(); c.enabled = true; const fired = [];
  c.on('autopilot', () => fired.push('ap')); c.on('help', () => fired.push('help'));
  key('keydown', 'KeyA'); key('keyup', 'KeyA'); key('keydown', 'KeyK'); key('keyup', 'KeyK'); key('keydown', 'Slash'); key('keyup', 'Slash'); key('keydown', 'F1'); key('keyup', 'F1');
  check('A no longer toggles autopilot; K does; ? and F1 open help', fired.join() === 'ap,help,help', fired.join()); });
isolate(() => { const c = new Controls(); c.enabled = true; key('keydown', 'KeyD'); c.update(1 / 60);
  check('slew turn works with D', c.slew.turn === 1); });
console.log(fails ? `\n${fails} FAILED` : '\nall controls tests passed'); process.exit(fails ? 1 : 0);
