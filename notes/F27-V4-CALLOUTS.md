# F27 V4 callouts: source evidence and integration

## What the sources actually establish

Reviewed all three supplied 65-page BGT v2.3 manuals: `f27500it-bgt_v23_doc_en.pdf` (French-labelled cockpit), **`f27500it-bgt_v23_doc_en2.pdf` (English-labelled cockpit)**, and French `f27500it-bgt_v23_doc_fr.pdf`; also the complete aircraft `sound/sound.xml`, relevant interior model XML, and recovered bank event/cue inventory. Page numbers below are printed manual pages, not excerpt line numbers. Hashes, exact relevant PDF page text and XML event inventory are in `notes/f27-v4-callout-evidence.json`.

| Evidence | Documented behavior | What it is NOT |
| --- | --- | --- |
| Both English manuals p43; French p43 | Radio-altimeter manually ON; works to 5,000 ft; switches OFF above that and must be manually switched on again after descent. Amber lamp below **selected** DH bug. | A fixed 200-ft minimum; an automatic voice minimums package. |
| Both English p47; French p47 | V1/V2 bugs are weight-dependent reminders; VR lies between. Overspeed at **227 KIAS** sounds a klaxon. Yellow barometric altitude-warning lamp is inoperative. | A universal V1/VR pair; a spoken overspeed phrase. |
| Both English p49 | TAPIR AP annunciators show LOC/GS coupling, excessive deviations, AP disconnect and trim failure. AP disconnect has a red annunciator, CANCEL/SUPPR acknowledgement. | Evidence for an Airbus/modern GPWS voice. |
| Both English p51 | On ILS approach **900 ft RA** triggers **TEST AMV** annunciator/test; **below 200 ft RA** AD200 rising runway indicates remaining height. RA must be ON. AP disengagement around 1,500 ft and final manual approach are described. | A 900-ft DH voice or universal minimums setting; a 200-ft voice threshold. |
| Both English p52 | Diagram's extraction juxtaposes "900 ft: DECISION HEIGHT" and "(100 ft): runway in sight or go around". Prose p43/p51 and the adjustable bug make that layout unsafe as a universal DH source. | Justification for hardcoding either 900 or 100 ft as every approach minimum. |
| Both English p56 and following tables | Takeoff speeds vary with mass/configuration; V1 decision speed, VR rotation, V2 performance target; gear up at positive climb. | Proof of a universal spoken V2, 80-knots or 'positive rate' SOP. |
| All manuals/sound XML | Fire bell, stall warning, continuous horn, AP sound have explicit sound bindings. No height/minimums/V1/rotate/RETARD voice binding identified. | Proof that unidentified numeric bank recordings are speech. |

Public operations sources independently checked:

- [FAA AC 120-71B](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_120-71B.pdf), §1.1 and §§6.6.1–6.6.2.1, printed pp1-1,6-3: advisory guidance, not a regulation; operators must define callout wording, timing and intervention criteria. **It does not establish an F27/Air Inter voice schedule.** Download and extracted text saved in `f27-integration/research/f27-v4-callouts/`.
- [14 CFR 97.3](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-97/subpart-A/section-97.3): RA means radio-altimeter setting height; HAT means height above touchdown. Barometric DA and terrain radio height must not be conflated.
- Search service was unavailable (provider HTTP 402), and SKYbrary returned a bot challenge; neither is counted as verified source evidence. Direct FAA/eCFR sources succeeded.

## Real sound-bank findings

FNV-1 lowercase event namespace `play_bgt_f27500v2_` matched these source declarations against extracted bank events:

| XML event | Bank event ID | Original media ID | Use/evidence limit |
| --- | --- | --- | --- |
| `stall_warning` | 3378484594 | 463686891 | Identified stall-warning media; not spoken 'Stall'. |
| `HornCont` | 124318328 | 922392798 | Identified WASM-controlled horn. Exact operational predicate is opaque; do NOT assume this is the XML overspeed event. |
| `FireRing` | 2757188285 | 616154136 | Fire bell. |
| `SwAPSnd` | 523786983 | 497346625 | AP sound; not an identified spoken phrase. |
| `OVERSPEED_WARNING_SOUND` | hash 3589142331 | **No verified bank match** | Manual still documents the 227-KIAS klaxon; no media invented. |

No new bank audio was added or relabelled as speech. Existing browser height MP3s are generated assistance assets (`tools/make-callouts.py`, Kokoro `am_michael`), **not original Fokker audio**. Existing generic optional warning voices are unchanged and must not be advertised as original F27 equipment.

## Implemented

`src/f27callouts.js` provides:

- `F27Callouts`: separate F27 scheduler; descending wheel-AGL crossings only; one spoken call per threshold; lowest relevant call if one frame crosses several. No stale queue. No RETARD, Five, climb/level/taxi/rollout/bounce calls.
- Existing **generic browser pilot assistance** speaks 100,50,40,30,20,10 ft using existing clips. This is an explicit simulator adaptation, **not a documented F27/Air Inter SOP**. The 150-ft arming/go-around gate, 60-fpm go-around detector, jump suppression and 2-second/30-kt ground reset are software guards, not aircraft limits.
- Selected radio DH and barometric DA support, on descending crossings; DA uses `baroAltFt` (MSL), never AGL. No minimum is invented. Changing the setting below the aircraft does not create a call.
- Optional V1/Rotate events require `takeoffActive:true`, ground acceleration, and identical explicit `{v1,vr,v2,verified:true,source}` briefing data on adjacent frames. Nothing derives V1 from `F27.VR`. V2 has no automatic spoken event. Missing/changed/unverified values stay silent.
- **No minimums/V1/Rotate recordings exist in the current asset set.** Those optional events are dropped unless a caller deliberately supplies corresponding decoded `calloutClips` buffers. They are not claimed as delivered spoken features. The present live integration should leave minimums and V-speeds unspecified until actual user briefing/control/performance data and suitable generic recordings are provided.
- Pause breaks continuity; slew/crash/reset/teleport clear flight tracking. Mute, zero volume and higher-priority warnings consume/drop routine events instead of replaying them later.
- `F27RadioAltimeter` models manual ON and auto-OFF above 5,000 ft. `f27Annunciators` exposes documented thresholds for an eventual instrument integration; these helpers are tested but **not wired to cockpit switch meshes** by this change.

`src/audio.js` now selects the dedicated scheduler when the existing F27 `configure({turboprop:true})` runs. Only six retained height clips load for F27. Sources connect to the existing `voiceGain -> master` AudioContext path: no OS speech, independent volume, or mute bypass. Off/pause/slew stop a currently playing callout. Other aircraft keep `AltCallouts` and their current behavior.

## Exact parent wiring handoff (main.js intentionally untouched)

The existing F27 configure call already activates the new scheduler. **One additional F27-only input is required to suppress slew crossings**: in the `audio.update({...})` object, add `slew: IS_F27 && state.slew,` (or pass it inside `callout`). Preserve other aircraft data. The existing audio callout fields already supply wheel AGL/VS/ground/crash and the spawn path already calls `audio.resetForSpawn()`.

Recommended callout-object extension, only for F27 (do not fabricate a DH or takeoff briefing):

```js
callout: {
  aglFt: (fdm.pos.y - state.lastGround - CG_H) * FT,
  vsFpm: fdm.vel.y * FT * 60,
  onGround: fdm.onGround, throttle: fdm.throttle, crashed: fdm.crashed,
  ...(IS_F27 ? { slew: state.slew, iasKt: casMs() * KT } : {}),
},
```

No main import is required just for the scheduler. Add the test command `node test/f27-callouts-test.mjs` to the parent's test registration. This worker did not edit `main.js`, `src/f27.js` or `test/scripts.json` and did not build or deploy.

If/when actual RA ON/OFF controls are implemented, instantiate/reset `F27RadioAltimeter` with the flight, update it using the real switch command, and pass its result as `callout.radioAltValid`; use the same validity for cockpit instruments. Until then, absent validity means **assumed available browser assistance**, not a claim that the original manual-switch RA system is reproduced. Do not wire an invented always-true 'real' switch.

## Verification

`node test/f27-callouts-test.mjs`: 26 scenario groups cover descending equality/direction, skip/priority, missing clips, low spawns, bounce, go-around, pause, slew, crash, teleport, resets, invalid numbers, RA/power validity, correct DA/DH basis, briefing-gated V1/Rotate, aborted-roll reset, 5,000-ft/manual RA rearm, annunciator thresholds, retained assets, and real `Audio` methods/routing/mute. Existing `f27-audio-test.mjs`, `callouts-test.mjs` and `voicewarn-test.mjs` passed. Further verification results are recorded in `notes/f27-v4-callouts-tests.log`.

Additional out-of-scope instrument discrepancy for the parent: `src/f27instruments.js` currently makes the RA OFF flag depend on `radioAltFt <= 2500`. The manuals specify operation to 5,000 ft. Needle scale/end-stop limits and receiver operating validity are distinct; do not simply turn a 2,500-ft dial end stop into an instrument power-off threshold. This worker did not alter that module.

No claim of exact-aircraft certification, complete Air Inter SOP, original speech, or already-wired interactive RA/DH controls is made.
