# Selected-aircraft startup code split

Baseline: `08e7f399`. Local production build only; no deployment or live provider traffic.

## Change

The bootstrap now downloads the shared simulator and selected visual module concurrently, then initializes only once both resolve. The existing aircraft-choice function, touch gate, early-click queue, required exterior/cockpit asset gates and model loaders are unchanged. Vite keeps Three.js and Leaflet cacheable without forcing optional aircraft loaders into one eager vendor chunk. No artwork, models, texture resolution, graphics presets or legal notices changed.

## Exact initial JavaScript bytes

Measured by cold-context Chrome requesting the built site from an isolated loopback static fixture. These are the sum of the actual requested main-window `.js` file lengths through usable home, excluding separate worker scripts. Gzip is a deterministic sum of `gzipSync` file sizes, not a measured production network transfer. HTML/CSS/fonts/models are outside this comparison.

| Aircraft | Before JS bytes | After JS bytes | Saved bytes | Before gzip bytes | After gzip bytes | Saved gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| da40 | 2123865 | 1890968 | 232897 | 704495 | 633138 | 71357 |
| c172 | 2123865 | 1949339 | 174526 | 704495 | 655270 | 49225 |
| sr71 | 2123865 | 1899474 | 224391 | 704495 | 636951 | 67544 |
| sf50 | 2123865 | 1925779 | 198086 | 704495 | 647569 | 56926 |
| f27 | 2123865 | 1943826 | 180039 | 704495 | 650929 | 53566 |
| il76 | 2123865 | 1915687 | 208178 | 704495 | 643575 | 60920 |

The same fixture verified all six selectable aircraft reach usable setup, load exactly their selected visual chunk, request no model assets on home, keep Start enabled and open/close Credits without page errors. SR-71 no longer requests the unused Draco loader. The dormant A380X import is retained but not newly exposed in the picker. Source regression covers all seven import functions and the existing DA40 default.

## Candid timing and request-count limitations

This is verified payload/evaluation-scope reduction, not a demonstrated end-to-end time or FPS improvement. One exploratory before/after sample per aircraft on a shared SwiftShader machine was noisy; it did **not** show a consistent faster ready time. The split raises initial main-window JS requests from 3 to 17–20. Vite preloads shared dependencies in parallel and main/selected transfers start together, but high-latency connection behavior needs a real HTTP/2 network benchmark before claiming faster startup.

| Aircraft | Before ready ms (one sample) | After ready ms (one sample) | After script requests |
| --- | ---: | ---: | ---: |
| da40 | 3460 | 4468 | 18 |
| c172 | 3268 | 3500 | 19 |
| sr71 | 3285 | 3336 | 17 |
| sf50 | 5031 | 3468 | 20 |
| f27 | 3510 | 3642 | 19 |
| il76 | 3066 | 4744 | 20 |

## Reproduce

```sh
npm run build
node test/aircraft-visual-load-test.mjs
LOADPERF_RESULT=/tmp/loadperf-home.json node test/aircraft-visual-load-browser-test.mjs
DISPLAY= SMOKE_AIRCRAFT=c172 SMOKE_OUTPUT_DIR=/tmp/loadperf-smoke node tools/browser-smoke.mjs
```

The browser regression uses its own static loopback server, intercepts every external request and fixtures local API endpoints. It never enables Vite preview provider proxies. Its fresh headless Chrome clears a stale inherited DISPLAY value: this machine had no display server, so the untouched baseline initially reported WebGL unavailable; clearing DISPLAY restored actual WebGL2/SwiftShader without changing the machine or application. For the old build, set `LOADPERF_BASELINE=1 LOADPERF_DIST_DIR=/path/to/old/dist`.

## Flight/cockpit smoke result

Both untouched and modified production builds passed `tools/browser-smoke.mjs` for C172: actual original 319,122-triangle model, started flight, entered cockpit, nonzero draw calls, 257 shader programs, zero failed programs, zero context-loss/shader/frame/page errors and zero missing local assets. All seven standard flight sheets opened. World imagery/API responses were synthetic fixtures; this does not validate live provider behavior or real hardware FPS. Before/after cockpit screenshots were inspected: the same model, instruments, moving-map overlay, flight HUD and controls remain present (not pixel-identical due to animation/FPS). Raw local receipts/screenshots are under `handoff/loadperf-evidence/`.
