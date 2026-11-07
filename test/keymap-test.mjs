// Custom key bindings (Settings → Keyboard controls): rebinding press and held actions, Shift chords, conflicts within a context, saved
// overrides, key names. Synthetic events on a fake window (no browser).
const listeners = {};
globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
globalThis.innerWidth = 1000; globalThis.innerHeight = 800;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
const { Controls, KEY_ACTIONS, DEFAULT_KEYS, resolveKeys, keyOverrides, assignKey, keyName } = await import('../src/controls.js');

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };
const ev = (type, code, mods = {}) => (listeners[type] || []).forEach((fn) => fn({ code, key: code, target: {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, preventDefault() {} }));
const tap = (code, mods) => { ev('keydown', code, mods); ev('keyup', code, mods); };
const run = (c, s) => { for (let t = 0; t < s; t += 1 / 60) c.update(1 / 60); };
const iso = (over) => { for (const k of Object.keys(listeners)) listeners[k].length = 0; const c = new Controls(); c.enabled = true; if (over) c.setBindings(over); return c; };
const count = (c, ...ids) => { const n = {}; for (const id of ids) { n[id] = 0; c.on(id, () => n[id]++); } return n; };

{ // defaults are the original keys
  check('every action has a default key and the ids are unique', KEY_ACTIONS.every((a) => a.keys.length) && new Set(KEY_ACTIONS.map((a) => a.id)).size === KEY_ACTIONS.length);
  const c = iso(), n = count(c, 'gear', 'flapsDown', 'flapsUp', 'prevView', 'help');
  tap('KeyG'); tap('KeyF'); tap('KeyF', { shiftKey: true }); tap('KeyV', { shiftKey: true }); tap('Slash', { shiftKey: true });
  check('defaults: G gear, F flaps down, Shift+F flaps up, Shift+V previous view, ? help', n.gear === 1 && n.flapsDown === 1 && n.flapsUp === 1 && n.prevView === 1 && n.help === 1, JSON.stringify(n));
}
{ // a press action moved to another key
  const t = resolveKeys(null); assignKey(t, 'gear', 'KeyN'); t.gear = t.gear.filter((k) => k !== 'KeyG');
  const c = iso(keyOverrides(t)), n = count(c, 'gear');
  tap('KeyG'); const afterG = n.gear; tap('KeyN');
  check('gear rebound G -> N: G does nothing, N raises the gear', afterG === 0 && n.gear === 1, `${afterG} / ${n.gear}`);
}
{ // a held action moved, Shift removed from the throttle
  const t = resolveKeys(null); t.throttleUp = ['KeyR']; assignKey(t, 'throttleUp', 'KeyR');
  const c = iso(keyOverrides(t)), n = count(c, 'reset');
  ev('keydown', 'KeyR'); run(c, 1); ev('keyup', 'KeyR'); const thr = c.throttle;
  ev('keydown', 'ShiftLeft', { shiftKey: true }); run(c, 1); ev('keyup', 'ShiftLeft');
  check('throttle up on R (taken off Restart): R pushes it, Restart no longer fires, Shift no longer pushes', thr > 0.3 && Math.abs(c.throttle - thr) < 1e-9 && n.reset === 0 && t.reset.length === 0, `thr ${thr.toFixed(2)} -> ${c.throttle.toFixed(2)}`);
}
{ // pitch on I / K, a Shift chord for a press action
  const t = resolveKeys(null); t.pitchDown = []; t.pitchUp = []; assignKey(t, 'pitchDown', 'KeyI'); assignKey(t, 'pitchUp', 'KeyK'); assignKey(t, 'gear', 'Shift+KeyL');
  const c = iso(keyOverrides(t)), n = count(c, 'gear', 'autopilot', 'instruments');
  ev('keydown', 'KeyK'); run(c, 0.5); const pull = c.axes.pitch; ev('keyup', 'KeyK'); run(c, 0.5); ev('keydown', 'ArrowDown'); run(c, 0.5); const arrow = c.axes.pitch; ev('keyup', 'ArrowDown');
  tap('KeyL', { shiftKey: true }); tap('KeyL');
  check('pitch on I/K: K pulls, the arrow no longer does; K/I left Autopilot and Strip; Shift+L gear fires only with Shift', pull > 0.5 && Math.abs(arrow) < 1e-6 && n.autopilot === 0 && n.instruments === 0 && n.gear === 1 && t.autopilot.length === 0, `pull ${pull.toFixed(2)} arrow ${arrow.toFixed(2)} gear ${n.gear}`);
}
{ // contexts: slew climb shares PgUp with the throttle by default; assigning within a context moves, across contexts does not
  const t = resolveKeys(null), r = assignKey(t, 'slewUp', 'KeyE');
  check('slew-mode keys may reuse flight keys (E stays on the throttle)', r.ok && t.throttleUp.includes('KeyE') && t.slewUp.includes('KeyE'));
  const r2 = assignKey(t, 'chute', 'KeyG');
  check('a key taken in the same context leaves its old action', r2.moved.join() === 'gear' && t.gear.length === 0 && t.chute.includes('KeyG'));
  check('Shift alone only for held controls', !assignKey(t, 'gear', 'Shift').ok && assignKey(t, 'brakes', 'Shift').ok);
}
{ // overrides save only what changed and survive a round trip
  const t = resolveKeys(null); assignKey(t, 'map', 'Digit1'); // a key no action uses (N is the moving map since the cockpit map)
  const o = keyOverrides(t);
  check('only changed actions are saved', Object.keys(o).join() === 'map' && o.map.join() === 'KeyM,Digit1');
  check('round trip', JSON.stringify(resolveKeys(JSON.parse(JSON.stringify(o)))) === JSON.stringify(t));
  check('a broken save falls back to the defaults', JSON.stringify(resolveKeys({ gear: 'nope', map: [3, 'KeyM'] }).gear) === JSON.stringify(DEFAULT_KEYS.gear) && resolveKeys({ map: [3, 'KeyM'] }).map.join() === 'KeyM');
}
check('key names', ['KeyG', 'ArrowUp', 'Shift+KeyF', 'Digit9', 'Semicolon', 'PageUp', 'Shift'].map(keyName).join(' ') === "G ↑ Shift+F 9 ; PgUp Shift");
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('keymap tests passed');
