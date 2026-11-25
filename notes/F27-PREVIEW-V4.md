# F27 Mk500 preview revision 4

## Gear and cockpit response follow-up — 23 November 2026

Nose-wheel steering now starts straight ahead, follows the physical steering direction, and reduces authority with speed. Gear deployment uses one synchronized source timeline: 7 seconds to extend and 17 seconds to retract, without the old half-cycle stop/suspension jump. Press G again in transit to reverse from the current position. Ground retraction remains locked, and pressure failures are explained separately.

**F27 Systems → Aircraft** includes a landing-gear button plus live travel/remaining-time status. The HUD and original cockpit selector now agree with the commanded movement and completed position. Runway/approach starts initialize down; cruise initializes up.

A cockpit-only static-local-matrix optimization reduces CPU work while retaining live needles, yokes, pedals, props, day/night lamps, exterior geometry and existing shadow behavior. No resolution or instrument-update-rate reduction. Details and limits: `F27-GEAR-COCKPIT-FIXES.md`.

## Controls and liveries

Both flight-deck yokes now follow pilot pitch and roll; the four interlinked rudder pedals follow the pilot’s steering/yaw inputs. This uses the 100-frame source yoke clips and 32-frame pedal clips from the add-on’s `F27500v2bgt_INTERIOR.xml` rather than moving the yoke-hide controls or guessing from surface lag. Independent toe-brake motion is not authored by this source.

**Air Inter 1980 · F-BPNB** is the new default. Switch between the two liveries under **Flight Setup → Livery** or **F27 Systems → Livery**. The six Air Inter color maps keep the source orientation, with no duplicated geometry or repainted markings. The exact same paint applies to exterior surfaces visible from the cockpit. White Classic remains available. The 1.48 MB exterior transfers with another 0.96 MB only when using Air Inter; cockpit and audio load separately.

This is a browser approximation, not a certified trainer or an approved source for actual flight operations. The original freeware restrictions are in `public/models/f27/NOTICE.md`.

## View and approach audio

Aircraft, current time of day, cockpit/exterior lights, and fresh shadow/occlusion data are applied before painting the first target-view frame. The old view stays active while the cockpit asset is loading. This avoids the visible shadow settling, not the basic rendering cost of the new scene. Graphics profiles without world shadows remain unchanged.

Optional spoken height assistance calls 100, 50, 40, 30, 20 and 10 feet on descent only. It does not say “Retard”; the supplied manuals do not document an F27 voice schedule. Approach minimums and V1/rotate are not spoken without an actual procedure/briefing. Terrain-derived height is a simulator estimate. See `F27-V4-CALLOUTS.md` for the source audit.

## Aircraft behavior

Landing reference speed now depends on mass and selected landing flap angle (1.3 times the model’s stall speed). The F27 final-approach start uses gear down, 26.5° flaps, and this modeled Vref + 15 kt, matching the setup described in the supplied add-on manual. Selective feathering cuts fuel and power to that engine while its prop still runs down. The gear horn now follows lever position and flap configuration rather than waiting for the turbine to slow. See `F27-V4-FLIGHT.md` for before/after checks, the EASA type-certificate data, and limits that remain unvalidated.
