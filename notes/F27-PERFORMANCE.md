# Fokker F27-500 — browser flight-model engineering note

**Status:** implemented and deterministic tests passing; engineering/game approximation, not a certified F27 simulator, an MSFS flight-model port, or validated flight-test data. No live deployment performed by the flight-dynamics task. The supplied Blackbird owner source is the base; the requester verified the two game ZIPs' 100 overlapping files were byte-identical before changes.

## Integration contract

`src/f27.js` exports `F27Model` (also `F27FlightModel`), `F27`, `F27_CG`, `F27_GEAR`, `F27_HARD`, `F27_FLAP_DEG`, `stallAlpha(flapsDegrees)`, `f27Lift(alphaRadians, flapsDegrees)`, and `stallSpeed(massKg, flapsDegrees, density)` (m/s).

- Standard `FlightModel` position/velocity/quaternion, `ctrl`, `surf`, throttle, trim, fuel, `out`, reset and step interfaces are retained. The independent class extends the common `FlightModel` infrastructure, **not** C172, DA40 or IL76 physics. The established DA40 rigid-body/tyre integrator is reused with F27-specific geometry, mass/inertia, forces, derivatives, engines and configuration logic.
- `F27` includes `FUEL_MAX`, `FUEL_START`, `MTOW`/`MTOM`, `MLW`, `MZFW`, `VMO`, `MMO`, `VFE`, `VLE`, `VLO`, load limits, dimensions and engine ratings. Public reference speeds are knots indicated; internal dynamics use SI. Reset's speed argument, like the other aircraft, is **true m/s**.
- `setFlaps(index)` selects one of `[0, 11.5, 16.5, 26.5, 40]` degrees. The pilot selects the detent; extension takes 15 seconds end to end. This does not imply hand-powered actuators. `setGear(down)` returns `false` for ground retraction or insufficient pneumatic pressure; gear travel is 17 seconds up / 7 seconds down. `setTailGear()` returns false: this is a retractable tricycle aircraft.
- Two independent engine objects, `setEngineRunning(bool)`, `failEngine(index, bool)`, a generic `magnetos` stop alias, per-engine `leverTrim` offsets and optional `engine.feather` state are provided. There are no actual Dart magnetos. Parked idle shutdown gives an immediate cold-and-dark state; airborne shutdowns spool down/windmill. Restart uses a simplified RPM ramp and combustion threshold, not a procedural starter sequence.
- **Engine versus propeller RPM:** `model.rpm` / `engine.rpm` / `out.rpm` are gas-turbine instrument RPM (7,000 idle to 15,000 takeoff). **Visual/audio propeller rotation should use `engine.propRpm` or `model.propRpm` / `out.propRpm`: 651 idle to 1,395 max.** They differ by the 0.093 gearbox ratio. A visual reading `engine.rpm` directly will rotate at engine speed, not propeller speed.
- `out` includes mass-dependent lift/drag/stall, fuel flow in kg/s for the pair, `flapOverspeed`, `gearOverspeed`, `gearWarning`, pneumatic pressure and engine readouts. Gear horn is an output flag; sound/UI belong to integration. Surface controls remain pilot-selected: no F27 autoland or automatic flap scheduling.
- App body axes: +X nose, +Y up, +Z right. `F27_CG = (0.707136, 2.29, 0)` metres in the app/model frame. Gear/hardpoint vectors are already **CG-relative**. The vertical datum is shifted to the app ground plane and contact planes equalised for this point-contact solver; they are not a promise of exact GLB wheel-centre registration. Static settled CG height measured 2.297 m, with 0.10 m nominal contact compression.

## Sources and confidence

### Primary real-aircraft source

EASA Type Certificate Data Sheet **EASA.A.036, issue 08, 17 October 2022**, <https://www.easa.europa.eu/en/downloads/7452/en>:

- Page 8, F27 Mark 500: standard MTOW **19,730 kg**, MLW **18,600 kg**, zero-fuel/oil/water-methanol maximum **17,460 kg**; reduction gearing **0.093:1**. Optional higher-weight modifications are listed by EASA but are **not** enabled in this model.
- Pages 10–11, engine limitations: Dart 532-7 dry takeoff **1,835 shaft hp** plus **479 lbf residual exhaust thrust**, versus wet takeoff **1,990 shaft hp** plus **514 lbf**, at **15,000 gas-turbine rpm**. The model uses the **dry** rating (1.368 MW shaft power per engine). It exposes the wet power constant for documentation but does not simulate water/methanol injection or grant wet power.
- EASA defers serial-specific speeds, CG limits and detailed operating procedures to the applicable approved AFM. Therefore the following add-on/manual speeds must **not** be presented as certified limits for every real Mk500.

Local research copy supplied by the parent: `f27-integration/research/EASA-A.036-Fokker-F27.txt` and PDF.

### User-supplied add-on references (simulation data)

Under `fokker-f27-inspection/bgt-f27500-v2/SimObjects/Airplanes/Bgt_F27500v2/`:

- `flight_model.cfg`: wing **754 ft² = 70.049 m²**, span **95.15 ft = 29.002 m**, Oswald efficiency **0.77**, empty mass **28,990 lb = 13,149.6 kg**, empty inertias (slug ft²), approximate gear/engine/hardpoint stations and control travels. Parasite drag **0.02539**, full-flap drag increment **0.106445**, gear drag increment **0.026531** are retained. Induced factor is calculated as `1/(pi * AR * e)`.
- Same file: clean/full-flap stall references **91 / 74 knots**, redline **227 KIAS**, Mach **0.48**, flap speed **145 knots**, gear **220 knots**, load factors clean **+3/-2 g**, flaps **+2 g**, the five flap detents and **15 s** total flap travel. These are **add-on reference/calibration numbers**, not independently certified performance. The separate `[REFERENCE SPEEDS]` full-flap limit says 144 knots; this implementation follows the flap section's 145-knots value consistently.
- The cfg's raw lift peak of roughly 1.5 does not reproduce its 91/74-knot stall references when used as a single whole-aircraft coefficient in this solver. It is **not copied blindly**: effective CLmax is calibrated to those reference speeds **at standard MTOW**. Source reference weight is not explicitly declared, so this weight association is an approximation.
- `engines.cfg`: two turboprops, four-bladed **11.5 ft diameter** constant-speed/featherable propellers, 15,000 rated turbine RPM, inverse gearbox ratio **10.753**, and BSFC **0.735 lb/(shp h)** inform the implementation. Its **2,070 shaft hp** and **525 lbf static thrust** conflict with the standard dry 532-7 type-certificate rating; the EASA dry rating is used instead. Unrelated copied engine features such as nitrous sections are not implemented.
- `systems.cfg`: pneumatic/brake context; no fictional conventional hydraulic-pressure model is inferred from its zeroed hydraulic section.

English add-on manual: `fokker-f27-inspection/f27500it-bgt_v23_doc_en2.txt` (PDF page numbers, 65 pages):

- Page 19: conventional aileron/elevator/rudder/flap layout.
- Page 25: Dart Mk532-7; lever-selected engine RPM **7,000 idle / 15,000 takeoff / 14,200 climb-cruise / 11,000 descent**; holding **12,000 below 10,000 ft / 12,600 above**; 12,600–14,000 continuous-operation vibration avoidance is documented by the manual, not enforced as a game lockout.
- Pages 31–32: pneumatic gear/brakes/steering; engines above 10,000 RPM recharge reservoirs to **2,800 psi**; gear horn at flaps 26.5 or greater with gear not down, or a throttle reduced below roughly 10,500 RPM in flight.
- Page 33: **2 × 2,535 L** main tanks. Model capacity **4,056 kg** assumes Jet A **0.8 kg/L**. Collector/unusable quantities, exact fuel density versus temperature and crossfeed plumbing are not resolved. EASA family configurations differ; this is the supplied add-on manual's configuration, not a universal F27 tank capacity.
- Page 34: 20,000–25,000-ft pressurisation context; **25,000 ft / 7,620 m** is an indicative maximum-altitude context, not a validated service ceiling for this browser model. Cabin pressurisation is not simulated.
- Pages 56–60: normal procedures, **138 KIAS climb**, **14,200 RPM**, approximately **240 KTAS** cruise, **VREF = 1.3 VS**, wind correction up to 20 knots, weight-dependent takeoff tables (clean / 16.5°), and 18.6-tonne landing weight. Tables have interleaved columns in extracted text; this model does **not** claim exact V1/VR/V2/field-length table reproduction. The cfg's fixed 85-knot rotation and 95-knot approach are not treated as universal speeds either.
- Manual fuel-consumption prose gives 400 kg/h cruise etc. without unambiguously stating pair versus engine in the extracted passage. This model reports **both engines combined** and uses cfg BSFC; no claim of matching that ambiguous total is made. Page 61's route-fuel calculator does not supply a validated range model here.

## Explicit approximations and limitations

- Fixed example payload **2,200 kg**, default fuel **3,000 kg**, default mass **18,349.6 kg**; full fuel gives **19,405.6 kg**, under standard MTOW. Fixed symmetric CG; inertia scales with total/empty mass using the supplied empty inertia. Payload distribution and real fuel-CG migration are not represented.
- Effective CLmax by detent: **2.06 / 2.28 / 2.50 / 2.82 / 3.11**. CL-alpha **5.2/rad**, CL0 **0.54**, smooth 30% post-stall lift loss, flap lift increments, estimated stability/damping derivatives, control gearing and partial propwash are engineering fits. Stall speed changes with mass, flap configuration and density, not a hardcoded stall-speed trigger. Real buffet/wing drop/spin entry and recovery are not validated.
- Shaft-power schedule depends on squared-ish lever/RPM fraction and a density lapse exponent of **0.65**. Prop thrust uses an actuator/momentum disk with empirical useful-power efficiency varying from **0.55 to 0.86**, plus residual exhaust thrust. These replace MSFS propeller tables; they are not a blade-element model. Spool time constants **2.8 s up / 1.6 s down**, rate cap **1,800 rpm/s up** and thermal response are estimates. Governor pitch transients, thermal/torque damage, wet power, ground-fine/reverse thrust and detailed HP-lever procedures are not implemented. Feather state reduces estimated dead-engine drag; no automatic feathering is assumed.
- Pneumatic reservoir starts charged for warm starts. Recharge **100 psi/s**, a **450 psi** charge per accepted gear command and minimum **600 psi** operation are estimates. Detailed air consumption, emergency extension, real brake pneumatic metering and leaks are not simulated. Reservoirs are retained after shutdown.
- Gear spring/damping/wheel/brake constants, equalised contact planes, approximate hardpoints, steering fade and contact travel are solver-compatible estimates. Ground collision geometry still needs visual verification against the converted GLB. Difficulty uses existing IL76 landing-tolerance rows as **game tolerance**, not a certified F27 landing-sink limit.
- `flapOverspeed` / `gearOverspeed` are warnings; they do not forcibly retract or instantly damage surfaces. Generic airframe failure uses 1.5 times indicated load limits and 1.2 times VMO as a game failure threshold, not a real structural test result. Mach drag rise is approximate. No claim of accurate single-engine climb, VMC, service ceiling, runway performance by weather/slope, terrain aerodynamics, icing or pressurisation.
- Warm starts solve steady approximate lift, pitching moment, thrust and trim; slow starts choose landing flaps/gear using **density-adjusted KIAS**, avoiding TAS-based bad high-altitude configuration selection. Low-energy starts below stall cannot be made physically level by trim. Longitudinal trim is solved with the current config; moving flaps/gear afterward requires retrimming.
- Public `step()` subdivides to <= 1/120 s for stable contacts. App controls/assists and scene/cockpit alignment are integration responsibilities. No extra dependencies or package/manifest edits were made by this task.

## Deterministic verification

Run from the owner root:

```sh
node test/f27-fdm-test.mjs
```

Final run passed all assertions. Tests are headless physics checks; they do **not** establish visual correctness or real-world performance accuracy. Conditions: ISA, zero wind, flat ground, 120-Hz solver, default payload/fuel unless stated, heading east. Test pilot helpers are fixed deterministic wings-level / pitch controllers, not claimed F27 autopilot logic.

| Check | Measured result |
| --- | --- |
| Whole-aircraft static 1-g stall at 19,730 kg | clean **90.95 KIAS**; 16.5° **82.56 KIAS**; 40° **74.02 KIAS** |
| Static stall angle | clean **16.7°**; 16.5° **15.0°**; 40° **12.3°** |
| Mass dependency | 81% mass produces exactly 90% calculated stall speed |
| Parked contact equilibrium | CG **2.297 m**, supported normal load **1.000 g** |
| Dart spool from idle, full lever | **8,800 RPM at 1 s**, **14,958 at 15 s** |
| Dry sea-level static thrust, both engines | **51,755 N**; decreases with forward speed |
| 300 m / 100-KIAS / -3° warm approach, after 30 s | **100.14 KIAS**, height change **-82.8 m** |
| 1,500 m / 160-KIAS level warm start, after 30 s | **159.76 KIAS**, height change **+1.6 m** |
| 6,000 m / 190-KIAS level warm start, after 30 s | **189.90 KIAS**, height change **+0.9 m** |
| 7,620 m / 180-KIAS level warm start, after 30 s | **179.04 KIAS**, height change **-0.1 m**; short-term energy stability only |
| Takeoff, approximately 18.35 t, flaps 16.5°, full dry power, rotate toward 8° | **755 m ground roll**, **100.0 KIAS** liftoff, **165 m CG height after 60 s**, gear fully retracted |
| Power-off clean developed stall, default mass | **86.4 KIAS / 0.82 g** after post-peak lift loss; unloading/full power recovered to **155.6 KIAS**, alpha **2.0°** in 15 s |
| Power-off 40° developed stall, default mass | **69.5 KIAS / 0.84 g** after post-peak lift loss; unloading/full power recovered to **107.1 KIAS**, alpha **-5.5°** in 15 s |
| Manual-style cruise, 4,000 m, 5 minutes | **240 KTAS / 196 KIAS**, **14,169 gas RPM**, **745 kg/h pair**, height change **+5.4 m** |
| Manual-style climb, initially 300 m, 14,200 RPM, target 138 KIAS | last 30 s of 120-s run: **1,148 ft/min**, **137.4 KIAS** |

Additional passing assertions cover: independent engine objects; correctly signed asymmetric thrust after left-engine failure; fuel consumption and unlimited-fuel behaviour; empty-fuel shutdown; cold-and-dark and warm restart; fixed gearbox ratio; altitude power lapse; prop thrust decrease with speed; gear/flap movement and bounds; ground and low-pressure gear interlocks; pneumatic recharge threshold; flap/gear warning flags; ground braking; finite state; and 30-Hz public-step subdivision matching 120-Hz parked integration to within 1e-8.

The lower dynamic-stall speeds above are **developed post-peak events at default mass**, not 1-g MTOW stalls. Do not substitute them for the static reference-speed check or real operating speeds.

## Scope / handoff

Flight-dynamics task changed only:

1. `src/f27.js`
2. `test/f27-fdm-test.mjs`
3. `notes/F27-PERFORMANCE.md`

No package dependencies, test manifests, deployment config, app source, visual source, other aircraft or model assets were edited by this task. The parent owns test-manifest wiring, integration, browser QA, final game ZIPs and any release decision. Code is frozen after the passing final test run; this note is the fallback completion report.
