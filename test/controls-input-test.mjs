// Controls input rules, driven with synthetic events and fake gamepads (no browser): Shift/B chord, Ctrl/Meta chords go to the browser, mouse stick
// lets go over the UI, gamepad mapping/dead zone/trigger axes/override threshold, and paused or menu inputs do nothing.
const listeners = {};
globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
globalThis.innerWidth = 1000; globalThis.innerHeight = 800;
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
const { Controls } = await import('../src/controls.js');
const { Tutorial, STEPS } = await import('../src/tutorial.js');
const { missionSpawnMode, missionFits, missionSurvivesTeleport } = await import('../src/missions.js');

let fails = 0, prevented = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };
const ev = (type, code, mods = {}) => (listeners[type] || []).forEach((fn) => fn({ code, key: code, target: {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, preventDefault() { prevented.push(code); } }));
const mouse = (type, props) => (listeners[type] || []).forEach((fn) => fn({ target: { id: 'view' }, clientX: 500, clientY: 400, relatedTarget: {}, ...props }));
const run = (c, s) => { for (let t = 0; t < s; t += 1 / 60) c.update(1 / 60); };
const iso = () => { for (const k of Object.keys(listeners)) listeners[k].length = 0; pads = []; const c = new Controls(); c.enabled = true; return c; };
const pad = (axes, pressed = [], over = {}) => ({ index: 0, connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), ...over });

// Shift + B: a quick chord sets the parking brake and does not push the throttle; Shift already pushing the throttle makes B the plain brake
{
  let c = iso(), pb = 0; c.on('parkingBrake', () => pb++); ev('keydown', 'ShiftLeft', { shiftKey: true }); ev('keydown', 'KeyB', { shiftKey: true }); run(c, 1);
  check('Shift then B at once: parking brake, throttle stays', pb === 1 && c.throttle === 0 && c.brake === 1, `pb ${pb} thr ${c.throttle}`);
  ev('keyup', 'KeyB'); ev('keyup', 'ShiftLeft'); run(c, 0.1); ev('keydown', 'ShiftLeft', { shiftKey: true }); run(c, 0.5);
  check('Shift alone no longer moves the throttle (it is only the modifier of the Shift chords)', c.throttle === 0, c.throttle.toFixed(2));
  c = iso(); ev('keydown', 'KeyE'); run(c, 1); check('E pushes the throttle', c.throttle > 0.3, c.throttle.toFixed(2));
  c = iso(); pb = 0; c.on('parkingBrake', () => pb++); ev('keydown', 'KeyB'); ev('keydown', 'KeyE'); run(c, 2.5);
  check('guide step 1 (hold B, push with E): brakes held, throttle > 70 %, no parking brake', pb === 0 && c.brake === 1 && c.throttle > 0.7, c.throttle.toFixed(2));
}

// Ctrl and Meta are no game keys: the chord goes whole to the browser, nothing is swallowed, nothing sticks
{
  const c = iso(); let gear = 0, pause = 0; c.on('gear', () => gear++); c.on('pause', () => pause++); c.throttle = 0.5;
  ev('keydown', 'ControlLeft', { ctrlKey: true }); ev('keydown', 'KeyW', { ctrlKey: true }); ev('keydown', 'KeyG', { ctrlKey: true }); ev('keydown', 'ArrowUp', { ctrlKey: true, key: 'ArrowUp' }); run(c, 1);
  check('Ctrl+W/G/Arrow: no pitch, no gear, never preventDefault (Ctrl+W still closes the tab)', c.axes.pitch === 0 && gear === 0 && prevented.length === 0 && !c.manual, `pitch ${c.axes.pitch} gear ${gear} prevented ${prevented}`);
  check('Ctrl is not a throttle key', c.throttle === 0.5);
  ev('keyup', 'KeyW'); ev('keyup', 'KeyG'); ev('keyup', 'ArrowUp'); ev('keyup', 'ControlLeft'); run(c, 1);
  check('all released: no stuck pitch, no held keys', c.axes.pitch === 0 && c.keys.size === 0);
  ev('keydown', 'KeyG'); ev('keyup', 'KeyG'); check('plain G still works', gear === 1);
  ev('keydown', 'MetaLeft', { metaKey: true }); ev('keydown', 'KeyP', { metaKey: true }); ev('keyup', 'KeyP'); ev('keyup', 'MetaLeft'); check('Meta+P goes to the browser', pause === 0);
  ev('keydown', 'KeyW'); ev('keydown', 'ControlLeft', { ctrlKey: true }); ev('keyup', 'ControlLeft'); run(c, 0.5);
  check('W held across a Ctrl tap keeps pitching', Math.abs(c.axes.pitch) > 0.5, c.axes.pitch.toFixed(2)); ev('keyup', 'KeyW');
  // the bindings are a table now (Settings → Keyboard controls); the editor refuses Ctrl too (RESERVED_KEYS)
  const { DEFAULT_KEYS, RESERVED_KEYS } = await import('../src/controls.js');
  check('no default binding uses Ctrl', Object.values(DEFAULT_KEYS).flat().every((k) => !/Control/.test(k)) && RESERVED_KEYS.has('ControlLeft'));
}

// mouse stick: full deflection ends when the pointer is over the UI or leaves the window
{
  const c = iso(); c.mouseStick = true;
  mouse('mousemove', { clientX: 1000, clientY: 400 }); run(c, 0.1);
  check('mouse stick: cursor at the right edge rolls fully', c.axes.roll === 1, c.axes.roll.toFixed(2));
  mouse('mousemove', { target: { id: 'dock' }, clientX: 1000, clientY: 400 }); run(c, 0.1);
  check('mouse stick: pointer over UI centres the stick', c.axes.roll === 0 && c.axes.pitch === 0);
  mouse('mousemove', { clientX: 1000, clientY: 800 }); run(c, 0.1); mouse('mouseout', { relatedTarget: null }); run(c, 0.1);
  check('mouse stick: pointer leaving the window centres the stick', c.axes.roll === 0 && c.axes.pitch === 0);
  mouse('mousemove', { clientX: 1000, clientY: 400 }); mouse('mouseout', { relatedTarget: {} }); run(c, 0.1);
  check('mouse stick: moving between elements inside the window does not centre it', c.axes.roll === 1);
  mouse('mousemove', { clientX: 1000, clientY: 400 }); (listeners.blur || []).forEach((fn) => fn()); run(c, 0.1);
  check('mouse stick: window blur centres the stick', c.axes.roll === 0);
}

// gamepad
{
  let c = iso(), gear = 0, view = 0; c.on('gear', () => gear++); c.on('nextView', () => view++);
  pads = [pad([0.1, -0.1, 0.11, 0])]; run(c, 1);
  check('pad: stick drift inside the dead zone does nothing', c.axes.roll === 0 && c.axes.pitch === 0 && c.axes.yaw === 0 && !c.manual);
  pads = [pad([0.2, 0, 0, 0])]; run(c, 0.1);
  check('pad: light stick flies but does not count as pilot override', c.axes.roll > 0 && c.axes.roll < 0.2 && !c.manual, c.axes.roll.toFixed(2));
  pads = [pad([0.5, 0, 0, 0])]; run(c, 0.1);
  check('pad: stick beyond 0.3 is pilot override', c.manual === true);
  pads = [pad([1, 0, 0, 0])]; run(c, 0.1);
  check('pad: dead zone is rescaled so the stick still reaches 1', Math.abs(c.axes.roll - 1) < 1e-9);
  c = iso(); pads = [pad([0, 0, -1, 0])]; run(c, 0.5);
  check('pad: axis resting at -1 (trigger) gives no rudder', c.axes.yaw === 0);
  pads = [pad([0, 0, -0.2, 0])]; run(c, 0.1);
  check('pad: the same axis works once it has moved', c.axes.yaw < 0, c.axes.yaw.toFixed(2));
  c = iso(); c.on('gear', () => gear++); gear = 0; pads = [pad([0, 0, 0.8, 0], [0, 7], { mapping: '' })]; run(c, 0.5);
  check('pad: non-standard mapping: no rudder from axis 2, no button actions, no throttle', c.axes.yaw === 0 && gear === 0 && c.throttle === 0, `yaw ${c.axes.yaw} gear ${gear} thr ${c.throttle}`);
  c = iso(); c.on('gear', () => gear++); gear = 0; pads = [pad([0, 0, 0, 0], [0])]; run(c, 0.5);
  check('pad: standard A fires gear once while held', gear === 1, `gear ${gear}`);
  pads = [pad([0, 0, 0, 0], [7])]; run(c, 1);
  check('pad: standard right trigger pushes the throttle', c.throttle > 0.4, c.throttle.toFixed(2));
}

// paused or in the menu: flight inputs do nothing and nothing jumps on resume
{
  const c = iso(); let gear = 0, pause = 0, takeoff = 0, map = 0; c.on('gear', () => gear++); c.on('pause', () => pause++); c.on('takeoff', () => takeoff++); c.on('map', () => map++); c.throttle = 0.4;
  c.setLocked(true);
  ev('keydown', 'KeyQ'); ev('keydown', 'KeyW'); ev('keydown', 'KeyG'); ev('keydown', 'KeyT'); ev('keydown', 'KeyP'); ev('keydown', 'KeyM'); pads = [pad([0.9, 0, 0, 0], [0, 7])]; run(c, 2);
  check('paused: throttle, axes, gear and take-off keys do nothing', c.throttle === 0.4 && c.axes.pitch === 0 && c.axes.roll === 0 && gear === 0 && takeoff === 0 && !c.manual, `thr ${c.throttle}`);
  check('paused: P and M still work', pause === 1 && map === 1);
  ev('keyup', 'KeyQ'); ev('keyup', 'KeyW'); ev('keyup', 'KeyG'); ev('keyup', 'KeyT'); ev('keyup', 'KeyP'); ev('keyup', 'KeyM'); pads = [pad([0, 0, 0, 0], [0])]; c.setLocked(false); run(c, 0.5);
  check('resume: throttle unchanged, held gamepad A does not fire the gear', c.throttle === 0.4 && gear === 0, `thr ${c.throttle} gear ${gear}`);
  const m = iso(); gear = 0; m.on('gear', () => gear++); m.setEnabled(false); ev('keydown', 'KeyG'); ev('keydown', 'KeyE'); run(m, 1);
  check('menu (not enabled): no actions, no throttle', gear === 0 && m.throttle === 0);
  ev('keyup', 'KeyG'); ev('keyup', 'KeyE'); m.setEnabled(true); ev('keydown', 'KeyG'); check('enabled again: actions work', gear === 1);
}

// coach hints stay quiet after a crash or while respawning; mission start rules for R / Return / Airports / map
{
  const t = new Tutorial(), c = { iasKt: 0, agl: 0, altFt: 0, pitchDeg: 0, hdg: 90, onGround: true, gearDown: true, throttle: 0.2, apOn: false, apAltFt: 5000, apHdg: 90, view: 'orbit', orbitAz: 0, xtk: 0 };
  t.start(c); t.i = STEPS.findIndex((x) => x.id === 'trim'); t.update(0.2, c);
  check('tutorial hint shows in flight', t.update(0.2, c).hint !== '');
  check('tutorial hint hidden after a crash', t.update(0.2, { ...c, crashed: 'hard landing' }).hint === '');
  check('tutorial hint hidden while respawning or paused', t.update(0.2, { ...c, started: false }).hint === '');
  check('missions: landing missions start on their approach, tutorial on the runway', missionSpawnMode('landassist') === 'approach' && missionSpawnMode('landhand') === 'final' && missionSpawnMode('tutorial', 'approach') === 'runway' && missionSpawnMode('free', 'cruise') === 'cruise');
  check('missions: fit rules', missionFits('landassist', 'approach') && !missionFits('landassist', 'runway') && !missionFits('tutorial', 'cruise') && missionFits('recon', 'cruise') && missionFits('free', 'final'));
  check('missions: only free, recon and high & fast survive a teleport', missionSurvivesTeleport('recon') && missionSurvivesTeleport('highfast') && !missionSurvivesTeleport('landhand') && !missionSurvivesTeleport('tutorial'));
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('controls input: all passed');
