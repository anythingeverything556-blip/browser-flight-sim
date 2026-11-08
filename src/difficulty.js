// Flying modes: how much the sim helps. Medium is the sim as it shipped before modes existed; Easy adds every assist plus
// envelope protection and forgiving gear; Realistic switches the assists off and puts the touchdown limits back to the real gear's.
// Pure data and maths (no DOM, no aircraft imports): the flight models and the tests import it directly.

export const MODES = ['easy', 'medium', 'realistic'];
export const DEFAULT_MODE = 'medium';
export const modeOf = (v) => (MODES.includes(v) ? v : DEFAULT_MODE);

export const MODE_INFO = {
  easy: { label: 'Easy', blurb: 'Every assist on, plus stall, bank and g protection. Firm landings are forgiven, fuel never runs out and the inlets never unstart.' },
  medium: { label: 'Medium', blurb: 'The standard sim: hands-off, rotation, auto-trim and landing aids help; stalls, over-g and hard landings are yours.' },
  realistic: { label: 'Realistic', blurb: 'Like the real aircraft: no assists, you trim, use the rudder and flare yourself, the gear takes only what the real one does and fuel runs out.' },
};

// Settings each mode writes (keys are the settings the Options checkboxes already store). A key a mode leaves out keeps the pilot's choice.
export const PRESETS = {
  easy: { assist: true, handsOff: true, rotAssist: true, autoTrim: true, landAid: true, unstarts: false, fuel: true },
  medium: { assist: false, handsOff: true, rotAssist: true, autoTrim: true, landAid: true, unstarts: true, fuel: false },
  realistic: { assist: false, handsOff: false, rotAssist: false, autoTrim: false, landAid: false, unstarts: true, fuel: false, crash: true },
};
// true when the pilot has changed one of the mode's settings since picking it
export const presetChanged = (mode, settings) => Object.entries(PRESETS[modeOf(mode)]).some(([k, v]) => !!settings[k] !== v);

// Touchdown limits in m/s. sinkMax: sink at first wheel contact; sinkBottom: sink with the strut bottomed; scrapeVs: a tail (or, on
// the SR-71, nozzle / wingtip) touch with the aircraft sinking slower than this scrapes instead of crashing.
// Realistic is what the models used before the Nov 2026 landing-forgiveness change; Medium is that change.
export const LANDING = {
  sr71: {
    easy: { sinkMax: 8.5, sinkBottom: 6, scrapeVs: 3.5 },
    medium: { sinkMax: 7, sinkBottom: 4.5, scrapeVs: 2.5 },
    realistic: { sinkMax: 5.5, sinkBottom: 3, scrapeVs: 1.5 },
  },
  c172: {
    easy: { sinkMax: 7, sinkBottom: 4.5, scrapeVs: 3.5 },
    medium: { sinkMax: 5.5, sinkBottom: 3.5, scrapeVs: 2.5 },
    realistic: { sinkMax: 4, sinkBottom: 2.5, scrapeVs: 1.5 },
  },
  sf50: {
    easy: { sinkMax: 7.5, sinkBottom: 6, scrapeVs: 3.5 },
    medium: { sinkMax: 6, sinkBottom: 4.5, scrapeVs: 2.5 },
    realistic: { sinkMax: 4.5, sinkBottom: 3, scrapeVs: 1.5 },
  },
};
export const landingLimits = (aircraft, mode) => ({ ...(LANDING[aircraft] || LANDING.sr71)[modeOf(mode)] });

// Easy mode envelope protection, applied to the pilot's surface commands (de > 0 nose up, da > 0 roll right) before the flight
// model steps. A limit on the nose-up command closes in as the angle of attack or g (led by their rates, so a fast pull is caught
// before it overshoots) nears the stall angle, the g limit or 30° nose up, and holds the aircraft just inside them; the nose-down
// command likewise stops at the negative g limit and 25° nose down. Past 55° of bank the roll command stops adding bank, and past
// 67° it rolls back. In the air only.
// s: { alpha (rad), aOn, aMax, nz, nzMax, nzMin, pitch, bank (rad, + right wing down), auth, onGround, dt }; st: {} kept across frames.
// auth: the most nose-up elevator the pilot's stick can command at this speed (the stick gearing); the limiter works in that
// unit, so its pushes are never sharper than the pilot's own stick (full surface travel at 240 kt set the Vision Jet oscillating).
// Returns { alpha, g, pitch, bank } flags for what limited the command.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const BANK_ON = 55 * Math.PI / 180, BANK_MAX = 67 * Math.PI / 180;
// the angle-of-attack band sits this far (rad) below the stall angle: protection starts at aOn and holds short of aMax
export const PROT_A_ON = 0.09, PROT_A_MAX = 0.045;
export const PROT = { lead: 0.35, nzBand: 0.7, ki: 2, kp: 0.3, hold: 0.25, relax: 1.5, floor: -0.4, pitchMax: 30 * Math.PI / 180, pitchMin: -25 * Math.PI / 180, pitchBand: 10 * Math.PI / 180 };
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const rateOf = (st, key, v, dt) => {
  const r = st[key] == null || !(dt > 0) ? 0 : wrapPi(v - st[key]) / dt; // wrapped: the bank angle jumps from +180° to -180°
  st[key] = v; st[key + 'Dot'] = st[key + 'Dot'] == null ? r : st[key + 'Dot'] + (r - st[key + 'Dot']) * Math.min(1, dt / 0.08);
  return st[key + 'Dot'];
};
export function resetProtect(st) { for (const k of Object.keys(st)) delete st[k]; }
// one side of the pitch limiter: m is the margin (1 at the onset, 0 at the limit, negative past it); cmd the command towards the
// limit (nose up for the upper side). The limit engages at the command flying now and integrates to hold m near P.hold.
function limitSide(st, key, m, cmd, dt, P) {
  if (st[key] == null) st[key] = 1;
  if (m < 1) {
    if (st[key] >= 1) st[key] = Math.min(1, st[key + 'Last'] ?? cmd);
    st[key] = clamp(st[key] + dt * P.ki * (Math.max(-1, m) - P.hold), P.floor, 1);
  } else st[key] = Math.min(1, st[key] + dt * P.relax);
  const lim = clamp(st[key] + P.kp * (clamp(m, -1, 1) - P.hold), -1, 1), out = m < 1 || st[key] < 1 ? Math.min(cmd, lim) : cmd; // released gradually, not at once
  st[key + 'Last'] = out;
  return out;
}
export function envelopeProtect(ctrl, s, st = {}, P = PROT) {
  const act = { alpha: false, g: false, pitch: false, bank: false }, dt = s.dt || 0;
  if (s.onGround) { resetProtect(st); return act; }
  const aDot = rateOf(st, 'a', s.alpha, dt), nDot = rateOf(st, 'n', s.nz, dt), bDot = rateOf(st, 'b', s.bank, dt), pDot = rateOf(st, 'p', s.pitch || 0, dt);
  const aL = s.alpha + P.lead * Math.max(0, aDot), pL = (s.pitch || 0) + 2 * P.lead * pDot;
  const mA = (s.aMax - aL) / (s.aMax - s.aOn), mG = (s.nzMax - (s.nz + P.lead * Math.max(0, nDot))) / P.nzBand, mP = (P.pitchMax - pL) / P.pitchBand;
  const mN = ((s.nz + P.lead * Math.min(0, nDot)) - s.nzMin) / P.nzBand, mD = (pL - P.pitchMin) / P.pitchBand;
  // nose down first (negative g, pitch attitude), then nose up (angle of attack, positive g, pitch attitude): where the two
  // disagree the nose-up side wins, so a pull-out from a dive never overstresses the airframe
  const k = s.auth > 0 ? s.auth : 1;
  const dn = Math.min(mN, mD), deDn = -limitSide(st, 'dn', dn, -ctrl.de / k, dt, P) * k;
  if (deDn > ctrl.de) { ctrl.de = deDn; act.g = mN === dn; act.pitch = mD === dn; }
  const up = Math.min(mA, mG, mP), deUp = limitSide(st, 'up', up, ctrl.de / k, dt, P) * k;
  if (deUp < ctrl.de) { ctrl.de = deUp; act.alpha = mA === up; act.g = act.g || mG === up; act.pitch = act.pitch || mP === up; }
  const bL = s.bank + 0.3 * bDot, b = Math.abs(bL), dir = Math.sign(bL);
  if (b > BANK_ON) {
    const kb = (b - BANK_ON) / (BANK_MAX - BANK_ON);
    if (ctrl.da * dir > 0) ctrl.da *= Math.max(0, 1 - kb);
    if (kb > 1) ctrl.da -= dir * Math.min(0.3, 0.6 * (kb - 1));
    act.bank = true;
  }
  return act;
}
