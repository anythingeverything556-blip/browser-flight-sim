const Kr = (s, t, e) => Math.min(e, Math.max(t, s)),
  M2 = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Home', 'End', 'F1'],
  w2 = (s) =>
    s &&
    (s.isContentEditable ||
      s.tagName === 'TEXTAREA' ||
      s.tagName === 'SELECT' ||
      (s.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(s.type)));
// ---------- key bindings (Settings → Keyboard controls) ----------
// Each action has a list of keys: a KeyboardEvent.code ('KeyG', 'ArrowUp'), 'Shift+<code>' for a chord, or 'Shift' alone (held actions only).
// hold: read every frame while down; otherwise fired once on the key press. ctx: keys only conflict within one context (slew mode reuses keys).
// The defaults are the simulator's original keys, so an unedited setup behaves exactly as before.
export const KEY_ACTIONS = [
  { id: 'pitchDown', label: 'Nose down (push)', group: 'Flight controls', hold: true, keys: ['ArrowUp', 'KeyW'] },
  { id: 'pitchUp', label: 'Nose up (pull)', group: 'Flight controls', hold: true, keys: ['ArrowDown', 'KeyS'] },
  { id: 'rollLeft', label: 'Roll left', group: 'Flight controls', hold: true, keys: ['ArrowLeft'] },
  { id: 'rollRight', label: 'Roll right', group: 'Flight controls', hold: true, keys: ['ArrowRight'] },
  { id: 'rollSteerLeft', label: 'Roll left in the air · steer left on the ground', group: 'Flight controls', hold: true, keys: ['KeyA'] },
  { id: 'rollSteerRight', label: 'Roll right in the air · steer right on the ground', group: 'Flight controls', hold: true, keys: ['KeyD'] },
  { id: 'yawLeft', label: 'Rudder left (nose-wheel steering)', group: 'Flight controls', hold: true, keys: ['KeyZ', 'Comma'] },
  { id: 'yawRight', label: 'Rudder right (nose-wheel steering)', group: 'Flight controls', hold: true, keys: ['KeyX', 'Period'] },
  { id: 'trimDown', label: 'Pitch trim nose down', group: 'Flight controls', hold: true, keys: ['Semicolon'] },
  { id: 'trimUp', label: 'Pitch trim nose up', group: 'Flight controls', hold: true, keys: ['Quote'] },
  { id: 'throttleUp', label: 'Throttle up (hold)', group: 'Engine', hold: true, keys: ['Shift', 'KeyE', 'PageUp', 'Equal', 'NumpadAdd', 'BracketRight'] },
  { id: 'throttleDown', label: 'Throttle down (hold)', group: 'Engine', hold: true, keys: ['KeyQ', 'PageDown', 'Minus', 'NumpadSubtract', 'BracketLeft'] },
  { id: 'idle', label: 'Throttle to idle', group: 'Engine', keys: ['Digit0'] },
  { id: 'fullAB', label: 'Full power (SR-71: max afterburner)', group: 'Engine', keys: ['Digit9'] },
  { id: 'brakes', label: 'Wheel brakes (hold)', group: 'Ground and gear', hold: true, keys: ['KeyB', 'Space'] },
  { id: 'parkingBrake', label: 'Parking brake', group: 'Ground and gear', keys: ['Shift+KeyB'] },
  { id: 'gear', label: 'Landing gear (Skyhawk: tail wheel; Vision Jet: retractable)', group: 'Ground and gear', keys: ['KeyG'] },
  { id: 'flapsDown', label: 'Flaps down a notch, then back to 0 (Skyhawk, Vision Jet)', group: 'Ground and gear', keys: ['KeyF'] },
  { id: 'doors', label: 'Cabin door open / close, on the ground (Vision Jet)', group: 'Ground and gear', keys: ['Shift+KeyN'] },
  { id: 'flapsUp', label: 'Flaps up a notch (Skyhawk, Vision Jet)', group: 'Ground and gear', keys: ['Shift+KeyF'] },
  { id: 'chute', label: 'Drag chute (SR-71)', group: 'Ground and gear', keys: ['KeyC'] },
  { id: 'autopilot', label: 'Autopilot on / off', group: 'Autopilot and aids', keys: ['KeyK'] },
  { id: 'recover', label: 'Recover from an unusual attitude', group: 'Autopilot and aids', keys: ['KeyU'] },
  { id: 'takeoff', label: 'Auto take-off (SR-71)', group: 'Autopilot and aids', keys: ['KeyT'] },
  { id: 'goAround', label: 'Go around', group: 'Autopilot and aids', keys: ['KeyJ'] },
  { id: 'autoland', label: 'Autoland on the selected arrival (Vision Jet)', group: 'Autopilot and aids', keys: ['Shift+KeyK'] },
  { id: 'safeReturn', label: 'Safe Return: emergency autoland at the nearest airport (Vision Jet)', group: 'Autopilot and aids', keys: ['Shift+KeyU'] },
  { id: 'nextView', label: 'Next view', group: 'Simulator', keys: ['KeyV'] },
  { id: 'prevView', label: 'Previous view', group: 'Simulator', keys: ['Shift+KeyV'] },
  { id: 'map', label: 'Map', group: 'Simulator', keys: ['KeyM'] },
  { id: 'pause', label: 'Pause', group: 'Simulator', keys: ['KeyP'] },
  { id: 'reset', label: 'Restart', group: 'Simulator', keys: ['KeyR'] },
  { id: 'hud', label: 'HUD overlay', group: 'Simulator', keys: ['KeyH'] },
  { id: 'instruments', label: 'Flight data strip', group: 'Simulator', keys: ['KeyI'] },
  { id: 'sound', label: 'Sound on / off', group: 'Simulator', keys: ['KeyO'] },
  { id: 'help', label: 'Help (this list)', group: 'Simulator', keys: ['Slash', 'F1'] },
  { id: 'slew', label: 'Slew mode on / off', group: 'Simulator', keys: ['KeyY'] },
  { id: 'timeWarp', label: 'Time warp: 1x, 2x, 4x, 8x, 16x (cycles; back to 1x below 1,000 ft)', group: 'Simulator', keys: ['Backquote'] },
  { id: 'cockpitMap', label: 'Moving map on / off', group: 'Simulator', keys: ['KeyN'] },
  { id: 'tuneIls', label: 'Tune the ILS of the nearest runway ahead (no autopilot needed)', group: 'Autopilot and aids', keys: ['Backslash'] },
  { id: 'refuel', label: 'Refuel (stopped on the ground; SR-71 also from a tanker below 30,000 ft)', group: 'Ground and gear', keys: ['KeyL'] },
  { id: 'slewUp', label: 'Slew mode: climb', group: 'Slew mode', hold: true, ctx: 'slew', keys: ['PageUp'] },
  { id: 'slewDown', label: 'Slew mode: descend', group: 'Slew mode', hold: true, ctx: 'slew', keys: ['PageDown'] },
];
const ACTION = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a]));
export const DEFAULT_KEYS = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, [...a.keys]]));
// keys the editor will not take: Escape closes menus; Ctrl / Alt / Meta chords belong to the browser (Ctrl+W closes the tab)
export const RESERVED_KEYS = new Set(['Escape', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu', 'Tab', 'CapsLock']);
// the full table from saved overrides (only actions the player changed are saved)
export function resolveKeys(over) {
  const out = {}; for (const a of KEY_ACTIONS) out[a.id] = Array.isArray(over && over[a.id]) ? over[a.id].filter((k) => typeof k === 'string') : [...a.keys];
  return out;
}
export function keyOverrides(table) {
  const out = {}; for (const a of KEY_ACTIONS) { const k = table[a.id] || []; if (k.join('|') !== a.keys.join('|')) out[a.id] = [...k]; }
  return out;
}
// bind key to action (appended); the same key is taken off any other action in the same context. Returns the actions it was taken from.
export function assignKey(table, id, key) {
  const ctx = ACTION[id].ctx || 'main', moved = [];
  if (key === 'Shift' && !ACTION[id].hold) return { ok: false, why: 'Shift alone only works for held controls' };
  for (const a of KEY_ACTIONS) if (a.id !== id && (a.ctx || 'main') === ctx && table[a.id].includes(key)) { table[a.id] = table[a.id].filter((k) => k !== key); moved.push(a.id); }
  if (!table[id].includes(key)) table[id] = [...table[id], key];
  return { ok: true, moved };
}
const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '=', Backquote: '`', PageUp: 'PgUp', PageDown: 'PgDn', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', ShiftLeft: 'Shift', ShiftRight: 'Shift', Shift: 'Shift' };
export function keyName(k) {
  if (k.startsWith('Shift+')) return 'Shift+' + keyName(k.slice(6));
  if (NAMES[k]) return NAMES[k];
  if (/^Key[A-Z]$/.test(k)) return k.slice(3);
  if (/^Digit\d$/.test(k)) return k.slice(5);
  if (/^Numpad\d$/.test(k)) return 'Num ' + k.slice(6);
  return k;
}

const UI_ACTIONS = new Set(['help', 'nextView', 'prevView', 'pause', 'reset', 'map', 'hud', 'instruments', 'sound']), // still work while paused; everything that flies the jet does not
  PAD_DEAD = 0.12, PAD_OVERRIDE = 0.3, PB_CHORD_S = 0.3;
class Controls {
  constructor() {
    ((this.keys = new Set()),
      (this.axes = { pitch: 0, roll: 0, yaw: 0 }),
      (this.throttle = 0),
      (this.touched = !1),
      (this.brake = 0),
      (this.mouseStick = !1),
      (this.mouse = { x: 0, y: 0 }),
      (this.mouseMoved = !1),
      (this.handlers = {}),
      (this.manual = !1),
      (this._enabled = !0),
      (this.locked = !1),
      (this.shiftT = 0),
      (this.padLive = {}),
      (this.onGround = !1),
      (this.ground = !1),
      (this.groundFor = 0),
      (this.pbChord = !1),
      (this.chordKeys = new Set()),
      this.setBindings(null),
      window.addEventListener('keydown', (t) => {
        w2(t.target) ||
          t.ctrlKey ||
          t.metaKey ||
          t.altKey ||
          (M2.includes(t.key) && t.preventDefault(),
          !this.keys.has(t.code) && this.enabled && this.fire(t),
          this.keys.add(t.code));
      }),
      window.addEventListener('keyup', (t) => { this.keys.delete(t.code); this.chordKeys.delete(t.code); if (t.code === 'ShiftLeft' || t.code === 'ShiftRight') this.pbChord = false; }),
      window.addEventListener('blur', () => { this.keys.clear(); this.chordKeys.clear(); this.pbChord = false; this.centerMouse(); }),
      window.addEventListener('mouseout', (t) => { t.relatedTarget || this.centerMouse(); }),
      window.addEventListener('mousemove', (t) => {
        if (!t.target || t.target.id !== 'view') { this.centerMouse(); return; }
        const e = (t.clientX / innerWidth) * 2 - 1,
          n = (t.clientY / innerHeight) * 2 - 1;
        (Math.abs(e - this.mouse.x) + Math.abs(n - this.mouse.y) > 0.01 && (this.mouseMoved = !0),
          (this.mouse.x = e),
          (this.mouse.y = n));
      }));
  }
  // over: saved per-action overrides (or a full table); the press lookup maps a key or 'Shift+key' to its action
  setBindings(over) {
    this.bind = resolveKeys(over);
    this.press = new Map();
    for (const a of KEY_ACTIONS) if (!a.hold) for (const k of this.bind[a.id]) this.press.set(k, a.id);
  }
  // is a held action's key down? 'Shift' alone counts unless a Shift chord is in use (Shift+B parking brake, Shift+V, Shift+F, ?)
  held(id) {
    const e = this.keys, shift = e.has('ShiftLeft') || e.has('ShiftRight');
    for (const k of this.bind[id]) {
      if (k === 'Shift') { if (shift && !this.pbChord && !this.chordKeys.size) return true; }
      else if (k.startsWith('Shift+')) { if (shift && e.has(k.slice(6))) return true; }
      else if (e.has(k)) return true;
    }
    return false;
  }
  get enabled() {
    return this._enabled;
  }
  set enabled(v) {
    this._enabled = !!v;
    this._enabled || this.releaseAll();
  }
  setEnabled(v) {
    this.enabled = v;
  }
  setLocked(v) {
    this.locked = !!v;
    this.locked && this.releaseAll();
  }
  releaseAll() {
    this.axes.pitch = this.axes.roll = this.axes.yaw = 0; this.brake = 0; this.manual = false; this.pbChord = false; this.shiftT = 0;
    this.slew = { fwd: 0, turn: 0, up: 0 }; this.trimUp = this.trimDown = false;
  }
  centerMouse() {
    this.mouse.x = this.mouse.y = 0; this.mouseMoved = false;
  }
  on(t, e) {
    this.handlers[t] = e;
  }
  fire(t) {
    const e = this.handlers, n = t.code, shift = t.shiftKey && n !== 'ShiftLeft' && n !== 'ShiftRight';
    // a Shift chord first ('Shift+KeyF'), then the plain key (Shift+G is still the gear, '?' is Shift+/ for help)
    let act = shift ? this.press.get('Shift+' + n) : undefined, chord = !!act;
    if (!act) act = this.press.get(n);
    if (act === 'parkingBrake' && chord) {
      // Shift already pushing the throttle for a while = B is the brakes (guide step 1), not a parking-brake chord
      if (this.held('throttleUp') && this.bind.throttleUp.includes('Shift') && this.shiftT >= PB_CHORD_S) return;
      this.pbChord = true; // Shift was the chord's modifier: it must not also push the throttle until it is let go
    }
    if (shift && act) this.chordKeys.add(n);
    act && e[act] && (!this.locked || UI_ACTIONS.has(act)) && e[act]();
  }
  update(t) {
    if (this.onGround === this.ground) this.groundFor = 0;
    else if ((this.groundFor += t) > 0.25) ((this.ground = this.onGround), (this.groundFor = 0));
    if (!this.enabled || this.locked) { this.releaseAll(); this.padEdges(); return; }
    const e = this.keys,
      // Exponential smoothing: the stick starts moving the instant a key goes down and eases to full over ~0.35 s. A fast
      // reversal and a quick release keep it from feeling like it lags behind the fingers.
      n = (d, p, v) => {
        const g = (v ? 1 : 0) - (p ? 1 : 0),
          tau = g ? (Math.sign(g) !== Math.sign(d) && d ? 0.07 : 0.14) : 0.1,
          out = d + (g - d) * (1 - Math.exp(-t / tau));
        return Math.abs(out) < 0.002 && !g ? 0 : Kr(out, -1, 1);
      },
      kA = this.held('rollSteerLeft'),
      kD = this.held('rollSteerRight'),
      up = this.held('pitchDown'),
      down = this.held('pitchUp'),
      // On the ground A/D steer the nose wheel (rudder axis); in the air they roll, like the arrows.
      i = up,
      r = down,
      a = this.held('rollLeft') || (!this.ground && kA),
      l = this.held('rollRight') || (!this.ground && kD),
      h = this.held('yawLeft') || (this.ground && kA),
      u = this.held('yawRight') || (this.ground && kD);
    if (
      ((this.manual = i || r || a || l),
      (this.axes.pitch = n(this.axes.pitch, i, r)),
      (this.axes.roll = n(this.axes.roll, a, l)),
      (this.axes.yaw = n(this.axes.yaw, h, u)),
      this.mouseStick)
    ) {
      const d = (p) => (Math.abs(p) < 0.04 ? 0 : p);
      ((this.axes.roll = Kr(d(this.mouse.x) * 1.3, -1, 1)),
        (this.axes.pitch = Kr(d(this.mouse.y) * 1.3, -1, 1)),
        this.mouseMoved && (this.manual = !0));
    }
    this.mouseMoved = !1;
    this.shiftT = e.has('ShiftLeft') || e.has('ShiftRight') ? this.shiftT + t : 0;
    // throttle (default Shift / E up, Q down). Not Ctrl: held Ctrl turned W/S/G into browser shortcuts (Ctrl+W closed the tab).
    // B held for the brakes still lets Shift push the throttle (the first guide step); a Shift chord (Shift+B, Shift+V, ?) holds it off
    const thrUp = this.held('throttleUp'), thrDn = this.held('throttleDown');
    if (thrUp) { this.throttle = Kr(this.throttle + 0.35 * t, 0, 1); this.touched = true; }
    if (thrDn) { this.throttle = Kr(this.throttle - 0.35 * t, 0, 1); this.touched = true; }
    ((this.slewKeys = 0),
      (this.trimUp = this.held('trimUp')),
      (this.trimDown = this.held('trimDown')),
      (this.brake = this.held('brakes') ? 1 : 0),
      (this.slew = {
        fwd: i ? 1 : r ? -1 : 0,
        turn: l || kD ? 1 : a || kA ? -1 : 0,
        up: this.held('slewUp') ? 1 : this.held('slewDown') ? -1 : 0,
      }));
    const f = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const d of f) {
      if (!d || d.connected === false) continue;
      const std = d.mapping === 'standard',
        ax = (k) => this.padAxis(d, k),
        v = ax(0),
        y = ax(1),
        x = std ? ax(2) : 0; // yaw only where axis 2 is known to be the right stick: elsewhere it is often a trigger or twist
      if (v || y) { this.axes.roll = v; this.axes.pitch = y; if (Math.max(Math.abs(v), Math.abs(y)) > PAD_OVERRIDE) this.manual = true; } // drift and light touches fly the jet but do not cancel the autopilot
      x && (this.axes.yaw = x);
      if (std) {
        const g = d.buttons[7] ? d.buttons[7].value : 0,
          _ = d.buttons[6] ? d.buttons[6].value : 0;
        (g > 0.1 || _ > 0.1) && ((this.throttle = Kr(this.throttle + (g - _) * 0.5 * t, 0, 1)), (this.touched = !0));
        const dp = (d.buttons[12] && d.buttons[12].pressed ? 1 : 0) - (d.buttons[13] && d.buttons[13].pressed ? 1 : 0);
        dp && ((this.throttle = Kr(this.throttle + dp * 0.4 * t, 0, 1)), (this.touched = !0));
        const w = (S) => d.buttons[S] && d.buttons[S].pressed,
          b = this.padPrev || {};
        w(1) && (this.brake = 1);
        (w(0) && !b[0] && this.handlers.gear && this.handlers.gear(),
          w(3) && !b[3] && this.handlers.nextView && this.handlers.nextView());
        this.padPrev = { 0: w(0), 3: w(3) };
      }
      break;
    }
  }
  // axis with a dead zone (rescaled so it still reaches 1); an axis that first reads -1 is an unpressed trigger and counts as 0 until it moves
  padAxis(d, k) {
    const raw = d.axes[k] || 0, id = d.index + ':' + k;
    if (this.padLive[id] === undefined) this.padLive[id] = raw > -0.95;
    if (!this.padLive[id]) { if (raw > -0.9) this.padLive[id] = true; else return 0; }
    return Math.abs(raw) < PAD_DEAD ? 0 : Math.sign(raw) * (Math.abs(raw) - PAD_DEAD) / (1 - PAD_DEAD);
  }
  // keep the button edge state current while the controls are off, so a button held across a resume does not fire
  padEdges() {
    const f = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const d of f) { if (!d || d.connected === false) continue; if (d.mapping === 'standard') this.padPrev = { 0: !!(d.buttons[0] && d.buttons[0].pressed), 3: !!(d.buttons[3] && d.buttons[3].pressed) }; break; }
  }
}

export { Controls };
