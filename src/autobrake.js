// Autobrake: off / low / medium / max. A simulator aid fitted to every aircraft here; the real Il-76, SR-71 and Skyhawk have none.
// Armed in the air or before a take-off roll, it brakes by itself after touchdown (or a rejected take-off) once the thrust lever is
// closed, holding a deceleration through the normal brake path, so anti-skid still works. Pressing the brakes takes over and
// switches it off; pushing the lever up (go-around) lets go until the next landing. Pure: no DOM, tested in node.
export const AUTOBRAKE = ['OFF', 'LOW', 'MED', 'MAX'];
const TARGET = [0, 1.2, 2.0, Infinity]; // m/s2 held; MAX is the full pedal
const IDLE = 0.15, MIN_GS = 2;

export class Autobrake {
  constructor() { this.level = 0; this.reset(); }
  reset() { this.active = false; this.cmd = 0; this.flew = false; this.rolled = false; }
  cycle() { this.level = (this.level + 1) % AUTOBRAKE.length; this.active = false; this.cmd = 0; return AUTOBRAKE[this.level]; }
  // s: { onGround, gs (m/s), accel (m/s2 along the track, negative when slowing), throttle 0..1, pedal 0..1 } -> brake command 0..1
  update(s, dt) {
    if (!this.level) { this.reset(); return 0; }
    if (!s.onGround) { this.flew = true; this.active = false; return (this.cmd = 0); }
    if (s.throttle > 0.5 && s.gs > 40) this.rolled = true; // a take-off roll: closing the lever from here is a rejected take-off
    if (this.active) {
      if (s.pedal > 0.1) { this.level = 0; this.reset(); return 0; }
      if (s.throttle > 0.3) { this.active = false; return (this.cmd = 0); }
      if (s.gs < MIN_GS) { this.reset(); return 0; }
    } else if ((this.flew || this.rolled) && s.throttle < IDLE && s.gs > 15) { this.active = true; this.cmd = 0.15; }
    else if (s.gs < MIN_GS) { this.flew = false; this.rolled = false; }
    if (!this.active) return (this.cmd = 0);
    const want = TARGET[this.level];
    this.cmd = want === Infinity ? 1 : Math.max(0, Math.min(1, this.cmd + (want + s.accel) * 0.35 * dt));
    return this.cmd;
  }
}
