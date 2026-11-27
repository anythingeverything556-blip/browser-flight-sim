# Local qualification harness

Run from the checkout root after `npm ci`, using the CI Node 24 toolchain and an
installed Chrome/Chromium. Legacy SR-71 probes now use the project's exact pinned
`puppeteer-core`, not a separate machine's Playwright installation. Set
`CHROME_PATH` if Chrome is outside the common installation paths.

## Focused release checks

- `node --test test/qa-harness-support-test.mjs` (also in `npm test`): portable
  browser lookup, loopback-only fixture origins, bounded condition waits, listener
  failures, and persistence of failed assertions before/after failed captures.
- `node test/intro-layout-browser-test.mjs`: six aircraft in the checked-in 3×2
  desktop grid, existing text/overlap assertions, native keyboard visibility and
  scroll reachability across twelve viewports. Screenshots use `INTRO_SCREENSHOTS`.
- `npm run build`, then `node tools/qa-flight-browser.mjs`: zero SR-71 model
  requests on home; Start requests current SR-71 manifests and waits when stalled;
  navigating to C172 still starts flight. Separately verifies presets clear auto
  weather, then seeds Storm followed by explicit METAR opt-in before testing saved
  weather isolation. Existing restart, slew and graphics assertions remain active.
- `SMOKE_AIRCRAFT=f27 npm run test:smoke`: idle-prefetch observation gets its own
  bounded 20-second window, not an audio-completion deadline. Data-saving mode is
  recorded and exempts only idle prefetch; actual cockpit entry still requires the
  served cockpit asset and visible interior. Audio and cockpit assertions remain.
- `npm run test:smoke:negative`: controlled console, page and GLSL failures must
  still fail, without unrelated fixture errors.

Built-app harnesses mock external page/terrain data; listeners bind only to
127.0.0.1 on an ephemeral port. Bind errors reject instead of stranding startup.
They do not validate live services, native avionics or hardware performance.

`smoke-checkpoint.json` is written **before and after** each screenshot and keeps
completed checks if capture fails. Capture errors still fail the run. The explicit
`SMOKE_SKIP_SCREENSHOTS=1` diagnostic mode records each capture as skipped; it is
not visual proof or a standard-profile release pass. `qa-flight-checkpoint.json`
likewise preserves completed QA state before its final graphics screenshot.

## Historical SR-71 probes

Run a local Vite fixture first, e.g. `npm run dev -- --host 127.0.0.1`, then invoke
any of the nine historical `test/sr71-*-browser.mjs`, game-smoke, cockpit-browser,
optional-detail, surface-signs, perf-bench or browser-proof probes. These scripts
are not promoted to the default suite: their original product assertions remain
unchanged and may expose legitimate failures. Their default base is
`http://127.0.0.1:5173`; `SR71_TEST_BASE` may select another HTTP loopback port,
not a live site. Artifacts go under `.scratch/sr71` or `SR71_TEST_OUTPUT`.

No production code, visual layouts, model/audio assets or assertion thresholds
should be altered merely to make these checks pass. Report adjusted-cost,
partial, timed-out and skipped-evidence runs as such.
