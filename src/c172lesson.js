// Hand-flown C172 lessons, displayed by the existing mission coach. No control writes.
import { haversine } from './geo.js';
const delta = (a, b) => ((a - b + 540) % 360) - 180;
export class C172Lesson {
  constructor(start, pattern = false) { this.start = start; this.pattern = pattern; this.phase = 0; this.hold = 0; this.done = false; }
  update(dt, s) {
    this.s = s;
    if (this.done || s.crashed) return null;
    const h = this.start.hdg, rel = delta(s.hdg, h), near = Math.abs(delta(s.hdg, h - [0,0,90,180,270,360][this.phase])) < 25;
    const checks = this.pattern
      ? [!s.onGround && s.agl > 15, s.agl > 240, near && s.agl > 180, near && s.agl > 150, near && s.agl > 80, Math.abs(rel) < 20 && s.agl < 180 && !s.onGround,
        s.onGround && haversine(s.lat,s.lon,this.start.lat,this.start.lon) < 2000 && s.gs < 8]
      : [s.throttle > .85, !s.onGround && s.agl > 15, s.agl > 150 && s.iasKt > 65, Math.abs(rel) > 25, Math.abs(s.pitchDeg) < 8 && s.iasKt > 65];
    this.hold = checks[this.phase] ? this.hold + dt : 0;
    if (this.hold > 1) { this.phase++; this.hold = 0; if (this.phase >= checks.length) { this.done = true; return {event:'done',text: this.pattern ? 'C172 pattern complete — stopped near the departure runway.' : 'Guided flight complete — you are flying the Skyhawk.'}; } }
    return null;
  }
  coach() {
    const steps = this.pattern ? [
      ['Take off','Full power with E, steer with A/D. Gently raise the nose with S at 55 KIAS; climb at 74 KIAS.'],
      ['Climb straight ahead','Climb to about 1,000 ft above the airport before turning. Keep the runway heading.'],
      ['Crosswind','Turn left 90° from the runway heading. Bank gently with A, level with D. Maintain about 1,000 ft above the airport.'],
      ['Downwind','Turn left another 90°, parallel to the runway in the opposite direction. Reduce power for about 90 KIAS. Use M to keep the runway in sight.'],
      ['Base leg','Abeam the touchdown point, reduce power and add flaps with F below 85 KIAS. Turn left toward base and descend.'],
      ['Final approach','Turn left onto the runway heading, align visually with the runway and aim for 65 KIAS. Adjust power with E/Q. Go around if not aligned.'],
      ['Land and stop','Near the ground, close the throttle with Q and gently raise the nose with S. Brake with B after touchdown; stop near the departure runway.']
    ] : [
      ['Add power','Hold E for full throttle; Q reduces power. The first push releases the parking brake.'],
      ['Lift off','Steer on the centreline with A/D. At 55 KIAS gently hold S to lift the nose; W lowers it.'],
      ['Climb','Aim for 74 KIAS and climb 500 ft above the runway. Small pitch changes are enough.'],
      ['Make a gentle turn','Tap A or D to bank, then the opposite key to level. Change heading by about 30°.'],
      ['Settle into flight','Ease the power for 90–105 KIAS. Trim with ; and apostrophe. V changes camera, M opens the map. No autopilot is fitted.']
    ];
    const [title,text] = steps[Math.min(this.phase,steps.length-1)];
    return {label: this.done ? 'Complete' : `C172 · ${this.phase+1}/${steps.length}`, title: this.done ? 'Your aircraft' : title, text: this.done ? 'Free flight continues. Use Controls for keys or restart the lesson from Flight setup.' : text, live: this.s ? `${Math.round(this.s.iasKt)} KIAS · ${Math.round(this.s.agl*3.28084)} ft above ground` : '', hint:'You fly; the coach never moves the controls.',ok:this.done};
  }
  hud() { return {title:this.pattern?'C172 PATTERN':'C172 GUIDED FLIGHT', lines:[`<div>${this.done?'Complete':`Step ${this.phase+1}`}</div>`],done:this.done}; }
}
