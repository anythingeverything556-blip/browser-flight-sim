// Voice warnings: priority, repeat cadence, interruption, flicker reset, and that every clip ships.
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { VOICE_KEYS, VOICE_REPEAT, VOICE_STYLES, VoiceScheduler, voiceStyle, voiceUrl } from '../src/voicewarn.js';

const dur = () => 1.0;
const s = new VoiceScheduler();

// nothing active: silent
assert.equal(s.step({}, 0, dur), null);

// pull up speaks at once and repeats after the clip plus its gap
assert.deepEqual(s.step({ pullUp: true }, 0, dur), { key: 'pullUp', interrupt: false });
assert.equal(s.step({ pullUp: true }, 0.5, dur), null, 'no overlap while speaking');
assert.ok(s.speaking(0.5));
assert.equal(s.step({ pullUp: true }, 1.0 + VOICE_REPEAT.pullUp - 0.01, dur), null, 'waits for the gap');
assert.equal(s.step({ pullUp: true }, 1.0 + VOICE_REPEAT.pullUp + 0.01, dur).key, 'pullUp', 'repeats while active');

// a higher-priority warning interrupts a lower one mid-phrase
const q = new VoiceScheduler();
assert.equal(q.step({ lowFuel: true }, 10, dur).key, 'lowFuel');
assert.deepEqual(q.step({ lowFuel: true, pullUp: true }, 10.3, dur), { key: 'pullUp', interrupt: true });
// ...but a lower one never interrupts a higher one
assert.equal(q.step({ pullUp: true, stall: true }, 10.6, dur), null);
// with both active the higher one keeps the floor
assert.equal(q.step({ pullUp: true, stall: true }, 11.7, dur).key, 'pullUp');

// low fuel speaks once, then not again for 30 s while it stays active
const f = new VoiceScheduler();
assert.equal(f.step({ lowFuel: true }, 0, dur).key, 'lowFuel');
assert.equal(f.step({ lowFuel: true }, 5, dur), null);
assert.equal(f.step({ lowFuel: true }, 1 + VOICE_REPEAT.lowFuel + 0.1, dur).key, 'lowFuel');

// a flickering stall (buffet) does not restart the call-out on every flicker, but a real re-trigger does
const b = new VoiceScheduler();
assert.equal(b.step({ stall: true }, 0, dur).key, 'stall');
b.step({}, 1.2, dur); // clears briefly
assert.equal(b.step({ stall: true }, 1.4, dur), null, 'brief flicker waits out the repeat gap');
b.step({}, 2.0, dur); b.step({}, 3.6, dur); // clear for > 1.5 s
assert.equal(b.step({ stall: true }, 3.7, dur).key, 'stall', 'fresh warning speaks immediately');

// clips that have not loaded yet are skipped instead of blocking lower priorities
const l = new VoiceScheduler();
assert.equal(l.step({ pullUp: true, stall: true }, 0, (k) => (k === 'pullUp' ? 0 : 1)).key, 'stall');

// reset (spawn, crash, voice off) forgets everything
l.reset(); assert.equal(l.playing, null);

// styles and URLs; unknown styles fall back to the default
assert.equal(voiceStyle('rita'), 'rita');
assert.equal(voiceStyle('nope'), 'betty');
assert.equal(voiceUrl('/sim/', 'gpws', 'pullUp'), '/sim/audio/voice/gpws/pullUp.mp3');

// every style ships every clip
for (const style of Object.keys(VOICE_STYLES)) for (const key of VOICE_KEYS) {
  const file = new URL(`../public/audio/voice/${style}/${key}.mp3`, import.meta.url);
  assert.ok(existsSync(file), `missing ${style}/${key}.mp3`);
  assert.ok(statSync(file).size > 2000, `${style}/${key}.mp3 is too small`);
}
console.log('voicewarn-test: ok');
