// Dirty-flag logic: the HUD/rain redraw scheduler and the panel change gate.
import assert from 'node:assert/strict';
import { Redraw, ChangeGate, stateSig, stat } from '../src/workstats.js';

const ok = (name, c, info = '') => { assert.ok(c, `${name} ${info}`); console.log(`PASS  ${name} ${info}`); };

// Redraw: capped rate while active, one clear after it goes inactive, then nothing at all
{
  const r = new Redraw('t', 30); let draws = 0, clears = 0, skips = 0;
  for (let ms = 0; ms < 1000; ms += 1000 / 120) { const a = r.next(ms, true); if (a === 'draw') draws++; else if (a === 'clear') clears++; else skips++; }
  ok('redraw: 120 Hz frames are drawn at about 30 Hz', draws >= 29 && draws <= 31, `${draws} draws`);
  const after = []; for (let ms = 1000; ms < 1100; ms += 8) after.push(r.next(ms, false));
  ok('redraw: inactive clears the layer exactly once, then skips', after[0] === 'clear' && after.slice(1).every((a) => a === 'skip') && clears === 0, after.join(','));
  ok('redraw: active again draws immediately', r.next(2000, true) === 'draw');
}
{
  const r = new Redraw('hidden', 30); let n = 0;
  for (let i = 0; i < 100; i++) if (r.next(i * 16, false) !== 'skip') n++;
  ok('redraw: a layer that never showed anything does no work', n === 0);
}
// ChangeGate: draw while changing and while the needles settle, then skip until something changes
{
  const g = new ChangeGate('p', 4); const st = { alt: 1000.123, rpm: [90, 90], warn: { stall: false }, flightTime: 10.2 };
  const seq = []; for (let i = 0; i < 8; i++) seq.push(g.should(st));
  ok('gate: first state draws, settles after 4 draws, then skips', seq.join() === 'true,true,true,true,false,false,false,false', seq.join());
  st.flightTime = 10.9; ok('gate: sub-second flight timer jitter does not count as a change', g.should(st) === false);
  st.flightTime = 11.1; ok('gate: a whole second does', g.should(st) === true);
  g.should(st); g.should(st); g.should(st); g.should(st);
  st.alt = 1000.124; ok('gate: change below display precision (4 digits) is ignored', g.should(st) === false);
  st.alt = 1002; ok('gate: a real change draws again', g.should(st) === true);
  st.warn.stall = true; g.should(st); g.should(st); g.should(st); g.should(st); st.warn.stall = false; ok('gate: nested flag flips are seen', g.should(st) === true);
}
ok('stats count work and skips', stat.snapshot().some(([n, d, s]) => n === 'p' && d > 0 && s > 0));
console.log('all workstats tests passed');
