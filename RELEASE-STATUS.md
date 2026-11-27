# Blackbird private repair release status

Owner repair commit: `68152dbee6618dfa0bd262796e8c8a3c52dde698`  
Original inspected owner archive: 899 files, SHA-256 `3d436d9cd5f0bb9b522d49e613bc0269fa9bd58a4ee94ca5b2713eed3893d60b`  
Public upstream comparison: `anythingeverything556-blip/browser-flight-sim` at `db8ac6578770e2ad4569afccc5d6372dedf758b0`. The bases shared 560 identical files, 28 different common paths, 311 owner-only paths and 2 upstream-only paths. This candidate starts with the owner archive; the upstream code was used to scope the mirror package, not as a substitute build.

## Repairs and verification

- **26 isolated workstreams integrated; fixes mapped to 45 distinct audited IDs.** The first combined test run caught cross-lane fixture and tutorial-hint incompatibilities. Those were resolved; the failed cases and their negative/positive behavioral assertions stayed in the suite.
- **Node 24 final suite:** 188/188 scripts passed; Node 24 production build passed.
- **Browser:** the post-build tests used local offline fixtures, headless Chrome and software WebGL, not live production or real-device hardware. The integrated repair build passed the 12-viewport home layout and invalid/valid stored render-scale checks. The integrated Node suite includes keyboard, modal, and throttle regression tests. The six-aircraft home-launch check verified the selected visual module, no model download at home, enabled Start, and no page errors.
- C172: browser start, cockpit rendering and panel checks passed with no page or local asset errors.
- SF50: browser start, cockpit rendering and panel checks passed with no page or local asset errors.
- SR-71 slow-renderer diagnostic: actual cockpit model loaded; exit, re-entry and advancing flight passed with no page or local asset errors.
- The stock SR-71 smoke exceeded its 15-second cockpit event deadline twice in SwiftShader. The captured state showed the cockpit rendering; the separate diagnostic used a 90-second event deadline and stricter model/re-entry checks. Do not read that diagnostic as a stock smoke pass or a speed claim.

## Measured performance, not a guarantee

These are startup main-window JS bytes fetched through usable home in fresh local Chrome contexts. Gzip is calculated per downloaded file, not a measurement of production HTTP transfer. Shader/model art and graphics quality were not deliberately lowered. The split increases chunk requests (roughly 3 → 17–20), so fewer bytes do not yet imply consistently faster elapsed loads. The camera-only benchmark showed 13 → 0 steady-frame Three math constructions and exact pose equality across 50,400 fixture comparisons. It is not a real-device FPS or stutter measurement.

| Selection | Before JS | Repaired JS | Before gzip | Repaired gzip |
|---|---:|---:|---:|---:|
| da40 | 2,123,865 | 1,909,656 | 704,495 | 639,544 |
| sr71 | 2,123,865 | 1,918,162 | 704,495 | 643,353 |

## Production and public mirror: held

`earthwing.pages.dev` and `sr71-blackbird.pages.dev` both responded normally and served the same existing JavaScript entry filename during the read-only preflight. The supplied Cloudflare credential was used only to verify token status and read both existing `main` projects. No token value, authentication header or account identifier is included. No Cloudflare upload or GitHub write was made.

The owner archive includes converted third-party Milviz SR-71 material and F27 material whose handoff does not grant public redistribution. The host code has a private-use/no-publishing license outside the authors’ authorized distribution, and the DA40 assets have separate corresponding-source terms. Release-specific rights evidence or explicitly approved replacement assets, plus the final deploy qualification, are required before any public upload. Being able to access the Pages projects or finding previous copies online does not clear those terms. Original notices are preserved and the inaccurate current-asset attribution is corrected.

The owner ZIP is private. The GitHub ZIP is a review kit: it preserves repository-relative file paths but intentionally omits changed/owner-only aircraft/audio payloads, programs and private handoff records where noted in its manifest. It is not a runnable, approved public replacement by itself. No generated dist, dependencies, or secrets are packaged. Actual live load time, FPS, and performance on customer devices are unverified. Tested local cold-start timings did not establish a speedup.

## Per-lane fix index

| Lane | Issue IDs or qualification scope | Integrated commit |
|---|---|---|
| workers | B01 B11 | `215ac591e937` |
| keys | B02 B03 | `42b014348836` |
| f27 | B04 Q02 | `f4069cf676f0` |
| rudder | B05 | `f1b85e1117fa` |
| trafficpoll | B06 | `4938211ae0f1` |
| trafficfresh | B07 | `22f335f19498` |
| trafficmap | B08 B09 | `0b354c6ebe36` |
| metar | B10 | `4b002a96c0db` |
| logbook | B12 | `0e5f95b39bf8` |
| home | B13 | `ab1caeeed2f8` |
| throttle | B14 B19 | `e4cabbe1907c` |
| access | B15 B16 B20 | `cc60b07b5748` |
| camera | B17 B18 | `b64c7310e9c6` |
| sf50mode | E01 E04 | `89baf7f87cb4` |
| apcapture | E02 | `049c154501a2` |
| route | E03 Q01 | `35e002c035bb` |
| radio | E05 E06 E07 E08 E11 E12 | `dc318d57ec1b` |
| tutorial | E09 E10 | `16ee6acf08ac` |
| render | E13 E22 | `9e02abc2787d` |
| terrain | E14 E15 | `3bc1b80aa3c4` |
| devices | E16 E17 | `fb28cef64719` |
| instruments | E18 E19 E20 E21 | `ae482768e7b9` |
| labels | Q03 | `fa3fdebef77f` |
| loadperf | load-performance | `230f54101396` |
| frameperf | frame-performance | `22f637c7d953` |
| harness | test-harness | `8117d6666874` |
