# Cockpit gauge audit

The live panel state is assembled by `panelState()` in `src/main.js`, with pressure, temperature, electrical, oxygen, cabin and fuel-group readings from `src/systems.js`. `src/panel.js` maps those values to the display. No real aircraft sensor feed is present: “derived” means mapped from simulated flight/navigation state; “approximate” means supplied by the simplified systems model or an explicitly shared indication.

## Needles and numeric instruments

| Instrument | Panel source | Range / display | Status |
| --- | --- | --- | --- |
| KEAS needle and digital readout | `kias` from `ias()` | 0–600 kt; digits rounded to 1 kt | Derived from flight-model airspeed and atmosphere |
| Mach readout and mini MCH needle | `mach` from `fdm.out.M` | 0–3.5 | Flight-model output |
| Altimeter needles, digital altitude, and mini ALT needle | `altFt` from `fdm.pos.y` | 1,000-ft and 10,000-ft pointer cycles; digital altitude rounded to 1 ft | Derived from simulated altitude |
| Current, maximum and minimum G needles | `g` from `fdm.out.nz` | -2–6 G | Current is flight-model output; max/min are peak-hold values |
| Main and mini AOA needles | `aoaDeg` from `fdm.out.alpha` | 0–45° main, 0–25° mini | Derived from flight-model angle of attack |
| Clock hour, minute and seconds hands | `hour` from `env.hour` | 12-hour face | Simulated environment clock; follows the run-clock setting |
| Main fuel needle and digital readout | `fuelLb` from `fdm.fuel` | 0–80,000 lb; digital pounds rounded to 1 lb | Derived from simulated fuel mass |
| Six tank-group needles T1–T6 | `fuelTanksLb` from `fdm.fuel` and `fdm.fuelAft` | 0–16,000 lb per group | Approximate allocation: three equal forward groups and three equal aft groups; group totals preserve the flight model’s forward/aft fuel pools |
| Left/right engine RPM needles and digits | `rpm` from each `fdm.engines[].dry` and `.unstart` | 0–110% | Derived from engine model state |
| Left/right EGT needles and digits | `egt` from engine dry thrust, afterburner and unstart state | 0–1,000°C dial range | Derived from engine model state |
| Left/right nozzle needles and mini NZL/NZR needles | `noz` from engine afterburner and dry thrust | 0–100% | Derived from engine model state |
| Left/right fuel-flow digits | `ff` from `fdm.engines[].ff` | lb/h | Derived from engine model fuel flow |
| Main CIT needle and digits | `cit` from total temperature and Mach | -50–450°C | Derived from flight-model temperature and Mach |
| Left/right oil-pressure needles OL/OR | `oilPressurePsi` | 0–100 psi | Approximate systems model, follows engine RPM |
| Left/right hydraulic-pressure needles HL/HR | `hydraulicPressureKpsi` | 0–4 kpsi | Approximate systems model; pressure sags during gear travel and recovers afterward |
| Electrical AMP and VLT needles | `busCurrentA`, `busVoltageV` | 0–400 A, 0–30 V | Approximate systems model; engine generation and low-light load affect the readings |
| Cabin-altitude and differential-pressure needles | `cabinAltitudeFt`, `differentialPressurePsi` | 0–50,000 ft, 0–6 psi | Approximate pressure schedule versus aircraft altitude |
| OAT needle | `altFt` via standard-atmosphere lapse rate | -80–40°C | Approximate standard atmosphere |
| Left/right oil-temperature needles OTL/OTR | `oilTemperatureC` | 0–150°C | Approximate systems model, follows engine RPM with thermal lag |
| Fuel-temperature needle F-T | `fuelTemperatureC` | -80–80°C | Approximate systems model, follows outside temperature and engine heat with thermal lag |
| Oxygen quantity needle OXY | `oxygenQuantityPct` | 0–100% | Approximate systems model; slowly depletes while an engine is running |
| Intake-spike needles SPL/SPR and IN AFT bars | `spikeIn` from aircraft inlet state | 0–26 in | Approximate shared inlet-spike position |
| Bypass needles BPL/BPR and bars | `bypass` from Mach and inlet-unstart state | 0–100% | Derived from flight-model inlet state |
| Mini fuel-flow needle FF | Average of both engine `ff` values | 0–80 (thousands of lb/h) | Derived from engine fuel flow |
| Pitch, bank, vertical-speed and duplicate KEAS needles PCH/BNK/VS/KEA | `pitch`, `bank`, `vsFpm`, `kias` | ±20°, ±60°, ±6,000 fpm, 0–600 kt | Derived from aircraft attitude, vertical velocity and airspeed |

## Other live readouts

- **ADI and flight director:** pitch, bank, slip, and autopilot-commanded pitch/roll; aircraft values are derived from attitude/flight state, director commands from autopilot targets.
- **HSI / navigation:** heading, course, DME, station identifier, bearing, localizer/glideslope deviation, and turn anticipation from `nav`; these are live navigation outputs, blanked when invalid.
- **Autopilot text:** altitude, heading, and speed/Mach targets and engagement states from `ap`.
- **Warning/status lamps:** master warning/caution, inlet unstarts, afterburners, fuel, G/AOA/airspeed warnings, autopilot, gear, brakes, parking brake, chute, and ground indication are tied to state or warning inputs. Gear lamps share the single simulated gear position rather than independent microswitches.
- **Gear-position pointer:** `gearPos` and `gearDown` from the flight model.

The permanently lit, unmodeled SAS annunciator and ground-tied NWS annunciator were removed rather than left as decorative indicators. No decorative live needle remains. The system-model outputs are educational approximations, not calibrated aircraft instrumentation.

## Rendering and refresh

The panel has one 4096×2304 static texture when the WebGL texture limit permits it (otherwise 2048×1152), plus a 1536×864 transparent dynamic canvas sampled by the existing three panel facets. It adds no meshes. Static bezels, relief, screws, markings and lens highlight are generated once. Dynamic content uses the original 2048×1152 drawing coordinates scaled into the compact overlay, redraws at no more than 20 Hz, and skips unchanged display-precision state. The overlay texture disables mipmap regeneration.

The texture-payload estimate is 5,308,416 bytes per dynamic upload (1536×864 RGBA), or at most about 106 MB/s at 20 Hz. The previous 2048×1152 RGBA canvas at 24 Hz was about 226.5 MB/s, a 2.1× reduction (an earlier 512×288 layer cut it 19× but made needles and digits visibly soft) in full-upload payload. This is byte-count arithmetic, not a GPU transfer trace; static texture upload is one-time, and actual dynamic upload frequency falls when values do not change.
