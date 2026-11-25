import { IL76, NOTCHES, NOTCH_LANDING } from './il76.js';

// Il-76 cockpit warnings (HUD strip, voice call-outs, warning tones) and the state object of its live screens (src/il76displays.js). Pure, so it can be
// tested in node. Display units: kt, ft, fpm, deg. casKt: calibrated airspeed (kt), iasMs: equivalent airspeed (m/s), agl: wheel height (m).
const KT = 1 / 0.514444, FT = 3.28084;

// Each warning must hold for ON seconds before it shows and stay clear for OFF seconds before it goes: a gust, the rotation or a
// spawn transient cannot set off a voice. The margins are those of the aircraft's own warnings: the AUASP angle-of-attack warning near
// 1.13 Vs, the speed warning just past the limit (not at it), the gear horn only in a landing configuration.
const HOLD = { stall: [0.35, 0.8], pullUp: [0.3, 1], gearUnsafe: [1.5, 1], overspeed: [1.5, 1.5], overG: [0.3, 1], lowFuel: [2, 2] };
const _held = new WeakMap();
export function il76Warn(fdm, { casKt, iasMs, agl, dt = 1 / 60 }) {
  const o = fdm.out || {}, vy = fdm.vel.y, mx = fdm.mx || {}, vlim = mx.vlim || 1, idle = (fdm.throttle || 0) < 0.4;
  const raw = {
    stall: !fdm.onGround && agl > 3 && ((o.aoaNorm || 0) > 0.86 || (o.stall || 0) > 0.05) && iasMs > 20,
    pullUp: !fdm.onGround && agl < 600 && vy < -9 && agl / -vy < 9,
    // gear horn: gear up with the landing flaps out, or low, descending and slow with the thrust back
    gearUnsafe: !fdm.gearDown && !fdm.onGround && ((fdm.flapCmd >= NOTCH_LANDING && agl < 900) || (agl < 300 && vy < -1.5 && idle && casKt < IL76.VLO * 0.8)),
    overspeed: casKt > IL76.VMO * vlim + 6 || (o.M || 0) > IL76.MMO + 0.01 || casKt > (o.vfe || Infinity) + 5 || (fdm.gearPos > 0.02 && casKt > IL76.VLE * vlim + 5),
    overG: (o.nz || 1) > (fdm.flaps > 1 ? IL76.NZ_FLAP_LIMIT : IL76.NZ_LIMIT) + 0.1,
    lowFuel: !fdm.unlimitedFuel && fdm.fuel < 5000,
  };
  let st = _held.get(fdm); if (!st) _held.set(fdm, (st = {}));
  const w = {};
  for (const k in raw) {
    const s = st[k] || (st[k] = { on: false, t: 0 }), [tOn, tOff] = HOLD[k];
    if (raw[k] === s.on) s.t = 0; else if ((s.t += dt) >= (raw[k] ? tOn : tOff)) { s.on = raw[k]; s.t = 0; }
    w[k] = s.on;
  }
  return w;
}
// after a respawn the old state must not carry over
export function il76WarnReset(fdm) { _held.delete(fdm); }

// Cockpit alerts, strongest first
export function il76Alerts(fdm, w = {}) {
  const o = fdm.out || {}, a = [];
  if (w.pullUp) a.push({ text: 'TERRAIN — PULL UP', level: 'warning' });
  if (w.stall) a.push({ text: 'STALL', level: 'warning' });
  if (w.overspeed) a.push({ text: 'OVERSPEED', level: 'warning' });
  if (w.gearUnsafe) a.push({ text: 'GEAR NOT DOWN', level: 'warning' });
  if (o.enginesOut) a.push({ text: `ENGINE FAIL ×${o.enginesOut}`, level: 'warning' });
  if (o.gearOverspeed) a.push({ text: 'GEAR OVERSPEED', level: 'caution' });
  if (o.flapOverspeed) a.push({ text: 'FLAPS OVERSPEED', level: 'caution' });
  if (w.lowFuel) a.push({ text: 'LOW FUEL', level: 'caution' });
  if (fdm.parkingBrake && (fdm.throttle || 0) > 0.5) a.push({ text: 'PARK BRAKE', level: 'caution' });
  return a;
}

// c: { att: { pitch, roll, heading } (deg), casMs, gsMs, altM, warn, selHdg }
export function il76Feed(fdm, c) {
  const o = fdm.out || {}, att = c.att || {}, es = fdm.engines;
  return {
    pitch: att.pitch, bank: att.roll, hdg: att.heading, ias: (c.casMs || 0) * KT, tas: (o.V || 0) * KT, gs: (c.gsMs || 0) * KT, mach: o.M || 0,
    altFt: (c.altM || 0) * FT, vsFpm: (fdm.vel ? fdm.vel.y : 0) * FT * 60, selHdg: c.selHdg,
    n1: es.map((e) => e.n1 || 0), n2: es.map((e) => e.n2 || 0), egt: es.map((e) => e.egt || 0), rev: es.map((e) => e.rev || 0),
    flaps: fdm.flaps || 0, slats: fdm.slats || 0, gear: fdm.gearPos ?? 1, spoilers: fdm.spoilers || 0, fuel: fdm.fuel, ff: (o.ff || 0) * 3600, enginesOut: o.enginesOut || 0,
    alerts: il76Alerts(fdm, c.warn),
  };
}
export const il76NotchName = (n) => (NOTCHES[n] || NOTCHES[0]).name;
