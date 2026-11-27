# Camera update allocation reduction

## Scope and correctness

Base: owner archive `08e7f399`. Only production change: `src/camera.js`.
Camera math vectors, quaternion, Euler and look-at matrix are owned per rig and
reused. Retained chase/fly-by positions remain separate from temporary storage
so main-loop origin rebasing continues to work. The Euler order is explicitly
restored to XYZ for shake after cockpit YXZ calculations.

No equations, update cadence, projection settings, FOV, camera eye, assets,
physics, cockpit materials/lights/gauges, terrain/workers, dynres or render scale
were changed. Projection matrices are still refreshed on every call. There is
no quality/feature reduction or network dependency.

The baseline fixture is byte-for-byte `git show 08e7f399:src/camera.js`, SHA-256
`4593dc965269ee0f68542939888aa6f7566541c6e1b93435855dad514ada7fdf`.
The regression asserts the hash, then checks **50,400 exact (not tolerance)
comparisons** of camera world position, quaternion, FOV, near, projection and
inverse matrices, chase/fly-by state and shake time. Seven views, six geometry
settings, separate interleaved rigs, shake on/off, view transitions, zoom, zero
dt, teleport/rebase, stopped/vertical flight and terrain clamp are covered.
Physics position/velocity/quaternion inputs are verified unchanged on every case.

After initialisation the moving fixture constructs zero Three math objects in
all seven views, including cabin. Count instrumentation includes clones of
input vectors via their constructors; it is not a count of all JavaScript or
Three-internal allocations. Initial setup retains eleven scratch math objects
per rig. Chase resets/large discontinuities may still construct a retained
position; no blanket zero-allocation claim is made for all lifecycle events.

## Same-fixture CPU timing

Local Node v26.12.1, Linux Intel Xeon, Three r180. Both versions load against the
same library with a mock event sink; no browser, renderer, downloads or service.
1024 deterministic cyclic moving/turning poses, dt 1/60, shake 0.2, analytical
height function; identical PerspectiveCamera and projection work. 32,768 warmup
frames per view/version, 15 alternating paired rounds of 65,536 frames. Timing
is uninstrumented; constructor instrumentation runs only after all timings.
Raw per-round values and round p95s are retained in
`test/fixtures/frameperf/paired-camera-bench.json`.

Median **microseconds per CameraRig.update**, not milliseconds per game frame:

| View | Before µs | After µs | Reduction | Math constructions/frame |
| --- | ---: | ---: | ---: | ---: |
| cockpit | 0.524 | 0.424 | 19.1% | 5.000 → 0 |
| chase | 0.653 | 0.481 | 26.2% | 13.000 → 0 |
| orbit | 0.545 | 0.438 | 19.6% | 7.000 → 0 |
| tower | 0.496 | 0.407 | 18.0% | 7.000 → 0 |
| wing | 0.713 | 0.630 | 11.7% | 5.000 → 0 |
| flyby | 1.161 | 0.876 | 24.5% | 7.010 → 0 |
| cabin | 0.495 | 0.439 | 11.4% | 5.000 → 0 |

These are small CPU microbenchmark savings only. They do **not** demonstrate an
observable FPS/latency improvement, GPU gain or elimination of game-wide stutter.
At the measured chase median, the absolute saving is well below 0.001 ms/frame.
Machine load/JIT affect tiny timings; deterministic allocation removal and exact
output parity are the stronger guarantees.

## CPU profiling

`cpu-profile-summary.json` retains top self-sample functions, sample counts and
raw-profile SHA-256s from separate V8 CPU-profile runs of 1,966,080 frames per
view/version. Shake's trigonometric wave function dominates; update and Three
matrix/quaternion functions are also sampled hot, with garbage-collection
samples in the baseline. These full-process profiles include harness setup and
warmup; the sampled GC counts are diagnostic, not a GC-pause or frame-time claim.
The change removes repeated math construction without reducing the camera work.
Raw profiles were kept outside source under `/tmp/frameperf-profiles` and are
not required to run the benchmark or correctness tests.

Reproduce (no network/server needed after installing locked dependencies):

```sh
node test/camera-frameperf-test.mjs
node test/camera-frameperf-bench.mjs /tmp/paired-camera-bench.json
CAMERA_PROFILE=before BENCH_FRAMES=131072 BENCH_ROUNDS=15 node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=camera-before.cpuprofile test/camera-frameperf-bench.mjs
CAMERA_PROFILE=after BENCH_FRAMES=131072 BENCH_ROUNDS=15 node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=camera-after.cpuprofile test/camera-frameperf-bench.mjs
```

## Verification

Nine relevant scripts passed; per-script receipts are in
`test/fixtures/frameperf/regression-results.json`:

- camera-frameperf-test: exact parity and steady-state construction guard.
- flight-alloc-test: all 240 recorded physics values bit-identical.
- flight-reference-test: six model trim/speed/first-physics-step references.
- ew-guidance-regressions-test: includes real fly-by wheel zoom and gauges.
- a380x-assets-test: includes actual CameraRig passenger-eye behavior with mocks.
- f27-camera-v3-test: pilot eye, saved seat limits, panel preset.
- sr71-cockpit-test: thirteen functional original-art instrument/control tests.
- sr71-cockpit-lighting-test: original sixteen emitters, optics and dimmers.
- sr71-ivsi-test: original needle calibration and monotonic sweep.

`npm run build` passed (6.43 s). `git diff --check` passed. No full-game/browser
FPS test or screenshot claim; exact transforms/projection plus original-art
functional tests are the no-quality-regression evidence for this isolated change.
Nothing deployed, published or sent to an external service.
