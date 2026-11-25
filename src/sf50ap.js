// Vision Jet SF50 autopilot (Garmin GFC 700 style: HDG / NAV / APPR, ALT / V/S / FLCH, autothrottle SPD / MACH), its autoland, and Safe Return.
// The autopilot itself is the shared one in autopilot.js; SF50_AP gives it the jet's limits. SF50Autoland flies what the shared autopilot stops at:
// configuration on the approach, a stabilised-approach monitor with go-around, flare, decrab, touchdown, rollout and braking to a stop.
// planSafeReturn picks the runway for the emergency autoland (fuel, terrain and wind permitting).
import { SF50, stallAlpha, sf50Lift } from './sf50.js';
import { haversine, bearing, destination } from './geo.js';

const KT = 1.943844, FT = 3.28084, G = 9.80665, D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => ((a + 540) % 360) - 180;

// Protection angles track the wing's own stall angle for the flap setting (the AFM stall table is built into sf50.js's CLmax):
// protection starts 2.6 deg short of the stall, is full 0.3 deg short of it, and releases 4.6 deg short.
const prot = (fdm, M) => { const as = stallAlpha(fdm.flaps || 0, M); return { aOn: as - 0.045, aMax: as - 0.005, aSafe: as - 0.08 }; };

export const SF50_AP = {
  iasLimit: SF50.VMO / KT, machLimit: SF50.MMO, citLimit: Infinity,
  prot,
  // 1 g equivalent airspeed at the protection angle, for the weight and flaps
  vmin: (fdm, M) => Math.sqrt(2 * (fdm.mass || SF50.MTOW) * G / (1.225 * SF50.S * Math.max(0.3, sf50Lift(prot(fdm, M).aOn, fdm.flaps || 0, M)))),
  // AFM climb schedule: 175 KIAS to 10,000 ft, falling to 140 KIAS at FL280
  climbIas: (alt) => (175 - 35 * clamp((alt * FT - 10000) / 18000, 0, 1)) / KT,
  vFloor: 45,
  kiDiv: (V) => clamp(8 + (V - 50) * 0.08, 8, 13),
  bank: () => 25, locBank: 15,
  hdgGain: 0.05, locHdgGain: 0.08,
  rollKp: 4, rollKd: 2.8,       // ~2 rad/s roll loop, damping 0.7: the straight wing's roll power is far higher per unit aileron than the delta's
  locKi: 0.004, locKp: 0.06,
  spdGain: 15,
  protSink: 5,
  recNz: () => 2, recSpdMax: 160 / KT,
  gaSpd: [115 / KT, 130 / KT], gaClimb: 1500 / FT,
  target: { alt: 10000 / FT, hdg: 0, spd: 180 / KT, mach: 0.48, vsLimit: 3000 / 196.85, vs: 0 },
};

// approach speed: VREF (89 KIAS at 6,000 lb, scaling with the square root of weight) + 10 kt in every flap setting (AFM 4-26), flaps 100 %, gear down
export const vrefKt = (mass) => 89 * Math.sqrt(mass / SF50.MTOW);
export const VAPP_ADD = 10;
export const FLARE_H = 9;      // m of wheel height: the flare starts (about 30 ft)
export const RETARD_H = 6;     // m: thrust to idle ("RETARD", 20 ft)
export const DECRAB_H = 8;     // m: the rudder lines the nose up with the runway, the into-wind wing goes down

// Stabilised-approach gates (the usual 1,000 ft criteria). Dots are GFC 700 / G1000 full-scale halves: 1.25 deg on the localizer, 0.35 deg on the glideslope.
export const GATE_FT = 1000, LOW_FT = 100, SINK_GATE_FT = 500, GEAR_GATE_FT = 500;
export const LOC_DOT = 1.25, GS_DOT = 0.35, SINK_MAX_FPM = 1500, SPD_HI_KT = 20, SPD_LO_KT = 10, XTK_LOW_M = 25, UNSTABLE_S = 1.5;
const GA_VS = 7.6, GA_VA = 120 / KT, GA_MAX_S = 240; // go-around: climb rate (m/s, 1,500 fpm) at 120 KIAS, give-up time (s)
export const MAX_SR_RETRIES = 2;                 // Safe Return: further approaches after a go-around

// Why the approach is not stabilised, or null. m: { hFt (above the runway), ilsValid, loc, gs, locDev, gsDev (deg), xtk (m), sinkFpm, dKt (IAS - target),
// gearDown, thrDist (m, + = threshold ahead), rwyLen (m) }. Inside LOW_FT only the centreline, sink, speed, gear and the runway left are judged:
// the angular deviations blow up near the threshold.
export function approachUnstable(m) {
  if (m.hFt >= GATE_FT) return null;
  if (m.hFt >= LOW_FT) {
    if (!m.ilsValid) return 'no localizer signal';
    if (!m.loc) return 'localizer not captured';
    if (!m.gs) return 'glideslope not captured';
    if (Math.abs(m.locDev) > LOC_DOT) return 'localizer deviation';
    if (Math.abs(m.gsDev) > GS_DOT) return 'glideslope deviation';
  } else if (Math.abs(m.xtk) > XTK_LOW_M) return 'off the centreline';
  if (m.hFt < SINK_GATE_FT && m.sinkFpm > SINK_MAX_FPM) return 'excessive sink rate';
  if (m.dKt > SPD_HI_KT) return 'speed high';
  if (m.dKt < -SPD_LO_KT) return 'speed low';
  if (m.hFt < GEAR_GATE_FT && !m.gearDown) return 'gear not down';
  if (m.thrDist != null && m.thrDist < -(m.rwyLen - 450)) return 'runway behind';
  return null;
}

// Autoland. update() runs after the autopilot each frame and returns the controls it takes over (null fields are left to the autopilot).
export class SF50Autoland {
  constructor() { this.reset(); }
  reset() {
    this.fI = 0; this.de0 = null; this.pApp = 0; this.retard = false; this.armed = false; this.phase = 'off'; this.t = 0; this.tdT = 0; this.prevHdg = null; this.msg = '';
    this.safeReturn = false; this.attempt = 0; this.unstableT = 0; this.flareT = 0; this.gaT = 0; this.gaReason = ''; this.ap = null;
  }
  // attempt: 0 for the first Safe Return approach, +1 for each approach flown again after a go-around
  arm(safeReturn = false, attempt = 0) { this.reset(); this.armed = true; this.phase = 'approach'; this.safeReturn = safeReturn; this.attempt = attempt; }
  // hands the autopilot's vertical overrides (flare / go-around) back, so the V/S loop and the trim servo work again
  disarm() { const ap = this.ap; if (ap) { ap.vsOverride = null; ap.tauV = null; ap.kiDiv = null; } this.reset(); }
  retryAllowed() { return this.safeReturn && this.attempt < MAX_SR_RETRIES; }

  // Go-around (TO/GA): full thrust, nose up, flaps 50 % (AFM), gear up in the positive climb, flaps up at 115 KIAS. The shared autopilot's go-around
  // sets the modes and the target; the climb itself is a V/S command (more when fast, less when slow: FLCH's speed-for-altitude loop rings with full
  // thrust) up to gaClimb above the present altitude, then ALT hold. Safe Return then orbits at that altitude unless main.js re-plans.
  startGoAround(why, s, out) {
    const { fdm, ap, att } = s;
    this.phase = 'goaround'; this.gaT = 0; this.gaReason = why; this.unstableT = 0; this.retard = false; this.de0 = null;
    ap.tauV = null; ap.kiDiv = null; ap.vsOverride = 0;
    ap.startGoAround({ ctrl: fdm.ctrl, throttle: fdm.throttle }, att, fdm.pos.y, s.ias);
    ap.modes.flch = false; this.missedAlt = ap.target.alt;
    if ((fdm.flapCmd || 0) > 1) s.setFlaps(1);
    out.de = out.da = out.dr = out.brakes = null; out.th = 1; this.msg = 'GO AROUND'; out.events.push('goaround');
    return out;
  }
  finishGoAround(s, out) {
    const { fdm, ap } = s;
    ap.vsOverride = null; ap.tauV = null; ap.kiDiv = null; ap.ga = false;
    Object.assign(ap.modes, { appr: false, flch: false, nav: false, hdg: true, alt: true, spd: true });
    ap.target.alt = this.gaT >= GA_MAX_S ? fdm.pos.y : this.missedAlt; ap.target.spd = Math.max(s.ias, 125 / KT);
    if (fdm.gearDown) s.setGear(false);
    if ((fdm.flapCmd || 0) > 0 && s.ias * KT > 115) s.setFlaps(0);
    out.events.push('goaround_done');
    if (this.safeReturn) { this.phase = 'hold'; this.msg = 'HOLD'; if (this.retryAllowed()) out.events.push('replan'); else out.events.push('hold'); }
    else { this.armed = false; this.phase = 'off'; this.msg = ''; }
    return out;
  }

  // s: { fdm, ap, nav (navOut), att, ias (m/s, calibrated), agl (wheel height above the runway, m), rwyHdg (deg), dt, setFlaps(n), setGear(down) }
  // returns { de, da, dr, th, brakes, done, events: [] } with nulls for what it leaves alone, or null when not active
  update(dt, s) {
    if (!this.armed) return null;
    const { fdm, ap, nav, att } = s, out = { de: null, da: null, dr: null, th: null, brakes: null, done: false, events: [] };
    this.ap = ap;
    const ev = (t) => out.events.push(t);
    this.t += dt;
    const iasKt = s.ias * KT, mass = fdm.mass || SF50.MTOW, vapp = vrefKt(mass) + VAPP_ADD;
    const hdgRate = this.prevHdg == null ? 0 : wrap180(att.heading - this.prevHdg) / Math.max(dt, 1e-3); this.prevHdg = att.heading;
    const rwyHdg = s.rwyHdg ?? nav.course ?? att.heading;
    // lateral speed across the runway (m/s, + = drifting right) and offset from the centreline (m, + = right of it)
    const hr = rwyHdg * D2R, vRight = fdm.vel.x * Math.cos(hr) + fdm.vel.z * Math.sin(hr), xtk = nav.locXtk || 0;

    if (this.phase === 'approach') {
      ap.vsOverride = null; ap.tauV = null; ap.kiDiv = null;
      if (!ap.modes.appr) ap.modes.appr = true;
      ap.modes.spd = true; ap.modes.mach = false;
      // configuration as flown: flaps 50 % once the localizer is held and the glideslope is near (140 KIAS, then 125 on the path); gear down at
      // 2,000 ft above the runway on the glideslope, flaps 100 % and VREF + 10 by 1,500 ft, stable by 1,000 ft
      const hThr = (nav.agl ?? s.agl) * FT;
      const nearGs = ap.status.loc && (ap.status.gs || (nav.gsDev ?? -9) > -0.9 || (nav.distNm ?? 99) < 8);
      if (nearGs && (fdm.flapCmd || 0) < 1 && iasKt < SF50.VFE50 - 5) { s.setFlaps(1); ev('flaps50'); }
      if (ap.status.gs && hThr < 2000 && !fdm.gearDown && iasKt < SF50.VLO_EXT - 5) { s.setGear(true); ev('gear'); }
      if (ap.status.gs && hThr < 1500 && (fdm.flapCmd || 0) < 2 && iasKt < SF50.VFE100 - 5 && fdm.gearDown) { s.setFlaps(2); ev('flaps100'); }
      // VREF + 10 on the approach, easing to VREF over the last 200 ft (AFM 4-25: VREF to VREF + 10, then VREF for the landing)
      const vland = vapp - VAPP_ADD * clamp((60 - s.agl) / 45, 0, 1);
      ap.target.spd = (ap.status.gs ? ((fdm.flapCmd || 0) >= 2 ? vland : 125) : nearGs ? 140 : Math.min(ap.target.spd * KT, 160)) / KT;
      this.msg = ap.status.gs ? 'LAND' : ap.status.loc ? 'LOC · G/S ARMED' : 'APPR ARMED';
      if (fdm.onGround) { this.phase = 'rollout'; this.tdT = 0; ev('touchdown'); return out; }
      const why = approachUnstable({ hFt: hThr, ilsValid: nav.ilsValid, loc: ap.status.loc, gs: ap.status.gs, locDev: nav.locDev || 0, gsDev: nav.gsDev || 0, xtk,
        sinkFpm: -fdm.vel.y * 196.85, dKt: iasKt - ap.target.spd * KT, gearDown: fdm.gearDown, thrDist: nav.ilsValid ? nav.thrDist : null, rwyLen: s.rwyLen ?? 1500 });
      this.unstableT = why ? this.unstableT + dt : 0;
      if (why && this.unstableT >= UNSTABLE_S) return this.startGoAround(why, s, out);
      if (ap.status.gs && fdm.gearDown && s.agl < FLARE_H) { this.phase = 'flare'; ev('flare'); }
      return out;
    }

    if (this.phase === 'goaround') {
      this.gaT += dt;
      const hFt = s.agl * FT, climbing = fdm.vel.y > 2;
      if (fdm.onGround) { ap.vsOverride = null; ap.ga = false; ap.modes.flch = false; this.phase = 'rollout'; this.tdT = 0; ev('touchdown'); return out; }
      const err = this.missedAlt - fdm.pos.y, vsC = clamp(GA_VS + 0.8 * (s.ias - GA_VA), 2, 9);
      ap.vsOverride = vsC; out.th = 1;
      if (climbing && hFt > 50 && fdm.gearDown) { s.setGear(false); ev('gearup'); }
      if ((fdm.flapCmd || 0) > 0 && iasKt > 115 && hFt > 120) { s.setFlaps(0); ev('flaps0'); }
      this.msg = 'GO AROUND';
      if (err < 25 + 6 * vsC || this.gaT >= GA_MAX_S) return this.finishGoAround(s, out);
      return out;
    }

    if (this.phase === 'hold') {
      // Safe Return after the last go-around: altitude held, a standard orbit above the field until the pilot takes over
      Object.assign(ap.modes, { appr: false, nav: false, hdg: true, alt: true, flch: false, spd: true });
      ap.target.hdg = Math.round((att.heading + 30 + 360) % 360);
      this.msg = 'HOLD';
      return out;
    }

    if (this.phase === 'flare') {
      // the flare flies the attitude itself (the autopilot's own V/S loop and trim servo stand off): the nose comes up while the sink is above
      // a profile easing from the glideslope's ~3 m/s to ~0.4 m/s at the wheels, never above +5 deg and, in the last 4 m, at least +1.5 deg so
      // the main gear touches first (the approach attitude is nose-low). Elevator: the one at flare entry, plus a PI on the attitude error.
      if (this.de0 == null) { this.de0 = fdm.ctrl.de || 0; this.pApp = att.pitch; this.fI = 0; this.th0 = fdm.throttle; this.flareT = 0; }
      this.flareT += dt;
      ap.vsOverride = fdm.vel.y; // keeps the autopilot's V/S loop and the trim servo quiet
      const vsT = -Math.max(0.4, s.agl / 3.2);
      const floor = 1.5 * D2R * clamp((4 - s.agl) / 3, 0, 1);
      const pitchT = clamp(this.pApp + 0.15 * (vsT - fdm.vel.y), Math.max(this.pApp, floor), 5 * D2R);
      const e = pitchT - att.pitch, pp = Math.max(0.3, fdm.out.pitchPower ?? 1);
      this.fI = clamp(this.fI + 2.5 * e * dt, -0.2, 0.6);
      out.de = clamp(this.de0 + this.fI + (14 * e - 5 * fdm.w.z) / pp, -1, 1);
      // thrust: from the flare-entry setting to idle over 1.5 s (the autothrottle stands off); RETARD called by 20 ft
      out.th = this.th0 * clamp(1 - this.flareT / 1.5, 0, 1);
      if (!this.retard && (s.agl < RETARD_H || out.th === 0)) { this.retard = true; ev('retard'); }
      // decrab: rudder to the runway heading, ailerons bank into the wind to hold the track along the centreline
      if (s.agl < DECRAB_H) {
        const vWant = clamp(-0.25 * xtk, -1.5, 1.5);
        const bankT = clamp(Math.atan(1.4 * (vWant - vRight) / G), -6 * D2R, 6 * D2R);
        out.da = clamp((4 * (bankT - att.bank) - 2.8 * fdm.w.x) / Math.max(0.05, fdm.out.rollPower ?? 1), -1, 1);
        // the nose is yawed straight only in the last 4 m: the sideslip it makes rolls the jet off the into-wind bank, so drift builds while it lasts
        if (s.agl < 4) out.dr = clamp(0.15 * wrap180(rwyHdg - att.heading) - 0.06 * hdgRate, -1, 1);
      }
      this.msg = 'FLARE';
      if (fdm.onGround) { this.phase = 'rollout'; this.tdT = 0; ev('touchdown'); return out; }
      // floating down the runway: go around rather than land long
      const long = nav.ilsValid && nav.thrDist != null && nav.thrDist < -((s.rwyLen ?? 1500) - 450);
      if (long || this.flareT > 12) return this.startGoAround(long ? 'runway behind' : 'floating', s, out);
      return out;
    }

    if (this.phase === 'rollout') {
      this.tdT += dt; ap.vsOverride = null;
      out.th = 0; out.da = clamp(-0.5 * att.bank, -1, 1);
      // the nose comes down over ~2 s; then the elevator stays a little nose-down of neutral to keep the nose wheel planted
      const deNeutral = -(fdm.trim || 0) * 0.6; // cancels the trim wheel (TRIM_AUTH 0.6)
      out.de = clamp(deNeutral + (0.25 - 0.4 * clamp(this.tdT / 2, 0, 1)), -1, 1);
      // steer along the centreline: rudder and nose wheel to a heading that closes the offset
      const gs = Math.hypot(fdm.vel.x, fdm.vel.z);
      const hdgT = rwyHdg - clamp(xtk * 1.5, -8, 8);
      out.dr = clamp((gs > 15 ? 0.06 : 0.12) * wrap180(hdgT - att.heading) - 0.05 * hdgRate, -1, 1);
      // wheel brakes once the nose wheel is down, firm but inside the anti-skid
      out.brakes = this.tdT < 1.5 ? 0 : clamp((this.tdT - 1.5) / 1.5, 0, 1) * (gs > 25 ? 0.7 : 0.9);
      this.msg = 'ROLLOUT';
      if (gs < 1) { this.phase = 'done'; out.done = true; ev('stopped'); }
      return out;
    }
    if (this.phase === 'done') { out.th = 0; out.brakes = 1; out.done = true; return out; }
    return null;
  }
}

// Safe Return limits: the jet's demonstrated crosswind and a tailwind cap (kt); the range model (170 kt over the ground, ~500 lb/h as at FL280 max
// cruise, 30 min reserve, 24 NM for the fixes and a go-around) is deliberately simple and on the safe side.
export const XWIND_MAX_KT = 16, TWIND_MAX_KT = 10;
export const SR_GS_KT = 170, SR_FF_KGH = 230, SR_RESERVE_MIN = 30, SR_EXTRA_NM = 24;
export const fuelNeededKg = (distM) => ((distM / 1852 + SR_EXTRA_NM) / SR_GS_KT + SR_RESERVE_MIN / 60) * SR_FF_KGH;
const AVOID_M = 15000; // distance penalty for a runway end that was just abandoned: the next-best is preferred unless it is far worse

// Safe Return: the best airport with a paved runway long enough for the jet (1,000 m). Cost in metres: distance, a long-runway bonus, a headwind bonus
// and penalties for tailwind and crosswind. Candidates are ranked fuel first (reachable with the reserve), then wind (inside the crosswind / tailwind
// limits), then cost: a runway breaking a limit is flown only when nothing else is left, and then `warnings` says which limit.
// Terrain is a hard filter, when groundAt(lat, lon) (m MSL, null while unknown) is given: the final from the threshold out to the 12 NM fix, flown at the
// lower of the 3 deg path and the final-approach altitude, and the direct leg to that fix (at the lower of `alt` and that altitude) must keep clear.
// Returns { apt, rwy, end, dist (m), waypoints: [{ lat, lon, name, alt }], fafAlt, warnings } or null. The approach is a straight-in on a 3 deg path:
// an initial fix 12 NM out on the centreline and a final fix at 7 NM, which the glideslope crosses from below.
export function planSafeReturn({ lat, lon, db, windDir = 0, windSpd = 0, minLen = 1000, km = 200, fuelKg = null, alt = null, groundAt = null, avoid = [] }) {
  let best = null;
  for (const { a, d } of db.near(lat, lon, km)) {
    for (const r of a.runways || []) {
      if (!r.paved || r.len < minLen) continue;
      r.ends.forEach((e, i) => {
        const head = windSpd * Math.cos((windDir - e.hdg) * D2R), cross = Math.abs(windSpd * Math.sin((windDir - e.hdg) * D2R));
        const headKt = head * KT, crossKt = cross * KT, warnings = [];
        if (crossKt > XWIND_MAX_KT) warnings.push('crosswind');
        if (-headKt > TWIND_MAX_KT) warnings.push('tailwind');
        const fuelBad = fuelKg != null && fuelKg < fuelNeededKg(d);
        if (groundAt && !terrainClear(a, e, lat, lon, alt, groundAt)) return;
        const cost = d - Math.min(r.len - minLen, 1500) * 2 - Math.max(0, head) * 500 + Math.max(0, -head) * 8000 + crossKt * 600
          + (avoid.includes(a.ident + e.ident) ? AVOID_M : 0);
        const rank = [fuelBad ? 1 : 0, warnings.length ? 1 : 0, cost];
        if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && cost < best.rank[2])))) {
          best = { rank, cost, apt: a, rwy: r, end: i, dist: d, warnings: fuelBad ? ['fuel', ...warnings] : warnings };
        }
      });
    }
  }
  if (!best) return null;
  delete best.rank;
  const e = best.rwy.ends[best.end], fix = (nm, name, alt) => { const p = destination(e.start.lat, e.start.lon, (e.hdg + 180) % 360, nm * 1852); return { lat: p.lat, lon: p.lon, name, alt }; };
  best.waypoints = [fix(12, `${best.apt.ident}IF`, glidepath(e, 12) - 40), fix(7, `${best.apt.ident}FF`, glidepath(e, 7) - 60)];
  best.fafAlt = glidepath(e, 7) - 60;
  return best;
}
const glidepath = (e, nm) => e.elev + 4 + nm * 1852 * Math.tan(3 * D2R);

// terrain under the Safe Return profile for one runway end (see planSafeReturn); unknown terrain (null) counts as clear
function terrainClear(apt, e, lat, lon, alt, groundAt) {
  const back = (e.hdg + 180) % 360, fafAlt = glidepath(e, 7) - 60, ok = (h, flown, margin) => !Number.isFinite(h) || h + margin <= flown;
  for (let nm = 0.5; nm <= 12; nm += 0.5) {
    const p = destination(e.start.lat, e.start.lon, back, nm * 1852);
    if (!ok(groundAt(p.lat, p.lon), Math.min(glidepath(e, nm), fafAlt), Math.min(150, 10 + 20 * nm))) return false;
  }
  const f = destination(e.start.lat, e.start.lon, back, 12 * 1852), level = Math.min(alt ?? Infinity, fafAlt), dist = haversine(lat, lon, f.lat, f.lon), br = bearing(lat, lon, f.lat, f.lon);
  for (let m = 2000; m < dist; m += 2000) {
    const p = destination(lat, lon, br, m);
    if (!ok(groundAt(p.lat, p.lon), level, 150)) return false;
  }
  return true;
}
export { haversine, bearing };

// Autopilot trim servo: walks the autopilot's elevator integrator onto the trim wheel (0.6 of the elevator's travel at full wheel), so the jet is in
// trim the moment the autopilot lets go. Moves at most 0.06 of the wheel per second, like the real pitch-trim servo.
export function apTrimServo(ap, fdm, dt, trimAuth = 0.6) {
  if (ap.vsOverride != null) return; // the autoland flare flies the elevator itself
  const want = clamp(ap.deI * 0.8 * dt, -0.06 * trimAuth * dt, 0.06 * trimAuth * dt);
  const next = clamp((fdm.trim || 0) + want / trimAuth, -1, 1), moved = (next - (fdm.trim || 0)) * trimAuth;
  fdm.trim = next; ap.deI -= moved;
}
