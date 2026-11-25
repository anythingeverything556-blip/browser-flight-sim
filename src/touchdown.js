// One "Touchdown" report per landing. The flight models emit a 'touch' event every time a wheel regains contact with the ground, so
// every bounce of each main wheel on a landing roll, and every bump of a fast taxi or take-off roll over the terrain, became its own
// "Touchdown ... fpm" message (10-16 on one take-off roll over slightly uneven ground). A landing needs a real flight before it
// (airborne at least AIR_MIN seconds), is reported once, with the worst main-wheel sink of that frame, and the bounces after it are not.
export const AIR_MIN = 1.5, QUIET = 6;

export class TouchdownReporter {
  constructor() { this.reset(); }
  // the aircraft was put somewhere new: on the ground nothing has been flown yet; in the air the next contact is a landing once it has flown AIR_MIN
  reset() { this.air = 0; this.since = Infinity; this.armed = 0; }
  // events: this frame's flight-model events; dt: frame time (s); onGround: after the frame. Returns the sink (m/s) to report, or null.
  // The first contact of any wheel after a real flight starts the landing; the first main-wheel contact within a second is the one reported
  // (a nose wheel can meet the ground a frame before the mains).
  frame(events, dt, onGround) {
    let main = 0, any = false;
    for (const e of events) if (e && e.type === 'touch' && e.vs > 0.3) { any = true; if (e.wheel > 0) main = Math.max(main, e.vs); }
    this.since += dt;
    if (any && this.armed <= 0 && this.air >= AIR_MIN && this.since >= QUIET) this.armed = 1;
    let report = null;
    if (this.armed > 0) {
      if (main > 0) { report = main; this.armed = 0; this.since = 0; }
      else { this.armed -= dt; if (this.armed <= 0) this.since = 0; }
    }
    this.air = onGround ? 0 : this.air + dt;
    return report;
  }
}
