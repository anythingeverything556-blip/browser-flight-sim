// BGT v2.3 manuals (both English cockpits), pp.43,47,49,51,56.
// The documented avionics have LIGHTS/horns, not Airbus voice/RETARD logic.
// Optional spoken heights below are browser pilot assistance, NOT an airline SOP.
export const F27_HEIGHTS_FT = Object.freeze([100, 50, 40, 30, 20, 10]);
export const F27_CALLOUT_KEYS = Object.freeze([...F27_HEIGHTS_FT.map(h => `h${h}`), 'minimums', 'v1', 'rotate']);
export const F27_CALLOUT_MEDIA_KEYS = Object.freeze(F27_HEIGHTS_FT.map(h => `h${h}`));
export const F27_RADIO_MAX_FT = 5000;
const finite = Number.isFinite;
const down = (before, after, n) => finite(before) && finite(after) && before > n && after <= n;
const up = (before, after, n) => finite(before) && finite(after) && before < n && after >= n;

// The caller supplies actual instrument state, not a guess based on altitude.
// Above 5000 the manual says it switches off; a fresh manual ON edge is needed.
export class F27RadioAltimeter {
  constructor() { this.reset(); }
  reset() { this.on = false; this.command = false; }
  step({ aglFt, radioAltOn = false, electrical = true }) {
    const command = radioAltOn === true;
    if (!command || !electrical || !finite(aglFt) || aglFt > F27_RADIO_MAX_FT) this.on = false;
    else if (command && !this.command) this.on = true;
    this.command = command;
    return this.on;
  }
}

export function f27Annunciators(s = {}) {
  const ra = s.aglFt, valid = s.electrical !== false && s.radioAltValid === true && finite(ra) && ra >= 0 && ra <= F27_RADIO_MAX_FT;
  const dh = s.minimums?.type === 'radio' ? s.minimums.valueFt : undefined;
  return {
    radioAltValid: valid,
    decisionHeight: valid && finite(dh) && dh > 0 && ra < dh,
    // TEST AMV at 900 ft is a test annunciator, NOT a 900-ft voice or DH.
    testAmv: valid && s.ilsApproach === true && ra < 900,
    risingRunway: valid && ra < 200 ? 1 - Math.max(0, ra) / 200 : 0,
    overspeedHorn: s.electrical !== false && finite(s.iasKt) && s.iasKt > 227,
    altitudeAlert: false, // manual: yellow barometric altitude warning is inoperative
  };
}

function validSpeeds(v) {
  // No hardcoded 80 kt/V1/VR and no V1 inferred from F27.VR. Require an
  // explicitly verified takeoff computation/briefing, with its source recorded.
  return v?.verified === true && typeof v.source === 'string' && v.source.trim().length > 0 &&
    finite(v.v1) && finite(v.vr) && finite(v.v2) && v.v1 > 0 && v.v1 <= v.vr && v.vr <= v.v2;
}
function minValue(s) {
  const m = s.minimums;
  if (!m || !finite(m.valueFt) || m.valueFt <= 0) return null;
  if (m.type === 'radio') return s.radioAltValid !== false && s.electrical !== false && finite(s.aglFt) && s.aglFt >= 0 && s.aglFt <= F27_RADIO_MAX_FT ? s.aglFt : null;
  if (m.type === 'baro') return finite(s.baroAltFt) ? s.baroAltFt : null;
  return null;
}
const minId = s => s.minimums ? `${s.minimums.type}:${s.minimums.valueFt}` : '';

export class F27Callouts {
  constructor() { this.reset(); }
  reset() {
    this.prev = null; this.t = 0; this.busyUntil = 0; this.armed = false;
    this.spoken = new Set(); this.takeoffDone = new Set(); this.groundT = 0;
    this.minimumDone = false; this.minimumArmed = false; this.goneAround = false;
  }
  // Same interface as AltCallouts. s has wheel AGL feet, vsFpm, onGround,
  // paused/slew/teleported/crashed; optional radioAltValid, electrical,
  // {minimums:{type:'radio'|'baro',valueFt},baroAltFt}, takeoffActive and
  // takeoffSpeeds:{v1,vr,v2,verified:true,source}. assistance:false is silent.
  // duration=0 means media missing: drop the event, never queue it for later.
  step(s, dt, duration = () => 0.6) {
    if (!s || s.crashed || s.teleported) { this.reset(); return null; }
    if (s.slew) { this.reset(); return null; }
    if (s.paused || !finite(dt) || dt <= 0) { this.prev = null; return null; }
    if (dt > 1) { this.prev = null; this.busyUntil = this.t; return null; }
    this.t += dt;
    if (!finite(s.aglFt) || !finite(s.vsFpm)) { this.prev = null; return null; }
    const prev = this.prev;
    this.prev = { ...s, minimums: s.minimums ? { ...s.minimums } : undefined };
    // A relocation or terrain data jump must never manufacture crossings.
    if (prev && Math.abs(s.aglFt - prev.aglFt) > Math.max(120, Math.abs(s.vsFpm) / 60 * dt * 4 + 30)) {
      this.armed = false; this.minimumArmed = false; this.busyUntil = this.t; return null;
    }
    if (s.onGround) {
      this.groundT += dt; this.armed = false;
      if (finite(s.iasKt) && s.iasKt < 30 && this.groundT >= 2) {
        this.takeoffDone.clear(); this.minimumDone = false; this.minimumArmed = false;
        this.spoken.clear(); this.goneAround = false;
      }
    } else {
      this.groundT = 0;
      if (s.aglFt > 150 && !this.armed) {
        this.armed = true; this.spoken.clear(); this.minimumDone = false; this.goneAround = false;
      }
      if (s.aglFt <= 150 && s.vsFpm > 60) { this.armed = false; this.goneAround = true; }
    }
    const raValid = s.radioAltValid !== false && s.electrical !== false && s.aglFt >= 0 && s.aglFt <= F27_RADIO_MAX_FT;
    const m = minValue(s), pm = prev ? minValue(prev) : null;
    if (!prev || minId(prev) !== minId(s)) { this.minimumArmed = false; this.minimumDone = false; }
    if (!s.onGround && m !== null && m > s.minimums.valueFt + 50) {
      if (this.goneAround) this.minimumDone = false;
      this.minimumArmed = true;
    }
    let key = null;
    if (prev && !s.onGround && s.vsFpm < 0 && !this.goneAround) {
      if (this.armed && raValid && prev.radioAltValid !== false && prev.electrical !== false) {
        const passed = F27_HEIGHTS_FT.filter(h => !this.spoken.has(h) && down(prev.aglFt, s.aglFt, h));
        for (const h of passed) this.spoken.add(h);
        // A coarse frame can cross several: only the lowest is relevant now.
        if (passed.length) key = `h${passed.at(-1)}`;
      }
      if (minId(prev) === minId(s) && this.minimumArmed && !this.minimumDone && pm !== null && m !== null && down(pm, m, s.minimums.valueFt)) {
        this.minimumDone = true; key = 'minimums';
      }
    }
    if (prev && s.takeoffActive === true && prev.takeoffActive === true && s.onGround && prev.onGround && validSpeeds(s.takeoffSpeeds) &&
      validSpeeds(prev.takeoffSpeeds) && JSON.stringify(s.takeoffSpeeds) === JSON.stringify(prev.takeoffSpeeds)) {
      for (const [name, speed] of [['v1', s.takeoffSpeeds.v1], ['rotate', s.takeoffSpeeds.vr]]) {
        if (!this.takeoffDone.has(name) && up(prev.iasKt, s.iasKt, speed)) { this.takeoffDone.add(name); key = name; }
      }
    }
    if (s.assistance === false || !key || this.t < this.busyUntil || s.speechBlocked) return null;
    const len = duration(key);
    if (!finite(len) || len <= 0) return null;
    this.busyUntil = this.t + len;
    return key;
  }
}
