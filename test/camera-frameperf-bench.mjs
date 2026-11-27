import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { loadCamera, baselinePath, candidatePath, allocationCounter, makeRig, countedFrames, sample } from './helpers/camera-frameperf.mjs';

// Paired, alternating order, warm same-fixture CPU microbenchmark. No renderer,
// GPU, network, terrain worker, resolution change or simulator state step.
const frames = Number(process.env.BENCH_FRAMES || 65536);
const rounds = Number(process.env.BENCH_ROUNDS || 15);
const profileOnly = process.env.CAMERA_PROFILE; // before / after, for --cpu-prof
const variants = { before: loadCamera(baselinePath), after: loadCamera(candidatePath) };
for (const api of Object.values(variants)) api.configureCameraAircraft({ cabin: { x: -2, y: 3, z: .4 } });
const output = { environment: { node: process.version, cpu: cpus()[0].model, platform: process.platform },
  fixture: '1024 deterministic cyclic moving/turning flight poses, 60 Hz dt, shake 0.2, same Three r180 PerspectiveCamera; mock event sink, analytical terrain height only',
  method: { framesPerRound: frames, rounds, warmupFrames: 32768, alternatingOrder: true, units: 'microseconds per CameraRig.update including updateProjectionMatrix', profileOnly: profileOnly || null }, views: {} };
const quantile = (a, p) => a.slice().sort((a, b) => a - b)[Math.floor((a.length - 1) * p)];
for (const view of variants.before.VIEWS) {
  const rigs = Object.fromEntries(Object.entries(variants).map(([label, api]) => [label, makeRig(api, view).rig]));
  const times = { before: [], after: [] };
  for (let i = 0; i < 32768; i++) for (const label of profileOnly ? [profileOnly] : ['before', 'after']) sample(rigs[label], i);
  for (let round = 0; round < rounds; round++) {
    const labels = profileOnly ? [profileOnly] : round % 2 ? ['after', 'before'] : ['before', 'after'];
    for (const label of labels) {
      const rig = rigs[label], start = performance.now();
      for (let i = 0; i < frames; i++) sample(rig, i);
      times[label].push((performance.now() - start) * 1000 / frames);
    }
  }
  const timing = {};
  for (const label of ['before', 'after']) if (times[label].length) timing[label] = { medianUs: quantile(times[label], .5), p95RoundUs: quantile(times[label], .95), samplesUs: times[label] };
  output.views[view] = { timing };
}
// Keep instrumented subclasses out of timed warmup/measurement: sharing the
// same Three prototype methods can otherwise make later views polymorphic.
if (!profileOnly) for (const view of variants.before.VIEWS) {
  const allocations = {};
  for (const [label, source] of [['before', baselinePath], ['after', candidatePath]]) {
    const counter = allocationCounter(), api = loadCamera(source, counter.three), { rig } = makeRig(api, view);
    const fixture = countedFrames(counter.three);
    sample(rig, 0, fixture); counter.reset();
    for (let i = 1; i <= 1024; i++) sample(rig, i, fixture);
    allocations[label] = { ...counter.counts };
  }
  output.views[view].mathConstructorCallsPer1024Frames = allocations;
}
const json = JSON.stringify(output, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(json);
