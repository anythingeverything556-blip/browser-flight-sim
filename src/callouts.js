// Radio-altitude call-outs on the way down to a landing (Airbus style): 100, 90 ... 10 ft, then "Retard" until the thrust is at idle.
// Kept free of Web Audio so it can be tested in node; the clips are public/audio/voice/callouts/<key>.mp3 (tools/make-callouts.py).

export const CALLOUT_FT = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
export const CALLOUT_KEYS = [...CALLOUT_FT.map((f) => 'h' + f), 'retard'];
const ARM_FT = 150;          // armed once above this height, re-armed after a go-around climbs back above it
const RETARD_FT = 10;        // "Retard" from here down, after the 10 call
const RETARD_REPEAT = 1.0;   // s of silence between repeats while the thrust stays above idle
const IDLE = 0.05;           // throttle at or below this counts as idle

export class AltCallouts {
  constructor() { this.reset(); }
  reset() { this.armed = false; this.next = 0; this.busyUntil = 0; this.retardAt = 0; this.retardDone = false; this.t = 0; this.groundT = 0; }

  // s: { aglFt (wheels above the ground below), vsFpm, onGround, throttle, gearDown, crashed }; duration(key): clip seconds (0 = not loaded).
  // Returns the key of a clip to play now, or null. A late call is skipped rather than queued: the lowest height already passed is the one said.
  step(s, dt, duration = () => 0.6) {
    this.t += dt;
    if (s.crashed) { this.armed = false; return null; }
    if (s.onGround) { this.groundT += dt; } else this.groundT = 0;
    if (!s.onGround && s.aglFt > ARM_FT) { this.armed = true; this.next = 0; this.retardDone = false; return null; }
    if (!this.armed) return null;
    if (this.t < this.busyUntil) return null;
    const descending = s.onGround || s.vsFpm < -60;
    let key = null;
    if (descending && this.next < CALLOUT_FT.length && s.aglFt <= CALLOUT_FT[this.next] + 0.5) {
      let i = this.next; while (i + 1 < CALLOUT_FT.length && s.aglFt <= CALLOUT_FT[i + 1] + 0.5) i++;
      this.next = i + 1; key = 'h' + CALLOUT_FT[i];
      if (s.onGround) key = null; // touched down before the call came round: say nothing stale
    } else if (this.next >= CALLOUT_FT.length || s.aglFt <= RETARD_FT) {
      this.next = CALLOUT_FT.length;
      const thrustUp = s.throttle > IDLE;
      if ((!this.retardDone || thrustUp) && this.groundT < 3 && this.t >= this.retardAt) { key = 'retard'; this.retardDone = true; }
      if (this.groundT >= 3) this.armed = false; // rolled out: done until the next climb above 150 ft
    }
    if (!key) return null;
    const len = duration(key) || 0.6;
    this.busyUntil = this.t + len;
    if (key === 'retard') this.retardAt = this.t + len + RETARD_REPEAT;
    return key;
  }
}
