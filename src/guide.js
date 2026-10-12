// First-flight controls guide: a small card with a picture of the keys to press, the keys light up as you press them, each step
// completes when the jet does the thing, and the whole guide can be skipped or quit at any time. Never touches the controls.
const K = (l, c, cls = '') => ({ l, c: [].concat(c), cls });
const STEPS = [
  { id: 'throttle', title: 'Add power', text: 'The engines need about 8 seconds to spool and light the afterburners. Hold B (brakes), push the throttle with Shift (Ctrl pulls it back) or drag the lever, then release B.',
    pads: [{ rows: [[K('Shift', ['ShiftLeft', 'ShiftRight'], 'wide'), K('Ctrl', ['ControlLeft', 'ControlRight'], 'wide')]], cap: 'throttle up · down' }, { rows: [[K('B', 'KeyB'), K('9', 'Digit9'), K('0', 'Digit0')]], cap: 'brakes · full A/B · idle' }],
    live: (c) => `Throttle ${Math.round(c.throttle * 100)}%`, done: (c) => c.throttle > 0.7 },
  { id: 'steer', title: 'Keep it straight', text: 'The jet is rolling. On the ground A and D steer the nose wheel, so tap them gently to stay on the centre line.',
    pads: [{ rows: [[K('A', 'KeyA'), K('D', 'KeyD')]], cap: 'steer left · right' }],
    live: (c) => `Speed ${Math.round(c.iasKt)} kt (rotate at about 200)`, done: (c) => c.iasKt > 150 || !c.onGround },
  { id: 'rotate', title: 'Lift off', text: 'Hold S gently to raise the nose to about 10°, then let the jet fly itself off. W lowers the nose.',
    pads: [{ rows: [[K('W', 'KeyW')], [K('S', 'KeyS')]], cap: 'nose down · up' }],
    live: (c) => `Pitch ${Math.round(c.pitchDeg)}°  Speed ${Math.round(c.iasKt)} kt`, done: (c) => !c.onGround && c.agl > 10 },
  { id: 'gear', title: 'Gear up', text: 'You are climbing away. Press G to retract the landing gear.',
    pads: [{ rows: [[K('G', 'KeyG')]], cap: 'landing gear' }], done: (c) => !c.gearDown },
  { id: 'roll', title: 'Bank and turn', text: 'In the air A and D roll the jet. Use small taps, hold the bank for a moment, then level out. Finding it twitchy? Options → Flight assist levels the wings when you let go of the keys. On approach the Landing aid (also in Options) eases the sink rate below 150 ft; touch the pitch keys to flare yourself.',
    pads: [{ rows: [[K('A', 'KeyA'), K('D', 'KeyD')]], cap: 'roll left · right' }], done: (c) => Math.abs(c.bankDeg) > 12 },
  { id: 'view', title: 'Look around', text: 'V cycles the camera views: cockpit, chase, orbit and more. Drag with the mouse to look around, scroll to zoom.',
    pads: [{ rows: [[K('V', 'KeyV')]], cap: 'next view' }, { rows: [[K('K', 'KeyK'), K('M', 'KeyM'), K('?', 'Slash')]], cap: 'autopilot · map · all controls' }],
    done: (c, s) => c.view !== s.view0 },
];

export class Guide {
  constructor({ el, controls, ctx, onChange }) {
    this.el = el; this.controls = controls; this.ctx = ctx; this.i = 0; this.active = false; this.s = {}; this.ok = []; this.onChange = onChange || (() => {});
    this.q = (id) => el.querySelector('#' + id);
    this.q('g-quit').addEventListener('click', () => this.stop(true));
    this.q('g-skip').addEventListener('click', () => this.next());
    this.q('g-never').addEventListener('click', () => { try { localStorage.setItem('guideSeen', '1'); } catch { /* storage may be off */ } this.stop(true); });
  }
  static seen() { try { return localStorage.getItem('guideSeen') === '1'; } catch { return false; } }
  start() { this.active = true; this.i = -1; this.ok = []; this.el.hidden = false; this.next(); this.onChange(true); }
  stop(mark) { this.active = false; this.el.hidden = true; if (mark) try { localStorage.setItem('guideSeen', '1'); } catch { /* ignore */ } this.onChange(false); }
  next() {
    if (this.i >= 0) this.ok[this.i] = true;
    this.i++; this.s = { view0: this.ctx().view }; this.done = 0;
    if (this.i >= STEPS.length) { this.finish(); return; }
    this.render();
  }
  finish() {
    this.active = false; try { localStorage.setItem('guideSeen', '1'); } catch { /* ignore */ }
    this.q('g-step').textContent = 'ALL SET'; this.q('g-title').textContent = 'You are flying the Blackbird';
    this.q('g-text').textContent = 'Press ? or open Controls in the left dock any time to see every key. The throttle lever stays on the right edge.';
    this.q('g-keys').innerHTML = ''; this.q('g-live').textContent = ''; this.q('g-skip').hidden = true; this.q('g-never').hidden = true;
    this.dots(); setTimeout(() => { if (!this.active) this.el.hidden = true; this.onChange(false); }, 7000);
  }
  dots() { this.q('g-dots').innerHTML = STEPS.map((_, k) => `<i class="${this.ok[k] ? 'ok' : k === this.i ? 'on' : ''}"></i>`).join(''); }
  render() {
    const st = STEPS[this.i]; this.q('g-step').textContent = `STEP ${this.i + 1} OF ${STEPS.length}`; this.q('g-title').textContent = st.title; this.q('g-text').textContent = st.text;
    this.q('g-skip').hidden = false; this.q('g-never').hidden = false;
    this.q('g-keys').innerHTML = st.pads.map((p) => `<div><div class="g-pad">${p.rows.map((r) => `<div class="row">${r.map((k) => `<span class="g-key hot ${k.cls}" data-c="${k.c.join(',')}">${k.l}</span>`).join('')}</div>`).join('')}</div><div class="g-cap">${p.cap}</div></div>`).join('');
    this.dots();
  }
  update(dt) {
    if (!this.active || this.i < 0 || this.i >= STEPS.length) return;
    const st = STEPS[this.i], c = this.ctx();
    for (const k of this.el.querySelectorAll('.g-key')) { const codes = k.dataset.c.split(','), down = codes.some((x) => this.controls.keys.has(x)); k.classList.toggle('down', down); }
    this.q('g-live').textContent = st.live ? st.live(c) : '';
    if (st.done(c, this.s)) { this.done += dt; if (this.done > 0.8) this.next(); } else this.done = 0;
  }
}
