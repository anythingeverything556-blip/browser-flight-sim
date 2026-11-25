# DA40 NG performance approximation

This is a game model, not an exact aircraft simulation, an approved flight manual, or a training device. Never use its numbers for real flight. Use the actual airplane's current, approved AFM and weight-and-balance data.

## References

- [Diamond's DA40 NG fact sheet, S_30613E, 18 February 2011](https://cdn.sprinkle.com/library/pdfs/a140b207-a4ca-412f-bcc1-6d8bf2c3a4e0.pdf), manufacturer document hosted by a third party: maximum mass 1,280 kg; clean and landing stalls 63 and 58 **KCAS**; ISA sea-level takeoff ground roll 370 m and climb 690 ft/min; 125 KTAS at 14,000 ft and 60% power; 19.7 L/h at 60%. The sheet calls the specifications approximate and does not specify takeoff flap setting, wind, slope, or runway surface.
- [Diamond's current DA40 specifications](https://www.diamondaircraft.com/en/flight-school-solution/aircraft/da40/tech-specs/): empty weight 903 kg without options, maximum takeoff mass 1,310 kg, total standard-plus-auxiliary fuel 147 L / 118 kg, landing stall 58 KCAS, ground roll 397 m MSL, climb 651 ft/min MSL, cruise 124 KTAS at 14,000 ft and 60%, and 19.3 L/h at 60%. These figures are also approximate; the page does not state all test conditions.
- [EASA TCDS EASA.IM.A.022, issue 24, 22 April 2021](https://www.easa.europa.eu/en/downloads/44254/en), section D, DA 40 NG: takeoff and landing flap deflections 20° ±2° and 42° ±1°; VFE 110 KIAS takeoff / 98 KIAS full, VNO 130 KIAS, VNE 172 KIAS; propeller limits 2,300 rpm takeoff and 2,100 rpm continuous. MTOM 1,280 kg normally; 1,310 kg requires MÄM 40-662. The TCDS identifies the NG AFM as document 6.01.15-E; an accessible NG AFM revision could not be independently verified. Do not substitute an earlier DA40 model's AFM.
- The pinned FlightGear source files under `.scratch/da40/source` are secondary references for geometry, assumed controls, a 72 KIAS best-rate speed, and flap transit times. The 72-knot setting is **not** independently verified here against the NG AFM.

## Model and test conditions

The modeled configuration uses the manufacturer's 903 kg empty weight and 118 kg full fuel, with a fixed 160 kg payload representing two 80 kg occupants: 1,181 kg at full fuel by default. The exposed `model.payload` permits controlled test loading; there is no user-facing loading interface or real station-by-station weight and balance. Tests use 259 kg payload for 1,280 kg and 289 kg for 1,310 kg. The high-weight configuration is conditional as noted above. The 2011 sheet's own empty weight is 880 kg; the present simplified model uses its own 903 kg empty base plus payload to achieve the same total mass, not a verified identical CG or loading.

Flap detents are UP, T/O, LDG at 0°, 20°, 42°. The 4 s and 3 s transition segments are retained from FlightGear, not verified AFM timings. The governor, static-to-cruise propeller efficiency, windmilling, low-rpm power cap, drag and lift coefficients are fitted/heuristic approximations; the engine can windmill when stopped in flight and idle at rest. Power command represents requested fraction of rated shaft power, limited by available altitude power and propeller rpm. Fuel flow uses a constant fitted specific consumption and 0.8 kg/L for reporting; temperature, Jet A density variation, engine maps, blade pitch and transient response are not modeled in detail.

Run `node test/da40-fdm-test.mjs` and `node test/da40-performance-test.mjs` from the project root. Tests integrate the actual gameplay model at 120 Hz, flat terrain, no wind, ISA atmosphere, and frozen fuel to maintain mass. The ground roll starts stationary with T/O flaps and full power already established, rotates when the simulated equivalent airspeed exceeds 60 kt, and records the last ground-contact position, **not** the distance to a 50 ft obstacle. The climb uses a simple pilot controller targeting 72 kt and measures seconds 60–120, after an initial altitude of 100 m; the test therefore samples low altitude rather than exactly sea level. Cruise holds 14,000 ft at simulated 60% shaft power for six minutes. These are reproducible comparisons, not the manufacturer's full prescribed procedures; unspecified reference conditions are assumptions.

The game's `out.ias` is density-scaled equivalent airspeed (EAS), not a calibrated IAS instrument. For these low-speed comparisons EAS is used as an approximation to CAS; instrument/position error and compressibility are not simulated. Analytical stall uses peak model lift at 1 g; the dynamic stall test reduces power while holding altitude, and records the EAS when the model first reaches its stall angle. These tests do not establish actual certified stall behavior or recoveries. Liftoff speeds below are observations, not manufacturer rotation-speed recommendations.

## Measured results

| Measurement | Reference | Model | Difference |
| --- | ---: | ---: | ---: |
| 1,280 kg clean dynamic stall | 63 KCAS | 63.2 kt EAS | +0.2 kt |
| 1,280 kg landing dynamic stall | 58 KCAS | 58.1 kt EAS | +0.1 kt |
| 1,280 kg takeoff ground roll | 370 m | 380.0 m | +10.0 m |
| 1,310 kg takeoff ground roll | 397 m | 397.9 m | +0.9 m |
| 1,280 kg low-altitude climb | 690 ft/min | 694.2 ft/min | +4.2 ft/min |
| 1,310 kg low-altitude climb | 651 ft/min | 635.1 ft/min | -15.9 ft/min |
| 1,310 kg cruise at 14,000 ft / 60% | 124 KTAS | 126.8 KTAS | +2.8 kt |
| 60% fuel flow, 0.8 kg/L | 19.3 L/h | 19.3 L/h | approximately 0.0 L/h |

Observed liftoff was 62.9 and 63.3 kt EAS at 1,280 and 1,310 kg, respectively. The 1,310 kg landing stall estimate was 58.6 kt EAS versus the current sheet's 58 KCAS, whose precise weight and configuration conditions are not fully stated. Model fitting and broad regression tolerances mean agreement at these points does not validate performance outside them, in wind, at different temperatures, or during maneuvers and failures.
