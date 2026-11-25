# Flight trajectory realism pass

This source pass fixes initial airspeeds and the production Skyhawk ground configuration. It does not replay GPS tracks, retune the lift/drag tables, or claim that a flight in the sim will follow a real flight point for point.

## Changes

- **C172S:** Default to fixed tricycle gear. The extra tailwheel is available only to code that explicitly constructs the fictional configuration; the normal game's gear key no longer toggles it.
- **C172S, DA40 NG, F27 Mk500, SF50 G3 and Il-76MD-90A:** Pass true airspeed (TAS) into the physics using the target calibrated airspeed (CAS) and local ISA conditions. Use CAS as the cockpit IAS proxy where applicable; the sim does not model aircraft-specific instrument or position error. The F27 final speed retains the loading-dependent stall margin. The Il-76 cruise remains Mach 0.72.
- **SR-71A:** Preserve the control schedule in equivalent airspeed (EAS) and Mach, and label the teleport input KEAS. The HUD's existing CAS readout is separate. Aerodynamic forces still use dynamic pressure, and the fitted jet thrust blends retain their original speed basis.

Example reset speeds, in knots CAS (not groundspeed, and not performance claims):

| Scenario | Old | Fixed |
|---|---:|---:|
| C172S cruise at 8,000 ft | 93.2 | 105 |
| DA40 NG cruise at 8,000 ft | 111.0 | 125 |
| F27 Mk500 cruise at 15,000 ft | 167.6 | ~191.9 (240 kt TAS; see follow-up) |
| SF50 G3 cruise at FL250 | 182.8 | 180 |

Verification: `npm test`, `npm run build`, and `npm run test:smoke`. The dedicated `test/flight-reference-test.mjs` checks the six production aircraft's airport-start paths, the CAS↔TAS round trip, EAS versus dynamic pressure, and gear-limit behavior where CAS and EAS straddle a threshold.

## What the real-flight evidence supports

- **C172S / DA40 NG:** [Cessna 172 type certificate](https://www.easa.europa.eu/en/downloads/7423/en) and [DA40 type certificate](https://www.easa.europa.eu/en/downloads/44254/en). Observed tracks can check path and timing, but not unknown loading, pilot technique or wind. A departure at the exact chart weight and conditions is still a separate validation.
- **SF50 G3:** The verified G3 `N963SF` Albuquerque–Mesa Gateway trace contains genuine altitude steps; it does not reveal engine thrust or how the flight would behave in another clearance or weather regime. Retuning needs the serial-effective flight manual and matched conditions; see [EASA.IM.A.615](https://www.easa.europa.eu/en/downloads/24242/en).
- **F27 Mk500:** The [available recorder trace](https://www.baaa-acro.com/sites/default/files/2025-08/ZK-NFC.pdf#page=66) is from an unstable approach, not a nominal benchmark.
- **SR-71A:** The [NASA transonic measurements](https://ntrs.nasa.gov/citations/20020057965) used distinct research configurations, not a stock-aircraft target to fit blindly.
- **Il-76MD-90A:** Published performance figures provide bounds, but an exact-variant time series matched to mass, weather and configuration was not available. No substitute variant was used as a trajectory benchmark.

## F27 gear and wheel follow-up

- The F27 no longer plays the generic spoken gear warning. Its gear caution and pulsing configuration horn still operate under the existing warning conditions; other spoken warnings remain available.
- The rendered nose and main wheels now use the signed rotational speed from the tire model. Braking and reverse motion affect the spin, while the suspension and axles keep their own motion. Wheel rotation follows simulation time and stops advancing when paused or retracted.
- Run `node test/f27-gear-test.mjs` and `node test/f27-audio-test.mjs` for focused regression coverage.

## Fleet callouts and cruise-speed follow-up

- Persistent spoken gear and low-fuel reminders leave 15 and 60 seconds of silence between clips. This does not change genuine warning conditions, critical warning cadence, or caution tones and indicators. The F27 keeps its configuration horn without the generic spoken gear clip. Height crossings that occur while speech is busy or blocked are skipped, not played late; a new approach can still re-arm the calls.
- The F27 normal cruise start is now **240 KTAS at 15,000 ft**, or about **192 kt CAS** in ISA. The previous setting of 210 kt CAS started at ~262 KTAS and needed nearly the modeled takeoff RPM. In a clean, level, no-wind test from **190 KTAS**, the 18.35 t model reached **240.3 KTAS** at the manual's **14,200 engine RPM**. Its simulated full-lever value is not a published maximum or an operating target.
- The Il-76 cruise target stays **Mach 0.72 around FL330**. At 10,000 m in ISA that is about **776 km/h true**, not indicated. In separate level-flight tests starting at **650 km/h true**, the model crossed **770 km/h true** at 170 t and 190 t; no extra engine thrust or higher speed limit was needed. A separate 170 t Mach-hold test also reached the target from below. The selector and the true-speed readout now make those different speeds explicit.
- All six airborne starts now convert the speed through the air to ground-relative motion using the local mean wind. Before, the default test weather pulled the same Il-76 cruise start down to Mach 0.68 and F27 start to about 218 KTAS as soon as physics took over. Headwind, tailwind and crosswind now affect initial groundspeed and drift, not the selected airspeed. Runway starts remain stationary and an explicit traffic-alongside start still starts with the requested groundspeed.
- Map teleport cruise presets now compute the IAS/EAS needed for the selected Il-76 or SR-71 Mach target at the chosen altitude. Cruise and maximum operating limits remain distinct, and actual speeds still vary with power, altitude, and load. These are not exact real-flight trajectory replays.

## Preset setup follow-up

| Aircraft | Runway | 10 NM approach | 5 NM final | Cruise |
|---|---|---|---|---|
| C172S | Normal flaps up, fixed gear | 20° flaps at 65 KIAS | 30° flaps at 65 KIAS | Clean at 105 KIAS / 8,000 ft |
| DA40 NG | Takeoff flaps, fixed gear | Takeoff flaps at 75 KIAS | Landing flaps at 75 KIAS | Clean at 125 KIAS / 8,000 ft |
| Vision Jet G3 | Takeoff flaps and trim | Gear down, half flaps at 110 KIAS | Gear down, full flaps at 100 KIAS | Gear/flaps up at 180 KIAS / FL250 |
| SR-71A | Gear down, chute stowed | Gear down at 200 KEAS | Gear down at 200 KEAS | Gear up at Mach 3.2 / 80,000 ft |

These are repeatable **game presets**, not operating instructions or universal aircraft speeds. The F27 and Il-76 airport setups are unchanged. Gear and flaps are selected before airborne trim. The trainer trim now accounts for propwash, thrust-line pitch and asymmetric elevator travel. Hot airport starts also restore the trainers’ engines after shutdown; map teleports preserve engine state. Vision Jet airport approaches load at or below the modeled landing-weight limit instead of full takeoff weight. The teleport form now accepts existing whole-number presets such as 192 kt or 4,572 m. Fixed gear is shown as fixed, and changing a Vision Jet preset to a speed above its extended-gear limit requires selecting a lower value or raising the gear.

The trainer changes solve longitudinal trim only. The unassisted Skyhawk can still turn slowly with no rudder/roll correction; the default hands-off assist remains available. Terrain clearance takes precedence over a selected cruise altitude where the two conflict.

The optional landing voice now announces heights without the generic Airbus-style “Retard” prompt on the six production aircraft. Retractable-gear aircraft using the shared landing aid don't issue optional height cues during a gear-up pass. The F27's separate height and warning logic is unchanged; caution tones and urgent warnings remain enabled as before.

The ZIPs are a private source handoff, not a deployment or an authorization to redistribute third-party assets. Retain the supplied notices and check individual asset terms before republishing.
