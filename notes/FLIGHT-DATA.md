# Il-76MD-90A (Il-476, 4 x PS-90A-76) - flight and systems data for simulation

Extends an earlier research file (`IL-76MD-90A-RESEARCH.md`, not part of this repository). Facts that file already settled (46.6 m length, 50.5 m span, 210 t MTOW, 60 t payload, UAC 16,000 kgf, 1,540 m takeoff / 960 m landing run, payload-range points, 300 m2 wing) are reused, not re-searched.

**Evidence scale:** A = manufacturer/operator document for the MD-90A (or for Il-76TD-90VD where stated). B = flight manual (RLE-76T) or Il-76 family design/aerodynamics data that plausibly carries over. C = reputable secondary source. D = my engineering estimate (calculation shown). D is never fact.

**Most important caveat:** nearly all RLE-level numbers (speeds, limits, flap schedules, control deflections, geometry, inertia) come from the ORIGINAL Il-76T/TD/MD with 4 x D-30KP-2 (MTOW 170-190 t). They are carried over to the MD-90A as B, with the variant stated per row. Where mass-dependent, I scale with sqrt(W) and mark D.

**Source key:** every row cites a key; URLs here. "p.N" = page N of the studfile RLE viewer.

| Key | URL |
|---|---|
| T-geo | https://www.testpilot.ru/review/il76/geometr.htm |
| T-mass | https://www.testpilot.ru/review/il76/mass.htm |
| T-des | https://www.testpilot.ru/review/il76/design.htm |
| T-eng | https://www.testpilot.ru/review/il76/201.htm |
| T-thr | https://www.testpilot.ru/review/il76/202.htm |
| T-alt | https://www.testpilot.ru/review/il76/203.htm |
| T-ctl | https://www.testpilot.ru/review/il76/305.htm |
| T-701 | https://www.testpilot.ru/review/il76/701.htm |
| T-703 | https://www.testpilot.ru/review/il76/703.htm |
| T-704 | https://www.testpilot.ru/review/il76/704.htm |
| T-705 | https://www.testpilot.ru/review/il76/705.htm |
| T-801 | https://www.testpilot.ru/review/il76/801.htm |
| T-802 | https://www.testpilot.ru/review/il76/802.htm |
| T-803 | https://www.testpilot.ru/review/il76/803.htm |
| T-504 / T-603 | https://www.testpilot.ru/review/il76/504.htm / https://www.testpilot.ru/review/il76/603.htm |
| RLE | RLE-76T Book 1 (1977), https://studfile.net/preview/6708525/page:N/ (N = 4,5,6,7,14,15,16,17,18,20,21) |
| W-MD90A | https://ru.wikipedia.org/wiki/Ил-76МД-90А |
| W-IL76 | https://ru.wikipedia.org/wiki/Ил-76 |
| W-PS90 | https://ru.wikipedia.org/wiki/ПС-90А |
| W-EN | https://en.wikipedia.org/wiki/Ilyushin_Il-76 ; https://en.wikipedia.org/wiki/Aviadvigatel_PS-90 |
| PERM | https://perm-motors.ru/en/production/ps-90a/ |
| REDSTAR | https://www.redstar.gr/en/russian-aerial-means/aero-engines/ps-90a-76-turbofan-engine.html |
| PS-TXT | https://lektsia.com/9x4d0a.html (Nikhamkin/Zaltsman, PS-90A textbook) |
| VD | https://volga-dnepr.com/en/fleet/IL-76/ts/ (Il-76TD-90VD) |
| VMC | https://cyberleninka.ru/article/n/raschet-minimalnyh-evolyutivnyh-skorostey-samoleta-il-76td-90vd |
| KOMOV | https://cyberleninka.ru/article/n/o-neobhodimosti-modernizatsii-samoleta-il-76md-90a |
| CTL-90A | https://rykovodstvo.ru/exspl/17649/index.html (Besenbekov, Il-76MD-90A control system) |
| SAU | https://cyberleninka.ru/article/n/sravnitelnyy-analiz-sistem-avtomaticheskogo-upravleniya-samoletom-sau-1t-2b-i-sau-76 |
| PILOTS | https://www.pilotspost.co.za/PsPpyarn944 |
| HATCH | https://infopediasu.com/14xec40.html (cargo-hatch subsystem) |
| TECHINS | https://www.techinsider.ru/weapon/1665725-zachem-sovetskomu-gruzovomu-samoletu-il-76-dve-kabiny-i-strannyi-gruzovoi-lyuk/ |
| GEAR-N | https://studfile.net/preview/9789691/page:10/ (nose gear) |
| GEAR-M | https://studfile.net/preview/9789691/page:8/ (main gear) ; doors list https://studfile.net/preview/9789691/page:3/ |
| MYNAVI | https://news.mynavi.jp/techplus/article/aero_tech-546/ |
| HYD | https://lektsii.com/2-7634.html |
| AEX | https://aex.ru/news/2020/11/9/218907/print/ |
| AIRINV | https://www.aircraftinvestigation.info/airplanes/Aviadvigatel_PS-90A.html |
| EXIST | existing summary file (UAC page https://uacrussia.ru/ru/aircraft/lineup/transport/IL-76MD-90A/ - UAC fetch failed in this session, so figures are taken from the existing summary) |

---

## 1. Masses

| Parameter | Value | Variant | Conf | Source |
|---|---|---|---|---|
| MTOW | 210,000 kg | MD-90A | A | EXIST, https://roe.ru/production/aerospace-forces/aircraft/military-transport-and-special-purpose-aircraft/il-76/ (search excerpt) |
| MTOW "by registry" | 195,000 kg | MD-90A (ru.wiki note) / Il-76TD-90VD certified | C / A | W-MD90A; VD |
| Operating empty | 88,500 kg | MD-90A | C | W-MD90A |
| Operating empty (alternatives) | 92,000 kg (sim database); 92,500 kg (Il-76TD-90); 97,243 kg (Il-76TD-90VD average OEW incl. equipment) | various | C/C/A(TD-90VD) | https://virtairlines.com/db/Ilyushin%20IL-76MD-90A ; W-EN ; VD |
| Max payload | 60,000 kg | MD-90A | A | EXIST; AEX (48 t -> 60 t) |
| Max payload | 50,000 kg incl. loading equipment | Il-76TD-90VD | A | VD |
| Max landing mass | not found for MD-90A. 155,000 kg (TD-90VD); 151,500 kg (Il-76T, concrete) / 135,500 kg (unpaved) | TD-90VD / Il-76T | A / B | VD; RLE p.4 |
| Max landing mass, MD-90A | **165,000 kg** (D: MZFW 152 t + ~13 t landing fuel; plausible range 155-170 t) | MD-90A | D | calc below |
| Max zero-fuel mass | 144,800 kg (TD-90VD); 128,000 kg (Il-76T "aircraft without fuel") | TD-90VD / Il-76T | A / B | VD; RLE p.4 |
| Max zero-fuel mass, MD-90A | **152,000 kg** (D: OEW 88.5 + payload 60 + service load 3.4 t = 151.9 t) | MD-90A | D | calc |
| Max fuel volume | 109,000 L | MD-90A | C | W-MD90A |
| Max fuel volume (older) | 109,480 L = 84,840 kg (density 0.775); "about 112,000 L" system capacity | Il-76 | C / B | W-IL76; RLE p.4 |
| Max fuel mass | 84,600 kg (concrete), 66,600 kg (unpaved) | Il-76T | B | RLE p.4; T-mass |
| Max fuel mass, MD-90A | **84,500 kg** (D: 109,000 L x 0.775) | MD-90A | D | calc |
| Max taxi / max takeoff / max landing / max OEW+payload ("no fuel") | 171 t / 170 t / 151.5 t / 128 t (concrete); 153 / 152 / 135.5 / 118 t (unpaved) | Il-76T | B | RLE p.4 |
| Max commercial load | 40,000 kg concrete / 30,000 kg unpaved; service load 3,400 kg | Il-76T | B | RLE p.4 |
| Max landing fuel | 30,000 kg (series 0902-0904); 50,000 kg (series from 0905); unpaved 24 / 30 t | Il-76T | B | RLE p.4 |
| Typical takeoff masses | 150-195 t for ordinary missions; 195 t (TD-90VD cert); 210 t only for max-payload short sectors | - | D | from payload-range points in EXIST and OEW + payload + fuel |
| Crew | min 5; up to 6 accompanying persons in cargo cabin | Il-76T | B | RLE p.5 |

D calculation (MZFW): 88.5 + 60.0 + 3.4 = 151.9 t; MLW: 152 + ~13 t reserve + approach fuel = ~165 t. Il-76T ratios MLW/MTOW = 0.89, TD-90VD = 0.795; 165/210 = 0.786 sits at the low end, so treat as conservative.

## 2. Geometry

All rows are for the Il-76 family (original, D-30KP) unless stated; wing span and area are corroborated for the MD-90A by the existing summary. The MD-90A has "redesigned wing sections" (C: PILOTS) but no changed dimensions were found.

| Parameter | Value | Variant | Conf | Source |
|---|---|---|---|---|
| Wing area (basic trapezoid, no glove) | 300 m2 | Il-76 / MD-90A | B/C | T-geo; W-MD90A |
| Span | 50.5 m | Il-76 / MD-90A | A | T-geo; EXIST |
| Aspect ratio | 8.5 (50.5^2/300 = 8.50) | Il-76 | B | T-geo |
| Taper ratio | 3 (root/tip) | Il-76 | B | T-geo |
| MAC | 6.345 m | Il-76 | B | T-geo |
| MAC leading edge from fuselage nose | 18.141 m (original fuselage 43.25 m; MD-90A overall length 46.6 m) | Il-76 | B | T-geo |
| Sweep at quarter-chord | 25 deg | Il-76 | B | T-geo; W-IL76 |
| Dihedral | -3 deg (anhedral) | Il-76 | B | T-geo |
| Incidence | 3 deg at fuselage side, 0 deg at tip, geometric twist -3 deg | Il-76 | B | T-geo |
| Airfoil | TsAGI P-151; t/c 12.9% at root station (2.4 m), 10.9% at 11.4 m; camber 0.8% -> 1.4% | Il-76 | B | T-geo |
| Fuselage max diameter / cabin | 4.8 m; cabin 20 m (no ramp) / 24.5 m (with ramp) x 3.45 m x 3.4 m; floor 2.2 m above ground; volume 321 m3 | Il-76 / MD-90A | B/C | T-geo; W-MD90A |
| Horizontal stabiliser | span 17.4 m, area 63 m2, AR 4.8, sweep 30 deg (c/4), elevator 17.2 m2, trim-flettner 1.206 m2 | Il-76 | B | T-geo |
| Fin | area 49.6 m2, height 7.245 m, AR 1.05, sweep 38 deg, rudder 15.6 m2, servo-compensator 1.245 m2, trim tab 0.63 m2; T-tail | Il-76 | B | T-geo |
| Stabiliser trim range | +2 to -8 deg vs fuselage datum | Il-76 | B | T-geo |
| CG limits | forward 20% MAC, aft 40% MAC (Il-76T). **MD-90A forward limit moved to 15%** | Il-76T / MD-90A | B / C | RLE p.4; CTL-90A |
| Empty CG, gear down | 33.3% MAC | Il-76 | B | T-mass |
| Gear track (outer wheels) | 8.16 m | Il-76 | B | T-geo |
| Wheelbase | 14.17 m | Il-76 | B | T-geo |
| Wheels | 20: nose 4 abreast, 4 main units x 4 wheels abreast (two units per side, tandem) | Il-76 / MD-90A | B | T-des; W-IL76 |
| Tyres | main 1300 x 480 mm (KT-158 wheels, braked, tubed); nose 1100 x 330 mm (KT-159 tubeless) | Il-76 | B | T-des; GEAR-N; https://www.forumavia.ru/t/47240/ |
| Tyre pressure | main 0.45-0.5 MPa soil / 0.7 MPa concrete; nose 0.55-0.6 MPa soil / 0.75 MPa concrete | Il-76 | B/C | T-des; W-IL76 |
| Nose-gear stroke | 298 +/-2 mm; two-chamber strut | Il-76 | B | GEAR-N |
| Nose steering | +/-50 deg tiller (taxi); +/-7 deg pedals (takeoff/landing) | Il-76 | B | T-geo |
| Minimum turn radius | 13-15 m; 180 deg turn on 40 m strip. Radius vs taxi speed: 13 m at 10 km/h, 35 m at 30, 63 m at 40, 100 m at 50 km/h | Il-76 | B | T-801; RLE p.14 |
| Pitch-down ground attitude | wing setting angle 3 deg; takeoff roll at ~3 deg AoA | Il-76 | B | T-802 |

## 3. Engines: PS-90A-76

### 3.1 Takeoff thrust conflict (14,000 / 14,500 / 16,000 kgf)

| Figure | Where | Conf |
|---|---|---|
| 14,500 kgf (142 kN) takeoff | ru.wikipedia PS-90A table (PS-90A-76 column); en.wikipedia PS-90 ("up to 14,500 kgf"); ru.wikipedia MD-90A text; Pilot's Post calls 14,500 kgf "maximum continuous" | C |
| 14,000 kgf takeoff, 3,200 kgf cruise (H=11 km, M=0.8), SFC 0.372 / 0.594, BPR 4.6, OPR 29.5, airflow 451 kg/s, dry 2,800 kg + 450 kg reverser | REDSTAR (PS-90A-76 spec sheet reproduction) | C |
| 16,000 kgf (156.9 kN) takeoff x 4 = 64,000 kgf | Volga-Dnepr for Il-76TD-90VD (VD); UAC for MD-90A (EXIST). Base PS-90A is 16,000 kgf (PERM; W-PS90) | A |
| Both 14 t and 16 t takeoff settings modelled for the Il-76TD-90VD | VMC paper: VMCG 210-230 km/h etc. depending on setting | B |

Explanation (D, not documented): the PS-90A-76 is the Il-76 variant of the PS-90A with improved life/acoustics (REDSTAR; PERM). It is a PS-90A core, so 16,000 kgf is the hardware's maximum (static, SL, ISA+, as quoted by operators/UAC). A lower 14,000-14,500 kgf figure appears in the PS-90A-76 certification/spec sheets and secondary sources and is probably the standard/flat-rated takeoff setting. The VMC paper confirming both 14 t and 16 t settings for the same TD-90VD supports "two selectable ratings". Cross-check: calculated takeoff run at 210 t is ~1,720 m with 14.5 t and ~1,545 m with 16 t (section 6); UAC's 1,540 m only closes with ~16 t. **Sim choice: realistic mode default 14,500 kgf (standard rating) with 16,000 kgf as the boosted/max-rating (thrust lever to the stop, short-run takeoff); easier modes may use 16,000 as the default.**

### 3.2 Engine data

| Parameter | Value | Variant | Conf | Source |
|---|---|---|---|---|
| Type | two-spool mixed-flow turbofan, common nozzle, reverser in the fan (outer) duct | PS-90A-76 | B | PERM; W-PS90 |
| Bypass ratio | 4.6 (takeoff, -76 sheet); 4.4 (PS-90A, PERM); 4.5-5.4 range (ru.wiki) | PS-90A-76 | C | REDSTAR; PERM; W-PS90 |
| Overall pressure ratio | 29.5 (-76); 35.5 (PS-90A) | -76 / base | C | REDSTAR; W-PS90 |
| Airflow, takeoff | 451 kg/s (-76 sheet); 534 kg/s (PS-90A textbook); 504 kg/s (ru.wiki) | | C | REDSTAR; PS-TXT; W-PS90 |
| Fan diameter | 1.9 m | | A/B | PERM |
| Fan blades | 33 | PS-90A | C | PS-TXT |
| Compressors/turbines | fan + 2 booster stages, 13-stage HPC, 2-stage HPT, 4-stage LPT (en.wiki says 4-stage LP) | | C | PS-TXT; W-PS90; W-EN |
| Rotor speeds, takeoff SL | N1 (LP) 4,340 rpm; N2 (HP) 11,740 rpm (PS-90A at ~161 kN). Cruise: LP 3,940, HP 11,365 rpm | PS-90A | C | PS-TXT |
| HP rpm (alt. figure) | 13,000 rpm | PS-90A | C | AIRINV (conflicts with PS-TXT) |
| Idle | not found for PS-90A. D-30KP-2: N2 60 +/-1% (6,550 rpm), N1 30%, thrust <= 9 kN, fuel ~800 kg/h | D-30KP-2 | B | T-thr; RLE p.5 |
| Takeoff thrust (cert) | see 3.1 | | | |
| Cruise thrust, H=11 km, M=0.8 | 3,500 kgf (ru.wiki, PS-90A-76 column) / 3,200 kgf (REDSTAR) | -76 | C | W-PS90; REDSTAR |
| SFC | takeoff 0.372 kg/kgf-h; cruise 0.594-0.595 kg/kgf-h (59.5 kg/kN-h) | -76 / PS-90A | C | REDSTAR; PERM; AIRINV |
| Fuel flow takeoff | 4 x 0.372 x 14,000 = ~5.2 t/h per engine (1.45 kg/s). Catalogue: 1.53-1.74 kg/s | -76 | C/D | REDSTAR; https://aerospace-community.com/engines/4829/ps-90a |
| Fuel flow cruise | ~1.9-2.1 t/h per engine (0.594 x 3,200-3,500 kgf); aircraft ~7.6-8.3 t/h; mission average ~9 t/h to 6,700 km | -76 | D (C for 9 t/h) | calc; W-IL76 |
| Max reverse thrust | 36 kN (3,600 kgf) static; D-30KP also 3,600 kgf. Effective at landing speeds ~2,000 kgf (derived: KOMOV states 1,200 kgf optimum, existing value "67% excessive" -> 1,200 x 1.67 = 2,000 kgf) | PS-90A / TD-90 | C / D | PS-TXT; KOMOV; T-alt |
| Reverser type | in the fan duct; grid/cascade type (KOMOV refers to reverser "grids"; reverser units + 450 kg) with doors. Translating-cowl vs blocker-door detail not found | -76 | C | KOMOV; PERM; REDSTAR |
| Reverser use on Il-76TD-90VD | **only outer engines** (1 and 4 in numbering outer) because inner-engine reverse jets are ingested by outer engines; all four possible only with modified grids, down to 100 km/h. Off at ~120 km/h recommended; jets visible entering engines from 180 km/h | TD-90 / MD-90A | C | KOMOV |
| Reverser use, original (D-30KP) | outer engines on landing roll, off at 50 km/h (all four only on snow/emergency: inner off at 150, outer at 50 km/h, +7% distance); max 1 min continuous | Il-76T | B | RLE p.16-17; T-thr; T-alt |
| EGT limits | not found for PS-90A-76. D-30KP-2: takeoff <= 655 C (5 min), nominal <= 595 C, idle ref. 465 C, max reverse <= 615 C (1 min) | D-30KP-2 | B | RLE p.5 |
| N2 limits D-30KP-2 | takeoff 97.5%, nominal 93%, max reverse 93%; N1 takeoff 91%, nominal 83.5% | D-30KP-2 | B | RLE p.5 |
| Spool-up idle -> takeoff | ground 7-10 s (throttle motion 1-2 s); flight idle -> 79% N2 in 4-7 s. PS-90A-76: not found; **use 8 s** | D-30KP / -76 | B / D | T-thr |
| Takeoff thrust time limit | 5 min (special cases 15 min); in flight starts to 9,000 m (reliable to 7,000 m) | D-30KP-2 | B | RLE p.5-6 |
| Throttle table (D-30KP-2, SL static): thrust kN vs N2% | idle 60% 9 kN; 0.42 nom 80.5% 40 kN; 0.6 nom 85% 57; 0.7 nom 87% 66.5; 0.9 nom 91% 85.5; nominal 93% 95; takeoff 97% 120 kN | D-30KP-2 | B | T-thr |
| Engine mass | 2,950 kg dry (PS-90A) / 2,800 kg (-76 per REDSTAR) + reverser 450 kg; length 4,964 mm; max diameter 2,396 mm | | C | W-PS90; REDSTAR |
| Nacelle bleed/anti-ice | wing and tail de-icing can be on at takeoff thrust to 3,000 m | Il-76T | B | RLE p.17 |
| APU | TA-12A | MD-90A | C | PILOTS |
| APU limits (older APU) | continuous ground <= 5 h; in-flight start <= 3,000 m & 370 km/h; use to 7,000 m & 400 km/h; EGT <= 550 C (680 C start peak); speed 97-101%; generator DC 400 A | Il-76T | B | RLE p.5 |
| Engines on MD-90A that have reversers | all four are equipped; operational policy limits use to outer pair (see above) | MD-90A | C/D | KOMOV |

## 4. Speeds (km/h unless stated; IAS "pribornaya" in the manuals)

| Parameter | Value | Variant | Conf | Source |
|---|---|---|---|---|
| Vmo (normal) | 600 km/h (550 with < 5,000 kg fuel); gear down also 600; with dampers failed 500 | Il-76T | B | RLE p.5; T-705 |
| Mmo | 0.77 | Il-76T | B | RLE p.5 |
| Max dynamic pressure | 17,014 Pa | Il-76 | B | T-705 |
| Vmax, brief exceptional | 650 km/h (>160 t), 670 km/h (<=150 t) | Il-76 | B | T-705 |
| Flap/slat limits | slats 14 deg: 400; slats 25 deg: 370; flaps 15 deg: 400; flaps 30 deg: 370; flaps 43 deg: 280; speed brakes out: 250 (brake panels at 14 deg) | Il-76T | B | RLE p.5; T-801 |
| Gear | normal ext/ret 370; emergency-descent extension 500; emergency extension 350; with gear down 600 | Il-76T | B | RLE p.5 |
| Max tyre speed | takeoff roll 290 km/h; landing roll 225 km/h | Il-76T | B | RLE p.5 |
| Stall speed clean (IAS) | 90 t: 210; 100: 222; 110: 232; 120: 242; 130: 252; 140: 262; 150: 272; 160: 280; 170: 290 | Il-76 | B | T-704 |
| Stall clean, MD-90A 210 t | 322 km/h (D: 290 x sqrt(210/170)) | MD-90A | D | calc |
| AUASP activation 1.13 Vs; min permissible 1.25 Vs | e.g. 170 t: 324 / 360 km/h | Il-76 | B | T-704 |
| Takeoff config speeds, flaps 30/slats 14 | VR 210-260 and V2 230-285 for 110-170 t (mapping assumed); V3/V4 (clean) 265-360 for 90-170 t; start flap retract 290-340, slat retract 350-370 | Il-76T | B | RLE p.15; T-802 |
| Takeoff config speeds, 43/25 | 120 t: VR 205, V2 215; 130 t: 205/220; 140 t: 210/225; 152 t: 210/230; max speed with devices 265-280; V4 305-340 | Il-76T | B | RLE p.17; T-802 |
| V1 | "V1/VR = 0.89-0.91"; V1 = 236 km/h in worked example (169-170 t, 30/14); V1 = VR on unpaved; 180 km/h on snow | Il-76T | B | RLE p.20-21, p.18 |
| VR / V2 / V3 rules | V2 = 1.2 Vs (takeoff config); V3 clean = 1.25 Vs; liftoff 10-15 km/h above VR; gear up >= 5 m; flaps start 120 m at V2+50 | Il-76T | B | RLE p.15; T-802 |
| MD-90A V speeds at 210 t | VR ~ 285 x sqrt(210/170) = ~317 km/h; V2 ~ 335 km/h; V1 ~ 0.9 VR = ~285 km/h (30/14) | MD-90A | D | scaling |
| Min control speeds | VMCG 210-230 km/h; VMCA 200-210; VMCL 190-200 (14 t vs 16 t takeoff setting, AP-25/NLGS-3) | Il-76TD-90VD | B | VMC |
| Approach (landing 43/25) | gear ext 370; slats 25/flaps 30 at 330-360 (by mass); 4th turn 300; flaps 43 at 250-280; glide-path 210-260 (90-160 t); min touchdown 190-220; touchdown 10-25 km/h below threshold speed; AoA on glide ~4 deg, touchdown AoA 7-9 deg | Il-76T | B | RLE p.16; T-803 |
| Vref at 210 t | ~300 km/h (D: 1.3 x Vs43; Vs43 = 220/1.2 x sqrt(210/130) = 233 km/h) | MD-90A | D | calc |
| Glide path | 2.7 deg, descent -3.4 m/s at max mass, ~0.6 nominal thrust; flare starts 10-12 m | Il-76T | B | T-803 |
| Landing mass 130 t cut | max descent speed 280 km/h with devices; maximum speed in landing config < 130 t: 270 | Il-76T | B | T-705; T-803 |
| Climb speeds | after flap retract 370-400 IAS then nominal; speed-climb M 0.74-0.76 (530 IAS to M 0.71); economy climb M 0.70-0.73 (500 IAS to M 0.68); 3-engine climb 450; 2-engine 400 | Il-76T | B | RLE p.6, p.15 |
| Cruise | economy M 0.71-0.73; fast M 0.76-0.77; min IAS at cruise level 370; MD-90A published 750-780 km/h (ru.wiki 780-850) | Il-76T / MD-90A | B / A | RLE p.16; EXIST; W-MD90A |
| Cruise altitude | typical 9,100-10,600 m; service ceiling 12,000-12,200 m (weight dependent, see 6) | TD-90VD / MD-90A | A | VD; EXIST |
| Holding speed | RLE graph unreadable. **~380 km/h IAS at 140 t** (D: 1.4 x Vs_clean(140 t)=262 x 1.4 = 367, rounded up to above the 370 km/h cruise-level minimum) | Il-76 | D | calc |
| Turbulence penetration | IAS = flight mass (t) + 300 km/h (470 at 170 t ... 410 at 110 t) | Il-76T | B | RLE p.18 |
| Max crosswind | 12 m/s (mu >= 0.5), 10 m/s (0.4-0.5), 7 m/s (0.3-0.4); tailwind 5 m/s; slope +/-2%; 15 m/s crosswind accepted on a dry runway for engine-failure takeoff | Il-76T | B | RLE p.16; T-801 |
| G limits | -0.3..+2 g (clean); +0.2..+1.7 g (flaps out); bank limit 30 deg | Il-76T | B | RLE p.4 |
| AoA limit | 15 deg (M<=0.54), 13.5 (0.60), 11 (0.70), 10 (0.74), 9 (0.77); stall ~23 deg at CL 1.4 (clean, M<0.4) | Il-76 | B | RLE p.5; T-703 |

## 5. High-lift and controls

| Item | Value | Variant | Conf | Source |
|---|---|---|---|---|
| Slats | 5 sections per wing (2 midwing + 3 outer); takeoff 14 deg (concrete) / 25 deg (unpaved, >= 120 t); landing 25 deg | Il-76 | B | T-des; T-geo; W-IL76 |
| Flaps | 2 triple-slotted extendable flap pieces per wing (inner section on midwing, outer on outer wing); 15 deg (limited use) / 30 deg (closed single-slot takeoff on concrete) / 43 deg (triple-slotted open, landing and unpaved takeoff) | Il-76 | B | T-des; T-geo |
| Spoilers | 4 per outer wing panel (2 inner + 2 outer); outer pair also work as roll interceptors (only on the wing with the raised aileron); airbrake mode symmetric, deflection 20 deg, threshold 3-5 deg wheel angle; extended/retracted smoothly over 3-4 s; 4 irreversible boosters (hydraulic 1 outer, hydraulic 2 inner) | Il-76 | B | T-des; T-geo; T-ctl; RLE p.16 |
| Brake panels ("tormoznye shchitki") | 4 per midwing section; 40 deg in landing | Il-76 | B | T-des; T-geo |
| Aileron | up 28 / down 16 deg; servo-tab 30 up/20 down; trim +/-15 deg | Il-76 | B | T-geo |
| Elevator | up 21 / down 15 deg; trim-flettner 4 up / 7 down (trim), 5 up / 7 down (flettner) | Il-76 | B | T-geo |
| Rudder | +/-27 deg; trim +/-10 deg; servo +/-20 deg | Il-76 | B | T-geo |
| Stabiliser | +2 to -8 deg (movable) | Il-76 | B | T-geo |
| Wheel force | +100 N at half travel, ~300 N at full travel; step force-loader with flaps retracted | Il-76 | B | T-ctl |
| Control wheel travel | half travel above 450 km/h | Il-76 | B | RLE p.5 |
| Flap/slat extension times | **not found.** D: slats 14 deg ~ 10 s, flaps to 43 deg ~ 40 s in total (typical large-transport hydraulic flap drive; thrice longer for the 43 deg triple-slot) | - | D | engineering judgement |
| Gear retraction / extension time | **not found.** D: ~ 14 s retraction, ~ 12 s extension (door open 3 s, gear travel, door close 3 s) | - | D | engineering judgement |
| Flight-control architecture | Il-76MD-90A keeps the hydromechanical system with irreversible hydraulic boosters (ARM-62 steering machines) and a mechanical unboosted backup; two hydraulic systems; spring servo-compensators. New SAU-76 digital autopilot (director control). A fly-by-wire KSU was only proposed, not installed. Rudder/elevator/aileron boosters on autonomous hydraulic stations | MD-90A | C | CTL-90A; SAU; HYD |
| Yaw/roll dampers | yes (SAU-1T-2B on Il-76MD); speed limit 500 km/h if dampers inoperative | Il-76MD | B/C | SAU; T-705 |
| AP-25 compliance issues | stability/controllability and loading devices did not meet 25.143(b),(c),(f); 25.145(a),(b); 25.207(b) | MD-90A | C | CTL-90A |

## 6. Performance

| Parameter | Value | Variant | Conf | Source |
|---|---|---|---|---|
| Takeoff run (MTOW, concrete) | 1,540 m (UAC); "takeoff distance paved 1,700 m" (Pilot's Post); 2,150 m runway quoted | MD-90A | A / C | EXIST; PILOTS; W-MD90A |
| Landing run | 960 m (UAC), 450 m "with reversers" (en.wiki, unlikely for full weight) | MD-90A | A / C | EXIST; W-EN |
| Required takeoff distance, example | 2,100 m at 169 t, SL, 15 C, 1% slope up, 10 m/s headwind (distance = 1.15 x (run + 0.5 x 10.5 m climb)) | Il-76T | B | RLE p.21 |
| Takeoff climb gradient requirement | 3% (all-engine failed case) | Il-76T | B | RLE p.20 |
| Wet/snow corrections | water 8-10 mm: run x1.2, RTO x1.4; wet snow: run x1.2, RTO x1.6; packed snow: x1.25 (<120 t) / x1.11 | Il-76T | B | RLE p.21 |
| Ceiling by weight | 165 t: 10,000 m; 150 t: 10,750; 140 t: 11,250; 130 t: 11,750; <=125 t: 12,000 | Il-76T | B | RLE p.5 |
| Ceilings with engines out (D-30KP) | one engine out: 12,000 m up to 105 t; three engines at nominal at 160 t: > 8,000 m; two engines: ~10,000 m | Il-76T | B | T-701 |
| Service ceiling | 12,200 m | MD-90A | A | EXIST |
| Rate of climb SL | no document value. D: with 4 x 14,500 kgf at 450 km/h: ROC 22 m/s at 210 t (theoretical max, takeoff rating, CD0 0.026, K 0.047); ~29 m/s at 170 t. Operational nominal-rating initial climb ~ 12-15 m/s (D) | MD-90A | D | calc |
| Time to cruise altitude | D: ~ 20-25 min to FL330 at 190-200 t (average ROC ~ 7-9 m/s over 10 km) | MD-90A | D | calc/judgement |
| Range/payload | 60 t: 4,000 km; 52 t: 5,000 km; 48 t: 5,500 km; 40 t: 6,500 km; 20 t: 8,500 km; ferry 9,700 km; TD-90VD 50 t: 4,000-4,500 km | MD-90A | A/C | EXIST; W-MD90A; VD |
| Fuel economy vs MD | -12-15% fuel, +18% range | MD-90A | C | AEX |
| Glide ratio / L/D | max L/D ~ 15 (D: see section 10) | | D | calc |
| Engine-out | VMCG 210-230 km/h; one engine out: establish 370 km/h minimum; 3-engine climb 450 km/h, 2-engine 400 km/h; one-engine-out landing speeds +10 km/h; go-around from >= 30 m | Il-76T / TD-90VD | B | RLE p.6; VMC |
| Wind limits to hold | holding up to ~ 75-80% on wet/snow runway only (brakes hold) | Il-76T | B | T-802 |

## 7. Landing-gear mechanics

| Item | Fact | Conf | Source |
|---|---|---|---|
| Nose gear | retracts **forward (in direction of flight)** into an unpressurised bay; bay closed by **two pairs of doors**: two large forward doors driven by two hydraulic cylinders (system 2), two small rear doors linked mechanically to the forward ones; in emergency extension the gear itself opens the large door locks and the doors stay open; up-lock pin/latch released by hydraulic cylinder or emergency cable at frame 14; wheels braked automatically during retraction (centrifugal sensors) | B | GEAR-N |
| Main gear (4 units, 4 wheels each) | retraction cylinder and folding-brace cylinder work simultaneously; **wheels rotate 90 deg, irreversibly during retraction** (turning lever linked to a bracket on the bay side beam, torque via two-link spline joint), so the 4-abreast bogie becomes 4-in-line (fore-aft) | B | GEAR-M |
| Direction of swing | **inward toward the fuselage**, bogie twisted 90 deg so wheels line up fore-aft, stowed in the bulged side fairings (sponsons) of the fuselage; two units per side in tandem | C | MYNAVI |
| Doors | bay recesses are closed by doors both in the retracted AND extended position, doors open/close automatically (electrical control): so animation = open doors -> leg swings & bogie twists -> doors close, reverse on extension | B | GEAR-M |
| Hydraulics | gear, brakes, nose steering, slats/flaps, spoilers, doors/ramp and wipers all on hydraulic systems No. 1 and No. 2 (210 kgf/cm2 class) | B | HYD; GEAR-N |
| Photo/video/diagram | Commons CC videos of takeoff/landing show gear stow (see section 11 list); no free diagram of the 90 deg twist was found beyond MYNAVI's article | - | |

## 8. Cargo doors and other doors

| Item | Fact | Conf | Source |
|---|---|---|---|
| Hatch composition | tri-leaf, five elements: **ramp**, **pressure door (germostvorka)**, **middle door**, **two side doors** | B | W-IL76; HATCH |
| Opening sequence | (1) closed-position locks release; (2) **side doors open outward** to the sides; (3) **middle door swings inward and lifts up to the ceiling** between the hoist rails; (4) ramp locks release; (5) **ramp lowers with its under-steps**; (6) **pressure door rises** (up/inward). Closing is the reverse: pressure door, ramp, ramp locks, middle door, side doors, closed locks. Automatic from a control panel via limit switches; two hydraulic systems (halved force if one fails) | C | HATCH; TECHINS |
| Ramp | length 5 m (T-geo) / 4.5 m (W-IL76); parked ramp angle 14 deg; usable as a loading ramp (floor 2.2 m above ground); strength of ramp 2,000 kg stated by ru.wiki for a "light" load | B/C | T-geo; W-IL76 |
| Opening angles / times | **not found.** D: side doors ~ 100 deg open, middle door ~ 90 deg up (flush to ceiling), pressure door ~ 80 deg; full open ~ 60-90 s | - | D | judgement |
| Hoists | overhead electric hoists (telphers) move cargo > 5 m beyond the ramp; Il-76TD-90VD crane system 12,000 kg | C / A | TECHINS; VD |
| Crew entrance | two outer entrance doors one per side at frames 15-17; inner crew-cabin entrance door on right at frame 14; ru.wiki: emergency exit on the left behind navigator's cabin plus a top service hatch to fuselage/wing | B / C | GEAR-M (list); W-IL76 |
| Emergency exits | four: two No.1 at frames 23-24, two No.2 at frames 58-60 | B | GEAR-M |
| Paratroop doors | two side doors (rear fuselage) plus two paths at the ramp (ru-language Il-76 search reference); direction of hinging/sliding **not found**. D: side door opens outward/upward like standard airdrop doors | C/D | https://studfile.net/preview/6708525/ (cargo cabin text) - not confirmed |
| Warning | "Hatches not closed" annunciator | B | GEAR-M |

## 9. Lights and miscellany

| Item | Fact | Conf | Source |
|---|---|---|---|
| Landing/taxi lights | two PRF-4 lights, one on each wing half; **retractable** (crew "extend lights" on glide path, switch on at 150-100 m, retract after takeoff at 50 m); continuous operation on the ground limited to 5 min | B | RLE p.17; https://studbooks.net/1922456/matematika_himiya_fizika/osveschenie (search excerpt) |
| Stabiliser ice-inspection light | FS-155 light on left side between frames 40 and 41 with an observation window | B | https://mydocxru.com/3-361.html (search excerpt) |
| Nav / beacon / strobe positions | not found in readable sources. D: red left / green right wingtip, white tail, anti-collision beacons top and bottom fuselage, strobes at wingtips and tail (standard AP-25) | D | judgement |
| Wipers | hydraulically driven | B | HYD |
| Wing/tail/engine anti-ice | hot air; tail/wing heating on below +5 C visible moisture | B | RLE p.17 |

## 10. Derived simulator coefficients (all D)

Inputs: S = 300 m2, b = 50.5 m, AR = 8.50, rho0 = 1.225 kg/m3, g = 9.80665.

**CLmax from stall speeds** (CL = 2 W g / (rho V^2 S)):
- Clean: 170 t at 290 km/h gives 1.398; 90 t at 210 gives 1.412; 130 t at 252 gives 1.416. **CLmax clean ~ 1.40** (matches T-703: "CL about 1.4 at alpha ~ 23 deg").
- Takeoff 30/14 with Vs = V2/1.2: 1.99-2.13 across 110-170 t (mapping assumed). **CLmax(30/14) ~ 2.08.**
- Landing/unpaved takeoff 43/25 with Vs = V2/1.2: 120 t: 2.59; 130 t: 2.68; 140 t: 2.75; 152 t: 2.86 (drifting up because V2 is rounded to 5 km/h and includes ground-effect margin). **CLmax(43/25) ~ 2.7** (T-703 allowable CL at alpha 15 deg: 1.1 clean, 1.5 (15/14), 1.9 (30/14), 2.6 (43/25)).
- T-802: liftoff CL 1.5-1.58 (30/14) / 2.15-2.3 (43/25); ground-roll CL 0.9 / 1.7.

**CL-alpha:** DATCOM lift slope with AR 8.5, Lambda_c/2 = 22.2 deg (from tan(c/2) = tan(c/4) - (4/AR)(0.25)(1-lambda)/(1+lambda), lambda = 1/3), M = 0.2, kappa 0.97 gives a = 4.64/rad = 0.081/deg. Data check: (1.4 - 1.1)/(23 - 15) = 0.0375/deg near stall (nonlinear region). **Use 4.6/rad linear to alpha ~ 12 deg, then round off to CLmax at ~23 deg clean.** Zero-lift alpha ~ -(CL at 0)/a: with wing setting +3 deg and the 15 deg/1.1 point, alpha0 ~ -4 deg (D).

**Drag:** K = 1/(pi AR e), e = 0.80 -> K = 0.0468. From T-701: drag ~240 kN at 790 km/h TAS at sea level gives CD = 240e3/(0.5 x 1.225 x 219.4^2 x 300) = 0.0271 at CL ~ 0.17 (150 t) -> CD0 (M 0.65, gear up) ~ 0.0258. Choose **CD0 = 0.024-0.026 (clean, M<0.65), K = 0.047, giving (L/D)max = 0.5/sqrt(CD0 K) = 14.9** (consistent with L/D 15 for Il-76). Compressibility rise above M 0.70 (Mcrit ~ 0.74 from Mmo 0.77) - model CD_wave = 0.02 x (M - 0.72)^2 / 0.0025 for M > 0.72 (D). Gear down adds ~ +0.015, 43/25 flaps ~ +0.05, spoilers 20 deg ~ +0.02, brake panels 40 deg ~ +0.03 (D, typical values).

**Thrust lapse (high BPR ~ 4.5):** T = T0 x delta^0.8 x (1 - 0.30 M), delta = p/p0 (in the stratosphere delta only). Gives: SL M 0.3: 0.91; 3,000 m M 0.4: 0.66; 6,000 m M 0.55: 0.45; 9,000 m M 0.70: 0.30; 11,000 m M 0.8: **0.229**, matching REDSTAR 3,200/14,000 = 0.229 and W-PS90 3,500/16,000 = 0.219. Mattingly's generic high-BPR formula delta(1 - 0.49 sqrt(M)) gives 0.125 at 11 km/0.8 and is too low for this engine, so it was rejected. (T-alt: below 8 km thrust falls with speed, above 8 km it rises with speed - the simple lapse ignores this; use the table for D-30KP behaviour if needed.) SFC rises from 0.372 (SL static) to 0.594 (11 km, M 0.8): SFC = 0.372 + (0.594-0.372) x min(1, h/11,000 x (0.4 + 0.6 M/0.8)).

**Ground friction and braking:** touchdown 215 km/h (59.7 m/s), roll 960 m -> mean decel = v^2/(2s) = 3,566/1,920 = 1.86 m/s2 = 0.19 g (spoilers + brakes + outer reverse). **Rolling mu = 0.02 (concrete), braking mu 0.35-0.40 max effective (dry), 0.20 wet, 0.10-0.12 icy; unpaved 0.06 rolling.** (Il-76 limits: mu >= 0.5 dry class for 12 m/s crosswind.)

**Reverse-thrust deceleration:** 2 outer engines at ~2,000 kgf effective: 2 x 2,000 x 9.81 = 39 kN -> a = 39e3/150,000 kg = 0.26 m/s2 (0.027 g); at static 3,600 kgf each: 72 kN -> 0.48 m/s2 (0.05 g); all four at 3,600 kgf: 0.96 m/s2 (0.10 g). Reverse effectiveness falls ~ linearly with speed to ~ 40% at 100 km/h (D). Use 2,000 kgf (effective) as the sim default, 3,600 kgf as peak at < 150 km/h.

**Takeoff acceleration check (210 t, V_lof 300 km/h):** a ~ (T/W - mu) g x 0.88 with T = 4 x T0 x 0.92. 14,500 kgf: 2.02 m/s2 -> 1,720 m; 16,000 kgf: 2.25 m/s2 -> 1,545 m.

**Roll/pitch/yaw rate maxima (very low confidence):** no documented rates. From AP-25-style response (30 deg bank in ~ 6 s at approach speed) and spoiler/aileron authority: **max roll rate ~ 10 deg/s at approach, ~ 8 deg/s at cruise; max pitch rate ~ 3.5 deg/s (elevator 21/15 deg); max yaw rate ~ 3 deg/s.** (D.)

**Inertia:** documented (T-mass, units 10^6 kg m2, "Ix, Iy, Iz" in Russian axes where Y is up and the Il-76 had OEW 86 t assumed):
| Total mass / CG | Ix (roll) | Iy (yaw) | Iz (pitch) |
|---|---|---|---|
| 170 t, 40% MAC | 10.2 | 18.8 | 10.1 |
| 170 t, 20% MAC | 10.9 | 19.7 | 10.8 |
| 152 t, 40% | 9.4 | 17.8 | 10.0 |
| 141 t, 40% | 9.6 | 17.8 | 9.7 |
| 135 t, 40% | 10.1 | 18.4 | 9.2 |
Ixz 0.6-1.3 x 10^6. Sanity: Iy ~ Ix + Iz (18.8 ~ 10.2 + 10.1), so Iy is yaw; B747 scaled by mass and length^2 gives pitch ~ 9.9e6, supporting Iz = pitch. For the MD-90A scale linearly with mass (D): 210 t: **roll 12.6e6, pitch 12.5e6, yaw 23.2e6 kg m2**. Radii: k_roll = 0.153 b, k_pitch = 0.178 L, k_yaw = 0.243 L.

## 11. Sound facts for synthesis

| Item | Value | Conf | Basis |
|---|---|---|---|
| Fan blades | 33 | C | PS-TXT |
| Takeoff N1 (PS-90A) | 4,340 rpm = 72.3 Hz shaft; **blade-passing frequency 33 x 72.3 = 2,387 Hz**; N1 90%: 65.1 Hz, BPF 2,148 Hz | C/D | calc |
| Idle N1 | not documented for PS-90A; D-30KP-2 idle N1 30% -> PS-90A idle N1 ~ 1,300 rpm = 21.7 Hz; **BPF ~ 716 Hz**; idle N2 ~ 60% = 7,000 rpm = 117 Hz (core whine) | D | analogy T-thr |
| Takeoff N2 | 11,740 rpm = 195.7 Hz; 13,000 rpm quoted by AIRINV | C | PS-TXT |
| Fan tip speed | pi x 1.9 x 72.3 = 431.8 m/s = Mach 1.27 relative to still air at takeoff (supersonic tips) -> **multiple-pure-tone "buzz-saw"** at takeoff and climb (audible harmonics of shaft frequency 72 Hz, strongest at 2,3,4 x N1 and the BPF) fading as inlet flow increases in forward flight | D | calc |
| Character | mixed-flow exhaust with acoustic liner panels -> less low-frequency jet roar and lower overall level than the D-30KP (D-30KP LP 5,380 rpm, fan 1.455 m: tip ~ 410 m/s; its noisy straight-through bypass gives the famous "howl"); PS-90A-76 is described as a low-noise engine meeting ICAO Stage 4 (C: avid.ru; PERM) | C/D | PERM; https://www.avid.ru/en/avia/?id=1 (search excerpt) |
| Spool-up | idle -> takeoff 7-10 s (D-30KP), 8 s for sim; flight idle to 79% N2 4-7 s | B | T-thr |
| Reverser | deployment 1.5-2 s (D); engine goes to ~ 93% N2 max reverse; loud broadband roar from forward-angled cascade exhaust + ground debris; use <= 1 min | B/D | RLE p.5 |
| APU | TA-12A, 97-101% speed, whine ~ 100% constant speed; exhaust temp limit 550 C | C/B | PILOTS; RLE p.5 |
| Systems sounds | hydraulic pump whine (two systems), gear motor/unlock thunk, door/ramp hydraulics, cargo hatch locks, stall-warning (AUASP "light and sound") | D | judgement |

**Openly licensed recordings (links only; nothing downloaded):**

| Asset | Licence | URL |
|---|---|---|
| Freesound "AEROJet_Cargo Jet Aircraft IL-76.Flies By Overhead 6_EM" by newlocknew (1:43, Il-76 flyby before landing, Ekaterinburg, 2024-06-05) | CC BY 4.0 (verified on the Freesound page) | https://freesound.org/people/newlocknew/sounds/770628/ |
| Freesound "...Flies By Overhead 2_EM" and a rain-on-cargo-plane recording by the same author | CC BY-NC (per SoundSpool listing; NC = not usable in a commercial product) | https://soundspool.com/fr/tags/il-76 |
| Commons video "Il-76MD Take Off (UKLL-LWO).ogv" (24 s) | CC BY-SA 4.0, author Oleg Volkov | https://commons.wikimedia.org/wiki/File:Il-76MD_Take_Off_(UKLL-LWO).ogv |
| Commons "Il-76MD landing in Lviv airport.ogv" (52 s) | CC BY-SA 4.0 (page also lists CC BY 3.0), author pilotlviv/Oleg Volkov | https://commons.wikimedia.org/wiki/File:Il-76MD_landing_in_Lviv_airport.ogv |
| Commons "Il-76 landing 67.ogv" (2 min 14 s) | CC BY 3.0, author Yaroslav Pankratiev | https://commons.wikimedia.org/wiki/File:Il-76_landing_67.ogv |
| Commons "2019 landing of Il-76MD on an unpaved airfield.webm" (1 min 6 s) | CC BY 4.0, Ministry of Defence of the Russian Federation | https://commons.wikimedia.org/wiki/File:2019_landing_of_Il-76MD_on_an_unpaved_airfield.webm |
| Commons category with 8 Il-76 videos (the others, MoD airborne exercises, not licence-checked here) | per file | https://commons.wikimedia.org/wiki/Category:Videos_of_Ilyushin_Il-76 |
Notes: these are D-30KP-powered aircraft except possibly the MoD clips; none is a PS-90A-76 recording. CC BY-SA requires share-alike on the derived audio. FS2004/DCS fan packs (https://www.avsimrus.com/f/fs2004-sounds-38/ilyushin-il-76-soloviev-d-30kp-3431.html) are freeware, not open licences - do not bundle.

---

## (a) `il76_sim_params`

```json
{
  "il76_sim_params": {
    "mass": {
      "mtow_kg": {"v": 210000, "c": "A"},
      "oew_kg": {"v": 88500, "c": "C"},
      "mzfw_kg": {"v": 152000, "c": "D"},
      "mlw_kg": {"v": 165000, "c": "D"},
      "max_payload_kg": {"v": 60000, "c": "A"},
      "max_fuel_l": {"v": 109000, "c": "C"},
      "max_fuel_kg": {"v": 84500, "c": "D"},
      "fuel_density_kg_per_l": {"v": 0.775, "c": "C"},
      "typical_takeoff_kg": {"v": 190000, "c": "D"}
    },
    "geometry": {
      "wing_area_m2": {"v": 300, "c": "B"},
      "span_m": {"v": 50.5, "c": "A"},
      "aspect_ratio": {"v": 8.5, "c": "B"},
      "taper_ratio_root_over_tip": {"v": 3, "c": "B"},
      "mac_m": {"v": 6.345, "c": "B"},
      "mac_le_from_nose_m": {"v": 18.141, "c": "B"},
      "sweep_c4_deg": {"v": 25, "c": "B"},
      "dihedral_deg": {"v": -3, "c": "B"},
      "incidence_root_deg": {"v": 3, "c": "B"},
      "incidence_tip_deg": {"v": 0, "c": "B"},
      "length_m": {"v": 46.6, "c": "A"},
      "height_m": {"v": 14.42, "c": "C"},
      "htail_area_m2": {"v": 63, "c": "B"},
      "htail_span_m": {"v": 17.4, "c": "B"},
      "htail_sweep_c4_deg": {"v": 30, "c": "B"},
      "elevator_area_m2": {"v": 17.2, "c": "B"},
      "fin_area_m2": {"v": 49.6, "c": "B"},
      "fin_height_m": {"v": 7.245, "c": "B"},
      "rudder_area_m2": {"v": 15.6, "c": "B"},
      "cg_fwd_pct_mac": {"v": 15, "c": "C"},
      "cg_aft_pct_mac": {"v": 40, "c": "B"},
      "wheelbase_m": {"v": 14.17, "c": "B"},
      "track_m": {"v": 8.16, "c": "B"},
      "nose_wheels": {"v": 4, "c": "B"},
      "main_units": {"v": 4, "c": "B"},
      "wheels_per_main_unit": {"v": 4, "c": "B"},
      "main_tyre_mm": {"v": "1300x480", "c": "B"},
      "nose_tyre_mm": {"v": "1100x330", "c": "B"},
      "nose_steer_taxi_deg": {"v": 50, "c": "B"},
      "nose_steer_takeoff_deg": {"v": 7, "c": "B"},
      "min_turn_radius_m": {"v": 13, "c": "B"}
    },
    "engine": {
      "count": {"v": 4, "c": "A"},
      "model": {"v": "PS-90A-76", "c": "A"},
      "takeoff_thrust_standard_kgf": {"v": 14500, "c": "C"},
      "takeoff_thrust_max_kgf": {"v": 16000, "c": "A"},
      "nominal_thrust_fraction_of_takeoff": {"v": 0.8, "c": "B"},
      "cruise_thrust_11km_m08_kgf": {"v": 3300, "c": "C"},
      "sfc_takeoff_kg_per_kgfh": {"v": 0.372, "c": "C"},
      "sfc_cruise_kg_per_kgfh": {"v": 0.594, "c": "C"},
      "bypass_ratio": {"v": 4.6, "c": "C"},
      "opr": {"v": 29.5, "c": "C"},
      "airflow_kg_s": {"v": 451, "c": "C"},
      "fan_diameter_m": {"v": 1.9, "c": "A"},
      "fan_blades": {"v": 33, "c": "C"},
      "n1_100pct_rpm": {"v": 4340, "c": "C"},
      "n2_100pct_rpm": {"v": 11740, "c": "C"},
      "idle_n1_pct": {"v": 30, "c": "D"},
      "idle_n2_pct": {"v": 60, "c": "D"},
      "egt_takeoff_c": {"v": 655, "c": "B"},
      "egt_nominal_c": {"v": 595, "c": "B"},
      "spool_up_idle_to_takeoff_s": {"v": 8, "c": "D"},
      "reverse_thrust_peak_kgf": {"v": 3600, "c": "C"},
      "reverse_thrust_effective_kgf": {"v": 2000, "c": "D"},
      "reverser_type": {"v": "fan-duct cascade with doors", "c": "C"},
      "reverse_engines_normal": {"v": "outer pair (1,4)", "c": "C"},
      "reverse_off_speed_kmh": {"v": 50, "c": "B"},
      "apu": {"v": "TA-12A", "c": "C"}
    },
    "speeds_kmh_ias": {
      "vmo": {"v": 600, "c": "B"},
      "mmo": {"v": 0.77, "c": "B"},
      "vfe_slats14": {"v": 400, "c": "B"},
      "vfe_slats25": {"v": 370, "c": "B"},
      "vfe_flaps15": {"v": 400, "c": "B"},
      "vfe_flaps30": {"v": 370, "c": "B"},
      "vfe_flaps43": {"v": 280, "c": "B"},
      "vle_vlo": {"v": 370, "c": "B"},
      "vle_emerg_descent": {"v": 500, "c": "B"},
      "max_tyre_takeoff": {"v": 290, "c": "B"},
      "max_tyre_landing": {"v": 225, "c": "B"},
      "v_brake_panels_out_max": {"v": 250, "c": "B"},
      "stall_clean_170t": {"v": 290, "c": "B"},
      "stall_clean_210t": {"v": 322, "c": "D"},
      "stall_t_o_30_14_210t": {"v": 264, "c": "D"},
      "stall_land_43_25_210t": {"v": 233, "c": "D"},
      "vref_210t": {"v": 300, "c": "D"},
      "vr_210t": {"v": 317, "c": "D"},
      "v2_210t": {"v": 335, "c": "D"},
      "vmcg": {"v": 220, "c": "B"},
      "vmca": {"v": 205, "c": "B"},
      "approach_gear_down": {"v": 370, "c": "B"},
      "slats25_flaps30_approach": {"v": 340, "c": "B"},
      "touchdown_min": {"v": 190, "c": "B"},
      "holding_140t": {"v": 380, "c": "D"},
      "climb_initial": {"v": 400, "c": "B"},
      "climb_speed_best": {"v": 450, "c": "B"},
      "cruise_mach_econ": {"v": 0.72, "c": "B"},
      "cruise_mach_fast": {"v": 0.765, "c": "B"},
      "crosswind_max_ms": {"v": 12, "c": "B"},
      "tailwind_max_ms": {"v": 5, "c": "B"}
    },
    "controls": {
      "slats_takeoff_deg": {"v": [14, 25], "c": "B"},
      "slats_landing_deg": {"v": 25, "c": "B"},
      "flaps_takeoff_deg": {"v": [30, 43], "c": "B"},
      "flaps_landing_deg": {"v": 43, "c": "B"},
      "flaps_intermediate_deg": {"v": 15, "c": "B"},
      "slat_sections_per_wing": {"v": 5, "c": "B"},
      "flap_sections_per_wing": {"v": 2, "c": "B"},
      "spoiler_sections_per_wing": {"v": 4, "c": "B"},
      "brake_panel_sections_per_wing": {"v": 4, "c": "B"},
      "spoiler_deflection_deg": {"v": 20, "c": "B"},
      "brake_panel_deflection_deg": {"v": 40, "c": "B"},
      "aileron_up_down_deg": {"v": [28, 16], "c": "B"},
      "elevator_up_down_deg": {"v": [21, 15], "c": "B"},
      "rudder_deg": {"v": 27, "c": "B"},
      "stabiliser_trim_deg": {"v": [2, -8], "c": "B"},
      "flap_extension_time_s": {"v": 40, "c": "D"},
      "slat_extension_time_s": {"v": 10, "c": "D"},
      "gear_retract_time_s": {"v": 14, "c": "D"},
      "gear_extend_time_s": {"v": 12, "c": "D"},
      "spoiler_deploy_time_s": {"v": 3.5, "c": "B"},
      "control_type": {"v": "hydromechanical with irreversible boosters, digital SAU-76 autopilot, no fly-by-wire", "c": "C"},
      "max_g_clean": {"v": [-0.3, 2.0], "c": "B"},
      "max_g_flaps": {"v": [0.2, 1.7], "c": "B"}
    },
    "performance": {
      "takeoff_run_m": {"v": 1540, "c": "A"},
      "landing_run_m": {"v": 960, "c": "A"},
      "service_ceiling_m": {"v": 12200, "c": "A"},
      "cruise_alt_m": {"v": 10000, "c": "A"},
      "cruise_speed_kmh": {"v": 770, "c": "A"},
      "range_60t_km": {"v": 4000, "c": "A"},
      "range_52t_km": {"v": 5000, "c": "A"},
      "range_20t_km": {"v": 8500, "c": "A"},
      "ferry_range_km": {"v": 9700, "c": "A"},
      "max_alt_by_mass_t_to_m": {"v": {"165": 10000, "150": 10750, "140": 11250, "130": 11750, "125": 12000}, "c": "B"},
      "roc_sl_max_210t_ms": {"v": 22, "c": "D"},
      "roc_sl_operational_ms": {"v": 13, "c": "D"},
      "time_to_cruise_alt_min": {"v": 22, "c": "D"},
      "approach_glide_deg": {"v": 2.7, "c": "B"},
      "ld_max": {"v": 14.9, "c": "D"}
    },
    "aero_coeffs": {
      "cl_alpha_per_rad": {"v": 4.6, "c": "D"},
      "alpha_zero_lift_deg": {"v": -4, "c": "D"},
      "clmax_clean": {"v": 1.4, "c": "D"},
      "clmax_takeoff_30_14": {"v": 2.08, "c": "D"},
      "clmax_landing_43_25": {"v": 2.7, "c": "D"},
      "alpha_stall_clean_deg": {"v": 23, "c": "B"},
      "cd0_clean": {"v": 0.025, "c": "D"},
      "induced_k": {"v": 0.047, "c": "D"},
      "oswald_e": {"v": 0.8, "c": "D"},
      "delta_cd0_gear": {"v": 0.015, "c": "D"},
      "delta_cd0_flaps43_slats25": {"v": 0.05, "c": "D"},
      "delta_cd0_spoilers20": {"v": 0.02, "c": "D"},
      "delta_cd0_brake_panels40": {"v": 0.03, "c": "D"},
      "thrust_lapse_exponent_delta": {"v": 0.8, "c": "D"},
      "thrust_lapse_mach_coeff": {"v": 0.3, "c": "D"},
      "rolling_mu_concrete": {"v": 0.02, "c": "D"},
      "braking_mu_dry": {"v": 0.37, "c": "D"},
      "braking_mu_wet": {"v": 0.2, "c": "D"},
      "mean_landing_decel_ms2": {"v": 1.86, "c": "D"}
    },
    "dynamics": {
      "ixx_kgm2_at_210t": {"v": 12600000, "c": "D"},
      "iyy_pitch_kgm2_at_210t": {"v": 12500000, "c": "D"},
      "izz_yaw_kgm2_at_210t": {"v": 23200000, "c": "D"},
      "roll_rate_max_deg_s": {"v": 10, "c": "D"},
      "pitch_rate_max_deg_s": {"v": 3.5, "c": "D"},
      "yaw_rate_max_deg_s": {"v": 3, "c": "D"}
    },
    "sound": {
      "fan_bpf_takeoff_hz": {"v": 2387, "c": "D"},
      "fan_bpf_idle_hz": {"v": 716, "c": "D"},
      "fan_tip_mach_takeoff": {"v": 1.27, "c": "D"},
      "n2_hz_takeoff": {"v": 195.7, "c": "D"}
    }
  }
}
```

## (b) Conflicts between sources and the choice made

1. **Takeoff thrust 14,000 / 14,500 / 16,000 kgf.** Chose 14,500 as the standard rating, 16,000 as max (explained in 3.1; the TD-90VD paper models both). Reason: UAC/Volga-Dnepr (A) say 16,000, but spec-sheet and secondary data say 14-14.5 and the VMC paper confirms two selectable settings; 1,540 m takeoff run only matches ~16 t.
2. **Empty weight 88.5 t / 92 t / 92.5 t / 97.2 t.** Chose 88.5 t (only value tied to the MD-90A in a general reference). 97.2 t is an Il-76TD-90VD average including freighter equipment.
3. **MTOW 210 t vs 195 t "by registry".** Chose 210 t (UAC/UAC-adjacent A); 195 t is the certified weight of the TD-90VD and the registry note in ru.wiki.
4. **Height 14.42 m vs 14.7/14.76 m.** Kept 14.42 m (existing summary); unresolved.
5. **Fuel 109,000 L / 109,480 L / 112,000 L.** Chose 109,000 L (MD-90A ru.wiki); 112,000 L is Il-76T tank capacity incl. unusable.
6. **Bypass ratio 4.4 / 4.5 / 4.6 / 5.4 and OPR 29.5 vs 35.5; airflow 451 / 504 / 534 kg/s.** Chose the -76 sheet values (4.6, 29.5, 451) for PS-90A-76; the others are PS-90A (16,000 kgf) values. Airflow: 534 (textbook, PS-90A at 161 kN) fits 156 kN better than 451; if matching thrust at 16,000 use 504-534.
7. **LP compressor stages 2 vs 4.** ru.wiki/textbook: fan + 2 boosters; en.wiki: 4-stage LP. Chose fan + 2 boosters.
8. **HP rotor speed 11,740 (textbook) vs 13,000 rpm (aircraftinvestigation).** Chose the textbook value.
9. **Max reverse thrust 36 kN vs 1,200 kgf optimum vs 2,000 kgf derived.** Peak 3,600 kgf (but same number is the D-30KP's); effective 2,000 kgf derived from KOMOV. Treat peak with caution.
10. **Ramp length 5 m vs 4.5 m; cabin length 20/24.5/24.54 m.** Geometry 5 m (design table); 4.5 m is Wikipedia's figure for the floor portion; cabin 20 m (no ramp) / 24.5 m (with ramp).
11. **Cruise 750-780 vs 780-850 vs 820-850 km/h.** Chose 770 km/h (UAC 750-780) at M 0.72; 820-850 only reachable at M 0.77 at altitude (~ 818 km/h at 11 km) as a max/fast figure.
12. **Takeoff run 1,540 m vs 1,700 m (paved).** Chose 1,540 (A). Landing 960 m vs 450 m (en.wiki): 960 chosen.
13. **Landing run vs Il-76T RLE "required" distances.** RLE distances are factored; UAC numbers are runs.
14. **Stall/approach/V-speed data from D-30KP aircraft at 170 t.** Not the MD-90A; scaled by sqrt(mass) as D.
15. **Fwd CG 20% vs 15%.** MD-90A thesis states forward limit moved to 15%; chose 15 (C).
16. **Inertia axes.** Table "Ix, Iy, Iz" in Russian axes; chose Iy = yaw, Iz = pitch (consistency check Iy ~ Ix + Iz).
17. **Il-76TD-90VD 50 t range 4,000 vs 4,500 km** (both on the same Volga-Dnepr page); not relevant to the MD-90A, 4,000 km at 60 t is used.

## (c) Unknown / not found

- Any PS-90A-76 N1/N2 100% reference rpm, idle rpm, EGT limits, idle fuel flow, spool-up time, reverser geometry (translating cowl vs blocker doors), reverse-thrust curve versus speed; which engines have reversers on the MD-90A by policy (documents say only the outer pair is normally used).
- MD-90A-specific: max landing mass, max zero-fuel mass, stall speeds, V1/VR/V2, Vref, Vmo/Mmo, flap/slat/gear speed limits, flap/slat extension times, gear retraction/extension times, control-surface deflection limits after the wing redesign, wing sweep/area changes, CG limits (only the 15% forward change is cited), climb rate, time-to-altitude, glide ratio, engine-out performance.
- Exact main-gear kinematics direction and door sequence with times; a free diagram/video of the 90 deg bogie twist.
- Cargo hatch angles/times, paratroop door and crew door hinge directions/dimensions; navigator's hatch operation.
- Nav/strobe/beacon positions and wiper geometry.
- RLE graphs (takeoff run, holding fuel/speed figures 5.5-22..28, climb tables) were not extractable; the RLE-76T Book 1 is page-viewable at studfile (531 pages) and could be mined further.
- A PS-90A-76 audio recording under an open licence: none found; only D-30KP-era Il-76 recordings.
- The Il-76TD-90VD type-certificate data sheet (Rosaviatsiya) and EASA TCDS for PS-90A could not be retrieved; engine certification limits remain unverified.
