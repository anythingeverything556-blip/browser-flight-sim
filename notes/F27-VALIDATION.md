# F27 Mk500 reference and local validation

## References used

- [EASA type certificate A.036, issue 08](https://www.easa.europa.eu/en/downloads/7452/en), pp. 8, 10–11: standard Mk500 weights, permitted Dart variants, ratio and engine ratings. This FDM uses the baseline 19,730 kg max takeoff and 18,600 kg max landing weights, and Dart 532-7 dry takeoff power of 1,835 shp per side. EASA directs readers to the serial-specific approved AFM for speed limitations; it does not validate these simulator V-speeds.
- User-supplied Gaurant F27 simulator package: `flight_model.cfg`, `engines.cfg`, `systems.cfg`, model animation/XML data and English-cockpit manual, in particular pp. 19–34 and pp. 56–61. The package gives a ~29 m wingspan and the 0 / 11.5 / 16.5 / 26.5 / 40° flap detents used here. The simulator package’s reference speeds and setup procedures are tuning inputs, **not** real-world operating instructions.
- Flight model parameters absent from those sources (control response, aerodynamic derivatives, propulsion efficiency, ground/tyre properties and other behaviors) are estimates. The new cockpit is not a port of the original MSFS avionics, Tapir autopilot, Wwise bank, or simulator systems.

## What was verified before packaging

- Both input ZIPs had identical content in their 100 shared paths. One integration was tested and the changed files were mirrored byte for byte into the Earthwing overlay. Unmodified source remains in both respective packages.
- 129 regression scripts passed; the normal Vite production build passed. Chrome WebGL 2 with software rendering advanced gameplay in exterior and cockpit views with no page, frame, or shader errors. It was a local production fixture with synthetic terrain, not a live Pages deployment or a phone frame-rate measurement.
- Browser request tracing saw only the exterior model at first (608,440 bytes). The cockpit (2,883,672 bytes) fetched on view entry; both aircraft GLBs total 3,492,112 bytes. Shared code, Draco, and scenery are separate. Both models keep their source animation inventories (102 + 624); game state drives the supported subset.
- Deterministic tests measured static stalls at 91.0 KIAS clean and 74.0 KIAS with 40° flap at modeled MTOW, stable warm approach and cruise starts, and stall/recovery in both configurations. In the nominal 18.35 t, 16.5° flap, calm/flat test, the model lifted off at 100 KIAS after a 755 m roll. These are **game test results**, not certified performance predictions.

Sound is procedural and engine-specific, not original recordings. The model provides manual controls and partial live cockpit gauges; full gauges, real flight-control feel, native effects, and autopilot are not implemented. The archive has private-use restrictions; see the base `LICENSE` and `public/models/f27/NOTICE.md`.
