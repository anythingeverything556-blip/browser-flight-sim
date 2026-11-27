#!/usr/bin/env node
// Offline evidence preflight only. Never launches a simulator or authorizes parity/deployment.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const AREAS = ['effects', 'analog-systems', 'audio'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const filled = value => object(value) && Object.keys(value).length > 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// No directory scan or reference outside the explicitly supplied evidence root.
// Reject links (including parent-directory links), URLs, absolute paths and traversal.
async function localFile(root, relative) {
  if (!text(relative) || relative.includes('\\') || relative.includes(':') ||
      path.posix.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('expected a relative local path without traversal');
  }
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('symbolic links are not accepted');
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error('expected directories ending in a regular file');
    }
  }
  return open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
}

export async function preflight(inputDirectory) {
  const blockers = [];
  const files = new Map();
  const areas = Object.fromEntries(AREAS.map(area => [area, { cases: 0, blocked: false }]));
  let record;
  let recordSha256 = null;
  const fail = message => blockers.push(message);
  const result = () => ({
    schemaVersion: 1,
    status: blockers.length ? 'blocked' : 'ready-for-review',
    parityVerified: false,
    deploymentAuthorized: false,
    licenseVerified: false,
    redistributionPermissionVerified: false,
    scope: 'Local evidence completeness and consistency only; no content, fidelity or numerical equivalence verdict.',
    comparisonId: text(record?.comparisonId) ? record.comparisonId : null,
    operator: text(record?.operator) ? record.operator : null,
    recordSha256,
    planId: text(record?.planId) ? record.planId : null,
    runs: Object.fromEntries(['browser', 'native'].map(side => [side,
      Object.fromEntries((side === 'browser'
        ? ['runId', 'buildId', 'browserVersion', 'os', 'gpu']
        : ['runId', 'buildId', 'platform', 'simulator', 'windowsVersion', 'simulatorBuild', 'addonBuild', 'gpu', 'licensedUseAttested'])
        .filter(field => record?.[side]?.[field] !== undefined)
        .map(field => [field, record[side][field]])),
    ])),
    requiredCases: Array.isArray(record?.requiredCases) ? record.requiredCases : [],
    gaps: [
      ...AREAS.map((area, i) => ({
        gap: i + 1, area, cases: areas[area].cases,
        status: areas[area].cases && !areas[area].blocked && !blockers.length
          ? 'evidence-present-unreviewed' : 'blocked',
      })),
      { gap: 4, area: 'native-verification-route', status: blockers.length ? 'blocked' : 'comparison-record-ready-for-review' },
    ],
    evidence: [...files.values()],
    blockers,
    nextStep: blockers.length ? 'Supply or correct the listed local records and evidence; rerun preflight.'
      : 'A qualified reviewer must examine captures, scenario coverage, measurement references and tolerances; this is not parity sign-off or deployment clearance.',
  });

  let root;
  try {
    if (!text(inputDirectory)) throw new Error('provide an evidence directory');
    root = await realpath(inputDirectory);
    if (!(await lstat(root)).isDirectory()) throw new Error('input must be a directory');
    const file = await localFile(root, 'record.json');
    try {
      if ((await file.stat()).size > 1024 * 1024) throw new Error('record.json exceeds 1 MiB');
      const bytes = await file.readFile();
      recordSha256 = digest(bytes);
      record = JSON.parse(bytes.toString('utf8'));
    } finally { await file.close(); }
    if (!object(record)) throw new Error('record.json must contain an object');
  } catch (error) {
    fail(`Input blocked: ${error.code || error.message}`);
    return result();
  }

  if (record.schemaVersion !== 1) fail('schemaVersion must be 1');
  for (const field of ['comparisonId', 'operator', 'planId']) {
    if (!text(record[field])) fail(`${field} is required`);
  }
  for (const side of ['browser', 'native']) {
    const baseline = record[side];
    if (!object(baseline)) { fail(`${side} baseline is required`); continue; }
    for (const field of ['runId', 'buildId']) {
      if (!text(baseline[field])) fail(`${side}.${field} is required`);
    }
  }
  for (const field of ['browserVersion', 'os', 'gpu']) {
    if (!text(record.browser?.[field])) fail(`browser.${field} is required`);
  }
  for (const field of ['windowsVersion', 'simulatorBuild', 'addonBuild', 'gpu']) {
    if (!text(record.native?.[field])) fail(`native.${field} is required`);
  }
  if (record.native?.platform !== 'Windows' || record.native?.simulator !== 'MSFS 2024') {
    fail('native baseline must declare Windows and MSFS 2024');
  }
  if (record.native?.licensedUseAttested !== true) {
    fail('native.licensedUseAttested must be true (operator attestation, not a license check)');
  }
  if (text(record.browser?.runId) && record.browser.runId === record.native?.runId) {
    fail('browser and native runId must identify distinct capture runs');
  }

  const plan = record.requiredCases;
  const cases = record.cases;
  if (!Array.isArray(plan) || !plan.length) fail('requiredCases must be a nonempty scenario plan');
  if (!Array.isArray(cases) || !cases.length) fail('cases must contain paired native and browser captures');
  const required = new Map();
  for (const item of Array.isArray(plan) ? plan : []) {
    if (!object(item) || !text(item.id) || !AREAS.includes(item.area) || !text(item.procedure)) {
      fail('each required case needs id, area (effects/analog-systems/audio) and procedure');
      continue;
    }
    if (required.has(item.id)) fail(`duplicate required case: ${item.id}`);
    required.set(item.id, item);
    areas[item.area].cases++;
  }
  for (const area of AREAS) {
    if (!areas[area].cases) fail(`requiredCases is missing area: ${area}`);
  }
  const seen = new Set();
  for (const item of Array.isArray(cases) ? cases : []) {
    if (!object(item) || !text(item.id)) { fail('each capture case needs id'); continue; }
    const start = blockers.length;
    if (seen.has(item.id)) fail(`duplicate capture case: ${item.id}`);
    seen.add(item.id);
    const planned = required.get(item.id);
    if (!planned) { fail(`unplanned capture case: ${item.id}`); continue; }
    if (item.area !== planned.area) fail(`${item.id}: area does not match plan`);
    if (!filled(item.conditions)) fail(`${item.id}: nonempty conditions are required`);
    for (const field of ['location', 'weather', 'aircraftState', 'camera', 'audioSettings']) {
      if (!filled(item.conditions?.[field])) fail(`${item.id}: conditions.${field} must be a nonempty object`);
    }
    if (!text(item.conditions?.timeUtc) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(item.conditions.timeUtc) ||
        !Number.isFinite(Date.parse(item.conditions.timeUtc))) fail(`${item.id}: conditions.timeUtc must be a UTC timestamp`);
    for (const side of ['browser', 'native']) {
      const capture = item[side];
      const label = `${item.id}.${side}`;
      if (!object(capture)) { fail(`${label}: capture is required`); continue; }
      for (const [field, expected] of Object.entries({
        comparisonId: record.comparisonId, caseId: item.id,
        runId: record[side]?.runId, buildId: record[side]?.buildId,
      })) {
        if (!text(capture[field]) || capture[field] !== expected) fail(`${label}: mismatched or missing ${field}`);
      }
      if (!isDeepStrictEqual(capture.conditions, item.conditions)) fail(`${label}: conditions do not match scenario`);
      if (!Array.isArray(capture.evidence) || !capture.evidence.length) {
        fail(`${label}: local evidence is required`);
        continue;
      }
      for (const evidence of capture.evidence) {
        if (!object(evidence) || !text(evidence.path) || !/^[a-f0-9]{64}$/.test(evidence.sha256)) {
          fail(`${label}: each evidence file needs a local path and lowercase SHA-256`);
          continue;
        }
        try {
          if (!files.has(evidence.path)) {
            const file = await localFile(root, evidence.path);
            try {
              const sizeBytes = (await file.stat()).size;
              if (!sizeBytes) throw new Error('evidence file is empty');
              const hash = createHash('sha256');
              for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
              files.set(evidence.path, { path: evidence.path, sizeBytes, sha256: hash.digest('hex') });
            } finally { await file.close(); }
          }
          if (files.get(evidence.path).sha256 !== evidence.sha256) throw new Error('SHA-256 mismatch');
        } catch (error) { fail(`${label}: ${evidence.path}: ${error.code || error.message}`); }
      }
    }
    if (blockers.length > start) areas[planned.area].blocked = true;
  }
  for (const [id, planned] of required) {
    if (!seen.has(id)) { fail(`missing planned case: ${id}`); areas[planned.area].blocked = true; }
  }
  return result();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node tools/sr71-native-parity-preflight.mjs <local-evidence-directory>\nReads record.json and listed files only. JSON report to stdout; exit 0 = ready for review, 1 = blocked, 2 = usage error. Never verifies parity or authorizes deployment.');
  } else if (process.argv.length !== 3 || process.argv[2].startsWith('-')) {
    console.error('Usage: node tools/sr71-native-parity-preflight.mjs <local-evidence-directory>');
    process.exitCode = 2;
  } else {
    const report = await preflight(process.argv[2]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'ready-for-review' ? 0 : 1;
  }
}
