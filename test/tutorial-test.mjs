import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Tutorial, STEPS } from '../src/tutorial.js';
import { scoreLanding, createMission } from '../src/missions.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const base = { iasKt: 0, agl: 0, altFt: 0, pitchDeg: 0, hdg: 90, onGround: true, gearDown: true, throttle: 0, apOn: false, apAltFt: 5000, apHdg: 90, view: 'orbit', orbitAz: 0, xtk: 0 };
const tick = (t, c, n = 1) => { let v; for (let i = 0; i < n; i++) v = t.update(0.2, c); return v; };

check('tutorial waits for the pilot: nothing advances on its own', () => {
  const t = new Tutorial(); t.start(base); const v = tick(t, base, 200);
  assert.equal(v.title, 'Look around'); assert.equal(t.i, 0);
});
check('each step advances only when its action happens', () => {
  const t = new Tutorial(), c = { ...base }; t.start(c);
  tick(t, c, 2); c.orbitAz = 1; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'throttle');
  tick(t, c, 10); assert.equal(STEPS[t.i].id, 'throttle', 'throttle step must wait for 9');
  c.throttle = 1; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'roll');
  c.iasKt = 190; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'rotate');
  c.onGround = false; c.agl = 20; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'gear');
  c.gearDown = false; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'climb');
  c.altFt = 7000; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'trim');
  c.throttle = 0.85; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'ap'); // no air brake step: the real SR-71 had none (round 5)
  c.apOn = true; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'apalt');
  c.apAltFt = 8000; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'aphdg');
  c.apHdg = 180; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'aphdg', 'must also wait for the turn to finish');
  c.hdg = 178; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'takeover');
  c.apOn = false; tick(t, c, 8); assert.equal(t.i, STEPS.length);
  assert.equal(tick(t, c, 1).title, 'Tutorial complete');
  tick(t, c, 80); assert.ok(!t.active, 'ends by itself after the final message');
});
check('hints react to what the pilot is doing', () => {
  const t = new Tutorial(), c = { ...base, throttle: 1, iasKt: 200, view: 'cockpit' }; t.start(c); t.i = 5; // climb
  c.onGround = false; c.gearDown = false; c.pitchDeg = 28; c.iasKt = 300;
  assert.match(tick(t, c).hint, /Too steep/); c.pitchDeg = 10; c.iasKt = 220; assert.match(tick(t, c).hint, /Speed is dropping/);
  c.iasKt = 320; assert.equal(tick(t, c).hint, '');
  t.i = 2; t.entered = false; c.onGround = true; c.xtk = 15; assert.match(tick(t, c).hint, /Steer left/);
});
check('the climb step teaches the real profile: low and fast to about 400 kt, then pull up', () => {
  const climb = STEPS.find((x) => x.id === 'climb');
  assert.match(climb.text, /400 kt/); assert.match(climb.text, /15 to 20 degrees/);
  const c = { ...base, onGround: false, gearDown: false, pitchDeg: 10, iasKt: 560 };
  assert.match(climb.hint(c), /raise the nose/i);
});
check('the final card points to the new controls', () => {
  const t = new Tutorial(); t.start(base); t.i = STEPS.length; const v = tick(t, base, 1);
  for (const key of ['T ', 'J ', 'C ', 'B ']) assert.ok(v.text.includes(key), `missing ${key}`);
  for (const key of ['F for', 'N for', 'air brake', 'reverse thrust']) assert.ok(!v.text.includes(key), `still mentions ${key}`);
});
check('skip step moves on', () => {
  const t = new Tutorial(); t.start(base); tick(t, base); t.skip(); tick(t, base, 8); assert.equal(t.i, 1);
});

const td = (o) => ({ sink: 1, kt: 180, vref: 176, off: 2, dist: 400, belly: false, ...o }); // round 4: speed is scored against the weight's touchdown reference
check('landing score: a smooth landing is an A, a hard one is not', () => {
  assert.equal(scoreLanding(td()).total, 100); assert.equal(scoreLanding(td()).grade, 'A');
  const hard = scoreLanding(td({ sink: 4, kt: 215, off: 20, dist: 2500 }));
  assert.ok(hard.total < 35 && hard.tips.length >= 3, `hard=${hard.total}`);
  assert.equal(scoreLanding(td({ belly: true })).total, 0);
});
check('landing mission: final, flare, touchdown, rollout, score', () => {
  const m = createMission('landhand', {}), s = { agl: 300, vy: -4, onGround: false, iasKt: 180, gs: 92, throttle: 0.3, crashed: null, gearDown: true, chute: 0, ilsValid: true, gsDev: 0, locXtk: 1, thrDist: 2000, vrefKt: 172 };
  m.update(0.2, s); assert.equal(m.phase, 'final'); assert.match(m.coach().title, /ILS/);
  s.agl = 40; m.update(0.2, s); assert.equal(m.phase, 'flare');
  s.agl = 20; s.vy = -4; m.update(0.2, s); assert.match(m.coach().hint, /Pull back/);
  s.vy = -1.4; m.update(0.2, s);
  s.agl = 2; s.onGround = true; s.thrDist = -350; s.iasKt = 178; const ev = m.update(0.2, s);
  assert.equal(ev.event, 'touchdown'); assert.equal(m.phase, 'rollout'); assert.ok(m.score.total >= 85, 'score ' + m.score.total);
  s.gs = 2; const end = m.update(0.2, s); assert.equal(end.event, 'done'); assert.match(m.coach().title, /Score/);
});
check('landing mission: a crash ends it with advice', () => {
  const m = createMission('landassist', {}); m.update(0.2, { agl: 100, vy: -3, onGround: false, iasKt: 180, gs: 90, throttle: 0.3, crashed: null, gearDown: true });
  const ev = m.update(0.2, { agl: 0, vy: -9, onGround: true, iasKt: 180, gs: 90, throttle: 0.3, crashed: 'hard landing', gearDown: true });
  assert.equal(ev.event, 'done'); assert.equal(m.coach().title, 'Crashed');
});

const approach = (overrides = {}) => ({ agl: 40, vy: -2, onGround: false, iasKt: 180, gs: 92,
  throttle: 0.3, crashed: null, gearDown: true, chute: 0, ilsValid: true, gsDev: 0,
  locXtk: 1, thrDist: 2000, apOn: false, ...overrides });
for (const kind of ['landhand', 'landassist']) {
  check(`${kind} E09: a manual go-around leaves flare and a stable new final can be landed`, () => {
    const m = createMission(kind, {});
    m.update(0.2, approach()); assert.equal(m.phase, 'flare');
    // The audited reproduction: 400 m high and climbing at +8 m/s.
    m.update(0.2, approach({ agl: 400, vy: 8, throttle: 1 }));
    assert.equal(m.phase, 'goaround'); assert.equal(m.done, false); assert.equal(m.score, null);
    assert.match(m.coach().title, /Climb away/); assert.doesNotMatch(m.coach().text, /idle|touch down/i);
    assert.match(m.hud().lines.join(''), /Go-around/); assert.equal(m.hud().done, false);
    const final = approach({ agl: 160, vy: -4 });
    // No premature recapture: climbing, below the reset height, beyond the runway,
    // invalid ILS, or not aligned on the ILS all interrupt the two-second hold.
    for (const notFinal of [{ vy: 8 }, { agl: 80 }, { thrDist: -100 }, { ilsValid: false }, { locXtk: 151 }, { gsDev: 1.6 }, { goAround: true }]) {
      m.update(1.5, final); assert.equal(m.phase, 'goaround');
      m.update(3, { ...final, ...notFinal }); assert.equal(m.phase, 'goaround');
    }
    m.update(1, final); assert.equal(m.phase, 'goaround');
    m.update(1, final); assert.equal(m.phase, 'final');
    assert.equal(m.coach().title, 'Fly the ILS', 'a hand-flown return must not claim the AP is flying');
    assert.equal(m.coach().label, kind === 'landassist' ? 'Landing 1 of 2' : 'Landing 2 of 2');
    // 60/90 m hysteresis: a small flare bounce does not count as a go-around.
    m.update(0.2, approach()); assert.equal(m.phase, 'flare');
    m.update(0.2, approach({ agl: 65, vy: 0.6 })); assert.equal(m.phase, 'flare');
    m.update(0.2, approach({ agl: 10, vy: -1 }));
    const td = m.update(0.2, approach({ agl: 0, onGround: true, thrDist: -350 }));
    assert.equal(td.event, 'touchdown'); assert.equal(m.td.sink, 1);
    const end = m.update(0.2, approach({ agl: 0, onGround: true, gs: 0 }));
    assert.equal(end.event, 'done'); assert.equal(m.phase, 'done'); assert.ok(m.hud().done);
  });
  check(`${kind} E09: commanded go-around starts immediately and discards a touch-and-go score`, () => {
    const m = createMission(kind, {}); m.update(0.2, approach());
    m.update(0.2, approach({ onGround: true, agl: 0, thrDist: -350 }));
    assert.equal(m.phase, 'rollout'); assert.ok(m.score);
    m.update(0.2, approach({ agl: 20, vy: 2, throttle: 1, goAround: true }));
    assert.equal(m.phase, 'goaround'); assert.equal(m.td, null); assert.equal(m.score, null);
    m.update(3, approach({ agl: 150, vy: -2, goAround: true })); assert.equal(m.phase, 'goaround');
    // Landing before TO/GA is canceled still produces one touchdown, not an endless reset.
    m.update(0.2, approach({ onGround: true, agl: 0, thrDist: -350, goAround: true }));
    const end = m.update(0.2, approach({ onGround: true, agl: 0, gs: 0, goAround: true }));
    assert.equal(end.event, 'done'); assert.equal(m.phase, 'done');
  });
  check(`${kind}: a rollout crash cannot show a successful landing HUD`, () => {
    const m = createMission(kind, {}); m.update(0.2, approach());
    m.update(0.2, approach({ onGround: true, agl: 0, thrDist: -350 })); assert.ok(m.score.total >= 55);
    m.update(0.2, approach({ crashed: 'ran off runway', onGround: true, gs: 0 }));
    assert.equal(m.phase, 'crashed'); assert.equal(m.hud().done, false); assert.equal(m.coach().title, 'Crashed');
  });
}

// Reach Take control through the actual predicates, not by jumping to the last index.
function reachTakeover() {
  const t = new Tutorial(), c = { ...base, started: true }; t.start(c); tick(t, c);
  for (const action of [
    () => c.orbitAz = 1, () => c.throttle = 1, () => c.iasKt = 190,
    () => { c.onGround = false; c.agl = 20; }, () => c.gearDown = false,
    () => c.altFt = 7000, () => c.throttle = 0.85, () => c.apOn = true,
    () => c.apAltFt = 8000, () => { c.apHdg = 180; c.hdg = 178; },
  ]) { action(); tick(t, c, 8); }
  assert.equal(STEPS[t.i].id, 'takeover'); assert.ok(c.apOn); return { t, c };
}
check('landing return coach only claims an assisted approach when APPR is actually active', () => {
  const m = createMission('landassist', {});
  m.update(0.2, approach({ agl: 200, apOn: true, apApproach: false }));
  assert.equal(m.coach().title, 'Fly the ILS'); assert.equal(m.coach().label, 'Landing 1 of 2');
  m.update(0.2, approach({ agl: 200, apOn: true, apApproach: true }));
  assert.equal(m.coach().title, 'Autopilot flying the ILS');
});
check('E10: post-crash AP disconnect cannot complete Take control; failure needs a restart', () => {
  const { t, c } = reachTakeover(); c.crashed = 'hard landing'; c.apOn = false; c.onGround = true;
  const v = tick(t, c, 100); assert.equal(STEPS[t.i].id, 'takeover');
  assert.equal(v.ok, false); assert.equal(v.next, false); assert.match(v.text, /Press R.*restart/);
  assert.doesNotMatch(v.title, /complete/i); assert.equal(t.passed, false);
  t.skip(); assert.equal(t.passed, false, 'skip cannot bypass a failed flight');
  c.crashed = null; assert.match(tick(t, c).title, /try again/);
  t.start(base); assert.equal(t.failed, null); assert.equal(tick(t, base).title, 'Look around');
});
check('E10: crash overrides a pending success dwell and the final success card', () => {
  for (const atFinalCard of [false, true]) {
    const { t, c } = reachTakeover(); c.apOn = false;
    tick(t, c); assert.ok(t.passed);
    if (atFinalCard) { tick(t, c, 8); assert.equal(t.i, STEPS.length); assert.equal(tick(t, c).title, 'Tutorial complete'); }
    const index = t.i, final = t.final; c.crashed = 'airframe overstressed';
    const v = tick(t, c, 100); assert.equal(t.i, index); assert.equal(v.ok, false); assert.match(v.text, /Press R/);
    assert.equal(t.final, final);
  }
});
check('E10: every objective rejects wreck state, even when its predicate becomes true', () => {
  for (let i = 0; i < STEPS.length; i++) {
    const t = new Tutorial(); t.start(base); t.i = i;
    const v = tick(t, { ...base, crashed: 'impact', apOn: false, throttle: 1, onGround: false, agl: 50, altFt: 9000 }, 100);
    assert.equal(t.i, i); assert.equal(t.passed, false); assert.equal(v.ok, false); assert.equal(v.next, false);
  }
});
check('tutorial predicates, dwell and completion timer freeze outside a live flight', () => {
  for (const inactive of [{ started: false }, { paused: true }, { pending: true }]) {
    const { t, c } = reachTakeover(); c.apOn = false;
    tick(t, { ...c, ...inactive }, 100); assert.equal(t.passed, false);
    tick(t, c); assert.ok(t.passed); const pt = t.pt;
    tick(t, { ...c, ...inactive }, 100); assert.equal(t.pt, pt); assert.equal(STEPS[t.i].id, 'takeover');
    tick(t, c, 6); assert.equal(t.i, STEPS.length); const timer = t.final;
    tick(t, { ...c, ...inactive }, 100); assert.equal(t.final, timer);
  }
});
check('E09/E10: the actual mission update forwards TO/GA and crash to the lessons', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function updateMission(dt) {'), end = main.indexOf('// ---------- airports sheet', start);
  assert.ok(start >= 0 && end > start);
  const t = new Tutorial(); t.start(base); t.i = STEPS.length - 1;
  const m = createMission('landhand', {}); m.update(0.2, approach());
  let renders = [];
  const c = { beacons: [], tutorial: t, tutorialCtx: () => ({ ...base, started: true, crashed: c.fdm.crashed }),
    state: { paused: false, pending: false, navOut: { ilsValid: true, agl: 40, gsDev: 0, locXtk: 0, thrDist: 2000 } },
    mission: m, missionAcc: -100, aircraftLatLon: () => ({ lat: 0, lon: 0 }), attitude: () => ({ heading: 0, pitch: 0 }),
    fdm: { quat: {}, out: {}, pos: { y: 40 }, vel: { y: 2, length: () => 90 }, onGround: false, throttle: 1, mass: 45000, gearDown: true, crashed: null },
    ap: { on: true, ga: true, modes: { appr: false } }, KT: 1.943844, ias: () => 90, vrefEas: () => 90,
    toast() {}, audio: { play() {} }, renderCoach: (v) => renders.push(v) };
  vm.runInNewContext(main.slice(start, end), c); c.updateMission(0.2);
  assert.equal(m.phase, 'goaround', 'real update must forward AP TO/GA below the flare-reset height');
  c.fdm.crashed = 'impact'; c.ap.on = false; c.mission = null; renders = [];
  for (let i = 0; i < 100; i++) c.updateMission(0.2);
  assert.equal(t.i, STEPS.length - 1); assert.ok(renders.every(v => v && !v.ok && /restart/.test(v.text)));
});
if (fails) { console.log(`\n${fails} failed`); process.exit(1); } else console.log('\nall tutorial and landing tests passed');
