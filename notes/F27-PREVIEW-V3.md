# F27 Mk500 preview revision 3.1

## Controls

- From the F27 cockpit use **F27 Systems → Pilot view** or **Instrument view**. The pilot eye is another 16 cm below revision 2; **Seat height** adds a saved −25 to +18 cm offset. **Reset seat** restores the new default. The close instrument view hides the captain's yoke without changing the flight controls.
- Exterior and interior views use the same currently selected render scale. The cockpit is still 4.49 MB and loads in the background unless the browser requests Data Saver. Cockpit textures upload in short slices even while scenery is busy. Shader preparation is best-effort and no longer traps an already-loaded cockpit off screen.
- **Start / stop engines** or **Shift+I** cuts power normally but lets the two props coast. A cold spawn initializes at zero. Throttle uses the original supplied engine recordings with level matching and smoother overlap; no synthesized engine or shutdown recording was added. The 3.2 s rundown time constant is a game approximation.
- **F27 Systems** retains navigation, beacon, landing/taxi and wing inspection lights, red/white dome lamps and instrument dimming. Lighting strength changes without changing the count of GPU spot and point lights. Ground beams are most apparent in twilight/night.

## Assets

The 1.48 MB white exterior restores source detail without changing geometry or paint; the remaining F27 cockpit and sample downloads are separate. This is a browser simulation rather than the full MSFS implementation. Original author credit and terms are in `public/models/f27/NOTICE.md`.

## Working cockpit instruments and limits

The two flight panels use the original animated airspeed, attitude, altimeter, vertical speed, heading/compass and radio-altimeter instruments, with working clocks, annunciators, standby attitude, RPM, exhaust temperature, fuel flow/quantity, flap, trim and main pneumatic indications. Tracking the simulator's selected arrival supplies ILS indications on NAV1. NAV2/ADF/standalone radio tuning, full electrical/fuel/oil/pressurization subsystems, GPS/weather radar, and controls requiring vendor MSFS logic are not recreated. Some visible faces are consequently static. The decoded-instrument inventory in `test/f27-cockpit-gauges-inventory.json` distinguishes active animation channels, channels that require extra data, and unimplemented ones. Several animation channels form one dial.
