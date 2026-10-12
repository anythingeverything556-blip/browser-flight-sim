import assert from 'node:assert/strict';
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
  c.throttle = 0.85; tick(t, c, 8); assert.equal(STEPS[t.i].id, 'ap');
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
check('skip step moves on', () => {
  const t = new Tutorial(); t.start(base); tick(t, base); t.skip(); tick(t, base, 8); assert.equal(t.i, 1);
});

const td = (o) => ({ sink: 1, kt: 155, off: 2, dist: 400, belly: false, ...o });
check('landing score: a smooth landing is an A, a hard one is not', () => {
  assert.equal(scoreLanding(td()).total, 100); assert.equal(scoreLanding(td()).grade, 'A');
  const hard = scoreLanding(td({ sink: 4, kt: 190, off: 20, dist: 2500 }));
  assert.ok(hard.total < 35 && hard.tips.length >= 3, `hard=${hard.total}`);
  assert.equal(scoreLanding(td({ belly: true })).total, 0);
});
check('landing mission: final, flare, touchdown, rollout, score', () => {
  const m = createMission('landhand', {}), s = { agl: 300, vy: -4, onGround: false, iasKt: 180, gs: 92, throttle: 0.3, crashed: null, gearDown: true, chute: 0, ilsValid: true, gsDev: 0, locXtk: 1, thrDist: 2000 };
  m.update(0.2, s); assert.equal(m.phase, 'final'); assert.match(m.coach().title, /ILS/);
  s.agl = 40; m.update(0.2, s); assert.equal(m.phase, 'flare');
  s.agl = 20; s.vy = -4; m.update(0.2, s); assert.match(m.coach().hint, /Pull back/);
  s.vy = -1.4; m.update(0.2, s);
  s.agl = 2; s.onGround = true; s.thrDist = -350; s.iasKt = 158; const ev = m.update(0.2, s);
  assert.equal(ev.event, 'touchdown'); assert.equal(m.phase, 'rollout'); assert.ok(m.score.total >= 85, 'score ' + m.score.total);
  s.gs = 2; const end = m.update(0.2, s); assert.equal(end.event, 'done'); assert.match(m.coach().title, /Score/);
});
check('landing mission: a crash ends it with advice', () => {
  const m = createMission('landassist', {}); m.update(0.2, { agl: 100, vy: -3, onGround: false, iasKt: 180, gs: 90, throttle: 0.3, crashed: null, gearDown: true });
  const ev = m.update(0.2, { agl: 0, vy: -9, onGround: true, iasKt: 180, gs: 90, throttle: 0.3, crashed: 'hard landing', gearDown: true });
  assert.equal(ev.event, 'done'); assert.equal(m.coach().title, 'Crashed');
});
if (fails) { console.log(`\n${fails} failed`); process.exit(1); } else console.log('\nall tutorial and landing tests passed');
