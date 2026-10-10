const Kr = (s, t, e) => Math.min(e, Math.max(t, s)),
  M2 = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Home', 'End'],
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
      (this.brake = 0),
      (this.mouseStick = !1),
      (this.mouse = { x: 0, y: 0 }),
      (this.mouseMoved = !1),
      (this.handlers = {}),
      (this.manual = !1),
      (this.enabled = !0),
      window.addEventListener('keydown', (t) => {
        w2(t.target) ||
          t.ctrlKey ||
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
        KeyA: 'autopilot',
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
    const e = this.keys,
      n = (d, p, v, y = 2.2, x = 3) => {
        const g = (v ? 1 : 0) - (p ? 1 : 0);
        return g
          ? Kr(d + g * y * t * (Math.sign(g) !== Math.sign(d) && d ? 2.5 : 1), -1, 1)
          : Math.abs(d) < x * t
            ? 0
            : d - Math.sign(d) * x * t;
      },
      i = e.has('ArrowUp'),
      r = e.has('ArrowDown'),
      a = e.has('ArrowLeft'),
      l = e.has('ArrowRight'),
      h = e.has('KeyZ') || e.has('Comma'),
      u = e.has('KeyX') || e.has('Period');
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
    ((this.mouseMoved = !1),
      (e.has('PageUp') || e.has('Equal') || e.has('NumpadAdd')) && (this.throttle = Kr(this.throttle + 0.35 * t, 0, 1)),
      (e.has('PageDown') || e.has('Minus') || e.has('NumpadSubtract')) &&
        (this.throttle = Kr(this.throttle - 0.35 * t, 0, 1)),
      (this.trimUp = e.has('End')),
      (this.trimDown = e.has('Home')),
      (this.brake = e.has('KeyB') || e.has('Space') ? 1 : 0),
      (this.slew = {
        fwd: i ? 1 : r ? -1 : 0,
        turn: l ? 1 : a ? -1 : 0,
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
      (g > 0.05 || _ > 0.05) && (this.throttle = Kr(this.throttle + (g - _) * 0.5 * t, 0, 1));
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
