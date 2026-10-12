// Closed-loop autopilot scenarios on the real flight model: speed changes, stall / minimum-speed / overspeed protection, recovery.
import assert from 'node:assert/strict';
import { makeRig, setAttitude, KT, FT } from './ap-rig.mjs';
import { PROT, minSpeedEas, attitude } from '../src/autopilot.js';

const results = [];
const check = (name, cond, info = '') => { assert.ok(cond, `${name} ${info}`); console.log(`PASS  ${name} ${info}`); results.push(name); };

// --- altitude hold across speed changes (target below the minimum-speed floor is raised to it) ---
for (const [from, to, gear] of [[250, 150, false], [250, 150, true], [250, 200, false], [200, 300, true]]) {
  const r = makeRig({ altM: 3048, kt: from, gear });
  r.engage({ spd: true, alt: true, hdg: true }); r.ap.target.spd = to / KT;
  let dev = 0, aoa = 0;
  r.run(120, 10, (rr) => { dev = Math.max(dev, Math.abs(rr.fdm.pos.y - 3048) * FT); aoa = Math.max(aoa, rr.fdm.out.alpha); });
  const vmin = minSpeedEas(r.fdm.mass, 0.3) * KT;
  check(`alt hold ${from}->${to} kt gear ${gear ? 'down' : 'up'}`, dev < 400 && aoa < 0.26 && !r.fdm.crashed && r.sample().kt > vmin, `maxdev ${dev.toFixed(0)} ft, max AoA ${(aoa * 57.3).toFixed(1)} deg, final ${r.sample().kt.toFixed(0)} kt`);
}

// --- stall protection: engaged while already past the AOA limit / below the minimum speed ---
{
  const r = makeRig({ altM: 3048, kt: 150 });
  r.engage({ spd: true, alt: true, hdg: true }); r.ap.target.spd = 250 / KT;
  let dev = 0, tOk = null;
  r.run(40, 10, (rr) => { dev = Math.max(dev, (3048 - rr.fdm.pos.y) * FT); if (tOk == null && rr.fdm.out.alpha < PROT.aOn) tOk = rr.t; });
  check('stall protect: below the minimum speed the AOA comes back under the limit', tOk != null && tOk < 15 && r.ap.on, `AOA < ${(PROT.aOn * 57.3).toFixed(1)} deg after ${tOk?.toFixed(1)} s, height lost ${dev.toFixed(0)} ft`);
  check('stall protect: it does not dive to get out of it', dev < 800, `${dev.toFixed(0)} ft`);
}
{
  const r = makeRig({ altM: 3048, kt: 250 });
  r.engage({ alt: true, hdg: true }); r.fdm.throttle = 0.2; r.ap.target.alt = 3048 + 3000; // ask for a big climb with no speed mode and low power
  let aoa = 0; r.run(150, 10, (rr) => { aoa = Math.max(aoa, rr.fdm.out.alpha); });
  check('stall protect: a commanded climb never pushes the AOA past the warning angle', aoa < 0.26 && !r.fdm.crashed, `max AoA ${(aoa * 57.3).toFixed(1)} deg`);
}

// --- overspeed ---
{
  const r = makeRig({ altM: 3048, kt: 400 });
  r.engage({ spd: true, alt: true, hdg: true }); r.ap.target.spd = 600 / KT;
  let mx = 0; r.run(90, 10, (rr) => { mx = Math.max(mx, rr.fdm.out.ias * KT); });
  check('overspeed: a 600 kt target stays under 450 KEAS', mx < 452, `max ${mx.toFixed(0)} KEAS`);
}
{
  const r = makeRig({ altM: 24000, mach: 3.1 });
  r.engage({ mach: true, alt: true, hdg: true }); r.ap.target.mach = 3.45; r.ap.target.alt = 24000;
  let mx = 0; r.run(120, 10, (rr) => { mx = Math.max(mx, rr.fdm.out.M); });
  check('overspeed: Mach target 3.45 stays under the Mach limit', mx < 3.34 && !r.fdm.crashed, `max M ${mx.toFixed(2)}`);
}

// --- climb to cruise: speed schedule, no stall protection, limits respected ---
{
  const r = makeRig({ altM: 4500, kt: 320 });
  r.engage({ mach: true, alt: true, hdg: true }); Object.assign(r.ap.target, { mach: 3.2, alt: 24000, vsLimit: 55 }); r.fdm.throttle = 1; r.ap.thI = 1;
  let aoa = 0, kmax = 0, mmax = 0, prot = new Set(), tTop = null;
  r.run(1500, 100, (rr) => { const o = rr.fdm.out; aoa = Math.max(aoa, o.alpha); kmax = Math.max(kmax, o.ias * KT); mmax = Math.max(mmax, o.M); if (rr.ap.status.prot) prot.add(rr.ap.status.prot); if (tTop == null && Math.abs(rr.fdm.pos.y - 24000) < 100 && o.M > 3.0) tTop = rr.t; });
  check('climb to 78,700 ft at Mach 3.2 follows a speed schedule', tTop != null && tTop < 1500 && aoa < 0.15 && !prot.has('STALL PROTECT') && kmax < 452 && mmax < 3.3 && !r.fdm.crashed,
    `on altitude and M > 3 after ${tTop?.toFixed(0)} s, max AoA ${(aoa * 57.3).toFixed(1)} deg, max ${kmax.toFixed(0)} KEAS, max M ${mmax.toFixed(2)}, protections: ${[...prot].join(',') || 'none'}`);
}

// --- turbulence and heading hold ---
{
  const r = makeRig({ altM: 3048, kt: 250 }); r.engage({ spd: true, alt: true, hdg: true }); r.ap.target.spd = 250 / KT;
  let dev = 0, aoa = 0;
  r.run(180, 20, (rr) => { const t = rr.t; rr.wind.set(6 * Math.sin(t * 1.3) + 3 * Math.sin(t * 3.7), 5 * Math.sin(t * 0.9 + 1) + 3 * Math.sin(t * 2.9), 5 * Math.sin(t * 1.7)); dev = Math.max(dev, Math.abs(rr.fdm.pos.y - 3048) * FT); aoa = Math.max(aoa, rr.fdm.out.alpha); });
  check('altitude hold in gusty air (about 6 m/s)', dev < 250 && aoa < 0.26, `max deviation ${dev.toFixed(0)} ft, max AoA ${(aoa * 57.3).toFixed(1)} deg`);
}
for (const [label, opts, secs, lim] of [['150 kt', { altM: 3048, kt: 250 }, 200, 25], ['Mach 3', { altM: 24000, mach: 3 }, 900, 26]]) {
  const r = makeRig(opts), fast = !!opts.mach; r.engage({ spd: !fast, mach: fast, alt: true, hdg: true }); Object.assign(r.ap.target, { hdg: 270, spd: 150 / KT, mach: 3 });
  let bank = 0; r.run(secs, 20, (rr) => { bank = Math.max(bank, Math.abs(attitude(rr.fdm.quat).bank) * 57.3); });
  const h = attitude(r.fdm.quat).heading, e = Math.abs(((h - 270 + 540) % 360) - 180), dAlt = Math.abs(r.fdm.pos.y - opts.altM) * FT;
  check(`180 degree heading change ${label}`, e < 3 && bank < lim + 6 && dAlt < 300 && !r.fdm.crashed, `final heading error ${e.toFixed(1)} deg, max bank ${bank.toFixed(0)}, altitude change ${dAlt.toFixed(0)} ft`);
}

// --- recovery ---
const cases = {
  'nose-high stall': { pitch: 50, bank: 0, kt: 90, altM: 6000, velAlongHeading: true },
  'inverted dive': { pitch: -40, bank: 150, kt: 300, altM: 6000 },
  'steep spiral': { pitch: -30, bank: 80, kt: 350, altM: 6000 },
  'slow and banked': { pitch: 15, bank: 60, kt: 130, altM: 6000 },
};
for (const [name, c] of Object.entries(cases)) {
  const r = makeRig({ altM: c.altM, kt: 300 }); setAttitude(r.fdm, c);
  r.fdm.throttle = 0.5; r.ap.startRecovery({ ctrl: r.fdm.ctrl, throttle: r.fdm.throttle });
  let minAlt = 1e9, tDone = null;
  r.run(120, 10, (rr) => { minAlt = Math.min(minAlt, rr.fdm.pos.y); if (tDone == null && !rr.ap.recovering) tDone = rr.t; });
  const e = r.sample();
  check(`recover: ${name}`, tDone != null && tDone < 70 && !r.fdm.crashed && minAlt > 3000 && Math.abs(e.bankDeg) < 5 && Math.abs(e.vsFpm) < 1500 && e.kt > minSpeedEas(r.fdm.mass, e.M) * KT,
    `level after ${tDone?.toFixed(0)} s, lowest ${(minAlt * FT).toFixed(0)} ft, then ${e.kt.toFixed(0)} kt, ${e.altFt.toFixed(0)} ft`);
}
console.log(`\nall autopilot tests passed (${results.length})`);
