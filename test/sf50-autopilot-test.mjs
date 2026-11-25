// Vision Jet SF50 autopilot and autoland, closed loop: the flight model, the shared autopilot with SF50_AP, the real Navigation ILS and a real Runway,
// stepped as main.js steps them (trim servo on, stick untouched). Flat ground at 0 m, ISA.
import * as THREE from 'three';
import { SF50Model, SF50, SF50_CG, FLAP_DEG, stallAlpha } from '../src/sf50.js';
import { Autopilot, attitude } from '../src/autopilot.js';
import { SF50_AP, SF50Autoland, planSafeReturn, apTrimServo, vrefKt, VAPP_ADD, approachUnstable, fuelNeededKg } from '../src/sf50ap.js';
import { Navigation } from '../src/nav.js';
import { Runway } from '../src/airportdb.js';
import { Geo, destination } from '../src/geo.js';
import { airData } from '../src/airdata.js';
import { isa } from '../src/atmosphere.js';

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const KT = 1.943844, FT = 3.28084, D = 180 / Math.PI, dt = 1 / 120, LAT0 = 39.0, LON0 = -121.0;
const geo = new Geo(LAT0, LON0);
const flat = () => 0;
const wrap180 = (a) => ((a + 540) % 360) - 180;
// runway 09/27, 1,800 m, threshold of 09 at the origin, elevation 0
const rb = destination(LAT0, LON0, 90, 1800);
const RWY = new Runway({ ident: 'KTST' }, ['09', '27', LAT0, LON0, rb.lat, rb.lon, 0, 0, 30, 1, 1]);

function makeRig({ altFt = 10000, kias = 180, hdg = 90, x = 0, z = 0, gear = false, notch = 0, wind = [0, 0, 0] } = {}) {
  const fdm = new SF50Model(); fdm.fuel = SF50.FUEL_MAX * 0.6;
  const alt = altFt / FT, v = kias / KT / Math.sqrt(isa(alt).rho / 1.225);
  fdm.reset(new THREE.Vector3(x, alt, z), hdg, v, false);
  fdm.setFlaps(notch); fdm.flaps = FLAP_DEG[notch]; fdm.gearDown = gear; fdm.gearPos = gear ? 1 : 0;
  fdm.quat.identity(); fdm.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(hdg - 90) * Math.PI / 180);
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(fdm.quat); fdm.vel.copy(fwd).multiplyScalar(v); fdm.w.set(0, 0, 0); fdm.trimLevel(0);
  const ap = new Autopilot(SF50_AP), land = new SF50Autoland(), nav = new Navigation(), w = new THREE.Vector3(...wind);
  ap.target.alt = alt; ap.target.hdg = hdg; ap.target.spd = kias / KT;
  const r = { fdm, ap, land, nav, t: 0, navOut: {}, events: [], td: null, maxBank: 0, minAlphaMargin: 1, maxKias: 0, crashed: null };
  r.engage = (modes = {}) => { Object.keys(ap.modes).forEach((k) => { ap.modes[k] = false; }); Object.assign(ap.modes, modes); ap.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle }); };
  r.step = () => {
    const att = attitude(fdm.quat), out = fdm.out, ll = geo.toLatLon(fdm.pos.x, fdm.pos.z);
    r.navOut = nav.update(ll, fdm.pos.y, fdm.vel.length());
    const cas = out.V ? airData(out).cas : 0;
    if (ap.on) {
      const c = ap.update(dt, { fdm, out, att, vs: fdm.vel.y, alt: fdm.pos.y, ias: cas, nav: r.navOut });
      fdm.ctrl.de = c.de; fdm.ctrl.da = c.da; fdm.ctrl.dr = c.dr;
      if (ap.modes.spd || ap.modes.mach || c.thrOverride) fdm.throttle = c.th;
      const l = land.update(dt, { fdm, ap, nav: r.navOut, att, ias: cas, agl: fdm.pos.y - SF50_CG.y, rwyHdg: nav.arrival ? nav.arrival.rwy.ends[nav.arrival.end].hdg : null,
        setFlaps: (n) => fdm.setFlaps(n), setGear: (d) => fdm.setGear(d) });
      if (l) {
        for (const k of ['de', 'da', 'dr']) if (l[k] != null) fdm.ctrl[k] = l[k];
        if (l.th != null) fdm.throttle = l.th;
        if (l.brakes != null) fdm.brakes = l.brakes;
        r.events.push(...l.events.map((e) => ({ e, t: r.t, x: fdm.pos.x, z: fdm.pos.z, vs: fdm.vel.y, bank: att.bank * D, hdg: att.heading, pitch: att.pitch * D, kias: cas * KT })));
        if (l.done) { fdm.parkingBrake = true; ap.disengage(); }
      }
      if (ap.on && !fdm.onGround) apTrimServo(ap, fdm, dt);
    }
    const wasAir = !fdm.onGround;
    fdm.step(dt, flat, w);
    if (wasAir && fdm.onGround && !r.td) r.td = { t: r.t, x: fdm.pos.x, z: fdm.pos.z, vs: fdm.vel.y, bank: att.bank * D, hdg: att.heading, pitch: att.pitch * D, kias: cas * KT };
    if (!fdm.onGround) { r.maxBank = Math.max(r.maxBank, Math.abs(att.bank * D)); r.minAlphaMargin = Math.min(r.minAlphaMargin, stallAlpha(fdm.flaps, out.M || 0) - (out.alpha || 0)); }
    r.maxKias = Math.max(r.maxKias, cas * KT);
    if (r.k500 == null && ap.status.gs && fdm.pos.y - SF50_CG.y < 500 / FT) r.k500 = cas * KT;
    if (fdm.crashed) r.crashed = fdm.crashed;
    fdm.events.length = 0; r.t += dt;
  };
  r.run = (secs, until) => { for (let t = 0; t < secs; t += dt) { r.step(); if (r.crashed || (until && until(r))) break; } };
  r.kias = () => (fdm.out.V ? airData(fdm.out).cas : 0) * KT;
  r.att = () => attitude(fdm.quat);
  return r;
}

// ---- altitude and speed hold: FL100, 180 KIAS, two minutes ----
{
  const r = makeRig({ altFt: 10000, kias: 180 }); r.engage({ alt: true, hdg: true, spd: true });
  let altErr = 0, spdErr = 0; r.run(30); r.run(90, (q) => { altErr = Math.max(altErr, Math.abs(q.fdm.pos.y * FT - 10000)); spdErr = Math.max(spdErr, Math.abs(q.kias() - 180)); return false; });
  check('ALT + SPD hold at FL100 / 180 KIAS for 90 s (after 30 s to settle)', !r.crashed && altErr < 40 && spdErr < 4, `max error ${altErr.toFixed(0)} ft, ${spdErr.toFixed(1)} kt`);
  check('trim servo: the autopilot integrator ends up on the trim wheel', Math.abs(r.ap.deI) < 0.03, `deI ${r.ap.deI.toFixed(3)}, trim ${r.fdm.trim.toFixed(2)}`);
  // disconnect: the jet is in trim, so the pitch rate stays small for 10 s hands off
  r.ap.disengage(); r.fdm.ctrl.de = 0; let qMax = 0; r.run(10, (q) => { qMax = Math.max(qMax, Math.abs(q.fdm.w.z * D)); return false; });
  check('autopilot off: in trim, no pitch bump hands off', qMax < 1.0, `peak pitch rate ${qMax.toFixed(2)} deg/s`);
}
// ---- heading: a 180 deg turn at 160 KIAS, 25 deg bank limit ----
{
  const r = makeRig({ altFt: 8000, kias: 160, hdg: 90 }); r.engage({ alt: true, hdg: true, spd: true }); r.ap.target.hdg = 270;
  r.run(120); const e = Math.abs(wrap180(r.att().heading - 270));
  check('HDG: 180 deg turn at 160 KIAS', !r.crashed && e < 2 && r.maxBank < 27 && Math.abs(r.fdm.pos.y * FT - 8000) < 80, `heading error ${e.toFixed(1)} deg, max bank ${r.maxBank.toFixed(1)}, altitude ${(r.fdm.pos.y * FT).toFixed(0)} ft`);
}
// ---- FLCH climb to FL250 on the AFM schedule, then capture ----
{
  const r = makeRig({ altFt: 5000, kias: 175 }); r.engage({ flch: true, hdg: true }); r.ap.target.alt = 25000 / FT;
  let spdDev = 0; r.run(1500, (q) => { const a = q.fdm.pos.y * FT; if (a > 6000 && a < 24000 && q.ap.status.vert === 'FLCH') spdDev = Math.max(spdDev, Math.abs(q.kias() - SF50_AP.climbIas(q.fdm.pos.y) * KT)); return q.ap.status.vert === 'ALT' && Math.abs(q.fdm.pos.y * FT - 25000) < 50; });
  const tMin = r.t / 60; r.run(60);
  check('FLCH climb 5,000 ft to FL250 on the climb schedule (175 falling to 140 KIAS), captures ALT', !r.crashed && r.ap.status.vert === 'ALT' && Math.abs(r.fdm.pos.y * FT - 25000) < 60 && spdDev < 8 && tMin < 20,
    `${tMin.toFixed(1)} min, speed within ${spdDev.toFixed(1)} kt of the schedule, ends at ${(r.fdm.pos.y * FT).toFixed(0)} ft`);
  // descent back to 10,000 ft
  r.ap.modes.flch = true; r.ap.modes.alt = false; r.ap.target.alt = 10000 / FT; r.ap.modes.spd = false;
  r.run(900, (q) => q.ap.status.vert === 'ALT' && Math.abs(q.fdm.pos.y * FT - 10000) < 60); r.run(30);
  check('FLCH descent to 10,000 ft without passing VMO', !r.crashed && Math.abs(r.fdm.pos.y * FT - 10000) < 60 && r.maxKias < SF50.VMO + 3, `ends ${(r.fdm.pos.y * FT).toFixed(0)} ft, max ${r.maxKias.toFixed(0)} KIAS`);
}
// ---- V/S and speed changes ----
{
  const r = makeRig({ altFt: 15000, kias: 200 }); r.engage({ vs: true, hdg: true, spd: true }); r.ap.target.vs = -1500 / 196.85;
  r.run(25); const vs = r.fdm.vel.y * 196.85;
  check('V/S -1,500 fpm', Math.abs(vs + 1500) < 120, `${vs.toFixed(0)} fpm`);
  const s = makeRig({ altFt: 12000, kias: 150 }); s.engage({ alt: true, hdg: true, spd: true }); s.ap.target.spd = 220 / KT; s.run(90);
  check('SPD 150 -> 220 KIAS (autothrottle)', Math.abs(s.kias() - 220) < 4 && Math.abs(s.fdm.pos.y * FT - 12000) < 80, `${s.kias().toFixed(0)} KIAS, ${(s.fdm.pos.y * FT).toFixed(0)} ft`);
  const o = makeRig({ altFt: 12000, kias: 220 }); o.engage({ alt: true, hdg: true, spd: true }); o.ap.target.spd = 300 / KT; o.run(120);
  check('overspeed protection: a 300 kt target is held below VMO (250)', !o.crashed && o.maxKias < SF50.VMO + 4, `max ${o.maxKias.toFixed(0)} KIAS`);
  const u = makeRig({ altFt: 8000, kias: 140 }); u.engage({ alt: true, hdg: true, spd: true }); u.ap.target.spd = 60 / KT; u.ap.target.alt = 12000 / FT; u.run(120);
  check('underspeed protection: a 60 kt target and a climb never reach the stall', !u.crashed && u.minAlphaMargin > 0.01, `closest ${(u.minAlphaMargin * D).toFixed(1)} deg below the stall angle, ${u.kias().toFixed(0)} KIAS`);
}

// ---- autoland: 10 NM final, offset 400 m left with a 20 deg intercept, 2,500 ft, 170 KIAS clean, crosswind ----
const autoland = (name, { wind = [0, 0, 0], kias = 170, z = -400, hdg = 110, altFt = 2500 } = {}) => {
  const r = makeRig({ altFt, kias, hdg, x: -18520, z, wind });
  r.nav.setArrival(RWY, 0); r.engage({ alt: true, hdg: true, spd: true, appr: true }); r.ap.target.hdg = hdg; r.land.arm();
  r.run(600, (q) => q.land.phase === 'done');
  const td = r.td || {}, stop = r.fdm.pos;
  const ev = Object.fromEntries(r.events.map((e) => [e.e, e]));
  check(`autoland, ${name}: lands and stops on the runway, configured on the way down`, !r.crashed && r.land.phase === 'done' && ev.gear && ev.flaps50 && ev.flaps100 && ev.flare && ev.retard && ev.touchdown,
    `${r.crashed || r.land.phase}, events ${r.events.map((e) => e.e).join(' ')}`);
  if (!r.td) return r;
  check(`autoland, ${name}: touchdown 150-600 m past the threshold, on the centreline`, td.x > 150 && td.x < 600 && Math.abs(td.z) < 6, `${td.x.toFixed(0)} m, ${td.z.toFixed(1)} m off the centreline`);
  check(`autoland, ${name}: gentle touchdown, wings level, aligned, nose up but not on the tail`, td.vs > -1.3 && Math.abs(td.bank) < 4 && Math.abs(wrap180(td.hdg - 90)) < 3 && td.pitch > 0.5 && td.pitch < 9,
    `${(td.vs * 196.85).toFixed(0)} fpm, bank ${td.bank.toFixed(1)}, heading ${td.hdg.toFixed(1)}, pitch ${td.pitch.toFixed(1)}, ${td.kias.toFixed(0)} KIAS`);
  check(`autoland, ${name}: stops before the end, near the centreline`, stop.x < 1800 && Math.abs(stop.z) < 6, `stopped ${stop.x.toFixed(0)} m down the 1,800 m runway, ${stop.z.toFixed(1)} m off`);
  return r;
};
const calm = autoland('calm');
const vapp = vrefKt(calm.fdm.mass) + VAPP_ADD;
{ const fl = (calm.events.find((e) => e.e === 'flare') || {}).kias, vref = vapp - VAPP_ADD;
  check('autoland: VREF + 10 with full flaps at 500 ft, easing to VREF at the flare (AFM 4-25 / 4-26)', Math.abs(calm.k500 - vapp) < 5 && Math.abs(fl - vref) < 5,
    `${calm.k500?.toFixed(0)} KIAS at 500 ft (VREF + 10 = ${vapp.toFixed(0)}), ${fl?.toFixed(0)} KIAS at the flare (VREF ${vref.toFixed(0)})`); }
autoland('10 kt crosswind from the left', { wind: [0, 0, 10 / KT] });
autoland('8 kt headwind, from the right side', { wind: [-6 / KT, 0, -5 / KT], z: 500, hdg: 70 });

// ---- go-around from 200 ft on the approach ----
{
  const r = makeRig({ altFt: 2500, kias: 170, hdg: 90, x: -18520 }); r.nav.setArrival(RWY, 0); r.engage({ alt: true, hdg: true, spd: true, appr: true }); r.land.arm();
  r.run(400, (q) => q.fdm.pos.y * FT < 200 + SF50_CG.y * FT && q.ap.status.gs);
  r.land.disarm(); r.ap.startGoAround({ ctrl: r.fdm.ctrl, throttle: r.fdm.throttle }, r.att(), r.fdm.pos.y, airData(r.fdm.out).cas);
  r.fdm.setFlaps(1); const y0 = r.fdm.pos.y; let minY = y0; r.run(40, (q) => { minY = Math.min(minY, q.fdm.pos.y); if (q.fdm.gearDown && q.fdm.vel.y > 2) q.fdm.setGear(false); return false; });
  check('go-around from 200 ft: climbs away, loses under 60 ft first, gear up', !r.crashed && r.fdm.pos.y > y0 + 150 && (y0 - minY) * FT < 60 && !r.fdm.gearDown, `+${((r.fdm.pos.y - y0) * FT).toFixed(0)} ft after 40 s, sank ${((y0 - minY) * FT).toFixed(0)} ft`);
}

// ---- Safe Return: picks the nearest paved runway long enough, the into-wind end ----
{
  const mk = (ident, lat, lon, len, paved = 1) => { const b = destination(lat, lon, 0, len); const a = { ident, lat, lon, runways: [] }; a.runways.push(new Runway(a, ['36', '18', lat, lon, b.lat, b.lon, 50, 50, 30, paved, 1])); return a; };
  const far = mk('KFAR', 39.5, -121.0, 2000), shortA = mk('KSHT', 39.1, -121.0, 700), grass = mk('KGRS', 39.12, -121.0, 1500, 0);
  const db = { near: (lat, lon, km) => [shortA, grass, far].map((a) => ({ a, d: Math.hypot((a.lat - lat) * 111e3, (a.lon - lon) * 86e3) })).filter((x) => x.d < km * 1000).sort((p, q) => p.d - q.d) };
  const p = planSafeReturn({ lat: 39.0, lon: -121.0, db, windDir: 180, windSpd: 15 / KT });
  check('Safe Return skips short and unpaved runways, lands into the wind', p && p.apt.ident === 'KFAR' && p.rwy.ends[p.end].ident === '18' && p.waypoints.length === 2,
    p ? `${p.apt.ident} ${p.rwy.ends[p.end].ident}, fixes ${p.waypoints.map((w) => `${w.name} ${(w.alt * FT).toFixed(0)} ft`).join(', ')}` : 'none');
}

// ---- Safe Return begun 9,000 ft over the airfield, flying away from the runway: no instant G/S capture; out to the fixes, back, land, stop ----
{
  const apt = { ident: 'KTST', lat: LAT0, lon: LON0, runways: [RWY] }, db = { near: () => [{ a: apt, d: 500 }] };
  const r = makeRig({ altFt: 9000, kias: 180, hdg: 270, x: 600, z: 0 });
  const ll = geo.toLatLon(r.fdm.pos.x, r.fdm.pos.z), p = planSafeReturn({ lat: ll.lat, lon: ll.lon, db });
  for (const w of p.waypoints) r.nav.add({ lat: w.lat, lon: w.lon, name: w.name }); r.nav.setArrival(p.rwy, p.end);
  r.engage({ nav: true, appr: true, flch: true, spd: true }); Object.assign(r.ap.target, { alt: p.fafAlt, spd: 180 / KT }); r.land.arm(true);
  let early = false; r.run(20, (q) => { if (q.ap.status.gs || q.ap.status.loc) early = true; return false; });
  check('Safe Return over the airfield: no LOC / G/S capture while flying away from the runway', !early, `lat ${r.ap.status.lat}, vert ${r.ap.status.vert}`);
  r.run(1500, (q) => q.land.phase === 'done');
  const td = r.td || {};
  check('Safe Return over the airfield: flies out to the fixes, back down the final, lands and stops on the runway', !r.crashed && r.land.phase === 'done' && td.x > 100 && td.x < 700 && Math.abs(td.z) < 8 && r.fdm.pos.x < 1800,
    `${r.crashed || r.land.phase} after ${(r.t / 60).toFixed(1)} min, touchdown ${td.x?.toFixed(0)} m / ${td.z?.toFixed(1)} m off, ${(td.vs * 196.85)?.toFixed(0)} fpm`);
}

// ---- stabilised-approach gates (pure) ----
{
  const ok = { hFt: 800, ilsValid: true, loc: true, gs: true, locDev: 0.2, gsDev: 0.1, xtk: 5, sinkFpm: 700, dKt: 2, gearDown: true, thrDist: 3000, rwyLen: 1800 };
  const cases = [['above the 1,000 ft gate nothing is judged', { hFt: 1500, loc: false, gs: false, gearDown: false }, null], ['stable', {}, null],
    ['localizer lost', { ilsValid: false }, 'no localizer signal'], ['localizer not captured', { loc: false }, 'localizer not captured'], ['glideslope not captured', { gs: false }, 'glideslope not captured'],
    ['localizer deviation > 1 dot', { locDev: 1.4 }, 'localizer deviation'], ['glideslope deviation > 1 dot', { gsDev: -0.4 }, 'glideslope deviation'],
    ['sink > 1,500 fpm below 500 ft', { hFt: 400, sinkFpm: 1700 }, 'excessive sink rate'], ['1,700 fpm is fine at 800 ft (gate is 500 ft)', { sinkFpm: 1700 }, null],
    ['speed 25 kt high', { dKt: 25 }, 'speed high'], ['speed 12 kt low', { dKt: -12 }, 'speed low'], ['gear up at 450 ft', { hFt: 450, gearDown: false }, 'gear not down'],
    ['gear up at 800 ft is still allowed', { gearDown: false }, null], ['runway behind', { hFt: 50, thrDist: -1500, xtk: 2 }, 'runway behind'],
    ['below 100 ft the angular deviation is ignored', { hFt: 60, locDev: 3, gsDev: 1, xtk: 3 }, null], ['below 100 ft 30 m off the centreline', { hFt: 60, xtk: 30 }, 'off the centreline']];
  for (const [name, o, want] of cases) { const got = approachUnstable({ ...ok, ...o }); check(`approach gate: ${name}`, got === want, `${got}`); }
}

// ---- go-around: an approach that is not stabilised at the gate is abandoned (closed loop) ----
// 800 ft above the runway 4.9 NM out: below the path and inside the 1,000 ft gate with the glideslope not captured
const abortRig = (extra = {}) => {
  const r = makeRig({ altFt: 800, kias: 110, hdg: 90, x: -9000, gear: false, notch: 1, ...extra });
  r.nav.setArrival(RWY, 0); r.engage({ alt: true, hdg: true, spd: true, appr: true }); return r;
};
{
  const r = abortRig(); r.land.arm();
  r.run(60, (q) => q.land.phase === 'goaround');
  const ga = r.events.find((e) => e.e === 'goaround');
  check('go-around: abandons an approach with no glideslope below 1,000 ft', !r.crashed && ga && r.land.phase === 'goaround' && /glideslope|localizer/.test(r.land.gaReason), `${r.land.gaReason} at ${(r.fdm.pos.y * FT - SF50_CG.y * FT).toFixed(0)} ft`);
  const y0 = r.fdm.pos.y; let minY = y0, maxThr = 0, maxPitch = 0;
  r.run(200, (q) => { minY = Math.min(minY, q.fdm.pos.y); maxThr = Math.max(maxThr, q.fdm.throttle); maxPitch = Math.max(maxPitch, q.att().pitch * D); return q.land.phase !== 'goaround'; });
  const done = r.events.find((e) => e.e === 'goaround_done');
  check('go-around: climbs away (sinks under 40 ft), take-off thrust and a nose-up pitch, gear and flaps up, autopilot still on', !r.crashed && done && maxThr > 0.98 && maxPitch > 5 && (y0 - minY) * FT < 40 && r.fdm.pos.y - y0 > 400 / FT && !r.fdm.gearDown && r.fdm.flapCmd === 0 && r.ap.on && r.ap.modes.alt && !r.ap.ga && r.fdm.throttle > 0.1,
    `+${((r.fdm.pos.y - y0) * FT).toFixed(0)} ft in ${(r.t).toFixed(0)} s, peak pitch ${maxPitch.toFixed(0)} deg, throttle ${maxThr.toFixed(2)}, sank ${((y0 - minY) * FT).toFixed(0)} ft, gear ${r.fdm.gearDown ? 'down' : 'up'}, flaps ${r.fdm.flapCmd}, events ${r.events.map((e) => e.e).join(' ')}`);
  check('go-around: hands back to the autopilot: armed off, overrides cleared, trim servo free', !r.land.armed && r.land.phase === 'off' && r.ap.vsOverride == null && r.ap.tauV == null && r.ap.kiDiv == null && !r.ap.modes.appr, `phase ${r.land.phase}, vsOverride ${r.ap.vsOverride}`);
  r.run(200, (q) => Math.abs(q.fdm.pos.y - q.ap.target.alt) * FT < 25 && Math.abs(q.fdm.vel.y) < 0.5); r.run(60); const alt0 = r.ap.target.alt; let dev = 0; r.run(40, (q) => { dev = Math.max(dev, Math.abs(q.fdm.pos.y - alt0) * FT); return false; });
  check('go-around: levels off at the missed-approach altitude (1,500 ft above) and holds it', !r.crashed && dev < 30 && Math.abs(alt0 - y0 - 1500 / FT) < 5, `${dev.toFixed(0)} ft over 40 s, target ${((alt0 - y0) * FT).toFixed(0)} ft above the go-around start`);
}
{ // the pilot (or the disconnect) disarms during the go-around: the overrides come back and nothing is stuck
  const r = abortRig(); r.land.arm(); r.run(60, (q) => q.land.phase === 'goaround'); r.run(0.5);
  const had = r.ap.vsOverride; r.land.disarm();
  check('go-around: disarm during it restores vsOverride / tauV / kiDiv and the phase', had != null && r.ap.vsOverride == null && r.ap.tauV == null && r.ap.kiDiv == null && r.land.phase === 'off' && !r.land.armed && r.land.update(dt, {}) === null, `vsOverride was ${had}`);
  r.ap.disengage(); r.run(5); check('go-around: after disengage the jet keeps flying', !r.crashed, '');
}
{ // the same decision lower down: 450 ft, no glideslope
  const r = abortRig({ altFt: 450, kias: 150, x: -3400 }); r.land.arm(); r.run(20, (q) => q.land.phase === 'goaround');
  check('go-around: no glideslope at 450 ft also aborts', !r.crashed && r.land.phase === 'goaround', `${r.land.phase} ${r.land.gaReason}`);
}
{ // a go-around from the flare: floating long
  const land = new SF50Autoland(), ap = new Autopilot(SF50_AP), fdm = new SF50Model(); fdm.gearDown = true; fdm.flapCmd = 2; fdm.vel.set(40, -0.3, 0); ap.on = true;
  const set = { f: 0, g: null }; const s = { fdm, ap, nav: { ilsValid: true, thrDist: -1500, locXtk: 0, locDev: 0, gsDev: 0 }, att: { heading: 90, pitch: 0.05, bank: 0 }, ias: 43, agl: 5, rwyHdg: 90, rwyLen: 1800, setFlaps: (n) => { set.f = n; fdm.setFlaps(n); }, setGear: (d) => { set.g = d; } };
  land.arm(); land.phase = 'flare'; ap.status.gs = true; ap.status.loc = true;
  const out = land.update(dt, s);
  check('go-around: floating past the safe landing point in the flare goes around, thrust full', land.phase === 'goaround' && out.th === 1 && out.events.includes('goaround') && land.gaReason === 'runway behind' && set.f === 1, `${land.phase} ${land.gaReason}`);
}

// ---- Safe Return: go-around, then up to two more approaches, then a holding orbit ----
{
  const apt = { ident: 'KTST', lat: LAT0, lon: LON0, runways: [RWY] }, db = { near: () => [{ a: apt, d: 9000 }] };
  const r = abortRig(); const p0 = planSafeReturn({ lat: LAT0, lon: LON0 - 0.1, db });
  const replan = (attempt) => {
    const ll = geo.toLatLon(r.fdm.pos.x, r.fdm.pos.z), p = planSafeReturn({ lat: ll.lat, lon: ll.lon, db, avoid: [`${p0.apt.ident}${p0.rwy.ends[p0.end].ident}`] });
    r.nav.clear(); for (const w of p.waypoints) r.nav.add({ lat: w.lat, lon: w.lon, name: w.name }); r.nav.setArrival(p.rwy, p.end);
    r.engage({ nav: true, appr: true, flch: true, spd: true }); Object.assign(r.ap.target, { alt: p.fafAlt, spd: 180 / KT }); r.land.arm(true, attempt);
  };
  r.land.arm(true, 0);
  r.run(60, (q) => q.events.some((e) => e.e === 'replan'));
  check('Safe Return: the first go-around asks for a re-plan (attempt 0 of 2 more)', r.events.some((e) => e.e === 'replan') && r.land.retryAllowed() && r.land.phase === 'hold' && r.ap.vsOverride == null, `${r.events.map((e) => e.e).join(' ')}, phase ${r.land.phase}`);
  replan(1);
  r.run(1800, (q) => q.land.phase === 'done' || q.crashed);
  const td = r.td || {};
  check('Safe Return: the second approach (the other runway end, the first is avoided) flies the fixes, lands and stops', !r.crashed && r.land.phase === 'done' && Math.min(td.x, 1800 - td.x) > 100 && Math.min(td.x, 1800 - td.x) < 900 && Math.abs(td.z) < 8, `${r.crashed || r.land.phase} after ${(r.t / 60).toFixed(1)} min, touchdown ${td.x?.toFixed(0)} m / ${td.z?.toFixed(1)} m off`);
}
{ // out of retries: the hold orbits at the missed-approach altitude, no further re-plan
  const r = abortRig(); r.land.arm(true, 2);
  r.run(120, (q) => q.events.some((e) => e.e === 'hold' || e.e === 'replan'));
  const hasHold = r.events.some((e) => e.e === 'hold'), noRe = !r.events.some((e) => e.e === 'replan');
  r.run(60); const alt0 = r.ap.target.alt, h0 = r.att().heading; let dev = 0, turned = 0, prev = h0; r.run(90, (q) => { dev = Math.max(dev, Math.abs(q.fdm.pos.y - alt0) * FT); const h = q.att().heading; turned += Math.abs(wrap180(h - prev)); prev = h; return false; });
  check('Safe Return: after the last go-around it holds altitude near the field in an orbit', !r.crashed && hasHold && noRe && !r.land.retryAllowed() && r.land.phase === 'hold' && dev < 150 && turned > 270 && r.maxBank < 30,
    `hold ${hasHold}, altitude within ${dev.toFixed(0)} ft, turned ${turned.toFixed(0)} deg in 90 s, max bank ${r.maxBank.toFixed(0)}`);
  r.land.disarm(); check('Safe Return: disarm leaves the hold', r.land.phase === 'off' && !r.land.armed, '');
}

// ---- Safe Return runway choice: fuel, terrain, wind ----
{
  const mk = (ident, lat, lon, hdgDeg, len = 2000) => { const b = destination(lat, lon, hdgDeg, len), a = { ident, lat, lon, runways: [] };
    const num = (h) => String(Math.round(h / 10) || 36).padStart(2, '0'); a.runways.push(new Runway(a, [num(hdgDeg), num((hdgDeg + 180) % 360), lat, lon, b.lat, b.lon, 50, 50, 30, 1, 1])); return a; };
  const mkdb = (list, lat0 = 39.0, lon0 = -121.0) => ({ near: (lat, lon, km) => list.map((a) => ({ a, d: haversine(lat, lon, a.lat, a.lon) })).filter((x) => x.d < km * 1000).sort((p, q) => p.d - q.d) });
  const haversine = (la, lo, lb, lp) => { const R = 6371000, p = Math.PI / 180, dLa = (lb - la) * p, dLo = (lp - lo) * p, h = Math.sin(dLa / 2) ** 2 + Math.cos(la * p) * Math.cos(lb * p) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const id = (p) => p ? `${p.apt.ident} ${p.rwy.ends[p.end].ident}` : 'none';
  // wind: a 25 kt crosswind rejects the near runway for a farther one lined up with the wind (and flags it when it is all there is)
  { const near = mk('KNEA', 39.25, -121.0, 0), far = mk('KFAR', 39.0, -120.2, 90, 2500);
    const p = planSafeReturn({ lat: 39.0, lon: -121.0, db: mkdb([near, far]), windDir: 90, windSpd: 25 / KT });
    check('Safe Return: skips a runway with a crosswind above the limit for one into the wind', p && p.apt.ident === 'KFAR' && p.rwy.ends[p.end].ident === '09' && p.warnings.length === 0, id(p));
    const q = planSafeReturn({ lat: 39.0, lon: -121.0, db: mkdb([near]), windDir: 90, windSpd: 25 / KT });
    check('Safe Return: with only a crosswind runway left it is still flown and the warning says so', q && q.warnings.includes('crosswind'), `${id(q)} ${q?.warnings}`);
    const t = planSafeReturn({ lat: 39.0, lon: -121.0, db: mkdb([mk('KTLW', 39.1, -121.0, 0)]), windDir: 0, windSpd: 14 / KT });
    check('Safe Return: the end with the headwind, not the tailwind', id(t) === 'KTLW 36' && t.warnings.length === 0, id(t));
  }
  // fuel: the better-ranked far airport is out of reach, the near one is chosen
  { const near = mk('KNEA', 39.25, -121.0, 0), far = mk('KFAR', 39.0, -120.2, 90, 2500), db = mkdb([near, far]);
    const dFar = haversine(39.0, -121.0, 39.0, -120.2), dNear = haversine(39.0, -121.0, 39.25, -121.0);
    const full = planSafeReturn({ lat: 39.0, lon: -121.0, db, windDir: 90, windSpd: 25 / KT });
    const lowKg = (fuelNeededKg(dNear) + fuelNeededKg(dFar)) / 2, low = planSafeReturn({ lat: 39.0, lon: -121.0, db, windDir: 90, windSpd: 25 / KT, fuelKg: lowKg });
    check('Safe Return fuel: without the fuel limit the far airport wins; with only enough for the near one, the near one', full.apt.ident === 'KFAR' && low.apt.ident === 'KNEA' && low.warnings.join() === 'crosswind', `${id(full)} -> ${id(low)} (${lowKg.toFixed(0)} kg: near needs ${fuelNeededKg(dNear).toFixed(0)}, far ${fuelNeededKg(dFar).toFixed(0)})`);
    const none = planSafeReturn({ lat: 39.0, lon: -121.0, db, fuelKg: 30 });
    check('Safe Return fuel: nothing reachable still returns the nearest, marked fuel', none && none.apt.ident === 'KNEA' && none.warnings[0] === 'fuel', `${id(none)} ${none?.warnings}`); }
  // terrain: a ridge on the final of the into-wind end, the other end is flown (a tailwind inside the limit)
  { const a = mk('KRDG', 39.2, -121.0, 0), db = mkdb([a]), ridge = (la, lo) => (la < 39.2 - 0.04 && la > 39.2 - 0.12 ? 1200 : 50);
    const clear = planSafeReturn({ lat: 39.45, lon: -121.0, db, windDir: 0, windSpd: 9 / KT, groundAt: () => 50 }), blocked = planSafeReturn({ lat: 39.45, lon: -121.0, db, windDir: 0, windSpd: 9 / KT, groundAt: ridge });
    check('Safe Return terrain: a ridge on the final rejects that runway end', id(clear) === 'KRDG 36' && id(blocked) === 'KRDG 18', `${id(clear)} -> ${id(blocked)}`);
    const all = planSafeReturn({ lat: 39.45, lon: -121.0, db, groundAt: () => 2000 });
    check('Safe Return terrain: terrain above every approach leaves no runway', all === null, id(all));
    const unknown = planSafeReturn({ lat: 39.45, lon: -121.0, db, groundAt: () => null });
    check('Safe Return terrain: unknown terrain is not an obstacle', unknown != null, id(unknown)); }
  // terrain on the direct leg to the 12 NM fix
  { const a = mk('KRT2', 39.3, -121.0, 0), db = mkdb([a]), box = (la, lo) => (la > 39.17 && la < 39.23 && lo > -120.8 && lo < -120.7 ? 1200 : 50);
    const clear = planSafeReturn({ lat: 39.3, lon: -120.5, db, windDir: 0, windSpd: 9 / KT }), blocked = planSafeReturn({ lat: 39.3, lon: -120.5, db, windDir: 0, windSpd: 9 / KT, groundAt: box });
    check('Safe Return terrain: a ridge across the direct leg to the fix rejects that end', id(clear) === 'KRT2 36' && id(blocked) === 'KRT2 18', `${id(clear)} -> ${id(blocked)}`); }
}

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('sf50-autopilot-test ok');
