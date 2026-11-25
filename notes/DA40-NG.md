# Diamond DA40 NG — private Earthwing integration

## Original source and notices

The standalone Diamond DA40 visual asset is derived from **Diamond DA40 NG for FlightGear**, [source revision `0d50a457edb203b9ac6058b41cac1b33922acf28`](https://github.com/sryu1/DA40/tree/0d50a457edb203b9ac6058b41cac1b33922acf28). The source is available [as an original archive](https://codeload.github.com/sryu1/DA40/tar.gz/0d50a457edb203b9ac6058b41cac1b33922acf28) (SHA-256 `eb8ce8950d7fe7d344012f1635e46d154e9f28496786f08f13699a8da643d64d`). Retain its `COPYING` (GNU GPL v2) and all contributor notices. These terms apply to the DA40-derived material, not Earthwing's own software or its other aircraft. This is an unofficial adaptation; no endorsement by Diamond, Garmin, or FlightGear is implied. Do not distribute a combined public build without confirming permissions for both Earthwing and the third-party assets.

Upstream credit: Bea Wolf, Sascha Reiszner, Joshua Davidson, Emmanuel Baranger, Maik Justus, Torsten Dreyer, the C172 authors, Onox, B. Hallinger, Philip Zakharov, Noah Ryu, and the other upstream contributors. Refer to the original README, THANKS, and `da40-base.xml` for the original attribution.

## Isolated local validation

From the project root, run `npm ci`, then `node tools/da40-qa-build.mjs`. This builds a test tree at `.scratch/da40/dist` and copies the DA40 and existing small models. It intentionally omits the multi-gigabyte A380 asset directory without modifying the source files or any release build. Run `npm run preview -- --outDir .scratch/da40/dist` and open `http://localhost:4173/?aircraft=da40`. The browser smoke harness uses a synthetic map/terrain fixture to isolate simulator behavior; it is not a test of live weather/terrain providers.

```sh
SMOKE_DIST_DIR=.scratch/da40/dist SMOKE_AIRCRAFT=da40 npm run test:smoke
```

The comparable aircraft budget is the set of model and rig resources requested by DA40, versus the Il-76's 2,007,968-byte GLB. It excludes shared files such as the already-present Draco decoder, base simulator code, terrain, audio reused from the base application, and human-readable third-party notices. Report measurement and motion coverage from the final validation, not an earlier unassembled size probe.
