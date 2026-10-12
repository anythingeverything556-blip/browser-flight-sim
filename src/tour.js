// Guided first flight: a scripted pilot flies the take-off and climb, hands the jet to the autopilot, shows heading and speed
// modes, then gives control back. Any stick input or Skip ends it. update() returns true while it is flying the aircraft.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((a + 540) % 360) - 180;
const FT = 3.28084, CLIMB_ALT = 4572; // 15,000 ft

export class Tour {
  constructor() { this.active = false; this.phase = null; this.t = 0; this.step = 0; }
  start(hdg) { this.active = true; this.phase = 'roll'; this.t = 0; this.pt = 0; this.hdg = hdg; this.announced = ''; }
  stop() { this.active = false; this.phase = null; }
  // api: { fdm, att, iasKt, agl, ap, engage(t), setThrottle(v), say(title, text), setCaption(step, title, text), done(msg) }
  update(dt, a) {
    if (!this.active) return false;
    const { fdm, att } = a, pitchDeg = att.pitch * 180 / Math.PI;
    this.t += dt; this.pt += dt;
    const go = (p) => { this.phase = p; this.pt = 0; };
    const say = (key, step, title, text) => { if (this.announced !== key) { this.announced = key; a.setCaption(step, title, text); } };
    // pitch hold: elevon from pitch error with rate damping; wings level: aileron from bank
    const holdPitch = (deg) => clamp((deg - pitchDeg) * 0.05 - 0.5 * fdm.w.z, -0.6, 0.6);
    const wingsLevel = () => clamp(0.5 * (0 - att.bank) - 1.2 * fdm.w.x, -1, 1);

    switch (this.phase) {
      case 'roll':
        say('roll', 1, 'Take-off roll', 'Full afterburner. On the ground A and D steer the nose wheel; W and S pitch.');
        a.setThrottle(1);
        fdm.ctrl.de = 0; fdm.ctrl.da = 0; fdm.ctrl.dr = clamp(wrap180(this.hdg - att.heading) * 0.06 - 0.8 * fdm.w.y, -0.5, 0.5);
        if (this.pt > 3 && a.iasKt > 175) go('rotate');
        break;
      case 'rotate':
        say('rotate', 2, 'Rotate', 'Ease the nose up to about 10 degrees and let the jet fly itself off.');
        fdm.ctrl.de = holdPitch(10); fdm.ctrl.da = wingsLevel(); fdm.ctrl.dr = 0;
        if (!fdm.onGround && a.agl > 25) go('climb');
        break;
      case 'climb':
        say('climb', 3, 'Gear up', 'Press G to retract the gear once you are climbing away from the runway.');
        if (fdm.gearDown && this.pt > 2) a.gearUp();
        fdm.ctrl.de = holdPitch(this.pt < 6 ? 10 : 12); fdm.ctrl.da = wingsLevel(); fdm.ctrl.dr = 0;
        if (this.pt > 12 && a.agl > 500) { a.engage({ alt: CLIMB_ALT, hdg: Math.round(att.heading), spdKt: 380 }); go('apclimb'); }
        break;
      case 'apclimb':
        say('apclimb', 4, 'Autopilot engaged', 'K toggles the autopilot. It is climbing to 15,000 ft at 380 knots. Any stick input takes control back.');
        if (!a.ap.on) { this.stop(); a.done('Autopilot off. Your aircraft.'); break; }
        if (Math.abs(fdm.pos.y - CLIMB_ALT) < 250 && this.pt > 6) go('level');
        else if (this.pt > 180) go('level');
        break;
      case 'level':
        say('level', 5, 'Level at 15,000 ft', 'Altitude hold. Next the autopilot will turn the aircraft 90 degrees to the right.');
        if (this.pt > 6) { a.engage({ alt: CLIMB_ALT, hdg: (Math.round(att.heading) + 90) % 360, spdKt: 380, keepOn: true }); go('turn'); }
        break;
      case 'turn':
        say('turn', 6, 'Heading select', 'Change the target heading on the A/P panel (the aircraft sheet in the rail) and the jet banks to it.');
        if ((Math.abs(wrap180(a.ap.target.hdg - att.heading)) < 4 && this.pt > 6) || this.pt > 60) { a.engage({ alt: CLIMB_ALT, hdg: Math.round(att.heading), spdKt: 300, keepOn: true }); go('speed'); }
        break;
      case 'speed':
        say('speed', 7, 'Speed select: 300 knots', 'Speed hold sets the throttle to reach the target. Above about 35,000 ft you switch it to Mach; the SR-71 cruises at Mach 3.2 near 80,000 ft.');
        if ((a.iasKt < 345 && this.pt > 8) || this.pt > 50) go('hand');
        break;
      case 'hand':
        say('hand', 8, 'Your aircraft', 'Move the stick (W S A D) to take over, or press K to disconnect the autopilot. Press ? for every key.');
        if (this.pt > 14) { this.stop(); a.done(''); }
        break;
    }
    return this.phase !== null && (this.phase === 'roll' || this.phase === 'rotate' || this.phase === 'climb');
  }
}
export { CLIMB_ALT, FT };
