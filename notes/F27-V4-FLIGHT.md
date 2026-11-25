# F27 v4 — manual-grounded flight-model corrections

**Implemented, standalone verified, not deployed.** This is a conservative improvement to the independent browser FDM, not an exact F27 replica or an approved training/performance model. No new aerodynamic coefficients have been invented to claim a closer match.

## Changed files and integration boundary

- `src/f27.js`: fuel cutoff when feather is selected, a public `setFeather(index, state = true)` API, configuration-aware `vref(flaps = this.flaps)`, and throttle-position-based gear-warning output.
- `test/helpers/f27-fdm.mjs`: reusable standalone rigid-body fixture with optional loading of a saved pre-change FDM.
- `test/f27-manual-flight-test.mjs`: actual integrator approach and asymmetric-force checks, engine state and warning checks, before/after measurement mode.
- This note.

No changes to main.js, visual/audio/callout code, other aircraft, existing regression files, test registration, dependencies, build output, deployment or packaging. The new test is **not registered** in the central runner: parent integration owns that decision. The work is saved in the owner source tree. That supplied tree has no usable .git metadata in this environment; no commit is claimed.

### API changes to be aware of

- `vref()` now uses the **actual current flap angle** and mass rather than always assuming 40°. It returns KIAS-equivalent reference speed from this FDM's estimated static stall model, not certified landing speeds. `vref(40)` retains an explicit full-flap planning reference before flap selection. It does not move flaps or change pilot inputs.
- `setFeather(0)` / `setFeather(1)` represent a simplified **completed HP FEATHER selection**: fuel is cut immediately, the existing feathered drag estimate is used, and the geared rotor runs down continuously. Invalid indices return false. Existing direct `engine.feather` assignments also cut fuel at the next engine update.
- Unfeathering does not override global cutoff, engine failure or empty fuel. If those permit running, the existing simplified restart ramp is reused; full ignition/pump/HP-lever procedures and blade-angle transit are not modeled.
- No existing UI calls `vref()` or selects feather in the inspected source. Thus the configuration-reference correction is currently an FDM/API improvement, not a claim of a changed on-screen approach target or a new clickable cockpit control. The fuel/thrust correction applies whenever feather state is set. Gear warning changes the existing output flag only; audio/callout integration is outside this task.

## Sources actually reviewed

### All three bundled manuals — add-on documentation, not an approved AFM

Read **all 65 pages of each PDF**, in bounded PDF-tool selections 1–20, 21–40, 41–60 and 61–65; cross-checked extracted English text for critical pages. Source directory:

`fokker-f27-inspection/bgt-f27500-v2/Documentation/`

1. `f27500it-bgt_v23_doc_en.pdf`: English documentation / French-label Air Inter cockpit.
2. `f27500it-bgt_v23_doc_en2.pdf`: English documentation / English-label cockpit.
3. `f27500it-bgt_v23_doc_fr.pdf`: French documentation / French-label Air Inter cockpit.

B. Gaurant, **v2.3, May 2026** (takeoff tables pp. 59–60 carry February 2025 dates). These are three language/cockpit variants of substantially the same reference, **not three independent flight-test sources**. They attribute operational material to Air Inter and credit a former F27 ground instructor, but include no applicable approved AFM revision or identified aircraft serial/modification state. Page 65 explicitly excludes real-world aviation use.

Relevant printed pages in all three:

| Pages | Evidence and use |
| --- | --- |
| 19–20 | Conventional controls; electrically powered flap detents **0 / 11.5 / 16.5 / 26.5 / 40°**. Existing detents retained. |
| 23 | Four-bladed variable/constant-speed propeller discussion; **0 / 18 / 20 / 32 / 87°** ground-fine/safety/feather pitch descriptions. These are **propeller** angles, not flap angles. Ground-fine selection is automatic in the add-on but described as aft-of-idle in reality; flight-fine locks around **14,000 engine RPM**. Not implemented as a new drag model without force data. |
| 24–25 | Feather limits windmilling drag; HP CLOSED/FEATHER **cut fuel**. This directly justifies the feather-fuel correction. Autofeather is conditional on torque below **50 psi**, selected lever beyond **11,500 RPM**, appropriate HP position and other propeller not already feathered. No automatic feather invented. |
| 25–28 | Engine RPM **7,000 idle / 15,000 takeoff / 14,200 climb-cruise / 11,000 descent / 12,000 or 12,600 holding**. **12,600–14,000** vibration-range avoidance. Fuel trim changes torque/flow at selected RPM; water/methanol assists takeoff/go-around. Existing dry-power model retained. |
| 31–32 | Pneumatic gear/brakes/steering, recharge above **10,000 RPM** to **2,800 psi**. Gear horn with flaps **26.5° or more** and gear not down, or either throttle below the **10,500-RPM lever position**. Use commanded lever position, not spooling actual RPM. |
| 33–34 | **2 × 2,535 L** tanks and pressurization context; not enough to validate full fuel/cabin systems. |
| 47, 56 | Landing references associated with **26.5° or 40°**; **VREF = 1.3 VS**, mass-dependent; French specifies stall speed for a configuration. A universal 40° reference understates the modeled 26.5° reference. No numerical landing Vref-vs-mass table is supplied here. |
| 51–52, 58 | Different precision/general approach prescriptions; 26.5° final, or full 40° final in another diagram. Do not merge these into one claimed exact procedure. |
| 56–60 | **138 KIAS** climb, **14,200 RPM**, about **240 KTAS** cruise; takeoff tables are **with water/methanol**, not our dry-power takeoff prediction. Table cells interleave in text extraction; no exact V1/VR/V2 reconstruction is claimed. |
| 61–65 | Fuel calculator includes reserves but excludes wind; **1,210 nm** is its distance-input limit, not verified usable range. Installation, credits and private/freeware legal restrictions reviewed; no assets redistributed here. |

### Source inconsistencies explicitly retained as uncertainties

- p. 32 says retract the gear to silence a gear-not-down flap warning. That is a shared textual error; it is not implemented literally.
- p. 47 gives bugs at VRF and VRF+20; p. 52 says Vref+25. p. 51 prescribes 26.5° / VRF+15; p. 58 gives wind-corrected final VRF and initial VRF+20. No automatic speed schedule is imposed.
- p. 58's diagram includes **IAS <177 kt**, while cfg flap damage/limit data says **145 kt** (and another reference field says 144). There is insufficient approved per-detent evidence to raise VFE. **145 remains a documented add-on-derived warning assumption**, not a real-aircraft certification assertion.
- p. 27's illustrated 20°C/sea-level fuel trim is about **92%** in the English-cockpit PDF, **93%** in the other two. No calibration was based on that discrepant example.
- p. 57's cruise/holding/descent fuel figures do not clearly identify engine versus aircraft totals. The model still reports **pair flow** and cfg BSFC; it is not tuned to a possibly per-engine number.
- English p. 58 says flaps up on touching ground; French is more specific, nosewheel on ground. No automatic flap retraction was added.

### Supplied configuration files — simulation inputs

Reviewed `aircraft.cfg`, `flight_model.cfg`, `engines.cfg`, `systems.cfg` under `SimObjects/Airplanes/Bgt_F27500v2/`, and existing `notes/F27-VALIDATION.md` and `notes/F27-PERFORMANCE.md`.

- Geometry **754 ft² / 95.15 ft**, empty mass **28,990 lb**, existing inertias/contact approximations retained.
- Existing whole-aircraft CLmax calibration to cfg **91/74 kt** at assumed standard MTOW retained. The reference-weight association and conversion of those source reference fields into a sea-level IAS calibration remain estimates; source comments call them KTAS.
- Flap **15 s**, gear approximately **17 s up / 7 s down**, flap/gear drag increments and detents already matched the selected cfg interpretation; no evidence-backed change needed.
- Props: **11.5 ft**, **4 blades**, feather **87°**. Cfg inverse gearbox **10.753**, no native autofeather, reverse/ground-beta entries that do not exactly match the manual's simplified pitch-stop discussion. These are not a directly portable governor/blade model.
- Cfg **2,070 shp** and **525 lbf** differ from the selected certified dry Dart rating. Existing primary-source dry power retained.
- Cfg BSFC **0.735 lb/(shp h)** retained. Systems pneumatic maximum **2,800 psi**, zero hydraulic-pressure system. Electrical/flap/feather circuits describe the add-on implementation, not a full browser systems simulation.

### Freely accessible primary real-aircraft source

[EASA TCDS A.036, Issue 08, 17 October 2022](https://www.easa.europa.eu/en/downloads/7452/en). Re-fetched directly from EASA and verified SHA-256 matches the retained research PDF:

`a7f3fcc44a1b6fc6acb2179cd1d16c48e0eab2b400b80b2056efe8e34a4b297a`

Read relevant PDF pages **8, 10–11**:

- p. 8: standard Mk500 **19,730 kg takeoff / 18,600 kg landing / 17,460 kg zero fuel, oil and water/methanol**, gearbox **0.093:1**. Higher optional modification weights not enabled.
- p. 11: Dart 532-7 dry **1,835 shp + 479 lbf residual jet thrust per engine**, wet **1,990 shp + 514 lbf**, both **15,000 engine RPM**. Five-minute takeoff ratings. At the stated gearing, calculated prop RPM is **1,395**, not 15,000.
- p. 10 delegates actual speed limitations to the **approved AFM for the applicable serial number**. This is not independent verification of our VFE, stall/reference speeds, approach handling, runway performance or exact propeller governor behavior.
- Manual TGT operating advice and type-certificate temperature/rating data are not interchangeable. No thermal-limit or fuel-trim system is claimed in this update.

## Measurement-driven changes

Baseline was copied before editing and executed through the **same F27 rigid-body model and same scenario code**. No screenshot-based or surrogate equations were used to claim flight performance.

### Deficiency 1 — feather could still be a powered engine

At 1,500 m ISA, **14,200 engine RPM**, engine 0 feather state selected while otherwise healthy, sampled engine forces at **80 m/s forward airspeed**:

| Measurement | Before | After |
| --- | ---: | ---: |
| Fuel flow, selected engine | 0.123338 kg/s | **0** |
| Shaft power | 993,143 W | **0** |
| Powered prop torque | 7,181 Nm | **0** |
| Net selected-engine thrust | +11,460 N | **−1,016 N** (existing estimated feather drag) |
| RPM immediately at selection | 14,200 | **14,200** |
| RPM after 5 s | 14,200 | **2,976.48** |
| Other engine shaft power | 993,143 W | **993,143 W** |

The corrected state now actually removes power and creates asymmetric forces rather than merely labeling a powered propeller as feathered. In a separate real `step()` 160-KIAS fixture, initial yaw rate changed from **0** to **+0.0004481 rad/s** toward the selected left engine; after five seconds with only the deterministic wings-level pilot the left/right thrusts were **−1,217 / +10,730 N**, selected-engine fuel remained zero, and state stayed finite at **158.27 KIAS**. This verifies force direction and continuity, **not real F27 VMC/single-engine performance**.

### Deficiency 2 — 26.5° landing reference silently assumed 40°

Derived using this FDM's static stall model and the manual's 1.3 factor:

| Mass | Flaps | Before vref() | After vref() |
| --- | ---: | ---: | ---: |
| 15,000 kg | 26.5° | 83.90 KIAS | **88.11 KIAS** |
| 15,000 kg | 40° | 83.90 KIAS | **83.90 KIAS** |
| 18,600 kg | 26.5° | 93.43 KIAS | **98.12 KIAS** |
| 18,600 kg | 40° | 93.43 KIAS | **93.43 KIAS** |

This corrects a **4.2–4.7 kt configuration error inside the model**. It is not an assertion that the calculated numbers are an approved real-aircraft Vref schedule.

For each row, flew the actual integrator for **60 seconds**, starting at **1,200 m ISA**, corresponding 1.3-Vs IAS, gear down, selected flap fixed, -3° trim solution, no fuel mass change, zero wind/flat ground. The deterministic pilot held wings level only: **no pitch, altitude or speed hold**.

| Mass / flaps | Final KIAS | Height change | Stall output |
| --- | ---: | ---: | ---: |
| 15 t / 26.5° | 88.11 | −146.53 m | 0 |
| 15 t / 40° | 84.14 | −141.97 m | 0 |
| 18.6 t / 26.5° | 98.22 | −162.73 m | 0 |
| 18.6 t / 40° | 93.65 | −157.34 m | 0 |

These trajectories were **identical before and after**, because the reference API did not feed forces or controls. The stable configuration-specific approaches supported retaining the existing lift/drag coefficients instead of speculative retuning.

### Deficiency 3 — gear warning followed spool lag rather than lever position

Airborne, clean, gear up, sampled after one 1/120-second step:

| Action | Actual RPM | Before horn flag | After horn flag |
| --- | ---: | --- | --- |
| Retard lever from 14,200-RPM setting to idle | 14,162.60 | false | **true** |
| Advance lever from idle to 14,200-RPM setting | 7,015 | true | **false** |
| Left lever only selected below threshold (leverTrim offset) | Still initially near high RPM | false | **true** |

Fully down gear suppresses the output. Existing flap-position warning remains. No silence/rearm switch model or sound changes were added.

## Existing envelope/regression checks retained

These scripts were run against the pre-change model and corrected model and passed:

```sh
node test/f27-fdm-test.mjs
node test/f27-spool-test.mjs
node test/f27-ground-prop-test.mjs
```

Measured unchanged:

- MTOW static model stalls **90.95 KIAS clean / 82.56 KIAS at 16.5° / 74.02 KIAS at 40°**.
- Developed default-mass power-off stall/recovery: **86.4 KIAS / 0.82 g** clean, **69.5 KIAS / 0.84 g** full flap; recovered by unloading and power. These developed post-peak events are **not** a 1-g MTOW stall-speed measurement.
- Dry-power default-mass takeoff fixture: **755 m roll / 100.0 KIAS liftoff**, 165 m height after 60 s. Not certified field length.
- 4,000 m five-minute cruise: **240 KTAS, 196 KIAS, 14,169 engine RPM**, 745 kg/h pair, +5.4 m height change. Fuel discrepancy remains unvalidated.
- Manual-style 14,200-RPM / 138-KIAS climb fixture: **1,148 ft/min**, 137.4 KIAS.
- **v3.1 shutdown preserved:** 7,000-RPM cutoff leaves rotation continuous; **5,121.31 RPM at 1 s, 1,467.28 at 5 s**, estimated 3.2 s rundown time constant. Combustion/flow/power stop immediately; prop RPM remains engine RPM ×0.093. Frame-step independence, restart, fuel-empty windmill and failure isolation pass.
- Existing contact/visual-frame integration test passed; this task did not perform new rendered visual QA.

New standalone regression:

```sh
node test/f27-manual-flight-test.mjs
```

Optional diagnostic comparison, after saving the old module before applying this change:

```sh
F27_FDM_BASELINE=/path/to/saved-f27.js node test/f27-manual-flight-test.mjs --measure
```

The helper resolves that saved module's existing imports to the source tree and executes its original model; `--measure` reports the new contract failures without asserting the corrected contract. This mode is not an alternative FDM.

## Remaining unsupported / unvalidated areas

- No serial-specific approved AFM, raw stability derivatives, flight-test traces or measured handling-force data. This update cannot establish an exact replica, certified envelope or pilot-training fidelity.
- CLmax, flap intermediate lift/drag/moment and post-stall behavior, lift slope, elevator/aileron/rudder gearing, pitch/roll/yaw damping, torque reaction, propwash and CG/inertia remain estimates. No calibrated wing-drop/spin behavior or accelerated-stall test claimed.
- Ground fine/flight fine/safety-stop/governor blade aerodynamics, prop inertia and beta response, automatic feather logic, pump timing, realistic relight, fuel trim independent of RPM, hot/high temperature management and wet power are not implemented.
- Feather/windmill drag magnitudes remain the old estimates. Verified fuel cutoff and yaw direction do not verify engine-out climb, VMC, glide or feathering duration.
- Pressure reservoirs are simplified; detailed brake/steering demand, emergency extension, electrical flap/feather-power availability, leaks and systems failures remain unsupported.
- Stall/approach IAS here is density-equivalent, without a full calibrated airspeed instrument/compressibility/position-error model.
- Per-detent real speed limits and runway length versus mass, wind, slope, wet power, temperature/elevation remain unvalidated. Existing 145/220-KIAS warning values are add-on assumptions.
- No browser deployment, integration of the reference/feather API into controls, live-site checks, full-suite registration, packaging or claims that all user-facing flight assistance uses the F27-specific references. Those remain parent integration responsibilities.
