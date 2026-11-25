# Flight-state and graphics QA corrections

Scope: browser toy simulator only. EW-04, EW-07–11, EW-30–34, EW-38 and EW-45.
No deployment, authentication, production traffic, or GitHub changes.

| Finding | Correction | Deterministic coverage / remaining qualification |
| --- | --- | --- |
| EW-04 | Temporary Quick start and Resume conditions are overlaid at the preference serialization boundary; unrelated settings saves retain original weather preferences. Deliberate weather edits commit current conditions. | New regression exercises voice/volume saves; browser fixture checks saved storm/auto preferences against active quick-start clear/auto-off conditions. |
| EW-07 | Airport restart preserves the setup and begins a fresh logbook attempt. Teleport restart remains intentionally untracked. | Real restart function + FlightLogbook fixture verifies a subsequent landing can be recorded; browser checks active setup/log after restart. |
| EW-08 | Weather intent generation invalidates older requests on reset, presets, manual weather edits, departure/spawn changes and auto-mode changes. Stale successes/errors do not apply, save or clear newer busy state. | Deferred promises exercise invalidation, overlapping requests and latest-success application; no production METAR request is used. |
| EW-09 | Validated bounded weather snapshots include cloud cover/base, wind, turbulence, visibility and visual precipitation/fog. Resume restores them without enabling live updates. METAR arrival updates the existing attempt's saved setup. | Storage roundtrip, late update identity/duration retention, malformed snapshot rejection, and size checks. Old records without snapshots retain the existing preset fallback. Raw METAR/ATIS text and QNH metadata are not archived. |
| EW-10 | Finite nonnegative visibility parsing preserves numeric zero instead of defaulting to 10 SM. | Raw `0000 FG VV001`, numeric/string zero, absent, negative, malformed and quarter-mile cases. Nearby-thunderstorm policy is intentionally unchanged. |
| EW-11 | Context loss suspends frame work, flight controls and audio and exposes a recovery notice. Context restoration alone cannot resume flight: the player reloads to rebuild all scenery/cockpit resources safely. | Event fixture and frame guard plus browser context-loss/restoration exercise. This is explicit reload recovery, not unverified in-place restoration of discarded streamed resources. |
| EW-30 | Optional Blackbird LOD has an independent 1.5-second end-to-end deadline, abort signal and decoder lifetime; it cannot consume the mandatory asset timeout. Original synchronous mesh/proxy setup is retained for a timely optional model. | Deterministic never-resolving fetch fixture verifies timeout/abort/disposal. Browser fixture stalls the LOD request while requiring Blackbird boot readiness. |
| EW-31 | Adaptive toggle clears pressure levels/counters and stale downscale probes/caps as well as restoring render scale. | Tests OFF at levels 0–3. Existing independent adaptive-cloud policy and session preset fallback remain unchanged. |
| EW-32 | Every window resize rebases native render/cloud dimensions, not only pixel-ratio changes. | Constant-DPR 800×600 → 1600×1200 fixture verifies native cloud dimensions. No real-GPU performance claim. |
| EW-33 | Slew exit preserves entry speed inside aircraft-specific in-game EAS bounds instead of imposing the Blackbird minimum on all aircraft. | Actual C172 physics steps at several approach altitudes, bounded defaults for all aircraft and a near-ground stationary case; browser toggles slew twice on approach. |
| EW-34 | Spawn/restart explicitly clears temporary slew state and its captured speed. | Actual spawn-reset prefix plus browser slew-active restart and alive/normal-flight assertions. |
| EW-38 | Systems integrate once for each actual warp simulation iteration; indication-only refreshes use zero delta. Pause, loading, menu, slew, crash and graphics hold consume nothing. | Actual scheduling fragment plus AircraftSystems compares equal 10.24 simulated seconds at 1× and 16× and paused control. |
| EW-45 | Notice text distinguishes slow imagery, confirmed failed/no-coverage requests, terrain still pending and ready-flight shaded fallback; it clears on imagery recovery even if elevation remains pending. | Real finishPending function at 12.001 seconds with active imagery and missing elevation, confirmed-failure text, and later successful recovery. |

## Repeatable checks

- `node test/qa-flight-state-test.mjs` (included in `npm test`).
- `node tools/qa-flight-browser.mjs` after `npm run build`: local Chromium/SwiftShader with synthetic terrain, local models and intercepted external resources; writes evidence to `qa-flight-smoke/` by default. This is not physical hardware, real terrain, a complete flown landing, a live-provider test or a deployment.
- `npm test` and `npm run build`.

Before running project code, unset `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Dependency install used `npm ci --ignore-scripts`.

## Validation result

- Full suite: **107/107 scripts passed** (including the new per-ID deterministic regressions).
- Production build: passed.
- Focused Chromium fixture: passed with no page/frame/shader/request errors or missing local files; real SwiftShader WebGL2 drew 298 calls with 136 programs before the deliberate context-loss test.
- Browser assertions passed: temporary-weather preference isolation, unchanged C172 slew-entry/exit speed (33.46 m/s), tracked restart, cleared slew, live aircraft after restart, frozen simulation/controls on context loss, continued suspension after context restoration, and Blackbird startup with an indefinitely stalled optional LOD request.
- Evidence in the working checkout: `qa-flight-full-suite.log`, `qa-flight-browser.log`, and `qa-flight-smoke/smoke-positive.json`; screenshot `qa-flight-smoke/qa-flight-context-held.png`. These generated files are not source changes.
