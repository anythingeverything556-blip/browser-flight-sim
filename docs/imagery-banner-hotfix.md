# Imagery banner hotfix (EW-45 follow-up)

Baseline: owner source `b03b0bfb6afa2d81d22a5ed28eaf31550cc8da3c`.

## Behavior

- Startup deadlines still allow shaded/elevation fallback, without treating slow active or queued imagery as an outage.
- The existing single notice/retry button now requires an unresolved base-image failure/no-data tile wanted in the current frame, relevant to the aircraft or nearby visible terrain, and lacking usable drawn texture coverage.
- Usable parent coverage wins over pending/sharper children and legitimate maximum-detail no-data. Textured descendants likewise prevent an older parent failure from blaming an offscreen gap.
- The notice persists through retries of a real gap, clears on successful recovery or leaving its relevant area, and never relies on cumulative failure totals. Unchanged status text is not reassigned every frame.
- Full health scans are skipped in normal flight before any imagery failure/no-data and outside shaded-fallback mode.
- Automatic retries preserve healthy active/queued jobs and transient failure backoff. Only known no-data gaps are reopened automatically; manual retry also expedites relevant failed base tiles. Neither resets attempt history nor reopens covered detail limits.
- Regional source pools are included when checking startup loader idleness. Existing global/regional/4-slot request accounting is otherwise unchanged.
- Existing worker fetch timeout (20 seconds), tile backoff, fallback shader and DEM safety gate remain intact. Real timed-out requests become confirmed failures rather than remaining permanently hidden as loading.

## Verification

All commands run after unsetting `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`.

- `npm ci --ignore-scripts`: successful; no dependency or lockfile changes.
- `node test/imagery-notice-test.mjs`: successful.
- `node test/qa-flight-state-test.mjs`: successful.
- `node test/startup-fallback-test.mjs`: successful.
- `npm test`: **115 scripts passed, 0 failed**, including unchanged terrain selection/stitching/crossfade regression digests.
- `npm run build`: successful.
- `git diff --check`: successful.

New deterministic regressions include pending and active slow requests, regional/global queues, a real base-request failure callback amid other healthy requests, one stable notice without repeated status assignment, manual retry and recovery, automatic no-data retry, persistent confirmed outage, stale/unwanted/unrelated failures, teleport clearing before terrain update, textured parent/child coverage despite a strict sharpness denominator, offscreen gaps, maximum-detail limits, source/4-slot accounting, and actual terrain update -> request failure -> shaded mesh -> automatic backoff -> texture-upload recovery.

Detailed local evidence (not source artifacts): `imagery-regressions.log`, `qa-flight-state.log`, `startup-fallback.log`, `imagery-full-suite.log`, `imagery-full-test-results.json`, `imagery-build.log`, `npm-ci.log`.

## Scope / residuals

No provider, attribution, license, deployment, GitHub, credentials or authentication changes. No deployment performed. The parent task owns live-provider checks and the independent repeatable full-Chromium slow/failure/recovery fixture and screenshots; this commit does not claim live browser/GPU/provider verification.
