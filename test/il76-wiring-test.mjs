// Il-76 wiring: registry and setup card, stick, warnings and display feed, spawn configurations, cockpit controls and interlocks, autopilot, collision points,
// the audio profile, and a static audit that every aircraft-specific branch in main.js has an Il-76 answer (so it never inherits the SR-71 or the Vision Jet).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { IL76Model, IL76, IL76_CG, IL76_GEAR, IL76_HARD, NOTCHES, stallAlpha } from '../src/il76.js';
import { c172Stick, c172PitchAuthority, IL76_STICK, C172_STICK } from '../src/c172stick.js';
import { il76Warn, il76Feed, il76Alerts } from '../src/il76feed.js';
import { makeIl76Controls } from '../src/il76ctl.js';
import { IL76_AP } from '../src/il76ap.js';
import { Autopilot, attitude } from '../src/autopilot.js';
import { IL76_COLLIDE_POINTS, IL76_PAD, COLLIDE_POINTS, SF50_COLLIDE_POINTS } from '../src/buildcollide.js';
import { TouchdownReporter } from '../src/touchdown.js';
import { isa } from '../src/atmosphere.js';

let fails = 0;
const check = (name, fn) => { try { const info = fn(); console.log('PASS ', name, info || ''); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const KT = 1.943844, FT = 3.28084, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const fresh = (alt, kt, { onGround = false, mass = 170000, mode = 'medium' } = {}) => { const f = new IL76Model(); f.setMode(mode); f.fuel = mass - IL76.EMPTY - IL76.PAYLOAD; f.reset(new THREE.Vector3(0, onGround ? IL76_CG.y : alt, 0), 90, kt / KT, onGround, 0); return f; };
const fly = (f, secs, ctl) => { for (let t = 0; t < secs; t += dt) { ctl && ctl(f, t); f.step(dt, ground, wind); if (f.crashed) break; } };

// ---- registry, card, copy
check('four aircraft; the Il-76 has a name, model file, blurb and three stats; ?aircraft=il76 and the saved setting choose it', () => {
  assert.equal(Object.keys(AIRCRAFT_TYPES).join(), 'sr71,c172,sf50,il76'); const a = AIRCRAFT_TYPES.il76;
  assert.ok(a.model === 'IL76_v6.glb' && /Il-76MD-90A/.test(a.name) && a.short === 'Il-76' && a.stats.length === 3 && a.blurb.length > 40);
  assert.equal(aircraftChoice({}, '?aircraft=il76'), 'il76'); assert.equal(aircraftChoice({ aircraft: 'il76' }, ''), 'il76'); assert.equal(aircraftChoice({}, '?aircraft=il-76'), 'sr71');
  const html = src('index.html'); assert.ok(html.includes('class="ac-card" data-v="il76"') && /<svg class="ac-icon"[^>]*><path d="M32 4c1\.4/.test(html), 'card with its own SVG icon');
  assert.ok(/Ilyushin Il-76 from 8,200/.test(html) && /<td>2 · 3<\/td>/.test(html), 'meta copy and help rows');
  assert.ok(fs.statSync(new URL('../public/models/IL76_v6.glb', import.meta.url)).size > 1e6, 'the model is in public/');
  assert.ok(/Il-76/.test(src('src/controls.js')) && /id: 'spoilers'/.test(src('src/controls.js')));
});

// ---- stick: full travel at low speed, the schedule falls with speed; a held full pull stays inside the limit load
check('stick: full authority to 150 KIAS, a fifth of it by VMO, softer than the Vision Jet; a held full pull never breaks the airframe at any speed', () => {
  assert.equal(c172PitchAuthority(120, IL76_STICK), 1); assert.equal(c172PitchAuthority(150, IL76_STICK), 1); assert.ok(Math.abs(c172PitchAuthority(324, IL76_STICK) - 0.22) < 0.02);
  assert.ok(IL76_STICK.PITCH_SLEW < C172_STICK.PITCH_SLEW && IL76_STICK.ROLL_SLEW < C172_STICK.ROLL_SLEW, 'slower slews for the heavy aircraft');
  const rows = [];
  for (const [alt, kt, notch] of [[3000, 160, 0], [3000, 250, 0], [3000, 320, 0], [8000, 250, 0], [1500, 150, 3]]) {
    const f = fresh(alt, kt); f.setFlaps(notch); f.flaps = NOTCHES[notch].flap; f.slats = NOTCHES[notch].slat; const v = f.vel.length(); f.quat.identity(); f.vel.set(v, 0, 0); f.trimLevel(0); f.gearDown = false; f.gearPos = 0; f.setEngines(0.7);
    const st = {}; let nz = 0; fly(f, 14, (g) => { c172Stick(st, { pitch: 1, roll: 0 }, (g.out.ias || g.out.V) * KT, dt, IL76_STICK); g.ctrl.de = st.de; g.ctrl.dr = 0; g.throttle = 0.7; nz = Math.max(nz, g.out.nzAero || 0); });
    assert.equal(f.crashed, null, `${alt} m ${kt} kt flaps ${notch}: ${f.crashed}`); rows.push(`${kt} kt ${nz.toFixed(2)} g`);
  }
  return rows.join(', ');
});

// ---- warnings, alerts and the display feed
check('warnings: stall, pull-up, gear horn, overspeed (Vmo, Mmo, flap and gear limits), over-g and low fuel; alerts rank warnings first', () => {
  const f = fresh(300, 160, { mass: 170000, mode: 'realistic' }); fly(f, 1); const base = { casKt: 150, iasMs: 77, agl: 250, dt: 10 }; // dt 10 s: past every hold time, so each call shows the settled warning
  assert.deepEqual(Object.keys(il76Warn(f, base)).sort(), ['gearUnsafe', 'lowFuel', 'overG', 'overspeed', 'pullUp', 'stall']);
  f.out.aoaNorm = 0.95; assert.ok(il76Warn(f, base).stall); f.out.aoaNorm = 0.3; assert.ok(!il76Warn(f, base).stall);
  f.flapCmd = 0; f.gearDown = false; f.vel.y = -3; f.throttle = 0; assert.ok(il76Warn(f, base).gearUnsafe, 'gear horn: gear up, low, descending, slow, thrust back'); f.throttle = 0.8; assert.ok(!il76Warn(f, base).gearUnsafe, 'no horn climbing away with power on'); f.throttle = 0; assert.ok(!il76Warn(f, { ...base, casKt: 260 }).gearUnsafe, 'silenced above the gear speed'); f.flapCmd = 4; assert.ok(il76Warn(f, { ...base, casKt: 260, agl: 700 }).gearUnsafe, 'landing flaps with the gear up: the configuration horn'); f.flapCmd = 0; f.gearDown = true;
  f.vel.y = -14; assert.ok(il76Warn(f, { ...base, agl: 120 }).pullUp); f.vel.y = 0;
  assert.ok(il76Warn(f, { ...base, casKt: 330 }).overspeed); f.out.M = 0.79; assert.ok(!il76Warn(f, base).overspeed, 'Mach 0.79 is inside the limit'); f.out.M = 0.82; assert.ok(il76Warn(f, base).overspeed); f.out.M = 0.5; const vfe = f.out.vfe; f.out.vfe = 120; assert.ok(il76Warn(f, base).overspeed, 'past the flap limit'); f.out.vfe = vfe;
  const g = fresh(300, 148, { mass: 165000 }); fly(g, 1); g.out.aoaNorm = 0.95; assert.ok(!il76Warn(g, { ...base, dt: 0.1 }).stall, 'a one-frame spike does not warn'); for (let i = 0; i < 5; i++) il76Warn(g, { ...base, dt: 0.1 }); assert.ok(il76Warn(g, { ...base, dt: 0.1 }).stall, 'held for 0.35 s it does');
  f.fuel = 3000; assert.ok(il76Warn(f, base).lowFuel); f.unlimitedFuel = true; assert.ok(!il76Warn(f, base).lowFuel);
  const a = il76Alerts(f, { pullUp: true, stall: true, lowFuel: true }); assert.deepEqual(a.map((x) => x.level), ['warning', 'warning', 'caution']);
  const easy = fresh(3000, 250, { mode: 'easy' }); fly(easy, 1); assert.ok(!il76Warn(easy, { ...base, casKt: 340, agl: 3000 }).overspeed, 'the easier modes widen the limit speeds');
});
check('the display feed gives the PFD, ND and engine screens their units: kt, ft, fpm, deg, N1 / EGT of all four engines, flaps, slats, gear, spoilers, reversers, fuel', () => {
  const f = fresh(3000, 250); fly(f, 1); f.engines[3].rev = 1; f.spoilers = 0.5; f.fuel = 40000;
  const s = il76Feed(f, { att: { pitch: 4, roll: -10, heading: 91 }, casMs: 128.6, gsMs: 130, altM: 3000, warn: { stall: true }, selHdg: 120 });
  assert.ok(Math.abs(s.ias - 250) < 1 && Math.abs(s.altFt - 9843) < 2 && Math.abs(s.gs - 252.7) < 1 && s.hdg === 91 && s.pitch === 4 && s.bank === -10 && s.selHdg === 120);
  assert.equal(s.n1.length, 4); assert.ok(s.n1.every((v) => v >= 30) && s.egt.every((v) => v >= 300), `n1 ${s.n1} egt ${s.egt}`); assert.equal(s.rev[3], 1); assert.equal(s.spoilers, 0.5); assert.equal(s.fuel, 40000); assert.equal(s.gear, 0); assert.equal(s.alerts[0].text, 'STALL');
  assert.ok(s.ff > 1000, 'fuel flow in kg/h');
});

// ---- spawn configurations: what main.js's spawn() hands the flight model
check('final approach start (148 KIAS at landing weight, inside the 280 km/h landing-flap limit): slats 25 / flaps 43, gear down, and it holds the approach for a minute; the cruise start holds FL330 at Mach 0.72', () => {
  const f = fresh(450, 148, { mass: 165000 }); assert.equal(f.flapCmd, 4); assert.equal(f.slats, 25); assert.equal(f.flaps, 43); assert.ok(f.gearDown && f.gearPos === 1);
  const y0 = f.pos.y; fly(f, 60, (g) => { g.ctrl.da = Math.max(-1, Math.min(1, -2 * (-Math.asin(new THREE.Vector3(0, 0, 1).applyQuaternion(g.quat).y)) - 0.5 * g.w.x)); }); assert.equal(f.crashed, null);
  assert.ok(Math.abs(f.out.ias * KT - 148) < 25 && Math.abs(f.pos.y - y0) < 120, `${(f.out.ias * KT).toFixed(0)} KIAS, ${(f.pos.y - y0).toFixed(0)} m`);
  const tas = 0.72 * isa(10000).a, c = fresh(10000, tas * KT, { mass: 170000 }); assert.ok(!c.gearDown && c.flapCmd === 0 && c.throttle < 1, `lever ${c.throttle.toFixed(2)}`);
  const y1 = c.pos.y; fly(c, 60, (g) => { g.ctrl.da = Math.max(-1, Math.min(1, -2 * (-Math.asin(new THREE.Vector3(0, 0, 1).applyQuaternion(g.quat).y)) - 0.5 * g.w.x)); }); assert.equal(c.crashed, null); assert.ok(Math.abs(c.pos.y - y1) < 150 && Math.abs(c.out.M - 0.72) < 0.015, `${(c.pos.y - y1).toFixed(0)} m, M ${c.out.M.toFixed(3)}`);
  const m = src('src/main.js'); assert.ok(/IL76_NOTCH_TO/.test(m) && /fdm\.setMode\(settings\.mode\)/.test(m) && /IL76\.FUEL_START/.test(m), 'runway start: take-off slats and flaps, mode, fuel');
});

// ---- cockpit controls and their interlocks (src/il76ctl.js)
check('gear lever, flaps, spoilers, thrust reverse, doors and the cargo-hatch interlock follow the rules, and tell the player', () => {
  const toasts = [], played = []; const f = fresh(0, 0, { onGround: true, mass: 160000, mode: 'realistic' }); fly(f, 3);
  const visual = { crewDoor: { cmd: 0, pos: 0 }, para: { cmd: 0, pos: 0 }, cargo: { cmd: 0, pos: 0 }, setDoors(o) { this.crewDoor.cmd = o ? 1 : 0; }, setParatroop(o) { this.para.cmd = o ? 1 : 0; }, setCargo(o) { this.cargo.cmd = o ? 1 : 0; } };
  let kt = 0; const c = makeIl76Controls({ fdm: f, visual, audio: { play: (n, k) => played.push([n, k]) }, toast: (m, w) => toasts.push([m, !!w]), casKt: () => kt });
  c.gear(); assert.ok(f.gearDown && /locked down/.test(toasts.at(-1)[0]) && toasts.at(-1)[1], 'gear up refused on the ground');
  c.flapsDown(); assert.equal(f.flapCmd, 1); for (let i = 0; i < 3; i++) c.flapsDown(); assert.equal(f.flapCmd, 4); c.flapsDown(); assert.equal(f.flapCmd, 0, 'wraps to UP'); c.flapsUp(); assert.equal(f.flapCmd, 0);
  kt = 300; c.flapsDown(); c.flapsDown(); c.flapsDown(); c.flapsDown(); assert.ok(/VFE/.test(toasts.at(-1)[0]) && toasts.at(-1)[1], 'full flaps above 151 KIAS is flagged'); c.flapsUp(); c.flapsUp(); c.flapsUp(); c.flapsUp(); kt = 0;
  c.spoilers(); assert.ok(f.spoilerCmd); c.spoilers(); assert.ok(!f.spoilerCmd);
  c.reverse(); assert.ok(f.reverserCmd && played.at(-1)[0] === 'reverser-deploy' && /engines 1 and 4/.test(toasts.at(-1)[0])); c.reverse(); assert.ok(!f.reverserCmd && played.at(-1)[0] === 'reverser-stow');
  c.doors(); assert.equal(visual.crewDoor.cmd, 1); c.doors(); assert.equal(visual.crewDoor.cmd, 0); c.paratroop(); assert.equal(visual.para.cmd, 1); c.paratroop();
  c.cargo(); assert.equal(visual.cargo.cmd, 1, 'cargo hatch opens on the ground'); visual.cargo.pos = 1; assert.equal(c.frame(), 0.3, 'no take-off power with the hatch open'); assert.ok(/before take-off power/.test(toasts.at(-1)[0]));
  c.cargo(); assert.equal(visual.cargo.cmd, 0, 'closing is always allowed'); visual.cargo.pos = 0; assert.equal(c.frame(), 1);
  f.vel.set(10, 0, 0); c.doors(); assert.equal(visual.crewDoor.cmd, 0, 'doors refuse to open on the move'); visual.crewDoor.cmd = 1; visual.para.cmd = 1; c.frame(); assert.ok(visual.crewDoor.cmd === 0 && visual.para.cmd === 0, 'and close by themselves');
  const air = fresh(1500, 150); const c2 = makeIl76Controls({ fdm: air, visual, toast: (m, w) => toasts.push([m, !!w]), casKt: () => 240 }); c2.reverse(); assert.ok(!air.reverserCmd && /locked out in the air/.test(toasts.at(-1)[0])); c2.cargo(); assert.equal(visual.cargo.cmd, 0, 'no cargo hatch opening in flight');
  c2.gear(); assert.ok(!air.gearDown && /VLO/.test(toasts.at(-1)[0]), 'gear up above 200 KIAS warns (VLO 370 km/h)');
  assert.equal(c2.warnTone({ pullUp: true, stall: true }), 2); assert.equal(c2.warnTone({ stall: true }), 1); assert.equal(c2.warnTone({ overspeed: true }), 4); assert.equal(c2.warnTone({ gearUnsafe: true }), 3); assert.equal(c2.warnTone({}), 0);
});

// ---- touchdown: one report per landing though twenty wheels touch
check('one "Touchdown" report per landing even though all five gear units make contact', () => {
  const r = new TouchdownReporter(); const f = fresh(5, 150, { mass: 165000 }); f.setFlaps(4); f.flaps = 43; f.slats = 25; f.vel.y = -2.2; let air = 0, reports = [];
  for (let i = 0; i < 60 * 12; i++) { f.step(1 / 60, ground, wind); const sink = r.frame(f.events, 1 / 60, f.onGround); f.events.length = 0; if (sink !== null) reports.push(sink); if (!f.onGround) air++; }
  assert.equal(f.crashed, null); assert.equal(reports.length <= 1, true, `${reports.length} reports`);
});

// ---- autopilot: the shared one with IL76_AP holds altitude and speed, turns, climbs and levels off; no autoland is offered
check('autopilot with IL76_AP: ALT / HDG / speed hold, a 60 degree turn and a 600 m climb with capture, FLCH to altitude, no crash', () => {
  const run = (mode) => {
    const f = fresh(3000, 250, { mode }); const ap = new Autopilot(IL76_AP); ap.target.alt = 3000; ap.target.hdg = 90; ap.engage({ ctrl: f.ctrl, throttle: f.throttle }); Object.assign(ap.modes, { alt: true, hdg: true, spd: true }); ap.target.spd = 250 / KT;
    const step = (secs) => { for (let i = 0; i < secs * 60; i++) { const att = attitude(f.quat), c = ap.update(1 / 60, { fdm: f, out: f.out, att, vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? 0, nav: {} }); f.ctrl.de = c.de; f.ctrl.da = c.da; f.ctrl.dr = c.dr; if (ap.modes.spd || c.thrOverride) f.throttle = c.th; for (let k = 0; k < 2; k++) f.step(1 / 120, ground, wind); if (f.crashed) break; } };
    step(60); const hold = { alt: f.pos.y, hdg: attitude(f.quat).heading, kias: f.out.ias * KT }; ap.target.hdg = 150; ap.target.alt = 3600; let maxBank = 0; for (let i = 0; i < 150; i++) { step(1); maxBank = Math.max(maxBank, Math.abs(attitude(f.quat).bank)); }
    return { f, hold, maxBank, alt: f.pos.y, hdg: attitude(f.quat).heading };
  };
  for (const mode of ['realistic', 'easy']) { const r = run(mode); assert.equal(r.f.crashed, null); assert.ok(Math.abs(r.hold.alt - 3000) < 40 && Math.abs(r.hold.hdg - 90) < 2 && Math.abs(r.hold.kias - 244) < 15, `${mode} hold ${JSON.stringify(r.hold)}`); assert.ok(Math.abs(r.alt - 3600) < 40 && Math.abs(r.hdg - 150) < 3 && r.maxBank < 32 / 57.3, `${mode} turn+climb ${r.alt.toFixed(0)} m ${r.hdg.toFixed(0)} deg bank ${(r.maxBank * 57.3).toFixed(0)}`); }
  const m = src('src/main.js'); assert.ok(/IS_SF50 \? SF50_AP : IS_IL76 \? IL76_AP/.test(m) && /Climbing to FL330/.test(m), 'main uses IL76_AP and its climb to cruise'); assert.ok(/controls\.on\('autoland', \(\) => \{ if \(IS_SF50\) armAutoland\(\)/.test(m), 'autoland stays a Vision Jet feature (refused politely for the others)');
  assert.ok(IL76_AP.iasLimit * KT > 320 && IL76_AP.machLimit === 0.80 && IL76_AP.climbIas() > 120 && IL76_AP.target.mach === 0.72);
  const f = fresh(3000, 160); f.flaps = 43; f.slats = 25; assert.ok(IL76_AP.prot(f, 0.25).aOn < stallAlpha(43, 25, 0.25) && IL76_AP.vmin(f, 0.25) < 70, 'protection angles sit below the stall for this configuration');
});

// ---- collision points
check('building collision points cover the span, the gear, the tail and the engines of a 50 m aircraft, with a pad to match', () => {
  const pts = IL76_COLLIDE_POINTS, zs = pts.map((p) => p.z), ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
  assert.ok(Math.max(...zs) >= 25 && Math.min(...zs) <= -25, 'wingtips'); assert.ok(Math.min(...ys) < -IL76_CG.y + 0.2 && Math.max(...ys) > 9, 'wheels and the T-tail'); assert.ok(Math.min(...xs) < -20 && Math.max(...xs) > 20, 'tail and nose');
  assert.ok(pts.length >= IL76_HARD.length + IL76_GEAR.length && pts.length > SF50_COLLIDE_POINTS.length && IL76_PAD > 0.6 && IL76_PAD < 2.5, `${pts.length} points, pad ${IL76_PAD} m`); assert.ok(COLLIDE_POINTS.length > 0);
});

// ---- audio: four turbofans through the TURBOFAN4 profile; the SF50 literal and the shared NO_FAN profile are untouched
const il76ctlHas = (k) => src('src/il76ctl.js').includes(`'${k}'`);
check('audio: TURBOFAN4 matches the PS-90A-76 (716 Hz idle to 2,387 Hz take-off blade-pass), main passes four engines, the profile and the system flags', () => {
  const a = src('src/audio.js'), m = src('src/main.js');
  const prof = /const TURBOFAN4 = \{([^}]*)\}/.exec(a); assert.ok(prof); const P = Object.fromEntries(prof[1].split(',').map((kv) => kv.split(':').map((x) => x.trim())).map(([k, v]) => [k, +v]));
  assert.ok(P.whineLo === 716 && Math.abs(P.whineLo + P.whineSpan - 2387) < 1 && P.blades === 33 && P.n1Rpm === 4340 && P.n2Rpm === 11740 && P.cabin < 1 && P.windRef === 400, JSON.stringify(P));
  assert.ok(/engines: IS_SF50 \? \[fdm\.engines\[0\]\] : fdm\.engines, fan: IS_SF50, profile: IS_IL76 \? 'turbofan4' : null/.test(m), 'one engine for the SF50, all four for the Il-76'); assert.ok(/audio\.configure\(\{ engines: 4 \}\)/.test(m));
  for (const k of ['flapMoving', 'cargoMoving', 'revMoving', 'spoilers', 'apu', 'warnTone: IS_IL76 ? il76c.warnTone(warn)']) assert.ok(m.includes(k), k);
  for (const k of ['touch-bogies', 'reverser-deploy', 'reverser-stow', 'spoiler', 'cargo-clunk', 'flap-clunk']) assert.ok(a.includes(`case '${k}'`) && m.includes(`'${k}'`) || il76ctlHas(k), k);
});


// ---- the audit: every branch in main.js that is specific to the Vision Jet is meant to be, and everything the Il-76 needs has its own
check('main.js audit: each IS_SF50 line without an Il-76 answer is a deliberate Vision Jet feature (autoland, Safe Return, PFD feed, cabin door...), and no IS_GA branch swallows the Il-76', () => {
  const lines = src('src/main.js').split('\n').map((l) => l.trim()).filter((l) => /IS_SF50/.test(l) && !/IS_IL76/.test(l));
  const MARK = ['setCallsign(\'Vision Jet\'', 'configureCameraAircraft({ eye: SF50_EYE', 'fdm.setTakeoffTrim(); } // runway starts: 50 % flaps', 'sp.alt = 25000 / FT; sp.speed = 180', 'if (IS_SF50) {', ': IS_SF50 ? [[\'Cruise FL250\'',
    'Auto take-off is for the SR-71. Vision Jet', 'autoland.disarm(); state.alBrakes = 0; ap.vsOverride', 'Object.assign(ap.target, { alt: 28000', 'if (!IS_SF50) { toast(\'Doors', 'if (IS_SF50) armAutoland()', 'if (IS_SF50) safeReturn()', 'No drag chute on the Vision Jet',
    'if (IS_SF50) sf50ApFrame', 'IS_SF50 && visual.cabinDoor', 'const sf50Feed = IS_SF50', 'scale: IS_SF50 ? 0.3 : 1'];
  const stray = lines.filter((l) => !MARK.some((k) => l.includes(k))); assert.deepEqual(stray, [], 'Vision Jet-only lines with no Il-76 answer and no entry in the audit list');
  assert.ok(src('src/main.js').split('\n').filter((l) => /IS_IL76/.test(l)).length >= 55, 'the Il-76 is wired at every site');
  assert.ok(!/IS_GA = IS_C172 \|\| IS_SF50 \|\| IS_IL76/.test(src('src/main.js')));
  const gaLines = src('src/main.js').split('\n').filter((l) => /\bIS_GA\b/.test(l) && !/IS_IL76|STICK_GA/.test(l)).map((l) => l.trim().slice(0, 70));
  // light-aircraft-only behaviour that the Il-76 deliberately does not take: the second throttle bar and A/B zone hiding, the missions guide, the wreck camera distance, the strip bars
  assert.ok(gaLines.length <= 8, `${gaLines.length} IS_GA lines: ${gaLines.join(' | ')}`);
});
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
