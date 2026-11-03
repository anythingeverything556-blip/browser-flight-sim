import { SF50, thrustFrac } from './sf50.js';

// The state object of the Vision Jet's PFD and MFD (src/sf50displays.js) from the flight model and what the game knows about the flight: air data,
// engine, fuel, configuration, pressurisation, navigation, autopilot and alerts. Pure, so it can be tested in node. Display units: kt, ft, fpm, deg.
const KT = 1 / 0.514444, FT = 3.28084, R2D = 180 / Math.PI;
const GAL_KG = 3.785 * 0.804; // a US gallon of Jet-A
const PSI_SL = 14.696, MAX_DIFF = 6.5; // cabin differential limit, psi
const pAmbPsi = (ft) => PSI_SL * Math.pow(Math.max(0, 1 - 6.8755856e-6 * Math.min(ft, 60000)), 5.2559);
const altOfPsi = (p) => (1 - Math.pow(p / PSI_SL, 1 / 5.2559)) / 6.8755856e-6;
const wrap180 = (a) => ((a + 540) % 360) - 180;
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
export const hms = (s) => `${Math.floor(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;

// cabin altitude and differential for an aircraft altitude: sea level cabin until the 6.5 psi limit, then it climbs (8,000 ft at FL310)
export function cabinAt(altFt) {
  const amb = pAmbPsi(altFt), cab = Math.min(PSI_SL, amb + MAX_DIFF);
  return { cabAlt: Math.max(0, altOfPsi(cab)), cabDiff: Math.max(0, cab - amb) };
}
// flap indicator: the pointer sits at 0 / 50 / 100 % for the 0 / 15 / 39 degree positions
export const flapFraction = (deg) => (deg <= 15 ? (Math.max(0, deg) / 15) * 0.5 : 0.5 + Math.min(1, (deg - 15) / 24) * 0.5);

// Cockpit warnings (HUD strip, voice call-outs, PFD alerts). casKt: calibrated airspeed (kt), iasMs: equivalent airspeed (m/s), agl: wheel height (m)
export function sf50Warn(fdm, { casKt, iasMs, agl }) {
  const o = fdm.out || {}, vy = fdm.vel.y;
  return {
    stall: !fdm.onGround && ((o.aoaNorm || 0) > 0.9 || (o.stall || 0) > 0.05) && iasMs > 8,
    pullUp: !fdm.onGround && agl < 600 && vy < -8 && agl / -vy < 9,
    // the gear horn: gear up and low, descending and slow (silenced above VLO retract speed)
    gearUnsafe: !fdm.gearDown && agl < 400 && vy < 0 && casKt < SF50.VLO_RET,
    overspeed: casKt > SF50.VMO || (o.M || 0) > SF50.MMO || !!o.flapOverspeed || !!o.gearOverspeed,
    overG: (o.nz || 1) > (fdm.flaps > 1 ? SF50.NZ_FLAP_LIMIT : SF50.NZ_LIMIT),
    lowFuel: !fdm.unlimitedFuel && fdm.fuel < LOW_FUEL_KG,
  };
}
const LOW_FUEL_KG = 90; // about 35 minutes at cruise

export function alertsOf(fdm, c) {
  const w = c.warn || {}, o = fdm.out || {}, a = [];
  if (w.pullUp) a.push({ text: 'TERRAIN — PULL UP', level: 'warning' });
  if (w.stall) a.push({ text: 'STALL', level: 'warning' });
  if (w.overspeed) a.push({ text: 'OVERSPEED', level: 'warning' });
  if (w.gearUnsafe) a.push({ text: 'GEAR NOT DOWN', level: 'warning' });
  if (o.gearOverspeed) a.push({ text: 'GEAR OVERSPEED', level: 'caution' });
  if (o.flapOverspeed) a.push({ text: 'FLAPS OVERSPEED', level: 'caution' });
  if (w.overG) a.push({ text: 'OVER G', level: 'caution' });
  if (w.lowFuel) a.push({ text: 'LOW FUEL', level: 'caution' });
  if (fdm.parkingBrake && (fdm.throttle || 0) > 0.5) a.push({ text: 'PARK BRAKE', level: 'caution' });
  if (!fdm.engineOn && !fdm.crashed) a.push({ text: 'ENGINE OFF', level: 'caution' });
  return a;
}

// A feed with a little memory (heading rate, cabin rate). c: { att, casMs, gsMs, trkDeg, flightT, hour, settings: { windDir, windSpd }, nav, ap, warn,
// airports [{ id, brgDeg, distNm }], com1, com1Name, destElevFt }
export function makeSF50Feed() {
  const mem = { hdg: null, cab: null, rate: 0, turn: 0, t: 0 };
  return function feed(fdm, c, dt = 0.1) {
    const o = fdm.out || {}, e = fdm.engines[0], att = c.att, nav = c.nav || {}, ap = c.ap;
    const altFt = fdm.pos.y * FT, V = o.V || 0, gs = (c.gsMs || 0) * KT, vsFpm = fdm.vel.y * 196.85;
    const cas = (c.casMs || 0) * KT, hdg = att.heading, cab = cabinAt(altFt);
    if (mem.hdg !== null && dt > 0) { mem.turn += (wrap180(hdg - mem.hdg) / dt - mem.turn) * Math.min(1, dt / 1.5); mem.rate += ((cab.cabAlt - mem.cab) / dt * 60 - mem.rate) * Math.min(1, dt / 4); }
    mem.hdg = hdg; mem.cab = cab.cabAlt;
    const oat = (o.T || 288.15) - 273.15, isa = oat - (altFt < 36089 ? 15 - 1.98 * altFt / 1000 : -56.5);
    const fuel = Math.max(0, fdm.fuel), ff = e.ff || 0, ffGph = ff * 3600 / GAL_KG;
    const apOn = !!(ap && ap.on);
    const endH = ff > 1e-4 ? fuel / (ff * 3600) : 0;
    const sel = apOn ? { selIas: ap.target.spd * KT, selAlt: ap.target.alt * FT, selHdg: ap.cmdHdg ?? ap.target.hdg } : {};
    const wind = c.settings || {};
    return {
      ias: cas, tas: V * KT, gs, mach: o.M || 0, alt: altFt, vs: vsFpm, hdg, trk: c.trkDeg ?? hdg, crs: nav.valid ? nav.course : hdg,
      pitch: att.pitch * R2D, bank: att.bank * R2D, fpa: gs > 20 ? Math.atan2(fdm.vel.y, Math.max(1, c.gsMs || 0)) * R2D : att.pitch * R2D, slip: Math.max(-1, Math.min(1, (o.beta || 0) / 0.1)),
      aoa: o.aoaNorm || 0, ...sel,
      thrust: e.lit ? thrustFrac(e.dry) * 100 : 0, thrustCmd: (fdm.throttle || 0) * 100, n1: e.n1 || 0, n2: e.n2 || 0, itt: e.itt || 15,
      oilT: 38 + 44 * Math.min(1, (e.n2 || 0) / 100), oilP: e.lit ? 38 + 30 * (e.n2 || 0) / 100 : 0, ff: ffGph, fuelL: fuel / 2 / GAL_KG, fuelR: fuel / 2 / GAL_KG,
      fobLb: fuel * 2.20462, endurance: endH > 0 ? `${Math.floor(endH)}+${pad2((endH % 1) * 60)}` : '-:--',
      gear: fdm.gearPos ?? 1, gearTransit: (fdm.gearPos ?? 1) > 0.02 && (fdm.gearPos ?? 1) < 0.98, flaps: flapFraction(fdm.flaps || 0), trim: (fdm.trim || 0) * 8,
      cabAlt: cab.cabAlt, cabDiff: cab.cabDiff, cabRate: mem.rate, oat, isa, windFrom: wind.windDir ?? 0, windKt: (wind.windSpd || 0) * KT,
      turnRate: mem.turn, xtk: nav.valid ? nav.xtkNm : 0,
      ap: { ap: apOn, yd: !!(fdm.sasOn && !fdm.onGround && V > 35), at: apOn && (ap.modes.spd || ap.modes.mach) ? 'SPD' : false, lat: apOn ? ap.status.lat : 'ROL', vert: apOn ? ap.status.vert : 'PIT', fd: apOn, armed: apOn && ap.modes.appr ? 'GP' : '' },
      com1: c.com1 || '118.300', com1Name: c.com1Name || '', wpt: nav.valid ? nav.ident : '', dis: nav.valid ? nav.distNm : NaN,
      ete: nav.valid && gs > 30 ? `${pad2(Math.min(99, nav.distNm / gs))}:${pad2(((nav.distNm / gs) % 1) * 60)}` : '', flt: hms(c.flightT || 0),
      utc: `${pad2(c.hour || 0)}:${pad2(((c.hour || 0) % 1) * 60)}:${pad2((((c.hour || 0) * 60) % 1) * 60)}`, destElev: c.destElevFt || 0,
      airports: (c.airports || []).map((a) => { const r = wrap180(a.brgDeg - hdg) * Math.PI / 180; return { id: a.id, x: a.distNm * Math.sin(r), y: -a.distNm * Math.cos(r) }; }),
      alerts: alertsOf(fdm, c),
    };
  };
}
