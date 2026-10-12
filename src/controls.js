const Kr = (s, t, e) => Math.min(e, Math.max(t, s)),
  M2 = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Home', 'End', 'F1'],
  w2 = (s) =>
    s &&
    (s.isContentEditable ||
      s.tagName === 'TEXTAREA' ||
      s.tagName === 'SELECT' ||
      (s.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(s.type)));
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
      (this.enabled = !0),
      (this.onGround = !1),
      (this.ground = !1),
      (this.groundFor = 0),
      window.addEventListener('keydown', (t) => {
        w2(t.target) ||
          (t.ctrlKey && !/^(Control|Arrow)/.test(t.code)) ||
          t.metaKey ||
          t.altKey ||
          (M2.includes(t.key) && t.preventDefault(),
          !this.keys.has(t.code) && this.enabled && this.fire(t),
          this.keys.add(t.code));
      }),
      window.addEventListener('keyup', (t) => this.keys.delete(t.code)),
      window.addEventListener('blur', () => this.keys.clear()),
      window.addEventListener('mousemove', (t) => {
        if (t.target.id !== 'view') return;
        const e = (t.clientX / innerWidth) * 2 - 1,
          n = (t.clientY / innerHeight) * 2 - 1;
        (Math.abs(e - this.mouse.x) + Math.abs(n - this.mouse.y) > 0.01 && (this.mouseMoved = !0),
          (this.mouse.x = e),
          (this.mouse.y = n));
      }));
  }
  on(t, e) {
    this.handlers[t] = e;
  }
  fire(t) {
    const e = this.handlers,
      n = t.code,
      i = {
        KeyG: 'gear',
        KeyC: 'chute',
        KeyK: 'autopilot',
        KeyU: 'recover',
        Slash: 'help',
        F1: 'help',
        KeyV: t.shiftKey ? 'prevView' : 'nextView',
        KeyP: 'pause',
        KeyR: 'reset',
        KeyM: 'map',
        KeyH: 'hud',
        KeyI: 'instruments',
        KeyY: 'slew',
        Digit0: 'idle',
        Digit9: 'fullAB',
        KeyO: 'sound',
      };
    if (n === 'KeyB' && t.shiftKey) {
      e.parkingBrake && e.parkingBrake();
      return;
    }
    i[n] && e[i[n]] && e[i[n]]();
  }
  update(t) {
    if (this.onGround === this.ground) this.groundFor = 0;
    else if ((this.groundFor += t) > 0.25) ((this.ground = this.onGround), (this.groundFor = 0));
    const e = this.keys,
      // Exponential smoothing: the stick starts moving the instant a key goes down and eases to full over ~0.35 s. A fast
      // reversal and a quick release keep it from feeling like it lags behind the fingers.
      n = (d, p, v) => {
        const g = (v ? 1 : 0) - (p ? 1 : 0),
          tau = g ? (Math.sign(g) !== Math.sign(d) && d ? 0.07 : 0.14) : 0.1,
          out = d + (g - d) * (1 - Math.exp(-t / tau));
        return Math.abs(out) < 0.002 && !g ? 0 : Kr(out, -1, 1);
      },
      kA = e.has('KeyA'),
      kD = e.has('KeyD'),
      up = e.has('ArrowUp') || e.has('KeyW'),
      down = e.has('ArrowDown') || e.has('KeyS'),
      // On the ground A/D steer the nose wheel (rudder axis); in the air they roll, like the arrows.
      i = up,
      r = down,
      a = e.has('ArrowLeft') || (!this.ground && kA),
      l = e.has('ArrowRight') || (!this.ground && kD),
      h = e.has('KeyZ') || e.has('Comma') || (this.ground && kA),
      u = e.has('KeyX') || e.has('Period') || (this.ground && kD);
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
    // throttle: Shift pushes it forward, Ctrl pulls it back (the usual flight-game mapping), plus the older keys
    const shiftUp = (e.has('ShiftLeft') || e.has('ShiftRight')) && !e.has('KeyB') && !e.has('KeyV') && !e.has('Slash'),
      thrUp = shiftUp || e.has('PageUp') || e.has('Equal') || e.has('NumpadAdd') || e.has('BracketRight') || e.has('KeyE'),
      thrDn = e.has('ControlLeft') || e.has('ControlRight') || e.has('PageDown') || e.has('Minus') || e.has('NumpadSubtract') || e.has('BracketLeft') || e.has('KeyQ');
    if (thrUp) { this.throttle = Kr(this.throttle + 0.35 * t, 0, 1); this.touched = true; }
    if (thrDn) { this.throttle = Kr(this.throttle - 0.35 * t, 0, 1); this.touched = true; }
    ((this.slewKeys = 0),
      (this.trimUp = e.has('End')),
      (this.trimDown = e.has('Home')),
      (this.brake = e.has('KeyB') || e.has('Space') ? 1 : 0),
      (this.slew = {
        fwd: i ? 1 : r ? -1 : 0,
        turn: l || kD ? 1 : a || kA ? -1 : 0,
        up: e.has('PageUp') ? 1 : e.has('PageDown') ? -1 : 0,
      }));
    const f = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const d of f) {
      if (!d) continue;
      const p = (S) => (Math.abs(S) < 0.08 ? 0 : S),
        v = p(d.axes[0] || 0),
        y = p(d.axes[1] || 0),
        x = p(d.axes[2] || 0);
      ((v || y) && ((this.axes.roll = v), (this.axes.pitch = y), (this.manual = !0)), x && (this.axes.yaw = x));
      const g = d.buttons[7] ? d.buttons[7].value : 0,
        _ = d.buttons[6] ? d.buttons[6].value : 0;
      (g > 0.05 || _ > 0.05) && ((this.throttle = Kr(this.throttle + (g - _) * 0.5 * t, 0, 1)), (this.touched = !0));
      const dp = (d.buttons[12] && d.buttons[12].pressed ? 1 : 0) - (d.buttons[13] && d.buttons[13].pressed ? 1 : 0);
      dp && ((this.throttle = Kr(this.throttle + dp * 0.4 * t, 0, 1)), (this.touched = !0));
      const w = (S) => d.buttons[S] && d.buttons[S].pressed;
      w(1) && (this.brake = 1);
      const b = this.padPrev || {};
      (w(0) && !b[0] && this.handlers.gear && this.handlers.gear(),
        w(3) && !b[3] && this.handlers.nextView && this.handlers.nextView(),
        (this.padPrev = { 0: w(0), 3: w(3) }));
      break;
    }
  }
}

export { Controls };
