// Synthetic local files only: these tests never capture or substantiate SR-71 parity.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { preflight } from '../tools/sr71-native-parity-preflight.mjs';

const cli = fileURLToPath(new URL('../tools/sr71-native-parity-preflight.mjs', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const AREAS = ['effects', 'analog-systems', 'audio'];

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'sr71-preflight-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = {
    schemaVersion: 1, comparisonId: 'synthetic-comparison', operator: 'Synthetic test operator', planId: 'synthetic-plan-v1',
    browser: { runId: 'browser-run', buildId: 'earthwing-synthetic-sha', browserVersion: 'Synthetic browser', os: 'Synthetic OS', gpu: 'Synthetic GPU' },
    native: { runId: 'native-run', buildId: 'native-synthetic-id', platform: 'Windows', simulator: 'MSFS 2024',
      windowsVersion: 'Synthetic Windows', simulatorBuild: 'synthetic-msfs-build', addonBuild: 'synthetic-addon-build',
      gpu: 'Synthetic GPU', licensedUseAttested: true },
    requiredCases: AREAS.map((area, i) => ({ id: `synthetic-${i}`, area, procedure: `Synthetic ${area} fixture, not a capture procedure` })),
    cases: [],
  };
  await mkdir(path.join(root, 'captures'));
  for (const planned of record.requiredCases) {
    const conditions = {
      location: { latDeg: 0, lonDeg: 0, altitudeMslFt: 0 }, weather: { preset: 'synthetic-clear' },
      timeUtc: '2026-11-26T12:00:00Z', aircraftState: { throttle: 0, fuelKg: 1 },
      camera: { view: 'synthetic' }, audioSettings: { sampleRateHz: 48000, channels: 2 },
    };
    const item = { id: planned.id, area: planned.area, conditions };
    for (const side of ['browser', 'native']) {
      const relative = `captures/${planned.id}-${side}.txt`;
      const bytes = `SYNTHETIC ONLY ${planned.id} ${side}\n`;
      await writeFile(path.join(root, relative), bytes);
      item[side] = {
        comparisonId: record.comparisonId, caseId: planned.id,
        runId: record[side].runId, buildId: record[side].buildId,
        conditions: structuredClone(conditions), evidence: [{ path: relative, sha256: sha256(bytes) }],
      };
    }
    record.cases.push(item);
  }
  const save = () => writeFile(path.join(root, 'record.json'), JSON.stringify(record, null, 2));
  await save();
  return { root, record, save };
}

const blocked = (report, pattern) => {
  assert.equal(report.status, 'blocked');
  assert.equal(report.parityVerified, false);
  assert.equal(report.deploymentAuthorized, false);
  assert.ok(report.blockers.some(message => pattern.test(message)), JSON.stringify(report.blockers));
};

test('absent directory and absent record block; no implicit input discovery', async t => {
  const f = await fixture(t);
  blocked(await preflight(path.join(f.root, 'absent')), /Input blocked/);
  await mkdir(path.join(f.root, 'empty'));
  blocked(await preflight(path.join(f.root, 'empty')), /ENOENT/);
  blocked(await preflight(), /provide an evidence directory/);
});

test('invalid or oversized record fails closed', async t => {
  const f = await fixture(t);
  for (const bytes of ['{', 'null', ' '.repeat(1024 * 1024 + 1)]) {
    await writeFile(path.join(f.root, 'record.json'), bytes);
    blocked(await preflight(f.root), /Input blocked/);
  }
});

test('empty plan/captures and missing area block', async t => {
  const f = await fixture(t);
  f.record.requiredCases = [];
  f.record.cases = [];
  await f.save();
  blocked(await preflight(f.root), /requiredCases/);
  const g = await fixture(t);
  g.record.requiredCases.pop(); g.record.cases.pop();
  await g.save();
  blocked(await preflight(g.root), /missing area: audio/);
});

test('missing native baseline and missing local captures block', async t => {
  const f = await fixture(t);
  delete f.record.native;
  delete f.record.cases[0].native;
  await f.save();
  blocked(await preflight(f.root), /native baseline is required/);
  const g = await fixture(t);
  g.record.cases[0].native.evidence = [];
  await g.save();
  blocked(await preflight(g.root), /local evidence is required/);
});

test('native platform, build identity and license attestation are mandatory metadata', async t => {
  for (const [field, value, pattern] of [
    ['platform', 'Linux', /Windows and MSFS 2024/], ['simulator', 'Other sim', /Windows and MSFS 2024/],
    ['licensedUseAttested', false, /licensedUseAttested/], ['addonBuild', '', /addonBuild/],
  ]) {
    const f = await fixture(t);
    f.record.native[field] = value;
    await f.save();
    blocked(await preflight(f.root), pattern);
  }
});

test('mismatched comparison, run, case and build IDs block', async t => {
  for (const field of ['comparisonId', 'runId', 'caseId', 'buildId']) {
    const f = await fixture(t);
    f.record.cases[0].native[field] = 'wrong';
    await f.save();
    blocked(await preflight(f.root), new RegExp(`mismatched or missing ${field}`));
  }
});

test('capture conditions must match the planned shared conditions', async t => {
  const f = await fixture(t);
  f.record.cases[0].native.conditions.weather.preset = 'different';
  await f.save();
  blocked(await preflight(f.root), /conditions do not match/);
  const g = await fixture(t);
  delete g.record.cases[0].conditions.camera;
  await g.save();
  blocked(await preflight(g.root), /conditions.camera/);
});

test('missing, duplicate and unplanned scenarios block', async t => {
  for (const mode of ['missing', 'duplicate', 'unplanned']) {
    const f = await fixture(t);
    if (mode === 'missing') f.record.cases.pop();
    if (mode === 'duplicate') f.record.cases.push(structuredClone(f.record.cases[0]));
    if (mode === 'unplanned') f.record.cases[0].id = 'not-planned';
    await f.save();
    blocked(await preflight(f.root), new RegExp(`${mode === 'missing' ? 'missing planned' : mode === 'duplicate' ? 'duplicate capture' : 'unplanned capture'} case`));
  }
});

test('missing, empty and changed evidence files block', async t => {
  for (const mode of ['missing', 'empty', 'changed']) {
    const f = await fixture(t);
    const evidence = f.record.cases[0].browser.evidence[0];
    if (mode === 'missing') evidence.path = 'absent.png';
    else await writeFile(path.join(f.root, evidence.path), mode === 'empty' ? '' : 'changed synthetic content');
    await f.save();
    blocked(await preflight(f.root), mode === 'missing' ? /ENOENT/ : mode === 'empty' ? /file is empty/ : /SHA-256 mismatch/);
  }
});

test('URLs, absolute paths, traversal and symbolic links cannot supply evidence', async t => {
  for (const relative of ['../outside.txt', '/etc/passwd', 'https://example.invalid/capture', 'C:\\capture.wav', 'captures/../record.json']) {
    const f = await fixture(t);
    f.record.cases[0].native.evidence[0].path = relative;
    await f.save();
    blocked(await preflight(f.root), /relative local path/);
  }
  const f = await fixture(t);
  await symlink('record.json', path.join(f.root, 'link'));
  f.record.cases[0].native.evidence[0].path = 'link';
  await f.save();
  blocked(await preflight(f.root), /symbolic links/);
  await symlink('captures', path.join(f.root, 'linkdir'));
  f.record.cases[0].native.evidence[0].path = 'linkdir/synthetic-0-native.txt';
  await f.save();
  blocked(await preflight(f.root), /symbolic links/);
});

test('matching local records are reproducible and ONLY ready for human review', async t => {
  const f = await fixture(t);
  f.record.parityVerified = true; // Untrusted input cannot override the report.
  f.record.deploymentAuthorized = true;
  await f.save();
  const before = await readFile(path.join(f.root, 'record.json'));
  const report = await preflight(f.root);
  assert.equal(report.status, 'ready-for-review');
  assert.equal(report.parityVerified, false);
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.licenseVerified, false);
  assert.equal(report.redistributionPermissionVerified, false);
  assert.equal(report.evidence.length, 6);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.recordSha256, sha256(before));
  assert.equal(report.gaps.length, 4);
  assert.ok(report.gaps.slice(0, 3).every(gap => gap.status === 'evidence-present-unreviewed'));
  assert.deepEqual(await preflight(f.root), report);
  assert.deepEqual(await readFile(path.join(f.root, 'record.json')), before);
});

test('CLI returns 0 for ready-for-review, nonzero for missing evidence or usage', async t => {
  const f = await fixture(t);
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const ready = invoke([f.root]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).status, 'ready-for-review');
  await rm(path.join(f.root, f.record.cases[0].native.evidence[0].path));
  const missing = invoke([f.root]);
  assert.equal(missing.status, 1, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).status, 'blocked');
  assert.equal(invoke([]).status, 2);
  assert.equal(invoke(['--help']).status, 0);
});
