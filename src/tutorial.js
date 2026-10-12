// Interactive first-flight tutorial. It never touches the controls: each step names one thing to do, watches the aircraft state
// for it, and gives live hints when the pilot is heading for trouble. A finished step shows a tick for a moment, then the next appears.
const wrap180 = (a) => ((a + 540) % 360) - 180;

export const STEPS = [
  { id: 'look', title: 'Look around',
    text: 'Drag the mouse to swing the camera round the jet and scroll to zoom. Press V to cycle through the views, then come back to this one.',
    enter: (c, s) => { s.view0 = c.view; s.az0 = c.orbitAz; },
    done: (c, s) => c.view !== s.view0 || Math.abs(c.orbitAz - s.az0) > 0.5 },
  { id: 'throttle', title: 'Light the burners',
    text: 'Press 9 for full afterburner. E and Q change the throttle (so do + and −, or PgUp and PgDn) and 0 is idle. The engines take a few seconds to spool up.',
    done: (c) => c.throttle > 0.9 },
  { id: 'roll', title: 'Take-off roll',
    text: 'Keep the nose wheel on the centre line with A and D. At about 190 kt you will rotate.',
    live: (c) => `Speed ${Math.round(c.iasKt)} kt`,
    hint: (c) => (c.xtk == null || !c.onGround ? '' : c.xtk > 8 ? 'Right of the centre line. Steer left with A.' : c.xtk < -8 ? 'Left of the centre line. Steer right with D.' : ''),
    done: (c) => c.iasKt >= 185 || !c.onGround },
  { id: 'rotate', title: 'Rotate',
    text: 'Hold S gently to bring the nose up to about 10 degrees. Let the jet fly itself off the runway, then ease off.',
    live: (c) => `Pitch ${Math.round(c.pitchDeg)}°  Speed ${Math.round(c.iasKt)} kt`,
    hint: (c) => (c.onGround && c.iasKt > 215 && c.pitchDeg < 4 ? 'You are past 215 kt. Pull back with S now.' : c.pitchDeg > 16 ? 'Too steep. Tap W to lower the nose.' : ''),
    done: (c) => !c.onGround && c.agl > 8 },
  { id: 'gear', title: 'Gear up',
    text: 'You are climbing away. Press G to retract the landing gear.',
    hint: (c) => (c.gearDown && c.agl > 400 ? 'The gear is still down. Press G.' : ''),
    done: (c) => !c.gearDown },
  { id: 'climb', title: 'Climb',
    text: 'Hold roughly 10 degrees nose up. Speed matters more than height: if the speed falls away, lower the nose. A climb that is too steep stalls the wing.',
    live: (c) => `Pitch ${Math.round(c.pitchDeg)}°  Speed ${Math.round(c.iasKt)} kt  Altitude ${Math.round(c.altFt / 100) * 100} ft`,
    hint: (c) => (c.pitchDeg > 20 ? 'Too steep. The wing will stall and you will lose height. Lower the nose with W.'
      : c.iasKt < 250 ? 'Speed is dropping. Lower the nose with W.' : c.pitchDeg < 3 ? 'Raise the nose a little with S.' : ''),
    done: (c) => c.altFt > 6000 },
  { id: 'trim', title: 'Throttle back',
    text: 'Afterburner burns fuel very quickly. Pull the throttle back to about 85 percent with Q and watch the THROTTLE readout.',
    live: (c) => `Throttle ${Math.round(c.throttle * 100)}%`,
    hint: (c) => (c.throttle <= 0.4 ? 'That is too far back. Add some with E.' : c.pitchDeg > 20 ? 'Lower the nose with W, you are too steep.' : ''),
    done: (c) => c.throttle < 0.92 && c.throttle > 0.4 },
  { id: 'ap', title: 'Autopilot',
    text: 'Press K to engage the autopilot. It holds your current heading, altitude and speed. Any move of the stick takes control back.',
    done: (c) => c.apOn },
  { id: 'apalt', title: 'Change altitude',
    text: 'Open the A/P panel in the left rail. Set ALT to a new height, either by typing it or with the arrow buttons. The jet climbs or descends by itself.',
    enter: (c, s) => { s.alt0 = c.apAltFt; },
    live: (c) => `Altitude ${Math.round(c.altFt / 100) * 100} ft  Target ${Math.round(c.apAltFt / 100) * 100} ft`,
    done: (c, s) => Math.abs(c.apAltFt - s.alt0) >= 1500 },
  { id: 'aphdg', title: 'Change heading',
    text: 'Now set HDG to a heading about 90 degrees away from where you are pointing. The autopilot banks into the turn and rolls out on the new heading.',
    enter: (c, s) => { s.hdg0 = c.apHdg; },
    live: (c) => `Heading ${Math.round(c.hdg)}°  Target ${Math.round(c.apHdg)}°`,
    done: (c, s) => Math.abs(wrap180(c.apHdg - s.hdg0)) >= 45 && Math.abs(wrap180(c.hdg - c.apHdg)) < 6 },
  { id: 'takeover', title: 'Take control',
    text: 'Press any of W, S, A or D, or press K again. The autopilot disconnects and the jet is yours. Use small inputs and keep the nose level.',
    done: (c) => !c.apOn },
];

export class Tutorial {
  constructor() { this.active = false; this.i = 0; this.s = {}; this.pt = 0; this.passed = false; this.final = 0; }
  start(c) { this.active = true; this.i = 0; this.s = {}; this.pt = 0; this.passed = false; this.final = 0; this.entered = false; this.c0 = c; }
  stop() { this.active = false; }
  skip() { if (this.active && this.i < STEPS.length) { this.passed = true; this.pt = 1e9; } }
  // c: aircraft state; returns what the coach card should show, or null once the tutorial is over
  update(dt, c) {
    if (!this.active) return null;
    if (this.i >= STEPS.length) {
      this.final += dt;
      if (this.final > 12) { this.stop(); return null; }
      return { label: 'Tutorial', title: 'Tutorial complete', ok: true, next: false,
        text: 'You have flown a take-off, a climb and the autopilot. For landings, pick Landing 1 or Landing 2 under Mission in Flight setup, then press R.' };
    }
    const st = STEPS[this.i], label = `Step ${this.i + 1} of ${STEPS.length}`;
    if (!this.entered) { this.entered = true; st.enter && st.enter(c, this.s); }
    if (this.passed) {
      this.pt += dt;
      if (this.pt > 1.1) { this.i++; this.s = {}; this.pt = 0; this.passed = false; this.entered = false; }
      return { label, title: st.title, ok: true, next: false, text: 'Done.' };
    }
    if (st.done(c, this.s)) { this.passed = true; this.pt = 0; }
    return { label, title: st.title, text: st.text, live: st.live ? st.live(c) : '', hint: st.hint ? st.hint(c) : '', ok: false, next: true };
  }
}
